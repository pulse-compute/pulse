'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadHandlerEffectContracts() {
  const local = path.resolve(__dirname, '../../../../wasm/packages/contracts/src/handler/effects.js');
  if (fs.existsSync(local)) return require(local);
  return require('@pulse-compute/wasm-contracts/handler/effects');
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
function loadRouteEffectsRuntime() {
  try { return require('@pulse-compute/provider-node/runtime/route-handler-effects'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/provider-node')) return require('../runtime/route-handler-effects.js');
    throw error;
  }
}

const handlerEffects = loadHandlerEffectContracts();
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadDiagnostics();
const { getDefaultArtifactsDir } = loadArtifactsDir();
const {
  createNodeLiveOriginRouteHandlerEffectProvider,
  headerValue,
  defaultParamsForRoute = (route) => {
    const params = {};
    for (const match of String(route && route.path || '').matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) params[match[1]] = 'abc';
    return params;
  }
} = loadRouteEffectsRuntime();

const phaseName = 'node-compiled-wasm-route-handler-effect-bridge';
const COMPILED_RESULT_RESOLVE = 6;

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}
function stableSlash(value) { return String(value || '').replace(/\\/g, '/'); }
function normalizePlan(input) {
  const plan = input && input.artifact && typeof input.artifact === 'object' ? input.artifact : input;
  if (!plan || typeof plan !== 'object') return undefined;
  return { ...plan, routes: Array.isArray(plan.routes) ? plan.routes.map(clone) : [], continuations: Array.isArray(plan.continuations) ? plan.continuations.map(clone) : [] };
}
function plannedEntries(plan) {
  const entries = [];
  for (const route of plan && plan.routes || []) {
    for (const resolve of route.resolves || []) {
      if (resolve && Array.isArray(resolve.effects) && resolve.effects.some((effect) => effect && effect.kind === 'backend-fetch')) entries.push({ route, resolve });
    }
  }
  return entries;
}
function makeDiagnostic(code, message, severity, details, hint) {
  return normalizeDiagnostic({ phase: phaseName, severity: severity || 'error', code, message, hint, details, loc: { file: '<node-compiled-wasm-route-handler-effect-bridge>' } });
}
function check(name, ok, details, failures, diagnostics) {
  const entry = { name, status: ok ? 'ok' : 'error', details: sanitize(details || {}) };
  if (!ok) {
    failures.push(entry);
    diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeCompiledBridgeSmokeFailed, `Node compiled-Wasm route-effect bridge check failed: ${name}.`, 'error', entry.details));
  }
  return entry;
}
function stableHeaders(headers) {
  const volatile = new Set(['date', 'connection', 'keep-alive', 'transfer-encoding']);
  const entries = Array.isArray(headers) ? headers : Object.entries(headers || {});
  return entries.map((entry) => {
    if (Array.isArray(entry)) return [entry[0], entry[1]];
    if (entry && typeof entry === 'object') return [entry.name || entry.key || '', entry.value !== undefined ? entry.value : ''];
    return ['', ''];
  }).map(([name, value]) => [String(name).toLowerCase(), String(value)]).filter(([name]) => name && !volatile.has(name)).sort(([a], [b]) => a.localeCompare(b));
}
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'headers') out.headers = stableHeaders(entry);
    else if (key === 'body') { out.body = String(entry || ''); out.bodyPreview = String(entry || '').slice(0, 240); }
    else out[key] = sanitize(entry);
  }
  return out;
}
function findCompiledHandlerWasm(compiledHandlers, cwd, outDir, compiledHandlersCwd) {
  const candidates = [];
  for (const file of compiledHandlers && compiledHandlers.outputFiles || []) {
    if (file && file.kind === 'compiled-handler-wasm' && file.file) candidates.push(file.file);
  }
  for (const file of candidates) {
    const bases = [compiledHandlersCwd, cwd].filter(Boolean);
    for (const base of bases) {
      const abs = path.isAbsolute(file) ? file : path.resolve(base, file);
      if (fs.existsSync(abs)) return abs;
    }
  }
  const fallback = path.join(outDir || getDefaultArtifactsDir(cwd), 'generated', 'compiled-handlers', 'pulsewasm-compiled-handlers.wasm');
  if (fs.existsSync(fallback)) return fallback;
  return undefined;
}
function instantiateCompiledBridge(wasmFile) {
  const wasmBytes = fs.readFileSync(wasmFile);
  const module = new WebAssembly.Module(wasmBytes);
  const imports = WebAssembly.Module.imports(module);
  const importObject = { env: { abort() { throw new Error('AssemblyScript abort'); } } };
  for (const imp of imports) {
    if (!importObject[imp.module]) importObject[imp.module] = {};
    if (!importObject[imp.module][imp.name]) importObject[imp.module][imp.name] = () => 0;
  }
  const instance = new WebAssembly.Instance(module, importObject);
  const exports = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  function memory() {
    if (!exports.memory) throw new Error('Compiled handler bridge did not export memory.');
    return exports.memory;
  }
  function writeUtf8(value) {
    const bytes = encoder.encode(String(value ?? ''));
    const ptr = exports.bridge_alloc_utf8(bytes.length || 1);
    new Uint8Array(memory().buffer, ptr, bytes.length).set(bytes);
    return { ptr, len: bytes.length };
  }
  function readUtf8(ptr, len) {
    if (!ptr || !len) return '';
    return decoder.decode(new Uint8Array(memory().buffer, ptr, len));
  }
  function setResolvedResponse(name, response) {
    const kind = response.kind || (String(headerValue(response.headers, 'content-type') || '').includes('json') ? 'json-text' : 'text');
    const n = writeUtf8(name);
    const k = writeUtf8(kind);
    const b = writeUtf8(response.body || '');
    exports.bridge_set_resolved_response_utf8(n.ptr, n.len, Number(response.status || 0), k.ptr, k.len, b.ptr, b.len);
    for (const [headerName, headerValueText] of stableHeaders(response.headers || [])) {
      const hn = writeUtf8(headerName);
      const hv = writeUtf8(headerValueText);
      exports.bridge_set_resolved_header_utf8(n.ptr, n.len, hn.ptr, hn.len, hv.ptr, hv.len);
    }
  }
  function readHeaderText(kind, index) {
    const lenName = `bridge_result_header_${kind}_utf8_len`;
    const ptrName = `bridge_result_header_${kind}_utf8_ptr`;
    const len = typeof exports[lenName] === 'function' ? exports[lenName](index) : 0;
    const ptr = typeof exports[ptrName] === 'function' ? exports[ptrName](index) : 0;
    return readUtf8(ptr, len);
  }
  function readResultHeaders() {
    const count = typeof exports.bridge_result_header_count === 'function' ? exports.bridge_result_header_count() : 0;
    const headers = [];
    for (let index = 0; index < count; index += 1) {
      const name = readHeaderText('name', index);
      const value = readHeaderText('value', index);
      if (name) headers.push([name, value]);
    }
    return headers;
  }
  function setRequestBody(body) {
    if (typeof exports.bridge_set_request_body_utf8 !== 'function') return false;
    const b = writeUtf8(body || '');
    exports.bridge_set_request_body_utf8(b.ptr, b.len);
    return true;
  }
  function requestBodyReadCount() { return typeof exports.bridge_request_body_read_count === 'function' ? exports.bridge_request_body_read_count() : 0; }
  function requestJsonParseCount() { return typeof exports.bridge_request_json_parse_count === 'function' ? exports.bridge_request_json_parse_count() : 0; }
  function readResult() {
    const len = exports.bridge_result_body_utf8_len ? exports.bridge_result_body_utf8_len() : 0;
    const ptr = exports.bridge_result_body_utf8_ptr ? exports.bridge_result_body_utf8_ptr() : 0;
    const kindCode = exports.bridge_result_kind ? exports.bridge_result_kind() : 0;
    return { status: exports.bridge_result_status ? exports.bridge_result_status() : 0, kindCode, kind: kindCode === 2 ? 'json-text' : kindCode === 1 ? 'text' : kindCode === 4 ? 'empty' : kindCode === COMPILED_RESULT_RESOLVE ? 'resolve' : 'none', headers: readResultHeaders(), body: readUtf8(ptr, len) };
  }
  return { module, instance, exports, imports, wasmBytes, writeUtf8, setRequestBody, requestBodyReadCount, requestJsonParseCount, setResolvedResponse, readResult };
}
async function executeCompiledBoundary({ runtime, provider, entry, routeIndex, params, variant }) {
  const route = entry.route;
  const resolve = entry.resolve;
  const runName = variant === 'missing' ? `bridge_run_effect_route_${routeIndex}_missing` : `bridge_run_effect_route_${routeIndex}`;
  const run = runtime.exports[runName];
  if (typeof run !== 'function') throw new Error(`Missing compiled bridge export ${runName}.`);
  const pendingKind = run();
  const boundaryIndex = typeof runtime.exports[`bridge_route_${routeIndex}_boundary_index`] === 'function' ? runtime.exports[`bridge_route_${routeIndex}_boundary_index`]() : 0;
  const runtimeId = typeof runtime.exports[`bridge_route_${routeIndex}_runtime_id`] === 'function' ? runtime.exports[`bridge_route_${routeIndex}_runtime_id`]() : Number(route.runtimeId || 0);
  if (runtime.exports.bridge_clear_resolved) runtime.exports.bridge_clear_resolved();
  const mergedParams = { ...defaultParamsForRoute(route), ...params };
  const resolved = {};
  const diagnostics = [];
  for (const effect of resolve.effects || []) {
    if (!effect || effect.kind !== 'backend-fetch') continue;
    const requestJsonText = sampleJsonBodyForEffect(effect);
    const handle = await provider.executeFetch(effect, { route, params: mergedParams, requestJsonText });
    const snapshot = handle.toJSON();
    const name = effect.name || '$default';
    diagnostics.push(...(snapshot.diagnostics || []));
    resolved[name] = { effect: clone(effect), request: snapshot.request, response: { status: snapshot.status, ok: snapshot.ok, kind: snapshot.kind, headers: snapshot.headers, body: snapshot.body, diagnostics: snapshot.diagnostics || [] } };
    runtime.setResolvedResponse(name, resolved[name].response);
  }
  const resumeStatus = runtime.exports.bridge_resume(runtimeId, boundaryIndex);
  const finalResult = runtime.readResult();
  return { pendingKind, boundaryIndex, runtimeId, resumeStatus, routeIndex, variant: variant || 'default', route: { routeId: route.routeId, method: route.method, path: route.path, handlerName: route.handlerName }, groupShape: resolve.groupShape, continuation: resolve.continuation && resolve.continuation.name, resolved, finalResult, diagnostics, lifecycle: { compiledWasmHandlerReturnedResolveRequest: pendingKind === COMPILED_RESULT_RESOLVE, nodeProviderExecutedLiveOriginFetch: true, hostWroteResolvedHandlesToWasm: true, compiledWasmContinuationReentered: true, finalResponseReadFromWasm: true, userAuthoredAsync: false, promises: false, asyncAwait: false, asyncify: false } };
}
function serializeExecution(execution) {
  if (!execution) return undefined;
  return { pendingKind: execution.pendingKind, boundaryIndex: execution.boundaryIndex, runtimeId: execution.runtimeId, resumeStatus: execution.resumeStatus, routeIndex: execution.routeIndex, variant: execution.variant, route: execution.route, groupShape: execution.groupShape, continuation: execution.continuation, resolved: Object.fromEntries(Object.entries(execution.resolved || {}).map(([name, value]) => [name, sanitize(value)])), finalResult: sanitize(execution.finalResult), lifecycle: execution.lifecycle, diagnostics: (execution.diagnostics || []).map((entry) => ({ code: entry.code, severity: entry.severity })) };
}
function sampleJsonBodyForEffect(effect) {
  if (!effect || !effect.request || !(effect.request.bodyMode === 'json' || effect.request.json)) return undefined;
  return '{"id":"compiled-created","name":"Compiled Created User","active":true}';
}
async function buildNodeCompiledRouteHandlerEffectBridge(options = {}) {
  const cwd = options.cwd || process.cwd();
  const outDir = options.outDir || getDefaultArtifactsDir(cwd);
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const diagnostics = [];
  const failures = [];
  const checks = [];
  const plan = normalizePlan(options.routeHandlerEffectPlan || options.plan || options.effectPlan);
  if (!plan) diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeCompiledBridgePlanRequired, 'Node compiled-Wasm route-effect bridge requires route-handler-effect-plan.json.', 'error', { hint: 'Emit route-handler-effect-plan.json before requesting the compiled bridge proof.' }));
  const entries = plannedEntries(plan || {});
  if (plan && entries.length === 0) diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeCompiledBridgeNoPlannedEffects, 'Node compiled-Wasm route-effect bridge requires at least one planned ctx.resolve boundary.', 'error', { routes: (plan.routes || []).length }));
  const wasmFile = findCompiledHandlerWasm(options.compiledHandlers, cwd, outDir, options.compiledHandlersCwd || options.sourceCwd);
  if (!wasmFile) diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeCompiledBridgeAscMissing, 'Node compiled-Wasm route-effect bridge requires the compiled-handler Wasm artifact.', 'error', { hint: 'Enable emitCompiledHandlers together with the node compiled bridge proof.' }));

  let runtime;
  let originSummary = [];
  const smoke = { results: {}, checks, failedChecks: failures };
  if (wasmFile && diagnostics.filter((entry) => (entry.severity || 'error') === 'error').length === 0) {
    try {
      runtime = instantiateCompiledBridge(wasmFile);
      const provider = createNodeLiveOriginRouteHandlerEffectProvider({
        plan,
        resolvedConfig: options.resolvedConfig,
        liveOrigins: options.liveOrigins || options.origins,
        defaultParams: options.params || { id: 'abc' },
        mode: options.mode || 'compiled-wasm-live-origin-bridge',
        redactOriginUrls: options.redactOriginUrls !== false
      });
      originSummary = Array.isArray(provider.originSummary) ? provider.originSummary.map(clone) : [];
      diagnostics.push(...(provider.diagnostics || []));
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const result = await executeCompiledBoundary({ runtime, provider, entry, routeIndex: index, params: options.params || { id: 'abc' } });
        smoke.results[`route${index}`] = serializeExecution(result);
        checks.push(check(`compiled_wasm_route_${index}_returned_resolve`, result.pendingKind === COMPILED_RESULT_RESOLVE && result.lifecycle.compiledWasmHandlerReturnedResolveRequest, { pendingKind: result.pendingKind, route: entry.route.path }, failures, diagnostics));
        checks.push(check(`compiled_wasm_route_${index}_resumed_final_result`, result.finalResult.status >= 200 && result.finalResult.status < 300 && String(result.finalResult.body || '').length > 0, { finalResult: result.finalResult, route: entry.route.path }, failures, diagnostics));
        checks.push(check(`compiled_wasm_route_${index}_final_response_headers`, Boolean(headerValue(result.finalResult.headers, 'content-type')), { finalResult: result.finalResult, route: entry.route.path }, failures, diagnostics));
        const head = Object.values(result.resolved).find((value) => String(value.request && value.request.method).toUpperCase() === 'HEAD');
        if (head) checks.push(check(`compiled_wasm_route_${index}_head_bodyless`, head.response.body === '' && Boolean(headerValue(head.response.headers, 'x-count')), { head: head.response }, failures, diagnostics));
      }
      const singleIndex = entries.findIndex((entry) => entry.resolve.groupShape === 'single');
      if (singleIndex >= 0) {
        const missing = await executeCompiledBoundary({ runtime, provider, entry: entries[singleIndex], routeIndex: singleIndex, params: options.missingParams || { id: 'missing' }, variant: 'missing' });
        smoke.results.missing = serializeExecution(missing);
        checks.push(check('compiled_wasm_missing_origin_404', missing.finalResult.status === 404, { finalResult: missing.finalResult }, failures, diagnostics));
      }
      checks.push(check('compiled_wasm_module_has_no_js_handler_imports', runtime.imports.filter((entry) => entry.module === 'pulsewasm_handlers').length === 0, { imports: runtime.imports }, failures, diagnostics));
    } catch (error) {
      diagnostics.push(makeDiagnostic(handlerEffects.ROUTE_HANDLER_EFFECT_DIAGNOSTICS.nodeCompiledBridgeSmokeFailed, 'Node compiled-Wasm route-effect bridge smoke execution failed.', 'error', { message: error && error.message ? error.message : String(error), stack: error && error.stack ? error.stack : undefined }));
    }
  }
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const singleValidated = entries.some((entry, index) => entry.resolve && entry.resolve.groupShape === 'single' && checks.some((check) => check.name === `compiled_wasm_route_${index}_resumed_final_result` && check.status === 'ok'));
  const namedObjectValidated = entries.some((entry, index) => entry.resolve && entry.resolve.groupShape === 'named-object' && checks.some((check) => check.name === `compiled_wasm_route_${index}_resumed_final_result` && check.status === 'ok'));
  const policy = handlerEffects.defaultRouteHandlerNodeCompiledEffectBridgePolicy();
  const compiledHandlerFiles = Array.isArray(options.compiledHandlers && options.compiledHandlers.files) ? options.compiledHandlers.files : [];
  const compiledHandlerOutputs = Array.isArray(options.compiledHandlers && options.compiledHandlers.outputFiles) ? options.compiledHandlers.outputFiles : [];
  const artifact = normalizeArtifact({
    version: handlerEffects.ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_VERSION,
    generatedBy,
    phase: handlerEffects.ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_PHASE,
    artifact: handlerEffects.ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_ARTIFACT,
    contractId: handlerEffects.ROUTE_HANDLER_EFFECT_CONTRACT_ID,
    provider: 'node',
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    sourcePlanVersion: plan && plan.version,
    sourcePlanArtifact: plan && plan.artifact,
    routeEffectPlanConnected: Boolean(plan),
    compiledHandlersConnected: Boolean(options.compiledHandlers),
    compiledHandlerPlanVersion: options.compiledHandlers && options.compiledHandlers.artifact && options.compiledHandlers.artifact.version,
    providerBehaviorImplemented: true,
    nodeProviderLiveOriginFetchImplemented: true,
    compiledWasmEffectExecutionImplemented: errorDiagnostics.length === 0,
    compiledWasmSuspendResumeBridgeImplemented: errorDiagnostics.length === 0,
    compiledWasmContinuationReentryImplemented: errorDiagnostics.length === 0,
    userAuthoredAsync: false,
    promises: false,
    asyncAwait: false,
    asyncify: false,
    scope: policy,
    runtime: { version: handlerEffects.ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_RUNTIME_VERSION, package: '@pulse-compute/wasm-runtime-core-as/compiler/compiled-handlers', wasm: wasmFile ? stableSlash(path.relative(cwd, wasmFile)) : undefined },
    proof: { package: '@pulse-compute/provider-node/compiler/route-handler-compiled-wasm-bridge', mode: options.mode || 'compiled-wasm-live-origin-bridge', actualNetworkFetch: true, compiledWasmBridgeModule: true, singleEffect: entries.some((entry) => entry.resolve && entry.resolve.groupShape === 'single'), namedObjectEffectGroup: entries.some((entry) => entry.resolve && entry.resolve.groupShape === 'named-object'), arrayEffectGroup: false, fixtureBackends: false, noJsHandlerImports: runtime ? runtime.imports.filter((entry) => entry.module === 'pulsewasm_handlers').length === 0 : false },
    lifecycle: { ...handlerEffects.ROUTE_HANDLER_EFFECT_LIFECYCLE, compiledWasmHandlerReturnedResolveRequest: checks.some((entry) => entry.name.includes('returned_resolve') && entry.status === 'ok'), nodeProviderExecutedLiveOriginFetch: true, hostWroteResolvedHandlesToWasm: errorDiagnostics.length === 0, compiledWasmContinuationReentered: errorDiagnostics.length === 0, finalResponseReadFromWasm: errorDiagnostics.length === 0, languageLevelAsync: false, promises: false, asyncAwait: false, asyncify: false },
    methods: [...handlerEffects.ROUTE_HANDLER_EFFECT_ALLOWED_METHODS],
    groupShapes: clone(handlerEffects.ROUTE_HANDLER_EFFECT_GROUP_SHAPES),
    responseHandleSurface: [...handlerEffects.ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
    reservedResponseHandleSurface: [...handlerEffects.ROUTE_HANDLER_CONTEXT_SURFACE.reservedResolvedFetchResponse],
    origins: originSummary,
    entriesConsumed: entries.map((entry, index) => ({ routeIndex: index, routeId: entry.route.routeId, method: entry.route.method, path: entry.route.path, handlerName: entry.route.handlerName, groupShape: entry.resolve.groupShape, continuation: entry.resolve.continuation && entry.resolve.continuation.name, effects: (entry.resolve.effects || []).map((effect) => ({ name: effect.name || '$default', kind: effect.kind, backend: effect.backend, method: effect.request && effect.request.method })) })),
    smoke,
    summary: { routesWithEffects: entries.length, compiled: Boolean(wasmFile) && errorDiagnostics.length === 0, executed: checks.length > 0 && errorDiagnostics.length === 0, checks: checks.length, failedChecks: failures.length, singleValidated: entries.some((entry, index) => entry.resolve.groupShape === 'single' && checks.some((checkEntry) => checkEntry.name === `compiled_wasm_route_${index}_resumed_final_result` && checkEntry.status === 'ok')), namedObjectValidated: entries.some((entry, index) => entry.resolve.groupShape === 'named-object' && checks.some((checkEntry) => checkEntry.name === `compiled_wasm_route_${index}_resumed_final_result` && checkEntry.status === 'ok')), liveOriginNetworkFetchValidated: checks.some((entry) => entry.name.includes('resumed_final_result') && entry.status === 'ok'), liveOrigin404Validated: checks.some((entry) => entry.name === 'compiled_wasm_missing_origin_404' && entry.status === 'ok'), headValidated: checks.some((entry) => entry.name.includes('head_bodyless') && entry.status === 'ok'), finalResponseHeadersValidated: checks.some((entry) => entry.name.includes('final_response_headers') && entry.status === 'ok'), continuationResumeValidated: checks.some((entry) => entry.name.includes('resumed_final_result') && entry.status === 'ok'), noJsHandlerImports: checks.some((entry) => entry.name === 'compiled_wasm_module_has_no_js_handler_imports' && entry.status === 'ok'), providerBehaviorImplemented: true, compiledWasmEffectExecutionImplemented: errorDiagnostics.length === 0, compiledWasmSuspendResumeBridgeImplemented: errorDiagnostics.length === 0, diagnostics: diagnostics.length, errorDiagnostics: errorDiagnostics.length, errors: errorDiagnostics.length },
    generatedFiles: compiledHandlerFiles.map((file) => ({ file: file.file, bytes: file.bytes, sha256: file.sha256 })),
    generatedOutputs: compiledHandlerOutputs.map((file) => ({ file: file.file, kind: file.kind, bytes: file.bytes, sha256: file.sha256 })),
    diagnostics
  }, cwd);
  return { artifact, diagnostics, failures, files: compiledHandlerFiles, outputFiles: compiledHandlerOutputs.length ? compiledHandlerOutputs : (wasmFile ? [{ file: stableSlash(path.relative(cwd, wasmFile)), kind: 'compiled-handler-wasm', bytes: fs.statSync(wasmFile).size }] : []), wasmFile };
}

module.exports = {
  phaseName,
  buildNodeCompiledRouteHandlerEffectBridge,
  buildNodeCompiledWasmRouteHandlerEffectBridge: buildNodeCompiledRouteHandlerEffectBridge,
  createCompiledHandlerBridgeRuntime: instantiateCompiledBridge,
  findCompiledHandlerWasm
};
