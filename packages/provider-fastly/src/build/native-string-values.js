'use strict';

// ECMAScript WhiteSpace + LineTerminator code units. Keep this explicit rather
// than inheriting the AssemblyScript library's Unicode whitespace policy.
const nativeStringTrim = `
function __pulse_fastly_trim_space(code: i32): bool {
  return (code >= 9 && code <= 13) || code == 32 || code == 160 || code == 5760
    || (code >= 8192 && code <= 8202) || code == 8232 || code == 8233
    || code == 8239 || code == 8287 || code == 12288 || code == 65279
}
function host_value_string_trim(handle: i32): i32 {
  const value = __pulse_fastly_value(handle)
  if (value.kind != PULSE_VALUE_STRING) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 56, -1); return 0 }
  let start = 0
  let end = value.text.length
  while (start < end && __pulse_fastly_trim_space(value.text.charCodeAt(start))) start += 1
  while (end > start && __pulse_fastly_trim_space(value.text.charCodeAt(end - 1))) end -= 1
  return __pulse_fastly_string_value(value.text.substring(start, end))
}
`;

// Indexed reads expose one UTF-16 code unit, including an isolated surrogate.
// Validate property spelling before converting to i32: "01", fractions,
// negative indices and nonnumeric keys are ordinary missing properties.
const nativeStringIndex = `
function __pulse_fastly_string_index(text: string, keyHandle: i32): i32 {
  const key = __pulse_fastly_value(keyHandle)
  if (key.kind != PULSE_VALUE_NUMBER && key.kind != PULSE_VALUE_STRING) return host_value_undefined()
  const index = __pulse_fastly_number(keyHandle)
  if (!(index >= 0 && index < text.length)) return host_value_undefined()
  const position = i32(index)
  if (index != f64(position)) return host_value_undefined()
  if (key.kind == PULSE_VALUE_STRING && key.text != position.toString()) return host_value_undefined()
  return __pulse_fastly_string_value(text.charAt(position))
}
`;

function needsNativeValueFailureGuard(plan) {
  if ((plan.schemas?.references || []).some(entry => ['value-encode', 'text-decode'].includes(entry.usage))) return true;
  function containsValueOperation(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.kind === 'pure-loop' || (node.kind === 'method-call' && node.method === 'string.trim')) return true;
    return Object.values(node).some(containsValueOperation);
  }
  return containsValueOperation(plan.entry?.body) || containsValueOperation(plan.effects);
}

module.exports = { nativeStringTrim, nativeStringIndex, needsNativeValueFailureGuard };
