'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const { create } = require('../../../packages/provider-fastly/src/build/lifecycle');
const { runtimeSource } = require('../../../packages/provider-fastly/src/build/effect-invocations');
const { renderNativeExports } = require('../../packages/runtime-core-as/src/compiler/canonical-native-support');
const { createLifecycleEmitter } = require('../../packages/runtime-core-as/src/compiler/lifecycle-emitter');
const authority = require('../../../packages/provider-fastly/src/build/response-authority');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-lifecycle-'));
const asc = require('../../packages/build-support/src/assemblyscript-compile').resolveAsc(path.join(root, 'wasm/packages/compiler'));
let count = 0;
function check(name, test) { test(); count++; console.log('ok - ' + name); }
function compile(name, source) {
  const file = path.join(tmp, name + '.ts'), output = path.join(tmp, name + '.wasm');
  fs.writeFileSync(file, source + '\nexport function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable() }\n');
  const r = spawnSync(asc.executable, [asc.script, file, '--outFile', output, '--runtime', 'stub', '--optimize', '--noAssert', '--use', `abort=${name}/abort`], { cwd: tmp, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr || r.error?.message);
  return new WebAssembly.Module(fs.readFileSync(output));
}
const hook = (point, body, order = 0, owner = 'test') => ({ point, owner, order, body });
try {
  const services = [
    hook('effect.settle', 'note(1); return mode != 3'),
    { point: 'effect.deliver', owner: 'outer', order: -1, before: 'note(2); if (mode == 4) unreachable()', after: 'note(6); acceptedValue = accepted' },
    { point: 'effect.deliver', owner: 'inner', order: 1, before: 'note(3)', after: 'note(5)' },
    hook('effect.result', 'note(4); return !__pulse_invocation_closed'),
    hook('invocation.close', 'note(7)'),
    hook('invocation.closed', 'if (!__pulse_invocation_closed || unchecked(__pulse_invocation_tickets[0]) != 0) unreachable(); note(8); if (cleanupOwned) { cleanupOwned = false; cleanups++; }'),
    hook('invocation.end', 'note(9)')
  ];
  const lifecycle = create({ effects: [], capabilities: [] }, {}, services);
  const setter = renderNativeExports({ eventReachable: false, stateEnabled: false, eventExports: [], lifecycle,
    setterCases: 'case 0: deliveries++; if (mode == 2) unreachable(); return mode == 1 ? 0 : 1;' }).join('\n');
  const module = compile('tickets', `
const PULSE_FASTLY_EFFECT_COUNT: i32 = 1, PULSE_ERROR_STATE: i32 = 1007;
const PULSE_ABI_VERSION: i32 = 2, PULSE_ENTRY_PC: i32 = 0;
const PULSE_PLAN_HASH: string = 'fixture';
let __pulse_started: i32 = 0, __pulse_pc: i32 = 0, __pulse_state: i32 = 0, __pulse_result: i32 = 0, __pulse_error: i32 = 0, __pulse_pending: i32 = 0;
let trace: i32 = 0, mode: i32 = 0, deliveries: i32 = 0, acceptedValue: i32 = -1, cleanups: i32 = 0;
let cleanupOwned: bool = true;
function note(value: i32): void { trace = trace * 10 + value }
function __pulse_fastly_fail(code: i32, stage: i32, effect: i32): void { __pulse_error = code }
function __pulse_run(): i32 { return 0 }
function __pulse_ready_for_resume(): bool { return true }
function __pulse_clear_resume_flags(): void {}
${runtimeSource({ lifecycle })}
${setter}
${lifecycle.supportSource}
export function open(): i32 { __pulse_invocation_begin(0); return unchecked(__pulse_invocation_tickets[0]) }
export function settle(ticket: i32): i32 { return __pulse_invocation_settle(0, ticket, 7) }
export function settleOther(ticket: i32): i32 { return __pulse_invocation_settle(1, ticket, 7) }
export function close(): void { __pulse_invocation_close() }
export function drive(ticket: i32): void { __pulse_invocation_settle(0, ticket, 7); ${lifecycle.site('invocation-end')} __pulse_invocation_close() }
export function setMode(value: i32): void { mode = value }
export function getTrace(): i32 { return trace }
export function getTicket(): i32 { return unchecked(__pulse_invocation_tickets[0]) }
export function getDeliveries(): i32 { return deliveries }
export function getAccepted(): i32 { return acceptedValue }
export function getCleanups(): i32 { return cleanups }
`);
  lifecycle.assertSites();
  const fresh = () => new WebAssembly.Instance(module, {}).exports;
  require('../support/execution-lifecycle-conformance.cjs').runDeliveryConformance(() => {
    const x = fresh(), ticket = x.open();
    return {
      mode: x.setMode, settle: () => x.settle(ticket), close: x.close, cleanupCount: x.getCleanups,
      trace: () => x.getTrace() === 0 ? '' : String(x.getTrace()), accepted: x.getAccepted,
      rejectInvalid() { for (const invalid of [0, -1, ticket + 1]) assert.equal(x.settle(invalid), 0); assert.equal(x.settleOther(ticket), 0); },
      assertPending() { assert.equal(x.getTicket(), ticket); },
      assertConsumed() { assert.equal(x.getTicket(), 0); assert.equal(x.settle(ticket), 0); }
    };
  }, check);

  check('authenticates before service guards and ticket consumption', () => {
    const x = fresh(), ticket = x.open();
    for (const value of [0, -1, ticket + 1]) assert.equal(x.settle(value), 0);
    assert.equal(x.settleOther(ticket), 0); assert.equal(x.getTrace(), 0); assert.equal(x.getTicket(), ticket); assert.equal(x.getDeliveries(), 0);
    assert.equal(x.settle(ticket), 1); assert.equal(x.getTicket(), 0); assert.equal(x.getTrace(), 123456); assert.equal(x.getAccepted(), 1);
    assert.equal(x.settle(ticket), 0); assert.equal(x.getDeliveries(), 1);
  });
  check('guard rejection retains the active ticket for a valid retry', () => {
    const x = fresh(), ticket = x.open(); x.setMode(3); assert.equal(x.settle(ticket), 0); assert.equal(x.getTicket(), ticket); assert.equal(x.getDeliveries(), 0);
    x.setMode(0); assert.equal(x.settle(ticket), 1);
  });
  check('repeated sites receive fresh tickets and reject stale visits', () => {
    const x = fresh(), old = x.open(); x.settle(old); const next = x.open(); assert.ok(next > old); assert.equal(x.settle(old), 0); assert.equal(x.getTicket(), next); assert.equal(x.settle(next), 1);
  });
  check('rejected delivery consumes once and still runs reverse after notifications', () => {
    const x = fresh(), ticket = x.open(); x.setMode(1); assert.equal(x.settle(ticket), 0); assert.equal(x.getTrace(), 123456); assert.equal(x.getAccepted(), 0); assert.equal(x.getTicket(), 0); assert.equal(x.settle(ticket), 0);
  });
  check('trapped delivery consumes once and skips after/end/closed notifications', () => {
    const x = fresh(), ticket = x.open(); x.setMode(2); assert.throws(() => x.drive(ticket), WebAssembly.RuntimeError); assert.equal(x.getTrace(), 1234); assert.equal(x.getTicket(), 0); assert.equal(x.getCleanups(), 0); assert.equal(x.settle(ticket), 0);
  });
  check('trapped before notification skips delivery and every after notification', () => {
    const x = fresh(), ticket = x.open(); x.setMode(4); assert.throws(() => x.drive(ticket), WebAssembly.RuntimeError); assert.equal(x.getTrace(), 12); assert.equal(x.getTicket(), 0); assert.equal(x.getDeliveries(), 0); assert.equal(x.getCleanups(), 0);
  });
  check('normal end precedes closure and closed cleanup sees invalidated tickets', () => {
    const x = fresh(); x.drive(x.open()); assert.equal(x.getTrace(), 123456978); assert.equal(x.getCleanups(), 1);
    x.close(); assert.equal(x.getCleanups(), 1); assert.equal(x.open(), 0); assert.equal(x.pulse_set_effect_result(0, 7), 0); assert.equal(x.getDeliveries(), 1);
  });
  check('closure invalidates an outstanding result without delivery', () => {
    const x = fresh(), ticket = x.open(); x.close(); assert.equal(x.getTrace(), 78); assert.equal(x.getTicket(), 0); assert.equal(x.settle(ticket), 0); assert.equal(x.getDeliveries(), 0);
  });

  const dispatch = createLifecycleEmitter({
    bindings: { version: 'pulse.lifecycle-bindings.v1', executionVersion: 'pulse.execution-lifecycle.v1', httpVersion: 'pulse.http-lifecycle.v1', sites: [
      { id: 'guard', points: [{ point: 'effect.result', parameters: { effect: 'effect', result: 'result' }, reject: 'reject' }] },
      { id: 'claim', points: [{ point: 'result.claim', parameters: { result: 'result' }, onClaim: 'claimed' }] }
    ] },
    contributions: ['effect.result', 'result.claim'].flatMap(point => [1, 2, 3].map(order => ({ point, owner: 'owner' + order, order }))),
    implementations: ['effect.result', 'result.claim'].flatMap(point => [1, 2, 3].map(order => ({ point, owner: 'owner' + order, body: `trace = trace * 10 + ${order}; return ${point === 'effect.result' ? 'mode != ' : 'mode == '}${order};` }))),
    values: { effect: { name: 'effect', type: 'i32' }, result: { name: 'result', type: 'i32' } }, actions: { reject: 'return 0;', claimed: 'return 1;' }
  });
  const composition = compile('composition', `
let trace: i32 = 0, mode: i32 = 0;
${dispatch.source}
export function guard(effect: i32, result: i32): i32 { ${dispatch.site('guard')} return 1 }
export function claim(result: i32): i32 { ${dispatch.site('claim')} return 0 }
export function setMode(value: i32): void { mode = value; trace = 0 }
export function getTrace(): i32 { return trace }
`);
  dispatch.assertSites();
  check('compiled guards and claims short circuit in numeric contribution order', () => {
    const x = new WebAssembly.Instance(composition, {}).exports;
    for (const [mode, expected] of [[0, 123], [1, 1], [2, 12], [3, 123]]) {
      x.setMode(mode); assert.equal(x.guard(0, 0), mode === 0 ? 1 : 0); assert.equal(x.getTrace(), expected);
      x.setMode(mode); assert.equal(x.claim(0), mode === 0 ? 0 : 1); assert.equal(x.getTrace(), expected);
    }
  });

  const http = compile('authority', `
const PULSE_ERROR_STATE: i32 = 1007;
let mode: i32 = 0, sends: i32 = 0;
function __pulse_fastly_fail(code: i32, stage: i32, effect: i32): void {}
function __pulse_response_send_raw(handle: i32, body: i32, streaming: i32): i32 { sends++; if (mode == 2) unreachable(); return mode == 1 ? 7 : 0 }
${authority.runtimeSource()}
export function send(streaming: i32): i32 { return fastly_http_resp_send_downstream(1, 2, streaming) }
export function setMode(value: i32): void { mode = value }
export function state(): i32 { return __pulse_response_authority }
export function count(): i32 { return sends }
export function complete(): void { __pulse_response_complete() }
export function transfer(): void { __pulse_response_transferred() }
`);
  for (const [mode, streaming, state] of [[0, 0, 3], [0, 1, 2], [1, 0, 1], [1, 1, 1], [2, 0, 1], [2, 1, 1]]) check(`HTTP authority outcome ${mode}/${streaming}`, () => {
    const x = new WebAssembly.Instance(http, {}).exports; x.complete(); x.transfer(); assert.equal(x.state(), 0); x.setMode(mode);
    if (mode === 2) assert.throws(() => x.send(streaming), WebAssembly.RuntimeError); else assert.equal(x.send(streaming), mode === 1 ? 7 : 0);
    assert.equal(x.state(), state); x.setMode(0); assert.equal(x.send(0), 1007); assert.equal(x.count(), 1);
    x.complete(); assert.equal(x.state(), state === 2 ? 3 : state);
  });

  const plan = buildCanonicalNativePlan(compileCanonicalSource(`export default async function handler(ctx){ const value=await ctx.config.get('MODE');return ctx.text(value) }`));
  const note = digit => `__pulse_fastly_jwt_secret_calls = __pulse_fastly_jwt_secret_calls * 10 + ${digit};`;
  const realServices = [hook('request.acquired', note(1)), hook('effect.settle', note(2) + 'return true'),
    { point: 'effect.deliver', owner: 'test', order: 0, before: note(3), after: note(5) + '__pulse_fastly_jwt_clock_calls = accepted;' },
    hook('effect.result', note(4) + 'return !__pulse_invocation_closed'), hook('result.claim', note(9) + 'return false'),
    hook('response.error', '__pulse_fastly_jwt_crypto_calls++; return false'),
    hook('invocation.end', note(6)), hook('invocation.close', note(7)), hook('invocation.closed', note(8))];
  const options = { cwd: root, bindings: { configStore: 'config' }, maxDurationMs: 1000, lifecycleServices: realServices, emitWat: false };
  const native = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, options);
  check('real Fastly driver and canonical setter execute all structural normal-return points', () => {
    const result = execute(native, { configStore: 'config', config: { MODE: 'ok' } });
    assert.equal(result.response.body, 'ok'); assert.equal(result.instance.exports.pulse_fastly_jwt_secret_calls(), 123459678); assert.equal(result.instance.exports.pulse_fastly_jwt_clock_calls(), 1);
    assert.equal(result.instance.exports.pulse_set_effect_result(0, 0), 0);
    assert.equal(result.trace.filter(x => x.name === 'send_downstream').length, 1);
  });
  check('authority fences ordinary, error and timeout handling in the actual generated driver', () => {
    const unknown = [...realServices.filter(x => x.point !== 'request.acquired'), hook('request.acquired', '__pulse_response_begin();')];
    const fenced = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { ...options, lifecycleServices: unknown });
    // The model cannot return an HTTP result when the authority fence forbids one.
    for (const host of [
      { configStore: 'config', config: { MODE: 'ok' } },
      { configStore: 'missing', config: { MODE: 'ok' } },
      { configStore: 'config', config: { MODE: 'ok' }, hostcallDelayMs: { 'fastly_config_store.get': 1001 } }
    ]) assert.throws(() => execute(fenced, host), error => {
      assert.ok(error.detail?.trace); assert.equal(error.detail.trace.filter(x => x.name === 'send_downstream').length, 0); return true;
    });
    const errorEntry = fenced.source.slice(fenced.source.indexOf('function __pulse_fastly_jwt_send_error()'), fenced.source.indexOf('function __pulse_fastly_jwt_send_error_impl()'));
    assert.ok(errorEntry.indexOf('response_authority') < errorEntry.indexOf('response_error'));
    assert.doesNotMatch(errorEntry, /__pulse_header_send_error|__pulse_body_send_error|__pulse_fetch_send_error|__request_check/);
  });
  check('registration permutations preserve generated source and Wasm', () => {
    const reversed = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { ...options, lifecycleServices: [...realServices].reverse() });
    assert.equal(reversed.source, native.source); assert.deepEqual(reversed.wasm, native.wasm);
  });
  check('empty services preserve source, Wasm and imports and emit no lifecycle machinery', () => {
    const plain = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { ...options, lifecycleServices: [] });
    const absent = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: root, bindings: options.bindings, maxDurationMs: 1000, emitWat: false });
    assert.equal(plain.source, absent.source); assert.deepEqual(plain.wasm, absent.wasm); assert.deepEqual(plain.inspection.imports, absent.inspection.imports); assert.doesNotMatch(plain.source, /__pulse_lifecycle_|__pulse_response_authority/);
  });
  check('unbound package-owned emitters fail closed before generation', () => {
    assert.throws(() => create({ packages: { application: {} } }, {}, [hook('invocation.end', '')]), { code: 'PULSE_FASTLY_LIFECYCLE_HOOK_INVALID' });
  });
  check('missing AS implementation, types, actions and structural sites reject', () => {
    const bindings = { version: 'pulse.lifecycle-bindings.v1', executionVersion: 'pulse.execution-lifecycle.v1', sites: [{ id: 'test', points: [{ point: 'effect.result', parameters: { effect: 'effect', result: 'result' }, reject: 'reject' }] }] };
    const input = { bindings, contributions: [{ point: 'effect.result', owner: 'test', order: 0 }], implementations: [{ point: 'effect.result', owner: 'test', body: 'return true' }], values: { effect: { name: 'index', type: 'i32' }, result: { name: 'value', type: 'i32' } }, actions: { reject: 'return 0;' } };
    for (const change of [{ implementations: [] }, { values: {} }, { actions: {} }]) assert.throws(() => createLifecycleEmitter({ ...input, ...change }), { code: 'PULSEWASM_LIFECYCLE_EMISSION_INVALID' });
    const emitter = createLifecycleEmitter(input); assert.throws(() => emitter.assertSites(), /not emitted/); assert.throws(() => emitter.site('unknown'), /Unknown structural/); emitter.site('test'); emitter.assertSites();
  });
  console.log(`ok - ${count} compiled Fastly lifecycle cases; injected-host and emitted-template evidence, not hosted acceptance`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
