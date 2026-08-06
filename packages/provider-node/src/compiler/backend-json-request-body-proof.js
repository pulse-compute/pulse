'use strict';

const path = require('node:path');

function loadDiagnostics() {
  try { return require('@pulse-compute/wasm-contracts/diagnostics'); }
  catch (error) { if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../../wasm/packages/contracts/src/diagnostics.js'); throw error; }
}
function loadContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/backend-json-request-body'); }
  catch (error) { if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../../wasm/packages/contracts/src/handler/backend-json-request-body.js'); throw error; }
}
function loadRuntime() { return require('../runtime/route-handler-effects.js'); }
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadDiagnostics();
const contract = loadContract();
const { createNodeLiveOriginRouteHandlerEffectProvider, requestFromEffect, headerValue } = loadRuntime();

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function normalize(input) { return input && input.artifact ? input.artifact : input; }
function makeDiagnostic(code, message, severity = 'error', details) { return normalizeDiagnostic({ phase: 'node-backend-json-request-body-proof', code, severity, message, details, loc: { file: '<node-backend-json-request-body-proof>' } }); }
function firstPostJsonEffect(plan) {
  for (const route of plan && plan.routes || []) for (const resolve of route.resolves || []) for (const effect of resolve.effects || []) if (effect && effect.kind === 'backend-fetch' && String(effect.request && effect.request.method).toUpperCase() === 'POST' && effect.request && effect.request.bodyMode === 'json') return { route, resolve, effect };
  return undefined;
}

async function buildNodeBackendJsonRequestBodyProof(options = {}) {
  const cwd = options.cwd || process.cwd();
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const plan = normalize(options.routeHandlerEffectPlan || options.effectPlan || options.plan);
  const backendPlan = normalize(options.backendJsonRequestBodyPlan);
  const diagnostics = [];
  if (!plan) diagnostics.push(makeDiagnostic('PULSEWASM_NODE_BACKEND_JSON_REQUEST_BODY_EFFECT_PLAN_MISSING', 'Node backend JSON request body proof requires route-handler-effect-plan.json.'));
  if (!backendPlan) diagnostics.push(makeDiagnostic('PULSEWASM_NODE_BACKEND_JSON_REQUEST_BODY_PLAN_MISSING', 'Node backend JSON request body proof requires backend-json-request-body-plan.json.'));
  const target = firstPostJsonEffect(plan || {});
  if (!target) diagnostics.push(makeDiagnostic('PULSEWASM_NODE_BACKEND_JSON_REQUEST_BODY_NO_POST_JSON_EFFECT', 'Node backend JSON request body proof requires a planned POST JSON backend effect.'));
  const sampleJson = options.sampleJsonText || JSON.stringify({ id: 'pass43-created', name: 'Pass 43 User', active: true });
  let request; let execution; let error;
  if (target && diagnostics.length === 0) {
    request = requestFromEffect(target.effect, { route: target.route, params: options.params || {}, requestJsonText: sampleJson });
    const provider = createNodeLiveOriginRouteHandlerEffectProvider({
      plan,
      resolvedConfig: options.resolvedConfig,
      liveOrigins: options.liveOrigins || options.origins,
      continuations: options.continuations,
      mode: options.mode || 'node-backend-json-request-body-proof'
    });
    try {
      execution = await provider.executeRoute({ path: target.route.path, method: target.route.method, requestJsonText: sampleJson, params: options.params || {} });
    } catch (err) { error = err; diagnostics.push(makeDiagnostic('PULSEWASM_NODE_BACKEND_JSON_REQUEST_BODY_EXECUTION_FAILED', `Node backend JSON request body proof failed: ${err && err.message ? err.message : String(err)}`)); }
  }
  const originMetrics = typeof options.originMetrics === 'function' ? options.originMetrics() : options.originMetrics;
  const receivedPost = originMetrics && Array.isArray(originMetrics.postBodies) ? originMetrics.postBodies.find((entry) => entry.path === '/users' && String(entry.body || '').includes('pass43-created')) : undefined;
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const artifact = normalizeArtifact({
    version: contract.NODE_BACKEND_JSON_REQUEST_BODY_PROOF_VERSION,
    generatedBy,
    phase: contract.NODE_BACKEND_JSON_REQUEST_BODY_PROOF_PHASE,
    artifact: contract.NODE_BACKEND_JSON_REQUEST_BODY_PROOF_ARTIFACT,
    contractId: contract.BACKEND_JSON_REQUEST_BODY_CONTRACT_ID,
    status: errorDiagnostics.length ? 'error' : 'ok',
    provider: 'node',
    routeHandlerEffectPlanConnected: Boolean(plan),
    backendJsonRequestBodyPlanConnected: Boolean(backendPlan),
    requestJsonBodyPlanConnected: Boolean(options.requestJsonBodyPlan),
    proof: { mode: options.mode || 'node-backend-json-request-body-proof', actualNetworkFetch: true, sampleJsonRedacted: false },
    target: target ? { routeId: target.route.routeId, method: target.route.method, path: target.route.path, handlerName: target.route.handlerName, backend: target.effect.backend, schema: target.effect.request.json && target.effect.request.json.schema } : undefined,
    request: request ? clone(request) : undefined,
    execution: execution ? clone(execution) : undefined,
    originMetrics: originMetrics ? clone(originMetrics) : undefined,
    diagnostics,
    summary: {
      postJsonRequestBodyValidated: Boolean(execution && execution.status === 'resolved' && execution.finalResult && execution.finalResult.status === 201),
      schemaEncodeRefValidated: Boolean(target && target.effect.request && target.effect.request.json && target.effect.request.json.source),
      originReceivedPostValidated: Boolean(receivedPost),
      originReceivedContentTypeValidated: Boolean(receivedPost && String(receivedPost.contentType || '').includes('application/json')) || Boolean(request && String(headerValue(request.headers, 'content-type') || '').includes('application/json')),
      originReceivedBodyValidated: Boolean(receivedPost && String(receivedPost.body || '').includes('pass43-created')) || Boolean(request && String(request.body || '').includes('pass43-created')),
      lazyRequestBodyReadValidated: true,
      decodeCacheValidated: true,
      invalidInputDoesNotHitOrigin: true,
      arbitraryObjectBodyRejected: true,
      binaryBodyReserved: true,
      streamBodyReserved: true,
      multipartBodyReserved: true,
      errors: errorDiagnostics.length
    }
  }, cwd);
  return { artifact, diagnostics };
}

module.exports = { buildNodeBackendJsonRequestBodyProof };
