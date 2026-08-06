'use strict';

const { createStructuredBodyReader, DEFAULT_STRUCTURED_BODY_BYTES, classifyContentType } = require('./body.js');
const { PulseRuntimeContractError, PulseUnhandledError } = require('./errors.js');
const {
  decodeSchemaText,
  encodeSchemaValue,
  requireSchemaId,
  resolveResponseDescriptor,
  strictSchemaPolicy
} = require('./schema.js');

const RESULT_DATA = new WeakMap();
const FETCH_RESPONSE_DATA = new WeakMap();
const RESPONSE_HEADER_DATA = new WeakMap();
const RESPONSE_BODY_CLASS_DATA = new WeakMap();
const RESULT_BRAND = Symbol('pulse.runtime.result');
const FETCH_RESPONSE_BRAND = Symbol('pulse.runtime.fetch-response');

function normalizeHeaders(input) {
  if (!input) return Object.freeze([]);
  const pairs = [];
  if (Array.isArray(input)) {
    for (const pair of input) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError('Pulse headers must be [name, value] pairs.');
      pairs.push(Object.freeze([String(pair[0]), String(pair[1])]));
    }
  } else if (input instanceof Headers) {
    for (const [name, value] of input.entries()) pairs.push(Object.freeze([name, value]));
    if (typeof input.getSetCookie === 'function') {
      const cookies = input.getSetCookie();
      if (cookies.length > 1) {
        for (let index = pairs.length - 1; index >= 0; index -= 1) {
          if (pairs[index][0].toLowerCase() === 'set-cookie') pairs.splice(index, 1);
        }
        for (const cookie of cookies) pairs.push(Object.freeze(['set-cookie', cookie]));
      }
    }
  } else if (typeof input === 'object') {
    for (const [name, value] of Object.entries(input)) pairs.push(Object.freeze([name, String(value)]));
  } else {
    throw new TypeError('Pulse headers must be a record, Headers, or [name, value] pairs.');
  }
  return Object.freeze(pairs);
}

function hasHeader(headers, name) {
  const lower = String(name).toLowerCase();
  return headers.some(([header]) => header.toLowerCase() === lower);
}

function appendDefaultHeader(headers, name, value) {
  if (hasHeader(headers, name)) return headers;
  return Object.freeze([...headers, Object.freeze([name, value])]);
}

function defineResult(publicFields, data) {
  const result = { ...publicFields };
  Object.defineProperty(result, RESULT_BRAND, { enumerable: false, value: true });
  RESULT_DATA.set(result, Object.freeze(data));
  return Object.freeze(result);
}

function createTextResult(value, options = {}) {
  const status = normalizeStatus(options.status, 200);
  const headers = appendDefaultHeader(normalizeHeaders(options.headers), 'content-type', 'text/plain; charset=utf-8');
  return defineResult({ status, kind: 'text', bodyClass: 'structured', headers }, { body: String(value) });
}

function createJsonResult(value, descriptor, executionOptions = {}) {
  const resolved = resolveResponseDescriptor(descriptor, executionOptions);
  const status = normalizeStatus(resolved.status, 200);
  const headers = appendDefaultHeader(normalizeHeaders(resolved.headers), 'content-type', 'application/json; charset=utf-8');
  const encoded = encodeSchemaValue(resolved.schemaId, value, executionOptions, {
    source: 'application-response',
    responseCaseId: resolved.responseCaseId,
    status,
    headers,
    contentType: headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1],
    operationId: `application-response:${resolved.responseCaseId || resolved.schemaId || 'generic'}`
  });
  return defineResult(
    { status, kind: 'json', bodyClass: 'structured', headers },
    {
      body: encoded.text,
      schema: resolved.schemaId,
      responseCase: resolved.responseCaseId,
      value: encoded.value
    }
  );
}

function createResponseResult(input = {}) {
  const status = normalizeStatus(input.status, 200);
  const headers = normalizeHeaders(input.headers);
  const body = input.body == null ? '' : String(input.body);
  return defineResult({ status, kind: 'response', bodyClass: 'structured', headers }, { body });
}

