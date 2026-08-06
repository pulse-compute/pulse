'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadSchemaResponseContracts() {
  const local = path.resolve(__dirname, '../../../../wasm/packages/contracts/src/handler/schema-response-codec.js');
  if (fs.existsSync(local)) return require(local);
  return require('@pulse-compute/wasm-contracts/handler/schema-response-codec');
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
const schemaResponse = loadSchemaResponseContracts();
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadDiagnostics();
const { getDefaultArtifactsDir } = loadArtifactsDir();
const { createCompiledHandlerBridgeRuntime, findCompiledHandlerWasm } = require('./route-handler-compiled-wasm-bridge.js');

const phaseName = 'node-schema-response-codec-proof';
function clone(value) { if (Array.isArray(value)) return value.map(clone); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])); return value; }
function payload(value) { return value && value.artifact && typeof value.artifact === 'object' ? value.artifact : value; }
function normalizePlan(input) { const plan = payload(input); if (!plan || typeof plan !== 'object') return undefined; return { ...plan, routes: Array.isArray(plan.routes) ? plan.routes.map(clone) : [] }; }
function responseRoutes(plan) { return (Array.isArray(plan && plan.routes) ? plan.routes : []).filter((route) => route && Array.isArray(route.finalResponses) && route.finalResponses.length > 0); }
function makeDiagnostic(code, message, severity, details, hint) { return normalizeDiagnostic({ phase: phaseName, severity: severity || 'error', code, message, hint, details, loc: { file: '<node-schema-response-codec-proof>' } }); }
function sanitize(value) { if (Array.isArray(value)) return value.map(sanitize); if (!value || typeof value !== 'object') return value; const out = {}; for (const [key, entry] of Object.entries(value)) { if (key === 'body') { out.body = String(entry || ''); out.bodyPreview = String(entry || '').slice(0, 240); } else out[key] = sanitize(entry); } return out; }
function check(name, ok, details, failures, diagnostics) { const entry = { name, status: ok ? 'ok' : 'error', details: sanitize(details || {}) }; if (!ok) { failures.push(entry); diagnostics.push(makeDiagnostic(schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.compiledSmokeFailed, `Node schema response codec proof check failed: ${name}.`, 'error', entry.details)); } return entry; }
function requestJsonRoutes(requestJsonBodyPlan) { const plan = normalizePlan(requestJsonBodyPlan); return (Array.isArray(plan && plan.routes) ? plan.routes : []).filter((route) => route.required); }
function routeIndexFor(requestJsonRoutesList, route) { return requestJsonRoutesList.findIndex((entry) => entry.path === route.path && String(entry.method).toUpperCase() === String(route.method).toUpperCase()); }
function runRequestJsonRoute(runtime, index, variant) { const suffix = variant === 'invalid' ? '_invalid' : variant === 'schema-missing' ? '_schema_missing' : ''; const fn = runtime.exports[`bridge_run_request_json_route_${index}${suffix}`]; if (typeof fn !== 'function') throw new Error(`Missing request JSON bridge export bridge_run_request_json_route_${index}${suffix}.`); const status = fn(); return { status, result: runtime.readResult(), bodyReadCount: runtime.requestBodyReadCount(), parseCount: runtime.requestJsonParseCount() }; }

