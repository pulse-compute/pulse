@external("pulse_guest_memory", "pulse_guest_span_checksum")
declare function guestChecksum(pointer: usize, length: u32): u32

const NEGATIVE_POINTER: usize = 8 * 65536
const NEGATIVE_LENGTH: i32 = 16
const NEGATIVE_SEED: u32 = 0x31

function patternByte(index: i32): u8 {
  return <u8>((NEGATIVE_SEED + <u32>index * 29 + (<u32>index << 1)) & 0xff)
}

export function pulseNegativeControl(): u32 {
  for (let index = 0; index < NEGATIVE_LENGTH; index += 1) {
    store<u8>(NEGATIVE_POINTER + <usize>index, patternByte(index))
  }
  return guestChecksum(NEGATIVE_POINTER, <u32>NEGATIVE_LENGTH)
}

export function pulseNegativePointer(): usize {
  return NEGATIVE_POINTER
}

export function pulseNegativeLength(): i32 {
  return NEGATIVE_LENGTH
}

export function pulseNegativeByte(index: i32): u8 {
  return patternByte(index)
}
