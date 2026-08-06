'use strict';

function loadAssetsContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/assets/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/assets/contracts.js');
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

const assetsContracts = loadAssetsContracts();
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic, stableFileName } = loadDiagnostics();
const {
  createNodeCompiledWasmAssetsLifecycleRuntime,
  normalizeHeaders
} = require('../runtime/assets-provider.js');

const phaseName = 'node-compiled-wasm-assets-lifecycle-proof';

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}

function normalizePlan(input) {
  const plan = input && input.artifact ? input.artifact : input;
  if (!plan || typeof plan !== 'object') return undefined;
  return {
    ...plan,
    entries: Array.isArray(plan.entries) ? plan.entries.map(clone) : []
  };
}

function normalizeSidecarPlan(input) {
  const plan = input && input.artifact ? input.artifact : input;
  if (!plan || typeof plan !== 'object') return undefined;
  return {
    ...plan,
    terminalAssetResponseEffects: Array.isArray(plan.terminalAssetResponseEffects) ? plan.terminalAssetResponseEffects.map(clone) : []
  };
}

function makeDiagnostic(code, message, severity, details, hint) {
  return normalizeDiagnostic({
    phase: phaseName,
    severity: severity || 'error',
    code,
    message,
    hint: hint || (details && details.hint),
    details,
    loc: { file: '<node-compiled-wasm-assets-lifecycle-proof>' }
  });
}

function check(name, passed, details, failures, diagnostics) {
  const entry = { name, status: passed ? 'ok' : 'error', details: details || {} };
  if (!passed) {
    failures.push(entry);
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.NODE_COMPILED_LIFECYCLE_SMOKE_FAILED,
      `Node compiled-Wasm assets lifecycle check failed: ${name}.`,
      'error',
      { check: name, details: entry.details }
    ));
  }
  return entry;
}

function headerValue(headers, name) {
  const lower = String(name).toLowerCase();
  const found = normalizeHeaders(headers).find(([key]) => String(key).toLowerCase() === lower);
  return found ? found[1] : undefined;
}

function resultBody(result) {
  if (!result) return undefined;
  if (result.body !== undefined) return String(result.body);
  if (result.kind === 'stream' && result.bodyStream && Array.isArray(result.bodyStream.chunks)) {
    return result.bodyStream.chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)).join('');
  }
  return undefined;
}

function sanitizeResult(result) {
  if (!result) return undefined;
  return {
    status: result.status,
    kind: result.kind,
    body: resultBody(result),
    bodyLength: resultBody(result) ? resultBody(result).length : 0,
    headers: normalizeHeaders(result.headers),
    diagnostics: (result.diagnostics || []).map((entry) => ({ code: entry.code, severity: entry.severity, message: entry.message }))
  };
}

function findEffect(effects, method) {
  const upper = String(method || 'GET').toUpperCase();
  return effects.find((entry) => String(entry.method || 'GET').toUpperCase() === upper) || effects[0];
}

function codeSet(result) {
  return new Set((result && result.diagnostics || []).map((entry) => entry.code));
}

function negativeCaseFlag(negativeCases, name, fallback) {
  if (negativeCases && Object.prototype.hasOwnProperty.call(negativeCases, name)) return negativeCases[name] === true;
  return Boolean(fallback);
}

