'use strict';

function loadContractsStableId() {
  try {
    return require('@pulse-compute/wasm-contracts/stable-id');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../contracts/src/stable-id.js');
    }
    throw error;
  }
}

module.exports = loadContractsStableId();
