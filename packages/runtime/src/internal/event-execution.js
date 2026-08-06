'use strict';

// Portable runtime realization of the repository-owned event contract. This
// module intentionally exposes direct JavaScript execution only; transports,
// provider delivery, and Native execution remain out of scope. Outbound event
// acceptance is a separate execution-owned effect and never loops back here.

const { createEventContext } = require('./context.js');
const { createJavascriptEffectExecution } = require('./effect-adapter.js');
const { PulseRuntimeContractError, PulseUnhandledError } = require('./errors.js');
const { reportingLevel } = require('./logging.js');
const { createRedactionState } = require('./redaction.js');
const { validateSchemaValue } = require('./schema.js');

const EVENT_FRAME_VERSION = 'pulse.event-frame.v1';
const EVENT_EXECUTION_RESULT_VERSION = 'pulse.event-execution-result.v1';
const EVENT_REGISTRATION_READER = Symbol.for('pulse.runtime.event-registration-reader.v1');
const EVENT_DEFAULT_LIMITS = Object.freeze({
  maxTypeBytes: 128,
  maxSchemaIdBytes: 256,
  maxPayloadBytes: 65_536,
  maxPayloadDepth: 32,
  maxPayloadEntries: 4_096,
  maxEvents: 256
});
const EVENT_LIMIT_KEYS = Object.freeze(Object.keys(EVENT_DEFAULT_LIMITS));
const SCHEMA_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/;

const EVENT_RUNTIME_CODES = Object.freeze({
  LIMIT_INVALID: 'PULSE_RUNTIME_EVENT_LIMIT_INVALID',
  LIMIT_EXCEEDED: 'PULSE_RUNTIME_EVENT_LIMIT_EXCEEDED',
  FRAME_INVALID: 'PULSE_RUNTIME_EVENT_FRAME_INVALID',
  TYPE_INVALID: 'PULSE_RUNTIME_EVENT_TYPE_INVALID',
  SCHEMA_ID_INVALID: 'PULSE_RUNTIME_EVENT_SCHEMA_ID_INVALID',
  PAYLOAD_REQUIRED: 'PULSE_RUNTIME_EVENT_PAYLOAD_REQUIRED',
  PAYLOAD_FORBIDDEN: 'PULSE_RUNTIME_EVENT_PAYLOAD_FORBIDDEN',
  PAYLOAD_INVALID: 'PULSE_RUNTIME_EVENT_PAYLOAD_INVALID',
  HANDLER_NOT_FOUND: 'PULSE_RUNTIME_EVENT_HANDLER_NOT_FOUND',
  REGISTRATION_INVALID: 'PULSE_RUNTIME_EVENT_REGISTRATION_INVALID',
  SCHEMA_MISMATCH: 'PULSE_RUNTIME_EVENT_SCHEMA_MISMATCH',
  HANDLER_ASYNC_REQUIRED: 'PULSE_RUNTIME_EVENT_HANDLER_ASYNC_REQUIRED',
  HANDLER_RESULT_INVALID: 'PULSE_RUNTIME_EVENT_HANDLER_RESULT_INVALID',
  CANCELLED: 'PULSE_RUNTIME_EVENT_CANCELLED',
  COMPLETION_DUPLICATE: 'PULSE_RUNTIME_EVENT_COMPLETION_DUPLICATE'
});

function contractError(code, message, detail) {
  return new PulseRuntimeContractError(code, message, detail === undefined ? {} : { detail: Object.freeze({ ...detail }) });
}

function ownDataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function requireDataObject(value, label, code = EVENT_RUNTIME_CODES.FRAME_INVALID) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(code, `Pulse ${label} must be a plain data object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw contractError(code, `Pulse ${label} must be a plain data object.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw contractError(code, `Pulse ${label} must not contain symbol keys.`);
  }
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw contractError(code, `Pulse ${label}.${key} must be an own data property.`);
    }
  }
  return value;
}

