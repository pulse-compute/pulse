'use strict';

const { CANONICAL_EFFECT_INVOCATION_POLICY } = require('@pulse-compute/wasm-contracts/handler/canonical-runtime');
let executionSequence = 0;

function normalizeMaxEffects(value) {
  const max = value === undefined ? CANONICAL_EFFECT_INVOCATION_POLICY.defaultMaxEffects : Number(value);
  if (!Number.isSafeInteger(max) || max <= 0) throw new TypeError('Pulse maxEffects must be a positive safe integer.');
  return max;
}

// A ticket is authenticated by object identity, never by caller-supplied fields.
// Only pending slots are retained; the sequence is cumulative across loop visits.
function createEffectInvocations(check = () => {}) {
  const execution = ++executionSequence;
  const active = new Map();
  let sequence = 0;
  let closed = false;
  function invalid() {
    const error = new Error('Effect invocation is stale, already settled, foreign, or closed.');
    error.name = 'EffectInvocationError';
    error.code = 'PULSE_EFFECT_INVOCATION_INVALID';
    throw error;
  }
  function assertOpen() { if (closed) invalid(); check(); }
  function assertPending(ticket) {
    assertOpen();
    if (!ticket || active.get(ticket.slot) !== ticket) invalid();
    return ticket;
  }
  return Object.freeze({
    execution,
    open(slot, siteId) {
      assertOpen();
      if (active.has(slot) || !Number.isSafeInteger(sequence + 1)) invalid();
      const ticket = Object.freeze({ slot, siteId, sequence: ++sequence, invocationId: `effect-${execution}-${sequence}` });
      active.set(slot, ticket);
      return ticket;
    },
    assertOpen,
    assertPending,
    settle(ticket, consume) {
      assertPending(ticket);
      active.delete(ticket.slot); // Consume before calling into the guest.
      return consume();
    },
    close() { closed = true; active.clear(); },
    get closed() { return closed; }
  });
}

module.exports = { createEffectInvocations, normalizeMaxEffects };
