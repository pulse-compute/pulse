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
  const definitionCounts = new Map(), resultBindings = new Set(), constDefinitions = new Set();
  const inputVisitor = s => {
    if (s.kind === 'local') {
      definitions.set(s.localId, s.value);
      definitionCounts.set(s.localId, (definitionCounts.get(s.localId) || 0) + 1);
      if (s.declaration === 'const') constDefinitions.add(s.localId);
    }
    if (s.result?.localId) resultBindings.add(s.result.localId);
    for (const result of s.results || []) if (result.localId) resultBindings.add(result.localId);
    // Loop ownership, zero initialization, monotonic steps and immutable active
    // counters are independently checked by validatePlanTree.
    if (['pure-loop', 'read-loop'].includes(s.kind)) {
      definitions.set(s.localId, { kind: 'literal', value: 0, valueKind: 'number' });
      resultBindings.add(s.localId);
    }
  };
  inputVisitor.expression = e => {
    if (['assignment', 'update'].includes(e.kind) && ['property', 'element'].includes(e.target?.kind)) memberWrites.push(e);
    if (['assignment', 'update'].includes(e.kind) && e.target?.kind === 'local') {
      const list = writes.get(e.target.id) || []; list.push(e); writes.set(e.target.id, list);
    }
  };
  for (const body of [plan.entry.body, ...(plan.handlers || []).map(h => h.body), ...(plan.stages || []).map(h => h.body)]) walkStatements(body, inputVisitor);
  for (const effect of plan.effects) {
    if (effect.result?.localId) resultBindings.add(effect.result.localId);
    for (const input of effect.inputs || []) walkExpression(input.value, inputVisitor.expression);
    for (const arg of effect.result?.decoder?.arguments || []) walkExpression(arg, inputVisitor.expression);
  }
  function proveInputs(expression, visiting = new Set()) {
    if (!expression || typeof expression !== 'object') return;
    // A const scalar snapshot checked at this exact branch read does not borrow
    // its initializer's object graph. Writes to that graph cannot change it.
    if (expression.kind === 'local' && guardedScalar(expression)) {
      if (expression.valueKind !== guardedScalar(expression)) fail('guarded scalar kind mismatch');
      return;
    }
    if (expression.kind === 'local' && expression.valueKind !== locals.get(expression.id)?.valueKind) fail('pure input local tag mismatch');
    if (['object','array'].includes(expression.kind) && expression.valueKind !== expression.kind) fail('pure input structural tag mismatch');
    if (expression.kind !== 'local' && values.scalar(inputType(expression))) scalarArgumentKind(expression,locals,fail,true,projectionType);
    // Schema decoders and typed effect results establish their own boundary;
    // the encoded input need not itself have the decoded shape.
    if (expression.kind === 'intrinsic' && ['request.json','schema.decode.text'].includes(expression.name)) return;
    if (expression.kind === 'object') { for (const field of expression.entries) proveInputs(field.value, visiting); return; }
    if (expression.kind !== 'local') {
      for (const child of Object.values(expression)) {
        if (Array.isArray(child)) for (const item of child) proveInputs(item,visiting);
        else if (child && typeof child === 'object') proveInputs(child,visiting);
      }
      return;
    }
    const e=expression;
    if (visiting.has(e.id)) return;
    const next = new Set([...visiting,e.id]), expected=locals.get(e.id)?.valueKind;
    const type=inputType(e), structured=type && !values.scalar(type) && typeof type !== 'string';
    const value=definitions.get(e.id);
    if (value) {
      if (value.valueKind !== expected) fail('pure input initializer tag mismatch');
      if (!structured) {
        const actual=value.kind === 'pure-helper-call' ? helpers.get(value.helperId)?.resultKind : scalarArgumentKind(value,locals,fail,true,projectionType);
        if(actual!==expected || value.valueKind!==expected)fail('pure input local initializer kind mismatch');
      }
      proveInputs(value,next);
    } else if (!resultEffects.has(e.id) || resultEffects.get(e.id).result.valueKind!==expected) fail('pure input local requires a proven initializer or effect result');
    for(const write of writes.get(e.id)||[]) {
      if (!structured && scalarArgumentKind(write,locals,fail,false,projectionType)!==expected)fail('pure input local write kind mismatch');
      proveInputs(write.value,next);
    }
  }
  // Reconstruct caller provenance from the serialized expression/definition graph.
  // No expression valueKind or call-site type assertion can create a record proof.
  const resultEffects = new Map(plan.effects.filter(e => e.result?.localId).map(e => [e.result.localId, e]));
  for (const effect of plan.effects) if (effect.borrowedValue !== undefined) {
    const b = effect.borrowedValue;
    if (effect.kind !== 'kv.getVersioned' || effect.providerKind !== 'kv' || effect.operation !== 'getVersioned'
      || effect.capability !== 'kv.getVersioned' || effect.result?.mode !== 'bind' || effect.result.valueKind !== 'json'
      || effect.result.decoder || b?.version !== contract.CANONICAL_NATIVE_TYPED_KV_BORROW_VERSION
      || Object.keys(b).sort().join() !== 'type,version' || !values.validType(b.type)) fail('invalid typed KV borrow provenance');
  }
  // Only an explicit null guard or a definitely non-null assignment removes a
  // nullable initializer. Facts are attached to each read, including alias initializers.
  const nonNullAt = new WeakMap();
  const scalarAt = new WeakMap();
  const scalarKey = (id, kind) => `scalar:${id}:${kind}`;
  function guardedScalar(e) {
    if (e?.kind !== 'local' || locals.get(e.id)?.declaration !== 'const' || !constDefinitions.has(e.id)
      || definitionCounts.get(e.id) !== 1 || resultBindings.has(e.id) || writes.has(e.id)) return;
    return ['string', 'number', 'boolean'].find(kind => scalarAt.get(e)?.has(scalarKey(e.id, kind)));
  }
  function nullFacts(e, truth, facts) {
    if(e?.kind!=='binary')return;
    let mutates=false;walkExpression(e,node=>{if(['assignment','update'].includes(node.kind))mutates=true;});
    if(mutates)return;
    if ((e.operator==='&&' && truth) || (e.operator==='||' && !truth)) {
      nullFacts(e.left,truth,facts);nullFacts(e.right,truth,facts);return;
    }
    if(!['===','!=='].includes(e.operator))return;
    if (e.left?.kind === 'unary' && e.left.operator === 'typeof' && e.left.value?.kind === 'local'
      && e.right?.kind === 'literal' && ['string','number','boolean'].includes(e.right.value)
      && (e.operator === '===') === truth) facts.add(scalarKey(e.left.value.id, e.right.value));
    const local=e.left?.kind==='local' && e.right?.kind==='literal' && e.right.value===null ? e.left
      : e.right?.kind==='local' && e.left?.kind==='literal' && e.left.value===null ? e.right : undefined;
    if(local && (e.operator==='!==')===truth)facts.add(local.id);
  }
  function nonNullValue(e) {
    return e && (e.kind==='literal' && e.value!==null || ['object','array','template'].includes(e.kind)
      || e.kind==='intrinsic' && ['request.json','schema.decode.text'].includes(e.name));
  }
  function markExpression(e,facts) {
    if(!e || typeof e!=='object')return;
    nonNullAt.set(e,new Set(facts));
    scalarAt.set(e,new Set(facts));
    if(e.kind==='conditional' || e.kind==='binary' && ['&&','||','??'].includes(e.operator)) {
      markExpression(e.test || e.left,facts);
      const yes=new Set(facts),no=new Set(facts);
      if(e.kind==='conditional') {
        nullFacts(e.test,true,yes);nullFacts(e.test,false,no);
        markExpression(e.whenTrue,yes);markExpression(e.whenFalse,no);
      } else markExpression(e.right,yes);
      facts.clear();for(const id of yes)if(no.has(id))facts.add(id);
      return;
    }
    for(const child of Object.values(e)) {
      if(Array.isArray(child))for(const item of child)markExpression(item,facts);
      else if(child && typeof child==='object')markExpression(child,facts);
    }
    if(e.kind==='assignment' && e.target?.kind==='local') {
      facts.delete(e.target.id);
      if(e.operator==='=' && nonNullValue(e.value))facts.add(e.target.id);
    }
  }
  function markBody(body, facts) {
    for(const s of body||[]) {
      if(s.kind==='if') {
        markExpression(s.test,facts);
        const yes=new Set(facts),no=new Set(facts);nullFacts(s.test,true,yes);nullFacts(s.test,false,no);
        const yr=markBody(s.then,yes),nr=markBody(s.else,no);
        if(yr && nr)return true;
        const merged=yr?no:nr?yes:new Set([...yes].filter(id=>no.has(id)));
        facts.clear();for(const id of merged)facts.add(id);
      } else if(['pure-loop','read-loop'].includes(s.kind)) {
        // A later iteration may observe a write from the previous iteration.
        // Do not import a pre-loop non-null fact for any loop-carried binding.
        const inside=new Set(facts);
        const visit=()=>{};visit.expression=e=>{if(e.kind==='assignment' && e.target?.kind==='local'){facts.delete(e.target.id);inside.delete(e.target.id);}};
        walkStatements(s.body,visit);
        markExpression(s.test,inside);markBody(s.body,inside);
      } else {
        markExpression(s.value||s.expression,facts);
        if(s.kind==='local') {facts.delete(s.localId);if(nonNullValue(s.value))facts.add(s.localId);}
        if(s.kind==='return')return true;
      }
    }
    return false;
  }
  for(const body of [plan.entry.body,...(plan.handlers||[]).map(h=>h.body),...(plan.stages||[]).map(h=>h.body)])markBody(body,new Set());
  const inputTypes = new WeakMap();
  function inputType(e, seen = new Set()) {
    if(!e || typeof e!=='object')return;
    if (guardedScalar(e)) return guardedScalar(e);
    if(inputTypes.has(e))return inputTypes.get(e);
    const types = {schemas:plan.schemas?.registry, get(id) {
      if (seen.has(id)) return undefined;
      const next = new Set([...seen,id]);
      const value = definitions.get(id), effect = resultEffects.get(id);
      const candidates=value?[value]:[];
      for(const write of writes.get(id)||[]) {
        if(write.kind!=='assignment' || write.operator!=='=') {
          return values.scalar(inputType(value,next)) ? inputType(value,next) : undefined;
        }
        candidates.push(write.value);
      }
      const types=candidates.filter(v=>!(v?.kind==='literal' && v.value===null && nonNullAt.get(e)?.has(id))).map(v=>inputType(v,next));
      if(effect)types.push(values.effectType(effect,plan.schemas?.registry));
      return types.length && types[0] && types.every(t=>values.same(types[0],t)) ? types[0] : undefined;
    }};
    const type=values.readType(e,types);
    if(type)inputTypes.set(e,type);
    return type;
  }
  const readonlyChecked=new WeakSet();
  function readonlyInput(e) {
    if(!e || readonlyChecked.has(e))return;
    readonlyChecked.add(e);
    const aliases = new Set(), visited=new Set();
    const scalarType=t=>typeof t==='string';
    function collect(value) {
      if(!value || typeof value!=='object')return;
      if(value.kind==='intrinsic')return;
      if(value.kind==='local') {
        if(visited.has(value.id))return;visited.add(value.id);
        if(!scalarType(inputType(value)))aliases.add(value.id);
        collect(definitions.get(value.id));
        for(const write of writes.get(value.id)||[])collect(write.value);
        return;
      }
      if(value.kind==='object') {
        for(const field of value.entries||[])if(!scalarType(inputType(field.value)))collect(field.value);
        return;
      }
      for(const child of Object.values(value)) {
        if(Array.isArray(child))for(const item of child)collect(item);
        else if(child && typeof child==='object')collect(child);
      }
    }
    collect(e);
    function references(value) {
      if(!value || typeof value!=='object')return false;
      if(value.kind==='local')return aliases.has(value.id);
      if(['property','element'].includes(value.kind))return !scalarType(inputType(value)) && references(value.object);
      if(value.kind==='conditional')return references(value.whenTrue)||references(value.whenFalse);
      if(value.kind==='binary' && ['&&','||','??'].includes(value.operator))return references(value.left)||references(value.right);
      if(value.kind==='object')return value.entries.some(f=>references(f.value));
      if(value.kind==='array')return value.items.some(references);
      return false;
    }
    let changed=true;
    while(changed) {
      changed=false;
      const add=(id,value)=>{if(!aliases.has(id) && references(value)){aliases.add(id);changed=true;}};
      for(const [id,value] of definitions)add(id,value);
      for(const [id,updates] of writes)for(const update of updates)add(id,update.value);
    }
    for(const write of memberWrites)if(references(write.target.object))fail('borrowed caller shape is mutated through an alias');
  }
  function projectionType(e) {
    if (e?.kind === 'local') return guardedScalar(e);
    const type=inputType(e);
    readonlyInput(e);
    return type;
  }
  function proveBorrow(e, expected) {
    if (!values.validType(expected)) { fail('invalid borrow type'); return false; }
    readonlyInput(e);
    const actual=inputType(e);
    // A literal graph also proves all scalar initializer/write chains.
    proveInputs(e);
    return values.validType(actual) && values.same(actual,expected);
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
        || e.arguments.some((arg, i) => helper.parameters[i]?.borrow ? !proveBorrow(arg, helper.parameters[i].borrow.type) : scalarArgumentKind(arg, locals, fail, false, projectionType) !== helper.parameters[i]?.valueKind)) fail('invalid pure helper call');
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
  const effectfulCallVisitor = s => { if (s.kind === 'helper-call') rejectCalls(s); };
  effectfulCallVisitor.expression = () => {};
  for (const body of [plan.entry.body, ...(plan.handlers || []).map(h => h.body), ...(plan.stages || []).map(h => h.body)]) walkStatements(body, effectfulCallVisitor);
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
      if ((object !== 'string' && object?.kind !== 'number-array') || index !== 'number') fail('pure element requires a string or numeric array and numeric index');
      kind = object === 'string' ? 'string' : 'number';
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

function scalarArgumentKind(e, locals, fail, bound = false, projectionType) {
  if (!e || typeof e !== 'object') { fail('missing pure call argument'); return 'unknown'; }
  const child = v => scalarArgumentKind(v, locals, fail, bound, projectionType);
  let kind = 'unknown';
  if (e.kind === 'literal' && ['string', 'number', 'boolean'].includes(typeof e.value)) kind = typeof e.value;
  else if (e.kind === 'local') kind = projectionType?.(e) || locals.get(e.id)?.valueKind;
  else if (['property','element'].includes(e.kind) && projectionType) {
    kind = projectionType(e);
    if (e.kind === 'element') child(e.index);
  }
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
