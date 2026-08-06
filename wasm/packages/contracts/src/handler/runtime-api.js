'use strict';

// Executable runtime primitives used by the canonical API runtime. This module
// intentionally contains behavior only: no pass metadata, confidence summaries,
// fixture catalogs, or generated-artifact declarations.

const ERROR_KINDS = Object.freeze({
  compile: 'CompileError',
  lowering: 'LoweringError',
  hostEffect: 'HostEffectError',
  fetchNetwork: 'FetchNetworkError',
  fetchTimeout: 'FetchTimeoutError',
  bodyTooLarge: 'BodyTooLargeError',
  bodyDecode: 'BodyDecodeError',
  bodyUnavailable: 'BodyUnavailableError',
  opaqueBodyInspection: 'OpaqueBodyInspectionError',
  responseEncode: 'ResponseEncodeError',
  continuationExpired: 'ContinuationExpiredError',
  continuationDoubleResume: 'ContinuationDoubleResumeError',
  providerCapabilityMissing: 'ProviderCapabilityMissingError'
});

const LIMITS = Object.freeze({
  structuredBodyBytes: 65_536,
  fetchTimeoutMs: 5_000
});

const OPAQUE_BODY_KINDS = Object.freeze(['binary', 'stream']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (isRecord(value)) {
    const out = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(out, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: clonePlain(value[key])
      });
    }
    return out;
  }
  return value;
}

function deepFreeze(value) {
  if ((Array.isArray(value) || isRecord(value)) && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function immutableClone(value) {
  return deepFreeze(clonePlain(value));
}

function normalizeHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) return headers.map(([name, value]) => [String(name), String(value)]);
  if (typeof headers.entries === 'function') return Array.from(headers.entries()).map(([name, value]) => [String(name), String(value)]);
  if (isRecord(headers)) return Object.entries(headers).map(([name, value]) => [String(name), String(value)]);
  return [];
}

function headerValue(headers, name) {
  const lower = String(name || '').toLowerCase();
  const match = normalizeHeaders(headers).find(([key]) => String(key).toLowerCase() === lower);
  return match ? match[1] : '';
}

function normalizeContentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function classifyContentType(value) {
  const normalized = normalizeContentType(value);
  if (!normalized) return 'unknown';
  if (normalized === 'application/json' || normalized.endsWith('+json')) return 'json';
  if (normalized.startsWith('text/')) return 'text';
  if (['application/javascript', 'application/xml', 'application/xhtml+xml', 'application/x-www-form-urlencoded'].includes(normalized)) return 'text';
  return 'opaque';
}

function utf8ByteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function runtimeValueError(kind, message, detail = {}) {
  return deepFreeze({
    ok: false,
    kind: 'runtime-value-error',
    error: kind,
    message: String(message),
    detail: immutableClone(detail)
  });
}

function readInputBody(input) {
  const source = input || {};
  if (!Object.prototype.hasOwnProperty.call(source, 'body')
      && !Object.prototype.hasOwnProperty.call(source, 'text')
      && !Object.prototype.hasOwnProperty.call(source, 'jsonText')) {
    return { available: false, text: '' };
  }
  const value = Object.prototype.hasOwnProperty.call(source, 'body')
    ? source.body
    : Object.prototype.hasOwnProperty.call(source, 'text')
      ? source.text
      : source.jsonText;
  return { available: true, text: Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '') };
}

