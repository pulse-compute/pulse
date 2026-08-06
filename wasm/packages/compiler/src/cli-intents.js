'use strict';

const CLI_INTENT_VERSION = 'pulsewasm.cli-intent.v1';
const CLI_DOCTOR_VERSION = 'pulsewasm.cli-doctor.v1';
const CLI_EXPLAIN_VERSION = 'pulsewasm.cli-explain.v1';
const CLI_ARTIFACTS_VERSION = 'pulsewasm.cli-artifacts.v1';


function loadDoctorReadinessAggregatorContract() {
  try {
    return require('@pulse-compute/wasm-contracts/handler/doctor-readiness-aggregator');
  } catch (_) {
    return require('../../contracts/src/handler/doctor-readiness-aggregator.js');
  }
}

const { DOCTOR_READINESS_AGGREGATOR_VERSION } = loadDoctorReadinessAggregatorContract();

const INTENT_COMMANDS = ['build', 'plan', 'doctor', 'explain', 'artifacts', 'resolve-config'];
const PLAN_DEFAULT_FEATURES = ['routes', 'libraries', 'assets', 'route-context', 'route-effects', 'handler-io', 'request-json', 'schema-decode-result', 'schema-response-codec', 'backend-json-request-body'];
const DOCTOR_DEFAULT_FEATURES = ['routes', 'libraries', 'assets', 'route-context', 'route-effects', 'handler-io', 'request-json', 'schema-decode-result', 'schema-response-codec', 'backend-json-request-body'];

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function pushUnique(list, values) {
  for (const value of values) {
    if (!list.includes(value)) list.push(value);
  }
  return list;
}

function normalizeFeatureName(feature) {
  return String(feature || '').trim().toLowerCase().replace(/_/g, '-');
}

function enableDispatch(args) {
  args.emitDispatchTs = true;
}

function enableHandlerBindings(args) {
  args.emitHandlerBindings = true;
  enableDispatch(args);
}

function enableExecutionHarness(args) {
  args.emitExecutionHarness = true;
  enableHandlerBindings(args);
}

function enableAsShape(args) {
  args.emitAssemblyScriptShape = true;
}

function enableAsCore(args) {
  args.emitAssemblyScriptCore = true;
  enableAsShape(args);
}

function enableHostAbi(args) {
  args.emitWasmHostAbi = true;
}

function enableJsonBody(args) {
  args.emitJsonBody = true;
  args.emitRequestResultHeaders = true;
  enableHostAbi(args);
}

function enableLibraries(args) {
  args.emitHandlerLibraryContracts = true;
}

function enableAssets(args) {
  args.emitAssetsLoweringPlan = true;
  enableLibraries(args);
}

function enableHostCapabilities(args) {
  args.emitHostCapabilities = true;
  enableLibraries(args);
  args.emitRequestResultHeaders = true;
  args.emitChannelBroadcaster = true;
  enableJsonBody(args);
  args.emitBackendCapabilities = true;
}

function enableEffects(args) {
  args.emitEffectComposition = true;
  args.emitEffectRuntime = true;
  args.emitRouteHandlerEffectPlan = true;
  enableHostCapabilities(args);
}

function enableRouteHandlerContextLowering(args) {
  args.emitRouteHandlerContextLoweringPlan = true;
}

function enableRouteHandlerEffects(args) {
  args.emitRouteHandlerContextLoweringPlan = true;
  args.emitRouteHandlerEffectPlan = true;
  args.emitEffectComposition = true;
  args.emitEffectRuntime = true;
}

function enableHandlerIoLifecycle(args) {
  args.emitHandlerIoLifecyclePlan = true;
  enableRouteHandlerEffects(args);
}

function enableRequestJsonBody(args) {
  args.emitRequestJsonBodyPlan = true;
  enableJsonBody(args);
  enableRouteHandlerContextLowering(args);
}


function enableSchemaDecodeResult(args) {
  args.emitSchemaDecodeResultPlan = true;
  enableRequestJsonBody(args);
}

function enableNodeSchemaDecodeResultProof(args) {
  args.emitNodeSchemaDecodeResultProof = true;
  enableSchemaDecodeResult(args);
  enableRouteHandlerEffects(args);
  enableCompiledHandlers(args);
}

function enableSchemaResponseCodec(args) {
  args.emitSchemaResponseCodecPlan = true;
  enableSchemaDecodeResult(args);
  enableRouteHandlerEffects(args);
}

function enableNodeSchemaResponseCodecProof(args) {
  args.emitNodeSchemaResponseCodecProof = true;
  enableSchemaResponseCodec(args);
  enableCompiledHandlers(args);
}

function enableBackendJsonRequestBody(args) {
  args.emitBackendJsonRequestBodyPlan = true;
  enableSchemaResponseCodec(args);
  enableRouteHandlerEffects(args);
}

function enableNodeBackendJsonRequestBodyProof(args) {
  args.emitNodeBackendJsonRequestBodyProof = true;
  enableBackendJsonRequestBody(args);
}

function enableNodeRequestJsonBodyProof(args) {
  args.emitNodeRequestJsonBodyProof = true;
  enableRequestJsonBody(args);
  enableRouteHandlerEffects(args);
  enableCompiledHandlers(args);
}

function enableNodeRouteHandlerEffectProof(args) {
  args.emitNodeRouteHandlerEffectProof = true;
  enableRouteHandlerEffects(args);
}

function enableNodeLiveOriginRouteHandlerEffectProof(args) {
  args.emitNodeLiveOriginRouteHandlerEffectProof = true;
  enableRouteHandlerEffects(args);
}

function enableNodeCompiledRouteHandlerEffectBridge(args) {
  args.emitNodeCompiledRouteHandlerEffectBridge = true;
  enableRouteHandlerEffects(args);
  enableCompiledHandlers(args);
}

function enableFastlyRouteHandlerEffectProof(args) {
  args.emitFastlyRouteHandlerEffectProof = true;
  enableRouteHandlerEffects(args);
}

function enableFastlyLifecycleParityProof(args) {
  args.emitFastlyLifecycleParityProof = true;
  enableBackendJsonRequestBody(args);
  enableHandlerIoLifecycle(args);
}

function enableSchema(args) {
  args.emitSchemaJsonSidecar = true;
  enableJsonBody(args);
}

function enableSchemaJsonGenericParser(args) {
  args.emitSchemaJsonGenericParser = true;
  enableJsonBody(args);
}

function enableStreaming(args) {
  args.emitStreamingPassthrough = true;
  args.emitNodeAdapter = true;
  args.emitHostRuntimeKernel = true;
  args.emitWasmHostBridge = true;
  enableHostAbi(args);
  args.emitRequestResultHeaders = true;
  args.emitChannelBroadcaster = true;
  args.emitBackendCapabilities = true;
  enableJsonBody(args);
  enableAsCore(args);
}

function enableCompiledHandlers(args) {
  args.emitCompiledHandlers = true;
  enableRouteHandlerContextLowering(args);
  enableAsCore(args);
}

function enableNodeAdapter(args) {
  args.emitNodeAdapter = true;
  args.emitHostRuntimeKernel = true;
  args.emitWasmHostBridge = true;
  enableHostAbi(args);
  enableAsCore(args);
  enableJsonBody(args);
  args.emitBackendCapabilities = true;
  args.emitChannelBroadcaster = true;
}

function enableFastlyReadiness(args) {
  args.emitFastlyReadiness = true;
  args.emitPulseWrapper = true;
  args.emitCompiledWasmRuntime = true;
  args.emitIntegratedCompiledApp = true;
  enableAsCore(args);
  enableSchema(args);
  args.emitLibrarySidecars = true;
  enableLibraries(args);
  enableHostAbi(args);
  enableHostCapabilities(args);
  enableEffects(args);
}

function enableAssetsCompiledWasmSidecar(args) {
  args.emitAssetsCompiledWasmSidecarPlan = true;
  enableAssets(args);
}

function enableAssetsSidecarCompileLinkProof(args) {
  args.emitAssetsSidecarCompileLinkProof = true;
  enableAssetsCompiledWasmSidecar(args);
}

