'use strict';

function loadContractsPath() {
  try {
    return require('@pulse-compute/wasm-contracts/path');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../contracts/src/path.js');
    }
    throw error;
  }
}

module.exports = loadContractsPath();
