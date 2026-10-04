'use strict';

const http = require('node:http');
const { Readable } = require('node:stream');
const { createRequestBudget } = require('@pulse-compute/runtime/host');
const { executeCanonicalNativeModule } = require('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host');
const { createNodeProviderAdapter } = require('../runtime/canonical-api-runtime.js');
const { createNodeKvReference } = require('../runtime/conditional-kv.js');
const { createNodeJavascriptHandler, nodeRequestToWebRequest, writeWebResponseToNode } = require('../javascript/node-adapter.js');
const { statusForError } = require('../javascript/lifecycle.js');
const { normalizeOptions } = require('./config.js');
const { loadBuild } = require('./build.js');

function safeError(response, error) {
  if (response.destroyed) return;
  if (response.headersSent) { response.destroy(); return; }
  const status = statusForError(error);
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
  response.end(status === 504 ? 'Gateway Timeout' : status === 413 ? 'Payload Too Large' : status === 400 ? 'Bad Request' : 'Internal Server Error');
}

function nativeHandler(build, options) {
  const providerAdapter = createNodeProviderAdapter(options);
  return async (request, response, signal) => {
    const budget = createRequestBudget({ ...options, signal });
    try {
      const adapted = await budget.race(nodeRequestToWebRequest(request, { ...options, signal: budget.signal }));
      const input = { method: adapted.method, url: adapted.request.url, headers: adapted.headerPairs,
        body: adapted.request.body ? Buffer.from(await budget.race(adapted.request.arrayBuffer())) : undefined };
      const execution = await executeCanonicalNativeModule(build.native, {
        ...options, providerAdapter, request: input, requestBudget: budget, signal: budget.signal,
        maxBodyBytes: options.maxRequestBodyBytes
      });
      const result = execution.response;
      const suppressed = adapted.method === 'HEAD' || [204, 205, 304].includes(result.status);
      let body = result.bodyStream ?? result.body ?? null;
      if (suppressed && result.bodyStream) {
        if (typeof body.cancel === 'function') await body.cancel();
        else body.destroy?.();
      }
      if (body && typeof body.pipe === 'function') body = Readable.toWeb(body);
      const webResponse = new Response(suppressed ? null : body, { status: result.status, headers: result.headers });
      await writeWebResponseToNode(webResponse, response, { requestMethod: adapted.method, requestBudget: budget, signal: budget.signal });
    } finally { budget.close(); }
  };
}

/** Create a production HTTP lifecycle over one immutable, trusted pulse build. */
function createNodeLauncher(input) {
  const options = normalizeOptions(input);
  let state = 'created', generation, starting, stopping, lastClose = Object.freeze({ forced: false, abortedRequests: 0 });
  // Snapshot the build once; restart is a fresh host generation, not hot reload.
  const build = loadBuild(options);
  // Validate host bindings before entering any lifecycle transition.
  const { createNodeJavascriptBindingCapabilities } = require('../javascript/bindings-adapter.js');
  createNodeJavascriptBindingCapabilities(options);
  function status() {
    const address = generation?.server.address();
    return Object.freeze({ state, target: options.target, buildId: build.identity,
      activeRequests: generation?.active.size || 0,
      address: address && typeof address === 'object' ? Object.freeze({ host: address.address, port: address.port }) : null });
  }
  function start() {
    if (state === 'ready') return Promise.resolve(status());
    if (state === 'starting') return starting;
    if (state === 'draining') return Promise.reject(new Error('Node launcher is draining; await close before start.'));
    state = 'starting';
    const active = new Set(), sockets = new Set();
    const execution = { ...options, kvReference: createNodeKvReference({ kv: structuredClone(options.kv || {}) }),
      fetchImplementation: options.networkFetch ? globalThis.fetch : undefined,
      liveFetch: options.networkFetch, schemaCodecs: build.schemaCodecs };
    const javascript = options.target === 'javascript' ? createNodeJavascriptHandler(build.application, execution) : null;
    const native = options.target === 'native' ? nativeHandler(build, execution) : null;
    const current = { active, sockets, server: null, onIdle: null };
    const server = http.createServer({
      headersTimeout: options.headersTimeoutMs, requestTimeout: Math.max(options.maxDurationMs, options.headersTimeoutMs),
      keepAliveTimeout: options.keepAliveTimeoutMs, maxHeaderSize: 16384
    }, (request, response) => {
      const reject = (code, message) => { response.writeHead(code, { connection: 'close', 'content-type': 'text/plain; charset=utf-8' }); response.end(message); };
      const pathname = (request.url || '/').split('?')[0];
      if (pathname === options.readinessPath) {
        response.setHeader('cache-control', 'no-store');
        response.setHeader('connection', 'close');
        if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('allow', 'GET, HEAD'); reject(405, 'Method Not Allowed'); return; }
        response.statusCode = state === 'ready' && generation === current ? 200 : 503;
        response.end(request.method === 'HEAD' ? undefined : response.statusCode === 200 ? 'ready' : 'not ready');
        return;
      }
      if (state !== 'ready' || generation !== current || active.size >= options.maxConcurrentRequests) { reject(503, 'Service Unavailable'); return; }
      const controller = new AbortController();
      active.add(controller);
      const disconnect = () => controller.abort(new Error('Node launcher request disconnected.'));
      const closed = () => { if (!response.writableFinished) disconnect(); };
      request.once('aborted', disconnect); response.once('close', closed);
      // Each invocation owns its own cancellation signal, including forced drain.
      const run = javascript
        ? javascript(request, response, controller.signal)
        : native(request, response, controller.signal);
      Promise.resolve(run).catch(error => safeError(response, error)).finally(() => {
        request.removeListener('aborted', disconnect); response.removeListener('close', closed);
        active.delete(controller); current.onIdle?.();
      });
    });
    current.server = server; generation = current;
    server.maxConnections = options.maxConnections;
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    // This listener remains after listen to prevent an unhandled server error.
    server.on('error', () => { if (state === 'ready' && generation === current) void close(); });
    starting = new Promise((resolve, reject) => {
      const error = () => { server.removeListener('listening', ready); state = 'stopped'; reject(new Error('Node launcher could not listen.')); };
      const ready = () => { server.removeListener('error', error); state = 'ready'; resolve(status()); };
      server.once('error', error); server.once('listening', ready);
      try { server.listen(options.port, options.host); } catch (cause) { server.removeListener('error', error); error(); }
    });
    return starting;
  }
  function close() {
    if (state === 'starting') return starting.then(() => close(), () => lastClose);
    if (state === 'draining') return stopping;
    if (state === 'created' || state === 'stopped') { state = 'stopped'; return Promise.resolve(lastClose); }
    state = 'draining';
    const current = generation;
    stopping = new Promise(resolve => {
      let closed = false, finished = false;
      const finish = result => {
        if (finished) return;
        finished = true; clearTimeout(timer); current.onIdle = null;
        state = 'stopped'; lastClose = Object.freeze(result); resolve(lastClose);
      };
      const check = () => { if (closed && current.active.size === 0) finish({ forced: false, abortedRequests: 0 }); };
      const timer = setTimeout(() => {
        const abortedRequests = current.active.size;
        for (const controller of current.active) controller.abort(new Error('Node launcher drain deadline exceeded.'));
        for (const socket of current.sockets) socket.destroy();
        finish({ forced: true, abortedRequests });
      }, options.shutdownTimeoutMs);
      current.onIdle = check;
      current.server.close(() => { closed = true; check(); });
      current.server.closeIdleConnections();
    });
    return stopping;
  }
  return Object.freeze({ start, close, status });
}

module.exports = { createNodeLauncher };