function enableNodeAssetsProof(args) {
  args.emitNodeAssetsProviderProof = true;
  enableAssets(args);
}

function enableNodeCompiledWasmAssetsLifecycleProof(args) {
  args.emitNodeCompiledWasmAssetsLifecycleProof = true;
  enableAssetsCompiledWasmSidecar(args);
}

function enableFastlyAssetsProof(args) {
  args.emitFastlyAssetsProviderProof = true;
  enableAssets(args);
}

function enableFastlyAssetsPackageOutParityProof(args) {
  args.emitFastlyAssetsPackageOutParityProof = true;
  enableFastlyAssetsProof(args);
  enableAssetsCompiledWasmSidecar(args);
}

function enableDoctorReadiness(args) {
  enableHandlerIoLifecycle(args);
  enableNodeBackendJsonRequestBodyProof(args);
  enableFastlyLifecycleParityProof(args);
  enableAssetsSidecarCompileLinkProof(args);
  enableNodeCompiledWasmAssetsLifecycleProof(args);
  enableFastlyAssetsProof(args);
}


const FEATURE_ENABLERS = {
  routes() {},
  route() {},
  ast(args) { args.includeAst = true; },
  dispatch: enableDispatch,
  'dispatch-ts': enableDispatch,
  handlers: enableHandlerBindings,
  'handler-bindings': enableHandlerBindings,
  harness: enableExecutionHarness,
  'execution-harness': enableExecutionHarness,
  libraries: enableLibraries,
  library: enableLibraries,
  'library-contracts': enableLibraries,
  assets: enableAssets,
  'assets-plan': enableAssets,
  'assets-compiled-wasm-sidecar': enableAssetsCompiledWasmSidecar,
  'assets-compiled-wasm-sidecar-plan': enableAssetsCompiledWasmSidecar,
  'assets-sidecar': enableAssetsCompiledWasmSidecar,
  'assets-sidecar-plan': enableAssetsCompiledWasmSidecar,
  'assets-sidecar-compile-link': enableAssetsSidecarCompileLinkProof,
  'assets-sidecar-compile-link-proof': enableAssetsSidecarCompileLinkProof,
  'assets-sidecar-link-proof': enableAssetsSidecarCompileLinkProof,
  host: enableHostCapabilities,
  'host-capabilities': enableHostCapabilities,
  effects: enableEffects,
  effect: enableEffects,
  'effect-composition': enableEffects,
  'route-context': enableRouteHandlerContextLowering,
  'route-handler-context': enableRouteHandlerContextLowering,
  'route-handler-context-lowering': enableRouteHandlerContextLowering,
  'context-lowering': enableRouteHandlerContextLowering,
  'ctx-lowering': enableRouteHandlerContextLowering,
  'sync-context': enableRouteHandlerContextLowering,
  'route-effects': enableRouteHandlerEffects,
  'route-handler-effects': enableRouteHandlerEffects,
  'route-handler-effect-plan': enableRouteHandlerEffects,
  'ctx-resolve': enableRouteHandlerEffects,
  'fetch-effects': enableRouteHandlerEffects,
  'handler-io': enableHandlerIoLifecycle,
  'handler-io-lifecycle': enableHandlerIoLifecycle,
  'io-lifecycle': enableHandlerIoLifecycle,
  'handler-lifecycle': enableHandlerIoLifecycle,
  'lifecycle': enableHandlerIoLifecycle,
  'request-lifecycle': enableHandlerIoLifecycle,
  'request-json': enableRequestJsonBody,
  'request-json-body': enableRequestJsonBody,
  'request-json-body-plan': enableRequestJsonBody,
  'ctx-req-json': enableRequestJsonBody,
  'lazy-request-json': enableRequestJsonBody,
  'schema-decode': enableSchemaDecodeResult,
  'schema-decode-result': enableSchemaDecodeResult,
  'schema-decode-result-plan': enableSchemaDecodeResult,
  'ctx-req-json-schema': enableSchemaDecodeResult,
  'node-request-json': enableNodeRequestJsonBodyProof,
  'node-request-json-body': enableNodeRequestJsonBodyProof,
  'node-request-json-body-proof': enableNodeRequestJsonBodyProof,
  'node-ctx-req-json-proof': enableNodeRequestJsonBodyProof,
  'node-schema-decode': enableNodeSchemaDecodeResultProof,
  'node-schema-decode-result': enableNodeSchemaDecodeResultProof,
  'node-schema-decode-result-proof': enableNodeSchemaDecodeResultProof,
  'node-ctx-req-json-schema-proof': enableNodeSchemaDecodeResultProof,
  'schema-response': enableSchemaResponseCodec,
  'schema-response-codec': enableSchemaResponseCodec,
  'schema-response-codec-plan': enableSchemaResponseCodec,
  'ctx-result-json-schema': enableSchemaResponseCodec,
  'node-schema-response': enableNodeSchemaResponseCodecProof,
  'node-schema-response-codec': enableNodeSchemaResponseCodecProof,
  'node-schema-response-codec-proof': enableNodeSchemaResponseCodecProof,
  'node-ctx-result-json-schema-proof': enableNodeSchemaResponseCodecProof,
  'backend-json-request-body': enableBackendJsonRequestBody,
  'backend-json-request-body-plan': enableBackendJsonRequestBody,
  'fetch-json-body': enableBackendJsonRequestBody,
  'ctx-fetch-json': enableBackendJsonRequestBody,
  'node-backend-json-request-body': enableNodeBackendJsonRequestBodyProof,
  'node-backend-json-request-body-proof': enableNodeBackendJsonRequestBodyProof,
  'node-fetch-json-body-proof': enableNodeBackendJsonRequestBodyProof,
  'node-route-effects': enableNodeRouteHandlerEffectProof,
  'node-route-handler-effects': enableNodeRouteHandlerEffectProof,
  'node-route-handler-effect-proof': enableNodeRouteHandlerEffectProof,
  'node-ctx-resolve-proof': enableNodeRouteHandlerEffectProof,
  'node-fetch-effects': enableNodeRouteHandlerEffectProof,
  'node-live-origin-route-effects': enableNodeLiveOriginRouteHandlerEffectProof,
  'node-live-origin-route-handler-effects': enableNodeLiveOriginRouteHandlerEffectProof,
  'node-live-origin-route-handler-effect-proof': enableNodeLiveOriginRouteHandlerEffectProof,
  'node-live-origin-ctx-resolve-proof': enableNodeLiveOriginRouteHandlerEffectProof,
  'node-live-origin-fetch-effects': enableNodeLiveOriginRouteHandlerEffectProof,
  'node-compiled-route-effects': enableNodeCompiledRouteHandlerEffectBridge,
  'node-compiled-route-handler-effects': enableNodeCompiledRouteHandlerEffectBridge,
  'node-compiled-route-handler-effect-bridge': enableNodeCompiledRouteHandlerEffectBridge,
  'node-compiled-ctx-resolve-bridge': enableNodeCompiledRouteHandlerEffectBridge,
  'node-compiled-fetch-effects': enableNodeCompiledRouteHandlerEffectBridge,
  'fastly-route-effects': enableFastlyRouteHandlerEffectProof,
  'fastly-route-handler-effects': enableFastlyRouteHandlerEffectProof,
  'fastly-route-handler-effect-proof': enableFastlyRouteHandlerEffectProof,
  'fastly-ctx-resolve-proof': enableFastlyRouteHandlerEffectProof,
  'fastly-fetch-effects': enableFastlyRouteHandlerEffectProof,
  'fastly-lifecycle-parity': enableFastlyLifecycleParityProof,
  'fastly-lifecycle-parity-proof': enableFastlyLifecycleParityProof,
  'fastly-provider-lifecycle': enableFastlyLifecycleParityProof,
  'fastly-reference-lifecycle': enableFastlyLifecycleParityProof,
  schema: enableSchema,
  'schema-json': enableSchema,
  'schema-json-generic-parser': enableSchemaJsonGenericParser,
  'schema-json-parser': enableSchemaJsonGenericParser,
  'schema-json-generic': enableSchemaJsonGenericParser,
  'schema-generic-parser': enableSchemaJsonGenericParser,
  'generic-json': enableSchemaJsonGenericParser,
  'generic-json-parser': enableSchemaJsonGenericParser,
  'as-json-parser': enableSchemaJsonGenericParser,
  streaming: enableStreaming,
  stream: enableStreaming,
  'node-adapter': enableNodeAdapter,
  'fastly-readiness': enableFastlyReadiness,
  compiled: enableCompiledHandlers,
  'compiled-handlers': enableCompiledHandlers,
  'node-assets-proof': enableNodeAssetsProof,
  'node-assets-provider-proof': enableNodeAssetsProof,
  'node-compiled-wasm-assets-lifecycle': enableNodeCompiledWasmAssetsLifecycleProof,
  'node-compiled-wasm-assets-lifecycle-proof': enableNodeCompiledWasmAssetsLifecycleProof,
  'node-compiled-assets-proof': enableNodeCompiledWasmAssetsLifecycleProof,
  'node-assets-compiled-wasm': enableNodeCompiledWasmAssetsLifecycleProof,
  'fastly-assets-proof': enableFastlyAssetsProof,
  'fastly-assets-provider-proof': enableFastlyAssetsProof,
  'fastly-assets-package-out-parity': enableFastlyAssetsPackageOutParityProof,
  'fastly-assets-package-out-parity-proof': enableFastlyAssetsPackageOutParityProof,
  'fastly-assets-package-parity': enableFastlyAssetsPackageOutParityProof,
  'fastly-assets-package-proof': enableFastlyAssetsPackageOutParityProof,
  'doctor-readiness': enableDoctorReadiness,
  'readiness': enableDoctorReadiness,
  'lifecycle-readiness': enableDoctorReadiness,
  'beta-readiness': enableDoctorReadiness,
  'beta-lifecycle-readiness': enableDoctorReadiness
};

