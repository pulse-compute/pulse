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

const handlerEffects = loadHandlerEffectContracts();
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadDiagnostics();
const {
  createNodeLiveOriginRouteHandlerEffectProvider,
  normalizeLiveOriginsFromResolvedConfig,
  headerValue
} = require('../runtime/route-handler-effects.js');

const phaseName = 'node-live-origin-route-handler-effect-proof';

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

function plannedResolveEntries(plan) {
  const entries = [];
  for (const route of plan && plan.routes || []) {
    for (const resolve of route.resolves || []) {
      if (resolve && Array.isArray(resolve.effects) && resolve.effects.length > 0) entries.push({ route, resolve });
    }
  }
  return entries;
}

function firstEntryByShape(entries, shape) {
  return entries.find((entry) => entry.resolve && entry.resolve.groupShape === shape);
}

function makeDiagnostic(code, message, severity, details) {
  return normalizeDiagnostic({
    phase: phaseName,
    severity: severity || 'error',
    code,
    message,
    hint: details && details.hint,
    details,
    loc: { file: '<node-live-origin-route-handler-effect-proof>' }
  });
}

const VOLATILE_HEADERS = new Set(['date', 'connection', 'keep-alive', 'transfer-encoding']);

function stableHeaders(headers) {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers || {});
  return entries
    .map(([name, value]) => [String(name).toLowerCase(), String(value)])
    .filter(([name]) => !VOLATILE_HEADERS.has(name))
    .sort(([left], [right]) => left.localeCompare(right));
}

function compactResponse(response) {
  if (!response || typeof response !== 'object') return response;
  return {
    status: response.status,
    ok: response.ok,
    kind: response.kind,
    method: response.request && response.request.method,
    path: response.request && response.request.path,
    headers: stableHeaders(response.headers),
    bodyPreview: response.body === undefined ? undefined : String(response.body).slice(0, 120)
  };
}

function compactFinalResult(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    status: result.status,
    kind: result.kind,
    headers: stableHeaders(result.headers),
    bodyPreview: result.body === undefined ? undefined : String(result.body).slice(0, 160)
  };
}

function sanitizeProofValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeProofValue);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value.headers)) return compactResponse(value);
  if (value.finalResult) return { ...value, finalResult: compactFinalResult(value.finalResult) };
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'headers') out.headers = stableHeaders(entry);
    else if (key === 'head') out.head = compactResponse(entry);
    else if (key === 'finalResult') out.finalResult = compactFinalResult(entry);
    else out[key] = sanitizeProofValue(entry);
  }
  return out;
}

function check(name, condition, details, failures, diagnostics) {
  const proofDetails = sanitizeProofValue(details || {});
  const entry = { name, status: condition ? 'ok' : 'error', details: proofDetails };
  if (!condition) {
    failures.push(entry);
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectSmokeFailed, `Node live-origin route-handler effect proof check failed: ${name}.`, 'error', { check: name, details: proofDetails }));
  }
  return entry;
}

function cloneEffectWithMethod(effect, method) {
  const next = clone(effect);
  next.request = { ...(next.request || {}), method };
  return next;
}

function serializeExecution(execution) {
  if (!execution) return undefined;
  return {
    status: execution.status,
    routeId: execution.routeId,
    route: execution.route && {
      routeId: execution.route.routeId,
      method: execution.route.method,
      path: execution.route.path,
      handlerName: execution.route.handlerName
    },
    groupShape: execution.groupShape,
    continuation: execution.continuation,
    continuationPlanned: execution.continuationPlanned,
    effectCount: execution.effectCount,
    effects: (execution.effects || []).map((effect) => ({
      name: effect.name || '$default',
      backend: effect.backend,
      request: effect.request && { method: effect.request.method, path: effect.request.path },
      response: compactResponse(effect.response)
    })),
    resolved: Object.fromEntries(Object.entries(execution.resolved || {}).map(([name, response]) => [name, compactResponse(response)])),
    finalResult: compactFinalResult(execution.finalResult),
    responseHandleSurface: clone(execution.responseHandleSurface),
    continuationResultAccesses: clone(execution.continuationResultAccesses),
    continuationResponseMethodCalls: clone(execution.continuationResponseMethodCalls),
    lifecycle: clone(execution.lifecycle),
    diagnostics: (execution.diagnostics || []).map((entry) => ({ code: entry.code, severity: entry.severity }))
  };
}

