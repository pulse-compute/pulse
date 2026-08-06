'use strict';

const { prefixedStableId, sha256Hex, stableStringify } = require('../stable-id.js');

const EVENT_CONTRACT_VERSION = 'pulse.events-contract.v1';
const EVENT_DECLARATION_VERSION = 'pulse.event-declaration.v1';
const EVENT_FRAME_VERSION = 'pulse.event-frame.v1';
const EVENT_CATALOG_VERSION = 'pulse.event-catalog.v1';
const EVENT_ADAPTER_VERSION = 'pulse.event-adapter.v1';
const EVENT_EXECUTION_RESULT_VERSION = 'pulse.event-execution-result.v1';
const EVENT_DIAGNOSTIC_VERSION = 'pulse.events-diagnostics.v1';
const EVENT_NATIVE_ABI_EXTENSION_VERSION = 'pulse.native-event-abi.v1';
const EVENT_CONTRACT_ID = 'pulse.events';

const EVENT_DEFAULT_LIMITS = Object.freeze({
  maxTypeBytes: 128,
  maxSchemaIdBytes: 256,
  maxPayloadBytes: 65_536,
  maxPayloadDepth: 32,
  maxPayloadEntries: 4_096,
  maxEvents: 256,
  maxQueueDepth: 65_536,
  maxErrorBytes: 4_096
});
const EVENT_LIMIT_KEYS = Object.freeze(Object.keys(EVENT_DEFAULT_LIMITS));

const EVENT_DIAGNOSTIC_CODES = Object.freeze({
  LIMIT_INVALID: 'PULSEWASM_EVENTS_LIMIT_INVALID',
  LIMIT_EXCEEDED: 'PULSEWASM_EVENTS_LIMIT_EXCEEDED',
  TYPE_INVALID: 'PULSEWASM_EVENTS_TYPE_INVALID',
  SCHEMA_ID_INVALID: 'PULSEWASM_EVENTS_SCHEMA_ID_INVALID',
  DECLARATION_INVALID: 'PULSEWASM_EVENTS_DECLARATION_INVALID',
  FRAME_INVALID: 'PULSEWASM_EVENTS_FRAME_INVALID',
  PAYLOAD_REQUIRED: 'PULSEWASM_EVENTS_PAYLOAD_REQUIRED',
  PAYLOAD_FORBIDDEN: 'PULSEWASM_EVENTS_PAYLOAD_FORBIDDEN',
  PAYLOAD_INVALID: 'PULSEWASM_EVENTS_PAYLOAD_INVALID',
  CATALOG_INVALID: 'PULSEWASM_EVENTS_CATALOG_INVALID',
  TYPE_DUPLICATE: 'PULSEWASM_EVENTS_TYPE_DUPLICATE',
  ADAPTER_INVALID: 'PULSEWASM_EVENTS_ADAPTER_INVALID',
  EXECUTION_RESULT_INVALID: 'PULSEWASM_EVENTS_EXECUTION_RESULT_INVALID'
});

const EVENT_EXECUTION_STATUS = Object.freeze({
  COMPLETED: 'completed',
  FAILED: 'failed'
});

const EVENT_ADAPTER_SEMANTICS = Object.freeze({
  acceptance: 'host-accepted',
  deliveryGuarantee: 'none',
  autoLoopback: false,
  sameStackReentry: false,
  queueDiscipline: 'fifo-per-declared-adapter',
  executionIsolation: 'one-event-frame-per-execution'
});

const EVENT_COMPLETION_SEMANTICS = Object.freeze({
  handlerResult: 'void',
  completed: 'handler-and-owned-effects-completed',
  failed: 'selection-validation-handler-or-owned-effect-failed',
  responseValue: false,
  providerMetadata: false
});

const EVENT_NATIVE_ABI_EXTENSION = Object.freeze({
  version: EVENT_NATIVE_ABI_EXTENSION_VERSION,
  abiVersion: 1,
  conditional: true,
  baseEntry: 'pulse_start',
  imports: Object.freeze([]),
  exports: Object.freeze([
    Object.freeze({ name: 'pulse_event_abi_version', parameters: Object.freeze([]), result: 'i32' }),
    Object.freeze({ name: 'pulse_event_start', parameters: Object.freeze(['i32', 'i32']), result: 'i32' })
  ]),
  arguments: Object.freeze({
    runtimeId: 'non-negative artifact-local event catalog runtime ID',
    payloadHandle: 'positive host-owned immutable schema-validated value handle; 0 means an explicit no-payload event'
  }),
  startStatus: Object.freeze({
    complete: 0,
    failed: -1,
    invalidStartErrorCode: 1
  }),
  policy: Object.freeze({
    httpOnlyArtifactIdentityUnchanged: true,
    eventImportsAdded: false,
    mixedArtifactsKeepHttpEntry: true,
    hostValidatesFrameAndSchemaBeforeEntry: true,
    singleActiveInvocationPerInstance: true
  })
});

