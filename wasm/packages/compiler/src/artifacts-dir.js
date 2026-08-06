'use strict';

const path = require('node:path');
const support = require('@pulse-compute/wasm-build-support/artifacts-dir');

function getCompilerPackageRoot() {
  return path.resolve(__dirname, '..');
}

module.exports = {
  ...support,
  getCompilerPackageRoot
};