function createStructuredBodyValue(input = {}, options = {}) {
  const configuredMax = Number(options.maxBytes);
  const maxBytes = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : LIMITS.structuredBodyBytes;
  const headers = normalizeHeaders(input.headers);
  const contentType = input.contentType || headerValue(headers, 'content-type');
  const contentClass = classifyContentType(contentType);
  const forceStructured = options.forceStructured === true;
  const body = readInputBody(input);
  const bytes = utf8ByteLength(body.text);
  const counters = { bodyCopies: 0, textTransforms: 0, jsonTransforms: 0, errors: 0 };
  let textMemo;
  let jsonMemo;

  function unavailableError() {
    counters.errors += 1;
    return runtimeValueError(ERROR_KINDS.bodyUnavailable, 'Structured body snapshot is unavailable from the provider boundary.', { contentType, contentClass });
  }

  function tooLargeError() {
    counters.errors += 1;
    return runtimeValueError(ERROR_KINDS.bodyTooLarge, `Structured body exceeds the ${maxBytes} byte limit.`, { bytes, maxBytes });
  }

  function inspectableError() {
    if (!forceStructured && contentClass === 'opaque') {
      counters.errors += 1;
      return runtimeValueError(ERROR_KINDS.opaqueBodyInspection, 'Opaque binary and stream bodies are pass-through only.', { contentType, contentClass });
    }
    if (!body.available) return unavailableError();
    if (bytes > maxBytes) return tooLargeError();
    return undefined;
  }

  function text() {
    if (textMemo) return textMemo;
    const rejected = inspectableError();
    if (rejected) {
      textMemo = rejected;
      return textMemo;
    }
    counters.bodyCopies += 1;
    counters.textTransforms += 1;
    textMemo = deepFreeze({
      ok: true,
      kind: 'structured-text',
      value: String(body.text),
      bytes,
      contentType: String(contentType || ''),
      contentClass,
      immutable: true,
      memoized: true
    });
    return textMemo;
  }

  function json() {
    if (jsonMemo) return jsonMemo;
    const textResult = text();
    if (!textResult.ok) {
      jsonMemo = textResult;
      return jsonMemo;
    }
    counters.jsonTransforms += 1;
    try {
      const parsed = JSON.parse(textResult.value);
      jsonMemo = deepFreeze({
        ok: true,
        kind: 'structured-json',
        value: immutableClone(parsed),
        jsonText: textResult.value,
        bytes,
        contentType: textResult.contentType,
        contentClass: contentClass === 'unknown' ? 'json' : contentClass,
        immutable: true,
        memoized: true
      });
    } catch (error) {
      counters.errors += 1;
      jsonMemo = runtimeValueError(ERROR_KINDS.bodyDecode, 'Structured JSON body could not be decoded.', {
        contentType,
        contentClass,
        message: error && error.message ? error.message : String(error)
      });
    }
    return jsonMemo;
  }

  return Object.freeze({
    kind: 'structured-body-value',
    bodyClass: !forceStructured && contentClass === 'opaque' ? 'opaque' : 'structured',
    contentType: String(contentType || ''),
    contentClass,
    maxBytes,
    bytes,
    text,
    json,
    stats() {
      return deepFreeze({
        ...counters,
        bodyAvailable: body.available,
        textMemoized: Boolean(textMemo),
        jsonMemoized: Boolean(jsonMemo)
      });
    }
  });
}

function defaultHeader(headers, name, value) {
  const normalized = normalizeHeaders(headers);
  if (!headerValue(normalized, name)) normalized.push([String(name), String(value)]);
  return normalized;
}

