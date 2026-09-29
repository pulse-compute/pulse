'use strict';

// O-18 internal experiment. No CLI/config switch or supported lowering contract.
// Validate equivalent plan bodies before factoring them; never infer equivalence
// from the authored handler ID alone. O-19 owns production IR and eligibility.
const assert = require('node:assert/strict');

function prepareSharedStageProof(input, handlerId) {
  const plan = structuredClone(input);
  assert.ok(plan.routing.entries.some(entry => entry.kind === 'error'), 'O-18 selects a Router with an explicit error lane');
  const entries = plan.routing.entries.filter(entry => entry.handlerId === handlerId);
  assert.ok(entries.length > 0 && entries.length <= 16, 'O-18 requires 1..16 registrations');
  assert.ok(entries.every(entry => entry.kind === 'route' && !entry.nativeBody), 'O-18 requires transfer-capable HTTP routes');
  const cursor = plan.locals.find(local => local.name === '__pulse_router_cursor').id;
  const routerLocals = new Set(plan.locals.filter(local => ['__pulse_router_cursor', '__pulse_router_mode', '__pulse_router_error'].includes(local.name)).map(local => local.id));
  const nextLocal = { id: 'o18-next-cursor', scopeId: 'entry', name: '__pulse_stage_next_cursor', valueKind: 'number' };
  const rows = entries.map(entry => {
    const outer = plan.entry.body.find(statement => statement.kind === 'if'
      && statement.test.kind === 'binary' && statement.test.operator === '==='
      && statement.test.left.id === cursor && statement.test.right.value === entry.index);
    assert.ok(outer && outer.then.length === 1 && outer.then[0].kind === 'if', 'O-18 requires a static Router admission branch');
    const branch = outer.then[0], body = branch.then, localIds = [], effectIds = [];
    function visit(statements) {
      for (const s of statements) {
        assert.ok(['local', 'expression', 'return', 'if', 'effect'].includes(s.kind), 'O-18 excludes loops, groups and nested calls');
        if (s.kind === 'local') localIds.push(s.localId);
        if (s.kind === 'effect') {
          assert.equal(s.result.mode, 'bind'); localIds.push(s.result.localId); effectIds.push(s.effectId);
        }
        if (s.kind === 'if') { visit(s.then); visit(s.else); }
      }
    }
    visit(body);
    assert.equal(new Set(localIds).size, localIds.length);
    assert.equal(effectIds.length, 2, 'O-18 selects two sequential effect sites');
    const effects = effectIds.map(id => plan.effects.find(effect => effect.id === id));
    assert.ok(effects.every(effect => effect.routerEntryStableId === entry.stableId && effect.kind === 'fetch' && !effect.grouped && effect.decoder === 'text'));
    const locals = new Map(localIds.map((id, i) => [id, `stage-local-${i}`]));
    const ids = new Map(effects.flatMap((effect, i) => [[effect.id, `stage-effect-${i}`], [effect.continuationId, `stage-continuation-${i}`]]));
    function normalize(node) {
      if (Array.isArray(node)) return node.map(normalize);
      if (!node || typeof node !== 'object') return node;
      if (node.kind === 'local' && node.id) assert.ok(locals.has(node.id) || routerLocals.has(node.id), 'O-18 rejects captured locals');
      if (node.kind === 'assignment' && node.target.kind === 'local' && node.target.id === cursor && node.value !== null) {
        assert.equal(node.operator, '='); assert.equal(node.value.kind, 'literal'); assert.equal(node.value.value, entry.nextIndex);
        return { ...normalize({ ...node, value: null }), value: { kind: 'stage-next-cursor' } };
      }
      return Object.fromEntries(Object.entries(node).filter(([key]) => !['statementPath', 'localName'].includes(key) && !(key === 'name' && node.kind === 'local')).map(([key, value]) => [key,
        ['id', 'localId'].includes(key) && locals.has(value) ? locals.get(value)
          : ['effectId', 'continuationId'].includes(key) && ids.has(value) ? ids.get(value) : normalize(value)]));
    }
    const signature = JSON.stringify({ body: normalize(body), effects: effects.map(effect => normalize({ kind: effect.kind, providerKind: effect.providerKind, operation: effect.operation, capability: effect.capability, resource: effect.resource, decoder: effect.decoder, inputs: effect.inputs, result: effect.result })) });
    return { entry, branch, body, localIds, effects, signature };
  });
  for (const row of rows) assert.equal(row.signature, rows[0].signature, 'O-18 registration bodies must be alpha-equivalent');
  const representative = rows[0];
  const body = structuredClone(representative.body);
  function rewrite(node) {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'assignment' && node.target.kind === 'local' && node.target.id === cursor) node.value = { kind: 'local', id: nextLocal.id, valueKind: 'number' };
    for (const value of Object.values(node)) rewrite(value);
  }
  rewrite(body);
  const storage = new Map();
  for (const [registration, row] of rows.entries()) {
    row.branch.then = [{ kind: 'stage-call', registration }];
    row.effects.forEach((effect, site) => {
      storage.set(plan.effects.indexOf(effect), { site });
      // These inputs were checked structurally above. Reuse their expression
      // objects so discarded registrations do not retain unused helper copies.
      effect.inputs = representative.effects[site].inputs;
    });
  }
  plan.locals.push(nextLocal);
  plan.handlers.push({ id: 'o18-shared-stage', handlerId, body });
  return { plan, body, rows, storage, nextLocal, localIds: representative.localIds };
}

function effectAccessors(stage) {
  const indices = [...stage.storage.keys()];
  const operations = [
    ['prepare', 'void', index => `__pulse_effect_pending_${index} = 1; __pulse_effect_ready_${index} = 0; __pulse_effect_result_${index} = 0; return`, 'return'],
    ['clear', 'void', index => `__pulse_effect_pending_${index} = 0; __pulse_effect_ready_${index} = 0; return`, 'return'],
    ['ready', 'i32', index => `return __pulse_effect_ready_${index}`, 'return 0'],
    ['result', 'i32', index => `return __pulse_effect_result_${index}`, 'return 0']
  ];
  return operations.map(([name, type, emit, fallback]) => `@noinline
function __pulse_stage_${name}(index: i32): ${type} {
  switch (index) {
${indices.map(index => `    case ${index}: ${emit(index)}`).join('\n')}
    default: ${fallback}
  }
}`);
}
module.exports = { prepareSharedStageProof, effectAccessors };
