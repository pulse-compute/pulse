'use strict';

function loadContractsHandlerRoles() {
  try {
    return require('@pulse-compute/wasm-contracts/definitions/handler-roles');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/definitions/handler-roles.js');
    }
    throw error;
  }
}

module.exports = loadContractsHandlerRoles();
