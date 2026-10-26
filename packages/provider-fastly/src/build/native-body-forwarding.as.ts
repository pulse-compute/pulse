// FWD9-02: sequential upload/response pumps. Payload bytes never become Pulse
// values. Fixed scratch and ABI outputs are reused, including the clock slot.
// close accepts EOF into Fastly; it is not a delivery/drain receipt.
@external('fastly_http_req', 'send_async_streaming')
declare function __fwd_dispatch(request: i32, body: i32, backend: usize, length: i32, pending: usize): i32
@external('fastly_http_body', 'abandon') declare function __fwd_abandon(body: i32): i32
@external('fastly_async_io', 'is_ready') declare function __fwd_ready(handle: i32, ready: usize): i32
@external('fastly_http_resp', 'header_names_get')
declare function __fwd_names(handle: i32, buffer: usize, size: i32, cursor: i32, end: usize, written: usize): i32
@external('fastly_http_resp', 'header_values_get')
declare function __fwd_values(handle: i32, name: usize, length: i32, buffer: usize, size: i32, cursor: i32, end: usize, written: usize): i32
const __fwd_buffer: usize = memory.data(16384)
const __fwd_headers: usize = memory.data(16384)
const __fwd_pairs: usize = memory.data(1024) // 64 x (name ptr/size, value ptr/size)
const __fwd_io: usize = memory.data(128) // aligned reusable ABI outputs
const __fwd_detail: usize = __fwd_io + 8
const __fwd_done: usize = __fwd_detail + __PULSE_SEND_ERROR_DETAIL_BYTES
const __fwd_response_out: usize = __fwd_done + 4
const __fwd_body_out: usize = __fwd_response_out + 4 // ends at +40; next scratch field starts there
let __fwd_source: i32 = -1
let __fwd_upload: i32 = -1
let __fwd_request: i32 = -1
let __fwd_pending: i32 = -1
let __fwd_response: i32 = -1
let __fwd_body: i32 = -1
let __fwd_downstream: i32 = -1
let __fwd_output: i32 = -1
let __fwd_index: i32 = -1
let __fwd_result: i32 = 0
let __fwd_marker: i32 = 0
let __fwd_failure: i32 = 0
let __fwd_reserved: bool = false
let __fwd_header_count: i32 = 0
let __fwd_request_length: i32 = -1
let __fwd_response_length: i32 = -1
let __fwd_status: i32 = 200
function host_request_body(): i32 {
  if (__fwd_marker != 0 || __fwd_reserved) { __fwd_fail(400); return 0; }
  const marker = new __PulseFastlyValue(); marker.kind = 90;
  __fwd_marker = __pulse_fastly_put(marker); return __fwd_marker;
}
function __fwd_fail(status: i32): void {
  if (__fwd_failure == 0) __fwd_failure = status;
  __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 280, __fwd_index);
}
function __fwd_remaining(): i32 {
  if (__fwd_failure != 0) return 0;
  if (wasi_snapshot_preview1_clock_time_get(1, 1, __fwd_io) != 0) { __fwd_fail(504); return 0; }
  const now = load<i64>(__fwd_io);
  if (now < 0 || now < __request_last_clock || now < __pulse_fetch_last_clock) { __fwd_fail(504); return 0; }
  __request_last_clock = now; __pulse_fetch_last_clock = now;
  let remaining = f64(__request_deadline - now) / 1000000.0;
  if (__request_expired || remaining <= 0) { __request_expired = true; __fwd_fail(504); return 0; }
  if (__fwd_index >= 0) remaining = Math.min(remaining, __pulse_fetch_remaining(__fwd_index, now));
  if (remaining <= 0) { __fwd_fail(504); return 0; }
  return i32(Math.ceil(remaining)); // 1..30000; zero never reaches async.select
}
function __fwd_cleanup(): void {
  if (__fwd_source >= 0) { __pulse_fetch_close_body(__fwd_source); __fwd_source = -1; }
  if (__fwd_upload >= 0) { __fwd_abandon(__fwd_upload); __fwd_upload = -1; }
  if (__fwd_request >= 0) { __pulse_fetch_close_request(__fwd_request); __fwd_request = -1; }
  if (__fwd_body >= 0) { __pulse_fetch_close_body(__fwd_body); __fwd_body = -1; }
  if (__fwd_response >= 0) { __pulse_fetch_close_response(__fwd_response); __fwd_response = -1; }
  if (__fwd_output >= 0) { __pulse_fetch_close_response(__fwd_output); __fwd_output = -1; }
  if (__fwd_downstream >= 0) { __fwd_abandon(__fwd_downstream); __fwd_downstream = -1; }
  if (__fwd_pending >= 0) {
    // No pending-request cancel ABI. Poll once without waiting and discard any
    // late handles; an unresolved host operation ends at invocation teardown.
    __pulse_send_error_detail_reset(__fwd_detail);
    store<i32>(__fwd_done, 0);
    const status = __pulse_fetch_poll(__fwd_pending, __fwd_detail, __fwd_done, __fwd_response_out, __fwd_body_out);
    if (status == 0 && load<i32>(__fwd_done) == 1) {
      __pulse_fetch_close_response(load<i32>(__fwd_response_out)); __pulse_fetch_close_body(load<i32>(__fwd_body_out));
    }
    __fwd_pending = -1;
  }
}
function __fwd_error_response(): bool {
  if (!__pulse_response_owned()) { __fwd_cleanup(); return true; }
  if (__fwd_failure == 0) return false;
  const status = __fwd_failure;
  __fwd_cleanup(); __request_error_response = true;
  __pulse_fastly_last_error = 0;
  const value = new __PulseFastlyValue(); value.kind = PULSE_VALUE_RESPONSE; value.status = status;
  value.text = status == 413 ? 'Payload Too Large' : status == 504 ? 'Gateway Timeout' : status == 400 ? 'Bad Request' : 'Bad Gateway';
  __pulse_fastly_send_result(__pulse_fastly_put(value)); return true;
}
function __fwd_lower(byte: u8): u8 { return byte >= 65 && byte <= 90 ? byte + 32 : byte; }
function __fwd_equal(ptr: usize, size: i32, text: string): bool {
  if (size != text.length) return false;
  for (let i = 0; i < size; i++) if (__fwd_lower(load<u8>(ptr + i)) != text.charCodeAt(i)) return false;
  return true;
}
function __fwd_token(byte: u8): bool {
  return (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)
    || byte == 33 || byte == 35 || byte == 36 || byte == 37 || byte == 38 || byte == 39 || byte == 42
    || byte == 43 || byte == 45 || byte == 46 || byte == 94 || byte == 95 || byte == 96 || byte == 124 || byte == 126;
}
function __fwd_hop(ptr: usize, size: i32): bool {
  return __fwd_equal(ptr,size,'connection') || __fwd_equal(ptr,size,'keep-alive') || __fwd_equal(ptr,size,'proxy-connection')
    || __fwd_equal(ptr,size,'transfer-encoding') || __fwd_equal(ptr,size,'te') || __fwd_equal(ptr,size,'trailer')
    || __fwd_equal(ptr,size,'upgrade') || __fwd_equal(ptr,size,'content-length') || __fwd_equal(ptr,size,'host')
    || __fwd_equal(ptr,size,'proxy-authenticate') || __fwd_equal(ptr,size,'proxy-authorization');
}
// Decimal parsing stops at cap+1: huge declared sizes cannot overflow or wrap.
function __fwd_length(ptr: usize, size: i32, cap: i32): i32 {
  if (size == 0) return -2;
  let value = 0;
  for (let i = 0; i < size; i++) {
    const byte = load<u8>(ptr + i); if (byte < 48 || byte > 57) return -2;
    value = min(cap + 1, value * 10 + byte - 48);
  }
  return value;
}
function __fwd_declared_request(): bool {
  const name = memory.data<u8>([99,111,110,116,101,110,116,45,108,101,110,103,116,104]);
  store<i64>(__fwd_io + 40, -1); store<i32>(__fwd_io + 48, 0);
  const status = __pulse_request_header_values(__pulse_fastly_request_handle, name, 14, __fwd_headers, 16384, 0, __fwd_io + 40, __fwd_io + 48);
  const count = load<i32>(__fwd_io + 48);
  if (status != 0 || count < 0 || count > 16384 || (count > 0 && load<i64>(__fwd_io + 40) != -1)) { __fwd_fail(400); return false; }
  if (count == 0) return true;
  if (load<u8>(__fwd_headers + count - 1) != 0) { __fwd_fail(400); return false; }
  __fwd_request_length = __fwd_length(__fwd_headers, count - 1, __FWD_REQUEST_MAX);
  if (__fwd_request_length < 0) { __fwd_fail(400); return false; }
  if (__fwd_request_length > __FWD_REQUEST_MAX) { __fwd_fail(413); return false; }
  return true;
}
function __fwd_begin(index: i32, payload: __PulseFastlyValue): void {
  __fwd_index = index;
  const init = __pulse_fastly_value(__pulse_fastly_payload_field(payload, 'init'));
  if (__fwd_reserved || __fwd_source < 0 || __pulse_fastly_payload_field(init, 'body') != __fwd_marker || __fwd_marker == 0) { __fwd_fail(400); return; }
  __fwd_reserved = true;
  __pulse_fetch_begin_deadline(index, init);
  if (__pulse_fastly_last_error != 0 || !__fwd_remaining() || !__fwd_declared_request()) return;
  const url = __pulse_fastly_utf8(__pulse_fastly_string(__pulse_fastly_payload_field(payload, 'url')));
  const backend = __pulse_fastly_utf8(__pulse_fastly_backend(index));
  if (fastly_http_req_new(__fwd_io + 52) != 0) { __fwd_fail(502); return; }
  __fwd_request = load<i32>(__fwd_io + 52);
  if (fastly_http_body_new(__fwd_io + 52) != 0) { __fwd_fail(502); return; }
  __fwd_upload = load<i32>(__fwd_io + 52);
  const method = memory.data<u8>([80,79,83,84]);
  if (fastly_http_req_method_set(__fwd_request, method, 4) != 0 || fastly_http_req_uri_set(__fwd_request, changetype<usize>(url), url.byteLength) != 0) { __fwd_fail(502); return; }
  const headers = __pulse_fastly_value(__pulse_fastly_payload_field(init, 'headers'));
  let bytes = 0;
  if (headers.kind == PULSE_VALUE_OBJECT) for (let i = 0; i < headers.keys.length; i++) {
    const name = __pulse_fastly_utf8(headers.keys[i]), value = __pulse_fastly_utf8(__pulse_fastly_string(headers.values[i]));
    bytes += name.byteLength + value.byteLength + 4;
    if (i >= 64 || bytes > 16384 || __fwd_hop(changetype<usize>(name), name.byteLength)) { __fwd_fail(400); return; }
    if (fastly_http_req_header_insert(__fwd_request, changetype<usize>(name), name.byteLength, changetype<usize>(value), value.byteLength) != 0) { __fwd_fail(400); return; }
  }
  if (!__fwd_remaining()) return;
  __pulse_transport_slots[index] = null;
  const status = __fwd_dispatch(__fwd_request, __fwd_upload, changetype<usize>(backend), backend.byteLength, __fwd_io + 52);
  // send may consume the request even on failure. Cleanup makes only a best-effort
  // close on that error path before any handle allocation/reuse can occur.
  if (status != 0) { __pulse_transport_capture(__fwd_index, status, 'send'); __fwd_fail(502); return; }
  __fwd_request = -1; __fwd_pending = load<i32>(__fwd_io + 52);
  __pulse_fastly_pending[index] = __fwd_pending; __pulse_fastly_pending_mode[index] = PULSE_FASTLY_PENDING_ASYNC;
  __fwd_remaining();
}
// Adopt early headers before considering readiness of the source or writer.
function __fwd_poll(): bool {
  if (__fwd_pending < 0 || !__fwd_remaining()) return __fwd_response >= 0;
  __pulse_send_error_detail_reset(__fwd_detail);
  store<i32>(__fwd_done, 0);
  const status = __pulse_fetch_poll(__fwd_pending, __fwd_detail, __fwd_done, __fwd_response_out, __fwd_body_out);
  const done = load<i32>(__fwd_done);
  if (status != 0) { __pulse_transport_capture(__fwd_index, status, 'poll', __fwd_detail); __fwd_pending = -1; __fwd_fail(502); return false; }
  if (done != 0 && done != 1) { __fwd_fail(502); return false; }
  if (done == 1) {
    __fwd_response = load<i32>(__fwd_response_out); __fwd_body = load<i32>(__fwd_body_out); __fwd_pending = -1;
  }
  if (!__fwd_remaining()) return false;
  return done == 1;
}
function __fwd_wait_io(handle: i32, upload: bool): bool {
  while (__fwd_remaining() > 0) {
    if (upload && __fwd_poll()) return false;
    if (__fwd_failure != 0) return false;
    store<i32>(__fwd_io + 52, -1);
    if (__fwd_ready(handle, __fwd_io + 52) != 0) { __fwd_fail(502); return false; }
    const ready = load<i32>(__fwd_io + 52);
    if (ready == 1) return __fwd_remaining() > 0;
    if (ready != 0) { __fwd_fail(502); return false; }
    let count = 0;
    if (upload && __fwd_pending >= 0) { store<i32>(__fwd_io + 56, __fwd_pending); count++; }
    store<i32>(__fwd_io + 56 + count * 4, handle); count++;
    const remaining = __fwd_remaining(); if (remaining == 0) return false;
    const status = __pulse_fetch_select(__fwd_io + 56, count, remaining, __fwd_io + 64);
    if (status != 0) { __fwd_fail(502); return false; }
    const selected = load<i32>(__fwd_io + 64);
    if (selected == -1) { __fwd_fail(504); return false; }
    if (selected < 0 || selected >= count) { __fwd_fail(502); return false; }
  }
  return false;
}
function __fwd_copy(source: i32, sink: i32, cap: i32, declared: i32, upload: bool): bool {
  let total = 0;
  while (true) {
    // Demand first; at most one raw chunk can be read ahead of the writer.
    if (!__fwd_wait_io(sink, upload) || !__fwd_wait_io(source, upload)) return false;
    const size = min(16384, cap - total + 1);
    store<i32>(__fwd_io + 68, -1);
    if (fastly_http_body_read(source, __fwd_buffer, size, __fwd_io + 68) != 0) { __fwd_fail(upload ? 400 : 502); return false; }
    const read = load<i32>(__fwd_io + 68);
    if (!__fwd_remaining()) return false;
    if (read < 0 || read > size) { __fwd_fail(502); return false; }
    if (read == 0) {
      if (declared >= 0 && total != declared) { __fwd_fail(upload ? 400 : 502); return false; }
      return true;
    }
    total += read;
    if (total > cap) { __fwd_fail(upload ? 413 : 502); return false; }
    if (declared >= 0 && total > declared) { __fwd_fail(upload ? 400 : 502); return false; }
    let offset = 0;
    while (offset < read) {
      if (!__fwd_wait_io(sink, upload)) return false;
      store<i32>(__fwd_io + 72, -1);
      if (fastly_http_body_write(sink, __fwd_buffer + offset, read - offset, 0, __fwd_io + 72) != 0) { __fwd_fail(502); return false; }
      const written = load<i32>(__fwd_io + 72);
      if (!__fwd_remaining()) return false;
      if (written <= 0 || written > read - offset) { __fwd_fail(502); return false; }
      offset += written;
    }
  }
}
function __fwd_wait(): i32 {
  if (__fwd_failure != 0 || __fwd_pending < 0) return 0;
  const eof = __fwd_copy(__fwd_source, __fwd_upload, __FWD_REQUEST_MAX, __fwd_request_length, true);
  __pulse_fetch_close_body(__fwd_source); __fwd_source = -1;
  if (eof && __fwd_remaining()) {
    const upload = __fwd_upload; __fwd_upload = -1;
    if (__pulse_fetch_close_body(upload) != 0) __fwd_fail(502);
  } else if (__fwd_upload >= 0) { __fwd_abandon(__fwd_upload); __fwd_upload = -1; }
  while (__fwd_failure == 0 && __fwd_response < 0) {
    if (__fwd_poll()) break;
    if (__fwd_failure != 0 || !__fwd_wait_io(__fwd_pending, false)) break;
  }
  __pulse_fastly_pending_mode[__fwd_index] = PULSE_FASTLY_PENDING_NONE; __pulse_fastly_pending[__fwd_index] = 0;
  if (__fwd_failure != 0 || !__fwd_remaining()) return 0;
  const value = new __PulseFastlyValue(); value.kind = PULSE_VALUE_FETCH;
  value.responseHandle = __fwd_response; value.bodyHandle = __fwd_body;
  __fwd_result = __pulse_fastly_put(value); return __fwd_result;
}
function __fwd_response_headers(): bool {
  store<i32>(__fwd_io + 52, 0);
  if (fastly_http_resp_status_get(__fwd_response, __fwd_io + 52) != 0) { __fwd_fail(502); return false; }
  __fwd_status = load<u16>(__fwd_io + 52);
  if (__fwd_status < 200 || __fwd_status > 599) { __fwd_fail(502); return false; }
  store<i64>(__fwd_io + 40, -1); store<i32>(__fwd_io + 48, -1);
  if (__fwd_names(__fwd_response, __fwd_headers, 16384, 0, __fwd_io + 40, __fwd_io + 48) != 0) { __fwd_fail(502); return false; }
  const names = load<i32>(__fwd_io + 48);
  if (names < 0 || names > 16384 || (names > 0 && load<i64>(__fwd_io + 40) != -1)) { __fwd_fail(502); return false; }
  let used = names, start = 0, total = 0, nameCount = 0;
  for (let i = 0; i < names; i++) {
    const byte = load<u8>(__fwd_headers + i);
    if (byte != 0) { if (!__fwd_token(byte)) { __fwd_fail(502); return false; } continue; }
    const name = __fwd_headers + start, length = i - start; start = i + 1;
    if (length == 0 || ++nameCount > 64 || used >= 16384) { __fwd_fail(502); return false; }
    store<i64>(__fwd_io + 40, -1); store<i32>(__fwd_io + 48, -1);
    if (__fwd_values(__fwd_response, name, length, __fwd_headers + used, 16384 - used, 0, __fwd_io + 40, __fwd_io + 48) != 0) { __fwd_fail(502); return false; }
    const size = load<i32>(__fwd_io + 48);
    if (size <= 0 || size > 16384 - used || load<i64>(__fwd_io + 40) != -1) { __fwd_fail(502); return false; }
    let valueStart = 0;
    for (let j = 0; j < size; j++) {
      const item = load<u8>(__fwd_headers + used + j);
      if (item != 0) { if ((item < 32 && item != 9) || item == 127) { __fwd_fail(502); return false; } continue; }
      const value = __fwd_headers + used + valueStart, valueSize = j - valueStart; valueStart = j + 1;
      total += length + valueSize + 4;
      if (__fwd_header_count >= 64 || total > 16384) { __fwd_fail(502); return false; }
      const pair = __fwd_pairs + __fwd_header_count * 16; __fwd_header_count++;
      store<usize>(pair, name); store<i32>(pair + 4, length); store<usize>(pair + 8, value); store<i32>(pair + 12, valueSize);
      if (__fwd_equal(name, length, 'content-length')) {
        if (__fwd_response_length != -1) { __fwd_fail(502); return false; }
        __fwd_response_length = __fwd_length(value, valueSize, __FWD_RESPONSE_MAX);
        if (__fwd_response_length < 0 || (__fwd_status != 304 && __fwd_response_length > __FWD_RESPONSE_MAX)) { __fwd_fail(502); return false; }
      }
    }
    if (valueStart != size) { __fwd_fail(502); return false; }
    used += size;
  }
  if (start != names || ((__fwd_status == 204 || __fwd_status == 205) && __fwd_response_length > 0)) { __fwd_fail(502); return false; }
  return __fwd_remaining() > 0;
}
function __fwd_nominated(name: usize, length: i32): bool {
  let nominated = false;
  for (let i = 0; i < __fwd_header_count; i++) {
    const pair = __fwd_pairs + i * 16;
    if (!__fwd_equal(load<usize>(pair), load<i32>(pair + 4), 'connection')) continue;
    const value = load<usize>(pair + 8), size = load<i32>(pair + 12);
    let offset = 0;
    while (offset < size) {
      while (offset < size && (load<u8>(value + offset) == 32 || load<u8>(value + offset) == 9)) offset++;
      const start = offset;
      while (offset < size && __fwd_token(load<u8>(value + offset))) offset++;
      const count = offset - start;
      if (count == 0) { __fwd_fail(502); return false; }
      if (count == length) {
        let same = true;
        for (let c = 0; c < count; c++) if (__fwd_lower(load<u8>(value + start + c)) != __fwd_lower(load<u8>(name + c))) same = false;
        if (same) nominated = true;
      }
      while (offset < size && (load<u8>(value + offset) == 32 || load<u8>(value + offset) == 9)) offset++;
      if (offset < size && (load<u8>(value + offset++) != 44 || offset == size)) { __fwd_fail(502); return false; }
    }
  }
  return nominated;
}
function __fwd_send(): i32 {
  if (!__fwd_response_headers()) { __fwd_error_response(); return 0; }
  if (fastly_http_resp_new(__fwd_io + 52) != 0) { __fwd_fail(502); __fwd_error_response(); return 0; }
  __fwd_output = load<i32>(__fwd_io + 52);
  if (fastly_http_resp_status_set(__fwd_output, __fwd_status) != 0 || fastly_http_body_new(__fwd_io + 52) != 0) { __fwd_fail(502); __fwd_error_response(); return 0; }
  __fwd_downstream = load<i32>(__fwd_io + 52);
  for (let i = 0; i < __fwd_header_count; i++) {
    const pair = __fwd_pairs + i * 16, name = load<usize>(pair), length = load<i32>(pair + 4);
    const nominated = __fwd_nominated(name, length);
    if (__fwd_failure != 0) break;
    if (__fwd_hop(name, length) || nominated) continue;
    if (fastly_http_resp_header_append(__fwd_output, name, length, load<usize>(pair + 8), load<i32>(pair + 12)) != 0) { __fwd_fail(502); break; }
  }
  __pulse_fetch_close_response(__fwd_response); __fwd_response = -1;
  if (!__fwd_remaining()) { __fwd_error_response(); return 0; }
  // Treat even an ambiguous send failure as committed: never emit a second
  // response. The writable body remains ours until explicit EOF or abandon.
  const output = __fwd_output; __fwd_output = -1;
  if (fastly_http_resp_send_downstream(output, __fwd_downstream, 1) != 0) { __pulse_fetch_close_response(output); __fwd_fail(502); __fwd_cleanup(); return 0; }
  const bodyless = __fwd_status == 204 || __fwd_status == 205 || __fwd_status == 304;
  const eof = __fwd_copy(__fwd_body, __fwd_downstream, bodyless ? 0 : __FWD_RESPONSE_MAX, bodyless ? 0 : __fwd_response_length, false);
  __pulse_fetch_close_body(__fwd_body); __fwd_body = -1;
  if (eof && __fwd_remaining()) {
    const downstream = __fwd_downstream; __fwd_downstream = -1;
    if (__pulse_fetch_close_body(downstream) != 0) __fwd_fail(502);
    else __pulse_response_complete();
    // Success is the host-handoff boundary. The handle is gone; there is no
    // final-writer wait, delivery receipt, or post-handoff timeout guarantee.
  }
  __fwd_cleanup(); return 0;
}
