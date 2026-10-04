#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {acceptanceToolchain}=require('../s3/acceptance-toolchain.cjs');
const fastly=require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function main(packedRoot,releaseRoot){
 assert.ok(packedRoot&&releaseRoot,'Usage: assert-read-loop-reality.cjs <isolated-install> <release-pack>');
 assert.equal(process.env.NODE_PATH,undefined);
 const {verifyClosure}=require('../release/assert-request-deadline-packages.cjs');
 const manifest=JSON.parse(fs.readFileSync(path.join(releaseRoot,'pulse-release-manifest.json')));
 verifyClosure(packedRoot,releaseRoot,manifest);
 const launcher=fastly.inspectFastlyComputeLauncher({viceroyBinary:process.env.PULSE_VICEROY_BIN});
 const tc=acceptanceToolchain(packedRoot),cwd=fs.mkdtempSync(path.join(packedRoot,'read-loop-reality-'));
 let scenario,server,passed=false;const calls=[];
 const origin=http.createServer((req,res)=>{
  if(!scenario){res.writeHead(404);res.end();return;}
  calls.push(req.url);assert.equal(req.method,'GET');
  const i=Number(req.url.split('/p').at(-1));
  if(i===scenario.missing){res.writeHead(404);res.end();return;}
  if(i===scenario.failed){res.writeHead(500);res.end();return;}
  if(i===scenario.malformed){res.writeHead(200);res.end('{');return;}
  const body=JSON.stringify({next:scenario.cycle?'p1':i<scenario.count?'p'+(i+1):'',action:scenario.early&&i===2?'return':'',values:[1,-1,2,99]});
  res.writeHead(200,{'content-type':'application/json','content-length':Buffer.byteLength(body)});res.end(body);
 });
 try{
  await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));const endpoint='http://127.0.0.1:'+origin.address().port;
  const fixture=path.resolve(__dirname,'../fixtures/projects/bounded-read-loops');
  for(const name of ['src','.pulse'])fs.cpSync(path.join(fixture,name),path.join(cwd,name),{recursive:true});
  const entry=path.join(cwd,'src/index.ts');fs.writeFileSync(entry,fs.readFileSync(entry,'utf8').replace('export default app',"app.error(async(error,ctx,next)=>{return ctx.text('invalid-page',{status:503})});\nexport default app").replace('  return ctx.text(state.visits +',"  if(state.visits===64&&key!=='')return ctx.text('incomplete',{status:409})\n  return ctx.text(state.visits +"));
  const project=tc.resolveProject({cwd,profile:'fastly'}),built=tc.buildProject(project);assert.equal(built.status,'built');
  const wasmFile=path.join(built.outDir,'bin/main.wasm'),manifestFile=path.join(built.outDir,'fastly.toml');
  fs.writeFileSync(manifestFile,fastly.renderFastlyLocalConfig({name:'pulse-read-loop-reality',backends:{object_origin:{url:endpoint,overrideHost:'127.0.0.1:'+origin.address().port,useSni:false}},secretStores:{app_secrets:{S3_ID:'fixture-id',S3_KEY:'fixture-secret-012345678901234567890123456789'}}}));
  server=await fastly.startFastlyComputeServe({launcher,packageRoot:built.outDir,wasmFile,manifestFile,startTimeoutMs:120000,stopTimeoutMs:5000});
  const cases=[
   {name:'one',count:1,body:'1:103::99'},
   {name:'zero',count:0,body:'0:0::99'},
   {name:'four',count:4,body:'4:412::99'},
   {name:'early-return',count:4,early:true,reads:2,body:'found:1:106'},
   {name:'exact-64',count:64,body:'64:6592::99'},
   {name:'65-incomplete',count:65,reads:64,body:'incomplete',status:409},
   {name:'cycle',count:1,cycle:true,reads:64,body:'incomplete',status:409},
   {name:'missing',count:4,missing:3,reads:3,body:'unavailable',status:503},
   {name:'failed',count:4,failed:3,reads:3,body:'unavailable',status:503},
   {name:'malformed',count:4,malformed:3,reads:3,status:503,body:'invalid-page'},
  ];
  const results=[];
  for(const row of cases){scenario=row;calls.length=0;const response=await fastly.requestFastlyCompute(server,{path:'/pages',headers:{'x-start':row.count?'p1':'','x-stop-before':'never'},timeoutMs:45000});assert.equal(response.status,row.status||200,row.name+': '+response.body);if(row.body!==undefined)assert.equal(response.body.toString(),row.body,row.name+' '+JSON.stringify({headers:response.headers,port:server.port,originPort:origin.address().port}));assert.equal(calls.length,row.reads??row.count,row.name);assert.deepEqual(calls,Array.from({length:row.reads??row.count},(_,i)=>'/pages/p'+(row.cycle?1:i+1)));results.push({name:row.name,status:'passed',httpStatus:response.status,reads:calls.length});}
  verifyClosure(packedRoot,releaseRoot,manifest);
  passed=true;return {schemaVersion:'pulse.read-loop-reality.v1',status:'passed',results,installedBytesUnchanged:true,packages:manifest.packages.map(({name,version,sha256})=>({name,version,sha256})),artifact:{sha256:hash(fs.readFileSync(wasmFile)),bytes:fs.statSync(wasmFile).size},engine:{kind:launcher.kind,version:launcher.inspection.version,sha256:hash(fs.readFileSync(launcher.inspection.binary))},providerReality:true,deployed:false,origin:'local-http-fixture',conditionalKvAcceptance:'separate-K4-gate'};
 }catch(error){error.detail={...(error.detail||{}),cwd,calls:[...calls],serverLogs:server?.logs};throw error;}finally{if(server)await server.stop();await new Promise(resolve=>origin.close(resolve));if(passed)fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={main};
if(require.main===module)main(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.stack);console.error(JSON.stringify(e.detail||e.diagnostics||{}));process.exitCode=1});
