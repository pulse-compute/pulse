'use strict';
function source() { return `function __pulse_resource_request_check(): bool { return true }
function host_workspace_number_value(handle: i32): f64 {
  if (__pulse_fastly_last_error != 0) return NaN;
  const value = __pulse_fastly_value(handle);
  if (value.kind != PULSE_VALUE_NUMBER) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 280, -1); return NaN; }
  return value.number;
}
function host_workspace_check(offset: f64, capacity: i32, value: f64): i32 {
  if (__pulse_fastly_last_error != 0 || !__pulse_resource_request_check()) return -1;
  if (!isFinite(offset) || Math.floor(offset) != offset || offset < 0 || offset >= capacity || capacity < 1 || capacity > 1024 || !isFinite(value)) {
    __pulse_fastly_fail(PULSE_ERROR_VALUE, 280, -1); return -1;
  }
  return <i32>offset;
}
function host_resource_offset_value(handle: i32): f64 {
  if (__pulse_fastly_last_error != 0) return NaN;
  const value = __pulse_fastly_value(handle);
  if (value.kind != PULSE_VALUE_NUMBER) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 270, -1); return NaN; }
  return value.number;
}
function host_resource_check(offset: f64, length: i32, width: i32): i32 {
  if (__pulse_fastly_last_error != 0 || !__pulse_resource_request_check()) return -1;
  if (!isFinite(offset) || offset < 0 || Math.floor(offset) != offset || length < 0 || width < 0 || offset > <f64>length || <f64>width > <f64>length - offset) {
    __pulse_fastly_fail(PULSE_ERROR_VALUE, 270, -1); return -1;
  }
  return <i32>offset;
}
`; }
module.exports = { source };
