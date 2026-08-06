'use strict';

const node = require('@pulse-compute/provider-node/compiler');
const fastly = require('@pulse-compute/provider-fastly/compiler');
const {
  buildNodeLiveOriginRouteHandlerEffectProof
} = require('@pulse-compute/provider-node/compiler/route-handler-live-origin-proof');
const {
  buildNodeCompiledRouteHandlerEffectBridge
} = require('@pulse-compute/provider-node/compiler/route-handler-compiled-wasm-bridge');
const {
  buildNodeBackendJsonRequestBodyProof
} = require('@pulse-compute/provider-node/compiler/backend-json-request-body-proof');

module.exports = Object.freeze({
  buildNodeAdapter: node.buildNodeAdapter,
  buildNodeAssetsProviderProof: node.buildNodeAssetsProviderProof,
  buildNodeCompiledWasmAssetsLifecycleProof: node.buildNodeCompiledWasmAssetsLifecycleProof,
  buildNodeRouteHandlerEffectProof: node.buildNodeRouteHandlerEffectProof,
  buildNodeRequestJsonBodyProof: node.buildNodeRequestJsonBodyProof,
  buildNodeSchemaDecodeResultProof: node.buildNodeSchemaDecodeResultProof,
  buildNodeSchemaResponseCodecProof: node.buildNodeSchemaResponseCodecProof,
  buildNodeLiveOriginRouteHandlerEffectProof,
  buildNodeCompiledRouteHandlerEffectBridge,
  buildNodeBackendJsonRequestBodyProof,
  buildFastlyReadiness: fastly.buildFastlyReadiness,
  buildFastlyHostcallBinding: fastly.buildFastlyHostcallBinding,
  buildFastlyStreamHeaderAdapter: fastly.buildFastlyStreamHeaderAdapter,
  buildFastlyCommandEntry: fastly.buildFastlyCommandEntry,
  buildFastlyAssetsProviderProof: fastly.buildFastlyAssetsProviderProof,
  buildFastlyAssetsPackageOutParityProof: fastly.buildFastlyAssetsPackageOutParityProof,
  buildFastlyRouteHandlerEffectProof: fastly.buildFastlyRouteHandlerEffectProof,
  buildFastlyLifecycleParityProof: fastly.buildFastlyLifecycleParityProof
});
