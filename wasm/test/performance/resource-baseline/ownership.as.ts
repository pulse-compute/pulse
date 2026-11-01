// P11A ownership-only control. This is a fixture, never a production service.
const WIDTH: i32 = __WIDTH__;
const PULSE_FASTLY_EFFECT_COUNT: i32 = WIDTH, PULSE_ERROR_STATE: i32 = 1007;
const EMPTY: i32 = 0, PREPARED: i32 = 1, OWNED: i32 = 2, FENCED: i32 = 3, RELEASED: i32 = 4, UNKNOWN: i32 = 5;
const states = new StaticArray<i32>(WIDTH), handles = new StaticArray<i32>(WIDTH);
const generations = new StaticArray<i32>(WIDTH), buffers = new StaticArray<usize>(WIDTH);
const lengths = new StaticArray<i32>(WIDTH);
let primary: i32 = 0, delivered: i32 = 0, checksumTotal: i32 = 0, cleaned: bool = false, rejectDelivery: bool = false;
@external('fixture', 'acquire') declare function acquire(namespace: i32, slot: i32): i32;
@external('fixture', 'read') declare function read(namespace: i32, handle: i32, pointer: usize, size: i32): i32;
@external('fixture', 'dispose') declare function dispose(namespace: i32, handle: i32): i32;
@external('fixture', 'remaining') declare function remaining(): i32;
__OBSERVER__
function __pulse_fastly_fail(code: i32, stage: i32, effect: i32): void { if (primary == 0) primary = stage; }
__INVOCATIONS__
__LIFECYCLE__
function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {
  __RESULT_GUARD__
  if (rejectDelivery) return 0;
  delivered++; checksumTotal += handle;
  return 1;
}
export function issue(index: i32): i32 {
  if (index < 0 || index >= WIDTH || primary != 0 || unchecked(states[index]) != EMPTY || !__pulse_invocation_begin(index)) return 0;
  const ticket = unchecked(__pulse_invocation_tickets[index]);
  unchecked(generations[index] = ticket);
  unchecked(states[index] = PREPARED); // Fence possible output before acquisition.
  note(1, index);
  const handle = acquire(index & 1, index);
  if (handle < 0) { unchecked(states[index] = UNKNOWN); __pulse_fastly_fail(1, 10, index); return 0; }
  unchecked(handles[index] = handle); unchecked(states[index] = OWNED);
  return ticket;
}
export function resolve(index: i32, ticket: i32, size: i32): i32 {
  if (__pulse_invocation_closed || primary != 0 || index < 0 || index >= WIDTH || ticket <= 0
    || unchecked(generations[index]) != ticket || unchecked(__pulse_invocation_tickets[index]) != ticket
    || unchecked(states[index]) != OWNED || size <= 0 || size > 65536) return 0;
  // One bounded binary backing allocation. No per-read buffer or text concat.
  const data = new Uint8Array(size + 1);
  unchecked(buffers[index] = data.dataStart); unchecked(lengths[index] = size + 1);
  const count = read(index & 1, unchecked(handles[index]), data.dataStart, size);
  if (count != size) { __pulse_fastly_fail(1, 11, index); return 0; }
  let checksum: i32 = 0;
  for (let i = 0; i < size; i++) checksum += unchecked(data[i]);
  note(2, index);
  return __pulse_invocation_settle(index, ticket, checksum);
}
function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  for (let i = 0; i < WIDTH; i++) {
    if (unchecked(__pulse_invocation_tickets[i]) != 0) unreachable();
    if (unchecked(states[i]) != OWNED || remaining() <= 0) continue;
    unchecked(states[i] = FENCED); // A trap/unknown never authorizes retry.
    note(3, i);
    const outcome = dispose(i & 1, unchecked(handles[i]));
    unchecked(states[i] = outcome == 0 ? RELEASED : UNKNOWN);
    if (outcome != 0) __pulse_fastly_fail(1, 12, i);
  }
}
export function close(): void { __pulse_invocation_close(); }
export function run(size: i32): i32 {
  if (size <= 0 || size > 65536) return 0;
  for (let i = 0; i < WIDTH; i++) { if (issue(i) == 0) break; }
  for (let i = 0; i < WIDTH && primary == 0; i++) resolve(i, unchecked(generations[i]), size);
  close();
  return delivered;
}
export function state(index: i32): i32 { return states[index]; }
export function ticket(index: i32): i32 { return __pulse_invocation_tickets[index]; }
export function generation(index: i32): i32 { return generations[index]; }
export function length(index: i32): i32 { return lengths[index]; }
export function byte(index: i32, offset: i32): i32 { if (offset < 0 || offset >= lengths[index]) unreachable(); return load<u8>(buffers[index] + offset); }
export function error(): i32 { return primary; }
export function deliveries(): i32 { return delivered; }
export function checksum(): i32 { return checksumTotal; }
export function reject(value: bool): void { rejectDelivery = value; }
export function metadataElementBytes(): i32 { return WIDTH * 24; } // Five fixture arrays plus production ticket array; excludes headers/globals.
export function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
