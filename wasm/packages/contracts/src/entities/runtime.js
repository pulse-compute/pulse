'use strict';

const ENTITIES_ADAPTER_VERSION = 'pulse.entities-adapter.v1';
const ENTITIES_FAILURE_VERSION = 'pulse.entities-failure.v1';
const ENTITIES_JSON_RPC_ADAPTER_VERSION = 'pulse.entities-json-rpc-adapter.v1';
const ENTITIES_JSON_RPC_OPTIONS = Object.freeze({
  namedParamsOnly: true,
  acceptEmptyObjectForNoInput: false
});
const ENTITIES_DEFAULT_LIMITS = Object.freeze({
  maxEnvelopeBytes: 65_536,
  maxPayloadBytes: 32_768,
  maxMethodBytes: 256,
  maxEntities: 256,
  maxMetadataBytesPerEntity: 4_096,
  maxMetadataBytesPerRouter: 65_536,
  maxMetadataDepth: 8,
  maxMetadataEntries: 128,
  maxJsonDepth: 32,
  maxOutputBytes: 65_536,
  maxErrorMessageBytes: 256
});
const ENTITIES_LIMIT_KEYS = Object.freeze(Object.keys(ENTITIES_DEFAULT_LIMITS));
const ENTITIES_FAILURE_KINDS = Object.freeze([
  'invalid-envelope',
  'unknown-entity',
  'invalid-input',
  'execution-failed',
  'invalid-output',
  'input-too-large',
  'output-too-large',
  'adapter-failed',
  'runtime-not-realized'
]);
const ENTITIES_FAILURE_CODES = Object.freeze({
  'invalid-envelope': 'PULSE_ENTITIES_INVALID_ENVELOPE',
  'unknown-entity': 'PULSE_ENTITIES_UNKNOWN_ENTITY',
  'invalid-input': 'PULSE_ENTITIES_INPUT_INVALID',
  'execution-failed': 'PULSE_ENTITIES_EXECUTION_FAILED',
  'invalid-output': 'PULSE_ENTITIES_OUTPUT_INVALID',
  'input-too-large': 'PULSE_ENTITIES_INPUT_TOO_LARGE',
  'output-too-large': 'PULSE_ENTITIES_OUTPUT_TOO_LARGE',
  'adapter-failed': 'PULSE_ENTITIES_ADAPTER_FAILED',
  'runtime-not-realized': 'PULSE_ENTITIES_RUNTIME_NOT_REALIZED'
});
const ENTITIES_DIAGNOSTIC_CODES = Object.freeze({
  ADAPTER_STATIC_REQUIRED: 'PULSE_ENTITIES_ADAPTER_STATIC_REQUIRED',
  ADAPTER_UNSUPPORTED: 'PULSE_ENTITIES_ADAPTER_UNSUPPORTED',
  ADAPTER_OPTIONS_INVALID: 'PULSE_ENTITIES_ADAPTER_OPTIONS_INVALID',
  DISCRIMINATOR_STATIC_REQUIRED: 'PULSE_ENTITIES_DISCRIMINATOR_STATIC_REQUIRED',
  DISCRIMINATOR_INVALID: 'PULSE_ENTITIES_DISCRIMINATOR_INVALID',
  DISCRIMINATOR_DUPLICATE: 'PULSE_ENTITIES_DISCRIMINATOR_DUPLICATE',
  SCHEMA_MISSING: 'PULSE_ENTITIES_SCHEMA_MISSING',
  SCHEMA_ID_INVALID: 'PULSE_ENTITIES_SCHEMA_ID_INVALID',
  DECLARATION_INVALID: 'PULSE_ENTITIES_DECLARATION_INVALID',
  HANDLER_UNRESOLVED: 'PULSE_ENTITIES_HANDLER_UNRESOLVED',
  HANDLER_INVALID: 'PULSE_ENTITIES_HANDLER_INVALID',
  METADATA_INVALID: 'PULSE_ENTITIES_METADATA_INVALID',
  LIMIT_INVALID: 'PULSE_ENTITIES_LIMIT_INVALID',
  LIMIT_EXCEEDED: 'PULSE_ENTITIES_LIMIT_EXCEEDED',
  REGISTRATION_UNSUPPORTED: 'PULSE_ENTITIES_REGISTRATION_UNSUPPORTED',
  BINDING_UNSUPPORTED: 'PULSE_ENTITIES_BINDING_UNSUPPORTED',
  BODY_CONSUMER_CONFLICT: 'PULSE_ENTITIES_BODY_CONSUMER_CONFLICT',
  TARGET_INELIGIBLE: 'PULSE_ENTITIES_TARGET_INELIGIBLE'
});
const SCHEMA_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/;

