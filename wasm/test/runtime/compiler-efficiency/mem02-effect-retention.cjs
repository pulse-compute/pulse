#!/usr/bin/env node
'use strict';

// Evidence only: public host/controller seams, WeakRefs, and listener counters.
// No monkey-patched runtime, production instrumentation, or heap-root deletion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { getEventListeners, setMaxListeners } = require('node:events');
const root = path.resolve(__dirname, '../../../..');
const host = require('../../../packages/host-runtime/src/runtime/canonical-native-host');
const generator = require('../../../packages/host-runtime/src/runtime/canonical-api-runtime');
const { compileCanonicalSource, loadCanonicalModule } = require('../../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-compiler');
const jsHost = require('../../../../packages/provider-node/src/javascript/runtime-host');
const { createJavascriptEffectExecution } = require('../../../../packages/runtime/src/internal/effect-adapter');
const { createStructuredBodyReader } = require('../../../../packages/runtime/src/internal/body');
const { createRequestBudget } = require('../../../../packages/runtime/src/internal/request-budget');
const { createContinuationRegistry } = require('../../../packages/host-runtime/src/runtime/continuation-registry');
const tick = () => new Promise(resolve => setImmediate(resolve));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const jsonBytes = value => Buffer.byteLength(JSON.stringify(value));
const listeners = signal => getEventListeners(signal, 'abort').length;
const live = refs => refs.filter(ref => ref.deref() !== undefined).length;
async function collect() {
  // Never dereference between collections: WeakRef targets survive the current job.
  for (let i = 0; i < 5; i++) { await tick(); global.gc(); }
  await tick();
}
function clock() {
  let time = 0; const timers = new Map();
  return { now: () => time, setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, pending: () => timers.size,
    advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } } };
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const source = `export default async function handler(ctx) {
 let key='p0';let count=0;let first=null;
 const state={visits:0};const alias=state;
 for(let i=0;i<64&&key!=='';i++){
  const row=await ctx.kv('pages').getVersioned(key);
  if(row.status!=='found')return ctx.text('unavailable');
  if(i===0)first=row.value;
  alias.visits+=1;count+=1;key=row.value.next;
 }
 return ctx.text(count+':'+state.visits+':'+(first===null?'':first.tag));
}`;
const parallelSource = `export default async function handler(ctx){
 const rows=await ctx.parallel({left:ctx.config.get('LEFT'),right:ctx.config.get('RIGHT')});
 return ctx.text(rows.left+':'+rows.right);
}`;
function row(index, count, size) { return { status: 'found', generation: 'g'+index,
  value: { next: index + 1 < count ? 'p'+(index+1) : '', tag: 'row-'+index, text: String(index).padStart(4,'0')+'x'.repeat(size-4) } }; }
