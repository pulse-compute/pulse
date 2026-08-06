'use strict';

const http = require('node:http');
const https = require('node:https');

function loadHandlerEffectContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/handler/effects');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/handler/effects.js');
    }
    throw error;
  }
}

function loadDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/diagnostics.js');
    }
    throw error;
  }
}

const routeEffects = loadHandlerEffectContracts();
const { normalizeDiagnostic } = loadDiagnostics();

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}

function normalizePlan(input) {
  const plan = input && input.artifact && typeof input.artifact === 'object' ? input.artifact : input;
  if (!plan || typeof plan !== 'object') return undefined;
  return {
    ...plan,
    routes: Array.isArray(plan.routes) ? plan.routes.map(clone) : [],
    continuations: Array.isArray(plan.continuations) ? plan.continuations.map(clone) : []
  };
}

function makeDiagnostic(code, message, severity, details) {
  return normalizeDiagnostic({
    phase: 'node-route-handler-effects',
    severity: severity || 'error',
    code,
    message,
    hint: details && details.hint,
    details,
    loc: { file: '<node-route-handler-effects>' }
  });
}

function normalizeHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) return headers.filter((entry) => entry && entry[0] !== undefined && entry[1] !== undefined).map(([name, value]) => [String(name), String(value)]);
  if (typeof headers[Symbol.iterator] === 'function' && typeof headers !== 'string') return Array.from(headers, ([name, value]) => [String(name), String(value)]);
  return Object.entries(headers).map(([name, value]) => [String(name), String(value)]);
}

function headerValue(headers, name) {
  const lower = String(name || '').toLowerCase();
  const match = normalizeHeaders(headers).find(([key]) => String(key).toLowerCase() === lower);
  return match ? match[1] : undefined;
}

function pathParamNames(routePath) {
  return Array.from(String(routePath || '').matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g), (match) => match[1]);
}

function defaultParamsForRoute(route) {
  const params = {};
  for (const name of pathParamNames(route && route.path)) params[name] = 'abc';
  return params;
}

function evaluateExpression(expression, context = {}) {
  if (expression === undefined || expression === null) return '';
  if (typeof expression === 'string' || typeof expression === 'number' || typeof expression === 'boolean') return expression;
  if (typeof expression !== 'object') return String(expression);
  if (expression.kind === 'literal') return String(expression.value ?? '');
  if (expression.kind === 'number') return Number(expression.value || 0);
  if (expression.kind === 'boolean') return Boolean(expression.value);
  if (expression.kind === 'ctx.param') return String((context.params || {})[expression.name] ?? '');
  if (expression.kind === 'ctx.paramI32') return Number((context.params || {})[expression.name] || 0);
  if (expression.kind === 'local') return evaluateExpression(expression.value, context);
  if (expression.kind === 'concat') return (expression.parts || []).map((part) => evaluateExpression(part, context)).join('');
  return String(expression.value ?? '');
}


function hasHeader(headers, name) {
  const lower = String(name || '').toLowerCase();
  return normalizeHeaders(headers).some(([key]) => String(key).toLowerCase() === lower);
}

function jsonTextForSchemaEncode(json, context = {}) {
  if (!json || typeof json !== 'object') return undefined;
  if (json.kind !== 'schema-encode') return undefined;
  if (context.requestJsonText !== undefined) return String(context.requestJsonText);
  if (context.requestBodyText !== undefined) return String(context.requestBodyText);
  if (context.requestBody !== undefined) return typeof context.requestBody === 'string' ? context.requestBody : JSON.stringify(context.requestBody);
  if (context.schemaEncodeRefs && json.source && json.source.local && context.schemaEncodeRefs[json.source.local] !== undefined) {
    const value = context.schemaEncodeRefs[json.source.local];
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return '{}';
}

function requestFromEffect(effect, context = {}) {
  const request = effect && effect.request ? effect.request : {};
  const headers = (request.headers || []).map((header) => [String(header.name), String(evaluateExpression(header.value, context))]);
  const out = {
    method: String(request.method || 'GET').toUpperCase(),
    path: String(evaluateExpression(request.path, context) || '/'),
    headers
  };
  if ((request.bodyMode === 'json' || request.json) && request.json) {
    const body = jsonTextForSchemaEncode(request.json, context);
    out.bodyMode = 'json';
    out.schema = request.json.schema;
    out.body = body;
    if (!hasHeader(out.headers, 'content-type')) out.headers.push(['content-type', 'application/json; charset=utf-8']);
    if (!hasHeader(out.headers, 'content-length')) out.headers.push(['content-length', String(Buffer.byteLength(body || ''))]);
  }
  return out;
}

function normalizeResponse(value, request) {
  const method = String(request && request.method || 'GET').toUpperCase();
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    return { status: 200, kind: method === 'HEAD' ? 'empty' : 'text', headers: [['Content-Type', 'text/plain; charset=utf-8']], body: method === 'HEAD' ? '' : String(value) };
  }
  if (typeof value === 'object') {
    const kind = String(value.kind || '').toLowerCase();
    const opaque = method !== 'HEAD' && (kind === 'stream' || kind === 'opaque' || value.bodyStream !== undefined || value.bodyHandle !== undefined);
    if (opaque) {
      return {
        status: Number(value.status || 200),
        kind: 'stream',
        bodyClass: 'opaque',
        headers: normalizeHeaders(value.headers),
        bodyStream: value.bodyStream,
        bodyHandle: value.bodyHandle,
        responseRef: Number.isFinite(Number(value.responseRef)) ? Number(value.responseRef) : undefined,
        streamRef: Number.isFinite(Number(value.streamRef)) ? Number(value.streamRef) : undefined,
        hostOwnsStream: true,
        wasmOwnsBytes: false
      };
    }
    const body = value.body !== undefined ? value.body : value.text !== undefined ? value.text : value.content;
    return {
      status: Number(value.status || 200),
      kind: method === 'HEAD' ? 'empty' : (value.kind || 'text'),
      headers: normalizeHeaders(value.headers),
      body: method === 'HEAD' ? '' : (Buffer.isBuffer(body) ? body.toString('utf8') : body === undefined ? '' : String(body))
    };
  }
  return { status: 200, kind: method === 'HEAD' ? 'empty' : 'text', headers: [['Content-Type', 'text/plain; charset=utf-8']], body: method === 'HEAD' ? '' : String(value) };
}

