'use strict';

const {
  discoverLowerableLibraryManifests,
  loadLowerableCompilerBuilder,
  resolveDefaultLibraryContracts,
  invokeLowerableCompilerBuilder
} = require('./handler-library-contracts.js');

function findLowerableManifestRecord(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const manifestRecords = Array.isArray(inputs.manifestRecords) && inputs.manifestRecords.length > 0
    ? inputs.manifestRecords
    : discoverLowerableLibraryManifests({ cwd, workspaceRoot: inputs.workspaceRoot, scanNodeModules: inputs.scanNodeModules });
  const contractId = inputs.contractId;
  const npmPackage = inputs.npmPackage;
  const lowerableSubpath = inputs.lowerableSubpath;
  const record = manifestRecords.find((entry) => {
    const manifest = entry.manifest || {};
    if (contractId && manifest.contractId !== contractId) return false;
    if (npmPackage && manifest.npmPackage !== npmPackage) return false;
    if (lowerableSubpath && manifest.lowerableSubpath !== lowerableSubpath) return false;
    return true;
  });
  return { record, manifestRecords };
}

function buildPackageOwnedLoweringPlan(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const { record, manifestRecords } = findLowerableManifestRecord(inputs);
  if (!record) {
    const selector = inputs.contractId || inputs.npmPackage || inputs.lowerableSubpath || '<unspecified lowerable package>';
    const error = new Error(`Could not discover package-owned lowerable manifest for ${selector}.`);
    error.diagnostics = [];
    throw error;
  }
  const loaded = loadLowerableCompilerBuilder(record);
  const libraryContracts = Array.isArray(inputs.libraryContracts) && inputs.libraryContracts.length > 0
    ? inputs.libraryContracts
    : resolveDefaultLibraryContracts({ cwd, workspaceRoot: inputs.workspaceRoot });
  return invokeLowerableCompilerBuilder(loaded, record, libraryContracts, inputs);
}

module.exports = {
  findLowerableManifestRecord,
  buildPackageOwnedLoweringPlan
};
