'use strict';

const handlerLibraryContracts = require('./handler-library-contracts.js');
const librarySidecars = require('./library-sidecars.js');
const hostCapabilities = require('./host-capabilities.js');
const assetsLowering = require('./assets-lowering.js');
const packageLowering = require('./package-lowering.js');
const packageContracts = require('./package-contracts.js');

module.exports = {
  handlerLibraryContracts,
  librarySidecars,
  hostCapabilities,
  assetsLowering,
  packageLowering,
  packageContracts,
  buildHandlerLibraryContracts: handlerLibraryContracts.buildHandlerLibraryContracts,
  discoverLowerableLibraryManifests: handlerLibraryContracts.discoverLowerableLibraryManifests,
  resolveLowerableCompilerBuilder: handlerLibraryContracts.resolveLowerableCompilerBuilder,
  loadLowerableCompilerBuilder: handlerLibraryContracts.loadLowerableCompilerBuilder,
  resolveDefaultLibraryContracts: handlerLibraryContracts.resolveDefaultLibraryContracts,
  buildLibrarySidecarConsumption: librarySidecars.buildLibrarySidecarConsumption,
  buildHostCapabilities: hostCapabilities.buildHostCapabilities,
  buildAssetsLoweringPlan: assetsLowering.buildAssetsLoweringPlan,
  buildAssetsCompiledWasmSidecarPlan: assetsLowering.buildAssetsCompiledWasmSidecarPlan,
  buildAssetsSidecarCompileLinkProof: assetsLowering.buildAssetsSidecarCompileLinkProof,
  findLowerableManifestRecord: packageLowering.findLowerableManifestRecord,
  buildPackageOwnedLoweringPlan: packageLowering.buildPackageOwnedLoweringPlan,
  discoverPulsePackageContracts: packageContracts.discoverPulsePackageContracts
};