function applyFeature(args, feature) {
  const normalized = normalizeFeatureName(feature);
  if (!normalized) return;
  if (normalized === 'none') return;
  if (normalized === 'default' || normalized === 'defaults') {
    const defaults = args.command === 'doctor' ? DOCTOR_DEFAULT_FEATURES : PLAN_DEFAULT_FEATURES;
    applyFeatures(args, defaults);
    return;
  }
  if (normalized === 'all') {
    applyFeatures(args, ['routes', 'libraries', 'assets', 'effects', 'handler-io', 'schema', 'host']);
    return;
  }
  const enable = FEATURE_ENABLERS[normalized];
  if (!enable) {
    throw new Error(`Unknown --features value "${feature}". Known features: ${knownFeatures().join(', ')}`);
  }
  enable(args);
}

function applyFeatures(args, features) {
  for (const feature of features || []) {
    applyFeature(args, feature);
  }
}

function applyTargetPreset(args) {
  const target = args.targetIntent ? String(args.targetIntent).toLowerCase() : undefined;
  if (!target) return;
  if (target === 'js' || target === 'javascript') {
    enableDispatch(args);
    return;
  }
  if (target === 'wasm' || target === 'as' || target === 'assemblyscript') {
    enableAsCore(args);
    enableHostAbi(args);
    enableLibraries(args);
    return;
  }
  if (target === 'wasm-smoke' || target === 'compiled-wasm') {
    args.emitWasmSmoke = true;
    args.emitAssemblyScriptCompile = true;
    enableAsCore(args);
    return;
  }
  if (target === 'plan' || target === 'metadata') {
    applyFeatures(args, PLAN_DEFAULT_FEATURES);
    return;
  }
  throw new Error(`Unknown --target value "${args.targetIntent}". Expected js, wasm, wasm-smoke, or plan.`);
}

function applyProviderPreset(args) {
  const provider = args.providerIntent ? String(args.providerIntent).toLowerCase() : undefined;
  if (!provider || provider === 'none') return;
  if (provider === 'node' || provider === 'local') {
    enableHostCapabilities(args);
    return;
  }
  if (provider === 'fastly') {
    enableHostCapabilities(args);
    return;
  }
  throw new Error(`Unknown --provider value "${args.providerIntent}". Expected none, node, local, or fastly.`);
}

function applyIntentDefaults(args) {
  if (args.command === 'plan') {
    applyFeatures(args, PLAN_DEFAULT_FEATURES);
  }
  if (args.command === 'doctor') {
    args.includeAst = true;
    applyFeatures(args, DOCTOR_DEFAULT_FEATURES);
  }
}

function applyCliIntent(args) {
  if (!args || args.command === 'explain' || args.command === 'artifacts' || args.command === 'resolve-config') return args;
  applyIntentDefaults(args);
  applyTargetPreset(args);
  applyProviderPreset(args);
  applyFeatures(args, args.features || []);
  return args;
}

function knownFeatures() {
  return Object.keys(FEATURE_ENABLERS).filter((name) => !['route', 'library', 'effect', 'stream'].includes(name)).sort();
}

function commandSummary(args) {
  return {
    version: CLI_INTENT_VERSION,
    command: args.command || 'build',
    target: args.targetIntent,
    provider: args.providerIntent,
    features: args.features || [],
    defaultsApplied: args.command === 'plan' ? PLAN_DEFAULT_FEATURES : args.command === 'doctor' ? DOCTOR_DEFAULT_FEATURES : []
  };
}

function diagnosticCounts(diagnostics) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  const counts = { total: list.length, error: 0, warning: 0, info: 0 };
  for (const diag of list) {
    const severity = diag.severity || 'error';
    if (counts[severity] === undefined) counts[severity] = 0;
    counts[severity] += 1;
  }
  return counts;
}


function lifecycleName(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.name === 'string') return value.name;
  return undefined;
}

function routeLifecycleSummary(route) {
  const sync = route && route.syncContext || {};
  const requestBody = route && route.requestBody || {};
  const effects = route && route.effects || {};
  const originResponse = route && route.originResponse || {};
  const finalResponse = route && route.finalResponse || {};
  const schema = route && route.schema || {};
  const providerExecution = effects.providerExecution || {};
  return {
    route: `${route.method || 'ANY'} ${route.path || '/'}`,
    handler: route.handlerName,
    syncCtxReads: sync.surfaces || [],
    routeParamsRead: sync.paramsRead || [],
    requestHeadersRead: sync.headersRead || [],
    requestBodyRequirement: requestBody.required ? 'required' : 'none',
    requestBodyModes: requestBody.modes || [],
    schemaDecodeRequirement: (schema.requestDecode || []).length > 0,
    genericJsonParserRequirement: Boolean(schema.genericParserNeeded),
    backendOriginEffects: (effects.backendFetches || []).map((effect) => ({
      name: effect.name || '$default',
      backend: effect.backend,
      method: effect.method || effect.request?.method,
      path: effect.path || effect.request?.path,
      bodyMode: effect.bodyMode || effect.requestBody?.mode || 'none'
    })),
    continuationHandler: (effects.resolveBoundaries || []).map((resolve) => lifecycleName(resolve.continuation)).filter(Boolean)[0],
    resolvedResponseReads: originResponse.reads || [],
    resolvedResponseModes: originResponse.modes || [],
    finalResponseEncoding: finalResponse.encodes || [],
    finalResponseModes: finalResponse.modes || [],
    reservedPayloadModes: route.reserved || {},
    providerReadiness: {
      node: providerExecution.nodeProofAvailable ? 'proof-available' : (effects.required ? 'planned' : 'not-required'),
      fastly: providerExecution.fastlyProofAvailable ? 'proof-available' : (effects.required ? 'planned' : 'not-required')
    },
    compiledWasmReadiness: providerExecution.compiledWasmSuspendResumeBridgeImplemented ? 'ready' : (effects.required ? 'planned' : 'not-required'),
    diagnostics: route.diagnostics || []
  };
}


