'use strict';
const fs=require('node:fs'),https=require('node:https'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const T=require('../upload-01/transport.cjs');
const [stateFile,out,selection='smoke']=process.argv.slice(2);
if(fs.existsSync(out))throw Error('Fresh evidence path required');
const state=JSON.parse(fs.readFileSync(stateFile)),target={...state.target,accessId:state.objectKey.access_key,secret:state.objectKey.secret_key};
const agent=()=>new https.Agent({proxyEnv:process.env,keepAlive:false,maxSockets:32});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={schema:'pulse.upload-live.v1',status:'running',selection,startedAt:new Date().toISOString(),service:state.service.id,version:state.version,domain:state.domain,artifact:state.artifact,networkRoute:'environment-proxy',cases:[],keys:[],publicAdmission:false};
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');save();
async function object(method,key){
 const {url,headers}=await T.signed(target,method,key),a=agent();
 try{return await new Promise((resolve,reject)=>{
  const req=https.request(url,{method,headers,agent:a},res=>{let bytes=0;const h=crypto.createHash('sha256');
   res.on('data',b=>{bytes+=b.length;if(bytes>33554432+16384){req.destroy(Error('response-cap'));return;}h.update(b)});
   res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,length:Number(res.headers['content-length']),bytes,sha256:h.digest('hex')}));
  });req.setTimeout(45000,()=>req.destroy(Error('object-timeout')));req.on('error',reject);req.end();
 });}finally{a.destroy();}
}
async function upload(size,{pace=0,stall=false,cancel=false,declared=size}={}){
 const suffix=crypto.randomUUID(),key=target.prefix+suffix;
 const before=await object('HEAD',key);assert.equal(before.status,404);
 const record={key,size,declared,beforeStatus:before.status,startedAt:new Date().toISOString(),sentBytes:0};report.keys.push(record);save();
 const a=agent(),start=performance.now();let req,ended=false,producer,stop=false;
 try{
 const response=new Promise(resolve=>{
  const done=result=>{if(ended)return;ended=true;stop=true;resolve({...result,elapsedMs:performance.now()-start,sentBytes:record.sentBytes});};
  req=https.request('https://'+state.domain+'/',{method:'POST',agent:a,headers:{'content-length':String(declared),'content-type':'application/octet-stream','x-probe-token':state.probeToken,'x-object-key':suffix}},res=>{
   const headersMs=performance.now()-start;let body='';res.on('data',b=>{body+=b;if(body.length>16384)req.destroy(Error('response-cap'));});
   res.on('error',e=>done({error:e.code||'response-error'}));res.on('end',()=>{let result;try{result=JSON.parse(body);}catch{result={text:body.slice(0,256)}}done({httpStatus:res.statusCode,headersMs,result,pop:res.headers['x-served-by']||null});});
  });req.on('error',e=>done({error:e.code||e.message}));req.on('close',()=>{if(!ended)done({error:'closed-without-response'});});req.setTimeout(25000,()=>req.destroy(Error('client-timeout')));
  const watchdog=setTimeout(()=>req.destroy(Error('client-wall-timeout')),35000);req.once('close',()=>clearTimeout(watchdog));
 });
 producer=(async()=>{
  for(let offset=0;offset<size&&!stop;offset+=16384){
   const b=T.bytesAt(offset,Math.min(16384,size-offset));record.sentBytes+=b.length;
   await new Promise((resolve,reject)=>req.write(b,e=>e?reject(e):resolve()));
   if(record.sentBytes>=65536&&(stall||cancel)){
    if(cancel){await delay(1000);record.cancelAtMs=performance.now()-start;req.destroy(Error('intentional-disconnect'));return;}
    // Wait for response or the 35-second wall deadline; never send EOF.
    await response;return;
   }
   if(pace)await Promise.race([delay(pace),response]);
  }
  if(!stop){record.producerEofMs=performance.now()-start;req.end();}
 })().catch(e=>{if(!ended)req.destroy(e)});
 const r=await response;req.destroy();await producer;record.response=r;save();return record;
 }finally{stop=true;req?.destroy();a.destroy();}
}
const digests=new Map();function digest(size){if(!digests.has(size))digests.set(size,T.digest(size));return digests.get(size);}
async function validate(record){
 const r=record.response;assert.equal(r.httpStatus,200);assert.equal(r.result.status,'stored');assert.equal(r.result.byteLength,record.size);
 assert.equal(r.result.readBytes,record.size);assert.equal(r.result.writtenBytes,record.size);assert.equal(r.result.guestCloseErrors,0);
 record.readback=await object('GET',record.key);assert.equal(record.readback.status,200);assert.equal(record.readback.bytes,record.size);assert.equal(record.readback.sha256,digest(record.size));save();
}
async function main(){
 const matrix=selection==='smoke'?[[65536,1],[1048576,1]]:selection==='repeat-max'?[[33554432,16]]:selection==='capacity'?[8388608,16777216,33554432].flatMap(n=>[1,8,16].map(c=>[n,c])):[];
 for(const [size,concurrency]of matrix){
  const cell={size,concurrency,status:'running',startedAt:new Date().toISOString()};report.cases.push(cell);save();
  const start=performance.now(),rows=await Promise.all(Array.from({length:concurrency},()=>upload(size)));cell.uploadWallMs=performance.now()-start;
  cell.keys=rows.map(r=>r.key);const validations=await Promise.allSettled(rows.map(validate));cell.status=validations.every(v=>v.status==='fulfilled')?'passed':'failed';cell.errors=validations.filter(v=>v.status==='rejected').map(v=>String(v.reason.message).slice(0,300));
  const times=rows.map(r=>r.response.elapsedMs).sort((a,b)=>a-b);cell.p50Ms=times[Math.ceil(times.length*.5)-1];cell.p95Ms=times[Math.ceil(times.length*.95)-1];cell.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(cell));
  if(cell.status!=='passed'){report.stoppedAtFailedCapacityCell=true;break;}
 }
 if(selection==='faults')for(const [name,options]of [['slow-client',{pace:12}],['stalled-input',{stall:true}],['disconnect',{cancel:true}],['declared-over-cap',{stall:true,declared:33554433}],['recovery',{}]]){
  const row=await upload(8388608,options),cell={name,key:row.key,status:'observed',response:row.response};report.cases.push(cell);save();
  if(name==='slow-client'||name==='recovery'){try{await validate(row);cell.status='passed';}catch(e){cell.status='failed';cell.error=e.message.slice(0,300);}}
  if(name==='stalled-input'){cell.responseBeforeEof=row.sentBytes<row.size&&row.response.httpStatus===200;cell.status=cell.responseBeforeEof&&row.response.result?.status==='unknown'&&row.response.result?.reason==='timeout'?'passed':'failed';}
  if(name==='declared-over-cap')cell.status=row.response.result?.status==='not-stored'&&row.response.result?.reason==='length'&&row.response.result?.readBytes===0?'passed':'failed';
  row.observations=[];const observationStart=performance.now();for(const after of [0,2000,15000]){await delay(Math.max(0,after-(performance.now()-observationStart)));row.observations.push({afterMs:performance.now()-observationStart,head:await object('HEAD',row.key)});save();}
  console.log(JSON.stringify(cell));
 }
 report.status=report.cases.every(c=>['passed','observed'].includes(c.status))?'passed-with-limitations':'failed';report.finishedAt=new Date().toISOString();save();if(report.status==='failed')process.exitCode=1;
}
main().catch(e=>{report.status='failed';report.error=String(e.message).slice(0,400);report.finishedAt=new Date().toISOString();save();console.error(report.error);process.exitCode=1;});
