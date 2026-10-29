'use strict';

// Preserve ordered pairs (including repeated names) in the existing key/value
// carrier. Do not use object_set: it would replace duplicate keys.
function fetchHeadersSource() {
  return `
function __pulse_fastly_fetch_header_valid(name: string, value: __PulseFastlyValue): bool {
  if (name.length == 0 || value.kind != PULSE_VALUE_STRING) return false
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) continue
    if ("!#$%&'*+-.^_\u0060|~".indexOf(name.charAt(i)) < 0) return false
  }
  for (let i = 0; i < value.text.length; i++) {
    const c = value.text.charCodeAt(i)
    if (c == 0 || c == 10 || c == 13 || c > 255) return false
  }
  return true
}
function __pulse_fastly_fetch_headers(input: __PulseFastlyValue, effectIndex: i32): __PulseFastlyValue {
  const output = new __PulseFastlyValue()
  output.kind = PULSE_VALUE_OBJECT
  if (input.kind == PULSE_VALUE_UNDEFINED) return output
  if (input.kind == PULSE_VALUE_OBJECT) {
    for (let i = 0; i < input.keys.length; i++) {
      if (!__pulse_fastly_fetch_header_valid(input.keys[i], __pulse_fastly_value(input.values[i]))) {
        __pulse_fastly_fail(PULSE_ERROR_VALUE, 74, effectIndex); return output
      }
    }
    return input
  }
  if (input.kind == PULSE_VALUE_ARRAY) {
    for (let i = 0; i < input.values.length; i++) {
      const pair = __pulse_fastly_value(input.values[i])
      if (pair.kind != PULSE_VALUE_ARRAY || pair.values.length != 2) {
        __pulse_fastly_fail(PULSE_ERROR_VALUE, 74, effectIndex); return output
      }
      const name = __pulse_fastly_value(pair.values[0])
      if (name.kind != PULSE_VALUE_STRING || !__pulse_fastly_fetch_header_valid(name.text, __pulse_fastly_value(pair.values[1]))) {
        __pulse_fastly_fail(PULSE_ERROR_VALUE, 74, effectIndex); return output
      }
      output.keys.push(name.text); output.values.push(pair.values[1])
    }
    return output
  }
  __pulse_fastly_fail(PULSE_ERROR_VALUE, 74, effectIndex)
  return output
}
`;
}

module.exports = { fetchHeadersSource };
