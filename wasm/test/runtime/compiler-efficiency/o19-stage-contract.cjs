'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validateCanonicalNativePlan, stableStringify } = require('../../../packages/compiler/src/canonical-native-plan');

function check(plan) {
  assert.equal(plan.stages.length, 1);
  const stage = plan.stages[0];
  assert.equal(stage.registrations.length, 2);
  assert.equal(stage.effectIds.length, 2);
  assert.equal(stage.inputs.context, 'request');
  assert.deepEqual(stage.outputs, ['response', 'next', 'error', 'suspend', 'failure']);
  assert.deepEqual(plan.locals.filter(l => l.scopeId === stage.id).map(l => l.id), [...stage.localIds, stage.inputs.nextCursorLocalId]);
  assert.ok(Object.isFrozen(stage.body));
  validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));
  const mutations = [
    p => { p.stages[0].registrations[1].effectIds[0] = p.stages[0].registrations[0].effectIds[0]; },
    p => { p.stages[0].registrations[1].continuationIds[0] = p.stages[0].registrations[0].continuationIds[0]; },
    p => { p.stages[0].registrations[1].nextIndex++; },
    p => { p.stages[0].body[0].value = { kind: 'local', id: p.handlers[0].localIds[0], valueKind: 'string' }; },
    p => { p.stages[0].body.push({ kind: 'stage-call', stageId: stage.id, registrationId: stage.registrations[0].entryId }); },
    p => { p.stages[0].localIds.pop(); },
    p => { p.stages[0].frame.reset = 'never'; },
    p => { p.stages[0].outputs.pop(); },
    p => { p.stages[0].registrations.pop(); },
    p => { p.effects.find(e => e.stageId && e.routerEntryStableId === stage.registrations[1].entryId).inputs[0].value.value = 'other'; },
    p => { const entry = p.entry.body.find(s => s.then?.[0]?.then?.[0]?.kind === 'stage-call'); entry.then[0].then[0].registrationId = stage.registrations[1].entryId; },
    p => { p.entry.body.push({ kind: 'stage-call', stageId: stage.id, registrationId: stage.registrations[0].entryId }); }
  ];
  for (const [index, mutate] of mutations.entries()) {
    const changed = JSON.parse(JSON.stringify(plan)); mutate(changed);
    const unsigned = { ...changed }; delete unsigned.planHash;
    changed.planHash = createHash('sha256').update(stableStringify(unsigned)).digest('hex');
    assert.throws(() => validateCanonicalNativePlan(changed), error => error.name === 'CanonicalNativePlanError', `mutation ${index}: ownership validation must reject even with a recomputed plan hash`);
  }
  return mutations.length + 1;
}
module.exports = { check };
