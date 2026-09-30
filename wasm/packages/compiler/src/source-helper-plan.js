'use strict';
function validateHelpers(plan, fail, walkStatements, walkExpression) {
  if (plan.helpers !== undefined && !Array.isArray(plan.helpers)) { fail('helpers must be an array'); return; }
  const helpers = new Map(), locals = new Map(plan.locals.map(l => [l.id, l]));
  const effects = new Map(plan.effects.map(e => [e.id, e]));
  const calls = new Map(), sites = new Map();
  const admittedCalls = new Map();
  const admit = (body, owner) => { const visit = s => { if (s.kind === 'helper-call') admittedCalls.set(s, owner); }; visit.expression = () => {}; walkStatements(body, visit); };
  const cursor = plan.locals.find(l => l.scopeId === 'entry' && l.name === '__pulse_router_cursor')?.id;
  for (const entry of plan.routing?.entries || []) {
    if (!['route', 'use'].includes(entry.kind)) continue;
    if (entry.nativeBody) { const handler = plan.handlers.find(h => h.id === entry.stableId); if (handler) admit(handler.body, entry.stableId); continue; }
    const outer = plan.entry.body.find(s => s.kind === 'if' && s.test?.kind === 'binary' && s.test.operator === '===' && s.test.left?.id === cursor && s.test.right?.value === entry.index);
    if (outer?.then?.length === 1 && outer.then[0].kind === 'if') admit(outer.then[0].then, entry.stableId);
  }
  for (const helper of plan.helpers || []) {
    if (!helper || typeof helper.id !== 'string' || !helper.id.startsWith('helper:') || helpers.has(helper.id)
      || helper.version !== 'pulse.canonical-native-helper.v1' || !Array.isArray(helper.body)
      || !Array.isArray(helper.parameters) || !Array.isArray(helper.localIds)
      || JSON.stringify(helper.frame) !== JSON.stringify({ lifetime: 'invocation', reset: 'call', suspension: 'retain', nesting: false })
      || JSON.stringify(helper.outputs) !== JSON.stringify(['value', 'suspend', 'failure'])) { fail('invalid helper contract'); continue; }
    helpers.set(helper.id, helper);
    const owned = new Set(helper.localIds);
    if (owned.size !== helper.localIds.length || helper.localIds.some(id => locals.get(id)?.scopeId !== helper.id)
      || plan.locals.filter(l => l.scopeId === helper.id).length !== owned.size) fail('helper local ownership mismatch');
    if (new Set(helper.parameters.map(p => p.localId)).size !== helper.parameters.length) fail('duplicate helper inputs');
    for (const p of helper.parameters) if (!['string','number','boolean'].includes(p.valueKind)
      || !owned.has(p.localId) || locals.get(p.localId)?.valueKind !== p.valueKind) fail('invalid helper input');
    const resultKinds = new Set();
    const visitor = s => {
      if (s.kind === 'return') resultKinds.add(s.value?.valueKind);
      if (['helper-call', 'handler-call', 'stage-call', 'effect-group'].includes(s.kind)) fail('nested calls and groups are outside helper v1');
      if (s.localId && !owned.has(s.localId)) fail('helper statement crosses local ownership');
      if (s.kind === 'effect') {
        const effect = effects.get(s.effectId);
        if (effect?.helperId !== helper.id || effect?.routerEntryStableId !== undefined || !['bind','discard'].includes(effect?.result?.mode)) fail('helper effect ownership mismatch');
        sites.set(s.effectId, (sites.get(s.effectId) || 0) + 1);
        for (const input of effect?.inputs || []) walkExpression(input.value, visitor.expression);
        if (effect?.result?.localId && !owned.has(effect.result.localId)) fail('helper result crosses local ownership');
      }
    };
    visitor.expression = e => {
      if (e.kind === 'local' && !owned.has(e.id)) fail('helper captures another lexical owner');
      if (e.kind === 'intrinsic' && (e.name.startsWith('response.') || e.name.startsWith('router.'))) fail('helper cannot own a response or Router transfer');
      if (['assignment','update'].includes(e.kind) && helper.parameters.some(p => p.localId === e.target?.id)) fail('helper inputs are immutable');
    };
    walkStatements(helper.body, visitor);
    if (helper.resultKind !== (resultKinds.size === 1 ? [...resultKinds][0] : 'unknown')) fail('helper result kind mismatch');
  }
  for (const body of [plan.entry.body, ...(plan.handlers || []).map(h => h.body), ...(plan.stages || []).map(s => s.body)]) {
    const visitor = s => {
      if (s.kind === 'effect' && effects.get(s.effectId)?.helperId) fail('helper effect used outside its body');
      if (s.kind === 'effect-group' && s.effectIds.some(id => effects.get(id)?.helperId)) fail('helper effect used outside its body');
      if (s.kind !== 'helper-call') return;
      if (!admittedCalls.has(s) || admittedCalls.get(s) !== s.callerEntryId) fail('helper call requires its owning HTTP admission branch');
      const helper = helpers.get(s.helperId);
      if (!helper || !Array.isArray(s.arguments) || s.arguments.length !== helper.parameters.length
        || s.arguments.some((arg, i) => arg.valueKind !== helper.parameters[i].valueKind) || locals.get(s.localId)?.valueKind !== helper.resultKind) fail('invalid helper call binding');
      for (const arg of s.arguments || []) walkExpression(arg, e => {
        if (['assignment','update'].includes(e.kind)) fail('helper inputs must be read-only values');
      });
      calls.set(s.helperId, (calls.get(s.helperId) || 0) + 1);
    };
    visitor.expression = () => {};
    walkStatements(body, visitor);
  }
  for (const helper of helpers.values()) if (!calls.has(helper.id)) fail('helper requires a reachable call');
  for (const effect of plan.effects) if (effect.helperId && (!helpers.has(effect.helperId) || sites.get(effect.id) !== 1)) fail('helper effect requires one owning site');
  for (const c of plan.continuations) for (const id of c.effectIds) if (effects.get(id)?.helperId !== c.helperId) fail('helper continuation ownership mismatch');
}
module.exports = { validateHelpers };
