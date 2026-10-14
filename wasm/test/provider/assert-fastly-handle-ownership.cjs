'use strict';
const assert = require('node:assert/strict');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { generateCanonicalNativeAssemblyScript: generate } = require('../../packages/runtime-core-as/src/compiler/canonical-native');
const { prepareHandleOwnership } = require('../../packages/runtime-core-as/src/compiler/canonical-native-ownership');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const ownership = require('../../../packages/provider-fastly/src/build/native-handle-ownership');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { withRetainedHandles } = require('../support/handle-ownership-control.cjs');
const { schemaBundle } = require('./assert-fastly-numeric-regions.cjs');
const options = { canonicalBuild: true, requirePlatformCapability: false, emitWat: false };
function assertDiagnosticObserver() {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const mem = require('../runtime/compiler-efficiency/mem01-schema-materialization.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-handle-observer-'));
  try {
    for (const retained of [false, true]) {
      const artifact = build(planFor(retentionBody), { retained });
      const wasm = mem.diagnosticCompile(mem.instrument(artifact.source), 'staged', path.join(directory, String(retained)));
      const probe = mem.observer();
      const result = mem.diagnosticHost()({ ...artifact, wasm }, { clockUnixSeconds: 1700000000,
        request: { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body: '{"n":32}' }, mem01: probe });
      assert.deepEqual(result.response, run(artifact, 32).response);
      const table = probe.table(), e = result.instance.exports;
      assert.equal(table.handles, e.mem01_count());
      if (!retained) assert(table.handles < 500 && e.mem01_last() > table.handles * 50,
        'sparse diagnostic enumeration skips removed IDs without guest allocation');
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function planFor(body, schema = true) {
  return buildCanonicalNativePlan(compileCanonicalSource(`export default async function handler(ctx){${schema ? "const input=await ctx.req.json('proof.Input');" : ''}${body}}`,
    { fileName: 'handle-ownership.ts', strict: false, target: 'native', ...(schema ? { schemaBundle } : {}) }));
}
function build(plan, { retained = false, observed = false, force = false, interval = 1024, elideJsonCacheArena = false } = {}) {
  const original = ownership.tableSource;
  if (observed || force || interval !== 1024) ownership.tableSource = enabled => {
    let source = original(enabled);
    if (enabled && interval !== 1024) source = source.replace('let __pulse_handle_interval: i32 = 1024', `let __pulse_handle_interval: i32 = ${interval}`)
      .replace('max<i32>(1024, __pulse_fastly_values.size)', `max<i32>(${interval}, __pulse_fastly_values.size)`);
    if (observed && enabled) source = 'let __mem9_peak_capacity: i32 = 0\nlet __mem9_peak_scratch: i32 = 0\nlet __mem9_sweeps: i32 = 0\n' + source.replace('__pulse_handle_allocations++',
      "__pulse_handle_allocations++; __mem9_peak_capacity = max<i32>(__mem9_peak_capacity, load<i32>(changetype<usize>(__pulse_fastly_values) + offsetof<Map<i32, __PulseFastlyValue>>('entriesCapacity')))")
      .replace('__pulse_fastly_values = __pulse_handle_survivors!', `
    // Payload bytes of the three tracing structures and their backing buffers.
    // Excludes allocator headers, old table and transient rehash copies; RTRACE
    // separately observes whole-artifact peak managed allocation.
    const survivors = __pulse_handle_survivors!
    const scratch = offsetof<Map<i32, __PulseFastlyValue>>() + offsetof<Set<__PulseFastlyValue>>() + offsetof<Array<__PulseFastlyValue>>()
      + changetype<ArrayBuffer>(load<usize>(changetype<usize>(survivors) + offsetof<Map<i32, __PulseFastlyValue>>('entries'))).byteLength
      + changetype<ArrayBuffer>(load<usize>(changetype<usize>(survivors) + offsetof<Map<i32, __PulseFastlyValue>>('buckets'))).byteLength
      + changetype<ArrayBuffer>(load<usize>(changetype<usize>(visited) + offsetof<Set<__PulseFastlyValue>>('entries'))).byteLength
      + changetype<ArrayBuffer>(load<usize>(changetype<usize>(visited) + offsetof<Set<__PulseFastlyValue>>('buckets'))).byteLength
      + load<i32>(changetype<usize>(work) + offsetof<Array<__PulseFastlyValue>>('byteLength'))
    __mem9_peak_scratch = max<i32>(__mem9_peak_scratch, scratch)
    __mem9_sweeps++
    __pulse_fastly_values = __pulse_handle_survivors!`);
    if (force && enabled) source = source.replace('let __pulse_handle_interval: i32 = 1024', 'let __pulse_handle_interval: i32 = 1')
      .replace('max<i32>(1024, __pulse_fastly_values.size)', '1');
    if (observed) source += `
export function mem9_count(): i32 { return __pulse_fastly_value_count() }
export function mem9_has(h: i32): bool { return __pulse_fastly_has_value(h) }
export function mem9_new(): i32 { return host_value_number(80000.25) }
export function mem9_read(h: i32): f64 { return __pulse_fastly_value(h).number }
export function mem9_gc(): void { __collect() }
${enabled ? `
export function mem9_next(): i32 { return __pulse_handle_next }
export function mem9_capacity(): i32 { return load<i32>(changetype<usize>(__pulse_fastly_values) + offsetof<Map<i32, __PulseFastlyValue>>('entriesCapacity')) }
export function mem9_peak_capacity(): i32 { return __mem9_peak_capacity }
export function mem9_peak_scratch(): i32 { return __mem9_peak_scratch }
export function mem9_pins(): i32 { return __pulse_handle_cache_roots.length }
export function mem9_sweeps(): i32 { return __mem9_sweeps }
export function mem9_sweep(): void { __pulse_handle_allocations = __pulse_handle_interval; __pulse_handle_checkpoint() }
export function mem9_overflow(): i32 { __pulse_handle_next = i32.MAX_VALUE; return __pulse_fastly_put(new __PulseFastlyValue()) }
export function mem9_graph(): i32 {
  const dead = host_value_object()
  host_value_object_set(dead, __pulse_fastly_string_value('cycle'), dead)
  const a = host_value_object(), b = host_value_object()
  host_value_object_set(a, __pulse_fastly_string_value('child'), b)
  host_value_object_set(b, __pulse_fastly_string_value('parent'), a)
  const alias = __pulse_fastly_put(__pulse_fastly_value(a))
  __pulse_result = host_value_array()
  host_value_array_push(__pulse_result, a)
  host_value_array_push(__pulse_result, alias)
  return dead
}
export function mem9_graph_valid(): bool {
  const root = __pulse_fastly_value(__pulse_result)
  const a = __pulse_fastly_value(root.values[0]), alias = __pulse_fastly_value(root.values[1])
  const b = __pulse_fastly_value(a.values[0])
  return a === alias && __pulse_fastly_value(b.values[0]) === a
}
export function mem9_bad_edge(): void { __pulse_fastly_value(__pulse_result).values.push(__pulse_handle_next + 1) }
export function mem9_cache(): i32 { return host_value_number(42.0) }
export function mem9_failed_cache_miss(): i32 { return host_value_number(12345.0) }
export function mem9_rope(): i32 {
  const child = __pulse_fastly_string_value('uncached rope child')
  __pulse_result = __pulse_fastly_concat(child, __pulse_fastly_string_value(' suffix'))
  return child
}
export function mem9_rope_valid(flatten: bool): bool {
  const value = __pulse_fastly_value(__pulse_result)
  return flatten ? value.text == 'uncached rope child suffix' : value.textLeft !== null && value.textLeaf == ''
}
export function mem9_headers(): i32 { return __pulse_request_headers_read() }
export function mem9_cache_valid(): bool {
  const pins = new Set<i32>()
  for (let i = 0; i < __pulse_handle_cache_roots.length; i++) {
    const h = __pulse_handle_cache_roots[i]
    if (pins.has(h) || !__pulse_fastly_has_value(h)) return false
    pins.add(h)
  }
  const caches = [__pulse_fastly_scalar_handles, __pulse_fastly_integer_handles, __pulse_fastly_character_handles]
  let count = 0
  for (let i = 0; i < caches.length; i++) for (let j = 0; j < caches[i].length; j++) {
    const h = caches[i][j]
    if (h != 0) { if (!pins.has(h)) return false; count++ }
  }
  const literal = __pulse_fastly_literal_handles.values()
  for (let i = 0; i < literal.length; i++) { if (!pins.has(literal[i])) return false; count++ }
  return count == pins.size && count <= 132101
}
` : ''}
`;
    return source;
  };
  const compile = p => p.compileFastlyNativePlatformCapabilitiesPlan(plan, { ...options, elideJsonCacheArena });
  try { return retained ? withRetainedHandles(compile) : compile(platform); }
  finally { ownership.tableSource = original; }
}
function run(artifact, n = 70000.25) {
  return execute(artifact, { clockUnixSeconds: 1700000000, request: { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body: JSON.stringify({ n }) } });
}
const lifetimeBody = `
let n=input.n; const alias=n; let old=n; let text=' first '; const saved=[];
const box={value:n}; const copy={...box}; const array=[box,copy];
const headers=ctx.req.headers; ctx.state.set('saved',text);
let steps=0; let rope='start';
for(let i=0;i<8;i++) {
  for(let j=0;j<8;j++) {
    if(j===1) continue;
    old=n++; box.value=n; saved[i]=old; steps++;
    text=(' '+n+' ').trim(); rope=rope+'x';
    if(j===5) break;
  }
}
let zero=0*-1; let nan=0/0; let inf=1/0;
let assigned=box; assigned=assigned; const assignment=(assigned=box); const empty=''+rope;
const encoded=ctx.encodeJson({n:box.value},'proof.Input');
return ctx.json({n,alias,old,text,steps,rope,empty,assignment,sameAssignment:assignment===assigned,first:rope[0],saved,copy,array,
  state:ctx.state.get('saved'),header:headers[0][1],
  same:box===array[0],borrowed:(false||box)===box,conditional:(true?box:copy)===box,
  negativeZero:1/zero<0,nan:nan!==nan,infinity:inf>0,encoded});`;
const prefix = 'fixed-working-set-'.repeat(9);
const retentionBody = `let n=70000.25;let text='';const box={value:n};
for(let outer=0;outer<32;outer++) {
 if(outer>=input.n) break;
 for(let i=0;i<128;i++){n+=0.25;box.value=n;text=('${prefix}'+n+' ').trim();}
}
return ctx.json({n,text,box});`;
function admission() {
  const plan = planFor('return ctx.json(input);');
  const base = { plan, policy: 'fastly-handle-tracing-v1', schemaActive: true, budgeted: false, expressions: [], eventReachable: false };
  assert.equal(prepareHandleOwnership(base).enabled, true);
  for (const change of [{policy:undefined},{schemaActive:false},{budgeted:true},{eventReachable:true},
    {expressions:[{kind:'new-owner'}]}, {expressions:[{kind:'pure-helper-call'}]},
    {expressions:[{kind:'intrinsic',name:'new-owner'}]}, {expressions:[{kind:'context-read',path:['event','payload']}]},
    {plan:{...plan,helpers:[{}]}}, {plan:{...plan,stages:[{}]}}, {plan:{...plan,effects:[{}]}},
    {plan:{...plan,capabilities:['new-owner']}}, {plan:{...plan,packages:{application:{}}}},
    {plan:{...plan,entry:{body:[{kind:'new-control'}]}}}, {plan:{...plan,entry:{body:[{kind:'continue'}]}}},
    {plan:{...plan,routing:{entries:[{kind:'error'}]}}}])
    assert.equal(prepareHandleOwnership({...base,...change}).enabled,false,JSON.stringify(change));
  const traced = generate(plan,{handleOwnership:'fastly-handle-tracing-v1'});
  ownership.validateRoots(plan,traced.manifest);
  for(const roots of [[], [...traced.manifest.handleOwnership.roots,'unknown-owner']])
    assert.throws(()=>ownership.validateRoots(plan,{...traced.manifest,handleOwnership:{...traced.manifest.handleOwnership,roots}}),/root descriptor/);
  const plain=generate(plan);
  for(const capability of ['response.output','request.body.transform']) {
    const p={...plan,capabilities:[...plan.capabilities,capability]};
    assert.equal(generate(p,{handleOwnership:'fastly-handle-tracing-v1'}).source,generate(p).source);
  }
  assert.equal(generate(plan).source,plain.source,'portable/Node generation remains unselected');
  const stub=platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(planFor("return ctx.text('ok');",false),options);
  assert.equal(stub.manifest.handleOwnership.enabled,false);
  assert.equal(stub.manifest.handleOwnership.reason,'collector-unavailable');
  // Adding an unclassified value field must force an owner audit. The visitor
  // never touches lazy getters; these are the complete stored fields today.
  const source=platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,options).source;
  const valueClass=source.split('class __PulseFastlyValue {')[1].split('class __PulseFastlyHeader')[0];
  const fields=[...valueClass.matchAll(/^  (?:private )?(\w+): [^\n=]+=/gm)].map(m=>m[1]).sort();
  assert.deepEqual(fields,['kind','boolean','number','textLeaf','textLeft','textRight','textLength','keysStorage','valuesStorage','responseHandle','bodyHandle','bodyLoaded','s3Body','s3Deadline','s3Length','status','headersStorage','binaryBody','immutable'].sort());
}
async function main() {
  admission();
  const plan = planFor(lifetimeBody);
  const generated = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options);
  assert.equal(generated.manifest.handleOwnership.enabled, true, JSON.stringify(generated.manifest.handleOwnership));
  const artifact = build(plan, { observed: true, force: true });
  const control = build(plan, { retained: true });
  for (const n of [70000.25,-3,0,9007199254740992]) {
    const result=run(artifact,n), retained=run(control,n);
    assert.deepEqual(result.response,retained.response);
    assert.deepEqual(result.trace,retained.trace);
    const state=new Map();
    const expected=await new Function('ctx',`return (async()=>{const input={n:${n}};${lifetimeBody}})()`)(
      {req:{headers:[['content-type','application/json']]},state,encodeJson:JSON.stringify,json:v=>v});
    const actual=JSON.parse(result.response.body);
    // Exact text is compared against the retained artifact above. AS and JS
    // intentionally use different f64 formatting for very large integers.
    actual.encoded=JSON.parse(actual.encoded);expected.encoded=JSON.parse(expected.encoded);
    actual.text=Number(actual.text);expected.text=Number(expected.text);
    assert.deepEqual(actual,expected);
  }
  const e=run(artifact).instance.exports, dead=e.mem9_graph(), cached=e.mem9_cache();
  e.mem9_sweep();e.mem9_gc();
  assert.equal(e.mem9_has(dead),0,'unreachable self-cycle reclaimed');
  assert.equal(e.mem9_graph_valid(),1,'mutual cycle/shared object/distinct IDs survive');
  assert.equal(e.mem9_cache(),cached,'cache roots survive');
  assert.equal(e.mem9_cache_valid(),1,'compact cache index is complete, unique and bounded');
  const rope=run(artifact).instance.exports,child=rope.mem9_rope();
  rope.mem9_sweep();rope.mem9_gc();
  assert.equal(rope.mem9_has(child),0,'direct rope edge preserves object without retaining old mapping');
  assert.equal(rope.mem9_rope_valid(false),1,'tracing does not flatten ropes');
  assert.equal(rope.mem9_rope_valid(true),1,'direct object edges survive managed GC');
  const headers=build(planFor("ctx.req.headers; return ctx.text('ok');"),{observed:true,force:true});
  const he=run(headers).instance.exports,header=he.mem9_headers();he.mem9_sweep();he.mem9_gc();
  assert.equal(he.mem9_has(header),1,'provider snapshot survives without a guest local alias');
  assert.equal(he.mem9_headers(),header);
  const fresh=e.mem9_new();assert(fresh>dead);e.mem9_sweep();assert.equal(e.mem9_has(fresh),0);
  const newer=e.mem9_new();assert(newer>fresh,'IDs never reused');
  e.mem9_bad_edge();const before=e.mem9_count();e.mem9_sweep();
  assert.equal(e.mem9_count(),before,'invalid edge aborts before publishing any removals');
  assert.equal(e.pulse_fastly_error_stage(),1);
  const stale=run(artifact).instance.exports,h=stale.mem9_new();stale.mem9_sweep();stale.mem9_read(h);
  assert.equal(stale.pulse_fastly_error_stage(),1);
  const overflow=run(artifact).instance.exports;assert.equal(overflow.mem9_overflow(),0);assert.equal(overflow.pulse_fastly_error_stage(),1);
  const pinsBeforeFailure=overflow.mem9_pins();
  for(let i=0;i<64;i++)assert.equal(overflow.mem9_failed_cache_miss(),0);
  assert.equal(overflow.mem9_pins(),pinsBeforeFailure,'failed cache insertions cannot accumulate zero pins');
  const rows=[];
  for(const elideJsonCacheArena of [false,true]) {
    const p=planFor(retentionBody),a=build(p,{observed:true,elideJsonCacheArena}),b=build(p,{observed:true,retained:true,elideJsonCacheArena});
    const cells=[];
    for(const iterations of [1,8,32]) {
      const x=run(a,iterations),y=run(b,iterations),ex=x.instance.exports;
      assert.deepEqual(x.response,y.response);
      ex.mem9_gc();
      cells.push({iterations,live:ex.mem9_count(),pins:ex.mem9_pins(),capacity:ex.mem9_capacity(),peakCapacity:ex.mem9_peak_capacity(),peakScratchPayloadBytes:ex.mem9_peak_scratch(),sweeps:ex.mem9_sweeps(),allocated:ex.mem9_next(),retained:y.instance.exports.mem9_count(),memoryBytes:ex.memory.buffer.byteLength});
    }
    assert(cells[2].retained>cells[0].retained*20);
    assert(cells.every(x=>x.live<2500 && x.peakCapacity<4000),'fixed working set bounds mappings and peak map capacity');
    assert(cells[2].live<cells[2].retained/10);
    rows.push({elideJsonCacheArena,cells});
  }
  // Snapshots are intentionally live. They must not be optimized into one box.
  const snapshots=build(planFor('const saved=[];let n=70000.25;for(let outer=0;outer<4;outer++){if(outer>=input.n)break;for(let i=0;i<128;i++){saved[outer*128+i]={n};n+=0.25;}}return ctx.json(saved);'),{force:true,observed:true});
  const liveSnapshots=[];
  for(const batches of [1,2,4]) {
    const result=run(snapshots,batches),e=result.instance.exports;
    assert.deepEqual(JSON.parse(result.response.body),Array.from({length:batches*128},(_,i)=>({n:70000.25+i*.25})));
    liveSnapshots.push({snapshots:batches*128,live:e.mem9_count(),pins:e.mem9_pins(),capacity:e.mem9_capacity(),peakScratchPayloadBytes:e.mem9_peak_scratch()});
  }
  assert(liveSnapshots[2].live>liveSnapshots[0].live*2,'legitimate live graphs grow with retained snapshots');
  assertDiagnosticObserver();
  console.log(JSON.stringify({task:'MEM9-09A',status:'passed',providerReality:false,rows,liveSnapshots}));
}
module.exports = { main, planFor, build, run, options, retentionBody, lifetimeBody };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
