'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const root=__dirname;
exports.createProbes=async function(){
 const deployment=JSON.parse(fs.readFileSync(path.join(root,'deployment.json')));
 const auth=fs.readFileSync(path.join(root,'probe-auth'),'utf8').trim();
 const identity=deployment.identity;assert.ok(identity);
 const ledger=[];let lossEvidence;let lossCount=0;
 const transport=async(row,command,signal,discard=false)=>{
  const started=Date.now();
  const response=await fetch('https://'+row.domain+'/',{method:'POST',headers:{'content-type':'application/json','x-pulse-k4-auth':auth,'cache-control':'no-store'},body:JSON.stringify(command),signal,redirect:'error'});
  assert.equal(response.status,200,`${row.kind}: HTTP ${response.status}`);
  const header=n=>response.headers.get('x-pulse-k4-'+n);
  const metadata={serviceId:header('service'),serviceVersion:header('version'),storeId:header('store'),moduleSha256:header('module'),pop:header('pop'),requestId:header('request')};
  for(const field of ['serviceId','serviceVersion','storeId','moduleSha256'])assert.equal(metadata[field],identity[field]);
  assert.match(metadata.pop,/^[A-Z0-9]{3}$/);assert.match(metadata.requestId,/^[a-f0-9-]{36}$/i);
  const computeServedBy=header('compute-served-by');
  if(computeServedBy){
   const pops=[...computeServedBy.matchAll(/-([A-Z0-9]{3})(?:,|$)/g)].map(m=>m[1]);
   assert.ok(pops.length>0,'Unrecognized Compute server identity');
   assert.ok(pops.every(pop=>pop===metadata.pop),'Compute and shield probe executed in different POPs');
  }
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;assert.ok(bytes<=262144,'Bounded response exceeded');if(!discard)chunks.push(chunk);}
  const result=discard?undefined:JSON.parse(Buffer.concat(chunks).toString());
  const keyPrefix=command.key?.match(/^pulse-k4-[a-f0-9-]{36}(?=-)/)?.[0]||null;
  ledger.push({probe:row.kind,operation:command.operation,status:response.status,resultStatus:result?.status,resultReason:result?.reason,keyPrefix,metadata,computeServedBy,elapsedMs:Date.now()-started,responseBytes:bytes,discarded:discard});
  fs.writeFileSync(path.join(root,'requests.json'),JSON.stringify(ledger,null,2)+'\n');
  if(discard)return {metadata};
  return {metadata,result};
 };
 const rows=deployment.services.filter(x=>x.kind!=='compute');
 const probes=rows.map(row=>({id:row.kind,invoke:(command,{signal})=>transport(row,command,signal)}));
 const relay=http.createServer(async(req,res)=>{
  lossCount++;const chunks=[];let bytes=0;const controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),14000);
  try{
   for await(const chunk of req){bytes+=chunk.length;assert.ok(bytes<=262144);chunks.push(chunk);}
   const command=JSON.parse(Buffer.concat(chunks));
   // Allow the real remote invocation to finish, drain/discard every application
   // byte, and retain only independent service-side headers in the relay.
   lossEvidence=await transport(rows[0],command,controller.signal,true);
  }catch(error){lossEvidence={error:error.message};}
  finally{clearTimeout(deadline);res.destroy();}
 });
 await new Promise((resolve,reject)=>{relay.once('error',reject);relay.listen(0,'127.0.0.1',resolve)});
 probes[0].loseResponse=async(command,{signal})=>{
  assert.equal(lossCount,0,'Only one controlled dropped response permitted');
  await new Promise((resolve,reject)=>{
   const req=http.request({hostname:'127.0.0.1',port:relay.address().port,path:'/',method:'POST',headers:{'content-type':'application/json'},signal},()=>reject(Error('Loss relay delivered an HTTP response')));
   req.on('error',error=>error.code==='ECONNRESET'?resolve():reject(error));req.end(JSON.stringify(command));
  });
  assert.equal(lossCount,1);assert.ok(lossEvidence?.metadata,lossEvidence?.error||'Loss relay lacked independent metadata');
  fs.writeFileSync(path.join(root,'loss-relay.json'),JSON.stringify({clientTransport:'ECONNRESET',dispatches:lossCount,applicationResponseDelivered:false,metadata:lossEvidence.metadata},null,2)+'\n');
  return {outcome:'response-lost',metadata:lossEvidence.metadata};
 };
 return {identity,probes,readTimeoutMs:30000,async close(){relay.closeAllConnections();await new Promise(resolve=>relay.close(resolve));}};
};
