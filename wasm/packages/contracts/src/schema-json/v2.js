'use strict';

const SCHEMA_JSON_SIDECAR_VERSION = 'pulsewasm.schema-json-sidecar.v3';
const SCHEMA_JSON_PLAN_VERSION = 'pulsewasm.schema-json-plan.v3';
const SCHEMA_JSON_REPORT_VERSION = 'pulsewasm.schema-json-parser-report.v3';
const SCHEMA_JSON_SMOKE_VERSION = 'pulsewasm.schema-json-smoke.v3';
const SCHEMA_JSON_REGISTRY_VERSION = 'pulsewasm.schema-json-registry.v2';
const SCHEMA_JSON_ABI_VERSION = 'pulsewasm.schema-json-sidecar-abi.v2';
const SCHEMA_JSON_BODY_POLICY_VERSION = 'pulsewasm.schema-json-body-policy.v1';
const SCHEMA_JSON_PHASE = '14';
const PHASE = SCHEMA_JSON_PHASE;

const SCALAR_ALIASES = new Map([
  ['boolean', 'bool'],
  ['number', 'f64']
]);
const SCALAR_TYPES = new Set(['string', 'bool', 'boolean', 'i32', 'u32', 'f64', 'number']);
const RESERVED_SCALAR_TYPES = new Set(['any', 'unknown', 'object', 'Object', 'Record<string, unknown>', 'array', 'Array']);
const CONTENT_TYPE_POLICIES = new Set(['accept-json-or-missing', 'require-json']);
const RESERVED_CONTENT_TYPE_POLICIES = new Set(['ignore-content-type']);
const DEFAULT_SCHEMA_JSON_NAMESPACE = 'app';
const DEFAULT_SCHEMA_JSON_CONTENT_TYPE_POLICY = 'accept-json-or-missing';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function plainObject(value) {
  return isPlainObject(value) ? value : {};
}

function jsonConfig(config) {
  const runtime = plainObject(config && config.runtime);
  const payload = plainObject(runtime.payload);
  return plainObject(payload.json || (config && config.json));
}

function lowerScalar(type) {
  return SCALAR_ALIASES.get(type) || type;
}

function normalizeScalarType(type) {
  const raw = String(type || '');
  return lowerScalar(raw);
}

function isSupportedScalarType(type) {
  const raw = String(type || '');
  const lowered = lowerScalar(raw);
  return SCALAR_TYPES.has(raw) || SCALAR_TYPES.has(lowered);
}

function isReservedScalarType(type) {
  return RESERVED_SCALAR_TYPES.has(String(type || ''));
}

function isSupportedContentTypePolicy(policy) {
  return CONTENT_TYPE_POLICIES.has(String(policy));
}

function descriptorNeedsV2(value) {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, 'fields')) return true;
  if (Object.prototype.hasOwnProperty.call(value, 'enum')) return true;
  if (Object.prototype.hasOwnProperty.call(value, 'required')) return true;
  if (Object.prototype.hasOwnProperty.call(value, 'nullable')) return true;
  if (value.type === 'object') return true;
  if (Array.isArray(value.type)) return true;
  if (isPlainObject(value.type)) return true;
  return false;
}

function configArtifact(config) {
  return config && typeof config === 'object' && config.artifact ? config.artifact : config;
}

function shouldUseSchemaJsonV2(config) {
  const json = jsonConfig(configArtifact(config));
  if ((json.schemaVersion || '') === 'v2') return true;
  const schemas = Array.isArray(json.schemas) ? json.schemas : [];
  return schemas.some((schema) => descriptorNeedsV2(schema.fields) || Object.values(plainObject(schema.fields)).some((field) => descriptorNeedsV2(field)));
}

module.exports = {
  SCHEMA_JSON_SIDECAR_VERSION,
  SCHEMA_JSON_PLAN_VERSION,
  SCHEMA_JSON_REPORT_VERSION,
  SCHEMA_JSON_SMOKE_VERSION,
  SCHEMA_JSON_REGISTRY_VERSION,
  SCHEMA_JSON_ABI_VERSION,
  SCHEMA_JSON_BODY_POLICY_VERSION,
  SCHEMA_JSON_PHASE,
  PHASE,
  SCALAR_ALIASES,
  SCALAR_TYPES,
  RESERVED_SCALAR_TYPES,
  CONTENT_TYPE_POLICIES,
  RESERVED_CONTENT_TYPE_POLICIES,
  DEFAULT_SCHEMA_JSON_NAMESPACE,
  DEFAULT_SCHEMA_JSON_CONTENT_TYPE_POLICY,
  lowerScalar,
  normalizeScalarType,
  isSupportedScalarType,
  isReservedScalarType,
  isSupportedContentTypePolicy,
  configArtifact,
  descriptorNeedsV2,
  shouldUseSchemaJsonV2
};
