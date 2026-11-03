// Reuse Catalog's unchanged prepared corpus with an explicitly identified private candidate.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [mode,catalog,directory,consumer,artifact,output]=process.argv.slice(2);
assert(['javascript','fastly'].includes(mode));assert(!fs.existsSync(output));
process.env.ADMIN_TOOLCHAIN_ROOT=consumer;
const moduleAt=relative=>import(pathToFileURL(path.join(catalog,relative)));
const {inspectPrepared}=await moduleAt('scripts/deployment/prepared-qualification.mjs');
const {verifyArtifact,digest}=await moduleAt('scripts/testing/build-identity.mjs');
const {createAdminUiWorker}=await moduleAt('scripts/fixtures/admin-ui-worker.mjs');
const {exercisePrepared,preparedScenarioNames}=await moduleAt('scripts/qualification/prepared-application.mjs');
const prepared=inspectPrepared(directory,consumer);
const report={schemaVersion:'catalog.prepared-application.v1',mode,status:'running',startedAt:new Date().toISOString(),
  diagnostic:true,published:false,deployed:false,activationPerformed:false,identity:prepared.identity,
  bounds:{resources:1,enrolledActors:2,acceptedSignals:1,maxRequests:120,maxRequestsPerScenario:45},
  checks:[],responses:[],timings:[],harness:[],phases:[]};
report.harness=[fileURLToPath(import.meta.url),'scripts/deployment/identity.mjs','scripts/deployment/prepare.mjs',
 'scripts/deployment/prepared-qualification.mjs','scripts/qualification/prepared-application.mjs',
 'scripts/fixtures/admin-ui-worker.mjs','probes/c05-acceptance/support/native-host.cjs'].map(p=>({path:p,sha256:digest(fs.readFileSync(path.resolve(catalog,p)))}));
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));save();
let worker;
try {
 if(mode==='fastly') {
   const saved=verifyArtifact(artifact,prepared.identity);
   assert.equal(JSON.parse(fs.readFileSync(path.join(artifact,'provider-manifest.json'))).latencyDiagnostics,'pulse.request-latency.v1');
   report.artifact={reused:true,wasmSha256:saved.wasmSha256,registrySha256:saved.registrySha256,bytes:fs.statSync(path.join(artifact,'main.wasm')).size};
 }
 worker=await createAdminUiWorker({profile:mode,preparedDirectory:directory,artifactDir:artifact});
 assert.equal(worker.preparedIdentity.key,prepared.identity.key);report.fixtureConfigSha256=worker.fixtureConfigSha256;
 if(mode==='javascript')report.artifact=worker.javascriptArtifact;
 if(mode==='fastly')for(const name of ['call','invoke','recovery']) {
   const original=worker[name];worker[name]=async(...args)=>{
     const response=await original(...args),raw=response.headers.get('x-pulse-latency');
     assert(raw&&Buffer.byteLength(raw)<=4096,'Expected bounded diagnostic response');
     const timing=JSON.parse(raw);assert.equal(timing.valid,true);
     // An early JWT/error response can terminate an effect before settlement.
     // Preserve that incomplete span as open; never claim complete attribution.
     if(response.status<400)assert.equal(timing.open,0);
     report.timings.push(timing);return response;
   };
 }
 await exercisePrepared(worker,report,save);assert.deepEqual(report.checks.map(c=>c.name),preparedScenarioNames);
 report.requestCount=worker.calls.length;report.metrics=worker.metrics;
 if(mode==='fastly')assert.equal(report.timings.length,report.requestCount);
 assert.equal(inspectPrepared(directory,consumer).identity.key,prepared.identity.key);
 report.status='passed';
} catch(error) {report.status='failed';report.error={message:error.message,code:error.code};process.exitCode=1;console.error(error);}
finally {if(worker)worker.close();report.completedAt=new Date().toISOString();save();console.log(output);}
