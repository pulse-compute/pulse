'use strict';

// Native plan owner for shared, transfer-capable HTTP route and middleware stages. Admission
// is conservative: an unsupported shape keeps the ordinary Native lowering.
function loadStageContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-native-plan'); }
  catch (error) {
    if (['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../contracts/src/handler/canonical-native-plan');
    throw error;
  }
}
const contract = loadStageContract().CANONICAL_NATIVE_STAGE_CONTRACT;
const VERSION = contract.version;
const OUTPUTS = contract.outputs;
const MAX_SITES = contract.maxEffectSites;
const excluded = Symbol('not a shared stage');
const demand = (condition, reason = 'unsupported-shape') => {
  if (!condition) throw { [excluded]: true, reason };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function mapTree(node, replace) {
  const replaced = replace(node);
  if (replaced !== node) return replaced;
  if (Array.isArray(node)) return node.map(value => mapTree(value, replace));
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, mapTree(value, replace)]));
}
function statements(body, visit) {
  for (const statement of body || []) {
    visit(statement);
    if (statement.kind === 'if') { statements(statement.then, visit); statements(statement.else, visit); }
  }
}
function effectShape(effect) {
  return Object.fromEntries(['kind', 'providerKind', 'operation', 'capability', 'resource', 'decoder', 'inputs', 'result'].map(key => [key, effect[key]]));
}
function rowFor(plan, entry, router) {
  demand(['route', 'use'].includes(entry.kind) && !entry.nativeBody, 'entry-kind');
  const outer = plan.entry.body.find(s => s.kind === 'if' && s.test?.kind === 'binary'
    && s.test.operator === '===' && s.test.left?.id === router.cursor && s.test.right?.value === entry.index);
  demand(outer?.then?.length === 1 && outer.then[0].kind === 'if');
  const branch = outer.then[0], body = branch.then, localIds = [], effectIds = [];
  statements(body, s => {
    demand(s.kind !== 'helper-call', 'nested-helper-call');
    demand(['local', 'expression', 'return', 'if', 'effect'].includes(s.kind), 'unsupported-statement:' + s.kind);
    if (s.kind === 'local') localIds.push(s.localId);
    if (s.kind === 'effect') {
      demand(s.result?.mode === 'bind', 'effect-result-mode'); localIds.push(s.result.localId); effectIds.push(s.effectId);
    }
  });
  demand(new Set(localIds).size === localIds.length && effectIds.length > 0 && effectIds.length <= MAX_SITES, 'locals-or-effect-count');
  const effects = effectIds.map(id => plan.effects.find(e => e.id === id));
  demand(effects.every(e => e?.routerEntryStableId === entry.stableId && e.kind === 'fetch' && !e.grouped && e.decoder === 'text'), 'effect-kind-or-ownership');
  const locals = new Map(localIds.map((id, i) => [id, `local-${i}`]));
  const ids = new Map(effects.flatMap((e, i) => [[e.id, `effect-${i}`], [e.continuationId, `continuation-${i}`]]));
  let transfers = 0;
  function normalize(node) {
    if (Array.isArray(node)) return node.map(normalize);
    if (!node || typeof node !== 'object') return node;
    // Helper ownership is still tied to the original Router entry, not a stage.
    demand(node.kind !== 'pure-helper-call' && node.kind !== 'helper-call', 'nested-helper-call');
    if (node.kind === 'local' && node.id) demand(locals.has(node.id) || Object.values(router).includes(node.id));
    if (node.kind === 'assignment' && node.target?.id === router.cursor && node.value !== null) {
      demand(node.operator === '=' && node.value?.kind === 'literal' && node.value.value === entry.nextIndex);
      transfers++;
      return { ...normalize({ ...node, value: null }), value: { kind: 'stage-next-cursor' } };
    }
    return Object.fromEntries(Object.entries(node).filter(([key]) => !['statementPath', 'localName'].includes(key)
      && !(key === 'name' && node.kind === 'local')).map(([key, value]) => [key,
      ['id', 'localId'].includes(key) && locals.has(value) ? locals.get(value)
        : ['effectId', 'continuationId'].includes(key) && ids.has(value) ? ids.get(value) : normalize(value)]));
  }
  const signature = JSON.stringify({ body: normalize(body), effects: effects.map(e => normalize(effectShape(e))) });
  demand(transfers > 0);
  return { entry, branch, body, localIds, effects, signature };
}

