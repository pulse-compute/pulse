'use strict';

function loadContractsDiagnosticReporter() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics/reporter');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/diagnostics/reporter.js');
    }
    throw error;
  }
}

module.exports = loadContractsDiagnosticReporter();
