'use strict';

const {
  PulseRuntimeContractError,
  PulseUnhandledError,
  createOpaqueFetchResponse,
  isPulseFetchResponse,
  markOpaqueResponse,
  responseBodyClass,
  executeRouter,
  routerEntries,
  wrapStructuredResponse
} = require('./internal/index.js');
const {
  JAVASCRIPT_EFFECT_PROTOCOL_VERSION,
  JAVASCRIPT_EFFECT_ADAPTER_VERSION,
  JAVASCRIPT_EFFECT_OBSERVATION_VERSION,
  createJavascriptEffectAdapter,
  createCapabilityEffectAdapter,
  createJavascriptEffectExecution,
  isPulseJavascriptEffect
} = require('./internal/effect-adapter.js');
const {
  cloneKvValue,
  normalizeBindingName,
  normalizeBindingValue,
  normalizeKvKey,
  normalizeKvNamespace,
  normalizeKvPutResult
} = require('./internal/bindings.js');
const { createRedactionState } = require('./internal/redaction.js');
const { executeEvent } = require('./internal/event-execution.js');
const {
  EVENT_ADAPTER_VERSION,
  EVENT_ADAPTER_SEMANTICS,
  EVENT_EMIT_CODES,
  createEventRecordingAdapter
} = require('./internal/event-emission.js');
const { responseHeaderPairs } = require('./internal/response.js');
const { Router } = require('./index.js');

const RUNTIME_HOST_API_VERSION = 'pulse.runtime-host.v3';

function isRouterApplication(value) {
  try {
    routerEntries(value);
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeApplication(value) {
  if (isRouterApplication(value)) return value;
  if (typeof value === 'function') {
    const router = new Router();
    router.use(async (ctx) => value(ctx));
    return router;
  }
  throw new PulseRuntimeContractError(
    'PULSE_RUNTIME_APPLICATION_EXPORT_INVALID',
    'Pulse JavaScript application modules must default-export a Router, Pulse application, or managed handler.'
  );
}

function assertRouterApplication(value) {
  if (!isRouterApplication(value)) {
    throw new PulseRuntimeContractError(
      'PULSE_RUNTIME_APPLICATION_EXPORT_INVALID',
      'Expected a Router or Pulse application.'
    );
  }
  return value;
}

async function executeApplication(application, request, options = {}) {
  return executeRouter(normalizeApplication(application), request, options);
}

module.exports = Object.freeze({
  ...require('./internal/time.js'),
  isApplicationError: require('./internal/errors.js').isApplicationError,
  ...require('./internal/conditional-kv.js'),
  RUNTIME_HOST_API_VERSION,
  JAVASCRIPT_EFFECT_PROTOCOL_VERSION,
  JAVASCRIPT_EFFECT_ADAPTER_VERSION,
  JAVASCRIPT_EFFECT_OBSERVATION_VERSION,
  EVENT_ADAPTER_VERSION,
  EVENT_ADAPTER_SEMANTICS,
  EVENT_EMIT_CODES,
  PulseRuntimeContractError,
  PulseUnhandledError,
  assertRouterApplication,
  cloneKvValue,
  createCapabilityEffectAdapter,
  createEventRecordingAdapter,
  createJavascriptEffectAdapter,
  createJavascriptEffectExecution,
  createRedactionState,
  createOpaqueFetchResponse,
  executeApplication,
  executeEvent,
  executeRouter,
  isPulseFetchResponse,
  isPulseJavascriptEffect,
  isRouterApplication,
  markOpaqueResponse,
  normalizeBindingName,
  normalizeBindingValue,
  normalizeKvKey,
  normalizeKvNamespace,
  normalizeKvPutResult,
  normalizeApplication,
  responseBodyClass,
  responseHeaderPairs,
  wrapStructuredResponse
});
