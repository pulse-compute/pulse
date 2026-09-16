'use strict';

// Host value handles live for the invocation. Store concatenation as shared,
// immutable prefixes instead of retaining a flat copy for every intermediate.
// This changes representation only: coercion happens at the original operation,
// and aliases keep their original string even after a later append.
const nativeStringFields = `
  textLeaf: string = ""
  textLeft: __PulseFastlyValue | null = null
  textRight: __PulseFastlyValue | null = null
  textLength: i32 = 0
  get text(): string {
    if (this.textLeft === null) return this.textLeaf
    const pending = new Array<__PulseFastlyValue>()
    const parts = new Array<string>()
    pending.push(this)
    while (pending.length > 0) {
      const node = pending.pop()
      if (node.textLeft === null) parts.push(node.textLeaf)
      else { pending.push(node.textRight!); pending.push(node.textLeft!) }
    }
    this.textLeaf = parts.join("")
    this.textLeft = null
    this.textRight = null
    return this.textLeaf
  }
  set text(value: string) {
    this.textLeaf = value
    this.textLength = value.length
    this.textLeft = null
    this.textRight = null
  }
`;
const nativeStringConcat = `
function __pulse_fastly_concat(leftHandle: i32, rightHandle: i32): i32 {
  let left = __pulse_fastly_value(leftHandle)
  let right = __pulse_fastly_value(rightHandle)
  // Snapshot non-string coercions now; a referenced object can change later.
  if (left.kind != PULSE_VALUE_STRING) {
    leftHandle = __pulse_fastly_string_value(__pulse_fastly_string(leftHandle))
    left = __pulse_fastly_value(leftHandle)
  }
  if (right.kind != PULSE_VALUE_STRING) {
    rightHandle = __pulse_fastly_string_value(__pulse_fastly_string(rightHandle))
    right = __pulse_fastly_value(rightHandle)
  }
  if (left.textLength == 0) return rightHandle
  if (right.textLength == 0) return leftHandle
  const length = i64(left.textLength) + i64(right.textLength)
  if (length > String.MAX_LENGTH) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 57, -1); return 0 }
  const value = new __PulseFastlyValue()
  value.kind = PULSE_VALUE_STRING
  value.textLength = i32(length)
  value.textLeft = left
  value.textRight = right
  return __pulse_fastly_put(value)
}
`;

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
function __pulse_fastly_string_index(value: __PulseFastlyValue, keyHandle: i32): i32 {
  const key = __pulse_fastly_value(keyHandle)
  if (key.kind == PULSE_VALUE_STRING && key.text == "length") return host_value_number(value.textLength)
  if (key.kind != PULSE_VALUE_NUMBER && key.kind != PULSE_VALUE_STRING) return host_value_undefined()
  const index = __pulse_fastly_number(keyHandle)
  if (!(index >= 0 && index < value.textLength)) return host_value_undefined()
  const position = i32(index)
  if (index != f64(position)) return host_value_undefined()
  if (key.kind == PULSE_VALUE_STRING && key.text != position.toString()) return host_value_undefined()
  let node = value
  let offset = position
  while (node.textLeft !== null) {
    const left = node.textLeft!
    if (offset < left.textLength) node = left
    else { offset -= left.textLength; node = node.textRight! }
  }
  return __pulse_fastly_string_value(node.textLeaf.charAt(offset))
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

module.exports = { nativeStringFields, nativeStringConcat, nativeStringTrim, nativeStringIndex, needsNativeValueFailureGuard };
