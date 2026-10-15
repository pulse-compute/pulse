'use strict';
// MEM9-07: actual Wasm against the boxed emitter, with test-only observations
// and narrowed counters. No production option can select these limits/hooks.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { generateCanonicalNativeAssemblyScript: generate } = require('../../packages/runtime-core-as/src/compiler/canonical-native');
const { POLICY, LINKED_POLICY, HOST_POLICY } = require('../../packages/runtime-core-as/src/compiler/canonical-native-numeric');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const budget = require('../../../packages/provider-fastly/src/build/native-value-budget');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { createConditionalKvAuthority } = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
const { withBoxedControl } = require('../support/numeric-region-control.cjs');
const { schemaBundle } = require('./assert-fastly-numeric-regions.cjs');
const options = { canonicalBuild: true, requirePlatformCapability: false, emitWat: false,
  bindings: { kv: { pages: 'pages' } } };
const body = `let output='';
  for(let page=0;page<3;page++) {
    const row=await ctx.kv('pages').getVersioned('p');
    let n=70000;let alias=n;let edge=65534;let fraction=0.25;
    let neg=0;let nan=1;let inf=1;let truth=0;
    for(let i=0;i<8;i++) {
      if(i===2) continue;
      for(let j=0;j<8;j++) {n+=0.25;if(j===5)break;}
      edge++;fraction=-fraction;neg=0*-1;nan=0/0;inf=1/0;
      n = i!==4 ? n+1 : n-1;
      if(nan){truth+=100;}else{truth+=1;}
      if(!nan){truth+=2;}if(inf){truth+=4;}
    }
    let zero=12;for(let z=0;z<0;z++){zero+=1;}
    const saved={n,alias,edge,fraction,neg:1/neg<0,nan:nan!==nan,inf:inf>0,truth,zero};
    n=90000;for(let k=0;k<4;k++){n++;}
    await ctx.kv('pages').getVersioned('next');
    output+=''+saved.n+':'+saved.alias+':'+saved.edge+':'+saved.fraction+':'+saved.neg+':'+saved.nan+':'+saved.inf+':'+saved.truth+':'+saved.zero+':'+n+';';
  }
  return ctx.text(output);`;
