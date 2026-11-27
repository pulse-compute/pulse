'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const cli=require('../../../../packages/provider-fastly/src/testing/fastly-cli.js');
const {verify}=require('../upload-01/local.cjs'),{bytesAt,digest}=require('../upload-01/transport.cjs');
const [dir,binary,out]=process.argv.slice(2);
(async()=>{
 if(fs.existsSync(out))throw Error('Fresh receipt required');
 const artifact=JSON.parse(fs.readFileSync(path.join(dir,'artifact.json'))),target={...artifact.target,accessId:'fixture-id',secret:'fixture-secret'};
 let calls=0,bytes=0,originError,server;
 const origin=http.createServer((req,res)=>{if(req.method==='GET'){res.end();return;}calls++;try{assert(verify(req.method,req.url,req.headers,target),'wire signature');}catch(e){originError=e;res.writeHead(403);res.end();return;}const h=crypto.createHash('sha256');req.on('data',b=>{bytes+=b.length;h.update(b)});req.on('end',()=>{try{assert.equal(h.digest('hex'),digest(bytes));res.writeHead(200,{'content-length':'0'});res.end();}catch(e){originError=e;res.destroy();}});});
 await new Promise(r=>origin.listen(0,'127.0.0.1',r));
 try{
  const local=fs.mkdtempSync('/tmp/upload-live-local-');const manifest=path.join(local,'fastly.toml');fs.writeFileSync(manifest,cli.renderFastlyLocalConfig({name:'upload-live-local',backends:{object_origin:{url:`http://127.0.0.1:${origin.address().port}`,overrideHost:new URL(target.endpoint).host,useSni:false}},secretStores:{app_secrets:{PROBE_TOKEN:'fixture-token',S3_ID:target.accessId,S3_SECRET:target.secret}}}));
  server=await cli.startFastlyComputeServe({launcher:cli.inspectFastlyComputeLauncher({viceroyBinary:binary,required:true}),packageRoot:local,wasmFile:path.join(dir,'bin/main.wasm'),manifestFile:manifest,startTimeoutMs:20000,stopTimeoutMs:3000});
  const request=token=>new Promise((resolve,reject)=>{const req=http.request(server.baseUrl,{method:'POST',headers:{'x-probe-token':token,'x-object-key':'local','content-length':65536}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(bytesAt(0,65536));});
  const denied=await request('wrong');assert.equal(denied.status,403);assert.equal(calls,0);
  const result=await request('fixture-token');if(originError)throw originError;assert.equal(result.status,200);const d=JSON.parse(result.text);assert.equal(d.status,'stored');assert.equal(d.byteLength,65536);assert.equal(d.readBytes,65536);assert.equal(d.writtenBytes,65536);assert.equal(d.guestCloseErrors,0);assert(d.guestFinalBytes>=d.guestInitialBytes);assert(d.operationMs>0);assert.equal(calls,1);
  fs.writeFileSync(out,JSON.stringify({status:'passed',wasmSha256:artifact.wasmSha256,deniedBeforeDispatch:true,signatureAndBytes:true,result:d,scope:'local instrumented artifact; not hosted qualification'},null,2)+'\n');console.log(d);
 }finally{if(server)await server.stop();origin.closeAllConnections();await new Promise(r=>origin.close(r));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
