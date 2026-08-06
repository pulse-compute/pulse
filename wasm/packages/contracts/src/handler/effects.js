'use strict';

const ROUTE_HANDLER_EFFECT_PLAN_VERSION = 'pulsewasm.route-handler-effect-plan.v1';
const ROUTE_HANDLER_EFFECT_PLAN_PHASE = '30';
const ROUTE_HANDLER_EFFECT_PLAN_ARTIFACT = 'route-handler-effect-plan.json';
const ROUTE_HANDLER_NODE_EFFECT_PROOF_VERSION = 'pulsewasm.route-handler-node-effect-proof.v1';
const ROUTE_HANDLER_NODE_EFFECT_PROOF_PHASE = '32';
const ROUTE_HANDLER_NODE_EFFECT_PROOF_ARTIFACT = 'node-route-handler-effect-proof.json';
const ROUTE_HANDLER_NODE_EFFECT_RUNTIME_VERSION = 'pulsewasm.route-handler-node-effect-runtime.v1';
const ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_VERSION = 'pulsewasm.route-handler-node-live-origin-effect-proof.v1';
const ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_PHASE = '37';
const ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_ARTIFACT = 'node-live-origin-route-handler-effect-proof.json';
const ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_RUNTIME_VERSION = 'pulsewasm.route-handler-node-live-origin-effect-runtime.v1';
const ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_VERSION = 'pulsewasm.route-handler-node-compiled-effect-bridge.v1';
const ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_PHASE = '38';
const ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_ARTIFACT = 'node-compiled-route-handler-effect-bridge.json';
const ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_RUNTIME_VERSION = 'pulsewasm.route-handler-node-compiled-effect-bridge-runtime.v1';
const ROUTE_HANDLER_FASTLY_EFFECT_PROOF_VERSION = 'pulsewasm.route-handler-fastly-effect-proof.v1';
const ROUTE_HANDLER_FASTLY_EFFECT_PROOF_PHASE = '33';
const ROUTE_HANDLER_FASTLY_EFFECT_PROOF_ARTIFACT = 'fastly-route-handler-effect-proof.json';
const ROUTE_HANDLER_FASTLY_EFFECT_RUNTIME_VERSION = 'pulsewasm.route-handler-fastly-effect-runtime.v1';
const ROUTE_HANDLER_FASTLY_EFFECT_PROVIDER_CONFIG_VERSION = 'pulsewasm.route-handler-fastly-effect-provider-config.v1';
const ROUTE_HANDLER_EFFECT_CONTRACT_ID = 'pulse.route-handler-effects';

const ROUTE_HANDLER_EFFECT_PLAN_SCOPE = Object.freeze({
  planOnly: true,
  runtimeBehaviorChanged: false,
  providerBehaviorImplemented: false,
  compiledWasmEffectExecutionImplemented: false,
  languageLevelAsync: false,
  promises: false,
  asyncAwait: false,
  asyncify: false,
  hiddenScheduler: false
});

const ROUTE_HANDLER_NODE_EFFECT_PROOF_SCOPE = Object.freeze({
  provider: 'node',
  compilerOwnsProviderBehavior: false,
  compilerOrchestrationOnly: true,
  providerBehaviorImplemented: true,
  backendFetchProviderExecutionImplemented: true,
  responseHandleSurfaceImplemented: true,
  continuationContextImplemented: true,
  directProviderSmoke: true,
  routeEffectPlanRequired: true,
  compiledWasmEffectExecutionImplemented: false,
  compiledWasmSuspendResumeBridgeImplemented: false,
  languageLevelAsync: false,
  promises: false,
  asyncAwait: false,
  asyncify: false,
  actualNetworkFetch: false,
  localFixtureFetch: true
});

const ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_SCOPE = Object.freeze({
  provider: 'node',
  compilerOwnsProviderBehavior: false,
  compilerOrchestrationOnly: true,
  providerBehaviorImplemented: true,
  compilerOwnsProviderBehavior: false,
  backendFetchProviderExecutionImplemented: true,
  liveOriginFetchImplemented: true,
  responseHandleSurfaceImplemented: true,
  continuationContextImplemented: true,
  directProviderSmoke: true,
  routeEffectPlanRequired: true,
  compiledWasmEffectExecutionImplemented: false,
  compiledWasmSuspendResumeBridgeImplemented: false,
  languageLevelAsync: false,
  promises: false,
  asyncAwait: false,
  asyncify: false,
  actualNetworkFetch: true,
  localFixtureFetch: false,
  bootstrapOriginRequired: true
});

const ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_SCOPE = Object.freeze({
  provider: 'node',
  compilerOwnsProviderBehavior: false,
  compilerOrchestrationOnly: true,
  providerBehaviorImplemented: true,
  backendFetchProviderExecutionImplemented: true,
  liveOriginFetchImplemented: true,
  responseHandleSurfaceImplemented: true,
  continuationContextImplemented: true,
  routeEffectPlanRequired: true,
  compiledWasmEffectExecutionImplemented: true,
  compiledWasmSuspendResumeBridgeImplemented: true,
  compiledWasmContinuationReentryImplemented: true,
  compiledWasmResolvedHandleInjectionImplemented: true,
  directProviderSmoke: false,
  languageLevelAsync: false,
  promises: false,
  asyncAwait: false,
  asyncify: false,
  actualNetworkFetch: true,
  localFixtureFetch: false,
  bootstrapOriginRequired: true,
  singleEffectGroup: true,
  namedObjectEffectGroup: true,
  arrayEffectGroup: false
});

const ROUTE_HANDLER_FASTLY_EFFECT_PROOF_SCOPE = Object.freeze({
  provider: 'fastly',
  providerBehaviorImplemented: true,
  compilerOwnsProviderBehavior: false,
  backendFetchProviderExecutionImplemented: true,
  responseHandleSurfaceImplemented: true,
  continuationContextImplemented: true,
  directProviderSmoke: true,
  routeEffectPlanRequired: true,
  providerConfigMappingImplemented: true,
  symbolicBackendRefs: true,
  symbolicConfigSecretRefs: true,
  compiledWasmEffectExecutionImplemented: false,
  compiledWasmSuspendResumeBridgeImplemented: false,
  languageLevelAsync: false,
  promises: false,
  asyncAwait: false,
  asyncify: false,
  actualNetworkFetch: false,
  localFixtureFetch: true
});

const ROUTE_HANDLER_EFFECT_GROUP_SHAPES = Object.freeze({
  single: {
    status: 'implemented-plan',
    authoringShape: 'ctx.resolve(ctx.fetch("backend", requestSpec), afterFetch)',
    resultAccess: 'ctx.resolved()'
  },
  namedObject: {
    status: 'implemented-plan',
    authoringShape: 'ctx.resolve({ user: ctx.fetch("users", requestSpec) }, afterDashboard)',
    resultAccess: 'ctx.resolved("user")'
  },
  array: {
    status: 'reserved-with-diagnostic',
    authoringShape: 'ctx.resolve([ctx.fetch(...)], afterFetch)',
    diagnostic: 'PULSEWASM_RESOLVE_ARRAY_GROUP_RESERVED'
  }
});

const ROUTE_HANDLER_EFFECT_ALLOWED_METHODS = Object.freeze(['GET', 'HEAD', 'POST']);
const ROUTE_HANDLER_EFFECT_KIND_REGISTRY = Object.freeze({
  backendFetch: {
    kind: 'backend-fetch',
    publicSurface: 'ctx.fetch("backendKey", requestSpec)',
    status: 'planned-only',
    requiredCapability: 'backend-fetch',
    hostOwned: true,
    providerExecution: 'future-provider-proof',
    payload: {
      backend: 'literal backend key',
      request: 'static object literal request spec',
      method: 'literal GET/HEAD/POST for the MVP plan',
      path: 'literal/concat/ctx.param expression tree'
    }
  }
});

