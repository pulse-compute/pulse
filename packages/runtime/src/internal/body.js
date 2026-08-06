'use strict';

const { PulseRuntimeContractError } = require('./errors.js');

const DEFAULT_STRUCTURED_BODY_BYTES = 65_536;

function normalizeBodyLimit(value, fallback = DEFAULT_STRUCTURED_BODY_BYTES) {
  const limit = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError('Pulse structured body limits must be positive safe integers.');
  }
  return limit;
}

function normalizeContentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function classifyContentType(value) {
  const normalized = normalizeContentType(value);
  if (!normalized) return 'unknown';
  if (normalized === 'application/json' || normalized.endsWith('+json')) return 'json';
  if (normalized.startsWith('text/')) return 'text';
  if ([
    'application/javascript',
    'application/xml',
    'application/xhtml+xml',
    'application/x-www-form-urlencoded'
  ].includes(normalized) || normalized.endsWith('+xml')) return 'text';
  return 'opaque';
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (isPlainRecord(value)) {
    const output = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(output, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: clonePlain(value[key])
      });
    }
    return output;
  }
  return value;
}

function deepFreeze(value) {
  if ((Array.isArray(value) || isPlainRecord(value)) && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function immutableClone(value) {
  return deepFreeze(clonePlain(value));
}

function contentLength(headers) {
  if (!headers || typeof headers.get !== 'function') return undefined;
  const raw = headers.get('content-length');
  if (raw == null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function bodyError(code, message, detail, cause) {
  return new PulseRuntimeContractError(code, message, {
    detail: Object.freeze({ ...(detail || {}) }),
    cause
  });
}

function bodyUnavailable(label, detail, cause) {
  return bodyError(
    'PULSE_BODY_UNAVAILABLE',
    `Pulse ${label} body is unavailable or was consumed outside its request-owned body projection.`,
    detail,
    cause
  );
}

function bodyTooLarge(label, bytes, maxBytes) {
  return bodyError(
    'PULSE_BODY_TOO_LARGE',
    `Pulse ${label} body exceeds the ${maxBytes} byte structured-body limit.`,
    { bytes, maxBytes }
  );
}

function opaqueInspection(label, contentType) {
  return bodyError(
    'PULSE_OPAQUE_BODY_INSPECTION',
    `Pulse ${label} body is opaque and may only be returned as a host-owned response.`,
    { contentType: String(contentType || ''), contentClass: 'opaque' }
  );
}

function bodyAborted(label, reason) {
  if (reason instanceof PulseRuntimeContractError) return reason;
  return bodyError(
    'PULSE_RUNTIME_EFFECT_ABORTED',
    `Pulse ${label} body read was aborted with its request.`,
    { reason: reason && reason.name ? reason.name : typeof reason },
    reason
  );
}

async function readBodyBytes(owner, maxBytes, label, signal) {
  if (!owner || typeof owner !== 'object') throw bodyUnavailable(label, { reason: 'missing-owner' });
  const declared = contentLength(owner.headers);
  if (declared !== undefined && declared > maxBytes) throw bodyTooLarge(label, declared, maxBytes);
  if (owner.bodyUsed) throw bodyUnavailable(label, { reason: 'already-consumed' });
  if (signal && signal.aborted) throw bodyAborted(label, signal.reason);
  if (owner.body == null) return new Uint8Array(0);

  if (typeof owner.body.getReader !== 'function') {
    if (typeof owner.arrayBuffer !== 'function') throw bodyUnavailable(label, { reason: 'reader-unavailable' });
    let buffer;
    try {
      buffer = new Uint8Array(await owner.arrayBuffer());
    } catch (error) {
      if (signal && signal.aborted) throw bodyAborted(label, signal.reason);
      throw bodyUnavailable(label, { reason: 'read-failed' }, error);
    }
    if (buffer.byteLength > maxBytes) throw bodyTooLarge(label, buffer.byteLength, maxBytes);
    return buffer;
  }

  const reader = owner.body.getReader();
  const chunks = [];
  let bytes = 0;
  let removeAbortListener;
  if (signal && typeof signal.addEventListener === 'function') {
    const onAbort = () => {
      Promise.resolve(reader.cancel(bodyAborted(label, signal.reason))).catch(() => undefined);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
  }

  try {
    while (true) {
      if (signal && signal.aborted) throw bodyAborted(label, signal.reason);
      const result = await reader.read();
      if (signal && signal.aborted) throw bodyAborted(label, signal.reason);
      if (result.done) break;
      const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value || 0);
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        const error = bodyTooLarge(label, bytes, maxBytes);
        // Stop the request-owned structured projection as soon as the bound
        // is crossed. Cancellation is best effort and must not mask the size error.
        try { Promise.resolve(reader.cancel(error)).catch(() => undefined); } catch (_) { /* best effort */ }
        throw error;
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof PulseRuntimeContractError) throw error;
    if (signal && signal.aborted) throw bodyAborted(label, signal.reason);
    throw bodyUnavailable(label, { reason: 'read-failed', bytes }, error);
  } finally {
    if (removeAbortListener) removeAbortListener();
    try { reader.releaseLock(); } catch (_) { /* already released */ }
  }

  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function createStructuredBodyReader(owner, options = {}) {
  const label = String(options.label || 'structured');
  const maxBytes = normalizeBodyLimit(options.maxBytes);
  const contentType = String(options.contentType || owner?.headers?.get?.('content-type') || '');
  const contentClass = classifyContentType(contentType);
  const forceStructured = options.forceStructured === true;
  const signal = options.signal;
  let bytesPromise;
  let textPromise;
  let jsonPromise;

  function assertInspectable() {
    if (!forceStructured && contentClass === 'opaque') throw opaqueInspection(label, contentType);
  }

  function bytes() {
    assertInspectable();
    if (!bytesPromise) bytesPromise = readBodyBytes(owner, maxBytes, label, signal);
    return bytesPromise;
  }

  function text() {
    assertInspectable();
    if (!textPromise) textPromise = bytes().then((value) => new TextDecoder().decode(value));
    return textPromise;
  }

  function json() {
    assertInspectable();
    if (!jsonPromise) {
      jsonPromise = text().then((value) => {
        try {
          return immutableClone(JSON.parse(value));
        } catch (error) {
          throw bodyError(
            'PULSE_BODY_DECODE',
            `Pulse ${label} body could not be decoded as JSON.`,
            { contentType, contentClass },
            error
          );
        }
      });
    }
    return jsonPromise;
  }

  return Object.freeze({
    label,
    maxBytes,
    contentType,
    contentClass,
    bodyClass: !forceStructured && contentClass === 'opaque' ? 'opaque' : 'structured',
    bytes,
    text,
    json,
    hasSnapshot() { return Boolean(bytesPromise); }
  });
}

module.exports = Object.freeze({
  DEFAULT_STRUCTURED_BODY_BYTES,
  classifyContentType,
  createStructuredBodyReader,
  deepFreeze,
  immutableClone,
  normalizeBodyLimit,
  normalizeContentType,
  readBodyBytes
});