function lowerSharedStages(plan, { onExcluded } = {}) {
  const router = Object.fromEntries(['cursor', 'mode', 'error'].map(name => [name,
    plan.locals.find(local => local.name === `__pulse_router_${name}`)?.id]));
  if (!Object.values(router).every(Boolean)) return plan;
  const families = new Map();
  for (const entry of plan.routing?.entries || []) {
    if (!families.has(entry.handlerId)) families.set(entry.handlerId, []);
    families.get(entry.handlerId).push(entry);
  }
  const continuationOwners = new Map();
  const stages = [], replacement = new Map(), localOwners = new Map(), removedLocals = new Set(), effectReplacements = new Map();
  for (const entries of families.values()) {
    let rows;
    try {
      rows = entries.map(entry => rowFor(plan, entry, router));
      demand(rows.every(row => row.signature === rows[0].signature), 'registration-shape-mismatch');
    } catch (error) {
      if (!error?.[excluded]) throw error;
      // Optional internal inspection; never changes the valid fallback plan/hash.
      if (onExcluded && entries[0].handlerId) onExcluded({
        handlerId: entries[0].handlerId, entryIds: entries.map(entry => entry.stableId), reason: error.reason
      });
      continue;
    }
    const first = rows[0], id = `stage:${first.entry.stableId}`, nextCursorLocalId = `${id}:next`;
    const body = mapTree(first.body, node => node?.kind === 'assignment' && node.target?.id === router.cursor
      ? { ...node, value: { kind: 'local', id: nextCursorLocalId, valueKind: 'number' } } : node);
    const registrations = rows.map(row => {
      replacement.set(row.branch, { ...row.branch, then: [{ kind: 'stage-call', stageId: id, registrationId: row.entry.stableId }] });
      row.localIds.forEach(local => removedLocals.add(local));
      row.effects.forEach((effect, site) => {
        effectReplacements.set(effect.id, { ...effect, stageId: id, stageSite: site, inputs: first.effects[site].inputs, result: first.effects[site].result });
        continuationOwners.set(effect.continuationId, { stageId: id, stageSite: site });
      });
      return { entryId: row.entry.stableId, nextIndex: row.entry.nextIndex,
        effectIds: row.effects.map(e => e.id), continuationIds: row.effects.map(e => e.continuationId) };
    });
    first.localIds.forEach(local => { removedLocals.delete(local); localOwners.set(local, id); });
    stages.push({ version: VERSION, id, handlerId: first.entry.handlerId,
      inputs: { context: 'request', nextCursorLocalId, routerLocals: router }, outputs: OUTPUTS,
      frame: contract.frame,
      localIds: first.localIds, effectIds: first.effects.map(e => e.id), body, registrations });
  }
  if (!stages.length) return plan;
  const rewriteBranches = body => body.map(s => replacement.get(s) || (s.kind === 'if'
    ? { ...s, then: rewriteBranches(s.then), else: rewriteBranches(s.else) } : s));
  const locals = plan.locals.filter(local => !removedLocals.has(local.id)).map(local => localOwners.has(local.id)
    ? { ...local, scopeId: localOwners.get(local.id) } : local);
  for (const stage of stages) locals.push({ id: stage.inputs.nextCursorLocalId, scopeId: stage.id, name: '__pulse_stage_next_cursor', valueKind: 'number' });
  return { ...plan, stages, entry: { ...plan.entry, body: rewriteBranches(plan.entry.body) }, locals,
    effects: plan.effects.map(e => effectReplacements.get(e.id) || e),
    continuations: plan.continuations.map(c => continuationOwners.has(c.id) ? { ...c, ...continuationOwners.get(c.id) } : c) };
}