const EVENT_CALL_DISPOSITION = Object.freeze({
  status: 'deferred',
  publicSurfaceReserved: false,
  compilerOpcodeReserved: false,
  runtimeCapabilityReserved: false,
  adapterOperationReserved: false,
  reevaluateAfter: Object.freeze([
    'a real browser Worker host exists',
    'ordinary Entities lifecycle blockers are resolved'
  ])
});

const SCHEMA_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/;
const HANDLER_STABLE_ID_PATTERN = /^handler_[a-f0-9]{24}$/;

function eventContractError(code, message, detail = {}) {
  const error = new TypeError(message);
  error.name = 'EventContractError';
  error.code = code;
  error.detail = Object.freeze({ ...detail });
  return error;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertDataObject(value, field, code) {
  if (!plainObject(value)) throw eventContractError(code, `${field} must be a plain object.`, { field });
  if (Object.getOwnPropertySymbols(value).length > 0) throw eventContractError(code, `${field} must not contain symbol keys.`, { field });
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw eventContractError(code, `${field}.${key} must be an own data property.`, { field, key });
    }
  }
  return value;
}

function assertKnownKeys(value, allowed, field, code) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length > 0) throw eventContractError(code, `${field} contains unsupported fields: ${unknown.join(', ')}.`, { field, unknown });
}

function assertDataArray(value, field, code) {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw eventContractError(code, `${field} must be a data-only array.`, { field });
  }
  if (Object.keys(value).some((key) => !/^(?:0|[1-9][0-9]*)$/.test(key))) {
    throw eventContractError(code, `${field} must not contain named properties.`, { field });
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw eventContractError(code, `${field} must be dense and contain only data properties.`, { field, index });
    }
  }
  return value;
}

function utf8ByteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeEventLimits(input = {}) {
  assertDataObject(input, 'limits', EVENT_DIAGNOSTIC_CODES.LIMIT_INVALID);
  assertKnownKeys(input, EVENT_LIMIT_KEYS, 'limits', EVENT_DIAGNOSTIC_CODES.LIMIT_INVALID);
  const output = {};
  for (const key of EVENT_LIMIT_KEYS) {
    const value = input[key] === undefined ? EVENT_DEFAULT_LIMITS[key] : Number(input[key]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw eventContractError(EVENT_DIAGNOSTIC_CODES.LIMIT_INVALID, `limits.${key} must be a positive safe integer.`, { key, value });
    }
    output[key] = value;
  }
  return Object.freeze(output);
}

function resolvedLimits(input) {
  return input === undefined || input === EVENT_DEFAULT_LIMITS ? EVENT_DEFAULT_LIMITS : normalizeEventLimits(input);
}

function normalizeEventType(value, limitsInput) {
  const limits = resolvedLimits(limitsInput);
  if (typeof value !== 'string' || value.length === 0) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.TYPE_INVALID, 'Event type must be a non-empty string.', { value });
  }
  const bytes = utf8ByteLength(value);
  if (bytes > limits.maxTypeBytes) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.TYPE_INVALID, 'Event type exceeds its UTF-8 byte limit.', { bytes, maxBytes: limits.maxTypeBytes });
  }
  return value;
}

function normalizeEventSchemaId(value, limitsInput) {
  const limits = resolvedLimits(limitsInput);
  if (value === null) return null;
  if (typeof value !== 'string' || !SCHEMA_ID_PATTERN.test(value) || utf8ByteLength(value) > limits.maxSchemaIdBytes) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.SCHEMA_ID_INVALID, 'Event schema ID must be a bounded dotted schema ID or null.', { value });
  }
  return value;
}

