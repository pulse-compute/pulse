'use strict';

const { sha256Hex, stableStringify } = require('../stable-id.js');
const { SCHEMA_ID_PATTERN, RESPONSE_CASE_ID_PATTERN } = require('./registry.js');

const JSON_SEMANTIC_TRACE_VERSION = 'pulse.json-semantic-trace.v1';
const JSON_TRACE_EVENT_KINDS = Object.freeze([
  'json.decode.request',
  'json.decode.fetch',
  'json.encode.response',
  'json.encode.fetch',
  'json.decode.error',
  'json.encode.error'
]);
const JSON_BOUNDARIES = Object.freeze(['request', 'fetch-response', 'application-response', 'fetch-request']);
const JSON_BODY_OWNERSHIP = Object.freeze([
  'request-snapshot',
  'fetched-response-snapshot',
  'application-owned',
  'host-owned-opaque'
]);
const JSON_EVENT_BOUNDARIES = Object.freeze({
  'json.decode.request': Object.freeze(['request']),
  'json.decode.fetch': Object.freeze(['fetch-response']),
  'json.encode.response': Object.freeze(['application-response']),
  'json.encode.fetch': Object.freeze(['fetch-request']),
  'json.decode.error': Object.freeze(['request', 'fetch-response']),
  'json.encode.error': Object.freeze(['application-response', 'fetch-request'])
});

function traceError(code, message, details = {}) {
  const error = new TypeError(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function normalizeText(value) {
  return String(value).normalize('NFC');
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeSemanticValue(value, options = {}, path = '') {
  const redacted = typeof options.redact === 'function' ? options.redact(value, path) : value;
  if (redacted !== value) return normalizeSemanticValue(redacted, { ...options, redact: undefined }, path);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return normalizeText(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw traceError('PULSE_JSON_TRACE_NUMBER_NONFINITE', 'Semantic trace values must contain only finite RFC JSON numbers.', {
        path,
        value: String(value)
      });
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => normalizeSemanticValue(entry, options, `${path}/${index}`)));
  }
  if (plainObject(value)) {
    const out = {};
    const normalizedKeys = new Set();
    for (const key of Object.keys(value).sort()) {
      const normalizedKey = normalizeText(key);
      if (normalizedKeys.has(normalizedKey)) {
        throw traceError(
          'PULSE_JSON_TRACE_KEY_NORMALIZATION_COLLISION',
          `Semantic trace object keys collide after NFC normalization at ${path || '/'}.`,
          { path, key: normalizedKey }
        );
      }
      normalizedKeys.add(normalizedKey);
      const pointerKey = normalizedKey.replace(/~/g, '~0').replace(/\//g, '~1');
      out[normalizedKey] = normalizeSemanticValue(value[key], options, `${path}/${pointerKey}`);
    }
    return Object.freeze(out);
  }
  throw traceError('PULSE_JSON_TRACE_VALUE_UNSUPPORTED', `Semantic trace values cannot contain ${typeof value}.`, {
    path,
    valueType: typeof value
  });
}

function semanticValueDigest(value, options = {}) {
  return sha256Hex(stableStringify(normalizeSemanticValue(value, options)));
}

function normalizeHeaderPairs(input) {
  const entries = input == null
    ? []
    : (Array.isArray(input) ? input : Object.entries(input));
  return Object.freeze(entries.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      throw traceError('PULSE_JSON_TRACE_HEADERS_INVALID', `headers[${index}] must be a name/value pair.`, { index });
    }
    return Object.freeze([
      normalizeText(entry[0]).trim().toLowerCase(),
      normalizeText(entry[1]).trim().replace(/[ \t]+/g, ' ')
    ]);
  }).sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1])));
}

