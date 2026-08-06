'use strict';

const JSON_BODY_VERSION = 'pulsewasm.json-body.v1';
const JSON_BODY_PHASE = '10F';
const DEPLOYMENT_POSTURE_VERSION = 'pulsewasm.deployment-posture.v1';

const JSON_TARGETS = new Set(['generic', 'schema', 'none', 'auto', 'parser']);
const ENGINE_TARGETS = new Set(['wasm', 'js']);
const DEFAULT_JSON_MAX_BYTES = 1_048_576;

const JSON_ABI_EXPORTS = Object.freeze([
  'pulse_request_body_text(ctxRef) -> StringRef',
  'pulse_request_body_len(ctxRef) -> i32',
  'pulse_request_json_parse(ctxRef) -> JsonParseResultRef',
  'pulse_json_result_ok(resultRef) -> i32',
  'pulse_json_result_value(resultRef) -> JsonValueRef',
  'pulse_json_result_error(resultRef) -> ErrorRef',
  'pulse_json_kind(valueRef) -> i32',
  'pulse_json_object_has(valueRef, keyPtr, keyLen) -> i32',
  'pulse_json_object_get(valueRef, keyPtr, keyLen) -> JsonValueRef',
  'pulse_json_array_len(valueRef) -> i32',
  'pulse_json_array_get(valueRef, index) -> JsonValueRef',
  'pulse_json_as_string(valueRef) -> StringRef',
  'pulse_json_as_f64(valueRef) -> f64',
  'pulse_json_as_bool(valueRef) -> i32',
  'pulse_result_json_text(ctxRef, statusCode, jsonPtr, jsonLen) -> void'
]);

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function selectRuntimeEngine(config) {
  const runtime = plainObject(config.runtime);
  const explicit = typeof runtime.engine === 'string' && runtime.engine !== '';
  if (explicit) return { engine: runtime.engine, source: 'config.runtime.engine', explicit: true };
  if (typeof config.target === 'string' && config.target === 'js') return { engine: 'js', source: 'config.target', explicit: false };
  return { engine: 'wasm', source: config.target ? 'default-from-non-js-target' : 'default', explicit: false };
}

function selectJsonConfig(config) {
  const runtime = plainObject(config.runtime);
  const payload = plainObject(runtime.payload);
  const json = plainObject(payload.json || config.json);
  const explicitTarget = typeof json.target === 'string' && json.target !== '';
  const target = explicitTarget ? json.target : 'generic';
  const maxBytes = json.maxBytes === undefined || json.maxBytes === null ? DEFAULT_JSON_MAX_BYTES : Number(json.maxBytes);
  return {
    raw: json,
    target,
    explicitTarget,
    targetSource: explicitTarget ? 'runtime.payload.json.target' : 'default',
    maxBytes,
    maxBytesSource: json.maxBytes === undefined || json.maxBytes === null ? 'default' : 'runtime.payload.json.maxBytes',
    schemas: Array.isArray(json.schemas) ? json.schemas : [],
    parser: typeof json.parser === 'string' && json.parser ? json.parser : undefined
  };
}

function isSupportedJsonTarget(target) {
  return JSON_TARGETS.has(target);
}

function isSupportedRuntimeEngine(engine) {
  return ENGINE_TARGETS.has(engine);
}

module.exports = {
  JSON_BODY_VERSION,
  JSON_BODY_PHASE,
  DEPLOYMENT_POSTURE_VERSION,
  JSON_TARGETS,
  ENGINE_TARGETS,
  DEFAULT_JSON_MAX_BYTES,
  JSON_ABI_EXPORTS,
  selectRuntimeEngine,
  selectJsonConfig,
  isSupportedJsonTarget,
  isSupportedRuntimeEngine
};