function createStructuredResponseBuilders(defaults = {}) {
  const configuredStatus = Number(defaults.status);
  const defaultStatus = Number.isFinite(configuredStatus) && configuredStatus > 0 ? configuredStatus : 200;
  function normalizeOptions(options = {}) {
    const configured = Number(options.status);
    return {
      status: Number.isFinite(configured) && configured > 0 ? configured : defaultStatus,
      headers: normalizeHeaders(options.headers)
    };
  }

  return Object.freeze({
    text(body, options = {}) {
      const normalized = normalizeOptions(options);
      const text = String(body ?? '');
      return deepFreeze({
        status: normalized.status,
        kind: 'text',
        bodyClass: 'structured',
        body: text,
        bytes: utf8ByteLength(text),
        headers: defaultHeader(normalized.headers, 'content-type', 'text/plain; charset=utf-8'),
        builder: 'ctx.text'
      });
    },
    json(value, options = {}) {
      const normalized = normalizeOptions(options);
      let body;
      try {
        body = JSON.stringify(value ?? null);
      } catch (error) {
        return runtimeValueError(ERROR_KINDS.responseEncode, 'Structured JSON response could not be encoded.', {
          message: error && error.message ? error.message : String(error)
        });
      }
      return deepFreeze({
        status: normalized.status,
        kind: 'json',
        bodyClass: 'structured',
        body,
        value: immutableClone(value ?? null),
        bytes: utf8ByteLength(body),
        headers: defaultHeader(normalized.headers, 'content-type', 'application/json; charset=utf-8'),
        builder: 'ctx.json'
      });
    },
    jsonText(body, options = {}, value) {
      const normalized = normalizeOptions(options);
      const text = String(body);
      try { JSON.parse(text); }
      catch (error) {
        return runtimeValueError(ERROR_KINDS.responseEncode, 'Structured JSON response codec returned malformed JSON.', {
          message: error && error.message ? error.message : String(error)
        });
      }
      return deepFreeze({
        status: normalized.status,
        kind: 'json',
        bodyClass: 'structured',
        body: text,
        value: immutableClone(value),
        bytes: utf8ByteLength(text),
        headers: defaultHeader(normalized.headers, 'content-type', 'application/json; charset=utf-8'),
        builder: 'ctx.json'
      });
    },
    response(input = {}) {
      const body = Object.prototype.hasOwnProperty.call(input, 'body') ? input.body : '';
      const configuredStatus = Number(input.status);
      const status = Number.isFinite(configuredStatus) && configuredStatus > 0 ? configuredStatus : defaultStatus;
      const headers = normalizeHeaders(input.headers);
      const text = String(body ?? '');
      const contentClass = classifyContentType(headerValue(headers, 'content-type'));
      if (contentClass === 'opaque') {
        return runtimeValueError(ERROR_KINDS.opaqueBodyInspection, 'ctx.response accepts structured bodies only; return an opaque fetch response directly.', { status });
      }
      return deepFreeze({
        status,
        kind: text.length === 0 ? 'empty' : (contentClass === 'json' ? 'json' : 'text'),
        bodyClass: 'structured',
        body: text,
        bytes: utf8ByteLength(text),
        headers,
        builder: 'ctx.response'
      });
    }
  });
}

function normalizeBodyKind(value) {
  const normalized = String(value || 'stream').trim().toLowerCase();
  return OPAQUE_BODY_KINDS.includes(normalized) ? normalized : 'stream';
}

function normalizeHandleId(value) {
  return String(value || 'opaque-body').trim().replace(/[^a-zA-Z0-9:_-]+/g, '-') || 'opaque-body';
}

function createOpaqueBodyHandle(input = {}) {
  const headers = normalizeHeaders(input.headers || (input.contentType ? [['content-type', input.contentType]] : []));
  const contentType = input.contentType || headerValue(headers, 'content-type') || 'application/octet-stream';
  const bodyKind = normalizeBodyKind(input.bodyKind || input.kind);
  const handleId = normalizeHandleId(input.id || input.handleId || `${bodyKind}-body`);
  return deepFreeze({
    ok: true,
    kind: 'opaque-body-handle',
    bodyClass: 'opaque',
    bodyKind,
    handleId,
    source: String(input.source || 'host-response'),
    ownership: 'host-owned',
    model: 'capability-handle',
    contentType: String(contentType),
    headers,
    status: Object.prototype.hasOwnProperty.call(input, 'status') ? Number(input.status) : undefined,
    byteLength: Number.isFinite(Number(input.byteLength)) ? Number(input.byteLength) : undefined,
    responseRef: Number.isFinite(Number(input.responseRef)) ? Number(input.responseRef) : undefined,
    streamRef: Number.isFinite(Number(input.streamRef)) ? Number(input.streamRef) : undefined,
    inspectable: false,
    mutable: false,
    iterable: false,
    transformable: false,
    passThroughOnly: true,
    userlandBytesVisible: false,
    bodyCopiedIntoWasm: false,
    traceBodyContents: false,
    providerSpecificUserland: false,
    lifecycle: Object.freeze({
      states: Object.freeze(['created', 'attached']),
      finalState: 'attached',
      detached: false,
      userVisibleContinuationToken: false
    })
  });
}

