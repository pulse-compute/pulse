'use strict';

const compiler = require('./compiler/index.js');

module.exports = {
  compiler,
  assemblyscriptCompile: require('@pulse-compute/wasm-build-support/assemblyscript-compile'),
  assemblyscriptCore: compiler.assemblyscriptCore,
  assemblyscriptShape: compiler.assemblyscriptShape,
  assemblyscriptWasmSmoke: compiler.assemblyscriptWasmSmoke,
  compiledHandlers: compiler.compiledHandlers,
  integratedCompiledApp: compiler.integratedCompiledApp,
  routeHandlerEffects: compiler.routeHandlerEffects,
  routeHandlerContext: compiler.routeHandlerContext,
  routeHandlerContextLowering: compiler.routeHandlerContextLowering,
  handlerIoLifecycle: compiler.handlerIoLifecycle,
  requestJsonBody: compiler.requestJsonBody,
  schemaDecodeResult: compiler.schemaDecodeResult,
  schemaResponseCodec: compiler.schemaResponseCodec,
  backendJsonRequestBody: compiler.backendJsonRequestBody,
  canonicalNative: compiler.canonicalNative,
  buildAssemblyScriptCore: compiler.buildAssemblyScriptCore,
  buildAssemblyScriptShape: compiler.buildAssemblyScriptShape,
  buildAssemblyScriptWasmSmoke: compiler.buildAssemblyScriptWasmSmoke,
  buildCompiledUserHandlers: compiler.buildCompiledUserHandlers,
  buildIntegratedCompiledApp: compiler.buildIntegratedCompiledApp,
  buildRouteHandlerEffectPlan: compiler.buildRouteHandlerEffectPlan,
  buildRouteHandlerContextPlan: compiler.buildRouteHandlerContextPlan,
  buildRouteHandlerContextLoweringPlan: compiler.buildRouteHandlerContextLoweringPlan,
  buildHandlerIoLifecyclePlan: compiler.buildHandlerIoLifecyclePlan,
  buildRequestJsonBodyPlan: compiler.buildRequestJsonBodyPlan,
  buildSchemaDecodeResultPlan: compiler.buildSchemaDecodeResultPlan,
  buildSchemaResponseCodecPlan: compiler.buildSchemaResponseCodecPlan,
  buildBackendJsonRequestBodyPlan: compiler.buildBackendJsonRequestBodyPlan,
  generateCanonicalNativeAssemblyScript: compiler.generateCanonicalNativeAssemblyScript
};
