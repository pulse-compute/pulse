'use strict';

const { compileRoutePath, matchRoutePath, normalizeRoutePath } = require('./path.js');
const { createContext, createRequestView } = require('./context.js');
const { createJavascriptEffectExecution } = require('./effect-adapter.js');
const { reportingLevel } = require('./logging.js');
const {
  PulseRuntimeContractError,
  PulseUnhandledError,
  fetchResponseToResponse,
  isPulseFetchResponse,
  isPulseResult,
  markOpaqueResponse,
  responseBodyClass,
  responseHeaderPairs,
  statusAllowsBody,
  resultToResponse
} = require('./response.js');

const ROUTER_STATE = new WeakMap();
const TRANSFER_DATA = new WeakMap();
const NO_ERROR = Symbol('pulse.runtime.no-error');

function requireHandler(value, label) {
  if (typeof value !== 'function') throw new TypeError(`Pulse Router ${label} requires a handler function.`);
  return value;
}

function requireRouter(value) {
  if (!ROUTER_STATE.has(value)) throw new TypeError('Pulse Router mount(path, router) requires a Router instance.');
  return value;
}

function mergeParams(left, right) {
  return Object.freeze({ ...(left || {}), ...(right || {}) });
}

function entry(kind, fields) {
  return Object.freeze({ kind, ...fields });
}

class Router {
  constructor() {
    ROUTER_STATE.set(this, { entries: [] });
  }

  use(pathOrHandler, maybeHandler) {
    const state = ROUTER_STATE.get(this);
    if (typeof pathOrHandler === 'string') {
      state.entries.push(entry('use', {
        path: compileRoutePath(pathOrHandler, { scoped: true, allowWildcard: true }),
        handler: requireHandler(maybeHandler, 'use(path, handler)')
      }));
      return this;
    }
    state.entries.push(entry('use', { path: null, handler: requireHandler(pathOrHandler, 'use(handler)') }));
    return this;
  }

  get(path, handler) {
    ROUTER_STATE.get(this).entries.push(entry('route', {
      method: 'GET',
      path: compileRoutePath(path, { allowWildcard: true }),
      handler: requireHandler(handler, 'get(path, handler)')
    }));
    return this;
  }

  head(path, handler) {
    ROUTER_STATE.get(this).entries.push(entry('route', {
      method: 'HEAD',
      path: compileRoutePath(path, { allowWildcard: true }),
      handler: requireHandler(handler, 'head(path, handler)')
    }));
    return this;
  }

  post(path, handler) {
    ROUTER_STATE.get(this).entries.push(entry('route', {
      method: 'POST',
      path: compileRoutePath(path, { allowWildcard: true }),
      handler: requireHandler(handler, 'post(path, handler)')
    }));
    return this;
  }

  put(path, handler) {
    ROUTER_STATE.get(this).entries.push(entry('route', {
      method: 'PUT',
      path: compileRoutePath(path, { allowWildcard: true }),
      handler: requireHandler(handler, 'put(path, handler)')
    }));
    return this;
  }

  patch(path, handler) {
    ROUTER_STATE.get(this).entries.push(entry('route', {
      method: 'PATCH',
      path: compileRoutePath(path, { allowWildcard: true }),
      handler: requireHandler(handler, 'patch(path, handler)')
    }));
    return this;
  }

  delete(path, handler) {
    ROUTER_STATE.get(this).entries.push(entry('route', {
      method: 'DELETE',
      path: compileRoutePath(path, { allowWildcard: true }),
      handler: requireHandler(handler, 'delete(path, handler)')
    }));
    return this;
  }

  mount(path, router) {
    ROUTER_STATE.get(this).entries.push(entry('mount', {
      path: compileRoutePath(path, { scoped: true, allowWildcard: true }),
      router: requireRouter(router)
    }));
    return this;
  }

  error(handler) {
    ROUTER_STATE.get(this).entries.push(entry('error', { handler: requireHandler(handler, 'error(handler)') }));
    return this;
  }
}

function createTransferFactory() {
  const token = Object.freeze({});
  let transfer = null;
  function next(error) {
    if (transfer) {
      throw new PulseRuntimeContractError('PULSE_RUNTIME_NEXT_MULTIPLE', 'Pulse next() may be invoked at most once by a managed handler.');
    }
    transfer = {};
    Object.defineProperty(transfer, 'kind', { enumerable: false, value: 'pulse.router.transfer' });
    TRANSFER_DATA.set(transfer, Object.freeze({ token, error: error === undefined ? NO_ERROR : error }));
    Object.freeze(transfer);
    return transfer;
  }
  return Object.freeze({
    next,
    token,
    wasCalled: () => transfer !== null,
    transfer: () => transfer
  });
}

function transferData(value, token) {
  const data = value && typeof value === 'object' ? TRANSFER_DATA.get(value) : undefined;
  return data && data.token === token ? data : undefined;
}

