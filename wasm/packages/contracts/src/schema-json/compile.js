'use strict';

const SCHEMA_JSON_COMPILE_VERSION = 'pulsewasm.schema-json-compile.v1';
const SCHEMA_JSON_COMPILE_SMOKE_VERSION = 'pulsewasm.schema-json-compile-smoke.v1';
const SCHEMA_JSON_COMPILE_PHASE = '13';
const PHASE = SCHEMA_JSON_COMPILE_PHASE;

const MARKER_TYPES = new Map([
  ['string', 'string'],
  ['bool', 'bool'],
  ['boolean', 'bool'],
  ['i32', 'i32'],
  ['u32', 'u32'],
  ['Int32', 'i32'],
  ['Uint32', 'u32'],
  ['f64', 'f64'],
  ['number', 'f64']
]);
const JSON_MARKER_MODULES = new Set([
  '@pulse-compute/pulse/schema',
  '@pulsewasm/json-types',
  'pulsewasm/json-types'
]);

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function jsonConfig(config) {
  const runtime = plainObject(config && config.runtime);
  const payload = plainObject(runtime.payload);
  return plainObject(payload.json || (config && config.json));
}

function normalizeFieldType(type) {
  const raw = String(type || '');
  return MARKER_TYPES.get(raw) || raw;
}

function isJsonMarkerModule(moduleName) {
  return JSON_MARKER_MODULES.has(String(moduleName || ''));
}

function compileNeeded(config) {
  const json = jsonConfig(config);
  const schemas = Array.isArray(json.schemas) ? json.schemas : [];
  const target = json.target || 'generic';
  const effectiveTarget = target === 'auto' && schemas.length > 0 ? 'schema' : target;
  if (effectiveTarget !== 'schema') return false;
  return schemas.some((schema) => Object.keys(plainObject(schema.fields)).length === 0 && typeof schema.source === 'string' && schema.source && typeof schema.type === 'string' && schema.type);
}

module.exports = {
  SCHEMA_JSON_COMPILE_VERSION,
  SCHEMA_JSON_COMPILE_SMOKE_VERSION,
  SCHEMA_JSON_COMPILE_PHASE,
  PHASE,
  MARKER_TYPES,
  JSON_MARKER_MODULES,
  normalizeFieldType,
  isJsonMarkerModule,
  compileNeeded
};
