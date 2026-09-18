// Package-owned HS256/ES256 issuance. Provider callbacks own secrets, clock and errors;
// the selected Crypto guest owns signing. No provider SDK or JavaScript fallback.
class __PulseJwtSignBudget { entries: i32 = 0; code: i32 = 0 }

function __pulse_jwt_sign_validate(handle: i32, depth: i32, budget: __PulseJwtSignBudget): bool {
  if (++budget.entries > 1024 || depth > 32) { budget.code = __PULSE_JWT_ERROR_LIMIT_EXCEEDED; return false }
  const value = __pulse_fastly_value(handle)
  if (value.kind == PULSE_VALUE_NULL || value.kind == PULSE_VALUE_BOOLEAN) return true
  if (value.kind == PULSE_VALUE_NUMBER && isFinite(value.number)) return true
  if (value.kind == PULSE_VALUE_STRING) {
    if (value.text.length > 8192) { budget.code = __PULSE_JWT_ERROR_LIMIT_EXCEEDED; return false }
    __pulse_fastly_remember_secret(value.text)
    return true
  }
  if (value.kind == PULSE_VALUE_ARRAY || value.kind == PULSE_VALUE_OBJECT) {
    for (let i = 0; i < value.values.length; i++) {
      if (value.kind == PULSE_VALUE_OBJECT && unchecked(value.keys[i]).length > 8192) {
        budget.code = __PULSE_JWT_ERROR_LIMIT_EXCEEDED; return false
      }
      if (!__pulse_jwt_sign_validate(unchecked(value.values[i]), depth + 1, budget)) return false
    }
    return true
  }
  budget.code = __PULSE_JWT_ERROR_CLAIMS_INVALID
  return false
}

function __pulse_jwt_base64url_encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let output = ''
  let accumulator: u32 = 0
  let bits = 0
  for (let i = 0; i < bytes.length; i++) {
    accumulator = (accumulator << 8) | unchecked(bytes[i]); bits += 8
    while (bits >= 6) { bits -= 6; output += alphabet.charAt((accumulator >> bits) & 63) }
  }
  if (bits > 0) output += alphabet.charAt((accumulator << (6 - bits)) & 63)
  return output
}

