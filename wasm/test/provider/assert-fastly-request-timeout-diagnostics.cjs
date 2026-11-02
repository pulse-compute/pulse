'use strict';

// Focused real-Wasm regression: actual budget, timeout diagnostic and stdio
// generators, with modeled surrounding provider operations. Not live evidence.
// Run: node wasm/test/provider/assert-fastly-request-timeout-diagnostics.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const build = path.resolve(__dirname, '../../..', 'packages/provider-fastly/src/build');
const budget = require(path.join(build, 'request-budget-source.js'));
const diagnostic = require(path.join(build, 'request-timeout-diagnostics.js'));
const {nativeStdioSource} = require(path.join(build, 'native-stdio.js'));
const plan = {effects: [{kind: 'fetch'}, {kind: 'kv.compareAndSwap'}, {kind: 's3.put'}, {kind: 'invalid"\nsecret'}]};
const probe = '12345678-1234-4abc-8def-123456789abc';

function fixture({lifecycle = false, forwarding = false, fetchAccounting = false} = {}) {
  const hooks = lifecycle ? {active: true, legacyName: () => '__legacy_request_send_timeout',
    site: () => '  for (let i = 0; i < PULSE_FASTLY_EFFECT_COUNT; i++) __pulse_invocation_tickets[i] = 0;'} : undefined;
  return `
@external('diag', 'clock') declare function wasi_snapshot_preview1_clock_time_get(id: i32, precision: i64, out: usize): i32;
@external('diag', 'header') declare function fastly_http_req_header_value_get(handle: i32, name: usize, length: i32, value: usize, capacity: i32, written: usize): i32;
const PULSE_FASTLY_EFFECT_COUNT: i32 = 4;
const PULSE_FASTLY_PENDING_ASYNC: i32 = 1;
const PULSE_ERROR_HOSTCALL: i32 = 1008;
let __pulse_fastly_request_handle: i32 = 1;
let __pulse_fastly_last_error: i32 = 0, __pulse_fastly_error_stage: i32 = 0, __pulse_fastly_error_effect: i32 = -1;
const __pulse_invocation_tickets = new StaticArray<i32>(4);
const __pulse_fastly_pending_mode = new StaticArray<i32>(4);
let status: i32 = 0, shortcut: bool = false;
let responseBody: string = '';
function __pulse_fastly_fail(code: i32, stage: i32, index: i32): void {
  if (__pulse_fastly_last_error == 0) { __pulse_fastly_last_error = code; __pulse_fastly_error_stage = stage; __pulse_fastly_error_effect = index; }
}
function pulse_program_counter(): i32 { return 97; }
function host_value_object(): i32 { return 1; }
function __pulse_fastly_string_value(text: string): i32 { if (text == 'Gateway Timeout') responseBody = text; return 1; }
function host_value_number(value: f64): i32 { return i32(value); }
function host_value_object_set(object: i32, key: i32, value: i32): void { status = value; }
function host_response_text(body: i32, options: i32): i32 { return 1; }
function __pulse_fastly_send_result(handle: i32): i32 { return __request_check() ? 0 : 1; }
class Forwarding {}
let __fwd_ra: Forwarding | null = null;
function __fwd_fail(value: i32): void { status = value; }
function __fwd_error_response(): void { responseBody = 'Gateway Timeout'; }
function __fca_error(): bool { if (shortcut) { status = 504; responseBody = 'Gateway Timeout'; } return shortcut; }
${nativeStdioSource}
${budget.runtimeSource(hooks, forwarding, fetchAccounting, true)}
${diagnostic.runtimeSource(plan, 10000)}
export function test_start(): void {
  __pulse_fastly_last_error = 0; __pulse_fastly_error_stage = 0; __pulse_fastly_error_effect = -1;
  status = 0; responseBody = ''; shortcut = false; __fwd_ra = null;
  for (let i = 0; i < 4; i++) { __pulse_invocation_tickets[i] = 0; __pulse_fastly_pending_mode[i] = 0; }
  __request_diag_reset(); __request_expired = false; __request_error_response = false; __request_last_clock = -1;
  __request_deadline = __request_clock() + i64(10000) * 1000000;
  __request_diag_origin = __request_last_clock;
  __request_diag_capture_probe();
}
export function test_slot(index: i32, ticket: i32, mode: i32): void {
  __pulse_invocation_tickets[index] = ticket; __pulse_fastly_pending_mode[index] = mode;
}
export function test_dispatch(index: i32): void { __request_diag_kv_dispatch(index); }
export function test_dispatch_reset(index: i32): void { __request_diag_kv_reset(index); }
export function test_check(index: i32, phase: i32): i32 { return __request_check(index, phase) ? 1 : 0; }
export function test_wait(index: i32): i32 { return __request_wait(12, index) ? 1 : 0; }
export function test_expire(): void { __request_expired = true; }
export function test_emit(index: i32, phase: i32): void { __request_diag_emit(index, phase); }
export function test_send(): void { __request_send_timeout(); }
export function test_forward(): void { __fwd_ra = new Forwarding(); }
export function test_shortcut(): void { shortcut = true; }
export function test_error(): void { __pulse_fastly_fail(1008, 123, 1); }
export function test_status(): i32 { return status; }
export function test_body_ok(): i32 { return responseBody == 'Gateway Timeout' ? 1 : 0; }
export function test_error_stage(): i32 { return __pulse_fastly_error_stage; }
export function test_last_clock(): i64 { return __request_last_clock; }
export function test_deadline(): i64 { return __request_deadline; }
`;
}

