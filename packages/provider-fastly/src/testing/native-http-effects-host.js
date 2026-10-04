'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FASTLY_STATUS_OK = 0;
const FASTLY_STATUS_ERROR = 1;
const FASTLY_STATUS_BADF = 3;
const FASTLY_STATUS_BUFLEN = 4;
const FASTLY_STATUS_NONE = 10;

class FastlyNativeHttpEffectsMockError extends Error {
  constructor(message, code = 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_FAILED', detail = {}) {
    super(message);
    this.name = 'FastlyNativeHttpEffectsMockError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function normalizeHeaders(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(([name, value]) => [String(name), String(value)]);
  return Object.entries(input).flatMap(([name, value]) => Array.isArray(value)
    ? value.map((entry) => [String(name), String(entry)])
    : [[String(name), String(value)]]);
}

function normalizeBody(input) {
  if (Buffer.isBuffer(input)) return Buffer.from(input);
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input === undefined || input === null) return Buffer.alloc(0);
  if (typeof input === 'string') return Buffer.from(input);
  return Buffer.from(JSON.stringify(input));
}

function fixtureKey(backend, method, url) {
  return `${backend} ${method.toUpperCase()} ${url}`;
}

function resolveFixture(fixtures, backend, method, url) {
  if (!fixtures) return undefined;
  if (fixtures instanceof Map) {
    return fixtures.get(fixtureKey(backend, method, url))
      || fixtures.get(`${method.toUpperCase()} ${url}`)
      || fixtures.get(url);
  }
  return fixtures[fixtureKey(backend, method, url)]
    || fixtures[`${method.toUpperCase()} ${url}`]
    || fixtures[url]
    || (fixtures[backend] && (
      fixtures[backend][`${method.toUpperCase()} ${url}`]
      || fixtures[backend][url]
      || fixtures[backend][new URL(url).pathname]
    ));
}

