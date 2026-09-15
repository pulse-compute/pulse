// Crypto-owned text framing over the existing SHA-256 implementation.
class __PulseTextDigestResult {
  status: string = 'failed'
  reason: string = ''
  sha256: string = ''
  byteLength: i32 = 0
}
function __pulse_crypto_digest_text(text: string | null): __PulseTextDigestResult {
  const result = new __PulseTextDigestResult()
  if (text === null) { result.reason = 'invalid-text'; return result }
  if (text.length > 32768) { result.reason = 'too-large'; return result }
  let length = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      i += 1
      if (i >= text.length) { result.reason = 'invalid-text'; return result }
      const low = text.charCodeAt(i)
      if (low < 0xdc00 || low > 0xdfff) { result.reason = 'invalid-text'; return result }
      length += 4
    } else if (c >= 0xdc00 && c <= 0xdfff) { result.reason = 'invalid-text'; return result }
    else length += c < 0x80 ? 1 : c < 0x800 ? 2 : 3
  }
  if (length > 32768) { result.reason = 'too-large'; return result }
  const data = Uint8Array.wrap(String.UTF8.encode(text)), digest = new Uint8Array(32)
  const code = pulse_crypto_sha256_bytes_v1(data.dataStart, data.length, digest.dataStart, 32)
  data.fill(0)
  if (code != 1) { digest.fill(0); result.reason = 'realization-failure'; return result }
  const alphabet = '0123456789abcdef'
  for (let i = 0; i < 32; i++) result.sha256 += alphabet.charAt(digest[i] >> 4) + alphabet.charAt(digest[i] & 15)
  digest.fill(0)
  result.status = 'ok'; result.byteLength = length
  return result
}
