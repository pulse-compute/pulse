'use strict';

function loadDiagnostics() {
  try { return require('@pulse-compute/wasm-contracts/diagnostics'); }
  catch (error) { if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../../wasm/packages/contracts/src/diagnostics.js'); throw error; }
}
function loadParityContract() {
  return require('./lifecycle-parity-contract.js');
}
function loadBackendBodyContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/backend-json-request-body'); }
  catch (error) { if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../../wasm/packages/contracts/src/handler/backend-json-request-body.js'); throw error; }
}

const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadDiagnostics();
const parity = loadParityContract();
const backendBody = loadBackendBodyContract();
const {
  createFastlyRouteHandlerEffectProvider,
  buildFastlyRouteEffectProviderConfig,
  requestFromEffect,
  headerValue
} = require('../runtime/route-handler-effects.js');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function normalize(input) { return input && input.artifact ? input.artifact : input; }
function makeDiagnostic(code, message, severity = 'error', details) { return normalizeDiagnostic({ phase: 'fastly-lifecycle-parity-proof', code, severity, message, details, loc: { file: '<fastly-lifecycle-parity-proof>' } }); }
function normalizedMethod(value) { return String(value || 'GET').toUpperCase(); }
function pathParamNames(routePath) { return Array.from(String(routePath || '').matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g), (match) => match[1]); }
function paramsForRoute(route, params = {}) {
  const out = {};
  for (const name of pathParamNames(route && route.path)) out[name] = name === 'id' ? 'abc' : 'value';
  return { ...out, ...params };
}
function routeHasResolve(route) { return Boolean(route && Array.isArray(route.resolves) && route.resolves.some((resolve) => Array.isArray(resolve.effects) && resolve.effects.length > 0)); }
function firstEffect(route, predicate = () => true) {
  for (const resolve of route && route.resolves || []) for (const effect of resolve.effects || []) if (effect && predicate(effect, resolve)) return { resolve, effect };
  return undefined;
}
function findRoute(plan, predicate) { return (plan && plan.routes || []).find(predicate); }
function findGetUserRoute(plan) { return findRoute(plan, (route) => normalizedMethod(route.method) === 'GET' && String(route.path) === '/users/:id' && routeHasResolve(route)); }
function findDashboardRoute(plan) { return findRoute(plan, (route) => normalizedMethod(route.method) === 'GET' && String(route.path) === '/dashboard/:id' && routeHasResolve(route)); }
function findPostJsonRoute(plan) {
  return findRoute(plan, (route) => normalizedMethod(route.method) === 'POST' && (route.resolves || []).some((resolve) => (resolve.effects || []).some((effect) => effect && effect.request && effect.request.bodyMode === 'json')));
}
function responseHeaders(effect, request, extra = []) {
  return [
    ['content-type', request.method === 'HEAD' ? 'application/json; charset=utf-8' : 'application/json; charset=utf-8'],
    ['x-pulsewasm-fastly-backend', effect.backend],
    ['x-pulsewasm-fastly-effect', effect.name || '$default'],
    ...extra
  ];
}
function fixtureForEffect(effect, route, params) {
  const request = requestFromEffect(effect, { route, params: paramsForRoute(route, params) });
  if (request.method === 'HEAD') {
    return { request, response: { status: 200, kind: 'empty', headers: responseHeaders(effect, request, [['x-count', '2'], ['x-user-id', paramsForRoute(route, params).id || 'abc']]), body: '' } };
  }
  if (/\/users\/[^/]+\/posts$/.test(request.path)) {
    const id = request.path.split('/')[2] || 'abc';
    return { request, response: { status: 200, kind: 'json-text', headers: responseHeaders(effect, request, [['x-count', '2']]), body: JSON.stringify([{ id: 'post-1', userId: id, title: 'Reference Post 1' }, { id: 'post-2', userId: id, title: 'Reference Post 2' }]) } };
  }
  if (/\/users\/[^/]+$/.test(request.path)) {
    const id = request.path.split('/')[2] || 'abc';
    return { request, response: { status: 200, kind: 'json-text', headers: responseHeaders(effect, request, [['x-user-id', id]]), body: JSON.stringify({ id, name: 'Fastly Reference User', active: true }) } };
  }
  return { request, response: { status: 200, kind: 'json-text', headers: responseHeaders(effect, request), body: JSON.stringify({ ok: true, path: request.path }) } };
}
function createReferenceBackends(plan, params) {
  const backends = {};
  for (const route of plan && plan.routes || []) {
    for (const resolve of route.resolves || []) {
      for (const effect of resolve.effects || []) {
        if (!effect || effect.kind !== 'backend-fetch') continue;
        const method = normalizedMethod(effect.request && effect.request.method);
        if (method === 'POST' && effect.request && effect.request.bodyMode === 'json') continue;
        const { request, response } = fixtureForEffect(effect, route, params);
        if (!backends[effect.backend]) backends[effect.backend] = {};
        backends[effect.backend][`${request.method} ${request.path}`] = response;
        if (request.method === 'GET') backends[effect.backend][request.path] = response;
      }
    }
  }
  return backends;
}
function collectBodyModes(handlerIoPlan) {
  const modes = new Set();
  for (const route of handlerIoPlan && handlerIoPlan.routes || []) {
    for (const fetch of route.effects && route.effects.backendFetches || []) if (fetch.requestBody && fetch.requestBody.mode) modes.add(fetch.requestBody.mode);
  }
  return Array.from(modes).sort();
}
function routeReadiness(route, handlerIoPlan, postJsonRoute) {
  const io = (handlerIoPlan && handlerIoPlan.routes || []).find((entry) => entry.routeId === route.routeId || (entry.method === route.method && entry.path === route.path));
  const hasJsonBody = Boolean(io && (io.effects && io.effects.backendFetches || []).some((fetch) => fetch.requestBody && fetch.requestBody.mode === 'json'));
  const hasEffects = routeHasResolve(route);
  const readiness = hasJsonBody || (postJsonRoute && postJsonRoute.routeId === route.routeId) ? 'plan-only' : (hasEffects ? 'implemented-fixture-proof' : 'not-required');
  return {
    routeId: route.routeId,
    method: route.method,
    path: route.path,
    handlerName: route.handlerName,
    provider: 'fastly',
    symbolicBackendConfig: hasEffects,
    originMapping: readiness,
    providerReadiness: readiness,
    compiledWasmReadiness: 'metadata-only',
    requestBodyModes: io && io.requestBody ? clone(io.requestBody.modes || []) : [],
    backendRequestBodyModes: io ? (io.effects.backendFetches || []).map((fetch) => fetch.requestBody && fetch.requestBody.mode).filter(Boolean) : [],
    responseBodyModes: io && io.originResponse ? clone(io.originResponse.modes || []) : [],
    diagnostics: hasJsonBody ? [parity.FASTLY_LIFECYCLE_PARITY_DIAGNOSTICS.postJsonBodyPlanOnly] : []
  };
}
function check(name, condition, details, failures, diagnostics) {
  const out = { name, status: condition ? 'ok' : 'error', details: details || {} };
  if (!condition) {
    failures.push(out);
    diagnostics.push(makeDiagnostic(parity.FASTLY_LIFECYCLE_PARITY_DIAGNOSTICS.smokeFailed, `Fastly lifecycle parity check failed: ${name}.`, 'error', { check: name, details: out.details }));
  }
  return out;
}
function serializeExecution(execution) {
  if (!execution) return undefined;
  return {
    status: execution.status,
    provider: execution.provider,
    routeId: execution.routeId,
    route: clone(execution.route),
    groupShape: execution.groupShape,
    continuation: execution.continuation,
    effectCount: execution.effectCount,
    effects: clone(execution.effects || []),
    resolved: clone(execution.resolved || {}),
    finalResult: clone(execution.finalResult),
    lifecycle: clone(execution.lifecycle),
    responseHandleSurface: clone(execution.responseHandleSurface || []),
    continuationResultAccesses: clone(execution.continuationResultAccesses || []),
    continuationResponseMethodCalls: clone(execution.continuationResponseMethodCalls || []),
    diagnostics: clone(execution.diagnostics || [])
  };
}

