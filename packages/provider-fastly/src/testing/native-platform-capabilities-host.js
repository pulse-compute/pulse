'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FASTLY_STATUS_OK = 0;
const FASTLY_STATUS_INVALID_ARGUMENT = 2;
const FASTLY_STATUS_ERROR = 1;
const FASTLY_STATUS_BADF = 3;
const FASTLY_STATUS_BUFLEN = 4;
const FASTLY_STATUS_NONE = 10;
const FASTLY_KV_ERROR_OK = 1;
const FASTLY_KV_ERROR_NOT_FOUND = 3;
const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'x-auth-token', 'cookie', 'set-cookie', 'x-amz-security-token', 'x-amz-content-sha256']);

class FastlyNativePlatformCapabilitiesMockError extends Error {
  constructor(message, code = 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_FAILED', detail = {}) {
    super(message);
    this.name = 'FastlyNativePlatformCapabilitiesMockError';
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

function redactHeaders(headers) {
  return headers.map(([name, value]) => [name, SENSITIVE_HEADERS.has(String(name).toLowerCase()) ? '[REDACTED]' : value]);
}

function normalizeNamedStores(input, fallbackName, fallbackValues) {
  const stores = new Map();
  if (input instanceof Map) {
    for (const [name, values] of input) stores.set(String(name), new Map(Object.entries(values || {})));
  } else if (input && typeof input === 'object') {
    for (const [name, values] of Object.entries(input)) stores.set(String(name), new Map(Object.entries(values || {})));
  }
  if (fallbackValues && typeof fallbackValues === 'object') stores.set(String(fallbackName), new Map(Object.entries(fallbackValues)));
  return stores;
}

function encodeKvValue(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string' && value.startsWith('{"__pulseKv":')) return Buffer.from(value);
  return Buffer.from(JSON.stringify({ __pulseKv: 1, value }));
}

function snapshotStores(stores, decode = false) {
  const output = {};
  for (const [name, values] of stores) {
    output[name] = {};
    for (const [key, value] of values) {
      if (!decode) output[name][key] = value;
      else {
        const text = Buffer.from(value).toString('utf8');
        try {
          const parsed = JSON.parse(text);
          output[name][key] = parsed && parsed.__pulseKv === 1 ? parsed.value : parsed;
        } catch (_) { output[name][key] = text; }
      }
    }
  }
  return output;
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

function executeFastlyNativePlatformCapabilities(input, options = {}) {
  const wasm = Buffer.isBuffer(input)
    ? input
    : input && Buffer.isBuffer(input.wasm)
      ? input.wasm
      : fs.readFileSync(path.resolve(input));
  if (!WebAssembly.validate(wasm)) {
    throw new FastlyNativePlatformCapabilitiesMockError('Pass98 mock host requires valid WebAssembly.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_INVALID_WASM');
  }

  const requestInput = options.request || {};
  const method = String(requestInput.method || 'GET').toUpperCase();
  const pathValue = String(requestInput.path || '/');
  const url = String(requestInput.url || `https://pulse.test${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`);
  const requestHeaders = normalizeHeaders(requestInput.headers);
  const trace = [];
  let monotonicMs = 0;
  const privateUrls = new Set();
  let nextHandle = 10;
  const typedHandleStarts = options.handleStarts && typeof options.handleStarts === 'object' ? options.handleStarts : {};
  const typedHandleNext = new Map();
  let instance;

  const requests = new Map();
  const bodies = new Map();
  const responses = new Map();
  const pending = new Map();
  const outboundRequests = [];
  const configStores = normalizeNamedStores(options.configStores, options.configStore || 'app_config', options.config);
  const secretStores = normalizeNamedStores(options.secretStores, options.secretStore || 'app_secrets', options.secrets);
  const secretValues = [...secretStores.values()].flatMap((values) => [...values.values()].map((value) => String(value))).filter(Boolean);
  const redactText = (value) => secretValues.reduce((output, secret) => output.split(secret).join('[REDACTED]'), String(value));
  const redactRuntimeHeaders = (headers, privateS3 = false) => headers.map(([name, value]) => [name, SENSITIVE_HEADERS.has(String(name).toLowerCase()) || privateS3 && ['etag', 'content-type'].includes(String(name).toLowerCase()) ? '[REDACTED]' : redactText(value)]);
  const kvStores = normalizeNamedStores(options.kvStores, options.kvStore || 'app_sessions', undefined);
  for (const values of kvStores.values()) for (const [key, value] of values) values.set(key, encodeKvValue(value));
  const configHandles = new Map();
  const secretStoreHandles = new Map();
  const secretHandles = new Map();
  const kvStoreHandles = new Map();
  const pendingKvLookups = new Map();
  const pendingKvInserts = new Map();
  const logHandles = new Map();
  const logs = [];
  const downstreamRequestHandle = 1;
  const downstreamBodyHandle = 2;
  requests.set(downstreamRequestHandle, { method, url, headers: requestHeaders.map((entry) => [...entry]) });
  bodies.set(downstreamBodyHandle, { bytes: normalizeBody(requestInput.body), readOffset: 0, writes: [],
    readyAt: monotonicMs + Number(requestInput.readyDelayMs || 0), fixture: requestInput });
  let downstream;

  function alloc(kind = 'default') {
    if (Object.prototype.hasOwnProperty.call(typedHandleStarts, kind)) {
      const current = typedHandleNext.has(kind) ? typedHandleNext.get(kind) : Number(typedHandleStarts[kind]);
      if (!Number.isInteger(current) || current < 0) {
        throw new FastlyNativePlatformCapabilitiesMockError('Mock host handle starts must be non-negative integers.', 'PULSE_FASTLY_NATIVE_MOCK_HANDLE_START_INVALID', { kind, value: typedHandleStarts[kind] });
      }
      typedHandleNext.set(kind, current + 1);
      return current;
    }
    return nextHandle++;
  }

  function memory() {
    const value = instance && instance.exports && instance.exports.memory;
    if (!(value instanceof WebAssembly.Memory)) {
      throw new FastlyNativePlatformCapabilitiesMockError('Fastly native platform capabilities module did not export memory.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_MEMORY_MISSING');
    }
    return value;
  }

  function view() { return new DataView(memory().buffer); }
  function writeU32(pointer, value) { view().setUint32(Number(pointer), Number(value) >>> 0, true); }
  function writeU64(pointer, value) { view().setBigUint64(Number(pointer), BigInt(value), true); }
  function readBytes(pointer, length) { return Buffer.from(new Uint8Array(memory().buffer, Number(pointer), Number(length))); }
  function readUtf8(pointer, length) { return readBytes(pointer, length).toString('utf8'); }

  const dynamicBackends = require('./native-dynamic-backends-host.js').createDynamicBackendHost({ view, readUtf8, trace, options, beforeRegister: () => { monotonicMs += Number(options.dynamicBackendRegistrationMs || 0); } });

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
    // Ordinary Pulse harness fixtures use value/text; preserve the ABI fixture
    // body's explicit precedence and its existing json shorthand.
    if (body === undefined && Object.prototype.hasOwnProperty.call(normalized, 'value')) {
      body = JSON.stringify(normalized.value);
      if (!headers.some(([name]) => name.toLowerCase() === 'content-type')) headers.push(['content-type', 'application/json; charset=utf-8']);
    } else if (body === undefined && Object.prototype.hasOwnProperty.call(normalized, 'text')) {
      body = String(normalized.text);
      if (!headers.some(([name]) => name.toLowerCase() === 'content-type')) headers.push(['content-type', 'text/plain; charset=utf-8']);
    }
    responses.set(responseHandle, {
      status: Number(normalized.status || 200),
      headers,
      origin: true
    });
    bodies.set(bodyHandle, { bytes: normalizeBody(body), readOffset: 0, writes: [], fixture: normalized, readyAt: monotonicMs + Number(normalized.bodyDelayMs || 0) });
    return { responseHandle, bodyHandle };
  }

  function headerList(values, buffer, size, end, written) {
    const output = Buffer.from(values.map((value) => String(value) + '\0').join(''));
    writeU32(written, output.length); view().setBigInt64(Number(end), -1n, true);
    if (output.length > Number(size)) return FASTLY_STATUS_BUFLEN;
    new Uint8Array(memory().buffer, Number(buffer), output.length).set(output);
    return FASTLY_STATUS_OK;
  }
  function requestHeaderList(values, buffer, size, cursor, end, written, kind, lookupKind) {
    const limit = Math.min(Number(size), options.requestHeaderPageBytes ?? Number(size));
    let index = Number(cursor), count = 0;
    if (index < 0 || index > values.length) return FASTLY_STATUS_ERROR;
    while (index < values.length) {
      const bytes = Buffer.from(String(values[index]) + '\0');
      if (count + bytes.length > limit) {
        if (count === 0) { writeU32(written, bytes.length); return FASTLY_STATUS_BUFLEN; }
        break;
      }
      new Uint8Array(memory().buffer, Number(buffer) + count, bytes.length).set(bytes);
      count += bytes.length; index++;
    }
    writeU32(written, count);
    view().setBigInt64(Number(end), index === values.length ? -1n : BigInt(index), true);
    // Fault injection is host-fixture-only; neither values nor faults enter traces.
    const fault = (lookupKind && options.headerLookupFault?.({kind:lookupKind})) || options.requestHeaderFault?.({kind, cursor: Number(cursor)});
    if (fault?.written !== undefined) writeU32(written, fault.written);
    if (fault?.cursor !== undefined) view().setBigInt64(Number(end), BigInt(fault.cursor), true);
    if (fault?.unterminated && count) new Uint8Array(memory().buffer)[Number(buffer) + count - 1] = 65;
    return fault?.status ?? FASTLY_STATUS_OK;
  }
  function writeSendErrorDetail(item, handle, detail, outputs, name) {
    // Independent wasm32 ABI oracle: SendErrorDetail is 20 bytes, aligned to
    // four, even when no optional field is valid. Do not import guest constants.
    const strict = options.sendErrorDetailLayout;
    if (strict) {
      const fail = message => { throw new FastlyNativePlatformCapabilitiesMockError(message, 'PULSE_FASTLY_SEND_ERROR_DETAIL_LAYOUT'); };
      if (detail % 4) fail('SendErrorDetail must be four-byte aligned');
      // AssemblyScript managed StaticArray rtSize is the word at data - 4.
      if (strict === 'managed' && view().getUint32(detail - 4, true) < 20) fail('SendErrorDetail allocation is smaller than 20 bytes');
      for (const output of outputs) if (output < detail + 20 && output + 4 > detail) fail('SendErrorDetail overlaps an output');
      if (view().getUint32(detail, true) !== 0 || view().getUint32(detail + 4, true) !== 30) fail('SendErrorDetail tag/mask were not reset before host call');
      for (let offset = 8; offset < 20; offset++) if (view().getUint8(detail + offset) !== 0) fail('SendErrorDetail contains stale optional fields');
    }
    const guards = [...new Set([detail - 4, detail + 20, ...outputs])];
    const saved = guards.map(pointer => view().getUint32(pointer, true));
    const canary = guards.map((_, i) => 0x13579bd0 + i);
    if (strict) guards.forEach((pointer, i) => writeU32(pointer, canary[i]));
    const wire = item.fixture.sendErrorDetail === null ? {tag:0,mask:0} : item.fixture.sendErrorDetail || { tag: item.fixture.transportStatus ? 22 : 1, mask: 0 };
    // Write the entire C-layout record, including padding and the final word.
    new Uint8Array(memory().buffer, detail, 20).fill(0);
    writeU32(detail, wire.tag); writeU32(detail + 4, wire.mask);
    view().setUint16(detail + 8, wire.dnsRcode || 0, true);
    view().setUint16(detail + 10, wire.dnsInfo || 0, true);
    view().setUint8(detail + 12, wire.tlsAlert || 0);
    view().setUint8(detail + 13, wire.h2Frame || 0);
    writeU32(detail + 16, wire.h2Code || 0);
    if (strict) guards.forEach((pointer, i) => {
      if (view().getUint32(pointer, true) !== canary[i]) throw new FastlyNativePlatformCapabilitiesMockError('SendErrorDetail overwrote an adjacent/output sentinel', 'PULSE_FASTLY_SEND_ERROR_DETAIL_LAYOUT');
      writeU32(pointer, saved[i]);
    });
    trace.push({module:'fastly_http_req',name,pendingHandle:Number(handle),
      detailBytes:20, detailTag:wire.tag, detailMask:wire.mask, detailLayoutChecked:Boolean(strict)});
  }
  const imports = {
    fastly_async_io: {
      is_ready(handle, out) {
        const item = pending.get(Number(handle)) || bodies.get(Number(handle));
        if (!item) return FASTLY_STATUS_BADF;
        const ready = monotonicMs >= (item.readyAt || 0) ? 1 : 0;
        writeU32(out, ready);
        trace.push({module:'fastly_async_io',name:'is_ready',handle:Number(handle),ready,now:monotonicMs});
        return FASTLY_STATUS_OK;
      },
      select(handles, count, timeout, done) {
        if (Number(count) < 1 || Number(timeout) <= 0) return FASTLY_STATUS_ERROR;
        const selected = Array.from({length:Number(count)},(_,i) => view().getUint32(Number(handles)+4*i,true));
        const items = selected.map(handle => pending.get(handle) || bodies.get(handle));
        if (items.some(item => !item)) return FASTLY_STATUS_BADF;
        const waits = items.map(item => Math.max(0, Number(item.readyAt || 0) - monotonicMs));
        const wait = Math.min(...waits), timedOut = wait >= Number(timeout);
        const fault = options.asyncSelectFault?.({handles:selected,timeout:Number(timeout),now:monotonicMs});
        monotonicMs += fault?.advanceMs ?? Math.min(wait,Number(timeout));
        writeU32(done, fault?.selected ?? (timedOut ? 0xffffffff : waits.indexOf(wait)));
        trace.push({ module: 'fastly_async_io', name: 'select', handles:selected, timeout:Number(timeout), timedOut, now:monotonicMs });
        if (fault?.status) return fault.status;
        return FASTLY_STATUS_OK;
      }
    },
    wasi_snapshot_preview1: {
      fd_write(fd, iovs, count, writtenOut) {
        // WASI errno values, independent of the Fastly status enum.
        if (Number(fd) !== 1) return 8; // BADF
        if (options.logWriteFailure === true) {
          trace.push({ module: 'wasi_snapshot_preview1', name: 'fd_write', fd: 1, accepted: false });
          return 29; // IO
        }
        const chunks = [];
        for (let index = 0; index < Number(count); index++) {
          const pointer = Number(iovs) + index * 8;
          chunks.push(readBytes(view().getUint32(pointer, true), view().getUint32(pointer + 4, true)));
        }
        const bytes = Buffer.concat(chunks);
        const written = Math.min(bytes.length, options.logWriteMaxBytes ?? bytes.length);
        const emitted = bytes.subarray(0, written).toString('utf8');
        if (typeof options.onLogWrite === 'function') options.onLogWrite(emitted);
        const message = redactText(emitted);
        writeU32(writtenOut, written);
        logs.push(Object.freeze({ endpoint: 'stdout', message }));
        trace.push({ module: 'wasi_snapshot_preview1', name: 'fd_write', fd: 1, count: Number(count), bytes: bytes.length, written, message, accepted: true });
        return 0;
      },
      clock_time_get(clockId, precision, timeOut) {
        if (Number(clockId) === 1 && typeof options.monotonicClock === 'function') {
          const sample = options.monotonicClock(monotonicMs);
          if (sample.status) return sample.status;
          writeU64(timeOut, sample.nanoseconds);
          return FASTLY_STATUS_OK;
        }
        if (Number(clockId) === 0 && typeof options.realtimeClock === 'function') {
          const sample = options.realtimeClock();
          trace.push({ module: 'wasi_snapshot_preview1', name: 'clock_time_get', clockId: 0, precision: String(precision), status: sample.status || 0 });
          if (sample.status) return sample.status;
          writeU64(timeOut, sample.nanoseconds);
          return FASTLY_STATUS_OK;
        }
        const seconds = Number.isFinite(Number(options.clockUnixSeconds))
          ? Number(options.clockUnixSeconds)
          : Math.floor(Date.now() / 1000);
        writeU64(timeOut, BigInt(Math.trunc((Number(clockId) === 1 ? monotonicMs : seconds * 1000 + monotonicMs) * 1_000_000)));
        trace.push({
          module: 'wasi_snapshot_preview1',
          name: 'clock_time_get',
          clockId: Number(clockId),
          precision: String(precision),
          unixEpochSeconds: seconds
        });
        return FASTLY_STATUS_OK;
      }
    },
    env: {
      abort(message, fileName, line, column) {
        throw new FastlyNativePlatformCapabilitiesMockError('AssemblyScript aborted in the Pass98 Fastly effects module.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_ABORT', { message, fileName, line, column, trace });
      }
    },
    fastly_abi: {
      init(version) {
        trace.push({ module: 'fastly_abi', name: 'init', version: String(version) });
        return version === 1n ? FASTLY_STATUS_OK : FASTLY_STATUS_ERROR;
      }
    },
    fastly_log: {
      endpoint_get(namePointer, nameLength, handleOut) {
        const endpoint = readUtf8(namePointer, nameLength);
        // Match Viceroy/Compute: these names belong to stdio or the platform.
        if (/^(?:stdout$|stderr$|fst_managed_)/i.test(endpoint)) {
          trace.push({ module: 'fastly_log', name: 'endpoint_get', endpoint, opened: false });
          return FASTLY_STATUS_INVALID_ARGUMENT;
        }
        if (options.logEndpointFailure === true || (options.logEndpoints && !options.logEndpoints.includes(endpoint))) {
          trace.push({ module: 'fastly_log', name: 'endpoint_get', endpoint, opened: false });
          return FASTLY_STATUS_ERROR;
        }
        const handle = alloc('log');
        logHandles.set(handle, endpoint);
        writeU32(handleOut, handle);
        trace.push({ module: 'fastly_log', name: 'endpoint_get', endpoint, handle, opened: true });
        return FASTLY_STATUS_OK;
      },
      write(handle, messagePointer, messageLength, writtenOut) {
        const endpoint = logHandles.get(Number(handle));
        if (!endpoint) return FASTLY_STATUS_BADF;
        if (options.logWriteFailure === true) {
          trace.push({ module: 'fastly_log', name: 'write', endpoint, accepted: false });
          return FASTLY_STATUS_ERROR;
        }
        const length = Math.min(Number(messageLength), options.logWriteMaxBytes ?? Number(messageLength));
        const emitted = readUtf8(messagePointer, length);
        // Test-only assertion seam before proof-trace redaction. Never retain raw
        // guest bytes in the returned evidence, even when the guest regresses.
        if (typeof options.onLogWrite === 'function') options.onLogWrite(emitted);
        const message = redactText(emitted);
        writeU32(writtenOut, length);
        logs.push(Object.freeze({ endpoint, message }));
        trace.push({ module: 'fastly_log', name: 'write', endpoint, message, accepted: true });
        return FASTLY_STATUS_OK;
      }
    },
    fastly_http_req: {
      register_dynamic_backend: dynamicBackends.register,
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
      header_names_get(handle, buffer, size, cursor, end, written) {
        trace.push({module: 'fastly_http_req', name: 'header_names_get', cursor: Number(cursor)});
        const request = requests.get(Number(handle));
        if (!request) return FASTLY_STATUS_BADF;
        return requestHeaderList([...new Set(request.headers.map(([name]) => name.toLowerCase()))], buffer, size, cursor, end, written, 'names');
      },
      header_values_get(handle, pointer, length, buffer, size, cursor, end, written) {
        trace.push({module: 'fastly_http_req', name: 'header_values_get', cursor: Number(cursor)});
        const request = requests.get(Number(handle));
        if (!request) return FASTLY_STATUS_BADF;
        const name = readUtf8(pointer, length).toLowerCase();
        if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)) return FASTLY_STATUS_INVALID_ARGUMENT;
        return requestHeaderList(request.headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value), buffer, size, cursor, end, written, 'values', 'request');
      },
      header_value_get(handle, namePointer, nameLength, valuePointer, valueLength, writtenOut) {
        const request = requests.get(Number(handle));
        const name = readUtf8(namePointer, nameLength);
        trace.push({ module: 'fastly_http_req', name: 'header_value_get', handle: Number(handle), header: name });
        if (!request) return FASTLY_STATUS_BADF;
        const value = headerValue(request.headers, name);
        return value === undefined ? FASTLY_STATUS_INVALID_ARGUMENT : writeUtf8(value, valuePointer, valueLength, writtenOut);
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
        trace.push({ module: 'fastly_http_req', name: 'uri_set', handle: Number(handle), url: redactText(request.url) });
        return FASTLY_STATUS_OK;
      },
      header_insert(handle, namePointer, nameLength, valuePointer, valueLength) {
        const request = requests.get(Number(handle));
        if (!request) return FASTLY_STATUS_BADF;
        const name = readUtf8(namePointer, nameLength);
        const value = readUtf8(valuePointer, valueLength);
        if (name.toLowerCase() === 'authorization' && value.includes('/s3/aws4_request')) privateUrls.add(request.url);
        request.headers = request.headers.filter(([headerName]) => headerName.toLowerCase() !== name.toLowerCase());
        request.headers.push([name, value]);
        trace.push({ module: 'fastly_http_req', name: 'header_insert', handle: Number(handle), header: redactRuntimeHeaders([[name, value]], privateUrls.has(request.url))[0] });
        return FASTLY_STATUS_OK;
      },
      cache_override_set(handle, tag, ttl, swr) {
        const request = requests.get(Number(handle)); if (!request) return FASTLY_STATUS_BADF;
        request.cacheOverride = Number(tag); return FASTLY_STATUS_OK;
      },
      auto_decompress_response_set(handle, encodings) {
        const request = requests.get(Number(handle)); if (!request) return FASTLY_STATUS_BADF;
        request.decompression = Number(encodings); return FASTLY_STATUS_OK;
      },
      close(handle) { return requests.delete(Number(handle)) ? FASTLY_STATUS_OK : FASTLY_STATUS_BADF; },
      pending_req_poll_v2(handle, detail, done, responseOut, bodyOut) {
        const item = pending.get(Number(handle)); if (!item) return FASTLY_STATUS_BADF;
        writeSendErrorDetail(item, handle, detail, [done, responseOut, bodyOut], 'pending_req_poll_v2');
        // Exercise a readiness race: select/is_ready can precede a not-ready poll.
        if (monotonicMs >= item.readyAt && item.fixture.pollNotReadyMs && !item.delayedPoll) {
          item.delayedPoll = true; item.readyAt = monotonicMs + Number(item.fixture.pollNotReadyMs);
        }
        if (monotonicMs < item.readyAt) { writeU32(done, 0); return FASTLY_STATUS_OK; }
        writeU32(done, 1); return imports.fastly_http_req.pending_req_wait(handle, responseOut, bodyOut);
      },
      send_async_streaming(handle, bodyHandle, backendPointer, backendLength, pendingOut) {
        const request = requests.get(Number(handle)), body = bodies.get(Number(bodyHandle));
        if (!request || !body) return FASTLY_STATUS_BADF;
        const backend = readUtf8(backendPointer, backendLength);
        const fixture = resolveFixture(options.fixtures, backend, request.method, request.url);
        requests.delete(Number(handle));
        if (!fixture || fixture.sendStatus) { bodies.delete(Number(bodyHandle)); return Number(fixture?.sendStatus || 1); }
        const pendingHandle = alloc('pending');
        const record = {backend, method:request.method, url:redactText(request.url), headers:redactRuntimeHeaders(request.headers), bodyBytes:Buffer.alloc(0)};
        outboundRequests.push(record);
        const item = {request, backend, fixture, readyAt:fixture.earlyResponse ? monotonicMs + Number(fixture.delayMs || 0) : Infinity};
        pending.set(pendingHandle, item);
        body.streamingUpload = {item, record}; body.readyAt = monotonicMs + Number(options.uploadReadyDelayMs || 0);
        writeU32(pendingOut, pendingHandle);
        trace.push({module:'fastly_http_req',name:'send_async_streaming',bodyHandle:Number(bodyHandle),pendingHandle});
        return FASTLY_STATUS_OK;
      },
      send_async(handle, bodyHandle, backendPointer, backendLength, pendingOut) {
        const request = requests.get(Number(handle));
        const body = bodies.get(Number(bodyHandle));
        if (!request || !body) return FASTLY_STATUS_BADF;
        const backend = readUtf8(backendPointer, backendLength);
        dynamicBackends.route(backend, request);
        const signedS3 = request.headers.some(([name, value]) => name.toLowerCase() === 'authorization' && value.startsWith('AWS4-HMAC-SHA256 '));
        if (signedS3) privateUrls.add(request.url);
        const fixture = resolveFixture(options.fixtures, backend, request.method, request.url);
        if (!fixture) {
          trace.push({ module: 'fastly_http_req', name: 'send_async', handle: Number(handle), backend, method: request.method, url: signedS3 ? '[REDACTED]' : request.url, missingFixture: true });
          return FASTLY_STATUS_ERROR;
        }
        const pendingHandle = alloc('pending');
        const capturedBody = bodyBytes(bodyHandle);
        pending.set(pendingHandle, { request: { ...request, headers: request.headers.map((entry) => [...entry]), body: capturedBody }, backend, fixture, readyAt: fixture.neverHeaders ? Infinity : monotonicMs + Number(fixture.delayMs || 0) });
        if (typeof options.onOutboundRequest === 'function') options.onOutboundRequest({ ...request, backend, headers: request.headers.map((entry) => [...entry]), body: capturedBody });
        if (fixture.sendStatus) { pending.delete(pendingHandle); return Number(fixture.sendStatus); }
        if (request.headers.some(([name, value]) => name.toLowerCase() === 'authorization' && value.startsWith('AWS4-HMAC-SHA256 '))) privateUrls.add(request.url);
        requests.delete(Number(handle)); bodies.delete(Number(bodyHandle));
        outboundRequests.push(Object.freeze({
          backend,
          method: request.method,
          url: privateUrls.has(request.url) ? '[REDACTED]' : redactText(request.url),
          headers: Object.freeze(redactRuntimeHeaders(request.headers, signedS3).map((header) => Object.freeze(header))),
          body: signedS3 ? '[REDACTED]' : redactText(capturedBody.toString('utf8'))
        }));
        writeU32(pendingOut, pendingHandle);
        trace.push({ module: 'fastly_http_req', name: 'send_async', handle: Number(handle), bodyHandle: Number(bodyHandle), pendingHandle, backend, method: request.method, url: redactText(request.url), headers: redactRuntimeHeaders(request.headers, signedS3), bodyBytes: capturedBody.length });
        return FASTLY_STATUS_OK;
      },
      pending_req_wait_v2(handle, detail, responseOut, bodyOut) {
        const item = pending.get(Number(handle)); if (!item) return FASTLY_STATUS_BADF;
        writeSendErrorDetail(item, handle, detail, [responseOut, bodyOut], 'pending_req_wait_v2');
        return imports.fastly_http_req.pending_req_wait(handle, responseOut, bodyOut);
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
    fastly_config_store: {
      open(namePointer, nameLength, handleOut) {
        const name = readUtf8(namePointer, nameLength);
        const values = configStores.get(name);
        trace.push({ module: 'fastly_config_store', name: 'open', store: name, found: Boolean(values) });
        if (!values) return FASTLY_STATUS_NONE;
        const handle = alloc('configStore'); configHandles.set(handle, values); writeU32(handleOut, handle); return FASTLY_STATUS_OK;
      },
      get(handle, keyPointer, keyLength, valuePointer, valueLength, writtenOut) {
        const values = configHandles.get(Number(handle));
        const key = readUtf8(keyPointer, keyLength);
        const value = values && values.get(key);
        trace.push({ module: 'fastly_config_store', name: 'get', handle: Number(handle), key, found: value !== undefined });
        if (!values) return FASTLY_STATUS_BADF;
        return value === undefined ? FASTLY_STATUS_NONE : writeUtf8(value, valuePointer, valueLength, writtenOut);
      }
    },
    fastly_secret_store: {
      open(namePointer, nameLength, handleOut) {
        const name = readUtf8(namePointer, nameLength);
        const values = secretStores.get(name);
        trace.push({ module: 'fastly_secret_store', name: 'open', store: name, found: Boolean(values) });
        if (!values) return FASTLY_STATUS_NONE;
        const handle = alloc('secretStore'); secretStoreHandles.set(handle, values); writeU32(handleOut, handle); return FASTLY_STATUS_OK;
      },
      get(handle, keyPointer, keyLength, secretOut) {
        monotonicMs += Number(options.secretDelayMs || 0);
        if (typeof options.onSecretLookup === 'function') options.onSecretLookup();
        const values = secretStoreHandles.get(Number(handle));
        const key = readUtf8(keyPointer, keyLength);
        const value = values && values.get(key);
        trace.push({ module: 'fastly_secret_store', name: 'get', handle: Number(handle), key, found: value !== undefined });
        if (!values) return FASTLY_STATUS_BADF;
        if (value === undefined) return FASTLY_STATUS_NONE;
        const secretHandle = alloc('secret'); secretHandles.set(secretHandle, String(value)); writeU32(secretOut, secretHandle); return FASTLY_STATUS_OK;
      },
      plaintext(handle, valuePointer, valueLength, writtenOut) {
        const value = secretHandles.get(Number(handle));
        trace.push({ module: 'fastly_secret_store', name: 'plaintext', handle: Number(handle), value: '[REDACTED]' });
        return value === undefined ? FASTLY_STATUS_BADF : writeUtf8(value, valuePointer, valueLength, writtenOut);
      }
    },
    fastly_kv_store: {
      open(namePointer, nameLength, handleOut) {
        const name = readUtf8(namePointer, nameLength);
        const values = kvStores.get(name);
        trace.push({ module: 'fastly_kv_store', name: 'open', store: name, found: Boolean(values) });
        if (!values) return FASTLY_STATUS_NONE;
        const handle = alloc('kvStore'); kvStoreHandles.set(handle, { name, values }); writeU32(handleOut, handle); return FASTLY_STATUS_OK;
      },
      lookup(storeHandle, keyPointer, keyLength, configMask, configPointer, lookupOut) {
        const store = kvStoreHandles.get(Number(storeHandle));
        if (!store) return FASTLY_STATUS_BADF;
        const key = readUtf8(keyPointer, keyLength);
        const handle = alloc('kvLookup'); pendingKvLookups.set(handle, { store, key }); writeU32(lookupOut, handle);
        trace.push({ module: 'fastly_kv_store', name: 'lookup', store: store.name, key, pendingHandle: handle, configMask: Number(configMask) });
        return FASTLY_STATUS_OK;
      },
      lookup_wait_v2(handle, bodyOut, metadataPointer, metadataLength, writtenOut, generationOut, kvErrorOut) {
        const item = pendingKvLookups.get(Number(handle));
        if (!item) return FASTLY_STATUS_BADF;
        pendingKvLookups.delete(Number(handle));
        const value = item.store.values.get(item.key);
        writeU32(writtenOut, 0); writeU64(generationOut, 0n);
        if (value === undefined) {
          writeU32(kvErrorOut, FASTLY_KV_ERROR_NOT_FOUND);
          trace.push({ module: 'fastly_kv_store', name: 'lookup_wait_v2', store: item.store.name, key: item.key, found: false });
          return FASTLY_STATUS_OK;
        }
        const bodyHandle = alloc('body'); bodies.set(bodyHandle, { bytes: Buffer.from(value), readOffset: 0, writes: [] }); writeU32(bodyOut, bodyHandle); writeU32(kvErrorOut, FASTLY_KV_ERROR_OK);
        trace.push({ module: 'fastly_kv_store', name: 'lookup_wait_v2', store: item.store.name, key: item.key, found: true, bodyHandle });
        return FASTLY_STATUS_OK;
      },
      insert(storeHandle, keyPointer, keyLength, bodyHandle, configMask, configPointer, insertOut) {
        const store = kvStoreHandles.get(Number(storeHandle));
        const body = bodies.get(Number(bodyHandle));
        if (!store || !body) return FASTLY_STATUS_BADF;
        const key = readUtf8(keyPointer, keyLength);
        const handle = alloc('kvInsert'); pendingKvInserts.set(handle, { store, key, bytes: bodyBytes(bodyHandle) }); writeU32(insertOut, handle);
        trace.push({ module: 'fastly_kv_store', name: 'insert', store: store.name, key, pendingHandle: handle, bytes: bodyBytes(bodyHandle).length, configMask: Number(configMask) });
        return FASTLY_STATUS_OK;
      },
      insert_wait(handle, kvErrorOut) {
        const item = pendingKvInserts.get(Number(handle));
        if (!item) return FASTLY_STATUS_BADF;
        pendingKvInserts.delete(Number(handle)); item.store.values.set(item.key, Buffer.from(item.bytes)); writeU32(kvErrorOut, FASTLY_KV_ERROR_OK);
        trace.push({ module: 'fastly_kv_store', name: 'insert_wait', store: item.store.name, key: item.key, bytes: item.bytes.length });
        return FASTLY_STATUS_OK;
      }
    },
    fastly_http_resp: {
      close(handle) { trace.push({ module: 'fastly_http_resp', name: 'close' }); return responses.delete(Number(handle)) ? FASTLY_STATUS_OK : FASTLY_STATUS_BADF; },
      header_names_get(handle, buffer, size, cursor, end, written) {
        const response = responses.get(Number(handle)); if (!response || cursor !== 0) return FASTLY_STATUS_BADF;
        return headerList([...new Set(response.headers.map(([name]) => name.toLowerCase()))], buffer, size, end, written);
      },
      header_values_get(handle, pointer, length, buffer, size, cursor, end, written) {
        const response = responses.get(Number(handle)); if (!response || cursor !== 0) return FASTLY_STATUS_BADF;
        const name = readUtf8(pointer, length).toLowerCase();
        return headerList(response.headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value), buffer, size, end, written);
      },
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
      header_values_get(handle, pointer, length, buffer, size, cursor, end, written) {
        trace.push({module:'fastly_http_resp', name:'header_values_get', cursor:Number(cursor)});
        const response = responses.get(Number(handle));
        if (!response) return FASTLY_STATUS_BADF;
        const name = readUtf8(pointer, length).toLowerCase();
        if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)) return FASTLY_STATUS_INVALID_ARGUMENT;
        return requestHeaderList(response.headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value), buffer, size, cursor, end, written, 'response-values', 'response');
      },
      header_value_get(handle, namePointer, nameLength, valuePointer, valueLength, writtenOut) {
        const response = responses.get(Number(handle));
        const name = readUtf8(namePointer, nameLength);
        trace.push({ module: 'fastly_http_resp', name: 'header_value_get', handle: Number(handle), header: name });
        if (!response) return FASTLY_STATUS_BADF;
        const value = headerValue(response.headers, name);
        return value === undefined ? FASTLY_STATUS_INVALID_ARGUMENT : writeUtf8(value, valuePointer, valueLength, writtenOut);
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
        if (Number(streaming) === 1) responses.delete(Number(handle));
        return FASTLY_STATUS_OK;
      }
    },
    fastly_http_body: {
      close(handle) {
        trace.push({module:'fastly_http_body',name:'close',handle:Number(handle)});
        const body = bodies.get(Number(handle));
        if (body?.streamingUpload) {
          const {item,record} = body.streamingUpload;
          record.bodyBytes = bodyBytes(handle);
          if (item.fixture.echoBody) item.fixture = {...item.fixture,body:record.bodyBytes};
          item.readyAt = item.fixture.neverHeaders ? Infinity : monotonicMs + Number(item.fixture.delayMs || 0);
        }
        if (downstream?.streaming && downstream.bodyHandle === Number(handle)) { downstream.bodyBytes = bodyBytes(handle); downstream.finished = true; }
        return bodies.delete(Number(handle)) ? FASTLY_STATUS_OK : FASTLY_STATUS_BADF;
      },
      abandon(handle) {
        trace.push({module:'fastly_http_body',name:'abandon',handle:Number(handle)});
        const body = bodies.get(Number(handle));
        if (body?.streamingUpload) { body.streamingUpload.record.bodyBytes = bodyBytes(handle); body.streamingUpload.record.aborted = true; }
        if (downstream?.streaming && downstream.bodyHandle === Number(handle)) { downstream.bodyBytes = bodyBytes(handle); downstream.aborted = true; }
        return bodies.delete(Number(handle)) ? FASTLY_STATUS_OK : FASTLY_STATUS_BADF;
      },
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
        if (body.fixture && body.fixture.bodyReadStatus) return Number(body.fixture.bodyReadStatus);
        const source = bodyBytes(handle);
        const offset = body.readOffset || 0;
        const count = Math.min(Number(bufferLength), Math.max(0, source.length - offset), Number(body.fixture && body.fixture.chunkBytes || 65536));
        if (count > 0) new Uint8Array(memory().buffer, Number(buffer), count).set(source.subarray(offset, offset + count));
        body.readOffset = offset + count;
        body.readyAt = monotonicMs + Number(body.fixture && body.fixture.chunkDelayMs || 0);
        writeU32(readOut, count);
        trace.push({ module: 'fastly_http_body', name: 'read', handle: Number(handle), bytes: count, ...(options.traceBodyIo === true ? {pointer:Number(buffer), capacity:Number(bufferLength), now:monotonicMs} : {}) });
        return FASTLY_STATUS_OK;
      },
      write(handle, buffer, bufferLength, end, writtenOut) {
        const body = bodies.get(Number(handle));
        if (!body) return FASTLY_STATUS_BADF;
        if (downstream?.streaming && Number(handle) === downstream.bodyHandle && options.downstreamBodyWriteStatus) return Number(options.downstreamBodyWriteStatus);
        if ((requests.size > 1 || body.streamingUpload) && options.outboundBodyWriteStatus) return Number(options.outboundBodyWriteStatus);
        const length = Math.min(Number(bufferLength), Number(options.bodyWriteChunkBytes ?? bufferLength));
        const bytes = readBytes(buffer, length);
        body.writes.push(bytes);
        if (body.streamingUpload) body.readyAt = monotonicMs + Number(options.uploadWriteDelayMs || 0);
        if (downstream?.streaming && downstream.bodyHandle === Number(handle)) body.readyAt = monotonicMs + Number(options.downstreamWriteDelayMs || 0);
        writeU32(writtenOut, bytes.length);
        trace.push({ module: 'fastly_http_body', name: 'write', handle: Number(handle), bytes: bytes.length, end: Number(end), ...(options.traceBodyIo === true ? {pointer:Number(buffer), capacity:Number(bufferLength), now:monotonicMs} : {}) });
        return FASTLY_STATUS_OK;
      }
    }
  };

  const cacheEvidence = options.cache ? require('./native-cache-host.js').attachCacheHost(imports, {view, writeU32, readBytes, readUtf8, alloc, bodies, bodyBytes, trace, now:()=>monotonicMs, advance:ms=>{monotonicMs+=ms;}}, options.cache) : undefined;

  const kvEvidence = options.conditionalKv ? require('./conditional-kv-host.js').attachConditionalKvHost(imports, {
    view, writeU32, writeU64, readBytes, readUtf8, alloc, bodies, bodyBytes, trace,
    now: () => monotonicMs, advance: ms => { monotonicMs += ms; }
  }, options.conditionalKv) : undefined;

  // Model invocation termination, including cancellation raised by a host call.
  // Throwing stops the Wasm invocation; it never fabricates an effect result.
  const checkActive = () => { if (options.signal && options.signal.aborted) throw options.signal.reason || new Error('Request cancelled.'); };
  checkActive();
  // A test-only post-call hook can corrupt ABI outputs or advance the clock.
  // It observes the real generated guest; it is never used by provider execution.
  if (options.signal || options.hostcallDelayMs || options.afterHostcall) for (const [moduleName, namespace] of Object.entries(imports)) {
    for (const [name, hostcall] of Object.entries(namespace)) if (typeof hostcall === 'function') namespace[name] = (...args) => {
      checkActive(); const result = hostcall(...args);
      monotonicMs += Number(options.hostcallDelayMs?.[`${moduleName}.${name}`] || 0);
      const replacement = options.afterHostcall?.({module:moduleName,name,args,result,trace,
        writeU32,writeU64,readU32:pointer=>view().getUint32(Number(pointer),true),
        advance:ms=>{monotonicMs+=ms;}});
      checkActive(); return replacement ?? result;
    };
  }
  const module = new WebAssembly.Module(wasm);
  instance = new WebAssembly.Instance(module, imports);
  if (typeof instance.exports._start !== 'function') {
    throw new FastlyNativePlatformCapabilitiesMockError('Pass98 native module is missing _start.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_START_MISSING');
  }
  if (options.conditionalKv && options.conditionalKv.deadlineNs !== undefined) instance.exports.pulse_fastly_kv_request_deadline(BigInt(options.conditionalKv.deadlineNs));
  const callableEvidence = () => input?.plan?.callables?.length ? {
    guestMemoryBytes: instance.exports.memory.buffer.byteLength,
    memory: { bytes: Number(instance.exports.pulse_fastly_memory_bytes()),
      values: Number(instance.exports.pulse_fastly_memory_values()) },
    responseStatus: downstream?.status
  } : {};
  try { instance.exports._start(); }
  catch (error) {
    if (Number(instance.exports.pulse_fastly_last_error?.()) !== 1010) {
      Object.defineProperty(error, 'execution', { value: Object.freeze(callableEvidence()), configurable: true });
      throw error;
    }
    throw new FastlyNativePlatformCapabilitiesMockError('Native retained-value budget exceeded.',
      'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED', {
        ...callableEvidence(), lastError: 1010, errorStage: Number(instance.exports.pulse_fastly_error_stage()), trace,
        bytes: Number(instance.exports.pulse_fastly_memory_bytes()),
        values: Number(instance.exports.pulse_fastly_memory_values())
      });
  }
  for (const entry of trace) if (entry.url && privateUrls.has(entry.url)) entry.url = '[REDACTED]';
  const lastError = typeof instance.exports.pulse_fastly_last_error === 'function'
    ? Number(instance.exports.pulse_fastly_last_error())
    : undefined;
  const errorStage = typeof instance.exports.pulse_fastly_error_stage === 'function'
    ? Number(instance.exports.pulse_fastly_error_stage())
    : undefined;
  const errorEffect = typeof instance.exports.pulse_fastly_error_effect === 'function'
    ? Number(instance.exports.pulse_fastly_error_effect())
    : undefined;
  const pulseLastError = typeof instance.exports.pulse_last_error_code === 'function'
    ? Number(instance.exports.pulse_last_error_code())
    : undefined;
  if (downstream?.streaming && !downstream.finished) { downstream.bodyBytes = bodyBytes(downstream.bodyHandle) || downstream.bodyBytes; downstream.aborted = true; }
  const handledJwtError = options.allowHandledJwtError === true
    && lastError === 1008
    && Boolean(downstream);
  const handledHeaderError = options.allowHandledHeaderError === true
    && lastError === 1003 && (errorStage === 22 || errorStage === 23) && downstream?.status === 500;
  const handledTransportError = options.allowHandledTransportError === true
    && (errorStage === 77 || errorStage === 81)
    && ((lastError === 1006 && downstream?.status === 502) || (lastError === 1003 && downstream?.status === 500));
  const handledDeadlineError = options.allowHandledFetchDeadlineError === true
    && ((lastError === 1006 && errorStage === 271 && downstream?.status === 504)
      || (lastError === 1001 && errorStage === 270 && downstream?.status === 400)
      || (lastError === 1003 && errorStage === 272 && downstream?.status === 500));
  const handledDynamicBackendError = options.allowHandledDynamicBackendError === true
    && ((lastError === 1001 && errorStage === 273 && downstream?.status === 400)
      || (lastError === 1001 && errorStage === 276 && downstream?.status === 500)
      || (lastError === 1003 && (errorStage === 274 || errorStage === 275) && downstream?.status === 500));
  const handledCacheError = options.allowHandledCacheError === true && lastError === 1003 && errorStage >= 300 && errorStage <= 309 && downstream?.status === 500;
  if (lastError !== FASTLY_STATUS_OK && !handledCacheError && !handledDynamicBackendError && !handledDeadlineError && !handledTransportError && !handledHeaderError && !handledJwtError && !(options.allowAbortedResponse === true && downstream?.aborted)) {
    throw new FastlyNativePlatformCapabilitiesMockError('Fastly native platform capabilities module reported an execution error.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED', { ...callableEvidence(), lastError, errorStage, errorEffect, pulseLastError, trace });
  }
  if (!downstream) {
    throw new FastlyNativePlatformCapabilitiesMockError('Fastly native platform capabilities module did not send a downstream response.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_RESPONSE_NOT_SENT', { trace });
  }

  return Object.freeze({
    ...callableEvidence(),
    cacheEvidence,
    version: 'pulse.fastly-native-platform-capabilities-mock.v1',
    request: Object.freeze({ method, url, path: pathValue, headers: Object.freeze(requestHeaders.map((entry) => Object.freeze(entry))) }),
    response: Object.freeze({
      status: downstream.status,
      headers: Object.freeze(downstream.headers.map((entry) => Object.freeze(entry))),
      body: downstream.bodyBytes.toString('utf8'),
      bodyBytes: downstream.bodyBytes,
      sent: true,
      streaming: downstream.streaming,
      aborted: downstream.aborted === true,
      origin: downstream.origin,
      responseHandle: downstream.responseHandle,
      bodyHandle: downstream.bodyHandle
    }),
    trace: Object.freeze(trace.map((entry) => Object.freeze({ ...entry }))),
    logs: Object.freeze(logs),
    outboundRequests: Object.freeze(outboundRequests),
    stores: Object.freeze({ config: snapshotStores(configStores), secrets: Object.fromEntries([...secretStores].map(([name, values]) => [name, Object.fromEntries([...values].map(([key]) => [key, '[REDACTED]']))])), kv: snapshotStores(kvStores, true) }),
    kvEvidence,
    monotonicMs,
    transportResources: Object.freeze({pendingRequests: pending.size,
      outboundRequests: requests.size - Number(requests.has(downstreamRequestHandle))}),
    // Non-streaming send transfers these two handles even though the fixture
    // keeps their bytes for assertions. Pending work is counted separately:
    // Fastly has no cancellation hostcall for an unresolved pending request.
    forwardingResources: Object.freeze({
      bodies: bodies.size - Number(!downstream?.streaming && bodies.has(downstream?.bodyHandle)),
      responses: responses.size - Number(!downstream?.streaming && responses.has(downstream?.responseHandle))
    }),
    instance
  });
}

module.exports = Object.freeze({
  FASTLY_STATUS_OK,
  FASTLY_STATUS_ERROR,
  FASTLY_STATUS_BADF,
  FASTLY_STATUS_BUFLEN,
  FASTLY_STATUS_NONE,
  FASTLY_KV_ERROR_OK,
  FASTLY_KV_ERROR_NOT_FOUND,
  FastlyNativePlatformCapabilitiesMockError,
  normalizeHeaders,
  fixtureKey,
  executeFastlyNativePlatformCapabilities
});
