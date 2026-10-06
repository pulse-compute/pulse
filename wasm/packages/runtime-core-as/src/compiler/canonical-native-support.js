'use strict';

const { runtimeContract, eventContract } = require('./canonical-native-context.js');

// Resume data is complete before support emission; only these local string
// arrays are mutable here. The control builder remains the sole block owner.
function prepareNativeRuntimeSupport({
  plan, stages, stageSites, maxStageSites, helpers, applicationErrors,
  stateEnabled, eventEntries, eventReachable, blocks, resumeRequirements
}) {
  const imports = runtimeContract.CANONICAL_NATIVE_IMPORTS.filter(([name]) => name !== 'router_error_take' || applicationErrors).map(([name, parameters, results]) => {
    const args = parameters.map((type, index) => `arg${index}: ${type}`).join(', ');
    const result = results.length > 0 ? results[0] : 'void';
    return `@external("${runtimeContract.CANONICAL_NATIVE_IMPORT_MODULE}", "${name}") declare function host_${name}(${args}): ${result}`;
  });

  const globals = stages.size ? [
    'let __pulse_stage_next: i32 = 0', 'let __pulse_stage_return: i32 = 0',
    ...Array.from({ length: maxStageSites }, (_, site) => site).flatMap(site => [`let __pulse_stage_effect_${site}: i32 = -1`, `let __pulse_stage_continuation_${site}: i32 = 0`])
  ] : [];
  if (helpers.size) globals.push('let __pulse_helper_result: i32 = 0', 'let __pulse_helper_return: i32 = 0', 'let __pulse_helper_error_next: i32 = 0', 'let __pulse_helper_error_return: i32 = 0');
  if (eventReachable) {
    globals.push('let __pulse_event_runtime_id: i32 = -1');
    globals.push('let __pulse_event_payload_handle: i32 = 0');
  }
  if (stateEnabled) {
    globals.push('let __pulse_state_keys = new Array<i32>()');
    globals.push('let __pulse_state_values = new Array<i32>()');
  }
  for (let index = 0; index < (plan.locals || []).length; index += 1) globals.push(`let __pulse_local_${index}: i32 = 0`);
  for (let index = 0; index < (plan.effects || []).length; index += 1) {
    globals.push(`let __pulse_effect_result_${index}: i32 = 0`);
    globals.push(`let __pulse_effect_ready_${index}: i32 = 0`);
    globals.push(`let __pulse_effect_pending_${index}: i32 = 0`);
  }

  const setterCases = (plan.effects || []).map((_, index) => [
    `    case ${index}:`,
    `      if (handle <= 0 || __pulse_effect_pending_${index} == 0 || __pulse_effect_ready_${index} != 0) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_EFFECT_RESULT}; return ${runtimeContract.CANONICAL_NATIVE_RESULT_STATUS.REJECTED} }`,
    `      __pulse_effect_result_${index} = handle`,
    `      __pulse_effect_ready_${index} = 1`,
    `      __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.NONE}`,
    `      return ${runtimeContract.CANONICAL_NATIVE_RESULT_STATUS.ACCEPTED}`
  ].join('\n')).join('\n');
  const readyCases = [...resumeRequirements.entries()].map(([pc, required]) => {
    const condition = required.length > 0 ? required.map((index) => stages.has(blocks[pc].handlerId)
      ? `__pulse_stage_ready(__pulse_stage_effect_${stageSites.get(index).site}) != 0` : `__pulse_effect_ready_${index} != 0`).join(' && ') : 'true';
    return `    case ${pc}: return ${condition}`;
  }).join('\n');
  const clearCases = [...resumeRequirements.entries()].map(([pc, required]) => {
    const lines = required.flatMap((index) => stages.has(blocks[pc].handlerId)
      ? [`__pulse_stage_clear(__pulse_stage_effect_${stageSites.get(index).site})`] : [`__pulse_effect_ready_${index} = 0`, `__pulse_effect_pending_${index} = 0`]).join('; ');
    return `    case ${pc}: ${lines}${lines ? '; ' : ''}return`;
  }).join('\n');
  const eventPayloadCases = eventEntries.map((event) => {
    const condition = event.schemaId === null ? 'payloadHandle == 0' : 'payloadHandle > 0';
    return `    case ${event.runtimeId}: validPayload = ${condition}; break`;
  }).join('\n');
  const eventExports = eventReachable ? [
    `export function pulse_event_abi_version(): i32 { return ${eventContract.EVENT_NATIVE_ABI_EXTENSION.abiVersion} }`,
    'export function pulse_event_start(runtimeId: i32, payloadHandle: i32): i32 {',
    `  if (__pulse_started != 0 || runtimeId < 0 || payloadHandle < 0) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_START}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED} }`,
    '  let validPayload = false',
    '  switch (runtimeId) {',
    eventPayloadCases,
    '    default: validPayload = false',
    '  }',
    `  if (!validPayload) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_START}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED} }`,
    '  __pulse_started = 1',
    '  __pulse_event_runtime_id = runtimeId',
    '  __pulse_event_payload_handle = payloadHandle',
    '  __pulse_pc = PULSE_ENTRY_PC',
    '  __pulse_state = 0',
    '  __pulse_result = 0',
    '  __pulse_error = 0',
    '  __pulse_pending = 0',
    ...(stateEnabled ? ['  __pulse_state_keys = new Array<i32>()', '  __pulse_state_values = new Array<i32>()'] : []),
    '  return __pulse_run()',
    '}'
  ] : [];

  const executionGlobals = [
    'let __pulse_started: i32 = 0',
    'let __pulse_pc: i32 = 0',
    'let __pulse_state: i32 = 0',
    'let __pulse_result: i32 = 0',
    'let __pulse_error: i32 = 0',
    'let __pulse_pending: i32 = 0',
  ];
  return { imports, executionGlobals, globals, readyCases, clearCases, setterCases, eventExports };
}

