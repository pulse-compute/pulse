'use strict';

const LIFECYCLE_READINESS_AGGREGATE_VERSION = 'pulsewasm.lifecycle-readiness-aggregate.v1';
const LIFECYCLE_READINESS_AGGREGATE_PHASE = '53';
const LIFECYCLE_READINESS_AGGREGATE_ARTIFACT = 'lifecycle-readiness-aggregate.json';
const LIFECYCLE_READINESS_AGGREGATE_CONTRACT_ID = 'pulse.lifecycle-readiness-aggregate';

const LIFECYCLE_READINESS_AGGREGATE_SCOPE = Object.freeze({
  betaApp: 'examples/beta-lifecycle/app.js',
  referenceApp: 'examples/reference-node-lifecycle/app.js',
  assetsPackageOutApp: 'examples/assets-package-out/app.js',
  command: 'corepack pnpm run -s test:lifecycle-readiness',
  doctorCommand: 'pulsewasm doctor examples/beta-lifecycle/app.js',
  nodeProviderReadinessRequired: true,
  fastlyProviderReadinessRequired: true,
  routeReadinessRequired: true,
  packageReadinessRequired: true,
  proofArtifactsAggregated: true,
  productionCompletenessRequired: false
});

const LIFECYCLE_READINESS_STATES = Object.freeze({
  implemented: 'implemented',
  implementedNarrow: 'implemented-narrow',
  implementedNarrowTerminalAssets: 'implemented-narrow-terminal-get-head-text',
  symbolicParity: 'symbolic-parity',
  proofAvailable: 'proof-available',
  planOnly: 'plan-only',
  reserved: 'reserved',
  notRequired: 'not-required',
  notSupported: 'not-supported',
  splitProofRequired: 'split-proof-required',
  unknown: 'unknown'
});

const LIFECYCLE_READINESS_AGGREGATE_POLICY = Object.freeze({
  purpose: 'make pulsewasm doctor the developer-facing source of truth for beta lifecycle route, package, provider, and unsupported-edge readiness',
  productionCompletenessRequired: false,
  betaQualityTarget: true,
  providerSpecificReadinessRequired: true,
  aggregateSourceArtifacts: Object.freeze([
    'handler-io-lifecycle-plan.json',
    'reference-node-lifecycle-golden.json',
    'beta-lifecycle-golden.json',
    'lifecycle-authoring-alignment.json',
    'node-live-origin-route-handler-effect-proof.json',
    'node-compiled-route-handler-effect-bridge.json',
    'node-backend-json-request-body-proof.json',
    'fastly-lifecycle-parity-proof.json',
    'assets-package-owned-lowering-proof.json',
    'assets-package-out-discovery-proof.json',
    'assets-compiled-wasm-sidecar-plan.json',
    'assets-sidecar-compile-link-proof.json',
    'node-compiled-wasm-assets-lifecycle-proof.json',
    'fastly-assets-package-out-parity-proof.json'
  ]),
  routeReadinessMustExplain: Object.freeze([
    'route',
    'handler',
    'node backend/live-origin/compiled-Wasm readiness',
    'Fastly backend/parity readiness',
    'request body/schema posture',
    'backend JSON body posture',
    'assets terminal response posture',
    'unsupported/reserved body modes',
    'diagnostics'
  ]),
  packageReadinessMustExplain: Object.freeze([
    'package-owned lowerer',
    'package-out discovery',
    'sidecar readiness',
    'Node direct/provider readiness',
    'Node compiled-Wasm readiness',
    'Fastly parity readiness',
    'Fastly compiled-Wasm plan-only posture',
    'reserved binary/stream posture'
  ]),
  knownBreaksRemainExplicit: Object.freeze({
    combinedAppCompiledRouteBridge: 'split-proof-required-assets-handlers-not-yet-in-pass38-compiled-handler-lowerer',
    realAssemblyScriptAssetsSidecarCompileLink: 'dependency-gated-or-implemented',
    fastlyCompiledWasmAssets: 'plan-only'
  })
});

module.exports = {
  LIFECYCLE_READINESS_AGGREGATE_VERSION,
  LIFECYCLE_READINESS_AGGREGATE_PHASE,
  LIFECYCLE_READINESS_AGGREGATE_ARTIFACT,
  LIFECYCLE_READINESS_AGGREGATE_CONTRACT_ID,
  LIFECYCLE_READINESS_AGGREGATE_SCOPE,
  LIFECYCLE_READINESS_AGGREGATE_POLICY,
  LIFECYCLE_READINESS_STATES
};
