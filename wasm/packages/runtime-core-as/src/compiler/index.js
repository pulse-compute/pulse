'use strict';

const assemblyscriptCore = require('./assemblyscript-core.js');
const assemblyscriptShape = require('./assemblyscript-shape.js');
const assemblyscriptWasmSmoke = require('./assemblyscript-wasm-smoke.js');
const compiledHandlers = require('./compiled-handlers.js');
const integratedCompiledApp = require('./integrated-compiled-app.js');
const routeHandlerEffects = require('./route-handler-effects.js');
const routeHandlerContext = require('./route-handler-context.js');
const handlerIoLifecycle = require('./handler-io-lifecycle.js');
const requestJsonBody = require('./request-json-body.js');
const schemaDecodeResult = require('./schema-decode-result.js');
const schemaResponseCodec = require('./schema-response-codec.js');
const backendJsonRequestBody = require('./backend-json-request-body.js');
const canonicalNative = require('./canonical-native.js');

module.exports = {
  assemblyscriptCore,
  assemblyscriptShape,
  assemblyscriptWasmSmoke,
  compiledHandlers,
  integratedCompiledApp,
  routeHandlerEffects,
  routeHandlerContext,
  routeHandlerContextLowering: routeHandlerContext,
  handlerIoLifecycle,
  requestJsonBody,
  schemaDecodeResult,
  schemaResponseCodec,
  backendJsonRequestBody,
  canonicalNative,
  buildAssemblyScriptCore: assemblyscriptCore.buildAssemblyScriptCore,
  buildAssemblyScriptShape: assemblyscriptShape.buildAssemblyScriptShape,
  buildAssemblyScriptWasmSmoke: assemblyscriptWasmSmoke.buildAssemblyScriptWasmSmoke,
  buildCompiledUserHandlers: compiledHandlers.buildCompiledUserHandlers,
  buildIntegratedCompiledApp: integratedCompiledApp.buildIntegratedCompiledApp,
  buildRouteHandlerEffectPlan: routeHandlerEffects.buildRouteHandlerEffectPlan,
  buildRouteHandlerContextPlan: routeHandlerContext.buildRouteHandlerContextPlan,
  buildRouteHandlerContextLoweringPlan: routeHandlerContext.buildRouteHandlerContextLoweringPlan,
  buildHandlerIoLifecyclePlan: handlerIoLifecycle.buildHandlerIoLifecyclePlan,
  buildRequestJsonBodyPlan: requestJsonBody.buildRequestJsonBodyPlan,
  buildSchemaDecodeResultPlan: schemaDecodeResult.buildSchemaDecodeResultPlan,
  buildSchemaResponseCodecPlan: schemaResponseCodec.buildSchemaResponseCodecPlan,
  buildBackendJsonRequestBodyPlan: backendJsonRequestBody.buildBackendJsonRequestBodyPlan,
  generateCanonicalNativeAssemblyScript: canonicalNative.generateCanonicalNativeAssemblyScript
};
