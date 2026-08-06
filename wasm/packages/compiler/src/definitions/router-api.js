'use strict';

function loadContractsRouterApi() {
  try {
    return require('@pulse-compute/wasm-contracts/definitions/router-api');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/definitions/router-api.js');
    }
    throw error;
  }
}

module.exports = loadContractsRouterApi();
