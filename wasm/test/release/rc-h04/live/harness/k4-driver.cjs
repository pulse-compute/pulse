'use strict';
const fs=require('node:fs'),http=require('node:http'),https=require('node:https'),assert=require('node:assert/strict'),path=require('node:path');
const root='/tmp/rc-h04-live',state=()=>JSON.parse(fs.readFileSync(root+'/resources.json'));
const key=fs.readFileSync(root+'/api-key','utf8').trim(),s=state(),service=s.resources.find(r=>r.label==='kv');
const artifact=JSON.parse(fs.readFileSync(root+'/k4-build/artifact.json'));
const identity={serviceId:service.id,serviceVersion:String(service.version),storeId:s.kvStore.id,moduleSha256:artifact.wasmSha256};
const rows=[];let before;
const agent=new https.Agent({proxyEnv:process.env,maxSockets:8});
async function inspect(){
 const api=async p=>{const r=await fetch('https://api.fastly.com'+p,{headers:{'Fastly-Key':key},redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);return r.json();};
 const [v,pkg,bindings]=await Promise.all([api(`/service/${service.id}/version/${service.version}`),api(`/service/${service.id}/version/${service.version}/package`),api(`/service/${service.id}/version/${service.version}/resource`)]);
 assert.equal(v.active,true);assert.equal(pkg.metadata.files_hash,service.filesHash);assert(bindings.some(b=>b.name==='k4_catalog'&&b.resource_id===identity.storeId));return{identity,filesHash:pkg.metadata.files_hash,active:true};
}
function metadata(headers){
 const m={...identity,pop:headers['x-rc-pop'],requestId:headers['x-rc-request']};
 assert.equal(headers['x-rc-service'],identity.serviceId);assert.equal(headers['x-rc-version'],identity.serviceVersion);assert(m.pop&&m.requestId);return m;
}
function invoke(relay,command,{signal},drop=false){
 return new Promise((resolve,reject)=>{
  const started=Date.now();let bytes=0;const chunks=[];const req=https.request('https://'+relay.domain+'/',{method:'POST',headers:{'content-type':'application/json','x-probe-token':s.probeToken},agent,signal},res=>{
   let meta;try{assert.equal(res.statusCode,200);meta=metadata(res.headers);}catch(e){res.resume();reject(e);return;}
   res.on('data',b=>{bytes+=b.length;if(bytes>262144)req.destroy(Error('Bounded response exceeded'));if(!drop)chunks.push(b);});
   res.on('error',reject);res.on('end',()=>{try{
    const result=drop?undefined:JSON.parse(Buffer.concat(chunks));rows.push({probe:relay.label,operation:command.operation,key:command.key,resultStatus:result?.status||'discarded',metadata:meta,bytes,mutationRetried:false,elapsedMs:Date.now()-started});
    fs.writeFileSync(root+'/k4-requests.json',JSON.stringify({identity,rows},null,2)+'\n');resolve(drop?{metadata:meta}:{result,metadata:meta});
   }catch(e){reject(e);}});
  });req.on('error',e=>{rows.push({probe:relay.label,operation:command.operation,key:command.key,error:e.code||e.name,elapsedMs:Date.now()-started,mutationRetried:false});fs.writeFileSync(root+'/k4-requests.json',JSON.stringify({identity,rows},null,2)+'\n');reject(e);});req.end(JSON.stringify(command));
 });
}
async function loseResponse(relay,command,{signal}){
 let observed,dispatches=0,server;
 const observation=new Promise((resolve,reject)=>{
  server=http.createServer(async(req,res)=>{req.resume();try{dispatches++;assert.equal(dispatches,1);const r=await invoke(relay,command,{signal},true);observed=r.metadata;res.socket.destroy();resolve();}catch(e){res.socket.destroy();reject(e);}});
 });observation.catch(()=>{});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const error=await new Promise(resolve=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/',method:'POST',signal},r=>{r.resume();resolve(Error('Lost response unexpectedly delivered'));});req.on('error',resolve);req.end('dispatch-once');});
  assert.equal(error.code,'ECONNRESET');await observation;assert.equal(dispatches,1);assert(observed);
  return{outcome:'response-lost',metadata:observed};
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
exports.createProbes=async()=>{
 before=await inspect();const relays=['probe-iad','probe-lhr'].map(label=>{const r=s.resources.find(r=>r.label===label);assert(r?.active);return r;});
 return{identity,probes:relays.map(r=>({id:r.label,invoke:(command,options)=>invoke(r,command,options),loseResponse:(command,options)=>loseResponse(r,command,options)})),readTimeoutMs:30000,
 async close(){try{const after=await inspect();assert.deepEqual(after,before);fs.writeFileSync(root+'/k4-identity.json',JSON.stringify({status:'passed',before,after,metadataSource:'FASTLY_POP/SERVICE_ID/SERVICE_VERSION/TRACE_ID read through WASI in response-only instrumentation; module/store bound by inspected package and resource link',mutationRetries:0},null,2)+'\n');}finally{agent.destroy();}}
 };
};
