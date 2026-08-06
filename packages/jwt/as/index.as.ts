/*
 * Pulse package-owned Native JWT verifier.
 *
 * This source is concatenated into a provider's one final AssemblyScript
 * module. It owns compact-JWS parsing, protected-header policy, registered
 * claim validation, result shaping, and the ordered composition boundary to
 * @pulse-compute/crypto. Provider callbacks retain request-owned secret,
 * wall-clock, schema, redaction, and error-transport authority.
 */

export const PULSE_JWT_SIDECAR_ABI_VERSION: i32 = 2
export const PULSE_JWT_VERIFY_CRYPTO_COMPOSITION_REQUIRED: i32 = -2

const __PULSE_JWT_TOKEN_BYTES_MAX: i32 = 16 * 1024
const __PULSE_JWT_HEADER_BYTES_MAX: i32 = 4 * 1024
const __PULSE_JWT_CLAIMS_BYTES_MAX: i32 = 16 * 1024
const __PULSE_JWT_HS256_SIGNATURE_BYTES: i32 = 32
const __PULSE_JWT_ES256_SIGNATURE_BYTES: i32 = 64
const __PULSE_JWT_KEY_BYTES_MIN: i32 = 32
const __PULSE_JWT_KEY_BYTES_MAX: i32 = 4096
const __PULSE_JWT_ES256_PUBLIC_KEY_BYTES: i32 = 64

const __PULSE_JWT_ERROR_TOKEN_REQUIRED: i32 = 1
const __PULSE_JWT_ERROR_BEARER_INVALID: i32 = 2
const __PULSE_JWT_ERROR_MALFORMED: i32 = 3
const __PULSE_JWT_ERROR_LIMIT_EXCEEDED: i32 = 4
const __PULSE_JWT_ERROR_ALGORITHM_NOT_ALLOWED: i32 = 5
const __PULSE_JWT_ERROR_KEY_INVALID: i32 = 6
const __PULSE_JWT_ERROR_SIGNATURE_INVALID: i32 = 7
const __PULSE_JWT_ERROR_CLOCK_INVALID: i32 = 8
const __PULSE_JWT_ERROR_CLAIMS_INVALID: i32 = 9
const __PULSE_JWT_ERROR_CLAIMS_SCHEMA_INVALID: i32 = 10
const __PULSE_JWT_ERROR_OPERATION_FAILED: i32 = 11

function __pulse_jwt_fail(effectIndex: i32, code: i32, stage: i32): i32 {
  return __pulse_fastly_jwt_fail_code(effectIndex, code, stage)
}

function __pulse_jwt_base64url_value(code: i32): i32 {
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 71
  if (code >= 48 && code <= 57) return code + 4
  if (code == 45) return 62
  if (code == 95) return 63
  return -1
}

function __pulse_jwt_base64url_decode(segment: string): Uint8Array | null {
  if (segment.length == 0 || segment.length % 4 == 1) return null
  const remainder = segment.length % 4
  const last = __pulse_jwt_base64url_value(segment.charCodeAt(segment.length - 1))
  if (last < 0 || (remainder == 2 && (last & 15) != 0) || (remainder == 3 && (last & 3) != 0)) return null
  const output = new Uint8Array((segment.length * 6) >> 3)
  let accumulator: u32 = 0
  let bits: i32 = 0
  let outputIndex: i32 = 0
  for (let index: i32 = 0; index < segment.length; index += 1) {
    const value = __pulse_jwt_base64url_value(segment.charCodeAt(index))
    if (value < 0) return null
    accumulator = (accumulator << 6) | <u32>value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      unchecked(output[outputIndex] = <u8>(accumulator >> bits))
      outputIndex += 1
    }
  }
  return output
}

function __pulse_jwt_decode_text(bytes: Uint8Array): string {
  return String.UTF8.decodeUnsafe(bytes.dataStart, bytes.byteLength, false)
}

function __pulse_jwt_wipe(bytes: Uint8Array): void {
  for (let index: i32 = 0; index < bytes.byteLength; index += 1) unchecked(bytes[index] = 0)
}