const ROUTE_HANDLER_CONTEXT_SURFACE = Object.freeze({
  sync: [
    'ctx.param',
    'ctx.paramI32',
    'ctx.request.method',
    'ctx.request.path',
    'ctx.request.header.first',
    'ctx.request.header.count',
    'ctx.request.header.at',
    'ctx.response.header.set',
    'ctx.response.header.append',
    'ctx.response.header.delete',
    'ctx.result.text',
    'ctx.result.jsonText',
    'ctx.result.empty',
    'ctx.error',
    'next',
    'next(error)'
  ],
  effect: [
    'ctx.fetch',
    'ctx.resolve',
    'ctx.resolved'
  ],
  resolvedFetchResponse: [
    'status',
    'ok',
    'header',
    'text',
    'jsonText',
    'json'
  ],
  reservedResolvedFetchResponse: [
    'bytes',
    'stream'
  ],
  rejected: [
    'await ctx.fetch(...)',
    'ctx.fetch(...).then(...)',
    'inline resolve continuation callbacks',
    'captured continuation closures',
    'dynamic backend keys',
    'dynamic effect names',
    'computed request objects',
    'Promise',
    'async function',
    'global fetch',
    'bare defer keyword'
  ]
});

const ROUTE_HANDLER_EFFECT_DIAGNOSTICS = Object.freeze({
  resolveContinuationMustBeTopLevel: 'PULSEWASM_RESOLVE_CONTINUATION_MUST_BE_TOP_LEVEL',
  resolveContinuationMissing: 'PULSEWASM_RESOLVE_CONTINUATION_MISSING',
  resolveEffectUnsupported: 'PULSEWASM_RESOLVE_EFFECT_UNSUPPORTED',
  resolveObjectKeyUnsupported: 'PULSEWASM_RESOLVE_OBJECT_KEY_UNSUPPORTED',
  resolveArrayGroupReserved: 'PULSEWASM_RESOLVE_ARRAY_GROUP_RESERVED',
  fetchBackendMustBeLiteral: 'PULSEWASM_FETCH_BACKEND_MUST_BE_LITERAL',
  fetchRequestMustBeObject: 'PULSEWASM_FETCH_REQUEST_MUST_BE_OBJECT',
  fetchMethodMustBeLiteral: 'PULSEWASM_FETCH_METHOD_MUST_BE_LITERAL',
  fetchMethodUnsupported: 'PULSEWASM_FETCH_METHOD_UNSUPPORTED',
  backendMethodUnsupported: 'PULSEWASM_BACKEND_METHOD_UNSUPPORTED',
  backendRequestBodyModeUnsupported: 'PULSEWASM_BACKEND_REQUEST_BODY_MODE_UNSUPPORTED',
  schemaEncodeRefRequired: 'PULSEWASM_SCHEMA_ENCODE_REF_REQUIRED',
  schemaEncodeDynamicSchemaUnsupported: 'PULSEWASM_SCHEMA_ENCODE_DYNAMIC_SCHEMA_UNSUPPORTED',
  fetchJsonBodySchemaEncodeRequired: 'PULSEWASM_FETCH_JSON_BODY_SCHEMA_ENCODE_REQUIRED',
  requestBodyBinaryReserved: 'PULSEWASM_REQUEST_BODY_BINARY_RESERVED',
  requestBodyStreamReserved: 'PULSEWASM_REQUEST_BODY_STREAM_RESERVED',
  requestBodyMultipartReserved: 'PULSEWASM_REQUEST_BODY_MULTIPART_RESERVED',
  fetchPathUnsupported: 'PULSEWASM_FETCH_PATH_UNSUPPORTED',
  fetchHeadersUnsupported: 'PULSEWASM_FETCH_HEADERS_UNSUPPORTED',
  handlerSourceMissing: 'PULSEWASM_ROUTE_EFFECT_HANDLER_SOURCE_MISSING',
  resolvedResultUnknownName: 'PULSEWASM_RESOLVED_RESULT_UNKNOWN_NAME',
  resolvedResponseModeReserved: 'PULSEWASM_RESOLVED_RESPONSE_MODE_RESERVED',
  unsupportedLanguageAsync: 'PULSEWASM_ROUTE_EFFECT_ASYNC_UNSUPPORTED',
  nodeEffectPlanRequired: 'PULSEWASM_NODE_ROUTE_EFFECT_PLAN_REQUIRED',
  nodeEffectNoPlannedEffects: 'PULSEWASM_NODE_ROUTE_EFFECT_NO_PLANNED_EFFECTS',
  nodeEffectRouteNotFound: 'PULSEWASM_NODE_ROUTE_EFFECT_ROUTE_NOT_FOUND',
  nodeEffectContinuationMissing: 'PULSEWASM_NODE_ROUTE_EFFECT_CONTINUATION_MISSING',
  nodeEffectBackendMissing: 'PULSEWASM_NODE_ROUTE_EFFECT_BACKEND_MISSING',
  nodeEffectBackendResponseMissing: 'PULSEWASM_NODE_ROUTE_EFFECT_BACKEND_RESPONSE_MISSING',
  nodeEffectUnsupportedMethod: 'PULSEWASM_NODE_ROUTE_EFFECT_UNSUPPORTED_METHOD',
  nodeEffectPathUnsupported: 'PULSEWASM_NODE_ROUTE_EFFECT_PATH_UNSUPPORTED',
  nodeEffectResolvedNameMissing: 'PULSEWASM_NODE_ROUTE_EFFECT_RESOLVED_NAME_MISSING',
  nodeEffectSmokeFailed: 'PULSEWASM_NODE_ROUTE_EFFECT_SMOKE_FAILED',
  nodeLiveOriginRequired: 'PULSEWASM_NODE_ROUTE_EFFECT_LIVE_ORIGIN_REQUIRED',
  nodeLiveOriginFetchFailed: 'PULSEWASM_NODE_ROUTE_EFFECT_LIVE_ORIGIN_FETCH_FAILED',
  nodeLiveOriginInvalidUrl: 'PULSEWASM_NODE_ROUTE_EFFECT_LIVE_ORIGIN_INVALID_URL',
  nodeCompiledBridgePlanRequired: 'PULSEWASM_NODE_COMPILED_ROUTE_EFFECT_BRIDGE_PLAN_REQUIRED',
  nodeCompiledBridgeNoPlannedEffects: 'PULSEWASM_NODE_COMPILED_ROUTE_EFFECT_BRIDGE_NO_PLANNED_EFFECTS',
  nodeCompiledBridgeAscMissing: 'PULSEWASM_NODE_COMPILED_ROUTE_EFFECT_BRIDGE_ASC_MISSING',
  nodeCompiledBridgeCompileFailed: 'PULSEWASM_NODE_COMPILED_ROUTE_EFFECT_BRIDGE_COMPILE_FAILED',
  nodeCompiledBridgeSmokeFailed: 'PULSEWASM_NODE_COMPILED_ROUTE_EFFECT_BRIDGE_SMOKE_FAILED',
  fastlyEffectPlanRequired: 'PULSEWASM_FASTLY_ROUTE_EFFECT_PLAN_REQUIRED',
  fastlyEffectNoPlannedEffects: 'PULSEWASM_FASTLY_ROUTE_EFFECT_NO_PLANNED_EFFECTS',
  fastlyEffectRouteNotFound: 'PULSEWASM_FASTLY_ROUTE_EFFECT_ROUTE_NOT_FOUND',
  fastlyEffectContinuationMissing: 'PULSEWASM_FASTLY_ROUTE_EFFECT_CONTINUATION_MISSING',
  fastlyEffectBackendMissing: 'PULSEWASM_FASTLY_ROUTE_EFFECT_BACKEND_MISSING',
  fastlyEffectBackendResponseMissing: 'PULSEWASM_FASTLY_ROUTE_EFFECT_BACKEND_RESPONSE_MISSING',
  fastlyEffectUnsupportedMethod: 'PULSEWASM_FASTLY_ROUTE_EFFECT_UNSUPPORTED_METHOD',
  fastlyEffectPathUnsupported: 'PULSEWASM_FASTLY_ROUTE_EFFECT_PATH_UNSUPPORTED',
  fastlyEffectResolvedNameMissing: 'PULSEWASM_FASTLY_ROUTE_EFFECT_RESOLVED_NAME_MISSING',
  fastlyEffectSmokeFailed: 'PULSEWASM_FASTLY_ROUTE_EFFECT_SMOKE_FAILED'
});

