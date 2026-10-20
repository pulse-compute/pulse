// Provider-owned, request-local dynamic backend policy. No optional timeout or
// trust overrides: deadlines and certificate validation retain their owners.
@external("fastly_http_req", "register_dynamic_backend")
declare function __pulse_dynamic_register(name: usize, nameLength: i32, target: usize, targetLength: i32, mask: u32, config: usize): i32
const __pulse_dynamic_origins = new Array<string>()
const __pulse_dynamic_names = new Array<string>()
let __pulse_dynamic_attempts: i32 = 0
let __pulse_dynamic_status: i32 = 0
let __pulse_dynamic_url: string = ""
export function pulse_fastly_dynamic_backend_status(): i32 { return __pulse_dynamic_status }
function __pulse_dynamic_clear(): void {
  __pulse_dynamic_origins.length = 0; __pulse_dynamic_names.length = 0; __pulse_dynamic_url = ""
}
function __pulse_dynamic_invalid(index: i32): string {
  __pulse_fastly_fail(PULSE_ERROR_VALUE, 273, index); return ""
}
function __pulse_dynamic_select(index: i32, url: string): string {
  __pulse_dynamic_url = url
  const fixed = __pulse_fastly_backend(index)
  if (fixed.length > 0) return fixed
  if (!__pulse_dynamic_check(index)) return ""
  if (url.length > PULSE_FASTLY_BUFFER_BYTES) return __pulse_dynamic_invalid(index)
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i)
    if (c <= 32 || c >= 127 || c == 92) return __pulse_dynamic_invalid(index)
  }
  const separator = url.indexOf("://")
  if (separator < 0) return __pulse_dynamic_invalid(index)
  const scheme = url.substring(0, separator).toLowerCase()
  const tls = scheme == "https"
  if (!tls && scheme != "http") return __pulse_dynamic_invalid(index)
  const start = separator + 3
  let end = start
  while (end < url.length && url.charAt(end) != "/" && url.charAt(end) != "?" && url.charAt(end) != "#") end++
  const authority = url.substring(start, end).toLowerCase()
  if (authority.length == 0 || authority.length > 1024 || authority.indexOf("@") >= 0) return __pulse_dynamic_invalid(index)
  const colon = authority.indexOf(":")
  let hostname = colon < 0 ? authority : authority.substring(0, colon)
  let port = tls ? 443 : 80
  if (colon >= 0) {
    const digits = authority.substring(colon + 1)
    if (digits.length == 0 || digits.length > 5) return __pulse_dynamic_invalid(index)
    port = 0
    for (let i = 0; i < digits.length; i++) {
      const c = digits.charCodeAt(i)
      if (c < 48 || c > 57) return __pulse_dynamic_invalid(index)
      port = port * 10 + c - 48
    }
    if (port < 1 || port > 65535) return __pulse_dynamic_invalid(index)
  }
  const dns = hostname.endsWith(".") ? hostname.substring(0, hostname.length - 1) : hostname
  if (dns.length == 0 || dns.length > 253) return __pulse_dynamic_invalid(index)
  const labels = dns.split(".")
  let allNumeric = true
  for (let i = 0; i < labels.length; i++) {
    const label = unchecked(labels[i])
    if (label.length == 0 || label.length > 63 || label.startsWith("xn--") || label.startsWith("-") || label.endsWith("-")) return __pulse_dynamic_invalid(index)
    for (let j = 0; j < label.length; j++) {
      const c = label.charCodeAt(j)
      if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 45)) return __pulse_dynamic_invalid(index)
      if (c < 48 || c > 57) allNumeric = false
    }
  }
  if (allNumeric) {
    if (tls || hostname != dns || labels.length != 4) return __pulse_dynamic_invalid(index)
    for (let i = 0; i < 4; i++) {
      const label = unchecked(labels[i])
      if (label.length > 3 || (label.length > 1 && label.startsWith("0"))) return __pulse_dynamic_invalid(index)
      let octet = 0
      for (let j = 0; j < label.length; j++) octet = octet * 10 + label.charCodeAt(j) - 48
      if (octet > 255) return __pulse_dynamic_invalid(index)
    }
  } else {
    // WHATWG numeric host aliases must not become a different DNS destination.
    const last = unchecked(labels[labels.length - 1])
    let numeric = true
    for (let i = 0; i < last.length; i++) if (last.charCodeAt(i) < 48 || last.charCodeAt(i) > 57) numeric = false
    if (numeric || last.startsWith("0x")) return __pulse_dynamic_invalid(index)
  }
  const host = hostname + (port == (tls ? 443 : 80) ? "" : ":" + port.toString())
  const origin = scheme + "://" + host
  let rest = url.substring(end)
  const fragment = rest.indexOf("#")
  if (fragment >= 0) rest = rest.substring(0, fragment)
  if (!rest.startsWith("/")) rest = "/" + rest
  __pulse_dynamic_url = origin + rest
  if (__pulse_dynamic_url.length > PULSE_FASTLY_BUFFER_BYTES) return __pulse_dynamic_invalid(index)
  const mapped = __pulse_dynamic_static(origin)
  if (mapped.length > 0) return mapped
  for (let i = 0; i < __pulse_dynamic_origins.length; i++) {
    if (unchecked(__pulse_dynamic_origins[i]) == origin) return unchecked(__pulse_dynamic_names[i])
  }
  if (__pulse_dynamic_attempts >= 32) {
    __pulse_fastly_fail(PULSE_ERROR_VALUE, 276, index); return ""
  }
  const name = "pulse-native-dynamic-" + (__pulse_dynamic_attempts++).toString()
  const n = __pulse_fastly_utf8(name), target = __pulse_fastly_utf8(hostname + ":" + port.toString())
  const h = __pulse_fastly_utf8(host), sni = __pulse_fastly_utf8(hostname)
  const config = new StaticArray<u32>(27)
  config[0] = <u32>changetype<usize>(h); config[1] = h.byteLength
  let mask: u32 = 2
  if (tls) {
    mask |= 32 | 256 | 2048
    config[7] = <u32>changetype<usize>(sni); config[8] = sni.byteLength
    config[13] = <u32>changetype<usize>(sni); config[14] = sni.byteLength
  }
  if (!__pulse_dynamic_check(index)) return ""
  __pulse_dynamic_status = __pulse_dynamic_register(changetype<usize>(n), n.byteLength, changetype<usize>(target), target.byteLength, mask, changetype<usize>(config))
  if (!__pulse_dynamic_check(index)) return ""
  if (__pulse_dynamic_status != 0) {
    __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, __pulse_dynamic_status == 5 ? 274 : 275, index); return ""
  }
  __pulse_dynamic_origins.push(origin); __pulse_dynamic_names.push(name)
  return name
}
