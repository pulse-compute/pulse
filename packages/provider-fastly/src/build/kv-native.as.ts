// Fastly Native realization of the runtime-owned K1/K2 conditional KV contract.
// Limits are generated from runtime/host. No SDK or unconditional CAS fallback.
@external('fastly_async_io', 'select') declare function __kv_select(handles: usize, count: i32, timeout: i32, ready: usize): i32
@external('fastly_http_body', 'close') declare function __kv_close(body: i32): i32

@lazy const __kv_deadline = new StaticArray<i64>(PULSE_FASTLY_EFFECT_COUNT)
@lazy const __kv_dispatched = new StaticArray<bool>(PULSE_FASTLY_EFFECT_COUNT)
let __kv_request_deadline: i64 = -1;
// Host embedding seam, in monotonic nanoseconds; never exposed through ctx.
export function pulse_fastly_kv_request_deadline(deadline: i64): void { __kv_request_deadline = deadline; }
function __kv_clock(): i64 {
  const out = new StaticArray<i64>(1);
  return wasi_snapshot_preview1_clock_time_get(1, 1, changetype<usize>(out)) == 0 ? out[0] : -1;
}
function __kv_remaining(index: i32): i32 {
  const now = __kv_clock();
  if (now < 0) return -1;
  const remaining = __kv_deadline[index] - now;
  return remaining <= 0 ? 0 : i32((remaining + 999999) / 1000000);
}
function __kv_set(result: i32, key: string, value: i32): void { host_value_object_set(result, __pulse_fastly_string_value(key), value); }
function __kv_result(status: string, reason: string = ''): i32 {
  const result = host_value_object(); __kv_set(result, 'status', __pulse_fastly_string_value(status));
  if (reason.length) __kv_set(result, 'reason', __pulse_fastly_string_value(reason));
  return result;
}
function __kv_failure(index: i32, reason: string): i32 {
  return __kv_result(__pulse_fastly_effect_kind(index) == 15 ? 'failed' : __kv_dispatched[index] ? 'unknown' : 'not-stored', reason);
}
function __kv_fail(index: i32, reason: string): void { __pulse_fastly_ready_effect(index, __kv_failure(index, reason)); }
function __kv_expired(index: i32): bool {
  const remaining = __kv_remaining(index);
  if (remaining > 0) return false;
  __kv_fail(index, remaining == 0 ? 'timeout' : 'unavailable'); return true;
}
// select readiness guarantees the corresponding I/O action will not block.
// Zero timeout means infinity in this ABI, so it must never be passed.
function __kv_ready(index: i32, handle: i32): i32 {
  const remaining = __kv_remaining(index); if (remaining <= 0) return remaining;
  const handles = new StaticArray<i32>(1), out = new StaticArray<i32>(1);
  handles[0] = handle; out[0] = -1;
  if (__kv_select(changetype<usize>(handles), 1, remaining, changetype<usize>(out)) != 0) return -1;
  const after = __kv_remaining(index); if (after <= 0) return after;
  return out[0] == 0 ? 1 : out[0] == -1 ? 0 : -2;
}
function __kv_ready_failure(index: i32, ready: i32): i32 { return __kv_failure(index, ready == 0 ? 'timeout' : ready == -2 ? 'protocol' : 'transport'); }
function __kv_key(text: string): bool {
  if (text == ' ' || text == '\ufffe' || text == '\uffff') return false;
  if (!text.length || text.length > __KV_keyBytes || String.UTF8.byteLength(text) > __KV_keyBytes) return false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 || (c >= 127 && c <= 159)) return false;
    if (c >= 0xd800 && c <= 0xdbff) { if (++i >= text.length) return false; const next = text.charCodeAt(i); if (next < 0xdc00 || next > 0xdfff) return false; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  // Fastly's exact-key restrictions; never normalize an application key.
  return text != '.' && text != '..' && !text.startsWith('.well-known/acme-challenge')
    && text.indexOf('./') < 0 && !text.endsWith('/.') && !text.endsWith('/..')
    && text.indexOf('#') < 0 && text.indexOf('?') < 0 && text.indexOf('^') < 0
    && text.indexOf('|') < 0 && text.indexOf(';') < 0 && text.indexOf('\n') < 0 && text.indexOf('\r') < 0;
}
function __kv_token_valid(token: string): bool {
  if (token.length != 29 || !token.startsWith('fastly-kv-v1:')) return false;
  for (let i = 13; i < 29; i++) { const c = token.charCodeAt(i); if (!(c >= 48 && c <= 57) && !(c >= 97 && c <= 102)) return false; }
  return true;
}
function __kv_generation(token: string): u64 {
  let value: u64 = 0;
  for (let i = 13; i < 29; i++) { const c = token.charCodeAt(i); value = (value << 4) | u64(c <= 57 ? c - 48 : c - 87); }
  return value;
}
function __kv_token(value: u64): string {
  let text = 'fastly-kv-v1:';
  for (let i = 15; i >= 0; i--) text += '0123456789abcdef'.charAt(i32((value >> (i * 4)) & 15));
  return text;
}
function __kv_number(value: f64): string {
  const text = __pulse_fastly_number_string(value);
  // AS prints a trailing .0 for large integral f64s; JSON.stringify does not.
  // Count the portable serialized value budget, including this boundary case.
  return text.endsWith('.0') ? text.substring(0, text.length - 2) : text;
}
function __kv_private(text: string): void {
  __pulse_fastly_remember_secret(text);
  const encoded = __pulse_fastly_quote(text);
  __pulse_fastly_remember_secret(encoded.substring(1, encoded.length - 1));
}
class __KvEncoder {
  reason: string = ''; entries: i32 = 0; bytes: i32 = 0;
  seen: Set<i32> = new Set<i32>(); parts: Array<string> = new Array<string>();
  add(text: string): void { this.bytes += String.UTF8.byteLength(text); if (this.bytes > __KV_valueBytes) this.reason = 'too-large'; else this.parts.push(text); }
  visit(handle: i32, depth: i32 = 0): void {
    if (this.reason.length) return;
    if (++this.entries > __KV_entries || depth > __KV_depth) { this.reason = 'too-large'; return; }
    const value = __pulse_fastly_value(handle);
    if (value.kind == PULSE_VALUE_NULL) this.add('null');
    else if (value.kind == PULSE_VALUE_BOOLEAN) this.add(value.boolean ? 'true' : 'false');
    else if (value.kind == PULSE_VALUE_STRING) { __kv_private(value.text); this.add(__pulse_fastly_quote(value.text)); }
    else if (value.kind == PULSE_VALUE_NUMBER) { if (!isFinite(value.number)) this.reason = 'invalid-value'; else this.add(value.number == 0 ? '0' : __kv_number(value.number)); }
    else if (value.kind == PULSE_VALUE_ARRAY || value.kind == PULSE_VALUE_OBJECT) {
      if (this.seen.has(handle)) { this.reason = 'invalid-value'; return; } this.seen.add(handle);
      const object = value.kind == PULSE_VALUE_OBJECT; this.add(object ? '{' : '[');
      for (let i = 0; i < value.values.length && !this.reason.length; i++) {
        if (i) this.add(',');
        if (object) { __kv_private(value.keys[i]); this.add(__pulse_fastly_quote(value.keys[i]) + ':'); }
        this.visit(value.values[i], depth + 1);
      }
      this.add(object ? '}' : ']');
    } else this.reason = 'invalid-value';
  }
  encode(handle: i32): string { this.visit(handle); return this.reason.length ? '' : this.parts.join(''); }
}
function __pulse_fastly_kv_conditional_begin(index: i32, payload: __PulseFastlyValue): void {
  __kv_dispatched[index] = false;
  const start = __kv_clock(); if (start < 0) { __kv_fail(index, 'unavailable'); return; }
  __kv_deadline[index] = start + i64(__KV_timeoutMs) * 1000000;
  if (__kv_request_deadline >= 0 && __kv_request_deadline < __kv_deadline[index]) __kv_deadline[index] = __kv_request_deadline;
  const kind = __pulse_fastly_effect_kind(index), key = __pulse_fastly_value(__pulse_fastly_payload_field(payload, 'key'));
  if (key.kind != PULSE_VALUE_STRING || !__kv_key(key.text)) { __kv_fail(index, 'invalid-key'); return; }
  __kv_private(key.text);
  let generation: u64 = 0;
  if (kind == 17) {
    const token = __pulse_fastly_value(__pulse_fastly_payload_field(payload, 'generation'));
    if (token.kind != PULSE_VALUE_STRING || !__kv_token_valid(token.text)) { __kv_fail(index, 'invalid-generation'); return; }
    __kv_private(token.text); generation = __kv_generation(token.text);
  }
  let wire = '';
  if (kind != 15) {
    const encoder = new __KvEncoder(); const json = encoder.encode(__pulse_fastly_payload_field(payload, 'value'));
    if (encoder.reason.length) { __kv_fail(index, encoder.reason); return; }
    // Immutable string snapshot exists before any binding/body/dispatch hostcall.
    wire = '{"__pulseKv":1,"value":' + json + '}';
    if (String.UTF8.byteLength(wire) > __KV_wireBytes) { __kv_fail(index, 'too-large'); return; }
  }
  if (__kv_expired(index)) return;
  const name = __pulse_fastly_utf8(__pulse_fastly_kv_store(index)), storeHandle = new StaticArray<i32>(1);
  if (fastly_kv_store_open(changetype<usize>(name), name.byteLength, changetype<usize>(storeHandle)) != 0) { __kv_fail(index, 'configuration'); return; }
  if (__kv_expired(index)) return;
  const keyBytes = __pulse_fastly_utf8(key.text), pending = new StaticArray<i32>(1); let status: i32;
  if (kind == 15) {
    const config = new StaticArray<i32>(1);
    status = fastly_kv_store_lookup(storeHandle[0], changetype<usize>(keyBytes), keyBytes.byteLength, 0, changetype<usize>(config), changetype<usize>(pending));
  } else {
    const body = new StaticArray<i32>(1), written = new StaticArray<i32>(1);
    if (fastly_http_body_new(changetype<usize>(body)) != 0) { __kv_fail(index, 'transport'); return; }
    if (__kv_expired(index)) { __kv_close(body[0]); return; }
    const bytes = __pulse_fastly_utf8(wire);
    status = fastly_http_body_write(body[0], changetype<usize>(bytes), bytes.byteLength, 0, changetype<usize>(written));
    if (status != 0 || written[0] != bytes.byteLength) { __kv_close(body[0]); __kv_fail(index, status != 0 ? 'transport' : 'protocol'); return; }
    if (__kv_expired(index)) { __kv_close(body[0]); return; }
    const config = new StaticArray<u64>(4); // 32 zeroed bytes, including padding.
    if (kind == 16) store<u32>(changetype<usize>(config), 1);
    else store<u64>(changetype<usize>(config) + 24, generation);
    __kv_dispatched[index] = true; // Entry is the conservative mutation boundary.
    status = fastly_kv_store_insert(storeHandle[0], changetype<usize>(keyBytes), keyBytes.byteLength, body[0], kind == 17 ? 32 : 0, changetype<usize>(config), changetype<usize>(pending));
    // Insert takes ownership on success. On error the body may already be consumed;
    // best-effort close cannot turn uncertain acceptance into rejection.
    if (status != 0) __kv_close(body[0]);
  }
  if (status != 0) { __kv_fail(index, 'transport'); return; }
  __pulse_fastly_pending[index] = pending[0]; __pulse_fastly_pending_mode[index] = PULSE_FASTLY_PENDING_ASYNC;
}
function __kv_utf8(data: Uint8Array, length: i32): bool {
  for (let i = 0; i < length;) {
    const c = data[i++]; if (c <= 127) continue;
    const count = c >= 194 && c <= 223 ? 1 : c >= 224 && c <= 239 ? 2 : c >= 240 && c <= 244 ? 3 : -1;
    if (count < 0 || i + count > length) return false;
    const second = data[i];
    if ((c == 224 && second < 160) || (c == 237 && second > 159) || (c == 240 && second < 144) || (c == 244 && second > 143)) return false;
    for (let j = 0; j < count; j++) { const next = data[i++]; if (next < 128 || next > 191) return false; }
  }
  return true;
}
function __kv_read(index: i32, body: i32, generation: u64): i32 {
  const buffer = new Uint8Array(__KV_wireBytes + 1), written = new StaticArray<i32>(1); let count = 0;
  while (true) {
    const ready = __kv_ready(index, body); if (ready <= 0) return __kv_ready_failure(index, ready);
    written[0] = 0;
    if (fastly_http_body_read(body, buffer.dataStart + count, buffer.length - count, changetype<usize>(written)) != 0) return __kv_failure(index, 'transport');
    if (written[0] < 0 || written[0] > buffer.length - count) return __kv_failure(index, 'protocol');
    if (!written[0]) break;
    count += written[0]; if (count > __KV_wireBytes) return __kv_failure(index, 'too-large');
  }
  if (!__kv_utf8(buffer, count)) return __kv_failure(index, 'protocol');
  const parser = new __PulseJsonParser(String.UTF8.decodeUnsafe(buffer.dataStart, count, false), true), parsed = parser.parse();
  if (parser.failed || parsed <= 0) return __kv_failure(index, parser.tooLarge ? 'too-large' : 'protocol');
  const outer = __pulse_fastly_value(parsed);
  if (outer.kind != PULSE_VALUE_OBJECT || outer.keys.length != 2 || __pulse_fastly_find(outer, '__pulseKv') < 0 || __pulse_fastly_find(outer, 'value') < 0) return __kv_failure(index, 'protocol');
  const marker = __pulse_fastly_value(__pulse_fastly_payload_field(outer, '__pulseKv'));
  if (marker.kind != PULSE_VALUE_NUMBER || marker.number != 1) return __kv_failure(index, 'protocol');
  const value = __pulse_fastly_payload_field(outer, 'value'), encoder = new __KvEncoder(); encoder.encode(value);
  if (encoder.reason.length) return __kv_failure(index, encoder.reason);
  const remaining = __kv_remaining(index); if (remaining <= 0) return __kv_failure(index, remaining == 0 ? 'timeout' : 'unavailable');
  const result = __kv_result('found'), token = __kv_token(generation); __kv_private(token);
  __kv_set(result, 'generation', __pulse_fastly_string_value(token)); __kv_set(result, 'value', value);
  __pulse_fastly_deep_freeze(result); return result;
}
function __kv_wait(index: i32): i32 {
  if (__pulse_fastly_pending_mode[index] == PULSE_FASTLY_PENDING_READY) return __pulse_fastly_wait_ready(index);
  const pending = __pulse_fastly_pending[index];
  __pulse_fastly_pending_mode[index] = PULSE_FASTLY_PENDING_NONE; __pulse_fastly_pending[index] = 0; __pulse_fastly_payloads[index] = 0;
  // No KV cancel hostcall exists. An expired pending handle is left to invocation
  // teardown; never call an unready wait just to drain it, and never retry.
  const ready = __kv_ready(index, pending); if (ready <= 0) return __kv_ready_failure(index, ready);
  const error = new StaticArray<i32>(1), kind = __pulse_fastly_effect_kind(index);
  if (kind != 15) {
    const status = fastly_kv_store_insert_wait(pending, changetype<usize>(error));
    if (status != 0) return __kv_failure(index, 'transport');
    const remaining = __kv_remaining(index); if (remaining <= 0) return __kv_failure(index, remaining == 0 ? 'timeout' : 'unavailable');
    if (error[0] == 1) return __kv_result('stored');
    if (error[0] == 4 || (error[0] == 3 && kind == 17)) return __kv_result('conflict');
    if (error[0] == 2 || error[0] == 5 || error[0] == 7) return __kv_result('not-stored', error[0] == 2 ? 'rejected' : error[0] == 5 ? 'too-large' : 'throttled');
    return __kv_failure(index, error[0] == 6 ? 'unavailable' : 'protocol');
  }
  const body = new StaticArray<i32>(1), metadata = new Uint8Array(2000), written = new StaticArray<i32>(1), generation = new StaticArray<u64>(1);
  const status = fastly_kv_store_lookup_wait_v2(pending, changetype<usize>(body), metadata.dataStart, metadata.length, changetype<usize>(written), changetype<usize>(generation), changetype<usize>(error));
  if (status != 0) return __kv_failure(index, 'transport');
  if (error[0] != 1) {
    const remaining = __kv_remaining(index); if (remaining <= 0) return __kv_failure(index, remaining == 0 ? 'timeout' : 'unavailable');
    if (error[0] == 3) return __kv_result('not-found');
    return __kv_failure(index, error[0] == 5 ? 'too-large' : error[0] == 6 ? 'unavailable' : error[0] == 7 ? 'throttled' : 'protocol');
  }
  const result = written[0] < 0 || written[0] > metadata.length ? __kv_failure(index, 'protocol') : __kv_read(index, body[0], generation[0]);
  __kv_close(body[0]); return result;
}

function __pulse_fastly_kv_conditional_wait(index: i32): i32 {
  const result = __kv_wait(index); __pulse_fastly_deep_freeze(result); return result;
}