function createDefaultBackendsFromPlan(planInput, defaultParams = {}) {
  const plan = normalizePlan(planInput) || { routes: [] };
  const backends = {};
  for (const route of plan.routes || []) {
    const params = { ...defaultParamsForRoute(route), ...defaultParams };
    for (const resolve of route.resolves || []) {
      for (const effect of resolve.effects || []) {
        if (!effect || effect.kind !== 'backend-fetch') continue;
        const request = requestFromEffect(effect, { route, params });
        if (!backends[effect.backend]) backends[effect.backend] = {};
        const response = {
          status: 200,
          kind: request.method === 'HEAD' ? 'empty' : 'text',
          headers: [
            ['Content-Type', 'text/plain; charset=utf-8'],
            ['X-PulseWasm-Backend', effect.backend],
            ['X-PulseWasm-Effect', effect.name || '$default'],
            ['X-Count', effect.name === 'posts' || request.method === 'HEAD' ? '2' : '1']
          ],
          body: request.method === 'HEAD' ? '' : `node-route-effect:${resolve.groupShape === 'single' ? '$default' : (effect.name || '$default')}:${effect.backend}:${request.method}:${request.path}`
        };
        backends[effect.backend][request.path] = response;
        backends[effect.backend][`${request.method} ${request.path}`] = response;
      }
    }
  }
  return backends;
}

function responseHandle(response, metadata = {}) {
  const normalized = response || { status: 500, kind: 'text', headers: [], body: '', diagnostics: [] };
  const opaque = normalized.kind === 'stream' || normalized.bodyClass === 'opaque' || normalized.bodyStream !== undefined || normalized.bodyHandle !== undefined;
  function bodyText() { return opaque ? '' : (normalized.body === undefined || normalized.body === null ? '' : String(normalized.body)); }
  return {
    status() { return Number(normalized.status || 0); },
    ok() { return this.status() >= 200 && this.status() < 300; },
    kind() { return opaque ? 'stream' : String(normalized.kind || 'text'); },
    bodyClass() { return opaque ? 'opaque' : 'structured'; },
    header(name) { return headerValue(normalized.headers, name) || ''; },
    text() { return bodyText(); },
    jsonText() { return bodyText(); },
    json(schema) {
      const text = bodyText();
      let parsed;
      let parseError;
      try { parsed = text ? JSON.parse(text) : null; }
      catch (error) { parseError = error; }
      return {
        ok() { return !parseError; },
        errorText() { return parseError ? JSON.stringify({ error: 'schema_decode_failed', schema: String(schema || ''), message: parseError.message }) : ''; },
        jsonText() { return text; },
        getString(path) { const value = parsed && parsed[String(path)]; return value === undefined || value === null ? '' : String(value); },
        getI32(path) { return Number.parseInt(this.getString(path), 10) || 0; },
        getU32(path) { const value = Number.parseInt(this.getString(path), 10) || 0; return value < 0 ? 0 : value; },
        getF64(path) { return Number.parseFloat(this.getString(path)) || 0; },
        getBool(path) { return Boolean(parsed && parsed[String(path)]); },
        has(path) { return Boolean(parsed && Object.prototype.hasOwnProperty.call(parsed, String(path))); },
        schema: String(schema || ''),
        response: this
      };
    },
    get diagnostics() { return clone(normalized.diagnostics || []); },
    toJSON() {
      return {
        status: this.status(),
        ok: this.ok(),
        kind: opaque ? 'stream' : (normalized.kind || 'text'),
        bodyClass: opaque ? 'opaque' : 'structured',
        request: metadata.request ? clone(metadata.request) : undefined,
        backend: metadata.backend,
        headers: normalizeHeaders(normalized.headers),
        body: opaque ? undefined : (normalized.body === undefined ? '' : String(normalized.body)),
        text: opaque ? undefined : this.text(),
        bodyStream: opaque ? normalized.bodyStream : undefined,
        bodyHandle: opaque ? normalized.bodyHandle : undefined,
        responseRef: opaque ? normalized.responseRef : undefined,
        streamRef: opaque ? normalized.streamRef : undefined,
        hostOwnsStream: opaque ? true : undefined,
        wasmOwnsBytes: opaque ? false : undefined,
        diagnostics: clone(normalized.diagnostics || [])
      };
    }
  };
}

