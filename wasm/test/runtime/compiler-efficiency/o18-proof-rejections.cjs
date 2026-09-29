'use strict';
const assert = require('node:assert/strict');
const { prepareSharedStageProof } = require('../../../packages/runtime-core-as/src/compiler/shared-stage-proof');
function check(plan, handlerId) {
  const entries = plan.routing.entries.filter(entry => entry.handlerId === handlerId);
  const second = entries[1];
  const pathToBody = plan.entry.body.findIndex(s => s.kind === 'if' && s.test.right?.value === second.index);
  const mutations = [
    p => { p.entry.body[pathToBody].then[0].then[1].value = { kind: 'literal', value: 'different', valueKind: 'string' }; },
    p => { p.effects.find(e => e.routerEntryStableId === second.stableId).inputs[0].value.value = 'different'; },
    p => { p.entry.body[pathToBody].then[0].then[1].value = { kind: 'local', id: 'captured', valueKind: 'string' }; },
    p => { p.entry.body[pathToBody].then[0].then.push({ kind: 'effect-group', effectIds: [] }); },
    p => { p.routing.entries.find(e => e.stableId === second.stableId).kind = 'error'; }
  ];
  for (const mutate of mutations) { const changed = structuredClone(plan); mutate(changed); assert.throws(() => prepareSharedStageProof(changed, handlerId)); }
  const before = JSON.stringify(plan); prepareSharedStageProof(plan, handlerId); assert.equal(JSON.stringify(plan), before, 'proof preparation must not mutate the validated plan');
  return mutations.length + 1;
}
module.exports = { check };

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
