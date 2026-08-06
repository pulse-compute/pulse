'use strict';

const CONTINUATION_REGISTRY_VERSION = 'pulse.continuation-registry.v1';
const CONTINUATION_STATES = Object.freeze(['created', 'waiting', 'resumed', 'completed', 'failed', 'expired', 'cancelled']);
const TERMINAL_STATES = new Set(['completed', 'failed', 'expired', 'cancelled']);

class ContinuationRegistryError extends Error {
  constructor(name, code, message, detail = {}) {
    super(message);
    this.name = name;
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function stateError(record, operation, expected) {
  const detail = { id: record.id, state: record.state, operation, expected };
  if (record.state === 'expired') return new ContinuationRegistryError('ContinuationExpiredError', 'PULSE_CONTINUATION_EXPIRED', `Continuation ${record.id} expired before ${operation}.`, detail);
  if (['resumed', 'completed', 'failed'].includes(record.state) && operation === 'resume') return new ContinuationRegistryError('ContinuationDoubleResumeError', 'PULSE_CONTINUATION_DOUBLE_RESUME', `Continuation ${record.id} cannot be resumed from ${record.state}.`, detail);
  return new ContinuationRegistryError('ContinuationStateError', 'PULSE_CONTINUATION_STATE', `Continuation ${record.id} cannot ${operation} from ${record.state}.`, detail);
}

function cloneRecord(record) {
  return Object.freeze({
    id: record.id,
    branchPoint: record.branchPoint,
    effectIds: Object.freeze([...record.effectIds]),
    state: record.state,
    states: Object.freeze([...record.states]),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    resumedAt: record.resumedAt,
    completedAt: record.completedAt,
    failedAt: record.failedAt,
    expiredAt: record.expiredAt,
    cancelledAt: record.cancelledAt,
    resumeCount: record.resumeCount,
    error: record.error
  });
}

function createContinuationRegistry(options = {}) {
  const clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
  const defaultTtlMs = Number.isFinite(Number(options.ttlMs)) ? Math.max(1, Number(options.ttlMs)) : 30000;
  const records = new Map();
  const trace = [];
  let sequence = 0;

  function event(record, type, detail = {}) {
    trace.push(Object.freeze({
      sequence: trace.length + 1,
      type,
      id: record.id,
      branchPoint: record.branchPoint,
      state: record.state,
      at: clock(),
      detail: Object.freeze({ ...detail })
    }));
  }

  function requireRecord(id) {
    const record = records.get(String(id));
    if (!record) throw new ContinuationRegistryError('ContinuationNotFoundError', 'PULSE_CONTINUATION_NOT_FOUND', `Unknown continuation ${id}.`, { id: String(id) });
    return record;
  }

  function transition(record, state, at, extra = {}) {
    record.state = state;
    record.states.push(state);
    Object.assign(record, extra);
    event(record, state, extra);
    return cloneRecord(record);
  }

  function create(input = {}) {
    sequence += 1;
    const now = clock();
    const id = String(input.id || `continuation-${sequence}`);
    if (records.has(id)) throw new ContinuationRegistryError('ContinuationDuplicateError', 'PULSE_CONTINUATION_DUPLICATE', `Continuation ${id} already exists.`, { id });
    const ttlMs = Number.isFinite(Number(input.ttlMs)) ? Math.max(1, Number(input.ttlMs)) : defaultTtlMs;
    const record = {
      id,
      branchPoint: String(input.branchPoint || id),
      effectIds: Array.isArray(input.effectIds) ? input.effectIds.map(String) : [],
      state: 'created',
      states: ['created'],
      createdAt: now,
      expiresAt: now + ttlMs,
      resumeCount: 0,
      error: undefined
    };
    records.set(id, record);
    event(record, 'created');
    return cloneRecord(record);
  }

  function wait(id) {
    const record = requireRecord(id);
    if (record.state !== 'created') throw stateError(record, 'wait', 'created');
    return transition(record, 'waiting', clock());
  }

  function resume(id) {
    const record = requireRecord(id);
    const now = clock();
    if (record.state === 'waiting' && now >= record.expiresAt) {
      transition(record, 'expired', now, { expiredAt: now });
      throw stateError(record, 'resume', 'waiting');
    }
    if (record.state !== 'waiting') throw stateError(record, 'resume', 'waiting');
    record.resumeCount += 1;
    return transition(record, 'resumed', now, { resumedAt: now });
  }

  function complete(id) {
    const record = requireRecord(id);
    if (record.state !== 'resumed') throw stateError(record, 'complete', 'resumed');
    const now = clock();
    return transition(record, 'completed', now, { completedAt: now });
  }

  function fail(id, error) {
    const record = requireRecord(id);
    if (!['created', 'waiting', 'resumed'].includes(record.state)) throw stateError(record, 'fail', 'created|waiting|resumed');
    const now = clock();
    const errorName = error && (error.name || error.code || error.message) ? String(error.name || error.code || error.message) : String(error || 'ContinuationFailure');
    return transition(record, 'failed', now, { failedAt: now, error: errorName });
  }

  function expire(id) {
    const record = requireRecord(id);
    if (TERMINAL_STATES.has(record.state) || record.state === 'resumed') throw stateError(record, 'expire', 'created|waiting');
    const now = clock();
    return transition(record, 'expired', now, { expiredAt: now });
  }

  function cancel(id) {
    const record = requireRecord(id);
    if (TERMINAL_STATES.has(record.state)) throw stateError(record, 'cancel', 'created|waiting|resumed');
    const now = clock();
    return transition(record, 'cancelled', now, { cancelledAt: now });
  }

  function sweepExpired(now = clock()) {
    const expired = [];
    for (const record of records.values()) {
      if (['created', 'waiting'].includes(record.state) && now >= record.expiresAt) {
        transition(record, 'expired', now, { expiredAt: now });
        expired.push(record.id);
      }
    }
    return Object.freeze(expired);
  }

  function get(id) { return cloneRecord(requireRecord(id)); }
  function list() { return Object.freeze([...records.values()].map(cloneRecord)); }
  function traceSnapshot() { return Object.freeze([...trace]); }

  return Object.freeze({
    version: CONTINUATION_REGISTRY_VERSION,
    states: CONTINUATION_STATES,
    create,
    wait,
    resume,
    complete,
    fail,
    expire,
    cancel,
    sweepExpired,
    get,
    list,
    trace: traceSnapshot
  });
}

module.exports = {
  CONTINUATION_REGISTRY_VERSION,
  CONTINUATION_STATES,
  ContinuationRegistryError,
  createContinuationRegistry
};
