/*
 * Pulse first-party HS256 guest-source realization.
 *
 * Algorithm sources:
 * - NIST FIPS 180-4, Secure Hash Standard (SHA-256)
 * - RFC 2104, HMAC
 * - RFC 4231, HMAC-SHA test vectors
 *
 * This implementation is original Apache-2.0 Pulse source derived from the
 * published algorithms. It has no host imports, ambient text encoding, or
 * guest-link dependency.
 */

const __PULSE_CRYPTO_VALID: i32 = 1
const __PULSE_CRYPTO_INVALID_AUTHENTICATOR: i32 = 0
const __PULSE_CRYPTO_INVALID_KEY: i32 = -1
const __PULSE_CRYPTO_INVALID_INPUT: i32 = -2

const __PULSE_CRYPTO_HS256_KEY_MIN: i32 = 32
const __PULSE_CRYPTO_HS256_KEY_MAX: i32 = 4096
const __PULSE_CRYPTO_HS256_DATA_MAX: i32 = 1024 * 1024
const __PULSE_CRYPTO_HS256_TAG_BYTES: i32 = 32
const __PULSE_CRYPTO_SHA256_BLOCK_BYTES: i32 = 64

const __PULSE_CRYPTO_SHA256_K = StaticArray.fromArray<u32>([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

@inline
function __pulse_crypto_rotr(value: u32, bits: i32): u32 {
  return (value >>> bits) | (value << (32 - bits))
}

class __PulseCryptoSha256 {
  private state: StaticArray<u32> = StaticArray.fromArray<u32>([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ])
  private block: StaticArray<u8> = new StaticArray<u8>(__PULSE_CRYPTO_SHA256_BLOCK_BYTES)
  private schedule: StaticArray<u32> = new StaticArray<u32>(64)
  private blockLength: i32 = 0
  private totalBytes: u64 = 0

  updateByte(value: u8): void {
    unchecked(this.block[this.blockLength] = value)
    this.blockLength += 1
    this.totalBytes += 1
    if (this.blockLength == __PULSE_CRYPTO_SHA256_BLOCK_BYTES) {
      this.transform()
      this.blockLength = 0
    }
  }

  updateMemory(pointer: usize, length: i32): void {
    for (let index: i32 = 0; index < length; index += 1) {
      this.updateByte(load<u8>(pointer + <usize>index))
    }
  }

  updateStatic(bytes: StaticArray<u8>, length: i32): void {
    for (let index: i32 = 0; index < length; index += 1) {
      this.updateByte(unchecked(bytes[index]))
    }
  }

  finish(): StaticArray<u8> {
    const bitLength = this.totalBytes * 8
    this.updateByte(0x80)
    while (this.blockLength != 56) this.updateByte(0)
    for (let shift: i32 = 56; shift >= 0; shift -= 8) {
      this.updateByte(<u8>(bitLength >> shift))
    }

    const output = new StaticArray<u8>(__PULSE_CRYPTO_HS256_TAG_BYTES)
    for (let wordIndex: i32 = 0; wordIndex < 8; wordIndex += 1) {
      const word = unchecked(this.state[wordIndex])
      const offset = wordIndex * 4
      unchecked(output[offset] = <u8>(word >> 24))
      unchecked(output[offset + 1] = <u8>(word >> 16))
      unchecked(output[offset + 2] = <u8>(word >> 8))
      unchecked(output[offset + 3] = <u8>word)
    }
    for (let index: i32 = 0; index < this.state.length; index += 1) {
      unchecked(this.state[index] = 0)
    }
    for (let index: i32 = 0; index < this.block.length; index += 1) {
      unchecked(this.block[index] = 0)
    }
    for (let index: i32 = 0; index < this.schedule.length; index += 1) {
      unchecked(this.schedule[index] = 0)
    }
    return output
  }

  private transform(): void {
    const schedule = this.schedule
    for (let index: i32 = 0; index < 16; index += 1) {
      const offset = index * 4
      unchecked(schedule[index] =
        (<u32>unchecked(this.block[offset]) << 24)
        | (<u32>unchecked(this.block[offset + 1]) << 16)
        | (<u32>unchecked(this.block[offset + 2]) << 8)
        | <u32>unchecked(this.block[offset + 3]))
    }
    for (let index: i32 = 16; index < 64; index += 1) {
      const before15 = unchecked(schedule[index - 15])
      const before2 = unchecked(schedule[index - 2])
      const sigma0 = __pulse_crypto_rotr(before15, 7)
        ^ __pulse_crypto_rotr(before15, 18)
        ^ (before15 >>> 3)
      const sigma1 = __pulse_crypto_rotr(before2, 17)
        ^ __pulse_crypto_rotr(before2, 19)
        ^ (before2 >>> 10)
      unchecked(schedule[index] =
        unchecked(schedule[index - 16])
        + sigma0
        + unchecked(schedule[index - 7])
        + sigma1)
    }

    let a = unchecked(this.state[0])
    let b = unchecked(this.state[1])
    let c = unchecked(this.state[2])
    let d = unchecked(this.state[3])
    let e = unchecked(this.state[4])
    let f = unchecked(this.state[5])
    let g = unchecked(this.state[6])
    let h = unchecked(this.state[7])

    for (let index: i32 = 0; index < 64; index += 1) {
      const sum1 = __pulse_crypto_rotr(e, 6)
        ^ __pulse_crypto_rotr(e, 11)
        ^ __pulse_crypto_rotr(e, 25)
      const choose = (e & f) ^ ((~e) & g)
      const temporary1 = h
        + sum1
        + choose
        + unchecked(__PULSE_CRYPTO_SHA256_K[index])
        + unchecked(schedule[index])
      const sum0 = __pulse_crypto_rotr(a, 2)
        ^ __pulse_crypto_rotr(a, 13)
        ^ __pulse_crypto_rotr(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = sum0 + majority

      h = g
      g = f
      f = e
      e = d + temporary1
      d = c
      c = b
      b = a
      a = temporary1 + temporary2
    }

    unchecked(this.state[0] += a)
    unchecked(this.state[1] += b)
    unchecked(this.state[2] += c)
    unchecked(this.state[3] += d)
    unchecked(this.state[4] += e)
    unchecked(this.state[5] += f)
    unchecked(this.state[6] += g)
    unchecked(this.state[7] += h)
  }
}

function __pulse_crypto_wipe(bytes: StaticArray<u8>): void {
  for (let index: i32 = 0; index < bytes.length; index += 1) {
    unchecked(bytes[index] = 0)
  }
}

function __pulse_crypto_memory_range_valid(pointer: i32, length: i32): bool {
  if (pointer < 0 || length < 0) return false
  if (length == 0) return true
  const start = <u64><u32>pointer
  const byteLength = <u64>memory.size() << 16
  const end = start + <u64><u32>length
  return end >= start && end <= byteLength
}

function __pulse_crypto_sha256_memory(pointer: usize, length: i32): StaticArray<u8> {
  const sha = new __PulseCryptoSha256()
  sha.updateMemory(pointer, length)
  return sha.finish()
}

function __pulse_crypto_hmac_sha256(
  keyPointer: usize,
  keyLength: i32,
  dataPointer: usize,
  dataLength: i32,
): StaticArray<u8> {
  const keyBlock = new StaticArray<u8>(__PULSE_CRYPTO_SHA256_BLOCK_BYTES)
  if (keyLength > __PULSE_CRYPTO_SHA256_BLOCK_BYTES) {
    const keyDigest = __pulse_crypto_sha256_memory(keyPointer, keyLength)
    for (let index: i32 = 0; index < __PULSE_CRYPTO_HS256_TAG_BYTES; index += 1) {
      unchecked(keyBlock[index] = unchecked(keyDigest[index]))
    }
    __pulse_crypto_wipe(keyDigest)
  } else {
    for (let index: i32 = 0; index < keyLength; index += 1) {
      unchecked(keyBlock[index] = load<u8>(keyPointer + <usize>index))
    }
  }

  const inner = new __PulseCryptoSha256()
  for (let index: i32 = 0; index < __PULSE_CRYPTO_SHA256_BLOCK_BYTES; index += 1) {
    inner.updateByte(unchecked(keyBlock[index]) ^ 0x36)
  }
  inner.updateMemory(dataPointer, dataLength)
  const innerDigest = inner.finish()

  const outer = new __PulseCryptoSha256()
  for (let index: i32 = 0; index < __PULSE_CRYPTO_SHA256_BLOCK_BYTES; index += 1) {
    outer.updateByte(unchecked(keyBlock[index]) ^ 0x5c)
  }
  outer.updateStatic(innerDigest, __PULSE_CRYPTO_HS256_TAG_BYTES)
  const output = outer.finish()

  __pulse_crypto_wipe(keyBlock)
  __pulse_crypto_wipe(innerDigest)
  return output
}

/*
 * Proof-only SHA-256 export used to bind the embedded primitive to FIPS 180-4
 * vectors. It is not a configured public Pulse algorithm surface.
 */
export function pulse_crypto_sha256_digest(
  dataPointer: i32,
  dataLength: i32,
  outputPointer: i32,
  outputLength: i32,
): i32 {
  if (
    dataLength < 0
    || dataLength > __PULSE_CRYPTO_HS256_DATA_MAX
    || outputLength != __PULSE_CRYPTO_HS256_TAG_BYTES
    || !__pulse_crypto_memory_range_valid(dataPointer, dataLength)
    || !__pulse_crypto_memory_range_valid(outputPointer, outputLength)
  ) return __PULSE_CRYPTO_INVALID_INPUT

  const digest = __pulse_crypto_sha256_memory(<usize><u32>dataPointer, dataLength)
  for (let index: i32 = 0; index < __PULSE_CRYPTO_HS256_TAG_BYTES; index += 1) {
    store<u8>(<usize><u32>outputPointer + <usize>index, unchecked(digest[index]))
  }
  __pulse_crypto_wipe(digest)
  return __PULSE_CRYPTO_VALID
}

export function pulse_crypto_hs256_verify(
  keyPointer: i32,
  keyLength: i32,
  dataPointer: i32,
  dataLength: i32,
  tagPointer: i32,
  tagLength: i32,
): i32 {
  if (
    keyLength < __PULSE_CRYPTO_HS256_KEY_MIN
    || keyLength > __PULSE_CRYPTO_HS256_KEY_MAX
    || !__pulse_crypto_memory_range_valid(keyPointer, keyLength)
  ) return __PULSE_CRYPTO_INVALID_KEY

  if (
    dataLength < 0
    || dataLength > __PULSE_CRYPTO_HS256_DATA_MAX
    || tagLength != __PULSE_CRYPTO_HS256_TAG_BYTES
    || !__pulse_crypto_memory_range_valid(dataPointer, dataLength)
    || !__pulse_crypto_memory_range_valid(tagPointer, tagLength)
  ) return __PULSE_CRYPTO_INVALID_INPUT

  const expected = __pulse_crypto_hmac_sha256(
    <usize><u32>keyPointer,
    keyLength,
    <usize><u32>dataPointer,
    dataLength,
  )

  // Every authenticator byte participates before the result branch.
  let mismatch: u32 = 0
  for (let index: i32 = 0; index < __PULSE_CRYPTO_HS256_TAG_BYTES; index += 1) {
    mismatch |= <u32>(
      unchecked(expected[index])
      ^ load<u8>(<usize><u32>tagPointer + <usize>index)
    )
  }
  const result = mismatch == 0
    ? __PULSE_CRYPTO_VALID
    : __PULSE_CRYPTO_INVALID_AUTHENTICATOR
  __pulse_crypto_wipe(expected)
  return result
}

// Internal digest/MAC output contract. This frame is a rooted allocation owned
// by Crypto; host callers may stage synchronously, copy the output, then wipe.
// It does not grow Wasm memory per operation or overlap allocator-owned memory.
const __pulse_crypto_bytes_frame = new Uint8Array(8192 + 32768 + 32)
export function pulse_crypto_bytes_frame_v1(): i32 {
  return <i32>__pulse_crypto_bytes_frame.dataStart
}

export function pulse_crypto_sha256_bytes_v1(dataPointer: i32, dataLength: i32, outputPointer: i32, outputLength: i32): i32 {
  if (dataLength < 0 || dataLength > 32768 || outputLength != 32
    || !__pulse_crypto_memory_range_valid(dataPointer, dataLength)
    || !__pulse_crypto_memory_range_valid(outputPointer, outputLength)) return __PULSE_CRYPTO_INVALID_INPUT
  const digest = __pulse_crypto_sha256_memory(<usize><u32>dataPointer, dataLength)
  for (let i: i32 = 0; i < 32; i++) store<u8>(<usize><u32>outputPointer + <usize>i, unchecked(digest[i]))
  __pulse_crypto_wipe(digest)
  return __PULSE_CRYPTO_VALID
}

export function pulse_crypto_hmac_sha256_bytes_v1(keyPointer: i32, keyLength: i32, dataPointer: i32, dataLength: i32, outputPointer: i32, outputLength: i32): i32 {
  if (keyLength < 0 || keyLength > 8192 || !__pulse_crypto_memory_range_valid(keyPointer, keyLength)) return __PULSE_CRYPTO_INVALID_KEY
  if (dataLength < 0 || dataLength > 32768 || outputLength != 32
    || !__pulse_crypto_memory_range_valid(dataPointer, dataLength)
    || !__pulse_crypto_memory_range_valid(outputPointer, outputLength)) return __PULSE_CRYPTO_INVALID_INPUT
  const digest = __pulse_crypto_hmac_sha256(<usize><u32>keyPointer, keyLength, <usize><u32>dataPointer, dataLength)
  for (let i: i32 = 0; i < 32; i++) store<u8>(<usize><u32>outputPointer + <usize>i, unchecked(digest[i]))
  __pulse_crypto_wipe(digest)
  return __PULSE_CRYPTO_VALID
}
