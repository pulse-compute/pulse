'use strict';

const path = require('node:path');

function loadGuestUnitStage() {
  try {
    return require('@pulse-compute/wasm-guest-link/stage');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../wasm-guest-link/src/stage.js');
    }
    throw error;
  }
}

function loadPackageContract() {
  try {
    return require('@pulse-compute/wasm-contracts/package/package-contract');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../contracts/src/package/package-contract.js');
    }
    throw error;
  }
}

const guestUnitStage = loadGuestUnitStage();
const {
  GUEST_UNIT_CONTRIBUTION_FIELDS,
  normalizeCanonicalGuestUnitContribution
} = loadPackageContract();

function optimizationPosture(value) {
  if (value === undefined || value === null || value === false) return 'native-default';
  if (
    value === 'experimental-native-bounded-size'
    || (value && typeof value === 'object' && value.mode === 'experimental-native-bounded-size')
  ) return 'native-default';
  if (
    value === true
    || value === 'experimental-native-size'
    || (value && typeof value === 'object' && value.mode === 'experimental-native-size')
  ) return 'native-size';
  const error = new Error(`Unsupported Native guest-link optimization mode ${String(value && value.mode || value)}.`);
  error.code = 'PULSE_GUEST_OPTIMIZATION_FAILED';
  throw error;
}

function canonicalContribution(selection) {
  return normalizeCanonicalGuestUnitContribution(Object.fromEntries(
    GUEST_UNIT_CONTRIBUTION_FIELDS.map((field) => [field, selection && selection[field]])
  ));
}

function realizeSelectedGuestUnits(realization, guestUnits, options = {}) {
  const selected = Array.isArray(guestUnits) ? guestUnits : [];
  if (selected.length === 0) return realization;
  const result = guestUnitStage.realizeGuestLinkStage({
    version: guestUnitStage.GUEST_LINK_STAGE_INVOCATION_VERSION,
    primaryWasm: realization && realization.wasm,
    guestUnits: selected.map((selection) => Object.freeze({
      contribution: canonicalContribution(selection),
      packageRoot: selection && selection.packageRoot
    })),
    projectRoot: path.resolve(options.projectRoot || options.cwd || process.cwd()),
    profile: String(options.profile || 'native'),
    finalWasmPolicy: options.targetDescriptor && options.targetDescriptor.finalWasmPolicy,
    synchronizedPackages: options.synchronizedPackages,
    optimizationPosture: optimizationPosture(options.nativeOptimization)
  });
  return Object.freeze({
    ...realization,
    wasm: result.wasm,
    // Guest linking retains its mandatory independent disassembly audit.
    // Only an explicitly requested diagnostic becomes an output artifact.
    wat: realization.textEmitted ? result.wat : '',
    // Preserve trusted package roots for subsequent provider-specific linking.
    guestUnits: Object.freeze(result.guestUnits.map(unit => Object.freeze({
      ...unit, packageRoot: selected.find(selection => selection.id === unit.id).packageRoot
    }))),
    guestLink: Object.freeze({
      version: result.version,
      plan: result.plan,
      report: result.report,
      audit: result.audit,
      materialization: result.materialization,
      finalArtifact: result.finalArtifact,
      providerPackaging: result.providerPackaging,
      fallback: result.fallback
    })
  });
}

module.exports = Object.freeze({
  realizeSelectedGuestUnits
});
