'use strict';

const fastlyReadiness = require('./fastly-readiness.js');
const fastlyHostcallBinding = require('./fastly-hostcall-binding.js');
const fastlyAdapter = require('./fastly-adapter.js');
const fastlyCommandEntry = require('./fastly-command-entry.js');
const fastlyConfigSecretServe = require('./fastly-config-secret-serve.js');
const configProviderResolution = require('./config-provider-resolution.js');
const runtimeProviderKv = require('./runtime-provider-kv.js');
const assetsProviderProof = require('./assets-provider-proof.js');
const routeHandlerEffectProof = require('./route-handler-effect-proof.js');
const lifecycleParityProof = require('./lifecycle-parity-proof.js');
const assetsPackageOutParityProof = require('./assets-package-out-parity-proof.js');

module.exports = {
  fastlyReadiness,
  fastlyHostcallBinding,
  fastlyAdapter,
  fastlyCommandEntry,
  fastlyConfigSecretServe,
  configProviderResolution,
  runtimeProviderKv,
  assetsProviderProof,
  routeHandlerEffectProof,
  lifecycleParityProof,
  assetsPackageOutParityProof,
  buildFastlyReadiness: fastlyReadiness.buildFastlyReadiness,
  buildFastlyHostcallBinding: fastlyHostcallBinding.buildFastlyHostcallBinding,
  buildFastlyStreamHeaderAdapter: fastlyAdapter.buildFastlyStreamHeaderAdapter,
  buildFastlyCommandEntry: fastlyCommandEntry.buildFastlyCommandEntry,
  buildFastlyConfigSecretServe: fastlyConfigSecretServe.buildFastlyConfigSecretServe,
  buildConfigProviderResolution: configProviderResolution.buildConfigProviderResolution,
  createPulseRuntimeConfigProvider: configProviderResolution.createPulseRuntimeConfigProvider,
  buildRuntimeProviderKv: runtimeProviderKv.buildRuntimeProviderKv,
  buildKvAdapterIntegration: runtimeProviderKv.buildKvAdapterIntegration,
  buildFastlyAssetsProviderProof: assetsProviderProof.buildFastlyAssetsProviderProof,
  buildFastlyRouteHandlerEffectProof: routeHandlerEffectProof.buildFastlyRouteHandlerEffectProof,
  buildFastlyLifecycleParityProof: lifecycleParityProof.buildFastlyLifecycleParityProof,
  buildFastlyAssetsPackageOutParityProof: assetsPackageOutParityProof.buildFastlyAssetsPackageOutParityProof
};