function __pulse_jwt_sign_private_key(encoded: Uint8Array, policy: __PulseFastlyValue): Uint8Array | null {
  const text = __pulse_jwt_decode_text(encoded)
  const roundtrip = Uint8Array.wrap(String.UTF8.encode(text, false))
  let valid = roundtrip.length == encoded.length
  for (let i = 0; valid && i < encoded.length; i++) if (roundtrip[i] != encoded[i]) valid = false
  __pulse_jwt_wipe(roundtrip)
  if (!valid) return null
  const parser = new __PulseJsonParser(text, true)
  const handle = parser.parse()
  if (parser.failed || handle <= 0) return null
  const jwk = __pulse_fastly_value(handle)
  if (jwk.kind != PULSE_VALUE_OBJECT) return null
  const rsa = __pulse_jwt_string_member(policy, 'algorithm') == 'RS256'
  const allowed = rsa ? ['kty', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi', 'alg', 'use', 'key_ops', 'kid', 'ext'] : ['kty', 'crv', 'x', 'y', 'd', 'alg', 'use', 'key_ops', 'kid', 'ext']
  for (let i = 0; i < jwk.keys.length; i++) if (allowed.indexOf(jwk.keys[i]) < 0) return null
  if (rsa ? __pulse_jwt_string_member(jwk, 'kty') != 'RSA' : (__pulse_jwt_string_member(jwk, 'kty') != 'EC' || __pulse_jwt_string_member(jwk, 'crv') != 'P-256')) return null
  if (__pulse_jwt_has_field(jwk, 'alg') && __pulse_jwt_string_member(jwk, 'alg') != (rsa ? 'RS256' : 'ES256')) return null
  if (__pulse_jwt_has_field(jwk, 'use') && __pulse_jwt_string_member(jwk, 'use') != 'sig') return null
  if (__pulse_jwt_has_field(jwk, 'ext') && __pulse_fastly_value(__pulse_jwt_object_field(jwk, 'ext')).kind != PULSE_VALUE_BOOLEAN) return null
  if (__pulse_jwt_has_field(jwk, 'key_ops')) {
    const ops = __pulse_fastly_value(__pulse_jwt_object_field(jwk, 'key_ops'))
    if (ops.kind != PULSE_VALUE_ARRAY || ops.values.length != 1 || !__pulse_jwt_array_contains(ops, 'sign')) return null
  }
  if (__pulse_jwt_has_field(jwk, 'kid')) {
    const kid = __pulse_jwt_string_member(jwk, 'kid')
    if (kid === null || kid.length == 0 || kid.indexOf(String.fromCharCode(0)) >= 0 || String.UTF8.byteLength(kid) > 256) return null
    if (__pulse_jwt_has_field(policy, 'kid') && __pulse_jwt_string_member(policy, 'kid') != kid) return null
  }
  if (rsa) return __pulse_jwt_rsa_private_bytes(jwk)
  const names = ['x', 'y', 'd']
  const output = new Uint8Array(96)
  for (let i = 0; i < 3; i++) {
    const value = __pulse_jwt_string_member(jwk, names[i])
    if (value === null || value.length != 43) { __pulse_jwt_wipe(output); return null }
    __pulse_fastly_remember_secret(value)
    const decoded = __pulse_jwt_base64url_decode(value)
    if (decoded === null) { __pulse_jwt_wipe(output); return null }
    if (decoded.length != 32) { __pulse_jwt_wipe(decoded); __pulse_jwt_wipe(output); return null }
    memory.copy(output.dataStart + i * 32, decoded.dataStart, 32)
    __pulse_jwt_wipe(decoded)
  }
  return output
}

export function pulse_jwt_fastly_sign(effectIndex: i32, outerHandle: i32): i32 {
  const outer = __pulse_fastly_value(outerHandle)
  const policy = __pulse_fastly_value(__pulse_jwt_object_field(outer, 'payload'))
  const invocation = __pulse_fastly_value(__pulse_jwt_object_field(outer, 'invocation'))
  const claimsHandle = __pulse_jwt_object_field(invocation, 'claims')
  const claims = __pulse_fastly_value(claimsHandle)
  const lifetime = __pulse_jwt_numeric_claim(policy, 'expiresInSeconds')
  const algorithm = __pulse_jwt_string_member(policy, 'algorithm')
  const kid = __pulse_jwt_string_member(policy, 'kid')
  if (__pulse_jwt_has_field(policy, 'kid') && (kid === null || kid.length == 0 || kid.indexOf(String.fromCharCode(0)) >= 0 || String.UTF8.byteLength(kid) > 256)) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_KEY_INVALID, 249)
  }
  if ((algorithm != 'HS256' && algorithm != 'ES256' && algorithm != 'RS256') || !isFinite(lifetime)
    || Math.floor(lifetime) != lifetime || lifetime < 1 || lifetime > 9007199254740991.0) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_OPERATION_FAILED, 240)
  }
  if (claims.kind != PULSE_VALUE_OBJECT || __pulse_jwt_has_field(claims, 'iat')
    || __pulse_jwt_has_field(claims, 'exp') || __pulse_jwt_has_field(claims, 'nbf')) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_CLAIMS_INVALID, 241)
  }
  const budget = new __PulseJwtSignBudget()
  if (!__pulse_jwt_sign_validate(claimsHandle, 0, budget)) return __pulse_jwt_fail(effectIndex, budget.code, 242)
  if (String.UTF8.byteLength(__pulse_fastly_json(claimsHandle, 0)) > 8192) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_LIMIT_EXCEEDED, 243)
  }
  let key = __pulse_fastly_jwt_resolve_secret(effectIndex)
  if (key.length < 32 || key.length > 4096) {
    __pulse_jwt_wipe(key)
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_KEY_INVALID, 244)
  }
  if (algorithm != 'HS256') {
    const decoded = __pulse_jwt_sign_private_key(key, policy)
    __pulse_jwt_wipe(key)
    if (decoded === null) return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_KEY_INVALID, 249)
    key = decoded
  }
  const captured = __pulse_fastly_jwt_capture_clock(effectIndex)
  const now = Math.floor(captured)
  if (!isFinite(captured) || captured < 0 || captured > 8640000000000.0) {
    __pulse_jwt_wipe(key)
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_CLOCK_INVALID, 245)
  }
  if (now > 8640000000000.0 - lifetime) {
    __pulse_jwt_wipe(key)
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_OPERATION_FAILED, 248)
  }
  const issued = host_value_object()
  for (let i = 0; i < claims.keys.length; i++) {
    host_value_object_set(issued, __pulse_fastly_string_value(unchecked(claims.keys[i])), unchecked(claims.values[i]))
  }
  host_value_object_set(issued, __pulse_fastly_string_value('iat'), host_value_number(now))
  host_value_object_set(issued, __pulse_fastly_string_value('exp'), host_value_number(now + lifetime))
  const text = __pulse_fastly_json(issued, 0)
  if (String.UTF8.byteLength(text) > 8192) {
    __pulse_jwt_wipe(key)
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_LIMIT_EXCEEDED, 246)
  }
  __pulse_fastly_remember_secret(text)
  const header = host_value_object()
  host_value_object_set(header, __pulse_fastly_string_value('alg'), __pulse_fastly_string_value(algorithm!))
  host_value_object_set(header, __pulse_fastly_string_value('typ'), __pulse_fastly_string_value('JWT'))
  if (kid !== null) host_value_object_set(header, __pulse_fastly_string_value('kid'), __pulse_fastly_string_value(kid))
  const input = __pulse_jwt_base64url_encode(Uint8Array.wrap(String.UTF8.encode(__pulse_fastly_json(header, 0), false))) + '.' + __pulse_jwt_base64url_encode(Uint8Array.wrap(String.UTF8.encode(text, false)))
  const data = Uint8Array.wrap(String.UTF8.encode(input, false))
  const tag = new Uint8Array(algorithm == 'RS256' ? i32(load<u32>(key.dataStart)) : algorithm == 'ES256' ? 64 : 32)
  const status = __pulse_fastly_jwt_crypto_sign(algorithm!, key, data, tag)
  __pulse_jwt_wipe(key); __pulse_jwt_wipe(data)
  if (status == -1) { __pulse_jwt_wipe(tag); return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_KEY_INVALID, 249) }
  if (status != 1) { __pulse_jwt_wipe(tag); return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_OPERATION_FAILED, 247) }
  const signature = __pulse_jwt_base64url_encode(tag)
  __pulse_jwt_wipe(tag)
  const token = input + '.' + signature
  __pulse_fastly_remember_secret(signature); __pulse_fastly_remember_secret(token)
  return __pulse_fastly_string_value(token)
}


