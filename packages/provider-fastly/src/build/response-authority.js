'use strict';

// Driver-owned downstream authority, selected only by services that need it.
// This is not resource ownership: streaming writers and borrowed request handles
// still require their service's qualified disposal policy.
function instrument(source) {
  const anchor = 'declare function fastly_http_resp_send_downstream(';
  if (source.split(anchor).length !== 2) {
    const error = new Error('Downstream authority import boundary drift.');
    error.code = 'PULSE_FASTLY_LIFECYCLE_HOOK_INVALID';
    throw error;
  }
  return source.replace(anchor, 'declare function __pulse_response_send_raw(') + `
// 0 owned; 1 dispatch outcome unknown; 2 transferred; 3 locally completed.
// Completion is not a delivery receipt. Nonzero status or trap never reopens it.
let __pulse_response_authority: i32 = 0
function __pulse_response_owned(): bool { return __pulse_response_authority == 0 }
function __pulse_response_begin(): bool {
  if (!__pulse_response_owned()) { __pulse_fastly_fail(PULSE_ERROR_STATE, 282, -1); return false }
  __pulse_response_authority = 1
  return true
}
function __pulse_response_transferred(): void {
  if (__pulse_response_authority == 1) __pulse_response_authority = 2
}
function __pulse_response_complete(): void {
  if (__pulse_response_authority == 2) __pulse_response_authority = 3
}
function fastly_http_resp_send_downstream(handle: i32, body: i32, streaming: i32): i32 {
  if (!__pulse_response_begin()) return PULSE_ERROR_STATE
  const status = __pulse_response_send_raw(handle, body, streaming)
  if (status == 0) {
    __pulse_response_transferred()
    if (streaming == 0) __pulse_response_complete()
  }
  return status
}
`;
}
function hooks() {
  return [{ point: 'response.authority', owner: 'driver.response', order: -100,
    body: '  return __pulse_response_owned()' }];
}
module.exports = { instrument, hooks };