function cloneBoundedJson(input, options) {
  const { field, code, maxDepth, maxEntries, maxBytes } = options;
  let entries = 0;
  const ancestors = new Set();

  function visit(value, path, depth) {
    if (depth > maxDepth) throw eventContractError(code, `${field} exceeds its nesting limit.`, { path, depth, maxDepth });
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw eventContractError(code, `${path} must be finite.`, { path });
      return value;
    }
    if (typeof value !== 'object') throw eventContractError(code, `${path} must be JSON data.`, { path, kind: typeof value });
    if (ancestors.has(value)) throw eventContractError(code, `${field} must not contain cycles.`, { path });
    ancestors.add(value);
    let output;
    if (Array.isArray(value)) {
      assertDataArray(value, path, code);
      entries += value.length;
      output = value.map((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
    } else {
      assertDataObject(value, path, code);
      const keys = Object.keys(value).sort();
      entries += keys.length;
      output = Object.fromEntries(keys.map((key) => [key, visit(value[key], `${path}.${key}`, depth + 1)]));
    }
    ancestors.delete(value);
    if (entries > maxEntries) throw eventContractError(code, `${field} exceeds its entry limit.`, { entries, maxEntries });
    return output;
  }

  const normalized = deepFreeze(visit(input, field, 0));
  const bytes = utf8ByteLength(JSON.stringify(normalized));
  if (bytes > maxBytes) throw eventContractError(code, `${field} exceeds its UTF-8 JSON byte limit.`, { bytes, maxBytes });
  return normalized;
}

function normalizeEventDeclaration(input, limitsInput) {
  const limits = resolvedLimits(limitsInput);
  assertDataObject(input, 'declaration', EVENT_DIAGNOSTIC_CODES.DECLARATION_INVALID);
  assertKnownKeys(input, ['schema'], 'declaration', EVENT_DIAGNOSTIC_CODES.DECLARATION_INVALID);
  if (!Object.prototype.hasOwnProperty.call(input, 'schema')) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Event declaration requires an explicit schema field.');
  }
  return Object.freeze({
    version: EVENT_DECLARATION_VERSION,
    schemaId: normalizeEventSchemaId(input.schema, limits)
  });
}

function normalizeEventFrame(input, limitsInput) {
  const limits = resolvedLimits(limitsInput);
  assertDataObject(input, 'frame', EVENT_DIAGNOSTIC_CODES.FRAME_INVALID);
  assertKnownKeys(input, ['version', 'type', 'schemaId', 'payload'], 'frame', EVENT_DIAGNOSTIC_CODES.FRAME_INVALID);
  if (input.version !== EVENT_FRAME_VERSION || !Object.prototype.hasOwnProperty.call(input, 'schemaId')) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.FRAME_INVALID, `Event frame requires ${EVENT_FRAME_VERSION}, type, and schemaId.`);
  }
  const type = normalizeEventType(input.type, limits);
  const schemaId = normalizeEventSchemaId(input.schemaId, limits);
  const hasPayload = Object.prototype.hasOwnProperty.call(input, 'payload');
  if (schemaId === null && hasPayload) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.PAYLOAD_FORBIDDEN, 'No-payload event frames must omit payload.');
  }
  if (schemaId !== null && !hasPayload) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.PAYLOAD_REQUIRED, 'Schema-bound event frames require payload.');
  }
  return deepFreeze({
    version: EVENT_FRAME_VERSION,
    type,
    schemaId,
    ...(hasPayload ? {
      payload: cloneBoundedJson(input.payload, {
        field: 'frame.payload',
        code: EVENT_DIAGNOSTIC_CODES.PAYLOAD_INVALID,
        maxDepth: limits.maxPayloadDepth,
        maxEntries: limits.maxPayloadEntries,
        maxBytes: limits.maxPayloadBytes
      })
    } : {})
  });
}

function createEventStableId(input, limitsInput) {
  assertDataObject(input, 'eventIdentity', EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
  assertKnownKeys(input, ['type', 'schemaId', 'handlerStableId'], 'eventIdentity', EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
  const type = normalizeEventType(input.type, limitsInput);
  const schemaId = normalizeEventSchemaId(input.schemaId, limitsInput);
  const handlerStableId = String(input.handlerStableId || '');
  if (!HANDLER_STABLE_ID_PATTERN.test(handlerStableId)) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, 'Event identity requires a canonical handler stable ID.', { handlerStableId });
  }
  return prefixedStableId('event', {
    artifact: EVENT_CATALOG_VERSION,
    type,
    schemaId,
    handlerStableId
  });
}