// The adapter must execute the same generated fixture. The default below compiles
// and instantiates real Wasm. External model adapters must label their result.
function exercise(create, label = 'compiled-wasm') {
  const results = [];
  const check = (name, fn) => { fn(); results.push({name, status: 'passed'}); };
  const make = options => {
    const h = create(fixture(options));
    h.now = 1000000000; h.header = probe; h.e.test_start(); return h;
  };
  const record = h => {
    assert.equal(h.writes.length, 1);
    assert.ok(Buffer.byteLength(h.writes[0]) <= 1024);
    assert.equal(h.writes[0].split('\n').length, 2);
    return JSON.parse(h.writes[0]);
  };
  check('9999 ms has no timeout or log; 10000 ms emits once and preserves 504', () => {
    const h = make(); h.now += 9999000000;
    assert.equal(h.e.test_check(-1, 0), 1); assert.equal(h.writes.length, 0);
    h.now += 1000000; assert.equal(h.e.test_check(-1, 0), 0);
    const r = record(h); assert.equal(r.elapsedMs, 10000); assert.equal(r.errorStage, 260);
    assert.equal(r.budgetMs, 10000); assert.equal(r.probeId, probe); assert.equal(r.remoteAcceptance, 'unknown');
    const deadline = h.e.test_deadline(); h.e.test_send(); h.e.test_send(); h.e.test_emit(-1, 0);
    assert.equal(h.e.test_deadline(), deadline); assert.equal(h.e.test_status(), 504); assert.equal(h.e.test_body_ok(), 1);
    assert.equal(h.writes.length, 1);
  });
  check('select expiry retains pending effect and observes fresh elapsed time', () => {
    const h = make(); h.e.test_slot(1, 8, 1); h.selectTimeout = true;
    assert.equal(h.e.test_wait(1), 0);
    const r = record(h); assert.equal(r.elapsedMs, 10000); assert.equal(r.effectIndex, 1);
    assert.equal(r.effectKind, 'kv.compareAndSwap'); assert.equal(r.pendingCount, 1);
    assert.equal(r.pendingCountScope, 'effect-tickets'); assert.equal(r.programCounter, 97);
    assert.equal(r.dispatchState, 'async-slot-observed'); assert.equal(r.settlementState, 'unsettled');
    assert.equal(r.phase, 2); assert.equal(Number(h.e.test_last_clock()), 1000000000);
    h.e.test_send(); assert.equal(h.e.test_status(), 504);
  });
  check('pre-begin expiry does not claim dispatch or acceptance', () => {
    const h = make(); h.now += 10000000000; h.e.test_check(2, 1);
    const r = record(h); assert.equal(r.effectKind, 's3.put'); assert.equal(r.dispatchState, 'not-started');
    assert.equal(r.pendingCount, 0); assert.equal(r.remoteAcceptance, 'unknown');
    assert.equal(r.requestElapsedAtDispatchMs, null); assert.equal(r.effectElapsedMs, null);
  });
  check('KV dispatch timing separates prior preparation from effect residence', () => {
    const h = make(); h.e.test_slot(1, 8, 1); h.now += 7000000000;
    const clock = h.e.test_last_clock(), deadline = h.e.test_deadline();
    h.e.test_dispatch(1);
    assert.equal(h.e.test_last_clock(), clock); assert.equal(h.e.test_deadline(), deadline);
    h.e.test_slot(1, 8, 0); h.now += 3000000000; h.e.test_check(1, 3);
    const r = record(h); assert.equal(r.elapsedMs, 10000);
    assert.equal(r.requestElapsedAtDispatchMs, 7000); assert.equal(r.effectElapsedMs, 3000);
    assert.equal(r.remoteAcceptance, 'unknown');
    const slow = make(); slow.e.test_slot(1, 1, 1); slow.e.test_dispatch(1);
    slow.now += 10000000000; slow.e.test_check(1, 3);
    assert.equal(record(slow).requestElapsedAtDispatchMs, 0); assert.equal(record(slow).effectElapsedMs, 10000);
  });
  check('reused, delivered and never-dispatched tickets cannot reuse timing', () => {
    for (const ticket of [0, 9]) {
      const h = make(); h.e.test_slot(1, 8, 1); h.e.test_dispatch(1);
      h.e.test_slot(1, ticket, 0); h.now += 10000000000; h.e.test_check(1, 3);
      const r = record(h); assert.equal(r.requestElapsedAtDispatchMs, null); assert.equal(r.effectElapsedMs, null);
    }
    const reset = make(); reset.e.test_slot(1, 8, 1); reset.e.test_dispatch(1); reset.e.test_dispatch_reset(1);
    reset.now += 10000000000; reset.e.test_check(1, 3); assert.equal(record(reset).effectElapsedMs, null);
    const again = make(); again.e.test_slot(1, 8, 1); again.e.test_dispatch(1);
    again.e.test_slot(1, 9, 1); again.now += 9000000000; again.e.test_dispatch(1);
    again.now += 1000000000; again.e.test_check(1, 3);
    assert.equal(record(again).requestElapsedAtDispatchMs, 9000); assert.equal(record(again).effectElapsedMs, 1000);
    const pre = make(); pre.e.test_slot(1, 8, 1); pre.e.test_dispatch(1);
    pre.now += 10000000000; pre.e.test_check(1, 1); assert.equal(record(pre).effectElapsedMs, null);
  });
  check('unreliable dispatch and snapshot clocks omit timing without changing budget', () => {
    for (const failure of [true, false]) {
      const h = make(); h.e.test_slot(1, 1, 1);
      const clock = h.e.test_last_clock(), deadline = h.e.test_deadline();
      h.clockError = failure; if (!failure) h.now--; h.e.test_dispatch(1);
      assert.equal(h.e.test_last_clock(), clock); assert.equal(h.e.test_deadline(), deadline);
      h.clockError = false; h.now = 11000000000; h.e.test_check(1, 3);
      assert.equal(record(h).effectElapsedMs, null); assert.equal(record(h).requestElapsedAtDispatchMs, null);
    }
    const h = make(); h.e.test_slot(1, 1, 1); h.now += 9500000000; h.e.test_dispatch(1);
    h.now -= 1000000000; h.e.test_expire(); h.e.test_emit(1, 3);
    assert.equal(record(h).effectElapsedMs, null);
  });
  check('settlement entry remains a local observation, not acceptance', () => {
    const h = make(); h.e.test_slot(2, 4, 0); h.now += 10000000000; h.e.test_check(2, 3);
    const r = record(h); assert.equal(r.settlementState, 'settlement-entered');
    assert.equal(r.dispatchState, 'unknown'); assert.equal(r.remoteAcceptance, 'unknown');
  });
  check('sole live ticket is attributed; multiple live tickets are not guessed', () => {
    const h = make(); h.e.test_slot(2, 7, 1); h.e.test_expire(); h.e.test_send();
    assert.equal(record(h).attribution, 'sole-live-ticket'); assert.equal(record(h).effectIndex, 2);
    const m = make(); m.e.test_slot(1, 1, 1); m.e.test_slot(2, 2, 1); m.e.test_expire(); m.e.test_send();
    const r = record(m); assert.equal(r.effectIndex, -1); assert.equal(r.pendingCount, 2); assert.equal(r.attribution, 'unattributed');
  });
  check('settled stale slots do not imply a live dispatch', () => {
    const h = make(); h.e.test_slot(1, 0, 1); h.now += 10000000000; h.e.test_check(1, 0);
    const r = record(h); assert.equal(r.pendingCount, 0); assert.equal(r.pendingMode, -1);
    assert.equal(r.dispatchState, 'unknown'); assert.equal(r.settlementState, 'no-live-ticket');
  });
  check('malformed, oversize, absent and failed probe reads are omitted', () => {
    for (const header of ['', 'x'.repeat(4000), probe + 'x', probe.toUpperCase(), 'Bearer secret.jwt.value',
      probe.replace('-4', '-1'), probe.replace('-8', '-c'), '"}\n{"token":"secret"', 'é'.repeat(18)]) {
      const h = make(); h.header = header; h.e.test_start(); h.now += 10000000000; h.e.test_check(-1, 0);
      assert.equal(record(h).probeId, null); assert.ok(!h.writes[0].includes('secret.jwt'));
    }
    const h = make(); h.headerError = true; h.e.test_start(); assert.equal(h.e.test_error_stage(), 0);
    h.now += 10000000000; h.e.test_check(-1, 0); assert.equal(record(h).probeId, null);
    assert.ok(h.headerNames.every(n => n === 'x-pulse-probe-id'));
  });
  check('new request resets log latch and does not retain prior correlation', () => {
    const h = make(); h.e.test_slot(1, 1, 1); h.e.test_dispatch(1);
    h.now += 10000000000; h.e.test_check(-1, 0); assert.equal(record(h).probeId, probe);
    h.writes.length = 0; h.header = ''; h.e.test_start(); h.now += 10000000000; h.e.test_check(-1, 0);
    assert.equal(record(h).probeId, null); assert.equal(record(h).effectElapsedMs, null);
  });
  check('diagnostic clock failure or regression emits null without mutating budget', () => {
    for (const failure of [true, false]) {
      const h = make(); const clock = h.e.test_last_clock(), deadline = h.e.test_deadline();
      h.e.test_expire(); h.clockError = failure; if (!failure) h.now--;
      h.e.test_send(); assert.equal(record(h).elapsedMs, null);
      assert.equal(h.e.test_last_clock(), clock); assert.equal(h.e.test_deadline(), deadline); assert.equal(h.e.test_status(), 504);
    }
  });
  check('logging failure, zero and short writes never retry or change the 504', () => {
    for (const mode of ['failure', 'zero', 'short']) {
      const h = make(); h.logMode = mode; h.now += 10000000000; h.e.test_check(0, 0); h.e.test_send();
      assert.equal(h.writeAttempts, 1); assert.equal(h.e.test_status(), 504); assert.equal(h.e.test_body_ok(), 1);
    }
  });
  check('lifecycle timeout hook cannot erase state before diagnostic snapshot', () => {
    const h = make({lifecycle: true}); h.e.test_slot(2, 4, 1); h.e.test_expire(); h.e.test_send();
    assert.equal(record(h).pendingCount, 1); assert.equal(record(h).effectIndex, 2); assert.equal(h.e.test_status(), 504);
  });
  check('forwarding and accounting early returns still emit exactly once', () => {
    const f = make({forwarding: true}); f.e.test_forward(); f.e.test_expire(); f.e.test_send(); record(f); assert.equal(f.e.test_status(), 504);
    const a = make({fetchAccounting: true}); a.e.test_shortcut(); a.e.test_expire(); a.e.test_send(); record(a); assert.equal(a.e.test_status(), 504);
  });
  check('existing primary error is preserved in the diagnostic', () => {
    const h = make(); h.e.test_error(); h.now += 10000000000; h.e.test_check(1, 0);
    const r = record(h); assert.equal(r.errorStage, 123); assert.equal(r.timeoutStage, 260);
  });
  check('unsafe effect labels cannot inject log content', () => {
    const h = make(); h.now += 10000000000; h.e.test_check(3, 0);
    const r = record(h); assert.equal(r.effectKind, 'other'); assert.ok(!h.writes[0].includes('secret'));
  });
  return {mode: label, status: 'passed', cases: results, count: results.length,
    scope: 'Generated request-budget/diagnostic/stdio fixture; modeled surrounding provider, not full application or live Fastly.'};
}