function planFor(schema = false, source = body) {
  return buildCanonicalNativePlan(compileCanonicalSource(`export default async function handler(ctx){${schema ? "await ctx.req.json('proof.Input');" : ''}${source}}`,
    { fileName: 'numeric-budget.ts', strict: false, target: 'native', ...(schema ? { schemaBundle } : {}) }));
}
function observedBuild(plan, boxed = false, limits, buildOptions = options) {
  const original = budget.instrument;
  budget.instrument = (source, p) => {
    let result = original(source, p);
    if (limits) {
      const current = budget.runtimeSource();
      assert.equal(result.split(current).length, 2);
      result = result.replace(current, budget.runtimeSource({ ...budget.policy, ...limits }));
    }
    result += '\nexport function mem9_handles():i32{return __pulse_fastly_values.length;}\n';
    if (result.includes('function __pulse_numeric_box(')) result += `
      export function mem9_fail():void{__pulse_memory_charge(${budget.policy.maxValues},0);}
      export function mem9_cached():f64{return __pulse_numeric_charge_number(1.0);}
      export function mem9_box():i32{return __pulse_numeric_box(70000.0);}
    `;
    return result;
  };
  try { return boxed ? withBoxedControl(p => p.compileFastlyNativePlatformCapabilitiesPlan(plan, buildOptions))
    : platform.compileFastlyNativePlatformCapabilitiesPlan(plan, buildOptions); }
  finally { budget.instrument = original; }
}
function run(artifact, extra = {}) {
  const authority = createConditionalKvAuthority(); authority.stores.set('pages', new Map());
  return execute(artifact, { clockUnixSeconds: 1700000000, request: { method: 'POST', body: '{"n":1}' }, conditionalKv: { authority, ...extra } });
}
function outcome(artifact, extra) {
  try {
    const r = run(artifact, extra), e = r.instance.exports;
    return { response: r.response, trace: r.trace, outboundRequests: r.outboundRequests,
      bytes: Number(e.pulse_fastly_memory_bytes()), values: Number(e.pulse_fastly_memory_values()) };
  } catch (e) { assert.equal(e.code, 'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED'); return { code: e.code, detail: e.detail }; }
}
function ownerParity() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-numeric-budget-owners-'));
  try {
    require('./assert-fastly-numeric-owners.cjs').writeOwnerProject(cwd);
    const file = path.join(cwd, 'src/terminal.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('const input=',
      "for(let page=0;page<2;page++){await ctx.kv('pages').getVersioned('p');}const input="));
    const tc = require('../s3/acceptance-toolchain.cjs').acceptanceToolchain();
    const { plan } = tc.compileNativeProjectInMemory(tc.resolveProject({ cwd, profile: 'node' }), { reportCapture: false, emitWat: false });
    const buildOptions = { ...options, bindings: { ...options.bindings, backends: { 'https://numeric-owner.test': 'numeric' } } };
    const artifacts = [observedBuild(plan, false, undefined, buildOptions), observedBuild(plan, true, undefined, buildOptions)];
    const paths = artifacts[0].manifest.numericRegions.regions.flatMap(r => r.statementPaths);
    assert(paths.some(p => p.startsWith('helpers.')));
    assert.equal(plan.stages.length, 2);
    for (const stage of plan.stages) assert(stage.body.some(s => paths.includes(s.statementPath)));
    for (const route of ['/', '/other']) for (const body of ['ok', 'stop']) {
      const outcomes = artifacts.map(artifact => {
        const authority = createConditionalKvAuthority(); authority.stores.set('pages', new Map());
        const r = execute(artifact, { clockUnixSeconds: 1700000000, request: { method: 'POST', path: route, body: '{"n":1}' }, conditionalKv: { authority },
          fixtures: { 'https://numeric-owner.test/a': { body, status: 200 }, 'https://numeric-owner.test/b': { body: 'ok', status: 200 } } });
        return { response: r.response, trace: r.trace, outboundRequests: r.outboundRequests,
          values: r.instance.exports.pulse_fastly_memory_values(), bytes: r.instance.exports.pulse_fastly_memory_bytes() };
      });
      assert.deepEqual(outcomes[0], outcomes[1], 'repeated helper/stage calls keep cache, charges, aliases and transfer semantics');
    }
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
async function main() {
  const rows = [];
  for (const schema of [false, true]) {
    const plan = planFor(schema), portable = generate(plan), numeric = generate(plan, { numericRegions: POLICY });
    assert.equal(numeric.manifest.numericRegions.accounting, 'fastly-read-loop-v1');
    assert(numeric.manifest.numericRegions.regions.length >= 2);
    const shape = g => g.blocks.map(({ lines, ...b }) => b);
    assert.deepEqual(shape(numeric), shape(portable));
    assert.equal(numeric.manifest.guardStateCount, portable.manifest.guardStateCount);
    for (const policy of [LINKED_POLICY, HOST_POLICY]) {
      const declined = generate(plan, { numericRegions: policy });
      assert.equal(declined.manifest.numericRegions.enabled, false); assert.equal(declined.source, portable.source);
    }
    for (const cap of ['response.output', 'request.body.transform']) {
      const mixed = { ...plan, capabilities: [...plan.capabilities, cap] };
      assert.equal(generate(mixed, { numericRegions: POLICY }).source, generate(mixed).source);
    }
    const a = observedBuild(plan), b = observedBuild(plan, true);
    const expected = outcome(b); assert.deepEqual(outcome(a), expected);
    const ra = run(a), rb = run(b), ea = ra.instance.exports, eb = rb.instance.exports;
    const handler = new Function(`return async function(ctx){${body}}`)();
    assert.equal(ra.response.body, await handler({ kv: () => ({ getVersioned: async () => ({ status: 'not-found' }) }), text: x => x }));
    assert(ea.mem9_handles() < eb.mem9_handles());
    assert.throws(() => ea.memory.grow(budget.policy.maximumMemoryPages + 1), RangeError);
    assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(a.wasm)), WebAssembly.Module.imports(new WebAssembly.Module(b.wasm)));
    for (const extra of [{ onCall(stage) { if (stage === 'lookup') return { readyDelayMs: 100000 }; } },
      { onCall(stage) { if (stage === 'lookup') return { status: 1 }; } }]) assert.deepEqual(outcome(a, extra), outcome(b, extra));
    assert.deepEqual(outcome(a), expected, 'fresh invocation after failed/deadline execution');
    const before = [ea.pulse_fastly_memory_values(), ea.pulse_fastly_memory_bytes(), ea.mem9_handles()];
    assert.throws(() => ea.mem9_fail(), WebAssembly.RuntimeError);
    assert.throws(() => ea.mem9_cached(), WebAssembly.RuntimeError);
    assert.throws(() => ea.mem9_box(), WebAssembly.RuntimeError);
    assert.deepEqual([ea.pulse_fastly_memory_values(), ea.pulse_fastly_memory_bytes(), ea.mem9_handles()], before);
    rows.push({ schema, values: expected.values, bytes: expected.bytes, boxedHandles: eb.mem9_handles(), numericHandles: ea.mem9_handles() });
  }
  // Cross the real policy limit through repeated visits; fail before the next
  // effect and response. The same code with small limits isolates byte/value
  // exhaustion at intermediate expression points (including cache admissions).
  const stress = planFor(false, `for(let page=0;page<16;page++){await ctx.kv('pages').getVersioned('p');let n=70000;for(let i=0;i<16;i++){for(let j=0;j<256;j++){${'n+=0.25;'.repeat(9)}}}}return ctx.text('unexpected');`);
  const limitsCases = [undefined, { maxValues: 120 }, { maxBytes: 3800 }, { maxValues: 500 }];
  for (const limits of limitsCases) {
    const plan = limits ? planFor() : stress;
    const a = observedBuild(plan, false, limits), b = observedBuild(plan, true, limits);
    const actual = outcome(a), expected = outcome(b);
    assert.equal(actual.code, 'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED');
    assert.deepEqual(actual, expected, 'exact counters, failure stage and effect/resource trace at exhaustion');
    assert(!actual.detail.trace.some(t => t.module === 'fastly_http_resp' && t.name === 'send_downstream'));
    rows.push({ limits: limits || 'production', errorStage: actual.detail.errorStage, values: actual.detail.values, bytes: actual.detail.bytes });
  }
  ownerParity();
  console.log(JSON.stringify({ task: 'MEM9-07', status: 'passed', providerReality: false, rows }));
}
module.exports = { main };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
