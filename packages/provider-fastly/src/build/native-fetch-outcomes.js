'use strict';

function instrument(input, plan) {
  const selected = plan.effects.flatMap((effect, index) => effect.kind === 'fetch' && effect.fetchErrors === 'collect' ? [index] : []);
  const wrapped = plan.effects.flatMap((effect,index)=>effect.kind==='fetch' && (effect.fetchErrors==='collect'||effect.fetchTiming) ? [index] : []);
  const hasTiming = plan.effects.some(effect=>effect.fetchTiming);
  let source = input;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw Error('Fetch outcome boundary drift: ' + before);
    source = source.replace(before, after);
  };
  // Even an unselected operation may receive a dynamic init object. Fail closed
  // if it tries to change the statically planned result shape before dispatch.
  const selectedIndex = selected.map(i => `effectIndex == ${i}`).join(' || ') || 'false';
  const anchor = 'headers.kind = PULSE_VALUE_OBJECT; if (init.kind == PULSE_VALUE_OBJECT) {';
  replace(anchor, anchor + `
    const errorsIndex = __pulse_fastly_find(init, 'errors');
    const errors = errorsIndex >= 0 ? __pulse_fastly_value(init.values[errorsIndex]) : new __PulseFastlyValue();
    const collect = errors.kind == PULSE_VALUE_STRING && errors.text == 'collect';
    if ((errorsIndex >= 0 && errors.kind != PULSE_VALUE_UNDEFINED && !collect) || collect != (${selectedIndex})) {
      __pulse_fastly_fail(PULSE_ERROR_VALUE, 48, effectIndex); return;
    }
  `);
  if (!wrapped.length) return source;
  replace('function __pulse_fastly_fetch_begin(effectIndex: i32, payload: __PulseFastlyValue): void {',
    'function __pulse_fetch_begin_uncollected(effectIndex: i32, payload: __PulseFastlyValue): void {');
  replace('function __pulse_fastly_resolve_effect(effectIndex: i32): i32 {',
    'function __pulse_fetch_resolve_uncollected(effectIndex: i32): i32 {');
  // Keep host status available only while an explicitly selected fetch projection
  // runs. Schema, invalid handle/ABI and request-body errors stay fatal.
  replace('if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 20, effectIndex); return "" }',
    'if (status != FASTLY_STATUS_OK) { if (__pulse_fetch_projecting >= 0) __pulse_fetch_fail(status, 20, __pulse_fetch_projecting); else __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 20, effectIndex); return "" }');
  source += `
// Per-site storage is reset on every admission; it never outlives invocation ownership.
const __pulse_fetch_collected_failure = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
let __pulse_fetch_projecting: i32 = -1
function __pulse_fetch_collects(index: i32): bool { return ${selected.map(i => `index == ${i}`).join(' || ') || 'false'} }
function __pulse_fetch_wraps(index: i32): bool { return ${wrapped.map(i => `index == ${i}`).join(' || ')} }
function __pulse_fetch_envelope(index: i32, value: i32, timeout: bool = false, rejected: bool = false): i32 {
  const result = host_value_object()
  host_value_object_set(result, __pulse_fastly_string_value('status'), __pulse_fastly_string_value(rejected ? 'rejected' : 'fulfilled'))
  if (rejected) {
    const error = host_value_object()
    host_value_object_set(error, __pulse_fastly_string_value('code'), __pulse_fastly_string_value(timeout ? 'PULSE_FETCH_TIMEOUT' : 'PULSE_FETCH_NETWORK'))
    host_value_object_set(result, __pulse_fastly_string_value('error'), error)
  } else host_value_object_set(result, __pulse_fastly_string_value('value'), value)
  ${hasTiming ? "if (__pulse_timing_selected(index)) host_value_object_set(result, __pulse_fastly_string_value('elapsedMs'), __pulse_timing_elapsed(index))" : ''}
  return result
}
function __pulse_fetch_collect_failure(index: i32): i32 {
  if (!__pulse_fetch_collects(index) || !__pulse_fetch_request_check(index)) return 0
  const stage = __pulse_fastly_error_stage
  if (__pulse_fastly_last_error != PULSE_ERROR_TRANSPORT || __pulse_fastly_error_effect != index
    || (stage != 77 && stage != 81 && stage != 271 && stage != 20)) return 0
  __pulse_fastly_last_error = 0; __pulse_fastly_error_stage = 0; __pulse_fastly_error_effect = -1
  return __pulse_fetch_envelope(index, 0, stage == 271, true)
}
function __pulse_fastly_fetch_begin(effectIndex: i32, payload: __PulseFastlyValue): void {
  __pulse_fetch_collected_failure[effectIndex] = 0
  __pulse_fetch_begin_uncollected(effectIndex, payload)
  if (__pulse_fastly_last_error == 0) return
  const failure = __pulse_fetch_collect_failure(effectIndex)
  if (failure <= 0) return
  __pulse_fetch_collected_failure[effectIndex] = failure
  __pulse_fastly_ready_effect(effectIndex, failure)
}
function __pulse_fastly_resolve_effect(effectIndex: i32): i32 {
  const saved = __pulse_fetch_collected_failure[effectIndex]
  if (saved > 0) {
    if (!__pulse_fetch_request_check(effectIndex)) return 0
    __pulse_fetch_collected_failure[effectIndex] = 0
    __pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_NONE
    __pulse_fastly_ready[effectIndex] = 0
    return saved
  }
  if (__pulse_fetch_wraps(effectIndex)) __pulse_fetch_projecting = effectIndex
  const value = __pulse_fetch_resolve_uncollected(effectIndex)
  __pulse_fetch_projecting = -1
  if (!__pulse_fetch_wraps(effectIndex)) return value
  if (!__pulse_fetch_request_check(effectIndex)) return 0
  if (__pulse_fastly_last_error != 0) return __pulse_fetch_collect_failure(effectIndex)
  return value > 0 ? __pulse_fetch_envelope(effectIndex, value) : 0
}
`;
  return source;
}
module.exports = { instrument };
