'use strict';

const { admission } = require('@pulse-compute/wasm-contracts/schema-json/contracts');
const NATIVE_JSON_MAX_DEPTH = 128;

function generateSchemaJsonPolicy(schema, index, maxBytes) {
  const limits = { ...schema.jsonLimits, maxTextBytes: Math.min(schema.jsonLimits.maxTextBytes, maxBytes) };
  if (limits.maxDepth > NATIVE_JSON_MAX_DEPTH) {
    const error = new TypeError(`Native schema ${schema.id} requests maxDepth ${limits.maxDepth}; the supported JSON parser/serializer capacity is ${NATIVE_JSON_MAX_DEPTH}.`);
    error.code = 'PULSE_SCHEMA_JSON_DEPTH_UNSUPPORTED';
    throw error;
  }
  return `
function __pulse_schema_json_limits_${index}(): __PulseJsonAdmissionLimits {
  const limits = new __PulseJsonAdmissionLimits()
${admission.JSON_LIMIT_FIELDS.map(key => `  limits.${key} = ${limits[key]}`).join('\n')}
  return limits
}
function __pulse_schema_json_scan_${index}(text: string, duplicateMode: i32 = 2): __PulseJsonTextAdmission {
  const scan = new __PulseJsonTextAdmission(text, __pulse_schema_json_limits_${index}(), duplicateMode)
  scan.scan()
  return scan
}
`;
}

function jsonAdmissionRuntimeSource() {
  // Emit the exact reference scanner, with only static type realization. Keep
  // the algorithm in the contract owner so target counting cannot drift.
  return [admission.JsonAdmissionLimits, admission.JsonAdmissionBudget,
    admission.JsonAdmissionFrame, admission.JsonTextAdmission].map(value => value.toString()).join('\n')
    .replace(/\/\*: ([^*]+) \*\//g, ': $1')
    .replace(/\/\* nonnull \*\//g, '')
    .replace('new Map()', 'new Map<string, i32>()')
    .replace(/\b(JsonAdmissionLimits|JsonAdmissionBudget|JsonAdmissionFrame|JsonTextAdmission)\b/g, '__Pulse$1');
}

function generateJsonAdmission(input) {
  const identity = admission.jsonAdmissionIdentity(input);
  const initialize = admission.JSON_LIMIT_FIELDS.map(key => `  limits.${key} = ${identity.limits[key]}`).join('\n');
  const source = `${jsonAdmissionRuntimeSource()}
function __pulse_json_limits(): __PulseJsonAdmissionLimits {
  const limits = new __PulseJsonAdmissionLimits()
${initialize}
  return limits
}
function __pulse_json_admit(text: string, duplicateMode: i32 = 0): __PulseJsonTextAdmission {
  const admission = new __PulseJsonTextAdmission(text, __pulse_json_limits(), duplicateMode)
  admission.scan()
  return admission
}
`;
  return Object.freeze({ source, identity });
}

module.exports = { NATIVE_JSON_MAX_DEPTH, jsonAdmissionRuntimeSource, generateJsonAdmission, generateSchemaJsonPolicy };
