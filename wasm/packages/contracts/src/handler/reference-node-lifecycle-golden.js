'use strict';

const REFERENCE_NODE_LIFECYCLE_GOLDEN_VERSION = 'pulsewasm.reference-node-lifecycle-golden.v1';
const REFERENCE_NODE_LIFECYCLE_GOLDEN_PHASE = '45';
const REFERENCE_NODE_LIFECYCLE_GOLDEN_ARTIFACT = 'reference-node-lifecycle-golden.json';
const REFERENCE_NODE_LIFECYCLE_GOLDEN_CONTRACT_ID = 'pulse.reference-node-lifecycle-golden';

const REFERENCE_NODE_LIFECYCLE_GOLDEN_SCOPE = Object.freeze({
  referenceApp: 'examples/reference-node-lifecycle/app.js',
  command: 'corepack pnpm run -s test:reference-node-lifecycle',
  publicSurfaceOnly: true,
  compilerOrchestrates: true,
  providersOwnProviderBehavior: true,
  nodeLiveOriginProviderProof: true,
  nodeCompiledWasmResolveResumeBridge: true,
  requestJsonDecodeLifecycle: true,
  schemaEncodeDecodeLifecycle: true,
  backendJsonRequestBodies: true,
  fastlyLifecycleParity: true,
  fastlyPostJsonRequestBodyReadiness: 'plan-only',
  noReferenceAppSpecialPath: true,
  noHiddenEagerWork: true,
  noUserAuthoredAsync: true,
  promises: false,
  asyncAwait: false,
  asyncify: false
});

const REFERENCE_NODE_LIFECYCLE_GOLDEN_POLICY = Object.freeze({
  appBoundary: 'reference app uses only public router/ctx surfaces',
  harnessBoundary: 'tests and proof builders may orchestrate origins/providers/CLI commands',
  requiredCommand: 'corepack pnpm run -s test:reference-node-lifecycle',
  validates: [
    'CLI plan',
    'CLI doctor',
    'CLI build',
    'artifact freshness',
    'handler I/O lifecycle artifact',
    'Node live-origin provider proof',
    'Node compiled-Wasm resolve/resume bridge',
    'lazy ctx.req.json',
    'schema-backed request decode',
    'schema decode result ergonomics',
    'schema-backed final response encode',
    'origin response schema decode',
    'backend JSON request bodies',
    'Fastly lifecycle parity',
    'unsupported body-mode diagnostics',
    'public-surface-only reference app',
    'no reference app special path'
  ],
  unsupportedOutOfScope: [
    'binary bodies',
    'stream bodies',
    'async/await lowering',
    'Promise lowering',
    'Asyncify',
    'automatic schema generation',
    'arbitrary JS object lowering',
    'multipart/form-data',
    'uploads',
    'general object-store semantics'
  ]
});

module.exports = {
  REFERENCE_NODE_LIFECYCLE_GOLDEN_VERSION,
  REFERENCE_NODE_LIFECYCLE_GOLDEN_PHASE,
  REFERENCE_NODE_LIFECYCLE_GOLDEN_ARTIFACT,
  REFERENCE_NODE_LIFECYCLE_GOLDEN_CONTRACT_ID,
  REFERENCE_NODE_LIFECYCLE_GOLDEN_SCOPE,
  REFERENCE_NODE_LIFECYCLE_GOLDEN_POLICY
};
