'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FASTLY_STATUS_OK = 0;
const FASTLY_STATUS_BUFLEN = 4;
const FASTLY_STATUS_NONE = 10;

class FastlyNativeHttpMockError extends Error {
  constructor(message, code = 'PULSE_FASTLY_NATIVE_HTTP_MOCK_FAILED', detail = {}) {
    super(message);
    this.name = 'FastlyNativeHttpMockError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function normalizeHeaders(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(([name, value]) => [String(name), String(value)]);
  return Object.entries(input).flatMap(([name, value]) => Array.isArray(value) ? value.map((entry) => [String(name), String(entry)]) : [[String(name), String(value)]]);
}

function executeFastlyNativeHttpShell(input, options = {}) {
  const wasm = Buffer.isBuffer(input) ? input : input && Buffer.isBuffer(input.wasm) ? input.wasm : fs.readFileSync(path.resolve(input));
  if (!WebAssembly.validate(wasm)) throw new FastlyNativeHttpMockError('Pass96 mock host requires valid WebAssembly.', 'PULSE_FASTLY_NATIVE_HTTP_MOCK_INVALID_WASM');
  const requestInput = options.request || {};
  const method = String(requestInput.method || 'GET').toUpperCase();
  const pathValue = String(requestInput.path || '/');
  const url = String(requestInput.url || `https://pulse.test${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`);
  const requestHeaders = normalizeHeaders(requestInput.headers);
  const trace = [];
  const response = { status: 200, headers: [], bodyChunks: [], sent: false, streaming: 0 };
  const handles = Object.freeze({ request: 1, requestBody: 2, response: 3, responseBody: 4 });
  let instance;

  function memory() {
    const value = instance && instance.exports && instance.exports.memory;
    if (!(value instanceof WebAssembly.Memory)) throw new FastlyNativeHttpMockError('Fastly native module did not export memory.', 'PULSE_FASTLY_NATIVE_HTTP_MOCK_MEMORY_MISSING');
    return value;
  }

  function view() {
    return new DataView(memory().buffer);
  }

  function writeU32(pointer, value) {
    view().setUint32(Number(pointer), Number(value) >>> 0, true);
  }

  function readBytes(pointer, length) {
    return Buffer.from(new Uint8Array(memory().buffer, Number(pointer), Number(length)));
  }

  function readUtf8(pointer, length) {
    return readBytes(pointer, length).toString('utf8');
  }

  function writeUtf8(value, pointer, maxLength, writtenOut) {
    const bytes = Buffer.from(String(value), 'utf8');
    if (bytes.length > Number(maxLength)) {
      writeU32(writtenOut, bytes.length);
      return FASTLY_STATUS_BUFLEN;
    }
    new Uint8Array(memory().buffer, Number(pointer), bytes.length).set(bytes);
    writeU32(writtenOut, bytes.length);
    return FASTLY_STATUS_OK;
  }

  function findHeader(name) {
    const target = String(name).toLowerCase();
    return requestHeaders.find(([headerName]) => headerName.toLowerCase() === target);
  }

  const imports = {
    env: {
      abort(message, fileName, line, column) {
        throw new FastlyNativeHttpMockError('AssemblyScript aborted in the Pass96 Fastly shell.', 'PULSE_FASTLY_NATIVE_HTTP_MOCK_ABORT', { message, fileName, line, column });
      }
    },
    fastly_abi: {
      init(version) {
        trace.push({ module: 'fastly_abi', name: 'init', version: String(version) });
        return version === 1n ? FASTLY_STATUS_OK : 1;
      }
    },
    fastly_http_req: {
      body_downstream_get(requestOut, bodyOut) {
        trace.push({ module: 'fastly_http_req', name: 'body_downstream_get' });
        writeU32(requestOut, handles.request);
        writeU32(bodyOut, handles.requestBody);
        return FASTLY_STATUS_OK;
      },
      method_get(handle, buffer, bufferLength, writtenOut) {
        trace.push({ module: 'fastly_http_req', name: 'method_get', handle });
        if (handle !== handles.request) return 3;
        return writeUtf8(method, buffer, bufferLength, writtenOut);
      },
      uri_get(handle, buffer, bufferLength, writtenOut) {
        trace.push({ module: 'fastly_http_req', name: 'uri_get', handle });
        if (handle !== handles.request) return 3;
        return writeUtf8(url, buffer, bufferLength, writtenOut);
      },
      header_value_get(handle, namePointer, nameLength, valuePointer, valueLength, writtenOut) {
        const name = readUtf8(namePointer, nameLength);
        trace.push({ module: 'fastly_http_req', name: 'header_value_get', handle, header: name });
        if (handle !== handles.request) return 3;
        const found = findHeader(name);
        if (!found) return FASTLY_STATUS_NONE;
        return writeUtf8(found[1], valuePointer, valueLength, writtenOut);
      }
    },
    fastly_http_resp: {
      new(handleOut) {
        trace.push({ module: 'fastly_http_resp', name: 'new' });
        writeU32(handleOut, handles.response);
        return FASTLY_STATUS_OK;
      },
      header_append(handle, namePointer, nameLength, valuePointer, valueLength) {
        const name = readUtf8(namePointer, nameLength);
        const value = readUtf8(valuePointer, valueLength);
        trace.push({ module: 'fastly_http_resp', name: 'header_append', handle, header: [name, value] });
        if (handle !== handles.response) return 3;
        response.headers.push([name, value]);
        return FASTLY_STATUS_OK;
      },
      status_set(handle, status) {
        trace.push({ module: 'fastly_http_resp', name: 'status_set', handle, status });
        if (handle !== handles.response) return 3;
        response.status = Number(status);
        return FASTLY_STATUS_OK;
      },
      send_downstream(handle, bodyHandle, streaming) {
        trace.push({ module: 'fastly_http_resp', name: 'send_downstream', handle, bodyHandle, streaming });
        if (handle !== handles.response || bodyHandle !== handles.responseBody) return 3;
        response.sent = true;
        response.streaming = Number(streaming);
        return FASTLY_STATUS_OK;
      }
    },
    fastly_http_body: {
      new(handleOut) {
        trace.push({ module: 'fastly_http_body', name: 'new' });
        writeU32(handleOut, handles.responseBody);
        return FASTLY_STATUS_OK;
      },
      write(handle, buffer, bufferLength, end, writtenOut) {
        trace.push({ module: 'fastly_http_body', name: 'write', handle, bytes: Number(bufferLength), end });
        if (handle !== handles.responseBody) return 3;
        const bytes = readBytes(buffer, bufferLength);
        response.bodyChunks.push(bytes);
        writeU32(writtenOut, bytes.length);
        return FASTLY_STATUS_OK;
      }
    }
  };

  const module = new WebAssembly.Module(wasm);
  instance = new WebAssembly.Instance(module, imports);
  if (typeof instance.exports._start !== 'function') throw new FastlyNativeHttpMockError('Pass96 native module is missing _start.', 'PULSE_FASTLY_NATIVE_HTTP_MOCK_START_MISSING');
  instance.exports._start();
  const lastError = typeof instance.exports.pulse_fastly_last_error === 'function' ? Number(instance.exports.pulse_fastly_last_error()) : undefined;
  if (lastError !== FASTLY_STATUS_OK) throw new FastlyNativeHttpMockError('Fastly native HTTP shell reported a hostcall error.', 'PULSE_FASTLY_NATIVE_HTTP_MOCK_HOSTCALL_FAILED', { lastError, trace });
  if (!response.sent) throw new FastlyNativeHttpMockError('Fastly native HTTP shell did not send a downstream response.', 'PULSE_FASTLY_NATIVE_HTTP_MOCK_RESPONSE_NOT_SENT', { trace });
  const bodyBytes = Buffer.concat(response.bodyChunks);
  return Object.freeze({
    version: 'pulse.fastly-native-http-mock.v1',
    request: Object.freeze({ method, url, path: pathValue, headers: Object.freeze(requestHeaders.map((pair) => Object.freeze(pair))) }),
    response: Object.freeze({
      status: response.status,
      headers: Object.freeze(response.headers.map((pair) => Object.freeze(pair))),
      body: bodyBytes.toString('utf8'),
      bodyBytes,
      sent: response.sent,
      streaming: response.streaming
    }),
    trace: Object.freeze(trace.map((entry) => Object.freeze({ ...entry }))),
    instance
  });
}

module.exports = Object.freeze({
  FASTLY_STATUS_OK,
  FASTLY_STATUS_BUFLEN,
  FASTLY_STATUS_NONE,
  FastlyNativeHttpMockError,
  normalizeHeaders,
  executeFastlyNativeHttpShell
});
