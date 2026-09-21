'use strict';

const { CANONICAL_EFFECT_INVOCATION_POLICY } = require('@pulse-compute/wasm-contracts/handler/canonical-runtime');

function runtimeSource() {
  return `
const PULSE_FASTLY_MAX_EFFECT_INVOCATIONS: i32 = ${CANONICAL_EFFECT_INVOCATION_POLICY.defaultMaxEffects}
let __pulse_invocation_count: i32 = 0
let __pulse_invocation_started: bool = false
let __pulse_invocation_closed: bool = false
let __pulse_invocation_failure: i32 = 171
const __pulse_invocation_tickets = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
function __pulse_invocation_begin(index: i32): bool {
  if (__pulse_invocation_closed || index < 0 || index >= PULSE_FASTLY_EFFECT_COUNT
    || unchecked(__pulse_invocation_tickets[index]) != 0) {
    __pulse_fastly_fail(PULSE_ERROR_STATE, __pulse_invocation_failure, index); return false
  }
  if (__pulse_invocation_count >= PULSE_FASTLY_MAX_EFFECT_INVOCATIONS) {
    __pulse_invocation_closed = true
    __pulse_invocation_failure = 170
    __pulse_fastly_fail(PULSE_ERROR_STATE, 170, index); return false
  }
  unchecked(__pulse_invocation_tickets[index] = ++__pulse_invocation_count)
  return true
}
function __pulse_invocation_settle(index: i32, ticket: i32, result: i32): i32 {
  if (__pulse_invocation_closed || index < 0 || index >= PULSE_FASTLY_EFFECT_COUNT
    || ticket <= 0 || unchecked(__pulse_invocation_tickets[index]) != ticket) {
    __pulse_fastly_fail(PULSE_ERROR_STATE, __pulse_invocation_failure, index); return 0
  }
  unchecked(__pulse_invocation_tickets[index] = 0)
  return pulse_set_effect_result(index, result)
}
function __pulse_invocation_close(): void {
  __pulse_invocation_closed = true
  for (let i = 0; i < PULSE_FASTLY_EFFECT_COUNT; i += 1) unchecked(__pulse_invocation_tickets[i] = 0)
}
`;
}

function instrument(source) {
  const signature = 'function host_effect_begin(effectIndex: i32, payload: i32): void {';
  if (!source.includes(signature)) throw new Error('Fastly invocation admission boundary drift.');
  // Every guest-requested slot gets a ticket, including a group member suppressed
  // by an earlier application error. Its undefined result can then be drained.
  return source.replace(signature, signature + '\n  if (!__pulse_invocation_begin(effectIndex)) return;');
}

module.exports = { runtimeSource, instrument, policy: CANONICAL_EFFECT_INVOCATION_POLICY };
