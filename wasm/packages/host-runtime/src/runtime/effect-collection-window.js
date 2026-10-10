'use strict';

// Internal scheduling foundation only. No authoring API, effect dispatch or ABI
// integration is implied. Values and individual effect tickets remain owned by
// the execution driver, not by these item leases.
const COLLECTION_WINDOW_LIMITS = Object.freeze({ maxItems: 1024, maxConcurrency: 64 });

function invalid() {
  const error = new Error('Collection lease is foreign, stale, in the wrong phase, or terminal.');
  error.name = 'CollectionWindowError';
  error.code = 'PULSEWASM_COLLECTION_WINDOW_INVALID';
  throw error;
}

function integer(name, value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer from ${min} through ${max}.`);
  }
  return value;
}

function createEffectCollectionWindow({ itemCount, maxItems, concurrency, check = () => {} }) {
  integer('maxItems', maxItems, 0, COLLECTION_WINDOW_LIMITS.maxItems);
  integer('itemCount', itemCount, 0, maxItems);
  integer('concurrency', concurrency, 1, COLLECTION_WINDOW_LIMITS.maxConcurrency);
  if (typeof check !== 'function') throw new TypeError('check must be an execution guard.');

  const slots = new Map();
  const ready = [];
  let handler;
  let started = 0;
  let completed = 0;
  let terminal = itemCount === 0 ? 'completed' : undefined;

  function close() {
    if (!terminal) terminal = 'closed';
    slots.clear();
    ready.length = 0;
    handler = undefined;
  }

  function guard() {
    if (terminal === 'closed') invalid();
    try { check(); }
    catch (error) { close(); throw error; }
  }

  function requireLease(lease, phase) {
    guard();
    const entry = lease && slots.get(lease.slot);
    if (terminal || !entry || entry.lease !== lease || entry.phase !== phase) invalid();
    return entry;
  }

  return Object.freeze({
    claim() {
      guard();
      if (terminal || started === itemCount || slots.size === concurrency) return undefined;
      let slot = 0;
      while (slots.has(slot)) slot++;
      const lease = Object.freeze({ slot, index: started++ });
      slots.set(slot, { lease, phase: 'running' });
      return lease;
    },
    settle(lease) {
      const entry = requireLease(lease, 'running');
      entry.phase = 'ready';
      ready.push(lease);
    },
    takeReady() {
      guard();
      if (terminal || handler || ready.length === 0) return undefined;
      const lease = ready.shift();
      requireLease(lease, 'ready').phase = 'handling';
      handler = lease;
      return lease;
    },
    finish(lease) {
      requireLease(lease, 'handling');
      if (handler !== lease) invalid();
      slots.delete(lease.slot);
      handler = undefined;
      completed++;
      if (completed === itemCount) terminal = 'completed';
    },
    close,
    snapshot() {
      return Object.freeze({
        state: terminal || 'open', itemCount, started, completed,
        occupied: slots.size,
        running: slots.size - ready.length - (handler ? 1 : 0),
        ready: ready.length,
        handling: handler ? 1 : 0
      });
    }
  });
}

module.exports = { COLLECTION_WINDOW_LIMITS, createEffectCollectionWindow };
