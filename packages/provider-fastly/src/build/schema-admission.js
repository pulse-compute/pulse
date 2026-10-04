'use strict';

const { schemaAdmission } = require('@pulse-compute/wasm-runtime-core-as/compiler');

function fastlyJsonValueAdmissionSource() {
  return `
class __PulseFastlyAdmissionFrame {
  index: i32 = 0
  constructor(public handle: i32) {}
}
function __pulse_fastly_admission_enter(handle: i32, budget: __PulseJsonAdmissionBudget,
  stack: Array<__PulseFastlyAdmissionFrame>, active: Set<i32>): bool {
  if (handle <= 0 || handle > __pulse_fastly_values.length) return budget.fail(12)
  const value = __pulse_fastly_values[handle - 1]
  const array = value.kind == PULSE_VALUE_ARRAY
  const object = value.kind == PULSE_VALUE_OBJECT
  if (!budget.node(stack.length + (array || object ? 1 : 0))) return false
  if (value.kind == PULSE_VALUE_NULL) return budget.addBytes(4)
  if (value.kind == PULSE_VALUE_BOOLEAN) return budget.addBytes(value.boolean != 0 ? 4 : 5)
  if (value.kind == PULSE_VALUE_NUMBER) return isFinite(value.number) ? budget.addBytes(24) : budget.fail(11)
  if (value.kind == PULSE_VALUE_STRING) return budget.stringBytes(value.text, false)
  if (!array && !object) return budget.fail(12)
  if (active.has(handle)) return budget.fail(13)
  if (array && value.values.length > budget.limits.maxArrayItems) return budget.fail(6)
  if (object && value.keys.length > budget.limits.maxObjectMembers) return budget.fail(5)
  if (object && value.keys.length != value.values.length) return budget.fail(12)
  if (!budget.addBytes(2)) return false
  active.add(handle)
  stack.push(new __PulseFastlyAdmissionFrame(handle))
  return true
}
function __pulse_fastly_admit_bounded_value(handle: i32, limits: __PulseJsonAdmissionLimits): __PulseJsonAdmissionBudget {
  const budget = new __PulseJsonAdmissionBudget(limits)
  const stack = new Array<__PulseFastlyAdmissionFrame>()
  const active = new Set<i32>()
  if (!__pulse_fastly_admission_enter(handle, budget, stack, active)) return budget
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    const value = __pulse_fastly_values[frame.handle - 1]
    if (frame.index == value.values.length) { active.delete(frame.handle); stack.pop(); continue }
    const index = frame.index++
    if (index > 0 && !budget.addBytes(1)) return budget
    if (value.kind == PULSE_VALUE_OBJECT) {
      if (!budget.stringBytes(value.keys[index], true) || !budget.addBytes(1)) return budget
    }
    if (!__pulse_fastly_admission_enter(value.values[index], budget, stack, active)) return budget
  }
  return budget
}
`;
}

// Standalone composition used by focused admission fixtures.
function generateFastlyJsonAdmission(limits, parserMaxDepth = 64) {
  const generated = schemaAdmission.generateJsonAdmission(limits);
  if (!Number.isInteger(parserMaxDepth) || parserMaxDepth < 1 || parserMaxDepth > 0x7fffffff
    || generated.identity.limits.maxDepth > parserMaxDepth) {
    throw new TypeError('JSON admission depth exceeds the selected Fastly parser capacity.');
  }
  return Object.freeze({ identity: generated.identity, source: `${generated.source}
${fastlyJsonValueAdmissionSource()}
function __pulse_fastly_admit_value(handle: i32): __PulseJsonAdmissionBudget {
  return __pulse_fastly_admit_bounded_value(handle, __pulse_json_limits())
}
function __pulse_fastly_admitted_json(text: string, duplicateMode: i32 = 0): i32 {
  const admission = __pulse_json_admit(text, duplicateMode)
  if (admission.failure != 0) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 57, -1); return 0 }
  return __pulse_fastly_parse_json(text)
}
function __pulse_fastly_admitted_json_text(handle: i32): string {
  const admission = __pulse_fastly_admit_value(handle)
  if (admission.failure != 0) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 57, -1); return '' }
  const text = __pulse_fastly_json(handle, 0)
  if (String.UTF8.byteLength(text) > admission.limits.maxTextBytes) {
    __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 57, -1)
    return ''
  }
  return text
}
` });
}

module.exports = { generateFastlyJsonAdmission, fastlyJsonValueAdmissionSource };
