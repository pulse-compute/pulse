'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { buildProject, startDevServer } = require('../../packages/cli/src/project-execution.js');
const { instantiateCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const { createIncomingBody } = require('../../../packages/provider-node/src/javascript/incoming-body.js');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise,resolve}; };
async function listen(server) { server.listen(0,'127.0.0.1'); await once(server,'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
function client(url, route, headers = {}, onChunk) {
  const result=deferred();
  const request=http.request(url+route,{method:'POST',headers},response=>{
    const chunks=[];
    assert.equal(response.headers.connection,'close');
    response.on('data',chunk=>{chunks.push(chunk);onChunk?.(chunk);});
    response.on('end',()=>result.resolve({status:response.statusCode,text:Buffer.concat(chunks).toString()}));
    response.on('error',error=>result.resolve({error}));
  });
  request.on('error',error=>result.resolve({error}));
  request.setTimeout(5000,()=>request.destroy(new Error('Native forwarding fixture timeout')));
  return {request,result:result.promise};
}

async function main() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-str02b-'));
  let first=deferred(), originCalls=0, lateResponse, dev, boundedDev;
  const origin=http.createServer((request,response)=>{
    originCalls++;
    if(request.url==='/early'){response.end('early');return;}
    if(request.url==='/redirect'){response.writeHead(307,{location:'/collect'});response.end();return;}
    if(request.url==='/stall'){response.write('prefix');return;}
    if(request.url==='/late-error'){lateResponse=response;response.write('prefix');return;}
    let bytes=0;const hash=createHash('sha256');
    request.on('error',()=>{});
    request.on('data',chunk=>{bytes+=chunk.length;hash.update(chunk);first.resolve();});
    request.on('end',()=>response.end(JSON.stringify({bytes,hash:hash.digest('hex')})));
  });
  const originUrl=await listen(origin), events=[];
  try {
    for(const dir of ['src','.pulse'])fs.mkdirSync(path.join(root,dir));
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'str02b-native-http',private:true,type:'module',dependencies:{'@pulse-compute/pulse':require('../../../packages/pulse/package.json').version}}));
    const source=`import {Pulse} from '@pulse-compute/pulse'; const app=new Pulse({auto:true});
app.post('/deny',async ctx=>{return ctx.text('denied',{status:403})});
${['collect','early','redirect','late-error'].map(route=>`app.post('/${route}',async ctx=>{return ctx.fetch('${originUrl}/${route}',{method:'POST',body:ctx.req.body()})});`).join('\n')}
app.post('/headers',async ctx=>{return ctx.fetch('${originUrl}/collect',{method:'POST',headers:{'content-length':'99'},body:ctx.req.body()})});
app.post('/timeout',async ctx=>{return ctx.fetch('${originUrl}/collect',{method:'POST',body:ctx.req.body(),timeoutMs:50})});
app.post('/response-timeout',async ctx=>{return ctx.fetch('${originUrl}/stall',{method:'POST',body:ctx.req.body(),timeoutMs:50})});
app.post('/budget',async ctx=>{return ctx.fetch('${originUrl}/stall',{method:'POST',body:ctx.req.body()})});
app.post('/bad-group',async ctx=>{const group=await ctx.parallel({upload:ctx.fetch('${originUrl}/collect',{method:'POST',body:ctx.req.body()}),other:ctx.fetch('invalid URL')});return group.upload});
app.post('/abandon',async ctx=>{const response=await ctx.fetch('${originUrl}/stall',{method:'POST',body:ctx.req.body()});return ctx.text('done')});
app.post('/group',async ctx=>{const group=await ctx.parallel({upload:ctx.fetch('${originUrl}/collect',{method:'POST',body:ctx.req.body()}),other:ctx.config.get('CHECK')});return group.upload});
export default app;`;
    fs.writeFileSync(path.join(root,'src/index.ts'),source);
    fs.writeFileSync(path.join(root,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_scope=>({pulse:{entry:'src/index.ts',defaultProfile:'local',strict:false},local:{host:'node',target:'native',node:{maxDurationMs:30000,bodyForwarding:{maxBytes:67108864}},dev:{networkFetch:true,config:{CHECK:'ready'}}}}));`);
    const project=resolveProject({cwd:root});
    const built=await buildProject(project);
    const wasm=fs.readFileSync(built.files.nativeWasm), plan=JSON.parse(fs.readFileSync(built.files.nativePlan));
    const wasmHash=createHash('sha256').update(wasm).digest('hex');
    assert.equal(wasmHash,built.native.wasm.sha256);
    assert.ok(WebAssembly.Module.imports(new WebAssembly.Module(wasm)).some(i=>i.module==='pulse_host'&&i.name==='request_body'));
    dev=await startDevServer(project,{port:0,watch:false,onEvent:event=>events.push(event)});
    const url=dev.ready.url;
    let deniedReads=0;
    dev.server.prependListener('request',request=>{
      if(request.url!=='/deny')return;
      const read=request.read;request.read=function(size){if(size>0)deniedReads++;return read.call(this,size);};
    });
    const live=client(url,'/collect');live.request.write(Buffer.from([0,255,7]));
    await first.promise;live.request.end(Buffer.from([2,3]));
    assert.equal(JSON.parse((await live.result).text).bytes,5);
    const sizes=[];
    for(const mib of [1,16,64]){
      const active=client(url,'/collect'), chunk=Buffer.alloc(16384,173), hash=createHash('sha256');
      for(let n=0;n<mib*64;n++){hash.update(chunk);if(!active.request.write(chunk))await once(active.request,'drain');}
      active.request.end();const result=await active.result;
      assert.equal(result.status,200,result.text);
      assert.deepEqual(JSON.parse(result.text),{bytes:mib*1048576,hash:hash.digest('hex')});
      await new Promise(resolve=>setImmediate(resolve));
      sizes.push({mib,guestMemoryBytes:events.filter(e=>e.event==='request').at(-1).executionEvidence.guestMemoryBytes});
    }
    assert.equal(new Set(sizes.map(s=>s.guestMemoryBytes)).size,1);
    for(const route of ['/deny','/headers','/bad-group']){
      const before=originCalls, active=client(url,route);active.request.write('partial');
      assert.equal((await active.result).status,route==='/deny'?403:route==='/bad-group'?400:500);assert.equal(originCalls,before);active.request.destroy();
    }
    assert.equal(deniedReads,0);
    const group=client(url,'/group');group.request.end('group');assert.equal(JSON.parse((await group.result).text).bytes,5);
    const abandoned=client(url,'/abandon');abandoned.request.end('one');assert.deepEqual(await abandoned.result,{status:200,text:'done'});
    const empty=client(url,'/collect');empty.request.end();assert.equal(JSON.parse((await empty.result).text).bytes,0);
    const early=client(url,'/early');early.request.write('partial');assert.deepEqual(await early.result,{status:200,text:'early'});early.request.destroy();
    const count=originCalls, redirect=client(url,'/redirect');redirect.request.end('one');assert.equal((await redirect.result).status,500);assert.equal(originCalls,count+1);
    const declared=client(url,'/collect',{'content-length':'67108865'});declared.request.write('one');assert.equal((await declared.result).status,413);declared.request.destroy();
    const timed=client(url,'/timeout');timed.request.write('pending');assert.equal((await timed.result).status,504);timed.request.destroy();
    const stalled=client(url,'/response-timeout');stalled.request.end('one');assert.ok((await stalled.result).error);
    const prefix=deferred(), late=client(url,'/late-error',{},()=>prefix.resolve());late.request.end('one');await prefix.promise;lateResponse.destroy();assert.ok((await late.result).error);
    const disconnected=client(url,'/collect');disconnected.request.write('pending');await new Promise(resolve=>setImmediate(resolve));disconnected.request.destroy();await disconnected.result;
    const healthy=client(url,'/collect');healthy.request.end('healthy');assert.equal(JSON.parse((await healthy.result).text).bytes,7);
    assert.ok(events.filter(e=>e.event==='request').every(e=>e.executionEvidence.mode==='native-wasm'&&e.executionEvidence.wasmSha256===wasmHash&&e.executionEvidence.automaticFallback===false));

    // A short total request deadline survives upload EOF and effect settlement.
    const configFile=path.join(root,'.pulse/config.ts');
    fs.writeFileSync(configFile,fs.readFileSync(configFile,'utf8').replace('maxDurationMs:30000','maxDurationMs:250').replace('maxBytes:67108864','maxBytes:32'));
    boundedDev=await startDevServer(resolveProject({cwd:root}),{port:0,watch:false});
    const oversized=client(boundedDev.ready.url,'/collect');oversized.request.write('x'.repeat(33));
    assert.equal((await oversized.result).status,413);oversized.request.destroy();
    const budgeted=client(boundedDev.ready.url,'/budget');budgeted.request.end('one');
    assert.ok((await budgeted.result).error);

    // The same emitted artifact uses the normal invocation registry. Closing
    // a suspended owner fences a late completion and leaves input unread.
    let reads=0,cancels=0;
    const body=new ReadableStream({pull(){reads++;},cancel(){cancels++;}},{highWaterMark:0});
    const owner=createIncomingBody(new Request('http://localhost/collect',{method:'POST',body,duplex:'half'}),{bodyForwarding:{maxBytes:1024},maxDurationMs:1000,fetchImplementation:globalThis.fetch});
    const controller=instantiateCanonicalNativeModule({wasm,plan},{providerAdapter:createNodeProviderAdapter(),incomingBody:owner,request:{method:'POST',path:'/collect'}});
    assert.equal(controller.start(),1);const pending=controller.pendingEffects();assert.equal(pending.length,1);
    controller.close();assert.throws(()=>controller.setEffectResult(pending[0].ticket,{}),{code:'PULSE_EFFECT_INVOCATION_INVALID'});await owner.close();
    assert.equal(reads,0);assert.equal(cancels,1);
    console.log(JSON.stringify({status:'passed',wasmSha256:wasmHash,sizes,firstByteBeforeEof:true,noReadDenial:true,groupSuspension:true,groupPreflight:true,abandonedResponse:true,staleCompletionRejected:true,emptyBody:true,earlyResponse:true,redirectNotReplayed:true,declaredLimit:true,operationTimeout:true,postEofOperationTimeout:true,postEofRequestDeadline:true,measuredLimit:true,postHeaderFailure:true,disconnectRecovery:true}));
  } finally {
    if(boundedDev)await close(boundedDev.server);if(dev)await close(dev.server);await close(origin);fs.rmSync(root,{recursive:true,force:true});
  }
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