function entitiesContractError(code, message, detail = {}) {
  const error = new TypeError(message);
  error.name = 'EntitiesContractError';
  error.code = code;
  error.detail = Object.freeze({ ...detail });
  return error;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertDataObject(value, field, code = ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID) {
  if (!plainObject(value)) throw entitiesContractError(code, `${field} must be a plain object.`, { field });
  if (Object.getOwnPropertySymbols(value).length > 0) throw entitiesContractError(code, `${field} must not contain symbol keys.`, { field });
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw entitiesContractError(code, `${field}.${key} must be an own data property.`, { field, key });
    }
  }
  return value;
}

function assertKnownKeys(value, allowed, field, code = ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length > 0) throw entitiesContractError(code, `${field} contains unsupported fields: ${unknown.join(', ')}.`, { field, unknown });
}

function utf8ByteLength(value) {
  const text = String(value);
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const point = text.codePointAt(index);
    if (point <= 0x7f) bytes += 1;
    else if (point <= 0x7ff) bytes += 2;
    else if (point <= 0xffff) bytes += 3;
    else {
      bytes += 4;
      index += 1;
    }
  }
  return bytes;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeEntityLimits(input = {}) {
  assertDataObject(input, 'limits', ENTITIES_DIAGNOSTIC_CODES.LIMIT_INVALID);
  assertKnownKeys(input, ENTITIES_LIMIT_KEYS, 'limits', ENTITIES_DIAGNOSTIC_CODES.LIMIT_INVALID);
  const output = {};
  for (const name of ENTITIES_LIMIT_KEYS) {
    const value = input[name] === undefined ? ENTITIES_DEFAULT_LIMITS[name] : Number(input[name]);
    if (!Number.isSafeInteger(value) || value <= 0) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.LIMIT_INVALID, `limits.${name} must be a positive safe integer.`, { name, value });
    output[name] = value;
  }
  if (output.maxPayloadBytes > output.maxEnvelopeBytes) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.LIMIT_INVALID, 'maxPayloadBytes cannot exceed maxEnvelopeBytes.');
  if (output.maxMetadataBytesPerEntity > output.maxMetadataBytesPerRouter) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.LIMIT_INVALID, 'Per-entity metadata bytes cannot exceed the router metadata limit.');
  return Object.freeze(output);
}

function normalizeDiscriminator(value, limitsInput = ENTITIES_DEFAULT_LIMITS) {
  const limits = limitsInput === ENTITIES_DEFAULT_LIMITS ? limitsInput : normalizeEntityLimits(limitsInput);
  if (typeof value !== 'string' || value.trim() === '') throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DISCRIMINATOR_INVALID, 'Entity discriminator must be a non-empty string.', { value });
  const bytes = utf8ByteLength(value);
  if (bytes > limits.maxMethodBytes) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DISCRIMINATOR_INVALID, 'Entity discriminator exceeds its UTF-8 byte limit.', { bytes, maxBytes: limits.maxMethodBytes });
  return value;
}

function normalizeSchemaId(value, field = 'schemaId') {
  if (value === null) return null;
  if (typeof value !== 'string' || !SCHEMA_ID_PATTERN.test(value)) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.SCHEMA_ID_INVALID, `${field} must be a dotted schema ID or null.`, { field, value });
  return value;
}