function createResultFactory(responseHeaders) {
  function normalizeOptions(options) {
    const headers = [];
    if (options && options.headers) {
      for (const [name, value] of Object.entries(options.headers)) headers.push([String(name), String(value)]);
    }
    return headers;
  }
  return {
    text(status, body, options) { return { status: Number(status), kind: 'text', headers: [...responseHeaders, ...normalizeOptions(options)], body: String(body ?? '') }; },
    jsonText(status, body, options) { return { status: Number(status), kind: 'json-text', headers: [...responseHeaders, ...normalizeOptions(options)], body: String(body ?? '') }; },
    json(schema, value, options) {
      const body = value && typeof value.jsonText === 'function' ? value.jsonText() : (typeof value === 'string' ? value : JSON.stringify(value ?? null));
      return { status: Number(options && options.status || 200), kind: 'json-text', schema: String(schema || ''), headers: [...responseHeaders, ...normalizeOptions(options)], body };
    },
    empty(status, options) { return { status: Number(status), kind: 'empty', headers: [...responseHeaders, ...normalizeOptions(options)], body: '' }; }
  };
}

function createRouteEffectContinuationContext(resolved) {
  const responseHeaders = [];
  return {
    resolved(name) {
      const key = name === undefined ? '$default' : String(name);
      const entry = resolved[key];
      if (!entry) {
        const diagnostic = makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectResolvedNameMissing, `Node route-effect continuation tried to read missing resolved effect ${JSON.stringify(key)}.`, 'error', { name: key });
        return responseHandle({ status: 500, kind: 'text', headers: [], body: '', diagnostics: [diagnostic] }, { name: key });
      }
      return responseHandle(entry.response, { backend: entry.effect.backend, request: entry.request });
    },
    result: createResultFactory(responseHeaders),
    response: {
      header: {
        set(name, value) {
          const lower = String(name).toLowerCase();
          for (let index = responseHeaders.length - 1; index >= 0; index -= 1) if (String(responseHeaders[index][0]).toLowerCase() === lower) responseHeaders.splice(index, 1);
          responseHeaders.push([String(name), String(value)]);
        },
        append(name, value) { responseHeaders.push([String(name), String(value)]); },
        delete(name) {
          const lower = String(name).toLowerCase();
          for (let index = responseHeaders.length - 1; index >= 0; index -= 1) if (String(responseHeaders[index][0]).toLowerCase() === lower) responseHeaders.splice(index, 1);
        }
      }
    }
  };
}

function routeMatches(route, selector) {
  if (!route) return false;
  if (!selector || Object.keys(selector).length === 0) return true;
  if (selector.routeId && route.routeId === selector.routeId) return true;
  if (selector.handlerName && route.handlerName === selector.handlerName) return true;
  if (selector.path && route.path === selector.path) return true;
  return false;
}

function createErrorResponse(status, diagnostic) {
  return responseHandle({ status, kind: 'text', headers: [['Content-Type', 'text/plain; charset=utf-8']], body: '', diagnostics: [diagnostic] });
}