function buildNodeSchemaResponseCodecProof(options = {}) {
  const cwd = options.cwd || process.cwd();
  const outDir = options.outDir || getDefaultArtifactsDir(cwd);
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const diagnostics = [];
  const failures = [];
  const checks = [];
  const plan = normalizePlan(options.schemaResponseCodecPlan || options.plan);
  if (!plan) diagnostics.push(makeDiagnostic(schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.planMissing, 'Node schema response codec proof requires schema-response-codec-plan.json.', 'error', { hint: 'Enable schema-response-codec-plan before requesting the Node proof.' }));
  const routes = responseRoutes(plan || {}).filter((route) => route.role === 'route');
  if (plan && routes.length === 0) diagnostics.push(makeDiagnostic(schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.noSchemaResponseRoutes, 'Node schema response codec proof requires at least one route using ctx.result.json("Schema", ref).', 'error', { routes: (plan.routes || []).length }));
  const requestRoutes = requestJsonRoutes(options.requestJsonBodyPlan);
  const wasmFile = findCompiledHandlerWasm(options.compiledHandlers, cwd, outDir, options.compiledHandlersCwd || options.sourceCwd);
  if (!wasmFile) diagnostics.push(makeDiagnostic(schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.wasmMissing, 'Node schema response codec proof requires the compiled-handler Wasm artifact.', 'error', { hint: 'Enable compiled handlers together with the schema response codec proof.' }));
  const smoke = { results: {}, checks, failedChecks: failures };
  let runtime;
  if (wasmFile && diagnostics.filter((entry) => (entry.severity || 'error') === 'error').length === 0) {
    try {
      runtime = createCompiledHandlerBridgeRuntime(wasmFile);
      for (let i = 0; i < routes.length; i += 1) {
        const route = routes[i];
        const requestJsonRouteIndex = routeIndexFor(requestRoutes, route);
        if (requestJsonRouteIndex < 0) {
          diagnostics.push(makeDiagnostic(schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.compiledSmokeFailed, `Could not map schema response route ${route.method} ${route.path} to a request-json bridge route.`, 'error', { route }));
          continue;
        }
        const valid = runRequestJsonRoute(runtime, requestJsonRouteIndex, 'valid');
        smoke.results[`route${i}`] = sanitize({ route, requestJsonRouteIndex, valid });
        checks.push(check(`schema_response_route_${i}_status`, valid.status >= 200 && valid.status < 300, valid, failures, diagnostics));
        checks.push(check(`schema_response_route_${i}_json_kind`, valid.result.kind === 'json-text', valid.result, failures, diagnostics));
        checks.push(check(`schema_response_route_${i}_content_type`, (valid.result.headers || []).some(([name, value]) => String(name).toLowerCase() === 'content-type' && String(value).includes('application/json')), valid.result, failures, diagnostics));
        checks.push(check(`schema_response_route_${i}_body_encoded_from_ref`, /body-123/.test(valid.result.body || '') && /Body User/.test(valid.result.body || ''), valid.result, failures, diagnostics));
        checks.push(check(`schema_response_route_${i}_lazy_read_once`, valid.bodyReadCount === 1, valid, failures, diagnostics));
        checks.push(check(`schema_response_route_${i}_parse_once`, valid.parseCount === 1, valid, failures, diagnostics));
        const missing = runRequestJsonRoute(runtime, requestJsonRouteIndex, 'schema-missing');
        smoke.results[`route${i}Missing`] = sanitize({ route, requestJsonRouteIndex, missing });
        checks.push(check(`schema_response_route_${i}_missing_field_status`, missing.status === 400, missing, failures, diagnostics));
        checks.push(check(`schema_response_route_${i}_missing_field_error`, /schema_decode_failed/.test(missing.result.body || ''), missing.result, failures, diagnostics));
      }
      checks.push(check('schema_response_module_has_no_js_handler_imports', runtime.imports.filter((entry) => entry.module === 'pulsewasm_handlers').length === 0, { imports: runtime.imports }, failures, diagnostics));
    } catch (error) {
      diagnostics.push(makeDiagnostic(schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.compiledSmokeFailed, 'Node schema response codec proof smoke execution failed.', 'error', { message: error && error.message ? error.message : String(error), stack: error && error.stack ? error.stack : undefined }));
    }
  }
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const compiledHandlerFiles = Array.isArray(options.compiledHandlers && options.compiledHandlers.files) ? options.compiledHandlers.files : [];
  const compiledHandlerOutputs = Array.isArray(options.compiledHandlers && options.compiledHandlers.outputFiles) ? options.compiledHandlers.outputFiles : [];
  const artifact = normalizeArtifact({
    version: schemaResponse.NODE_SCHEMA_RESPONSE_CODEC_PROOF_VERSION,
    generatedBy,
    phase: schemaResponse.NODE_SCHEMA_RESPONSE_CODEC_PROOF_PHASE,
    artifact: schemaResponse.NODE_SCHEMA_RESPONSE_CODEC_PROOF_ARTIFACT,
    contractId: schemaResponse.SCHEMA_RESPONSE_CODEC_CONTRACT_ID,
    provider: 'node',
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    sourcePlanVersion: plan && plan.version,
    sourcePlanArtifact: plan && plan.artifact,
    schemaResponseCodecPlanConnected: Boolean(plan),
    requestJsonBodyPlanConnected: Boolean(options.requestJsonBodyPlan),
    compiledHandlersConnected: Boolean(options.compiledHandlers),
    runtime: { version: schemaResponse.NODE_SCHEMA_RESPONSE_CODEC_RUNTIME_VERSION, package: '@pulse-compute/wasm-runtime-core-as/compiler/compiled-handlers', wasm: wasmFile ? path.relative(cwd, wasmFile).replace(/\\/g, '/') : undefined },
    scope: schemaResponse.defaultNodeSchemaResponseCodecProofPolicy(),
    surface: JSON.parse(JSON.stringify(schemaResponse.SCHEMA_RESPONSE_CODEC_SURFACE)),
    valueKinds: JSON.parse(JSON.stringify(schemaResponse.SCHEMA_RESPONSE_CODEC_VALUE_KINDS)),
    reserved: [...schemaResponse.SCHEMA_RESPONSE_CODEC_RESERVED_SURFACE],
    compiledWasmRuntimeImplemented: errorDiagnostics.length === 0,
    nodeCompiledProofImplemented: errorDiagnostics.length === 0,
    providerNetworkFetchRequired: false,
    backendJsonRequestBodies: false,
    requestBodyEffects: false,
    automaticSchemaGeneration: false,
    typedSchemaSpecificAccessors: false,
    arbitraryJsObjectInference: false,
    binaryRequestBodyParsing: false,
    streamRequestBodyParsing: false,
    asyncAwait: false,
    promises: false,
    asyncify: false,
    routes: routes.map((route) => ({ routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName, finalResponses: route.finalResponses })),
    smoke,
    summary: {
      schemaResponseRoutes: routes.length,
      finalJsonResponses: routes.reduce((sum, route) => sum + route.finalResponses.length, 0),
      compiled: Boolean(wasmFile) && errorDiagnostics.length === 0,
      executed: checks.length > 0 && errorDiagnostics.length === 0,
      checks: checks.length,
      failedChecks: failures.length,
      jsonResultValidated: checks.some((entry) => entry.name.includes('json_kind') && entry.status === 'ok'),
      contentTypeValidated: checks.some((entry) => entry.name.includes('content_type') && entry.status === 'ok'),
      encodeFromDecodeRefValidated: checks.some((entry) => entry.name.includes('body_encoded_from_ref') && entry.status === 'ok'),
      lazyReadValidated: checks.some((entry) => entry.name.includes('lazy_read_once') && entry.status === 'ok'),
      parseCacheValidated: checks.some((entry) => entry.name.includes('parse_once') && entry.status === 'ok'),
      missingFieldValidated: checks.some((entry) => entry.name.includes('missing_field_error') && entry.status === 'ok'),
      noJsHandlerImports: checks.some((entry) => entry.name === 'schema_response_module_has_no_js_handler_imports' && entry.status === 'ok'),
      compiledWasmRuntimeImplemented: errorDiagnostics.length === 0,
      nodeCompiledProofImplemented: errorDiagnostics.length === 0,
      backendJsonRequestBodies: false,
      requestBodyEffects: false,
      automaticSchemaGeneration: false,
      arbitraryJsObjectInference: false,
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

module.exports = { phaseName, buildNodeSchemaResponseCodecProof };
