/*
 * Package-owned Native runtime for @pulse-compute/entities.
 *
 * The package generator appends one static discriminator table, reachable
 * managed handlers, and the selected schema codecs to this source. This base
 * owns the bounded JSON-RPC envelope scan and exact response framing. It does
 * imports no dynamic handler and does not delegate envelope authority to JSON.Raw.
 */

import { JSON } from 'json-as'

const __PULSE_ENTITIES_MAX_ENVELOPE_BYTES: i32 = 65_536
const __PULSE_ENTITIES_MAX_PAYLOAD_BYTES: i32 = 32_768
const __PULSE_ENTITIES_MAX_METHOD_BYTES: i32 = 256
const __PULSE_ENTITIES_MAX_DEPTH: i32 = 32
const __PULSE_ENTITIES_MAX_OUTPUT_BYTES: i32 = 65_536

const __PULSE_ENTITIES_PARSE_ERROR: i32 = -32700
const __PULSE_ENTITIES_INVALID_REQUEST: i32 = -32600
const __PULSE_ENTITIES_METHOD_NOT_FOUND: i32 = -32601
const __PULSE_ENTITIES_INVALID_PARAMS: i32 = -32602
const __PULSE_ENTITIES_INTERNAL_ERROR: i32 = -32603

const __PULSE_ENTITIES_RUN_COMPLETE: i32 = 0
const __PULSE_ENTITIES_RUN_SUSPENDED: i32 = 1
const __PULSE_ENTITIES_RUN_FAILED: i32 = 2
const __PULSE_ENTITIES_RESULT_ACCEPTED: i32 = 1
const __PULSE_ENTITIES_RESULT_REJECTED: i32 = 0

let __pulse_entities_request: string = ''
let __pulse_entities_request_set: i32 = 0
let __pulse_entities_body_reads: i32 = 0
let __pulse_entities_response: string = ''
let __pulse_entities_response_status: i32 = 500
let __pulse_entities_scan_error: i32 = 0
let __pulse_entities_scan_ok: bool = false
let __pulse_entities_method: string = ''
let __pulse_entities_params_present: bool = false
let __pulse_entities_params_start: i32 = 0
let __pulse_entities_params_end: i32 = 0
let __pulse_entities_id_present: bool = false
let __pulse_entities_id_start: i32 = 0
let __pulse_entities_id_end: i32 = 0

function __pulse_entities_utf8_bytes(text: string, start: i32 = 0, end: i32 = -1): i32 {
  const limit = end < 0 ? text.length : end
  let bytes: i32 = 0
  let index = start
  while (index < limit) {
    const code = text.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < limit) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
    index += 1
  }
  return bytes
}

function __pulse_entities_ws(text: string, index: i32): i32 {
  let cursor = index
  while (cursor < text.length) {
    const code = text.charCodeAt(cursor)
    if (code != 0x20 && code != 0x09 && code != 0x0a && code != 0x0d) break
    cursor += 1
  }
  return cursor
}

function __pulse_entities_syntax(): i32 {
  __pulse_entities_scan_error = __PULSE_ENTITIES_PARSE_ERROR
  return -1
}

function __pulse_entities_invalid(): i32 {
  __pulse_entities_scan_error = __PULSE_ENTITIES_INVALID_REQUEST
  return -1
}

function __pulse_entities_hex(code: i32): bool {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102)
}

function __pulse_entities_scan_string(text: string, index: i32): i32 {
  if (index >= text.length || text.charCodeAt(index) != 0x22) return __pulse_entities_syntax()
  let cursor = index + 1
  while (cursor < text.length) {
    const code = text.charCodeAt(cursor)
    if (code == 0x22) return cursor + 1
    if (code < 0x20) return __pulse_entities_syntax()
    if (code == 0x5c) {
      cursor += 1
      if (cursor >= text.length) return __pulse_entities_syntax()
      const escape = text.charCodeAt(cursor)
      if (escape == 0x22 || escape == 0x5c || escape == 0x2f || escape == 0x62 || escape == 0x66 || escape == 0x6e || escape == 0x72 || escape == 0x74) {
        cursor += 1
        continue
      }
      if (escape != 0x75 || cursor + 4 >= text.length) return __pulse_entities_syntax()
      for (let offset: i32 = 1; offset <= 4; offset += 1) if (!__pulse_entities_hex(text.charCodeAt(cursor + offset))) return __pulse_entities_syntax()
      cursor += 5
      continue
    }
    cursor += 1
  }
  return __pulse_entities_syntax()
}

