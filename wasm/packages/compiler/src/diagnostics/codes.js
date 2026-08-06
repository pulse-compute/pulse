'use strict';

function loadContractsDiagnosticCodes() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics/codes');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/diagnostics/codes.js');
    }
    throw error;
  }
}

module.exports = loadContractsDiagnosticCodes();
