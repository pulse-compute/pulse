'use strict';

const assetsProvider = require('./assets-provider.js');
const routeHandlerEffects = require('./route-handler-effects.js');
const providerPrimitives = require('./provider-primitives.js');
const canonicalApiRuntime = require('./canonical-api-runtime.js');

module.exports = {
  assetsProvider,
  routeHandlerEffects,
  providerPrimitives,
  canonicalApiRuntime,
  createFastlyAssetsProvider: assetsProvider.createFastlyAssetsProvider,
  createDefaultStoresFromPlan: assetsProvider.createDefaultStoresFromPlan,
  buildFastlyAssetsProviderConfig: assetsProvider.buildFastlyAssetsProviderConfig,
  normalizeHeaders: assetsProvider.normalizeHeaders,
  normalizeFastlyPath: assetsProvider.normalizeFastlyPath,
  createFastlyRouteHandlerEffectProvider: routeHandlerEffects.createFastlyRouteHandlerEffectProvider,
  createFastlyRouteEffectProvider: routeHandlerEffects.createFastlyRouteEffectProvider,
  createFastlyRouteEffectContinuationContext: routeHandlerEffects.createFastlyRouteEffectContinuationContext,
  createDefaultRouteEffectBackendsFromPlan: routeHandlerEffects.createDefaultBackendsFromPlan,
  buildFastlyRouteEffectProviderConfig: routeHandlerEffects.buildFastlyRouteEffectProviderConfig,
  buildFastlyRouteHandlerEffectProviderConfig: routeHandlerEffects.buildFastlyRouteHandlerEffectProviderConfig,
  createFastlyProviderPrimitiveSurface: providerPrimitives.createFastlyProviderPrimitiveSurface,
  buildFastlyProviderPrimitiveManifest: providerPrimitives.buildFastlyProviderPrimitiveManifest,
  createCanonicalFastlyRuntime: canonicalApiRuntime.createCanonicalFastlyRuntime,
  executeCanonicalProgram: canonicalApiRuntime.executeCanonicalProgram
};