// Called at the original assembly positions to retain evaluation/failure order.
function renderNativeValueSupport({ stages, stageSites, stateEnabled, binaryIndex }) {
  return [
    ...(stages.size ? require('./shared-stage-accessors').effectAccessors(stageSites) : []),
    '',
    'function __pulse_string(value: string): i32 { return host_value_string(changetype<i32>(value), value.length) }',
    'function __pulse_drop(value: i32): void {}',
    ...(stateEnabled ? [
      `function __pulse_state_find(key: i32): i32 { for (let index: i32 = 0; index < __pulse_state_keys.length; index += 1) { const equal = host_value_binary(${binaryIndex.get('===')}, __pulse_state_keys[index], key); if (host_value_truthy(equal) != 0) return index; } return -1 }`,
      'function __pulse_state_get(key: i32): i32 { const index = __pulse_state_find(key); return index < 0 ? host_value_undefined() : __pulse_state_values[index] }',
      'function __pulse_state_set(key: i32, value: i32): i32 { const index = __pulse_state_find(key); if (index < 0) { __pulse_state_keys.push(key); __pulse_state_values.push(value); } else { __pulse_state_values[index] = value; } return host_value_undefined() }'
    ] : []),
  ];
}

function renderNativeResumeSupport({ readyCases, clearCases }) {
  return [
    '',
    'function __pulse_ready_for_resume(): bool {',
    '  switch (__pulse_pc) {',
    ...(readyCases ? [readyCases] : []),
    '    default: return false',
    '  }',
    '}',
    'function __pulse_clear_resume_flags(): void {',
    '  switch (__pulse_pc) {',
    ...(clearCases ? [clearCases] : []),
    '    default: return',
    '  }',
    '}',
  ];
}

function renderNativeExports({ eventReachable, stateEnabled, eventExports, setterCases }) {
  return [
    'export function pulse_abi_version(): i32 { return PULSE_ABI_VERSION }',
    'export function pulse_plan_hash_ptr(): i32 { return changetype<i32>(PULSE_PLAN_HASH) }',
    'export function pulse_plan_hash_length(): i32 { return PULSE_PLAN_HASH.length }',
    'export function pulse_start(): i32 {',
    `  if (__pulse_started != 0) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_START}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED} }`,
    '  __pulse_started = 1',
    '  __pulse_pc = PULSE_ENTRY_PC',
    '  __pulse_state = 0',
    '  __pulse_result = 0',
    '  __pulse_error = 0',
    '  __pulse_pending = 0',
    ...(eventReachable ? ['  __pulse_event_runtime_id = -1', '  __pulse_event_payload_handle = 0'] : []),
    ...(stateEnabled ? ['  __pulse_state_keys = new Array<i32>()', '  __pulse_state_values = new Array<i32>()'] : []),
    '  return __pulse_run()',
    '}',
    ...eventExports,
    'export function pulse_resume(): i32 {',
    `  if (__pulse_started == 0 || __pulse_pending == 0 || !__pulse_ready_for_resume()) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INCOMPLETE_RESUME}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.INVALID_RESUME} }`,
    `  __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.NONE}`,
    '  __pulse_clear_resume_flags()',
    '  return __pulse_run()',
    '}',
    'export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {',
    '  switch (effectIndex) {',
    ...(setterCases ? [setterCases] : []),
    `    default: __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_EFFECT_RESULT}; return ${runtimeContract.CANONICAL_NATIVE_RESULT_STATUS.REJECTED}`,
    '  }',
    '}',
    'export function pulse_result_handle(): i32 { return __pulse_result }',
    'export function pulse_program_counter(): i32 { return __pulse_pc }',
    'export function pulse_continuation_state(): i32 { return __pulse_state }',
    'export function pulse_last_error_code(): i32 { return __pulse_error }',
    'export function pulse_pending_count(): i32 { return __pulse_pending }',
  ];
}

module.exports = Object.freeze({
  prepareNativeRuntimeSupport, renderNativeValueSupport,
  renderNativeResumeSupport, renderNativeExports
});
