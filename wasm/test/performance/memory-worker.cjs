'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));
const checkpoints = [1, 11, 41, 128, 256];
const shapes = { small: 'Ada', ascii: 'x'.repeat(4096), unicode: '雪😀"\\\n'.repeat(512) };
const scenarios = [
  { id: 'dispatch', fixture: 'minimal-request', mode: 'full', shape: 'small' },
  ...['small', 'ascii', 'unicode'].map(shape => ({ id: 'full-' + shape, fixture: 'schema-effect', mode: 'full', shape })),
  ...['small', 'ascii', 'unicode'].map(shape => ({ id: 'codec-' + shape, fixture: 'schema-effect', mode: 'codec', shape })),
  { id: 'full-small-unobserved', fixture: 'schema-effect', mode: 'full', shape: 'small', observe: false, yieldEach: false },
  { id: 'full-small-yield', fixture: 'schema-effect', mode: 'full', shape: 'small', observe: false, yieldEach: true },
  { id: 'instantiate', fixture: 'schema-effect', mode: 'instantiate', shape: 'small' },
];
const snapshot = () => ({ ...process.memoryUsage() });
function load(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'pulse-build.json')));
  return { wasm: fs.readFileSync(path.join(directory, manifest.portable.wasm.file)), plan: JSON.parse(fs.readFileSync(path.join(directory, manifest.portable.plan))) };
}
// Process-local diagnostics only. No strong instance/memory/export references
// escape into receipts. WeakRef enumeration happens only after yielding; a yield
// also precedes every GC so deref's current-job liveness cannot skew collection.
function observer() {
  const Original = WebAssembly.Instance, records = [], phases = [];
  let request = 0;
  const mark = (phase, bytes = null, detail = {}) => {
    if (request === 1) phases.push({ phase, ...detail, memory: snapshot(), guestMemoryBytes: bytes });
  };
  WebAssembly.Instance = new Proxy(Original, { construct(Target, args) {
    const instance = Reflect.construct(Target, args), memory = instance.exports.memory;
    const record = { initialBytes: memory.buffer.byteLength, maxObservedBytes: memory.buffer.byteLength, memory: new WeakRef(memory) };
    records.push(record);
    mark('afterInstantiate', record.initialBytes);
    const exports = Object.fromEntries(Object.entries(instance.exports).map(([name, value]) => [name, typeof value !== 'function' ? value : function(...values) {
      const result = value(...values);
      record.maxObservedBytes = Math.max(record.maxObservedBytes, memory.buffer.byteLength);
      if (['__new', 'pulse_schema_decode', 'pulse_schema_encode', 'pulse_start', 'pulse_set_effect_result', 'pulse_resume'].includes(name)) mark('afterExport:' + name, memory.buffer.byteLength,
        name.startsWith('pulse_schema_') ? { schemaIndex: values[0] } : {});
      return result;
    }]));
    return new Proxy(instance, { get(target, property) { return property === 'exports' ? exports : Reflect.get(target, property, target); } });
  } });
  return {
    phases, setRequest(value) { request = value; }, mark,
    lastBytes() { return records.at(-1)?.maxObservedBytes ?? null; },
    count() { return records.length; },
    census() {
      let liveMemories = 0, liveLinearCapacityBytes = 0;
      for (const row of records) { const memory = row.memory.deref(); if (memory) { liveMemories++; liveLinearCapacityBytes += memory.buffer.byteLength; } }
      return { instancesCreated: records.length, liveMemories, liveLinearCapacityBytes,
        perInstanceInitialBytes: records.map(r => r.initialBytes), perInstanceMaxObservedBytes: records.map(r => r.maxObservedBytes) };
    },
    restore() { WebAssembly.Instance = Original; },
  };
}
async function collect() { for (let i = 0; i < 3; i++) { await tick(); global.gc(); } await tick(); }
async function run(directory, scenarioId, gcMode) {
  const scenario = scenarios.find(row => row.id === scenarioId); assert(scenario);
  assert(['natural', 'forced'].includes(gcMode)); assert.equal(typeof global.gc, gcMode === 'forced' ? 'function' : 'undefined');
  const result = { scenario: scenarioId, gcMode, execArgv: process.execArgv, beforeLoad: snapshot(), checkpoints: [], disposalCount: 0 };
  const compiled = load(directory);
  const { executeCanonicalNativeModule, instantiateCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
  const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
  let module = new WebAssembly.Module(compiled.wasm);
  result.abi = { imports: WebAssembly.Module.imports(module), exports: WebAssembly.Module.exports(module), planHash: compiled.plan.planHash };
  module = null; // Do not intentionally retain an inventory-only module.
  result.afterLoad = snapshot();
  const observed = scenario.observe !== false;
  const watch = observed ? observer() : { phases: [], setRequest() {}, mark() {}, lastBytes() { return null; }, census() { return null; }, restore() {} };
  const name = shapes[scenario.shape];
  const request = scenario.fixture === 'minimal-request' ? { method: 'GET', path: '/' } : {
    method: 'POST', path: '/', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, ignored: true }) };
  result.payload = { utf16Units: name.length, requestBytes: Buffer.byteLength(request.body || '') };
  async function invoke() {
    const original = createNodeProviderAdapter({ fetches: { 'https://origin.example.test/value': { status: 200, value: { score: 7, ignored: true } } } });
    const adapter = { ...original, disposeExecution(...args) {
      original.disposeExecution?.(...args); result.disposalCount++;
      watch.mark('afterProviderDisposal', watch.lastBytes());
    } };
    if (scenario.mode === 'full') {
      const returned = await executeCanonicalNativeModule(compiled, { request: structuredClone(request), providerAdapter: adapter });
      assert.equal(returned.response.status, 200);
      assert.deepEqual(JSON.parse(returned.response.body), scenario.fixture === 'minimal-request' ? { ok: true } : { name, score: 7 });
      assert.equal(returned.effectCount, scenario.fixture === 'minimal-request' ? 0 : 1);
      watch.mark('afterReturn', watch.lastBytes());
    } else {
      const controller = instantiateCanonicalNativeModule(compiled, { request: structuredClone(request), providerAdapter: adapter });
      try {
        if (scenario.mode === 'codec') {
          const input = controller.schemaCodecs.decodeJsonText('bench.Input', request.body);
          const origin = controller.schemaCodecs.decodeJsonText('bench.Origin', '{"score":7,"ignored":true}');
          const body = controller.schemaCodecs.encodeJsonText('bench.Output', { name: input.name, score: origin.score });
          assert.deepEqual(JSON.parse(body), { name, score: 7 });
          assert.deepEqual(controller.schemaCodecs.decodeJsonText('bench.Output', body), { name, score: 7 });
        }
      } finally { controller.close(); watch.mark('afterControllerClose', watch.lastBytes()); }
    }
  }
  try {
    for (let n = 1; n <= checkpoints.at(-1); n++) {
      watch.setRequest(n); await invoke();
      if (scenario.yieldEach !== false) await tick();
      if (checkpoints.includes(n)) {
        // A macrotask permits completed async stacks and Wasm roots to die.
        await tick();
        const beforeGc = { memory: snapshot(), guests: watch.census() };
        let afterGc = null;
        if (gcMode === 'forced') { await collect(); afterGc = { memory: snapshot(), guests: watch.census() }; }
        result.checkpoints.push({ requests: n, beforeGc, afterGc });
      }
    }
    result.phases = watch.phases;
    if (observed) assert.equal(watch.count(), checkpoints.at(-1));
    assert.equal(result.disposalCount, scenario.mode === 'full' ? checkpoints.at(-1) : 0);
    result.status = 'passed'; return result;
  } finally { watch.restore(); }
}
if (require.main === module) {
  assert.equal(process.argv.length, 6);
  run(process.argv[2], process.argv[3], process.argv[4]).then(result => fs.writeFileSync(process.argv[5], JSON.stringify(result) + '\n')).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { run, scenarios, shapes, checkpoints, observer, collect };
