'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadRequestJsonContracts() {
  const local = path.resolve(__dirname, '../../../../wasm/packages/contracts/src/handler/request-json-body.js');
  if (fs.existsSync(local)) return require(local);
  return require('@pulse-compute/wasm-contracts/handler/request-json-body');
}
function loadDiagnostics() {
  const local = path.resolve(__dirname, '../../../../wasm/packages/contracts/src/diagnostics.js');
  if (fs.existsSync(local)) return require(local);
  return require('@pulse-compute/wasm-contracts/diagnostics');
}
function loadArtifactsDir() {
  const local = path.resolve(__dirname, '../../../../wasm/packages/build-support/src/artifacts-dir.js');
  if (fs.existsSync(local)) return require(local);
  return require('@pulse-compute/wasm-build-support/artifacts-dir');
}
const requestJson = loadRequestJsonContracts();
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadDiagnostics();
const { getDefaultArtifactsDir } = loadArtifactsDir();
const { createCompiledHandlerBridgeRuntime, findCompiledHandlerWasm } = require('./route-handler-compiled-wasm-bridge.js');

const phaseName = 'node-request-json-body-proof';

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}
function normalizePlan(input) {
  const plan = input && input.artifact && typeof input.artifact === 'object' ? input.artifact : input;
  if (!plan || typeof plan !== 'object') return undefined;
  return { ...plan, routes: Array.isArray(plan.routes) ? plan.routes.map(clone) : [] };
}
function requestJsonRoutes(plan) {
  return (Array.isArray(plan && plan.routes) ? plan.routes : []).filter((route) => route && route.required);
}
function makeDiagnostic(code, message, severity, details, hint) {
  return normalizeDiagnostic({ phase: phaseName, severity: severity || 'error', code, message, hint, details, loc: { file: '<node-request-json-body-proof>' } });
}
function check(name, ok, details, failures, diagnostics) {
  const entry = { name, status: ok ? 'ok' : 'error', details: sanitize(details || {}) };
  if (!ok) {
    failures.push(entry);
    diagnostics.push(makeDiagnostic(requestJson.REQUEST_JSON_BODY_DIAGNOSTICS.compiledSmokeFailed, `Node request JSON body proof check failed: ${name}.`, 'error', entry.details));
  }
  return entry;
}
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'body') { out.body = String(entry || ''); out.bodyPreview = String(entry || '').slice(0, 240); }
    else out[key] = sanitize(entry);
  }
  return out;
}
function runRoute(runtime, index, variant) {
  const fnName = variant === 'invalid' ? `bridge_run_request_json_route_${index}_invalid` : `bridge_run_request_json_route_${index}`;
  const fn = runtime.exports[fnName];
  if (typeof fn !== 'function') throw new Error(`Missing request JSON bridge export ${fnName}.`);
  const status = fn();
  return { status, result: runtime.readResult(), bodyReadCount: runtime.requestBodyReadCount(), parseCount: runtime.requestJsonParseCount() };
}
function runNoBodyEffectRoute(runtime) {
  const fn = runtime.exports.bridge_run_effect_route_0;
  if (typeof fn !== 'function') return undefined;
  const kind = fn();
  return { kind, bodyReadCount: runtime.requestBodyReadCount(), parseCount: runtime.requestJsonParseCount(), result: runtime.readResult() };
}
function buildNodeRequestJsonBodyProof(options = {}) {
  const cwd = options.cwd || process.cwd();
  const outDir = options.outDir || getDefaultArtifactsDir(cwd);
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const diagnostics = [];
  const failures = [];
  const checks = [];
  const plan = normalizePlan(options.requestJsonBodyPlan || options.plan);
  if (!plan) diagnostics.push(makeDiagnostic(requestJson.REQUEST_JSON_BODY_DIAGNOSTICS.planMissing, 'Node request JSON body proof requires request-json-body-plan.json.', 'error', { hint: 'Enable request-json-body-plan before requesting the Node proof.' }));
  const routes = requestJsonRoutes(plan || {});
  if (plan && routes.length === 0) diagnostics.push(makeDiagnostic(requestJson.REQUEST_JSON_BODY_DIAGNOSTICS.planMissing, 'Node request JSON body proof requires at least one route using ctx.req.json/parse.', 'error', { routes: (plan.routes || []).length }));
  const wasmFile = findCompiledHandlerWasm(options.compiledHandlers, cwd, outDir, options.compiledHandlersCwd || options.sourceCwd);
  if (!wasmFile) diagnostics.push(makeDiagnostic(requestJson.REQUEST_JSON_BODY_DIAGNOSTICS.wasmMissing, 'Node request JSON body proof requires the compiled-handler Wasm artifact.', 'error', { hint: 'Enable compiled handlers together with the request JSON body proof.' }));

  let runtime;
  const smoke = { results: {}, checks, failedChecks: failures };
  if (wasmFile && diagnostics.filter((entry) => (entry.severity || 'error') === 'error').length === 0) {
    try {
      runtime = createCompiledHandlerBridgeRuntime(wasmFile);
      const noBody = runNoBodyEffectRoute(runtime);
      if (noBody) {
        smoke.results.noBodyRoute = sanitize(noBody);
        checks.push(check('request_json_not_read_on_unrelated_effect_route', noBody.bodyReadCount === 0 && noBody.parseCount === 0, noBody, failures, diagnostics));
      }
      for (let index = 0; index < routes.length; index += 1) {
        const route = routes[index];
        const valid = runRoute(runtime, index, 'valid');
        smoke.results[`route${index}`] = sanitize({ route: { method: route.method, path: route.path, handlerName: route.handlerName }, valid });
        const validReturnedResolveBoundary = valid.result && valid.result.kind === 'resolve';
        checks.push(check(`request_json_route_${index}_valid_status`, (valid.status >= 200 && valid.status < 300) || (validReturnedResolveBoundary && valid.status === 0), valid, failures, diagnostics));
        checks.push(check(`request_json_route_${index}_lazy_read_once`, valid.bodyReadCount === 1, valid, failures, diagnostics));
        checks.push(check(`request_json_route_${index}_parse_once`, valid.parseCount === 1, valid, failures, diagnostics));
        if (validReturnedResolveBoundary) {
          checks.push(check(`request_json_route_${index}_effect_boundary_returned`, true, valid.result, failures, diagnostics));
        } else {
          checks.push(check(`request_json_route_${index}_body_visible`, /body-123/.test(valid.result.body || ''), valid.result, failures, diagnostics));
        }
        const invalid = runRoute(runtime, index, 'invalid');
        smoke.results[`route${index}Invalid`] = sanitize({ route: { method: route.method, path: route.path, handlerName: route.handlerName }, invalid });
        checks.push(check(`request_json_route_${index}_invalid_json_status`, invalid.status === 400, invalid, failures, diagnostics));
        checks.push(check(`request_json_route_${index}_invalid_json_error`, /invalid_json/.test(invalid.result.body || ''), invalid.result, failures, diagnostics));
      }
      checks.push(check('request_json_module_has_no_js_handler_imports', runtime.imports.filter((entry) => entry.module === 'pulsewasm_handlers').length === 0, { imports: runtime.imports }, failures, diagnostics));
    } catch (error) {
      diagnostics.push(makeDiagnostic(requestJson.REQUEST_JSON_BODY_DIAGNOSTICS.compiledSmokeFailed, 'Node request JSON body proof smoke execution failed.', 'error', { message: error && error.message ? error.message : String(error), stack: error && error.stack ? error.stack : undefined }));
    }
  }
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const compiledHandlerFiles = Array.isArray(options.compiledHandlers && options.compiledHandlers.files) ? options.compiledHandlers.files : [];
  const compiledHandlerOutputs = Array.isArray(options.compiledHandlers && options.compiledHandlers.outputFiles) ? options.compiledHandlers.outputFiles : [];
  const artifact = normalizeArtifact({
    version: requestJson.NODE_REQUEST_JSON_BODY_PROOF_VERSION,
    generatedBy,
    phase: requestJson.NODE_REQUEST_JSON_BODY_PROOF_PHASE,
    artifact: requestJson.NODE_REQUEST_JSON_BODY_PROOF_ARTIFACT,
    contractId: requestJson.REQUEST_JSON_BODY_CONTRACT_ID,
    provider: 'node',
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    sourcePlanVersion: plan && plan.version,
    sourcePlanArtifact: plan && plan.artifact,
    requestJsonBodyPlanConnected: Boolean(plan),
    compiledHandlersConnected: Boolean(options.compiledHandlers),
    compiledHandlerPlanVersion: options.compiledHandlers && options.compiledHandlers.artifact && options.compiledHandlers.artifact.version,
    runtime: { version: requestJson.NODE_REQUEST_JSON_BODY_RUNTIME_VERSION, package: '@pulse-compute/wasm-runtime-core-as/compiler/compiled-handlers', wasm: wasmFile ? path.relative(cwd, wasmFile).replace(/\\/g, '/') : undefined },
    scope: requestJson.defaultNodeRequestJsonBodyProofPolicy(),
    lazyEvaluation: JSON.parse(JSON.stringify(requestJson.REQUEST_JSON_BODY_LAZY_POLICY)),
    surface: JSON.parse(JSON.stringify(requestJson.REQUEST_JSON_BODY_SURFACE)),
    accessors: [...requestJson.REQUEST_JSON_BODY_ACCESSORS],
    reservedAccessors: [...requestJson.REQUEST_JSON_BODY_RESERVED_ACCESSORS],
    compiledWasmRuntimeImplemented: errorDiagnostics.length === 0,
    nodeCompiledProofImplemented: errorDiagnostics.length === 0,
    providerNetworkFetchRequired: false,
    backendJsonRequestBodyImplemented: false,
    binaryRequestBodyParsing: false,
    streamRequestBodyParsing: false,
    asyncAwait: false,
    promises: false,
    asyncify: false,
    routesConsumed: routes.map((route, index) => ({ index, routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName, reads: route.reads, accessors: route.accessors })),
    smoke,
    summary: {
      routesWithJsonBodyReads: routes.length,
      compiled: Boolean(wasmFile) && errorDiagnostics.length === 0,
      executed: checks.length > 0 && errorDiagnostics.length === 0,
      checks: checks.length,
      failedChecks: failures.length,
      lazyReadValidated: checks.some((entry) => entry.name.includes('lazy_read_once') && entry.status === 'ok'),
      parseCacheValidated: checks.some((entry) => entry.name.includes('parse_once') && entry.status === 'ok'),
      invalidJsonValidated: checks.some((entry) => entry.name.includes('invalid_json_status') && entry.status === 'ok'),
      noEagerReadValidated: checks.some((entry) => entry.name === 'request_json_not_read_on_unrelated_effect_route' && entry.status === 'ok'),
      noJsHandlerImports: checks.some((entry) => entry.name === 'request_json_module_has_no_js_handler_imports' && entry.status === 'ok'),
      providerBehaviorImplemented: false,
      compiledWasmRuntimeImplemented: errorDiagnostics.length === 0,
      binaryRequestBodyParsing: false,
      streamRequestBodyParsing: false,
      diagnostics: diagnostics.length,
      errorDiagnostics: errorDiagnostics.length,
      errors: errorDiagnostics.length
    },
    generatedFiles: compiledHandlerFiles.map((file) => ({ file: file.file, bytes: file.bytes, sha256: file.sha256 })),
    generatedOutputs: compiledHandlerOutputs.map((file) => ({ file: file.file, kind: file.kind, bytes: file.bytes, sha256: file.sha256 })),
    diagnostics
  }, cwd);
  return { artifact, diagnostics, failures, files: compiledHandlerFiles, outputFiles: compiledHandlerOutputs.length ? compiledHandlerOutputs : (wasmFile ? [{ file: path.relative(cwd, wasmFile).replace(/\\/g, '/'), kind: 'compiled-handler-wasm', bytes: fs.statSync(wasmFile).size }] : []), wasmFile };
}

module.exports = { phaseName, buildNodeRequestJsonBodyProof };
