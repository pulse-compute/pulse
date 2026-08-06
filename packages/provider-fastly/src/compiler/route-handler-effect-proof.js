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
  createFastlyRouteHandlerEffectProvider,
  createDefaultBackendsFromPlan,
  buildFastlyRouteEffectProviderConfig,
  headerValue
} = require('../runtime/route-handler-effects.js');

const phaseName = 'fastly-route-handler-effect-proof';

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
    loc: { file: '<fastly-route-handler-effect-proof>' }
  });
}

function check(name, condition, details, failures, diagnostics) {
  const entry = { name, status: condition ? 'ok' : 'error', details: details || {} };
  if (!condition) {
    failures.push(entry);
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectSmokeFailed, `Fastly route-handler effect proof check failed: ${name}.`, 'error', { check: name, details }));
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
    route: clone(execution.route),
    groupShape: execution.groupShape,
    continuation: execution.continuation,
    continuationPlanned: execution.continuationPlanned,
    effectCount: execution.effectCount,
    effects: clone(execution.effects || []),
    resolved: clone(execution.resolved || {}),
    finalResult: clone(execution.finalResult),
    responseHandleSurface: clone(execution.responseHandleSurface),
    continuationResultAccesses: clone(execution.continuationResultAccesses),
    continuationResponseMethodCalls: clone(execution.continuationResponseMethodCalls),
    providerConfig: clone(execution.providerConfig),
    lifecycle: clone(execution.lifecycle),
    diagnostics: clone(execution.diagnostics || [])
  };
}

