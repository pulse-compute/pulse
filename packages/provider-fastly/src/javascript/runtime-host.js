'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');
const {
  createFastlyJavascriptBindingCapabilities,
  withFastlyBindingCapabilities
} = require('./bindings-adapter.js');
const { createFastlyJavascriptFetchCapability, withFastlyFetchCapability } = require('./fetch-adapter.js');
const { createFastlyJavascriptAssetsLookup } = require('./assets-adapter.js');
const { createFastlyJavascriptGripBroadcast } = require('./grip-broadcast.js');
const { createFastlyJavascriptJwtVerify } = require('./jwt-verifier.js');
const { withFastlyPackageEffectCapabilities } = require('./package-effects.js');
const { createFastlyJavascriptLogEmitter } = require('./logging.js');

const FASTLY_JAVASCRIPT_RUNTIME_HOST_VERSION = 'pulse.fastly-javascript-runtime-host.v1';

function isFastlyJavascriptApplication(value) {
  return runtimeHost.isRouterApplication(value) || typeof value === 'function';
}

function assertFastlyJavascriptApplication(value) {
  return runtimeHost.normalizeApplication(value);
}

function createFastlyJavascriptCapabilities(options = {}) {
  const bindingCapabilities = createFastlyJavascriptBindingCapabilities(options);
  const assetsLookup = createFastlyJavascriptAssetsLookup(options);
  const jwtVerify = createFastlyJavascriptJwtVerify({
    captureWallClock: options.jwtCaptureWallClock,
    secretLookup: bindingCapabilities.secret
  });
  const grip = options.bindings && options.bindings.grip;
  let configuredGripBroadcast;
  const gripBroadcast = grip && (grip.publishEndpoint || grip.publishUrl)
    ? (payload, execution) => {
        if (!configuredGripBroadcast) {
          configuredGripBroadcast = createFastlyJavascriptGripBroadcast({
            ...options,
            grip,
            secretLookup: bindingCapabilities.secret
          });
        }
        return configuredGripBroadcast(payload, execution);
      }
    : undefined;
  return withFastlyPackageEffectCapabilities(
    withFastlyFetchCapability(
      withFastlyBindingCapabilities(options.capabilities, { ...options, bindingCapabilities }),
      { ...options, fetchImplementation: options.fetchImplementation }
    ),
    { assetsLookup, gripBroadcast, jwtVerify }
  );
}

function requestHeaderPairs(request) {
  return Object.freeze(Array.from(request.headers.entries(), ([name, value]) => Object.freeze([name, value])));
}

async function executeFastlyJavascriptApplication(application, request, options = {}) {
  const capabilities = options.effectAdapter === undefined
    ? createFastlyJavascriptCapabilities(options)
    : undefined;
  return runtimeHost.executeApplication(assertFastlyJavascriptApplication(application), request, {
    capabilities,
    effectAdapter: options.effectAdapter,
    application: options.application,
    requestHeaders: options.requestHeaders || requestHeaderPairs(request),
    signal: options.signal || request.signal,
    maxEffects: options.maxEffects,
    maxRequestBodyBytes: options.maxRequestBodyBytes,
    maxFetchBodyBytes: options.maxFetchBodyBytes,
    maxStructuredBodyBytes: options.maxStructuredBodyBytes,
    maxBindingNameBytes: options.maxBindingNameBytes,
    maxBindingValueBytes: options.maxBindingValueBytes,
    maxKvNamespaceBytes: options.maxKvNamespaceBytes,
    maxKvKeyBytes: options.maxKvKeyBytes,
    maxKvValueBytes: options.maxKvValueBytes,
    maxKvValueDepth: options.maxKvValueDepth,
    maxKvValueEntries: options.maxKvValueEntries,
    schemaCodecs: options.schemaCodecs,
    strict: options.strict === true,
    target: 'javascript',
    provider: 'fastly',
    reporting: options.reporting,
    log: options.log || createFastlyJavascriptLogEmitter({ console: options.console }),
    redactionValues: options.redactionValues,
    onLogObservation: options.onLogObservation,
    onJsonTrace: options.onJsonTrace,
    onEffectObservation: options.onEffectObservation,
    onEffectSummary: options.onEffectSummary
  });
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_RUNTIME_HOST_VERSION,
  PulseRuntimeContractError: runtimeHost.PulseRuntimeContractError,
  createFastlyJavascriptAssetsLookup,
  createFastlyJavascriptBindingCapabilities,
  createFastlyJavascriptCapabilities,
  createFastlyJavascriptFetchCapability,
  createFastlyJavascriptGripBroadcast,
  createFastlyJavascriptJwtVerify,
  createFastlyJavascriptLogEmitter,
  assertFastlyJavascriptApplication,
  executeFastlyJavascriptApplication,
  isFastlyJavascriptApplication,
  requestHeaderPairs
});