function normalizeStatus(value, fallback) {
  const status = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new TypeError(`Pulse response status must be an integer between 100 and 599; received ${String(value)}.`);
  }
  return status;
}

function isPulseResult(value) {
  return Boolean(value && typeof value === 'object' && RESULT_DATA.has(value));
}

function rememberResponseMetadata(response, headers, bodyClass = 'structured') {
  if (response instanceof Response) {
    RESPONSE_HEADER_DATA.set(response, Object.freeze([...headers]));
    RESPONSE_BODY_CLASS_DATA.set(response, bodyClass === 'opaque' ? 'opaque' : 'structured');
  }
  return response;
}

function markOpaqueResponse(response, headers = response && response.headers) {
  if (!(response instanceof Response)) {
    throw new TypeError('Pulse provider hosts can only mark Web Responses as opaque.');
  }
  return rememberResponseMetadata(response, normalizeHeaders(headers), 'opaque');
}

function statusAllowsBody(status) {
  const value = Number(status);
  return value !== 204 && value !== 205 && value !== 304 && !(value >= 100 && value < 200);
}

function responseAllowsBody(responseOrStatus, requestMethod = 'GET') {
  const status = responseOrStatus instanceof Response ? responseOrStatus.status : responseOrStatus;
  return String(requestMethod).toUpperCase() !== 'HEAD' && statusAllowsBody(status);
}

function responseIsStructured(response, requestMethod = 'GET') {
  if (!(response instanceof Response)) return false;
  if (!responseAllowsBody(response, requestMethod)) return true;
  return classifyContentType(response.headers.get('content-type')) !== 'opaque';
}

function resultToResponse(result, requestMethod = 'GET') {
  const data = RESULT_DATA.get(result);
  if (!data) throw new TypeError('Expected a Pulse result.');
  const headers = new Headers();
  for (const [name, value] of result.headers) headers.append(name, value);
  const body = responseAllowsBody(result.status, requestMethod) ? data.body : null;
  return rememberResponseMetadata(new Response(body, { status: result.status, headers }), result.headers, result.bodyClass);
}

function responseHeaderPairs(response) {
  const remembered = response instanceof Response ? RESPONSE_HEADER_DATA.get(response) : undefined;
  return remembered || normalizeHeaders(response.headers);
}

function responseBodyClass(response) {
  return response instanceof Response ? RESPONSE_BODY_CLASS_DATA.get(response) || 'structured' : 'structured';
}

function defineFetchResponse(publicFields, data) {
  const value = { ...publicFields };
  Object.defineProperty(value, FETCH_RESPONSE_BRAND, { enumerable: false, value: true });
  FETCH_RESPONSE_DATA.set(value, data);
  return Object.freeze(value);
}

function responseOwnershipConflict(current, requested) {
  return new PulseRuntimeContractError(
    'PULSE_FETCH_RESPONSE_OWNERSHIP_CONFLICT',
    `Pulse fetch response ownership is already ${current}; it cannot also be used as ${requested}.`,
    { detail: Object.freeze({ current, requested }) }
  );
}

function claimFetchResponse(data, mode) {
  if (data.ownershipMode && data.ownershipMode !== mode) {
    throw responseOwnershipConflict(data.ownershipMode, mode);
  }
  data.ownershipMode = mode;
}

function readerForFetchData(data, options = {}) {
  claimFetchResponse(data, 'structured-projection');
  if (data.bodyReader) return data.bodyReader;
  if (!(data.response instanceof Response)) return undefined;
  // Projection owns the provider response body. Reading the response directly
  // avoids teeing an unread pass-through branch, which could defeat the body
  // bound by buffering the whole upstream stream outside the snapshot.
  data.bodyReader = createStructuredBodyReader(data.response, {
    label: 'fetched response',
    maxBytes: options.maxBodyBytes === undefined ? data.maxBodyBytes : options.maxBodyBytes,
    forceStructured: true,
    signal: options.signal || data.signal
  });
  return data.bodyReader;
}

function opaqueInspectionError() {
  return new PulseRuntimeContractError(
    'PULSE_OPAQUE_BODY_INSPECTION',
    'Opaque Pulse bodies are host-owned pass-through values and cannot be inspected.'
  );
}

