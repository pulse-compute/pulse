'use strict';
const contract = require('@pulse-compute/wasm-contracts/handler/canonical-native-plan');
const runtime = require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime');
const values = require('./pure-helper-values');
const isPure = helper => helper?.version === contract.CANONICAL_NATIVE_PURE_HELPER_VERSION;
function validateHelpers(plan, fail, walkStatements, walkExpression) {
  if (plan.helpers !== undefined && !Array.isArray(plan.helpers)) { fail('helpers must be an array'); return; }
  const helpers = new Map(), locals = new Map(plan.locals.map(l => [l.id, l]));
  const effects = new Map(plan.effects.map(e => [e.id, e]));
  const calls = new Map(), sites = new Map();
  const definitions = new Map(), writes = new Map(), memberWrites = [];
  const inputVisitor = s => { if (s.kind === 'local') definitions.set(s.localId, s.value); };
  inputVisitor.expression = e => {
    if (['assignment', 'update'].includes(e.kind) && ['property', 'element'].includes(e.target?.kind)) memberWrites.push(e);
    if (['assignment', 'update'].includes(e.kind) && e.target?.kind === 'local') {
      const list = writes.get(e.target.id) || []; list.push(e); writes.set(e.target.id, list);
    }
  };
  for (const body of [plan.entry.body, ...(plan.handlers || []).map(h => h.body), ...(plan.stages || []).map(h => h.body)]) walkStatements(body, inputVisitor);
  for (const effect of plan.effects) {
    for (const input of effect.inputs || []) walkExpression(input.value, inputVisitor.expression);
    for (const arg of effect.result?.decoder?.arguments || []) walkExpression(arg, inputVisitor.expression);
  }
  function proveInputs(expression, visiting = new Set()) {
    walkExpression(expression, e => {
      if (e.kind !== 'local' || visiting.has(e.id)) return;
      const next = new Set([...visiting, e.id]);
      const expected = locals.get(e.id)?.valueKind;
      const value = definitions.get(e.id);
      if (value) {
        const actual = value.kind === 'pure-helper-call' ? helpers.get(value.helperId)?.resultKind : scalarArgumentKind(value, locals, fail, true);
        if (actual !== expected || value.valueKind !== expected) fail('pure input local initializer kind mismatch');
        proveInputs(value, next);
      } else if (![...effects.values()].some(effect => effect.result?.localId === e.id && effect.result.valueKind === expected)) {
        fail('pure input local requires a proven initializer or effect result');
      }
      for (const write of writes.get(e.id) || []) {
        if (scalarArgumentKind(write, locals, fail) !== expected) fail('pure input local write kind mismatch');
        proveInputs(write, next);
      }
    });
  }
  function schemaType(node) {
    if (['string','boolean'].includes(node?.kind)) return node.kind;
    if (['i32','u32','f64'].includes(node?.kind)) return 'number';
    if (node?.kind === 'array' && schemaType(node.element) === 'number') return { kind: 'number-array' };
    if (node?.kind === 'object' && !node.open && node.fields?.every(f => f.required)) return { kind: 'record', fields: node.fields.map(f => ({ name: f.name, type: schemaType(f.value) })) };
  }
  function schemaMatches(id, expected) {
    if (id?.kind !== 'literal' || typeof id.value !== 'string') return false;
    const type = schemaType(plan.schemas?.registry?.schemas?.find(s => s.id === id.value)?.root);
    return values.validType(type) && values.same(type, expected);
  }
  function proveBorrow(e, expected, seen = new Set()) {
    if (!values.validType(expected)) { fail('invalid borrow type'); return false; }
    if (!e) return false;
    if (values.scalar(expected)) {
      proveInputs(e);
      return scalarArgumentKind(e, locals, fail) === expected;
    }
    if (e.kind === 'local') {
      if (seen.has(e.id) || locals.get(e.id)?.declaration !== 'const' || writes.has(e.id)) { fail('borrowed caller binding must be immutable and initialized'); return false; }
      // Alias graph rooted at this value must not contain a shape-changing write.
      const aliases = new Set([e.id]);
      const referencesAlias = value => {
        let found = false;
        walkExpression(value, child => { if (child.kind === 'local' && aliases.has(child.id)) found = true; });
        return found;
      };
      let changed = true;
      while (changed) {
        changed = false;
        const propagate = (id, value) => {
          if (!aliases.has(id) && referencesAlias(value)) { aliases.add(id); changed = true; }
        };
        for (const [id, value] of definitions) propagate(id, value);
        for (const [id, updates] of writes) for (const update of updates) propagate(id, update.value);
      }
      for (const write of memberWrites) if (referencesAlias(write.target)) fail('borrowed caller shape is mutated through an alias');
      const value = definitions.get(e.id);
      if (!value) {
        const result = [...effects.values()].find(effect => effect.result?.localId === e.id)?.result;
        return result?.valueKind === 'json' && result.decoder?.kind === 'json' && schemaMatches(result.decoder.arguments?.[0], expected);
      }
      return proveBorrow(value, expected, new Set([...seen, e.id]));
    }
    if (e.kind === 'intrinsic' && ['request.json', 'schema.decode.text'].includes(e.name)) return schemaMatches(e.arguments?.[e.name === 'request.json' ? 0 : 1], expected);
    if (expected.kind === 'number-array') return e.kind === 'array' && e.items.every(item => proveBorrow(item, 'number', seen));
    if (e.kind !== 'object' || e.entries.some(entry => entry.kind !== 'property' || entry.key?.kind !== 'literal')
      || new Set(e.entries.map(entry => entry.key.value)).size !== e.entries.length) return false;
    return expected.fields.length === e.entries.length && expected.fields.every(field => proveBorrow(e.entries.find(entry => entry.key.value === field.name)?.value, field.type, seen));
  }
  const admittedCalls = new Map();
  const admit = (body, owner) => { const visit = s => { if (s.kind === 'helper-call') admittedCalls.set(s, owner); }; visit.expression = e => { if (e.kind === 'pure-helper-call') admittedCalls.set(e, owner); }; walkStatements(body, visit); };
  const cursor = plan.locals.find(l => l.scopeId === 'entry' && l.name === '__pulse_router_cursor')?.id;
  for (const entry of plan.routing?.entries || []) {
    if (!['route', 'use'].includes(entry.kind)) continue;
    if (entry.nativeBody) { const handler = plan.handlers.find(h => h.id === entry.stableId); if (handler) admit(handler.body, entry.stableId); continue; }
    const outer = plan.entry.body.find(s => s.kind === 'if' && s.test?.kind === 'binary' && s.test.operator === '===' && s.test.left?.id === cursor && s.test.right?.value === entry.index);
    if (outer?.then?.length === 1 && outer.then[0].kind === 'if') admit(outer.then[0].then, entry.stableId);
  }
  for (const helper of plan.helpers || []) {
    if (!helper || typeof helper.id !== 'string' || !helper.id.startsWith('helper:') || helpers.has(helper.id)
      || !isPure(helper) && helper.version !== 'pulse.canonical-native-helper.v1' || !Array.isArray(helper.body)
      || !Array.isArray(helper.parameters) || !Array.isArray(helper.localIds)
      || JSON.stringify(helper.frame) !== JSON.stringify({ lifetime: 'invocation', reset: 'call', suspension: isPure(helper) ? 'none' : 'retain', nesting: false })
      || JSON.stringify(helper.outputs) !== JSON.stringify(isPure(helper) ? ['value', 'failure'] : ['value', 'suspend', 'failure'])) { fail('invalid helper contract'); continue; }
    helpers.set(helper.id, helper);
    const owned = new Set(helper.localIds);
    if (owned.size !== helper.localIds.length || helper.localIds.some(id => locals.get(id)?.scopeId !== helper.id)
      || plan.locals.filter(l => l.scopeId === helper.id).length !== owned.size) fail('helper local ownership mismatch');
    if (new Set(helper.parameters.map(p => p.localId)).size !== helper.parameters.length) fail('duplicate helper inputs');
    for (const p of helper.parameters) if (!(values.scalar(p.valueKind) && p.borrow === undefined || isPure(helper) && p.borrow?.version === contract.CANONICAL_NATIVE_PURE_BORROW_VERSION && Object.keys(p.borrow).sort().join() === 'type,version' && values.validType(p.borrow.type) && !values.scalar(p.borrow.type) && values.kind(p.borrow.type) === p.valueKind)
      || !owned.has(p.localId) || locals.get(p.localId)?.valueKind !== p.valueKind || isPure(helper) && locals.get(p.localId)?.declaration !== 'const') fail('invalid helper input');
    if (isPure(helper)) validatePureBody(helper, locals, fail);
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
      if (e.kind === 'pure-helper-call') fail('helper calls cannot nest');
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
      if (!helper || isPure(helper) || !Array.isArray(s.arguments) || s.arguments.length !== helper.parameters.length
        || s.arguments.some((arg, i) => arg.valueKind !== helper.parameters[i].valueKind) || locals.get(s.localId)?.valueKind !== helper.resultKind) fail('invalid helper call binding');
      for (const arg of s.arguments || []) walkExpression(arg, e => {
        if (['assignment','update'].includes(e.kind)) fail('helper inputs must be read-only values');
      });
      calls.set(s.helperId, (calls.get(s.helperId) || 0) + 1);
    };
    visitor.expression = e => {
      if (e.kind !== 'pure-helper-call') return;
      const helper = helpers.get(e.helperId);
      if (!admittedCalls.has(e) || !isPure(helper) || !Array.isArray(e.arguments)
        || e.arguments.length !== helper.parameters.length || e.valueKind !== helper.resultKind
        || e.arguments.some((arg, i) => helper.parameters[i]?.borrow ? !proveBorrow(arg, helper.parameters[i].borrow.type) : scalarArgumentKind(arg, locals, fail) !== helper.parameters[i]?.valueKind)) fail('invalid pure helper call');
      for (const [i, arg] of (e.arguments || []).entries()) { if (!helper?.parameters[i]?.borrow) proveInputs(arg); }
      for (const arg of e.arguments || []) walkExpression(arg, child => {
        if (child.kind === 'pure-helper-call') fail('pure calls cannot nest in arguments');
      });
      calls.set(e.helperId, (calls.get(e.helperId) || 0) + 1);
    };
    walkStatements(body, visitor);
  }
  function rejectCalls(value) {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'pure-helper-call') fail('pure call outside an admitted synchronous expression');
    for (const child of Object.values(value)) if (child && typeof child === 'object') rejectCalls(child);
  }
  for (const effect of plan.effects) rejectCalls(effect);
  for (const h of plan.helpers || []) if (!isPure(h)) rejectCalls(h.body);
  const loopVisitor = s => { if (['pure-loop', 'read-loop', 'helper-call'].includes(s.kind)) rejectCalls(s); };
  loopVisitor.expression = () => {};
  for (const body of [plan.entry.body, ...(plan.handlers || []).map(h => h.body), ...(plan.stages || []).map(h => h.body)]) walkStatements(body, loopVisitor);
  for (const helper of helpers.values()) if (!calls.has(helper.id)) fail('helper requires a reachable call');
  for (const effect of plan.effects) if (effect.helperId && (!helpers.has(effect.helperId) || sites.get(effect.id) !== 1)) fail('helper effect requires one owning site');
  for (const c of plan.continuations) for (const id of c.effectIds) if (effects.get(id)?.helperId !== c.helperId) fail('helper continuation ownership mismatch');
}
module.exports = { validateHelpers };