function __pulse_entities_scan_number(text: string, index: i32): i32 {
  let cursor = index
  if (cursor < text.length && text.charCodeAt(cursor) == 0x2d) cursor += 1
  if (cursor >= text.length) return __pulse_entities_syntax()
  let code = text.charCodeAt(cursor)
  if (code == 0x30) cursor += 1
  else if (code >= 0x31 && code <= 0x39) {
    cursor += 1
    while (cursor < text.length) {
      code = text.charCodeAt(cursor)
      if (code < 0x30 || code > 0x39) break
      cursor += 1
    }
  } else return __pulse_entities_syntax()
  if (cursor < text.length && text.charCodeAt(cursor) == 0x2e) {
    cursor += 1
    if (cursor >= text.length || text.charCodeAt(cursor) < 0x30 || text.charCodeAt(cursor) > 0x39) return __pulse_entities_syntax()
    while (cursor < text.length && text.charCodeAt(cursor) >= 0x30 && text.charCodeAt(cursor) <= 0x39) cursor += 1
  }
  if (cursor < text.length && (text.charCodeAt(cursor) == 0x65 || text.charCodeAt(cursor) == 0x45)) {
    cursor += 1
    if (cursor < text.length && (text.charCodeAt(cursor) == 0x2b || text.charCodeAt(cursor) == 0x2d)) cursor += 1
    if (cursor >= text.length || text.charCodeAt(cursor) < 0x30 || text.charCodeAt(cursor) > 0x39) return __pulse_entities_syntax()
    while (cursor < text.length && text.charCodeAt(cursor) >= 0x30 && text.charCodeAt(cursor) <= 0x39) cursor += 1
  }
  return cursor
}

function __pulse_entities_scan_value(text: string, index: i32, depth: i32): i32 {
  const start = __pulse_entities_ws(text, index)
  if (start >= text.length) return __pulse_entities_syntax()
  if (depth > __PULSE_ENTITIES_MAX_DEPTH) return __pulse_entities_invalid()
  const token = text.charCodeAt(start)
  if (token == 0x22) return __pulse_entities_scan_string(text, start)
  if (token == 0x7b) {
    let cursor = __pulse_entities_ws(text, start + 1)
    if (cursor < text.length && text.charCodeAt(cursor) == 0x7d) return cursor + 1
    while (cursor < text.length) {
      if (text.charCodeAt(cursor) != 0x22) return __pulse_entities_syntax()
      cursor = __pulse_entities_scan_string(text, cursor)
      if (cursor < 0) return -1
      cursor = __pulse_entities_ws(text, cursor)
      if (cursor >= text.length || text.charCodeAt(cursor) != 0x3a) return __pulse_entities_syntax()
      cursor = __pulse_entities_scan_value(text, cursor + 1, depth + 1)
      if (cursor < 0) return -1
      cursor = __pulse_entities_ws(text, cursor)
      if (cursor < text.length && text.charCodeAt(cursor) == 0x7d) return cursor + 1
      if (cursor >= text.length || text.charCodeAt(cursor) != 0x2c) return __pulse_entities_syntax()
      cursor = __pulse_entities_ws(text, cursor + 1)
    }
    return __pulse_entities_syntax()
  }
  if (token == 0x5b) {
    let cursor = __pulse_entities_ws(text, start + 1)
    if (cursor < text.length && text.charCodeAt(cursor) == 0x5d) return cursor + 1
    while (cursor < text.length) {
      cursor = __pulse_entities_scan_value(text, cursor, depth + 1)
      if (cursor < 0) return -1
      cursor = __pulse_entities_ws(text, cursor)
      if (cursor < text.length && text.charCodeAt(cursor) == 0x5d) return cursor + 1
      if (cursor >= text.length || text.charCodeAt(cursor) != 0x2c) return __pulse_entities_syntax()
      cursor = __pulse_entities_ws(text, cursor + 1)
    }
    return __pulse_entities_syntax()
  }
  if (text.substr(start, 4) == 'true' || text.substr(start, 4) == 'null') return start + 4
  if (text.substr(start, 5) == 'false') return start + 5
  if (token == 0x2d || (token >= 0x30 && token <= 0x39)) return __pulse_entities_scan_number(text, start)
  return __pulse_entities_syntax()
}

