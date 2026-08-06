'use strict';

const compiledWasmHostRuntimeKv = require('./compiled-wasm-host-runtime-kv.js');
const kvProvider = require('./kv-provider.js');
const continuationRegistry = require('./continuation-registry.js');
const canonicalApiRuntime = require('./canonical-api-runtime.js');
const canonicalNativeHost = require('./canonical-native-host.js');

module.exports = {
  compiledWasmHostRuntimeKv,
  kvProvider,
  continuationRegistry,
  canonicalApiRuntime,
  canonicalNativeHost,
  ...canonicalApiRuntime,
  ...canonicalNativeHost,
  ...continuationRegistry,
  createPulseWasmCompiledHostRuntimeWithKv: compiledWasmHostRuntimeKv.createPulseWasmCompiledHostRuntimeWithKv,
  createKvProvider: kvProvider.createKvProvider,
  createKvError: kvProvider.createKvError,
  createNamespaceStore: kvProvider.createNamespaceStore
};