function __pulse_jwt_object_field(object: __PulseFastlyValue, name: string): i32 {
  const index = __pulse_fastly_find(object, name)
  return index < 0 ? host_value_undefined() : unchecked(object.values[index])
}

function __pulse_jwt_has_field(object: __PulseFastlyValue, name: string): bool {
  return __pulse_fastly_find(object, name) >= 0
}

function __pulse_jwt_string_member(object: __PulseFastlyValue, name: string): string | null {
  const index = __pulse_fastly_find(object, name)
  if (index < 0) return null
  const value = __pulse_fastly_value(unchecked(object.values[index]))
  return value.kind == PULSE_VALUE_STRING ? value.text : null
}

function __pulse_jwt_array_contains(array: __PulseFastlyValue, expected: string): bool {
  if (array.kind != PULSE_VALUE_ARRAY) return false
  for (let index: i32 = 0; index < array.values.length; index += 1) {
    const value = __pulse_fastly_value(unchecked(array.values[index]))
    if (value.kind == PULSE_VALUE_STRING && value.text == expected) return true
  }
  return false
}

function __pulse_jwt_config_accepts(handle: i32, candidate: string): bool {
  const configured = __pulse_fastly_value(handle)
  if (configured.kind == PULSE_VALUE_STRING) return configured.text == candidate
  return __pulse_jwt_array_contains(configured, candidate)
}

function __pulse_jwt_audience_valid(claims: __PulseFastlyValue, policy: __PulseFastlyValue): bool {
  const policyIndex = __pulse_fastly_find(policy, "audience")
  if (policyIndex < 0) return true
  const audienceIndex = __pulse_fastly_find(claims, "aud")
  if (audienceIndex < 0) return false
  const audience = __pulse_fastly_value(unchecked(claims.values[audienceIndex]))
  if (audience.kind == PULSE_VALUE_STRING) {
    return __pulse_jwt_config_accepts(unchecked(policy.values[policyIndex]), audience.text)
  }
  if (audience.kind != PULSE_VALUE_ARRAY) return false
  for (let index: i32 = 0; index < audience.values.length; index += 1) {
    const value = __pulse_fastly_value(unchecked(audience.values[index]))
    if (value.kind != PULSE_VALUE_STRING) return false
    if (__pulse_jwt_config_accepts(unchecked(policy.values[policyIndex]), value.text)) return true
  }
  return false
}

function __pulse_jwt_numeric_claim(claims: __PulseFastlyValue, name: string): f64 {
  const index = __pulse_fastly_find(claims, name)
  if (index < 0) return NaN
  const value = __pulse_fastly_value(unchecked(claims.values[index]))
  return value.kind == PULSE_VALUE_NUMBER ? value.number : NaN
}