function opaqueError(message, detail = {}) {
  return runtimeValueError(ERROR_KINDS.opaqueBodyInspection, message, detail);
}

function denyOpaqueInspection(handle, helper = 'json') {
  const opaque = handle && handle.bodyClass === 'opaque' ? handle : createOpaqueBodyHandle({ id: 'opaque-inspection-denied' });
  return opaqueError(`Opaque ${opaque.bodyKind} bodies cannot be inspected with ${String(helper)}().`, {
    helper: String(helper),
    handleId: opaque.handleId,
    bodyKind: opaque.bodyKind,
    bodyClass: opaque.bodyClass,
    passThroughOnly: true,
    userlandBytesVisible: false,
    bodyCopiedIntoWasm: false,
    traceBodyContents: false
  });
}

function denyOpaqueMutation(handle, operation = 'mutate') {
  const opaque = handle && handle.bodyClass === 'opaque' ? handle : createOpaqueBodyHandle({ id: 'opaque-mutation-denied' });
  return opaqueError(`Opaque ${opaque.bodyKind} bodies are host-owned and cannot be ${String(operation)}d in userland.`, {
    operation: String(operation),
    handleId: opaque.handleId,
    bodyKind: opaque.bodyKind,
    mutable: false,
    passThroughOnly: true,
    bodyCopiedIntoWasm: false
  });
}

function createOpaquePassThroughResponse(input = {}) {
  const bodyHandle = input.bodyHandle && input.bodyHandle.bodyClass === 'opaque'
    ? input.bodyHandle
    : createOpaqueBodyHandle({
      id: input.handleId,
      bodyKind: input.bodyKind,
      contentType: input.contentType,
      headers: input.headers,
      status: input.status,
      source: input.source,
      responseRef: input.responseRef,
      streamRef: input.streamRef
    });
  const status = Number(Object.prototype.hasOwnProperty.call(input, 'status') ? input.status : (bodyHandle.status || 200));
  const headers = normalizeHeaders(input.headers || bodyHandle.headers || []);
  return deepFreeze({
    ok: true,
    kind: 'opaque-pass-through-response',
    status,
    bodyClass: 'opaque',
    bodyKind: bodyHandle.bodyKind,
    bodyHandle,
    headers,
    contentType: headerValue(headers, 'content-type') || bodyHandle.contentType,
    preserveStatus: true,
    preserveHeaders: true,
    preserveRepeatedHeaders: true,
    preserveBodyHandle: true,
    directFetchResponseReturn: input.directFetchResponseReturn === true,
    requestBodyForward: input.requestBodyForward === true,
    inspectable: false,
    mutable: false,
    passThroughOnly: true,
    userlandBytesVisible: false,
    bodyCopiedIntoWasm: false,
    traceBodyContents: false,
    providerSpecificUserland: false
  });
}

function detachOpaqueBodyHandle(handle, reason = 'terminal-response-handoff') {
  const opaque = handle && handle.bodyClass === 'opaque' ? handle : createOpaqueBodyHandle({ id: 'opaque-detached' });
  return deepFreeze({
    ...opaque,
    lifecycle: Object.freeze({
      states: Object.freeze(['created', 'attached', 'detached']),
      finalState: 'detached',
      detached: true,
      reason: String(reason),
      userVisibleContinuationToken: false
    })
  });
}

module.exports = Object.freeze({
  errors: ERROR_KINDS,
  limits: LIMITS,
  body: Object.freeze({
    deepFreeze,
    immutableClone,
    normalizeHeaders,
    headerValue,
    classifyContentType,
    createValue: createStructuredBodyValue,
    createResponseBuilders: createStructuredResponseBuilders
  }),
  opaque: Object.freeze({
    createBodyHandle: createOpaqueBodyHandle,
    createResponse: createOpaquePassThroughResponse,
    denyInspection: denyOpaqueInspection,
    denyMutation: denyOpaqueMutation,
    detach: detachOpaqueBodyHandle
  })
});
