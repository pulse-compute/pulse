#!/usr/bin/env node
'use strict';

// Evidence only. Root removal is confined to already-closed diagnostic owners.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const v8 = require('node:v8');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const hostPath = path.join(root, 'wasm/packages/host-runtime/src/runtime/canonical-native-host.js');
const host = require(hostPath);
const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-compiler');
const { replaceExact } = require('./mem01-schema-materialization.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function collect() { for (let i = 0; i < 5; i++) { await tick(); global.gc(); } await tick(); }

const source = `export default async function handler(ctx) {
 let key='p0';let count=0;let total=0;let first=null;
 const state={visits:0};const alias=state;
 for(let i=0;i<64&&key!=='';i++){
  const row=await ctx.kv('pages').getVersioned(key);
  if(row.status!=='found')return ctx.text('unavailable');
  if(i===0)first=row.value;
  alias.visits+=1;count+=1;total+=row.value.amount;key=row.value.next;
 }
 const barrier=await ctx.config.get('BARRIER');
 return ctx.text(count+':'+total+':'+state.visits+':'+(first===null?'':first.tag));
}`;
const cases = [
  { name: 'text-1-small', shape: 'text', count: 1, size: 256 },
  ...[1, 8, 64].map(count => ({ name: `text-${count}`, shape: 'text', count, size: 16384 })),
  ...[1, 8, 64].map(count => ({ name: `objects-${count}`, shape: 'objects', count, size: 128 }))
];
function payload(index, test) {
  const value = { __mem08_payload: true, next: index + 1 < test.count ? 'p' + (index + 1) : '', tag: 'row-' + index, amount: index + 1 };
  if (test.shape === 'text') {
    // Flat, distinct strings: avoid a repeated rope or one shared backing store.
    const bytes = Buffer.alloc(test.size);
    for (let i = 0; i < bytes.length; i++) bytes[i] = 65 + ((i * 7 + index * 11) % 26);
    bytes.write('MEM08-DATA-' + String(index).padStart(3, '0') + '-');
    value.text = bytes.toString('ascii');
  } else value.cells = Array.from({ length: test.size }, (_, i) => ({ __mem08_cell: true, n: index * test.size + i, ok: i % 2 === 0 }));
  return value;
}
const expected = test => `${test.count}:${test.count * (test.count + 1) / 2}:${test.count}:row-0`;
function observedHost(reuseNormalized = false) {
  const anchor = "  const controller = instantiateCanonicalNativeModule(compiled, { ...options, executionPlane: eventMode ? 'event' : 'http' });";
  let source = replaceExact(fs.readFileSync(hostPath, 'utf8'), anchor, anchor + '\n  options.mem08Observe?.(controller);');
  if (reuseNormalized) source = replaceExact(source, '        const result = controller.prepareEffectResult(entry.index, rawResult);',
    '        const result = conditional ? rawResult : controller.prepareEffectResult(entry.index, rawResult);');
  const loaded = new Module(hostPath, module); loaded.filename = hostPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(hostPath)); loaded._compile(source, hostPath);
  return loaded.exports;
}
function summary(result) {
  return { response: result.response, handles: result.valueHandleCount, memory: result.memory,
    traceSha256: sha(JSON.stringify(result.trace)), traceEntries: result.trace.length,
    continuationStates: result.continuations.map(c => c.states), continuations: result.continuations.length };
}
function rootFacts(controller) {
  let directPayloads = 0, envelopes = 0, longStrings = 0;
  for (const value of controller.heap.values.values()) {
    if (value?.__mem08_payload) directPayloads++;
    if (value?.status === 'found' && value.value?.__mem08_payload) envelopes++;
  }
  for (const value of controller.sensitiveValues) if (value.startsWith('MEM08-DATA-')) longStrings++;
  return { handles: controller.heap.size(), scalarIndex: controller.heap.scalars.size, directPayloads, envelopes,
    redactionStrings: controller.sensitiveValues.size, redactionPayloadStrings: longStrings,
    accounted: controller.heap.budget.snapshot(), wasmCapacityBytes: controller.exports.memory.buffer.byteLength };
}
function checkRedaction(controller) {
  for (const text of controller.sensitiveValues) if (text.startsWith('MEM08-DATA-')) {
    assert.equal(host.redactValue(text, controller.sensitiveValues), '<redacted>');
    // Dropping this root without a replacement would lose required redaction.
    assert.equal(host.redactValue(text, new Set()), text);
    return true;
  }
  return false;
}
async function nodeWorker(directory, test, mode) {
  const observed = mode !== 'control';
  const compiled = { wasm: fs.readFileSync(path.join(directory, 'node.wasm')), plan: JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'))) };
  const snapshots = [], runtime = observed ? observedHost(mode === 'reuse') : host;
  let calls = 0, disposals = 0;
  async function capture(stage) {
    await collect();
    const file = path.join(directory, test.name + '-' + mode + '-' + stage + '.heapsnapshot');
    snapshots.push({ stage, file: path.basename(file), facts: globalThis.__mem08Owner ? rootFacts(globalThis.__mem08Owner) : null,
      process: process.memoryUsage() });
    v8.writeHeapSnapshot(file);
  }
  const result = await runtime.executeCanonicalNativeModule(compiled, { strict: false, executionId: 'mem08',
    mem08Observe(controller) { globalThis.__mem08Owner = controller; },
    providerAdapter: { id: 'mem08', async dispatchEffect(effect) {
      if (effect.kind === 'config.get') { if (observed) await capture('suspended'); return 'ready'; }
      assert.equal(effect.kind, 'kv.getVersioned');
      const index = calls++; assert.equal(effect.key, 'p' + index);
      return { status: 'found', generation: 'fastly-kv-v1:' + BigInt(index + 1).toString(16).padStart(16, '0'), value: payload(index, test) };
    }, disposeExecution() { disposals++; } }
  });
  assert.equal(calls, test.count); assert.equal(disposals, 1); assert.equal(result.response.body, expected(test));
  const outcome = summary(result);
  if (observed) {
    await capture('closed');
    assert.equal(globalThis.__mem08Owner.heap.next - 1, result.valueHandleCount);
    const charged = globalThis.__mem08Owner.heap.budget.snapshot();
    assert.throws(() => globalThis.__mem08Owner.resume(), { code: 'PULSE_EFFECT_INVOCATION_INVALID' });
    // Whole-root ablation AFTER terminal handoff. This is causal attribution,
    // never a valid production lifetime or a resumable-controller operation.
    globalThis.__mem08Owner.heap.values.clear(); globalThis.__mem08Owner.heap.scalars.clear();
    assert.deepEqual(globalThis.__mem08Owner.heap.budget.snapshot(), charged);
    assert.equal(checkRedaction(globalThis.__mem08Owner), test.shape === 'text');
    await capture('without-table');
    globalThis.__mem08Owner.sensitiveValues.clear();
    assert.deepEqual(globalThis.__mem08Owner.heap.budget.snapshot(), charged);
    await capture('without-redactions');
    delete globalThis.__mem08Owner;
    await capture('owner-released-result-retained');
    // Still valid while the caller retains the full response and trace envelope.
    assert.deepEqual(summary(result), outcome);
  }
  write(path.join(directory, `${test.name}-${mode}.json`), { outcome, snapshots });
}

async function lifecycleControls(compiled, reuse = false) {
  const outcomes = [];
  for (const mode of ['failure', 'cancel', 'timeout']) {
    const signal = new AbortController(), refs = [], timerHandles = new Set(); let now = 0, calls = 0, disposed = 0, late;
    const budget = require('../../../../packages/runtime/src/internal/request-budget').createRequestBudget({ maxDurationMs: 10, signal: signal.signal,
      requestClock: { now: () => now, setTimeout(fn) { timerHandles.add(fn); return fn; }, clearTimeout(fn) { timerHandles.delete(fn); } } });
    let controllerRef;
    const execution = observedHost(reuse).executeCanonicalNativeModule(compiled, { strict: false, executionId: 'mem08-' + mode,
      requestBudget: budget, signal: mode === 'timeout' ? budget.signal : signal.signal,
      mem08Observe(c) { controllerRef = new WeakRef(c); }, providerAdapter: { id: 'mem08',
        dispatchEffect() {
          if (calls++ === 0) { const value = payload(0, { count: 8, shape: 'text', size: 4096 }); refs.push(new WeakRef(value)); return { status: 'found', generation: 'g0', value }; }
          if (mode === 'failure') return { status: 'failed', reason: 'unavailable' };
          return new Promise(resolve => { late = resolve; setImmediate(() => {
            if (mode === 'cancel') signal.abort(new Error('MEM08 cancellation'));
            else { now = 11; for (const fn of [...timerHandles]) fn(); }
          }); });
        }, disposeExecution() { disposed++; }
      } });
    let result;
    if (mode === 'failure') { result = await execution; assert.equal(result.response.body, 'unavailable'); }
    else await assert.rejects(execution, mode === 'timeout' ? { code: 'PULSE_REQUEST_DEADLINE_EXCEEDED' } : undefined);
    if (late) late({ status: 'found', generation: 'late', value: payload(1, { count: 8, shape: 'text', size: 4096 }) });
    budget.close(); await collect();
    assert.equal(disposed, 1); assert.equal(timerHandles.size, 0);
    assert.equal(controllerRef.deref(), undefined); assert.equal(refs.filter(r => r.deref()).length, 0);
    outcomes.push({ mode, calls, disposed, timers: timerHandles.size, controllerCollected: true, rawPayloadsCollected: true });
  }
  return outcomes;
}

async function repeatedNode(compiled) {
  const owners = [], graphs = [], results = [], samples = [];
  async function request() {
    let calls = 0, owner;
    const result = await observedHost().executeCanonicalNativeModule(compiled, { strict: false,
      mem08Observe(c) { owner = new WeakRef(c); owners.push(owner); }, providerAdapter: { id: 'mem08',
        dispatchEffect(effect) { return effect.kind === 'config.get' ? 'ready' : { status: 'found', generation: 'g', value: payload(calls++, { count: 4, shape: 'text', size: 4096 }) }; },
        disposeExecution() { for (const value of owner.deref().heap.values.values()) if (value?.__mem08_payload) graphs.push(new WeakRef(value)); }
      } });
    assert.equal(result.response.body, '4:10:4:row-0'); results.push(result);
  }
  for (let i = 1; i <= 16; i++) {
    await request();
    if ([1, 4, 16].includes(i)) {
      await collect();
      const controllers = owners.filter(r => r.deref()).length, payloads = graphs.filter(r => r.deref()).length;
      assert.equal(controllers, 0); assert.equal(payloads, 0);
      samples.push({ requests: i, callerRetainedResults: results.length, survivingControllers: controllers, survivingPayloadGraphs: payloads,
        callerTraceJsonBytes: Buffer.byteLength(JSON.stringify(results.map(r => r.trace))) });
    }
  }
  return samples;
}

async function candidateControl(compiled, kind, reuse) {
      let calls = 0, getterCalls = 0, raw;
      const result = await observedHost(reuse).executeCanonicalNativeModule(compiled, { strict: false, executionId: 'mem08-' + kind,
        ...(kind === 'oversize' ? { maxKvValueBytes: 64 } : {}),
        mem08Observe(c) { globalThis.__mem08Control = c; }, providerAdapter: { id: 'mem08', dispatchEffect(effect) {
          if (effect.kind === 'config.get') { raw.tag = 'mutated'; raw.cells[0].n = -1; return 'ready'; }
          calls++;
          if (kind === 'accessor') return Object.defineProperty({}, 'status', { enumerable: true, get() { getterCalls++; return 'found'; } });
          raw = payload(0, { count: 1, shape: 'objects', size: 2 });
          return { status: 'found', generation: 'g', value: raw };
        } }
      });
      assert.equal(getterCalls, 0); assert.equal(calls, 1);
      if (kind === 'detached-frozen') {
        assert.equal(result.response.body, '1:1:1:row-0');
        const stored = [...globalThis.__mem08Control.heap.values.values()].find(v => v?.__mem08_payload);
        assert.equal(stored.cells[0].n, 0);
        assert.ok(Object.isFrozen(stored) && Object.isFrozen(stored.cells) && Object.isFrozen(stored.cells[0]));
      } else assert.equal(result.response.body, 'unavailable');
      delete globalThis.__mem08Control;
      return summary(result);
}
function candidateControls(directory) {
  const rows = [];
  for (const kind of ['detached-frozen', 'accessor', 'oversize']) {
    // Fresh processes give identical execution ordinals, including any redacted
    // IDs and their byte charges. Do not normalize away observable differences.
    const variants = [false, true].map(reuse => {
      const child = spawnSync(process.execPath, [__filename, '--control', directory, kind, String(reuse)],
        { cwd: root, encoding: 'utf8', timeout: 30000 });
      assert.equal(child.status, 0, child.error?.message || child.stderr);
      return JSON.parse(fs.readFileSync(path.join(directory, `${kind}-${reuse}.json`)));
    });
    assert.deepEqual(variants[0], variants[1]); rows.push({ kind, parity: true, outcome: variants[0] });
  }
  return rows;
}

async function run(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const reportFile = path.join(directory, 'measurements.json');
  const owned = ['mem08-payload-retention.cjs', 'mem08-v8-snapshot.cjs', 'mem08-fastly-retention.cjs'];
  const sourceOwners = ['wasm/packages/host-runtime/src/runtime/canonical-native-host.js', 'wasm/packages/host-runtime/src/runtime/native-value-budget.js',
    'wasm/packages/host-runtime/src/runtime/effect-invocations.js', 'wasm/packages/host-runtime/src/runtime/canonical-api-runtime.js',
    'wasm/packages/contracts/src/handler/canonical-native-runtime.js', 'wasm/packages/runtime-core-as/src/compiler/canonical-native.js',
    'packages/runtime/src/internal/bindings.js', 'packages/runtime/src/internal/request-budget.js',
    'packages/runtime/src/internal/conditional-kv.js', 'packages/provider-fastly/src/build/native-platform-capabilities.js',
    'packages/provider-fastly/src/build/native-string-values.js', 'packages/provider-fastly/src/build/native-value-budget.js',
    'packages/provider-fastly/src/build/kv-native.as.ts', 'packages/provider-fastly/src/build/effect-invocations.js',
    'packages/provider-fastly/src/testing/conditional-kv-host.js', 'packages/provider-fastly/src/testing/native-platform-capabilities-host.js',
    'wasm/test/runtime/compiler-efficiency/mem01-schema-materialization.cjs'];
  const report = { version: 'pulse.mem08-payload-retention.v1', status: 'running',
    source: { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), fixtureSha256: sha(source),
      harness: Object.fromEntries(owned.map(file => [file, sha(fs.readFileSync(path.join(__dirname, file)))])),
      owners: Object.fromEntries(sourceOwners.map(file => [file, sha(fs.readFileSync(path.join(root, file)))])),
      lockSha256: sha(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))) },
    toolchain: { node: process.version, v8: process.versions.v8 }, node: [], candidate: [], fastly: [],
    limits: ['Terminal root ablation establishes ownership, not safe mid-execution reclamation.',
      'V8 snapshot object/string self sizes are measured allocations; the selected payload closure is not total process memory or a dominator retained-size calculation.',
      'Fastly production uses the stub allocator for this schema-free fixture; traced incremental GC is a diagnostic recipe, not the production default.',
      'Fastly allocator tracing uses injected ABI hostcalls and explicit collection, not Viceroy or deployed execution.',
      'PS3 cumulative accounting, live allocations and linear-memory capacity are distinct metrics.'] };
  write(reportFile, report);
  const unfinished = () => {
    if (report.status === 'running') {
      report.status = 'failed'; report.failure = 'Event loop ended before the evidence oracle completed.';
      write(reportFile, report); process.exitCode = 1;
    }
  };
  process.once('beforeExit', unfinished);
  try {
    const canonical = compileCanonicalSource(source, { fileName: 'mem08.ts', strict: false, requireAsync: true });
    assert.equal(canonical.ok, true);
    const plan = buildCanonicalNativePlan(canonical), compiled = compileCanonicalNativePlan(plan, { cwd: root });
    fs.writeFileSync(path.join(directory, 'node.wasm'), compiled.wasm); write(path.join(directory, 'plan.json'), plan);
    report.artifact = { planHash: plan.planHash, nodeWasmSha256: sha(compiled.wasm) };
    const { analyze } = require('./mem08-v8-snapshot.cjs');
    for (const test of cases) {
      for (const mode of ['control', 'observed', ...(test.count === 64 ? ['reuse'] : [])]) {
        const child = spawnSync(process.execPath, ['--expose-gc', __filename, '--node', directory, JSON.stringify(test), mode],
          { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
        assert.equal(child.status, 0, child.error?.message || child.stderr);
      }
      const control = JSON.parse(fs.readFileSync(path.join(directory, test.name + '-control.json')));
      const observed = JSON.parse(fs.readFileSync(path.join(directory, test.name + '-observed.json')));
      assert.deepEqual(observed.outcome, control.outcome, 'observer preserves complete managed response, trace and accounting');
      const snapshots = observed.snapshots.map(row => ({ ...row, heap: analyze(path.join(directory, row.file)) }));
      const byStage = Object.fromEntries(snapshots.map(row => [row.stage, row]));
      assert.equal(byStage.closed.heap.payloads, test.count);
      for (const stage of ['without-table', 'without-redactions', 'owner-released-result-retained']) assert.equal(byStage[stage].heap.payloads, 0);
      assert.equal(byStage['without-table'].heap.payloadStrings, test.shape === 'text' ? test.count : 0);
      assert.equal(byStage['without-redactions'].heap.payloadStrings, 0);
      assert.equal(byStage['owner-released-result-retained'].heap.payloadStrings, 0);
      report.node.push({ ...test, parity: true, outcome: observed.outcome, snapshots }); write(reportFile, report);
      if (test.count === 64) {
        const reuse = JSON.parse(fs.readFileSync(path.join(directory, test.name + '-reuse.json')));
        assert.deepEqual(reuse.outcome, control.outcome, 'one normalization preserves managed semantics and cumulative PS3');
        const snapshots = reuse.snapshots.map(row => ({ ...row, heap: analyze(path.join(directory, row.file)) }));
        const closed = snapshots.find(row => row.stage === 'closed');
        assert.equal(closed.heap.payloads, test.count);
        if (test.shape === 'text') {
          assert.equal(byStage.closed.heap.payloadStrings, test.count * 2);
          assert.equal(closed.heap.payloadStrings, test.count);
          assert.equal(closed.heap.payloadStringSelfBytes * 2, byStage.closed.heap.payloadStringSelfBytes);
        }
        report.candidate.push({ ...test, parity: true, outcome: reuse.outcome, snapshots }); write(reportFile, report);
      }
      console.log(JSON.stringify({ target: 'node', case: test.name, status: 'passed' }));
    }
    report.lifecycle = await lifecycleControls(compiled);
    report.candidateLifecycle = await lifecycleControls(compiled, true);
    assert.deepEqual(report.candidateLifecycle, report.lifecycle);
    report.repeatedNode = await repeatedNode(compiled);
    report.candidateControls = candidateControls(directory);
    report.fastly = await require('./mem08-fastly-retention.cjs').run(plan, cases, directory, payload, expected);
    report.status = 'passed'; write(reportFile, report);
    // Raw snapshots remain local; committed evidence contains measurements only.
    const compact = { ...report, fastly: { ...report.fastly, cases: report.fastly.cases.map(cell => ({ ...cell,
      variants: Object.fromEntries(Object.entries(cell.variants).map(([name, variant]) => [name, { ...variant,
        snapshots: variant.snapshots.filter(row => row.stage !== 'suspended' || [0, 1, 8, 32, 64].includes(row.payloads)) }])) })) } };
    write(path.join(directory, 'evidence.json'), compact);
    console.log(JSON.stringify({ status: report.status, node: report.node.length, fastly: report.fastly.cases.length, report: reportFile }));
  } catch (error) { report.status = 'failed'; report.failure = error.stack; write(reportFile, report); throw error; }
  finally { process.removeListener('beforeExit', unfinished); }
}
if (require.main === module) {
  if (process.argv[2] === '--node') nodeWorker(process.argv[3], JSON.parse(process.argv[4]), process.argv[5]).catch(e => { console.error(e); process.exitCode = 1; });
  else if (process.argv[2] === '--control') {
    const directory = process.argv[3], kind = process.argv[4], reuse = process.argv[5] === 'true';
    const compiled = { plan: JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'))), wasm: fs.readFileSync(path.join(directory, 'node.wasm')) };
    candidateControl(compiled, kind, reuse).then(result => write(path.join(directory, `${kind}-${reuse}.json`), result), e => { console.error(e); process.exitCode = 1; });
  }
  else if (!global.gc) {
    const child = spawnSync(process.execPath, ['--expose-gc', __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
    if (child.error) throw child.error; process.exitCode = child.status ?? 1;
  } else run(path.resolve(process.argv[2] || path.join(root, 'wasm/.test-results/compiler-efficiency/mem08', new Date().toISOString().replace(/[:.]/g, '-')))).catch(e => { console.error(e); process.exitCode = 1; });
}
module.exports = { source, cases, payload, expected, run, lifecycleControls, repeatedNode, candidateControls, observedHost };
