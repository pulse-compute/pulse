'use strict';

const { schemaHasNestedJson, schemaHasScalarRecord } = require('@pulse-compute/wasm-contracts/schema-json/registry');
const { fastlyJsonValueAdmissionSource } = require('./schema-admission.js');

function hasJsonAdmission(plan) { return (plan.schemas?.registry?.schemas || []).some(schema => schema.jsonLimits); }
function tracksJsonDuplicates(plan) {
  return (plan.schemas?.registry?.schemas || []).some(schema => schemaHasNestedJson(schema.root) || schemaHasScalarRecord(schema.root));
}
function schemaParserDepth(plan, baseline = 64) {
  return Math.max(baseline, ...(plan.schemas?.registry?.schemas || []).map(schema => schema.jsonLimits?.maxDepth || 0));
}

function nestedJsonProjectionLines(node) {
  return [
    ...(node.kind === 'json-object' ? ['  if (input.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 52, -1); return 0 }'] : []),
    '  return __pulse_fastly_copy_json(valueHandle, checkDuplicates)'
  ];
}

function schemaFetchJsonSource() {
  return `
function __pulse_fastly_fetch_json_headers(input: __PulseFastlyValue): __PulseFastlyValue {
  for (let index = 0; index < input.keys.length; index++) if (input.keys[index].toLowerCase() == "content-type") return input
  const output = new __PulseFastlyValue()
  output.kind = PULSE_VALUE_OBJECT
  for (let index = 0; index < input.keys.length; index++) {
    output.keys.push(input.keys[index]); output.values.push(input.values[index])
  }
  output.keys.push("content-type")
  output.values.push(__pulse_fastly_string_value("application/json; charset=utf-8"))
  return output
}
function __pulse_fastly_fetch_json_body(init: __PulseFastlyValue, valueHandle: i32): string {
  const index = __pulse_fastly_find(init, "schema")
  let value = valueHandle
  if (index >= 0) {
    const schema = __pulse_fastly_value(init.values[index])
    if (schema.kind != PULSE_VALUE_STRING || schema.text.length == 0) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 55, -1); return '' }
    value = __pulse_fastly_schema_apply(schema.text, valueHandle, true)
    if (value <= 0 || __pulse_fastly_last_error != 0) return ''
  }
  return __pulse_fastly_json(value, 0)
}
`;
}

function schemaJsonAdmissionSource(plan) {
  const schemas = plan.schemas?.registry?.schemas || [];
  if (!hasJsonAdmission(plan)) return '';
  const nested = schemas.some(schema => schemaHasNestedJson(schema.root));
  return `${fastlyJsonValueAdmissionSource()}
function __pulse_fastly_schema_parse_json(text: string, schemaHandle: i32): i32 {
  const schema = __pulse_fastly_value(schemaHandle)
  if (schema.kind == PULSE_VALUE_STRING) {
${schemas.map((schema, index) => schema.jsonLimits ? `    if (schema.text == ${JSON.stringify(schema.id)} && __pulse_schema_json_scan_${index}(text, 0).failure != 0) {
      __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 57, -1); return 0
    }` : '').join('\n')}
  }
  return __pulse_fastly_parse_json(text)
}
${nested ? `
class __PulseFastlyJsonCopyFrame {
  index: i32 = 0
  constructor(public input: i32, public output: i32) {}
}
function __pulse_fastly_json_copy_enter(handle: i32, duplicates: bool, frames: Array<__PulseFastlyJsonCopyFrame>): i32 {
  const value = __pulse_fastly_value(handle)
  if (value.kind != PULSE_VALUE_ARRAY && value.kind != PULSE_VALUE_OBJECT) return handle
  if (duplicates && value.duplicateJsonKeys) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 57, -1); return 0 }
  const copy = value.kind == PULSE_VALUE_ARRAY ? host_value_array() : host_value_object()
  frames.push(new __PulseFastlyJsonCopyFrame(handle, copy))
  return copy
}
function __pulse_fastly_copy_json(handle: i32, duplicates: bool): i32 {
  const frames = new Array<__PulseFastlyJsonCopyFrame>()
  const output = __pulse_fastly_json_copy_enter(handle, duplicates, frames)
  while (frames.length > 0) {
    const frame = frames[frames.length - 1]
    const value = __pulse_fastly_value(frame.input)
    if (frame.index == value.values.length) { frames.pop(); continue }
    const index = frame.index++
    const copy = __pulse_fastly_json_copy_enter(value.values[index], duplicates, frames)
    if (copy <= 0) return 0
    if (value.kind == PULSE_VALUE_ARRAY) host_value_array_push(frame.output, copy)
    else host_value_object_set(frame.output, __pulse_fastly_string_value(value.keys[index]), copy)
  }
  return output
}
` : ''}`;
}

module.exports = { hasJsonAdmission, tracksJsonDuplicates, schemaParserDepth, nestedJsonProjectionLines, schemaJsonAdmissionSource, schemaFetchJsonSource };
