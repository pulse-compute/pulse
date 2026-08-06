'use strict';

function loadContractsPathGrammar() {
  try {
    return require('@pulse-compute/wasm-contracts/definitions/path-grammar');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/definitions/path-grammar.js');
    }
    throw error;
  }
}

module.exports = loadContractsPathGrammar();