const ROUTE_HANDLER_EFFECT_LIFECYCLE = Object.freeze({
  handlerRunsSynchronously: true,
  resolveReturnsEffectRequest: true,
  hostExecutesEffectGroup: true,
  continuationReentryIsExplicit: true,
  continuationReadsResultsThroughCtx: true,
  continuationMayReturnResultOrAnotherResolveRequest: 'reserved',
  wasmCallStackCaptured: false,
  continuationTokenUserVisible: false
});

function defaultRouteHandlerEffectPolicy() {
  return {
    ...ROUTE_HANDLER_EFFECT_PLAN_SCOPE,
    contractId: ROUTE_HANDLER_EFFECT_CONTRACT_ID,
    artifact: ROUTE_HANDLER_EFFECT_PLAN_ARTIFACT,
    nodeProviderProofArtifact: ROUTE_HANDLER_NODE_EFFECT_PROOF_ARTIFACT,
    nodeProviderRuntimeVersion: ROUTE_HANDLER_NODE_EFFECT_RUNTIME_VERSION,
    nodeLiveOriginProviderProofArtifact: ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_ARTIFACT,
    nodeLiveOriginProviderRuntimeVersion: ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_RUNTIME_VERSION,
    nodeCompiledEffectBridgeArtifact: ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_ARTIFACT,
    nodeCompiledEffectBridgeRuntimeVersion: ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_RUNTIME_VERSION,
    fastlyProviderProofArtifact: ROUTE_HANDLER_FASTLY_EFFECT_PROOF_ARTIFACT,
    fastlyProviderRuntimeVersion: ROUTE_HANDLER_FASTLY_EFFECT_RUNTIME_VERSION,
    allowedMethods: [...ROUTE_HANDLER_EFFECT_ALLOWED_METHODS],
    groupShapes: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_GROUP_SHAPES)),
    effectKinds: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_KIND_REGISTRY)),
    contextSurface: JSON.parse(JSON.stringify(ROUTE_HANDLER_CONTEXT_SURFACE)),
    lifecycle: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_LIFECYCLE))
  };
}