function executeFastlyNativeHttpEffects(input, options = {}) {
  const wasm = Buffer.isBuffer(input)
    ? input
    : input && Buffer.isBuffer(input.wasm)
      ? input.wasm
      : fs.readFileSync(path.resolve(input));
  if (!WebAssembly.validate(wasm)) {
    throw new FastlyNativeHttpEffectsMockError('Pass97 mock host requires valid WebAssembly.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_INVALID_WASM');
  }

  const requestInput = options.request || {};
  const method = String(requestInput.method || 'GET').toUpperCase();
  const pathValue = String(requestInput.path || '/');
  const url = String(requestInput.url || `https://pulse.test${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`);
  const requestHeaders = normalizeHeaders(requestInput.headers);
  const trace = [];
  let nextHandle = 10;
  const typedHandleStarts = options.handleStarts && typeof options.handleStarts === 'object' ? options.handleStarts : {};
  const typedHandleNext = new Map();
  let instance;

  const requests = new Map();
  const bodies = new Map();
  const responses = new Map();
  const pending = new Map();
  const outboundRequests = [];
  const downstreamRequestHandle = 1;
  const downstreamBodyHandle = 2;
  requests.set(downstreamRequestHandle, { method, url, headers: requestHeaders.map((entry) => [...entry]) });
  bodies.set(downstreamBodyHandle, { bytes: normalizeBody(requestInput.body), readOffset: 0, writes: [] });
  let downstream;

  function alloc(kind = 'default') {
    if (Object.prototype.hasOwnProperty.call(typedHandleStarts, kind)) {
      const current = typedHandleNext.has(kind) ? typedHandleNext.get(kind) : Number(typedHandleStarts[kind]);
      if (!Number.isInteger(current) || current < 0) {
        throw new FastlyNativeHttpEffectsMockError('Mock host handle starts must be non-negative integers.', 'PULSE_FASTLY_NATIVE_MOCK_HANDLE_START_INVALID', { kind, value: typedHandleStarts[kind] });
      }
      typedHandleNext.set(kind, current + 1);
      return current;
    }
    return nextHandle++;
  }

  function memory() {
    const value = instance && instance.exports && instance.exports.memory;
    if (!(value instanceof WebAssembly.Memory)) {
      throw new FastlyNativeHttpEffectsMockError('Fastly native effects module did not export memory.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_MEMORY_MISSING');
    }
    return value;
  }

  function view() { return new DataView(memory().buffer); }
  function writeU32(pointer, value) { view().setUint32(Number(pointer), Number(value) >>> 0, true); }
  function readBytes(pointer, length) { return Buffer.from(new Uint8Array(memory().buffer, Number(pointer), Number(length))); }
  function readUtf8(pointer, length) { return readBytes(pointer, length).toString('utf8'); }

  function writeUtf8(value, pointer, maxLength, writtenOut) {
    const bytes = Buffer.from(String(value), 'utf8');
    writeU32(writtenOut, bytes.length);
    if (bytes.length > Number(maxLength)) return FASTLY_STATUS_BUFLEN;
    new Uint8Array(memory().buffer, Number(pointer), bytes.length).set(bytes);
    return FASTLY_STATUS_OK;
  }

  function headerValue(headers, name) {
    const target = String(name).toLowerCase();
    const found = headers.find(([headerName]) => String(headerName).toLowerCase() === target);
    return found && found[1];
  }

  function bodyBytes(handle) {
    const body = bodies.get(Number(handle));
    if (!body) return undefined;
    if (body.writes.length > 0) return Buffer.concat(body.writes);
    return body.bytes;
  }

  function makeOriginResponse(fixture) {
    const responseHandle = alloc('response');
    const bodyHandle = alloc('body');
    const normalized = fixture || {};
    const headers = normalizeHeaders(normalized.headers);
    let body = normalized.body;
    if (Object.prototype.hasOwnProperty.call(normalized, 'json')) {
      body = JSON.stringify(normalized.json);
      if (!headers.some(([name]) => name.toLowerCase() === 'content-type')) headers.push(['content-type', 'application/json; charset=utf-8']);
    }
    responses.set(responseHandle, {
      status: Number(normalized.status || 200),
      headers,
      origin: true
    });
    bodies.set(bodyHandle, { bytes: normalizeBody(body), readOffset: 0, writes: [] });
    return { responseHandle, bodyHandle };
  }

  const imports = {
    env: {
      abort(message, fileName, line, column) {
        throw new FastlyNativeHttpEffectsMockError('AssemblyScript aborted in the Pass97 Fastly effects module.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_ABORT', { message, fileName, line, column, trace });
      }
    },
    fastly_abi: {
      init(version) {
        trace.push({ module: 'fastly_abi', name: 'init', version: String(version) });
        return version === 1n ? FASTLY_STATUS_OK : FASTLY_STATUS_ERROR;
      }
    },
    fastly_http_req: {
      body_downstream_get(requestOut, bodyOut) {
        trace.push({ module: 'fastly_http_req', name: 'body_downstream_get' });
        writeU32(requestOut, downstreamRequestHandle);
        writeU32(bodyOut, downstreamBodyHandle);
        return FASTLY_STATUS_OK;
      },
      method_get(handle, buffer, bufferLength, writtenOut) {
        const request = requests.get(Number(handle));
        trace.push({ module: 'fastly_http_req', name: 'method_get', handle: Number(handle) });
        return request ? writeUtf8(request.method, buffer, bufferLength, writtenOut) : FASTLY_STATUS_BADF;
      },
      uri_get(handle, buffer, bufferLength, writtenOut) {
        const request = requests.get(Number(handle));
        trace.push({ module: 'fastly_http_req', name: 'uri_get', handle: Number(handle) });
        return request ? writeUtf8(request.url, buffer, bufferLength, writtenOut) : FASTLY_STATUS_BADF;
      },
      header_value_get(handle, namePointer, nameLength, valuePointer, valueLength, writtenOut) {
        const request = requests.get(Number(handle));
        const name = readUtf8(namePointer, nameLength);
        trace.push({ module: 'fastly_http_req', name: 'header_value_get', handle: Number(handle), header: name });
        if (!request) return FASTLY_STATUS_BADF;
        const value = headerValue(request.headers, name);
        return value === undefined ? FASTLY_STATUS_NONE : writeUtf8(value, valuePointer, valueLength, writtenOut);
      },
      new(handleOut) {
        const handle = alloc('request');
        requests.set(handle, { method: 'GET', url: '', headers: [] });
        writeU32(handleOut, handle);
        trace.push({ module: 'fastly_http_req', name: 'new', handle });
        return FASTLY_STATUS_OK;
      },
      method_set(handle, pointer, length) {
        const request = requests.get(Number(handle));
        if (!request) return FASTLY_STATUS_BADF;
        request.method = readUtf8(pointer, length).toUpperCase();
        trace.push({ module: 'fastly_http_req', name: 'method_set', handle: Number(handle), method: request.method });
        return FASTLY_STATUS_OK;
      },
      uri_set(handle, pointer, length) {
        const request = requests.get(Number(handle));
        if (!request) return FASTLY_STATUS_BADF;
        request.url = readUtf8(pointer, length);
        trace.push({ module: 'fastly_http_req', name: 'uri_set', handle: Number(handle), url: request.url });
        return FASTLY_STATUS_OK;
      },
      header_insert(handle, namePointer, nameLength, valuePointer, valueLength) {
        const request = requests.get(Number(handle));
        if (!request) return FASTLY_STATUS_BADF;
        const name = readUtf8(namePointer, nameLength);
        const value = readUtf8(valuePointer, valueLength);
        request.headers = request.headers.filter(([headerName]) => headerName.toLowerCase() !== name.toLowerCase());
        request.headers.push([name, value]);
        trace.push({ module: 'fastly_http_req', name: 'header_insert', handle: Number(handle), header: [name, value] });
        return FASTLY_STATUS_OK;
      },
      send_async(handle, bodyHandle, backendPointer, backendLength, pendingOut) {
        const request = requests.get(Number(handle));
        const body = bodies.get(Number(bodyHandle));
        if (!request || !body) return FASTLY_STATUS_BADF;
        const backend = readUtf8(backendPointer, backendLength);
        const fixture = resolveFixture(options.fixtures, backend, request.method, request.url);
        if (!fixture) {
          trace.push({ module: 'fastly_http_req', name: 'send_async', handle: Number(handle), backend, method: request.method, url: request.url, missingFixture: true });
          return FASTLY_STATUS_ERROR;
        }
        const pendingHandle = alloc('pending');
        const outbound = { ...request, headers: request.headers.map((entry) => [...entry]), body: bodyBytes(bodyHandle) };
        outboundRequests.push(outbound);
        pending.set(pendingHandle, { request: outbound, backend, fixture });
        writeU32(pendingOut, pendingHandle);
        trace.push({ module: 'fastly_http_req', name: 'send_async', handle: Number(handle), bodyHandle: Number(bodyHandle), pendingHandle, backend, method: request.method, url: request.url });
        return FASTLY_STATUS_OK;
      },
      pending_req_wait(handle, responseOut, bodyOut) {
        const item = pending.get(Number(handle));
        trace.push({ module: 'fastly_http_req', name: 'pending_req_wait', pendingHandle: Number(handle), backend: item && item.backend, url: item && item.request.url });
        if (!item) return FASTLY_STATUS_BADF;
        pending.delete(Number(handle));
        const transportStatus = Number(item.fixture.transportStatus || 0);
        if (transportStatus !== FASTLY_STATUS_OK) return transportStatus;
        const origin = makeOriginResponse(item.fixture);
        writeU32(responseOut, origin.responseHandle);
        writeU32(bodyOut, origin.bodyHandle);
        return FASTLY_STATUS_OK;
      }
    },
    fastly_http_resp: {
      new(handleOut) {
        const handle = alloc('response');
        responses.set(handle, { status: 200, headers: [], origin: false });
        writeU32(handleOut, handle);
        trace.push({ module: 'fastly_http_resp', name: 'new', handle });
        return FASTLY_STATUS_OK;
      },
      header_append(handle, namePointer, nameLength, valuePointer, valueLength) {
        const response = responses.get(Number(handle));
        if (!response) return FASTLY_STATUS_BADF;
        const name = readUtf8(namePointer, nameLength);
        const value = readUtf8(valuePointer, valueLength);
        response.headers.push([name, value]);
        trace.push({ module: 'fastly_http_resp', name: 'header_append', handle: Number(handle), header: [name, value] });
        return FASTLY_STATUS_OK;
      },
      header_value_get(handle, namePointer, nameLength, valuePointer, valueLength, writtenOut) {
        const response = responses.get(Number(handle));
        const name = readUtf8(namePointer, nameLength);
        trace.push({ module: 'fastly_http_resp', name: 'header_value_get', handle: Number(handle), header: name });
        if (!response) return FASTLY_STATUS_BADF;
        const value = headerValue(response.headers, name);
        return value === undefined ? FASTLY_STATUS_NONE : writeUtf8(value, valuePointer, valueLength, writtenOut);
      },
      status_get(handle, statusOut) {
        const response = responses.get(Number(handle));
        trace.push({ module: 'fastly_http_resp', name: 'status_get', handle: Number(handle) });
        if (!response) return FASTLY_STATUS_BADF;
        writeU32(statusOut, response.status);
        return FASTLY_STATUS_OK;
      },
      status_set(handle, status) {
        const response = responses.get(Number(handle));
        if (!response) return FASTLY_STATUS_BADF;
        response.status = Number(status);
        trace.push({ module: 'fastly_http_resp', name: 'status_set', handle: Number(handle), status: Number(status) });
        return FASTLY_STATUS_OK;
      },
      send_downstream(handle, bodyHandle, streaming) {
        const response = responses.get(Number(handle));
        const body = bodies.get(Number(bodyHandle));
        trace.push({ module: 'fastly_http_resp', name: 'send_downstream', handle: Number(handle), bodyHandle: Number(bodyHandle), streaming: Number(streaming), origin: response && response.origin });
        if (!response || !body) return FASTLY_STATUS_BADF;
        downstream = {
          status: response.status,
          headers: response.headers.map((entry) => [...entry]),
          bodyBytes: bodyBytes(bodyHandle),
          streaming: Number(streaming),
          origin: response.origin === true,
          responseHandle: Number(handle),
          bodyHandle: Number(bodyHandle)
        };
        return FASTLY_STATUS_OK;
      }
    },
    fastly_http_body: {
      new(handleOut) {
        const handle = alloc('body');
        bodies.set(handle, { bytes: Buffer.alloc(0), readOffset: 0, writes: [] });
        writeU32(handleOut, handle);
        trace.push({ module: 'fastly_http_body', name: 'new', handle });
        return FASTLY_STATUS_OK;
      },
      read(handle, buffer, bufferLength, readOut) {
        const body = bodies.get(Number(handle));
        if (!body) return FASTLY_STATUS_BADF;
        const source = bodyBytes(handle);
        const offset = body.readOffset || 0;
        const count = Math.min(Number(bufferLength), Math.max(0, source.length - offset));
        if (count > 0) new Uint8Array(memory().buffer, Number(buffer), count).set(source.subarray(offset, offset + count));
        body.readOffset = offset + count;
        writeU32(readOut, count);
        trace.push({ module: 'fastly_http_body', name: 'read', handle: Number(handle), bytes: count });
        return FASTLY_STATUS_OK;
      },
      write(handle, buffer, bufferLength, end, writtenOut) {
        const body = bodies.get(Number(handle));
        if (!body) return FASTLY_STATUS_BADF;
        const bytes = readBytes(buffer, bufferLength);
        body.writes.push(bytes);
        writeU32(writtenOut, bytes.length);
        trace.push({ module: 'fastly_http_body', name: 'write', handle: Number(handle), bytes: bytes.length, end: Number(end) });
        return FASTLY_STATUS_OK;
      }
    }
  };

  const module = new WebAssembly.Module(wasm);
  instance = new WebAssembly.Instance(module, imports);
  if (typeof instance.exports._start !== 'function') {
    throw new FastlyNativeHttpEffectsMockError('Pass97 native module is missing _start.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_START_MISSING');
  }
  instance.exports._start();
  const lastError = typeof instance.exports.pulse_fastly_last_error === 'function'
    ? Number(instance.exports.pulse_fastly_last_error())
    : undefined;
  const errorStage = typeof instance.exports.pulse_fastly_error_stage === 'function'
    ? Number(instance.exports.pulse_fastly_error_stage())
    : undefined;
  const errorEffect = typeof instance.exports.pulse_fastly_error_effect === 'function'
    ? Number(instance.exports.pulse_fastly_error_effect())
    : undefined;
  if (lastError !== FASTLY_STATUS_OK) {
    throw new FastlyNativeHttpEffectsMockError('Fastly native HTTP effects module reported an execution error.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_EXECUTION_FAILED', { lastError, errorStage, errorEffect, trace });
  }
  if (!downstream) {
    throw new FastlyNativeHttpEffectsMockError('Fastly native HTTP effects module did not send a downstream response.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_RESPONSE_NOT_SENT', { trace });
  }

  return Object.freeze({
    version: 'pulse.fastly-native-http-effects-mock.v1',
    request: Object.freeze({ method, url, path: pathValue, headers: Object.freeze(requestHeaders.map((entry) => Object.freeze(entry))) }),
    response: Object.freeze({
      status: downstream.status,
      headers: Object.freeze(downstream.headers.map((entry) => Object.freeze(entry))),
      body: downstream.bodyBytes.toString('utf8'),
      bodyBytes: downstream.bodyBytes,
      sent: true,
      streaming: downstream.streaming,
      origin: downstream.origin,
      responseHandle: downstream.responseHandle,
      bodyHandle: downstream.bodyHandle
    }),
    trace: Object.freeze(trace.map((entry) => Object.freeze({ ...entry }))),
    outboundRequests: Object.freeze(outboundRequests.map(entry => Object.freeze(entry))),
    instance
  });
}

module.exports = Object.freeze({
  FASTLY_STATUS_OK,
  FASTLY_STATUS_ERROR,
  FASTLY_STATUS_BADF,
  FASTLY_STATUS_BUFLEN,
  FASTLY_STATUS_NONE,
  FastlyNativeHttpEffectsMockError,
  normalizeHeaders,
  fixtureKey,
  executeFastlyNativeHttpEffects
});
