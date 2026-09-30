// Fastly owns opaque body handles. No bytes enter an application value or text codec.
@lazy const __s3_bodies = new Array<__PulseFastlyValue>()
function __s3_body_failure(reason: string): i32 {
  const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE;
  output.status = reason == 'timeout' ? 504 : 502;
  output.headers.push(new __PulseFastlyHeader('x-pulse-s3-error', reason));
  return __pulse_fastly_put(output);
}
function __s3_close_bodies(): void {
  for (let i = 0; i < __s3_bodies.length; i++) {
    const value = __s3_bodies[i];
    if (value.s3Body) { __s3_close_body(value.bodyHandle); value.s3Body = false; }
  }
  __s3_bodies.length = 0;
}
function __s3_body_response(index: i32, response: i32, body: i32, status: i32): i32 {
  const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE; output.status = status;
  const buffer = new Uint8Array(16384), end = new StaticArray<i64>(1), size = new StaticArray<i32>(1);
  if (__s3_header_names(response, buffer.dataStart, buffer.length, 0, changetype<usize>(end), changetype<usize>(size)) != 0 || end[0] >= 0) return __s3_body_failure('protocol');
  const names = __s3_list(buffer, size[0]); if (names === null) return __s3_body_failure('protocol');
  let total = 0, length: f64 = -1, contentRange = ''; const seen = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i].toLowerCase(), bytes = __pulse_s3_bytes(names[i]);
    if (__s3_header_values(response, bytes.dataStart, bytes.length, buffer.dataStart, buffer.length, 0, changetype<usize>(end), changetype<usize>(size)) != 0 || end[0] >= 0) return __s3_body_failure('protocol');
    const values = __s3_list(buffer, size[0]); if (values === null) return __s3_body_failure('protocol');
    const selected = name == 'content-length' || name == 'content-type' || name == 'etag' || name == 'content-encoding' || name == 'content-range';
    if (selected && (seen.has(name) || values.length != 1)) return __s3_body_failure('protocol');
    seen.add(name);
    for (let v = 0; v < values.length; v++) {
      const value = values[v], count = __pulse_s3_bytes(value).length;
      total += bytes.length + count + 4; if (total > 16384) return __s3_body_failure('protocol');
      if (!selected) continue;
      if (count > 1024 || !__pulse_s3_scalar(value, true)) return __s3_body_failure('protocol');
      if (name == 'content-encoding') { if (value.toLowerCase() != 'identity') return __s3_body_failure('protocol'); continue; }
      if (name == 'content-length') {
        length = __pulse_s3_decimal(value); if (length < 0) return __s3_body_failure('protocol');
        if (status != 200 && status != 206) continue;
      }
      if (name == 'etag' && !value.length) return __s3_body_failure('protocol');
      if (name == 'content-range') { if (!value.length || count > 128) return __s3_body_failure('protocol'); contentRange = value; }
      output.headers.push(new __PulseFastlyHeader(name, value));
    }
  }
  const binding = __pulse_fastly_s3_binding(index);
  if ((status == 200 || status == 206) && length < 0) return __s3_body_failure('protocol');
  if (!__pulse_s3_body_range(status, length, contentRange, binding.range, binding.ifNoneMatch.length > 0)) return __s3_body_failure('protocol');
  if (__s3_remaining(index) == 0) return __s3_body_failure('timeout');
  if (binding.method != 'HEAD' && (status == 200 || status == 206)) {
    if (length > binding.max) return __s3_body_failure('too-large');
    output.s3Body = true; output.bodyHandle = body; output.s3Length = i32(length); output.s3Deadline = __s3_deadlines[index];
    __s3_bodies.push(output);
  }
  return __pulse_fastly_put(output);
}
function __s3_body_remaining(value: __PulseFastlyValue): i32 {
  const now = __s3_clock(1), ns = value.s3Deadline - now;
  return now < 0 || ns <= 0 ? 0 : i32((ns + 999999) / 1000000);
}
function __s3_body_wait(value: __PulseFastlyValue, handle: i32): bool {
  const timeout = __s3_body_remaining(value); if (!timeout) return false;
  const handles = new StaticArray<i32>(1), done = new StaticArray<i32>(1); handles[0] = handle;
  return __s3_select(changetype<usize>(handles), 1, timeout, changetype<usize>(done)) == 0 && done[0] != -1 && __s3_body_remaining(value) > 0;
}
function __s3_copy_body(value: __PulseFastlyValue, output: i32): bool {
  const buffer = new Uint8Array(16384), size = new StaticArray<i32>(1), written = new StaticArray<i32>(1);
  let count = 0;
  while (true) {
    if (!__s3_body_wait(value, value.bodyHandle)) return false;
    if (fastly_http_body_read(value.bodyHandle, buffer.dataStart, buffer.length, changetype<usize>(size)) != 0 || size[0] < 0 || size[0] > buffer.length) return false;
    if (__s3_body_remaining(value) == 0) return false;
    if (!size[0]) return count == value.s3Length;
    count += size[0]; if (count > value.s3Length) return false;
    let offset = 0;
    while (offset < size[0]) {
      if (!__s3_body_wait(value, output)) return false;
      if (fastly_http_body_write(output, buffer.dataStart + offset, size[0] - offset, 0, changetype<usize>(written)) != 0 || written[0] <= 0 || written[0] > size[0] - offset) return false;
      offset += written[0];
    }
  }
}
function __s3_send_body(value: __PulseFastlyValue): i32 {
  if (!__s3_body_remaining(value)) return __pulse_fastly_send_result(__s3_body_failure('timeout'));
  const response = new StaticArray<i32>(1), body = new StaticArray<i32>(1);
  if (fastly_http_resp_new(changetype<usize>(response)) != 0) return 1;
  if (fastly_http_body_new(changetype<usize>(body)) != 0) { __s3_close_resp(response[0]); return 1; }
  let ok = fastly_http_resp_status_set(response[0], value.status) == 0;
  for (let i = 0; ok && i < value.headers.length; i++) {
    const header = value.headers[i], name = __pulse_s3_bytes(header.name), data = __pulse_s3_bytes(header.value);
    ok = fastly_http_resp_header_append(response[0], name.dataStart, name.length, data.dataStart, data.length) == 0;
  }
  if (!ok || fastly_http_resp_send_downstream(response[0], body[0], 1) != 0) { __s3_close_resp(response[0]); __s3_close_body(body[0]); return 1; }
  ok = __s3_copy_body(value, body[0]);
  __s3_close_body(value.bodyHandle); value.s3Body = false;
  // close is successful EOF for a streaming handle. On failure leave it unfinished:
  // Compute aborts the downstream stream when this invocation exits (SDK semantics).
  return ok ? __s3_close_body(body[0]) : 1;
}