function normalizePortableSource(input) {
  assertDataObject(input, 'catalog.event.source', EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
  assertKnownKeys(input, ['file', 'line', 'column'], 'catalog.event.source', EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
  const file = typeof input.file === 'string' ? input.file.replace(/\\/g, '/') : '';
  const line = Number(input.line);
  const column = Number(input.column);
  if (!file || file.startsWith('/') || /^[A-Za-z]:\//.test(file) || file.split('/').includes('..') || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 0) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, 'Event source must be a portable relative file with a one-based line and zero-based column.', { file, line, column });
  }
  return Object.freeze({ file, line, column });
}

function normalizeTextSet(input, field) {
  assertDataArray(input, field, EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
  const values = input.map((value) => {
    if (typeof value !== 'string' || value.length === 0 || utf8ByteLength(value) > 256) {
      throw eventContractError(EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, `${field} entries must be bounded non-empty strings.`, { value });
    }
    return value;
  });
  if (new Set(values).size !== values.length) throw eventContractError(EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, `${field} must not contain duplicates.`);
  return Object.freeze(values.sort());
}

function normalizeEventEligibility(input) {
  assertDataObject(input, 'catalog.event.eligibility', EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
  assertKnownKeys(input, ['javascript', 'native'], 'catalog.event.eligibility', EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
  if (typeof input.javascript !== 'boolean' || typeof input.native !== 'boolean') {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, 'Event eligibility requires explicit JavaScript and Native booleans.');
  }
  return Object.freeze({ javascript: input.javascript, native: input.native });
}

function normalizeEventCatalog(input, limitsInput) {
  const limits = resolvedLimits(limitsInput);
  assertDataObject(input, 'catalog', EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
  assertKnownKeys(input, ['version', 'contractId', 'events'], 'catalog', EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
  if (input.version !== EVENT_CATALOG_VERSION || input.contractId !== EVENT_CONTRACT_ID || !Array.isArray(input.events)) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, `Event catalog requires ${EVENT_CATALOG_VERSION}, ${EVENT_CONTRACT_ID}, and an events array.`);
  }
  assertDataArray(input.events, 'catalog.events', EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
  if (input.events.length > limits.maxEvents) throw eventContractError(EVENT_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, 'Event catalog exceeds its registration limit.', { count: input.events.length, maxEvents: limits.maxEvents });
  const types = new Set();
  const stableIds = new Set();
  const runtimeIds = new Set();
  const events = input.events.map((event, index) => {
    assertDataObject(event, `catalog.events[${index}]`, EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
    assertKnownKeys(event, ['type', 'schemaId', 'stableId', 'runtimeId', 'handlerStableId', 'source', 'capabilities', 'packageOperations', 'eligibility', 'hostRequirements'], `catalog.events[${index}]`, EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID);
    const type = normalizeEventType(event.type, limits);
    if (types.has(type)) throw eventContractError(EVENT_DIAGNOSTIC_CODES.TYPE_DUPLICATE, `Event catalog repeats type ${JSON.stringify(type)}.`, { type });
    types.add(type);
    const schemaId = normalizeEventSchemaId(event.schemaId, limits);
    const handlerStableId = String(event.handlerStableId || '');
    if (!HANDLER_STABLE_ID_PATTERN.test(handlerStableId)) throw eventContractError(EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, 'Catalog event requires a canonical handler stable ID.', { handlerStableId });
    const stableId = createEventStableId({ type, schemaId, handlerStableId }, limits);
    if (event.stableId !== stableId || stableIds.has(stableId)) throw eventContractError(EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, 'Catalog event stable ID does not match its canonical registration identity.', { expected: stableId, actual: event.stableId });
    stableIds.add(stableId);
    const runtimeId = Number(event.runtimeId);
    if (!Number.isSafeInteger(runtimeId) || runtimeId < 0 || runtimeId >= input.events.length || runtimeIds.has(runtimeId)) {
      throw eventContractError(EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, 'Catalog event runtime IDs must be unique contiguous non-negative integers.', { runtimeId });
    }
    runtimeIds.add(runtimeId);
    return Object.freeze({
      type,
      schemaId,
      stableId,
      runtimeId,
      handlerStableId,
      source: normalizePortableSource(event.source),
      capabilities: normalizeTextSet(event.capabilities, 'catalog.event.capabilities'),
      packageOperations: normalizeTextSet(event.packageOperations, 'catalog.event.packageOperations'),
      eligibility: normalizeEventEligibility(event.eligibility),
      hostRequirements: normalizeTextSet(event.hostRequirements, 'catalog.event.hostRequirements')
    });
  }).sort((left, right) => left.runtimeId - right.runtimeId);
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].runtimeId !== index) throw eventContractError(EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, 'Catalog event runtime IDs must form a contiguous source-order sequence.', { expected: index, actual: events[index].runtimeId });
  }
  const normalized = Object.freeze({ version: EVENT_CATALOG_VERSION, contractId: EVENT_CONTRACT_ID, events: Object.freeze(events) });
  return Object.freeze({ ...normalized, catalogHash: sha256Hex(stableStringify(normalized)) });
}

function normalizeEventAdapter(input, limitsInput) {
  const limits = resolvedLimits(limitsInput);
  assertDataObject(input, 'adapter', EVENT_DIAGNOSTIC_CODES.ADAPTER_INVALID);
  assertKnownKeys(input, ['version', 'id', 'maxQueueDepth', 'semantics'], 'adapter', EVENT_DIAGNOSTIC_CODES.ADAPTER_INVALID);
  const id = typeof input.id === 'string' ? input.id : '';
  const maxQueueDepth = Number(input.maxQueueDepth);
  if (input.version !== EVENT_ADAPTER_VERSION || !id || utf8ByteLength(id) > 128 || !Number.isSafeInteger(maxQueueDepth) || maxQueueDepth <= 0 || maxQueueDepth > limits.maxQueueDepth) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.ADAPTER_INVALID, 'Event adapter requires a bounded ID and finite queue bound.', { id, maxQueueDepth });
  }
  assertDataObject(input.semantics, 'adapter.semantics', EVENT_DIAGNOSTIC_CODES.ADAPTER_INVALID);
  assertKnownKeys(input.semantics, Object.keys(EVENT_ADAPTER_SEMANTICS), 'adapter.semantics', EVENT_DIAGNOSTIC_CODES.ADAPTER_INVALID);
  if (Object.keys(EVENT_ADAPTER_SEMANTICS).some((key) => input.semantics[key] !== EVENT_ADAPTER_SEMANTICS[key])) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.ADAPTER_INVALID, 'Event adapter semantics must match the canonical host-acceptance contract.');
  }
  return deepFreeze({ version: EVENT_ADAPTER_VERSION, id, maxQueueDepth, semantics: EVENT_ADAPTER_SEMANTICS });
}