function assetsDoctorSummary(result) {
  const plan = result && result.assetsLoweringPlan && result.assetsLoweringPlan.artifact;
  if (!plan) return undefined;
  const compilerBuilder = plan.policy && plan.policy.compilerBuilder || {};
  const sidecarCompileLinked = Boolean(result.assetsSidecarCompileLinkProof && result.assetsSidecarCompileLinkProof.artifact && result.assetsSidecarCompileLinkProof.artifact.summary && result.assetsSidecarCompileLinkProof.artifact.summary.linkedModuleExecuted === true);
  const nodeCompiledReady = Boolean(result.nodeCompiledWasmAssetsLifecycleProof && result.nodeCompiledWasmAssetsLifecycleProof.artifact && result.nodeCompiledWasmAssetsLifecycleProof.artifact.compiledWasmRuntimeBehaviorImplemented === true);
  const fastlyParity = result.fastlyAssetsPackageOutParityProof && result.fastlyAssetsPackageOutParityProof.artifact;
  const fastlyCompiledReadiness = fastlyParity && fastlyParity.compiledWasmAssetsReadiness ? fastlyParity.compiledWasmAssetsReadiness : 'plan-only';
  let compiledWasmReadiness = 'not-ready-until-assets-compiled-wasm-sidecar-lifecycle';
  if (nodeCompiledReady && fastlyCompiledReadiness === 'plan-only') compiledWasmReadiness = 'node-ready-fastly-plan-only';
  else if (nodeCompiledReady) compiledWasmReadiness = 'node-ready-fastly-classified-on-request';
  else if (result.assetsCompiledWasmSidecarPlan) compiledWasmReadiness = 'sidecar-ready-provider-lifecycle-next';
  return {
    version: 'pulsewasm.doctor-assets-package.v1',
    sourceArtifact: 'assets-lowering-plan.json',
    status: plan.status || 'unknown',
    package: plan.npmPackage,
    lowerableSubpath: plan.lowerableSubpath,
    compilerBuilder: {
      owner: plan.policy && plan.policy.builderOwner,
      entry: compilerBuilder.entry,
      export: compilerBuilder.export,
      trust: compilerBuilder.trust
    },
    packageIdentityOwnedByManifest: Boolean(plan.policy && plan.policy.packageIdentityOwnedByManifest),
    compilerOwnsPackageMapping: Boolean(plan.policy && plan.policy.compilerOwnsPackageMapping),
    summary: plan.summary || {},
    authoringAlignment: plan.authoringAlignment || {
      routeMethodConsistency: true,
      entriesChecked: 0,
      mismatches: 0
    },
    providerReadiness: {
      node: result.nodeAssetsProviderProof ? 'proof-available' : 'provider-proof-available-on-request',
      fastly: result.fastlyAssetsProviderProof ? 'proof-available' : 'provider-proof-available-on-request',
      nodeCompiledWasm: nodeCompiledReady ? 'ready-narrow-terminal-get-head-text' : (result.assetsCompiledWasmSidecarPlan ? 'sidecar-ready-provider-lifecycle-next' : 'not-ready'),
      fastlyCompiledWasm: fastlyCompiledReadiness,
      streamCompiledWasm: 'plan-only',
      binary: 'reserved'
    },
    compiledWasmReadiness,
    providerCompiledWasmReadiness: {
      node: nodeCompiledReady ? 'implemented-narrow' : (result.assetsCompiledWasmSidecarPlan ? 'sidecar-ready-provider-lifecycle-next' : 'not-ready'),
      fastly: fastlyCompiledReadiness,
      stream: 'plan-only',
      binary: 'reserved'
    },
    compiledWasmSidecarPlan: result.assetsCompiledWasmSidecarPlan ? {
      sourceArtifact: 'assets-compiled-wasm-sidecar-plan.json',
      summary: result.assetsCompiledWasmSidecarPlan.artifact.summary
    } : undefined,
    sidecarCompileLinkProof: result.assetsSidecarCompileLinkProof ? {
      sourceArtifact: 'assets-sidecar-compile-link-proof.json',
      summary: result.assetsSidecarCompileLinkProof.artifact.summary,
      linkedModuleExecuted: sidecarCompileLinked
    } : undefined,
    fastlyPackageOutParity: fastlyParity ? {
      sourceArtifact: 'fastly-assets-package-out-parity-proof.json',
      compiledWasmAssetsReadiness: fastlyParity.compiledWasmAssetsReadiness,
      diagnostic: fastlyParity.compiledWasmPlanOnlyDiagnostic
    } : undefined
  };
}

function lifecycleDoctorSummary(result) {
  const lifecycle = result && result.handlerIoLifecyclePlan && result.handlerIoLifecyclePlan.artifact;
  if (!lifecycle || !Array.isArray(lifecycle.routes)) return undefined;
  return {
    version: 'pulsewasm.doctor-handler-io-lifecycle.v1',
    sourceArtifact: lifecycle.artifact || 'handler-io-lifecycle-plan.json',
    status: lifecycle.status || 'unknown',
    summary: lifecycle.summary || {},
    lazyEvaluation: lifecycle.lazyEvaluation || {},
    routes: lifecycle.routes.map(routeLifecycleSummary)
  };
}


