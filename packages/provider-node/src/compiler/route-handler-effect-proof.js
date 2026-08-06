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
const { createNodeRouteHandlerEffectProvider, createDefaultBackendsFromPlan, headerValue } = require('../runtime/route-handler-effects.js');

const phaseName = 'node-route-handler-effect-proof';

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
    loc: { file: '<node-route-handler-effect-proof>' }
  });
}

function check(name, condition, details, failures, diagnostics) {
  const entry = { name, status: condition ? 'ok' : 'error', details: details || {} };
  if (!condition) {
    failures.push(entry);
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectSmokeFailed, `Node route-handler effect proof check failed: ${name}.`, 'error', { check: name, details }));
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
    lifecycle: clone(execution.lifecycle),
    diagnostics: clone(execution.diagnostics || [])
  };
}

function buildNodeRouteHandlerEffectProof(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const plan = normalizePlan(inputs.routeHandlerEffectPlan || inputs.plan);
  const diagnostics = [];
  const failures = [];
  const checks = [];

  if (!plan) {
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectPlanRequired, 'Node route-handler effect proof requires a route-handler-effect-plan artifact.', 'error', { hint: 'Emit --route-handler-effects before requesting --node-route-handler-effect-proof.' }));
  }

  const entries = plannedResolveEntries(plan);
  if (plan && entries.length === 0) {
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectNoPlannedEffects, 'Node route-handler effect proof requires at least one ctx.resolve(ctx.fetch(...), continuation) boundary.', 'error', { routes: Array.isArray(plan.routes) ? plan.routes.length : 0, hint: 'Add a lowerable ctx.resolve(ctx.fetch("backend", requestSpec), afterFetch) route handler.' }));
  }

  const backends = inputs.backends || createDefaultBackendsFromPlan(plan || {}, inputs.defaultParams || {});
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
  const provider = createNodeRouteHandlerEffectProvider({ plan, backends, continuations, mode: inputs.mode || 'local-route-effect-fixture' });
  diagnostics.push(...(provider.diagnostics || []));

  let singleExecution;
  let namedExecution;
  let unsupportedResult;
  let missingBackendResult;

  if (entries.length > 0) {
    const single = firstEntryByShape(entries, 'single') || entries[0];
    singleExecution = provider.executeResolve(single.route, single.resolve, inputs.params || { id: 'abc' });
    const singleResolved = singleExecution.resolved && (singleExecution.resolved.$default || singleExecution.resolved[Object.keys(singleExecution.resolved || {})[0]]);
    checks.push(check('single ctx.resolve(ctx.fetch(...), continuation) resolves one backend fetch handle', singleExecution.status === 'resolved' && Boolean(singleResolved) && singleResolved.status >= 200 && singleResolved.status < 300, { status: singleExecution.status, resolvedNames: Object.keys(singleExecution.resolved || {}) }, failures, diagnostics));
    checks.push(check('continuation reads single fetch through ctx.resolved()', singleExecution.continuationPlanned === true && singleExecution.continuationResultAccesses.some((access) => access.name === '$default'), { continuation: singleExecution.continuation, resultAccesses: singleExecution.continuationResultAccesses }, failures, diagnostics));
    checks.push(check('resolved fetch response exposes status ok header text jsonText json surface', singleExecution.responseHandleSurface.includes('status') && singleExecution.responseHandleSurface.includes('ok') && singleExecution.responseHandleSurface.includes('header') && singleExecution.responseHandleSurface.includes('text') && singleExecution.responseHandleSurface.includes('jsonText') && singleExecution.responseHandleSurface.includes('json'), { responseHandleSurface: singleExecution.responseHandleSurface }, failures, diagnostics));

    const named = firstEntryByShape(entries, 'named-object');
    if (named) {
      namedExecution = provider.executeResolve(named.route, named.resolve, inputs.params || { id: 'abc' });
      const names = Object.keys(namedExecution.resolved || {}).sort();
      checks.push(check('named ctx.resolve({ name: ctx.fetch(...) }, continuation) resolves all named fetch handles', namedExecution.status === 'resolved' && names.includes('user') && names.includes('posts'), { status: namedExecution.status, names }, failures, diagnostics));
      const head = Object.values(namedExecution.resolved || {}).find((entry) => entry.request && entry.request.method === 'HEAD');
      checks.push(check('HEAD backend fetch resolves headers/status with empty body text', Boolean(head) && head.status >= 200 && head.status < 300 && head.body === '', { head }, failures, diagnostics));
    } else {
      checks.push(check('named object effect group is present in proof fixture', false, { entries: entries.map((entry) => ({ routeId: entry.route.routeId, groupShape: entry.resolve.groupShape })) }, failures, diagnostics));
    }

    const firstEffect = single.resolve.effects[0];
    unsupportedResult = provider.executeFetch(cloneEffectWithMethod(firstEffect, 'PUT'), { route: single.route, params: { id: 'abc' } }).toJSON();
    checks.push(check('unsupported backend fetch methods are diagnosed', unsupportedResult.status === 405 && unsupportedResult.diagnostics.some((entry) => entry.code === handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectUnsupportedMethod), { status: unsupportedResult.status, diagnostics: unsupportedResult.diagnostics.map((entry) => entry.code) }, failures, diagnostics));

    const missingEffect = clone(firstEffect);
    missingEffect.backend = 'missingBackend';
    missingBackendResult = provider.executeFetch(missingEffect, { route: single.route, params: { id: 'abc' } }).toJSON();
    checks.push(check('missing backend fixtures are diagnosed', missingBackendResult.status === 502 && missingBackendResult.diagnostics.some((entry) => entry.code === handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeEffectBackendMissing), { status: missingBackendResult.status, diagnostics: missingBackendResult.diagnostics.map((entry) => entry.code) }, failures, diagnostics));

    checks.push(check('resolved header passthrough is available to continuations', singleResolved && headerValue(singleResolved.headers, 'x-pulsewasm-backend') === firstEffect.backend, { headers: singleResolved && singleResolved.headers }, failures, diagnostics));
  }

  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const policy = handlerEffects.defaultRouteHandlerNodeEffectProofPolicy();
  const effects = entries.flatMap((entry) => entry.resolve.effects || []);
  const artifact = normalizeArtifact({
    version: handlerEffects.ROUTE_HANDLER_NODE_EFFECT_PROOF_VERSION,
    generatedBy,
    phase: handlerEffects.ROUTE_HANDLER_NODE_EFFECT_PROOF_PHASE,
    artifact: handlerEffects.ROUTE_HANDLER_NODE_EFFECT_PROOF_ARTIFACT,
    contractId: handlerEffects.ROUTE_HANDLER_EFFECT_CONTRACT_ID,
    provider: 'node',
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    routeEffectPlanConnected: Boolean(plan),
    loweringPlanConnected: Boolean(plan),
    sourcePlanVersion: plan && plan.version,
    sourcePlanArtifact: plan && plan.artifact,
    providerBehaviorImplemented: true,
    nodeProviderEffectExecutionImplemented: true,
    compiledWasmEffectExecutionImplemented: false,
    compiledWasmSuspendResumeBridgeImplemented: false,
    scope: policy,
    runtime: { version: handlerEffects.ROUTE_HANDLER_NODE_EFFECT_RUNTIME_VERSION, package: '@pulse-compute/provider-node/runtime/route-handler-effects' },
    proof: { package: '@pulse-compute/provider-node/compiler/route-handler-effect-proof', mode: inputs.mode || 'local-route-effect-fixture', singleEffect: true, namedObjectEffectGroup: true, arrayEffectGroup: false, fixtureBackends: true, actualNetworkFetch: false },
    lifecycle: { ...handlerEffects.ROUTE_HANDLER_EFFECT_LIFECYCLE, nodeProofHostEffectExecution: entries.length > 0, nodeProofContinuationReentryPlanned: entries.length > 0, languageLevelAsync: false, promises: false, asyncAwait: false, asyncify: false },
    methods: [...handlerEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS],
    groupShapes: clone(handlerEffects.ROUTE_HANDLER_EFFECT_GROUP_SHAPES),
    responseHandleSurface: [...handlerEffects.ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
    reservedResponseHandleSurface: [...handlerEffects.ROUTE_HANDLER_CONTEXT_SURFACE.reservedResolvedFetchResponse],
    policy: { compilerOwnsProviderBehavior: false, compilerOrchestrationOnly: true, providerOwner: '@pulse-compute/provider-node', directProviderSmoke: true, localFixtureFetch: true, actualNetworkFetch: false, languageLevelAsync: false, promises: false, asyncAwait: false, asyncify: false, compiledWasmSuspendResumeBridge: false },
    entriesConsumed: entries.map(({ route, resolve }) => ({ routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName, groupShape: resolve.groupShape, continuation: resolve.continuation && resolve.continuation.name, effects: (resolve.effects || []).map((effect) => ({ name: effect.name || '$default', kind: effect.kind, backend: effect.backend, method: effect.request && effect.request.method })) })),
    backendFixtures: Object.keys(backends || {}).sort().map((backend) => ({ backend, responses: Object.keys(backends[backend] || {}).sort() })),
    smoke: { checks, failedChecks: failures, results: { single: serializeExecution(singleExecution), namedObject: serializeExecution(namedExecution), unsupportedMethod: unsupportedResult, missingBackend: missingBackendResult } },
    summary: { routesWithEffects: entries.length, effects: effects.length, backendFetchEffects: effects.filter((effect) => effect.kind === 'backend-fetch').length, checks: checks.length, failedChecks: failures.length, singleResolveValidated: checks.some((entry) => entry.name.startsWith('single ctx.resolve') && entry.status === 'ok'), singleValidated: checks.some((entry) => entry.name.startsWith('single ctx.resolve') && entry.status === 'ok'), namedObjectValidated: checks.some((entry) => entry.name.startsWith('named ctx.resolve') && entry.status === 'ok'), headValidated: checks.some((entry) => entry.name.startsWith('HEAD backend fetch') && entry.status === 'ok'), continuationReentryValidated: checks.some((entry) => entry.name.includes('continuation reads') && entry.status === 'ok'), unsupportedMethodValidated: checks.some((entry) => entry.name.startsWith('unsupported backend fetch methods') && entry.status === 'ok'), unsupportedMethodDiagnosticValidated: checks.some((entry) => entry.name.startsWith('unsupported backend fetch methods') && entry.status === 'ok'), missingBackendValidated: checks.some((entry) => entry.name.startsWith('missing backend fixtures') && entry.status === 'ok'), missingBackendDiagnosticValidated: checks.some((entry) => entry.name.startsWith('missing backend fixtures') && entry.status === 'ok'), responseHandleSurfaceValidated: checks.some((entry) => entry.name.startsWith('resolved fetch response exposes') && entry.status === 'ok'), providerBehaviorImplemented: true, compiledWasmEffectExecutionImplemented: false, diagnostics: diagnostics.length, errorDiagnostics: errorDiagnostics.length, errors: errorDiagnostics.length },
    diagnostics
  }, cwd);
  return { artifact, diagnostics, failures, provider };
}

module.exports = { buildNodeRouteHandlerEffectProof, phaseName };
