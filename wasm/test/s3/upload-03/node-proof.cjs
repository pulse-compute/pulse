'use strict';
const {install}=require('../upload-02/runtime-overlay.cjs');const overlay=install();
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),crypto=require('node:crypto');
const {project,target}=require('./project.cjs');
const {createOwner}=require('../upload-02/node-transport.cjs');
const {executeNodeJavascriptApplication}=require('../../../../packages/provider-node/src/javascript/runtime-host.js');
const {verify}=require('../upload-01/local.cjs');const {bytesAt}=require('../upload-01/transport.cjs');
const immediate=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function run(mode){
  const p=mode==='native'?project('node'):undefined,cases=[];
  const scenarios=[
    {name:'success',expected:'stored:32769'},
    {name:'source-underflow',size:3,length:4}, {name:'source-overflow',size:5,length:4},
    {name:'source-reset',sourceError:true},{name:'source-stall',stall:true},
    {name:'writer-stall',writeStall:true}, {name:'origin-reset',origin:'reset'},
    {name:'headers-stall',origin:'stall'}, {name:'ack-body-stall',origin:'body-stall'},
    {name:'ack-truncated',origin:'truncated'}, {name:'ack-nonempty',origin:'nonempty'},
    {name:'ack-oversized-rejection',origin:'oversize'}, {name:'ack-duplicate-length',origin:'duplicate'},
    {name:'ack-oversized-metadata',origin:'metadata'}, {name:'ack-unsupported-encoding',origin:'encoding'},
    ...[200,403,408,429,500,307].map(status=>({name:'early-'+status,early:true,status,stall:true,expected:[403,429].includes(status)?'not-stored':'unknown'})),
    {name:'complete-rejection',status:403,expected:'not-stored'},
    {name:'cancel-before-dispatch',cancel:'credentials',expected:'cancelled'},
    {name:'cancel-during-input',cancel:'source',stall:true,expected:'cancelled'},
    {name:'cancel-after-prefix',cancel:'write',expected:'cancelled'},
    {name:'cancel-after-upload',cancel:'ack',origin:'stall',expected:'cancelled'},
    {name:'late-provider-result',cancel:'late-result',expected:'cancelled'},
    {name:'late-source-after-deadline',stall:true,lateSource:true},
    {name:'late-ack-after-deadline',origin:'late'},
    {name:'request-deadline-source',stall:true,requestDeadline:true,expected:'request-deadline'},
    {name:'request-deadline-ack',origin:'stall',requestDeadline:true,expected:'request-deadline'},
    {name:'fresh-after-failures',expected:'stored:32769'}
  ];
  try {for(const scenario of scenarios){
    const before=Date.now();let row;
    try{row=await trial(scenario);cases.push({name:scenario.name,status:'passed',elapsedMs:Date.now()-before,...row});}
    catch(error){cases.push({name:scenario.name,status:'failed',error:error.stack,elapsedMs:Date.now()-before,...error.evidence});}
  }}finally{p?.cleanup();}
  return {status:cases.every(x=>x.status==='passed')?'passed':'failed',mode,cases,wasm:p?{bytes:p.compiled.native.wasm.length,sha256:crypto.createHash('sha256').update(p.compiled.native.wasm).digest('hex')}:undefined,
    limits:{operationMs:250,requestMs:2000,payloadBytes:1048576,emittedChunkBytes:16384,sourceBackingBytes:65536},limitations:['loopback HTTP; no TLS/live origin claim','Native uses putText compiler scaffold','write stall injected at existing afterWrite gate, not an OS send-buffer capacity measurement']};
  async function trial(s){
    const controller=new AbortController(),late=deferred(),credential=deferred(),sourceRelease=deferred();
    const size=s.size??32769,length=s.length??size;let reads=0,cancels=0,offset=0,authorized=false,continued=0,dispatchCalls=0,requests=0,originBytes=0,originComplete=false,lateEnqueues=0;
    let activeSockets=new Set(),serverFailure,adapterWork,settled=false;
    const abort=()=>controller.abort(new Error('UPLOAD03_CLIENT_DISCONNECT'));
    const body=new ReadableStream({async pull(c){assert(authorized);reads++;
      if(s.cancel==='source')abort();
      if(s.sourceError){c.error(new Error('UPLOAD03_SOURCE_RESET'));return;}
      if(s.stall){await sourceRelease.promise;if(s.lateSource){try{c.enqueue(bytesAt(0,1));lateEnqueues++;}catch{}}return;}
      if(offset===size){c.close();return;}const count=Math.min(4096,size-offset);c.enqueue(bytesAt(offset,count));offset+=count;
    },cancel(){cancels++;sourceRelease.resolve();}}, {highWaterMark:0});
    const server=http.createServer((req,res)=>{void(async()=>{
      requests++;assert(verify(req.method,req.url,req.headers,target));assert.equal(req.method,'PUT');
      const reply=()=>{
        if(s.origin==='reset'){req.socket.destroy();return;}
        if(s.origin==='stall')return;
        if(s.origin==='duplicate'){req.socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n');return;}
        if(s.origin==='truncated'){res.writeHead(403,{'content-length':'4'});res.write('x');res.socket.end();return;}
        if(s.origin==='body-stall'){res.writeHead(403,{'content-length':'4'});res.write('x');return;}
        const text=s.origin==='oversize'?'x'.repeat(16385):s.origin==='nonempty'?'x':'';
        const headers={'content-length':String(Buffer.byteLength(text)),...s.origin==='metadata'?{'x-large':'x'.repeat(17000)}:{},...s.origin==='encoding'?{'content-encoding':'gzip'}:{}};
        res.writeHead(s.origin==='oversize'?403:s.status??200,headers);res.end(text);
      };
      if(s.early||s.origin==='reset'){reply();return;}
      for await(const chunk of req)originBytes+=chunk.length;
      originComplete=true;
      if(s.cancel==='ack')abort();
      if(s.origin==='late'){await late.promise;reply();return;}
      reply();
    })().catch(error=>{if(error.code!=='ECONNRESET')serverFailure=error;res.destroy();});});
    server.on('connection',socket=>{activeSockets.add(socket);socket.on('close',()=>activeSockets.delete(socket));});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const request=new Request('https://app.example/',{method:'POST',body,duplex:'half'}),raw=[['content-length',String(length)],['x-object-key','probe.bin']];
    const {owner,metrics}=createOwner(request,raw,{port:server.address().port,binding:target,timeoutMs:s.requestDeadline?500:250,
      secret(name){if(s.cancel==='credentials'){queueMicrotask(abort);return credential.promise;}return name==='S3_ID'?target.accessId:target.secret;},
      async afterWrite(){if(s.cancel==='write')abort();if(s.writeStall)await late.promise;}});
    const dispatch=async(effect,execution)=>{
      if(effect.kind==='secret.get'){
        if(authorized){continued++;return 'continued';}
        assert.equal(reads,0);authorized=true;return 'allowed';
      }
      dispatchCalls++;assert.equal(dispatchCalls,1);assert(authorized);
      if(s.cancel==='late-result'){queueMicrotask(abort);return late.promise;}
      if(mode==='native')owner.claim(owner.marker(),{binding:effect.payload.binding,key:effect.payload.key});
      adapterWork=owner.forward(target.endpoint,{binding:'objects',key:'probe.bin'},execution);return adapterWork;
    };
    const app=async ctx=>{await ctx.secret.get('AUTHORIZE');const value=await overlay.upload(ctx,{binding:'objects',key:'probe.bin'},ctx.req.body());await ctx.secret.get('AFTER_UPLOAD');return ctx.text(value.status==='stored'?'stored:'+value.byteLength:value.status);};
    let response,failure,watchdog;
    const started=Date.now();
    try {
      const execution=mode==='native'?p.T.executeCanonicalNativeModule(p.compiled.native,{request:{method:'POST',url:'https://app.example/',headers:raw},incomingBody:owner,maxDurationMs:s.requestDeadline?75:2000,signal:controller.signal,providerAdapter:{id:'upload03-research',dispatchEffect:dispatch}})
        :executeNodeJavascriptApplication(app,request,{incomingBody:owner,maxDurationMs:s.requestDeadline?75:2000,signal:controller.signal,effectAdapter:{dispatch}});
      try{response=await Promise.race([execution,new Promise((_,reject)=>{watchdog=setTimeout(()=>{abort();reject(Error('test watchdog exceeded'));},3000);})]);}catch(error){failure=error.code||error.message;}
      finally{clearTimeout(watchdog);await owner.close();}
      const result=s.requestDeadline?'request-deadline':controller.signal.aborted?'cancelled':mode==='native'?response?.response.body:response&&await response.text();
      await adapterWork?.catch(()=>{});await immediate();
      const atSettlement={reads,writes:metrics.writes,dispatchCalls,continued};settled=true;
      // Resolve hostile late work after cancellation/deadline. It must not cause
      // another source pull, write, dispatch, or handler continuation.
      late.resolve({status:'stored',byteLength:size});credential.resolve(target.accessId);sourceRelease.resolve();
      for(let i=0;i<5;i++)await immediate();
      assert.deepEqual({reads,writes:metrics.writes,dispatchCalls,continued},atSettlement);
      assert.equal(result,s.expected??'unknown');
      if(s.requestDeadline)assert.match(failure||'',/PULSE_REQUEST_DEADLINE_EXCEEDED/);
      assert.equal(continued,['cancelled','request-deadline'].includes(result)?0:1);
      assert(metrics.closed);assert(dispatchCalls<=1&&requests<=1&&metrics.dispatches<=1,'no replay');
      if(result==='stored:'+size){assert(originComplete);assert.equal(originBytes,size);}
      if(s.cancel==='credentials'){assert.equal(metrics.dispatches,0);assert.equal(reads,0);}
      assert(Date.now()-started<1500,'operation/cleanup bounded below request deadline');
      assert.equal(activeSockets.size,0,'outbound sockets closed before fixture teardown');
      if(serverFailure)throw serverFailure;
      return {result,failure,reads,cancels,continued,dispatchCalls,requests,originBytes,originComplete,lateEnqueues,metrics};
    } catch(error){error.evidence={reads,cancels,continued,dispatchCalls,requests,originBytes,originComplete,metrics,settled};throw error;}
    finally{late.resolve();credential.resolve();sourceRelease.resolve();server.closeAllConnections();await new Promise(r=>server.close(r));}
  }
}
if(require.main===module)run(process.argv[2]).then(r=>{fs.writeFileSync(process.argv[3],JSON.stringify(r,null,2)+'\n');console.log(r.mode,r.status,r.cases.filter(x=>x.status==='failed').map(x=>({name:x.name,error:x.error.split('\n').slice(0,4).join('\n')})));if(r.status!=='passed')process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});