function defaultRouteHandlerNodeEffectProofPolicy() {
  return {
    ...ROUTE_HANDLER_NODE_EFFECT_PROOF_SCOPE,
    contractId: ROUTE_HANDLER_EFFECT_CONTRACT_ID,
    artifact: ROUTE_HANDLER_NODE_EFFECT_PROOF_ARTIFACT,
    sourcePlanArtifact: ROUTE_HANDLER_EFFECT_PLAN_ARTIFACT,
    runtimeVersion: ROUTE_HANDLER_NODE_EFFECT_RUNTIME_VERSION,
    allowedMethods: [...ROUTE_HANDLER_EFFECT_ALLOWED_METHODS],
    groupShapes: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_GROUP_SHAPES)),
    resolvedFetchResponseSurface: [...ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
    reservedResolvedFetchResponseSurface: [...ROUTE_HANDLER_CONTEXT_SURFACE.reservedResolvedFetchResponse],
    lifecycle: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_LIFECYCLE)),
    providerProof: {
      owner: '@pulse-compute/provider-node',
      mode: 'direct-provider-smoke-connected-to-route-handler-effect-plan',
      executesBackendFetchEffects: true,
      suppliesResolvedResponseHandles: true,
      reentersContinuationInCompiledWasm: false,
      continuationContextCanCallTopLevelHandlers: true
    }
  };
}


