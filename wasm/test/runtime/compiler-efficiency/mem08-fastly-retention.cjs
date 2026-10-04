'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const platform = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const mock = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { createConditionalKvAuthority } = require('../../../../packages/provider-fastly/src/testing/conditional-kv-host');
const { encodeConditionalKvValue } = require('../../../../packages/runtime/src/host');
const { replaceExact, diagnosticHost, observer } = require('./mem01-schema-materialization.cjs');
const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile');
const { appendAssemblyScriptOptimizationArgs } = require('../../../packages/build-support/src/native-optimization');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function diagnosticCompile(source, mode, directory) {
  const cwd = path.join(directory, mode); fs.mkdirSync(cwd, { recursive: true });
  const asc = resolveAsc(path.join(root, 'wasm/packages/compiler'));
  assert.equal(require(path.join(asc.packageRoot, 'package.json')).version, '0.28.18');
  const stub = mode === 'stub', control = mode === 'control';
  let runtime = control ? 'stub' : 'incremental';
  if (stub) {
    // Exact pinned allocator, plus two read-only global accessors. No allocation
    // path or layout changes. The used arena includes unreachable allocations.
    let source = fs.readFileSync(path.join(asc.packageRoot, 'std/assembly/rt/stub.ts'), 'utf8')
      .replace('from "./common"', 'from "~lib/rt/common"').replace('from "../util/error"', 'from "~lib/util/error"');
    source += '\n@global export function __mem08_stub_used(): usize { return offset - startOffset }\n@global export function __mem08_stub_start(): usize { return startOffset }\n';
    runtime = path.join(cwd, 'mem08-stub'); fs.writeFileSync(runtime + '.ts', source);
  }
  const filename = 'fastly-native-platform-capabilities.as.ts', output = path.join(cwd, 'proof.wasm');
  fs.writeFileSync(path.join(cwd, filename), source);
  const args = [asc.script, filename, '--outFile', output, '--runtime', runtime, '--noAssert', '--optimize'];
  appendAssemblyScriptOptimizationArgs(args, undefined, { guestLinked: false });
  args.push('--maximumMemory', String(require('../../../../packages/provider-fastly/src/build/native-value-budget').policy.maximumMemoryPages),
    '--use', 'abort=fastly-native-platform-capabilities.as/__pulse_fastly_abort');
  if (!control) args.push('--exportRuntime', '--exportStart', '__mem01_initialize');
  if (!control && !stub) args.push('--use', 'ASC_RTRACE=1');
  const result = spawnSync(asc.executable, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return fs.readFileSync(output);
}

function instrument(source, staged) {
  source = replaceExact(source, '  immutable: bool = false', `  immutable: bool = false
  mem01_length(): i32 { return this.valuesStorage === null ? 0 : this.valuesStorage!.length }
  mem01_child(i: i32): i32 { return unchecked(this.valuesStorage![i]) }
  mem01_key(i: i32): usize { return changetype<usize>(unchecked(this.keysStorage![i])) }
  mem01_key_count(): i32 { return this.keysStorage === null ? 0 : this.keysStorage!.length }
  mem08_part(i: i32): usize {
    if (i == 0) return changetype<usize>(this.keysStorage)
    if (i == 1) return this.keysStorage === null ? 0 : this.keysStorage!.dataStart
    if (i == 2) return changetype<usize>(this.valuesStorage)
    return this.valuesStorage === null ? 0 : this.valuesStorage!.dataStart
  }`);
  source += `
export function mem01_count(): i32 { return __pulse_fastly_values.length }
export function mem01_ptr(h: i32): usize { return changetype<usize>(unchecked(__pulse_fastly_values[h - 1])) }
export function mem01_kind(h: i32): i32 { return unchecked(__pulse_fastly_values[h - 1]).kind }
export function mem01_text(h: i32): usize { return changetype<usize>(unchecked(__pulse_fastly_values[h - 1]).textLeaf) }
export function mem01_frozen(h: i32): bool { return unchecked(__pulse_fastly_values[h - 1]).immutable }
export function mem01_length(h: i32): i32 { return unchecked(__pulse_fastly_values[h - 1]).mem01_length() }
export function mem01_child(h: i32, i: i32): i32 { return unchecked(__pulse_fastly_values[h - 1]).mem01_child(i) }
export function mem01_key_count(h: i32): i32 { return unchecked(__pulse_fastly_values[h - 1]).mem01_key_count() }
export function mem01_key(h: i32, i: i32): usize { return unchecked(__pulse_fastly_values[h - 1]).mem01_key(i) }
export function mem08_part(h: i32, i: i32): usize { return unchecked(__pulse_fastly_values[h - 1]).mem08_part(i) }
export function mem08_redaction_count(): i32 { return __pulse_fastly_redactions.length }
export function mem08_redaction_ptr(i: i32): usize { return changetype<usize>(unchecked(__pulse_fastly_redactions[i])) }
export function mem08_pending_roots(): i32 {
 let n=0;for(let i=0;i<PULSE_FASTLY_EFFECT_COUNT;i++) {
  if(unchecked(__pulse_fastly_payloads[i])>0)n++;
  if(unchecked(__pulse_fastly_ready[i])>0)n++;
 } return n;
}
// Diagnostic ablation after the invocation has ended. Never resume this instance.
export function mem08_drop_table(): void { __pulse_fastly_values.length = 0 }
export function mem08_drop_redactions(): void { __pulse_fastly_redactions.length = 0 }
`;
  if (staged) {
    source += '\n@external("mem08", "checkpoint") declare function mem08_checkpoint(status: i32): void\n';
    for (const anchor of ['  let runStatus = pulse_start()', '    runStatus = pulse_resume()'])
      source = replaceExact(source, anchor, anchor + '\n  mem08_checkpoint(runStatus)');
  }
  return source;
}

function probe(collectStages, stub = false) {
  const base = observer(), active = new Set(), snapshots = []; let instance;
  const rt = base.imports.rtrace;
  for (const [name, update] of [['onalloc', p => active.add(p)], ['onfree', p => active.delete(p)]]) {
    const original = rt[name]; rt[name] = (...args) => { const result = original(...args); update(args[0]); return result; };
  }
  const view = () => new DataView(instance.exports.memory.buffer);
  const blockBytes = p => (stub ? p - 20 >= instance.exports.mem08_stub_start() : active.has(p - 20))
    ? (view().getUint32(p - 20, true) & ~3) + 4 : 0;
  const text = p => p ? Buffer.from(instance.exports.memory.buffer, p, view().getUint32(p - 4, true)).toString('utf16le') : '';
  function roots() {
    const before = base.metrics().allocatorEvents, e = instance.exports, arenaBefore = stub ? e.mem08_stub_used() : 0, table = base.table();
    const byHandle = new Map(table.values.map(v => [v.handle, v]));
    const payloads = table.values.filter(v => v.keys.some(p => text(p) === '__mem08_payload'));
    const reached = new Set(), pending = payloads.map(v => v.handle), pointers = new Set();
    while (pending.length) {
      const h = pending.pop(); if (reached.has(h)) continue; reached.add(h);
      const v = byHandle.get(h); assert.ok(v);
      for (const p of [v.pointer, v.textPointer, ...v.keys, ...[0, 1, 2, 3].map(i => e.mem08_part(h, i))]) if (p) pointers.add(p);
      pending.push(...v.children);
    }
    const redactions = new Set(Array.from({ length: e.mem08_redaction_count() }, (_, i) => e.mem08_redaction_ptr(i)));
    const payloadStrings = [...redactions].filter(p => text(p).startsWith('MEM08-DATA-'));
    assert.equal(base.metrics().allocatorEvents, before, 'root readers must not allocate guest memory');
    if (stub) assert.equal(e.mem08_stub_used(), arenaBefore, 'stub root readers must not allocate guest memory');
    return { handles: table.handles, payloads: payloads.length, payloadGraphHandles: reached.size,
      payloadGraphBlockBytes: [...pointers].reduce((sum, p) => sum + blockBytes(p), 0),
      redactionStrings: redactions.size, redactionBlockBytes: [...redactions].reduce((sum, p) => sum + blockBytes(p), 0),
      redactionPayloadStrings: payloadStrings.length, redactionPayloadBlockBytes: payloadStrings.reduce((sum, p) => sum + blockBytes(p), 0),
      payloadAndRedactionOverlapBytes: [...redactions].filter(p => pointers.has(p)).reduce((sum, p) => sum + blockBytes(p), 0),
      pendingHandleSlots: e.mem08_pending_roots(), accounted: { bytes: Number(e.pulse_fastly_memory_bytes()), values: Number(e.pulse_fastly_memory_values()) } };
  }
  function metrics() { return stub ? { usedArenaBytes: instance.exports.mem08_stub_used(), memoryCapacityBytes: instance.exports.memory.buffer.byteLength }
    : base.metrics(); }
  function capture(stage) { const row = { stage, ...metrics(), ...roots() }; snapshots.push(row); return row; }
  base.imports.mem08 = { checkpoint(status) {
    const before = metrics(); if (collectStages) instance.exports.__collect();
    const row = capture(status === 1 ? 'suspended' : 'response-ready'); row.preCollectOutstandingBytes = before.outstandingBytes;
  } };
  return { imports: base.imports, attach(i) { instance = i; base.attach(i); }, capture, snapshots,
    collect() { return base.collect(); }, exports() { return instance.exports; } };
}

function options(test, payload, extra = {}) {
  const authority = createConditionalKvAuthority(); authority.stores.set('pages', new Map());
  for (let i = 0; i < test.count; i++) authority.seed('pages', 'p' + i, encodeConditionalKvValue(payload(i, test)), BigInt(i + 1));
  // Pin the host's clock input so independent executions have identical raw
  // traces even when the evidence run crosses a wall-clock second.
  return { clockUnixSeconds: 1790294400, configStores: { app_config: { BARRIER: 'ready' } }, conditionalKv: { authority, ...extra } };
}
function outcome(result) {
  return { status: result.response.status, body: result.response.body, traceSha256: sha(JSON.stringify(result.trace)),
    traceEntries: result.trace.length, pendingHostLookups: result.kvEvidence.pending.size, acquiredReadBodies: result.kvEvidence.bodyFixtures.size,
    accounted: { bytes: Number(result.instance.exports.pulse_fastly_memory_bytes()), values: Number(result.instance.exports.pulse_fastly_memory_values()) } };
}

async function run(plan, cases, directory, payload, expected) {
  directory = path.resolve(directory);
  const compiled = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: root, bindings: { configStore: 'app_config', kv: { pages: 'pages' } }, emitWat: false });
  const dir = path.join(directory, 'fastly'); fs.mkdirSync(dir, { recursive: true });
  assert.equal(compiled.manifest.schemaCodecs.active, false, 'this fixture selects the production stub runtime');
  assert.equal(sha(diagnosticCompile(compiled.source, 'control', dir)), sha(compiled.wasm), 'uninstrumented stub recipe reproduces production bytes');
  const tracedSource = instrument(compiled.source, false), stagedSource = instrument(compiled.source, true);
  const traced = diagnosticCompile(tracedSource, 'traced', dir), staged = diagnosticCompile(stagedSource, 'staged', dir);
  const stub = diagnosticCompile(stagedSource + '\nexport function mem08_stub_used(): usize { return __mem08_stub_used() }\nexport function mem08_stub_start(): usize { return __mem08_stub_start() }\n', 'stub', dir);
  const execute = diagnosticHost();
  const ascRoot = require('../../../packages/build-support/src/assemblyscript-compile').resolveAsc(path.join(root, 'wasm/packages/compiler')).packageRoot;
  const report = { toolchain: { assemblyScript: require(path.join(ascRoot, 'package.json')).version,
    runtimeSources: Object.fromEntries(['common.ts', 'stub.ts', 'tlsf.ts', 'itcms.ts', 'rtrace.ts'].map(file => [file, sha(fs.readFileSync(path.join(ascRoot, 'std/assembly/rt', file)))])) },
    productionRuntime: 'stub', diagnosticRuntime: 'incremental', productionWasmSha256: sha(compiled.wasm), stubProbeWasmSha256: sha(stub), tracedWasmSha256: sha(traced), stagedWasmSha256: sha(staged),
    generatedSourceSha256: sha(compiled.source), cases: [], lifecycle: [], repeated: [] };
  for (const test of cases) {
    const control = mock.executeFastlyNativePlatformCapabilities(compiled, options(test, payload));
    const baseline = outcome(control); assert.equal(baseline.body, expected(test));
    assert.equal(baseline.pendingHostLookups, 0); assert.equal(baseline.acquiredReadBodies, 0);
    const variants = {};
    for (const mode of ['stub', 'traced', 'staged', 'staged-collected']) {
      const p = probe(mode === 'staged-collected', mode === 'stub');
      const result = execute(mode === 'stub' ? stub : mode === 'traced' ? traced : staged, { ...options(test, payload), mem01: p });
      assert.deepEqual(outcome(result), baseline, 'diagnostics preserve response, hostcalls, resource closure and cumulative charges');
      const terminal = p.capture('closed'); p.collect(); const live = p.capture('closed-collected');
      assert.equal(live.payloads, test.count);
      p.collect(); const fixed = p.capture('fixed-point');
      if (mode === 'stub') assert.equal(fixed.usedArenaBytes, live.usedArenaBytes);
      else assert.equal(fixed.outstandingBytes, live.outstandingBytes);
      const charged = live.accounted;
      if (mode === 'traced' || mode === 'stub') {
        p.exports().mem08_drop_table(); p.collect(); const tableRemoved = p.capture('without-table');
        assert.equal(tableRemoved.payloads, 0); assert.deepEqual(tableRemoved.accounted, charged);
        assert.equal(tableRemoved.redactionPayloadStrings, test.shape === 'text' ? test.count : 0);
        p.exports().mem08_drop_redactions(); p.collect();
        const redactionsRemoved = p.capture('without-redactions'); assert.deepEqual(redactionsRemoved.accounted, charged);
        assert.equal(redactionsRemoved.redactionStrings, 0);
        if (mode === 'stub') assert.equal(redactionsRemoved.usedArenaBytes, live.usedArenaBytes, 'stub cannot reclaim removed roots');
      }
      variants[mode] = { terminal, live, snapshots: p.snapshots };
    }
    assert.equal(variants.traced.terminal.allocatedBytes, variants.staged.terminal.allocatedBytes, 'readers do not alter allocation total');
    assert.equal(variants.traced.live.outstandingBytes, variants.staged.live.outstandingBytes);
    report.cases.push({ ...test, parity: true, outcome: baseline, productionMemoryCapacityBytes: control.instance.exports.memory.buffer.byteLength, variants });
    console.log(JSON.stringify({ target: 'fastly', case: test.name, status: 'passed' }));
  }
  const small = { count: 8, shape: 'text', size: 4096 };
  for (const mode of ['failure', 'timeout', 'cancel']) {
    function attempt(instrumented) {
      let lookups = 0;
      const signal = new AbortController(), p = probe(false);
      const input = options(small, payload, { onCall(stage) {
        if (stage === 'lookup' && ++lookups === 2) {
          if (mode === 'cancel') signal.abort(new Error('MEM08 cancellation'));
          return mode === 'failure' ? { status: 1 } : mode === 'timeout' ? { readyDelayMs: 11000 } : undefined;
        }
      } });
      let result;
      try { result = (instrumented ? execute : mock.executeFastlyNativePlatformCapabilities)(instrumented ? traced : compiled,
        { ...input, signal: signal.signal, ...(instrumented ? { mem01: p } : {}) }); }
      catch (error) { if (mode !== 'cancel') throw error; assert.equal(error.message, 'MEM08 cancellation'); return { cancelled: true, lookups }; }
      assert.equal(result.response.body, 'unavailable'); assert.equal(result.kvEvidence.bodyFixtures.size, 0);
      return outcome(result);
    }
    const control = attempt(false); assert.deepEqual(attempt(true), control);
    report.lifecycle.push({ mode, parity: true, outcome: control });
  }
  const refs = [];
  function request() {
    const result = mock.executeFastlyNativePlatformCapabilities(compiled, options(small, payload));
    assert.equal(result.response.body, expected(small)); refs.push(new WeakRef(result.instance), new WeakRef(result.instance.exports.memory.buffer));
  }
  for (let i = 1; i <= 16; i++) {
    request();
    if ([1, 4, 16].includes(i)) {
      for (let j = 0; j < 5; j++) { await new Promise(resolve => setImmediate(resolve)); global.gc(); }
      await new Promise(resolve => setImmediate(resolve));
      const liveOwners = refs.filter(r => r.deref()).length; assert.equal(liveOwners, 0);
      report.repeated.push({ requests: i, survivingInstancesAndBuffers: liveOwners });
    }
  }
  return report;
}
module.exports = { run, instrument };
