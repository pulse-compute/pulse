'use strict';

const nodeAdapter = require('./node-adapter.js');
const assetsProviderProof = require('./assets-provider-proof.js');
const nodeCompiledWasmAssetsLifecycleProof = require('./node-compiled-wasm-assets-lifecycle-proof.js');
const routeHandlerEffectProof = require('./route-handler-effect-proof.js');
const routeHandlerLiveOriginProof = require('./route-handler-live-origin-proof.js');
const routeHandlerCompiledWasmBridge = require('./route-handler-compiled-wasm-bridge.js');
const requestJsonBodyProof = require('./request-json-body-proof.js');
const schemaDecodeResultProof = require('./schema-decode-result-proof.js');
const schemaResponseCodecProof = require('./schema-response-codec-proof.js');
const backendJsonRequestBodyProof = require('./backend-json-request-body-proof.js');

module.exports = {
  nodeAdapter,
  assetsProviderProof,
  nodeCompiledWasmAssetsLifecycleProof,
  routeHandlerEffectProof,
  routeHandlerLiveOriginProof,
  routeHandlerCompiledWasmBridge,
  requestJsonBodyProof,
  schemaDecodeResultProof,
  schemaResponseCodecProof,
  backendJsonRequestBodyProof,
  buildNodeAdapter: nodeAdapter.buildNodeAdapter,
  buildNodeAdapterSource: nodeAdapter.buildNodeAdapterSource,
  buildNodeAssetsProviderProof: assetsProviderProof.buildNodeAssetsProviderProof,
  buildNodeCompiledWasmAssetsLifecycleProof: nodeCompiledWasmAssetsLifecycleProof.buildNodeCompiledWasmAssetsLifecycleProof,
  buildNodeRouteHandlerEffectProof: routeHandlerEffectProof.buildNodeRouteHandlerEffectProof,
  buildNodeLiveOriginRouteHandlerEffectProof: routeHandlerLiveOriginProof.buildNodeLiveOriginRouteHandlerEffectProof,
  buildNodeCompiledRouteHandlerEffectBridge: routeHandlerCompiledWasmBridge.buildNodeCompiledRouteHandlerEffectBridge,
  buildNodeRequestJsonBodyProof: requestJsonBodyProof.buildNodeRequestJsonBodyProof,
  buildNodeSchemaDecodeResultProof: schemaDecodeResultProof.buildNodeSchemaDecodeResultProof,
  buildNodeSchemaResponseCodecProof: schemaResponseCodecProof.buildNodeSchemaResponseCodecProof,
  buildNodeBackendJsonRequestBodyProof: backendJsonRequestBodyProof.buildNodeBackendJsonRequestBodyProof,
  buildNodeCompiledWasmRouteHandlerEffectBridge: routeHandlerCompiledWasmBridge.buildNodeCompiledWasmRouteHandlerEffectBridge,
  NODE_ADAPTER_VERSION: nodeAdapter.NODE_ADAPTER_VERSION
};