function __pulse_entities_safe_integer_id(raw: string): bool {
  let start: i32 = 0
  if (raw.length > 0 && raw.charCodeAt(0) == 0x2d) start = 1
  if (start >= raw.length) return false
  if (raw.charCodeAt(start) == 0x30 && raw.length - start != 1) return false
  for (let index = start; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    if (code < 0x30 || code > 0x39) return false
  }
  const digits = raw.substring(start)
  if (digits.length < 16) return true
  if (digits.length > 16) return false
  return digits <= '9007199254740991'
}

function __pulse_entities_empty_object(raw: string): bool {
  if (raw.length < 2 || raw.charCodeAt(0) != 0x7b || raw.charCodeAt(raw.length - 1) != 0x7d) return false
  return __pulse_entities_ws(raw, 1) == raw.length - 1
}

function __pulse_entities_scan_envelope(text: string): bool {
  __pulse_entities_scan_error = 0
  __pulse_entities_scan_ok = false
  __pulse_entities_method = ''
  __pulse_entities_params_present = false
  __pulse_entities_id_present = false
  if (__pulse_entities_utf8_bytes(text) > __PULSE_ENTITIES_MAX_ENVELOPE_BYTES) {
    __pulse_entities_invalid()
    return false
  }
  let cursor = __pulse_entities_ws(text, 0)
  if (cursor >= text.length || text.charCodeAt(cursor) != 0x7b) {
    __pulse_entities_invalid()
    return false
  }
  cursor = __pulse_entities_ws(text, cursor + 1)
  let versionPresent = false
  let methodPresent = false
  let versionStart: i32 = 0
  let versionEnd: i32 = 0
  if (cursor < text.length && text.charCodeAt(cursor) != 0x7d) {
    while (cursor < text.length) {
      if (text.charCodeAt(cursor) != 0x22) { __pulse_entities_syntax(); return false }
      const keyStart = cursor
      const keyEnd = __pulse_entities_scan_string(text, keyStart)
      if (keyEnd < 0) return false
      const key = JSON.parse<string>(text.substring(keyStart, keyEnd))
      cursor = __pulse_entities_ws(text, keyEnd)
      if (cursor >= text.length || text.charCodeAt(cursor) != 0x3a) { __pulse_entities_syntax(); return false }
      const valueStart = __pulse_entities_ws(text, cursor + 1)
      const valueEnd = __pulse_entities_scan_value(text, valueStart, 1)
      if (valueEnd < 0) return false
      if (key == 'jsonrpc') {
        if (versionPresent) { __pulse_entities_invalid(); return false }
        versionPresent = true
        versionStart = valueStart
        versionEnd = valueEnd
      } else if (key == 'method') {
        if (methodPresent) { __pulse_entities_invalid(); return false }
        methodPresent = true
        if (valueStart >= text.length || text.charCodeAt(valueStart) != 0x22) { __pulse_entities_invalid(); return false }
        __pulse_entities_method = JSON.parse<string>(text.substring(valueStart, valueEnd))
      } else if (key == 'params') {
        if (__pulse_entities_params_present) { __pulse_entities_invalid(); return false }
        __pulse_entities_params_present = true
        __pulse_entities_params_start = valueStart
        __pulse_entities_params_end = valueEnd
      } else if (key == 'id') {
        if (__pulse_entities_id_present) { __pulse_entities_invalid(); return false }
        __pulse_entities_id_present = true
        __pulse_entities_id_start = valueStart
        __pulse_entities_id_end = valueEnd
      }
      cursor = __pulse_entities_ws(text, valueEnd)
      if (cursor < text.length && text.charCodeAt(cursor) == 0x7d) break
      if (cursor >= text.length || text.charCodeAt(cursor) != 0x2c) { __pulse_entities_syntax(); return false }
      cursor = __pulse_entities_ws(text, cursor + 1)
    }
  }
  if (cursor >= text.length || text.charCodeAt(cursor) != 0x7d) { __pulse_entities_syntax(); return false }
  cursor = __pulse_entities_ws(text, cursor + 1)
  if (cursor != text.length) { __pulse_entities_syntax(); return false }
  if (!versionPresent || text.substring(versionStart, versionEnd) != '"2.0"' || !methodPresent) {
    __pulse_entities_invalid()
    return false
  }
  const methodBytes = __pulse_entities_utf8_bytes(__pulse_entities_method)
  if (__pulse_entities_method.length == 0 || methodBytes > __PULSE_ENTITIES_MAX_METHOD_BYTES) {
    __pulse_entities_invalid()
    return false
  }
  if (__pulse_entities_params_present && __pulse_entities_utf8_bytes(text, __pulse_entities_params_start, __pulse_entities_params_end) > __PULSE_ENTITIES_MAX_PAYLOAD_BYTES) {
    __pulse_entities_invalid()
    return false
  }
  if (__pulse_entities_id_present) {
    const raw = text.substring(__pulse_entities_id_start, __pulse_entities_id_end)
    const first = raw.length > 0 ? raw.charCodeAt(0) : 0
    if (raw != 'null' && first != 0x22 && !__pulse_entities_safe_integer_id(raw)) {
      __pulse_entities_invalid()
      return false
    }
  }
  __pulse_entities_scan_ok = true
  return true
}

