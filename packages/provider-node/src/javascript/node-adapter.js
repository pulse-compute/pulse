'use strict';

const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const runtimeHost = require('@pulse-compute/runtime/host');
const { executeNodeJavascriptApplication } = require('./runtime-host.js');
const {
  createNodeJavascriptBindingCapabilities,
  withNodeBindingCapabilities
} = require('./bindings-adapter.js');

const NODE_JAVASCRIPT_REQUEST_ADAPTER_VERSION = 'pulse.node-javascript-request-adapter.v1';
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

class PulseNodeJavascriptRequestError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'PulseNodeJavascriptRequestError';
    this.code = code;
    this.detail = detail && Object.freeze(detail);
  }
}

function normalizeRawHeaders(rawHeaders) {
  if (!Array.isArray(rawHeaders)) return Object.freeze([]);
  const pairs = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) pairs.push(Object.freeze([String(name), String(value)]));
  }
  return Object.freeze(pairs);
}

function nodeRequestHeaderPairs(request) {
  if (Array.isArray(request && request.rawHeaders) && request.rawHeaders.length > 0) {
    return normalizeRawHeaders(request.rawHeaders);
  }
  const pairs = [];
  for (const [name, value] of Object.entries(request && request.headers || {})) {
    if (Array.isArray(value)) {
      for (const item of value) pairs.push(Object.freeze([String(name), String(item)]));
    } else if (value !== undefined) {
      pairs.push(Object.freeze([String(name), String(value)]));
    }
  }
  return Object.freeze(pairs);
}

function requestOrigin(request, options = {}) {
  if (options.baseUrl) return new URL(String(options.baseUrl)).origin;
  const encrypted = Boolean(request && request.socket && request.socket.encrypted);
  const protocol = options.protocol || (encrypted ? 'https' : 'http');
  const host = request && request.headers && request.headers.host
    ? String(request.headers.host)
    : String(options.host || '127.0.0.1');
  return `${protocol}://${host}`;
}

function requestUrl(request, options = {}) {
  const raw = request && request.url ? String(request.url) : '/';
  return new URL(raw, requestOrigin(request, options)).toString();
}

function bodyAllowed(method) {
  const normalized = String(method || 'GET').toUpperCase();
  return normalized !== 'GET' && normalized !== 'HEAD';
}

async function readNodeRequestBody(request, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('Pulse Node maxBodyBytes must be a positive safe integer.');
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > limit) {
        throw new PulseNodeJavascriptRequestError(
          'PULSE_REQUEST_BODY_TOO_LARGE',
          `Request body exceeds ${limit} bytes.`,
          { maxBytes: limit, bytes }
        );
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof PulseNodeJavascriptRequestError) throw error;
    throw new PulseNodeJavascriptRequestError(
      'PULSE_NODE_REQUEST_READ_FAILED',
      'Pulse could not read the Node request body.',
      { causeName: error && error.name }
    );
  }
  return Buffer.concat(chunks);
}

async function nodeRequestToWebRequest(request, options = {}) {
  if (!request || typeof request !== 'object') throw new TypeError('Pulse Node request adaptation requires an IncomingMessage-like object.');
  const method = String(request.method || 'GET').toUpperCase();
  const headerPairs = nodeRequestHeaderPairs(request);
  const headers = new Headers();
  for (const [name, value] of headerPairs) headers.append(name, value);
  const init = { method, headers };
  if (bodyAllowed(method)) {
    const body = await readNodeRequestBody(request, options.maxRequestBodyBytes ?? options.maxBodyBytes);
    if (body.byteLength > 0) {
      init.body = body;
      init.duplex = 'half';
    }
  }
  return Object.freeze({
    request: new Request(requestUrl(request, options), init),
    headerPairs,
    method
  });
}

function groupHeaderPairs(pairs) {
  const order = [];
  const groups = new Map();
  for (const [name, value] of pairs || []) {
    const displayName = String(name);
    const key = displayName.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { name: displayName, values: [] });
      order.push(key);
    }
    groups.get(key).values.push(String(value));
  }
  return Object.freeze(order.map((key) => Object.freeze({
    name: groups.get(key).name,
    values: Object.freeze(groups.get(key).values)
  })));
}

function statusAllowsBody(status) {
  const value = Number(status);
  return value !== 204 && value !== 205 && value !== 304 && !(value >= 100 && value < 200);
}

async function writeWebResponseToNode(response, nodeResponse, options = {}) {
  if (!(response instanceof Response)) throw new TypeError('Pulse Node response adaptation requires a Web Response.');
  if (!nodeResponse || typeof nodeResponse.end !== 'function') throw new TypeError('Pulse Node response adaptation requires a ServerResponse-like object.');

  nodeResponse.statusCode = response.status;
  if (response.statusText && typeof nodeResponse.statusMessage === 'string') nodeResponse.statusMessage = response.statusText;
  for (const group of groupHeaderPairs(runtimeHost.responseHeaderPairs(response))) {
    nodeResponse.setHeader(group.name, group.values.length === 1 ? group.values[0] : [...group.values]);
  }

  const method = String(options.requestMethod || 'GET').toUpperCase();
  if (method === 'HEAD' || !statusAllowsBody(response.status) || response.body == null) {
    nodeResponse.end();
    return response;
  }

  if (typeof Readable.fromWeb === 'function') {
    await pipeline(Readable.fromWeb(response.body), nodeResponse);
    return response;
  }

  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
  return response;
}

