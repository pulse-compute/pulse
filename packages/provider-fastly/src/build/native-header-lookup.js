'use strict';

function runtimeSource() {
  return `
@external("fastly_http_resp", "header_values_get")
declare function __pulse_response_header_values(handle: i32, name: usize, length: i32, buffer: usize, size: i32, cursor: i32, end: usize, written: usize): i32
function __pulse_header_lookup_failed(): bool {
  return __pulse_fastly_last_error == PULSE_ERROR_HOSTCALL && (__pulse_fastly_error_stage == 22 || __pulse_fastly_error_stage == 23);
}
function __pulse_header_lookup(handle: i32, name: string, response: bool): string | null {
  const key = __pulse_fastly_utf8(name), buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES);
  const end = new StaticArray<i64>(1), written = new StaticArray<i32>(1);
  written[0] = -1;
  // The single-value getter reports INVALID_ARGUMENT for absence on Viceroy.
  // The list ABI distinguishes no values (zero bytes) from an empty value (NUL).
  const status = response
    ? __pulse_response_header_values(handle, changetype<usize>(key), key.byteLength, buffer.dataStart, buffer.length, 0, changetype<usize>(end), changetype<usize>(written))
    : __pulse_request_header_values(handle, changetype<usize>(key), key.byteLength, buffer.dataStart, buffer.length, 0, changetype<usize>(end), changetype<usize>(written));
  const count = written[0], next = end[0];
  if (status == FASTLY_STATUS_OK && count == 0 && (next == -1 || next == 0)) return null;
  if (status != FASTLY_STATUS_OK || count <= 0 || count > buffer.length
    || (next != -1 && (next <= 0 || next > 4294967295)) || buffer[count - 1] != 0) {
    __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, response ? 23 : 22, -1); return null;
  }
  // Pulse's singular accessor returns the first value, including an empty one.
  for (let i = 0; i < count; i++) {
    if (buffer[i] == 0) return String.UTF8.decodeUnsafe(buffer.dataStart, i, false);
  }
  __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, response ? 23 : 22, -1); return null;
}
function __pulse_header_send_error(): bool {
  if (!__pulse_header_lookup_failed()) return false;
  const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE;
  output.status = 500; output.text = "Internal Server Error";
  output.headers.push(new __PulseFastlyHeader("content-type", "text/plain; charset=utf-8"));
  // Keep the original hostcall stage available to diagnostics.
  __pulse_fastly_send_result(__pulse_fastly_put(output));
  return true;
}
`;
}
function instrument(source) {
  source = source.replace(/function (host_\w+)\(([^)]*)\): (i32|void) \{/g,
    (declaration, name, _args, result) => name === 'host_router_error_take' ? declaration
      : `${declaration} if (__pulse_header_lookup_failed()) return${result === 'void' ? '' : ' 0'};`);
  const marker = 'function __pulse_fastly_jwt_send_error(): void {';
  if (!source.includes(marker)) throw new Error('Fastly header-lookup error boundary drift.');
  return source.replace(marker, marker + ' if (__pulse_header_send_error()) return;');
}
module.exports = {runtimeSource, instrument};