function normalizeStaticMetadata(input, limitsInput = ENTITIES_DEFAULT_LIMITS) {
  if (input === undefined) return undefined;
  const limits = limitsInput === ENTITIES_DEFAULT_LIMITS ? limitsInput : normalizeEntityLimits(limitsInput);
  let entries = 0;
  const ancestors = new Set();
  function visit(value, field, depth) {
    if (depth > limits.maxMetadataDepth) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.METADATA_INVALID, 'Entity metadata exceeds its nesting limit.', { field, depth, maxDepth: limits.maxMetadataDepth });
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.METADATA_INVALID, `${field} must be finite.`, { field });
      return value;
    }
    if (typeof value !== 'object') throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.METADATA_INVALID, `${field} must be static JSON.`, { field, kind: typeof value });
    if (ancestors.has(value)) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.METADATA_INVALID, 'Entity metadata must not contain cycles.', { field });
    ancestors.add(value);
    let output;
    if (Array.isArray(value)) {
      entries += value.length;
      output = value.map((entry, index) => visit(entry, `${field}[${index}]`, depth + 1));
    } else {
      assertDataObject(value, field, ENTITIES_DIAGNOSTIC_CODES.METADATA_INVALID);
      const keys = Object.keys(value).sort();
      entries += keys.length;
      output = Object.fromEntries(keys.map((key) => [key, visit(value[key], `${field}.${key}`, depth + 1)]));
    }
    ancestors.delete(value);
    if (entries > limits.maxMetadataEntries) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.METADATA_INVALID, 'Entity metadata exceeds its entry limit.', { entries, maxEntries: limits.maxMetadataEntries });
    return output;
  }
  if (!plainObject(input)) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.METADATA_INVALID, 'Entity metadata root must be a plain object.');
  const normalized = deepFreeze(visit(input, 'metadata', 0));
  const bytes = utf8ByteLength(JSON.stringify(normalized));
  if (bytes > limits.maxMetadataBytesPerEntity) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.METADATA_INVALID, 'Entity metadata exceeds its byte limit.', { bytes, maxBytes: limits.maxMetadataBytesPerEntity });
  return normalized;
}

function normalizeEntityDeclaration(input, limitsInput = ENTITIES_DEFAULT_LIMITS) {
  const limits = limitsInput === ENTITIES_DEFAULT_LIMITS ? limitsInput : normalizeEntityLimits(limitsInput);
  assertDataObject(input, 'declaration');
  assertKnownKeys(input, ['input', 'output', 'metadata'], 'declaration');
  if (!Object.prototype.hasOwnProperty.call(input, 'input') || !Object.prototype.hasOwnProperty.call(input, 'output')) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Entity declaration requires explicit input and output fields.');
  return Object.freeze({
    input: normalizeSchemaId(input.input, 'declaration.input'),
    output: normalizeSchemaId(input.output, 'declaration.output'),
    ...(input.metadata === undefined ? {} : { metadata: normalizeStaticMetadata(input.metadata, limits) })
  });
}

function normalizeHandler(handler) {
  if (typeof handler !== 'function' || typeof handler.name !== 'string' || handler.name.trim() === '') throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.HANDLER_INVALID, 'Entity handler must be a named function reference.');
  return handler;
}

function normalizeJsonRpcAdapterOptions(input = {}) {
  assertDataObject(input, 'adapter.options', ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID);
  assertKnownKeys(input, Object.keys(ENTITIES_JSON_RPC_OPTIONS), 'adapter.options', ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID);
  const namedParamsOnly = input.namedParamsOnly === undefined ? true : input.namedParamsOnly;
  const acceptEmptyObjectForNoInput = input.acceptEmptyObjectForNoInput === undefined ? false : input.acceptEmptyObjectForNoInput;
  if (namedParamsOnly !== true) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID, 'jsonRpc namedParamsOnly must remain true in the first contract.');
  if (typeof acceptEmptyObjectForNoInput !== 'boolean') throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID, 'jsonRpc acceptEmptyObjectForNoInput must be boolean.');
  return Object.freeze({ namedParamsOnly: true, acceptEmptyObjectForNoInput });
}

