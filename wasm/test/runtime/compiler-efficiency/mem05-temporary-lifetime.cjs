#!/usr/bin/env node
'use strict';

// Evidence only. The diagnostic release below mutates a test controller's
// exposed heap. It is not imported by a runtime or enabled in production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const host = require('../../../packages/host-runtime/src/runtime/canonical-native-host');
const { NativeValueBudget } = require('../../../packages/host-runtime/src/runtime/native-value-budget');
const contract = require('../../../packages/contracts/src/handler/canonical-native-runtime');
const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-compiler');
const { createRequestBudget } = require('../../../../packages/runtime/src/internal/request-budget');
const root = path.resolve(__dirname, '../../../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
const invalidHandle = { code: 'PULSE_CANONICAL_NATIVE_VALUE_HANDLE_INVALID' };
const invalidTicket = { code: 'PULSE_EFFECT_INVOCATION_INVALID' };
const limited = { code: 'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED' };

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

function compile(text) {
  const canonical = compileCanonicalSource(text, { fileName: 'mem05.ts', strict: false, requireAsync: true });
  assert.equal(canonical.ok, true);
  return buildCanonicalNativePlan(canonical);
}
function walk(node, visit, parent) {
  if (!node || typeof node !== 'object') return;
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walk(item, visit, node));
    else walk(value, visit, node);
  }
}
function mentions(node, localId) {
  let found = false;
  walk(node, item => { if (item.kind === 'local' && item.id === localId) found = true; });
  return found;
}

// Miniature recognizer for this proposal, not a production lifetime analysis.
// Only the outer envelope is selected. Reading a child may create an independent
// handle/root; it never grants permission to release that child.
function recognize(plan) {
  const reject = reason => ({ eligible: false, reason });
  if (plan.handlers.length || plan.effects.length !== 1 || plan.continuations.length !== 1)
    return reject('one plain-handler read site required');
  const effect = plan.effects[0];
  if (effect.kind !== 'kv.getVersioned' || effect.grouped || effect.result.mode !== 'bind')
    return reject('one bound conditional read required');
  const loops = [];
  walk(plan.entry, node => { if (node.kind === 'read-loop') loops.push(node); });
  if (loops.length !== 1) return reject('one bounded loop required');
  const loop = loops[0], localId = effect.result.localId;
  if (!Number.isInteger(loop.maxIterations) || loop.maxIterations < 1 || loop.maxIterations > 64)
    return reject('one to 64 iterations required');
  if (loop.body[0]?.kind !== 'effect' || loop.body[0].effectId !== effect.id)
    return reject('read must dominate each iteration');
  if (![loop.initial, loop.test, loop.increment, effect.inputs].every(node => !mentions(node, localId)))
    return reject('envelope used before overwrite');
  const local = plan.locals.find(item => item.id === localId);
  if (!local || local.declaration !== 'const') return reject('immutable result binding required');
  let reason;
  const allowedReads = new Set(['status', 'reason', 'generation', 'value']);
  walk(plan.entry, (node, parent) => {
    if (node.kind === 'local' && node.id === localId
      && !(parent?.kind === 'property' && parent.object === node && allowedReads.has(parent.property)))
      reason = 'envelope escapes or has an unknown use';
    if (['assignment', 'update'].includes(node.kind) && mentions(node.target, localId))
      reason = 'write through envelope';
  });
  const outside = plan.entry.body.filter(node => node !== loop);
  if (mentions(outside, localId)) reason = 'envelope used outside region';
  if (reason) return reject(reason);
  return { eligible: true, planHash: plan.planHash, effectId: effect.id, slot: 0,
    localId, continuationState: plan.continuations[0].stateIndex };
}