function createNodeRouteHandlerEffectProvider(options = {}) {
  const plan = normalizePlan(options.plan || options.routeHandlerEffectPlan || options.effectPlan);
  const diagnostics = [];
  if (!plan) {
    diagnostics.push(makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectPlanRequired, 'Node route-effect provider requires route-handler-effect-plan.json.', 'error', { hint: 'Emit route-handler-effect-plan.json before invoking the Node provider proof.' }));
  }
  const defaultParams = options.defaultParams || {};
  const backends = options.backends || createDefaultBackendsFromPlan(plan, defaultParams);
  const continuations = options.continuations || {};

  function executeFetch(effect, context = {}) {
    const route = context.route;
    const params = { ...defaultParams, ...(context.params || {}) };
    const request = requestFromEffect(effect, { route, params, requestJsonText: context.requestJsonText, requestBodyText: context.requestBodyText, requestBody: context.requestBody, schemaEncodeRefs: context.schemaEncodeRefs });
    if (!routeEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS.includes(request.method)) {
      return createErrorResponse(405, makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectUnsupportedMethod, `Node route-effect provider proof only supports ${routeEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS.join(' / ')} backend fetch methods.`, 'error', { method: request.method, allowedMethods: routeEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS }));
    }
    const backend = backends[effect.backend];
    if (!backend) {
      return createErrorResponse(502, makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectBackendMissing, `Node route-effect provider proof has no fixture backend named ${JSON.stringify(effect.backend)}.`, 'error', { backend: effect.backend }));
    }
    const value = backend[`${request.method} ${request.path}`] || backend[request.path];
    const response = normalizeResponse(value, request);
    if (!response) {
      return createErrorResponse(404, makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectBackendResponseMissing, `Node route-effect provider proof has no response fixture for ${effect.backend} ${request.path}.`, 'error', { backend: effect.backend, method: request.method, path: request.path }));
    }
    return responseHandle(response, { backend: effect.backend, request });
  }

  function executeResolve(routeOrSelector, resolveOrOptions, paramsInput) {
    let route = routeOrSelector;
    let resolve = resolveOrOptions;
    let params = paramsInput || {};
    let selector = {};
    if (!route || !Array.isArray(route.resolves)) {
      selector = routeOrSelector || {};
      route = (plan && plan.routes || []).find((candidate) => routeMatches(candidate, selector));
      resolve = route && (route.resolves || [])[selector.resolveIndex || 0];
      params = selector.params || params;
    }
    if (!plan) return { status: 'error', diagnostics: diagnostics.map(clone), resolved: {}, finalResult: undefined };
    if (!route) return { status: 'error', diagnostics: [makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectRouteNotFound, 'Node route-effect provider proof could not find a matching planned route.', 'error', { selector: routeOrSelector })], resolved: {}, finalResult: undefined };
    if (!resolve) return { status: 'error', route: { routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName }, diagnostics: [makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectNoPlannedEffects, 'Node route-effect provider proof requires at least one ctx.resolve boundary for the selected route.', 'error', { routeId: route.routeId, path: route.path })], resolved: {}, finalResult: undefined };

    const mergedParams = { ...defaultParamsForRoute(route), ...params };
    const resolved = {};
    const diagnosticsForRun = [];
    for (const effect of resolve.effects || []) {
      if (!effect || effect.kind !== 'backend-fetch') continue;
      const request = requestFromEffect(effect, { route, params: mergedParams, requestJsonText: selector.requestJsonText, requestBodyText: selector.requestBodyText, requestBody: selector.requestBody });
      const handle = executeFetch(effect, { route, params: mergedParams, requestJsonText: selector.requestJsonText, requestBodyText: selector.requestBodyText, requestBody: selector.requestBody });
      const snapshot = handle.toJSON();
      const name = effect.name || '$default';
      resolved[name] = {
        effect: clone(effect),
        backend: effect.backend,
        request,
        status: snapshot.status,
        ok: snapshot.ok,
        kind: snapshot.kind,
        headers: snapshot.headers,
        body: snapshot.body,
        diagnostics: snapshot.diagnostics,
        response: { status: snapshot.status, kind: snapshot.kind, headers: snapshot.headers, body: snapshot.body, diagnostics: snapshot.diagnostics }
      };
      diagnosticsForRun.push(...(snapshot.diagnostics || []));
    }

    const continuationName = resolve.continuation && resolve.continuation.name;
    const plannedContinuation = (plan.continuations || []).find((entry) => entry && entry.name === continuationName);
    const continuation = continuationName ? continuations[continuationName] : undefined;
    let finalResult;
    if (!plannedContinuation) {
      const diagnostic = makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectContinuationMissing, 'Node route-effect provider proof could not find the planned top-level continuation.', 'error', { continuation: continuationName });
      diagnosticsForRun.push(diagnostic);
      finalResult = { status: 500, kind: 'text', body: '', headers: [], diagnostics: [diagnostic] };
    } else if (continuation) {
      try {
        finalResult = continuation(createRouteEffectContinuationContext(resolved));
      } catch (error) {
        const diagnostic = makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectSmokeFailed, `Node route-effect continuation threw during proof execution: ${error && error.message ? error.message : String(error)}.`, 'error', { continuation: continuationName });
        diagnosticsForRun.push(diagnostic);
        finalResult = { status: 500, kind: 'text', body: '', headers: [], diagnostics: [diagnostic] };
      }
    } else {
      const accessNames = (plannedContinuation.resultAccesses || []).map((access) => access.name || '$default');
      const names = accessNames.length > 0 ? accessNames : Object.keys(resolved);
      let status = 200;
      let body = '';
      for (const name of names) {
        const entry = resolved[name];
        if (!entry) continue;
        if (!entry.ok && status === 200) status = entry.status;
        body += entry.body || '';
      }
      finalResult = { status, kind: 'text', body, headers: [['Content-Type', 'text/plain; charset=utf-8']], diagnostics: [] };
    }
    const finalDiagnostics = [...diagnosticsForRun, ...((finalResult && finalResult.diagnostics) || [])];
    const hasErrors = finalDiagnostics.some((entry) => (entry.severity || 'error') === 'error');
    return {
      status: hasErrors ? 'error' : 'resolved',
      provider: 'node',
      runtimeVersion: routeEffects.ROUTE_HANDLER_NODE_EFFECT_RUNTIME_VERSION,
      routeId: route && route.routeId,
      route: route ? { routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName } : undefined,
      groupShape: resolve.groupShape,
      continuation: continuationName,
      continuationPlanned: Boolean(plannedContinuation),
      effectCount: (resolve.effects || []).length,
      effects: Object.entries(resolved).map(([name, value]) => ({ name, backend: value.backend, request: value.request, response: { status: value.status, ok: value.ok, kind: value.kind, headers: value.headers, body: value.body, diagnostics: value.diagnostics || [] } })),
      resolved,
      finalResult: finalResult || { status: 204, kind: 'empty', headers: [], body: '' },
      diagnostics: finalDiagnostics,
      responseHandleSurface: [...routeEffects.ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
      continuationResultAccesses: plannedContinuation ? clone(plannedContinuation.resultAccesses || []) : [],
      continuationResponseMethodCalls: plannedContinuation ? clone(plannedContinuation.responseMethodCalls || []) : [],
      lifecycle: {
        handlerReturnedResolveRequest: true,
        nodeExecutedEffectGroup: !hasErrors,
        hostExecutedEffectGroup: !hasErrors,
        continuationReentered: !hasErrors && Boolean(plannedContinuation),
        continuationReadResolvedHandles: !hasErrors && Boolean(plannedContinuation),
        compiledWasmSuspendResumeBridgeUsed: false
      }
    };
  }

  function executeRoute(selector = {}) {
    return executeResolve(selector);
  }

  const plannedResolveBoundaries = [];
  for (const route of plan && plan.routes || []) {
    for (const resolve of route.resolves || []) if (resolve && Array.isArray(resolve.effects) && resolve.effects.length > 0) plannedResolveBoundaries.push({ route, resolve });
  }
  return {
    version: routeEffects.ROUTE_HANDLER_NODE_EFFECT_RUNTIME_VERSION,
    provider: 'node',
    mode: options.mode || 'local-backend-fixture',
    plan,
    backends,
    diagnostics,
    plannedResolveBoundaries,
    executeFetch,
    executeFetchEffect: executeFetch,
    executeResolve,
    executeResolveBoundary: executeResolve,
    executeRoute,
    createContinuationContext: createRouteEffectContinuationContext
  };
}


