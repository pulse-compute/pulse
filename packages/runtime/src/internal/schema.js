'use strict';

const { PulseRuntimeContractError } = require('./errors.js');

function schemaRuntimeError(code, message, detail, cause) {
  const error = new PulseRuntimeContractError(code, message, {
    detail: detail === undefined ? undefined : Object.freeze({ ...detail }),
    cause
  });
  if (code === 'PULSE_BODY_TOO_LARGE') error.name = 'BodyTooLargeError';
  else if (code === 'PULSE_SCHEMA_CONTENT_TYPE' || code === 'PULSE_SCHEMA_JSON_MALFORMED' || code === 'PULSE_SCHEMA_DECODE') error.name = 'SchemaDecodeError';
  else if (code === 'PULSE_SCHEMA_ENCODE') error.name = 'SchemaEncodeError';
  else if (
    code === 'PULSE_SCHEMA_REQUIRED'
    || code === 'PULSE_SCHEMA_REFERENCE'
    || code === 'PULSE_SCHEMA_CODECS_UNAVAILABLE'
    || code === 'PULSE_SCHEMA_ID_INVALID'
    || code === 'PULSE_RESPONSE_CASE_REFERENCE'
    || code === 'PULSE_RESPONSE_DESCRIPTOR_INVALID'
  ) error.name = 'SchemaReferenceError';
  return error;
}

function schemaCodecs(options = {}) {
  const codecs = options.schemaCodecs;
  return codecs && typeof codecs === 'object' ? codecs : undefined;
}

function schemaRegistry(options = {}) {
  return schemaCodecs(options)?.registry;
}

function strictSchemaPolicy(options = {}) {
  const codecs = schemaCodecs(options);
  return options.strict === true
    && Boolean(codecs && Array.isArray(codecs.ids) && codecs.ids.length > 0);
}

function requireSchemaCodecs(options, schemaId, source) {
  const codecs = schemaCodecs(options);
  if (!codecs || typeof codecs.has !== 'function' || typeof codecs.decodeJsonText !== 'function' || typeof codecs.encodeJsonText !== 'function') {
    throw schemaRuntimeError(
      'PULSE_SCHEMA_CODECS_UNAVAILABLE',
      `Pulse cannot use schema ${JSON.stringify(String(schemaId))} because the project codec registry is unavailable.`,
      { schemaId: String(schemaId), source }
    );
  }
  if (!codecs.has(String(schemaId))) {
    throw schemaRuntimeError(
      'PULSE_SCHEMA_REFERENCE',
      `Unknown compiled schema ${String(schemaId)}.`,
      { schemaId: String(schemaId), source }
    );
  }
  return codecs;
}

function requireSchemaValueCodecs(options, schemaId, source) {
  const codecs = schemaCodecs(options);
  if (!codecs || typeof codecs.has !== 'function' || typeof codecs.decode !== 'function') {
    throw schemaRuntimeError(
      'PULSE_SCHEMA_CODECS_UNAVAILABLE',
      `Pulse cannot use schema ${JSON.stringify(String(schemaId))} because in-memory project codecs are unavailable.`,
      { schemaId: String(schemaId), source }
    );
  }
  if (!codecs.has(String(schemaId))) {
    throw schemaRuntimeError(
      'PULSE_SCHEMA_REFERENCE',
      `Unknown compiled schema ${String(schemaId)}.`,
      { schemaId: String(schemaId), source }
    );
  }
  return codecs;
}

function requireSchemaId(schemaId, options, source) {
  if (schemaId === undefined) {
    if (strictSchemaPolicy(options)) {
      throw schemaRuntimeError(
        'PULSE_SCHEMA_REQUIRED',
        `Strict Pulse ${source} JSON requires a registered schema ID.`,
        { source, strict: true }
      );
    }
    return undefined;
  }
  return requireExplicitSchemaId(schemaId, options, source);
}

function requireExplicitSchemaId(schemaId, options, source) {
  if (typeof schemaId !== 'string' || schemaId.length === 0) {
    throw schemaRuntimeError(
      'PULSE_SCHEMA_ID_INVALID',
      'Pulse schema IDs must be non-empty strings.',
      { source, schemaIdType: typeof schemaId }
    );
  }
  requireSchemaCodecs(options, schemaId, source);
  return schemaId;
}

function validateSchemaValue(schemaId, value, options = {}, context = {}) {
  const source = String(context.source || 'json-value');
  if (typeof schemaId !== 'string' || schemaId.length === 0) {
    throw schemaRuntimeError(
      'PULSE_SCHEMA_ID_INVALID',
      'Pulse schema IDs must be non-empty strings.',
      { source, schemaIdType: typeof schemaId }
    );
  }
  const codecs = requireSchemaValueCodecs(options, schemaId, source);
  return codecs.decode(schemaId, value, source);
}