function releaseEnvelope(heap, handle) {
  const value = heap.get(handle);
  assert.ok(value && Object.isFrozen(value) && ['found', 'not-found', 'failed'].includes(value.status));
  const before = heap.budget.snapshot(), next = heap.next, identities = heap.identityCount;
  // Evict the reverse identity mapping too. Otherwise put(value) resurrects a
  // dead handle. Keep next and all cumulative accounting/index charges intact.
  heap.identities?.delete(value);
  assert.equal(heap.values.delete(handle), true);
  assert.deepEqual(heap.budget.snapshot(), before);
  assert.equal(heap.next, next);
  assert.equal(heap.identityCount, identities);
  assert.throws(() => heap.get(handle), invalidHandle);
}
async function collect() {
  for (let i = 0; i < 5; i++) { await tick(); global.gc(); }
  await tick();
}
const surviving = refs => refs.filter(ref => ref.deref() !== undefined).length;
const row = (index, count) => ({ status: 'found', generation: 'g' + index,
  value: { next: index + 1 < count ? 'p' + (index + 1) : '', tag: 'row-' + index, text: 'x'.repeat(4096) } });

async function run(compiled, count, mode, outcome = 'success') {
  const certificate = recognize(compiled.plan);
  assert.equal(certificate.eligible, true);
  const signal = new AbortController();
  let now = 0; const timers = new Set();
  const requestBudget = outcome === 'timeout' ? createRequestBudget({ maxDurationMs: 10, requestClock: {
    now: () => now, setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); }
  } }) : undefined;
  const controller = host.instantiateCanonicalNativeModule(compiled, {
    strict: false, signal: requestBudget?.signal || signal.signal, requestBudget
  });
  const envelopes = [], payloads = [], events = [], retired = [];
  let status = controller.start(), visits = 0, previous = 0, ticket, priorTicket;
  while (status === 1) {
    const pending = controller.pendingEffects();
    assert.equal(pending.length, 1);
    const entry = pending[0]; ticket = entry.ticket;
    const beforeTickets = controller.heap.budget.snapshot();
    if (priorTicket) assert.throws(() => controller.setEffectResult(priorTicket, {}), invalidTicket);
    assert.throws(() => controller.setEffectResult({ ...ticket }, {}), invalidTicket);
    assert.deepEqual(controller.heap.budget.snapshot(), beforeTickets);
    assert.equal(entry.index, certificate.slot);
    assert.equal(controller.continuationState(), certificate.continuationState);
    events.push({ visit: visits, effectId: entry.effect.id, key: entry.payload.key,
      pc: controller.programCounter(), state: controller.continuationState() });
    // Existing ABI boundary: prior resume returned at the next invocation of
    // the same certified site. Settlement alone is deliberately insufficient.
    if (mode === 'release' && previous) { releaseEnvelope(controller.heap, previous); retired.push(previous); }
    if (['cancel', 'timeout'].includes(outcome) && visits === 1) {
      if (outcome === 'timeout') {
        now = 11;
        assert.throws(() => requestBudget.check(), { code: 'PULSE_REQUEST_DEADLINE_EXCEEDED' });
      } else signal.abort(new Error('MEM05 cancellation'));
      const before = controller.heap.budget.snapshot();
      assert.throws(() => controller.setEffectResult(ticket, row(1, count)), invalidTicket);
      assert.throws(() => controller.resume(), invalidTicket);
      assert.deepEqual(controller.heap.budget.snapshot(), before);
      break;
    }
    {
      const raw = outcome === 'failure' && visits === 1 ? { status: 'failed', reason: 'unavailable' } : row(visits, count);
      const normalized = controller.prepareEffectResult(entry.index, raw);
      envelopes.push(new WeakRef(normalized));
      if (normalized.value) payloads.push(new WeakRef(normalized.value));
      previous = controller.setEffectResult(ticket, normalized);
      const before = controller.heap.budget.snapshot();
      assert.throws(() => controller.setEffectResult(ticket, normalized), invalidTicket);
      assert.deepEqual(controller.heap.budget.snapshot(), before);
    }
    status = controller.resume(); visits++; priorTicket = ticket;
  }
  const interrupted = ['cancel', 'timeout'].includes(outcome);
  const response = interrupted ? null : controller.response();
  if (outcome === 'success') assert.equal(response.body, `${count}:${count}:row-0`);
  if (outcome === 'failure') assert.equal(response.body, 'unavailable');
  controller.close();
  requestBudget?.close(); assert.equal(timers.size, 0);
  const accounted = controller.heap.budget.snapshot();
  assert.throws(() => controller.setEffectResult(ticket, row(0, 1)), invalidTicket);
  assert.deepEqual(controller.heap.budget.snapshot(), accounted);
  for (const handle of retired) assert.throws(() => controller.heap.get(handle), invalidHandle);
  await collect();
  const liveEnvelopes = surviving(envelopes), livePayloads = surviving(payloads);
  assert.equal(liveEnvelopes, mode === 'release' ? (interrupted ? 0 : 1) : envelopes.length);
  // Every successful iteration reads row.value, so all those payload handles
  // remain roots. Releasing envelopes is not payload-graph reclamation.
  assert.equal(livePayloads, payloads.length);
  return { count, mode, outcome, visits, response, events, trace: controller.trace,
    allocatedHandles: controller.heap.next - 1, liveHandles: controller.heap.size(),
    accounted, retired: retired.length, liveEnvelopes, livePayloads,
    linearMemoryCapacity: controller.exports.memory.buffer.byteLength };
}