function normalizeEventExecutionResult(input, limitsInput) {
  const limits = resolvedLimits(limitsInput);
  assertDataObject(input, 'executionResult', EVENT_DIAGNOSTIC_CODES.EXECUTION_RESULT_INVALID);
  assertKnownKeys(input, ['version', 'status', 'error'], 'executionResult', EVENT_DIAGNOSTIC_CODES.EXECUTION_RESULT_INVALID);
  if (input.version !== EVENT_EXECUTION_RESULT_VERSION || !Object.values(EVENT_EXECUTION_STATUS).includes(input.status)) {
    throw eventContractError(EVENT_DIAGNOSTIC_CODES.EXECUTION_RESULT_INVALID, `Event execution result requires ${EVENT_EXECUTION_RESULT_VERSION} and a supported status.`);
  }
  const hasError = Object.prototype.hasOwnProperty.call(input, 'error');
  if (input.status === EVENT_EXECUTION_STATUS.COMPLETED && hasError) throw eventContractError(EVENT_DIAGNOSTIC_CODES.EXECUTION_RESULT_INVALID, 'Completed event execution must not include an error.');
  if (input.status === EVENT_EXECUTION_STATUS.FAILED && !hasError) throw eventContractError(EVENT_DIAGNOSTIC_CODES.EXECUTION_RESULT_INVALID, 'Failed event execution requires an error.');
  return deepFreeze({
    version: EVENT_EXECUTION_RESULT_VERSION,
    status: input.status,
    ...(hasError ? {
      error: cloneBoundedJson(input.error, {
        field: 'executionResult.error',
        code: EVENT_DIAGNOSTIC_CODES.EXECUTION_RESULT_INVALID,
        maxDepth: limits.maxPayloadDepth,
        maxEntries: limits.maxPayloadEntries,
        maxBytes: limits.maxErrorBytes
      })
    } : {})
  });
}

module.exports = Object.freeze({
  EVENT_CONTRACT_VERSION,
  EVENT_DECLARATION_VERSION,
  EVENT_FRAME_VERSION,
  EVENT_CATALOG_VERSION,
  EVENT_ADAPTER_VERSION,
  EVENT_EXECUTION_RESULT_VERSION,
  EVENT_DIAGNOSTIC_VERSION,
  EVENT_NATIVE_ABI_EXTENSION_VERSION,
  EVENT_CONTRACT_ID,
  EVENT_DEFAULT_LIMITS,
  EVENT_LIMIT_KEYS,
  EVENT_DIAGNOSTIC_CODES,
  EVENT_EXECUTION_STATUS,
  EVENT_ADAPTER_SEMANTICS,
  EVENT_COMPLETION_SEMANTICS,
  EVENT_NATIVE_ABI_EXTENSION,
  EVENT_CALL_DISPOSITION,
  eventContractError,
  utf8ByteLength,
  normalizeEventLimits,
  normalizeEventType,
  normalizeEventSchemaId,
  normalizeEventDeclaration,
  normalizeEventFrame,
  createEventStableId,
  normalizeEventCatalog,
  normalizeEventAdapter,
  normalizeEventExecutionResult
});
