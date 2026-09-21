'use strict';
const { createEffectInvocations, normalizeMaxEffects } = require('./effect-invocations.js');
const portableKv = require('@pulse-compute/runtime/host');


function loadRuntimeApi() {
  try { return require('@pulse-compute/wasm-contracts/handler/runtime-api'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/handler/runtime-api.js');
    throw error;
  }
}

function loadCanonicalRuntimeContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-runtime'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/handler/canonical-runtime.js');
    throw error;
  }
}

function loadStreamingContract() {
  try { return require('@pulse-compute/wasm-contracts/host/streaming-passthrough'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/host/streaming-passthrough.js');
    throw error;
  }
}

function loadContinuationRegistry() {
  try { return require('@pulse-compute/wasm-host-runtime/runtime/continuation-registry'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../host-runtime/src/runtime/continuation-registry.js');
    throw error;
  }
}

function loadJsonSemanticTraceContract() {
  try { return require('@pulse-compute/wasm-contracts/schema-json/semantic-trace'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/schema-json/semantic-trace.js');
    throw error;
  }
}

function loadLoggingContract() {
  try { return require('@pulse-compute/wasm-contracts/logging'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/logging.js');
    throw error;
  }
}

function loadEventContract() {
  try { return require('@pulse-compute/wasm-contracts/events'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/events/contracts.js');
    throw error;
  }
}

const runtimeApi = loadRuntimeApi();
const canonicalRuntimeContract = loadCanonicalRuntimeContract();
const streamingContract = loadStreamingContract();
const { createContinuationRegistry } = loadContinuationRegistry();
const jsonSemanticTrace = loadJsonSemanticTraceContract();
const loggingContract = loadLoggingContract();
const eventContract = loadEventContract();

const CANONICAL_HOST_RUNTIME_VERSION = 'pulse.canonical-host-runtime.v1';
const REDACTED_VALUE = '<redacted>';
const CIRCULAR_VALUE = '<cycle>';
const BINARY_VALUE = '<binary>';
const BOUNDED_VALUE = '<bounded>';
const ACCESSOR_VALUE = '<accessor>';
const MAX_REDACTION_DEPTH = 32;
const MAX_REDACTION_ENTRIES = 1024;
const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'cookie', 'set-cookie']);
const SENSITIVE_FIELDS = new Set([
  ...SENSITIVE_HEADERS,
  'api-key', 'apikey', 'credential', 'credentials', 'password', 'secret', 'token'
]);
let executionSequence = 0;

class CanonicalRuntimeError extends Error {
  constructor(name, code, message, detail = {}) {
    super(message);
    this.name = name;
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function assertCanonicalProgramCompatibility(programModule) {
  const metadata = programModule && programModule.metadata;
  const actualProgramVersion = programModule && programModule.version;
  const actualMetadataVersion = metadata && metadata.version;
  const actualProtocolVersion = metadata && metadata.runtimeProtocolVersion;
  const expectedProgramVersion = canonicalRuntimeContract.CANONICAL_PROGRAM_VERSION;
  const expectedProtocolVersion = canonicalRuntimeContract.CANONICAL_RUNTIME_PROTOCOL_VERSION;
  if (actualProgramVersion !== expectedProgramVersion || actualMetadataVersion !== expectedProgramVersion || actualProtocolVersion !== expectedProtocolVersion) {
    throw new CanonicalRuntimeError(
      'CanonicalProgramCompatibilityError',
      'PULSE_CANONICAL_PROGRAM_INCOMPATIBLE',
      'Canonical program and runtime protocol versions are incompatible.',
      {
        expectedProgramVersion,
        actualProgramVersion,
        actualMetadataVersion,
        expectedProtocolVersion,
        actualProtocolVersion
      }
    );
  }
  const schemaIds = metadata && Array.isArray(metadata.schemaIds) ? metadata.schemaIds : [];
  const schemaCodecs = programModule && programModule.schemaCodecs;
  if (schemaIds.length > 0 && (!schemaCodecs || typeof schemaCodecs.decode !== 'function' || typeof schemaCodecs.encode !== 'function')) {
    throw new CanonicalRuntimeError(
      'CanonicalSchemaCompatibilityError',
      'PULSE_CANONICAL_SCHEMA_CODECS_MISSING',
      'Canonical program declares schemas but does not export its compiled schema codecs.',
      { schemaIds }
    );
  }
  return metadata;
}

function normalizeHeaders(headers) {
  return runtimeApi.body.normalizeHeaders(headers).map(([name, value]) => [String(name), String(value)]);
}

function headerValue(headers, name) {
  return runtimeApi.body.headerValue(headers, name);
}

function isSensitiveField(value) {
  const key = String(value || '').toLowerCase();
  if (SENSITIVE_FIELDS.has(key)) return true;
  const compact = key.replace(/[^a-z0-9]/g, '');
  return compact.endsWith('token')
    || compact.endsWith('secret')
    || compact.endsWith('password')
    || compact.endsWith('credential')
    || compact.endsWith('credentials')
    || compact.endsWith('apikey');
}

function ownDataValue(object, key) {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function initialSensitiveValues(options = {}) {
  const output = new Set();
  const secrets = options.secrets && typeof options.secrets === 'object' ? options.secrets : {};
  for (const key of Reflect.ownKeys(secrets)) {
    if (typeof key !== 'string') continue;
    const value = ownDataValue(secrets, key);
    if (typeof value === 'string' && value.length > 0) output.add(value);
  }
  const redactionValues = Array.isArray(options.redactionValues) ? options.redactionValues : [];
  for (let index = 0; index < redactionValues.length; index += 1) {
    const value = ownDataValue(redactionValues, String(index));
    if (typeof value === 'string' && value.length > 0) output.add(value);
  }
  return output;
}

function redactString(value, sensitiveValues = new Set()) {
  let output = String(value);
  const tokens = [...sensitiveValues].filter((entry) => typeof entry === 'string' && entry.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const secret of tokens) output = output.split(secret).join(REDACTED_VALUE);
  return output;
}

function defineRedactedProperty(target, key, value, enumerable = true) {
  try {
    Object.defineProperty(target, key, {
      enumerable,
      configurable: true,
      writable: false,
      value
    });
  } catch (_) {
    // Redaction must contain hostile evidence rather than execute or preserve it.
  }
}

function redactRuntimeValue(value, sensitiveValues = new Set(), seen = new WeakSet(), keyName = '', depth = 0) {
  if (isSensitiveField(keyName)) return REDACTED_VALUE;
  if (typeof value === 'string') return redactString(value, sensitiveValues);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return BINARY_VALUE;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return BINARY_VALUE;
  if (depth >= MAX_REDACTION_DEPTH) return BOUNDED_VALUE;
  if (value instanceof Error) return redactRuntimeError(value, sensitiveValues, seen, depth);
  if (seen.has(value)) return CIRCULAR_VALUE;
  seen.add(value);

  if (Array.isArray(value)) {
    const output = [];
    const length = Math.min(value.length, MAX_REDACTION_ENTRIES);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      const entry = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? descriptor.value
        : ACCESSOR_VALUE;
      if (Array.isArray(entry)) {
        const name = ownDataValue(entry, '0');
        if (entry.length >= 2 && isSensitiveField(name)) {
          const pair = [redactString(name, sensitiveValues), REDACTED_VALUE];
          const pairLength = Math.min(entry.length, MAX_REDACTION_ENTRIES);
          for (let pairIndex = 2; pairIndex < pairLength; pairIndex += 1) {
            const pairDescriptor = Object.getOwnPropertyDescriptor(entry, String(pairIndex));
            pair.push(pairDescriptor && Object.prototype.hasOwnProperty.call(pairDescriptor, 'value')
              ? redactRuntimeValue(pairDescriptor.value, sensitiveValues, seen, '', depth + 1)
              : ACCESSOR_VALUE);
          }
          output.push(Object.freeze(pair));
          continue;
        }
      }
      output.push(redactRuntimeValue(entry, sensitiveValues, seen, '', depth + 1));
    }
    return Object.freeze(output);
  }

  const output = {};
  for (const key of Reflect.ownKeys(value).slice(0, MAX_REDACTION_ENTRIES)) {
    if (typeof key !== 'string') continue;
    const outputKey = redactString(key, sensitiveValues);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const entry = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? redactRuntimeValue(descriptor.value, sensitiveValues, seen, key, depth + 1)
      : (isSensitiveField(key) ? REDACTED_VALUE : ACCESSOR_VALUE);
    defineRedactedProperty(output, outputKey, entry);
  }
  return Object.freeze(output);
}

function redactRuntimeError(error, sensitiveValues = new Set(), seen = new WeakSet(), depth = 0) {
  if (typeof error === 'string') return redactString(error, sensitiveValues);
  if (!error || typeof error !== 'object') return error;
  if (depth >= MAX_REDACTION_DEPTH) {
    const bounded = new Error(BOUNDED_VALUE);
    bounded.name = 'PulseRedactedError';
    return bounded;
  }
  if (seen.has(error)) {
    const circular = new Error(CIRCULAR_VALUE);
    circular.name = 'PulseRedactedError';
    return circular;
  }
  seen.add(error);

  const rawMessage = ownDataValue(error, 'message');
  const rawName = ownDataValue(error, 'name');
  const rawCode = ownDataValue(error, 'code');
  const rawDetail = ownDataValue(error, 'detail');
  const message = redactString(typeof rawMessage === 'string' ? rawMessage : 'Pulse runtime failure.', sensitiveValues);
  const name = redactString(typeof rawName === 'string' ? rawName : 'Error', sensitiveValues);
  // Keep the finite admitted discriminator intact; messages, causes and arbitrary
  // provider codes still pass through ordinary sensitive-value redaction.
  const code = portableKv.isApplicationError(error) ? rawCode
    : typeof rawCode === 'string' ? redactString(rawCode, sensitiveValues) : undefined;
  const detail = rawDetail === undefined ? undefined : redactRuntimeValue(rawDetail, sensitiveValues, seen, 'detail', depth + 1);

  const safe = code === undefined
    ? Object.assign(new Error(message), { name })
    : new CanonicalRuntimeError(name, code, message, detail === undefined ? {} : detail);

  const rawCause = ownDataValue(error, 'cause');
  if (rawCause !== undefined) {
    defineRedactedProperty(safe, 'cause', redactRuntimeError(rawCause, sensitiveValues, seen, depth + 1), false);
  }

  const reserved = new Set(['name', 'message', 'stack', 'code', 'detail', 'cause']);
  for (const key of Reflect.ownKeys(error).slice(0, MAX_REDACTION_ENTRIES)) {
    if (typeof key !== 'string' || reserved.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
    defineRedactedProperty(
      safe,
      redactString(key, sensitiveValues),
      redactRuntimeValue(descriptor.value, sensitiveValues, seen, key, depth + 1),
      descriptor.enumerable
    );
  }

  const rawStack = ownDataValue(error, 'stack');
  if (typeof rawStack === 'string') {
    try { Object.defineProperty(safe, 'stack', { configurable: true, writable: true, value: redactString(rawStack, sensitiveValues) }); }
    catch (_) { /* best effort */ }
  }
  return safe;
}

function redactedHeaders(headers, sensitiveValues = new Set()) {
  return normalizeHeaders(headers).map(([name, value]) => [
    redactString(name, sensitiveValues),
    isSensitiveField(name) ? REDACTED_VALUE : redactString(value, sensitiveValues)
  ]);
}

function jsonTrace(trace, input, value) {
  if (trace && typeof trace.json === 'function') trace.json(input, value);
}

function jsonTraceErrorDetail(error) {
  const detail = error && (error.detail || error.details) || {};
  return {
    errorCode: error && error.code || 'PULSE_SCHEMA_OPERATION_FAILED',
    errorPath: detail.path || detail.field || null,
    expected: detail.expected || null,
    actualKind: detail.actualKind || detail.actual || null
  };
}

function strictSchemaPolicy(options, schemaCodecs) {
  return options && options.strict === true
    && Boolean(schemaCodecs && Array.isArray(schemaCodecs.ids) && schemaCodecs.ids.length > 0);
}

function requireSchemaCodecs(schemaCodecs, schemaId, source) {
  if (
    !schemaCodecs
    || typeof schemaCodecs.has !== 'function'
    || typeof schemaCodecs.decodeJsonText !== 'function'
    || typeof schemaCodecs.encodeJsonText !== 'function'
  ) {
    throw new CanonicalRuntimeError(
      'SchemaReferenceError',
      'PULSE_SCHEMA_CODECS_UNAVAILABLE',
      `Pulse cannot use schema ${JSON.stringify(String(schemaId))} because the project codec registry is unavailable.`,
      { schemaId: String(schemaId), source }
    );
  }
  return schemaCodecs;
}

function requireSchemaId(schemaCodecs, schemaId, source) {
  if (typeof schemaId !== 'string' || schemaId.length === 0) {
    throw new CanonicalRuntimeError(
      'SchemaReferenceError',
      'PULSE_SCHEMA_ID_INVALID',
      'Pulse schema IDs must be non-empty strings.',
      { schemaIdType: typeof schemaId, source }
    );
  }
  const codecs = requireSchemaCodecs(schemaCodecs, schemaId, source);
  if (!codecs.has(schemaId)) {
    throw new CanonicalRuntimeError(
      'SchemaReferenceError',
      'PULSE_SCHEMA_REFERENCE',
      `Unknown compiled schema ${schemaId}.`,
      { schemaId, source }
    );
  }
  return schemaId;
}

function assertSchemaJsonContentType(schemaCodecs, headers, schemaId, source) {
  const policy = schemaCodecs && schemaCodecs.registry && schemaCodecs.registry.contentTypePolicy || 'accept-json-or-missing';
  const contentType = String(headerValue(headers, 'content-type') || '').trim().toLowerCase();
  const mediaType = contentType.split(';')[0].trim();
  const json = mediaType === 'application/json' || mediaType.endsWith('+json');
  const accepted = json || (!contentType && policy === 'accept-json-or-missing');
  if (accepted) return;
  throw new CanonicalRuntimeError(
    'SchemaDecodeError',
    'PULSE_SCHEMA_CONTENT_TYPE',
    `Schema ${String(schemaId)} requires a JSON content type.`,
    { schemaId: String(schemaId), source, contentType, contentTypePolicy: policy }
  );
}

function assertSchemaBodySize(schemaCodecs, text, schemaId, source) {
  const configured = Number(schemaCodecs && schemaCodecs.registry && schemaCodecs.registry.maxBytes);
  const maxBytes = Number.isSafeInteger(configured) && configured > 0 ? configured : 65536;
  const bytes = Buffer.byteLength(String(text || ''), 'utf8');
  if (bytes <= maxBytes) return;
  throw new CanonicalRuntimeError(
    'BodyTooLargeError',
    'PULSE_BODY_TOO_LARGE',
    `Structured schema body exceeds the ${maxBytes} byte limit.`,
    { schemaId: String(schemaId), source, bytes, maxBytes }
  );
}

const runtimeValueErrorCodes = Object.freeze({
  BodyTooLargeError: 'PULSE_BODY_TOO_LARGE',
  BodyDecodeError: 'PULSE_BODY_DECODE',
  RequestBodyInvalidUtf8Error: 'PULSE_REQUEST_BODY_INVALID_UTF8',
  BodyUnavailableError: 'PULSE_BODY_UNAVAILABLE',
  OpaqueBodyInspectionError: 'PULSE_OPAQUE_BODY_INSPECTION',
  ResponseEncodeError: 'PULSE_RESPONSE_ENCODE',
  FetchNetworkError: 'PULSE_FETCH_NETWORK',
  FetchTimeoutError: 'PULSE_FETCH_TIMEOUT',
  ContinuationExpiredError: 'PULSE_CONTINUATION_EXPIRED',
  ContinuationDoubleResumeError: 'PULSE_CONTINUATION_DOUBLE_RESUME',
  ProviderCapabilityMissingError: 'PULSE_PROVIDER_CAPABILITY_MISSING'
});

function unwrap(result) {
  if (result && result.ok === false) {
    const name = result.error || 'CanonicalRuntimeError';
    const code = runtimeValueErrorCodes[name]
      || `PULSE_${String(name || 'RUNTIME').replace(/Error$/i, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}`;
    const error = new CanonicalRuntimeError(name, code, result.message || name || 'Canonical runtime operation failed.', result.detail || {});
    throw error;
  }
  return result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;
}

function normalizeRequest(options = {}) {
  const input = options.request || {};
  const pathValue = String(input.path || (() => {
    try { return new URL(String(input.url || 'https://app.example.test/')).pathname; }
    catch (_) { return '/'; }
  })());
  const url = String(input.url || `https://app.example.test${pathValue}`);
  const headers = normalizeHeaders(input.headers || (input.contentType ? [['content-type', input.contentType]] : []));
  return Object.freeze({
    method: String(input.method || 'GET').toUpperCase(),
    url,
    path: pathValue,
    headers,
    body: Object.prototype.hasOwnProperty.call(input, 'body') ? input.body : undefined
  });
}

function createRequestSurface(request, options = {}, schemaCodecs, trace) {
  const body = runtimeApi.body.createValue(
    { body: request.body, headers: request.headers },
    { maxBytes: options.maxRequestBodyBytes || options.maxBodyBytes || options.maxStructuredBodyBytes, strictUtf8: true }
  );
  const schemaMemo = new Map();
  return Object.freeze({
    surface: Object.freeze({
      method: request.method,
      url: request.url,
      path: request.path,
      headers: request.headers,
      header(name) { return headerValue(request.headers, name); },
      text() { return unwrap(body.text()); },
      json(schemaId) {
        if (schemaId === undefined) {
          if (strictSchemaPolicy(options, schemaCodecs)) {
            throw new CanonicalRuntimeError(
              'SchemaReferenceError',
              'PULSE_SCHEMA_REQUIRED',
              'Strict Pulse request JSON requires a registered schema ID.',
              { source: 'request', strict: true }
            );
          }
          return unwrap(body.json());
        }
        const key = requireSchemaId(schemaCodecs, schemaId, 'request');
        if (!schemaMemo.has(key)) {
          const event = {
            boundary: 'request',
            schemaId: key,
            responseCaseId: null,
            operationId: `request:${key}`,
            status: null,
            contentType: headerValue(request.headers, 'content-type') || null,
            headers: request.headers,
            bodyOwnership: 'request-snapshot',
            target: options.target || null,
            provider: options.provider || null,
            effectId: null,
            groupId: null
          };
          try {
            assertSchemaJsonContentType(schemaCodecs, request.headers, key, 'request');
            const text = unwrap(body.text());
            assertSchemaBodySize(schemaCodecs, text, key, 'request');
            const decoded = schemaCodecs.decodeJsonText(key, text, 'request');
            schemaMemo.set(key, decoded);
            jsonTrace(trace, { ...event, kind: 'json.decode.request' }, decoded);
          } catch (error) {
            jsonTrace(trace, { ...event, kind: 'json.decode.error', ...jsonTraceErrorDetail(error) });
            throw error;
          }
        }
        return schemaMemo.get(key);
      }
    }),
    body
  });
}

function createResponseBuilders(schemaCodecs, options = {}, trace) {
  const builders = runtimeApi.body.createResponseBuilders();
  function checked(result) {
    if (result && result.ok === false) return unwrap(result);
    return result;
  }
  return Object.freeze({
    json(value, descriptor) {
      let schemaId;
      let responseCaseId;
      let responseOptions;
      if (typeof descriptor === 'string') {
        const codecs = requireSchemaCodecs(schemaCodecs, descriptor, 'application-response');
        const responseCase = typeof codecs.responseCase === 'function'
          ? codecs.responseCase(descriptor)
          : undefined;
        if (!responseCase) {
          throw new CanonicalRuntimeError(
            'SchemaReferenceError',
            'PULSE_RESPONSE_CASE_REFERENCE',
            `Unknown compiled response case ${descriptor}.`,
            { responseCaseId: descriptor, source: 'application-response' }
          );
        }
        responseCaseId = descriptor;
        schemaId = requireSchemaId(schemaCodecs, responseCase.schemaId, 'application-response');
        responseOptions = { status: responseCase.status };
      } else {
        if (descriptor !== undefined && (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor))) {
          throw new CanonicalRuntimeError(
            'SchemaReferenceError',
            'PULSE_RESPONSE_DESCRIPTOR_INVALID',
            'Pulse JSON response metadata must be an object or registered response-case ID.',
            { source: 'application-response', valueType: Array.isArray(descriptor) ? 'array' : typeof descriptor }
          );
        }
        const valueOptions = descriptor || {};
        schemaId = Object.prototype.hasOwnProperty.call(valueOptions, 'schema')
          ? requireSchemaId(schemaCodecs, valueOptions.schema, 'application-response')
          : undefined;
        const { schema: _schema, ...rest } = valueOptions;
        responseOptions = rest;
      }
      if (schemaId === undefined) {
        if (strictSchemaPolicy(options, schemaCodecs)) {
          throw new CanonicalRuntimeError(
            'SchemaReferenceError',
            'PULSE_SCHEMA_REQUIRED',
            'Strict Pulse JSON responses require a schema descriptor or registered response-case ID.',
            { source: 'application-response', strict: true }
          );
        }
        return checked(builders.json(value, responseOptions));
      }
      const key = String(schemaId);
      const status = responseOptions.status === undefined ? 200 : Number(responseOptions.status);
      const traceStatus = Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : null;
      const headers = normalizeHeaders(responseOptions.headers);
      if (!headerValue(headers, 'content-type')) headers.push(['content-type', 'application/json; charset=utf-8']);
      const event = {
        boundary: 'application-response',
        schemaId: key,
        responseCaseId: responseCaseId || null,
        operationId: `application-response:${responseCaseId || key}`,
        status: traceStatus,
        contentType: headerValue(headers, 'content-type') || null,
        headers,
        bodyOwnership: 'application-owned',
        target: options.target || null,
        provider: options.provider || null,
        effectId: null,
        groupId: null
      };
      try {
        const text = schemaCodecs.encodeJsonText(key, value, 'application-response');
        const normalized = schemaCodecs.decodeJsonText(key, text, 'application-response-trace');
        const result = checked(builders.jsonText(text, responseOptions, normalized));
        jsonTrace(trace, { ...event, kind: 'json.encode.response' }, normalized);
        return result;
      } catch (error) {
        jsonTrace(trace, { ...event, kind: 'json.encode.error', ...jsonTraceErrorDetail(error) });
        throw error;
      }
    },
    text(value, options) { return checked(builders.text(value, options)); },
    response(value) { return checked(builders.response(value)); }
  });
}

function createCanonicalContext(options, trace) {
  const request = normalizeRequest(options);
  const schemaCodecs = options.schemaCodecs;
  const requestSurface = createRequestSurface(request, options, schemaCodecs, trace);
  const builders = createResponseBuilders(schemaCodecs, options, trace);
  const configValues = Object.freeze({ ...(options.config || {}) });
  const secretValues = Object.freeze({ ...(options.secrets || {}) });
  const kvStores = new Map(Object.entries(options.kv || {}).map(([name, values]) => [String(name), new Map(Object.entries(values || {}))]));
  const requestState = new Map();
  const capabilities = options.capabilities && typeof options.capabilities === 'object' ? options.capabilities : {};
  const configCapability = capabilities.config && typeof capabilities.config.get === 'function' ? capabilities.config : undefined;
  const secretCapability = capabilities.secret && typeof capabilities.secret.get === 'function' ? capabilities.secret : undefined;
  const kvCapability = typeof capabilities.kv === 'function' ? capabilities.kv : undefined;
  const reporting = loggingContract.reportingDescriptor(options.reporting);
  const providerLog = typeof options.log === 'function' ? options.log : undefined;
  const redactLogMessage = typeof options.redactLogMessage === 'function'
    ? options.redactLogMessage
    : String;
  const log = {};
  for (const [name, level] of Object.entries(loggingContract.LOG_METHOD_LEVELS)) {
    log[name] = (message) => {
      if (typeof message !== 'string') throw new TypeError(`ctx.log.${name} requires one string message.`);
      if (!loggingContract.logStatementEnabled(level, reporting.level)) return;
      let safeMessage;
      try { safeMessage = String(redactLogMessage(message)); }
      catch (_) { safeMessage = REDACTED_VALUE; }
      const event = Object.freeze({
        version: 'pulse.log-event.v1',
        type: 'log',
        level,
        name,
        message: safeMessage,
        target: options.target || null,
        provider: options.provider || null
      });
      try { trace.push(event); }
      catch (_) { /* Logging evidence is best effort. */ }
      if (providerLog) {
        try { providerLog(level, safeMessage, event); }
        catch (_) { /* Provider logging failures never fail the request. */ }
      }
    };
  }
  try {
    trace.push(Object.freeze({
      version: 'pulse.log-event.v1',
      type: 'logging-config',
      reporting: Object.freeze({ name: reporting.name, level: reporting.level }),
      target: options.target || null,
      provider: options.provider || null
    }));
  } catch (_) {
    // Logging evidence is best effort.
  }

  const ctx = Object.freeze({
    decodeJson(text, schemaId) {
      const key = requireSchemaId(schemaCodecs, schemaId, 'application-text');
      const event = {
        boundary: 'application-text', schemaId: key, responseCaseId: null,
        operationId: `application-text:${key}`, status: null,
        contentType: null, headers: [], bodyOwnership: 'application-owned',
        target: options.target || null, provider: options.provider || null,
        effectId: null, groupId: null
      };
      try {
        if (typeof text !== 'string') {
          throw new CanonicalRuntimeError('SchemaDecodeError', 'PULSE_SCHEMA_DECODE',
            'Application JSON text must be a string.',
            { schemaId: key, source: 'application-text', expected: 'string', actualKind: typeof text });
        }
        assertSchemaBodySize(schemaCodecs, text, key, 'application-text');
        const value = schemaCodecs.decodeJsonText(key, text, 'application-text');
        jsonTrace(trace, { ...event, kind: 'json.decode.text' }, value);
        return value;
      } catch (error) {
        jsonTrace(trace, { ...event, kind: 'json.decode.error', ...jsonTraceErrorDetail(error) });
        throw error;
      }
    },
    encodeJson(value, schemaId) {
      const key = requireSchemaId(schemaCodecs, schemaId, 'application-value');
      const event = {
        boundary: 'application-value', schemaId: key, responseCaseId: null,
        operationId: `application-value:${key}`, status: null,
        contentType: 'application/json; charset=utf-8', headers: [],
        bodyOwnership: 'application-owned', target: options.target || null,
        provider: options.provider || null, effectId: null, groupId: null
      };
      try {
        const text = schemaCodecs.encodeJsonText(key, value, 'application-value');
        assertSchemaBodySize(schemaCodecs, text, key, 'application-value');
        const normalized = schemaCodecs.decodeJsonText(key, text, 'application-value-trace');
        jsonTrace(trace, { ...event, kind: 'json.encode.value' }, normalized);
        return text;
      } catch (error) {
        jsonTrace(trace, { ...event, kind: 'json.encode.error', ...jsonTraceErrorDetail(error) });
        throw error;
      }
    },
    req: requestSurface.surface,
    log: Object.freeze(log),
    fetch() {
      throw new CanonicalRuntimeError('CanonicalUnloweredFetchError', 'PULSE_CANONICAL_UNLOWERED_FETCH', 'ctx.fetch reached the runtime without compiler lowering.');
    },
    json: builders.json,
    text: builders.text,
    response: builders.response,
    state: Object.freeze({
      get(key) {
        if (typeof key !== 'string') {
          throw new CanonicalRuntimeError('CanonicalStateKeyError', 'PULSE_STATE_KEY_STRING_REQUIRED', 'ctx.state.get requires a string key.', { keyType: typeof key });
        }
        return requestState.has(key) ? requestState.get(key) : undefined;
      },
      set(key, value) {
        if (typeof key !== 'string') {
          throw new CanonicalRuntimeError('CanonicalStateKeyError', 'PULSE_STATE_KEY_STRING_REQUIRED', 'ctx.state.set requires a string key.', { keyType: typeof key });
        }
        if (typeof value !== 'string') {
          throw new CanonicalRuntimeError('CanonicalStateValueError', 'PULSE_STATE_VALUE_STRING_REQUIRED', 'ctx.state.set requires a string value.', { key, valueType: typeof value });
        }
        requestState.set(key, value);
      }
    }),
    config: Object.freeze({
      get(name) {
        const key = String(name);
        trace.push(Object.freeze({ type: 'config-read', name: key, source: configCapability ? 'provider-capability' : 'runtime-values' }));
        return configCapability ? configCapability.get(key) : configValues[key];
      }
    }),
    secret: Object.freeze({
      get(name) {
        const key = String(name);
        trace.push(Object.freeze({ type: 'secret-read', name: key, value: '<redacted>', source: secretCapability ? 'provider-capability' : 'runtime-values' }));
        return secretCapability ? secretCapability.get(key) : secretValues[key];
      }
    }),
    kv(name) {
      const storeName = String(name);
      const externalStore = kvCapability ? kvCapability(storeName) : undefined;
      if (externalStore !== undefined && (!externalStore || typeof externalStore.get !== 'function' || typeof externalStore.put !== 'function')) {
        throw new CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_PROVIDER_CAPABILITY_INVALID', `Provider KV capability ${storeName} must expose get and put operations.`, { capability: 'kv', store: storeName });
      }
      if (!externalStore && !kvStores.has(storeName)) kvStores.set(storeName, new Map());
      const store = externalStore || kvStores.get(storeName);
      return Object.freeze({
        get(key) {
          const normalized = String(key);
          trace.push(Object.freeze({ type: 'kv-get', store: storeName, key: normalized, source: externalStore ? 'provider-capability' : 'runtime-values' }));
          return store.get(normalized);
        },
        put(key, value) {
          const normalized = String(key);
          const result = store.put ? store.put(normalized, value) : store.set(normalized, value);
          trace.push(Object.freeze({ type: 'kv-put', store: storeName, key: normalized, source: externalStore ? 'provider-capability' : 'runtime-values' }));
          return externalStore ? result : true;
        }
      });
    }
  });

  return Object.freeze({ ctx, request, requestBody: requestSurface.body, kvStores, requestState });
}

function normalizedInit(init = {}, schemaCodecs, options = {}) {
  if (init !== undefined && (!init || typeof init !== 'object' || Array.isArray(init))) {
    throw new CanonicalRuntimeError('FetchRequestError', 'PULSE_FETCH_INIT_INVALID', 'Canonical fetch init must be an object.');
  }
  const value = init || {};
  const supportedFields = new Set(['method', 'headers', 'body', 'json', 'schema', 'timeoutMs']);
  for (const field of Object.keys(value)) {
    if (!supportedFields.has(field)) {
      throw new CanonicalRuntimeError(
        'FetchRequestError',
        'PULSE_FETCH_INIT_FIELD_UNSUPPORTED',
        `Canonical fetch init field ${JSON.stringify(field)} is outside the portable contract.`,
        { field }
      );
    }
  }
  const method = String(value.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST'].includes(method)) {
    throw new CanonicalRuntimeError(
      'FetchRequestError',
      'PULSE_FETCH_METHOD_UNSUPPORTED',
      `Canonical fetch method ${method} is outside the portable GET, HEAD, and POST contract.`,
      { method }
    );
  }
  const headers = normalizeHeaders(value.headers);
  const hasBody = Object.prototype.hasOwnProperty.call(value, 'body');
  const hasJson = Object.prototype.hasOwnProperty.call(value, 'json');
  const hasSchema = Object.prototype.hasOwnProperty.call(value, 'schema');
  if (hasBody && hasJson) {
    throw new CanonicalRuntimeError('FetchRequestError', 'PULSE_FETCH_BODY_AMBIGUOUS', 'Canonical fetch init accepts either body or json, not both.');
  }
  if (hasSchema && !hasJson) {
    throw new CanonicalRuntimeError('FetchRequestError', 'PULSE_FETCH_SCHEMA_WITHOUT_JSON', 'Canonical fetch schema is only valid together with the semantic json field.');
  }
  const schemaId = hasSchema
    ? requireSchemaId(schemaCodecs, value.schema, 'fetch-request')
    : undefined;
  let body;
  let bodyMode = 'none';
  if (hasBody) {
    if (typeof value.body !== 'string') {
      throw new CanonicalRuntimeError('FetchRequestError', 'PULSE_FETCH_BODY_INVALID', 'Canonical fetch body must be a string.', { valueType: typeof value.body });
    }
    body = value.body;
    bodyMode = 'text';
  } else if (hasJson) {
    if (!headerValue(headers, 'content-type')) headers.push(['content-type', 'application/json; charset=utf-8']);
    if (hasSchema) {
      const event = {
        boundary: 'fetch-request',
        schemaId,
        responseCaseId: null,
        operationId: `fetch-request:${options.effectId || schemaId}`,
        status: null,
        contentType: headerValue(headers, 'content-type') || 'application/json; charset=utf-8',
        headers,
        bodyOwnership: 'application-owned',
        target: options.target || null,
        provider: options.provider || null,
        effectId: options.effectId || null,
        groupId: options.groupId || null
      };
      try {
        body = schemaCodecs.encodeJsonText(schemaId, value.json, 'fetch-request');
        const normalized = schemaCodecs.decodeJsonText(schemaId, body, 'fetch-request-trace');
        jsonTrace(options.trace, { ...event, kind: 'json.encode.fetch' }, normalized);
      } catch (error) {
        jsonTrace(options.trace, { ...event, kind: 'json.encode.error', ...jsonTraceErrorDetail(error) });
        throw error;
      }
    } else {
      if (strictSchemaPolicy(options, schemaCodecs)) {
        throw new CanonicalRuntimeError(
          'SchemaReferenceError',
          'PULSE_SCHEMA_REQUIRED',
          'Strict outbound fetch JSON requires a registered schema ID.',
          { source: 'fetch-request', strict: true }
        );
      }
      try { body = JSON.stringify(value.json); }
      catch (error) {
        throw new CanonicalRuntimeError('FetchRequestError', 'PULSE_FETCH_JSON_ENCODE', 'Canonical fetch json could not be serialized.', { message: error.message });
      }
      if (body === undefined) {
        throw new CanonicalRuntimeError('FetchRequestError', 'PULSE_FETCH_JSON_ENCODE', 'Canonical fetch json must serialize to a JSON value.');
      }
    }
    bodyMode = 'json';
  }
  if ((method === 'GET' || method === 'HEAD') && bodyMode !== 'none') {
    throw new CanonicalRuntimeError(
      'FetchRequestError',
      'PULSE_FETCH_BODY_METHOD_UNSUPPORTED',
      `Canonical ${method} fetch operations cannot include a body.`,
      { method, bodyMode }
    );
  }
  let timeoutMs;
  if (value.timeoutMs !== undefined) {
    timeoutMs = Number(value.timeoutMs);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new CanonicalRuntimeError('FetchRequestError', 'PULSE_FETCH_TIMEOUT_INVALID', 'Canonical fetch timeoutMs must be a positive safe integer.', { timeoutMs: value.timeoutMs });
    }
  }
  return Object.freeze({
    method,
    headers,
    body,
    bodyMode,
    ...(hasSchema ? { schema: schemaId } : {}),
    timeoutMs
  });
}

function urlParts(value) {
  if (typeof value !== 'string') {
    throw new CanonicalRuntimeError(
      'FetchRequestError',
      'PULSE_FETCH_URL_INVALID',
      'Canonical fetch URLs must be absolute HTTP or HTTPS strings.',
      { valueType: typeof value }
    );
  }
  let parsed;
  try { parsed = new URL(value); }
  catch (error) { throw new CanonicalRuntimeError('FetchRequestError', 'PULSE_FETCH_URL_INVALID', `Invalid fetch URL ${value}.`, { url: value, message: error.message }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new CanonicalRuntimeError(
      'FetchRequestError',
      'PULSE_FETCH_URL_INVALID',
      `Canonical fetch only supports absolute HTTP and HTTPS URLs; received ${parsed.protocol || '<none>'}.`,
      { url: parsed.toString(), protocol: parsed.protocol }
    );
  }
  return Object.freeze({ url: parsed.toString(), origin: parsed.origin, path: `${parsed.pathname}${parsed.search}` || '/' });
}

function normalizeFetchEffect(effect, schemaCodecs, options = {}) {
  const responseMode = effect.responseMode === undefined ? 'auto' : String(effect.responseMode);
  if (!['auto', 'structured', 'opaque'].includes(responseMode)) {
    throw new CanonicalRuntimeError(
      'CanonicalEffectProtocolError',
      'PULSE_FETCH_RESPONSE_MODE_INVALID',
      `Canonical fetch response mode ${JSON.stringify(responseMode)} is unsupported.`,
      { effectId: String(effect.id), responseMode }
    );
  }
  const projection = String(effect.projection || (responseMode === 'structured' ? 'text' : 'response'));
  if (!['text', 'json', 'response'].includes(projection)) {
    throw new CanonicalRuntimeError(
      'CanonicalEffectProtocolError',
      'PULSE_FETCH_PROJECTION_INVALID',
      `Canonical fetch projection ${JSON.stringify(projection)} is unsupported.`,
      { effectId: String(effect.id), responseMode, projection }
    );
  }
  if ((responseMode === 'structured' && projection === 'response')
    || (responseMode === 'opaque' && projection !== 'response')) {
    throw new CanonicalRuntimeError(
      'CanonicalEffectProtocolError',
      'PULSE_FETCH_PROJECTION_MODE_CONFLICT',
      `Canonical fetch projection ${JSON.stringify(projection)} conflicts with response mode ${JSON.stringify(responseMode)}.`,
      { effectId: String(effect.id), responseMode, projection }
    );
  }
  return Object.freeze({
    id: String(effect.id),
    kind: 'fetch',
    parts: urlParts(effect.url),
    init: normalizedInit(effect.init, schemaCodecs, {
      ...options,
      effectId: String(effect.id),
      groupId: effect.groupKey === undefined ? null : String(effect.groupKey)
    }),
    responseMode,
    projection,
    ...(effect.groupKey === undefined ? {} : { groupKey: String(effect.groupKey) }),
    source: effect.source
  });
}


function normalizeProviderEffect(effect, schemaCodecs, options = {}) {
  if (!effect || typeof effect !== 'object') {
    throw new CanonicalRuntimeError('CanonicalEffectProtocolError', 'PULSE_CANONICAL_EFFECT_PROTOCOL', 'Canonical provider effect must be an object.', { effect });
  }
  if (portableKv.isConditionalKv(effect.kind)) return Object.freeze({ ...portableKv.admitConditionalKv(effect, options), id: effect.id, groupKey: effect.groupKey, source: effect.source });
  if (effect.kind === 'fetch') return normalizeFetchEffect(effect, schemaCodecs, options);
  const id = String(effect.id || '');
  if (!id) throw new CanonicalRuntimeError('CanonicalEffectProtocolError', 'PULSE_CANONICAL_EFFECT_PROTOCOL', 'Canonical provider effect requires an id.', { effect });
  if (effect.kind === 'time.now') return Object.freeze({ id, kind: 'time.now', providerKind: 'time', operation: 'now', capability: 'time.wall-clock', source: effect.source, ...(effect.groupKey === undefined ? {} : { groupKey: String(effect.groupKey) }) });
  if (effect.kind === 'config.get' || effect.kind === 'secret.get') {
    return Object.freeze({ id, kind: effect.kind, name: String(effect.name), ...(effect.groupKey === undefined ? {} : { groupKey: String(effect.groupKey) }), source: effect.source });
  }
  if (effect.kind === 'kv.get' || effect.kind === 'kv.put') {
    return Object.freeze({ id, kind: effect.kind, store: String(effect.store), key: String(effect.key), value: effect.kind === 'kv.put' ? effect.value : undefined, ...(effect.groupKey === undefined ? {} : { groupKey: String(effect.groupKey) }), source: effect.source });
  }
  if (effect.kind === 'event.emit') {
    const emission = effect.emission;
    if (!emission || typeof emission !== 'object' || Array.isArray(emission)) {
      throw new CanonicalRuntimeError(
        'CanonicalEffectProtocolError',
        'PULSE_RUNTIME_EVENT_EMIT_INPUT_INVALID',
        'Canonical event.emit requires a data emission descriptor.',
        { effectId: id }
      );
    }
    const prototype = Object.getPrototypeOf(emission);
    const symbols = Object.getOwnPropertySymbols(emission);
    const unknown = Object.keys(emission).filter((key) => key !== 'schema' && key !== 'payload').sort();
    if ((prototype !== Object.prototype && prototype !== null)
      || symbols.length > 0
      || unknown.length > 0
      || !Object.prototype.hasOwnProperty.call(emission, 'schema')
      || Object.keys(emission).some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(emission, key);
        return !descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value');
      })) {
      throw new CanonicalRuntimeError(
        'CanonicalEffectProtocolError',
        'PULSE_RUNTIME_EVENT_EMIT_INPUT_INVALID',
        'Canonical event.emit requires exactly schema and the schema-dependent payload field.',
        { effectId: id, unknown }
      );
    }
    let frame = eventContract.normalizeEventFrame({
      version: eventContract.EVENT_FRAME_VERSION,
      type: effect.type,
      schemaId: Object.getOwnPropertyDescriptor(emission, 'schema').value,
      ...(Object.prototype.hasOwnProperty.call(emission, 'payload')
        ? { payload: Object.getOwnPropertyDescriptor(emission, 'payload').value }
        : {})
    }, options.eventLimits);
    if (frame.schemaId !== null) {
      const payload = requireSchemaCodecs(schemaCodecs, frame.schemaId, 'event-emit')
        .decode(frame.schemaId, frame.payload, 'event-emit');
      frame = eventContract.normalizeEventFrame({ ...frame, payload }, options.eventLimits);
    }
    return Object.freeze({
      id,
      kind: 'event.emit',
      providerKind: 'event',
      operation: 'emit',
      capability: 'event.emit',
      frame,
      ...(effect.groupKey === undefined ? {} : { groupKey: String(effect.groupKey) }),
      source: effect.source
    });
  }
  if (effect.package && effect.contractId && effect.operation) {
    const invocation = effect.invocation && typeof effect.invocation === 'object'
      ? effect.invocation
      : {};
    return Object.freeze({
      id,
      kind: String(effect.kind),
      package: String(effect.package),
      contractId: String(effect.contractId),
      providerKind: String(effect.providerKind || 'package'),
      operation: String(effect.operation),
      capability: String(effect.capability || effect.kind),
      result: String(effect.result || 'value'),
      resource: Object.freeze({ ...(effect.resource || {}) }),
      payload: Object.freeze({ ...(effect.payload || {}), ...invocation }),
      ...(effect.groupKey === undefined ? {} : { groupKey: String(effect.groupKey) }),
      source: effect.source
    });
  }
  throw new CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_PROVIDER_CAPABILITY_UNSUPPORTED', `Canonical provider effect ${String(effect.kind)} is unsupported.`, { effectId: id, kind: effect.kind });
}

function effectTraceStart(adapterId, executionId, normalized, sensitiveValues) {
  const base = { type: 'effect-start', provider: adapterId, executionId, effectId: normalized.id, kind: normalized.kind, ...(normalized.groupKey === undefined ? {} : { groupKey: normalized.groupKey }) };
  if (normalized.kind === 'fetch') return Object.freeze({
    ...base,
    url: redactString(normalized.parts.url, sensitiveValues),
    method: normalized.init.method,
    responseMode: normalized.responseMode,
    projection: normalized.projection,
    headers: redactedHeaders(normalized.init.headers, sensitiveValues)
  });
  if (normalized.kind === 'config.get' || normalized.kind === 'secret.get') return Object.freeze({ ...base, name: redactString(normalized.name, sensitiveValues) });
  if (portableKv.isConditionalKv(normalized.kind)) return Object.freeze({ ...base, key: '<redacted>', generation: '<redacted>', value: '<redacted>' });
  if (normalized.kind === 'kv.get' || normalized.kind === 'kv.put') return Object.freeze({ ...base, store: redactString(normalized.store, sensitiveValues), key: redactString(normalized.key, sensitiveValues) });
  if (normalized.kind === 'event.emit') return Object.freeze({ ...base, eventType: redactString(normalized.frame.type, sensitiveValues), schemaId: normalized.frame.schemaId });
  if (normalized.package) return Object.freeze({ ...base, package: normalized.package, contractId: normalized.contractId, operation: normalized.operation });
  return Object.freeze(base);
}

function effectTraceResolved(adapterId, executionId, normalized, value) {
  const base = { type: 'effect-resolved', provider: adapterId, executionId, effectId: normalized.id, kind: normalized.kind, ...(normalized.groupKey === undefined ? {} : { groupKey: normalized.groupKey }) };
  if (normalized.kind === 'fetch') return Object.freeze({ ...base, status: value.status, bodyClass: value.bodyClass });
  if (normalized.kind === 'secret.get') return Object.freeze({ ...base, hit: value !== undefined, value: '<redacted>' });
  if (normalized.kind === 'config.get') return Object.freeze({ ...base, hit: value !== undefined });
  if (portableKv.isConditionalKv(normalized.kind)) return Object.freeze({ ...base, status: value.status });
  if (normalized.kind === 'kv.get') return Object.freeze({ ...base, hit: value !== undefined });
  if (normalized.kind === 'kv.put') return Object.freeze({ ...base, stored: Boolean(value) });
  if (normalized.kind === 'event.emit') return Object.freeze({ ...base, accepted: value === undefined });
  if (normalized.package) return Object.freeze({ ...base, result: normalized.result, status: value && value.status, bodyClass: value && value.bodyClass });
  return Object.freeze(base);
}

function createStructuredFetchResponse(snapshot, schemaCodecs, options = {}) {
  const schemaMemo = new Map();
  const headers = normalizeHeaders(snapshot.headers);
  const body = runtimeApi.body.createValue(
    { body: snapshot.body, headers },
    { maxBytes: options.maxBytes, forceStructured: true }
  );
  function text() { return unwrap(body.text()); }
  const responseStatus = Number(snapshot.status);
  const traceStatus = Number.isSafeInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599
    ? responseStatus
    : null;
  return Object.freeze({
    status: Number(snapshot.status || 0),
    ok: Number(snapshot.status || 0) >= 200 && Number(snapshot.status || 0) < 300,
    kind: String(snapshot.kind || 'text'),
    bodyClass: 'structured',
    get body() { return text(); },
    headers,
    header(name) { return headerValue(headers, name); },
    text,
    json(schemaId) {
      if (schemaId !== undefined) {
        const key = requireSchemaId(schemaCodecs, schemaId, 'fetch-response');
        if (!schemaMemo.has(key)) {
          const event = {
            boundary: 'fetch-response',
            schemaId: key,
            responseCaseId: null,
            operationId: `fetch-response:${options.effectId || key}`,
            status: traceStatus,
            contentType: headerValue(headers, 'content-type') || null,
            headers,
            bodyOwnership: 'fetched-response-snapshot',
            target: options.target || null,
            provider: options.provider || null,
            effectId: options.effectId || null,
            groupId: options.groupId || null
          };
          try {
            const value = text();
            assertSchemaJsonContentType(schemaCodecs, headers, key, 'fetch-response');
            assertSchemaBodySize(schemaCodecs, value, key, 'fetch-response');
            const decoded = schemaCodecs.decodeJsonText(key, value, 'fetch-response');
            schemaMemo.set(key, decoded);
            jsonTrace(options.trace, { ...event, kind: 'json.decode.fetch' }, decoded);
          } catch (error) {
            jsonTrace(options.trace, { ...event, kind: 'json.decode.error', ...jsonTraceErrorDetail(error) });
            throw error;
          }
        }
        return schemaMemo.get(key);
      }
      if (strictSchemaPolicy(options, schemaCodecs)) {
        throw new CanonicalRuntimeError(
          'SchemaReferenceError',
          'PULSE_SCHEMA_REQUIRED',
          'Strict fetched-response JSON requires a registered schema ID.',
          { source: 'fetch-response', strict: true }
        );
      }
      return unwrap(body.json());
    },
    bodyStats() { return body.stats(); },
    toJSON() { return { status: Number(snapshot.status || 0), ok: this.ok, kind: this.kind, bodyClass: 'structured', headers, body: text() }; }
  });
}

function opaqueInspectionError(handle, helper) {
  return new CanonicalRuntimeError('OpaqueBodyInspectionError', 'PULSE_OPAQUE_BODY_INSPECTION', `Opaque ${handle.bodyKind || 'stream'} response bodies are pass-through only and cannot be inspected with ${helper}().`, { helper, handleId: handle.handleId, bodyKind: handle.bodyKind, bodyCopiedIntoWasm: false });
}

function createOpaqueFetchResponse(snapshot, effectId, providerSource = 'canonical-provider') {
  const bodyHandle = runtimeApi.opaque.createBodyHandle({
    id: snapshot.bodyHandle && snapshot.bodyHandle.handleId || `${effectId}-body`,
    bodyKind: snapshot.bodyHandle && snapshot.bodyHandle.bodyKind || 'stream',
    headers: snapshot.headers,
    status: snapshot.status,
    source: String(snapshot.providerSource || snapshot.source || providerSource),
    responseRef: snapshot.responseRef,
    streamRef: snapshot.streamRef
  });
  const headers = normalizeHeaders(snapshot.headers);
  return Object.freeze({
    status: Number(snapshot.status || 0),
    ok: Number(snapshot.status || 0) >= 200 && Number(snapshot.status || 0) < 300,
    kind: 'stream',
    bodyClass: 'opaque',
    headers,
    header(name) { return headerValue(headers, name); },
    bodyHandle,
    bodyStream: snapshot.bodyStream,
    responseRef: snapshot.responseRef,
    streamRef: snapshot.streamRef,
    hostOwnsStream: true,
    wasmOwnsBytes: false,
    streamResultAbiVersion: streamingContract.STREAM_RESULT_ABI_VERSION,
    json() { throw opaqueInspectionError(bodyHandle, 'json'); },
    text() { throw opaqueInspectionError(bodyHandle, 'text'); },
    bytes() { throw opaqueInspectionError(bodyHandle, 'bytes'); },
    toJSON() { return { status: this.status, ok: this.ok, kind: 'stream', bodyClass: 'opaque', headers, bodyHandle, responseRef: this.responseRef, streamRef: this.streamRef, hostOwnsStream: true, wasmOwnsBytes: false }; }
  });
}

function responseSnapshot(handle) {
  if (!handle || typeof handle !== 'object') return handle;
  if (typeof handle.toJSON !== 'function') return handle;
  const snapshot = handle.toJSON();
  return Object.freeze({
    ...snapshot,
    bodyStream: handle.bodyStream === undefined ? snapshot.bodyStream : handle.bodyStream,
    body: handle.body === undefined ? snapshot.body : handle.body,
    responseRef: handle.responseRef === undefined ? snapshot.responseRef : handle.responseRef,
    streamRef: handle.streamRef === undefined ? snapshot.streamRef : handle.streamRef
  });
}

function opaqueSnapshotFromStructured(snapshot) {
  const status = Number(snapshot.status || 0);
  const allowsBody = status !== 204 && status !== 205 && status !== 304 && !(status >= 100 && status < 200);
  const body = allowsBody && snapshot.body !== undefined && snapshot.body !== null ? snapshot.body : undefined;
  return Object.freeze({
    ...snapshot,
    kind: 'stream',
    bodyClass: 'opaque',
    body: undefined,
    bodyStream: snapshot.bodyStream === undefined
      ? (body === undefined ? undefined : Object.freeze({ chunks: Object.freeze([body]) }))
      : snapshot.bodyStream
  });
}

function bodyStreamChunks(snapshot) {
  const stream = snapshot && snapshot.bodyStream;
  if (stream && Array.isArray(stream.chunks)) return stream.chunks;
  if (Array.isArray(snapshot && snapshot.chunks)) return snapshot.chunks;
  if (typeof stream === 'string' || Buffer.isBuffer(stream) || stream instanceof Uint8Array) return [stream];
  return undefined;
}

function structuredSnapshotFromOpaque(snapshot, effectId, maxBytes) {
  const chunks = bodyStreamChunks(snapshot);
  const status = Number(snapshot.status || 0);
  const allowsBody = status !== 204 && status !== 205 && status !== 304 && !(status >= 100 && status < 200);
  if (!allowsBody) return Object.freeze({ ...snapshot, kind: 'text', bodyClass: 'structured', body: '' });
  if (!chunks) {
    throw new CanonicalRuntimeError(
      'OpaqueBodyInspectionError',
      'PULSE_OPAQUE_BODY_INSPECTION',
      'The provider returned a pass-through-only response that cannot satisfy an explicit structured fetch projection.',
      { effectId, bodyCopiedIntoWasm: false }
    );
  }
  const buffers = chunks.map((chunk) => Buffer.isBuffer(chunk)
    ? chunk
    : chunk instanceof Uint8Array
      ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      : Buffer.from(String(chunk)));
  const bytes = buffers.reduce((total, chunk) => total + chunk.byteLength, 0);
  const limit = Number.isSafeInteger(Number(maxBytes)) && Number(maxBytes) > 0 ? Number(maxBytes) : 65_536;
  if (bytes > limit) {
    throw new CanonicalRuntimeError(
      'BodyTooLargeError',
      'PULSE_BODY_TOO_LARGE',
      `Fetched response exceeds the ${limit} byte structured-body limit.`,
      { effectId, bytes, maxBytes: limit }
    );
  }
  return Object.freeze({
    ...snapshot,
    kind: 'text',
    bodyClass: 'structured',
    body: Buffer.concat(buffers).toString('utf8'),
    bodyStream: undefined,
    bodyHandle: undefined
  });
}

function normalizeFetchResponse(handle, effectId, providerSource, schemaCodecs, options = {}) {
  const responseMode = options.responseMode || 'auto';
  if (responseMode === 'structured' && handle && handle.bodyClass === 'structured' && typeof handle.text === 'function') return handle;
  if (responseMode === 'opaque' && handle && handle.bodyClass === 'opaque' && handle.bodyHandle) return handle;
  const snapshot = responseSnapshot(handle);
  if (!snapshot || typeof snapshot !== 'object') throw new CanonicalRuntimeError('FetchNetworkError', 'PULSE_FETCH_NETWORK', 'Provider returned no fetch response.', { effectId });
  const opaque = snapshot.kind === 'stream' || snapshot.bodyClass === 'opaque' || snapshot.bodyStream !== undefined || snapshot.bodyHandle !== undefined;
  if (responseMode === 'opaque') {
    return createOpaqueFetchResponse(opaque ? snapshot : opaqueSnapshotFromStructured(snapshot), effectId, providerSource);
  }
  if (responseMode === 'structured') {
    const structured = opaque
      ? structuredSnapshotFromOpaque(snapshot, effectId, options.maxBytes)
      : snapshot;
    return createStructuredFetchResponse(structured, schemaCodecs, options);
  }
  return opaque
    ? createOpaqueFetchResponse(snapshot, effectId, providerSource)
    : createStructuredFetchResponse(snapshot, schemaCodecs, options);
}

function responseAllowsBody(status, requestMethod = 'GET') {
  const normalizedStatus = Number(status);
  return String(requestMethod || 'GET').toUpperCase() !== 'HEAD'
    && normalizedStatus !== 204
    && normalizedStatus !== 205
    && normalizedStatus !== 304
    && !(normalizedStatus >= 100 && normalizedStatus < 200);
}

function releaseDiscardedStream(stream) {
  if (!stream) return;
  try {
    if (typeof stream.destroy === 'function') stream.destroy();
    else if (typeof stream.cancel === 'function') Promise.resolve(stream.cancel()).catch(() => undefined);
  } catch (_) { /* bodyless response cleanup is best effort */ }
}

function finalResponse(value, requestMethod = 'GET') {
  if (value === undefined || value === null) return Object.freeze({ status: 204, kind: 'empty', bodyClass: 'structured', headers: [], body: '' });
  if (value && value.bodyClass === 'opaque') {
    const allowsBody = responseAllowsBody(value.status, requestMethod);
    if (!allowsBody) releaseDiscardedStream(value.bodyStream);
    const detached = runtimeApi.opaque.detach(value.bodyHandle, 'terminal-response-handoff');
    return Object.freeze({
      status: Number(value.status || 200),
      kind: 'stream',
      bodyClass: 'opaque',
      headers: normalizeHeaders(value.headers),
      bodyHandle: detached,
      bodyStream: allowsBody ? value.bodyStream : undefined,
      responseRef: value.responseRef,
      streamRef: value.streamRef,
      hostOwnsStream: true,
      wasmOwnsBytes: false,
      streamResultAbiVersion: streamingContract.STREAM_RESULT_ABI_VERSION
    });
  }
  if (value && value.bodyClass === 'structured' && Object.prototype.hasOwnProperty.call(value, 'status')) {
    const body = responseAllowsBody(value.status, requestMethod)
      ? (Object.prototype.hasOwnProperty.call(value, 'body') ? value.body : (typeof value.text === 'function' ? value.text() : ''))
      : '';
    return Object.freeze({
      status: Number(value.status || 200),
      kind: String(value.kind || 'text'),
      bodyClass: 'structured',
      headers: normalizeHeaders(value.headers),
      body: body === undefined || body === null ? '' : String(body)
    });
  }
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'status')) {
    const allowsBody = responseAllowsBody(value.status, requestMethod);
    if (!allowsBody) releaseDiscardedStream(value.bodyStream);
    return Object.freeze({
      ...value,
      headers: normalizeHeaders(value.headers),
      body: allowsBody ? value.body : '',
      bodyStream: allowsBody ? value.bodyStream : undefined
    });
  }
  throw new CanonicalRuntimeError('ResponseEncodeError', 'PULSE_RESPONSE_ENCODE', 'Canonical handler returned a non-response value. Use ctx.json, ctx.text, ctx.response, or return ctx.fetch for opaque pass-through.', { valueType: typeof value });
}

function responseIsStructured(method, headers) {
  if (String(method).toUpperCase() === 'HEAD') return true;
  const contentType = String(headerValue(headers, 'content-type') || '').toLowerCase();
  return contentType.startsWith('text/')
    || contentType.includes('application/json')
    || contentType.includes('+json')
    || contentType.includes('application/xml')
    || contentType.includes('+xml')
    || contentType.includes('application/x-www-form-urlencoded');
}

function normalizeProviderAdapter(input = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Canonical host runtime requires a provider adapter.');
  const id = String(input.id || input.name || '').trim();
  if (!id) throw new TypeError('Canonical provider adapter requires an id.');
  const dispatchEffect = typeof input.dispatchEffect === 'function'
    ? input.dispatchEffect
    : (typeof input.dispatchFetch === 'function'
      ? (effect, context) => {
        if (effect.kind !== 'fetch') throw new CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_PROVIDER_CAPABILITY_UNSUPPORTED', `Canonical provider ${id} does not implement ${effect.kind}.`, { provider: id, kind: effect.kind, effectId: effect.id });
        return input.dispatchFetch(effect, context);
      }
      : undefined);
  if (!dispatchEffect) throw new TypeError(`Canonical provider ${id} must implement dispatchEffect() or dispatchFetch().`);
  return Object.freeze({
    id,
    version: String(input.version || `pulse.canonical-${id}-provider.v1`),
    createCapabilities: typeof input.createCapabilities === 'function' ? input.createCapabilities : () => ({}),
    dispatchEffect,
    prepareConditionalKv: typeof input.prepareConditionalKv === 'function' ? input.prepareConditionalKv.bind(input) : undefined,
    resultMetadata: typeof input.resultMetadata === 'function' ? input.resultMetadata : () => undefined,
    disposeExecution: typeof input.disposeExecution === 'function' ? input.disposeExecution : () => undefined
  });
}

function createCanonicalHostRuntime(options = {}) {
  const adapter = normalizeProviderAdapter(options.providerAdapter || options.provider);
  const runtimeTrace = [];
  const registry = options.continuationRegistry || createContinuationRegistry({ ttlMs: options.continuationTtlMs, clock: options.clock });

  async function execute(programModule, executionOptions = {}) {
    const input = { ...options, ...executionOptions };
    const budget = portableKv.createRequestBudget(input);
    try {
      budget.check();
      return await executeInvocation(programModule, { ...executionOptions, requestBudget: budget, signal: budget.signal,
        deadlineMonotonicMs: budget.deadlineMonotonicMs ?? input.deadlineMonotonicMs, kvClock: budget.deadlineMonotonicMs === undefined ? input.kvClock : budget.clock });
    } finally { if (!input.requestBudget) budget.close(); }
  }

  async function executeInvocation(programModule, executionOptions) {
    if (!programModule || typeof programModule.createHandler !== 'function') throw new TypeError('Canonical runtime requires a compiled canonical module.');
    const metadata = assertCanonicalProgramCompatibility(programModule);
    executionSequence += 1;
    const executionId = String(executionOptions.executionId || `canonical-${adapter.id}-${executionSequence}`);
    const maxEffects = normalizeMaxEffects(executionOptions.maxEffects ?? options.maxEffects);
    const invocations = createEffectInvocations(() => executionOptions.requestBudget.check());
    const continuationIds = [];
    const sensitiveValues = initialSensitiveValues({ ...options, ...executionOptions });
    let executionStatus = 'failed';
    let executionFailure;
    try {
    const trace = [];
    function recordTrace(...events) {
      for (const entry of events) {
        const safeEntry = redactRuntimeValue(entry, sensitiveValues);
        trace.push(safeEntry);
        runtimeTrace.push(safeEntry);
      }
      return trace.length;
    }
    const traceSink = Object.freeze({
      push: recordTrace,
      json(input, value) {
        const safeValue = value === undefined
          ? undefined
          : redactRuntimeValue(value, sensitiveValues);
        const safeHeaders = input.headers === undefined
          ? undefined
          : redactRuntimeValue(input.headers, sensitiveValues);
        recordTrace(jsonSemanticTrace.normalizeJsonTraceEvent({
          ...input,
          ...(safeHeaders === undefined ? {} : { headers: safeHeaders }),
          valueDigest: safeValue === undefined
            ? null
            : jsonSemanticTrace.semanticValueDigest(safeValue)
        }));
      }
    });
    const providerCapabilities = adapter.createCapabilities({ ...options, ...executionOptions, metadata, executionId, trace: traceSink });
    const schemaCodecs = programModule.schemaCodecs;
    const runtimeOptions = {
      ...options,
      ...executionOptions,
      strict: executionOptions.strict === undefined
        ? (metadata.json ? metadata.json.strict === true : options.strict === true)
        : executionOptions.strict === true,
      schemaCodecs,
      trace: traceSink,
      target: executionOptions.target || metadata.target || options.target || 'javascript',
      provider: adapter.id,
      reporting: executionOptions.reporting || options.reporting || loggingContract.DEFAULT_REPORTING_LEVEL,
      redactLogMessage(message) { return redactString(message, sensitiveValues); },
      capabilities: executionOptions.capabilities || providerCapabilities
    };
    const context = createCanonicalContext(runtimeOptions, traceSink);
    const resolutionOrder = [];
    let dispatchedEffects = 0;

    function executionContinuations() {
      return continuationIds.map(id => registry.get(id));
    }

    async function dispatchOne(effect) {
      executionOptions.requestBudget.check();
      const ticket = invocations.open(effect.id, effect.id);
      const normalized = normalizeProviderEffect(effect, schemaCodecs, runtimeOptions);
      const conditional = portableKv.isConditionalKv(normalized.kind);
      if (conditional) portableKv.registerKvRedactions(normalized, (value) => sensitiveValues.add(value));
      recordTrace({ ...effectTraceStart(adapter.id, executionId, normalized, sensitiveValues), invocationId: ticket.invocationId });
      dispatchedEffects += 1;
      try {
        const effectExecution = { ...options, ...executionOptions, metadata, executionId, invocationId: ticket.invocationId, trace: traceSink, registerRedactionValue: (value) => sensitiveValues.add(value), onKvObservation: recordTrace };
        let snapshot = conditional
          ? await portableKv.executeConditionalKv(normalized, adapter.prepareConditionalKv || ((_admitted, kvExecution) => () => adapter.dispatchEffect(normalized, kvExecution)), effectExecution, runtimeOptions)
          : await executionOptions.requestBudget.race(adapter.dispatchEffect(normalized, effectExecution));
        executionOptions.requestBudget.check();
        invocations.assertPending(ticket);
        if (normalized.kind === 'config.get' || normalized.kind === 'secret.get') {
          if (snapshot !== undefined && typeof snapshot !== 'string') {
            throw new CanonicalRuntimeError(
              'BindingValueError',
              'PULSE_BINDING_VALUE_INVALID',
              `Pulse ${normalized.kind} must resolve to a string or undefined.`,
              { capability: normalized.kind, name: normalized.name, receivedType: Array.isArray(snapshot) ? 'array' : snapshot === null ? 'null' : typeof snapshot }
            );
          }
          if (normalized.kind === 'secret.get' && typeof snapshot === 'string') sensitiveValues.add(snapshot);
        }
        if (normalized.kind === 'kv.get') snapshot = runtimeApi.body.immutableClone(snapshot);
        if (normalized.kind === 'kv.put' && typeof snapshot !== 'boolean') {
          throw new CanonicalRuntimeError(
            'KvAcknowledgementError',
            'PULSE_KV_ACK_INVALID',
            'Pulse KV put providers must resolve to a boolean acknowledgement.',
            { receivedType: Array.isArray(snapshot) ? 'array' : snapshot === null ? 'null' : typeof snapshot }
          );
        }
        if (normalized.kind === 'time.now') snapshot = require('@pulse-compute/runtime/host').normalizeTimeResult(snapshot);
        if (normalized.kind === 'event.emit' && snapshot !== undefined) {
          throw new CanonicalRuntimeError(
            'EventAcceptanceError',
            'PULSE_RUNTIME_EVENT_EMIT_ACCEPTANCE_INVALID',
            'Pulse event emit providers must acknowledge host acceptance with undefined.',
            { receivedType: Array.isArray(snapshot) ? 'array' : snapshot === null ? 'null' : typeof snapshot }
          );
        }
        const value = normalized.kind === 'fetch' || normalized.result === 'opaque-response'
          ? normalizeFetchResponse(snapshot, effect.id, adapter.id, schemaCodecs, {
              maxBytes: executionOptions.maxFetchBodyBytes
                || executionOptions.maxStructuredBodyBytes
                || executionOptions.maxBodyBytes
                || options.maxFetchBodyBytes
                || options.maxStructuredBodyBytes
                || options.maxBodyBytes,
              strict: runtimeOptions.strict,
              responseMode: normalized.kind === 'fetch' ? normalized.responseMode : normalized.result === 'opaque-response' ? 'opaque' : 'auto',
              trace: traceSink,
              target: runtimeOptions.target,
              provider: adapter.id,
              effectId: normalized.id,
              groupId: normalized.groupKey
            })
          : snapshot;
        resolutionOrder.push(effect.id);
        recordTrace({ ...effectTraceResolved(adapter.id, executionId, normalized, value), invocationId: ticket.invocationId });
        return invocations.settle(ticket, () => value);
      } catch (error) {
        // A request deadline outranks a capability's concurrent abort result.
        try { executionOptions.requestBudget.check(); } catch (failure) {
          if (typeof failure?.code === 'string' && failure.code.startsWith('PULSE_REQUEST_')) error = failure;
        }
        recordTrace(Object.freeze({ type: 'effect-failed', provider: adapter.id, executionId, effectId: effect.id, kind: normalized.kind, error: error.name || 'Error', code: error.code }));
        throw redactRuntimeError(error, sensitiveValues);
      }
    }

    async function dispatchGroup(effects) {
      const settled = await Promise.allSettled(effects.map(dispatchOne));
      const failures = settled
        .map((entry, index) => entry.status === 'rejected' ? Object.freeze({
          index,
          effectId: effects[index].id,
          kind: effects[index].kind,
          groupKey: effects[index].groupKey,
          error: entry.reason
        }) : undefined)
        .filter(Boolean);
      if (failures.length > 0) {
        const rawPrimary = failures[0].error;
        const primary = rawPrimary instanceof Error ? rawPrimary : new Error(String(rawPrimary));
        const keyed = failures.every((entry) => entry.groupKey !== undefined);
        primary.effectFailures = Object.freeze(failures.map((entry) => Object.freeze(keyed
          ? {
              key: String(entry.groupKey),
              index: entry.index,
              effectId: entry.effectId,
              kind: entry.kind,
              name: entry.error && entry.error.name,
              code: entry.error && entry.error.code
            }
          : { effectId: entry.effectId, name: entry.error && entry.error.name, code: entry.error && entry.error.code })));
        throw primary;
      }
      return settled.map((entry) => entry.value);
    }

    const pulse = Object.freeze({
      effect(effect, continuationId) { return Object.freeze({ protocol: canonicalRuntimeContract.CANONICAL_RUNTIME_PROTOCOL_VERSION, kind: 'effect', continuationId: String(continuationId), effect }); },
      group(effects, continuationId) { return Object.freeze({ protocol: canonicalRuntimeContract.CANONICAL_RUNTIME_PROTOCOL_VERSION, kind: 'group', continuationId: String(continuationId), effects: Object.freeze([...effects]) }); }
    });

    const generator = programModule.createHandler()(context.ctx, pulse);
    if (!generator || typeof generator.next !== 'function') throw new CanonicalRuntimeError('CanonicalHandlerProtocolError', 'PULSE_CANONICAL_HANDLER_PROTOCOL', 'Compiled canonical handler did not return a generator.');
    let step;
    try { executionOptions.requestBudget.check(); step = generator.next(); }
    catch (error) { error.execution = { executionId, trace: [...trace], continuations: executionContinuations() }; throw error; }

    while (!step.done) {
      const marker = step.value;
      if (!marker || marker.protocol !== canonicalRuntimeContract.CANONICAL_RUNTIME_PROTOCOL_VERSION || !canonicalRuntimeContract.CANONICAL_EFFECT_MARKER_KINDS.includes(marker.kind)) throw new CanonicalRuntimeError('CanonicalEffectProtocolError', 'PULSE_CANONICAL_EFFECT_PROTOCOL', 'Canonical handler yielded an unsupported runtime marker.', { marker });
      const effects = marker.kind === 'group' ? marker.effects : [marker.effect];
      const continuationId = `${executionId}:${invocations.execution}:${marker.continuationId}:${continuationIds.length + 1}`;
      registry.create({ id: continuationId, branchPoint: marker.continuationId, effectIds: effects.map((effect) => effect.id), ttlMs: executionOptions.continuationTtlMs || options.continuationTtlMs });
      continuationIds.push(continuationId);
      registry.wait(continuationId);
      recordTrace(Object.freeze({ type: 'continuation-waiting', provider: adapter.id, executionId, continuationId, effectIds: effects.map((effect) => effect.id) }));
      let value;
      try {
        if (dispatchedEffects + effects.length > maxEffects) {
          throw new CanonicalRuntimeError('EffectLimitError', 'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED',
            `Pulse request exceeded the maximum of ${maxEffects} request-owned effects.`,
            { effectCount: dispatchedEffects, pendingEffects: effects.length, maxEffects });
        }
        value = marker.kind === 'group' ? await dispatchGroup(effects) : await dispatchOne(effects[0]);
        executionOptions.requestBudget.check();
        registry.resume(continuationId);
        recordTrace(Object.freeze({ type: 'continuation-resumed', provider: adapter.id, executionId, continuationId, branchPoint: marker.continuationId }));
        step = generator.next(value);
        registry.complete(continuationId);
      } catch (error) {
        const current = registry.get(continuationId);
        if (!['failed', 'expired', 'completed', 'cancelled'].includes(current.state)) {
          try { registry.fail(continuationId, error); } catch (_) { /* preserve primary failure */ }
        }
        recordTrace(Object.freeze({ type: 'continuation-failed', provider: adapter.id, executionId, continuationId, error: error.name || 'Error' }));
        error.execution = Object.freeze({ executionId, trace: Object.freeze([...trace]), continuations: Object.freeze(executionContinuations()), resolutionOrder: Object.freeze([...resolutionOrder]) });
        throw error;
      }
    }

    let response;
    try { executionOptions.requestBudget.check(); response = finalResponse(step.value, context.request.method); }
    catch (error) {
      error.execution = Object.freeze({ executionId, trace: Object.freeze([...trace]), continuations: Object.freeze(executionContinuations()), resolutionOrder: Object.freeze([...resolutionOrder]) });
      throw error;
    }
    recordTrace(Object.freeze({ type: 'execution-completed', provider: adapter.id, executionId, status: response.status, bodyClass: response.bodyClass }));
    executionStatus = 'completed';
    return Object.freeze({
      status: 'completed',
      version: String(options.runtimeVersion || CANONICAL_HOST_RUNTIME_VERSION),
      protocol: canonicalRuntimeContract.CANONICAL_RUNTIME_PROTOCOL_VERSION,
      provider: adapter.id,
      providerVersion: adapter.version,
      providerMetadata: adapter.resultMetadata({ ...options, ...executionOptions, metadata, executionId }),
      executionId,
      metadata,
      response,
      requestBodyStats: context.requestBody.stats(),
      effectCount: dispatchedEffects,
      resolutionOrder: Object.freeze([...resolutionOrder]),
      continuations: Object.freeze(executionContinuations()),
      trace: Object.freeze([...trace])
    });
    } catch (error) {
      executionFailure = redactRuntimeError(error, sensitiveValues);
      throw executionFailure;
    } finally {
      invocations.close();
      try { adapter.disposeExecution(Object.freeze({ executionId, metadata, status: executionStatus, error: executionFailure })); }
      catch (_) { /* provider cleanup must not mask execution results */ }
    }
  }

  return Object.freeze({
    version: String(options.runtimeVersion || CANONICAL_HOST_RUNTIME_VERSION),
    protocol: canonicalRuntimeContract.CANONICAL_RUNTIME_PROTOCOL_VERSION,
    provider: adapter.id,
    execute,
    registry,
    trace() { return Object.freeze([...runtimeTrace]); }
  });
}

async function executeCanonicalProgram(programModule, options = {}) {
  return createCanonicalHostRuntime(options).execute(programModule, options);
}

module.exports = {
  CANONICAL_HOST_RUNTIME_VERSION,
  CANONICAL_RUNTIME_PROTOCOL_VERSION: canonicalRuntimeContract.CANONICAL_RUNTIME_PROTOCOL_VERSION,
  CANONICAL_EFFECT_PROTOCOL_VERSION: canonicalRuntimeContract.CANONICAL_RUNTIME_PROTOCOL_VERSION,
  CanonicalRuntimeError,
  assertCanonicalProgramCompatibility,
  createCanonicalHostRuntime,
  createRequestBudget: portableKv.createRequestBudget,
  executeCanonicalProgram,
  createCanonicalContext,
  normalizeFetchResponse,
  normalizeFetchEffect,
  normalizeProviderEffect,
  normalizedInit,
  urlParts,
  finalResponse,
  redactedHeaders,
  redactRuntimeError,
  redactRuntimeValue,
  responseIsStructured,
  createStructuredFetchResponse,
  createOpaqueFetchResponse,
  normalizeHeaders,
  headerValue
};