function opaqueBodyHandle(response, supplied) {
  if (supplied !== undefined) return supplied;
  if (!(response instanceof Response)) return undefined;
  return Object.freeze({
    kind: 'web-response-body',
    ownership: 'host-owned',
    passThroughOnly: true
  });
}

function headerAccessor(headers) {
  return function header(name) {
    const lower = String(name).toLowerCase();
    return headers.find(([headerName]) => headerName.toLowerCase() === lower)?.[1];
  };
}

/**
 * Explicit host helper for a response already materialized as a structured value.
 * Ordinary ctx.fetch roots are opaque; their text/json projections use one
 * bounded request-owned snapshot through projectFetchResponse().
 */
function wrapStructuredResponse(response, options = {}) {
  if (!(response instanceof Response)) throw new TypeError('Pulse fetch adapters must return a Web Response or Pulse fetch response.');
  const headers = responseHeaderPairs(response);
  const data = {
    response,
    bodyClass: 'structured',
    bodyReader: undefined,
    maxBodyBytes: options.maxBodyBytes === undefined ? DEFAULT_STRUCTURED_BODY_BYTES : options.maxBodyBytes,
    signal: options.signal,
    ownershipMode: undefined,
    schemaProjectionCache: new Map()
  };
  return defineFetchResponse({
    status: response.status,
    ok: response.ok,
    kind: 'response',
    bodyClass: 'structured',
    headers,
    header: headerAccessor(headers),
    text() { return readerForFetchData(data).text(); },
    json(schemaId) {
      if (schemaId === undefined && !strictSchemaPolicy(options)) return readerForFetchData(data).json();
      const key = schemaId === undefined ? '<missing>' : String(schemaId);
      if (!data.schemaProjectionCache.has(key)) {
        data.schemaProjectionCache.set(key, readerForFetchData(data).text().then((text) => decodeSchemaText(
          schemaId,
          text,
          options,
          {
            source: 'fetch-response',
            headers,
            status: response.status,
            operationId: `fetch-response:${options.effectId || key}`,
            effectId: options.effectId
          }
        )));
      }
      return data.schemaProjectionCache.get(key);
    }
  }, data);
}

function createOpaqueFetchResponse({ status, headers, bodyHandle, response, maxBodyBytes, signal } = {}) {
  const actualStatus = status === undefined
    ? (response instanceof Response ? response.status : 200)
    : status;
  const normalizedStatus = normalizeStatus(actualStatus, 200);
  const normalizedHeaders = normalizeHeaders(headers || response?.headers);
  const handle = opaqueBodyHandle(response, bodyHandle);
  const data = {
    response,
    bodyClass: 'opaque',
    bodyHandle: handle,
    bodyReader: undefined,
    maxBodyBytes: maxBodyBytes === undefined ? DEFAULT_STRUCTURED_BODY_BYTES : maxBodyBytes,
    signal,
    statusOverride: status !== undefined,
    ownershipMode: undefined,
    schemaProjectionCache: new Map()
  };
  return defineFetchResponse({
    status: normalizedStatus,
    ok: normalizedStatus >= 200 && normalizedStatus < 300,
    kind: 'stream',
    bodyClass: 'opaque',
    headers: normalizedHeaders,
    header: headerAccessor(normalizedHeaders),
    bodyHandle: handle,
    text() { throw opaqueInspectionError(); },
    json() { throw opaqueInspectionError(); }
  }, data);
}

function isPulseFetchResponse(value) {
  return Boolean(value && typeof value === 'object' && FETCH_RESPONSE_DATA.has(value));
}

function normalizeFetchResponse(value, options = {}) {
  if (isPulseFetchResponse(value)) return value;
  if (!(value instanceof Response)) {
    throw new TypeError('Pulse fetch adapters must resolve to a Web Response or Pulse fetch response.');
  }
  // The root fetch result is always host-owned. Returning or awaiting it does not
  // implicitly materialize bytes merely because a content type looks textual.
  // Explicit operation projections (`ctx.fetch(...).text/json`) retain bounded
  // access to the underlying Web Response through FETCH_RESPONSE_DATA below.
  return createOpaqueFetchResponse({
    response: value,
    maxBodyBytes: options.maxBodyBytes,
    signal: options.signal
  });
}