function redactedError(frame, error) {
  return frame && frame.effectExecution && typeof frame.effectExecution.redactError === 'function'
    ? frame.effectExecution.redactError(error)
    : error;
}

function containUnexpected(error, frame) {
  const safe = redactedError(frame, error);
  return safe instanceof PulseUnhandledError ? safe : new PulseUnhandledError(safe);
}

function contractError(code, message) {
  return new PulseRuntimeContractError(code, message);
}

async function normalizeHandlerResponse(value, requestMethod) {
  if (isPulseResult(value)) return resultToResponse(value, requestMethod);
  if (isPulseFetchResponse(value)) return fetchResponseToResponse(value, requestMethod);
  if (value instanceof Response) {
    if (String(requestMethod).toUpperCase() !== 'HEAD' && statusAllowsBody(value.status)) return value;
    if (value.body && !value.bodyUsed) {
      try { await value.body.cancel(); } catch (_) { /* ownership cleanup is best effort */ }
    }
    const response = new Response(null, { status: value.status, statusText: value.statusText, headers: value.headers });
    return responseBodyClass(value) === 'opaque'
      ? markOpaqueResponse(response, responseHeaderPairs(value))
      : response;
  }
  return null;
}

function frameWith(frame, fields) {
  return { ...frame, ...fields };
}

async function dispatchRouter(router, frame, startIndex, activeError) {
  const entries = ROUTER_STATE.get(router).entries;
  let index = startIndex;
  let error = activeError;

  while (index < entries.length) {
    const current = entries[index];

    if (error !== NO_ERROR) {
      if (current.kind !== 'error') {
        index += 1;
        continue;
      }
      const result = await runErrorHandler(router, frame, index, error, current.handler);
      if (result.kind === 'continue') {
        index = result.index;
        error = result.error;
        continue;
      }
      return result;
    }

    if (current.kind === 'error') {
      index += 1;
      continue;
    }

    if (current.kind === 'mount') {
      const match = matchRoutePath(current.path, frame.relativePath);
      if (!match) {
        index += 1;
        continue;
      }
      const childFrame = frameWith(frame, {
        relativePath: match.rest,
        params: mergeParams(frame.params, match.params)
      });
      const childResult = await dispatchRouter(current.router, childFrame, 0, NO_ERROR);
      if (childResult.kind === 'continue') {
        if (childResult.error !== NO_ERROR) {
          error = childResult.error;
          frame = childResult.frame || childFrame;
        }
        index += 1;
        continue;
      }
      return childResult;
    }

    if (current.kind === 'use') {
      let handlerFrame = frame;
      if (current.path) {
        const match = matchRoutePath(current.path, frame.relativePath);
        if (!match) {
          index += 1;
          continue;
        }
        handlerFrame = frameWith(frame, {
          params: mergeParams(frame.params, match.params),
          packageRelativePath: match.rest
        });
      }
      const result = await runNormalHandler(router, handlerFrame, index, current.handler, false);
      if (result.kind === 'continue') {
        index = result.index;
        error = result.error;
        frame = result.frame || handlerFrame;
        continue;
      }
      return result;
    }

    if (current.kind === 'route') {
      if (frame.req.method !== current.method) {
        index += 1;
        continue;
      }
      const match = matchRoutePath(current.path, frame.relativePath);
      if (!match) {
        index += 1;
        continue;
      }
      const handlerFrame = frameWith(frame, { params: mergeParams(frame.params, match.params) });
      const result = await runNormalHandler(router, handlerFrame, index, current.handler, true);
      if (result.kind === 'continue') {
        index = result.index;
        error = result.error;
        frame = result.frame || handlerFrame;
        continue;
      }
      return result;
    }

    index += 1;
  }

  return Object.freeze({ kind: 'continue', index, error, frame });
}

async function runNormalHandler(_router, frame, index, handler, routeContext) {
  const transferFactory = createTransferFactory();
  const ctx = createContext({ ...frame, routeContext });
  let output;
  let handlerError;
  try {
    output = await handler(ctx, transferFactory.next);
  } catch (error) {
    handlerError = error;
  }
  try {
    await frame.effectExecution.assertIdle();
  } catch (error) {
    if (handlerError === undefined) handlerError = error;
  }
  if (handlerError !== undefined) {
    return Object.freeze({ kind: 'continue', index: index + 1, error: containUnexpected(handlerError, frame), frame });
  }

  const transfer = transferData(output, transferFactory.token);
  if (transferFactory.wasCalled()) {
    if (!transfer || output !== transferFactory.transfer()) {
      return Object.freeze({
        kind: 'continue',
        index: index + 1,
        error: containUnexpected(contractError(
          'PULSE_RUNTIME_NEXT_NOT_TERMINAL',
          'Pulse next() is a terminal transfer and its exact value must be returned.'
        ), frame),
        frame
      });
    }
    return Object.freeze({
      kind: 'continue',
      index: index + 1,
      error: transfer.error === NO_ERROR ? NO_ERROR : redactedError(frame, transfer.error),
      frame
    });
  }

  const response = await normalizeHandlerResponse(output, frame.req.method);
  if (response) return Object.freeze({ kind: 'response', response });
  return Object.freeze({
    kind: 'continue',
    index: index + 1,
    error: containUnexpected(contractError(
      'PULSE_RUNTIME_HANDLER_RESULT_REQUIRED',
      'Pulse handlers must return a response, next(), or next(error).'
    ), frame),
    frame
  });
}

