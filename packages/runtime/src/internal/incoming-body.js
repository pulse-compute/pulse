'use strict';

const { PulseRuntimeContractError } = require('./errors.js');
const owners = new WeakMap();
function conflict() {
  return new PulseRuntimeContractError('PULSE_REQUEST_BODY_OWNERSHIP', 'The incoming body has already been claimed by this request.');
}

// Host integration only. Markers carry no stream, bytes or serializable identity.
function createIncomingBodyOwnership(transport) {
  let state = 'available', invalidation, failure, disposed = false;
  const marker = Object.freeze(Object.create(null));
  const owner = Object.freeze({
    marker() { return marker; },
    bindInvalidation(callback) { invalidation = callback; },
    fail(error) {
      failure ||= error;
      state = 'failed';
      invalidation?.(error);
      return error;
    },
    structured() {
      if (state !== 'available' && state !== 'structured') throw owner.fail(conflict());
      state = 'structured';
    },
    claim(value, init) {
      if (owners.get(value) !== owner || state !== 'available') throw owner.fail(conflict());
      transport.validate(init);
      state = 'reserved';
    },
    async forward(url, init, execution) {
      if (state !== 'reserved') throw failure || conflict();
      state = 'forwarding';
      try {
        const response = await transport.forward(url, init, execution);
        state = 'closed';
        return response;
      } catch (error) { throw owner.fail(error); }
    },
    async close() {
      if (disposed) return;
      disposed = true;
      if (state !== 'closed' && state !== 'failed') state = 'cancelled';
      // Provider cleanup is best effort, must observe rejection, and never
      // delay an execution or grant application authority.
      try { Promise.resolve(transport.cancel(failure)).catch(() => {}); } catch (_) {}
    },
    get failure() { return failure; },
    get responseSignal() { return transport.responseSignal; }
  });
  owners.set(marker, owner);
  return owner;
}

function isIncomingBody(value) { return value !== null && typeof value === 'object' && owners.has(value); }
function forwardIncomingBody(value, url, init, execution) {
  const owner = owners.get(value);
  if (!owner) throw conflict();
  return owner.forward(url, init, execution);
}

module.exports = { createIncomingBodyOwnership, isIncomingBody, forwardIncomingBody };
