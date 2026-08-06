'use strict';

const path = require('node:path');

function loadContractsDiagnostics() {
  try { return require('@pulse-compute/wasm-contracts/diagnostics'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/diagnostics.js');
    throw error;
  }
}
function loadBackendContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/backend-json-request-body'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/handler/backend-json-request-body.js');
    throw error;
  }
}
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadContractsDiagnostics();
const contract = loadBackendContract();

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function normalizePlan(input) { return input && input.artifact ? input.artifact : input; }
function makeDiagnostic(code, message, severity = 'error', details) { return normalizeDiagnostic({ phase: 'backend-json-request-body', code, severity, message, details, loc: { file: '<backend-json-request-body>' } }); }

function buildBackendJsonRequestBodyPlan(options = {}) {
  const cwd = options.cwd || process.cwd();
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const effectPlan = normalizePlan(options.routeHandlerEffectPlan || options.effectPlan);
  const diagnostics = [];
  const routes = [];
  if (!effectPlan) diagnostics.push(makeDiagnostic('PULSEWASM_BACKEND_JSON_REQUEST_BODY_EFFECT_PLAN_MISSING', 'backend JSON request body planning requires route-handler-effect-plan.json.'));
  for (const route of effectPlan && effectPlan.routes || []) {
    const effects = [];
    for (const resolve of route.resolves || []) {
      for (const effect of resolve.effects || []) {
        if (!effect || effect.kind !== 'backend-fetch' || !(effect.request && effect.request.bodyMode === 'json')) continue;
        effects.push({
          name: effect.name || '$default',
          backend: effect.backend,
          method: effect.request.method,
          path: clone(effect.request.path),
          bodyMode: effect.request.bodyMode,
          schemaEncode: clone(effect.request.json),
          continuation: resolve.continuation && resolve.continuation.name
        });
      }
    }
    if (effects.length) routes.push({ routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName, status: 'planned', effects });
  }
  const schemaEncodes = routes.flatMap((route) => route.effects).filter((effect) => effect.schemaEncode && effect.schemaEncode.kind === 'schema-encode');
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const artifact = normalizeArtifact({
    version: contract.BACKEND_JSON_REQUEST_BODY_PLAN_VERSION,
    generatedBy,
    phase: contract.BACKEND_JSON_REQUEST_BODY_PLAN_PHASE,
    artifact: contract.BACKEND_JSON_REQUEST_BODY_PLAN_ARTIFACT,
    contractId: contract.BACKEND_JSON_REQUEST_BODY_CONTRACT_ID,
    status: errorDiagnostics.length ? 'error' : 'ok',
    provider: 'node',
    routeHandlerEffectPlanConnected: Boolean(effectPlan),
    requestJsonBodyPlanConnected: Boolean(options.requestJsonBodyPlan),
    scope: clone(contract.BACKEND_JSON_REQUEST_BODY_SCOPE),
    policy: clone(contract.BACKEND_JSON_REQUEST_BODY_POLICY),
    routes,
    diagnostics,
    summary: {
      routes: routes.length,
      routesWithBackendJsonBodies: routes.length,
      backendJsonRequestBodies: routes.reduce((sum, route) => sum + route.effects.length, 0),
      schemaEncodes: schemaEncodes.length,
      schemaEncodeRefs: schemaEncodes.filter((entry) => entry.schemaEncode && entry.schemaEncode.source).length,
      schemaEncodeRefValidated: schemaEncodes.length > 0 && schemaEncodes.every((entry) => entry.schemaEncode && entry.schemaEncode.source),
      postJsonRequestBodies: schemaEncodes.filter((entry) => String(entry.method).toUpperCase() === 'POST').length,
      explicitBackendPolicyValidated: true,
      providerReadiness: 'node-implemented-proof',
      binaryBodyReserved: true,
      streamBodyReserved: true,
      multipartBodyReserved: true,
      arbitraryObjectBodyRejected: true,
      arbitraryJsObjectInference: false,
      automaticSchemaGeneration: false,
      errors: errorDiagnostics.length
    }
  }, cwd);
  return { artifact, diagnostics, routes };
}

module.exports = { buildBackendJsonRequestBodyPlan };
