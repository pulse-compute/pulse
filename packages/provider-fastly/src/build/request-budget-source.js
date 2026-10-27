'use strict';

function runtimeSource(lifecycle, forwarding = false, fetchAccounting = false, cacheAccounting = false) {
  const name = lifecycle?.legacyName('__request_send_timeout') || '__request_send_timeout';
  return `// Provider-owned request lifecycle. No wall time or caller header grants time.
@external('fastly_async_io', 'select') declare function __request_select(handles: usize, count: i32, timeout: i32, done: usize): i32
let __request_deadline: i64 = -1;
let __request_last_clock: i64 = -1;
let __request_expired: bool = false;
let __request_error_response: bool = false;
export function pulse_fastly_request_expired(): i32 { return __request_expired ? 1 : 0; }
const __request_clock_result = new StaticArray<i64>(1);
function __request_clock(): i64 {
  const out = __request_clock_result;
  if (wasi_snapshot_preview1_clock_time_get(1, 1, changetype<usize>(out)) != 0 || out[0] < __request_last_clock) {
    __request_expired = true;
    return -1;
  }
  __request_last_clock = out[0];
  return out[0];
}
function __request_remaining(): i32 {
  if (__request_expired) return 0;
  const now = __request_clock();
  if (now < 0 || now >= __request_deadline) { __request_expired = true; return 0; }
  return i32((__request_deadline - now + 999999) / 1000000);
}
function __request_check(index: i32 = -1): bool {
  if (__request_error_response) return true;
  if (__request_remaining() > 0) return true;
  __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 260, index);
  return false;
}
${fetchAccounting || cacheAccounting ? 'const __request_wait_handles = new StaticArray<i32>(1), __request_wait_ready = new StaticArray<i32>(1);' : ''}
function __request_wait(handle: i32, index: i32): bool {
  const remaining = __request_remaining();
  if (remaining <= 0) return __request_check(index);
  const handles = ${fetchAccounting || cacheAccounting ? '__request_wait_handles' : 'new StaticArray<i32>(1)'}, ready = ${fetchAccounting || cacheAccounting ? '__request_wait_ready' : 'new StaticArray<i32>(1)'};
  handles[0] = handle;
  const status = __request_select(changetype<usize>(handles), 1, remaining, changetype<usize>(ready));
  if (status != 0) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 261, index); return false; }
${cacheAccounting ? '  if (ready[0] != 0 && ready[0] != -1) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 261, index); return false; }\n' : ''}  if (ready[0] == -1) __request_expired = true;
  return __request_check(index);
}
${lifecycle?.active ? `function __request_send_timeout(): void {\n${lifecycle.site('response-timeout')}\n  ${name}()\n}\n` : ''}function ${name}(): void {
${cacheAccounting ? '  if (__cache_error()) return;\n' : ''}${fetchAccounting ? '  if (__fca_error()) return;\n' : ''}${forwarding ? '  if (__fwd_ra !== null) { __fwd_fail(504); __fwd_error_response(); return; }\n' : ''}  // A timeout says nothing about remote acceptance of dispatched writes.
  __request_error_response = true;
  __pulse_fastly_last_error = 0;
  const options = host_value_object();
  host_value_object_set(options, __pulse_fastly_string_value('status'), host_value_number(504.0));
  const response = host_response_text(__pulse_fastly_string_value('Gateway Timeout'), options);
  __pulse_fastly_last_error = 0;
  const status = __pulse_fastly_send_result(response);
  if (status != 0) __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 262, -1);
}
`;
}
module.exports = { runtimeSource };
