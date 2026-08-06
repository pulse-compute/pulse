'use strict';

const BETA_LIFECYCLE_GOLDEN_VERSION = 'pulsewasm.beta-lifecycle-golden.v1';
const BETA_LIFECYCLE_GOLDEN_PHASE = '51';
const BETA_LIFECYCLE_GOLDEN_ARTIFACT = 'beta-lifecycle-golden.json';
const BETA_LIFECYCLE_GOLDEN_CONTRACT_ID = 'pulse.beta-lifecycle-golden';

const BETA_LIFECYCLE_GOLDEN_AUTHORING_SUBSET = Object.freeze({
  asyncAwait: false,
  promises: false,
  loops: false,
  dynamicBackends: false,
  dynamicAssetKeys: false,
  arbitraryObjectLowering: false,
  automaticSchemaGeneration: false,
  binaryBodies: false,
  streams: false,
  multipart: false,
  uploads: false,
  generalObjectStoreSemantics: false
});

const BETA_LIFECYCLE_GOLDEN_SCOPE = Object.freeze({
  betaApp: 'examples/beta-lifecycle/app.js',
  referenceApp: 'examples/reference-node-lifecycle/app.js',
  assetsPackageOutApp: 'examples/assets-package-out/app.js',
  command: 'node wasm/scripts/run-wasm-tests.cjs --profile release --no-report',
  publicSurfaceOnly: true,
  compilerOrchestrates: true,
  packageOwnedLowering: true,
  packageOutDiscovery: true,
  providersOwnProviderBehavior: true,
  nodeReferenceLifecycle: 'implemented',
  nodeCompiledWasmResolveResume: 'implemented',
  nodeCompiledWasmAssets: 'implemented-narrow-terminal-get-head-text',
  fastlyReferenceLifecycle: 'symbolic-parity',
  fastlyPostJsonRequestBodies: 'plan-only',
  fastlyCompiledWasmAssets: 'plan-only',
  noReferenceAppSpecialPath: true,
  noBetaAppSpecialPath: true,
  noHiddenEagerWork: true,
  noUserAuthoredAsync: true,
  promises: false,
  asyncAwait: false,
  asyncify: false,
  authoringSubset: BETA_LIFECYCLE_GOLDEN_AUTHORING_SUBSET
});

const BETA_LIFECYCLE_GOLDEN_POLICY = Object.freeze({
  purpose: 'beta-quality lifecycle harness for trying small apps across backend effects, schema JSON, package-owned lowerers, and provider readiness',
  productionCompletenessRequired: false,
  productionAssetServingTarget: false,
  simpleUserFunctionLoweringIntentional: true,
  appBoundary: 'beta/reference apps use only public router, ctx, and package lowerable facades',
  harnessBoundary: 'tests and proof builders may orchestrate origins, package-out fixtures, providers, and CLI commands',
  requiredCommand: 'node wasm/scripts/run-wasm-tests.cjs --profile release --no-report',
  validates: Object.freeze([
    'combined beta lifecycle example app',
    'reference Node lifecycle golden lane',
    'assets package-owned lowering',
    'assets package-out discovery',
    'assets compiled-Wasm sidecar readiness',
    'assets sidecar compile/link proof',
    'Node compiled-Wasm assets lifecycle proof',
    'Fastly lifecycle parity classification',
    'Fastly assets package-out parity classification',
    'CLI plan/doctor/build for the combined beta app',
    'router.head public route method support',
    'route/method consistency for HEAD asset routes',
    'docs for beta authoring subset and diagnostics',
    'canonical alpha artifact path hygiene'
  ]),
  authoringSubset: BETA_LIFECYCLE_GOLDEN_AUTHORING_SUBSET,
  outOfScope: Object.freeze([
    'production asset CDN semantics',
    'binary asset bodies',
    'compiled-Wasm stream asset bodies',
    'range requests',
    'uploads',
    'cache invalidation',
    'arbitrary third-party lowerer execution',
    'async/await lowering',
    'Promise lowering',
    'automatic schema generation',
    'arbitrary JavaScript object lowering'
  ])
});

module.exports = {
  BETA_LIFECYCLE_GOLDEN_VERSION,
  BETA_LIFECYCLE_GOLDEN_PHASE,
  BETA_LIFECYCLE_GOLDEN_ARTIFACT,
  BETA_LIFECYCLE_GOLDEN_CONTRACT_ID,
  BETA_LIFECYCLE_GOLDEN_AUTHORING_SUBSET,
  BETA_LIFECYCLE_GOLDEN_SCOPE,
  BETA_LIFECYCLE_GOLDEN_POLICY
};
