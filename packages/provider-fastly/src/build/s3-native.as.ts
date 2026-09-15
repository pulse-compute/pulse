// Provider-owned lifecycle and host ABI. Protocol algorithms are S3-owned.
@external('fastly_async_io', 'select') declare function __s3_select(handles: usize, count: i32, timeout: i32, done: usize): i32
@external('fastly_http_req', 'pending_req_poll_v2') declare function __s3_poll(pending: i32, detail: usize, done: usize, response: usize, body: usize): i32
@external('fastly_http_req', 'cache_override_set') declare function __s3_cache(request: i32, tag: i32, ttl: i32, swr: i32): i32
@external('fastly_http_req', 'auto_decompress_response_set') declare function __s3_decompress(request: i32, encodings: i32): i32
@external('fastly_http_req', 'close') declare function __s3_close_req(request: i32): i32
@external('fastly_http_resp', 'close') declare function __s3_close_resp(response: i32): i32
@external('fastly_http_body', 'close') declare function __s3_close_body(body: i32): i32
@external('fastly_http_resp', 'header_names_get') declare function __s3_header_names(response: i32, buffer: usize, size: i32, cursor: i32, end: usize, written: usize): i32
@external('fastly_http_resp', 'header_values_get') declare function __s3_header_values(response: i32, name: usize, length: i32, buffer: usize, size: i32, cursor: i32, end: usize, written: usize): i32