function buildFastlyLifecycleParityProof(options = {}) {
  const cwd = options.cwd || process.cwd();
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const plan = normalize(options.routeHandlerEffectPlan || options.effectPlan || options.plan);
  const handlerIoPlan = normalize(options.handlerIoLifecyclePlan || options.handlerIoPlan);
  const backendJsonPlan = normalize(options.backendJsonRequestBodyPlan || options.backendJsonPlan);
  const diagnostics = [];
  const failures = [];
  const checks = [];
  if (!plan) diagnostics.push(makeDiagnostic(parity.FASTLY_LIFECYCLE_PARITY_DIAGNOSTICS.planRequired, 'Fastly lifecycle parity proof requires route-handler-effect-plan.json.'));

  const getUserRoute = findGetUserRoute(plan);
  const dashboardRoute = findDashboardRoute(plan);
  const postJsonRoute = findPostJsonRoute(plan);
  if (plan && !getUserRoute) diagnostics.push(makeDiagnostic(parity.FASTLY_LIFECYCLE_PARITY_DIAGNOSTICS.getRouteMissing, 'Fastly lifecycle parity proof expected reference GET /users/:id route.'));
  if (plan && !dashboardRoute) diagnostics.push(makeDiagnostic(parity.FASTLY_LIFECYCLE_PARITY_DIAGNOSTICS.headRouteMissing, 'Fastly lifecycle parity proof expected reference dashboard route with a HEAD backend effect.'));

  const providerConfig = options.providerConfig || buildFastlyRouteEffectProviderConfig({ plan, resolvedConfig: options.resolvedConfig, mode: options.mode || 'fastly-lifecycle-parity-fixture' });
  const backends = options.backends || createReferenceBackends(plan || {}, options.params || { id: 'abc' });
  const provider = createFastlyRouteHandlerEffectProvider({ plan, backends, providerConfig, continuations: options.continuations, resolvedConfig: options.resolvedConfig, mode: options.mode || 'fastly-lifecycle-parity-fixture' });

  checks.push(check('symbolic backend config maps reference backends to Fastly refs', providerConfig && providerConfig.provider === 'fastly' && providerConfig.symbolicRefsOnly === true && (providerConfig.backends || []).some((entry) => entry.backend === 'users' && String(entry.baseUrlRef || '').startsWith('$config:')), { providerConfig }, failures, diagnostics));

  let getExecution;
  let dashboardExecution;
  if (getUserRoute) {
    getExecution = provider.executeRoute({ path: '/users/:id', method: 'GET', params: { id: 'abc' } });
    const resolved = getExecution.resolved && (getExecution.resolved.$default || getExecution.resolved[Object.keys(getExecution.resolved || {})[0]]);
    checks.push(check('GET /users/:id maps to a symbolic Fastly backend and resolves status/header/body', getExecution.status === 'resolved' && resolved && resolved.request && resolved.request.method === 'GET' && resolved.request.path === '/users/abc' && resolved.status === 200 && headerValue(resolved.headers, 'x-pulsewasm-fastly-backend') === 'users' && String(resolved.body || '').includes('abc'), { execution: serializeExecution(getExecution) }, failures, diagnostics));
    checks.push(check('GET continuation lifecycle metadata is present', getExecution.lifecycle && getExecution.lifecycle.handlerReturnedResolveRequest === true && getExecution.lifecycle.continuationReentered === true && getExecution.lifecycle.symbolicBackendRefs === true && getExecution.lifecycle.actualNetworkFetch === false, { lifecycle: getExecution.lifecycle }, failures, diagnostics));
  }
  if (dashboardRoute) {
    dashboardExecution = provider.executeRoute({ path: '/dashboard/:id', method: 'GET', params: { id: 'abc' } });
    const head = Object.values(dashboardExecution.resolved || {}).find((entry) => entry.request && entry.request.method === 'HEAD');
    checks.push(check('HEAD backend effect maps to symbolic Fastly backend with status/headers and no body', dashboardExecution.status === 'resolved' && head && head.request.path === '/users/abc/posts' && head.status === 200 && head.body === '' && headerValue(head.headers, 'x-count') === '2', { head, execution: serializeExecution(dashboardExecution) }, failures, diagnostics));
  }

  const responseModes = collectBodyModes(handlerIoPlan);
  const hasJsonTextPolicy = Boolean(handlerIoPlan && (handlerIoPlan.originResponseBodyModes || handlerIoPlan.finalResponseModes));
  checks.push(check('JSON/text body mode policy is explicit in handler lifecycle metadata', hasJsonTextPolicy && (handlerIoPlan.originResponseBodyModes.json || handlerIoPlan.finalResponseModes.jsonText), { originResponseBodyModes: handlerIoPlan && handlerIoPlan.originResponseBodyModes, finalResponseModes: handlerIoPlan && handlerIoPlan.finalResponseModes, backendBodyModes: responseModes }, failures, diagnostics));

  const postJsonReadiness = postJsonRoute ? 'plan-only' : 'not-present';
  if (postJsonRoute) diagnostics.push(makeDiagnostic(parity.FASTLY_LIFECYCLE_PARITY_DIAGNOSTICS.postJsonBodyPlanOnly, 'Fastly POST JSON backend request bodies are explicitly classified as plan-only until Fastly body send support is wired.', 'warning', { routeId: postJsonRoute.routeId, method: postJsonRoute.method, path: postJsonRoute.path }));
  const backendSummary = backendJsonPlan && backendJsonPlan.summary || {};
  const unsupportedModesDiagnosed = postJsonReadiness === 'plan-only' && backendSummary.binaryBodyReserved === true && backendSummary.streamBodyReserved === true && backendSummary.multipartBodyReserved === true;

  const routes = (plan && plan.routes || []).map((route) => routeReadiness(route, handlerIoPlan, postJsonRoute));
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const artifact = normalizeArtifact({
    version: parity.FASTLY_LIFECYCLE_PARITY_PROOF_VERSION,
    generatedBy,
    phase: parity.FASTLY_LIFECYCLE_PARITY_PROOF_PHASE,
    artifact: parity.FASTLY_LIFECYCLE_PARITY_PROOF_ARTIFACT,
    contractId: parity.FASTLY_LIFECYCLE_PARITY_CONTRACT_ID,
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    provider: 'fastly',
    routeHandlerEffectPlanConnected: Boolean(plan),
    handlerIoLifecyclePlanConnected: Boolean(handlerIoPlan),
    backendJsonRequestBodyPlanConnected: Boolean(backendJsonPlan),
    sourcePlanVersion: plan && plan.version,
    sourcePlanArtifact: plan && plan.artifact,
    scope: clone(parity.FASTLY_LIFECYCLE_PARITY_SCOPE),
    policy: clone(parity.FASTLY_LIFECYCLE_PARITY_POLICY),
    backendJsonPolicy: clone(backendBody.BACKEND_JSON_REQUEST_BODY_POLICY),
    proof: {
      package: '@pulse-compute/provider-fastly/compiler/lifecycle-parity-proof',
      mode: options.mode || 'fastly-lifecycle-parity-fixture',
      symbolicBackendRefs: true,
      actualNetworkFetch: false,
      fixtureBackends: true,
      noExternalFastlyServiceRequired: true,
      compiledWasmSuspendResumeBridge: false,
      postJsonRequestBodyReadiness: postJsonReadiness
    },
    providerConfig: clone(providerConfig),
    routes,
    readiness: {
      getHeadOriginMapping: 'implemented-fixture-proof',
      statusHeaderBodyPassthrough: 'implemented-fixture-proof',
      resolveContinuationLifecycle: 'implemented-fixture-proof',
      postJsonRequestBody: postJsonReadiness,
      compiledWasmFastlyBridge: 'metadata-only'
    },
    smoke: {
      checks,
      failedChecks: failures,
      results: {
        getUser: serializeExecution(getExecution),
        dashboard: serializeExecution(dashboardExecution),
        postJson: postJsonRoute ? { routeId: postJsonRoute.routeId, method: postJsonRoute.method, path: postJsonRoute.path, readiness: postJsonReadiness, diagnostic: parity.FASTLY_LIFECYCLE_PARITY_DIAGNOSTICS.postJsonBodyPlanOnly } : undefined
      }
    },
    diagnostics,
    summary: {
      symbolicBackendConfigValidated: checks.some((entry) => entry.name.startsWith('symbolic backend config') && entry.status === 'ok'),
      getOriginMappingValidated: checks.some((entry) => entry.name.startsWith('GET /users') && entry.status === 'ok'),
      headOriginMappingValidated: checks.some((entry) => entry.name.startsWith('HEAD backend') && entry.status === 'ok'),
      statusPassthroughValidated: Boolean(getExecution && getExecution.status === 'resolved' && getExecution.finalResult && getExecution.finalResult.status === 200),
      headerPassthroughValidated: Boolean(getExecution && (headerValue(getExecution.finalResult && getExecution.finalResult.headers, 'x-reference-continuation') || headerValue((getExecution.resolved && getExecution.resolved.$default && getExecution.resolved.$default.headers) || [], 'x-pulsewasm-fastly-backend'))),
      bodyModePolicyValidated: checks.some((entry) => entry.name.startsWith('JSON/text body mode policy') && entry.status === 'ok'),
      resolveContinuationLifecycleValidated: checks.some((entry) => entry.name.startsWith('GET continuation lifecycle') && entry.status === 'ok'),
      postJsonRequestBodyReadiness: postJsonReadiness,
      postJsonRequestBodyDiagnostic: postJsonRoute ? parity.FASTLY_LIFECYCLE_PARITY_DIAGNOSTICS.postJsonBodyPlanOnly : undefined,
      unsupportedModesDiagnosed,
      noExternalFastlyServiceRequired: true,
      actualNetworkFetch: false,
      binaryBodyReserved: backendSummary.binaryBodyReserved === true,
      streamBodyReserved: backendSummary.streamBodyReserved === true,
      multipartBodyReserved: backendSummary.multipartBodyReserved === true,
      diagnostics: diagnostics.length,
      warnings: diagnostics.filter((entry) => (entry.severity || 'error') === 'warning').length,
      errors: errorDiagnostics.length
    }
  }, cwd);
  return { artifact, diagnostics, provider, providerConfig, backends, failures };
}

module.exports = { buildFastlyLifecycleParityProof, createReferenceBackends };
