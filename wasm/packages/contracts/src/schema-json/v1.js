'use strict';

const SCHEMA_JSON_SIDECAR_VERSION = 'pulsewasm.schema-json-sidecar.v2';
const SCHEMA_JSON_PLAN_VERSION = 'pulsewasm.schema-json-plan.v2';
const SCHEMA_JSON_REPORT_VERSION = 'pulsewasm.schema-json-parser-report.v2';
const SCHEMA_JSON_SMOKE_VERSION = 'pulsewasm.schema-json-smoke.v2';
const SCHEMA_JSON_REGISTRY_VERSION = 'pulsewasm.schema-json-registry.v1';
const SCHEMA_JSON_ABI_VERSION = 'pulsewasm.schema-json-sidecar-abi.v1';
const SCHEMA_JSON_BODY_POLICY_VERSION = 'pulsewasm.schema-json-body-policy.v1';
const SCHEMA_JSON_PHASE = '12B.1';
const PHASE = SCHEMA_JSON_PHASE;

const SUPPORTED_TYPES = new Set(['string', 'i32', 'u32', 'f64', 'bool', 'boolean', 'number']);
const RESERVED_TYPES = new Set(['any', 'unknown', 'object', 'Object', 'Record<string, unknown>', 'array', 'Array']);
const CONTENT_TYPE_POLICIES = new Set(['accept-json-or-missing', 'require-json']);
const RESERVED_CONTENT_TYPE_POLICIES = new Set(['ignore-content-type']);
const DEFAULT_SCHEMA_JSON_NAMESPACE = 'app';
const DEFAULT_SCHEMA_JSON_MAX_BYTES = 1_048_576;
const DEFAULT_SCHEMA_JSON_CONTENT_TYPE_POLICY = 'accept-json-or-missing';

function lowerFieldType(type) {
  if (type === 'boolean') return 'bool';
  if (type === 'number') return 'f64';
  return type;
}

function isSupportedFieldType(type) {
  return SUPPORTED_TYPES.has(String(type));
}

function isReservedFieldType(type) {
  return RESERVED_TYPES.has(String(type));
}

function isSupportedContentTypePolicy(policy) {
  return CONTENT_TYPE_POLICIES.has(String(policy));
}

function isReservedContentTypePolicy(policy) {
  return RESERVED_CONTENT_TYPE_POLICIES.has(String(policy));
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
  SUPPORTED_TYPES,
  RESERVED_TYPES,
  CONTENT_TYPE_POLICIES,
  RESERVED_CONTENT_TYPE_POLICIES,
  DEFAULT_SCHEMA_JSON_NAMESPACE,
  DEFAULT_SCHEMA_JSON_MAX_BYTES,
  DEFAULT_SCHEMA_JSON_CONTENT_TYPE_POLICY,
  lowerFieldType,
  isSupportedFieldType,
  isReservedFieldType,
  isSupportedContentTypePolicy,
  isReservedContentTypePolicy
};
