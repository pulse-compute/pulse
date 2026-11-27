// Exact scalar text and tag framing shared by the provider-owned MAC effect.
function __pulse_crypto_mac_length(text: string, maximum: i32): i32 {
  if (text.length > maximum) return -2
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      i++
      if (i >= text.length) return -1
      const low = text.charCodeAt(i)
      if (low < 0xdc00 || low > 0xdfff) return -1
      bytes += 4
    } else if (c >= 0xdc00 && c <= 0xdfff) return -1
    else bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3
  }
  return bytes > maximum ? -2 : bytes
}
function __pulse_crypto_mac_hex(c: i32): i32 {
  return c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : -1
}
function __pulse_crypto_mac_tag_valid(tag: string): bool {
  if (tag.length != 64) return false
  for (let i = 0; i < 64; i++) if (__pulse_crypto_mac_hex(tag.charCodeAt(i)) < 0) return false
  return true
}