function headerValue(headers, name) {
  const lower = String(name).toLowerCase();
  if (headers && typeof headers.get === 'function') return headers.get(lower) || '';
  const entries = Array.isArray(headers) ? headers : Object.entries(headers || {});
  const match = entries.find(([key]) => String(key).toLowerCase() === lower);
  return match ? String(match[1]) : '';
}

function normalizeContentType(value) {
  return String(value || '').trim().toLowerCase().replace(/[ \t]+/g, ' ');
}

function assertSchemaContentType(options, headers, schemaId, source) {
  const policy = String(schemaRegistry(options)?.contentTypePolicy || 'accept-json-or-missing');
  const contentType = normalizeContentType(headerValue(headers, 'content-type'));
  const mediaType = contentType.split(';')[0].trim();
  const json = mediaType === 'application/json' || mediaType.endsWith('+json');
  if (json || (!contentType && policy === 'accept-json-or-missing')) return contentType;
  throw schemaRuntimeError(
    'PULSE_SCHEMA_CONTENT_TYPE',
    `Schema ${String(schemaId)} requires a JSON content type.`,
    { schemaId: String(schemaId), source, contentType, contentTypePolicy: policy }
  );
}

function utf8Bytes(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function assertSchemaBodySize(options, text, schemaId, source) {
  const configured = Number(schemaRegistry(options)?.maxBytes);
  let maxBytes = Number.isSafeInteger(configured) && configured > 0 ? configured : 65_536;
  const jsonLimits = schemaCodecs(options)?.schema?.(schemaId)?.jsonLimits;
  if (jsonLimits) {
    maxBytes = Math.min(maxBytes, jsonLimits.maxTextBytes);
    // UTF-16 length is a lower bound on UTF-8 bytes. Reject large application
    // strings before TextEncoder allocates their complete encoded form.
    if (typeof text === 'string' && text.length > maxBytes) {
      throw schemaRuntimeError('PULSE_BODY_TOO_LARGE', `Pulse ${source} schema body exceeds the ${maxBytes} byte limit.`,
        { schemaId: String(schemaId), source, bytesAtLeast: text.length, maxBytes });
    }
  }
  const bytes = utf8Bytes(text);
  if (bytes <= maxBytes) return bytes;
  throw schemaRuntimeError(
    'PULSE_BODY_TOO_LARGE',
    `Pulse ${source} schema body exceeds the ${maxBytes} byte limit.`,
    { schemaId: String(schemaId), source, bytes, maxBytes }
  );
}

function traceErrorFields(error) {
  const detail = error && (error.detail || error.details) || {};
  return {
    errorCode: error && error.code || 'PULSE_SCHEMA_OPERATION_FAILED',
    errorPath: detail.path || detail.field || null,
    expected: detail.expected || null,
    actualKind: detail.actualKind || detail.actual || null
  };
}

function emitSchemaTrace(options, event, value) {
  const codecs = schemaCodecs(options);
  if (!codecs || typeof codecs.createTraceEvent !== 'function' || typeof options.onJsonTrace !== 'function') return;
  const redact = typeof options.redactJsonTraceValue === 'function'
    ? options.redactJsonTraceValue
    : undefined;
  const headers = redact && event.headers !== undefined
    ? redact(event.headers)
    : event.headers;
  const normalized = codecs.createTraceEvent({
    ...event,
    ...(headers === undefined ? {} : { headers }),
    ...(value === undefined ? {} : { semanticValue: value }),
    target: event.target || options.target || 'javascript',
    provider: event.provider || options.provider || null
  }, {
    redact
  });
  options.onJsonTrace(normalized);
}

function decodeSchemaText(schemaId, text, options = {}, context = {}) {
  const source = String(context.source || 'json');
  const applicationText = source === 'application-text';
  const id = requireSchemaId(schemaId, options, source);
  if (id === undefined) {
    try {
      return JSON.parse(String(text));
    } catch (cause) {
      throw schemaRuntimeError('PULSE_BODY_DECODE', `Pulse ${source} body could not be decoded as JSON.`, { source }, cause);
    }
  }
  let contentType = normalizeContentType(headerValue(context.headers, 'content-type'));
  const event = {
    boundary: applicationText ? source : source === 'request' ? 'request' : 'fetch-response',
    schemaId: id,
    responseCaseId: null,
    operationId: String(context.operationId || `${source}:${id}`),
    status: context.status ?? null,
    headers: context.headers || [],
    bodyOwnership: applicationText ? 'application-owned' : source === 'request' ? 'request-snapshot' : 'fetched-response-snapshot',
    effectId: context.effectId || null,
    groupId: context.groupId || null
  };
  try {
    if (applicationText && typeof text !== 'string') {
      throw schemaRuntimeError('PULSE_SCHEMA_DECODE', 'Application JSON text must be a string.',
        { schemaId: id, source, expected: 'string', actualKind: typeof text });
    }
    if (!applicationText) contentType = assertSchemaContentType(options, context.headers, id, source);
    assertSchemaBodySize(options, text, id, source);
    const codecs = requireSchemaCodecs(options, id, source);
    const value = codecs.decodeJsonText(id, String(text), source);
    emitSchemaTrace(options, {
      ...event,
      kind: applicationText ? 'json.decode.text' : source === 'request' ? 'json.decode.request' : 'json.decode.fetch',
      contentType: contentType || null
    }, value);
    return value;
  } catch (error) {
    emitSchemaTrace(options, {
      ...event,
      kind: 'json.decode.error',
      contentType: contentType || null,
      ...traceErrorFields(error)
    });
    throw error;
  }
}

function encodeSchemaValue(schemaId, value, options = {}, context = {}) {
  const source = String(context.source || 'application-response');
  const id = requireSchemaId(schemaId, options, source);
  if (id === undefined) {
    let text;
    try {
      text = JSON.stringify(value);
    } catch (cause) {
      throw schemaRuntimeError('PULSE_RUNTIME_JSON_SERIALIZE_FAILED', `Pulse ${source} JSON could not be serialized.`, { source }, cause);
    }
    if (text === undefined) {
      throw schemaRuntimeError('PULSE_RUNTIME_JSON_SERIALIZE_FAILED', `Pulse ${source} JSON must serialize to a JSON value.`, { source });
    }
    return Object.freeze({ schemaId: null, text, value });
  }
  const codecs = requireSchemaCodecs(options, id, source);
  try {
    const text = codecs.encodeJsonText(id, value, source);
    if (source === 'application-value') assertSchemaBodySize(options, text, id, source);
    const normalized = codecs.decodeJsonText(id, text, `${source}-trace`);
    emitSchemaTrace(options, {
      kind: source === 'application-value' ? 'json.encode.value' : source === 'fetch-request' ? 'json.encode.fetch' : 'json.encode.response',
      boundary: source,
      schemaId: id,
      responseCaseId: context.responseCaseId || null,
      operationId: String(context.operationId || `${source}:${context.responseCaseId || id}`),
      status: context.status ?? null,
      contentType: normalizeContentType(context.contentType || 'application/json; charset=utf-8'),
      headers: context.headers || [],
      bodyOwnership: 'application-owned',
      effectId: context.effectId || null,
      groupId: context.groupId || null
    }, normalized);
    return Object.freeze({ schemaId: id, text, value: normalized });
  } catch (error) {
    emitSchemaTrace(options, {
      kind: 'json.encode.error',
      boundary: source,
      schemaId: id,
      responseCaseId: context.responseCaseId || null,
      operationId: String(context.operationId || `${source}:${context.responseCaseId || id}`),
      status: context.status ?? null,
      contentType: normalizeContentType(context.contentType || 'application/json; charset=utf-8'),
      headers: context.headers || [],
      bodyOwnership: 'application-owned',
      effectId: context.effectId || null,
      groupId: context.groupId || null,
      ...traceErrorFields(error)
    });
    throw error;
  }
}

function resolveResponseDescriptor(descriptor, options = {}) {
  if (typeof descriptor === 'string') {
    const codecs = schemaCodecs(options);
    const responseCase = codecs && typeof codecs.responseCase === 'function'
      ? codecs.responseCase(descriptor)
      : undefined;
    if (!responseCase) {
      throw schemaRuntimeError(
        'PULSE_RESPONSE_CASE_REFERENCE',
        `Unknown compiled response case ${descriptor}.`,
        { responseCaseId: descriptor, source: 'application-response' }
      );
    }
    requireSchemaId(String(responseCase.schemaId), options, 'application-response');
    return Object.freeze({
      responseCaseId: descriptor,
      schemaId: String(responseCase.schemaId),
      status: Number(responseCase.status),
      headers: undefined
    });
  }
  const value = descriptor === undefined ? {} : descriptor;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw schemaRuntimeError(
      'PULSE_RESPONSE_DESCRIPTOR_INVALID',
      'Pulse JSON response metadata must be an object or registered response-case ID.',
      { source: 'application-response', valueType: Array.isArray(value) ? 'array' : typeof value }
    );
  }
  const hasSchema = Object.prototype.hasOwnProperty.call(value, 'schema');
  const schemaId = hasSchema
    ? requireExplicitSchemaId(value.schema, options, 'application-response')
    : requireSchemaId(undefined, options, 'application-response');
  return Object.freeze({
    responseCaseId: null,
    schemaId,
    status: value.status,
    headers: value.headers
  });
}

module.exports = Object.freeze({
  assertSchemaBodySize,
  assertSchemaContentType,
  decodeSchemaText,
  emitSchemaTrace,
  encodeSchemaValue,
  requireSchemaCodecs,
  requireSchemaValueCodecs,
  requireExplicitSchemaId,
  requireSchemaId,
  resolveResponseDescriptor,
  schemaCodecs,
  schemaRegistry,
  strictSchemaPolicy,
  validateSchemaValue
});