function negativeControls(plan, compiled) {
  const cases = [];
  const check = (name, candidate) => {
    assert.equal(recognize(candidate).eligible, false, name);
    cases.push(name);
  };
  // Real compiler inputs establish the alias counterexamples.
  check('carried envelope local', compile(source.replace("let first=null;", "let first=null;let saved=null;")
    .replace('if(i===0)first=row.value;', 'if(i===0){first=row.value;saved=row;}')));
  check('container envelope alias', compile(source.replace('const state={visits:0};', 'const state={visits:0,saved:null};')
    .replace('if(i===0)first=row.value;', 'if(i===0){first=row.value;state.saved=row;}')));
  check('response envelope', compile(source.replace("return ctx.text('unavailable')", 'return ctx.json(row)')));
  // Plan-level unknown-use controls are model cases, not admitted source claims.
  for (const owner of ['pending-payload', 'pending-result', 'schema-cache', 'diagnostics', 'request-state']) {
    const candidate = structuredClone(plan), loop = candidate.entry.body.find(node => node.kind === 'read-loop');
    loop.body.push({ kind: 'evidence-root', owner, value: { kind: 'local', id: candidate.effects[0].result.localId } });
    check(owner, candidate);
  }
  const unknown = structuredClone(plan);
  unknown.effects.push(structuredClone(unknown.effects[0])); check('multiple effects or group', unknown);
  const c = host.instantiateCanonicalNativeModule(compiled, { strict: false });
  c.start(); const entry = c.pendingEffects()[0];
  const handle = c.setEffectResult(entry.ticket, c.prepareEffectResult(entry.index, row(0, 2)));
  releaseEnvelope(c.heap, handle);
  assert.throws(() => c.resume(), invalidHandle, 'release at settlement breaks the real compiled continuation');
  c.close(); cases.push('settlement is too early');

  const budget = new NativeValueBudget(contract.CANONICAL_NATIVE_READ_LOOP_MEMORY), heap = new host.ValueHeap(budget);
  const value = Object.freeze({ status: 'not-found' }), first = heap.put(value);
  heap.values.delete(first);
  assert.equal(heap.put(value), first, 'map deletion alone returns the stale identity-cache handle');
  assert.throws(() => heap.get(first), invalidHandle);
  heap.values.set(first, value); releaseEnvelope(heap, first);
  const second = heap.put(value);
  assert.ok(second > first); assert.throws(() => heap.get(first), invalidHandle);
  cases.push('identity cache eviction and monotonic handle IDs');
  const charged = budget.snapshot(); releaseEnvelope(heap, second);
  assert.deepEqual(budget.snapshot(), charged);
  assert.throws(() => budget.charge(budget.policy.maxValues, 0), limited);
  assert.throws(() => heap.put(value), limited);
  assert.deepEqual(budget.snapshot(), charged);
  cases.push('no accounting refund or recovery from terminal failure');
  return cases;
}