class __PulseS3Binding {
  contentType: string = ''; endpoint: string = ''; bucket: string = ''; region: string = ''; backend: string = '';
  id: string = ''; secret: string = ''; token: string = ''; max: i32 = 32768; timeout: i32 = 10000;
}
@lazy const __s3_dispatched = new StaticArray<bool>(PULSE_FASTLY_EFFECT_COUNT)
@lazy const __s3_sent_bytes = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
@lazy const __s3_digests = new Array<string>(PULSE_FASTLY_EFFECT_COUNT).fill('')
@lazy const __s3_deadlines = new StaticArray<i64>(PULSE_FASTLY_EFFECT_COUNT)
function __s3_clock(id: i32): i64 {
  const out = new StaticArray<i64>(1);
  return wasi_snapshot_preview1_clock_time_get(id, 1000000, changetype<usize>(out)) == 0 ? out[0] : -1;
}
function __s3_remaining(index: i32): i32 {
  const now = __s3_clock(1);
  if (now < 0) return 0;
  const ns = __s3_deadlines[index] - now;
  return ns <= 0 ? 0 : i32((ns + 999999) / 1000000);
}
function __s3_set(object: i32, name: string, value: i32): void { host_value_object_set(object, __pulse_fastly_string_value(name), value) }
function __s3_result(status: string, reason: string = '', http: i32 = 0): i32 {
  const result = host_value_object(); __s3_set(result, 'status', __pulse_fastly_string_value(status));
  if (reason.length) __s3_set(result, 'reason', __pulse_fastly_string_value(reason));
  if (http > 0) { const value = new __PulseFastlyValue(); value.kind = PULSE_VALUE_NUMBER; value.number = f64(http); __s3_set(result, 'httpStatus', __pulse_fastly_put(value)); }
  return result;
}
function __s3_failure(index: i32, reason: string, http: i32 = 0): i32 {
  return __s3_result(__pulse_fastly_effect_kind(index) == 14 ? (__s3_dispatched[index] ? 'unknown' : 'not-stored') : 'failed', reason, http);
}
function __s3_fail(index: i32, reason: string): void { __pulse_fastly_ready_effect(index, __s3_failure(index, reason)) }
function __s3_secret(store: i32, name: string): string | null {
  const key = __pulse_s3_bytes(name), out = new StaticArray<i32>(1), size = new StaticArray<i32>(1), bytes = new Uint8Array(4096);
  if (fastly_secret_store_get(store, key.dataStart, key.length, changetype<usize>(out)) != 0) return null;
  const status = fastly_secret_store_plaintext(out[0], bytes.dataStart, bytes.length, changetype<usize>(size));
  let result: string | null = null;
  if (status == 0 && size[0] > 0 && size[0] <= bytes.length) {
    const raw = bytes.subarray(0, size[0]);
    if (__pulse_s3_utf8_valid(raw)) result = String.UTF8.decodeUnsafe(raw.dataStart, raw.length, false);
  }
  bytes.fill(0);
  if (result !== null) __pulse_fastly_remember_secret(result);
  return result;
}
function __s3_header(request: i32, name: string, value: string): bool {
  const n = __pulse_s3_bytes(name), v = __pulse_s3_bytes(value);
  return fastly_http_req_header_insert(request, n.dataStart, n.length, v.dataStart, v.length) == 0;
}
function __pulse_fastly_s3_begin(index: i32, outer: __PulseFastlyValue): void {
  __s3_dispatched[index] = false; __s3_sent_bytes[index] = 0; __s3_digests[index] = '';
  const put = __pulse_fastly_effect_kind(index) == 14;
  const payload = __pulse_fastly_value(__pulse_fastly_payload_field(outer, 'invocation'));
  const input = __pulse_fastly_value(__pulse_fastly_payload_field(payload, 'key'));
  if (input.kind != PULSE_VALUE_STRING) { __s3_fail(index, 'invalid-key'); return; }
  const encoded = __pulse_s3_key(input.text);
  if (encoded === null) { __s3_fail(index, 'invalid-key'); return; }
  // Package effect payloads and signed paths must not enter provider logs.
  __pulse_fastly_remember_secret(input.text);
  const binding = __pulse_fastly_s3_binding(index), start = __s3_clock(1);
  if (start < 0) { __s3_fail(index, 'configuration'); return; }
  __s3_deadlines[index] = start + i64(binding.timeout) * 1000000;
  let data = new Uint8Array(0);
  if (put) {
    const text = __pulse_fastly_value(__pulse_fastly_payload_field(payload, 'text'));
    if (text.kind != PULSE_VALUE_STRING) { __s3_fail(index, 'invalid-text'); return; }
    if (text.text.length > binding.max) { __s3_fail(index, 'too-large'); return; }
    if (!__pulse_s3_scalar(text.text)) { __s3_fail(index, 'invalid-text'); return; }
    data = __pulse_s3_bytes(text.text);
    if (data.length > binding.max) { __s3_fail(index, 'too-large'); return; }
    __pulse_fastly_remember_secret(text.text);
  }
  const storeName = __pulse_s3_bytes(__pulse_fastly_secret_store(index)), store = new StaticArray<i32>(1);
  if (fastly_secret_store_open(storeName.dataStart, storeName.length, changetype<usize>(store)) != 0) { __s3_fail(index, 'credentials'); return; }
  const id = __s3_secret(store[0], binding.id), secret = __s3_secret(store[0], binding.secret);
  const token = binding.token.length ? __s3_secret(store[0], binding.token) : '';
  if (__s3_remaining(index) == 0) { __s3_fail(index, 'timeout'); return; }
  if (id === null || secret === null || token === null || !__pulse_s3_credentials(id, secret, token)) { __s3_fail(index, 'credentials'); return; }
  const method = put ? 'PUT' : __pulse_fastly_effect_kind(index) == 12 ? 'HEAD' : 'GET', path = '/' + binding.bucket + '/' + encoded;
  const now = __s3_clock(0);
  if (now < 0 || !__pulse_s3_date(now / 1000000000).length) { __s3_fail(index, 'configuration'); return; }
  const signature = __pulse_s3_sign(method, path, binding.endpoint.slice(8), binding.region, id, secret, token, now / 1000000000, data, binding.contentType);
  __s3_sent_bytes[index] = data.length; __s3_digests[index] = signature.digest;
  __pulse_fastly_remember_secret(signature.digest);
  __pulse_fastly_remember_secret(signature.authorization); __pulse_fastly_remember_secret(binding.endpoint + path);
  if (__s3_remaining(index) == 0) { __s3_fail(index, 'timeout'); return; }
  const request = new StaticArray<i32>(1), body = new StaticArray<i32>(1), pending = new StaticArray<i32>(1);
  if (fastly_http_req_new(changetype<usize>(request)) != 0) { __s3_fail(index, 'transport'); return; }
  const req = request[0], url = __pulse_s3_bytes(binding.endpoint + path), verb = __pulse_s3_bytes(method), backend = __pulse_s3_bytes(binding.backend);
  let ok = fastly_http_req_uri_set(req, url.dataStart, url.length) == 0 && fastly_http_req_method_set(req, verb.dataStart, verb.length) == 0
    && __s3_cache(req, 1, 0, 0) == 0 && __s3_decompress(req, 0) == 0
    && __s3_header(req, 'host', binding.endpoint.slice(8)) && __s3_header(req, 'x-amz-date', signature.date)
    && __s3_header(req, 'x-amz-content-sha256', signature.digest) && __s3_header(req, 'authorization', signature.authorization)
    && __s3_header(req, 'accept-encoding', 'identity');
  if (ok && put) ok = __s3_header(req, 'content-type', binding.contentType) && __s3_header(req, 'content-length', data.length.toString());
  if (ok && token.length) ok = __s3_header(req, 'x-amz-security-token', token);
  if (!ok || fastly_http_body_new(changetype<usize>(body)) != 0) { __s3_close_req(req); __s3_fail(index, 'transport'); return; }
  let offset = 0; const written = new StaticArray<i32>(1);
  while (offset < data.length) {
    if (__s3_remaining(index) == 0) { __s3_close_req(req); __s3_close_body(body[0]); __s3_fail(index, 'timeout'); return; }
    if (fastly_http_body_write(body[0], data.dataStart + offset, data.length - offset, 0, changetype<usize>(written)) != 0 || written[0] <= 0 || written[0] > data.length - offset) {
      __s3_close_req(req); __s3_close_body(body[0]); __s3_fail(index, 'transport'); return;
    }
    offset += written[0];
  }
  if (__s3_remaining(index) == 0) { __s3_close_req(req); __s3_close_body(body[0]); __s3_fail(index, 'timeout'); return; }
  __s3_dispatched[index] = true;
  if (fastly_http_req_send_async(req, body[0], backend.dataStart, backend.length, changetype<usize>(pending)) != 0) {
    __s3_close_req(req); __s3_close_body(body[0]); __s3_fail(index, 'transport'); return;
  }
  // send_async consumes request/body. Pending handles have no cancel hostcall.
  __pulse_fastly_pending[index] = pending[0]; __pulse_fastly_pending_mode[index] = PULSE_FASTLY_PENDING_ASYNC;
}
function __s3_wait_ready(index: i32, handle: i32): i32 {
  const timeout = __s3_remaining(index); if (timeout == 0) return 0;
  const handles = new StaticArray<i32>(1), done = new StaticArray<i32>(1); handles[0] = handle;
  if (__s3_select(changetype<usize>(handles), 1, timeout, changetype<usize>(done)) != 0) return -1;
  return done[0] == -1 || __s3_remaining(index) == 0 ? 0 : 1;
}
function __s3_list(buffer: Uint8Array, size: i32): Array<string> | null {
  if (size < 0 || size > buffer.length || (size > 0 && buffer[size - 1] != 0)) return null;
  const result = new Array<string>(); let start = 0;
  for (let i = 0; i < size; i++) if (buffer[i] == 0) {
    const bytes = buffer.subarray(start, i); if (!__pulse_s3_utf8_valid(bytes)) return null;
    result.push(String.UTF8.decodeUnsafe(bytes.dataStart, bytes.length, false)); start = i + 1;
  }
  return result;
}
function __s3_read_response(index: i32, response: i32, body: i32, status: i32): i32 {
  const put = __pulse_fastly_effect_kind(index) == 14;
  const rejected = put && status >= 400 && status <= 499 && status != 408;
  if (!put && status == 404) return __s3_result('not-found');
  if (status != 200 && !rejected) return __s3_failure(index, __pulse_s3_status_reason(status), status);
  const buffer = new Uint8Array(16384), end = new StaticArray<i64>(1), size = new StaticArray<i32>(1);
  if (__s3_header_names(response, buffer.dataStart, buffer.length, 0, changetype<usize>(end), changetype<usize>(size)) != 0 || end[0] >= 0) return __s3_failure(index, 'protocol', status);
  const names = __s3_list(buffer, size[0]); if (names === null) return __s3_failure(index, 'protocol', status);
  let total = 0, length: f64 = -1; const seen = new Set<string>();
  const result = __s3_result(put ? 'stored' : 'found');
  for (let i = 0; i < names.length; i++) {
    const rawName = names[i], name = rawName.toLowerCase(), bytes = __pulse_s3_bytes(rawName);
    if (__s3_header_values(response, bytes.dataStart, bytes.length, buffer.dataStart, buffer.length, 0, changetype<usize>(end), changetype<usize>(size)) != 0 || end[0] >= 0) return __s3_failure(index, 'protocol', status);
    const values = __s3_list(buffer, size[0]); if (values === null) return __s3_failure(index, 'protocol', status);
    const selected = name == 'content-length' || name == 'content-type' || name == 'etag' || name == 'content-encoding';
    if (selected && (seen.has(name) || values.length != 1)) return __s3_failure(index, 'protocol', status);
    seen.add(name);
    for (let v = 0; v < values.length; v++) {
      const value = values[v], count = __pulse_s3_bytes(value).length;
      total += bytes.length + count + 4; if (total > 16384) return __s3_failure(index, 'protocol', status);
      if (!selected) continue;
      if (count > 1024 || !__pulse_s3_scalar(value, true)) return __s3_failure(index, 'protocol', status);
      if (name == 'content-encoding' && value.toLowerCase() != 'identity') return __s3_failure(index, 'protocol', status);
      if (name == 'content-length') {
        if (!value.length || (value.length > 1 && value.charCodeAt(0) == 48)) return __s3_failure(index, 'protocol', status);
        length = 0;
        for (let c = 0; c < value.length; c++) { const digit = value.charCodeAt(c) - 48; if (digit < 0 || digit > 9) return __s3_failure(index, 'protocol', status); length = length * 10 + digit; if (length > 9007199254740991) return __s3_failure(index, 'protocol', status); }
      }
      if (name == 'etag') { if (!value.length) return __s3_failure(index, 'protocol', status); __s3_set(result, 'etag', __pulse_fastly_string_value(value)); }
      if (name == 'content-type' && !put) __s3_set(result, 'contentType', __pulse_fastly_string_value(value));
    }
  }
  if (__s3_remaining(index) == 0) return __s3_failure(index, 'timeout', status);
  const head = __pulse_fastly_effect_kind(index) == 12, binding = __pulse_fastly_s3_binding(index);
  if (head && length < 0) return __s3_failure(index, 'protocol', status);
  if (!head) {
    const maximum = put && !rejected ? 0 : binding.max;
    if (length > maximum) return __s3_failure(index, put ? 'protocol' : 'too-large', status);
    const data = new Uint8Array(maximum + 1); let count = 0;
    while (true) {
      const ready = __s3_wait_ready(index, body);
      if (ready <= 0) return __s3_failure(index, ready == 0 ? 'timeout' : 'transport', status);
      if (fastly_http_body_read(body, data.dataStart + count, data.length - count, changetype<usize>(size)) != 0) return __s3_failure(index, 'protocol', status);
      if (size[0] < 0 || size[0] > data.length - count) return __s3_failure(index, 'protocol', status);
      if (size[0] == 0) break;
      count += size[0]; if (count > maximum) return __s3_failure(index, put ? 'protocol' : 'too-large', status);
    }
    if (length >= 0 && length != count) return __s3_failure(index, 'protocol', status);
    if (put) {
      if (__s3_remaining(index) == 0) return __s3_failure(index, 'timeout', status);
      if (rejected) return __s3_result('not-stored', status == 401 || status == 403 ? 'not-authorized' : status == 429 ? 'throttled' : 'rejected', status);
      const sent = new __PulseFastlyValue(); sent.kind = PULSE_VALUE_NUMBER; sent.number = f64(__s3_sent_bytes[index]);
      __s3_set(result, 'byteLength', __pulse_fastly_put(sent));
      __s3_set(result, 'sha256', __pulse_fastly_string_value(__s3_digests[index]));
      return result;
    }
    length = f64(count); const raw = data.subarray(0, count), digest = __pulse_s3_hex(__pulse_s3_sha(raw));
    if (!__pulse_s3_utf8_valid(raw)) return __s3_failure(index, 'invalid-utf8', status);
    __s3_set(result, 'text', __pulse_fastly_string_value(String.UTF8.decodeUnsafe(raw.dataStart, raw.length, false)));
    __s3_set(result, 'sha256', __pulse_fastly_string_value(digest));
  }
  if (__s3_remaining(index) == 0) return __s3_failure(index, 'timeout', status);
  const sizeValue = new __PulseFastlyValue(); sizeValue.kind = PULSE_VALUE_NUMBER; sizeValue.number = length;
  __s3_set(result, 'byteLength', __pulse_fastly_put(sizeValue)); return result;
}
function __pulse_fastly_s3_wait(index: i32): i32 {
  if (__pulse_fastly_pending_mode[index] == PULSE_FASTLY_PENDING_READY) return __pulse_fastly_wait_ready(index);
  const pending = __pulse_fastly_pending[index], detail = new StaticArray<i32>(4), done = new StaticArray<i32>(1);
  const response = new StaticArray<i32>(1), body = new StaticArray<i32>(1), code = new StaticArray<i32>(1);
  __pulse_fastly_pending_mode[index] = PULSE_FASTLY_PENDING_NONE; __pulse_fastly_pending[index] = 0;
  while (true) {
    const ready = __s3_wait_ready(index, pending);
    if (ready <= 0) return __s3_failure(index, ready == 0 ? 'timeout' : 'transport');
    if (__s3_poll(pending, changetype<usize>(detail), changetype<usize>(done), changetype<usize>(response), changetype<usize>(body)) != 0) return __s3_failure(index, 'transport');
    if (done[0] != 0) break;
  }
  let result: i32;
  if (fastly_http_resp_status_get(response[0], changetype<usize>(code)) != 0) result = __s3_failure(index, 'protocol');
  else result = __s3_remaining(index) == 0 ? __s3_failure(index, 'timeout', code[0]) : __s3_read_response(index, response[0], body[0], code[0]);
  __s3_close_body(body[0]); __s3_close_resp(response[0]); return result;
}