async function resolveRequestOption(value, context) {
  return typeof value === 'function' ? value(context) : value;
}

function createNodeJavascriptHandler(application, options = {}) {
  const normalizedApplication = options.getApplication ? null : runtimeHost.normalizeApplication(application);
  const hasDynamicBindings = [options.config, options.secrets, options.kv]
    .some((value) => typeof value === 'function');
  const staticBindings = hasDynamicBindings
    ? undefined
    : createNodeJavascriptBindingCapabilities({
        config: options.config,
        secrets: options.secrets,
        kv: options.kv,
        kvReference: options.kvReference,
        maxBindingNameBytes: options.maxBindingNameBytes,
        maxBindingValueBytes: options.maxBindingValueBytes,
        maxKvNamespaceBytes: options.maxKvNamespaceBytes,
        maxKvKeyBytes: options.maxKvKeyBytes,
        maxKvValueBytes: options.maxKvValueBytes,
        maxKvValueDepth: options.maxKvValueDepth,
        maxKvValueEntries: options.maxKvValueEntries
      });
  return async function pulseNodeJavascriptHandler(request, response) {
    const adapted = await nodeRequestToWebRequest(request, options);
    const requestContext = Object.freeze({
      request,
      response,
      webRequest: adapted.request,
      headerPairs: adapted.headerPairs
    });
    const requestedCapabilities = await resolveRequestOption(options.capabilities, requestContext);
    const effectAdapter = await resolveRequestOption(options.effectAdapter, requestContext);
    const schemaCodecs = await resolveRequestOption(options.schemaCodecs, requestContext);
    const config = hasDynamicBindings ? await resolveRequestOption(options.config, requestContext) : options.config;
    const secrets = hasDynamicBindings ? await resolveRequestOption(options.secrets, requestContext) : options.secrets;
    const kv = hasDynamicBindings ? await resolveRequestOption(options.kv, requestContext) : options.kv;
    const bindings = staticBindings || createNodeJavascriptBindingCapabilities({
      config, secrets, kv,
      kvReference: options.kvReference,
      maxBindingNameBytes: options.maxBindingNameBytes,
      maxBindingValueBytes: options.maxBindingValueBytes,
      maxKvNamespaceBytes: options.maxKvNamespaceBytes,
      maxKvKeyBytes: options.maxKvKeyBytes,
      maxKvValueBytes: options.maxKvValueBytes,
      maxKvValueDepth: options.maxKvValueDepth,
      maxKvValueEntries: options.maxKvValueEntries
    });
    const capabilities = effectAdapter === undefined
      ? withNodeBindingCapabilities(requestedCapabilities, { bindings })
      : requestedCapabilities;
    const started = process.hrtime.bigint();
    const activeApplication = options.getApplication
      ? runtimeHost.normalizeApplication(options.getApplication())
      : normalizedApplication;
    const webResponse = await executeNodeJavascriptApplication(activeApplication, adapted.request, {
      capabilities,
      effectAdapter,
      config,
      secrets,
      kv,
      application: options.application,
      requestHeaders: adapted.headerPairs,
      signal: options.signal || adapted.request.signal,
      fetchImplementation: options.fetchImplementation,
      assetsLookup: options.assetsLookup,
      gripBroadcast: options.gripBroadcast,
      jwtCaptureWallClock: options.jwtCaptureWallClock,
      assets: options.assets,
      grip: options.grip,
      maxEffects: options.maxEffects,
      kvClock: options.kvClock, deadlineMonotonicMs: options.deadlineMonotonicMs,
      maxRequestBodyBytes: options.maxRequestBodyBytes ?? options.maxBodyBytes,
      maxFetchBodyBytes: options.maxFetchBodyBytes,
      maxStructuredBodyBytes: options.maxStructuredBodyBytes,
      maxBindingNameBytes: options.maxBindingNameBytes,
      maxBindingValueBytes: options.maxBindingValueBytes,
      maxKvNamespaceBytes: options.maxKvNamespaceBytes,
      maxKvKeyBytes: options.maxKvKeyBytes,
      maxKvValueBytes: options.maxKvValueBytes,
      maxKvValueDepth: options.maxKvValueDepth,
      maxKvValueEntries: options.maxKvValueEntries,
      schemaCodecs,
      strict: options.strict === true,
      provider: options.provider || 'node',
      redactionValues: options.redactionValues,
      onJsonTrace: options.onJsonTrace,
      onEffectObservation: options.onEffectObservation,
      onEffectSummary: options.onEffectSummary
    });
    await writeWebResponseToNode(webResponse, response, { requestMethod: adapted.method });
    if (typeof options.onRequest === 'function') {
      options.onRequest(Object.freeze({
        method: adapted.method,
        url: adapted.request.url,
        path: new URL(adapted.request.url).pathname,
        status: webResponse.status,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6
      }));
    }
    return webResponse;
  };
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_REQUEST_ADAPTER_VERSION,
  DEFAULT_MAX_BODY_BYTES,
  PulseNodeJavascriptRequestError,
  createNodeJavascriptHandler,
  groupHeaderPairs,
  nodeRequestHeaderPairs,
  nodeRequestToWebRequest,
  normalizeRawHeaders,
  readNodeRequestBody,
  requestUrl,
  writeWebResponseToNode
});