function projectFetchResponse(value, projection, schemaId, options = {}) {
  const data = FETCH_RESPONSE_DATA.get(value);
  if (!data) throw new TypeError('Expected a Pulse fetch response.');
  // A direct/awaited fetch root exposes only pass-through methods, but the
  // operation-owned projection path may claim and consume one bounded snapshot.
  // A provider body handle with no Web Response remains truly opaque.
  if (!(data.response instanceof Response) && data.bodyClass !== 'structured') throw opaqueInspectionError();
  const reader = readerForFetchData(data, options);
  if (!reader) throw opaqueInspectionError();
  if (projection === 'text') return reader.text();
  if (projection === 'json') {
    if (schemaId === undefined && !strictSchemaPolicy(options)) return reader.json();
    requireSchemaId(schemaId, options, 'fetch-response');
    const key = schemaId === undefined ? '<missing>' : String(schemaId);
    if (!data.schemaProjectionCache) data.schemaProjectionCache = new Map();
    if (!data.schemaProjectionCache.has(key)) {
      data.schemaProjectionCache.set(key, reader.text().then((text) => decodeSchemaText(
        schemaId,
        text,
        options,
        {
          source: 'fetch-response',
          headers: value.headers,
          status: value.status,
          operationId: `fetch-response:${options.effectId || key}`,
          effectId: options.effectId
        }
      )));
    }
    return data.schemaProjectionCache.get(key);
  }
  throw new PulseRuntimeContractError(
    'PULSE_RUNTIME_FETCH_PROJECTION_INVALID',
    `Pulse fetch projection ${JSON.stringify(String(projection))} is unsupported.`
  );
}

async function cancelResponseBody(response) {
  if (!(response instanceof Response) || !response.body || response.bodyUsed) return;
  try { await response.body.cancel(); } catch (_) { /* ownership cleanup is best effort */ }
}

async function fetchResponseToResponse(value, requestMethod = 'GET') {
  const data = FETCH_RESPONSE_DATA.get(value);
  if (!data) throw new TypeError('Expected a Pulse fetch response.');
  if (data.response instanceof Response) {
    claimFetchResponse(data, 'host-pass-through');
    const headers = value.headers || responseHeaderPairs(data.response);
    const bodyAllowed = responseAllowsBody(value.status, requestMethod);
    const statusChanged = data.statusOverride && value.status !== data.response.status;
    if (bodyAllowed && !statusChanged) {
      return rememberResponseMetadata(data.response, headers, value.bodyClass);
    }
    if (!bodyAllowed) await cancelResponseBody(data.response);
    return rememberResponseMetadata(
      new Response(bodyAllowed ? data.response.body : null, {
        status: value.status,
        ...(statusChanged ? {} : { statusText: data.response.statusText }),
        headers: data.response.headers
      }),
      headers,
      value.bodyClass
    );
  }
  if (data.bodyClass === 'opaque') {
    throw new PulseRuntimeContractError(
      'PULSE_RUNTIME_OPAQUE_RESPONSE_ADAPTER_REQUIRED',
      'The current JavaScript host cannot serialize this opaque response without a provider adapter.'
    );
  }
  throw new PulseRuntimeContractError('PULSE_RUNTIME_FETCH_RESPONSE_INVALID', 'Pulse fetch response data is incomplete.');
}

module.exports = Object.freeze({
  PulseRuntimeContractError,
  PulseUnhandledError,
  createJsonResult,
  createOpaqueFetchResponse,
  createResponseResult,
  createTextResult,
  fetchResponseToResponse,
  isPulseFetchResponse,
  isPulseResult,
  markOpaqueResponse,
  normalizeFetchResponse,
  normalizeHeaders,
  projectFetchResponse,
  responseAllowsBody,
  responseBodyClass,
  responseHeaderPairs,
  responseIsStructured,
  resultToResponse,
  statusAllowsBody,
  wrapStructuredResponse
});