function __pulse_entities_null(): JSON.Value { return JSON.Value.empty() }

function __pulse_entities_is_number(value: JSON.Value): bool {
  const kind = value.type
  return kind >= JSON.Types.U8 && kind <= JSON.Types.F64
}

function __pulse_entities_number(value: JSON.Value): f64 {
  switch (value.type) {
    case JSON.Types.U8: return <f64>value.get<u8>()
    case JSON.Types.U16: return <f64>value.get<u16>()
    case JSON.Types.U32: return <f64>value.get<u32>()
    case JSON.Types.U64: return <f64>value.get<u64>()
    case JSON.Types.I8: return <f64>value.get<i8>()
    case JSON.Types.I16: return <f64>value.get<i16>()
    case JSON.Types.I32: return <f64>value.get<i32>()
    case JSON.Types.I64: return <f64>value.get<i64>()
    case JSON.Types.F32: return <f64>value.get<f32>()
    case JSON.Types.F64: return value.get<f64>()
    default: return NaN
  }
}

function __pulse_entities_text(value: JSON.Value): string {
  if (value.type == JSON.Types.String) return value.get<string>()
  if (value.type == JSON.Types.Null) return 'null'
  if (value.type == JSON.Types.Bool) return value.get<bool>() ? 'true' : 'false'
  if (__pulse_entities_is_number(value)) return __pulse_entities_number(value).toString()
  return JSON.stringify<JSON.Value>(value)
}

function __pulse_entities_truthy(value: JSON.Value): bool {
  if (value.type == JSON.Types.Null) return false
  if (value.type == JSON.Types.Bool) return value.get<bool>()
  if (value.type == JSON.Types.String) return value.get<string>().length > 0
  if (__pulse_entities_is_number(value)) {
    const number = __pulse_entities_number(value)
    return number != 0.0 && !isNaN(number)
  }
  return true
}

function __pulse_entities_property(value: JSON.Value, key: string): JSON.Value {
  if (value.type == JSON.Types.Object) {
    const found = value.get<JSON.Obj>().get(key)
    return found === null ? __pulse_entities_null() : found!
  }
  if (key == 'length' && value.type == JSON.Types.String) return JSON.Value.from<f64>(<f64>value.get<string>().length)
  if (key == 'length' && value.type == JSON.Types.Array) return JSON.Value.from<f64>(<f64>value.get<JSON.Arr>().length)
  return __pulse_entities_null()
}

function __pulse_entities_element(value: JSON.Value, key: JSON.Value): JSON.Value {
  if (value.type == JSON.Types.Array && __pulse_entities_is_number(key)) {
    const index = <i32>__pulse_entities_number(key)
    const array = value.get<JSON.Arr>()
    return index >= 0 && index < array.length ? array.at(index) : __pulse_entities_null()
  }
  return __pulse_entities_property(value, __pulse_entities_text(key))
}

function __pulse_entities_equal(left: JSON.Value, right: JSON.Value): bool {
  if (__pulse_entities_is_number(left) && __pulse_entities_is_number(right)) return __pulse_entities_number(left) == __pulse_entities_number(right)
  if (left.type != right.type) return false
  if (left.type == JSON.Types.Null) return true
  if (left.type == JSON.Types.String) return left.get<string>() == right.get<string>()
  if (left.type == JSON.Types.Bool) return left.get<bool>() == right.get<bool>()
  return JSON.stringify<JSON.Value>(left) == JSON.stringify<JSON.Value>(right)
}