function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function artifactPresent(result, key) {
  return Boolean(result && result[key] && result[key].artifact && (result[key].artifact.status || 'ok') === 'ok');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function assetEntriesByRoute(result) {
  const out = new Map();
  const plan = result && result.assetsLoweringPlan && result.assetsLoweringPlan.artifact;
  const entries = Array.isArray(plan && plan.entries) ? plan.entries : [];
  for (const entry of entries) {
    const routes = entry && entry.routeAlignment && Array.isArray(entry.routeAlignment.routes) ? entry.routeAlignment.routes : [];
    for (const route of routes) {
      const key = route.route || `${String(route.method || entry.lookup?.method || 'GET').toUpperCase()} ${route.path || entry.lookup?.key || '/'}`;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(entry);
    }
  }
  return out;
}

function providerProofSources(result) {
  return {
    handlerIoLifecyclePlan: artifactPresent(result, 'handlerIoLifecyclePlan'),
    nodeRouteHandlerEffectProof: artifactPresent(result, 'nodeRouteHandlerEffectProof'),
    nodeLiveOriginRouteHandlerEffectProof: artifactPresent(result, 'nodeLiveOriginRouteHandlerEffectProof'),
    nodeCompiledRouteHandlerEffectBridge: artifactPresent(result, 'nodeCompiledRouteHandlerEffectBridge'),
    nodeBackendJsonRequestBodyProof: artifactPresent(result, 'nodeBackendJsonRequestBodyProof'),
    fastlyLifecycleParityProof: artifactPresent(result, 'fastlyLifecycleParityProof'),
    assetsLoweringPlan: artifactPresent(result, 'assetsLoweringPlan'),
    assetsCompiledWasmSidecarPlan: artifactPresent(result, 'assetsCompiledWasmSidecarPlan'),
    assetsSidecarCompileLinkProof: artifactPresent(result, 'assetsSidecarCompileLinkProof'),
    nodeCompiledWasmAssetsLifecycleProof: artifactPresent(result, 'nodeCompiledWasmAssetsLifecycleProof'),
    fastlyAssetsPackageOutParityProof: artifactPresent(result, 'fastlyAssetsPackageOutParityProof')
  };
}

function sourceArtifactNames(sources) {
  const names = {
    handlerIoLifecyclePlan: 'handler-io-lifecycle-plan.json',
    nodeRouteHandlerEffectProof: 'node-route-handler-effect-proof.json',
    nodeLiveOriginRouteHandlerEffectProof: 'node-live-origin-route-handler-effect-proof.json',
    nodeCompiledRouteHandlerEffectBridge: 'node-compiled-route-handler-effect-bridge.json',
    nodeBackendJsonRequestBodyProof: 'node-backend-json-request-body-proof.json',
    fastlyLifecycleParityProof: 'fastly-lifecycle-parity-proof.json',
    assetsLoweringPlan: 'assets-lowering-plan.json',
    assetsCompiledWasmSidecarPlan: 'assets-compiled-wasm-sidecar-plan.json',
    assetsSidecarCompileLinkProof: 'assets-sidecar-compile-link-proof.json',
    nodeCompiledWasmAssetsLifecycleProof: 'node-compiled-wasm-assets-lifecycle-proof.json',
    fastlyAssetsPackageOutParityProof: 'fastly-assets-package-out-parity-proof.json'
  };
  return Object.entries(sources).filter(([, present]) => present).map(([key]) => names[key] || key);
}

function routeReadinessForDoctor(route, assetEntries, sources) {
  const backendEffects = asArray(route.backendOriginEffects);
  const hasBackendEffects = backendEffects.length > 0;
  const hasPostJsonBackend = backendEffects.some((effect) => String(effect.method || '').toUpperCase() === 'POST' && effect.bodyMode === 'json');
  const hasAssetEffects = assetEntries.length > 0;
  const effectKinds = [];
  if (hasBackendEffects) effectKinds.push('backend-origin-fetch');
  if (hasPostJsonBackend) effectKinds.push('backend-json-request-body');
  if (hasAssetEffects) effectKinds.push('assets-terminal-response');
  if (effectKinds.length === 0) effectKinds.push('sync-result');

  const diagnostics = [];
  if (hasPostJsonBackend) diagnostics.push('PULSEWASM_FASTLY_POST_JSON_BODY_PLAN_ONLY');
  if (hasAssetEffects) diagnostics.push('PULSEWASM_FASTLY_ASSETS_COMPILED_WASM_PLAN_ONLY');

  const node = {
    routeHandlerEffects: 'not-required',
    liveOrigin: 'not-required',
    compiledWasm: 'not-required',
    assetsCompiledWasm: 'not-required',
    backendJsonRequestBodies: 'not-required',
    requestJsonDecode: route.requestBodyRequirement === 'required' ? 'implemented-lazy' : 'not-required'
  };
  const fastly = {
    routeHandlerEffects: 'not-required',
    compiledWasm: 'not-required',
    assetsCompiledWasm: 'not-required',
    backendJsonRequestBodies: 'not-required'
  };

  if (hasBackendEffects) {
    node.routeHandlerEffects = sources.nodeLiveOriginRouteHandlerEffectProof ? 'implemented-live-origin-proof' : (sources.nodeRouteHandlerEffectProof ? 'provider-proof' : 'planned');
    node.liveOrigin = sources.nodeLiveOriginRouteHandlerEffectProof ? 'implemented' : 'proof-available-on-request';
    node.compiledWasm = sources.nodeCompiledRouteHandlerEffectBridge ? 'implemented-resolve-resume-bridge' : 'available-via-reference-golden-split-proof';
    fastly.routeHandlerEffects = sources.fastlyLifecycleParityProof ? 'symbolic-parity' : 'symbolic-parity-available-on-request';
    fastly.compiledWasm = 'symbolic-parity-or-plan-only';
  }
  if (hasPostJsonBackend) {
    node.backendJsonRequestBodies = sources.nodeBackendJsonRequestBodyProof ? 'implemented-node-proof' : 'implemented-in-reference-golden-split-proof';
    fastly.backendJsonRequestBodies = 'plan-only';
  }
  if (hasAssetEffects) {
    node.assetsCompiledWasm = sources.nodeCompiledWasmAssetsLifecycleProof ? 'implemented-narrow-terminal-get-head-text' : (sources.assetsCompiledWasmSidecarPlan ? 'sidecar-ready-provider-lifecycle-next' : 'planned');
    node.compiledWasm = node.assetsCompiledWasm;
    fastly.assetsCompiledWasm = 'plan-only';
    fastly.compiledWasm = 'plan-only';
  }
  if (!hasBackendEffects && !hasAssetEffects) {
    node.routeHandlerEffects = 'ready-no-host-effects';
    node.compiledWasm = 'ready-no-host-effects';
    fastly.routeHandlerEffects = 'ready-no-host-effects';
    fastly.compiledWasm = 'ready-no-host-effects';
  }

  const readiness = hasAssetEffects
    ? 'node-ready-fastly-plan-only'
    : (hasBackendEffects ? 'node-ready-fastly-symbolic-or-plan-only' : 'ready-no-host-effects');

  return {
    route: route.route,
    handler: route.handler,
    lifecycleKind: hasAssetEffects ? 'terminal-package-effect' : (hasBackendEffects ? 'backend-origin-continuation' : 'sync-result'),
    readiness,
    effectKinds,
    lifecycle: {
      syncCtxReads: route.syncCtxReads || [],
      requestBody: route.requestBodyRequirement,
      schemaDecode: route.schemaDecodeRequirement ? 'required' : 'not-required',
      genericJsonParser: route.genericJsonParserRequirement ? 'explicitly-configured' : 'not-required',
      backendEffects,
      assetEffects: assetEntries.map((entry) => ({
        id: entry.id,
        store: entry.lookup && entry.lookup.store,
        key: entry.lookup && entry.lookup.key,
        method: entry.lookup && entry.lookup.method,
        payloadMode: entry.lookup && entry.lookup.payloadMode,
        routeAlignment: entry.routeAlignment && entry.routeAlignment.status
      })),
      continuation: route.continuationHandler || null,
      finalResponseModes: route.finalResponseModes || []
    },
    node: {
      ...node,
      compiledWasmResolveResume: hasBackendEffects ? (sources.nodeCompiledRouteHandlerEffectBridge ? 'implemented' : 'implemented-in-reference-golden-split-proof') : 'not-required',
      backendJsonRequestBodies: hasPostJsonBackend ? node.backendJsonRequestBodies : node.backendJsonRequestBodies
    },
    fastly: {
      ...fastly,
      postJsonRequestBodies: hasPostJsonBackend ? fastly.backendJsonRequestBodies : 'not-required'
    },
    backendReadiness: hasBackendEffects ? {
      node: node.routeHandlerEffects,
      nodePostJson: hasPostJsonBackend ? node.backendJsonRequestBodies : 'not-required',
      fastly: fastly.routeHandlerEffects,
      fastlyPostJson: hasPostJsonBackend ? fastly.backendJsonRequestBodies : 'not-required',
      compiledWasm: node.compiledWasm
    } : undefined,
    assetsReadiness: hasAssetEffects ? {
      entries: assetEntries.map((entry) => ({
        id: entry.id,
        store: entry.lookup && entry.lookup.store,
        key: entry.lookup && entry.lookup.key,
        method: entry.lookup && entry.lookup.method,
        payloadMode: entry.lookup && entry.lookup.payloadMode,
        routeAlignment: entry.routeAlignment && entry.routeAlignment.status
      })),
      node: node.assetsCompiledWasm,
      fastly: fastly.assetsCompiledWasm,
      streamCompiledWasm: 'plan-only',
      binary: 'reserved'
    } : undefined,
    readiness: hasAssetEffects ? (node.assetsCompiledWasm === 'implemented-narrow-terminal-get-head-text' ? 'node-ready-fastly-plan-only' : 'sidecar-ready') : (hasBackendEffects ? 'split-proof-ready' : 'ready-sync'),
    diagnostics: Array.from(new Set([...(route.diagnostics || []), ...diagnostics]))
  };
}

function packageReadinessForDoctor(assetsPackage, sources) {
  if (!assetsPackage) return [];
  return [{
    package: assetsPackage.package,
    lowerableSubpath: assetsPackage.lowerableSubpath,
    compilerBuilderOwner: assetsPackage.compilerBuilder && assetsPackage.compilerBuilder.owner,
    lowerer: {
      packageOwned: assetsPackage.compilerOwnsPackageMapping === false && assetsPackage.packageIdentityOwnedByManifest === true,
      builderOwner: assetsPackage.compilerBuilder && assetsPackage.compilerBuilder.owner,
      packageOutDiscovery: 'validated-by-assets-package-out-proof'
    },
    packageOwnedLowering: assetsPackage.compilerOwnsPackageMapping === false && assetsPackage.packageIdentityOwnedByManifest === true,
    packageOutDiscovery: 'validated-by-assets-package-out-proof',
    authoringAlignment: assetsPackage.authoringAlignment,
    node: {
      providerProof: sources.nodeCompiledWasmAssetsLifecycleProof ? 'implemented-narrow-terminal-get-head-text' : 'available-on-request',
      compiledWasm: sources.nodeCompiledWasmAssetsLifecycleProof ? 'implemented-narrow-terminal-get-head-text' : (assetsPackage.providerCompiledWasmReadiness && assetsPackage.providerCompiledWasmReadiness.node || 'not-ready')
    },
    fastly: {
      providerProof: 'symbolic-provider-proof',
      compiledWasm: assetsPackage.providerCompiledWasmReadiness && assetsPackage.providerCompiledWasmReadiness.fastly || 'plan-only'
    },
    streamCompiledWasm: assetsPackage.providerCompiledWasmReadiness && assetsPackage.providerCompiledWasmReadiness.stream || 'plan-only',
    binary: assetsPackage.providerCompiledWasmReadiness && assetsPackage.providerCompiledWasmReadiness.binary || 'reserved'
  }];
}

function buildDoctorReadiness({ result, lifecycle, assetsPackage, diagnostics }) {
  const sources = providerProofSources(result);
  const sidecarCompileLinkReadiness = result && result.assetsSidecarCompileLinkProof && result.assetsSidecarCompileLinkProof.artifact && result.assetsSidecarCompileLinkProof.artifact.summary
    ? (result.assetsSidecarCompileLinkProof.artifact.summary.actualAssemblyScriptCompileReadiness || (result.assetsSidecarCompileLinkProof.artifact.summary.linkedModuleExecuted ? 'link-proof-validated' : 'future-proof'))
    : 'future-proof';
  const assetRouteMap = assetEntriesByRoute(result);
  const routes = asArray(lifecycle && lifecycle.routes).map((route) => routeReadinessForDoctor(route, assetRouteMap.get(route.route) || [], sources));
  const backendRoutes = routes.filter((route) => route.effectKinds.includes('backend-origin-fetch'));
  const assetRoutes = routes.filter((route) => route.effectKinds.includes('assets-terminal-response'));
  const planOnly = [];
  if (!sources.nodeCompiledRouteHandlerEffectBridge) planOnly.push({ surface: 'combined beta app unified compiled route bridge', status: 'split-proof-required', reason: 'backend compiled bridge and assets terminal effect proofs are validated separately today' });
  planOnly.push({ surface: 'Fastly backend POST JSON request bodies', status: 'plan-only', diagnostic: 'PULSEWASM_FASTLY_POST_JSON_BODY_PLAN_ONLY' });
  planOnly.push({ surface: 'Fastly compiled-Wasm assets', status: 'plan-only', diagnostic: 'PULSEWASM_FASTLY_ASSETS_COMPILED_WASM_PLAN_ONLY' });
  planOnly.push({ surface: 'compiled-Wasm stream asset bodies', status: 'plan-only' });
  const reserved = [
    'binary bodies',
    'multipart',
    'uploads',
    'async/await',
    'Promise lowering',
    'dynamic backend names',
    'dynamic asset keys',
    'arbitrary object lowering',
    'automatic schema generation'
  ];
  const list = diagnostics?.diagnostics || diagnostics || [];
  const hasErrors = Array.isArray(list) && list.some((diag) => (diag.severity || 'error') === 'error');
  const nodeReadyRoutes = routes.filter((route) => {
    const needsBackend = route.effectKinds.includes('backend-origin-fetch');
    const needsAsset = route.effectKinds.includes('assets-terminal-response');
    const backendReady = !needsBackend || route.node.routeHandlerEffects === 'implemented-live-origin-proof' || route.node.routeHandlerEffects === 'provider-proof' || route.node.routeHandlerEffects === 'planned' || route.node.routeHandlerEffects === 'ready-no-host-effects';
    const assetReady = !needsAsset || route.node.assetsCompiledWasm === 'implemented-narrow-terminal-get-head-text';
    return backendReady && assetReady;
  }).length;

  return {
    version: DOCTOR_READINESS_AGGREGATOR_VERSION,
    status: hasErrors ? 'error' : 'ok',
    source: 'cli-doctor-current-command',
    sourceArtifacts: sourceArtifactNames(sources),
    routeCount: routes.length,
    routes,
    packages: packageReadinessForDoctor(assetsPackage, sources),
    providers: {
      node: {
        backendLifecycle: sources.nodeCompiledRouteHandlerEffectBridge ? 'implemented-compiled-wasm-resolve-resume' : (sources.nodeLiveOriginRouteHandlerEffectProof ? 'implemented-live-origin-proof' : 'implemented-in-reference-golden-split-proof'),
        backendJsonRequestBodies: sources.nodeBackendJsonRequestBodyProof ? 'implemented' : 'implemented-in-reference-golden-split-proof',
        assetsCompiledWasm: sources.nodeCompiledWasmAssetsLifecycleProof ? 'implemented-narrow-terminal-get-head-text' : (sources.assetsCompiledWasmSidecarPlan ? 'sidecar-ready-provider-lifecycle-next' : 'planned'),
        readyRoutes: nodeReadyRoutes
      },
      fastly: {
        backendLifecycle: sources.fastlyLifecycleParityProof ? 'symbolic-parity' : 'symbolic-parity-available-on-request',
        postJsonRequestBodies: 'plan-only',
        assetsCompiledWasm: 'plan-only',
        externalServiceRequired: false,
        classifiedRoutes: routes.filter((route) => route.fastly.compiledWasm !== undefined).length
      }
    },
    providerSummary: undefined,
    authoringSubset: {
      asyncAwait: false,
      promises: false,
      dynamicBackends: false,
      dynamicAssetKeys: false,
      arbitraryObjectLowering: false,
      binaryBodies: false,
      streamBodies: false,
      multipart: false,
      uploads: false
    },
    unsupportedEdges: {
      asyncAwait: false,
      promises: false,
      dynamicBackends: false,
      dynamicAssetKeys: false,
      arbitraryObjectLowering: false,
      automaticSchemaGeneration: false,
      binaryBodies: false,
      streamBodies: false,
      multipart: false,
      uploads: false
    },
    knownBreaks: {
      combinedAppCompiledRouteBridge: 'split-proof-required-assets-handlers-not-yet-in-pass38-compiled-handler-lowerer',
      realAssemblyScriptAssetsSidecarCompileLink: sidecarCompileLinkReadiness,
      fastlyPostJsonRequestBodies: 'plan-only',
      fastlyCompiledWasmAssets: 'plan-only'
    },
    unsupportedModes: {
      binaryBodies: 'reserved',
      streamCompiledWasm: 'plan-only',
      dynamicAssetKeys: 'diagnostic',
      dynamicBackends: 'diagnostic',
      arbitraryObjectLowering: 'diagnostic-or-reserved'
    },
    planOnly,
    planOnlySurfaces: planOnly,
    reserved,
    diagnostics: {
      fastlyPlanOnly: ['PULSEWASM_FASTLY_POST_JSON_BODY_PLAN_ONLY', 'PULSEWASM_FASTLY_ASSETS_COMPILED_WASM_PLAN_ONLY'],
      errors: hasErrors ? 1 : 0
    },
    actionableNextSteps: [
      'Use route rows to see which provider path is implemented, symbolic, or plan-only.',
      'Use package rows to see package-owned lowerer and provider compiled-Wasm readiness.',
      'Use diagnostics and unsupportedEdges before widening the lowerable authoring subset.'
    ],
    summary: {
      routes: routes.length,
      backendRoutes: backendRoutes.length,
      assetRoutes: assetRoutes.length,
      packages: assetsPackage ? 1 : 0,
      packageReadinessEntries: assetsPackage ? 1 : 0,
      nodeImplementedRoutes: nodeReadyRoutes,
      splitProofRequired: !sources.nodeCompiledRouteHandlerEffectBridge,
      nodeBackendLifecycleClassified: true,
      nodeAssetsCompiledWasmClassified: true,
      fastlyLifecycleClassified: true,
      fastlyPlanOnlySurfacesClassified: true,
      unsupportedModesClassified: true,
      routeReadinessAggregated: true,
      packageReadinessAggregated: true,
      providerReadinessAggregated: true,
      assetsSidecarCompileLinkAggregated: sources.assetsSidecarCompileLinkProof === true,
      doctorReadinessAggregator: true,
      productionCompletenessRequired: false,
      errors: hasErrors ? 1 : 0
    }
  };
}

function createDoctorArtifact({ args, diagnostics, result, resolvedConfig }) {
  const list = diagnostics?.diagnostics || [];
  const counts = diagnostics?.counts || diagnosticCounts(list);
  const lifecycle = lifecycleDoctorSummary(result);
  const assetsPackage = assetsDoctorSummary(result);
  const readiness = buildDoctorReadiness({ result, lifecycle, assetsPackage, diagnostics });
  const checks = [
    {
      name: 'config',
      status: resolvedConfig || !args.config ? 'ok' : 'skipped',
      summary: resolvedConfig ? {
        profile: resolvedConfig.profile || resolvedConfig.selectedProfile,
        entry: resolvedConfig.entry,
        rootRouter: resolvedConfig.rootRouter,
        target: resolvedConfig.target
      } : { reason: 'no config supplied' }
    },
    {
      name: 'entry',
      status: result ? 'ok' : 'error',
      summary: result ? { entry: result.summary?.entry, rootRouter: result.summary?.rootRouter } : { entry: args.entry }
    },
    {
      name: 'route-extraction',
      status: result ? 'ok' : 'error',
      summary: result ? {
        routes: result.routePlan?.routes?.length || 0,
        handlers: result.handlerTable?.handlers?.length || 0
      } : undefined
    },
    {
      name: 'diagnostics',
      status: counts.error > 0 ? 'error' : 'ok',
      summary: counts
    },
    {
      name: 'handler-io-lifecycle',
      status: lifecycle ? (lifecycle.status === 'ok' ? 'ok' : 'error') : 'skipped',
      summary: lifecycle ? lifecycle.summary : { reason: 'handler-io lifecycle plan not emitted' }
    },
    {
      name: 'assets-package',
      status: assetsPackage ? (assetsPackage.status === 'ok' ? 'ok' : 'error') : 'skipped',
      summary: assetsPackage ? {
        package: assetsPackage.package,
        lowerableSubpath: assetsPackage.lowerableSubpath,
        compilerBuilder: assetsPackage.compilerBuilder,
        entries: assetsPackage.summary.entries || 0,
        authoringAlignment: assetsPackage.authoringAlignment,
        compilerOwnsPackageMapping: assetsPackage.compilerOwnsPackageMapping,
        compiledWasmReadiness: assetsPackage.compiledWasmReadiness,
        providerCompiledWasmReadiness: assetsPackage.providerCompiledWasmReadiness
      } : { reason: 'assets lowering plan not emitted' }
    },
    {
      name: 'doctor-readiness',
      status: readiness.status === 'ok' ? 'ok' : 'error',
      summary: readiness.summary
    },
    {
      name: 'readiness-aggregation',
      status: readiness.status === 'ok' ? 'ok' : 'error',
      summary: readiness.summary
    },
    {
      name: 'artifact-surface',
      status: 'ok',
      summary: commandSummary(args)
    }
  ];
  return {
    version: CLI_DOCTOR_VERSION,
    status: counts.error > 0 ? 'error' : 'ok',
    command: 'doctor',
    intent: commandSummary(args),
    checks,
    lifecycle,
    assetsPackage,
    readiness,
    diagnostics: list.map((diag) => ({
      code: diag.code,
      severity: diag.severity || 'error',
      message: diag.message,
      hint: diag.hint,
      loc: diag.loc
    }))
  };
}

function groupDiagnostics(envelope) {
  const diagnostics = Array.isArray(envelope?.diagnostics) ? envelope.diagnostics : [];
  const groupsByKey = new Map();
  for (const diag of diagnostics) {
    const key = `${diag.severity || 'error'}:${diag.code || 'PULSEWASM_DIAGNOSTIC'}`;
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, {
        severity: diag.severity || 'error',
        code: diag.code || 'PULSEWASM_DIAGNOSTIC',
        count: 0,
        messages: []
      });
    }
    const group = groupsByKey.get(key);
    group.count += 1;
    const message = diag.message || '';
    if (message && !group.messages.includes(message)) group.messages.push(message);
  }
  return Array.from(groupsByKey.values()).sort((a, b) => {
    const severityRank = { error: 0, warning: 1, info: 2 };
    const ar = severityRank[a.severity] ?? 9;
    const br = severityRank[b.severity] ?? 9;
    if (ar !== br) return ar - br;
    return a.code.localeCompare(b.code);
  });
}