function defaultReferenceContinuations() {
  return {
    renderUser(ctx) {
      const user = ctx.resolved();
      if (!user.ok()) {
        return ctx.result.jsonText(user.status(), user.text(), {
          headers: {
            'content-type': user.header('content-type'),
            'x-reference-continuation': 'renderUser'
          }
        });
      }
      return ctx.result.jsonText(200, user.text(), {
        headers: {
          'content-type': user.header('content-type'),
          'x-reference-continuation': 'renderUser'
        }
      });
    },
    renderDashboard(ctx) {
      const user = ctx.resolved('user');
      const posts = ctx.resolved('posts');
      const count = ctx.resolved('count');
      if (!user.ok()) {
        return ctx.result.jsonText(user.status(), user.text(), {
          headers: {
            'content-type': user.header('content-type'),
            'x-reference-continuation': 'renderDashboard'
          }
        });
      }
      let body;
      try {
        body = JSON.stringify({
          user: JSON.parse(user.jsonText()),
          posts: JSON.parse(posts.jsonText()),
          postCount: count.header('x-count')
        });
      } catch (_) {
        body = user.text() + posts.text();
      }
      return ctx.result.jsonText(200, body, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-reference-continuation': 'renderDashboard'
        }
      });
    }
  };
}

function responseJsonBody(execution) {
  try {
    return JSON.parse(execution && execution.finalResult && execution.finalResult.body || '{}');
  } catch (_) {
    return {};
  }
}

function normalizeOriginSummary(provider) {
  return (provider.originSummary || []).map((entry) => ({ backend: entry.backend, baseUrl: entry.baseUrl }));
}

