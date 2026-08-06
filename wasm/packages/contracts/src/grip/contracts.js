'use strict';

const {
  PACKAGE_INTRINSIC_VERSION: GRIP_PACKAGE_INTRINSIC_VERSION
} = require('../package/package-contract.js');

const GRIP_CONTRACT_VERSION = 'pulsewasm.grip-contract.v2';
const GRIP_CONTRACT_ID = 'pulse.grip';
const GRIP_LOWERING_PLAN_VERSION = 'pulsewasm.grip-lowering-plan.v1';
const GRIP_LOWERING_PLAN_ARTIFACT = 'grip-lowering-plan.json';
const GRIP_PACKAGE_OWNED_LOWERING_PROOF_VERSION = 'pulsewasm.grip-package-owned-lowering-proof.v1';
const GRIP_PACKAGE_OWNED_LOWERING_PROOF_ARTIFACT = 'grip-package-owned-lowering-proof.json';
const GRIP_PACKAGE_OWNED_LOWERING_PROOF_PHASE = 54;
const GRIP_PACKAGE_OWNED_LOWERING_CONTRACT_ID = 'pulse.grip-package-owned-lowering';

const GRIP_ALLOWED_HOLD_MODES = Object.freeze(['stream', 'response']);
const GRIP_FACADE_SYMBOLS = Object.freeze(['broadcast', 'handoff', 'isWebSocket', 'subscribe']);
const GRIP_COMPATIBILITY_FACADE_SYMBOLS = Object.freeze(['hold', 'channel', 'publish']);
const GRIP_LOWERABLE_SUBPATH_SUFFIX = '/pulsewasm';
const GRIP_PACKAGE_INTRINSICS = Object.freeze({
  isWebSocket: Object.freeze({ name: 'grip.is-websocket', compilerName: '__pulse_grip_is_websocket', valueKind: 'boolean', argumentIndexes: Object.freeze([]) }),
  subscribe: Object.freeze({ name: 'grip.subscribe', compilerName: '__pulse_grip_subscribe', valueKind: 'pulse-result', argumentIndexes: Object.freeze([0, 1]) }),
  handoff: Object.freeze({ name: 'grip.handoff', compilerName: '__pulse_grip_handoff', valueKind: 'pulse-result', argumentIndexes: Object.freeze([0]) })
});

const GRIP_DIAGNOSTIC_CODES = Object.freeze({
  NON_LITERAL_HOLD_MODE: 'PULSEWASM_GRIP_NON_LITERAL_HOLD_MODE',
  HOLD_MODE_UNSUPPORTED: 'PULSEWASM_GRIP_HOLD_MODE_UNSUPPORTED',
  NON_LITERAL_CHANNEL: 'PULSEWASM_GRIP_NON_LITERAL_CHANNEL',
  NON_LITERAL_MESSAGE: 'PULSEWASM_GRIP_NON_LITERAL_MESSAGE',
  DYNAMIC_CHANNEL_LIST_UNSUPPORTED: 'PULSEWASM_GRIP_DYNAMIC_CHANNEL_LIST_UNSUPPORTED',
  HANDLE_ESCAPE_UNSUPPORTED: 'PULSEWASM_GRIP_HANDLE_ESCAPE_UNSUPPORTED',
  PROVIDER_RUNTIME_PLAN_ONLY: 'PULSEWASM_GRIP_PROVIDER_RUNTIME_PLAN_ONLY',
  PACKAGE_MANIFEST_NOT_DISCOVERED: 'PULSEWASM_GRIP_PACKAGE_MANIFEST_NOT_DISCOVERED',
  ARGUMENT_SHAPE_UNSUPPORTED: 'PULSEWASM_GRIP_ARGUMENT_SHAPE_UNSUPPORTED',
  STATIC_OPTIONS_REQUIRED: 'PULSEWASM_GRIP_STATIC_OPTIONS_REQUIRED',
  STATIC_MESSAGE_REQUIRED: 'PULSEWASM_GRIP_STATIC_MESSAGE_REQUIRED',
  CHANNEL_INVALID: 'PULSEWASM_GRIP_CHANNEL_INVALID',
  TIMEOUT_INVALID: 'PULSEWASM_GRIP_TIMEOUT_INVALID',
  MODE_UNSUPPORTED: 'PULSEWASM_GRIP_MODE_UNSUPPORTED',
  REQUEST_EXPRESSION_UNSUPPORTED: 'PULSEWASM_GRIP_REQUEST_EXPRESSION_UNSUPPORTED'
});

const GRIP_PACKAGE_OWNED_LOWERING_SCOPE = Object.freeze({
  primaryPackage: '@pulse-compute/assets',
  secondPackage: '@pulse-compute/grip',
  firstContractId: 'pulse.assets',
  secondContractId: GRIP_CONTRACT_ID,
  betaQualityTarget: true,
  productionCompletenessRequired: false
});

const GRIP_PACKAGE_OWNED_LOWERING_POLICY = Object.freeze({
  packageOwnsManifest: true,
  packageOwnsFacade: true,
  packageOwnsCompilerBuilder: true,
  packageOwnsSidecarDeclaration: true,
  libraryKitOwnsGenericDiscovery: true,
  compilerOwnsPackageMapping: false,
  arbitraryThirdPartyLowererExecution: false,
  trustedFirstPartyOnly: true,
  providerRuntimeRequiredForThisProof: false,
  assetsSpecificProtocolGeneralized: true
});

function gripProtocolExtension() {
  return {
    grip: {
      version: GRIP_CONTRACT_VERSION,
      contractId: GRIP_CONTRACT_ID,
      allowedHoldModes: GRIP_ALLOWED_HOLD_MODES.slice(),
      facadeSymbols: GRIP_FACADE_SYMBOLS.slice(),
      compatibilityFacadeSymbols: GRIP_COMPATIBILITY_FACADE_SYMBOLS.slice(),
      packageIntrinsicVersion: GRIP_PACKAGE_INTRINSIC_VERSION,
      packageIntrinsics: { ...GRIP_PACKAGE_INTRINSICS },
      diagnostics: { ...GRIP_DIAGNOSTIC_CODES }
    },
    policy: {
      packageIdentityOwnedByManifest: true,
      lowerableFacadeOwnedByPackage: true,
      compilerBuilderOwnedByPackage: true,
      runtimeProviderPlanOnly: true
    }
  };
}

module.exports = {
  GRIP_CONTRACT_VERSION,
  GRIP_CONTRACT_ID,
  GRIP_LOWERING_PLAN_VERSION,
  GRIP_LOWERING_PLAN_ARTIFACT,
  GRIP_PACKAGE_OWNED_LOWERING_PROOF_VERSION,
  GRIP_PACKAGE_OWNED_LOWERING_PROOF_ARTIFACT,
  GRIP_PACKAGE_OWNED_LOWERING_PROOF_PHASE,
  GRIP_PACKAGE_OWNED_LOWERING_CONTRACT_ID,
  GRIP_ALLOWED_HOLD_MODES,
  GRIP_FACADE_SYMBOLS,
  GRIP_COMPATIBILITY_FACADE_SYMBOLS,
  GRIP_LOWERABLE_SUBPATH_SUFFIX,
  GRIP_PACKAGE_INTRINSIC_VERSION,
  GRIP_PACKAGE_INTRINSICS,
  GRIP_DIAGNOSTIC_CODES,
  GRIP_PACKAGE_OWNED_LOWERING_SCOPE,
  GRIP_PACKAGE_OWNED_LOWERING_POLICY,
  gripProtocolExtension
};