function normalizeLiveOriginsFromResolvedConfig(resolvedConfig) {
  const artifact = resolvedConfig && resolvedConfig.artifact && typeof resolvedConfig.artifact === 'object' ? resolvedConfig.artifact : resolvedConfig;
  const backends = artifact && artifact.runtime && artifact.runtime.capabilities && artifact.runtime.capabilities.backends;
  const out = {};
  for (const [name, config] of Object.entries(backends || {})) {
    if (!config || typeof config !== 'object') continue;
    if (!config.baseUrl && !config.origin && !config.url) continue;
    out[name] = {
      baseUrl: String(config.baseUrl || config.origin || config.url),
      allowedMethods: Array.isArray(config.allowedMethods) ? config.allowedMethods.map((method) => String(method).toUpperCase()) : undefined,
      requestBody: Array.isArray(config.requestBody) ? config.requestBody.map((mode) => String(mode)) : undefined,
      timeoutMs: config.timeoutMs,
      headers: normalizeHeaders(config.headers && (config.headers.inject || config.headers.default || config.headers) || []),
      symbolicRef: config.symbolicRef || config.ref || undefined
    };
  }
  return out;
}

function normalizeLiveOriginConfig(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return { baseUrl: value };
  if (typeof value !== 'object') return undefined;
  const baseUrl = value.baseUrl || value.origin || value.url;
  if (!baseUrl) return undefined;
  return {
    ...value,
    baseUrl: String(baseUrl),
    allowedMethods: Array.isArray(value.allowedMethods) ? value.allowedMethods.map((method) => String(method).toUpperCase()) : undefined,
    requestBody: Array.isArray(value.requestBody) ? value.requestBody.map((mode) => String(mode)) : undefined,
    headers: normalizeHeaders(value.headers || [])
  };
}

