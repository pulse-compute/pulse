// K1 ABI feasibility only. This is not a Pulse runtime or provider realization.
@external('fastly_kv_store', 'lookup_wait_v2')
declare function lookup_wait_v2(handle: i32, body: usize, metadata: usize, capacity: i32, written: usize, generation: usize, error: usize): i32;
@external('fastly_kv_store', 'insert')
declare function insert(store: i32, key: usize, keyLength: i32, body: i32, mask: i32, config: usize, pending: usize): i32;

const generation = new StaticArray<u64>(1);
const config = new StaticArray<u64>(4);
const metadata = new Uint8Array(2000);
const body = new StaticArray<i32>(1), written = new StaticArray<i32>(1), error = new StaticArray<i32>(1), pending = new StaticArray<i32>(1);
const key = String.UTF8.encode('key');
let token = new Uint8Array(0);

export function read_generation(): i32 {
  const status = lookup_wait_v2(1, changetype<usize>(body), metadata.dataStart, metadata.length,
    changetype<usize>(written), changetype<usize>(generation), changetype<usize>(error));
  token = new Uint8Array(0);
  if (status != 0 || error[0] != 1) return 0;
  const alphabet = '0123456789abcdef'; let text = 'fastly-kv-v1:';
  for (let n = 15; n >= 0; n--) text += alphabet.charAt(i32((generation[0] >> (n * 4)) & 15));
  token = Uint8Array.wrap(String.UTF8.encode(text)); return 1;
}
export function token_ptr(): usize { return token.dataStart; }
export function token_len(): i32 { return token.length; }
export function input_ptr(): usize { return metadata.dataStart; }
export function send_cas_token(length: i32): i32 {
  if (length != 29) return -1;
  const prefix = 'fastly-kv-v1:';
  for (let i = 0; i < prefix.length; i++) if (metadata[i] != prefix.charCodeAt(i)) return -1;
  let value: u64 = 0;
  for (let i = 13; i < length; i++) {
    const c = metadata[i];
    const digit = c >= 48 && c <= 57 ? i32(c) - 48 : c >= 97 && c <= 102 ? i32(c) - 87 : -1;
    if (digit < 0) return -1;
    value = (value << 4) | u64(digit);
  }
  for (let i = 0; i < 4; i++) config[i] = 0;
  // wasm32 C layout: mode at 0; generation at 24. Presence is in the mask;
  // zero bits in a supplied token never mean "drop the condition".
  store<u64>(changetype<usize>(config) + 24, value);
  return insert(1, changetype<usize>(key), key.byteLength, 1, 32, changetype<usize>(config), changetype<usize>(pending));
}
export function send_add(): i32 {
  for (let i = 0; i < 4; i++) config[i] = 0;
  store<u32>(changetype<usize>(config), 1);
  return insert(1, changetype<usize>(key), key.byteLength, 1, 0, changetype<usize>(config), changetype<usize>(pending));
}
