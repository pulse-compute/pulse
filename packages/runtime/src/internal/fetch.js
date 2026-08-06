'use strict';

const { PulseRuntimeContractError } = require('./errors.js');
const { encodeSchemaValue, requireExplicitSchemaId } = require('./schema.js');

const SUPPORTED_FETCH_METHODS = Object.freeze(new Set(['GET', 'HEAD', 'POST']));
const SUPPORTED_FETCH_INIT_FIELDS = Object.freeze(new Set(['method', 'headers', 'body', 'json', 'schema', 'timeoutMs']));

function fetchContractError(code, message, detail, cause) {
  return new PulseRuntimeContractError(code, message, {
    cause,
    detail: detail === undefined ? undefined : Object.freeze({ ...detail })
  });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeFetchUrl(value) {
  if (typeof value !== 'string') {
    throw fetchContractError('PULSE_FETCH_URL_INVALID', 'Pulse fetch URLs must be absolute HTTP or HTTPS strings.', {
      type: typeof value
    });
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw fetchContractError('PULSE_FETCH_URL_INVALID', `Invalid Pulse fetch URL ${String(value)}.`, { url: String(value) }, error);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw fetchContractError(
      'PULSE_FETCH_URL_INVALID',
      `Pulse fetch only supports absolute HTTP and HTTPS URLs; received ${parsed.protocol || '<none>'}.`,
      { url: parsed.toString(), protocol: parsed.protocol }
    );
  }
  return parsed.toString();
}

function normalizeTimeout(value) {
  if (value === undefined) return undefined;
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw fetchContractError(
      'PULSE_FETCH_TIMEOUT_INVALID',
      'Pulse fetch timeoutMs must be a positive safe integer.',
      { timeoutMs: value }
    );
  }
  return timeoutMs;
}

function validateHeader(name, value) {
  if (typeof name !== 'string' || typeof value !== 'string') {
    throw fetchContractError(
      'PULSE_FETCH_HEADERS_INVALID',
      'Pulse fetch header names and values must be strings.',
      { nameType: typeof name, valueType: typeof value }
    );
  }
  try {
    const validation = new Headers();
    validation.append(name, value);
  } catch (error) {
    throw fetchContractError(
      'PULSE_FETCH_HEADERS_INVALID',
      `Pulse fetch header ${JSON.stringify(name)} is invalid.`,
      { name },
      error
    );
  }
  return Object.freeze([name, value]);
}

function normalizeFetchHeaders(input) {
  if (input === undefined) return Object.freeze([]);
  const pairs = [];
  if (Array.isArray(input)) {
    for (const pair of input) {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw fetchContractError(
          'PULSE_FETCH_HEADERS_INVALID',
          'Pulse fetch headers must contain [name, value] pairs.'
        );
      }
      pairs.push(validateHeader(pair[0], pair[1]));
    }
    return Object.freeze(pairs);
  }
  if (!isPlainRecord(input)) {
    throw fetchContractError(
      'PULSE_FETCH_HEADERS_INVALID',
      'Pulse fetch headers must be a string record or [name, value] pairs.'
    );
  }
  for (const [name, value] of Object.entries(input)) pairs.push(validateHeader(name, value));
  return Object.freeze(pairs);
}

function hasHeader(headers, name) {
  const normalized = String(name).toLowerCase();
  return headers.some(([header]) => header.toLowerCase() === normalized);
}

function normalizeFetchInit(input, options = {}) {
  if (input !== undefined && !isPlainRecord(input)) {
    throw fetchContractError('PULSE_FETCH_INIT_INVALID', 'Pulse fetch init must be an ordinary object.');
  }
  const value = input || {};
  for (const field of Object.keys(value)) {
    if (!SUPPORTED_FETCH_INIT_FIELDS.has(field)) {
      throw fetchContractError(
        'PULSE_FETCH_INIT_FIELD_UNSUPPORTED',
        `Pulse fetch init field ${JSON.stringify(field)} is outside the portable contract.`,
        { field }
      );
    }
  }

  const method = value.method === undefined ? 'GET' : String(value.method).toUpperCase();
  if (!SUPPORTED_FETCH_METHODS.has(method)) {
    throw fetchContractError(
      'PULSE_FETCH_METHOD_UNSUPPORTED',
      `Pulse fetch method ${method} is outside the portable GET, HEAD, and POST contract.`,
      { method }
    );
  }

  const headers = [...normalizeFetchHeaders(value.headers)];
  const hasBody = Object.prototype.hasOwnProperty.call(value, 'body');
  const hasJson = Object.prototype.hasOwnProperty.call(value, 'json');
  const hasSchema = Object.prototype.hasOwnProperty.call(value, 'schema');
  if (hasBody && hasJson) {
    throw fetchContractError(
      'PULSE_FETCH_BODY_AMBIGUOUS',
      'Pulse fetch init accepts either body or json, not both.'
    );
  }
  if (hasSchema && !hasJson) {
    throw fetchContractError(
      'PULSE_FETCH_SCHEMA_WITHOUT_JSON',
      'Pulse fetch schema is only valid together with the semantic json field.'
    );
  }
  const schemaId = hasSchema
    ? requireExplicitSchemaId(value.schema, options, 'fetch-request')
    : undefined;

  let body;
  let bodyMode = 'none';
  if (hasBody) {
    if (typeof value.body !== 'string') {
      throw fetchContractError('PULSE_FETCH_BODY_INVALID', 'Pulse fetch body must be a string.', { type: typeof value.body });
    }
    body = value.body;
    bodyMode = 'text';
  } else if (hasJson) {
    if (!hasHeader(headers, 'content-type')) {
      headers.push(Object.freeze(['content-type', 'application/json; charset=utf-8']));
    }
    const encoded = encodeSchemaValue(schemaId, value.json, options, {
      source: 'fetch-request',
      headers,
      contentType: headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1],
      operationId: options.operationId || 'fetch-request:encode',
      effectId: options.effectId
    });
    body = encoded.text;
    bodyMode = 'json';
  }

  if ((method === 'GET' || method === 'HEAD') && bodyMode !== 'none') {
    throw fetchContractError(
      'PULSE_FETCH_BODY_METHOD_UNSUPPORTED',
      `Pulse ${method} fetch operations cannot include a body.`,
      { method, bodyMode }
    );
  }

  return Object.freeze({
    method,
    headers: Object.freeze(headers),
    body,
    bodyMode,
    ...(hasSchema ? { schema: schemaId } : {}),
    timeoutMs: normalizeTimeout(value.timeoutMs)
  });
}

function normalizeFetchRequest(url, init, options = {}) {
  return Object.freeze({ url: normalizeFetchUrl(url), init: normalizeFetchInit(init, options) });
}

function fetchRequestInitForHost(init, signal) {
  const normalized = init && typeof init === 'object' && typeof init.bodyMode === 'string'
    ? init
    : normalizeFetchInit(init);
  const headers = new Headers();
  for (const [name, value] of normalized.headers) headers.append(name, value);
  return Object.freeze({
    method: normalized.method,
    headers,
    body: normalized.bodyMode === 'none' ? undefined : normalized.body,
    signal,
    redirect: 'follow'
  });
}

module.exports = Object.freeze({
  SUPPORTED_FETCH_INIT_FIELDS,
  SUPPORTED_FETCH_METHODS,
  fetchRequestInitForHost,
  normalizeFetchHeaders,
  normalizeFetchInit,
  normalizeFetchRequest,
  normalizeFetchUrl
});
