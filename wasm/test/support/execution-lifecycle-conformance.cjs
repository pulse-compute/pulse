'use strict';
const assert = require('node:assert/strict');
// Driver adapters normalize rejection syntax only (status versus exception).
// The trace and ticket postconditions are shared; HTTP is a separate capability.
function runDeliveryConformance(fresh, check) {
  check('common: authentication precedes service dispatch', () => {
    const x = fresh(); x.rejectInvalid(); assert.equal(x.trace(), '');
    assert.equal(x.settle(), 1); assert.equal(x.trace(), '123456');
    assert.equal(x.accepted(), 1); x.assertConsumed(); x.close();
  });
  check('common: guard rejection retains the ticket', () => {
    const x = fresh(); x.mode(3); assert.equal(x.settle(), 0); assert.equal(x.trace(), '1'); x.assertPending();
    x.mode(0); assert.equal(x.settle(), 1); assert.equal(x.trace(), '1123456'); x.assertConsumed(); x.close();
  });
  check('common: rejected delivery runs reverse after notifications', () => {
    const x = fresh(); x.mode(1); assert.equal(x.settle(), 0); assert.equal(x.trace(), '123456');
    assert.equal(x.accepted(), 0); x.assertConsumed(); x.close();
  });
  check('common: closure invalidates pending work and cleanup is idempotent', () => {
    const x = fresh(); x.close(); x.assertConsumed(); assert.equal(x.cleanupCount(), 1);
    x.close(); assert.equal(x.cleanupCount(), 1);
  });
  for (const [mode, trace] of [[2, '1234'], [4, '12']]) check(`common: trap ${mode} consumes once and skips after notifications`, () => {
    const x = fresh(); x.mode(mode); assert.throws(() => x.settle(), WebAssembly.RuntimeError);
    assert.equal(x.trace(), trace); assert.equal(x.accepted(), -1); x.assertConsumed(); x.close();
  });
}
module.exports = { runDeliveryConformance };