function compile(text) {
  const canonical = compileCanonicalSource(text, { fileName: 'mem02.ts', strict: false, requireAsync: true });
  return { canonical, native: compileCanonicalNativePlan(buildCanonicalNativePlan(canonical), { cwd: root }), program: loadCanonicalModule(canonical) };
}
function heapSnapshot(controller, stage, iteration) {
  const pages = new Set();
  for (const value of controller.heap.values.values()) {
    if (value && typeof value === 'object') {
      if (typeof value.tag === 'string' && typeof value.text === 'string') pages.add(value);
      if (value.value && typeof value.value.tag === 'string') pages.add(value.value);
    }
  }
  return { stage, iteration, handles: controller.heap.size(), payloadGraphs: pages.size,
    // A logical payload measure, not V8 string/heap allocation size.
    logicalPayloadUtf16Bytes: [...pages].reduce((n, p) => n + 2*p.text.length, 0),
    accounted: controller.heap.budget?.snapshot(), traceEntries: controller.trace.length,
    traceJsonBytes: jsonBytes(controller.trace), linearMemoryCapacity: controller.exports.memory.buffer.byteLength };
}
async function nativeIterations(compiled, count, size) {
  let controller = host.instantiateCanonicalNativeModule(compiled, { strict: false });
  const weakController = new WeakRef(controller), refs = [], stages = [heapSnapshot(controller, 'admission', 0)];
  let status = controller.start(), index = 0;
  while (status === 1) {
    const pending = controller.pendingEffects(); assert.equal(pending.length, 1);
    stages.push(heapSnapshot(controller, 'suspended', index));
    const entry = pending[0];
    const normalized = controller.prepareEffectResult(entry.index, row(index, count, size));
    refs.push(new WeakRef(normalized.value));
    controller.setEffectResult(entry.ticket, normalized);
    assert.throws(() => controller.setEffectResult(entry.ticket, normalized), { code: 'PULSE_EFFECT_INVOCATION_INVALID' });
    stages.push(heapSnapshot(controller, 'settled', index+1));
    status = controller.resume(); index++;
    stages.push(heapSnapshot(controller, 'resumed', index));
  }
  assert.equal(index, count); assert.equal(status, 0);
  assert.equal(controller.response().body, count+':'+count+':row-0');
  const terminal = heapSnapshot(controller, 'response-handoff', index);
  controller.close(); const closed = heapSnapshot(controller, 'closed-controller-still-owned', index);
  assert.equal(closed.handles, terminal.handles);
  assert.equal(closed.payloadGraphs, count);
  await collect(); const rooted = live(refs); assert.equal(rooted, count);
  controller = null;
  await collect();
  const released = { controllers: Number(weakController.deref() !== undefined), payloadGraphs: live(refs) };
  assert.deepEqual(released, { controllers: 0, payloadGraphs: 0 });
  let calls = 0, disposals = 0;
  const managed = await host.executeCanonicalNativeModule(compiled, { strict: false, providerAdapter: {
    id: 'mem02', dispatchEffect() { return row(calls++, count, size); }, disposeExecution() { disposals++; }
  } });
  assert.equal(managed.response.body, count+':'+count+':row-0'); assert.equal(calls, count); assert.equal(disposals, 1);
  assert.equal(managed.continuations.length, count);
  return { count, payloadBytes: size, stages, terminal, closed, rootedAfterGc: rooted, afterOwnerRelease: released,
    managed: { handles: managed.valueHandleCount, accounted: managed.memory, continuations: managed.continuations.length,
      traceEntries: managed.trace.length, traceJsonBytes: jsonBytes(managed.trace), disposalCalls: disposals } };
}
async function repeatedNative(compiled) {
  const refs = [], rows = [];
  for (let request = 1; request <= 16; request++) {
    let calls = 0;
    let result = await host.executeCanonicalNativeModule(compiled, { strict: false, providerAdapter: { id:'mem02', dispatchEffect() { return row(calls++, 4, 4096); } } });
    refs.push(new WeakRef(result)); assert.equal(result.response.body, '4:4:row-0'); result = null;
    if ([1,4,16].includes(request)) { await collect(); rows.push({ completedRequests:request, survivingResultEnvelopes:live(refs), process:process.memoryUsage() }); }
  }
  assert.ok(rows.every(r => r.survivingResultEnvelopes === 0)); return rows;
}
async function sharedGenerator(program) {
  let calls = 0;
  const runtime = generator.createCanonicalHostRuntime({ strict:false, providerAdapter:{ id:'mem02', dispatchEffect(){ return row(calls++,4,4096); } } });
  const rows=[];
  for(let request=1;request<=16;request++) {
    calls=0; const result=await runtime.execute(program); assert.equal(result.response.body,'4:4:row-0');
    if([1,4,16].includes(request)) {
      const records=runtime.registry.list(), trace=runtime.trace();
      rows.push({completedRequests:request,registryRecords:records.length,registryTransitions:runtime.registry.trace().length,
        runtimeTraceEntries:trace.length,diagnosticJsonBytes:jsonBytes({records,trace,transitions:runtime.registry.trace()})});
      assert.equal(records.length,request*4);
      assert.ok(records.every(r=>r.state==='completed'&&!('payload' in r)&&!('result' in r)));
    }
  }
  assert.throws(()=>runtime.registry.resume(runtime.registry.list()[0].id),{code:'PULSE_CONTINUATION_DOUBLE_RESUME'});
  return rows;
}
async function javascriptBodies(count, size) {
  const c=clock(),budget=createRequestBudget({maxDurationMs:1000,requestClock:c});
  setMaxListeners(0,budget.signal); // Only suppress warnings in this diagnostic fixture.
  const refs=[], stages=[]; let calls=0, disposals=0;
  const result=await jsHost.executeNodeJavascriptApplication(async ctx=>{
    stages.push({stage:'admission',listeners:listeners(budget.signal),timers:c.pending()});
    for(let i=0;i<count;i++) {
      const text=await ctx.fetch('https://example.invalid/'+i).text(); assert.equal(text.length,size);
      stages.push({stage:'projection-settled',iteration:i+1,listeners:listeners(budget.signal),timers:c.pending()});
    }
    await collect(); stages.push({stage:'before-handler-return',liveResponses:live(refs),listeners:listeners(budget.signal)});
    return ctx.text('done');
  },new Request('https://app.invalid/'),{requestBudget:budget,effectAdapter:{id:'mem02',dispatch(){
    const response=new Response(String(calls++).padStart(4,'0')+'x'.repeat(size-4),{headers:{'content-type':'text/plain'}});
    refs.push(new WeakRef(response)); return response;
  },dispose(){disposals++;}}});
  assert.equal(await result.text(),'done'); assert.equal(disposals,1);
  await collect(); const effectClosed={liveResponses:live(refs),listeners:listeners(budget.signal),timers:c.pending()};
  assert.equal(effectClosed.liveResponses,0); assert.equal(effectClosed.listeners,0);
  budget.close(); await collect();
  const budgetClosed={liveResponses:live(refs),listeners:listeners(budget.signal),timers:c.pending()};
  assert.deepEqual(budgetClosed,{liveResponses:0,listeners:0,timers:0});
  return {count,payloadBytes:size,stages,effectClosed,budgetClosed};
}
async function bodyControl(withBudget) {
  const budget=withBudget?createRequestBudget():undefined,refs=[],readers=[],buffers=[];
  const execution=createJavascriptEffectExecution({requestBudget:budget,effectAdapter:{id:'mem02',dispatch(){
    const response=new Response('control');refs.push(new WeakRef(response));return response;
  }}});
  for(let i=0;i<4;i++) await execution.dispatch({kind:'fetch',url:'https://example.invalid/',init:{}},
    async response=>{const reader=createStructuredBodyReader(response,{forceStructured:true});readers.push(new WeakRef(reader));buffers.push(new WeakRef((await reader.bytes()).buffer));return reader.text();});
  await execution.assertIdle();await collect();const settled=live(refs);
  assert.equal(settled,withBudget?4:0);const projectionRetention={readers:live(readers),buffers:live(buffers)};assert.deepEqual(projectionRetention,{readers:0,buffers:0});await execution.close();budget?.close();await collect();
  assert.equal(live(refs),0);return {withBudget,settledResponses:settled,projectionRetention,afterClose:live(refs)};
}
async function unsubscribeControl() {
  const budget=createRequestBudget();let callback=()=>{},remove=budget.onAbort(callback);
  const weak=new WeakRef(callback);callback=null;remove();remove=null;
  await collect();const removed={listeners:listeners(budget.signal),liveCallback:Number(weak.deref()!==undefined)};
  assert.deepEqual(removed,{listeners:0,liveCallback:0});
  budget.close();await collect();assert.equal(weak.deref(),undefined);
  return {removed,afterBudgetClose:{listeners:listeners(budget.signal),liveCallback:0}};
}
async function repeatedJavascript() {
  const refs=[],samples=[];
  for(let request=1;request<=16;request++) {
    let summary;
    let result=await jsHost.executeNodeJavascriptApplication(async ctx=>{
      for(let i=0;i<4;i++)assert.equal((await ctx.fetch('https://example.invalid/').text()).length,4096);
      return ctx.text('done');
    },new Request('https://app.invalid/'),{onEffectSummary(s){summary=s;},effectAdapter:{id:'mem02',dispatch(){
      const response=new Response('x'.repeat(4096));refs.push(new WeakRef(response));return response;
    }}});
    assert.equal(await result.text(),'done');assert.equal(summary.closed,true);result=null;
    if([1,4,16].includes(request)){await collect();samples.push({completedRequests:request,createdResponses:refs.length,survivingResponses:live(refs)});}
  }
  assert.ok(samples.every(s=>s.survivingResponses===0));return samples;
}