function defaultRouteHandlerNodeLiveOriginEffectProofPolicy() {
  return {
    ...ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_SCOPE,
    contractId: ROUTE_HANDLER_EFFECT_CONTRACT_ID,
    artifact: ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_ARTIFACT,
    sourcePlanArtifact: ROUTE_HANDLER_EFFECT_PLAN_ARTIFACT,
    runtimeVersion: ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_RUNTIME_VERSION,
    allowedMethods: [...ROUTE_HANDLER_EFFECT_ALLOWED_METHODS],
    groupShapes: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_GROUP_SHAPES)),
    resolvedFetchResponseSurface: [...ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
    reservedResolvedFetchResponseSurface: [...ROUTE_HANDLER_CONTEXT_SURFACE.reservedResolvedFetchResponse],
    lifecycle: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_LIFECYCLE)),
    providerProof: {
      owner: '@pulse-compute/provider-node',
      mode: 'direct-provider-smoke-with-live-local-origin',
      executesBackendFetchEffects: true,
      suppliesResolvedResponseHandles: true,
      reentersContinuationInCompiledWasm: false,
      continuationContextCanCallTopLevelHandlers: true,
      actualNetworkFetch: true,
      localFixtureFetch: false,
      userAuthoredAsync: false
    }
  };
}

function defaultRouteHandlerNodeCompiledEffectBridgePolicy() {
  return {
    ...ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_SCOPE,
    contractId: ROUTE_HANDLER_EFFECT_CONTRACT_ID,
    artifact: ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_ARTIFACT,
    sourcePlanArtifact: ROUTE_HANDLER_EFFECT_PLAN_ARTIFACT,
    runtimeVersion: ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_RUNTIME_VERSION,
    allowedMethods: [...ROUTE_HANDLER_EFFECT_ALLOWED_METHODS],
    groupShapes: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_GROUP_SHAPES)),
    resolvedFetchResponseSurface: [...ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
    reservedResolvedFetchResponseSurface: [...ROUTE_HANDLER_CONTEXT_SURFACE.reservedResolvedFetchResponse],
    lifecycle: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_LIFECYCLE)),
    providerProof: {
      owner: '@pulse-compute/provider-node',
      mode: 'compiled-wasm-resolve-resume-bridge-with-live-local-origin',
      executesBackendFetchEffects: true,
      suppliesResolvedResponseHandles: true,
      reentersContinuationInCompiledWasm: true,
      actualNetworkFetch: true,
      localFixtureFetch: false,
      userAuthoredAsync: false,
      promises: false,
      asyncAwait: false,
      asyncify: false
    }
  };
}

