#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
async function main(){
 const execute=process.argv[2]==='--execute';
 const [root,release]=process.argv.slice(execute?3:2);
 assert.ok(root&&release,'Usage: assert-read-loop-packages.cjs <isolated-install> <release-pack>');
 const packed=fs.realpathSync(root),repo=path.resolve(__dirname,'../../..');
 assert.ok(packed!==repo&&!packed.startsWith(repo+path.sep));assert.equal(process.env.NODE_PATH,undefined);
 const manifest=JSON.parse(fs.readFileSync(path.join(release,'pulse-release-manifest.json')));
 if(!execute){
  const {verifyClosure}=require('./assert-request-deadline-packages.cjs');verifyClosure(packed,release,manifest);
  const child=spawnSync(process.execPath,[__filename,'--execute',packed,release],{cwd:packed,env:process.env,encoding:'utf8',timeout:600000,maxBuffer:8*1024*1024});
  assert.equal(child.status,0,child.stderr||String(child.error));const report=JSON.parse(child.stdout);assert.equal(report.status,'passed');
  verifyClosure(packed,release,manifest);
  console.log(JSON.stringify({...report,schemaVersion:'pulse.read-loop-packed-acceptance.v1',installedBytesUnchanged:true,packages:manifest.packages.map(({name,version,sha256})=>({name,version,sha256}))}));return;
 }
 const result=await require('../runtime/bounded-read-loop-packed.cjs').main(packed);
 const allowed=new Set(['native-platform-capabilities-host.js','conditional-kv-host.js'].map(f=>path.join(repo,'packages/provider-fastly/src/testing',f)));
 for(const file of Object.keys(require.cache))if(file.startsWith(repo+'/packages/')||file.startsWith(repo+'/wasm/packages/'))assert.ok(allowed.has(file),'Workspace product module: '+file);
 console.log(JSON.stringify({...result,workspaceProductModules:0}));
}
main().catch(error=>{console.error(error.stack);console.error(JSON.stringify(error.diagnostics||error.detail||{}));process.exitCode=1});
