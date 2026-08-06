'use strict';

const { PulseRuntimeContractError } = require('./errors.js');
const { validateSchemaValue } = require('./schema.js');

const EVENT_ADAPTER_VERSION = 'pulse.event-adapter.v1';
const EVENT_ADAPTER_SEMANTICS = Object.freeze({
  acceptance: 'host-accepted',
  deliveryGuarantee: 'none',
  autoLoopback: false,
  sameStackReentry: false,
  queueDiscipline: 'fifo-per-declared-adapter',
  executionIsolation: 'one-event-frame-per-execution'
});
const DEFAULT_MAX_QUEUE_DEPTH = 1024;
const MAX_QUEUE_DEPTH = 65_536;

const EVENT_EMIT_CODES = Object.freeze({
  INPUT_INVALID: 'PULSE_RUNTIME_EVENT_EMIT_INPUT_INVALID',
  SCHEMA_INVALID: 'PULSE_RUNTIME_EVENT_EMIT_SCHEMA_INVALID',
  ACCEPTANCE_INVALID: 'PULSE_RUNTIME_EVENT_EMIT_ACCEPTANCE_INVALID',
  QUEUE_FULL: 'PULSE_RUNTIME_EVENT_EMIT_QUEUE_FULL',
  ADAPTER_INVALID: 'PULSE_RUNTIME_EVENT_ADAPTER_INVALID'
});

function ownDataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function requireDataObject(value, label, code = EVENT_EMIT_CODES.INPUT_INVALID) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PulseRuntimeContractError(code, `Pulse ${label} must be a plain data object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PulseRuntimeContractError(code, `Pulse ${label} must be a plain data object.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new PulseRuntimeContractError(code, `Pulse ${label} must not contain symbol keys.`);
  }
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new PulseRuntimeContractError(code, `Pulse ${label}.${key} must be an own data property.`);
    }
  }
  return value;
}

function errorCode(error) {
  const value = ownDataValue(error, 'code');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function eventFrameNormalizer() {
  // event-execution owns the canonical frame normalizer and imports context.
  // Resolve it only after module initialization to avoid a CommonJS cycle.
  return require('./event-execution.js').normalizeEventFrame;
}

function normalizeEventEmission(type, input, options = {}) {
  requireDataObject(input, 'event emission');
  const keys = Object.keys(input);
  const unknown = keys.filter((key) => key !== 'schema' && key !== 'payload').sort();
  if (unknown.length > 0 || !Object.prototype.hasOwnProperty.call(input, 'schema')) {
    throw new PulseRuntimeContractError(
      EVENT_EMIT_CODES.INPUT_INVALID,
      'Pulse event emissions require exactly schema and the schema-dependent payload field.',
      { detail: Object.freeze({ unknown }) }
    );
  }
  const schemaId = ownDataValue(input, 'schema');
  const hasPayload = Object.prototype.hasOwnProperty.call(input, 'payload');
  let frame = eventFrameNormalizer()({
    version: 'pulse.event-frame.v1',
    type,
    schemaId,
    ...(hasPayload ? { payload: ownDataValue(input, 'payload') } : {})
  }, options.eventLimits);
  if (frame.schemaId === null) return frame;

  let payload;
  try {
    payload = validateSchemaValue(frame.schemaId, frame.payload, {
      schemaCodecs: options.schemaCodecs,
      strict: true,
      target: options.target,
      provider: options.provider
    }, {
      source: 'event-emit',
      operationId: `event.emit:${frame.type}`
    });
  } catch (error) {
    throw new PulseRuntimeContractError(
      EVENT_EMIT_CODES.SCHEMA_INVALID,
      'Pulse outbound event payload failed its declared schema.',
      { detail: Object.freeze({
        type: frame.type,
        schemaId: frame.schemaId,
        causeCode: errorCode(error) || null
      }) }
    );
  }
  frame = eventFrameNormalizer()({
    version: frame.version,
    type: frame.type,
    schemaId: frame.schemaId,
    payload
  }, options.eventLimits);
  return frame;
}

function normalizeQueueDepth(value) {
  const depth = value === undefined ? DEFAULT_MAX_QUEUE_DEPTH : value;
  if (typeof depth !== 'number' || !Number.isSafeInteger(depth) || depth <= 0 || depth > MAX_QUEUE_DEPTH) {
    throw new PulseRuntimeContractError(
      EVENT_EMIT_CODES.ADAPTER_INVALID,
      `Pulse event recording adapter maxQueueDepth must be an integer from 1 through ${MAX_QUEUE_DEPTH}.`
    );
  }
  return depth;
}

function createEventRecordingAdapter(options = {}) {
  requireDataObject(options, 'event recording adapter options', EVENT_EMIT_CODES.ADAPTER_INVALID);
  const unknown = Object.keys(options).filter((key) => key !== 'id' && key !== 'maxQueueDepth').sort();
  if (unknown.length > 0) {
    throw new PulseRuntimeContractError(
      EVENT_EMIT_CODES.ADAPTER_INVALID,
      `Pulse event recording adapter options contain unsupported fields: ${unknown.join(', ')}.`
    );
  }
  const id = options.id === undefined ? 'pulse.event-adapter.recording' : options.id;
  if (typeof id !== 'string' || !id || new TextEncoder().encode(id).byteLength > 128) {
    throw new PulseRuntimeContractError(EVENT_EMIT_CODES.ADAPTER_INVALID, 'Pulse event recording adapter id must be a bounded non-empty string.');
  }
  const maxQueueDepth = normalizeQueueDepth(options.maxQueueDepth);
  const accepted = [];
  const eventAdapter = Object.freeze({
    version: EVENT_ADAPTER_VERSION,
    id,
    maxQueueDepth,
    semantics: EVENT_ADAPTER_SEMANTICS
  });
  return Object.freeze({
    version: 'pulse.javascript-effect-adapter.v1',
    id,
    eventAdapter,
    dispatch(effect) {
      if (!effect || effect.kind !== 'event.emit' || effect.capability !== 'event.emit') {
        throw new PulseRuntimeContractError(
          'PULSE_RUNTIME_CAPABILITY_UNAVAILABLE',
          `Pulse capability ${String(effect && effect.capability || '<unknown>')} is unavailable in the event recording adapter.`
        );
      }
      if (accepted.length >= maxQueueDepth) {
        throw new PulseRuntimeContractError(
          EVENT_EMIT_CODES.QUEUE_FULL,
          `Pulse event recording adapter ${JSON.stringify(id)} reached its bounded acceptance capacity.`
        );
      }
      const frame = eventFrameNormalizer()(effect.frame);
      accepted.push(frame);
      return undefined;
    },
    acceptedFrames() {
      return Object.freeze([...accepted]);
    }
  });
}

module.exports = Object.freeze({
  EVENT_ADAPTER_VERSION,
  EVENT_ADAPTER_SEMANTICS,
  EVENT_EMIT_CODES,
  normalizeEventEmission,
  createEventRecordingAdapter
});
