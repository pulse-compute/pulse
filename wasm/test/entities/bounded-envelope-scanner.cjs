'use strict';

const DEFAULT_LIMITS = Object.freeze({
  maxEnvelopeBytes: 65_536,
  maxPayloadBytes: 32_768,
  maxMethodBytes: 256,
  maxDepth: 32
});

const RESERVED_KEYS = new Set(['jsonrpc', 'method', 'params', 'id']);

class EnvelopeScanError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'EnvelopeScanError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function failure(code, message, detail) {
  throw new EnvelopeScanError(code, message, detail);
}

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function byteLengthRange(value, start, end) {
  let bytes = 0;
  for (let index = start; index < end; index += 1) {
    const point = value.codePointAt(index);
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

function normalizeLimits(input = {}) {
  const limits = {};
  for (const [name, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const value = input[name] === undefined ? fallback : Number(input[name]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Envelope scanner limit ${name} must be a positive safe integer.`);
    }
    limits[name] = value;
  }
  return Object.freeze(limits);
}

function scanJsonRpcEnvelope(input, options = {}) {
  if (typeof input !== 'string') throw new TypeError('Envelope scanner input must be text.');
  const limits = normalizeLimits(options);
  const bytes = byteLength(input);
  if (bytes > limits.maxEnvelopeBytes) {
    failure('PULSE_ENTITIES_ENVELOPE_TOO_LARGE', 'JSON-RPC envelope exceeds its byte limit.', {
      bytes,
      maxBytes: limits.maxEnvelopeBytes
    });
  }

  const length = input.length;

  function whitespace(index) {
    while (index < length) {
      const code = input.charCodeAt(index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
      index += 1;
    }
    return index;
  }

  function scanString(index) {
    if (input.charCodeAt(index) !== 0x22) failure('PULSE_ENTITIES_JSON_MALFORMED', 'Expected a JSON string.', { offset: index });
    let cursor = index + 1;
    while (cursor < length) {
      const code = input.charCodeAt(cursor);
      if (code === 0x22) return cursor + 1;
      if (code < 0x20) failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON strings cannot contain control characters.', { offset: cursor });
      if (code === 0x5c) {
        cursor += 1;
        if (cursor >= length) failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON string escape is incomplete.', { offset: cursor });
        const escape = input[cursor];
        if ('"\\/bfnrt'.includes(escape)) {
          cursor += 1;
          continue;
        }
        if (escape !== 'u' || !/^[0-9a-fA-F]{4}$/.test(input.slice(cursor + 1, cursor + 5))) {
          failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON string escape is invalid.', { offset: cursor });
        }
        cursor += 5;
        continue;
      }
      cursor += 1;
    }
    failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON string is unterminated.', { offset: index });
  }

  function decodedString(start, end) {
    try {
      return JSON.parse(input.slice(start, end));
    } catch (_) {
      failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON string could not be decoded.', { offset: start });
    }
  }

  function scanNumber(index) {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(index));
    if (!match) failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON number is invalid.', { offset: index });
    return index + match[0].length;
  }

  function scanValue(index, depth) {
    const start = whitespace(index);
    if (start >= length) failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON value is missing.', { offset: start });
    if (depth > limits.maxDepth) {
      failure('PULSE_ENTITIES_JSON_TOO_DEEP', 'JSON value exceeds its nesting limit.', {
        depth,
        maxDepth: limits.maxDepth
      });
    }
    const token = input[start];
    if (token === '"') return scanString(start);
    if (token === '{') {
      let cursor = whitespace(start + 1);
      if (input[cursor] === '}') return cursor + 1;
      for (;;) {
        if (input[cursor] !== '"') failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON object key must be a string.', { offset: cursor });
        cursor = whitespace(scanString(cursor));
        if (input[cursor] !== ':') failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON object key must be followed by a colon.', { offset: cursor });
        cursor = whitespace(scanValue(cursor + 1, depth + 1));
        if (input[cursor] === '}') return cursor + 1;
        if (input[cursor] !== ',') failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON object members must be comma separated.', { offset: cursor });
        cursor = whitespace(cursor + 1);
      }
    }
    if (token === '[') {
      let cursor = whitespace(start + 1);
      if (input[cursor] === ']') return cursor + 1;
      for (;;) {
        cursor = whitespace(scanValue(cursor, depth + 1));
        if (input[cursor] === ']') return cursor + 1;
        if (input[cursor] !== ',') failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON array members must be comma separated.', { offset: cursor });
        cursor = whitespace(cursor + 1);
      }
    }
    if (input.startsWith('true', start)) return start + 4;
    if (input.startsWith('false', start)) return start + 5;
    if (input.startsWith('null', start)) return start + 4;
    if (token === '-' || (token >= '0' && token <= '9')) return scanNumber(start);
    failure('PULSE_ENTITIES_JSON_MALFORMED', 'JSON value has an invalid token.', { offset: start });
  }

  let cursor = whitespace(0);
  if (input[cursor] !== '{') failure('PULSE_ENTITIES_TOP_LEVEL_OBJECT_REQUIRED', 'JSON-RPC envelope must be one object.', { offset: cursor });
  cursor = whitespace(cursor + 1);
  const fields = new Map();
  const seenReserved = new Set();
  if (input[cursor] !== '}') {
    for (;;) {
      if (input[cursor] !== '"') failure('PULSE_ENTITIES_JSON_MALFORMED', 'Envelope key must be a JSON string.', { offset: cursor });
      const keyStart = cursor;
      const keyEnd = scanString(keyStart);
      const key = decodedString(keyStart, keyEnd);
      cursor = whitespace(keyEnd);
      if (input[cursor] !== ':') failure('PULSE_ENTITIES_JSON_MALFORMED', 'Envelope key must be followed by a colon.', { offset: cursor });
      const valueStart = whitespace(cursor + 1);
      const valueEnd = scanValue(valueStart, 1);
      if (RESERVED_KEYS.has(key)) {
        if (seenReserved.has(key)) {
          failure('PULSE_ENTITIES_DUPLICATE_RESERVED_KEY', `JSON-RPC envelope repeats reserved key ${JSON.stringify(key)}.`, { key });
        }
        seenReserved.add(key);
        fields.set(key, Object.freeze({ start: valueStart, end: valueEnd }));
      }
      cursor = whitespace(valueEnd);
      if (input[cursor] === '}') break;
      if (input[cursor] !== ',') failure('PULSE_ENTITIES_JSON_MALFORMED', 'Envelope members must be comma separated.', { offset: cursor });
      cursor = whitespace(cursor + 1);
    }
  }
  cursor = whitespace(cursor + 1);
  if (cursor !== length) failure('PULSE_ENTITIES_JSON_MALFORMED', 'Envelope has trailing content.', { offset: cursor });

  const versionField = fields.get('jsonrpc');
  const versionRaw = versionField && input.slice(versionField.start, versionField.end);
  if (!versionField || versionRaw !== '"2.0"') {
    failure('PULSE_ENTITIES_JSONRPC_VERSION_INVALID', 'JSON-RPC version must be the exact string "2.0".');
  }
  const methodField = fields.get('method');
  const methodRaw = methodField && input.slice(methodField.start, methodField.end);
  if (!methodField || !methodRaw.startsWith('"')) {
    failure('PULSE_ENTITIES_METHOD_INVALID', 'JSON-RPC method must be a non-empty string.');
  }
  const method = decodedString(methodField.start, methodField.end);
  const methodBytes = byteLength(method);
  if (method.length === 0 || methodBytes > limits.maxMethodBytes) {
    failure('PULSE_ENTITIES_METHOD_INVALID', 'JSON-RPC method must be a bounded non-empty string.', {
      bytes: methodBytes,
      maxBytes: limits.maxMethodBytes
    });
  }

  const paramsField = fields.get('params');
  const paramsBytes = paramsField && byteLengthRange(input, paramsField.start, paramsField.end);
  if (paramsField && paramsBytes > limits.maxPayloadBytes) {
    failure('PULSE_ENTITIES_PAYLOAD_TOO_LARGE', 'JSON-RPC params exceeds its byte limit.', {
      bytes: paramsBytes,
      maxBytes: limits.maxPayloadBytes
    });
  }
  const paramsRaw = paramsField && input.slice(paramsField.start, paramsField.end);

  const idField = fields.get('id');
  const idRaw = idField && input.slice(idField.start, idField.end);
  let idKind = 'absent';
  let idValue;
  if (idField) {
    if (idRaw === 'null') {
      idKind = 'null';
      idValue = null;
    } else if (idRaw.startsWith('"')) {
      idKind = 'string';
      idValue = decodedString(idField.start, idField.end);
    } else if (/^-?(?:0|[1-9]\d*)$/.test(idRaw)) {
      idValue = Number(idRaw);
      if (!Number.isSafeInteger(idValue)) {
        failure('PULSE_ENTITIES_ID_INVALID', 'JSON-RPC numeric IDs must be safe integers.', { raw: idRaw });
      }
      idKind = 'number';
    } else {
      failure('PULSE_ENTITIES_ID_INVALID', 'JSON-RPC ID must be a string, safe integer, null, or absent.', { raw: idRaw });
    }
  }

  return Object.freeze({
    version: 'pulse.entities-envelope-scan.v1',
    method,
    paramsPresent: Boolean(paramsField),
    paramsRaw,
    idPresent: Boolean(idField),
    idKind,
    idValue,
    idRaw,
    envelopeBytes: bytes
  });
}

module.exports = Object.freeze({
  DEFAULT_LIMITS,
  EnvelopeScanError,
  scanJsonRpcEnvelope
});
