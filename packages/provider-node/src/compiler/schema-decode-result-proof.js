'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadSchemaDecodeContracts() {
  const local = path.resolve(__dirname, '../../../../wasm/packages/contracts/src/handler/schema-decode-result.js');
  if (fs.existsSync(local)) return require(local);
  return require('@pulse-compute/wasm-contracts/handler/schema-decode-result');
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
const schemaDecode = loadSchemaDecodeContracts();
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadDiagnostics();
const { getDefaultArtifactsDir } = loadArtifactsDir();
const { createCompiledHandlerBridgeRuntime, findCompiledHandlerWasm } = require('./route-handler-compiled-wasm-bridge.js');

const phaseName = 'node-schema-decode-result-proof';

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
function schemaRoutes(plan) {
  return (Array.isArray(plan && plan.routes) ? plan.routes : []).filter((route) => route && Array.isArray(route.decodes) && route.decodes.length > 0);
}
function makeDiagnostic(code, message, severity, details, hint) {
  return normalizeDiagnostic({ phase: phaseName, severity: severity || 'error', code, message, hint, details, loc: { file: '<node-schema-decode-result-proof>' } });
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
function check(name, ok, details, failures, diagnostics) {
  const entry = { name, status: ok ? 'ok' : 'error', details: sanitize(details || {}) };
  if (!ok) {
    failures.push(entry);
    diagnostics.push(makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.compiledSmokeFailed, `Node schema decode result proof check failed: ${name}.`, 'error', entry.details));
  }
  return entry;
}
function runRoute(runtime, requestJsonRouteIndex, variant) {
  const suffix = variant === 'schema-missing' ? '_schema_missing' : variant === 'invalid' ? '_invalid' : '';
  const fnName = `bridge_run_request_json_route_${requestJsonRouteIndex}${suffix}`;
  const fn = runtime.exports[fnName];
  if (typeof fn !== 'function') throw new Error(`Missing schema decode bridge export ${fnName}.`);
  const status = fn();
  return { status, result: runtime.readResult(), bodyReadCount: runtime.requestBodyReadCount(), parseCount: runtime.requestJsonParseCount() };
}