function buildFastlyRouteHandlerEffectProof(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const plan = normalizePlan(inputs.routeHandlerEffectPlan || inputs.plan);
  const diagnostics = [];
  const failures = [];
  const checks = [];

  if (!plan) {
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectPlanRequired, 'Fastly route-handler effect proof requires a route-handler-effect-plan artifact.', 'error', { hint: 'Emit --route-handler-effects before requesting --fastly-route-handler-effect-proof.' }));
  }

  const entries = plannedResolveEntries(plan);
  if (plan && entries.length === 0) {
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectNoPlannedEffects, 'Fastly route-handler effect proof requires at least one ctx.resolve(ctx.fetch(...), continuation) boundary.', 'error', { routes: Array.isArray(plan.routes) ? plan.routes.length : 0, hint: 'Add a lowerable ctx.resolve(ctx.fetch("backend", requestSpec), afterFetch) route handler.' }));
  }

  const backends = inputs.backends || createDefaultBackendsFromPlan(plan || {}, inputs.defaultParams || {});
  const providerConfig = inputs.providerConfig || buildFastlyRouteEffectProviderConfig({ plan, resolvedConfig: inputs.resolvedConfig, mode: inputs.mode || 'fastly-backend-fetch-fixture' });
  const continuations = inputs.continuations || {
    renderUser(ctx) {
      const user = ctx.resolved();
      if (!user.ok()) return ctx.result.text(user.status(), user.text());
      return ctx.result.text(200, user.text(), { headers: { 'X-PulseWasm-Continuation': 'renderUser' } });
    },
    renderDashboard(ctx) {
      const user = ctx.resolved('user');
      const posts = ctx.resolved('posts');
      return ctx.result.text(200, user.text() + posts.header('x-count'), { headers: { 'X-PulseWasm-Continuation': 'renderDashboard' } });
    }
  };
  const provider = createFastlyRouteHandlerEffectProvider({ plan, backends, continuations, providerConfig, resolvedConfig: inputs.resolvedConfig, mode: inputs.mode || 'fastly-backend-fetch-fixture' });
  diagnostics.push(...(provider.diagnostics || []));

  checks.push(check(
    'Fastly route-effect provider config maps planned backends to symbolic refs',
    providerConfig && providerConfig.provider === 'fastly' && providerConfig.symbolicRefsOnly === true && Array.isArray(providerConfig.backends) && providerConfig.backends.length > 0 && providerConfig.backends.every((backend) => typeof backend.baseUrlRef === 'string' && backend.baseUrlRef.startsWith('$config:')),
    { provider: providerConfig && providerConfig.provider, backends: providerConfig && providerConfig.backends ? providerConfig.backends.length : 0, symbolicRefsOnly: providerConfig && providerConfig.symbolicRefsOnly, refs: providerConfig && providerConfig.backends ? providerConfig.backends.map((backend) => backend.baseUrlRef) : [] },
    failures,
    diagnostics
  ));

  let singleExecution;
  let namedExecution;
  let unsupportedResult;
  let missingBackendResult;

  if (entries.length > 0) {
    const single = firstEntryByShape(entries, 'single') || entries[0];
    singleExecution = provider.executeResolve(single.route, single.resolve, inputs.params || { id: 'abc' });
    const singleResolved = singleExecution.resolved && (singleExecution.resolved.$default || singleExecution.resolved[Object.keys(singleExecution.resolved || {})[0]]);
    checks.push(check('single ctx.resolve(ctx.fetch(...), continuation) resolves one Fastly backend fetch handle', singleExecution.status === 'resolved' && Boolean(singleResolved) && singleResolved.status >= 200 && singleResolved.status < 300, { status: singleExecution.status, resolvedNames: Object.keys(singleExecution.resolved || {}) }, failures, diagnostics));
    checks.push(check('continuation reads Fastly single fetch through ctx.resolved()', singleExecution.continuationPlanned === true && singleExecution.continuationResultAccesses.some((access) => access.name === '$default'), { continuation: singleExecution.continuation, resultAccesses: singleExecution.continuationResultAccesses }, failures, diagnostics));
    checks.push(check('resolved Fastly fetch response exposes status ok header text jsonText json surface', singleExecution.responseHandleSurface.includes('status') && singleExecution.responseHandleSurface.includes('ok') && singleExecution.responseHandleSurface.includes('header') && singleExecution.responseHandleSurface.includes('text') && singleExecution.responseHandleSurface.includes('jsonText') && singleExecution.responseHandleSurface.includes('json'), { responseHandleSurface: singleExecution.responseHandleSurface }, failures, diagnostics));

    const named = firstEntryByShape(entries, 'named-object');
    if (named) {
      namedExecution = provider.executeResolve(named.route, named.resolve, inputs.params || { id: 'abc' });
      const names = Object.keys(namedExecution.resolved || {}).sort();
      checks.push(check('named ctx.resolve({ name: ctx.fetch(...) }, continuation) resolves all named Fastly fetch handles', namedExecution.status === 'resolved' && names.includes('user') && names.includes('posts'), { status: namedExecution.status, names }, failures, diagnostics));
      const head = Object.values(namedExecution.resolved || {}).find((entry) => entry.request && entry.request.method === 'HEAD');
      checks.push(check('HEAD Fastly backend fetch resolves headers/status with empty body text', Boolean(head) && head.status >= 200 && head.status < 300 && head.body === '', { head }, failures, diagnostics));
    } else {
      checks.push(check('named object effect group is present in Fastly proof fixture', false, { entries: entries.map((entry) => ({ routeId: entry.route.routeId, groupShape: entry.resolve.groupShape })) }, failures, diagnostics));
    }

    const firstEffect = single.resolve.effects[0];
    unsupportedResult = provider.executeFetch(cloneEffectWithMethod(firstEffect, 'PUT'), { route: single.route, params: { id: 'abc' } }).toJSON();
    checks.push(check('unsupported Fastly backend fetch methods are diagnosed', unsupportedResult.status === 405 && unsupportedResult.diagnostics.some((entry) => entry.code === handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectUnsupportedMethod), { status: unsupportedResult.status, diagnostics: unsupportedResult.diagnostics.map((entry) => entry.code) }, failures, diagnostics));

    const missingEffect = clone(firstEffect);
    missingEffect.backend = 'missingBackend';
    missingBackendResult = provider.executeFetch(missingEffect, { route: single.route, params: { id: 'abc' } }).toJSON();
    checks.push(check('missing Fastly backend fixtures are diagnosed', missingBackendResult.status === 502 && missingBackendResult.diagnostics.some((entry) => entry.code === handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fastlyEffectBackendMissing), { status: missingBackendResult.status, diagnostics: missingBackendResult.diagnostics.map((entry) => entry.code) }, failures, diagnostics));

    checks.push(check('resolved Fastly header passthrough is available to continuations', singleResolved && headerValue(singleResolved.headers, 'x-pulsewasm-fastly-backend') === firstEffect.backend, { headers: singleResolved && singleResolved.headers }, failures, diagnostics));
  }

  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const policy = handlerEffects.defaultRouteHandlerFastlyEffectProofPolicy();
  const effects = entries.flatMap((entry) => entry.resolve.effects || []);
  const artifact = normalizeArtifact({
    version: handlerEffects.ROUTE_HANDLER_FASTLY_EFFECT_PROOF_VERSION,
    generatedBy,
    phase: handlerEffects.ROUTE_HANDLER_FASTLY_EFFECT_PROOF_PHASE,
    artifact: handlerEffects.ROUTE_HANDLER_FASTLY_EFFECT_PROOF_ARTIFACT,
    contractId: handlerEffects.ROUTE_HANDLER_EFFECT_CONTRACT_ID,
    provider: 'fastly',
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    routeEffectPlanConnected: Boolean(plan),
    loweringPlanConnected: Boolean(plan),
    sourcePlanVersion: plan && plan.version,
    sourcePlanArtifact: plan && plan.artifact,
    providerBehaviorImplemented: true,
    fastlyProviderEffectExecutionImplemented: true,
    compiledWasmEffectExecutionImplemented: false,
    compiledWasmSuspendResumeBridgeImplemented: false,
    scope: policy,
    runtime: { version: handlerEffects.ROUTE_HANDLER_FASTLY_EFFECT_RUNTIME_VERSION, package: '@pulse-compute/provider-fastly/runtime/route-handler-effects' },
    proof: { package: '@pulse-compute/provider-fastly/compiler/route-handler-effect-proof', mode: inputs.mode || 'fastly-backend-fetch-fixture', singleEffect: true, namedObjectEffectGroup: true, arrayEffectGroup: false, fixtureBackends: true, symbolicBackendRefs: true, actualNetworkFetch: false },
    lifecycle: { ...handlerEffects.ROUTE_HANDLER_EFFECT_LIFECYCLE, fastlyProofHostEffectExecution: entries.length > 0, fastlyProofContinuationReentryPlanned: entries.length > 0, languageLevelAsync: false, promises: false, asyncAwait: false, asyncify: false },
    methods: [...handlerEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS],
    groupShapes: clone(handlerEffects.ROUTE_HANDLER_EFFECT_GROUP_SHAPES),
    responseHandleSurface: [...handlerEffects.ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
    reservedResponseHandleSurface: [...handlerEffects.ROUTE_HANDLER_CONTEXT_SURFACE.reservedResolvedFetchResponse],
    policy: { compilerOwnsProviderBehavior: false, compilerOrchestrationOnly: true, providerOwner: '@pulse-compute/provider-fastly', directProviderSmoke: true, localFixtureFetch: true, symbolicBackendRefs: true, actualNetworkFetch: false, languageLevelAsync: false, promises: false, asyncAwait: false, asyncify: false, compiledWasmSuspendResumeBridge: false },
    providerConfig: clone(providerConfig),
    entriesConsumed: entries.map(({ route, resolve }) => ({ routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName, groupShape: resolve.groupShape, continuation: resolve.continuation && resolve.continuation.name, effects: (resolve.effects || []).map((effect) => ({ name: effect.name || '$default', kind: effect.kind, backend: effect.backend, method: effect.request && effect.request.method })) })),
    backendFixtures: Object.keys(backends || {}).sort().map((backend) => ({ backend, responses: Object.keys(backends[backend] || {}).sort() })),
    smoke: { checks, failedChecks: failures, results: { single: serializeExecution(singleExecution), namedObject: serializeExecution(namedExecution), unsupportedMethod: unsupportedResult, missingBackend: missingBackendResult } },
    summary: {
      routesWithEffects: entries.length,
      effects: effects.length,
      backendFetchEffects: effects.filter((effect) => effect.kind === 'backend-fetch').length,
      checks: checks.length,
      failedChecks: failures.length,
      singleResolveValidated: checks.some((entry) => entry.name.startsWith('single ctx.resolve') && entry.status === 'ok'),
      singleValidated: checks.some((entry) => entry.name.startsWith('single ctx.resolve') && entry.status === 'ok'),
      namedObjectValidated: checks.some((entry) => entry.name.startsWith('named ctx.resolve') && entry.status === 'ok'),
      headValidated: checks.some((entry) => entry.name.startsWith('HEAD Fastly backend fetch') && entry.status === 'ok'),
      continuationReentryValidated: checks.some((entry) => entry.name.includes('continuation reads Fastly') && entry.status === 'ok'),
      unsupportedMethodValidated: checks.some((entry) => entry.name.startsWith('unsupported Fastly backend fetch methods') && entry.status === 'ok'),
      unsupportedMethodDiagnosticValidated: checks.some((entry) => entry.name.startsWith('unsupported Fastly backend fetch methods') && entry.status === 'ok'),
      missingBackendValidated: checks.some((entry) => entry.name.startsWith('missing Fastly backend fixtures') && entry.status === 'ok'),
      missingBackendDiagnosticValidated: checks.some((entry) => entry.name.startsWith('missing Fastly backend fixtures') && entry.status === 'ok'),
      responseHandleSurfaceValidated: checks.some((entry) => entry.name.startsWith('resolved Fastly fetch response exposes') && entry.status === 'ok'),
      providerConfigValidated: checks.some((entry) => entry.name.startsWith('Fastly route-effect provider config') && entry.status === 'ok'),
      providerConfigMapped: checks.some((entry) => entry.name.startsWith('Fastly route-effect provider config') && entry.status === 'ok'),
      symbolicBackendRefs: Boolean(providerConfig && providerConfig.symbolicRefsOnly),
      providerBehaviorImplemented: true,
      compiledWasmEffectExecutionImplemented: false,
      diagnostics: diagnostics.length,
      errorDiagnostics: errorDiagnostics.length,
      errors: errorDiagnostics.length
    },
    diagnostics
  }, cwd);
  return { artifact, diagnostics, failures, provider, providerConfig };
}

module.exports = { buildFastlyRouteHandlerEffectProof, phaseName };
