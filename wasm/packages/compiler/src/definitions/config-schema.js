'use strict';

function loadContractsConfigSchema() {
  try {
    return require('@pulse-compute/wasm-contracts/definitions/config-schema');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/definitions/config-schema.js');
    }
    throw error;
  }
}

module.exports = loadContractsConfigSchema();