function nativeFactory(directory) {
  let asc;
  try { asc = require.resolve('assemblyscript/bin/asc.js', {paths: [path.resolve(__dirname, '../../packages/compiler'), process.cwd()]}); }
  catch { throw new Error('Pinned AssemblyScript compiler is unavailable; install the repository toolchain. No model fallback is performed.'); }
  const compiled = new Map();
  return source => {
    let bytes = compiled.get(source);
    if (!bytes) {
      const input = path.join(directory, 'fixture.ts'), output = path.join(directory, 'fixture.wasm');
      fs.writeFileSync(input, source);
      execFileSync(process.execPath, [asc, input, '--outFile', output, '--runtime', 'incremental', '--optimize', '--exportRuntime'],
        {stdio: 'pipe', timeout: 120000, maxBuffer: 4 * 1024 * 1024});
      bytes = fs.readFileSync(output); compiled.set(source, bytes);
    }
    const h = {now: 0, header: '', headerNames: [], writes: [], writeAttempts: 0};
    let memory;
    const dv = () => new DataView(memory.buffer);
    const utf8 = (p, n) => Buffer.from(memory.buffer, p, n).toString('utf8');
    const imports = {
      env: {abort: () => {throw new Error('AssemblyScript fixture aborted');}},
      diag: {
        clock: (_id, _precision, out) => { if (h.clockError) return 1; dv().setBigInt64(out, BigInt(h.now), true); return 0; },
        header: (_req, name, len, out, cap, written) => {
          h.headerNames.push(utf8(name, len)); if (h.headerError) return 1;
          const b = Buffer.from(h.header); dv().setInt32(written, b.length, true);
          if (b.length > cap) return 4; new Uint8Array(memory.buffer, out, b.length).set(b); return 0;
        },
      },
      fastly_async_io: {select: (_handles, _count, timeout, ready) => {
        if (h.selectTimeout) h.now += timeout * 1000000;
        dv().setInt32(ready, h.selectTimeout ? -1 : 0, true); return 0;
      }},
      wasi_snapshot_preview1: {fd_write: (fd, iov, count, written) => {
        assert.equal(fd, 1); assert.equal(count, 1); h.writeAttempts++;
        const p = dv().getUint32(iov, true), n = dv().getUint32(iov + 4, true);
        if (h.logMode === 'failure') return 29;
        const writtenCount = h.logMode === 'zero' ? 0 : h.logMode === 'short' ? Math.min(n, 5) : n;
        h.writes.push(utf8(p, writtenCount)); dv().setUint32(written, writtenCount, true); return 0;
      }},
    };
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports);
    h.e = instance.exports; memory = h.e.memory; return h;
  };
}
function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-timeout-diagnostics-'));
  try { console.log(JSON.stringify(exercise(nativeFactory(directory)), null, 2)); }
  finally { fs.rmSync(directory, {recursive: true, force: true}); }
}
module.exports = {fixture, exercise, nativeFactory, main};
if (require.main === module) main();