function requireKnownKeys(value, allowed, label, code = EVENT_RUNTIME_CODES.FRAME_INVALID) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length > 0) {
    throw contractError(code, `Pulse ${label} contains unsupported fields: ${unknown.join(', ')}.`, { unknown });
  }
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function normalizeEventLimits(input) {
  const source = input === undefined ? {} : input;
  requireDataObject(source, 'event limits', EVENT_RUNTIME_CODES.LIMIT_INVALID);
  requireKnownKeys(source, EVENT_LIMIT_KEYS, 'event limits', EVENT_RUNTIME_CODES.LIMIT_INVALID);
  const limits = {};
  for (const key of EVENT_LIMIT_KEYS) {
    const value = source[key] === undefined ? EVENT_DEFAULT_LIMITS[key] : Number(source[key]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw contractError(EVENT_RUNTIME_CODES.LIMIT_INVALID, `Pulse event limit ${key} must be a positive safe integer.`, { key, value });
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}

function normalizeEventType(value, limits) {
  if (typeof value !== 'string' || value.length === 0 || utf8ByteLength(value) > limits.maxTypeBytes) {
    throw contractError(EVENT_RUNTIME_CODES.TYPE_INVALID, 'Pulse event type must be a bounded non-empty string.');
  }
  return value;
}

function normalizeEventSchemaId(value, limits) {
  if (value === null) return null;
  if (typeof value !== 'string' || !SCHEMA_ID_PATTERN.test(value) || utf8ByteLength(value) > limits.maxSchemaIdBytes) {
    throw contractError(EVENT_RUNTIME_CODES.SCHEMA_ID_INVALID, 'Pulse event schemaId must be a bounded dotted schema ID or null.');
  }
  return value;
}

function requireDataArray(value, path) {
  if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).some((key) => !/^(?:0|[1-9][0-9]*)$/.test(key))) {
    throw contractError(EVENT_RUNTIME_CODES.PAYLOAD_INVALID, `Pulse ${path} must be a dense data-only array.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw contractError(EVENT_RUNTIME_CODES.PAYLOAD_INVALID, `Pulse ${path} must be a dense data-only array.`);
    }
  }
}

function cloneEventPayload(input, limits) {
  let entries = 0;
  const ancestors = new Set();

  function visit(value, path, depth) {
    if (depth > limits.maxPayloadDepth) {
      throw contractError(EVENT_RUNTIME_CODES.PAYLOAD_INVALID, 'Pulse event payload exceeds its nesting limit.', { path });
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw contractError(EVENT_RUNTIME_CODES.PAYLOAD_INVALID, `Pulse ${path} must be finite.`);
      return Object.is(value, -0) ? 0 : value;
    }
    if (!value || typeof value !== 'object') {
      throw contractError(EVENT_RUNTIME_CODES.PAYLOAD_INVALID, `Pulse ${path} must contain only JSON data.`);
    }
    if (ancestors.has(value)) throw contractError(EVENT_RUNTIME_CODES.PAYLOAD_INVALID, 'Pulse event payload must not contain cycles.', { path });
    ancestors.add(value);
    let output;
    if (Array.isArray(value)) {
      requireDataArray(value, path);
      entries += value.length;
      output = value.map((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
    } else {
      requireDataObject(value, path, EVENT_RUNTIME_CODES.PAYLOAD_INVALID);
      const keys = Object.keys(value).sort();
      entries += keys.length;
      output = Object.fromEntries(keys.map((key) => [key, visit(ownDataValue(value, key), `${path}.${key}`, depth + 1)]));
    }
    ancestors.delete(value);
    if (entries > limits.maxPayloadEntries) {
      throw contractError(EVENT_RUNTIME_CODES.PAYLOAD_INVALID, 'Pulse event payload exceeds its entry limit.', { entries });
    }
    for (const child of Object.values(output)) {
      if (child && typeof child === 'object' && !Object.isFrozen(child)) Object.freeze(child);
    }
    return Object.freeze(output);
  }

  const payload = visit(input, 'event payload', 0);
  const bytes = utf8ByteLength(JSON.stringify(payload));
  if (bytes > limits.maxPayloadBytes) {
    throw contractError(EVENT_RUNTIME_CODES.PAYLOAD_INVALID, 'Pulse event payload exceeds its UTF-8 JSON byte limit.', { bytes });
  }
  return payload;
}

function normalizeEventFrame(input, limitsInput) {
  const limits = normalizeEventLimits(limitsInput);
  requireDataObject(input, 'event frame');
  requireKnownKeys(input, ['version', 'type', 'schemaId', 'payload'], 'event frame');
  if (ownDataValue(input, 'version') !== EVENT_FRAME_VERSION || !Object.prototype.hasOwnProperty.call(input, 'schemaId')) {
    throw contractError(EVENT_RUNTIME_CODES.FRAME_INVALID, `Pulse event frame requires ${EVENT_FRAME_VERSION}, type, and schemaId.`);
  }
  const type = normalizeEventType(ownDataValue(input, 'type'), limits);
  const schemaId = normalizeEventSchemaId(ownDataValue(input, 'schemaId'), limits);
  const hasPayload = Object.prototype.hasOwnProperty.call(input, 'payload');
  if (schemaId === null && hasPayload) {
    throw contractError(EVENT_RUNTIME_CODES.PAYLOAD_FORBIDDEN, 'Pulse no-payload event frames must omit payload.');
  }
  if (schemaId !== null && !hasPayload) {
    throw contractError(EVENT_RUNTIME_CODES.PAYLOAD_REQUIRED, 'Pulse schema-bound event frames require payload.');
  }
  return Object.freeze({
    version: EVENT_FRAME_VERSION,
    type,
    schemaId,
    ...(hasPayload ? { payload: cloneEventPayload(ownDataValue(input, 'payload'), limits) } : {})
  });
}

function eventRegistrations(application, limits) {
  const descriptor = application && (typeof application === 'object' || typeof application === 'function')
    ? Object.getOwnPropertyDescriptor(application, EVENT_REGISTRATION_READER)
    : undefined;
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || typeof descriptor.value !== 'function') return Object.freeze([]);
  const entries = descriptor.value();
  if (!Array.isArray(entries)) throw contractError(EVENT_RUNTIME_CODES.REGISTRATION_INVALID, 'Pulse event registration reader returned an invalid table.');
  if (entries.length > limits.maxEvents) {
    throw contractError(EVENT_RUNTIME_CODES.LIMIT_EXCEEDED, 'Pulse event registration table exceeds its configured limit.', {
      count: entries.length,
      maxEvents: limits.maxEvents
    });
  }
  return entries;
}

function normalizeRegistration(input, limits) {
  if (!input || typeof input !== 'object'
    || ownDataValue(input, 'version') !== 'pulse.event-registration.v1') {
    throw contractError(EVENT_RUNTIME_CODES.REGISTRATION_INVALID, 'Pulse event registration is invalid.');
  }
  const declaration = ownDataValue(input, 'declaration');
  const handler = ownDataValue(input, 'handler');
  if (!declaration || typeof declaration !== 'object'
    || ownDataValue(declaration, 'version') !== 'pulse.event-declaration.v1'
    || typeof handler !== 'function') {
    throw contractError(EVENT_RUNTIME_CODES.REGISTRATION_INVALID, 'Pulse event registration is invalid.');
  }
  try {
    return Object.freeze({
      type: normalizeEventType(ownDataValue(input, 'type'), limits),
      schemaId: normalizeEventSchemaId(ownDataValue(declaration, 'schemaId'), limits),
      handler
    });
  } catch (error) {
    throw contractError(EVENT_RUNTIME_CODES.REGISTRATION_INVALID, 'Pulse event registration is invalid.', {
      causeCode: errorField(error, 'code') || null
    });
  }
}

function selectEventRegistration(application, type, limits) {
  let selected;
  const types = new Set();
  for (const input of eventRegistrations(application, limits)) {
    const registration = normalizeRegistration(input, limits);
    if (types.has(registration.type)) {
      throw contractError(EVENT_RUNTIME_CODES.REGISTRATION_INVALID, 'Pulse event registration table contains duplicate event types.', {
        type: registration.type
      });
    }
    types.add(registration.type);
    if (registration.type === type) selected = registration;
  }
  if (selected) return selected;
  throw contractError(EVENT_RUNTIME_CODES.HANDLER_NOT_FOUND, `Pulse has no event handler registered for ${JSON.stringify(type)}.`, { type });
}

function errorField(error, field) {
  const value = ownDataValue(error, field);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function executionError(category, error, redaction) {
  const safe = redaction.redactError(error);
  const code = errorField(safe, 'code');
  const name = errorField(safe, 'name') || 'Error';
  const messages = {
    'invalid-frame': errorField(safe, 'message') || 'Pulse event frame is invalid.',
    'handler-not-found': errorField(safe, 'message') || 'Pulse event handler was not found.',
    'schema-mismatch': 'Pulse event frame schemaId does not match the registered event schema.',
    'schema-validation-failed': 'Pulse event payload failed its declared schema.',
    'handler-failed': 'Pulse contained an unexpected event handler or runtime failure.',
    'completion-invalid': 'Pulse event handlers must resolve with undefined.',
    cancelled: 'Pulse event execution was cancelled.',
    'disposal-failed': 'Pulse event execution disposal failed.',
    internal: 'Pulse event execution failed.'
  };
  return Object.freeze({
    category,
    name,
    ...(code ? { code } : {}),
    message: redaction.redactString(messages[category] || messages.internal)
  });
}

function createEventCompletion(redaction = createRedactionState()) {
  let settled = false;
  function claim() {
    if (settled) throw contractError(EVENT_RUNTIME_CODES.COMPLETION_DUPLICATE, 'Pulse event execution may complete exactly once.');
    settled = true;
  }
  return Object.freeze({
    complete() {
      claim();
      return Object.freeze({ version: EVENT_EXECUTION_RESULT_VERSION, status: 'completed' });
    },
    fail(category, error) {
      claim();
      return Object.freeze({
        version: EVENT_EXECUTION_RESULT_VERSION,
        status: 'failed',
        error: executionError(category, error, redaction)
      });
    }
  });
}

function effectExecutionOptions(options, application, frame) {
  return {
    effectAdapter: options.effectAdapter,
    capabilities: options.capabilities,
    application,
    event: frame,
    executionKind: 'event',
    signal: options.signal,
    maxEffects: options.maxEffects,
    maxBindingNameBytes: options.maxBindingNameBytes,
    maxBindingValueBytes: options.maxBindingValueBytes,
    maxKvNamespaceBytes: options.maxKvNamespaceBytes,
    maxKvKeyBytes: options.maxKvKeyBytes,
    maxKvValueBytes: options.maxKvValueBytes,
    maxKvValueDepth: options.maxKvValueDepth,
    maxKvValueEntries: options.maxKvValueEntries,
    schemaCodecs: options.schemaCodecs,
    strict: options.strict,
    target: options.target,
    provider: options.provider,
    redactionValues: options.redactionValues,
    onEffectObservation: options.onEffectObservation
  };
}

function observeLoggingConfiguration(options) {
  if (typeof options.onLogObservation !== 'function') return;
  const level = reportingLevel(options.reporting);
  const name = Object.freeze(['off', 'error', 'warn', 'info', 'debug'])[level];
  try {
    options.onLogObservation(Object.freeze({
      version: 'pulse.log-event.v1',
      type: 'logging-config',
      reporting: Object.freeze({ name, level }),
      target: options.target || 'javascript',
      provider: options.provider || null
    }));
  } catch (_) {
    // Logging evidence is best effort.
  }
}

async function executeEvent(application, inputFrame, options = {}) {
  const initialRedaction = createRedactionState(options.redactionValues);
  const initialCompletion = createEventCompletion(initialRedaction);
  let frame;
  let validatedFrame;
  let registration;
  let payload;
  let limits;
  let preflightStage = 'frame';
  try {
    limits = normalizeEventLimits(options.eventLimits);
    frame = normalizeEventFrame(inputFrame, limits);
    preflightStage = 'selection';
    registration = selectEventRegistration(application, frame.type, limits);
    if (registration.schemaId !== frame.schemaId) {
      throw contractError(EVENT_RUNTIME_CODES.SCHEMA_MISMATCH, 'Pulse event frame schemaId does not match its registered event declaration.', {
        type: frame.type,
        expectedSchemaId: registration.schemaId,
        actualSchemaId: frame.schemaId
      });
    }
    preflightStage = 'schema';
    payload = frame.schemaId === null
      ? null
      : cloneEventPayload(validateSchemaValue(frame.schemaId, frame.payload, {
          schemaCodecs: options.schemaCodecs,
          strict: true,
          target: options.target,
          provider: options.provider
        }, {
          source: 'event-ingress',
          operationId: `event:${frame.type}`
        }), limits);
    validatedFrame = Object.freeze({
      version: frame.version,
      type: frame.type,
      schemaId: frame.schemaId,
      ...(frame.schemaId === null ? {} : { payload })
    });
  } catch (error) {
    const code = errorField(error, 'code');
    const category = code === EVENT_RUNTIME_CODES.HANDLER_NOT_FOUND
      ? 'handler-not-found'
      : code === EVENT_RUNTIME_CODES.SCHEMA_MISMATCH
        ? 'schema-mismatch'
        : preflightStage === 'schema' || (code && (code.startsWith('PULSE_SCHEMA_') || code === 'PULSE_BODY_TOO_LARGE'))
          ? 'schema-validation-failed'
          : code === EVENT_RUNTIME_CODES.LIMIT_EXCEEDED || code === EVENT_RUNTIME_CODES.REGISTRATION_INVALID
            ? 'internal'
            : 'invalid-frame';
    return initialCompletion.fail(category, error);
  }

  if (options.signal && options.signal.aborted) {
    return initialCompletion.fail('cancelled', contractError(EVENT_RUNTIME_CODES.CANCELLED, 'Pulse event execution was cancelled before handler entry.'));
  }

  let effectExecution;
  try {
    effectExecution = createJavascriptEffectExecution(effectExecutionOptions(options, application, validatedFrame));
  } catch (error) {
    return initialCompletion.fail('internal', error);
  }
  const completion = createEventCompletion({
    redactError(error) { return effectExecution.redactError(error); },
    redactString(value) { return String(effectExecution.redactValue(String(value))); }
  });
  const executionOptions = Object.freeze({
    ...options,
    signal: options.signal,
    redactJsonTraceValue(value) { return effectExecution.redactValue(value); }
  });
  const event = Object.freeze({ type: validatedFrame.type, payload });
  let context;
  try {
    context = createEventContext({
      event,
      state: new Map(),
      effectExecution,
      signal: options.signal,
      executionOptions
    });
  } catch (error) {
    try { await effectExecution.close(); } catch (_) { /* Original context failure remains primary. */ }
    return completion.fail('internal', error);
  }
  observeLoggingConfiguration(options);

  let handlerError;
  let handlerFailureCategory = 'handler-failed';
  let output;
  try {
    const returned = registration.handler(context);
    if (!returned || typeof returned.then !== 'function') {
      handlerFailureCategory = 'completion-invalid';
      throw contractError(EVENT_RUNTIME_CODES.HANDLER_ASYNC_REQUIRED, 'Pulse event handlers must return a Promise resolving to undefined.');
    }
    output = await returned;
  } catch (error) {
    handlerError = error;
  }
  try {
    await effectExecution.assertIdle();
  } catch (error) {
    if (handlerError === undefined) handlerError = error;
  }

  let disposalError;
  try {
    await effectExecution.close();
  } catch (error) {
    disposalError = error;
  }
  if (typeof options.onEffectSummary === 'function') {
    try { options.onEffectSummary(effectExecution.summary()); }
    catch (_) { /* Observation callbacks do not own event completion. */ }
  }

  if (options.signal && options.signal.aborted) {
    return completion.fail('cancelled', contractError(EVENT_RUNTIME_CODES.CANCELLED, 'Pulse event execution was cancelled.'));
  }
  if (handlerError !== undefined) {
    if (handlerFailureCategory === 'completion-invalid') {
      return completion.fail('completion-invalid', handlerError);
    }
    const safe = effectExecution.redactError(handlerError);
    return completion.fail('handler-failed', safe instanceof PulseUnhandledError ? safe : new PulseUnhandledError(safe));
  }
  if (output !== undefined) {
    return completion.fail('completion-invalid', contractError(EVENT_RUNTIME_CODES.HANDLER_RESULT_INVALID, 'Pulse event handlers must resolve with undefined.'));
  }
  if (disposalError !== undefined) return completion.fail('disposal-failed', disposalError);
  return completion.complete();
}

module.exports = Object.freeze({
  EVENT_FRAME_VERSION,
  EVENT_EXECUTION_RESULT_VERSION,
  EVENT_RUNTIME_CODES,
  normalizeEventFrame,
  createEventCompletion,
  executeEvent
});