function redactedOriginUrl(origin, options = {}) {
  if (!origin) return undefined;
  if (origin.symbolicRef) return origin.symbolicRef;
  if (options.redactOriginUrls === false) return origin.baseUrl;
  try {
    const url = new URL(origin.baseUrl);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return '$local-reference-origin';
    return `${url.protocol}//${url.hostname}`;
  } catch (_) {
    return '$invalid-origin-url';
  }
}

function requestLiveOrigin(originInput, request, options = {}) {
  const origin = normalizeLiveOriginConfig(originInput);
  if (!origin) {
    return Promise.resolve({
      status: 502,
      kind: 'text',
      headers: [['Content-Type', 'text/plain; charset=utf-8']],
      body: '',
      diagnostics: [makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeLiveOriginRequired, 'Node live-origin route-effect proof requires an origin base URL for the planned backend.', 'error', { backend: options.backend })]
    });
  }

  let url;
  try {
    url = new URL(request.path || '/', origin.baseUrl);
  } catch (error) {
    return Promise.resolve({
      status: 502,
      kind: 'text',
      headers: [['Content-Type', 'text/plain; charset=utf-8']],
      body: '',
      diagnostics: [makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeLiveOriginInvalidUrl, `Node live-origin route-effect proof could not build a valid URL for backend ${JSON.stringify(options.backend)}.`, 'error', { backend: options.backend, baseUrl: redactedOriginUrl(origin, options), path: request.path, error: error && error.message ? error.message : String(error) })]
    });
  }

  const method = String(request.method || 'GET').toUpperCase();
  const headers = {};
  for (const [name, value] of [...normalizeHeaders(origin.headers), ...normalizeHeaders(request.headers)]) headers[name] = value;
  if (!Object.keys(headers).some((name) => String(name).toLowerCase() === 'connection')) headers.Connection = 'close';
  const client = url.protocol === 'https:' ? https : http;
  const timeoutMs = Number(options.timeoutMs || origin.timeoutMs || 2000);

  return new Promise((resolve) => {
    const req = client.request(url, { method, headers, timeout: timeoutMs, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const responseHeaders = [];
        for (const [name, value] of Object.entries(res.headers || {})) {
          if (Array.isArray(value)) for (const entry of value) responseHeaders.push([name, String(entry)]);
          else if (value !== undefined) responseHeaders.push([name, String(value)]);
        }
        resolve({
          status: Number(res.statusCode || 0),
          kind: method === 'HEAD' ? 'empty' : ((headerValue(responseHeaders, 'content-type') || '').includes('json') ? 'json-text' : 'text'),
          headers: responseHeaders,
          body: method === 'HEAD' ? '' : body,
          diagnostics: []
        });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`Node live-origin route-effect proof timed out after ${timeoutMs}ms.`));
    });
    req.on('error', (error) => {
      resolve({
        status: 502,
        kind: 'text',
        headers: [['Content-Type', 'text/plain; charset=utf-8']],
        body: '',
        diagnostics: [makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeLiveOriginFetchFailed, `Node live-origin route-effect proof failed to fetch backend ${JSON.stringify(options.backend)}.`, 'error', { backend: options.backend, baseUrl: redactedOriginUrl(origin, options), method, path: request.path, error: error && error.message ? error.message : String(error) })]
      });
    });
    if (request.body !== undefined) req.write(request.body);
    req.end();
  });
}

