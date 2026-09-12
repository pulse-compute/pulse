'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const mock = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { createConditionalKvAuthority } = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
const codec = require('../../../packages/runtime/src/host');
const vectors = require('../kv/k1/vectors.json');
const root = path.resolve(__dirname, '../../..');
const filename = path.join(__dirname, '../kv/k2/consumer.ts');
function compile(source, fileName = filename) {
  const compiled = compileCanonicalSource(source, { fileName, strict: false, schemaBundle: buildCanonicalSchemaBundle([], {maxBytes:262144}) });
  const plan = buildCanonicalNativePlan(compiled);
  return platform.compileFastlyNativePlatformCapabilitiesPlan(plan, {cwd:root,bindings:{kv:{catalog:'catalog'}}});
}
const native = compile(fs.readFileSync(filename, 'utf8'));
assert.ok(native.inspection.imports.some(x => x.module === 'fastly_async_io' && x.name === 'select'));
assert.ok(native.inspection.imports.some(x => x.module === 'fastly_kv_store' && x.name === 'lookup_wait_v2'));
assert.equal(native.manifest.policy.javascriptRuntime, false);
assert.equal(native.inspection.imports.some(x => /pulse_host|js_compute|env/.test(x.module)), false);
function authority() { const a = createConditionalKvAuthority(); a.stores.set('catalog', new Map()); return a; }
let cases = 0;
function run(command, a = authority(), options = {}, compiled = native) {
  const calls = [];
  let result;
  try { result = mock.executeFastlyNativePlatformCapabilities(compiled, {
    request:{method:'POST',body:JSON.stringify(command)},
    conditionalKv:{...options, authority:a, onCall(stage, data) { calls.push({stage,data}); return options.onCall?.(stage,data); }},
    signal:options.signal, handleStarts:options.handleStarts
  }); } catch (error) { error.message += ` (case ${cases}: ${command.operation} ${String(command.key).slice(0,40)})`; throw error; }
  assert.equal(result.response.status, 200);
  assert.equal(result.kvEvidence.bodyFixtures.size, 0, 'acquired read bodies must be closed on every outcome');
  cases++;
  return { body:JSON.parse(result.response.body), calls, result };
}
const create = (key, value = null) => ({operation:'create',key,value});
const get = key => ({operation:'get',key});
const cas = (key, generation, value = null) => ({operation:'cas',key,generation,value});
const zero = vectors.tokens[0].token;
const a = authority();
assert.deepEqual(run(get('missing'),a).body,{status:'not-found'});
assert.deepEqual(run(cas('missing',zero),a).body,{status:'conflict'});
assert.deepEqual(run(create('key'),a).body,{status:'stored'});
const observed = run(get('key'),a).body;
assert.equal(observed.value,null);
assert.deepEqual(run(cas('key',observed.generation),a).body,{status:'stored'});
assert.notEqual(run(get('key'),a).body.generation,observed.generation);
assert.deepEqual(run(cas('key',observed.generation),a).body,{status:'conflict'});
for (const operation of ['create-race','cas-race']) {
  const generation = operation === 'cas-race' ? run(get('race'),a).body.generation : undefined;
  const result = run({operation,key:'race',generation},a);
  assert.deepEqual(Object.values(result.body).map(x=>x.status).sort(),['conflict','conflict','stored']);
  assert.equal(result.calls.filter(x=>x.stage==='insert').length,3);
}
function permutations(xs) { return xs.length ? xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>i!==j)).map(t=>[x,...t])) : [[]]; }
for (const order of permutations([1,2,3])) {
  const key='race-'+order.join('');
  assert.deepEqual(order.map(writer=>run(create(key,{writer}),a).body.status).sort(),['conflict','conflict','stored']);
  const generation=run(get(key),a).body.generation;
  assert.deepEqual(order.map(writer=>run(cas(key,generation,{writer}),a).body.status).sort(),['conflict','conflict','stored']);
}
// Reads snapshot both metadata and bytes. A stale paired observation never permits
// a replacement against the authority's newer generation.
const stale={wire:codec.encodeConditionalKvValue({revision:0}),generation:2n};
a.seed('catalog','stale',codec.encodeConditionalKvValue({revision:1}),3n);
const staleRead=run(get('stale'),a,{onCall:s=>s==='lookup'?{observation:stale}:undefined}).body;
assert.equal(staleRead.value.revision,0);
assert.deepEqual(run(cas('stale',staleRead.generation),a).body,{status:'conflict'});
for (const row of vectors.tokens) {
  const store=authority(); store.seed('catalog','token',codec.encodeConditionalKvValue({n:1}),row.decimal);
  const r=run({operation:'round-trip',key:'token',value:{n:2}},store);
  assert.equal(r.body.before.generation,row.token); assert.deepEqual(r.body.result,{status:'stored'});
  const sent=r.calls.find(x=>x.stage==='insert').data;
  assert.equal(sent.condition,BigInt(row.decimal)); assert.equal(sent.mode,0); assert.equal(sent.mask,32);
  assert.equal(sent.config.subarray(24).toString('hex'),row.littleEndian);
  assert.deepEqual(sent.config.subarray(0,24),Buffer.alloc(24));
}
const add=run(create('add')); const sent=add.calls.find(x=>x.stage==='insert').data;
assert.equal(sent.mode,1); assert.equal(sent.mask,0); assert.equal(sent.condition,undefined);
assert.deepEqual(sent.config.subarray(4),Buffer.alloc(28));
for(const token of [...vectors.invalidTokens,...vectors.invalidFastlyTokens]) {
  const r=run(cas('key',token)); assert.deepEqual(r.body,{status:'not-stored',reason:'invalid-generation'});
  assert.equal(r.calls.some(x=>x.stage==='open'||x.stage==='insert'),false);
}
for(const key of ['',42,'\ud800','\udc00','\u0080','x'.repeat(1025),'雪'.repeat(342),'#','..','x?y','x^y','x|y','x;y','.well-known/acme-challenge/a']) {
  const r=run(create(key)); assert.deepEqual(r.body,{status:'not-stored',reason:'invalid-key'});
  assert.equal(r.calls.some(x=>x.stage==='open'||x.stage==='insert'),false);
}
for (const key of ['x'.repeat(1024),'雪'.repeat(341),'[key]*','é/é','/valid/path']) assert.deepEqual(run(create(key)).body,{status:'stored'});
for (const row of vectors.outcomes.filter(x=>x.input.kvError!==undefined)) {
  const command=row.input.operation==='compareAndSwap'?cas('outcome',zero):create('outcome');
  const r=run(command,authority(),{onCall:stage=>stage==='insert'?{kvError:row.input.kvError}:stage==='insert_wait'?{status:row.input.hostStatus,kvError:row.input.kvError}:undefined});
  assert.deepEqual(r.body,row.expected,row.id);
  assert.equal(r.calls.filter(x=>x.stage==='insert').length,1);
}
for (const row of vectors.readOutcomes.filter(x=>!x.input.bodyFailure&&!x.input.state)) {
  const r=run(get('outcome'),authority(),{onCall:stage=>stage==='lookup_wait_v2'?{status:row.input.hostStatus,kvError:row.input.kvError}:undefined});
  assert.deepEqual(r.body,row.expected,row.id);
}
// Both directions use each target's production codec against the other's bytes.
const values=[...vectors.wire.map(x=>x.value), '\ud800', '\udfff', '😀雪', '\u0000'.repeat(10922), 'x'.repeat(65534), [false,0,-0,1e-7,1e20,1e21,1e100,Number.MAX_VALUE]];
for(const [i,value] of values.entries()) {
  const key='wire-'+i, store=authority(); store.seed('catalog',key,codec.encodeConditionalKvValue(value),7n);
  assert.deepEqual(run(get(key),store).body.value,JSON.parse(JSON.stringify(value)));
  assert.deepEqual(run(create(key+'-native',value),store).body,{status:'stored'});
  assert.deepEqual(codec.decodeConditionalKvValue(store.get('catalog',key+'-native').wire),JSON.parse(JSON.stringify(value)));
}
const numericBudget={numbers:Array(1000).fill(1e20),padding:''};
numericBudget.padding='x'.repeat(65536-Buffer.byteLength(JSON.stringify(numericBudget)));
const numericStore=authority();
assert.deepEqual(run(create('numeric-budget',numericBudget),numericStore).body,{status:'stored'});
assert.deepEqual(run(get('numeric-budget'),numericStore).body.value,numericBudget);
assert.deepEqual(run(create('numeric-over-budget',{...numericBudget,padding:numericBudget.padding+'x'})).body,{status:'not-stored',reason:'too-large'});
// Exact value depth/entry limits include transport wrappers without charging
// those wrappers to the application's KV value budget.
let deep=0; for(let i=0;i<64;i++) deep=[deep];
for(const value of [deep,Array(9999).fill(null)]) {
  const store=authority();store.seed('catalog','bounds',codec.encodeConditionalKvValue(value),1n);
  assert.deepEqual(run(get('bounds'),store).body.value,value);
  assert.deepEqual(run(create('bounds-write',value),store).body,{status:'stored'});
}
assert.deepEqual(run(create('depth65',[deep])).body,{status:'not-stored',reason:'too-large'});
const prefix=JSON.stringify(create('unicode-boundary','')).split('\"value\":\"')[0]+'\"value\":\"';
const chunked=authority(), acrossChunk='x'.repeat(65535-Buffer.byteLength(prefix))+'雪😀';
assert.deepEqual(run(create('unicode-boundary',acrossChunk),chunked).body,{status:'stored'});
assert.equal(codec.decodeConditionalKvValue(chunked.get('catalog','unicode-boundary').wire),acrossChunk);
for(const value of ['x'.repeat(65535),Array(10000).fill(null)]) assert.deepEqual(run(create('large',value)).body,{status:'not-stored',reason:'too-large'});
const invalidWires=[...vectors.invalidWire, '{"__pulseKv":"1","value":0}', '{"__pulseKv":1,"value":01}', '{"__pulseKv":1,"value":[0,]}', Buffer.from([0xc0,0xaf]), Buffer.from([0xed,0xa0,0x80])];
for(const wire of invalidWires) {
  const store=authority(); store.seed('catalog','bad',wire,1n);
  assert.deepEqual(run(get('bad'),store).body,{status:'failed',reason:'protocol'});
}
for(const [wire,reason] of [
  ['{"__pulseKv":1,"value":1e999}','invalid-value'],
  ['{"__pulseKv":1,"value":'+JSON.stringify('x'.repeat(65535))+'}','too-large'],
  [' '.repeat(65561),'too-large'],
  ['{"__pulseKv":1,"value":'+'['.repeat(66)+'0'+']'.repeat(66)+'}','too-large']
]) { const store=authority();store.seed('catalog','bad',wire,1n);assert.deepEqual(run(get('bad'),store).body,{status:'failed',reason}); }
const reordered=authority(); reordered.seed('catalog','wire',' { "value" : {"n":1.0}, "__pulseKv":1e0 } ',1n);
assert.deepEqual(run(get('wire'),reordered).body.value,{n:1});
// Failures before send never call insert. After send, the authority can already
// contain the candidate even when the complete acknowledgement is lost.
for(const [stage,fault,expected] of [
  ['open',{status:1},{status:'not-stored',reason:'configuration'}],
  ['open',{delayMs:10000},{status:'not-stored',reason:'timeout'}],
  ['body_new',{status:1},{status:'not-stored',reason:'transport'}],
  ['body_write',{written:1},{status:'not-stored',reason:'protocol'}],
  ['body_write',{delayMs:10000},{status:'not-stored',reason:'timeout'}],
  ['insert',{status:1,commit:true},{status:'unknown',reason:'transport'}],
  ['insert',{readyDelayMs:10001},{status:'unknown',reason:'timeout'}],
  ['insert_wait',{status:1,kvError:1},{status:'unknown',reason:'transport'}],
  ['insert_wait',{delayMs:10000,kvError:4},{status:'unknown',reason:'timeout'}],
  ['select',{status:1},{status:'unknown',reason:'transport'}],
  ['select',{readyIndex:3},{status:'unknown',reason:'protocol'}]
]) {
  const store=authority(), r=run(create('lifecycle'),store,{onCall:s=>s===stage?fault:undefined});
  assert.deepEqual(r.body,expected,stage);
  assert.equal(Boolean(store.get('catalog','lifecycle')),expected.status==='unknown');
  if(expected.status==='not-stored') assert.equal(r.calls.some(x=>x.stage==='insert'),false);
  if(stage==='insert'&&fault.readyDelayMs) assert.equal(r.calls.some(x=>x.stage==='insert_wait'),false);
}
const expired=run(create('expired'),authority(),{deadlineNs:0n});
assert.deepEqual(expired.body,{status:'not-stored',reason:'timeout'});
assert.equal(expired.calls.some(x=>x.stage==='open'||x.stage==='insert'),false);
const shortened=run(create('deadline'),authority(),{deadlineNs:5000000n,onCall:s=>s==='insert'?{readyDelayMs:6}:undefined});
assert.deepEqual(shortened.body,{status:'unknown',reason:'timeout'});
assert.equal(shortened.calls.find(x=>x.stage==='select').data.timeout,5);
for (const [stage,fault,reason] of [
  ['lookup',{readyDelayMs:10001},'timeout'],['lookup_wait_v2',{bodyDelayMs:10001},'timeout'],
  ['lookup_wait_v2',{metadataLength:2001},'protocol'],['lookup_wait_v2',{metadataLength:2000},null],
  ['body_read',{status:1},'transport'],['body_read',{written:-1},'protocol'],['body_read',{delayMs:10000},'timeout']
]) {
  const store=authority();store.seed('catalog','read',codec.encodeConditionalKvValue(null),1n);
  const r=run(get('read'),store,{onCall:s=>s===stage?fault:undefined});
  if(reason) assert.deepEqual(r.body,{status:'failed',reason}); else assert.equal(r.body.status,'found');
}
for(const stage of ['open','insert','insert_wait']) {
  const controller=new AbortController(), store=authority();
  assert.throws(()=>run(create('cancel'),store,{signal:controller.signal,onCall:s=>{if(s===stage)controller.abort(new Error('cancelled'));}}),/cancelled/);
  assert.equal(Boolean(store.get('catalog','cancel')),stage!=='open');
}
const zeroHandles=run(create('zero-handles'),authority(),{handleStarts:{body:0,kvStore:0,kvInsert:0}});
assert.deepEqual(zeroHandles.body,{status:'stored'});
// No candidate, key or generation enters returned diagnostic traces.
const privateStore=authority();privateStore.seed('catalog','private-key',codec.encodeConditionalKvValue('private-value'),99n);
const privateResult=run({operation:'round-trip',key:'private-key',value:'private-next'},privateStore);
for(const secret of ['private-key','private-value','private-next',privateResult.body.before.generation]) assert.equal(JSON.stringify(privateResult.result.trace).includes(secret),false);