function __pulse_jwt_validate_registered(
  claims: __PulseFastlyValue,
  policy: __PulseFastlyValue,
  now: f64,
): bool {
  const requiredIndex = __pulse_fastly_find(policy, "requiredClaims")
  if (requiredIndex >= 0) {
    const required = __pulse_fastly_value(unchecked(policy.values[requiredIndex]))
    if (required.kind != PULSE_VALUE_ARRAY) return false
    for (let index: i32 = 0; index < required.values.length; index += 1) {
      const name = __pulse_fastly_value(unchecked(required.values[index]))
      if (name.kind != PULSE_VALUE_STRING) return false
      const claimIndex = __pulse_fastly_find(claims, name.text)
      if (claimIndex < 0 || __pulse_fastly_value(unchecked(claims.values[claimIndex])).kind == PULSE_VALUE_UNDEFINED) return false
    }
  }

  const issuerIndex = __pulse_fastly_find(policy, "issuer")
  if (issuerIndex >= 0) {
    const issuer = __pulse_jwt_string_member(claims, "iss")
    if (issuer === null || !__pulse_jwt_config_accepts(unchecked(policy.values[issuerIndex]), issuer)) return false
  }
  if (!__pulse_jwt_audience_valid(claims, policy)) return false

  const subjectIndex = __pulse_fastly_find(policy, "subject")
  if (subjectIndex >= 0) {
    const subject = __pulse_jwt_string_member(claims, "sub")
    const expected = __pulse_fastly_value(unchecked(policy.values[subjectIndex]))
    if (subject === null || expected.kind != PULSE_VALUE_STRING || subject != expected.text) return false
  }

  const toleranceIndex = __pulse_fastly_find(policy, "clockToleranceSeconds")
  const tolerance = toleranceIndex < 0 ? 0.0 : __pulse_fastly_number(unchecked(policy.values[toleranceIndex]))
  const expIndex = __pulse_fastly_find(claims, "exp")
  if (expIndex >= 0) {
    const exp = __pulse_jwt_numeric_claim(claims, "exp")
    if (isNaN(exp) || now - tolerance >= exp) return false
  }
  const nbfIndex = __pulse_fastly_find(claims, "nbf")
  if (nbfIndex >= 0) {
    const nbf = __pulse_jwt_numeric_claim(claims, "nbf")
    if (isNaN(nbf) || now + tolerance < nbf) return false
  }
  const iatIndex = __pulse_fastly_find(claims, "iat")
  if (iatIndex >= 0 && isNaN(__pulse_jwt_numeric_claim(claims, "iat"))) return false
  const maxAgeIndex = __pulse_fastly_find(policy, "maxTokenAgeSeconds")
  if (maxAgeIndex >= 0) {
    const iat = __pulse_jwt_numeric_claim(claims, "iat")
    const maxAge = __pulse_fastly_number(unchecked(policy.values[maxAgeIndex]))
    if (isNaN(iat) || iat > now + tolerance || now - iat - tolerance > maxAge) return false
  }
  return true
}

function __pulse_jwt_bearer(authorization: string): string | null {
  if (authorization.length < 8 || authorization.indexOf("\r") >= 0 || authorization.indexOf("\n") >= 0 || authorization.indexOf(",") >= 0) return null
  if (authorization.substring(0, 7).toLowerCase() != "bearer ") return null
  const token = authorization.substring(7)
  return token.length == 0 ? null : token
}

function __pulse_jwt_hex(bytes: Uint8Array): string {
  const alphabet = "0123456789abcdef"
  let output = ""
  for (let index: i32 = 0; index < bytes.byteLength; index += 1) {
    const value = unchecked(bytes[index])
    output += alphabet.charAt(value >> 4) + alphabet.charAt(value & 15)
  }
  return output
}

function __pulse_jwt_es256_scalar_valid(
  signature: Uint8Array,
  offset: i32,
): bool {
  let nonzero = false
  let lessThanOrder = false
  let greaterThanOrder = false
  for (let index: i32 = 0; index < 32; index += 1) {
    const value: i32 = unchecked(signature[offset + index])
    if (value != 0) nonzero = true
    const order = unchecked(__PULSE_JWT_P256_ORDER[index])
    if (!lessThanOrder && !greaterThanOrder) {
      if (value < order) lessThanOrder = true
      else if (value > order) greaterThanOrder = true
    }
  }
  return nonzero && lessThanOrder && !greaterThanOrder
}

@lazy const __PULSE_JWT_P256_ORDER = [
  255, 255, 255, 255, 0, 0, 0, 0,
  255, 255, 255, 255, 255, 255, 255, 255,
  188, 230, 250, 173, 167, 23, 158, 132,
  243, 185, 202, 194, 252, 99, 37, 81,
]

/**
 * Provider-neutral package effect sentinel retained for canonical lowering.
 */
export function pulse_jwt_verify(
  operationRef: i32,
  invocationRef: i32,
  resultRef: i32,
): i32 {
  void operationRef
  void invocationRef
  void resultRef
  return PULSE_JWT_VERIFY_CRYPTO_COMPOSITION_REQUIRED
}

/**
 * Package-owned Fastly integration entry used only after canonical lowering.
 * The provider supplies authority callbacks; this function supplies semantics.
 */