function defaultRouteHandlerFastlyEffectProofPolicy() {
  return {
    ...ROUTE_HANDLER_FASTLY_EFFECT_PROOF_SCOPE,
    contractId: ROUTE_HANDLER_EFFECT_CONTRACT_ID,
    artifact: ROUTE_HANDLER_FASTLY_EFFECT_PROOF_ARTIFACT,
    sourcePlanArtifact: ROUTE_HANDLER_EFFECT_PLAN_ARTIFACT,
    runtimeVersion: ROUTE_HANDLER_FASTLY_EFFECT_RUNTIME_VERSION,
    providerConfigVersion: ROUTE_HANDLER_FASTLY_EFFECT_PROVIDER_CONFIG_VERSION,
    allowedMethods: [...ROUTE_HANDLER_EFFECT_ALLOWED_METHODS],
    groupShapes: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_GROUP_SHAPES)),
    resolvedFetchResponseSurface: [...ROUTE_HANDLER_CONTEXT_SURFACE.resolvedFetchResponse],
    reservedResolvedFetchResponseSurface: [...ROUTE_HANDLER_CONTEXT_SURFACE.reservedResolvedFetchResponse],
    lifecycle: JSON.parse(JSON.stringify(ROUTE_HANDLER_EFFECT_LIFECYCLE)),
    providerProof: {
      owner: '@pulse-compute/provider-fastly',
      mode: 'direct-provider-smoke-connected-to-route-handler-effect-plan',
      executesBackendFetchEffects: true,
      suppliesResolvedResponseHandles: true,
      reentersContinuationInCompiledWasm: false,
      continuationContextCanCallTopLevelHandlers: true,
      providerConfigMapping: 'symbolic-backend-fetch-bindings',
      symbolicBackendRefs: true,
      symbolicConfigSecretRefs: true,
      actualNetworkFetch: false
    }
  };
}

module.exports = {
  ROUTE_HANDLER_EFFECT_PLAN_VERSION,
  ROUTE_HANDLER_EFFECT_PLAN_PHASE,
  ROUTE_HANDLER_EFFECT_PLAN_ARTIFACT,
  ROUTE_HANDLER_NODE_EFFECT_PROOF_VERSION,
  ROUTE_HANDLER_NODE_EFFECT_PROOF_PHASE,
  ROUTE_HANDLER_NODE_EFFECT_PROOF_ARTIFACT,
  ROUTE_HANDLER_NODE_EFFECT_RUNTIME_VERSION,
  ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_VERSION,
  ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_VERSION,
  ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_PHASE,
  ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_PHASE,
  ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_ARTIFACT,
  ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_ARTIFACT,
  ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_RUNTIME_VERSION,
  ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_RUNTIME_VERSION,
  ROUTE_HANDLER_FASTLY_EFFECT_PROOF_VERSION,
  ROUTE_HANDLER_FASTLY_EFFECT_PROOF_PHASE,
  ROUTE_HANDLER_FASTLY_EFFECT_PROOF_ARTIFACT,
  ROUTE_HANDLER_FASTLY_EFFECT_RUNTIME_VERSION,
  ROUTE_HANDLER_FASTLY_EFFECT_PROVIDER_CONFIG_VERSION,
  ROUTE_HANDLER_EFFECT_CONTRACT_ID,
  ROUTE_HANDLER_EFFECT_PLAN_SCOPE,
  ROUTE_HANDLER_NODE_EFFECT_PROOF_SCOPE,
  ROUTE_HANDLER_NODE_LIVE_ORIGIN_EFFECT_PROOF_SCOPE,
  ROUTE_HANDLER_NODE_COMPILED_EFFECT_BRIDGE_SCOPE,
  ROUTE_HANDLER_FASTLY_EFFECT_PROOF_SCOPE,
  ROUTE_HANDLER_EFFECT_GROUP_SHAPES,
  ROUTE_HANDLER_EFFECT_ALLOWED_METHODS,
  ROUTE_HANDLER_EFFECT_KIND_REGISTRY,
  ROUTE_HANDLER_CONTEXT_SURFACE,
  ROUTE_HANDLER_EFFECT_DIAGNOSTICS,
  ROUTE_HANDLER_EFFECT_LIFECYCLE,
  defaultRouteHandlerEffectPolicy,
  defaultRouteHandlerNodeEffectProofPolicy,
  defaultRouteHandlerNodeLiveOriginEffectProofPolicy,
  defaultRouteHandlerNodeCompiledEffectBridgePolicy,
  defaultRouteHandlerFastlyEffectProofPolicy
};