function createExplainArtifact(envelope, source) {
  const groups = groupDiagnostics(envelope);
  return {
    version: CLI_EXPLAIN_VERSION,
    status: envelope?.status || (groups.some((group) => group.severity === 'error') ? 'error' : 'ok'),
    source,
    counts: envelope?.counts || diagnosticCounts(envelope?.diagnostics || []),
    groups
  };
}

function producerForArtifact(fileName) {
  const file = String(fileName || '');
  if (file === 'build-manifest.json' || file === 'diagnostics.json' || file === 'resolved-config.json' || file === 'cli-doctor.json') return '@pulse-compute/wasm-compiler/cli';
  if (file.includes('reference-lifecycle-stabilization-proof')) return '@pulse-compute/wasm-workspace';
  if (file.includes('doctor-readiness-aggregator')) return '@pulse-compute/wasm-workspace';
  if (file.includes('lifecycle-readiness-aggregate')) return '@pulse-compute/wasm-workspace';
  if (file.includes('lifecycle-authoring-alignment')) return '@pulse-compute/wasm-workspace';
  if (file.includes('beta-lifecycle-golden')) return '@pulse-compute/wasm-workspace';
  if (file.includes('handler-io-lifecycle-plan')) return '@pulse-compute/wasm-runtime-core-as';
  if (file.includes('backend-json-request-body-plan')) return '@pulse-compute/wasm-runtime-core-as';
  if (file.includes('node-backend-json-request-body-proof')) return '@pulse-compute/provider-node';
  if (file.includes('schema-response-codec-plan')) return '@pulse-compute/wasm-runtime-core-as';
  if (file.includes('schema-decode-result-plan')) return '@pulse-compute/wasm-runtime-core-as';
  if (file.includes('request-json-body-plan')) return '@pulse-compute/wasm-runtime-core-as';
  if (file.includes('node-schema-response-codec-proof')) return '@pulse-compute/provider-node';
  if (file.includes('node-schema-decode-result-proof')) return '@pulse-compute/provider-node';
  if (file.includes('node-request-json-body-proof')) return '@pulse-compute/provider-node';
  if (file.includes('fastly-assets-package-out-parity-proof')) return '@pulse-compute/provider-fastly';
  if (file.includes('assets-compiled-wasm-sidecar-plan')) return '@pulse-compute/assets';
  if (file.includes('assets-package-out-discovery-proof')) return '@pulse-compute/assets';
  if (file.includes('assets-package-owned-lowering-proof')) return '@pulse-compute/assets';
  if (file.includes('assets-lowering-plan')) return '@pulse-compute/assets';
  if (file.includes('route-handler-context-lowering-plan')) return '@pulse-compute/wasm-runtime-core-as';
  if (file.includes('node-live-origin-route-handler-effect-proof')) return '@pulse-compute/provider-node';
  if (file.includes('node-compiled-route-handler-effect-bridge')) return '@pulse-compute/provider-node';
  if (file.includes('node-route-handler-effect-proof')) return '@pulse-compute/provider-node';
  if (file.includes('fastly-route-handler-effect-proof')) return '@pulse-compute/provider-fastly';
  if (file.includes('route-handler-effect-plan')) return '@pulse-compute/wasm-runtime-core-as';
  if (file.includes('route-handler-context-lowering')) return '@pulse-compute/wasm-runtime-core-as';
  if (file.includes('node-compiled-wasm-assets-lifecycle') || file.includes('node-assets-provider') || file.includes('node-adapter') || file.startsWith('generated/node/')) return '@pulse-compute/provider-node';
  if (file.includes('fastly') || file.startsWith('generated/fastly/')) return '@pulse-compute/provider-fastly';
  if (file.includes('schema-json')) return '@pulse-compute/wasm-schema-json';
  if (file.includes('host') || file.includes('headers') || file.includes('stream') || file.includes('backend-capabilities') || file.includes('json-body')) return '@pulse-compute/wasm-host-runtime';
  if (file.includes('library') || file.includes('capabilities')) return '@pulse-compute/wasm-library-kit';
  if (file.includes('assemblyscript') || file.startsWith('generated/as') || file.includes('compiled-handler')) return '@pulse-compute/wasm-runtime-core-as';
  if (file.includes('route') || file.includes('router') || file.includes('handler') || file.includes('dispatch') || file.includes('execution-plan') || file.includes('symbol-index')) return '@pulse-compute/wasm-compiler';
  return '@pulse-compute/wasm-compiler';
}

