// Package-owned adaptation to Pulse's canonical host ABI. No provider I/O here.
@external("pulse_host", "value_json") declare function entity_host_json(handle: i32): i32
@external("pulse_host", "value_null") declare function entity_host_null(): i32
@external("pulse_host", "value_boolean") declare function entity_host_boolean(value: i32): i32
@external("pulse_host", "value_number") declare function entity_host_number(value: f64): i32
@external("pulse_host", "value_string") declare function entity_host_string(pointer: i32, length: i32): i32
@external("pulse_host", "value_array") declare function entity_host_array(): i32
@external("pulse_host", "value_array_push") declare function entity_host_push(array: i32, value: i32): void
@external("pulse_host", "value_object") declare function entity_host_object(): i32
@external("pulse_host", "value_object_set") declare function entity_host_set(object: i32, key: i32, value: i32): void
@external("pulse_host", "request_text") declare function entity_host_request(): i32
@external("pulse_host", "response_custom") declare function entity_host_response(value: i32): i32
@external("pulse_host", "effect_begin") declare function entity_host_effect(index: i32, payload: i32): void
@external("pulse_host", "log") declare function entity_host_log(level: i32, payload: i32): void

let __pulse_package_result: i32 = 0
let __pulse_package_state: i32 = 0
let __pulse_package_error: i32 = 0

function __pulse_package_string(value: string): i32 {
  return entity_host_string(changetype<i32>(value), value.length)
}
function __pulse_package_value(value: JSON.Value): i32 {
  if (value.type == JSON.Types.Null) return entity_host_null()
  if (value.type == JSON.Types.Bool) return entity_host_boolean(value.get<bool>() ? 1 : 0)
  if (value.type == JSON.Types.String) return __pulse_package_string(value.get<string>())
  if (__pulse_entities_is_number(value)) return entity_host_number(__pulse_entities_number(value))
  if (value.type == JSON.Types.Array) {
    const handle = entity_host_array()
    const items = value.get<JSON.Arr>()
    for (let index = 0; index < items.length; index++) entity_host_push(handle, __pulse_package_value(items.at(index)))
    return handle
  }
  const handle = entity_host_object()
  const object = value.get<JSON.Obj>()
  const keys = object.keys()
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]
    const item = object.get(key)
    entity_host_set(handle, __pulse_package_string(key), item === null ? entity_host_null() : __pulse_package_value(item!))
  }
  return handle
}
function pulse_entities_host_effect_begin(index: i32, pointer: i32, length: i32): void {
  const payload = JSON.parse<JSON.Value>(changetype<string>(pointer))
  __pulse_package_state = __pulse_package_effect_state(index)
  entity_host_effect(index, __pulse_package_value(__pulse_entities_property(payload, 'inputs')))
}
function pulse_entities_host_log(level: i32, pointer: i32, length: i32): void {
  entity_host_log(4 - level, __pulse_package_string(changetype<string>(pointer)))
}
function __pulse_package_finish(status: i32): i32 {
  if (status == __PULSE_ENTITIES_RUN_SUSPENDED) return 1
  if (status != __PULSE_ENTITIES_RUN_COMPLETE) { __pulse_package_error = 5; return -1 }
  const response = entity_host_object()
  entity_host_set(response, __pulse_package_string('status'), entity_host_number(<f64>__pulse_entities_response_status))
  entity_host_set(response, __pulse_package_string('body'), __pulse_package_string(__pulse_entities_response))
  if (__pulse_entities_response_status != 204) {
    const headers = entity_host_object()
    entity_host_set(headers, __pulse_package_string('content-type'), __pulse_package_string('application/json; charset=utf-8'))
    entity_host_set(response, __pulse_package_string('headers'), headers)
  }
  __pulse_package_result = entity_host_response(response)
  return 0
}
export function pulse_abi_version(): i32 { return 2 }
export function pulse_plan_hash_ptr(): i32 { return changetype<i32>(__pulse_application_plan_hash) }
export function pulse_plan_hash_length(): i32 { return __pulse_application_plan_hash.length }
export function pulse_start(): i32 {
  if (__pulse_entities_started != 0) { __pulse_package_error = 1; return -1 }
  const request = JSON.parse<string>(changetype<string>(entity_host_json(entity_host_request())))
  pulse_entities_set_request(changetype<i32>(request))
  return __pulse_package_finish(pulse_entities_start())
}
export function pulse_resume(): i32 {
  if (__pulse_entities_suspended == 0 || __pulse_entities_pending_count != 0) { __pulse_package_error = 2; return -2 }
  return __pulse_package_finish(pulse_entities_resume())
}
export function pulse_set_effect_result(index: i32, handle: i32): i32 {
  if (handle <= 0) { __pulse_package_error = 3; return 0 }
  const result = pulse_entities_set_effect_result(index, 1, entity_host_json(handle))
  if (result == 0) __pulse_package_error = 3
  return result
}
export function pulse_package_set_effect_failure(index: i32): i32 {
  return pulse_entities_set_effect_result(index, 0, changetype<i32>('null'))
}
export function pulse_result_handle(): i32 { return __pulse_package_result }
export function pulse_program_counter(): i32 { return __pulse_entities_pc }
export function pulse_continuation_state(): i32 { return __pulse_package_state }
export function pulse_last_error_code(): i32 { return __pulse_package_error }
export function pulse_pending_count(): i32 { return pulse_entities_pending_count() }
export function pulse_schema_string_id(): i32 { return idof<string>() }
