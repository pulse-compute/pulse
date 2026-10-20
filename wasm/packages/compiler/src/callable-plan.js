'use strict';
// Experimental v1 composition boundary. Computation admission remains canonical.
const VERSION = 'pulse.callable-proof.v1';
function validateCallables(plan, fail, walkStatements, validatePlan) {
  const entries = plan.callables || [];
  if (!Array.isArray(entries) || entries.length > 16) { fail('callable table exceeds proof limit'); return; }
  if (plan.callable) {
    const c = plan.callable;
    const first = plan.entry?.body?.[0];
    if (c.version !== VERSION || !first || first.kind !== 'local' || first.localId !== c.inputLocalId || first.value?.kind !== 'callable-input'
      || first.declaration !== 'const') fail('invalid callable input boundary');
    for (const id of [c.inputSchema, c.outputSchema]) if (!plan.schemas?.registry?.schemas?.some(s => s.id === id)) fail('callable schema missing');
    if (entries.length || plan.effects?.length || plan.continuations?.length || plan.handlers?.length || plan.helpers?.length || plan.stages?.length || plan.packages?.application) fail('callable proof cannot suspend, nest or own dispatch');
    if (plan.capabilities?.length) fail('callable proof cannot acquire effects or HTTP authority');
  }
  for (const callee of entries) {
    if (!callee?.callable || callee.callables?.length) { fail('invalid or nested callable'); continue; }
    try { validatePlan(callee); } catch { fail('invalid callable plan'); }
    for (const schema of callee.schemas?.registry?.schemas || []) {
      if (JSON.stringify(plan.schemas?.registry?.schemas?.find(s => s.id === schema.id)) !== JSON.stringify(schema)) fail('callable schema identity differs from caller');
    }
    for (const record of callee.binaryResources?.records || []) {
      if (JSON.stringify(plan.binaryResources?.records?.find(r => r.id === record.id)) !== JSON.stringify(record)) fail('callable resource identity differs from caller');
    }
  }
  let inputUses = 0, callSites = 0;
  const used = new Set(plan.packages?.application?.callableIndices || []);
  for (const index of used) if (!Number.isInteger(index) || index < 0 || index >= entries.length) fail('invalid package callable target');
  const definitions = new Map(), writes = new Map(), memberWrites = [];
  const visitor = statement => { if (statement.kind === 'local') definitions.set(statement.localId, statement.value); };
  const bodies = [plan.entry?.body, ...(plan.handlers || []).map(h => h.body), ...(plan.helpers || []).map(h => h.body), ...(plan.stages || []).map(h => h.body)];
  visitor.expression = e => {
    if (['assignment','update'].includes(e.kind)) {
      if (['property','element'].includes(e.target?.kind)) memberWrites.push(e);
      if (e.target?.kind === 'local') { const list = writes.get(e.target.id) || []; list.push(e); writes.set(e.target.id,list); }
    }
    if (e.kind === 'callable-input') {
      inputUses++;
      if (!plan.callable || e.valueKind !== 'object') fail('callable input outside callable');
    }
    if (e.kind === 'callable-call') {
      callSites++; used.add(e.index);
      if (plan.callable || !Number.isInteger(e.index) || e.index < 0 || e.index >= entries.length || !e.argument || e.valueKind !== 'object') fail('invalid callable target');
    }
    if (plan.callable && (e.kind === 'context-read' || e.kind === 'intrinsic' && !['schema.encode.text','schema.decode.text'].includes(e.name))) fail('callable cannot access request, response or state');
    if (plan.callable && ['assignment','update'].includes(e.kind) && e.target?.id === plan.callable.inputLocalId) fail('callable input binding is immutable');
  };
  for (const body of bodies) walkStatements(body || [], visitor);
  if (callSites > 16) fail('callable site limit exceeded');
  if (used.size !== entries.length) fail('unreachable callable retained');
  function rejectLoopCalls(n, inLoop = false) {
    if (!n || typeof n !== 'object') return;
    if (inLoop && n.kind === 'callable-call') fail('calls inside loops are outside the proof');
    for (const v of Object.values(n)) if (v && typeof v === 'object') rejectLoopCalls(v, inLoop || ['pure-loop','read-loop'].includes(n.kind));
  }
  for (const body of bodies) rejectLoopCalls(body);
  if (plan.callable) require('./source-helper-plan').validateReadonlyInput({kind:'local',id:plan.callable.inputLocalId}, { definitions,writes,memberWrites,
    inputType: e => ['string','number','boolean','undefined','null'].includes(e?.valueKind) ? e.valueKind : undefined }, fail);
  if (plan.callable && inputUses !== 1) fail('callable needs one input binding');
}
module.exports = { VERSION, validateCallables };
