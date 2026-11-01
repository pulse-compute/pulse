'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {once} = require('node:events');
const {performance} = require('node:perf_hooks');
const {createHash} = require('node:crypto');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const base = 'https://deadline.example.test';
const ack = {status:202,headers:[['x-ack','accepted']],body:'body'};
function source(mode) {
  const routes = [['run','1000'],['default',undefined],['short','100'],['one','1'],['equal','600'],['long','9007199254740991'],
    ['zero','0'],['negative','-1'],['fraction','0.5'],['unsafe','9007199254740992']];
  return `import {Pulse} from '@pulse-compute/pulse';
const app = new Pulse({auto:true});
${routes.map(([route,timeout]) => `app.get('/${route}', async ctx => {const response = await ctx.fetch('${base}/origin',{method:'POST',body:'dispatch'${timeout === undefined ? '' : `,timeoutMs:${timeout}`}}); if(response.status === 202 && response.header('x-ack') === 'accepted') return ctx.text('healthy',{headers:{'x-tick-dispatch':'acked'}}); return ctx.text('not-acked');});`).join('\n')}
app.get('/checkpoint', async ctx => {const response = await ctx.fetch('${base}/origin',{timeoutMs:1000}); await ctx.kv('proof').put('checkpoint',true); return ctx.text('success');});
app.get('/text', async ctx => {const body = await ctx.fetch('${base}/origin',{timeoutMs:100}).text(); return ctx.text(body);});
app.get('/text-group', async ctx => {const result = await ctx.parallel({body:ctx.fetch('${base}/origin',{timeoutMs:100}).text(),other:ctx.fetch('${base}/fast',{timeoutMs:500})}); return ctx.text(result.body);});
app.get('/group', async ctx => {const {slow,fast} = await ctx.parallel({slow:ctx.fetch('${base}/slow',{timeoutMs:2000}),fast:ctx.fetch('${base}/fast',{timeoutMs:500})}); if(slow.status === 202 && fast.status === 202) return ctx.text('both'); return ctx.text('bad');});
app.get('/twice', async ctx => {const first=await ctx.fetch('${base}/origin',{timeoutMs:1000});if(first.status !== 202)return ctx.text('bad');const second=await ctx.fetch('${base}/origin',{timeoutMs:1000});if(second.status !== 202)return ctx.text('bad');return ctx.text('twice');});
app.get('/recover-again', async ctx => {const response = await ctx.fetch('${base}/origin',{timeoutMs:1000});return ctx.text('success');});
${mode === 'none' ? '' : `app.error(async (error,ctx,next) => {if(ctx.req.path === '/recover-again'){const response = await ctx.fetch('${base}/recovery',{timeoutMs:1000});return ctx.text('recovered');}return ctx.text(error.code,{headers:{'x-tick-dispatch':'failed'}});});
app.error(async (error,ctx,next) => ctx.text(error.code,{status:503,headers:{'x-tick-dispatch':'failed'}}));`}
export default app;`;
}
async function main() {
  const dir = fs.mkdtempSync(path.join(path.resolve(__dirname,'../../..'),'.fetch-deadline-proof-'));
  const tc = acceptanceToolchain(); let checks = 0;
  try {
    fs.mkdirSync(path.join(dir,'src')); fs.mkdirSync(path.join(dir,'.pulse'));
    for (const mode of ['recover','none','budget']) {
      fs.writeFileSync(path.join(dir,'.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig(_ => ({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'proof'},proof:{host:'fastly',target:'native',fastly:{${mode === 'budget' ? 'maxDurationMs:600,' : ''}bindings:{backends:{'${base}':'origin'},kv:{proof:'proof'}}}}}));`);
      fs.writeFileSync(path.join(dir,'src/index.ts'),source(mode));
      const native = tc.compileFastly(tc.resolveProject({cwd:dir,profile:'proof'}));
      const run = (route,fixture,extra={}) => tc.executeFastlyNativePlatformCapabilities(native,{request:{path:route},
        fixtures:{[`${base}/origin`]:{...ack,...fixture}},kvStores:{proof:{}},sendErrorDetailLayout:'managed',allowHandledFetchDeadlineError:true,allowHandledTransportError:true,...extra});
      const expired = mode === 'budget' ? 600 : 1000;
      const failureStatus = mode === 'recover' ? 200 : 504;
      const failureBody = mode === 'recover' ? 'PULSE_FETCH_TIMEOUT' : 'Gateway Timeout';
      for (const fixture of [{delayMs:1000},{delayMs:1400},{neverHeaders:true}]) for (const route of ['/run','/checkpoint']) {
        const result = run(route,fixture);
        assert.equal(result.response.status,failureStatus);assert.equal(result.response.body,failureBody);
        assert.equal(result.monotonicMs,expired);
        assert.equal(result.outboundRequests.length,1,'no retry');
        assert.ok(!result.trace.some(x=>x.module==='fastly_kv_store'),'timeout cannot resume checkpoint');
        assert.equal(result.trace.filter(x=>x.name==='send_downstream').length,1);
        assert.equal(result.instance.exports.pulse_fastly_fetch_retired(),1);
        assert.equal(result.transportResources.pendingRequests,result.instance.exports.pulse_fastly_fetch_unreaped());
        assert.ok(result.trace.filter(x=>x.name==='select').every(x=>x.timeout>0 && x.timeout<=expired));
        if(mode==='budget') assert.equal(result.instance.exports.pulse_fastly_request_expired(),1);
        checks++;
      }
      for (const [route,delay,success] of [['one',0,true],['one',1,false],['short',99,true],['short',100,false],['run',599,true]]) {
        const result = run('/'+route,{delayMs:delay});
        assert.equal(result.response.body,success?'healthy':mode==='none'?'Gateway Timeout':'PULSE_FETCH_TIMEOUT');
        assert.equal(result.monotonicMs,delay);checks++;
      }
      for (const route of ['/zero','/negative','/fraction','/unsafe']) {
        const result = run(route,{});
        assert.equal(result.response.status,400);assert.equal(result.response.body,'Invalid fetch timeoutMs');
        assert.equal(result.outboundRequests.length,0);assert.equal(result.monotonicMs,0);checks++;
      }
      const headers = run('/run',{delayMs:10,bodyDelayMs:10000,bodyReadStatus:1});
      assert.equal(headers.response.body,'healthy');assert.equal(headers.monotonicMs,10);
      assert.ok(!headers.trace.some(x=>x.module==='fastly_http_body' && x.name==='read'),'headers do not wait for body');checks++;
      // The fixture's bodyDelayMs alone does not delay every body reader. Advance
      // the actual read hostcall to prove the deadline boundary, not a fixture flag.
      for (const route of ['/text','/text-group']) {
        const body = run(route,{}, {
          fixtures:{[`${base}/origin`]:{...ack,delayMs:10},[`${base}/fast`]:{...ack,delayMs:20}},
          hostcallDelayMs:{'fastly_http_body.read':1000}
        });
        assert.ok(body.trace.some(x=>x.module==='fastly_http_body' && x.name==='read'));
        assert.ok(body.monotonicMs>=1000);
        assert.equal(body.response.body,mode==='budget'?'Gateway Timeout':'body',
          'body acquisition outlives the header timeout but not the request budget');
        assert.equal(body.instance.exports.pulse_fastly_request_expired?.() || 0,mode==='budget'?1:0);
        checks++;
      }
      if(mode==='budget') {
        for(const route of ['/equal','/group']) {
          const equal = run(route,{neverHeaders:true},{fixtures:{
            [`${base}/origin`]:{...ack,delayMs:600},
            [`${base}/slow`]:{...ack,delayMs:600},
            [`${base}/fast`]:{...ack,delayMs:100}
          }});
          assert.equal(equal.response.status,504);
          assert.equal(equal.response.body,'Gateway Timeout');
          assert.equal(equal.instance.exports.pulse_fastly_request_expired(),1);
          assert.equal(equal.monotonicMs,600);
          checks++;
        }
      }
      const large = run('/long',{delayMs:10});
      assert.equal(large.response.body,'healthy');assert.equal(large.monotonicMs,10);checks++;
      for (const [options,budgetStatus] of [
        [{monotonicClock:()=>({status:1})},504],
        [{monotonicClock:(() => {let n=0;return () => ({nanoseconds:n++===0?1000000n:0n});})()},504],
        [{asyncSelectFault:()=>({status:1})},504],
        [{asyncSelectFault:()=>({selected:99})},504],
        [{monotonicClock:()=>({nanoseconds:0n})},500],
        [{asyncSelectFault:()=>({advanceMs:0,selected:-1})},500]
      ]) {
        const result = run('/run',{neverHeaders:true},options);
        assert.equal(result.response.status,mode==='budget'?budgetStatus:500);
        assert.ok(!result.trace.some(x=>x.module==='fastly_kv_store'));checks++;
      }
      for(const failure of ['sendStatus','transportStatus']) {
        const result=run('/run',{[failure]:1,delayMs:10});
        assert.equal(result.response.body,mode==='none'?'Bad Gateway':'PULSE_FETCH_NETWORK');
        assert.equal(result.outboundRequests.length,failure==='sendStatus'?0:1);checks++;
      }
      const controller=new AbortController(),cancelled=new Error('cancelled by host');
      assert.throws(()=>run('/run',{neverHeaders:true},{signal:controller.signal,asyncSelectFault:()=>{controller.abort(cancelled);}}),error=>error===cancelled);checks++;
      const beforeSend = run('/run',{}, {hostcallDelayMs:{'fastly_http_req.uri_set':1000}});
      assert.equal(beforeSend.response.body,failureBody);assert.equal(beforeSend.outboundRequests.length,0);checks++;
      const afterPoll = run('/run',{}, {hostcallDelayMs:{'fastly_http_req.pending_req_poll_v2':1000}});
      assert.equal(afterPoll.response.body,failureBody);
      assert.equal(afterPoll.transportResources.pendingRequests,0);
      assert.ok(afterPoll.trace.some(x=>x.module==='fastly_http_resp' && x.name==='close'));checks++;
      const groupOptions = {fixtures:{[`${base}/slow`]:{...ack,delayMs:1500},[`${base}/fast`]:{...ack,delayMs:100}}};
      const group = run('/group',{},groupOptions);
      assert.equal(group.response.body,mode==='budget'?'Gateway Timeout':'both');
      assert.equal(group.monotonicMs,mode==='budget'?600:1500);
      assert.equal(group.outboundRequests.length,2);checks++;
      if(mode!=='budget') {
        const repeated = run('/twice',{delayMs:750});
        assert.equal(repeated.response.body,'twice');assert.equal(repeated.monotonicMs,1500);
        assert.equal(repeated.outboundRequests.length,2);checks++;
        const omitted = run('/default',{delayMs:1400});
        assert.equal(omitted.response.body,'healthy');assert.ok(!omitted.trace.some(x=>x.name==='select'));checks++;
        const failedGroup = run('/group',{}, {fixtures:{[`${base}/slow`]:{...ack,neverHeaders:true},[`${base}/fast`]:{...ack,delayMs:100}}});
        assert.equal(failedGroup.response.body,mode==='none'?'Gateway Timeout':'PULSE_FETCH_TIMEOUT');
        assert.equal(failedGroup.monotonicMs,2000);assert.equal(failedGroup.outboundRequests.length,2);checks++;
      }
      if(mode==='recover') {
        const retryHandler = run('/recover-again',{neverHeaders:true},{fixtures:{[`${base}/origin`]:{neverHeaders:true},[`${base}/recovery`]:{neverHeaders:true}}});
        assert.equal(retryHandler.response.status,503);assert.equal(retryHandler.response.body,'PULSE_FETCH_TIMEOUT');
        assert.equal(retryHandler.monotonicMs,2000);assert.equal(retryHandler.outboundRequests.length,2);
        assert.equal(retryHandler.instance.exports.pulse_fastly_fetch_retired(),2);checks++;
        const reaped = run('/recover-again',{}, {fixtures:{[`${base}/origin`]:{...ack,delayMs:1400},[`${base}/recovery`]:{...ack,delayMs:600}}});
        assert.equal(reaped.response.body,'recovered');assert.equal(reaped.monotonicMs,1600);
        assert.equal(reaped.instance.exports.pulse_fastly_fetch_retired(),1);assert.equal(reaped.instance.exports.pulse_fastly_fetch_unreaped(),0);
        assert.equal(reaped.transportResources.pendingRequests,0);checks++;
      }
      await replay(native,dir,mode);
    }
    console.log(`ok - Fastly fetch deadlines: ${checks} emitted-Wasm ABI cases`);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
async function replay(native,dir,mode) {
  if (!process.env.PULSE_VICEROY_BIN) {console.log('skip - fetch deadline HTTP replay requires PULSE_VICEROY_BIN; ABI fixture is not provider reality');return;}
  const launcher = cli.inspectFastlyComputeLauncher({viceroyBinary:process.env.PULSE_VICEROY_BIN,required:true});
  const timers = new Set(); let requests=0, originMode='fast', bodyEnded=0;
  const origin = http.createServer((_req,res) => {
    requests++; const selected=originMode;
    if(selected==='never')return;
    if(selected==='body'){res.writeHead(202,{'x-ack':'accepted'});res.flushHeaders();}
    const timer=setTimeout(()=>{timers.delete(timer);if(res.destroyed)return;if(selected!=='body')res.writeHead(202,{'x-ack':'accepted'});res.end('body');if(selected==='body')bodyEnded++;},selected==='slow'?1400:selected==='body'?2000:0);
    timers.add(timer);
  });
  origin.listen(0,'127.0.0.1');await once(origin,'listening');
  const wasmFile=path.join(dir,'main.wasm'),manifestFile=path.join(dir,'fastly.toml');
  fs.writeFileSync(wasmFile,native.wasm);
  fs.writeFileSync(manifestFile,cli.renderFastlyLocalConfig({name:'fetch-deadline-proof',backends:{origin:{url:`http://127.0.0.1:${origin.address().port}`,useSni:false}},kvStores:{proof:{}}}));
  let server;
  try {
    server=await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile,manifestFile,startTimeoutMs:60000,stopTimeoutMs:5000});
    for(const scenario of ['slow','never','body']) {
      requests=0;bodyEnded=0;originMode=scenario;
      const start=performance.now(),response=await cli.requestFastlyCompute(server,{path:'/run'}),elapsed=performance.now()-start;
      const success=scenario==='body';
      assert.equal(response.status,success||mode==='recover'?200:504);
      assert.equal(response.body.toString(),success?'healthy':mode==='recover'?'PULSE_FETCH_TIMEOUT':'Gateway Timeout');
      assert.equal(requests,1);assert.ok(elapsed<=(mode==='budget'?850:1250),`${mode}/${scenario}: ${elapsed}ms`);
      if(success){assert.equal(bodyEnded,0);assert.ok(response.headers.some(([k,v])=>k==='x-tick-dispatch'&&v==='acked'));}
      else if(mode==='recover')assert.ok(response.headers.some(([k,v])=>k==='x-tick-dispatch'&&v==='failed'));
      console.log(`ok - local ${launcher.kind} ${launcher.inspection.version}: ${mode}/${scenario} ${Math.round(elapsed)}ms`);
    }
    console.log(`Wasm sha256 (${mode}) ${createHash('sha256').update(native.wasm).digest('hex')}`);
  } finally {if(server)await server.stop();for(const timer of timers)clearTimeout(timer);origin.closeAllConnections();await new Promise(resolve=>origin.close(resolve));}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