function __pulse_entities_binary(operator: i32, left: JSON.Value, right: JSON.Value): JSON.Value {
  if (operator == 0) {
    if (left.type == JSON.Types.String || right.type == JSON.Types.String) return JSON.Value.from<string>(__pulse_entities_text(left) + __pulse_entities_text(right))
    return JSON.Value.from<f64>(__pulse_entities_number(left) + __pulse_entities_number(right))
  }
  if (operator == 1) return JSON.Value.from<f64>(__pulse_entities_number(left) - __pulse_entities_number(right))
  if (operator == 2) return JSON.Value.from<f64>(__pulse_entities_number(left) * __pulse_entities_number(right))
  if (operator == 3) return JSON.Value.from<f64>(__pulse_entities_number(left) / __pulse_entities_number(right))
  if (operator == 4) return JSON.Value.from<f64>(__pulse_entities_number(left) % __pulse_entities_number(right))
  if (operator == 5) return JSON.Value.from<bool>(__pulse_entities_equal(left, right))
  if (operator == 6) return JSON.Value.from<bool>(!__pulse_entities_equal(left, right))
  if (operator == 7) return JSON.Value.from<bool>(__pulse_entities_number(left) < __pulse_entities_number(right))
  if (operator == 8) return JSON.Value.from<bool>(__pulse_entities_number(left) <= __pulse_entities_number(right))
  if (operator == 9) return JSON.Value.from<bool>(__pulse_entities_number(left) > __pulse_entities_number(right))
  if (operator == 10) return JSON.Value.from<bool>(__pulse_entities_number(left) >= __pulse_entities_number(right))
  return __pulse_entities_null()
}

function __pulse_entities_set_response(status: i32, body: string): void {
  __pulse_entities_response_status = status
  __pulse_entities_response = body
}

function __pulse_entities_error_message(code: i32): string {
  if (code == __PULSE_ENTITIES_PARSE_ERROR) return 'Parse error'
  if (code == __PULSE_ENTITIES_INVALID_REQUEST) return 'Invalid Request'
  if (code == __PULSE_ENTITIES_METHOD_NOT_FOUND) return 'Method not found'
  if (code == __PULSE_ENTITIES_INVALID_PARAMS) return 'Invalid params'
  return 'Internal error'
}

function __pulse_entities_complete_failure(code: i32, selectedEnvelope: bool): i32 {
  if (selectedEnvelope && !__pulse_entities_id_present) {
    __pulse_entities_set_response(204, '')
    return __PULSE_ENTITIES_RUN_COMPLETE
  }
  const id = selectedEnvelope && __pulse_entities_id_present
    ? __pulse_entities_request.substring(__pulse_entities_id_start, __pulse_entities_id_end)
    : 'null'
  const body = '{"jsonrpc":"2.0","error":{"code":' + code.toString() + ',"message":' + JSON.stringify<string>(__pulse_entities_error_message(code)) + '},"id":' + id + '}'
  __pulse_entities_set_response(200, body)
  return __PULSE_ENTITIES_RUN_COMPLETE
}

function __pulse_entities_complete_success(encoded: string): i32 {
  if (__pulse_entities_utf8_bytes(encoded) > __PULSE_ENTITIES_MAX_OUTPUT_BYTES) return __pulse_entities_complete_failure(__PULSE_ENTITIES_INTERNAL_ERROR, true)
  if (!__pulse_entities_id_present) {
    __pulse_entities_set_response(204, '')
    return __PULSE_ENTITIES_RUN_COMPLETE
  }
  const id = __pulse_entities_request.substring(__pulse_entities_id_start, __pulse_entities_id_end)
  __pulse_entities_set_response(200, '{"jsonrpc":"2.0","result":' + encoded + ',"id":' + id + '}')
  return __PULSE_ENTITIES_RUN_COMPLETE
}

export function pulse_entities_string_id(): i32 { return idof<string>() }

export function pulse_entities_set_request(pointer: i32): i32 {
  if (pointer <= 0 || __pulse_entities_request_set != 0) return 0
  __pulse_entities_request = changetype<string>(pointer)
  __pulse_entities_request_set = 1
  __pulse_entities_body_reads = 1
  __pulse_entities_response = ''
  __pulse_entities_response_status = 500
  return 1
}

export function pulse_entities_response_ptr(): i32 { return changetype<i32>(__pulse_entities_response) }
export function pulse_entities_response_length(): i32 { return __pulse_entities_response.length }
export function pulse_entities_response_status(): i32 { return __pulse_entities_response_status }
export function pulse_entities_body_read_count(): i32 { return __pulse_entities_body_reads }
export function pulse_entities_run_complete(): i32 { return __PULSE_ENTITIES_RUN_COMPLETE }
export function pulse_entities_run_suspended(): i32 { return __PULSE_ENTITIES_RUN_SUSPENDED }
export function pulse_entities_run_failed(): i32 { return __PULSE_ENTITIES_RUN_FAILED }
