// Package only the previously qualified private diagnostic artifact. No deployment.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const [catalog,directory,consumer,artifact,javascriptFile,fastlyFile,output,fastlyBinary]=process.argv.slice(2);
const at=relative=>import(pathToFileURL(path.join(catalog,relative)));
const {inspectPrepared}=await at('scripts/deployment/prepared-qualification.mjs');
const {verifyArtifact,digest}=await at('scripts/testing/build-identity.mjs');
const {inspectArchive}=await at('scripts/deployment/preflight-artifacts.mjs');
const {preparedScenarioNames}=await at('scripts/qualification/prepared-application.mjs');
const prepared=inspectPrepared(directory,consumer),saved=verifyArtifact(artifact,prepared.identity);
const read=file=>JSON.parse(fs.readFileSync(file)),hash=file=>digest(fs.readFileSync(file));
assert.equal(read(path.join(consumer,'candidate.json')).kind,'private-latency-evidence');
assert.equal(read(path.join(artifact,'provider-manifest.json')).latencyDiagnostics,'pulse.request-latency.v1');
const files={javascript:javascriptFile,fastly:fastlyFile};
for(const [mode,file] of Object.entries(files)) {
 const report=read(file);assert.equal(report.status,'passed');assert.equal(report.mode,mode);
 assert.equal(report.diagnostic,true);assert.equal(report.published,false);
 assert.deepEqual(report.identity,prepared.identity);assert.equal(report.deployed,false);
 assert.deepEqual(report.checks.map(c=>c.name),preparedScenarioNames);
 assert(report.checks.every(c=>c.status==='passed'&&c.requests>0&&c.requests<=45));
 assert.equal(report.requestCount,report.checks.reduce((n,c)=>n+c.requests,0));
 assert.equal(report.responses.length,report.requestCount);assert(report.requestCount<=120);
 assert(Date.parse(report.completedAt)-Date.parse(report.startedAt)<=180000);
 for(const h of report.harness)assert.equal(hash(path.resolve(catalog,h.path)),h.sha256);
 assert.equal(report.artifact.registrySha256,saved.registrySha256);
 if(mode==='fastly'){assert.equal(report.artifact.wasmSha256,saved.wasmSha256);assert.equal(report.artifact.reused,true);}
}
assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true,mode:0o700});
const installed=createRequire(path.join(consumer,'package.json')),provider=installed('@pulse-compute/provider-fastly/build/canonical-target');
const build=provider.normalizedBuildConfig(prepared.config.fastly.fastly);
fs.writeFileSync(path.join(output,'fastly.toml'),provider.renderFastlyToml(build));
fs.mkdirSync(path.join(output,'bin'));const wasm=path.join(output,'bin/main.wasm');
fs.copyFileSync(path.join(artifact,'main.wasm'),wasm);
const version=execFileSync(fastlyBinary,['version'],{encoding:'utf8',timeout:15000}).trim();
execFileSync(fastlyBinary,['compute','pack','--wasm-binary',wasm,'--non-interactive'],{
 cwd:output,env:{PATH:process.env.PATH,HOME:process.env.HOME,FASTLY_WASM_METADATA_DISABLE:'true'},timeout:60000,stdio:'pipe'});
const file=path.join(output,'pkg',build.name+'.tar.gz');
const packaged=inspectArchive(file,saved.wasmSha256);assert.equal(hash(wasm),saved.wasmSha256);
const receipt={schemaVersion:'catalog.qualified-package.v1',status:'packaged',diagnostic:true,published:false,
 buildKey:prepared.identity.key,qualification:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,hash(v)])),
 packageFile:path.relative(output,file),artifact:packaged,packager:{command:'fastly compute pack',version},compiled:false,activationPerformed:false};
fs.writeFileSync(path.join(output,'package-receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify(receipt));