function __pulse_jwt_rsa_integer(jwk: __PulseFastlyValue, name: string, maximum: i32): Uint8Array | null {
  const value = __pulse_jwt_string_member(jwk, name)
  if (value === null || value.length > (maximum * 4 + 2) / 3) return null
  __pulse_fastly_remember_secret(value)
  const decoded = __pulse_jwt_base64url_decode(value)
  if (decoded === null) return null
  if (decoded.length == 0 || decoded.length > maximum || decoded[0] == 0) { __pulse_jwt_wipe(decoded); return null }
  return decoded
}
function __pulse_jwt_rsa_private_bytes(jwk: __PulseFastlyValue): Uint8Array | null {
  const n = __pulse_jwt_rsa_integer(jwk, 'n', 512)
  if (n === null) return null
  const k = n.length
  if ((k != 256 && k != 384 && k != 512) || n[0] < 128 || (n[k-1] & 1) == 0) { __pulse_jwt_wipe(n); return null }
  const output = new Uint8Array(8 + k * 9 / 2)
  store<u32>(output.dataStart, k)
  memory.copy(output.dataStart + 4, n.dataStart, k); __pulse_jwt_wipe(n)
  const names = ['e', 'd', 'p', 'q', 'dp', 'dq', 'qi']
  let offset = 4 + k
  for (let i = 0; i < names.length; i++) {
    const width = i == 0 ? 4 : i == 1 ? k : k / 2
    const bytes = __pulse_jwt_rsa_integer(jwk, names[i], width)
    if (bytes === null) { __pulse_jwt_wipe(output); return null }
    memory.copy(output.dataStart + offset + width - bytes.length, bytes.dataStart, bytes.length)
    offset += width; __pulse_jwt_wipe(bytes)
  }
  return output
}