export function pulse_jwt_fastly_verify(effectIndex: i32, outerHandle: i32): i32 {
  const outer = __pulse_fastly_value(outerHandle)
  if (outer.kind != PULSE_VALUE_OBJECT) return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_OPERATION_FAILED, 200)
  const policy = __pulse_fastly_value(__pulse_jwt_object_field(outer, "payload"))
  const invocation = __pulse_fastly_value(__pulse_jwt_object_field(outer, "invocation"))
  if (policy.kind != PULSE_VALUE_OBJECT || invocation.kind != PULSE_VALUE_OBJECT) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_OPERATION_FAILED, 201)
  }
  const authorizationValue = __pulse_fastly_value(__pulse_jwt_object_field(invocation, "token"))
  if (authorizationValue.kind == PULSE_VALUE_UNDEFINED) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_TOKEN_REQUIRED, 202)
  }
  if (authorizationValue.kind != PULSE_VALUE_STRING) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_BEARER_INVALID, 203)
  }
  const bearer = __pulse_jwt_bearer(authorizationValue.text)
  if (bearer === null) return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_BEARER_INVALID, 204)
  const token = bearer
  if (String.UTF8.encode(token, false).byteLength > __PULSE_JWT_TOKEN_BYTES_MAX) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_LIMIT_EXCEEDED, 205)
  }
  const segments = token.split(".")
  if (segments.length != 3) return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_MALFORMED, 206)
  const protectedBytes = __pulse_jwt_base64url_decode(unchecked(segments[0]))
  const claimsBytes = __pulse_jwt_base64url_decode(unchecked(segments[1]))
  const signature = __pulse_jwt_base64url_decode(unchecked(segments[2]))
  if (protectedBytes === null || claimsBytes === null || signature === null) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_MALFORMED, 207)
  }
  if (protectedBytes.byteLength > __PULSE_JWT_HEADER_BYTES_MAX || claimsBytes.byteLength > __PULSE_JWT_CLAIMS_BYTES_MAX) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_LIMIT_EXCEEDED, 208)
  }
  const protectedParser = new __PulseJsonParser(__pulse_jwt_decode_text(protectedBytes))
  const protectedHandle = protectedParser.parse()
  const protectedHeader = __pulse_fastly_value(protectedHandle)
  if (protectedParser.failed || protectedHandle <= 0 || protectedHeader.kind != PULSE_VALUE_OBJECT) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_MALFORMED, 210)
  }
  if (__pulse_jwt_has_field(protectedHeader, "crit") || __pulse_jwt_has_field(protectedHeader, "b64")) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_MALFORMED, 211)
  }
  const algorithm = __pulse_jwt_string_member(protectedHeader, "alg")
  const algorithmPolicy = __pulse_fastly_value(__pulse_jwt_object_field(policy, "algorithms"))
  if (
    algorithm === null ||
    (algorithm != "HS256" && algorithm != "ES256") ||
    !__pulse_jwt_array_contains(algorithmPolicy, algorithm)
  ) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_ALGORITHM_NOT_ALLOWED, 212)
  }
  if (
    (algorithm == "HS256" && signature.byteLength != __PULSE_JWT_HS256_SIGNATURE_BYTES) ||
    (
      algorithm == "ES256" &&
      (
        signature.byteLength != __PULSE_JWT_ES256_SIGNATURE_BYTES ||
        !__pulse_jwt_es256_scalar_valid(signature, 0) ||
        !__pulse_jwt_es256_scalar_valid(signature, 32)
      )
    )
  ) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_MALFORMED, 209)
  }
  const typPolicy = __pulse_jwt_string_member(policy, "typ")
  if (typPolicy !== null) {
    const typ = __pulse_jwt_string_member(protectedHeader, "typ")
    if (typ === null || typ != typPolicy) return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_CLAIMS_INVALID, 213)
  }
  const kidIndex = __pulse_fastly_find(protectedHeader, "kid")
  if (kidIndex >= 0 && __pulse_fastly_value(unchecked(protectedHeader.values[kidIndex])).kind != PULSE_VALUE_STRING) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_MALFORMED, 214)
  }
  if (!__pulse_fastly_jwt_key_descriptor_valid(effectIndex)) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_KEY_INVALID, 215)
  }

  let key: Uint8Array | null
  if (algorithm == "HS256") {
    key = __pulse_fastly_jwt_resolve_secret(effectIndex)
    if (key.byteLength < __PULSE_JWT_KEY_BYTES_MIN || key.byteLength > __PULSE_JWT_KEY_BYTES_MAX) {
      __pulse_jwt_wipe(key)
      return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_KEY_INVALID, 216)
    }
  } else {
    const kid = __pulse_jwt_string_member(protectedHeader, "kid")
    key = __pulse_fastly_jwt_resolve_es256_key(effectIndex, kid)
    if (key === null || key.byteLength != __PULSE_JWT_ES256_PUBLIC_KEY_BYTES) {
      return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_KEY_INVALID, 216)
    }
  }
  const signingInput = unchecked(segments[0]) + "." + unchecked(segments[1])
  const signingBytes = String.UTF8.encode(signingInput, false)
  const signingView = Uint8Array.wrap(signingBytes)
  __pulse_fastly_jwt_capture_signing_input(signingView)
  const cryptoStatus = __pulse_fastly_jwt_force_crypto_failure(effectIndex)
    ? -3
    : __pulse_fastly_jwt_crypto_verify(
        algorithm,
        key,
        signingView,
        signature,
      )
  __pulse_fastly_jwt_record_crypto_attempt()
  __pulse_jwt_wipe(key)
  if (cryptoStatus == 0) return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_SIGNATURE_INVALID, 217)
  if (cryptoStatus == -1) return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_KEY_INVALID, 218)
  if (cryptoStatus != 1) return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_OPERATION_FAILED, 219)

  const claimsParser = new __PulseJsonParser(__pulse_jwt_decode_text(claimsBytes))
  const claimsHandle = claimsParser.parse()
  const claims = __pulse_fastly_value(claimsHandle)
  if (claimsParser.failed || claimsHandle <= 0 || claims.kind != PULSE_VALUE_OBJECT) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_MALFORMED, 220)
  }
  __pulse_fastly_jwt_record_claims_parsed()
  const now = __pulse_fastly_jwt_capture_clock(effectIndex)
  if (isNaN(now) || !isFinite(now)) return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_CLOCK_INVALID, 221)
  if (!__pulse_jwt_validate_registered(claims, policy, now)) {
    return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_CLAIMS_INVALID, 222)
  }

  let normalizedClaims = claimsHandle
  const schema = __pulse_jwt_string_member(policy, "claimsSchema")
  if (schema !== null) {
    normalizedClaims = __pulse_fastly_jwt_validate_schema(effectIndex, schema, claimsHandle)
    if (normalizedClaims <= 0) return __pulse_jwt_fail(effectIndex, __PULSE_JWT_ERROR_CLAIMS_SCHEMA_INVALID, 223)
  }
  const outputHeader = host_value_object()
  host_value_object_set(outputHeader, __pulse_fastly_string_value("alg"), __pulse_fastly_string_value(algorithm))
  if (kidIndex >= 0) host_value_object_set(outputHeader, __pulse_fastly_string_value("kid"), unchecked(protectedHeader.values[kidIndex]))
  const typIndex = __pulse_fastly_find(protectedHeader, "typ")
  if (typIndex >= 0) host_value_object_set(outputHeader, __pulse_fastly_string_value("typ"), unchecked(protectedHeader.values[typIndex]))
  const output = host_value_object()
  host_value_object_set(output, __pulse_fastly_string_value("claims"), normalizedClaims)
  host_value_object_set(output, __pulse_fastly_string_value("protectedHeader"), outputHeader)
  __pulse_fastly_deep_freeze(output)
  __pulse_fastly_jwt_record_verified()
  return output
}
