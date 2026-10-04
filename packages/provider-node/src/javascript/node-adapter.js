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

async function readNodeRequestBody(request, maxBytes = DEFAULT_MAX_BODY_BYTES, signal) {
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('Pulse Node maxBodyBytes must be a positive safe integer.');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    function cleanup() {
      for (const [event, fn] of [['data', data], ['end', end], ['error', error], ['aborted', aborted]]) request.removeListener(event, fn);
      signal?.removeEventListener('abort', cancel);
    }
    function fail(cause) { cleanup(); chunks.length = 0; request.once('error', () => {}); request.resume(); reject(cause); }
    function cancel() { fail(signal.reason); }
    function error(cause) { fail(new PulseNodeJavascriptRequestError('PULSE_NODE_REQUEST_READ_FAILED', 'Pulse could not read the Node request body.', { causeName: cause?.name })); }
    function aborted() { error(new Error('Request aborted')); }
    function data(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > limit) return fail(new PulseNodeJavascriptRequestError('PULSE_REQUEST_BODY_TOO_LARGE', `Request body exceeds ${limit} bytes.`, { maxBytes: limit, bytes }));
      chunks.push(buffer);
    }
    function end() { cleanup(); resolve(Buffer.concat(chunks)); }
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', aborted);
  });
}

async function nodeRequestToWebRequest(request, options = {}) {
  if (!request || typeof request !== 'object') throw new TypeError('Pulse Node request adaptation requires an IncomingMessage-like object.');
  const method = String(request.method || 'GET').toUpperCase();
  const headerPairs = nodeRequestHeaderPairs(request);
  const headers = new Headers();
  for (const [name, value] of headerPairs) headers.append(name, value);
  const init = { method, headers };
  if (bodyAllowed(method)) {
    if (options.bodyForwarding || options.bodyTransform) {
      init.body = require('./incoming-body.js').nodeIncomingStream(request);
      init.duplex = 'half';
    } else {
      const body = await readNodeRequestBody(request, options.maxRequestBodyBytes ?? options.maxBodyBytes, options.signal);
      if (body.byteLength > 0) {
        init.body = body;
        init.duplex = 'half';
      }
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

  const check = () => { options.requestBudget?.check(); options.signal?.throwIfAborted(); };
  try {
    check();
    nodeResponse.statusCode = response.status;
    if (response.statusText && typeof nodeResponse.statusMessage === 'string') nodeResponse.statusMessage = response.statusText;
    for (const group of groupHeaderPairs(runtimeHost.responseHeaderPairs(response))) {
      nodeResponse.setHeader(group.name, group.values.length === 1 ? group.values[0] : [...group.values]);
    }
    if (options.closeConnection) nodeResponse.setHeader('connection', 'close');

    const method = String(options.requestMethod || 'GET').toUpperCase();
    if (method === 'HEAD' || !statusAllowsBody(response.status) || response.body == null) {
      check();
      nodeResponse.end();
      return response;
    }

    if (typeof Readable.fromWeb === 'function') {
      check();
      await pipeline(Readable.fromWeb(response.body), nodeResponse, { signal: options.signal });
      check();
      return response;
    }

    const body = Buffer.from(await response.arrayBuffer());
    check();
    nodeResponse.end(body);
    return response;
  } catch (error) {
    if (response.body && !response.body.locked) void response.body.cancel(error).catch(() => {});
    // Preserve the deadline diagnostic instead of pipeline's generic AbortError.
    check();
    throw error;
  }
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
  return async function pulseNodeJavascriptHandler(request, response, requestSignal) {
    const connection = new AbortController();
    const aborted = () => connection.abort(new Error('Node request disconnected.'));
    const closed = () => { if (!response.writableFinished) aborted(); };
    request.once('aborted', aborted); response.once?.('close', closed);
    const signal = AbortSignal.any([options.signal, requestSignal, connection.signal].filter(Boolean));
    const budget = runtimeHost.createRequestBudget({ ...options, signal });
    let incomingBody, adapted, outputExecution;
    try {
      budget.check();
      adapted = await budget.race(nodeRequestToWebRequest(request, { ...options, signal: budget.signal }));
      if ((options.bodyForwarding || options.bodyTransform) && bodyAllowed(adapted.method)) response.setHeader('connection', 'close');
      incomingBody = require('./incoming-body.js').createIncomingBody(adapted.request, {
        ...options, signal: budget.signal, responseWriterOwnsCompletion: true
      });
      const requestContext = Object.freeze({
        request,
        response,
        webRequest: adapted.request,
        signal: budget.signal,
        headerPairs: adapted.headerPairs
      });
      const resolve = value => { budget.check(); return budget.race(resolveRequestOption(value, requestContext)); };
      const requestedCapabilities = await resolve(options.capabilities);
      const effectAdapter = await resolve(options.effectAdapter);
      const schemaCodecs = await resolve(options.schemaCodecs);
      const config = hasDynamicBindings ? await resolve(options.config) : options.config;
      const secrets = hasDynamicBindings ? await resolve(options.secrets) : options.secrets;
      const kv = hasDynamicBindings ? await resolve(options.kv) : options.kv;
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
      outputExecution = require('../runtime/generated-output.js').createGeneratedOutput(response, { ...options, requestBudget: budget, requestMethod: adapted.method });
      const webResponse = await executeNodeJavascriptApplication(activeApplication, adapted.request, {
        outputExecution,
        incomingBody,
        capabilities,
        effectAdapter,
        config,
        secrets,
        kv,
        application: options.application,
        requestHeaders: adapted.headerPairs,
        signal: budget.signal,
        requestBudget: budget, requestClock: options.requestClock,
        fetchImplementation: options.fetchImplementation,
        s3: options.s3 || options.bindings && options.bindings.s3,
        s3FetchImplementation: options.s3FetchImplementation,
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
      if (incomingBody?.failure) throw incomingBody.failure;
      if (outputExecution?.started) await outputExecution.finish();
      else await writeWebResponseToNode(webResponse, response, {
        requestMethod: adapted.method,
        signal: incomingBody?.responseSignal || budget.signal, requestBudget: budget,
        closeConnection: Boolean((options.bodyForwarding || options.bodyTransform) && bodyAllowed(adapted.method))
      });
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
    } finally {
      outputExecution?.dispose();
      await incomingBody?.close();
      if ((options.bodyForwarding || options.bodyTransform) && !incomingBody && adapted?.request.body && !adapted.request.body.locked) {
        void adapted.request.body.cancel().catch(() => {});
      }
      request.removeListener('aborted', aborted); response.removeListener?.('close', closed);
      if (!options.requestBudget) budget.close();
    }
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
