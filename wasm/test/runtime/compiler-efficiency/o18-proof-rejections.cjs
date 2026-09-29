'use strict';
const assert = require('node:assert/strict');

function settlement(tc, native, plan) {
  const selected = plan.routing.entries.filter(entry => entry.handlerId === plan.routing.entries[0].handlerId);
  const controller = tc.instantiateCanonicalNativeModule(native, { request: { method: 'GET', path: '/chain/1', url: 'https://app.test/chain/1', headers: [['x-input', 'settlement']] } });
  try {
    assert.equal(controller.start(), 1);
    const pending = controller.pendingEffects(); assert.equal(pending.length, 1);
    const correct = pending[0].ticket.slot;
    const wrong = plan.effects.findIndex(effect => effect.routerEntryStableId === selected[0].stableId);
    assert.notEqual(correct, wrong);
    const handle = controller.heap.put('one');
    assert.equal(controller.exports.pulse_set_effect_result(wrong, handle), 0, 'another registration cannot settle this suspension');
    assert.equal(controller.exports.pulse_resume(), -2, 'missing result cannot resume');
    assert.equal(controller.exports.pulse_set_effect_result(correct, handle), 1);
    assert.equal(controller.exports.pulse_set_effect_result(correct, handle), 0, 'duplicate result rejected');
    assert.equal(controller.exports.pulse_resume(), 1);
    const next = controller.pendingEffects(); assert.equal(next.length, 1);
    assert.notEqual(next[0].ticket.slot, correct);
    assert.equal(controller.exports.pulse_set_effect_result(correct, handle), 0, 'stale first-site result cannot settle the second site');
    return 5;
  } finally { controller.close(); }
}
module.exports.settlement = settlement;
