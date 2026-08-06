@external("pulse_guest_memory", "pulse_guest_span_checksum")
declare function guestChecksum(pointer: usize, length: u32): u32

const MEMORY_PAGES: usize = 32
const MEMORY_BYTES: usize = MEMORY_PAGES * 65536
const VALID_BASE: usize = 8 * 65536
const EVERY_BYTE_POINTER: usize = VALID_BASE + 1024
const EVERY_BYTE_LENGTH: i32 = 64
const EVERY_BYTE_SEED: u32 = 0x66
const MAX_GUEST_LENGTH: u32 = 4096
const INVALID_RANGE: u32 = 0x80000000
const VALID_RESULT_MASK: u32 = 0x7fffffff
const SENTINEL_BEFORE: u8 = 0xa5
const SENTINEL_AFTER: u8 = 0x5a
const FNV_OFFSET_BASIS: u32 = 0x811c9dc5
const FNV_PRIME: u32 = 0x01000193
const PRIMARY_LAYOUT_MARKER: usize = memory.data<u8>([
  0x41, 0x53, 0x2d, 0x41, 0x32, 0x2d, 0x4d, 0x41,
  0x52, 0x4b, 0x45, 0x52, 0x2d, 0x30, 0x31, 0x21
])
const GUEST_DOMAIN_0: u8 = 0x50
const GUEST_DOMAIN_1: u8 = 0x4c
const GUEST_DOMAIN_2: u8 = 0x53
const GUEST_DOMAIN_3: u8 = 0x32

function patternByte(index: i32, seed: u32): u8 {
  return <u8>((seed + <u32>index * 29 + (<u32>index << 1)) & 0xff)
}

function expectedChecksum(length: i32, seed: u32): u32 {
  let hash = FNV_OFFSET_BASIS
  hash = (hash ^ <u32>GUEST_DOMAIN_0) * FNV_PRIME
  hash = (hash ^ <u32>GUEST_DOMAIN_1) * FNV_PRIME
  hash = (hash ^ <u32>GUEST_DOMAIN_2) * FNV_PRIME
  hash = (hash ^ <u32>GUEST_DOMAIN_3) * FNV_PRIME
  for (let index = 0; index < length; index += 1) {
    hash ^= <u32>patternByte(index, seed)
    hash *= FNV_PRIME
  }
  return hash & VALID_RESULT_MASK
}

export function pulseRunMemoryCase(caseId: i32): u32 {
  if (
    load<u8>(PRIMARY_LAYOUT_MARKER) != 0x41
    || load<u8>(PRIMARY_LAYOUT_MARKER + 15) != 0x21
  ) {
    return 0x6000
  }
  let pointer: usize = VALID_BASE + 1
  let length: i32 = 0
  let seed: u32 = 0x11

  if (caseId == 1) {
    pointer = VALID_BASE + 17
    length = 1
    seed = 0x22
  } else if (caseId == 2) {
    pointer = VALID_BASE + 35
    length = 7
    seed = 0x33
  } else if (caseId == 3) {
    pointer = VALID_BASE + 64
    length = 32
    seed = 0x44
  } else if (caseId == 4) {
    pointer = MEMORY_BYTES - 65
    length = 64
    seed = 0x55
  } else if (caseId != 0) {
    return 0x7000 + <u32>caseId
  }

  const before = pointer - 1
  const after = pointer + <usize>length
  store<u8>(before, SENTINEL_BEFORE)
  store<u8>(after, SENTINEL_AFTER)
  for (let index = 0; index < length; index += 1) {
    store<u8>(pointer + <usize>index, patternByte(index, seed))
  }

  const expected = expectedChecksum(length, seed)
  const actual = guestChecksum(pointer, <u32>length)
  if (actual != expected) {
    return 0x1000 + <u32>caseId
  }
  if (load<u8>(before) != SENTINEL_BEFORE) {
    return 0x2000 + <u32>caseId
  }
  if (load<u8>(after) != SENTINEL_AFTER) {
    return 0x3000 + <u32>caseId
  }
  for (let index = 0; index < length; index += 1) {
    if (load<u8>(pointer + <usize>index) != patternByte(index, seed)) {
      return 0x4000 + <u32>caseId
    }
  }
  return 0
}

export function pulseGuestInvalidStatus(pointer: usize, length: u32): u32 {
  return guestChecksum(pointer, length)
}

export function pulseRunEveryByteProbe(): u32 {
  const before = EVERY_BYTE_POINTER - 1
  const after = EVERY_BYTE_POINTER + <usize>EVERY_BYTE_LENGTH
  store<u8>(before, SENTINEL_BEFORE)
  store<u8>(after, SENTINEL_AFTER)
  for (let index = 0; index < EVERY_BYTE_LENGTH; index += 1) {
    store<u8>(
      EVERY_BYTE_POINTER + <usize>index,
      patternByte(index, EVERY_BYTE_SEED)
    )
  }

  const baseline = guestChecksum(EVERY_BYTE_POINTER, <u32>EVERY_BYTE_LENGTH)
  if (baseline != expectedChecksum(EVERY_BYTE_LENGTH, EVERY_BYTE_SEED)) {
    return 0x5000
  }
  for (let index = 0; index < EVERY_BYTE_LENGTH; index += 1) {
    const address = EVERY_BYTE_POINTER + <usize>index
    const original = load<u8>(address)
    store<u8>(address, original ^ 1)
    const altered = guestChecksum(EVERY_BYTE_POINTER, <u32>EVERY_BYTE_LENGTH)
    store<u8>(address, original)
    if (altered == baseline) {
      return 0x5100 + <u32>index
    }
  }
  if (load<u8>(before) != SENTINEL_BEFORE) {
    return 0x5200
  }
  if (load<u8>(after) != SENTINEL_AFTER) {
    return 0x5300
  }
  for (let index = 0; index < EVERY_BYTE_LENGTH; index += 1) {
    if (
      load<u8>(EVERY_BYTE_POINTER + <usize>index)
      != patternByte(index, EVERY_BYTE_SEED)
    ) {
      return 0x5400 + <u32>index
    }
  }
  return 0
}

export function pulseEveryBytePointer(): usize {
  return EVERY_BYTE_POINTER
}

export function pulseEveryByteLength(): i32 {
  return EVERY_BYTE_LENGTH
}

export function pulseMemoryBytes(): usize {
  return MEMORY_BYTES
}

export function pulseMaxGuestLength(): u32 {
  return MAX_GUEST_LENGTH
}

export function pulseInvalidRangeStatus(): u32 {
  return INVALID_RANGE
}

export function pulsePrimaryLayoutMarkerPointer(): usize {
  return PRIMARY_LAYOUT_MARKER
}
