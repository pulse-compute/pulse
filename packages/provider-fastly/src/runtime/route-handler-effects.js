'use strict';

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

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function normalizeResolvedConfig(input) {
  const resolved = input && input.artifact ? input.artifact : input;
  return resolved && typeof resolved === 'object' ? resolved : {};
}

function makeDiagnostic(code, message, severity, details) {
  return normalizeDiagnostic({
    phase: 'fastly-route-handler-effects',
    severity: severity || 'error',
    code,
    message,
    hint: details && details.hint,
    details,
    loc: { file: '<fastly-route-handler-effects>' }
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

function requestFromEffect(effect, context = {}) {
  const request = effect && effect.request ? effect.request : {};
  return {
    method: String(request.method || 'GET').toUpperCase(),
    path: String(evaluateExpression(request.path, context) || '/'),
    headers: (request.headers || []).map((header) => [String(header.name), String(evaluateExpression(header.value, context))])
  };
}

function symbolicRefName(value, fallback) {
  if (value && typeof value === 'object') {
    if (typeof value.$config === 'string') return `$config:${value.$config}`;
    if (typeof value.$secret === 'string') return `$secret:${value.$secret}`;
    if (typeof value.$env === 'string') return `$config:${value.$env}`;
    if (typeof value.fromEnv === 'string') return `$config:${value.fromEnv}`;
  }
  if (typeof value === 'string' && /^https?:\/\//.test(value)) return '$config:FASTLY_BACKEND_BASE_URL';
  return fallback;
}

function backendConfigFromResolvedConfig(resolvedConfig, backendKey) {
  const config = normalizeResolvedConfig(resolvedConfig);
  const runtime = plainObject(config.runtime);
  const capabilities = plainObject(runtime.capabilities);
  const backends = plainObject(capabilities.backends || runtime.backends || config.backends);
  return plainObject(backends[backendKey]);
}

function buildFastlyRouteEffectProviderConfig(options = {}) {
  const plan = normalizePlan(options.plan || options.routeHandlerEffectPlan || options.effectPlan);
  const resolvedConfig = normalizeResolvedConfig(options.resolvedConfig || {});
  const runtime = plainObject(resolvedConfig.runtime);
  const platformFastly = plainObject(plainObject(runtime.platform).fastly);
  const backendKeys = new Set();
  for (const route of plan && plan.routes || []) {
    for (const resolve of route.resolves || []) {
      for (const effect of resolve.effects || []) if (effect && effect.kind === 'backend-fetch' && effect.backend) backendKeys.add(effect.backend);
    }
  }
  const backends = Array.from(backendKeys).sort().map((backend) => {
    const declared = backendConfigFromResolvedConfig(resolvedConfig, backend);
    return {
      backend,
      logicalName: backend,
      bindingName: `pulse_backend_${String(backend).replace(/[^A-Za-z0-9_]/g, '_').toLowerCase()}`,
      mode: 'fastly-backend-fetch-fixture',
      baseUrlRef: symbolicRefName(declared.baseUrl, `$config:${String(backend).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}_BASE_URL`),
      serviceRef: symbolicRefName(declared.baseUrl, `$config:${String(backend).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}_BASE_URL`),
      authTokenRef: symbolicRefName(declared.authToken || declared.token, `$secret:${String(backend).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}_TOKEN`),
      allowedMethods: Array.isArray(declared.allowedMethods) ? declared.allowedMethods.map((method) => String(method).toUpperCase()) : [...routeEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS],
      timeoutMs: Number(declared.timeoutMs || 1500),
      headersSymbolicOnly: true,
      actualNetworkFetch: false
    };
  });
  return {
    version: routeEffects.ROUTE_HANDLER_FASTLY_EFFECT_PROVIDER_CONFIG_VERSION,
    provider: 'fastly',
    mode: options.mode || 'fastly-backend-fetch-fixture',
    configStore: platformFastly.configStore || 'pulse_config',
    secretStore: platformFastly.secretStore || 'pulse_secrets',
    symbolicRefsOnly: true,
    backends,
    summary: {
      backends: backends.length,
      configStore: platformFastly.configStore || 'pulse_config',
      secretStore: platformFastly.secretStore || 'pulse_secrets',
      symbolicRefs: backends.reduce((count, backend) => count + [backend.baseUrlRef, backend.authTokenRef].filter(Boolean).length, 0),
      actualNetworkFetch: false
    }
  };
}

function normalizeResponse(value, request) {
  const method = String(request && request.method || 'GET').toUpperCase();
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    return { status: 200, kind: method === 'HEAD' ? 'empty' : 'text', headers: [['Content-Type', 'text/plain; charset=utf-8']], body: method === 'HEAD' ? '' : String(value) };
  }
  if (typeof value === 'object') {
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
            ['X-PulseWasm-Fastly-Backend', effect.backend],
            ['X-PulseWasm-Fastly-Effect', effect.name || '$default'],
            ['X-Count', effect.name === 'posts' || request.method === 'HEAD' ? '2' : '1']
          ],
          body: request.method === 'HEAD' ? '' : `fastly-route-effect:${resolve.groupShape === 'single' ? '$default' : (effect.name || '$default')}:${effect.backend}:${request.method}:${request.path}`
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
  function bodyText() { return normalized.body === undefined || normalized.body === null ? '' : String(normalized.body); }
  return {
    status() { return Number(normalized.status || 0); },
    ok() { return this.status() >= 200 && this.status() < 300; },
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
        kind: normalized.kind || 'text',
        request: metadata.request ? clone(metadata.request) : undefined,
        backend: metadata.backend,
        bindingName: metadata.bindingName,
        baseUrlRef: metadata.baseUrlRef,
        serviceRef: metadata.serviceRef,
        authTokenRef: metadata.authTokenRef,
        headers: normalizeHeaders(normalized.headers),
        body: normalized.body === undefined ? '' : String(normalized.body),
        text: this.text(),
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

function createFastlyRouteEffectContinuationContext(resolved) {
  const responseHeaders = [];
  return {
    resolved(name) {
      const key = name === undefined ? '$default' : String(name);
      const entry = resolved[key];
      if (!entry) {
        const diagnostic = makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectResolvedNameMissing, `Fastly route-effect continuation tried to read missing resolved effect ${JSON.stringify(key)}.`, 'error', { name: key });
        return responseHandle({ status: 500, kind: 'text', headers: [], body: '', diagnostics: [diagnostic] }, { name: key });
      }
      return responseHandle(entry.response, { backend: entry.effect.backend, request: entry.request, bindingName: entry.bindingName, baseUrlRef: entry.baseUrlRef, serviceRef: entry.serviceRef, authTokenRef: entry.authTokenRef });
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

function createFastlyRouteHandlerEffectProvider(options = {}) {
  const plan = normalizePlan(options.plan || options.routeHandlerEffectPlan || options.effectPlan);
  const diagnostics = [];
  if (!plan) {
    diagnostics.push(makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectPlanRequired, 'Fastly route-effect provider requires route-handler-effect-plan.json.', 'error', { hint: 'Emit route-handler-effect-plan.json before invoking the Fastly provider proof.' }));
  }
  const defaultParams = options.defaultParams || {};
  const backends = options.backends || createDefaultBackendsFromPlan(plan, defaultParams);
  const continuations = options.continuations || {};
  const providerConfig = options.providerConfig || buildFastlyRouteEffectProviderConfig({ plan, resolvedConfig: options.resolvedConfig, mode: options.mode });

  function executeFetch(effect, context = {}) {
    const route = context.route;
    const params = { ...defaultParams, ...(context.params || {}) };
    const request = requestFromEffect(effect, { route, params });
    if (!routeEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS.includes(request.method)) {
      return createErrorResponse(405, makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectUnsupportedMethod, `Fastly route-effect provider proof only supports ${routeEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS.join(' / ')} backend fetch methods.`, 'error', { method: request.method, allowedMethods: routeEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS }));
    }
    const backend = backends[effect.backend];
    if (!backend) {
      return createErrorResponse(502, makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectBackendMissing, `Fastly route-effect provider proof has no fixture backend named ${JSON.stringify(effect.backend)}.`, 'error', { backend: effect.backend }));
    }
    const value = backend[`${request.method} ${request.path}`] || backend[request.path];
    const response = normalizeResponse(value, request);
    const backendConfig = (providerConfig.backends || []).find((entry) => entry.backend === effect.backend || entry.logicalName === effect.backend) || {};
    if (!response) {
      return createErrorResponse(404, makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectBackendResponseMissing, `Fastly route-effect provider proof has no response fixture for ${effect.backend} ${request.path}.`, 'error', { backend: effect.backend, method: request.method, path: request.path }));
    }
    return responseHandle(response, { backend: effect.backend, request, bindingName: backendConfig.bindingName, baseUrlRef: backendConfig.baseUrlRef, serviceRef: backendConfig.serviceRef, authTokenRef: backendConfig.authTokenRef });
  }

  function executeResolve(routeOrSelector, resolveOrOptions, paramsInput) {
    let route = routeOrSelector;
    let resolve = resolveOrOptions;
    let params = paramsInput || {};
    if (!route || !Array.isArray(route.resolves)) {
      const selector = routeOrSelector || {};
      route = (plan && plan.routes || []).find((candidate) => routeMatches(candidate, selector));
      resolve = route && (route.resolves || [])[selector.resolveIndex || 0];
      params = selector.params || params;
    }
    if (!plan) return { status: 'error', diagnostics: diagnostics.map(clone), resolved: {}, finalResult: undefined };
    if (!route) return { status: 'error', diagnostics: [makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectRouteNotFound, 'Fastly route-effect provider proof could not find a matching planned route.', 'error', { selector: routeOrSelector })], resolved: {}, finalResult: undefined };
    if (!resolve) return { status: 'error', route: { routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName }, diagnostics: [makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectNoPlannedEffects, 'Fastly route-effect provider proof requires at least one ctx.resolve boundary for the selected route.', 'error', { routeId: route.routeId, path: route.path })], resolved: {}, finalResult: undefined };

    const mergedParams = { ...defaultParamsForRoute(route), ...params };
    const resolved = {};
    const diagnosticsForRun = [];
    for (const effect of resolve.effects || []) {
      if (!effect || effect.kind !== 'backend-fetch') continue;
      const request = requestFromEffect(effect, { route, params: mergedParams });
      const handle = executeFetch(effect, { route, params: mergedParams });
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
        bindingName: snapshot.bindingName,
        baseUrlRef: snapshot.baseUrlRef,
        serviceRef: snapshot.serviceRef,
        authTokenRef: snapshot.authTokenRef,
        response: { status: snapshot.status, kind: snapshot.kind, headers: snapshot.headers, body: snapshot.body, diagnostics: snapshot.diagnostics }
      };
      diagnosticsForRun.push(...(snapshot.diagnostics || []));
    }

    const continuationName = resolve.continuation && resolve.continuation.name;
    const plannedContinuation = (plan.continuations || []).find((entry) => entry && entry.name === continuationName);
    const continuation = continuationName ? continuations[continuationName] : undefined;
    let finalResult;
    if (!plannedContinuation) {
      const diagnostic = makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectContinuationMissing, 'Fastly route-effect provider proof could not find the planned top-level continuation.', 'error', { continuation: continuationName });
      diagnosticsForRun.push(diagnostic);
      finalResult = { status: 500, kind: 'text', body: '', headers: [], diagnostics: [diagnostic] };
    } else if (continuation) {
      try {
        finalResult = continuation(createFastlyRouteEffectContinuationContext(resolved));
      } catch (error) {
        const diagnostic = makeDiagnostic(routeEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectSmokeFailed, `Fastly route-effect continuation threw during proof execution: ${error && error.message ? error.message : String(error)}.`, 'error', { continuation: continuationName });
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
      provider: 'fastly',
      runtimeVersion: routeEffects.ROUTE_HANDLER_FASTLY_EFFECT_RUNTIME_VERSION,
      routeId: route && route.routeId,
      route: route ? { routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName } : undefined,
      groupShape: resolve.groupShape,
      continuation: continuationName,
      continuationPlanned: Boolean(plannedContinuation),
      effectCount: (resolve.effects || []).length,
      effects: Object.entries(resolved).map(([name, value]) => ({ name, backend: value.backend, bindingName: value.bindingName, baseUrlRef: value.baseUrlRef, serviceRef: value.serviceRef, authTokenRef: value.authTokenRef, request: value.request, response: { status: value.status, ok: value.ok, kind: value.kind, headers: value.headers, body: value.body, diagnostics: value.diagnostics || [] } })),
      resolved,
      finalResult: finalResult || { status: 204, kind: 'empty', headers: [], body: '' },
      diagnostics: finalDiagnostics,
      responseHandleSurface: [...routeEffects.ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
      continuationResultAccesses: plannedContinuation ? clone(plannedContinuation.resultAccesses || []) : [],
      continuationResponseMethodCalls: plannedContinuation ? clone(plannedContinuation.responseMethodCalls || []) : [],
      providerConfig: clone(providerConfig),
      lifecycle: {
        handlerReturnedResolveRequest: true,
        fastlyExecutedEffectGroup: !hasErrors,
        hostExecutedEffectGroup: !hasErrors,
        continuationReentered: !hasErrors && Boolean(plannedContinuation),
        continuationReadResolvedHandles: !hasErrors && Boolean(plannedContinuation),
        compiledWasmSuspendResumeBridgeUsed: false,
        symbolicBackendRefs: true,
        actualNetworkFetch: false
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
    version: routeEffects.ROUTE_HANDLER_FASTLY_EFFECT_RUNTIME_VERSION,
    provider: 'fastly',
    mode: options.mode || 'fastly-backend-fetch-fixture',
    plan,
    backends,
    providerConfig,
    diagnostics,
    plannedResolveBoundaries,
    executeFetch,
    executeFetchEffect: executeFetch,
    executeResolve,
    executeResolveBoundary: executeResolve,
    executeRoute,
    createContinuationContext: createFastlyRouteEffectContinuationContext
  };
}

module.exports = {
  createFastlyRouteHandlerEffectProvider,
  createFastlyRouteEffectProvider: createFastlyRouteHandlerEffectProvider,
  createFastlyRouteEffectContinuationContext,
  createDefaultBackendsFromPlan,
  buildDefaultBackends: createDefaultBackendsFromPlan,
  buildFastlyRouteEffectProviderConfig,
  buildFastlyRouteHandlerEffectProviderConfig: buildFastlyRouteEffectProviderConfig,
  evaluateExpression,
  requestFromEffect,
  normalizeHeaders,
  headerValue
};
