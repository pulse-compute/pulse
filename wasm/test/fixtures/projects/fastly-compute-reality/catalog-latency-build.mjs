// Evidence-only Catalog consumer. Explicit paths; published installation unchanged.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [catalog,preparedDir,consumer,artifact] = process.argv.slice(2).map(p=>path.resolve(p));
const {inspectPrepared} = await import(pathToFileURL(path.join(catalog,'scripts/deployment/prepared-qualification.mjs')));
const hash=x=>createHash('sha256').update(x).digest('hex');
const prepared=inspectPrepared(preparedDir,consumer),installed=createRequire(path.join(consumer,'package.json'));
if(fs.existsSync(artifact))throw Error('Fresh artifact directory required');
fs.mkdirSync(artifact,{recursive:true});
const report={status:'running',startedAt:new Date().toISOString(),diagnostic:true,published:false,identity:prepared.identity};
const save=()=>fs.writeFileSync(path.join(artifact,'build-report.json'),JSON.stringify(report,null,2));save();
try {
 const project=installed('@pulse-compute/cli/project-config').resolveProject({cwd:prepared.project,profile:'fastly'});
 const compiled=installed('@pulse-compute/cli/project-execution').compileProject(project,{target:'native'});
 const plan=installed('@pulse-compute/wasm-compiler/canonical-native-plan').buildCanonicalNativePlan(compiled,{reporting:project.reporting});
 console.log('Compiling diagnostic Native Catalog');
 const built=installed('@pulse-compute/provider-fastly/build/canonical-target').inspectFastlyCanonicalTarget({
   plan,cwd:prepared.project,projectRoot:prepared.project,profile:'fastly',providerConfig:project.providerConfig,
   latencyDiagnostics:true,nativeOptimization:'experimental-native-bounded-size',compileTimeoutMs:720000,emitWat:false});
 if(built.native.manifest.latencyDiagnostics!=='pulse.request-latency.v1')throw Error('Missing diagnostic artifact identity');
 const wasm=built.native.wasm,registry=compiled.schema.bundle.registry;
 fs.writeFileSync(path.join(artifact,'main.wasm'),wasm);
 fs.writeFileSync(path.join(artifact,'memory-artifacts.json'),JSON.stringify({buildIdentity:prepared.identity,wasmSha256:hash(wasm),registry,registrySha256:hash(JSON.stringify(registry))}));
 fs.writeFileSync(path.join(artifact,'provider-manifest.json'),JSON.stringify(built.native.manifest,null,2));
 fs.writeFileSync(path.join(artifact,'effect-map.json'),JSON.stringify(plan.effects.map((effect,index)=>({index,kind:effect.kind})),null,2));
 if(inspectPrepared(preparedDir,consumer).identity.key!==prepared.identity.key)throw Error('Build inputs changed');
 report.status='passed';report.wasmSha256=hash(wasm);report.bytes=wasm.length;
} catch(error) {report.status='failed';report.error={message:error.message,code:error.code};throw error;}
finally {report.completedAt=new Date().toISOString();save();}
