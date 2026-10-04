'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');

// Compatibility proof commands are optional and never loaded by plain compile,
// help or version. The caller supplies its project/CLI composition root.
function createProviderProofs(root = process.cwd()) {
  const load = createRequire(path.join(path.resolve(root), 'package.json'));
  return Object.freeze({
    buildNodeAdapter: (...args) => load('@pulse-compute/provider-node/compiler').buildNodeAdapter(...args),
    buildNodeAssetsProviderProof: (...args) => load('@pulse-compute/provider-node/compiler').buildNodeAssetsProviderProof(...args),
    buildNodeCompiledWasmAssetsLifecycleProof: (...args) => load('@pulse-compute/provider-node/compiler').buildNodeCompiledWasmAssetsLifecycleProof(...args),
    buildNodeRouteHandlerEffectProof: (...args) => load('@pulse-compute/provider-node/compiler').buildNodeRouteHandlerEffectProof(...args),
    buildNodeRequestJsonBodyProof: (...args) => load('@pulse-compute/provider-node/compiler').buildNodeRequestJsonBodyProof(...args),
    buildNodeSchemaDecodeResultProof: (...args) => load('@pulse-compute/provider-node/compiler').buildNodeSchemaDecodeResultProof(...args),
    buildNodeSchemaResponseCodecProof: (...args) => load('@pulse-compute/provider-node/compiler').buildNodeSchemaResponseCodecProof(...args),
    buildFastlyReadiness: (...args) => load('@pulse-compute/provider-fastly/compiler').buildFastlyReadiness(...args),
    buildFastlyHostcallBinding: (...args) => load('@pulse-compute/provider-fastly/compiler').buildFastlyHostcallBinding(...args),
    buildFastlyStreamHeaderAdapter: (...args) => load('@pulse-compute/provider-fastly/compiler').buildFastlyStreamHeaderAdapter(...args),
    buildFastlyCommandEntry: (...args) => load('@pulse-compute/provider-fastly/compiler').buildFastlyCommandEntry(...args),
    buildFastlyAssetsProviderProof: (...args) => load('@pulse-compute/provider-fastly/compiler').buildFastlyAssetsProviderProof(...args),
    buildFastlyAssetsPackageOutParityProof: (...args) => load('@pulse-compute/provider-fastly/compiler').buildFastlyAssetsPackageOutParityProof(...args),
    buildFastlyRouteHandlerEffectProof: (...args) => load('@pulse-compute/provider-fastly/compiler').buildFastlyRouteHandlerEffectProof(...args),
    buildFastlyLifecycleParityProof: (...args) => load('@pulse-compute/provider-fastly/compiler').buildFastlyLifecycleParityProof(...args),
    buildNodeLiveOriginRouteHandlerEffectProof: (...args) => load('@pulse-compute/provider-node/compiler/route-handler-live-origin-proof').buildNodeLiveOriginRouteHandlerEffectProof(...args),
    buildNodeCompiledRouteHandlerEffectBridge: (...args) => load('@pulse-compute/provider-node/compiler/route-handler-compiled-wasm-bridge').buildNodeCompiledRouteHandlerEffectBridge(...args),
    buildNodeBackendJsonRequestBodyProof: (...args) => load('@pulse-compute/provider-node/compiler/backend-json-request-body-proof').buildNodeBackendJsonRequestBodyProof(...args),
  });
}

module.exports = { createProviderProofs };