function createNodeLiveOriginRouteHandlerEffectProvider(options = {}) {
  const plan = normalizePlan(options.plan || options.routeHandlerEffectPlan || options.effectPlan);
  const diagnostics = [];
  if (!plan) {
    diagnostics.push(makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectPlanRequired, 'Node live-origin route-effect provider requires route-handler-effect-plan.json.', 'error', { hint: 'Emit route-handler-effect-plan.json before invoking the Node live-origin provider proof.' }));
  }
  const defaultParams = options.defaultParams || {};
  const origins = { ...normalizeLiveOriginsFromResolvedConfig(options.resolvedConfig), ...(options.origins || options.liveOrigins || {}) };
  const continuations = options.continuations || {};

  async function executeFetch(effect, context = {}) {
    const route = context.route;
    const params = { ...defaultParams, ...(context.params || {}) };
    const request = requestFromEffect(effect, { route, params, requestJsonText: context.requestJsonText, requestBodyText: context.requestBodyText, requestBody: context.requestBody, schemaEncodeRefs: context.schemaEncodeRefs });
    if (!routeEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS.includes(request.method)) {
      return createErrorResponse(405, makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectUnsupportedMethod, `Node live-origin route-effect provider proof only supports ${routeEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS.join(' / ')} backend fetch methods.`, 'error', { method: request.method, allowedMethods: routeEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS }));
    }
    const origin = normalizeLiveOriginConfig(origins[effect.backend]);
    if (!origin) {
      return createErrorResponse(502, makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectBackendMissing, `Node live-origin route-effect provider proof has no origin backend named ${JSON.stringify(effect.backend)}.`, 'error', { backend: effect.backend, hint: 'Provide runtime.capabilities.backends.<name>.baseUrl or pass liveOrigins to the provider proof.' }));
    }
    if (Array.isArray(origin.allowedMethods) && !origin.allowedMethods.includes(request.method)) {
      return createErrorResponse(405, makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.backendMethodUnsupported, `Node live-origin backend ${JSON.stringify(effect.backend)} does not allow method ${request.method}.`, 'error', { backend: effect.backend, method: request.method, allowedMethods: origin.allowedMethods }));
    }
    const bodyMode = request.bodyMode || 'none';
    if (Array.isArray(origin.requestBody) && !origin.requestBody.includes(bodyMode)) {
      return createErrorResponse(415, makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.backendRequestBodyModeUnsupported, `Node live-origin backend ${JSON.stringify(effect.backend)} does not allow request body mode ${bodyMode}.`, 'error', { backend: effect.backend, bodyMode, requestBody: origin.requestBody }));
    }
    const response = await requestLiveOrigin(origin, request, { ...options, backend: effect.backend });
    return responseHandle(response, { backend: effect.backend, request });
  }

  async function executeResolve(routeOrSelector, resolveOrOptions, paramsInput) {
    let route = routeOrSelector;
    let resolve = resolveOrOptions;
    let params = paramsInput || {};
    let selector = {};
    if (!route || !Array.isArray(route.resolves)) {
      selector = routeOrSelector || {};
      route = (plan && plan.routes || []).find((candidate) => routeMatches(candidate, selector));
      resolve = route && (route.resolves || [])[selector.resolveIndex || 0];
      params = selector.params || params;
    }
    if (!plan) return { status: 'error', diagnostics: diagnostics.map(clone), resolved: {}, finalResult: undefined };
    if (!route) return { status: 'error', diagnostics: [makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectRouteNotFound, 'Node live-origin route-effect provider proof could not find a matching planned route.', 'error', { selector: routeOrSelector })], resolved: {}, finalResult: undefined };
    if (!resolve) return { status: 'error', route: { routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName }, diagnostics: [makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectNoPlannedEffects, 'Node live-origin route-effect provider proof requires at least one ctx.resolve boundary for the selected route.', 'error', { routeId: route.routeId, path: route.path })], resolved: {}, finalResult: undefined };

    const mergedParams = { ...defaultParamsForRoute(route), ...params };
    const diagnosticsForRun = [];
    const pairs = await Promise.all((resolve.effects || []).filter((effect) => effect && effect.kind === 'backend-fetch').map(async (effect) => {
      const request = requestFromEffect(effect, { route, params: mergedParams, requestJsonText: selector.requestJsonText, requestBodyText: selector.requestBodyText, requestBody: selector.requestBody });
      const handle = await executeFetch(effect, { route, params: mergedParams, requestJsonText: selector.requestJsonText, requestBodyText: selector.requestBodyText, requestBody: selector.requestBody });
      const snapshot = handle.toJSON();
      return { effect, request, snapshot };
    }));
    const resolved = {};
    for (const { effect, request, snapshot } of pairs) {
      const name = effect.name || '$default';
      resolved[name] = {
        effect: clone(effect),
        backend: effect.backend,
        request,
        status: snapshot.status,
        ok: snapshot.ok,
        kind: snapshot.kind,
        headers: snapshot.headers,
        body: snapshot.body,
        diagnostics: snapshot.diagnostics,
        response: { status: snapshot.status, kind: snapshot.kind, headers: snapshot.headers, body: snapshot.body, diagnostics: snapshot.diagnostics }
      };
      diagnosticsForRun.push(...(snapshot.diagnostics || []));
    }

    const continuationName = resolve.continuation && resolve.continuation.name;
    const plannedContinuation = (plan.continuations || []).find((entry) => entry && entry.name === continuationName);
    const continuation = continuationName ? continuations[continuationName] : undefined;
    let finalResult;
    if (!plannedContinuation) {
      const diagnostic = makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectContinuationMissing, 'Node live-origin route-effect provider proof could not find the planned top-level continuation.', 'error', { continuation: continuationName });
      diagnosticsForRun.push(diagnostic);
      finalResult = { status: 500, kind: 'text', body: '', headers: [], diagnostics: [diagnostic] };
    } else if (continuation) {
      try {
        finalResult = continuation(createRouteEffectContinuationContext(resolved));
      } catch (error) {
        const diagnostic = makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectSmokeFailed, `Node live-origin route-effect continuation threw during proof execution: ${error && error.message ? error.message : String(error)}.`, 'error', { continuation: continuationName });
        diagnosticsForRun.push(diagnostic);
        finalResult = { status: 500, kind: 'text', body: '', headers: [], diagnostics: [diagnostic] };
      }
    } else {
      const accessNames = (plannedContinuation.resultAccesses || []).map((access) => access.name || '$default');
      const names = accessNames.length > 0 ? accessNames : Object.keys(resolved);
      let status = 200;
      let body = '';
      for (const name of names) {
        const entry = resolved[name];
        if (!entry) continue;
        if (!entry.ok && status === 200) status = entry.status;
        body += entry.body || '';
      }
      finalResult = { status, kind: 'text', body, headers: [['Content-Type', 'text/plain; charset=utf-8']], diagnostics: [] };
    }
    const finalDiagnostics = [...diagnosticsForRun, ...((finalResult && finalResult.diagnostics) || [])];
    const hasErrors = finalDiagnostics.some((entry) => (entry.severity || 'error') === 'error');
    return {
      status: hasErrors ? 'error' : 'resolved',
      provider: 'node',
      runtimeVersion: routeEffects.ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_RUNTIME_VERSION,
      routeId: route && route.routeId,
      route: route ? { routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName } : undefined,
      groupShape: resolve.groupShape,
      continuation: continuationName,
      continuationPlanned: Boolean(plannedContinuation),
      effectCount: (resolve.effects || []).length,
      effects: Object.entries(resolved).map(([name, value]) => ({ name, backend: value.backend, request: value.request, response: { status: value.status, ok: value.ok, kind: value.kind, headers: value.headers, body: value.body, diagnostics: value.diagnostics || [] } })),
      resolved,
      finalResult: finalResult || { status: 204, kind: 'empty', headers: [], body: '' },
      diagnostics: finalDiagnostics,
      responseHandleSurface: [...routeEffects.ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
      continuationResultAccesses: plannedContinuation ? clone(plannedContinuation.resultAccesses || []) : [],
      continuationResponseMethodCalls: plannedContinuation ? clone(plannedContinuation.responseMethodCalls || []) : [],
      lifecycle: {
        handlerReturnedResolveRequest: true,
        nodeExecutedEffectGroup: !hasErrors,
        hostExecutedEffectGroup: !hasErrors,
        liveOriginNetworkFetch: true,
        continuationReentered: !hasErrors && Boolean(plannedContinuation),
        continuationReadResolvedHandles: !hasErrors && Boolean(plannedContinuation),
        compiledWasmSuspendResumeBridgeUsed: false
      }
    };
  }

  async function executeRoute(selector = {}) {
    return executeResolve(selector);
  }

  const plannedResolveBoundaries = [];
  for (const route of plan && plan.routes || []) {
    for (const resolve of route.resolves || []) if (resolve && Array.isArray(resolve.effects) && resolve.effects.length > 0) plannedResolveBoundaries.push({ route, resolve });
  }
  return {
    version: routeEffects.ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_RUNTIME_VERSION,
    provider: 'node',
    mode: options.mode || 'live-origin-http',
    plan,
    origins,
    diagnostics,
    plannedResolveBoundaries,
    executeFetch,
    executeFetchEffect: executeFetch,
    executeResolve,
    executeResolveBoundary: executeResolve,
    executeRoute,
    createContinuationContext: createRouteEffectContinuationContext,
    originSummary: Object.keys(origins || {}).sort().map((backend) => ({ backend, baseUrl: redactedOriginUrl(normalizeLiveOriginConfig(origins[backend]), options) }))
  };
}

module.exports = {
  createNodeRouteHandlerEffectProvider,
  createNodeRouteEffectProvider: createNodeRouteHandlerEffectProvider,
  createNodeLiveOriginRouteHandlerEffectProvider,
  createNodeLiveOriginRouteEffectProvider: createNodeLiveOriginRouteHandlerEffectProvider,
  createRouteEffectContinuationContext,
  createDefaultBackendsFromPlan,
  buildDefaultBackends: createDefaultBackendsFromPlan,
  normalizeLiveOriginsFromResolvedConfig,
  requestLiveOrigin,
  evaluateExpression,
  requestFromEffect,
  normalizeHeaders,
  headerValue
};
