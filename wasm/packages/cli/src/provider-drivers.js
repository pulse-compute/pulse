'use strict';

// Built-in packages belong to the CLI distribution, not the compiler core.
module.exports = require('@pulse-compute/wasm-compiler/provider-toolchain')
  .createProviderResolver({ builtinRoot: __dirname });
