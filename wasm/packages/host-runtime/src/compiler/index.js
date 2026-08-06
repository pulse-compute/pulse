'use strict';

const wasmHostAbi = require('./wasm-host-abi.js');
const wasmHostBridge = require('./wasm-host-bridge.js');
const requestResultHeaders = require('./request-result-headers.js');
const channelBroadcaster = require('./channel-broadcaster.js');
const jsonBody = require('./json-body.js');
const backendCapabilities = require('./backend-capabilities.js');
const hostRuntimeKernel = require('./host-runtime-kernel.js');
const streamingPassthrough = require('./streaming-passthrough.js');
const compiledWasmRuntime = require('./compiled-wasm-runtime.js');

module.exports = {
  wasmHostAbi,
  wasmHostBridge,
  requestResultHeaders,
  channelBroadcaster,
  jsonBody,
  backendCapabilities,
  hostRuntimeKernel,
  streamingPassthrough,
  compiledWasmRuntime,
  buildWasmHostAbi: wasmHostAbi.buildWasmHostAbi,
  buildWasmHostBridge: wasmHostBridge.buildWasmHostBridge,
  buildRequestResultHeaders: requestResultHeaders.buildRequestResultHeaders,
  buildChannelBroadcaster: channelBroadcaster.buildChannelBroadcaster,
  buildJsonBodyAbi: jsonBody.buildJsonBodyAbi,
  buildDeploymentPosture: jsonBody.buildDeploymentPosture,
  buildBackendCapabilities: backendCapabilities.buildBackendCapabilities,
  buildHostRuntimeKernel: hostRuntimeKernel.buildHostRuntimeKernel,
  buildStreamingPassthrough: streamingPassthrough.buildStreamingPassthrough,
  buildCompiledWasmRuntime: compiledWasmRuntime.buildCompiledWasmRuntime
};
