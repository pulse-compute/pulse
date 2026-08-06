'use strict';

const FASTLY_LIFECYCLE_PARITY_PROOF_VERSION = 'pulsewasm.fastly-lifecycle-parity-proof.v1';
const FASTLY_LIFECYCLE_PARITY_PROOF_PHASE = '44';
const FASTLY_LIFECYCLE_PARITY_PROOF_ARTIFACT = 'fastly-lifecycle-parity-proof.json';
const FASTLY_LIFECYCLE_PARITY_CONTRACT_ID = 'pulse.fastly-lifecycle-parity';

const FASTLY_LIFECYCLE_PARITY_SCOPE = Object.freeze({
  provider: 'fastly',
  compilerOrchestrationOnly: true,
  compilerOwnsProviderBehavior: false,
  providerOwnsOriginBehavior: true,
  symbolicBackendConfig: true,
  getHeadOriginMappingImplemented: true,
  statusHeaderBodyPassthroughImplemented: true,
  resolveContinuationLifecycleImplemented: true,
  jsonTextBodyModePolicyImplemented: true,
  actualNetworkFetch: false,
  noExternalFastlyServiceRequired: true,
  postJsonRequestBodyReadiness: 'plan-only',
  binaryRequestBody: false,
  streamRequestBody: false,
  multipartRequestBody: false,
  asyncAwait: false,
  promises: false,
  asyncify: false
});

const FASTLY_LIFECYCLE_PARITY_POLICY = Object.freeze({
  provider: 'fastly',
  proofMode: 'symbolic-fastly-fixture-parity',
  validates: [
    'symbolic-backend-config',
    'GET origin mapping',
    'HEAD origin mapping',
    'status/header/body passthrough',
    'ctx.resolve continuation lifecycle metadata',
    'json/text response body mode policy',
    'explicit POST JSON plan-only classification'
  ],
  doesNotRequire: [
    'external Fastly service',
    'actual network fetch',
    'compiled-Wasm Fastly suspend/resume bridge',
    'user-authored async',
    'Promise lowering',
    'Asyncify'
  ],
  postJsonRequestBodyReadiness: 'plan-only',
  reservedBodyModes: ['binary', 'stream', 'multipart/form-data']
});

const FASTLY_LIFECYCLE_PARITY_DIAGNOSTICS = Object.freeze({
  planRequired: 'PULSEWASM_FASTLY_LIFECYCLE_PARITY_PLAN_REQUIRED',
  getRouteMissing: 'PULSEWASM_FASTLY_LIFECYCLE_PARITY_GET_ROUTE_MISSING',
  headRouteMissing: 'PULSEWASM_FASTLY_LIFECYCLE_PARITY_HEAD_ROUTE_MISSING',
  backendMissing: 'PULSEWASM_FASTLY_LIFECYCLE_PARITY_BACKEND_MISSING',
  smokeFailed: 'PULSEWASM_FASTLY_LIFECYCLE_PARITY_SMOKE_FAILED',
  postJsonBodyPlanOnly: 'PULSEWASM_FASTLY_POST_JSON_BODY_PLAN_ONLY'
});

module.exports = {
  FASTLY_LIFECYCLE_PARITY_PROOF_VERSION,
  FASTLY_LIFECYCLE_PARITY_PROOF_PHASE,
  FASTLY_LIFECYCLE_PARITY_PROOF_ARTIFACT,
  FASTLY_LIFECYCLE_PARITY_CONTRACT_ID,
  FASTLY_LIFECYCLE_PARITY_SCOPE,
  FASTLY_LIFECYCLE_PARITY_POLICY,
  FASTLY_LIFECYCLE_PARITY_DIAGNOSTICS
};