async function lifecycle(compiled, parallel) {
  const rows=[];
  for(const mode of ['success','effect-failure','timeout','cancel-late-success','cancel-late-failure']) {
    const c=clock(),abort=new AbortController(),ready=deferred(),late=deferred();let calls=0,disposals=0;
    const signals=[];
    const pending=host.executeCanonicalNativeModule(compiled,{strict:false,signal:abort.signal,maxDurationMs:100,requestClock:c,
      providerAdapter:{id:'mem02',dispatchEffect(effect,execution){calls++;signals.push(new WeakRef(execution.signal));
        if(!parallel&&calls===1)return row(0,2,32);
        if(mode==='effect-failure') throw new Error('fixture failure '+(effect.name||'read'));
        if(mode==='timeout') { c.advance(101);return parallel?'late':row(0,1,32); }
        if(mode.startsWith('cancel')) {ready.resolve();return late.promise;}
        if(parallel&&effect.name==='LEFT')return tick().then(()=>'left');
        return parallel?'right':row(calls-1,2,32);
      },disposeExecution(){disposals++;}}});
    const outcome=pending.then(result=>({result}),error=>({error}));
    if(mode.startsWith('cancel')) {await ready.promise;abort.abort();}
    const {result,error}=await outcome;
    if(mode==='success') {assert.equal(result.response.body,parallel?'left:right':'2:2:row-0');if(parallel)assert.deepEqual(result.resolutionOrder,[...compiled.plan.continuations[0].effectIds].reverse());}
    else if(mode==='effect-failure'&&!parallel) {assert.equal(result.response.body,'unavailable');}
    else {assert.ok(error,mode);if(mode==='effect-failure'&&parallel)assert.match(error.message,/LEFT/);}
    const terminal=JSON.stringify(error?.execution||result),terminalCalls=calls;
    if(mode==='cancel-late-failure')late.reject(new Error('late fixture failure'));
    if(mode==='cancel-late-success')late.resolve(parallel?'late':row(0,1,32));
    await tick();await tick();assert.equal(calls,terminalCalls);assert.equal(JSON.stringify(error?.execution||result),terminal);
    assert.equal(disposals,1);assert.equal(c.pending(),0);
    assert.ok(signals.every(ref=>!ref.deref()||listeners(ref.deref())===0));
    rows.push({target:'native',parallel,mode,calls,disposals,timers:c.pending(),code:error?.code||null,errorName:error?.name||null,
      states:(error?.execution?.continuations||result?.continuations||[]).map(x=>x.states)});
  }
  return rows;
}
async function javascriptLifecycle() {
  const rows=[];
  for(const mode of ['parallel-success','parallel-failure','timeout','cancel-late-success','cancel-late-failure','opaque-handoff']) {
    const c=clock(),abort=new AbortController(),budget=createRequestBudget({maxDurationMs:100,requestClock:c,signal:abort.signal});
    const ready=deferred(),late=deferred();let calls=0,disposals=0,cancels=0,summary;
    const refs=[];
    const response=()=>{const value=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('body'));},cancel(){cancels++;}}),{headers:{'content-type':'application/octet-stream'}});refs.push(new WeakRef(value));return value;};
    const pending=jsHost.executeNodeJavascriptApplication(async ctx=>{
      if(mode.startsWith('parallel')) {const out=await ctx.parallel({left:ctx.config.get('LEFT'),right:ctx.config.get('RIGHT')});return ctx.text(out.left+':'+out.right);}
      return await ctx.fetch('https://example.invalid/');
    },new Request('https://app.invalid/'),{requestBudget:budget,onEffectSummary(s){summary=s;},effectAdapter:{id:'mem02',dispatch(effect){calls++;
      if(mode==='parallel-success')return effect.name==='LEFT'?tick().then(()=>'left'):'right';
      if(mode==='parallel-failure')throw new Error('fixture '+effect.name);
      if(mode==='timeout'){c.advance(101);return response();}
      if(mode.startsWith('cancel')){ready.resolve();return late.promise;}
      return response();
    },dispose(){disposals++;}}});
    const outcome=pending.then(result=>({result}),error=>({error}));
    if(mode.startsWith('cancel')){await ready.promise;abort.abort();}
    let {result,error}=await outcome;
    if(mode==='parallel-success')assert.equal(await result.text(),'left:right');
    if(mode==='parallel-failure')assert.equal(result.status,500);
    if(mode.startsWith('cancel')||mode==='timeout')assert.ok(error);
    const terminal=JSON.stringify(summary);
    if(mode==='cancel-late-success')late.resolve(response());
    if(mode==='cancel-late-failure')late.reject(new Error('late fixture failure'));
    await tick();await tick();assert.equal(JSON.stringify(summary),terminal);
    if(mode==='opaque-handoff') {
      budget.close();assert.equal(cancels,0,'handoff cannot cancel transferred body');
      const reader=result.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'body');await reader.cancel();
    }
    budget.close();await collect();assert.equal(c.pending(),0);assert.equal(listeners(budget.signal),0,mode+' remaining budget listeners');assert.equal(disposals,1,mode+' disposal');
    rows.push({target:'javascript',mode,calls,disposals,cancels,code:error?.code||error?.name||null,summary:{effects:summary.effectCount,parallel:summary.parallelCount,closed:summary.closed},timers:c.pending(),listeners:listeners(budget.signal)});
    result=null;
  }
  return rows;
}
function registryStates() {
  let now=0;const registry=createContinuationRegistry({clock:()=>now,ttlMs:10});
  for(const terminal of ['completed','failed','expired','cancelled']) {
    registry.create({id:terminal});registry.wait(terminal);
    if(terminal==='completed'){registry.resume(terminal);registry.complete(terminal);}
    if(terminal==='failed')registry.fail(terminal,new Error('synthetic'));
    if(terminal==='expired'){now+=11;assert.throws(()=>registry.resume(terminal),{code:'PULSE_CONTINUATION_EXPIRED'});}
    if(terminal==='cancelled')registry.cancel(terminal);
    assert.throws(()=>registry.resume(terminal));
  }
  return {records:registry.list(),transitions:registry.trace().length};
}
async function main() {
  assert.equal(typeof global.gc,'function','Run node --expose-gc');
  const out=path.resolve(process.argv[2]||path.join(root,'wasm/.test-results/compiler-efficiency/mem02',new Date().toISOString().replace(/[:.]/g,'-')));
  fs.mkdirSync(out,{recursive:true});
  const sequential=compile(source),parallel=compile(parallelSource);
  const report={version:'pulse.mem02-effect-retention.v1',status:'running',source:{base:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    workingTree:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),harnessSha256:sha(fs.readFileSync(__filename)),productionHashes:Object.fromEntries([
      'packages/runtime/src/internal/effect-adapter.js','packages/runtime/src/internal/request-budget.js','packages/runtime/src/internal/body.js',
      'packages/runtime/src/internal/response.js','packages/runtime/src/internal/router.js','wasm/packages/host-runtime/src/runtime/canonical-native-host.js',
      'wasm/packages/host-runtime/src/runtime/canonical-api-runtime.js','wasm/packages/host-runtime/src/runtime/continuation-registry.js',
      'wasm/packages/host-runtime/src/runtime/effect-invocations.js','wasm/packages/host-runtime/src/runtime/native-value-budget.js','pnpm-lock.yaml'
    ].map(p=>[p,sha(fs.readFileSync(path.join(root,p)))])),fixtureSha256:sha(source),parallelFixtureSha256:sha(parallelSource)},
    toolchain:{node:process.version,v8:process.versions.v8,assemblyScript:sequential.native.manifest.assemblyScript},
    artifacts:{sequential:sha(sequential.native.wasm),parallel:sha(parallel.native.wasm)},
    limits:['Injected providers; no network, listener integration, Fastly execution or deployed proof.',
      'Logical payload UTF-16 and JSON sizes are representation counts, not allocated heap bytes.',
      'PS3 counters are cumulative charges; Wasm capacity and process RSS are not live sets.',
      'Explicit GC and stage readers perturb timing. WeakRef survival proves reachability only for tracked objects.',
      'Controller stepping measures guest/value retention; managed controls separately measure full driver trace and continuation counts.']};
  const save=()=>fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(report,null,2)+'\n');save();
  try {
    report.native=[];for(const [count,size]of [[1,256],[8,256],[32,4096],[64,4096]]){report.native.push(await nativeIterations(sequential.native,count,size));save();}
    report.repeatedNative=await repeatedNative(sequential.native);save();
    report.sharedGenerator=await sharedGenerator(sequential.program);save();
    report.javascriptBodies=[];for(const [count,size]of [[1,256],[8,256],[32,4096],[64,4096]]){report.javascriptBodies.push(await javascriptBodies(count,size));save();}
    report.bodyControls=[await bodyControl(false),await bodyControl(true)];report.unsubscribeControl=await unsubscribeControl();report.repeatedJavascript=await repeatedJavascript();save();
    report.lifecycle=[];report.lifecycle.push(...await lifecycle(sequential.native,false));save();report.lifecycle.push(...await lifecycle(parallel.native,true));save();report.lifecycle.push(...await javascriptLifecycle());
    report.registry=registryStates();report.status='passed';save();console.log(JSON.stringify({status:report.status,report:path.join(out,'measurements.json')}));
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};save();throw error;}
}
module.exports={main,heapSnapshot};
if(require.main===module){
  if(typeof global.gc!=='function'){const child=spawnSync(process.execPath,['--expose-gc',__filename,...process.argv.slice(2)],{stdio:'inherit'});if(child.error)throw child.error;process.exitCode=child.status??1;}
  else main().catch(error=>{console.error(error);process.exitCode=1;});
}