function normalizeJsonPointer(input) {
  if (input === undefined || input === null || input === '') return null;
  if (Array.isArray(input)) {
    return `/${input.map((segment) => normalizeText(segment).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
  }
  const value = normalizeText(input);
  if (!value.startsWith('/') || /~(?![01])/u.test(value)) {
    throw traceError('PULSE_JSON_TRACE_POINTER_INVALID', 'errorPath must be a valid JSON Pointer.', { errorPath: value });
  }
  return value;
}

function optionalId(value, pattern, field, code) {
  if (value === undefined || value === null) return null;
  const id = normalizeText(value).trim();
  if (!pattern.test(id)) throw traceError(code, `${field} must be a stable dotted identifier.`, { field, id });
  return id;
}

function normalizeJsonTraceEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw traceError('PULSE_JSON_TRACE_EVENT_REQUIRED', 'JSON semantic trace event must be an object.');
  }
  const kind = normalizeText(input.kind || '');
  if (!JSON_TRACE_EVENT_KINDS.includes(kind)) {
    throw traceError('PULSE_JSON_TRACE_EVENT_KIND_INVALID', `Unsupported JSON trace event kind ${kind}.`, { kind });
  }
  const boundary = normalizeText(input.boundary || '');
  if (!JSON_BOUNDARIES.includes(boundary)) {
    throw traceError('PULSE_JSON_TRACE_BOUNDARY_INVALID', `Unsupported JSON trace boundary ${boundary}.`, { boundary });
  }
  if (!JSON_EVENT_BOUNDARIES[kind].includes(boundary)) {
    throw traceError(
      'PULSE_JSON_TRACE_EVENT_BOUNDARY_MISMATCH',
      `${kind} cannot be emitted for the ${boundary} boundary.`,
      { kind, boundary, allowed: JSON_EVENT_BOUNDARIES[kind] }
    );
  }
  const bodyOwnership = normalizeText(input.bodyOwnership || '');
  if (!JSON_BODY_OWNERSHIP.includes(bodyOwnership)) {
    throw traceError('PULSE_JSON_TRACE_BODY_OWNERSHIP_INVALID', `Unsupported JSON body ownership ${bodyOwnership}.`, {
      bodyOwnership
    });
  }
  const operationId = normalizeText(input.operationId || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(operationId)) {
    throw traceError('PULSE_JSON_TRACE_OPERATION_ID_INVALID', 'operationId must be deterministic and identifier-safe.', { operationId });
  }
  const status = input.status === undefined || input.status === null ? null : Number(input.status);
  if (status !== null && (!Number.isSafeInteger(status) || status < 100 || status > 599)) {
    throw traceError('PULSE_JSON_TRACE_STATUS_INVALID', 'status must be null or an integer from 100 through 599.', { status });
  }
  const schemaId = optionalId(input.schemaId, SCHEMA_ID_PATTERN, 'schemaId', 'PULSE_SCHEMA_ID_INVALID');
  const responseCaseId = optionalId(input.responseCaseId, RESPONSE_CASE_ID_PATTERN, 'responseCaseId', 'PULSE_RESPONSE_CASE_ID_INVALID');
  const contentType = input.contentType === undefined || input.contentType === null
    ? null
    : normalizeText(input.contentType).trim().toLowerCase().replace(/[ \t]+/g, ' ');
  const event = {
    version: JSON_SEMANTIC_TRACE_VERSION,
    kind,
    boundary,
    schemaId,
    responseCaseId,
    operationId,
    status,
    contentType,
    headers: normalizeHeaderPairs(input.headers),
    bodyOwnership,
    valueDigest: input.valueDigest === undefined || input.valueDigest === null
      ? null
      : normalizeText(input.valueDigest).toLowerCase(),
    errorCode: input.errorCode === undefined || input.errorCode === null ? null : normalizeText(input.errorCode),
    errorPath: normalizeJsonPointer(input.errorPath),
    expected: input.expected === undefined || input.expected === null ? null : normalizeText(input.expected),
    actualKind: input.actualKind === undefined || input.actualKind === null ? null : normalizeText(input.actualKind),
    target: input.target === undefined || input.target === null ? null : normalizeText(input.target),
    provider: input.provider === undefined || input.provider === null ? null : normalizeText(input.provider),
    effectId: input.effectId === undefined || input.effectId === null ? null : normalizeText(input.effectId),
    groupId: input.groupId === undefined || input.groupId === null ? null : normalizeText(input.groupId)
  };
  if (event.valueDigest !== null && !/^[0-9a-f]{64}$/.test(event.valueDigest)) {
    throw traceError('PULSE_JSON_TRACE_DIGEST_INVALID', 'valueDigest must be a lowercase SHA-256 hex digest.', {
      valueDigest: event.valueDigest
    });
  }
  const isError = kind.endsWith('.error');
  if (isError && !event.errorCode) {
    throw traceError('PULSE_JSON_TRACE_ERROR_CODE_REQUIRED', `${kind} requires errorCode.`, { kind });
  }
  if (!isError && event.errorCode) {
    throw traceError('PULSE_JSON_TRACE_ERROR_CODE_UNEXPECTED', `${kind} cannot carry errorCode.`, { kind });
  }
  return Object.freeze({
    ...event,
    eventDigest: sha256Hex(stableStringify(event))
  });
}

function operationIdentity(input) {
  const semantic = normalizeSemanticValue(input);
  return `jsonop:${sha256Hex(stableStringify(semantic)).slice(0, 24)}`;
}

function defaultJsonSemanticTraceContract() {
  return Object.freeze({
    version: JSON_SEMANTIC_TRACE_VERSION,
    eventKinds: JSON_TRACE_EVENT_KINDS,
    boundaries: JSON_BOUNDARIES,
    eventBoundaries: JSON_EVENT_BOUNDARIES,
    bodyOwnership: JSON_BODY_OWNERSHIP,
    digest: 'sha256(canonical-redacted-semantic-value)',
    stringNormalization: 'NFC',
    numberNormalization: 'finite; negative-zero becomes zero',
    headerNormalization: 'lowercase-name; collapsed-ows-value; sorted-pairs',
    errorPath: 'RFC-6901 JSON Pointer',
    parity: 'semantic-not-byte',
    rawSensitiveValuesAllowed: false
  });
}

module.exports = Object.freeze({
  JSON_SEMANTIC_TRACE_VERSION,
  JSON_TRACE_EVENT_KINDS,
  JSON_BOUNDARIES,
  JSON_BODY_OWNERSHIP,
  JSON_EVENT_BOUNDARIES,
  normalizeSemanticValue,
  semanticValueDigest,
  normalizeHeaderPairs,
  normalizeJsonPointer,
  normalizeJsonTraceEvent,
  operationIdentity,
  defaultJsonSemanticTraceContract
});
