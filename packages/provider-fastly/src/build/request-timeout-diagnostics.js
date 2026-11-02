'use strict';

// Internal provider diagnostic, not an application log or an acceptance receipt.
// Only compile-time operation kinds and numeric execution state may be serialized.
function runtimeSource(plan, durationMs) {
  if (!Number.isInteger(durationMs) || durationMs <= 0 || durationMs > 2147483647) {
    throw new TypeError('Timeout diagnostics require a normalized request duration.');
  }
  const kinds = new Map();
  for (const [index, effect] of plan.effects.entries()) {
    const kind = typeof effect.kind === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(effect.kind) ? effect.kind : 'other';
    if (!kinds.has(kind)) kinds.set(kind, []);
    kinds.get(kind).push(index);
  }
  const cases = [...kinds].map(([kind, indices]) =>
    indices.map(index => `    case ${index}:`).join('\n') + ` return ${JSON.stringify(kind)};`).join('\n');
  return String.raw`
// At most one <=1024-byte record per request through the existing configured sink.
// A caller ID is untrusted correlation only; it grants no time or authority.
let __request_diag_emitted: bool = false;
let __request_diag_origin: i64 = -1;
let __request_diag_probe: string = '';
const __request_diag_clock = new StaticArray<i64>(1);
const __request_diag_header = new Uint8Array(37);
const __request_diag_written = new StaticArray<i32>(1);
function __request_diag_reset(): void {
  __request_diag_emitted = false;
  __request_diag_origin = -1;
  __request_diag_probe = '';
}
function __request_diag_uuid(value: string): bool {
  if (value.length != 36 || value.charCodeAt(14) != 52) return false;
  const variant = value.charCodeAt(19);
  if (variant != 56 && variant != 57 && variant != 97 && variant != 98) return false;
  for (let i = 0; i < 36; i++) {
    const c = value.charCodeAt(i);
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != 45) return false;
    } else if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return true;
}
function __request_diag_capture_probe(): void {
  // Do not use the application's header accessor: diagnostics must not set its
  // error state. Oversize, missing, malformed and failed reads simply omit the ID.
  const name = String.UTF8.encode('x-pulse-probe-id', false);
  __request_diag_written[0] = -1;
  const status = fastly_http_req_header_value_get(__pulse_fastly_request_handle,
    changetype<usize>(name), name.byteLength, __request_diag_header.dataStart,
    __request_diag_header.length, changetype<usize>(__request_diag_written));
  if (status != 0 || __request_diag_written[0] != 36) return;
  const value = String.UTF8.decodeUnsafe(__request_diag_header.dataStart, 36, false);
  if (__request_diag_uuid(value)) __request_diag_probe = value;
}
function __request_diag_kind(index: i32): string {
  switch (index) {
${cases}
    default: return 'unknown';
  }
}
function __request_diag_emit(index: i32 = -1, phase: i32 = 0): void {
  if (__request_diag_emitted || !__request_expired) return;
  __request_diag_emitted = true;
  let pending = 0, sole = -1;
  for (let i = 0; i < PULSE_FASTLY_EFFECT_COUNT; i++) {
    if (unchecked(__pulse_invocation_tickets[i]) > 0) { pending++; sole = i; }
  }
  let attribution = 'checkpoint';
  if (index < 0 || index >= PULSE_FASTLY_EFFECT_COUNT) {
    index = pending == 1 ? sole : -1;
    attribution = index >= 0 ? 'sole-live-ticket' : 'unattributed';
  }
  const ticket = index >= 0 ? unchecked(__pulse_invocation_tickets[index]) : 0;
  // Pending slots may retain old values after delivery. Never interpret them
  // without a live invocation ticket, including repeated use of the same index.
  const mode = ticket > 0 ? unchecked(__pulse_fastly_pending_mode[index]) : -1;
  // The platform driver has a pending mode, not the legacy HTTP driver's
  // pending_active array. This is a local async-slot observation only.
  const active = ticket > 0 && mode == PULSE_FASTLY_PENDING_ASYNC ? 1 : 0;
  const dispatch = phase == 1 ? 'not-started'
    : ticket > 0 && active != 0 && mode == PULSE_FASTLY_PENDING_ASYNC ? 'async-slot-observed' : 'unknown';
  const settlement = phase == 3 && ticket > 0 ? 'settlement-entered'
    : ticket > 0 ? 'unsettled' : 'no-live-ticket';
  // Observe a fresh monotonic time without calling the budget mutator. Select
  // timeouts otherwise leave the budget's last clock at the start of the wait.
  let elapsed = 'null';
  __request_diag_clock[0] = -1;
  if (wasi_snapshot_preview1_clock_time_get(1, 1, changetype<usize>(__request_diag_clock)) == 0
      && __request_diag_origin >= 0 && __request_diag_clock[0] >= __request_diag_origin
      && __request_diag_clock[0] >= __request_last_clock) {
    elapsed = i64((__request_diag_clock[0] - __request_diag_origin) / 1000000).toString();
  }
  const probe = __request_diag_probe.length == 36 ? '"' + __request_diag_probe + '"' : 'null';
  const message = '{"event":"pulse.request-timeout.v1","probeId":' + probe
    + ',"elapsedMs":' + elapsed + ',"budgetMs":${durationMs},"timeoutStage":260'
    + ',"errorStage":' + __pulse_fastly_error_stage.toString()
    + ',"effectIndex":' + index.toString()
    + ',"effectKind":"' + __request_diag_kind(index) + '"'
    + ',"attribution":"' + attribution + '"'
    + ',"programCounter":' + pulse_program_counter().toString()
    + ',"pendingCount":' + pending.toString() + ',"pendingCountScope":"effect-tickets"'
    + ',"pendingMode":' + mode.toString() + ',"pendingActive":' + active.toString()
    + ',"phase":' + phase.toString()
    + ',"dispatchState":"' + dispatch + '","settlementState":"' + settlement + '"'
    + ',"remoteAcceptance":"unknown"}\n';
  const bytes = String.UTF8.encode(message, false);
  if (bytes.byteLength <= 1024) __pulse_fastly_write_stdout(bytes);
}
`;
}
module.exports = {runtimeSource};
