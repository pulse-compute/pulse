'use strict';

// Fastly's multi-value ABI returns NUL-delimited pages and an i64 next cursor
// (-1 marks completion). See https://docs.rs/fastly/latest/src/fastly/abi.rs.html
// Keep this independent of outbound response headers.
function runtimeSource() {
  return `
@external("fastly_http_req", "header_names_get")
declare function __pulse_request_header_names(handle: i32, buffer: usize, size: i32, cursor: i32, end: usize, written: usize): i32
@external("fastly_http_req", "header_values_get")
declare function __pulse_request_header_values(handle: i32, name: usize, length: i32, buffer: usize, size: i32, cursor: i32, end: usize, written: usize): i32
let __pulse_request_headers_snapshot: i32 = 0
let __pulse_request_headers_failed: bool = false
let __pulse_request_headers_bytes: i32 = 0
function __pulse_request_headers_fail(): void {
  __pulse_request_headers_failed = true;
  __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 24, -1);
}
function __pulse_request_header_list(name: string, names: bool): Array<string> {
  const output = new Array<string>();
  const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES);
  const end = new StaticArray<i64>(1), written = new StaticArray<i32>(1);
  const key = __pulse_fastly_utf8(name);
  let cursor: i64 = 0;
  let bytes = 0;
  for (let page = 0; page < 256; page++) {
    end[0] = 0; written[0] = -1;
    const status = names
      ? __pulse_request_header_names(__pulse_fastly_request_handle, buffer.dataStart, buffer.length, i32(cursor), changetype<usize>(end), changetype<usize>(written))
      : __pulse_request_header_values(__pulse_fastly_request_handle, changetype<usize>(key), key.byteLength, buffer.dataStart, buffer.length, i32(cursor), changetype<usize>(end), changetype<usize>(written));
    const count = written[0], next = end[0];
    if (status == FASTLY_STATUS_OK && count == 0 && cursor == 0 && next == 0) return output;
    if (status != FASTLY_STATUS_OK || count < 0 || count > buffer.length
      || (next != -1 && (next <= cursor || next > 4294967295 || count == 0))) {
      __pulse_request_headers_fail(); return output;
    }
    bytes += count;
    if (bytes > PULSE_FASTLY_BUFFER_BYTES) { __pulse_request_headers_fail(); return output; }
    let start = 0;
    for (let i = 0; i < count; i++) {
      if (buffer[i] != 0) continue;
      const size = i - start;
      // Count name bytes once per returned pair, including both terminators.
      if (!names) __pulse_request_headers_bytes += key.byteLength + size + 2;
      if (output.length >= 256 || (names && size == 0) || __pulse_request_headers_bytes > PULSE_FASTLY_BUFFER_BYTES) {
        __pulse_request_headers_fail(); return output;
      }
      output.push(String.UTF8.decodeUnsafe(buffer.dataStart + start, size, false));
      start = i + 1;
    }
    if (start != count) { __pulse_request_headers_fail(); return output; }
    if (next == -1) return output;
    cursor = next;
  }
  __pulse_request_headers_fail(); return output;
}
function __pulse_request_headers_read(): i32 {
  if (__pulse_request_headers_failed) { __pulse_request_headers_fail(); return 0; }
  if (__pulse_request_headers_snapshot != 0) return __pulse_request_headers_snapshot;
  const names = __pulse_request_header_list("", true);
  if (__pulse_request_headers_failed) return 0;
  const output = host_value_array();
  let pairs = 0;
  for (let n = 0; n < names.length; n++) {
    const name = names[n].toLowerCase();
    for (let previous = 0; previous < n; previous++) {
      if (names[previous].toLowerCase() == name) { __pulse_request_headers_fail(); return 0; }
    }
    const values = __pulse_request_header_list(name, false);
    if (__pulse_request_headers_failed) return 0;
    if (values.length == 0 || pairs + values.length > 256) { __pulse_request_headers_fail(); return 0; }
    pairs += values.length;
    for (let v = 0; v < values.length; v++) {
      const pair = host_value_array();
      host_value_array_push(pair, __pulse_fastly_string_value(name));
      host_value_array_push(pair, __pulse_fastly_string_value(values[v]));
      host_value_array_push(output, pair);
    }
  }
  __pulse_fastly_deep_freeze(output);
  __pulse_request_headers_snapshot = output;
  return output;
}
`;
}

function instrument(source, applicationErrors, used) {
  if (applicationErrors || !used) return source;
  return source.replace(/function (host_\w+)\(([^)]*)\): (i32|void) \{/g,
    (declaration, _name, _args, result) => `${declaration} if (__pulse_request_headers_failed) return${result === 'void' ? '' : ' 0'};`);
}

module.exports = { runtimeSource, instrument };
