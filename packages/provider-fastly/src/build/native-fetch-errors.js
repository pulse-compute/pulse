'use strict';

function runtimeSource(dynamic = false) {
  return `
@external("fastly_http_req", "close")
declare function __pulse_fetch_close_request(handle: i32): i32
@external("fastly_http_body", "close")
declare function __pulse_fetch_close_body(handle: i32): i32
function __pulse_fetch_fail(status: i32, stage: i32, effect: i32): void {
  // Fastly ERROR and HTTP parse/user/incomplete/size/status errors represent
  // failed exchanges. Invalid arguments, handles and unsupported ABI stay fatal.
  const network = __pulse_fastly_effect_kind(effect) != 1 || status == 1 || status == 7 || status == 8 || status == 9 || status == 11 || status == 12;
  if (__pulse_fastly_last_error == 0) __pulse_transport_error = __pulse_transport_slots[effect];
  __pulse_fastly_fail(network ? PULSE_ERROR_TRANSPORT : PULSE_ERROR_HOSTCALL, stage, effect);
}
function __pulse_fetch_failed(): bool {
  return (__pulse_fastly_last_error == PULSE_ERROR_TRANSPORT || __pulse_fastly_last_error == PULSE_ERROR_HOSTCALL || __pulse_fastly_last_error == PULSE_ERROR_VALUE)
    && (__pulse_fastly_error_stage == 77 || __pulse_fastly_error_stage == 81 || (__pulse_fastly_error_stage >= 270 && __pulse_fastly_error_stage <= ${dynamic ? 276 : 272}))
    && __pulse_fastly_effect_kind(__pulse_fastly_error_effect) == 1;
}
function __pulse_fetch_send_error(): bool {
  if (!__pulse_fetch_failed()) return false;
  const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE;
  const network = __pulse_fastly_last_error == PULSE_ERROR_TRANSPORT;
  output.status = ${dynamic ? '__pulse_fastly_error_stage == 273 ? 400 : ' : ''}__pulse_fastly_error_stage == 270 ? 400 : __pulse_fastly_error_stage == 271 ? 504 : network ? 502 : 500;
  output.text = ${dynamic ? '__pulse_fastly_error_stage == 273 ? "Unsupported or invalid Native dynamic URL" : __pulse_fastly_error_stage == 274 ? "Dynamic Backends unavailable; enable the Fastly service capability" : __pulse_fastly_error_stage == 275 ? "Dynamic backend registration failed; check service configuration" : __pulse_fastly_error_stage == 276 ? "Dynamic backend registration attempt limit exceeded" : ' : ''}__pulse_fastly_error_stage == 270 ? "Invalid fetch timeoutMs" : __pulse_fastly_error_stage == 271 ? "Gateway Timeout" : network ? "Bad Gateway" : "Internal Server Error";
  output.headers.push(new __PulseFastlyHeader("content-type", "text/plain; charset=utf-8"));
  __pulse_fastly_send_result(__pulse_fastly_put(output));
  return true;
}
`;
}
function instrument(source, lifecycle) {
  const marker = `function ${lifecycle?.legacyName('__pulse_fastly_jwt_send_error') || '__pulse_fastly_jwt_send_error'}(): void {`;
  if (!source.includes(marker)) throw new Error('Fastly fetch error boundary drift.');
  return source.replace(marker, marker + ' if (__pulse_fetch_send_error()) return;');
}
module.exports = {runtimeSource, instrument};
