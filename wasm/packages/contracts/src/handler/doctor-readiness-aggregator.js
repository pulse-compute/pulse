'use strict';

const DOCTOR_READINESS_AGGREGATOR_VERSION = 'pulsewasm.doctor-readiness-aggregator.v1';
const DOCTOR_READINESS_AGGREGATOR_PHASE = '53';
const DOCTOR_READINESS_AGGREGATOR_ARTIFACT = 'doctor-readiness-aggregator.json';
const DOCTOR_READINESS_AGGREGATOR_CONTRACT_ID = 'pulse.doctor-readiness-aggregator';

const DOCTOR_READINESS_AGGREGATOR_SCOPE = Object.freeze({
  betaApp: 'examples/beta-lifecycle/app.js',
  referenceApp: 'examples/reference-node-lifecycle/app.js',
  assetsPackageOutApp: 'examples/assets-package-out/app.js',
  command: 'node wasm/scripts/run-wasm-tests.cjs --profile release --no-report',
  cliDoctorReadinessRequired: true,
  routeReadinessRequired: true,
  packageReadinessRequired: true,
  providerReadinessRequired: true,
  planOnlyClassificationRequired: true,
  splitProofClassificationRequired: true
});

const DOCTOR_READINESS_AGGREGATOR_POLICY = Object.freeze({
  purpose: 'make pulsewasm doctor the developer-facing readiness aggregator for beta lifecycle routes, lowerable packages, providers, and plan-only edges',
  productionCompletenessRequired: false,
  betaQualityTarget: true,
  simpleUserFunctionLoweringIntentional: true,
  sourceOfTruth: Object.freeze({
    routeShape: 'handler-io-lifecycle-plan.json and CLI doctor lifecycle section',
    nodeBackendLifecycle: 'reference-node-lifecycle-golden.json and Node backend proof artifacts',
    assetsPackageLifecycle: 'assets package-owned/package-out/sidecar and Node compiled-Wasm assets proof artifacts',
    fastlyLifecycle: 'fastly-lifecycle-parity-proof.json and fastly-assets-package-out-parity-proof.json',
    unsupportedEdges: 'contracts diagnostics plus lifecycle-authoring-alignment.json'
  }),
  readinessVocabulary: Object.freeze({
    implemented: 'usable in the validated beta path',
    implementedNarrow: 'usable for the documented narrow beta subset',
    symbolicParity: 'provider-owned symbolic parity proof; no external service required',
    planOnly: 'reserved/planned and diagnosed or classified, not silently implemented',
    splitProofRequired: 'validated through split lifecycle proofs because the combined app is not yet lowered by one compiled bridge'
  }),
  requiredDoctorSections: Object.freeze([
    'readiness.summary',
    'readiness.routes',
    'readiness.packages',
    'readiness.providers',
    'readiness.unsupportedEdges',
    'readiness.actionableNextSteps'
  ]),
  outOfScope: Object.freeze([
    'production asset CDN semantics',
    'full Fastly compiled-Wasm runtime execution',
    'single unified compiled bridge for backend and package-owned assets handlers in the combined beta app',
    'arbitrary third-party compiler lowerer execution',
    'async/await lowering',
    'Promise lowering',
    'automatic schema generation',
    'arbitrary JavaScript object lowering'
  ])
});

module.exports = {
  DOCTOR_READINESS_AGGREGATOR_VERSION,
  DOCTOR_READINESS_AGGREGATOR_PHASE,
  DOCTOR_READINESS_AGGREGATOR_ARTIFACT,
  DOCTOR_READINESS_AGGREGATOR_CONTRACT_ID,
  DOCTOR_READINESS_AGGREGATOR_SCOPE,
  DOCTOR_READINESS_AGGREGATOR_POLICY
};
