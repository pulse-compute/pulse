'use strict';

const SECOND_PACKAGE_OWNED_LOWERING_PROOF_VERSION = 'pulsewasm.second-package-owned-lowering-proof.v1';
const SECOND_PACKAGE_OWNED_LOWERING_PROOF_ARTIFACT = 'second-package-owned-lowering-proof.json';
const GRIP_LOWERING_PLAN_VERSION = 'pulsewasm.grip-lowering-plan.v1';
const GRIP_LOWERING_PLAN_ARTIFACT = 'grip-lowering-plan.json';

const SECOND_PACKAGE_OWNED_LOWERING_SCOPE = Object.freeze({
  phase: '54',
  firstPackage: '@pulse-compute/assets',
  secondPackage: '@pulse-compute/grip',
  firstContractId: 'pulse.assets',
  secondContractId: 'pulse.grip',
  purpose: 'Prove the lowerable package protocol is not assets-specific by adding a second package-owned manifest/facade/compiler-builder/sidecar surface.',
  productionRuntimeRequired: false,
  providerRuntimeRequired: false
});

const SECOND_PACKAGE_OWNED_LOWERING_POLICY = Object.freeze({
  packageOwnsFacade: true,
  packageOwnsManifest: true,
  packageOwnsCompilerBuilder: true,
  packageOwnsSidecarDeclaration: true,
  libraryKitOwnsGenericDiscovery: true,
  compilerOwnsPackageMapping: false,
  arbitraryThirdPartyLowererExecution: false,
  firstPartyTrustRequired: true,
  productionGripRuntimeBehavior: false,
  betaProtocolBreadthOverProductionCompleteness: true
});

module.exports = {
  SECOND_PACKAGE_OWNED_LOWERING_PROOF_VERSION,
  SECOND_PACKAGE_OWNED_LOWERING_PROOF_ARTIFACT,
  GRIP_LOWERING_PLAN_VERSION,
  GRIP_LOWERING_PLAN_ARTIFACT,
  SECOND_PACKAGE_OWNED_LOWERING_SCOPE,
  SECOND_PACKAGE_OWNED_LOWERING_POLICY
};