// Independently prove the bounded value grammar after deserialization, rather than
// trusting valueKind tags or a recomputed hash. No external owner is reachable.
function validatePureBody(helper, locals, fail) {
  const scalars = new Set(['string', 'number', 'boolean']);
  const owned = new Set(helper.localIds);
  const parameters = new Set(helper.parameters.map(p => p.localId));
  const initialized = new Set(parameters);
  const types = new Map(helper.parameters.map(p => [p.localId, values.validType(p.borrow?.type || p.valueKind) ? p.borrow?.type || p.valueKind : 'unknown']));
  if (!scalars.has(helper.resultKind)) fail('pure result must be scalar');
  function expression(e, available) {
    if (!e || typeof e !== 'object') { fail('missing pure expression'); return 'unknown'; }
    let kind = 'unknown';
    const child = value => expression(value, available);
    if (e.kind === 'literal' && scalars.has(typeof e.value) && (typeof e.value !== 'number' || Number.isFinite(e.value))) kind = typeof e.value;
    else if (e.kind === 'local') {
      if (!owned.has(e.id) || !available.has(e.id)) fail('pure local must be initialized and owned');
      kind = types.get(e.id) || locals.get(e.id)?.valueKind;
    } else if (e.kind === 'property') {
      kind = values.member(child(e.object), e.property);
    } else if (e.kind === 'element') {
      const object = child(e.object), index = child(e.index);
      if (object?.kind !== 'number-array' || index !== 'number') fail('pure element requires a numeric array and index');
      kind = 'number';
    } else if (e.kind === 'binary') {
      const a = child(e.left), b = child(e.right);
      if (!values.scalar(a) || !values.scalar(b)) fail('pure operators require scalar operands');
      if (!runtime.CANONICAL_NATIVE_BINARY_OPERATORS.includes(e.operator) || e.operator === 'in') fail('unsupported pure binary operator');
      if (['===', '!==', '==', '!=', '<', '<=', '>', '>='].includes(e.operator)) kind = 'boolean';
      else if (['&&', '||', '??'].includes(e.operator)) kind = a === b ? a : 'unknown';
      else if (e.operator === '+' && (a === 'string' || b === 'string')) kind = 'string';
      else { if (a !== 'number' || b !== 'number') fail('pure arithmetic requires numbers'); kind = 'number'; }
    } else if (e.kind === 'unary') {
      const value = child(e.value);
      if (!values.scalar(value)) fail('pure unary requires a scalar');
      if (!runtime.CANONICAL_NATIVE_UNARY_OPERATORS.includes(e.operator) || e.operator === 'void') fail('unsupported pure unary operator');
      kind = e.operator === '!' ? 'boolean' : e.operator === 'typeof' ? 'string' : 'number';
      if (kind === 'number' && value !== 'number') fail('pure numeric unary requires a number');
    } else if (e.kind === 'conditional') {
      child(e.test); const a = child(e.whenTrue), b = child(e.whenFalse); kind = a === b ? a : 'unknown';
    } else if (e.kind === 'template') {
      if (!Array.isArray(e.parts)) fail('invalid pure template');
      for (const part of e.parts || []) {
        if (part.kind === 'value') { if (!values.scalar(child(part.value))) fail('pure templates require scalars'); }
        else if (part.kind !== 'text' || typeof part.value !== 'string') fail('invalid pure template part');
      }
      kind = 'string';
    } else if (e.kind === 'assignment' || e.kind === 'update') {
      const target = e.target, previous = child(target);
      if (!values.scalar(previous) || target?.kind !== 'local' || parameters.has(target.id) || locals.get(target.id)?.declaration !== 'let') fail('pure writes require a mutable owned scalar local');
      if (e.kind === 'assignment') {
        kind = child(e.value);
        if (!runtime.CANONICAL_NATIVE_ASSIGNMENT_OPERATORS.includes(e.operator) || kind !== previous) fail('invalid pure scalar assignment');
        if (!['=', '+=', '&&=', '||=', '??='].includes(e.operator) && kind !== 'number') fail('pure arithmetic assignment requires numbers');
      } else {
        if (!['++', '--'].includes(e.operator) || typeof e.prefix !== 'boolean' || previous !== 'number') fail('invalid pure scalar update');
        kind = 'number';
      }
    } else fail('pure helper expression cannot capture, call, allocate records or access authority');
    if (!values.validType(kind) || values.kind(kind) !== e.valueKind) fail('pure expression kind mismatch');
    return kind;
  }
  function body(statements, available) {
    if (!Array.isArray(statements)) { fail('invalid pure body'); return false; }
    let returns = false;
    for (const s of statements) {
      if (s.kind === 'local') {
        const kind = expression(s.value, available);
        if (!owned.has(s.localId) || available.has(s.localId) || !['let', 'const'].includes(s.declaration)
          || locals.get(s.localId)?.declaration !== s.declaration || locals.get(s.localId)?.valueKind !== values.kind(kind) || s.valueKind !== values.kind(kind) || !values.scalar(kind) && s.declaration !== 'const') fail('invalid pure local binding');
        types.set(s.localId, kind);
        available.add(s.localId);
      } else if (s.kind === 'return') {
        if (expression(s.value, available) !== helper.resultKind) fail('pure return kind mismatch');
        returns = true;
      } else if (s.kind === 'expression') expression(s.expression, available);
      else if (s.kind === 'if') {
        if (!values.scalar(expression(s.test, available))) fail('pure conditions require scalars');
        const yes = body(s.then, new Set(available)), no = body(s.else, new Set(available));
        returns ||= yes && no;
      } else if (s.kind === 'pure-loop') {
        if (!owned.has(s.localId) || available.has(s.localId) || parameters.has(s.localId) || locals.get(s.localId)?.valueKind !== 'number') fail('invalid pure counter ownership');
        const inside = new Set([...available, s.localId]);
        expression(s.test, inside); body(s.body, inside);
      } else if (!['break', 'continue'].includes(s.kind)) fail('pure helper cannot suspend or transfer Router control');
    }
    return returns;
  }
  if (!body(helper.body, initialized)) fail('pure helper must return on every path');
}

