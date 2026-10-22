// Private proof template. The harness supplies LENGTH and byteAt; not Pulse IR.
let active: bool = false;
let generation: i32 = 0;
let spent: i32 = 0;
let error: i32 = 0;
const READ_LIMIT: i32 = 4194304;
export function begin(): i32 {
  error = 0;
  if (generation == 2147483647) { active = false; error = 5; return 0; }
  generation++; spent = 0; active = true; return generation;
}
export function close(): void { active = false; }
export function last_error(): i32 { return error; }
export function read_bytes(): i32 { return spent; }
export function byte_length(): i32 { return LENGTH; }
function admit(token: i32, offset: f64, width: i32): bool {
  error = 0;
  if (!active) { error = 1; return false; }
  if (token != generation) { error = 2; return false; }
  if (!isFinite(offset) || offset < 0 || Math.floor(offset) != offset
    || offset > f64(LENGTH) || f64(width) > f64(LENGTH) - offset) { error = 3; return false; }
  if (width > READ_LIMIT - spent) { active = false; error = 5; return false; }
  spent += width; return true;
}
function word(offset: i32): u32 {
  return u32(byteAt(offset)) | (u32(byteAt(offset + 1)) << 8)
    | (u32(byteAt(offset + 2)) << 16) | (u32(byteAt(offset + 3)) << 24);
}
export function read_u8(token: i32, offset: f64): f64 {
  return admit(token, offset, 1) ? f64(byteAt(i32(offset))) : 0;
}
export function u32le(token: i32, offset: f64): f64 {
  return admit(token, offset, 4) ? f64(word(i32(offset))) : 0;
}
export function f32le(token: i32, offset: f64): f64 {
  if (!admit(token, offset, 4)) return 0;
  const value = reinterpret<f32>(word(i32(offset)));
  if (!isFinite(value)) { error = 4; return 0; }
  return f64(value);
}
// Fixture-owned vector computation, deliberately outside the resource substrate.
export function distance(token: i32, row: i32, dimensions: i32): f64 {
  if (row < 0 || row > 4096 || dimensions < 1 || dimensions > 32) { error = 3; return 0; }
  let total: f64 = 0;
  for (let dimension = 0; dimension < dimensions; dimension++) {
    const value = f32le(token, 16 + (row * dimensions + dimension) * 4);
    if (error) return 0;
    const difference = value - f64(dimension) / 8;
    total += difference * difference;
  }
  return total;
}
export function checksum(token: i32): f64 {
  let sum: u32 = 0;
  for (let offset = 0; offset < LENGTH; offset++) {
    sum += u32(read_u8(token, offset)); if (error) return 0;
  }
  return f64(sum);
}
// Keep all growth checks inside the same invocation, without resetting the budget.
export function repeat(token: i32, count: i32): void {
  for (let index = 0; index < count; index++) { read_u8(token, 0); if (error) return; }
}