async function main() {
  const plan = compile(source), compiled = compileCanonicalNativePlan(plan, { cwd: root });
  const out = path.resolve(process.argv[2] || path.join(root, 'wasm/.test-results/compiler-efficiency/mem05', new Date().toISOString().replace(/[:.]/g, '-')));
  fs.mkdirSync(out, { recursive: true });
  const owners = ['wasm/packages/host-runtime/src/runtime/canonical-native-host.js',
    'wasm/packages/host-runtime/src/runtime/effect-invocations.js',
    'wasm/packages/host-runtime/src/runtime/native-value-budget.js',
    'wasm/packages/runtime-core-as/src/compiler/canonical-native.js',
    'wasm/packages/contracts/src/handler/canonical-native-runtime.js',
    'packages/runtime/src/internal/conditional-kv.js', 'packages/runtime/src/internal/request-budget.js', 'pnpm-lock.yaml'];
  const report = { version: 'pulse.mem05-temporary-lifetime.v1', status: 'running',
    source: { base: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
      harnessSha256: sha(fs.readFileSync(__filename)), fixtureSha256: sha(source),
      owners: Object.fromEntries(owners.map(file => [file, sha(fs.readFileSync(path.join(root, file)))])) },
    toolchain: { node: process.version, v8: process.versions.v8, assemblyScript: compiled.manifest.assemblyScript },
    artifact: { planHash: plan.planHash, wasmSha256: sha(compiled.wasm), abi: contract.CANONICAL_NATIVE_ABI_VERSION },
    certificate: recognize(plan), cases: [], limitations: [
      'Diagnostic mutation of exposed test-controller storage only; production retains all handles.',
      'One outer conditional-read envelope; child handles, redaction strings and trace history are excluded.',
      'WeakRef survival is tracked-object reachability under explicit GC, not heap bytes or RSS.',
      'Controller stepping excludes managed-driver settled arrays; those can delay collection until the next loop turn.',
      'The miniature recognizer is a proposal oracle, not a shipped compiler certificate or public ABI guarantee.'
    ] };
  const save = () => fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
  save();
  try {
    report.negativeControls = negativeControls(plan, compiled);
    for (const [count, outcome] of [[1, 'success'], [8, 'success'], [64, 'success'], [8, 'failure'], [8, 'cancel'], [8, 'timeout']]) {
      const before = await run(compiled, count, 'retain', outcome), after = await run(compiled, count, 'release', outcome);
      for (const key of ['response', 'events', 'trace', 'allocatedHandles', 'accounted', 'linearMemoryCapacity'])
        assert.deepEqual(after[key], before[key], `${outcome}: ${key}`);
      report.cases.push({ before, after }); save();
    }
    report.status = 'passed'; save();
    const compact = { ...report, cases: report.cases.map(pair => Object.fromEntries(Object.entries(pair).map(([mode, row]) => {
      const { events, trace, ...summary } = row;
      return [mode, { ...summary, events: { count: events.length, sha256: sha(JSON.stringify(events)) },
        trace: { count: trace.length, sha256: sha(JSON.stringify(trace)) } }];
    }))) };
    fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(compact, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, pairs: report.cases.length, negativeControls: report.negativeControls.length, report: path.join(out, 'measurements.json') }));
  } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; save(); throw error; }
}
if (require.main === module) {
  if (typeof global.gc !== 'function') {
    const child = spawnSync(process.execPath, ['--expose-gc', __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  } else main().catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { recognize, main };