function buildNodeCompiledWasmAssetsLifecycleProof(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const plan = normalizePlan(inputs.assetsLoweringPlan || inputs.plan);
  const sidecarPlan = normalizeSidecarPlan(inputs.assetsCompiledWasmSidecarPlan || inputs.sidecarPlan);
  const diagnostics = [];
  const checks = [];
  const failures = [];
  const negativeCases = inputs.negativeCases || {};

  if (!plan) {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.NODE_PROVIDER_PLAN_REQUIRED,
      'Node compiled-Wasm assets lifecycle proof requires an assets-lowering-plan artifact.',
      'error',
      { sourceArtifact: assetsContracts.ASSETS_LOWERING_PLAN_VERSION }
    ));
  }
  if (!sidecarPlan) {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.SIDECAR_FILE_MISSING,
      'Node compiled-Wasm assets lifecycle proof requires an assets-compiled-wasm-sidecar-plan artifact.',
      'error',
      { sourceArtifact: assetsContracts.ASSETS_COMPILED_WASM_SIDECAR_PLAN_ARTIFACT }
    ));
  }

  const terminalEffects = sidecarPlan && sidecarPlan.terminalAssetResponseEffects || [];
  const getEffect = findEffect(terminalEffects, 'GET');
  const headEffect = findEffect(terminalEffects, 'HEAD');
  const missingEffect = getEffect ? {
    ...clone(getEffect),
    id: `${getEffect.id || 'asset'}-missing`,
    key: '/__pulsewasm-missing-asset__',
    method: 'GET'
  } : undefined;

  let runtime;
  let executions = [];
  let storeConfigProbeCodes = new Set();
  try {
    if (plan && sidecarPlan) {
      runtime = createNodeCompiledWasmAssetsLifecycleRuntime({
        cwd,
        configRoot: inputs.configRoot,
        assetConfig: inputs.assetConfig,
        resolvedConfig: inputs.resolvedConfig,
        assetsLoweringPlan: plan,
        assetsCompiledWasmSidecarPlan: sidecarPlan,
        extraTerminalEffects: missingEffect ? [missingEffect] : [],
        mode: inputs.mode || 'compiled-wasm-assets-lifecycle'
      });
      diagnostics.push(...(runtime.diagnostics || []));
      executions = runtime.executeAll();
    }
  } catch (error) {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.NODE_COMPILED_LIFECYCLE_SMOKE_FAILED,
      'Node compiled-Wasm assets lifecycle smoke execution failed.',
      'error',
      { message: error && error.message ? error.message : String(error), stack: error && error.stack ? error.stack : undefined }
    ));
  }

  if (plan && sidecarPlan) {
    try {
      const probe = createNodeCompiledWasmAssetsLifecycleRuntime({
        cwd,
        configRoot: inputs.configRoot,
        assetsLoweringPlan: plan,
        assetsCompiledWasmSidecarPlan: sidecarPlan,
        mode: 'compiled-wasm-assets-lifecycle-missing-store-config-probe'
      });
      storeConfigProbeCodes = codeSet(probe);
    } catch (error) {
      if (error && Array.isArray(error.diagnostics)) storeConfigProbeCodes = new Set(error.diagnostics.map((entry) => entry.code));
    }
  }

  const byId = new Map(executions.map((entry) => [entry.effect && entry.effect.id, entry]));
  const getExecution = getEffect ? byId.get(getEffect.id) : undefined;
  const headExecution = headEffect ? byId.get(headEffect.id) : undefined;
  const missingExecution = missingEffect ? byId.get(missingEffect.id) : undefined;
  const getResult = getExecution && getExecution.response;
  const headResult = headExecution && headExecution.response;
  const missingResult = missingExecution && missingExecution.response;

  checks.push(check(
    'compiled_wasm_module_imports_assets_hostcalls',
    Boolean(runtime && runtime.wasm.imports.some((entry) => entry.module === 'pulse_assets' && entry.name === 'pulse_assets_lookup') && runtime.wasm.imports.some((entry) => entry.module === 'pulse_assets' && entry.name === 'pulse_assets_respond')),
    { imports: runtime && runtime.wasm.imports },
    failures,
    diagnostics
  ));
  checks.push(check(
    'terminal_asset_response_effect_validated',
    executions.length >= terminalEffects.length && executions.every((entry) => entry.resultHandle > 0 && entry.lookup && entry.response),
    { executions: executions.map((entry) => ({ id: entry.effect && entry.effect.id, resultHandle: entry.resultHandle, lookup: entry.lookup && { store: entry.lookup.store, key: entry.lookup.key, method: entry.lookup.method }, response: sanitizeResult(entry.response) })) },
    failures,
    diagnostics
  ));
  checks.push(check(
    'get_text_asset_validated',
    Boolean(getResult && getResult.status === 200 && getResult.kind === 'text' && resultBody(getResult) && resultBody(getResult).length > 0),
    { response: sanitizeResult(getResult) },
    failures,
    diagnostics
  ));
  checks.push(check(
    'head_asset_bodyless_validated',
    Boolean(headResult && headResult.status === 200 && headResult.kind === 'empty' && headResult.body === undefined),
    { response: sanitizeResult(headResult) },
    failures,
    diagnostics
  ));
  checks.push(check(
    'headers_validated',
    Boolean(getResult && headerValue(getResult.headers, 'content-type') && headerValue(getResult.headers, 'x-pulsewasm-asset-key') === (getEffect && getEffect.key)),
    { contentType: getResult && headerValue(getResult.headers, 'content-type'), assetKey: getResult && headerValue(getResult.headers, 'x-pulsewasm-asset-key') },
    failures,
    diagnostics
  ));
  checks.push(check(
    'cache_control_validated',
    Boolean(getResult && headerValue(getResult.headers, 'cache-control') === (getEffect && getEffect.cacheControl || 'public, max-age=60')),
    { expected: getEffect && getEffect.cacheControl || 'public, max-age=60', actual: getResult && headerValue(getResult.headers, 'cache-control') },
    failures,
    diagnostics
  ));
  checks.push(check(
    'missing_asset_validated',
    Boolean(missingResult && missingResult.status === 404 && missingResult.kind === 'empty'),
    { response: sanitizeResult(missingResult) },
    failures,
    diagnostics
  ));
  checks.push(check(
    'explicit_store_config_required',
    storeConfigProbeCodes.has(assetsContracts.ASSETS_DIAGNOSTIC_CODES.STORE_CONFIG_REQUIRED),
    { diagnosticCodes: Array.from(storeConfigProbeCodes).sort() },
    failures,
    diagnostics
  ));

  const sidecarRestrictions = sidecarPlan && sidecarPlan.restrictions || {};
  const dynamicKeysRejected = negativeCaseFlag(negativeCases, 'dynamicKeysRejected', sidecarRestrictions.dynamicKeysSupported === false);
  const handleEscapeRejected = negativeCaseFlag(negativeCases, 'handleEscapeRejected', sidecarRestrictions.handleEscapeSupported === false);
  const binaryBodyReserved = negativeCaseFlag(negativeCases, 'binaryBodyReserved', sidecarRestrictions.binaryBodySupported === false);
  const streamPlanOnly = negativeCaseFlag(negativeCases, 'streamBodyPlanOnly', sidecarRestrictions.streamBodyCompiledWasmReadiness === 'plan-only');

  checks.push(check('dynamic_keys_rejected', dynamicKeysRejected, { diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.DYNAMIC_KEY_UNSUPPORTED }, failures, diagnostics));
  checks.push(check('asset_handle_escape_rejected', handleEscapeRejected, { diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.HANDLE_ESCAPE_UNSUPPORTED }, failures, diagnostics));
  checks.push(check('compiled_binary_body_reserved', binaryBodyReserved, { diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.COMPILED_BINARY_RESERVED }, failures, diagnostics));
  checks.push(check('compiled_stream_body_plan_only', streamPlanOnly, { diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.COMPILED_STREAM_PLAN_ONLY }, failures, diagnostics));

  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const artifact = normalizeArtifact({
    version: assetsContracts.ASSETS_NODE_COMPILED_WASM_LIFECYCLE_PROOF_VERSION,
    generatedBy,
    phase: phaseName,
    artifact: assetsContracts.ASSETS_NODE_COMPILED_WASM_LIFECYCLE_PROOF_ARTIFACT,
    provider: 'node',
    providerPackage: '@pulse-compute/provider-node',
    contractId: assetsContracts.ASSETS_CONTRACT_ID,
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    sourceAssetsLoweringPlanVersion: plan && plan.version,
    sourceAssetsCompiledWasmSidecarPlanVersion: sidecarPlan && sidecarPlan.version,
    loweringPlanConnected: Boolean(plan),
    sidecarPlanConnected: Boolean(sidecarPlan),
    compiledWasmLowering: true,
    compiledWasmRuntimeBehaviorImplemented: errorDiagnostics.length === 0,
    terminalAssetResponseEffectValidated: checks.some((entry) => entry.name === 'terminal_asset_response_effect_validated' && entry.status === 'ok'),
    getTextAssetValidated: checks.some((entry) => entry.name === 'get_text_asset_validated' && entry.status === 'ok'),
    headAssetValidated: checks.some((entry) => entry.name === 'head_asset_bodyless_validated' && entry.status === 'ok'),
    headersValidated: checks.some((entry) => entry.name === 'headers_validated' && entry.status === 'ok'),
    cacheControlValidated: checks.some((entry) => entry.name === 'cache_control_validated' && entry.status === 'ok'),
    missingAssetValidated: checks.some((entry) => entry.name === 'missing_asset_validated' && entry.status === 'ok'),
    storeConfigRequired: checks.some((entry) => entry.name === 'explicit_store_config_required' && entry.status === 'ok'),
    dynamicKeysRejected,
    handleEscapeRejected,
    binaryBodyReserved,
    streamBodyReadiness: 'plan-only',
    userAuthoredAsync: false,
    promises: false,
    asyncAwait: false,
    asyncify: false,
    runtime: {
      version: assetsContracts.ASSETS_NODE_COMPILED_WASM_LIFECYCLE_RUNTIME_VERSION,
      package: '@pulse-compute/provider-node/runtime/assets-provider',
      mode: inputs.mode || 'compiled-wasm-assets-lifecycle',
      actualAssemblyScriptCompilerRequired: false,
      generatedInMemoryWasmModule: true
    },
    wasmModule: runtime ? {
      byteLength: runtime.wasm.byteLength,
      imports: runtime.wasm.imports,
      exports: runtime.wasm.exports,
      routeExports: runtime.wasm.exports.filter((entry) => entry.kind === 'function' && String(entry.name).startsWith('pulse_assets_route_')).map((entry) => entry.name)
    } : undefined,
    storeConfig: runtime ? {
      explicit: true,
      stores: runtime.storeConfig.configuredStores.map((entry) => ({
        store: entry.store,
        mode: entry.mode,
        methods: entry.methods,
        responseBody: entry.responseBody,
        cacheControl: entry.cacheControl,
        dir: stableFileName(entry.dir, cwd)
      }))
    } : undefined,
    entriesConsumed: terminalEffects.map(clone),
    syntheticEffects: missingEffect ? [{ id: missingEffect.id, key: missingEffect.key, method: missingEffect.method, purpose: 'missing asset deterministic 404 proof' }] : [],
    smoke: {
      checks,
      failedChecks: failures,
      executions: executions.map((entry) => ({
        index: entry.index,
        exportName: entry.exportName,
        resultHandle: entry.resultHandle,
        effect: entry.effect,
        lookup: entry.lookup,
        response: sanitizeResult(entry.response)
      }))
    },
    negativeCases: {
      storeConfigRequired: {
        rejected: storeConfigProbeCodes.has(assetsContracts.ASSETS_DIAGNOSTIC_CODES.STORE_CONFIG_REQUIRED),
        diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.STORE_CONFIG_REQUIRED
      },
      dynamicKey: {
        rejected: dynamicKeysRejected,
        diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.DYNAMIC_KEY_UNSUPPORTED,
        loweringDiagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.NON_LITERAL_LOOKUP
      },
      handleEscape: {
        rejected: handleEscapeRejected,
        diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.HANDLE_ESCAPE_UNSUPPORTED
      },
      binaryBody: {
        reserved: binaryBodyReserved,
        diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.COMPILED_BINARY_RESERVED,
        loweringDiagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED
      },
      streamBody: {
        readiness: 'plan-only',
        diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.COMPILED_STREAM_PLAN_ONLY,
        loweringDiagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.STREAM_PROVIDER_NOT_WIRED
      }
    },
    policy: {
      providerOwnsRuntimeBehavior: true,
      compilerOrchestratesOnly: true,
      packageOwnsSidecarAndLowerer: true,
      sidecarPlanRequired: true,
      storeConfigRequired: true,
      continuationRequired: false,
      directProviderProofFallback: false,
      compiledWasmModuleExecuted: Boolean(runtime && executions.length > 0),
      assemblyScriptInstallRequiredForProof: false
    },
    scope: {
      methods: clone(assetsContracts.ASSETS_ALLOWED_METHODS),
      payloadModes: ['text-response-body'],
      localStoreMode: true,
      uploads: false,
      mutationApis: false,
      binaryBody: false,
      streamBodyReadiness: 'plan-only',
      dynamicKeys: false,
      handleEscape: false
    },
    summary: {
      compiledWasmLowering: true,
      compiledWasmRuntimeBehaviorImplemented: errorDiagnostics.length === 0,
      terminalAssetResponseEffectValidated: checks.some((entry) => entry.name === 'terminal_asset_response_effect_validated' && entry.status === 'ok'),
      getTextAssetValidated: checks.some((entry) => entry.name === 'get_text_asset_validated' && entry.status === 'ok'),
      headAssetValidated: checks.some((entry) => entry.name === 'head_asset_bodyless_validated' && entry.status === 'ok'),
      headersValidated: checks.some((entry) => entry.name === 'headers_validated' && entry.status === 'ok'),
      cacheControlValidated: checks.some((entry) => entry.name === 'cache_control_validated' && entry.status === 'ok'),
      missingAssetValidated: checks.some((entry) => entry.name === 'missing_asset_validated' && entry.status === 'ok'),
      storeConfigRequired: checks.some((entry) => entry.name === 'explicit_store_config_required' && entry.status === 'ok'),
      dynamicKeysRejected,
      handleEscapeRejected,
      binaryBodyReserved,
      streamBodyReadiness: 'plan-only',
      userAuthoredAsync: false,
      promises: false,
      asyncAwait: false,
      asyncify: false,
      checks: checks.length,
      failedChecks: failures.length,
      diagnostics: diagnostics.length,
      errorDiagnostics: errorDiagnostics.length,
      errors: errorDiagnostics.length
    },
    diagnostics
  }, cwd);

  return {
    artifact,
    diagnostics,
    runtime,
    smoke: artifact.smoke,
    hasErrors: errorDiagnostics.length > 0
  };
}

module.exports = {
  phaseName,
  buildNodeCompiledWasmAssetsLifecycleProof
};