const detached=compile(`export default async function handler(ctx) {
  const candidate={count:1};
  const stored=await ctx.kv('catalog').insertIfAbsent('detached',candidate);
  candidate.count=2;
  const found=await ctx.kv('catalog').getVersioned('detached');
  return ctx.json({stored,found,candidate});
}`, 'kv-detached.ts');
const detachedResult=run({},authority(),{},detached).body;
assert.equal(detachedResult.candidate.count,2);
assert.equal(detachedResult.found.value.count,1);
const immutable=compile(`export default async function handler(ctx) {
  const found=await ctx.kv('catalog').getVersioned('immutable');
  if(found.status==='found') found.value.count=2;
  return ctx.json(found);
}`, 'kv-immutable.ts');
const frozenStore=authority();frozenStore.seed('catalog','immutable',codec.encodeConditionalKvValue({count:1}),1n);
assert.throws(()=>run({},frozenStore,{},immutable),error=>error.detail?.lastError===1001,'read values are immutable in the actual Native heap');

const logging=compile(`export default async function handler(ctx) {
  const command=await ctx.req.json();
  const stored=await ctx.kv('catalog').insertIfAbsent(command.key,command.value);
  const found=await ctx.kv('catalog').getVersioned(command.key);
  ctx.log.error('candidate: '+command.value);
  ctx.log.error('observed: '+found);
  return ctx.json(stored);
}`, 'kv-private-logs.ts');
const privateValue={text:'private\\nvalue',quote:'private"value',slash:'private\\\\value'};
privateValue.newline='private'+String.fromCharCode(10)+'value';
const logged=run(create('private-log-key',privateValue),authority(),{},logging);
assert.ok(logged.result.logs.length>0);
const logText=logged.result.logs.map(x=>x.message).join('');
assert.ok(logText.includes('<redacted>'));
for(const value of Object.values(privateValue)) {
  assert.equal(logText.includes(value),false);
  assert.equal(logText.includes(JSON.stringify(value).slice(1,-1)),false);
}
assert.equal(logText.includes('fastly-kv-v1:'),false);
// Native capability promotion must leave JavaScript's incomplete mapping explicit.
const jsPolicy=require('../../../packages/provider-fastly/src/javascript/target-support-policy');
for(const kind of codec.KV_CONDITIONAL_KINDS) {
  assert.equal(jsPolicy.classifyFastlyJavascriptCapability(kind).reasonId,'fastly-conditional-kv-incomplete');
  assert.equal(jsPolicy.classifyFastlyJavascriptProviderRequirement(kind).status,'blocked');
}
console.log(`ok - K3 actual Fastly Native Wasm: ${cases} corpus cases, u64 ABI fidelity, shared wire, races, snapshots, bounded waits and uncertainty (no deployed-service claim)`);