function scalarArgumentKind(e, locals, fail, bound = false) {
  if (!e || typeof e !== 'object') { fail('missing pure call argument'); return 'unknown'; }
  const child = v => scalarArgumentKind(v, locals, fail, bound);
  let kind = 'unknown';
  if (e.kind === 'literal' && ['string', 'number', 'boolean'].includes(typeof e.value)) kind = typeof e.value;
  else if (e.kind === 'local') kind = locals.get(e.id)?.valueKind;
  else if (bound && e.kind === 'intrinsic' && ['schema.encode.text', 'state.get'].includes(e.name)) kind = e.name === 'state.get' ? 'string-or-undefined' : 'string';
  else if (bound && e.kind === 'method-call' && ['string.trim', 'text', 'header'].includes(e.method)) kind = e.method === 'header' ? 'string-or-undefined' : 'string';
  else if (e.kind === 'context-read' && ['req.method', 'req.path', 'req.url'].includes(e.path?.join('.'))) kind = 'string';
  else if (e.kind === 'intrinsic' && ['request.header', 'request.text', 'router.param'].includes(e.name)) {
    for (const arg of e.arguments || []) child(arg);
    const arity = e.name === 'request.text' ? 0 : e.name === 'request.header' ? 1 : 3;
    if (!Array.isArray(e.arguments) || e.arguments.length !== arity) fail('invalid pure scalar input intrinsic');
    kind = e.name === 'request.text' ? 'string' : 'string-or-undefined';
  } else if (e.kind === 'binary') {
    const a = child(e.left), b = child(e.right);
    if (!runtime.CANONICAL_NATIVE_BINARY_OPERATORS.includes(e.operator) || e.operator === 'in') fail('unsupported pure argument operator');
    if (['===','!==','==','!=','<','<=','>','>='].includes(e.operator)) kind='boolean';
    else if (['&&','||','??'].includes(e.operator)) {
      kind = a === b ? a : ['||','??'].includes(e.operator) && new Set([a,b]).has('string') && new Set([a,b]).has('string-or-undefined') ? 'string' : 'unknown';
    } else kind = e.operator === '+' && (a === 'string' || b === 'string') ? 'string' : 'number';
  } else if (e.kind === 'unary') {
    child(e.value);
    if (!['!','+','-','~','typeof'].includes(e.operator)) fail('unsupported pure argument unary');
    kind = e.operator === '!' ? 'boolean' : e.operator === 'typeof' ? 'string' : 'number';
  } else if (e.kind === 'conditional') {
    child(e.test); const a=child(e.whenTrue), b=child(e.whenFalse); kind=a===b?a:'unknown';
  } else if (e.kind === 'template') {
    for (const part of e.parts || []) if(part.kind==='value') child(part.value);
    kind='string';
  } else if (e.kind === 'assignment' || e.kind === 'update') {
    const target=child(e.target);
    if(e.target?.kind !== 'local' || locals.get(e.target.id)?.declaration !== 'let') fail('pure argument mutation requires a mutable local');
    if(e.kind==='assignment') {
      kind=child(e.value);
      if(!runtime.CANONICAL_NATIVE_ASSIGNMENT_OPERATORS.includes(e.operator) || kind!==target) fail('invalid pure argument assignment');
    } else { if(!['++','--'].includes(e.operator) || typeof e.prefix !== 'boolean' || target!=='number') fail('invalid pure argument update'); kind='number'; }
  } else fail('pure helper argument requires a proven scalar expression or request scalar read');
  if (!['string','number','boolean','string-or-undefined'].includes(kind) || e.valueKind !== kind) fail('pure argument kind mismatch');
  return kind;
}
