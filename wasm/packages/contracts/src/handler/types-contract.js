'use strict';

const { HANDLER_SURFACE_DEFINITIONS, HANDLER_SURFACE_CONTRACT_VERSION } = require('./surface-contract.js');

const HANDLER_TYPES_CONTRACT_VERSION = 'pulse.handler-types.v4';
const RUNTIME_AUTHORING_VERSION = 'pulse.runtime-authoring.v4';

function defaultHandlerTypesContract() {
  return Object.freeze({
    version: HANDLER_TYPES_CONTRACT_VERSION,
    runtimeVersion: RUNTIME_AUTHORING_VERSION,
    handlerSurfaceVersion: HANDLER_SURFACE_CONTRACT_VERSION,
    surfaceCount: HANDLER_SURFACE_DEFINITIONS.length,
    handlersAsyncShaped: true,
    pulseEffectsPromiseCompatible: true,
    routerNextTerminal: true,
    ctxState: Object.freeze({
      shape: 'execution-local-string-map',
      get: 'string | undefined',
      set: 'void'
    }),
    executionContexts: Object.freeze({
      shared: Object.freeze(['state', 'log', 'time', 'fetch', 'parallel', 'config', 'secret', 'kv', 'emit', 'encodeJson', 'decodeJson']),
      http: Object.freeze(['req', 'json', 'text', 'response']),
      route: Object.freeze(['param']),
      event: Object.freeze(['event.type', 'event.payload']),
      emitPublished: true
    }),
    compiler: Object.freeze({
      acceptsAsyncHandlers: true,
      acceptsAwait: true,
      acceptsEventHandlers: true,
      eventEmitRecognition: true,
      eventEmitNativeLowering: false,
      awaitAuthority: 'ctx-surface-classification',
      enablementWave: 'sprint1-wave2'
    }),
    native: Object.freeze({
      runtimeChanged: true,
      promiseRuntimeAdded: false,
      asyncifyAdded: false,
      eventEntryImplemented: false
    })
  });
}

module.exports = Object.freeze({
  HANDLER_TYPES_CONTRACT_VERSION,
  RUNTIME_AUTHORING_VERSION,
  defaultHandlerTypesContract
});
