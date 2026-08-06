'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');

const NODE_EVENT_REFERENCE_ADAPTER_VERSION = 'pulse.node-event-reference-adapter.v1';
const DEFAULT_MAX_QUEUE_DEPTH = 1024;

const NODE_EVENT_ADAPTER_CODES = Object.freeze({
  OPTIONS_INVALID: 'PULSE_NODE_EVENT_ADAPTER_OPTIONS_INVALID',
  QUEUE_FULL: 'PULSE_NODE_EVENT_QUEUE_FULL',
  ACCEPTANCE_FULL: runtimeHost.EVENT_EMIT_CODES.QUEUE_FULL,
  INSTANCE_BUSY: 'PULSE_NODE_EVENT_INSTANCE_BUSY',
  EXECUTOR_INVALID: 'PULSE_NODE_EVENT_EXECUTOR_INVALID',
  CANCELLED: 'PULSE_NODE_EVENT_CANCELLED'
});

function adapterError(code, message, detail = {}) {
  return new runtimeHost.PulseRuntimeContractError(code, message, {
    detail: Object.freeze({ ...detail })
  });
}

function requireOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw adapterError(NODE_EVENT_ADAPTER_CODES.OPTIONS_INVALID, 'Pulse Node event adapter options must be a data object.');
  }
  const prototype = Object.getPrototypeOf(input);
  const unknown = Object.keys(input).filter((key) => key !== 'id' && key !== 'maxQueueDepth').sort();
  if ((prototype !== Object.prototype && prototype !== null) || unknown.length > 0) {
    throw adapterError(
      NODE_EVENT_ADAPTER_CODES.OPTIONS_INVALID,
      'Pulse Node event adapter options contain unsupported fields.',
      { unknown }
    );
  }
  return input;
}

function createNodeEventReferenceAdapter(options = {}) {
  const input = requireOptions(options);
  const id = input.id === undefined ? 'pulse.node-event-reference' : input.id;
  const maxQueueDepth = input.maxQueueDepth === undefined ? DEFAULT_MAX_QUEUE_DEPTH : input.maxQueueDepth;
  const outbound = runtimeHost.createEventRecordingAdapter({ id, maxQueueDepth });
  const descriptor = outbound.eventAdapter;
  const ingress = [];
  let draining = false;
  let activeInvocations = 0;
  let maximumActiveInvocations = 0;
  let enqueuedCount = 0;
  let completedCount = 0;

  function requireNotCancelled(signal, message) {
    if (signal && signal.aborted) {
      throw adapterError(NODE_EVENT_ADAPTER_CODES.CANCELLED, message);
    }
  }

  function enqueue(inputFrame, execution = {}) {
    requireNotCancelled(execution.signal, 'Pulse Node event ingress was cancelled before host acceptance.');
    if (ingress.length >= descriptor.maxQueueDepth) {
      throw adapterError(
        NODE_EVENT_ADAPTER_CODES.QUEUE_FULL,
        `Pulse Node event adapter ${JSON.stringify(descriptor.id)} reached its bounded ingress queue capacity.`,
        { maxQueueDepth: descriptor.maxQueueDepth }
      );
    }
    const normalizer = runtimeHost.createEventRecordingAdapter({
      id: 'pulse.node-event-ingress-normalizer',
      maxQueueDepth: 1
    });
    normalizer.dispatch({ kind: 'event.emit', capability: 'event.emit', frame: inputFrame });
    const frame = normalizer.acceptedFrames()[0];
    ingress.push(frame);
    enqueuedCount += 1;
    return undefined;
  }

  function acceptOutbound(inputFrame, execution = {}) {
    requireNotCancelled(execution.signal, 'Pulse Node event emit was cancelled before host acceptance.');
    return outbound.dispatch({ kind: 'event.emit', capability: 'event.emit', frame: inputFrame });
  }

  async function drain(executor, execution = {}) {
    if (typeof executor !== 'function') {
      throw adapterError(NODE_EVENT_ADAPTER_CODES.EXECUTOR_INVALID, 'Pulse Node event adapter drain requires an executor function.');
    }
    if (draining) {
      throw adapterError(
        NODE_EVENT_ADAPTER_CODES.INSTANCE_BUSY,
        `Pulse Node event adapter ${JSON.stringify(descriptor.id)} already owns an active instance drain.`
      );
    }
    draining = true;
    const outcomes = [];
    try {
      while (ingress.length > 0) {
        const frame = ingress.shift();
        activeInvocations += 1;
        maximumActiveInvocations = Math.max(maximumActiveInvocations, activeInvocations);
        let result;
        try {
          result = await executor(frame, Object.freeze({ signal: execution.signal, adapter: api }));
        } finally {
          activeInvocations -= 1;
        }
        completedCount += 1;
        outcomes.push(Object.freeze({ frame, result }));
      }
      return Object.freeze(outcomes);
    } finally {
      draining = false;
    }
  }

  const api = Object.freeze({
    version: NODE_EVENT_REFERENCE_ADAPTER_VERSION,
    id: descriptor.id,
    eventAdapter: descriptor,
    enqueue,
    acceptOutbound,
    emit: acceptOutbound,
    drain,
    pendingFrames() { return Object.freeze([...ingress]); },
    acceptedFrames() { return outbound.acceptedFrames(); },
    summary() {
      return Object.freeze({
        enqueued: enqueuedCount,
        completed: completedCount,
        pending: ingress.length,
        acceptedOutbound: outbound.acceptedFrames().length,
        activeInvocations,
        maximumActiveInvocations,
        draining,
        automaticLoopback: false
      });
    }
  });
  return api;
}

module.exports = Object.freeze({
  NODE_EVENT_REFERENCE_ADAPTER_VERSION,
  NODE_EVENT_ADAPTER_CODES,
  createNodeEventReferenceAdapter
});
