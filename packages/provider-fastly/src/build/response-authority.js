'use strict';

// Adapted from HEX research ecc36468b5900a0de57a415379b85d12c5026f3f; structural emission.

const { httpLifecycle } = require('@pulse-compute/wasm-contracts/provider/toolchain');
if (httpLifecycle.VERSION !== 'pulse.http-lifecycle.v1') throw bindingError('Unsupported HTTP lifecycle contract version.');
const { AUTHORITY } = httpLifecycle;
// Fastly owns this diagnostic/runtime encoding; shared contracts use names.
const STATES = Object.freeze({ owned: 0, 'outcome-unknown': 1, transferred: 2, completed: 3 });
if (AUTHORITY.states.length !== Object.keys(STATES).length || AUTHORITY.states.some(state => !Object.hasOwn(STATES, state)))
  throw bindingError('Fastly response-authority encoding does not cover the shared contract.');
const dispatch = AUTHORITY.transitions.dispatch;
const transfer = AUTHORITY.transitions.transfer;
const complete = AUTHORITY.transitions.complete;
const mayRespond = AUTHORITY.mayRespond.map(state => `__pulse_response_authority == ${STATES[state]}`).join(' || ');

function bindingError(message) {
  return Object.assign(new Error(message), { code: 'PULSE_FASTLY_LIFECYCLE_HOOK_INVALID' });
}

// Driver-owned downstream authority, selected only by services that need it.
// This is not resource ownership: streaming writers and borrowed request handles
// still require their service's qualified disposal policy.
function runtimeSource() {
  return `
// 0 owned; 1 dispatch outcome unknown; 2 transferred; 3 locally completed.
// Completion is not a delivery receipt. Nonzero status or trap never reopens it.
let __pulse_response_authority: i32 = ${STATES[AUTHORITY.initial]}
function __pulse_response_owned(): bool { return ${mayRespond} }
function __pulse_response_begin(): bool {
  if (!__pulse_response_owned()) { __pulse_fastly_fail(PULSE_ERROR_STATE, 282, -1); return false }
  __pulse_response_authority = ${STATES[dispatch.to]}
  return true
}
function __pulse_response_transferred(): void {
  if (__pulse_response_authority == ${STATES[transfer.from]}) __pulse_response_authority = ${STATES[transfer.to]}
}
function __pulse_response_complete(): void {
  if (__pulse_response_authority == ${STATES[complete.from]}) __pulse_response_authority = ${STATES[complete.to]}
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
module.exports = { STATES, runtimeSource, hooks };