async function buildNodeLiveOriginRouteHandlerEffectProof(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const plan = normalizePlan(inputs.routeHandlerEffectPlan || inputs.plan);
  const diagnostics = [];
  const failures = [];
  const checks = [];

  if (!plan) {
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectPlanRequired, 'Node live-origin route-handler effect proof requires a route-handler-effect-plan artifact.', 'error', { hint: 'Emit route-handler-effect-plan.json before requesting the live-origin Node proof.' }));
  }

  const entries = plannedResolveEntries(plan);
  if (plan && entries.length === 0) {
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectNoPlannedEffects, 'Node live-origin route-handler effect proof requires at least one planned ctx.resolve(ctx.fetch(...), continuation) boundary.', 'error', { routes: Array.isArray(plan.routes) ? plan.routes.length : 0 }));
  }

  const origins = { ...normalizeLiveOriginsFromResolvedConfig(inputs.resolvedConfig), ...(inputs.origins || inputs.liveOrigins || {}) };
  const continuations = inputs.continuations || defaultReferenceContinuations();
  const provider = createNodeLiveOriginRouteHandlerEffectProvider({
    plan,
    origins,
    continuations,
    defaultParams: inputs.defaultParams || {},
    timeoutMs: inputs.timeoutMs || 2000,
    redactOriginUrls: inputs.redactOriginUrls !== false,
    mode: inputs.mode || 'live-origin-http'
  });
  diagnostics.push(...(provider.diagnostics || []));

  if (Object.keys(origins || {}).length === 0) {
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeLiveOriginRequired, 'Node live-origin route-handler effect proof requires at least one backend origin base URL.', 'error', { hint: 'Configure runtime.capabilities.backends.<name>.baseUrl or pass liveOrigins to the proof builder.' }));
  }

  let singleExecution;
  let missingExecution;
  let namedExecution;
  let unsupportedResult;
  let missingBackendResult;

  if (entries.length > 0) {
    const single = firstEntryByShape(entries, 'single') || entries[0];
    singleExecution = await provider.executeResolve(single.route, single.resolve, inputs.params || { id: 'abc' });
    const singleResolved = singleExecution.resolved && (singleExecution.resolved.$default || singleExecution.resolved[Object.keys(singleExecution.resolved || {})[0]]);
    checks.push(check('single ctx.resolve(ctx.fetch(...), continuation) performs a live origin GET', singleExecution.status === 'resolved' && Boolean(singleResolved) && singleResolved.status >= 200 && singleResolved.status < 300 && Boolean(singleResolved.body), { status: singleExecution.status, resolvedStatus: singleResolved && singleResolved.status, bodyPreview: singleResolved && String(singleResolved.body).slice(0, 80) }, failures, diagnostics));
    checks.push(check('live origin response headers are visible through ctx.resolved().header(...)', Boolean(singleResolved) && Boolean(headerValue(singleResolved.headers, 'content-type')), { headers: singleResolved && singleResolved.headers }, failures, diagnostics));
    checks.push(check('continuation re-enters with live origin resolved handle', singleExecution.continuationPlanned === true && singleExecution.lifecycle && singleExecution.lifecycle.liveOriginNetworkFetch === true, { continuation: singleExecution.continuation, lifecycle: singleExecution.lifecycle }, failures, diagnostics));

    missingExecution = await provider.executeResolve(single.route, single.resolve, inputs.missingParams || { id: 'missing' });
    checks.push(check('live origin 404 still completes the explicit continuation lifecycle', missingExecution.status === 'resolved' && missingExecution.finalResult && missingExecution.finalResult.status === 404, { status: missingExecution.status, finalResult: missingExecution.finalResult }, failures, diagnostics));

    const named = firstEntryByShape(entries, 'named-object');
    if (named) {
      namedExecution = await provider.executeResolve(named.route, named.resolve, inputs.params || { id: 'abc' });
      const names = Object.keys(namedExecution.resolved || {}).sort();
      const head = Object.values(namedExecution.resolved || {}).find((entry) => entry.request && entry.request.method === 'HEAD');
      const namedBody = responseJsonBody(namedExecution);
      checks.push(check('named ctx.resolve({ name: ctx.fetch(...) }, continuation) performs all live origin fetches', namedExecution.status === 'resolved' && names.includes('user') && names.includes('posts') && names.includes('count'), { status: namedExecution.status, names }, failures, diagnostics));
      checks.push(check('live origin HEAD effect resolves status/headers with empty body', Boolean(head) && head.status >= 200 && head.status < 300 && head.body === '' && Boolean(headerValue(head.headers, 'x-count')), { head }, failures, diagnostics));
      checks.push(check('named continuation can compose live JSON/text origin responses', namedExecution.finalResult && namedExecution.finalResult.status === 200 && namedBody.user && namedBody.posts && String(namedBody.postCount || '') !== '', { finalResult: namedExecution.finalResult }, failures, diagnostics));
    } else {
      checks.push(check('named object effect group is present in live-origin proof fixture', false, { entries: entries.map((entry) => ({ routeId: entry.route.routeId, groupShape: entry.resolve.groupShape })) }, failures, diagnostics));
    }

    const firstEffect = single.resolve.effects[0];
    unsupportedResult = (await provider.executeFetch(cloneEffectWithMethod(firstEffect, 'PUT'), { route: single.route, params: { id: 'abc' } })).toJSON();
    checks.push(check('unsupported backend fetch methods are diagnosed before network fetch', unsupportedResult.status === 405 && unsupportedResult.diagnostics.some((entry) => entry.code === handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectUnsupportedMethod), { status: unsupportedResult.status, diagnostics: unsupportedResult.diagnostics.map((entry) => entry.code) }, failures, diagnostics));

    const missingEffect = clone(firstEffect);
    missingEffect.backend = 'missingBackend';
    missingBackendResult = (await provider.executeFetch(missingEffect, { route: single.route, params: { id: 'abc' } })).toJSON();
    checks.push(check('missing live-origin backend is diagnosed', missingBackendResult.status === 502 && missingBackendResult.diagnostics.some((entry) => entry.code === handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectBackendMissing), { status: missingBackendResult.status, diagnostics: missingBackendResult.diagnostics.map((entry) => entry.code) }, failures, diagnostics));
  }

  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const policy = handlerEffects.defaultRouteHandlerNodeLiveOriginEffectProofPolicy();
  const effects = entries.flatMap((entry) => entry.resolve.effects || []);
  const artifact = normalizeArtifact({
    version: handlerEffects.ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_VERSION,
    generatedBy,
    phase: handlerEffects.ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_PHASE,
    artifact: handlerEffects.ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_ARTIFACT,
    contractId: handlerEffects.ROUTE_HANDLER_EFFECT_CONTRACT_ID,
    provider: 'node',
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    routeEffectPlanConnected: Boolean(plan),
    loweringPlanConnected: Boolean(plan),
    sourcePlanVersion: plan && plan.version,
    sourcePlanArtifact: plan && plan.artifact,
    providerBehaviorImplemented: true,
    nodeProviderEffectExecutionImplemented: true,
    nodeProviderLiveOriginFetchImplemented: true,
    compiledWasmEffectExecutionImplemented: false,
    compiledWasmSuspendResumeBridgeImplemented: false,
    scope: policy,
    runtime: { version: handlerEffects.ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_RUNTIME_VERSION, package: '@pulse-compute/provider-node/runtime/route-handler-effects' },
    proof: { package: '@pulse-compute/provider-node/compiler/route-handler-live-origin-proof', mode: inputs.mode || 'live-origin-http', singleEffect: true, namedObjectEffectGroup: true, arrayEffectGroup: false, fixtureBackends: false, actualNetworkFetch: true, bootstrapOrigin: true },
    lifecycle: { ...handlerEffects.ROUTE_HANDLER_EFFECT_LIFECYCLE, nodeProofHostEffectExecution: entries.length > 0, nodeProofContinuationReentryPlanned: entries.length > 0, nodeProofLiveOriginNetworkFetch: entries.length > 0, languageLevelAsync: false, promises: false, asyncAwait: false, asyncify: false },
    methods: [...handlerEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS],
    groupShapes: clone(handlerEffects.ROUTE_HANDLER_EFFECT_GROUP_SHAPES),
    responseHandleSurface: [...handlerEffects.ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
    reservedResponseHandleSurface: [...handlerEffects.ROUTE_HANDLER_CONTEXT_SURFACE.reservedResolvedFetchResponse],
    policy: { compilerOwnsProviderBehavior: false, compilerOrchestrationOnly: true, providerOwner: '@pulse-compute/provider-node', directProviderSmoke: true, localFixtureFetch: false, actualNetworkFetch: true, liveOriginFetch: true, userAuthoredAsync: false, languageLevelAsync: false, promises: false, asyncAwait: false, asyncify: false, compiledWasmSuspendResumeBridge: false },
    origins: normalizeOriginSummary(provider),
    entriesConsumed: entries.map(({ route, resolve }) => ({ routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName, groupShape: resolve.groupShape, continuation: resolve.continuation && resolve.continuation.name, effects: (resolve.effects || []).map((effect) => ({ name: effect.name || '$default', kind: effect.kind, backend: effect.backend, method: effect.request && effect.request.method })) })),
    smoke: { checks, failedChecks: failures, results: { single: serializeExecution(singleExecution), missingOriginResponse: serializeExecution(missingExecution), namedObject: serializeExecution(namedExecution), unsupportedMethod: unsupportedResult, missingBackend: missingBackendResult } },
    summary: {
      routesWithEffects: entries.length,
      effects: effects.length,
      backendFetchEffects: effects.filter((effect) => effect.kind === 'backend-fetch').length,
      checks: checks.length,
      failedChecks: failures.length,
      singleResolveValidated: checks.some((entry) => entry.name.startsWith('single ctx.resolve') && entry.status === 'ok'),
      singleValidated: checks.some((entry) => entry.name.startsWith('single ctx.resolve') && entry.status === 'ok'),
      namedObjectValidated: checks.some((entry) => entry.name.startsWith('named ctx.resolve') && entry.status === 'ok'),
      liveOriginNetworkFetchValidated: checks.some((entry) => entry.name.includes('live origin GET') && entry.status === 'ok'),
      liveOrigin404Validated: checks.some((entry) => entry.name.startsWith('live origin 404') && entry.status === 'ok'),
      headValidated: checks.some((entry) => entry.name.startsWith('live origin HEAD') && entry.status === 'ok'),
      continuationReentryValidated: checks.some((entry) => entry.name.includes('Continuation') || entry.name.includes('continuation') && entry.status === 'ok'),
      unsupportedMethodValidated: checks.some((entry) => entry.name.startsWith('unsupported backend fetch methods') && entry.status === 'ok'),
      unsupportedMethodDiagnosticValidated: checks.some((entry) => entry.name.startsWith('unsupported backend fetch methods') && entry.status === 'ok'),
      missingBackendValidated: checks.some((entry) => entry.name.startsWith('missing live-origin backend') && entry.status === 'ok'),
      missingBackendDiagnosticValidated: checks.some((entry) => entry.name.startsWith('missing live-origin backend') && entry.status === 'ok'),
      responseHandleSurfaceValidated: checks.some((entry) => entry.name.includes('headers are visible') && entry.status === 'ok'),
      providerBehaviorImplemented: true,
      actualNetworkFetch: true,
      fixtureBackends: false,
      compiledWasmEffectExecutionImplemented: false,
      diagnostics: diagnostics.length,
      errorDiagnostics: errorDiagnostics.length,
      errors: errorDiagnostics.length
    },
    diagnostics
  }, cwd);
  return { artifact, diagnostics, failures, provider };
}

module.exports = { buildNodeLiveOriginRouteHandlerEffectProof, phaseName };