function normalizeAdapter(input, limitsInput = ENTITIES_DEFAULT_LIMITS) {
  const limits = limitsInput === ENTITIES_DEFAULT_LIMITS ? limitsInput : normalizeEntityLimits(limitsInput);
  assertDataObject(input, 'adapter', ENTITIES_DIAGNOSTIC_CODES.ADAPTER_STATIC_REQUIRED);
  assertKnownKeys(input, ['version', 'id', 'adapterVersion', 'options', 'limits'], 'adapter', ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID);
  if (input.version !== ENTITIES_ADAPTER_VERSION || input.id !== 'json-rpc' || input.adapterVersion !== ENTITIES_JSON_RPC_ADAPTER_VERSION) {
    throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.ADAPTER_UNSUPPORTED, 'Only the first-party json-rpc adapter is supported.', { version: input.version, id: input.id, adapterVersion: input.adapterVersion });
  }
  return deepFreeze({
    version: ENTITIES_ADAPTER_VERSION,
    id: 'json-rpc',
    adapterVersion: ENTITIES_JSON_RPC_ADAPTER_VERSION,
    options: normalizeJsonRpcAdapterOptions(input.options),
    limits: input.limits === undefined ? limits : normalizeEntityLimits(input.limits)
  });
}

function createJsonRpcAdapter(options = {}, limitsInput = ENTITIES_DEFAULT_LIMITS) {
  return Object.freeze({
    version: ENTITIES_ADAPTER_VERSION,
    id: 'json-rpc',
    adapterVersion: ENTITIES_JSON_RPC_ADAPTER_VERSION,
    options: normalizeJsonRpcAdapterOptions(options),
    limits: limitsInput === ENTITIES_DEFAULT_LIMITS ? ENTITIES_DEFAULT_LIMITS : normalizeEntityLimits(limitsInput)
  });
}

function normalizeEntityRegistration(input, limitsInput = ENTITIES_DEFAULT_LIMITS) {
  const limits = limitsInput === ENTITIES_DEFAULT_LIMITS ? limitsInput : normalizeEntityLimits(limitsInput);
  assertDataObject(input, 'registration');
  assertKnownKeys(input, ['discriminator', 'declaration', 'handler'], 'registration');
  return Object.freeze({
    discriminator: normalizeDiscriminator(input.discriminator, limits),
    declaration: normalizeEntityDeclaration(input.declaration, limits),
    handler: normalizeHandler(input.handler)
  });
}

function normalizeEntityFailure(input, limitsInput = ENTITIES_DEFAULT_LIMITS) {
  const limits = limitsInput === ENTITIES_DEFAULT_LIMITS ? limitsInput : normalizeEntityLimits(limitsInput);
  assertDataObject(input, 'failure');
  assertKnownKeys(input, ['version', 'kind', 'message'], 'failure');
  const kind = String(input.kind || '');
  if (!ENTITIES_FAILURE_KINDS.includes(kind)) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `Unsupported Entities failure kind ${kind}.`, { kind });
  const message = String(input.message || 'Entity operation failed.');
  if (utf8ByteLength(message) > limits.maxErrorMessageBytes) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, 'Entities failure message exceeds its byte limit.');
  return Object.freeze({ version: ENTITIES_FAILURE_VERSION, kind, code: ENTITIES_FAILURE_CODES[kind], message });
}

module.exports = Object.freeze({
  ENTITIES_ADAPTER_VERSION,
  ENTITIES_FAILURE_VERSION,
  ENTITIES_JSON_RPC_ADAPTER_VERSION,
  ENTITIES_JSON_RPC_OPTIONS,
  ENTITIES_DEFAULT_LIMITS,
  ENTITIES_LIMIT_KEYS,
  ENTITIES_FAILURE_KINDS,
  ENTITIES_FAILURE_CODES,
  ENTITIES_DIAGNOSTIC_CODES,
  entitiesContractError,
  utf8ByteLength,
  compareText,
  normalizeEntityLimits,
  normalizeDiscriminator,
  normalizeSchemaId,
  normalizeStaticMetadata,
  normalizeEntityDeclaration,
  normalizeHandler,
  normalizeJsonRpcAdapterOptions,
  normalizeAdapter,
  createJsonRpcAdapter,
  normalizeEntityRegistration,
  normalizeEntityFailure
});
