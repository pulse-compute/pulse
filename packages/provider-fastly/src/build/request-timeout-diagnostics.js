'use strict';

// Observation only: no policy, retry, result/settlement, or response authority.
// The snapshot must precede adapter waits: conditional KV/S3 can clear their
// generic pending slot before waiting. A ticket binds it to this invocation.
function instrument(source, durationMs) {
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error('Fastly timeout diagnostic boundary drift: ' + before.slice(0, 100));
    source = source.replace(before, after);
  };
  replace(`  __request_deadline = __request_clock() + i64(${durationMs}) * 1000000;`,
    `  __request_started_at = __request_clock();\n  __request_deadline = __request_started_at + i64(${durationMs}) * 1000000;`);
  replace('  __pulse_fastly_request_body_handle = load<i32>(changetype<usize>(handles) + 4)',
    '  __pulse_fastly_request_body_handle = load<i32>(changetype<usize>(handles) + 4)\n  __request_diag_read_id();');
  for (const [signature, index, phase, snapshot] of [
    ['function host_effect_begin(effectIndex: i32, payload: i32): void {', 'effectIndex', 1, false],
    ['function __pulse_fastly_resolve_effect(effectIndex: i32): i32 {', 'effectIndex', 2, true],
    ['function __pulse_fastly_ready_effect(effectIndex: i32, handle: i32): void {', 'effectIndex', 3, false],
    ['function __pulse_invocation_settle(index: i32, ticket: i32, result: i32): i32 {', 'index', 4, false]
  ]) replace(signature, signature + `\n  __request_diag_phase_at(${index}, ${phase}, ${snapshot});`);
  return source + '\n' + runtimeSource(durationMs,
    source.includes('const __kv_dispatched ='), source.includes('const __s3_dispatched ='));
}

function runtimeSource(durationMs, conditionalKv, s3) {
  return `
// Internal diagnostic schema, not an authoring API. Caller correlation is
// untrusted metadata; it grants neither authority nor additional request time.
let __request_started_at: i64 = -1;
let __request_diag_id: string = '';
let __request_diag_reported: bool = false;
let __request_diag_active: i32 = -1;
let __request_diag_phase: i32 = 0;
let __request_diag_wait_index: i32 = -1;
let __request_diag_wait_ticket: i32 = 0;
let __request_diag_wait_mode: i32 = 0;
function __request_diag_read_id(): void {
  // A single fixed-size lookup. Do not use the general header reader: it can
  // allocate by caller length or modify application error state on failure.
  const name = String.UTF8.encode('x-pulse-diagnostic-id', false);
  const bytes = new Uint8Array(36), written = new StaticArray<i32>(1);
  const status = fastly_http_req_header_value_get(__pulse_fastly_request_handle,
    changetype<usize>(name), name.byteLength, bytes.dataStart, 36, changetype<usize>(written));
  if (status != 0 || written[0] != 36) return;
  // Canonical lowercase UUIDv4 only; no truncation, escaping, or raw fallback.
  for (let i = 0; i < 36; i++) {
    const c = bytes[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != 45) return; }
    else if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return;
  }
  if (bytes[14] != 52 || !(bytes[19] == 56 || bytes[19] == 57 || bytes[19] == 97 || bytes[19] == 98)) return;
  __request_diag_id = String.UTF8.decodeUnsafe(bytes.dataStart, 36, false);
}
function __request_diag_phase_at(index: i32, phase: i32, snapshot: bool): void {
  if (__request_diag_reported || index < 0 || index >= PULSE_FASTLY_EFFECT_COUNT) return;
  __request_diag_active = index; __request_diag_phase = phase;
  if (phase == 1 && __request_diag_wait_index == index) __request_diag_wait_index = -1;
  if (snapshot) {
    __request_diag_wait_index = index;
    __request_diag_wait_ticket = unchecked(__pulse_invocation_tickets[index]);
    __request_diag_wait_mode = unchecked(__pulse_fastly_pending_mode[index]);
  }
}
function __request_timeout_observe(index: i32): void {
  if (!__request_expired || __request_diag_reported) return;
  // Set before any diagnostic hostcall; failures never retry or recurse.
  __request_diag_reported = true;
  const error = __pulse_fastly_last_error, stage = __pulse_fastly_error_stage;
  if (index < 0 || index >= PULSE_FASTLY_EFFECT_COUNT) {
    index = __request_diag_active;
    if (index < 0 || index >= PULSE_FASTLY_EFFECT_COUNT || unchecked(__pulse_invocation_tickets[index]) == 0) index = -1;
  }
  const valid = index >= 0 && index < PULSE_FASTLY_EFFECT_COUNT;
  const ticket = valid ? unchecked(__pulse_invocation_tickets[index]) : 0;
  const kind = valid ? __pulse_fastly_effect_kind(index) : -1;
  const phase = valid && __request_diag_active == index ? __request_diag_phase : 0;
  const pendingMode = valid ? unchecked(__pulse_fastly_pending_mode[index]) : 0;
  const observedPending = valid && ticket > 0 && (pendingMode == PULSE_FASTLY_PENDING_ASYNC ||
    (__request_diag_wait_index == index && __request_diag_wait_ticket == ticket && __request_diag_wait_mode == PULSE_FASTLY_PENDING_ASYNC));
  let dispatch = observedPending ? 'pending-handle-observed' : 'not-observed';
  // Entry flags are conservative evidence of dispatch, never remote acceptance.
  ${conditionalKv ? "if (valid && ticket > 0 && phase != 1 && (kind == 16 || kind == 17 || kind == 22) && unchecked(__kv_dispatched[index])) dispatch = 'mutation-entered';" : ''}
  ${s3 ? "if (valid && ticket > 0 && phase != 1 && (kind == 12 || kind == 13 || kind == 14 || kind == 21) && unchecked(__s3_dispatched[index])) dispatch = 'send-entered';" : ''}
  let elapsed = 'null';
  // Refresh once after expiry (select may have advanced the clock). A failed
  // or regressing clock remains unknown rather than inventing a duration.
  if (!__request_clock_invalid && __request_started_at >= 0) {
    const now = __request_clock();
    if (now >= __request_started_at) elapsed = ((now - __request_started_at) / 1000000).toString();
  }
  const correlation = __request_diag_id.length == 36 ? '"' + __request_diag_id + '"' : 'null';
  const phaseName = phase == 1 ? 'begin' : phase == 2 ? 'resolve' : phase == 3 ? 'ready' : phase == 4 ? 'settle' : 'boundary';
  const record = '{"schema":"pulse.fastly.request-timeout.v1","correlationId":' + correlation +
    ',"elapsedMs":' + elapsed + ',"budgetMs":${durationMs},"clockValid":' + (__request_clock_invalid ? 'false' : 'true') +
    ',"timeoutStage":260,"errorCode":' + error.toString() + ',"errorStage":' + stage.toString() +
    ',"effectIndex":' + index.toString() + ',"effectKind":' + kind.toString() +
    ',"programCounter":' + pulse_program_counter().toString() + ',"pendingCount":' + pulse_pending_count().toString() +
    ',"phase":"' + phaseName + '","dispatchState":"' + dispatch +
    '","settlementState":"' + (ticket > 0 ? 'not-delivered' : 'none') + '","remoteOutcome":"unknown"}\\n';
  const bytes = String.UTF8.encode(record, false);
  // Fixed fields, enums, integers and a UUID only. No payload/URL/key/secret
  // inspection and no unbounded history. The existing sink is best effort.
  if (bytes.byteLength <= 1024) __pulse_fastly_write_stdout(bytes);
}
`;
}

module.exports = { instrument, runtimeSource };
