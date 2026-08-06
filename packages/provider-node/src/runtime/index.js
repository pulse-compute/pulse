'use strict';

const compiledWasmNodeAdapterKv = require('./compiled-wasm-node-adapter-kv.js');
const assetsProvider = require('./assets-provider.js');
const routeHandlerEffects = require('./route-handler-effects.js');
const canonicalApiRuntime = require('./canonical-api-runtime.js');

module.exports = {
  compiledWasmNodeAdapterKv,
  assetsProvider,
  routeHandlerEffects,
  canonicalApiRuntime,
  ...compiledWasmNodeAdapterKv,
  ...assetsProvider,
  ...routeHandlerEffects,
  ...canonicalApiRuntime
};