function buildNodeSchemaDecodeResultProof(options = {}) {
  const cwd = options.cwd || process.cwd();
  const outDir = options.outDir || getDefaultArtifactsDir(cwd);
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const diagnostics = [];
  const failures = [];
  const checks = [];
  const plan = normalizePlan(options.schemaDecodeResultPlan || options.plan);
  if (!plan) diagnostics.push(makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.planMissing, 'Node schema decode result proof requires schema-decode-result-plan.json.', 'error', { hint: 'Enable schema-decode-result-plan before requesting the Node proof.' }));
  const routes = schemaRoutes(plan || {});
  if (plan && routes.length === 0) diagnostics.push(makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.noSchemaRoutes, 'Node schema decode result proof requires at least one route using ctx.req.json("Schema") or ctx.req.parse("Schema").', 'error', { routes: (plan.routes || []).length }));
  const wasmFile = findCompiledHandlerWasm(options.compiledHandlers, cwd, outDir, options.compiledHandlersCwd || options.sourceCwd);
  if (!wasmFile) diagnostics.push(makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.wasmMissing, 'Node schema decode result proof requires the compiled-handler Wasm artifact.', 'error', { hint: 'Enable compiled handlers together with the schema decode result proof.' }));

  const smoke = { results: {}, checks, failedChecks: failures };
  if (wasmFile && diagnostics.filter((entry) => (entry.severity || 'error') === 'error').length === 0) {
    try {
      const runtime = createCompiledHandlerBridgeRuntime(wasmFile);
      for (let index = 0; index < routes.length; index += 1) {
        const route = routes[index];
        const requestJsonRouteIndex = Number(route.requestJsonRouteIndex) | 0;
        const valid = runRoute(runtime, requestJsonRouteIndex, 'valid');
        smoke.results[`route${index}`] = sanitize({ route: { method: route.method, path: route.path, handlerName: route.handlerName, requestJsonRouteIndex }, valid });
        const validReturnedResolveBoundary = valid.result && valid.result.kind === 'resolve';
        checks.push(check(`schema_decode_route_${index}_valid_status`, (valid.status >= 200 && valid.status < 300) || (validReturnedResolveBoundary && valid.status === 0), valid, failures, diagnostics));
        checks.push(check(`schema_decode_route_${index}_lazy_read_once`, valid.bodyReadCount === 1, valid, failures, diagnostics));
        checks.push(check(`schema_decode_route_${index}_parse_once`, valid.parseCount === 1, valid, failures, diagnostics));
        if (validReturnedResolveBoundary) {
          checks.push(check(`schema_decode_route_${index}_effect_boundary_returned`, true, valid.result, failures, diagnostics));
        } else {
          checks.push(check(`schema_decode_route_${index}_body_fields_visible`, /body-123/.test(valid.result.body || '') && /Body User/.test(valid.result.body || '') && /true/.test(valid.result.body || ''), valid.result, failures, diagnostics));
        }
        const invalid = runRoute(runtime, requestJsonRouteIndex, 'invalid');
        smoke.results[`route${index}InvalidJson`] = sanitize({ route: { method: route.method, path: route.path, handlerName: route.handlerName, requestJsonRouteIndex }, invalid });
        checks.push(check(`schema_decode_route_${index}_invalid_json_status`, invalid.status === 400, invalid, failures, diagnostics));
        checks.push(check(`schema_decode_route_${index}_invalid_json_error`, /invalid_json/.test(invalid.result.body || ''), invalid.result, failures, diagnostics));
        const missing = runRoute(runtime, requestJsonRouteIndex, 'schema-missing');
        smoke.results[`route${index}MissingField`] = sanitize({ route: { method: route.method, path: route.path, handlerName: route.handlerName, requestJsonRouteIndex }, missing });
        checks.push(check(`schema_decode_route_${index}_missing_field_status`, missing.status === 400, missing, failures, diagnostics));
        checks.push(check(`schema_decode_route_${index}_missing_field_error`, /schema_decode_failed/.test(missing.result.body || '') && /active/.test(missing.result.body || ''), missing.result, failures, diagnostics));
      }
      checks.push(check('schema_decode_module_has_no_js_handler_imports', runtime.imports.filter((entry) => entry.module === 'pulsewasm_handlers').length === 0, { imports: runtime.imports }, failures, diagnostics));
    } catch (error) {
      diagnostics.push(makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.compiledSmokeFailed, 'Node schema decode result proof smoke execution failed.', 'error', { message: error && error.message ? error.message : String(error), stack: error && error.stack ? error.stack : undefined }));
    }
  }
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const compiledHandlerFiles = Array.isArray(options.compiledHandlers && options.compiledHandlers.files) ? options.compiledHandlers.files : [];
  const compiledHandlerOutputs = Array.isArray(options.compiledHandlers && options.compiledHandlers.outputFiles) ? options.compiledHandlers.outputFiles : [];
  const artifact = normalizeArtifact({
    version: schemaDecode.NODE_SCHEMA_DECODE_RESULT_PROOF_VERSION,
    generatedBy,
    phase: schemaDecode.NODE_SCHEMA_DECODE_RESULT_PROOF_PHASE,
    artifact: schemaDecode.NODE_SCHEMA_DECODE_RESULT_PROOF_ARTIFACT,
    contractId: schemaDecode.SCHEMA_DECODE_RESULT_CONTRACT_ID,
    provider: 'node',
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    sourcePlanVersion: plan && plan.version,
    sourcePlanArtifact: plan && plan.artifact,
    schemaDecodeResultPlanConnected: Boolean(plan),
    compiledHandlersConnected: Boolean(options.compiledHandlers),
    compiledHandlerPlanVersion: options.compiledHandlers && options.compiledHandlers.artifact && options.compiledHandlers.artifact.version,
    runtime: { version: schemaDecode.NODE_SCHEMA_DECODE_RESULT_RUNTIME_VERSION, package: '@pulse-compute/wasm-runtime-core-as/compiler/compiled-handlers', wasm: wasmFile ? path.relative(cwd, wasmFile).replace(/\\/g, '/') : undefined },
    scope: schemaDecode.defaultNodeSchemaDecodeResultProofPolicy(),
    surface: JSON.parse(JSON.stringify(schemaDecode.SCHEMA_DECODE_RESULT_SURFACE)),
    accessors: JSON.parse(JSON.stringify(schemaDecode.SCHEMA_DECODE_RESULT_ACCESSORS)),
    reserved: [...schemaDecode.SCHEMA_DECODE_RESULT_RESERVED_SURFACE],
    compiledWasmRuntimeImplemented: errorDiagnostics.length === 0,
    nodeCompiledProofImplemented: errorDiagnostics.length === 0,
    providerNetworkFetchRequired: false,
    automaticSchemaGeneration: false,
    typedSchemaSpecificAccessors: false,
    arbitraryJsObjectInference: false,
    binaryRequestBodyParsing: false,
    streamRequestBodyParsing: false,
    asyncAwait: false,
    promises: false,
    asyncify: false,
    routesConsumed: routes.map((route, index) => ({ index, requestJsonRouteIndex: route.requestJsonRouteIndex, routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName, decodes: route.decodes })),
    smoke,
    summary: {
      schemaDecodeRoutes: routes.length,
      compiled: Boolean(wasmFile) && errorDiagnostics.length === 0,
      executed: checks.length > 0 && errorDiagnostics.length === 0,
      checks: checks.length,
      failedChecks: failures.length,
      lazyReadValidated: checks.some((entry) => entry.name.includes('lazy_read_once') && entry.status === 'ok'),
      parseCacheValidated: checks.some((entry) => entry.name.includes('parse_once') && entry.status === 'ok'),
      invalidJsonValidated: checks.some((entry) => entry.name.includes('invalid_json_status') && entry.status === 'ok'),
      missingFieldValidated: checks.some((entry) => entry.name.includes('missing_field_error') && entry.status === 'ok'),
      noJsHandlerImports: checks.some((entry) => entry.name === 'schema_decode_module_has_no_js_handler_imports' && entry.status === 'ok'),
      compiledWasmRuntimeImplemented: errorDiagnostics.length === 0,
      nodeCompiledProofImplemented: errorDiagnostics.length === 0,
      automaticSchemaGeneration: false,
      typedSchemaSpecificAccessors: false,
      arbitraryJsObjectInference: false,
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

module.exports = { phaseName, buildNodeSchemaDecodeResultProof };