function validateSharedStages(plan, fail, walkStatements, walkExpression, stableStringify) {
  if (plan.stages !== undefined && !Array.isArray(plan.stages)) { fail('stages must be an array'); return; }
  const stages = new Map(), bindings = new Map(), calls = new Map();
  const entries = new Map((plan.routing?.entries || []).map(e => [e.stableId, e]));
  const effects = new Map(plan.effects.map(e => [e.id, e]));
  const continuations = new Map(plan.continuations.map(c => [c.id, c]));
  const locals = new Map(plan.locals.map(l => [l.id, l]));
  for (const stage of plan.stages || []) {
    if (!stage || typeof stage.id !== 'string' || !stage.id.startsWith('stage:')
      || (plan.handlers || []).some(handler => handler.id === stage.id) || stages.has(stage.id) || stage.version !== VERSION || !Array.isArray(stage.body)
      || !Array.isArray(stage.localIds) || !Array.isArray(stage.effectIds) || !Array.isArray(stage.registrations)
      || !stage.inputs || !same(stage.outputs, OUTPUTS)
      || !same(stage.frame, contract.frame)) {
      fail('shared stage contract is invalid'); continue;
    }
    stages.set(stage.id, stage);
    const router = stage.inputs.routerLocals || {};
    if (stage.inputs.context !== 'request' || !['cursor', 'mode', 'error'].every(name =>
      locals.get(router[name])?.name === `__pulse_router_${name}` && locals.get(router[name])?.scopeId === 'entry')) fail('stage requires explicit request and Router inputs');
    const own = new Set([...stage.localIds, stage.inputs.nextCursorLocalId]);
    if (own.size !== stage.localIds.length + 1 || [...own].some(id => locals.get(id)?.scopeId !== stage.id)
      || plan.locals.filter(l => l.scopeId === stage.id).length !== own.size
      || locals.get(stage.inputs.nextCursorLocalId)?.valueKind !== 'number') fail('stage local ownership is invalid');
    const allowed = new Set([...own, ...Object.values(router)]);
    const observedEffects = [], declaredLocals = [];
    const visitor = s => {
      if (!['local', 'expression', 'return', 'if', 'effect'].includes(s.kind)) fail('shared stage contains unsupported control flow');
      if (s.kind === 'local') declaredLocals.push(s.localId);
      if (s.kind === 'effect') { observedEffects.push(s.effectId); declaredLocals.push(s.result?.localId); }
      if (s.localId && !own.has(s.localId)) fail('stage statement crosses local ownership');
    };
    visitor.expression = expr => {
      if (expr.kind === 'pure-helper-call') fail('shared stage contains unsupported helper call');
      if (expr.kind === 'local' && !allowed.has(expr.id)) fail('stage captures another lexical owner');
      if (['assignment', 'update'].includes(expr.kind) && expr.target?.id === stage.inputs.nextCursorLocalId) fail('stage return input is read-only');
      if (expr.kind === 'assignment' && expr.target?.id === router.cursor
        && (expr.operator !== '=' || expr.value?.kind !== 'local' || expr.value.id !== stage.inputs.nextCursorLocalId)) fail('stage transfer must use its selected return cursor');
    };
    walkStatements(stage.body, visitor);
    if (!same(observedEffects, stage.effectIds) || !same(declaredLocals, stage.localIds)
      || !stage.effectIds.length || stage.effectIds.length > MAX_SITES) fail('stage sites or locals do not match its body');
    const first = stage.registrations[0];
    if (!first || !same(stage.effectIds, first.effectIds)) fail('stage requires a representative registration');
    for (const row of stage.registrations) {
      const entry = entries.get(row?.entryId);
      if (!row || bindings.has(row.entryId) || !['route', 'use'].includes(entry?.kind) || entry.nativeBody
        || entry.handlerId !== stage.handlerId || row.nextIndex !== entry.nextIndex
        || !Array.isArray(row.effectIds) || !Array.isArray(row.continuationIds)
        || row.effectIds.length !== stage.effectIds.length || row.continuationIds.length !== stage.effectIds.length) {
        fail('stage registration ownership is invalid'); continue;
      }
      bindings.set(row.entryId, stage.id);
      row.effectIds.forEach((id, site) => {
        const effect = effects.get(id), representative = effects.get(stage.effectIds[site]);
        const continuation = continuations.get(row.continuationIds[site]);
        if (!effect || effect.stageId !== stage.id || effect.stageSite !== site || effect.routerEntryStableId !== row.entryId
          || effect.kind !== 'fetch' || effect.decoder !== 'text' || effect.grouped || effect.result?.mode !== 'bind'
          || effect.continuationId !== row.continuationIds[site] || continuation?.routerEntryStableId !== row.entryId
          || continuation?.stageId !== stage.id || continuation?.stageSite !== site
          || !same(continuation?.effectIds, [id]) || !representative
          || stableStringify(effectShape(effect)) !== stableStringify(effectShape(representative))) fail('stage effect/continuation binding is invalid');
        for (const input of effect?.inputs || []) walkExpression(input.value, visitor.expression);
        if (!own.has(effect?.result?.localId)) fail('stage result crosses local ownership');
      });
    }
  }
  // Calls may occur only in the matching registration's admitted branch.
  function checkCalls(body, entryId, admission = false) {
    for (const s of body || []) {
      if (s.kind === 'stage-call') {
        if (!stages.has(s.stageId) || !admission || entryId !== s.registrationId || bindings.get(s.registrationId) !== s.stageId) fail('stage call is outside its registration admission');
        calls.set(s.registrationId, (calls.get(s.registrationId) || 0) + 1);
      }
      if (s.kind === 'if') {
        const entry = s.test?.kind === 'binary' && s.test.operator === '===' && s.test.left?.kind === 'local'
          && locals.get(s.test.left.id)?.name === '__pulse_router_cursor'
          && [...entries.values()].find(e => e.index === s.test.right?.value);
        checkCalls(s.then, entry ? entry.stableId : entryId, !entry && Boolean(entryId));
        checkCalls(s.else, undefined);
      }
    }
  }
  checkCalls(plan.entry?.body);
  for (const id of bindings.keys()) if (calls.get(id) !== 1) fail('stage registration requires one static call');
  for (const effect of plan.effects) if (effect.stageId !== undefined
    && (bindings.get(effect.routerEntryStableId) !== effect.stageId
      || !stages.get(effect.stageId)?.registrations.some(row => row.effectIds[effect.stageSite] === effect.id))) fail('orphan stage effect binding');
  for (const continuation of plan.continuations) if (continuation.stageId !== undefined
    && (bindings.get(continuation.routerEntryStableId) !== continuation.stageId
      || !stages.get(continuation.stageId)?.registrations.some(row => row.continuationIds[continuation.stageSite] === continuation.id))) fail('orphan stage continuation binding');
  return { stages, bindings };
}
module.exports = { VERSION, OUTPUTS, MAX_SITES, lowerSharedStages, validateSharedStages };
