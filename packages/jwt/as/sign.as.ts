// Package-owned HS256 issuance. Provider callbacks own secrets, clock and errors;
// the selected Crypto guest owns HMAC. No provider SDK or JavaScript fallback.
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

export function pulse_jwt_fastly_sign(effectIndex: i32, outerHandle: i32): i32 {
  const outer = __pulse_fastly_value(outerHandle)
  const policy = __pulse_fastly_value(__pulse_jwt_object_field(outer, 'payload'))
  const invocation = __pulse_fastly_value(__pulse_jwt_object_field(outer, 'invocation'))
  const claimsHandle = __pulse_jwt_object_field(invocation, 'claims')
  const claims = __pulse_fastly_value(claimsHandle)
  const lifetime = __pulse_jwt_numeric_claim(policy, 'expiresInSeconds')
  if (__pulse_jwt_string_member(policy, 'algorithm') != 'HS256' || !isFinite(lifetime)
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
  const key = __pulse_fastly_jwt_resolve_secret(effectIndex)
  if (key.length < 32 || key.length > 4096) {
    __pulse_jwt_wipe(key)
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_KEY_INVALID, 244)
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
  const input = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + __pulse_jwt_base64url_encode(Uint8Array.wrap(String.UTF8.encode(text, false)))
  const data = Uint8Array.wrap(String.UTF8.encode(input, false))
  const tag = new Uint8Array(32)
  const status = pulse_crypto_hmac_sha256_bytes_v1(key.dataStart, key.length, data.dataStart, data.length, tag.dataStart, tag.length)
  __pulse_jwt_wipe(key); __pulse_jwt_wipe(data)
  if (status != 1) { __pulse_jwt_wipe(tag); return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_OPERATION_FAILED, 247) }
  const signature = __pulse_jwt_base64url_encode(tag)
  __pulse_jwt_wipe(tag)
  const token = input + '.' + signature
  __pulse_fastly_remember_secret(signature); __pulse_fastly_remember_secret(token)
  return __pulse_fastly_string_value(token)
}
