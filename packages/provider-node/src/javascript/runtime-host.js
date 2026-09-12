'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');
const {
  createNodeJavascriptBindingCapabilities,
  nodeJavascriptRedactionValues,
  withNodeBindingCapabilities
} = require('./bindings-adapter.js');
const { createNodeJavascriptFixtureFetch, withNodeFetchCapability } = require('./fetch-adapter.js');
const { createNodeJavascriptAssetsLookup } = require('./assets-adapter.js');
const { createNodeJavascriptGripBroadcast } = require('./grip-broadcast.js');
const { createNodeJavascriptJwtVerify } = require('./jwt-verifier.js');
const { createNodeJavascriptS3 } = require('./s3.js');
const { createNodeJavascriptPackageEffectCapabilities, withNodePackageEffectCapabilities } = require('./package-effects.js');
const { NODE_JAVASCRIPT_TARGET_DESCRIPTOR } = require('./target.js');

const NODE_JAVASCRIPT_RUNTIME_HOST_VERSION = 'pulse.node-javascript-runtime-host.v2';

function isNodeJavascriptApplication(value) {
  return runtimeHost.isRouterApplication(value) || typeof value === 'function';
}

function assertNodeJavascriptApplication(value) {
  return runtimeHost.normalizeApplication(value);
}

function nodeJavascriptProviderCapabilities(options) {
  if (options.effectAdapter !== undefined) {
    if (options.eventAdapter !== undefined) {
      throw new TypeError('Pulse Node JavaScript execution cannot combine effectAdapter and eventAdapter.');
    }
    return undefined;
  }
  const bindingOptions = {
    ...(Object.prototype.hasOwnProperty.call(options, 'config') ? { config: options.config } : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'secrets') ? { secrets: options.secrets } : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'kv') ? { kv: options.kv } : {}),
    maxBindingNameBytes: options.maxBindingNameBytes,
    maxBindingValueBytes: options.maxBindingValueBytes,
    maxKvNamespaceBytes: options.maxKvNamespaceBytes,
    maxKvKeyBytes: options.maxKvKeyBytes,
    maxKvValueBytes: options.maxKvValueBytes,
    maxKvValueDepth: options.maxKvValueDepth,
    maxKvValueEntries: options.maxKvValueEntries
  };
  const bindingCapabilities = withNodeBindingCapabilities(options.capabilities, bindingOptions);
  const configuredGripBroadcast = options.gripBroadcast
    || (options.grip && options.grip.broadcast)
    || (options.grip && options.grip.publishEndpoint
      ? createNodeJavascriptGripBroadcast({
          ...options.grip,
          fetchImplementation: options.gripFetchImplementation || options.fetchImplementation,
          secretLookup: bindingCapabilities && bindingCapabilities.secret
        })
      : undefined);
  const configuredAssetsLookup = options.assetsLookup
    || (bindingCapabilities && createNodeJavascriptAssetsLookup(bindingCapabilities));
  const configuredJwtVerify = bindingCapabilities
    && createNodeJavascriptJwtVerify({
      captureWallClock: options.jwtCaptureWallClock,
      secretLookup: bindingCapabilities.secret
    });
  const capabilities = withNodePackageEffectCapabilities(
    withNodeFetchCapability(bindingCapabilities, { fetchImplementation: options.fetchImplementation }),
    {
      assetsLookup: configuredAssetsLookup,
      gripBroadcast: configuredGripBroadcast,
      jwtVerify: configuredJwtVerify,
      s3: createNodeJavascriptS3(options, bindingCapabilities.secret),
      assets: options.assets,
      grip: options.grip
    }
  );
  if (options.eventAdapter === undefined) return capabilities;
  if (!options.eventAdapter || typeof options.eventAdapter.acceptOutbound !== 'function') {
    throw new TypeError('Pulse Node JavaScript eventAdapter must expose acceptOutbound(frame, execution).');
  }
  return Object.freeze({
    ...capabilities,
    emit(frame, execution) { return options.eventAdapter.acceptOutbound(frame, execution); }
  });
}

async function executeNodeJavascriptApplication(application, request, options = {}) {
  const capabilities = nodeJavascriptProviderCapabilities(options);
  return runtimeHost.executeApplication(assertNodeJavascriptApplication(application), request, {
    capabilities,
    effectAdapter: options.effectAdapter,
    application: options.application,
    requestHeaders: options.requestHeaders,
    signal: options.signal,
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
    provider: options.provider || 'node',
    reporting: options.reporting,
    log: options.log,
    redactionValues: nodeJavascriptRedactionValues(options),
    onLogObservation: options.onLogObservation,
    onJsonTrace: options.onJsonTrace,
    onEffectObservation: options.onEffectObservation,
    onEffectSummary: options.onEffectSummary
  });
}

async function executeNodeJavascriptEvent(application, frame, options = {}) {
  return runtimeHost.executeEvent(assertNodeJavascriptApplication(application), frame, {
    capabilities: nodeJavascriptProviderCapabilities(options),
    effectAdapter: options.effectAdapter,
    application: options.application,
    signal: options.signal,
    maxEffects: options.maxEffects,
    maxBindingNameBytes: options.maxBindingNameBytes,
    maxBindingValueBytes: options.maxBindingValueBytes,
    maxKvNamespaceBytes: options.maxKvNamespaceBytes,
    maxKvKeyBytes: options.maxKvKeyBytes,
    maxKvValueBytes: options.maxKvValueBytes,
    maxKvValueDepth: options.maxKvValueDepth,
    maxKvValueEntries: options.maxKvValueEntries,
    eventLimits: options.eventLimits,
    schemaCodecs: options.schemaCodecs,
    strict: true,
    target: 'javascript',
    provider: options.provider || 'node',
    reporting: options.reporting,
    redactionValues: nodeJavascriptRedactionValues(options),
    onLogObservation: options.onLogObservation,
    onEffectObservation: options.onEffectObservation,
    onEffectSummary: options.onEffectSummary
  });
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_RUNTIME_HOST_VERSION,
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR,
  PulseRuntimeContractError: runtimeHost.PulseRuntimeContractError,
  PulseUnhandledError: runtimeHost.PulseUnhandledError,
  JAVASCRIPT_EFFECT_PROTOCOL_VERSION: runtimeHost.JAVASCRIPT_EFFECT_PROTOCOL_VERSION,
  JAVASCRIPT_EFFECT_ADAPTER_VERSION: runtimeHost.JAVASCRIPT_EFFECT_ADAPTER_VERSION,
  JAVASCRIPT_EFFECT_OBSERVATION_VERSION: runtimeHost.JAVASCRIPT_EFFECT_OBSERVATION_VERSION,
  createJavascriptEffectAdapter: runtimeHost.createJavascriptEffectAdapter,
  createNodeJavascriptAssetsLookup,
  createNodeJavascriptBindingCapabilities,
  createNodeJavascriptFixtureFetch,
  createNodeJavascriptGripBroadcast,
  createNodeJavascriptJwtVerify,
  createNodeJavascriptPackageEffectCapabilities,
  createCapabilityEffectAdapter: runtimeHost.createCapabilityEffectAdapter,
  isPulseJavascriptEffect: runtimeHost.isPulseJavascriptEffect,
  assertNodeJavascriptApplication,
  createOpaqueFetchResponse: runtimeHost.createOpaqueFetchResponse,
  executeNodeJavascriptApplication,
  executeNodeJavascriptEvent,
  isNodeJavascriptApplication,
  wrapStructuredResponse: runtimeHost.wrapStructuredResponse
});
