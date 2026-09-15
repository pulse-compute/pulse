'use strict';

function enabled(plan) {
  return (plan.routing?.entries || []).some(entry => entry.kind === 'error');
}

// Capture provider diagnostics before clearing them. A failed continuation is
// drained once; only its application data error can enter the next Router lane.
function runtimeSource() {
  const jwt = ['TOKEN_REQUIRED', 'BEARER_INVALID', 'MALFORMED', 'LIMIT_EXCEEDED',
    'ALGORITHM_NOT_ALLOWED', 'KEY_INVALID', 'SIGNATURE_INVALID', 'CLOCK_INVALID',
    'CLAIMS_INVALID', 'CLAIMS_SCHEMA_INVALID'];
  return `
let __pulse_application_schema: i32 = 0
let __pulse_application_failed_schema: i32 = 0
function __pulse_application_code(): string {
  if (__pulse_fastly_jwt_error > 0) {
    if (__pulse_fastly_last_error != PULSE_ERROR_JWT
      && !(__pulse_fastly_last_error == PULSE_ERROR_SCHEMA && __pulse_fastly_jwt_error == 10)) return ""
    switch (__pulse_fastly_jwt_error) {
${jwt.map((code, i) => `      case ${i + 1}: return "PULSE_JWT_${code}"`).join('\n')}
      default: return ""
    }
  }
  if (__pulse_application_failed_schema == 0) return ""
  if (__pulse_fastly_last_error == PULSE_ERROR_JSON) return "PULSE_SCHEMA_JSON_MALFORMED"
  if (__pulse_fastly_last_error != PULSE_ERROR_SCHEMA) return ""
  if (__pulse_fastly_error_stage == 21) return "PULSE_BODY_TOO_LARGE"
  if (__pulse_fastly_error_stage == 44) return "PULSE_SCHEMA_CONTENT_TYPE"
  if (__pulse_fastly_error_stage >= 50 && __pulse_fastly_error_stage <= 54)
    return __pulse_application_failed_schema == 2 ? "PULSE_SCHEMA_ENCODE" : "PULSE_SCHEMA_DECODE"
  return ""
}
function __pulse_application_clear(): void {
  __pulse_fastly_last_error = 0; __pulse_fastly_error_stage = 0; __pulse_fastly_error_effect = -1
  __pulse_fastly_jwt_error = 0; __pulse_application_failed_schema = 0
}
function host_router_error_take(): i32 {
  if (__pulse_fastly_last_error == 0) return 0
  const code = __pulse_application_code()
  if (code.length == 0) return -1
  // Never abandon a dispatched sibling to run application recovery.
  for (let i = 0; i < PULSE_FASTLY_EFFECT_COUNT; i += 1)
    if (unchecked(__pulse_fastly_pending_mode[i]) != PULSE_FASTLY_PENDING_NONE) return 0
  __pulse_application_clear()
  const error = host_value_object()
  host_value_object_set(error, __pulse_fastly_string_value("code"), __pulse_fastly_string_value(code))
  host_value_object_set(error, __pulse_fastly_string_value("name"), __pulse_fastly_string_value("PulseApplicationError"))
  host_value_object_set(error, __pulse_fastly_string_value("message"), __pulse_fastly_string_value("Pulse application data validation failed."))
  return error
}
`;
}

function driverLoop(plan) {
  return `  while (runStatus == 1) {
    let failure = __pulse_fastly_last_error
    let stage = __pulse_fastly_error_stage
    let effect = __pulse_fastly_error_effect
    let jwt = __pulse_fastly_jwt_error
    let schema = __pulse_application_failed_schema
    let fatal = failure != 0 && __pulse_application_code().length == 0
${(plan.effects || []).map((_, index) => `    if (__pulse_effect_pending_${index} != 0) {
      __pulse_application_clear()
      let result = host_value_undefined()
      if (unchecked(__pulse_fastly_pending_mode[${index}]) != PULSE_FASTLY_PENDING_NONE) {
        result = __pulse_fastly_resolve_effect(${index})
        if (result <= 0 && __pulse_fastly_last_error == 0) __pulse_fastly_fail(PULSE_ERROR_STATE, 101, ${index})
      } else if (failure == 0) __pulse_fastly_fail(PULSE_ERROR_STATE, 101, ${index})
      if (__pulse_fastly_last_error != 0) {
        const terminal = __pulse_application_code().length == 0
        if (failure == 0 || (!fatal && terminal)) {
          failure = __pulse_fastly_last_error; stage = __pulse_fastly_error_stage; effect = __pulse_fastly_error_effect
          jwt = __pulse_fastly_jwt_error; schema = __pulse_application_failed_schema; fatal = terminal
        }
        __pulse_application_clear()
        result = host_value_undefined()
      }
      if (pulse_set_effect_result(${index}, result) != 1) { __pulse_fastly_fail(PULSE_ERROR_STATE, 101, ${index}); return }
    }`).join('\n')}
    __pulse_fastly_last_error = failure; __pulse_fastly_error_stage = stage; __pulse_fastly_error_effect = effect
    __pulse_fastly_jwt_error = jwt; __pulse_application_failed_schema = schema
    if (fatal) return
    runStatus = pulse_resume()
  }`;
}

function instrument(source) {
  // The input is compiler-owned AS with simple, typed host signatures. Keep
  // failure suppression on all imports so a failed expression has no effects.
  source = source.replace(/function (host_\w+)\(([^)]*)\): (i32|void) \{/g,
    (declaration, name, _args, result) => name === 'host_router_error_take' ? declaration
      : `${declaration} if (__pulse_fastly_last_error != 0) return${result === 'void' ? '' : ' 0'};`);
  const wrappers = [
    ['host_request_json', 'schema: i32', 'schema', '1'],
    ['host_schema_decode', 'text: i32, schema: i32', 'text, schema', '1'],
    ['host_schema_encode', 'value: i32, schema: i32', 'value, schema', '2'],
    ['host_fetch_json', 'responseHandle: i32, schemaHandle: i32', 'responseHandle, schemaHandle', '1'],
    ['host_response_json', 'value: i32, options: i32', 'value, options', '2'],
    ['__pulse_fastly_schema_apply', 'schemaId: string, valueHandle: i32, encode: bool', 'schemaId, valueHandle, encode', 'encode ? 2 : 1']
  ];
  for (const [name, params, args, mode] of wrappers) {
    source = source.replace(`function ${name}(`, `function __pulse_application_impl_${name}(`);
    source += `\nfunction ${name}(${params}): i32 {
  const previous = __pulse_application_schema; __pulse_application_schema = ${mode}
  const result = __pulse_application_impl_${name}(${args})
  __pulse_application_schema = previous
  return result
}\n`;
  }
  source = source.replace('__pulse_fastly_last_error = code;', '__pulse_application_failed_schema = __pulse_application_schema; __pulse_fastly_last_error = code;');
  return source;
}

module.exports = Object.freeze({ enabled, runtimeSource, driverLoop, instrument });
