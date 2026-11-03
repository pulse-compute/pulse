// Numeric evidence only. No payloads, keys, credentials, URLs or caller text.
// All times are monotonic wall microseconds, NOT CPU or pure network time.
class __LatSpan {
  start: i64 = 0; wait: i64 = 0; credentials: i64 = 0; signing: i64 = 0; body: i64 = 0;
}
@lazy const __lat_slots = new Array<__LatSpan | null>(PULSE_FASTLY_EFFECT_COUNT).fill(null);
@lazy const __lat_totals = new StaticArray<i64>(32 * 7);
@lazy const __lat_clock_out = new StaticArray<i64>(1);
let __lat_start: i64 = 0, __lat_last: i64 = 0;
let __lat_current: i32 = -1, __lat_dropped: i32 = 0, __lat_open: i32 = 0;
let __lat_valid: bool = true, __lat_sent: bool = false;
let __lat_rows: string = '';
function __lat_clock(): i64 {
  if (wasi_snapshot_preview1_clock_time_get(1, 1000, changetype<usize>(__lat_clock_out)) != 0
      || __lat_clock_out[0] < __lat_last) { __lat_valid = false; return __lat_last; }
  __lat_last = __lat_clock_out[0]; return __lat_last;
}
function __lat_begin(index: i32): void {
  if (index < 0 || index >= PULSE_FASTLY_EFFECT_COUNT) { __lat_valid = false; return; }
  if (__lat_slots[index] !== null) { __lat_valid = false; return; }
  const span = new __LatSpan(); span.start = __lat_clock(); __lat_slots[index] = span; __lat_open++;
}
function __lat_part(index: i32, part: i32): i64 {
  if (index < 0 || index >= PULSE_FASTLY_EFFECT_COUNT) return 0;
  const span = __lat_slots[index]; if (span === null) return 0;
  return part == 1 ? span.wait : part == 2 ? span.credentials : part == 3 ? span.signing : span.body;
}
function __lat_add(index: i32, part: i32, ns: i64): void {
  if (index < 0 || index >= PULSE_FASTLY_EFFECT_COUNT) return;
  const span = __lat_slots[index]; if (span === null) return;
  if (ns < 0) { __lat_valid = false; return; }
  if (part == 1) span.wait += ns;
  else if (part == 2) span.credentials += ns;
  else if (part == 3) span.signing += ns;
  else span.body += ns;
}
function __lat_finish(index: i32): void {
  if (index < 0 || index >= PULSE_FASTLY_EFFECT_COUNT) return;
  const span = __lat_slots[index]; if (span === null) return;
  const elapsed = __lat_clock() - span.start, kind = __pulse_fastly_effect_kind(index);
  __lat_slots[index] = null; __lat_open--;
  if (kind < 0 || kind >= 32) { __lat_valid = false; return; }
  const offset = kind * 7;
  __lat_totals[offset]++; __lat_totals[offset + 1] += elapsed;
  __lat_totals[offset + 2] += span.wait; __lat_totals[offset + 3] += span.credentials;
  __lat_totals[offset + 4] += span.signing; __lat_totals[offset + 5] += span.body;
  const row = '[' + index.toString() + ',' + kind.toString() + ',' + ((span.start - __lat_start) / 1000).toString()
    + ',' + (elapsed / 1000).toString() + ',' + (span.wait / 1000).toString() + ',' + (span.credentials / 1000).toString()
    + ',' + (span.signing / 1000).toString() + ',' + (span.body / 1000).toString() + ']';
  if (__lat_rows.length + row.length + 1 <= 2400) __lat_rows += (__lat_rows.length ? ',' : '') + row;
  else __lat_dropped++;
}
function __lat_emit(handle: i32): void {
  if (__lat_sent) return; __lat_sent = true;
  const wall = (__lat_clock() - __lat_start) / 1000;
  let totals = '';
  for (let kind = 0; kind < 32; kind++) {
    const offset = kind * 7; if (__lat_totals[offset] == 0) continue;
    totals += (totals.length ? ',' : '') + '[' + kind.toString() + ',' + __lat_totals[offset].toString();
    for (let part = 1; part <= 5; part++) totals += ',' + (__lat_totals[offset + part] / 1000).toString();
    totals += ']';
  }
  const prefix = '{"v":1,"valid":' + (__lat_valid ? 'true' : 'false') + ',"wallUs":' + wall.toString()
    + ',"open":' + __lat_open.toString() + ',"dropped":' + __lat_dropped.toString() + ',"totals":[' + totals + '],"spans":[';
  // A bounded application can still visit many effect kinds. Never exceed 4096 bytes.
  const value = prefix + __lat_rows + ']}';
  if (value.length > 4096) return;
  const nameBytes = String.UTF8.encode('x-pulse-latency'), valueBytes = String.UTF8.encode(value);
  // Header failure must not alter response status, acceptance or deadline policy.
  fastly_http_resp_header_append(handle, changetype<usize>(nameBytes), nameBytes.byteLength, changetype<usize>(valueBytes), valueBytes.byteLength);
}
