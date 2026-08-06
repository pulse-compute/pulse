'use strict';

const {
  discoverLowerableLibraryManifests,
  loadLowerableCompilerBuilder,
  resolveDefaultLibraryContracts
} = require('./handler-library-contracts.js');

function loadAssetsContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/assets/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/assets/contracts.js');
    }
    throw error;
  }
}

const assetsContracts = loadAssetsContracts();
const phaseName = 'assets-lowering-plan';

function findAssetsManifestRecord(inputs = {}) {
  const manifestRecords = Array.isArray(inputs.manifestRecords) && inputs.manifestRecords.length > 0
    ? inputs.manifestRecords
    : discoverLowerableLibraryManifests({ cwd: inputs.cwd || process.cwd(), workspaceRoot: inputs.workspaceRoot });

  const explicitManifest = inputs.assetsManifest || inputs.manifest;
  if (explicitManifest) {
    const record = manifestRecords.find((entry) => entry.manifest === explicitManifest || (
      entry.manifest &&
      entry.manifest.contractId === explicitManifest.contractId &&
      entry.manifest.npmPackage === explicitManifest.npmPackage
    ));
    if (record) return { record, manifestRecords };
    return {
      record: {
        packageDir: inputs.packageDir || process.cwd(),
        packageName: explicitManifest.npmPackage,
        manifestFile: inputs.manifestFile,
        manifest: explicitManifest,
        validation: { status: 'ok', diagnostics: [] }
      },
      manifestRecords
    };
  }

  return {
    record: manifestRecords.find((entry) => entry.manifest && entry.manifest.contractId === assetsContracts.ASSETS_CONTRACT_ID),
    manifestRecords
  };
}

function buildAssetsLoweringPlan(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const { record, manifestRecords } = findAssetsManifestRecord(inputs);
  const libraryContracts = Array.isArray(inputs.libraryContracts) && inputs.libraryContracts.length > 0
    ? inputs.libraryContracts
    : resolveDefaultLibraryContracts({ cwd, workspaceRoot: inputs.workspaceRoot });

  if (!record) {
    // Delegate the precise missing-manifest diagnostic to the package builder when possible;
    // otherwise keep the historical surface by throwing through an empty package-owned input.
    const error = new Error('Could not discover the package-owned @pulse-compute/assets PulseWasm manifest.');
    error.diagnostics = [];
    throw error;
  }

  const loaded = loadLowerableCompilerBuilder(record);
  return loaded.builder({
    ...inputs,
    cwd,
    manifest: record.manifest,
    assetsManifest: record.manifest,
    manifestRecord: record,
    manifestRecords,
    libraryContracts,
    packageCompilerBuilder: {
      owner: record.manifest && record.manifest.compiler ? record.manifest.compiler.builderOwner : record.packageName,
      entry: loaded.entry,
      export: loaded.exportName,
      trust: loaded.compiler && loaded.compiler.trust
    }
  });
}


function buildAssetsCompiledWasmSidecarPlan(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const { record, manifestRecords } = findAssetsManifestRecord(inputs);
  if (!record) {
    const error = new Error('Could not discover the package-owned @pulse-compute/assets PulseWasm manifest for sidecar planning.');
    error.diagnostics = [];
    throw error;
  }
  const loaded = loadLowerableCompilerBuilder(record);
  const builder = loaded.module && loaded.module.buildAssetsCompiledWasmSidecarPlan;
  if (typeof builder !== 'function') {
    const error = new Error('Package-owned assets compiler builder does not export buildAssetsCompiledWasmSidecarPlan.');
    error.diagnostics = [];
    throw error;
  }
  return builder({
    ...inputs,
    cwd,
    manifest: record.manifest,
    assetsManifest: record.manifest,
    manifestRecord: record,
    manifestRecords,
    packageDir: record.packageDir,
    packageCompilerBuilder: {
      owner: record.manifest && record.manifest.compiler ? record.manifest.compiler.builderOwner : record.packageName,
      entry: loaded.entry,
      export: 'buildAssetsCompiledWasmSidecarPlan',
      trust: loaded.compiler && loaded.compiler.trust
    }
  });
}



function buildAssetsSidecarCompileLinkProof(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const { record, manifestRecords } = findAssetsManifestRecord(inputs);
  if (!record) {
    const error = new Error('Could not discover the package-owned @pulse-compute/assets PulseWasm manifest for sidecar compile/link proof.');
    error.diagnostics = [];
    throw error;
  }
  const loaded = loadLowerableCompilerBuilder(record);
  const builder = loaded.module && loaded.module.buildAssetsSidecarCompileLinkProof;
  if (typeof builder !== 'function') {
    const error = new Error('Package-owned assets compiler builder does not export buildAssetsSidecarCompileLinkProof.');
    error.diagnostics = [];
    throw error;
  }
  return builder({
    ...inputs,
    cwd,
    manifest: record.manifest,
    assetsManifest: record.manifest,
    manifestRecord: record,
    manifestRecords,
    packageDir: record.packageDir,
    packageCompilerBuilder: {
      owner: record.manifest && record.manifest.compiler ? record.manifest.compiler.builderOwner : record.packageName,
      entry: loaded.entry,
      export: 'buildAssetsSidecarCompileLinkProof',
      trust: loaded.compiler && loaded.compiler.trust
    }
  });
}

module.exports = {
  buildAssetsLoweringPlan,
  buildAssetsCompiledWasmSidecarPlan,
  buildAssetsSidecarCompileLinkProof,
  findAssetsManifestRecord,
  phaseName
};
