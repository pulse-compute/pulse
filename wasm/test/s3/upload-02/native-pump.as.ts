// Research-only fixed-body PUT pump, specialized to the single S3 test site.
@external('fastly_http_req', 'send_async_streaming') declare function __u2_send(req: i32, body: i32, backend: usize, size: i32, out: usize): i32
@external('fastly_http_body', 'abandon') declare function __u2_abandon(body: i32): i32
@external('fastly_async_io', 'is_ready') declare function __u2_ready(handle: i32, out: usize): i32
const __u2_buffer: usize = memory.data(16384)
const __u2_io: usize = memory.data(96)
const __u2_headers: usize = memory.data(16384)
let __u2_claimed: bool = false
let __u2_length: i32 = -1
let __u2_eof: bool = false
let __u2_early: i32 = 0
let __u2_problem: string = ''
function __u2_length_header(): i32 {
  const name = __pulse_s3_bytes('content-length');
  store<i64>(__u2_io, -1); store<i32>(__u2_io + 8, 0);
  const status = __pulse_request_header_values(__pulse_fastly_request_handle, name.dataStart, name.length,
    __u2_headers, 16384, 0, __u2_io, __u2_io + 8);
  const count = load<i32>(__u2_io + 8);
  if (status != 0 || count < 2 || count > 32 || load<i64>(__u2_io) != -1 || load<u8>(__u2_headers + count - 1) != 0) return -1;
  let value = 0;
  for (let i = 0; i < count - 1; i++) {
    const digit = load<u8>(__u2_headers + i) - 48;
    if (digit < 0 || digit > 9 || (i == 1 && load<u8>(__u2_headers) == 48)) return -1;
    value = min(1048577, value * 10 + digit);
  }
  for (let i = 0; i < 2; i++) {
    const forbidden = __pulse_s3_bytes(i == 0 ? 'transfer-encoding' : 'content-encoding');
    store<i64>(__u2_io, -1); store<i32>(__u2_io + 8, 0);
    if (__pulse_request_header_values(__pulse_fastly_request_handle, forbidden.dataStart, forbidden.length,
      __u2_headers, 16384, 0, __u2_io, __u2_io + 8) != 0 || load<i32>(__u2_io + 8) != 0) return -1;
  }
  return value;
}
function __u2_poll(index: i32): bool {
  store<i32>(__u2_io + 12, 0);
  __pulse_send_error_detail_reset(__u2_io + 32);
  const status = __s3_poll(__pulse_fastly_pending[index], __u2_io + 32, __u2_io + 12, __u2_io + 16, __u2_io + 20);
  if (status != 0) { __u2_problem = 'transport'; return true; }
  const done = load<i32>(__u2_io + 12);
  if (done != 0 && done != 1) { __u2_problem = 'protocol'; return true; }
  if (!done) return false;
  const response = load<i32>(__u2_io + 16), body = load<i32>(__u2_io + 20);
  store<i32>(__u2_io + 24, 0);
  if (fastly_http_resp_status_get(response, __u2_io + 24) != 0) __u2_problem = 'protocol';
  else {
    const code = load<u16>(__u2_io + 24);
    __u2_early = __s3_read_response(index, response, body, code);
    if (code == 200 && !__u2_eof) __u2_early = __s3_failure(index, 'protocol', code);
  }
  __s3_close_body(body); __s3_close_resp(response);
  return true;
}
function __u2_wait(index: i32, handle: i32): bool {
  while (__s3_remaining(index) > 0) {
    if (__u2_poll(index)) return false;
    store<i32>(__u2_io + 28, -1);
    if (__u2_ready(handle, __u2_io + 28) != 0) { __u2_problem = 'transport'; return false; }
    const ready = load<i32>(__u2_io + 28);
    if (ready == 1) return true;
    if (ready != 0) { __u2_problem = 'protocol'; return false; }
    store<i32>(__u2_io + 64, __pulse_fastly_pending[index]); store<i32>(__u2_io + 68, handle);
    const remaining = __s3_remaining(index); if (remaining == 0) break;
    if (__s3_select(__u2_io + 64, 2, remaining, __u2_io + 72) != 0) { __u2_problem = 'transport'; return false; }
    const selected = load<i32>(__u2_io + 72);
    if (selected == -1) break;
    if (selected < 0 || selected > 1) { __u2_problem = 'protocol'; return false; }
  }
  __u2_problem = 'timeout'; return false;
}
function __u2_pump(index: i32, writer: i32): bool {
  let total = 0;
  while (__u2_wait(index, writer) && __u2_wait(index, __pulse_fastly_request_body_handle)) {
    const size = min(16384, __u2_length - total + 1);
    store<i32>(__u2_io + 76, -1);
    if (fastly_http_body_read(__pulse_fastly_request_body_handle, __u2_buffer, size, __u2_io + 76) != 0) { __u2_problem = 'transport'; return false; }
    const read = load<i32>(__u2_io + 76);
    if (read < 0 || read > size || total + read > __u2_length) { __u2_problem = 'length'; return false; }
    if (read == 0) {
      if (total != __u2_length) { __u2_problem = 'length'; return false; }
      __u2_eof = true; __s3_sent_bytes[index] = total; return true;
    }
    let offset = 0;
    while (offset < read) {
      if (!__u2_wait(index, writer)) return false;
      store<i32>(__u2_io + 80, -1);
      if (fastly_http_body_write(writer, __u2_buffer + offset, read - offset, 0, __u2_io + 80) != 0) { __u2_problem = 'transport'; return false; }
      const written = load<i32>(__u2_io + 80);
      if (written <= 0 || written > read - offset) { __u2_problem = 'protocol'; return false; }
      offset += written;
    }
    total += read;
  }
  return false;
}
