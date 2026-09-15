'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const { compileCanonicalSource, loadCanonicalModule } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const canonicalHost = require('../../packages/host-runtime/src/runtime/canonical-api-runtime');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime');
const { createNodeKvReference } = require('../../../packages/provider-node/src/runtime/conditional-kv');
const { executeNodeJavascriptApplication } = require('../../../packages/provider-node/src/javascript/runtime-host');
const portable = require('../../../packages/runtime/src/host');
const vectors = require('./k1/vectors.json');
function deferred() { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; }
function clock() {
  let time=0, next=0; const timers=new Map();
  return {now:()=>time,setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:time+delay});return id;},clearTimeout(id){timers.delete(id);},
    advance(ms){time+=ms;for(const [id,timer] of [...timers]) if(timer.at<=time){timers.delete(id);timer.fn();}},pending:()=>timers.size};
}
function permutations(xs) { return xs.length ? xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>i!==j)).map(t=>[x,...t])) : [[]]; }
async function main() {
  const filename=path.join(__dirname,'k2/consumer.ts'), source=fs.readFileSync(filename,'utf8');
  const compiled=compileCanonicalSource(source,{fileName:filename,strict:false});
  const plan=buildCanonicalNativePlan(compiled), native=compileCanonicalNativePlan(plan);
  const live=new Module(filename,module);live.filename=filename;live.paths=module.paths;
  live._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  const app=live.exports.default;
  assert.ok(plan.effects.some(e=>e.kind==='kv.compareAndSwap'));
  for(const effect of plan.effects.filter(e=>portable.isConditionalKv(e.kind))) assert.equal(effect.result.valueKind,'json');
  assert.ok(native.inspection.importModules.every(m=>['pulse_host','env'].includes(m)));
  assert.equal(native.manifest.policy.javascriptRuntime,false);
  const program=loadCanonicalModule(compiled);
  let cases=0;
  for (const target of ['javascript','native','generator']) {
    async function invoke(command, ref, options={}) {
      const observations=[];
      const request={method:'POST',path:'/',headers:[['content-type','application/json']],body:JSON.stringify(command)};
      const adapter=options.providerAdapter || createNodeProviderAdapter({kvReference:ref});
      if(target==='javascript') {
        const response=await executeNodeJavascriptApplication(app,new Request('http://kv.test/',{method:'POST',headers:request.headers,body:request.body}),{
          kvReference:ref,strict:false,...options,onEffectObservation:e=>observations.push(e)
        });
        return {body:await response.json(),trace:observations};
      }
      const result=target==='native' ? await nativeHost.executeCanonicalNativeModule(native,{request,strict:false,providerAdapter:adapter,...options})
        : await canonicalHost.createCanonicalHostRuntime({providerAdapter:adapter}).execute(program,{request,strict:false,...options});
      return {body:JSON.parse(result.response.body),trace:result.trace};
    }
    const ref=createNodeKvReference({kvInstanceId:target,kvGenerationStart:'9007199254740993'});
    const get=key=>invoke({operation:'get',key},ref);
    const largest='x'.repeat(65534), bodyLimits={maxRequestBodyBytes:262144,maxStructuredBodyBytes:262144,maxBodyBytes:262144};
    assert.deepEqual((await invoke({operation:'create',key:'largest',value:largest},ref,bodyLimits)).body,{status:'stored'});
    assert.equal((await invoke({operation:'get',key:'largest'},ref,bodyLimits)).body.value,largest);
    assert.deepEqual((await invoke({operation:'create',key:'oversized',value:largest+'x'},ref,bodyLimits)).body,{status:'not-stored',reason:'too-large'});

    assert.deepEqual((await get('missing')).body,{status:'not-found'});
    assert.deepEqual((await invoke({operation:'cas',key:'missing',generation:`node-kv-v1:${target}:00000000000000000000000000000001`,value:null},ref)).body,{status:'conflict'});
    assert.deepEqual((await invoke({operation:'create',key:'null',value:null},ref)).body,{status:'stored'});
    assert.equal((await get('null')).body.value,null);
    const read=(await get('null')).body;
    assert.deepEqual((await invoke({operation:'cas',key:'null',generation:read.generation,value:null},ref)).body,{status:'stored'});
    assert.notEqual((await get('null')).body.generation,read.generation,'same-byte write changes generation');
    assert.deepEqual((await invoke({operation:'cas',key:'null',generation:read.generation,value:'stale'},ref)).body,{status:'conflict'});
    assert.deepEqual((await invoke({operation:'cas',key:'null',generation:9007199254740992,value:null},ref)).body,{status:'not-stored',reason:'invalid-generation'});
    for(const operation of ['create-race','cas-race']) {
      const body=(await invoke({operation,key:'race',generation:(await get('race')).body.generation},ref)).body;
      assert.deepEqual(Object.values(body).map(x=>x.status).sort(),['conflict','conflict','stored']);
    }
    for(const order of permutations([1,2,3])) {
      const key='schedule-'+order.join('');
      const created=await Promise.all(order.map(writer=>invoke({operation:'create',key,value:{writer}},ref)));
      assert.deepEqual(created.map(x=>x.body.status).sort(),['conflict','conflict','stored']);
      const generation=(await get(key)).body.generation;
      const replaced=await Promise.all(order.map(writer=>invoke({operation:'cas',key,generation,value:{writer}},ref)));
      assert.deepEqual(replaced.map(x=>x.body.status).sort(),['conflict','conflict','stored']);
      cases+=2;
    }
    // An old observation stays internally paired and is still stale at authority.
    let stale;
    const staleRef=createNodeKvReference({kvInstanceId:'stale',kvHooks:{read:current=>stale || current}});
    await invoke({operation:'create',key:'stale',value:{revision:0}},staleRef);
    stale=(await invoke({operation:'get',key:'stale'},staleRef)).body;
    await invoke({operation:'cas',key:'stale',generation:stale.generation,value:{revision:1}},staleRef);
    assert.deepEqual((await invoke({operation:'get',key:'stale'},staleRef)).body,stale);
    assert.deepEqual((await invoke({operation:'cas',key:'stale',generation:stale.generation,value:{revision:2}},staleRef)).body,{status:'conflict'});
    // Fixed K1 u64 token strings are opaque through actual application/ABI values.
    for(const row of vectors.tokens) {
      let condition;
      const dispatch=effect=>effect.kind==='kv.getVersioned'?{status:'found',value:{n:1},generation:row.token}:(condition=effect.generation,{status:'stored'});
      const result=await invoke({operation:'round-trip',key:'token-key',value:{n:2}},ref,target==='javascript'
        ? {effectAdapter:{dispatch}}
        : {providerAdapter:{id:'node',dispatchEffect:dispatch}});
      assert.equal(condition,row.token);assert.equal(result.body.before.generation,row.token);assert.deepEqual(result.body.result,{status:'stored'});cases++;
    }
    for(const phase of ['prepare','afterCommit']) {
      const lostRef=createNodeKvReference({kvInstanceId:'lost',kvHooks:{[phase]:()=>{throw new Error('private-key private-value');}}});
      const lost=await invoke({operation:'create',key:'private-key',value:'private-value'},lostRef);
      assert.deepEqual(lost.body,{status:phase==='prepare'?'not-stored':'unknown',reason:phase==='prepare'?'unavailable':'transport'});
      assert.equal(JSON.stringify(lost.trace).includes('private-key'),false);assert.equal(JSON.stringify(lost.trace).includes('private-value'),false);
      if(phase==='afterCommit') assert.equal((await lostRef.kv('catalog').getVersioned('private-key')).status,'found');
      cases++;
    }
    for(const phase of ['prepare','afterCommit']) for(const mode of ['timeout','cancel']) {
      const reached=deferred(),release=deferred(),timer=clock(),abort=new AbortController();
      const slowRef=createNodeKvReference({kvInstanceId:'slow',kvHooks:{[phase]:()=>{reached.resolve();return release.promise;}}});
      const operation=invoke({operation:'create',key:'slow',value:{receipt:'accepted'}},slowRef,{kvClock:timer,signal:abort.signal});
      await reached.promise;
      if(mode==='timeout') timer.advance(10001); else abort.abort();
      if(mode==='cancel') {
        if(target==='javascript') await assert.rejects(operation,error=>error===abort.signal.reason);
        else await assert.rejects(operation,error=>error.code==='PULSE_RUNTIME_EFFECT_ABORTED');
      }
      else {
        const result=await operation;
        assert.deepEqual(result.body,{status:phase==='prepare'?'not-stored':'unknown',reason:'timeout'});
        assert.ok(result.trace.some(e=>e.type==='kv-lifecycle' && e.dispatched===(phase==='afterCommit')));
      }
      release.resolve(); await new Promise(r=>setImmediate(r));
      assert.equal(timer.pending(),0,'deadline timers disposed');
      assert.equal((await slowRef.kv('catalog').getVersioned('slow')).status,phase==='prepare'?'not-found':'found');cases++;
    }
    // Admission with an already expired host request deadline never enters provider work.
    let prepared=0; const expiredRef=createNodeKvReference({kvInstanceId:'expired',kvHooks:{prepare:()=>{prepared++;}}});
    assert.deepEqual((await invoke({operation:'create',key:'expired',value:1},expiredRef,{kvClock:clock(),deadlineMonotonicMs:0})).body,{status:'not-stored',reason:'timeout'});
    assert.equal(prepared,0);
    console.log(`ok - K2 ${target}: shared authority, token transport, races, stale observations, uncertainty, deadlines and cancellation`);
  }
  // Native effect_begin owns admission: even a host mutation of the original
  // heap payload after suspension cannot change the admitted candidate.
  const controller = nativeHost.instantiateCanonicalNativeModule(native, {request:{method:'POST',path:'/',headers:[['content-type','application/json']],body:JSON.stringify({operation:'create',key:'snapshot',value:{count:1}})}});
  assert.equal(controller.start(),nativeHost.CANONICAL_NATIVE_RUN_STATUS.SUSPENDED);
  const pending=controller.pendingEffects(); assert.equal(pending.length,1);
  assert.throws(() => { pending[0].payload.value.count=9; });
  assert.notEqual(pending[0].payload.value,pending[0].kvAdmission.value);
  assert.deepEqual(pending[0].kvAdmission.value,{count:1});
  assert.ok(Object.isFrozen(pending[0].kvAdmission.value));
  // Project-owned schemas still validate request and response transport around
  // KV results; a TypeScript T never becomes implicit provider-side validation.
  const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
  const bundle = buildCanonicalSchemaBundle([
    { id: 'kv.command', fields: [{ name: 'key', type: 'string' }, { name: 'count', type: 'i32' }] },
    { id: 'kv.ack', fields: [{ name: 'status', type: 'string' }] }
  ]);
  const typedSource = `export default async function typed(ctx) {
    const cmd = await ctx.req.json('kv.command');
    const result = await ctx.kv('catalog').insertIfAbsent(cmd.key, {count: cmd.count});
    return ctx.json({status: result.status}, {schema:'kv.ack'});
  }`;
  const typedCompiled = compileCanonicalSource(typedSource, {fileName:'typed-kv.ts',schemaBundle:bundle,strict:true});
  const typedNative = compileCanonicalNativePlan(buildCanonicalNativePlan(typedCompiled));
  const typedProgram = loadCanonicalModule(typedCompiled);
  const typedLive = new Module(filename,module); typedLive.paths=module.paths;
  typedLive._compile(ts.transpileModule(typedSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  for (const target of ['javascript','native','generator']) {
    const ref=createNodeKvReference({kvInstanceId:'schema'}), adapter=createNodeProviderAdapter({kvReference:ref});
    async function run(body) {
      const request={method:'POST',path:'/',headers:[['content-type','application/json']],body:JSON.stringify(body)};
      if(target==='javascript') {
        const response=await executeNodeJavascriptApplication(typedLive.exports.default,new Request('http://kv.test/',{method:'POST',headers:request.headers,body:request.body}),{kvReference:ref,strict:true,schemaCodecs:typedProgram.schemaCodecs});
        return {status:response.status,body:response.status===200?await response.json():null};
      }
      const result=target==='native' ? await nativeHost.executeCanonicalNativeModule(typedNative,{request,providerAdapter:adapter,strict:true})
        : await canonicalHost.createCanonicalHostRuntime({providerAdapter:adapter}).execute(typedProgram,{request,strict:true});
      return {status:result.response.status,body:JSON.parse(result.response.body)};
    }
    assert.deepEqual(await run({key:'typed',count:7}),{status:200,body:{status:'stored'}});
    if(target==='javascript') assert.notEqual((await run({key:'invalid',count:'wrong'})).status,200);
    else await assert.rejects(run({key:'invalid',count:'wrong'}));
    assert.equal((await ref.kv('catalog').getVersioned('invalid')).status,'not-found');
  }
  const fastly = require('../../../packages/provider-fastly/src/javascript/target-support-policy');
  const node = require('../../../packages/provider-node/src/javascript/target-support-policy');
  for(const kind of portable.KV_CONDITIONAL_KINDS) {
    assert.equal(fastly.classifyFastlyJavascriptCapability(kind).status,'blocked');
    assert.equal(node.classifyNodeJavascriptCapability(kind,{bindingsRedaction:true}).status,'eligible');
  }
  // Literal bindings only; dynamic key/generation/value remain ordinary data.
  for(const invalid of [
    `export default async function h(ctx) { const r = await ctx.kv(ctx.req.header('store')).getVersioned('k'); return ctx.json(r); }`,
    `export default async function h(ctx) { const r = await ctx.parallel({ bad: Promise.resolve(1) }); return ctx.json(r); }`,
    `export default async function h(ctx) { const r = ctx.kv('n').compareAndSwap('k','token',1); return ctx.json(r); }`
  ]) assert.throws(()=>compileCanonicalSource(invalid,{fileName:'invalid-kv.ts',strict:false}));
  console.log(`ok - ${cases} K2 target scenarios plus lowering negatives; no Fastly realization or deployed claims`);
}
main().catch(error=>{console.error(error); if(error.diagnostics) console.error(error.diagnostics);process.exitCode=1;});