async function runErrorHandler(_router, frame, index, activeError, handler) {
  const transferFactory = createTransferFactory();
  const ctx = createContext({ ...frame, routeContext: false });
  let output;
  let handlerError;
  try {
    output = await handler(activeError, ctx, transferFactory.next);
  } catch (error) {
    handlerError = error;
  }
  try {
    await frame.effectExecution.assertIdle();
  } catch (error) {
    if (handlerError === undefined) handlerError = error;
  }
  if (handlerError !== undefined) {
    return Object.freeze({ kind: 'continue', index: index + 1, error: containUnexpected(handlerError, frame), frame });
  }

  const transfer = transferData(output, transferFactory.token);
  if (transferFactory.wasCalled()) {
    if (!transfer || output !== transferFactory.transfer()) {
      return Object.freeze({
        kind: 'continue',
        index: index + 1,
        error: containUnexpected(contractError(
          'PULSE_RUNTIME_NEXT_NOT_TERMINAL',
          'Pulse next() is a terminal transfer and its exact value must be returned.'
        ), frame),
        frame
      });
    }
    return Object.freeze({
      kind: 'continue',
      index: index + 1,
      error: transfer.error === NO_ERROR ? NO_ERROR : redactedError(frame, transfer.error),
      frame
    });
  }

  const response = await normalizeHandlerResponse(output, frame.req.method);
  if (response) return Object.freeze({ kind: 'response', response });
  return Object.freeze({
    kind: 'continue',
    index: index + 1,
    error: containUnexpected(contractError(
      'PULSE_RUNTIME_HANDLER_RESULT_REQUIRED',
      'Pulse error handlers must return a response, next(), or next(error).'
    ), frame),
    frame
  });
}

async function executeRouter(router, request, options = {}) {
  requireRouter(router);
  if (!(request instanceof Request)) throw new TypeError('Pulse JavaScript execution requires a Web Request.');
  if (typeof options.onLogObservation === 'function') {
    const level = reportingLevel(options.reporting);
    const name = Object.freeze(['off', 'error', 'warn', 'info', 'debug'])[level];
    try {
      options.onLogObservation(Object.freeze({
        version: 'pulse.log-event.v1',
        type: 'logging-config',
        reporting: Object.freeze({ name, level }),
        target: options.target || 'javascript',
        provider: options.provider || null
      }));
    } catch (_) {
      // Logging evidence is best effort.
    }
  }
  const executionSignal = options.signal || request.signal;
  const effectExecution = createJavascriptEffectExecution({
    effectAdapter: options.effectAdapter,
    capabilities: options.capabilities,
    application: options.application,
    request,
    executionKind: 'request',
    signal: executionSignal,
    maxEffects: options.maxEffects,
    maxBindingNameBytes: options.maxBindingNameBytes,
    maxBindingValueBytes: options.maxBindingValueBytes,
    maxKvNamespaceBytes: options.maxKvNamespaceBytes,
    maxKvKeyBytes: options.maxKvKeyBytes,
    maxKvValueBytes: options.maxKvValueBytes,
    maxKvValueDepth: options.maxKvValueDepth,
    maxKvValueEntries: options.maxKvValueEntries,
    schemaCodecs: options.schemaCodecs,
    strict: options.strict,
    target: options.target,
    provider: options.provider,
    redactionValues: options.redactionValues,
    onEffectObservation: options.onEffectObservation
  });
  const req = createRequestView(request, options.requestHeaders, effectExecution, {
    ...options,
    signal: executionSignal,
    redactJsonTraceValue(value) { return effectExecution.redactValue(value); }
  });
  const executionOptions = Object.freeze({
    ...options,
    signal: executionSignal,
    redactJsonTraceValue(value) { return effectExecution.redactValue(value); }
  });
  const frame = {
    request,
    req,
    relativePath: normalizeRoutePath(req.path),
    params: Object.freeze({}),
    state: new Map(),
    effectExecution,
    signal: executionSignal,
    executionOptions
  };
  try {
    const result = await dispatchRouter(router, frame, 0, NO_ERROR);
    if (result.kind === 'response') return result.response;
    if (result.error !== NO_ERROR) {
      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }
    return new Response('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  } finally {
    try {
      await effectExecution.close();
    } finally {
      if (typeof options.onEffectSummary === 'function') options.onEffectSummary(effectExecution.summary());
    }
  }
}

function routerEntries(router) {
  requireRouter(router);
  return Object.freeze([...ROUTER_STATE.get(router).entries]);
}

module.exports = Object.freeze({
  Router,
  executeRouter,
  routerEntries
});
