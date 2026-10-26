'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createNativeExecutionLifecycle: create } = require('../../packages/host-runtime/src/runtime/native-execution-lifecycle');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const host = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime');
const { runDeliveryConformance } = require('../support/execution-lifecycle-conformance.cjs');
const root = path.resolve(__dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-native-lifecycle-'));
const plan = source => buildCanonicalNativePlan(compileCanonicalSource(source, { requireAsync: true, strict: false }));
const source = `export default async function handler(ctx){const value=await ctx.config.get('MODE');return ctx.text(value)}`;
const native = compileCanonicalNativePlan(plan(source), { cwd: root, emitWat: false });
const hook = (point, run, order = 0, owner = 'test') => ({ point, owner, order, run });
let count = 0;
function check(name, fn) { fn(); count++; console.log('ok - ' + name); }
function instrumentedGuest() {
  // Fault injection in a maintained test artifact only. The production controller
  // and all generated setter cases remain real; no mocked Wasm export object.
  const marker = 'export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {';
  assert.equal(native.source.split(marker).length, 2);
  const code = native.source.replace(marker, marker + '\nif (__p09_mode == 2) unreachable(); if (__p09_mode == 1) return 0;')
    + '\nlet __p09_mode: i32 = 0; export function p09_mode(mode: i32): void { __p09_mode = mode }\nexport function pulse_package_set_effect_failure(effect: i32): i32 { if (__p09_mode == 2) unreachable(); return __p09_mode == 1 ? 0 : 1 }\n';
  const file = path.join(tmp, 'faults.ts'), out = path.join(tmp, 'faults.wasm'); fs.writeFileSync(file, code);
  const asc = require('../../packages/build-support/src/assemblyscript-compile').resolveAsc(path.join(root, 'wasm/packages/compiler'));
  const r = spawnSync(asc.executable, [asc.script, file, '--outFile', out, '--runtime', 'stub', '--optimize', '--noAssert'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); return { ...native, wasm: fs.readFileSync(out) };
}
function recording(extra = [], artifact = native) {
  const trace = []; let accepted = -1, mode = 0, controller, activeTicket;
  const services = [
    hook('effect.settle', () => { trace.push(1); return mode !== 3; }),
    { point: 'effect.deliver', owner: 'outer', order: -1, before() { trace.push(2); if (mode === 4) throw new WebAssembly.RuntimeError('before'); }, after(_effect, _result, value) { trace.push(6); accepted = value; } },
    { point: 'effect.deliver', owner: 'inner', order: 1, before() { trace.push(3); }, after() { trace.push(5); } },
    hook('effect.result', () => { trace.push(4); return true; }),
    hook('invocation.end', () => { trace.push(9); }),
    hook('invocation.close', () => { trace.push(7); }),
    hook('invocation.closed', () => { trace.push(8); assert.deepEqual(controller.pendingEffects(), []); if (activeTicket) assert.throws(() => controller.assertPendingEffect(activeTicket), { code: 'PULSE_EFFECT_INVOCATION_INVALID' }); }), ...extra
  ];
  controller = host.instantiateCanonicalNativeModule(artifact, { lifecycleServices: services, providerAdapter: createNodeProviderAdapter({ config: { MODE: 'ok' } }) });
  controller.start(); const ticket = controller.pendingEffects()[0].ticket; activeTicket = ticket;
  return { controller, ticket, trace, services, accepted: () => accepted,
    mode(value) { mode = value; controller.exports.p09_mode?.(value); } };
}
async function main() {
  const faults = instrumentedGuest();
  runDeliveryConformance(() => {
    const x = recording([], faults), { controller: c, ticket } = x;
    return { mode: x.mode, accepted: x.accepted, trace: () => x.trace.filter(n => n < 7).join(''), close: c.close, cleanupCount: () => x.trace.filter(n => n === 8).length,
      settle() {
        try { c.setEffectResult(ticket, 'ok'); return 1; }
        catch (error) { if (['PULSE_CANONICAL_NATIVE_LIFECYCLE_REJECTED', 'PULSE_CANONICAL_NATIVE_EFFECT_INDEX_INVALID'].includes(error.code)) return 0; throw error; }
      },
      rejectInvalid() { const size = c.heap.size(); for (const bad of [0, { ...ticket }, { ...ticket, slot: 1 }]) assert.throws(() => c.setEffectResult(bad, 'bad'), { code: 'PULSE_EFFECT_INVOCATION_INVALID' }); assert.equal(c.heap.size(), size); },
      assertPending() { c.assertPendingEffect(ticket); },
      assertConsumed() { assert.throws(() => c.assertPendingEffect(ticket), { code: 'PULSE_EFFECT_INVOCATION_INVALID' }); }
    };
  }, check);
  check('package failure ABI uses authenticated settlement and the same around/result points', () => {
    // The extra export is a test ABI stub, not package admission evidence.
    const artifact = { ...faults, plan: { ...faults.plan, packages: { ...faults.plan.packages, application: { effectFailure: 'package-completion' } } } };
    for (const mode of [0, 1, 2]) {
      const x = recording([], artifact); x.mode(mode);
      if (mode === 0) x.controller.setEffectFailure(x.ticket);
      else assert.throws(() => x.controller.setEffectFailure(x.ticket), mode === 1 ? { code: 'PULSE_CANONICAL_NATIVE_EFFECT_INDEX_INVALID' } : WebAssembly.RuntimeError);
      assert.equal(x.trace.filter(n => n < 7).join(''), mode === 2 ? '1234' : '123456');
      assert.equal(x.accepted(), mode === 2 ? -1 : mode === 1 ? 0 : 1);
      assert.throws(() => x.controller.setEffectFailure(x.ticket), { code: 'PULSE_EFFECT_INVOCATION_INVALID' }); x.controller.close();
    }
  });
  check('result guard rejection reaches after notifications as rejected delivery', () => {
    const x = recording([hook('effect.result', () => false, 1, 'deny')]);
    assert.throws(() => x.controller.setEffectResult(x.ticket, 'ok'), { code: 'PULSE_CANONICAL_NATIVE_EFFECT_INDEX_INVALID' });
    assert.equal(x.trace.join(''), '12345678'); assert.equal(x.accepted(), 0);
  });
  check('real controller ends before closure and never repeats closed cleanup', () => {
    const x = recording(); x.controller.setEffectResult(x.ticket, 'ok'); assert.equal(x.controller.resume(), 0);
    assert.equal(x.trace.join(''), '123456978'); assert.equal(x.controller.response().body, 'ok');
    x.controller.close(); assert.equal(x.trace.join(''), '123456978');
    assert.equal(x.controller.exports, x.controller.instance.exports);
    assert.equal(x.controller.exports.pulse_set_effect_result(0, 0), 0);
  });
  check('external host-visible setter entry runs result guards without delivery notifications', () => {
    let called = 0;
    const c = host.instantiateCanonicalNativeModule(native, { lifecycleServices: [hook('effect.result', () => { called++; return false; })] });
    c.start(); const t = c.pendingEffects()[0].ticket;
    assert.equal(c.exports.pulse_set_effect_result(0, 0), 0); assert.equal(c.instance.exports.pulse_set_effect_result(0, 0), 0); assert.equal(called, 2); c.assertPendingEffect(t); c.close();
  });
  check('closure invalidates pending tickets even when a pre-close service throws', () => {
    let closed = 0;
    const c = host.instantiateCanonicalNativeModule(native, { lifecycleServices: [hook('invocation.close', () => { throw new Error('cleanup'); }), hook('invocation.closed', () => { closed++; })] });
    c.start(); const t = c.pendingEffects()[0].ticket;
    assert.throws(c.close, /cleanup/); assert.throws(() => c.setEffectResult(t, 'bad'), { code: 'PULSE_EFFECT_INVOCATION_INVALID' }); assert.deepEqual(c.pendingEffects(), []); assert.equal(closed, 0); c.close();
  });
  check('reentrant closure is bounded and cannot settle still-pending work', () => {
    let c, t, calls = 0;
    c = host.instantiateCanonicalNativeModule(native, { lifecycleServices: [hook('invocation.close', () => { calls++; c.close(); assert.throws(c.resume, { code: 'PULSE_EFFECT_INVOCATION_INVALID' }); assert.throws(() => c.setEffectResult(t, 'bad'), { code: 'PULSE_CANONICAL_NATIVE_LIFECYCLE_REJECTED' }); })] });
    c.start(); t = c.pendingEffects()[0].ticket; c.close(); assert.equal(calls, 1);
  });
  check('guard reentrancy cannot deliver after closing the invocation', () => {
    let c;
    c = host.instantiateCanonicalNativeModule(native, { lifecycleServices: [hook('effect.settle', () => { c.close(); return true; })] });
    c.start(); const t = c.pendingEffects()[0].ticket, size = c.heap.size(); assert.throws(() => c.setEffectResult(t, 'bad'), { code: 'PULSE_EFFECT_INVOCATION_INVALID' }); assert.equal(c.heap.size(), size);
  });
  check('abort closes host-owned tickets without leaking observer errors through EventTarget', () => {
    const abort = new AbortController(); let calls = 0;
    const c = host.instantiateCanonicalNativeModule(native, { signal: abort.signal, lifecycleServices: [hook('invocation.close', () => { calls++; throw new Error('cleanup'); })] });
    c.start(); const t = c.pendingEffects()[0].ticket; abort.abort(); assert.equal(calls, 1); assert.throws(() => c.setEffectResult(t, 'bad'), { code: 'PULSE_EFFECT_INVOCATION_INVALID' });
  });
  const loop = compileCanonicalNativePlan(plan(`export default async function h(ctx){let count=0;for(let i=0;i<3;i++){const row=await ctx.kv('pages').getVersioned('p');if(row.status!=='not-found')return ctx.text('bad');count++;}return ctx.text(''+count)}`), { cwd: root, emitWat: false });
  check('selected lifecycle preserves repeated sites and rejects stale and foreign tickets', () => {
    const seen = [], services = [hook('effect.settle', (effect, ticket) => { seen.push([effect, ticket.sequence]); return true; })];
    const a = host.instantiateCanonicalNativeModule(loop, { lifecycleServices: services }), b = host.instantiateCanonicalNativeModule(loop, { lifecycleServices: services });
    a.start(); b.start(); const foreign = b.pendingEffects()[0].ticket; let stale;
    for (let i = 0; i < 3; i++) {
      const t = a.pendingEffects()[0].ticket;
      for (const invalid of [foreign, ...(stale ? [stale] : [])]) assert.throws(() => a.setEffectResult(invalid, { status: 'not-found' }), { code: 'PULSE_EFFECT_INVOCATION_INVALID' });
      a.setEffectResult(t, { status: 'not-found' }); stale = t; assert.equal(a.resume(), i === 2 ? 0 : 1);
    }
    assert.deepEqual(seen, [[0,1],[0,2],[0,3]]); assert.equal(a.response().body, '3'); b.close();
  });
  check('memory exhaustion keeps its primary error when a close observer fails', () => {
    const c = host.instantiateCanonicalNativeModule(loop, { lifecycleServices: [hook('invocation.close', () => { throw new Error('secondary'); })] });
    assert.throws(() => c.heap.budget.charge(c.heap.budget.policy.maxValues + 1, 0), { code: 'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED' });
    assert.throws(c.start, { code: 'PULSE_EFFECT_INVOCATION_INVALID' });
  });
  check('adapter validates ordering, phases, unsupported HTTP, and synchronous results', () => {
    assert.equal(create(), undefined); assert.equal(create([]), undefined);
    for (const services of [null, [hook('response.authority', () => true)], [hook('invocation.end', async () => {})], [hook('invocation.end', function* () {})], [hook('invocation.end', () => {}, 0), hook('invocation.end', () => {}, 1)]]) assert.throws(() => create(services));
    for (const result of [1, undefined, Promise.resolve(true)]) assert.throws(() => create([hook('effect.result', () => result)]).guard('effect.result', 0, 0), { code: 'PULSEWASM_LIFECYCLE_ADAPTER_INVALID' });
    assert.throws(() => create([hook('invocation.end', () => 1)]).observe('invocation.end'));
    const events = []; const services = [hook('invocation.end', () => { events.push(2); }, 2, 'b'), hook('invocation.end', () => { events.push(1); }, -1, 'a')];
    const a = create(services), b = create([...services].reverse()); assert.deepEqual(a.plan, b.plan); a.observe('invocation.end'); b.observe('invocation.end'); assert.deepEqual(events, [1,2,1,2]);
  });
  const calls = [], primary = new Error('primary-dispatch'); let disposed = 0;
  await assert.rejects(host.executeCanonicalNativeModule(native, { lifecycleServices: [hook('invocation.close', () => { calls.push('close'); throw new Error('secondary-cleanup'); })], providerAdapter: { id: 'node', dispatchEffect() { throw primary; }, disposeExecution() { disposed++; } } }), error => { assert.equal(error.message, 'primary-dispatch'); return true; });
  assert.deepEqual(calls, ['close']); assert.equal(disposed, 1); count++; console.log('ok - managed driver preserves primary failure and still disposes provider');
  const events = [];
  const result = await host.executeCanonicalNativeModule(native, { providerAdapter: createNodeProviderAdapter({ config: { MODE: 'ok' } }), lifecycleServices: [hook('invocation.end', () => { events.push('end'); }), hook('invocation.close', () => { events.push('close'); }), hook('invocation.closed', () => { events.push('closed'); })] });
  assert.equal(result.response.body, 'ok'); assert.deepEqual(events, ['end', 'close', 'closed']); count++; console.log('ok - actual Node adapter completes through managed lifecycle');
  const trapTrace = [];
  await assert.rejects(host.executeCanonicalNativeModule(native, { providerAdapter: createNodeProviderAdapter({ config: { MODE: 'ok' } }), lifecycleServices: [
    hook('effect.result', () => { throw new WebAssembly.RuntimeError('primary trap'); }),
    { point: 'effect.deliver', owner: 'test', order: 0, before() { trapTrace.push('before'); }, after() { trapTrace.push('after'); } },
    hook('invocation.end', () => { trapTrace.push('end'); }), hook('invocation.close', () => { trapTrace.push('close'); }), hook('invocation.closed', () => { trapTrace.push('closed'); })
  ] }), /primary trap/);
  assert.deepEqual(trapTrace, ['before', 'close', 'closed']); count++; console.log('ok - host finally closes after thrown delivery without promising guest finalizers');
  fs.writeFileSync(path.join(tmp, 'event.ts'), `import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.on('system.tick',{schema:null},async ctx=>{await ctx.config.get('MODE');});export default app;`);
  const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler');
  const eventPlan = buildCanonicalNativePlan(compileCanonicalProject(path.join(tmp, 'event.ts'), { rootDir: tmp, workspaceRoot: root, strict: false, requireAsync: true, applicationProjectMetadata: { selectedProfile: { name: 'test', source: 'native-lifecycle' }, strict: false, target: 'native', host: 'node', projectHash: '3'.repeat(64), configPlanHash: '4'.repeat(64), bindings: { config: [], secret: [] }, fragments: {} } }));
  const eventNative = compileCanonicalNativePlan(eventPlan, { cwd: root, emitWat: false });
  const eventTrace = [];
  const eventResult = await host.executeCanonicalNativeEvent(eventNative, { version: require('../../packages/contracts/src/events/contracts').EVENT_FRAME_VERSION, type: 'system.tick', schemaId: null }, {
    providerAdapter: createNodeProviderAdapter({ config: { MODE: 'ok' } }), lifecycleServices: [hook('invocation.end', () => { eventTrace.push('end'); }), hook('invocation.closed', () => { eventTrace.push('closed'); })]
  });
  assert.equal(eventResult.status, 'completed'); assert.deepEqual(eventTrace, ['end','closed']); count++; console.log('ok - event execution selects no HTTP lifecycle capability');
  const absent = host.instantiateCanonicalNativeModule(native), empty = host.instantiateCanonicalNativeModule(native, { lifecycleServices: [] });
  assert.equal(absent.lifecycle, undefined); assert.equal(empty.lifecycle, undefined); assert.equal(Object.hasOwn(empty.instance, 'exports'), false);
  assert.equal(absent.wasmSha256, empty.wasmSha256); assert.deepEqual(WebAssembly.Module.imports(absent.module), WebAssembly.Module.imports(empty.module)); absent.close(); empty.close(); count++;
  console.log(`ok - ${count} Node Native lifecycle cases; common traces use compiled fault-injection artifacts, ordinary execution uses unmodified Wasm`);
}
main().finally(() => fs.rmSync(tmp, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