function whyForArtifact(fileName) {
  const file = String(fileName || '');
  if (file === 'build-manifest.json') return 'records the build command, selected intent, artifacts, hashes, and status';
  if (file === 'diagnostics.json') return 'records deterministic diagnostics for the selected command';
  if (file === 'cli-doctor.json') return 'summarizes CLI doctor checks and user-actionable status';
  if (file.includes('reference-lifecycle-stabilization-proof')) return 'validates Pass 42 reference lifecycle stabilization, artifact freshness, CLI app-path config discovery, origin coverage, doctor lifecycle output, and schema-origin decode posture';
  if (file.includes('doctor-readiness-aggregator')) return 'validates Pass 53 doctor readiness aggregation across routes, lowerable packages, Node/Fastly provider posture, plan-only surfaces, and explicit beta known breaks';
  if (file.includes('lifecycle-readiness-aggregate')) return 'validates Pass 53 doctor readiness aggregation across routes, lowerable packages, Node/Fastly provider posture, and explicit beta known breaks';
  if (file.includes('lifecycle-authoring-alignment')) return 'validates Pass 52 beta authoring alignment: public router HEAD support, route/effect method consistency, doctor readiness output, and unsupported-edge diagnostics';
  if (file.includes('beta-lifecycle-golden')) return 'validates the Pass 51 beta lifecycle harness across the combined app, reference lifecycle, package-owned assets lowerers, provider readiness, docs, and unsupported-edge posture';
  if (file.includes('handler-io-lifecycle-plan')) return 'unifies route ctx reads, request body posture, backend/origin effects, schema JSON posture, and final response encoding in a plan-only lifecycle artifact';
  if (file.includes('backend-json-request-body-plan')) return 'plans schema-backed JSON request bodies for ctx.fetch backend effects with explicit backend body-mode policy';
  if (file.includes('node-backend-json-request-body-proof')) return 'proves the Node provider sends planned schema-encoded JSON request bodies to a live local origin without arbitrary object lowering';
  if (file.includes('schema-response-codec-plan')) return 'plans schema-backed ctx.result.json("Schema", ref) final response encoding and ctx.resolved(...).json("Schema") origin response decode refs';
  if (file.includes('schema-decode-result-plan')) return 'validates schema-backed ctx.req.json("Schema") / ctx.req.parse("Schema") result accessors against declared schema fields';
  if (file.includes('request-json-body-plan')) return 'plans lazy ctx.req.json/ctx.req.parse request body reads and records schema/generic parser requirements without eager parsing';
  if (file.includes('node-schema-response-codec-proof')) return 'proves the Node compiled-Wasm path can encode final JSON responses from opaque schema/generic decode refs without arbitrary JS object materialization';
  if (file.includes('node-schema-decode-result-proof')) return 'proves the Node compiled-Wasm path exposes schema-backed request JSON decode results with inspectable ok/error/accessor behavior';
  if (file.includes('node-request-json-body-proof')) return 'proves the Node compiled-Wasm path lazily reads/parses request JSON only for routes that use ctx.req.json or ctx.req.parse';
  if (file.includes('fastly-assets-package-out-parity-proof')) return 'validates Fastly consumes the packaged @pulse-compute/assets lowering surface, symbolic store config, GET/HEAD/cache/404 policy, and explicit compiled-Wasm plan-only readiness';
  if (file.includes('assets-compiled-wasm-sidecar-plan')) return 'validates the package-owned @pulse-compute/assets AssemblyScript sidecar declaration, exported symbols, terminal asset-response effect posture, and compiled-Wasm restrictions';
  if (file.includes('assets-package-out-discovery-proof')) return 'proves packaged @pulse-compute/assets is discovered from node_modules with its manifest and package-owned compiler builder, without npm registry or monorepo assets source paths';
  if (file.includes('assets-package-owned-lowering-proof')) return 'proves @pulse-compute/assets owns its PulseWasm lowering builder while library-kit only loads it generically';
  if (file.includes('assets-lowering-plan')) return 'plans lowerable pulse.assets facade usage through the package-owned assets builder without provider-owned behavior';
  if (file.includes('route-handler-context-lowering-plan')) return 'plans synchronous AS-clean ctx lowering for route handlers without provider effect execution';
  if (file.includes('node-live-origin-route-handler-effect-proof')) return 'proves the Node provider can execute planned ctx.fetch effects against a live local HTTP origin and expose ctx.resolved handles without user-authored async';
  if (file.includes('node-compiled-route-handler-effect-bridge')) return 'proves the compiled-Wasm Node bridge can suspend at ctx.resolve, execute live-origin ctx.fetch effects, inject resolved handles, and resume a continuation without async/await';
  if (file.includes('node-route-handler-effect-proof')) return 'proves the Node provider can execute planned ctx.fetch effects and expose ctx.resolved handles without compiled-Wasm suspension';
  if (file.includes('fastly-route-handler-effect-proof')) return 'proves the Fastly provider can execute planned ctx.fetch effects through symbolic backend refs and expose ctx.resolved handles without compiled-Wasm suspension';
  if (file.includes('route-handler-effect-plan')) return 'plans ctx.resolve/ctx.fetch route-handler effect lifecycle without runtime/provider execution';
  if (file.includes('route-handler-context-lowering')) return 'describes the Pass 31 synchronous ctx surface lowerable into AssemblyScript without effect execution';
  if (file.includes('node-compiled-wasm-assets-lifecycle')) return 'proves Node executes package-owned pulse.assets terminal response effects through a compiled WebAssembly boundary';
  if (file.includes('node-assets-provider')) return 'proves the Node provider consumes the assets lowering plan';
  if (file.includes('fastly-assets-provider')) return 'proves the Fastly provider consumes the assets lowering plan';
  if (file.includes('schema-json-generic-parser')) return 'describes the explicit generic AssemblyScript JSON parser fallback for schema-less payloads';
  if (file.includes('schema-json')) return 'describes schema JSON sidecar/parser integration';
  if (file.includes('host') || file.includes('headers') || file.includes('stream')) return 'describes host ABI/runtime bridge behavior';
  if (file.includes('route') || file.includes('router')) return 'describes route extraction and routing metadata';
  if (file.includes('handler')) return 'describes handler table, evaluation, or lowering metadata';
  return 'emitted by the selected PulseWasm command intent';
}

function createArtifactsList(manifest, source) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  return {
    version: CLI_ARTIFACTS_VERSION,
    status: manifest?.status || 'unknown',
    source,
    command: manifest?.command,
    outDir: manifest?.outDir,
    artifactCount: artifacts.length,
    artifacts: artifacts.map((artifact) => ({
      file: artifact.file,
      version: artifact.version,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      producer: producerForArtifact(artifact.file),
      why: whyForArtifact(artifact.file)
    }))
  };
}

module.exports = {
  CLI_INTENT_VERSION,
  CLI_DOCTOR_VERSION,
  CLI_EXPLAIN_VERSION,
  CLI_ARTIFACTS_VERSION,
  INTENT_COMMANDS,
  PLAN_DEFAULT_FEATURES,
  DOCTOR_DEFAULT_FEATURES,
  applyCliIntent,
  commandSummary,
  createArtifactsList,
  createDoctorArtifact,
  createExplainArtifact,
  knownFeatures,
  splitList,
  pushUnique
};
