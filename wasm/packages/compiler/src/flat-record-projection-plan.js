'use strict';

const values = require('./pure-helper-values');

// Reconstruct placement from serialized statements. Inferred kinds and source
// annotations are not bounds, dominance, alias, or lifetime evidence.
function flatRecordProjectionProof(plan, locals, definitions, writes, inputType, fail) {
  const contexts = new WeakMap(), parents = new WeakMap(), bindings = new Map();
  const expressions = [], roots = new WeakMap(), checkedRoots = new Set();
  const effects = new Map(plan.effects.map(e => [e.id, e]));
  let nextRoot = 0;
  const clone = s => ({ available: new Set(s.available), loops: new Set(s.loops),
    barriers: new Set(s.barriers), guards: [...s.guards] });
  const equalSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  function mark(e, state, parent) {
    if (!e || typeof e !== 'object') return;
    contexts.set(e, state); parents.set(e, parent); expressions.push(e);
    if (e.kind === 'conditional') {
      mark(e.test, state, e);
      const yes = clone(state), no = clone(state);
      yes.guards.push([e.test, true]); no.guards.push([e.test, false]);
      mark(e.whenTrue, yes, e); mark(e.whenFalse, no, e);
    } else if (e.kind === 'binary' && ['&&', '||'].includes(e.operator)) {
      mark(e.left, state, e);
      const right = clone(state); right.guards.push([e.left, e.operator === '&&']);
      mark(e.right, right, e);
    } else for (const child of Object.values(e)) {
      if (Array.isArray(child)) for (const item of child) mark(item, state, e);
      else if (child && typeof child === 'object') mark(child, state, e);
    }
  }
  function bind(id, statement, state, effect) {
    const previous = bindings.get(id);
    bindings.set(id, { statement, state: clone(state), effect, count: (previous?.count || 0) + 1 });
    state.available.add(id);
  }
  function body(statements, state) {
    for (const s of statements || []) {
      if (s.kind === 'if') {
        mark(s.test, clone(state), s);
        const yes = clone(state), no = clone(state);
        yes.guards.push([s.test, true]); no.guards.push([s.test, false]);
        const yr = body(s.then, yes), nr = body(s.else, no);
        for (const x of [...yes.barriers, ...no.barriers]) state.barriers.add(x);
        if (yr && nr) return true;
        if (yr) state.guards = no.guards;
        else if (nr) state.guards = yes.guards;
      } else if (['pure-loop', 'read-loop'].includes(s.kind)) {
        const inside = clone(state);
        bind(s.localId, s, inside);
        if (s.kind === 'pure-loop') inside.loops.add(s.localId);
        mark(s.test, clone(inside), s); inside.guards.push([s.test, true]);
        body(s.body, inside);
        for (const x of inside.barriers) state.barriers.add(x);
      } else if (['effect', 'effect-group', 'helper-call', 'stage-call', 'handler-call'].includes(s.kind)) {
        const ids = s.effectIds || (s.effectId ? [s.effectId] : []);
        for (const id of ids) {
          const effect = effects.get(id);
          for (const input of effect?.inputs || []) mark(input.value, clone(state), effect);
          for (const arg of effect?.result?.decoder?.arguments || []) mark(arg, clone(state), effect);
        }
        for (const arg of s.arguments || []) mark(arg, clone(state), s);
        state.barriers.add(s);
        for (const id of ids) {
          const effect = effects.get(id);
          if (effect?.result?.localId) bind(effect.result.localId, s, state, effect);
        }
      } else {
        mark(s.value || s.expression, clone(state), s);
        if (s.kind === 'local') bind(s.localId, s, state);
        if (['return', 'break', 'continue'].includes(s.kind)) return true;
      }
    }
    return false;
  }
  for (const b of [plan.entry.body, ...(plan.handlers || []).map(h => h.body), ...(plan.stages || []).map(h => h.body)]) {
    body(b, { available: new Set(), loops: new Set(), barriers: new Set(), guards: [] });
  }
  function bindingAt(e) {
    const binding = bindings.get(e.id), at = contexts.get(e);
    if (!binding || binding.count !== 1 || !at?.available.has(e.id)
      || locals.get(e.id)?.declaration !== 'const'
      || binding.statement.kind === 'local' && binding.statement.declaration !== 'const'
      || writes.get(e.id)?.length || !equalSet(binding.state.barriers, at.barriers)
      || [...binding.state.loops].some(id => !at.loops.has(id))) return;
    return binding;
  }
  function rootKey(e) {
    if (!roots.has(e)) roots.set(e, `decode:${++nextRoot}`);
    return roots.get(e);
  }
  function identity(e, seen = new Set()) {
    if (!e) return;
    if (e.kind === 'local') {
      if (seen.has(e.id)) return;
      const b = bindingAt(e); if (!b) return;
      if (b.effect) return b.effect.result.decoder?.kind === 'json'
        && values.schemaRead(b.effect.result.decoder.arguments?.[0], plan.schemas?.registry)
        ? rootKey(b.effect) : undefined;
      return identity(definitions.get(e.id), new Set([...seen, e.id]));
    }
    if (e.kind === 'property') {
      const object = identity(e.object, seen);
      return object && `${object}/${JSON.stringify(e.property)}`;
    }
    if (e.kind === 'intrinsic' && ['request.json', 'schema.decode.text'].includes(e.name)
      && values.schemaRead(e.arguments?.[e.name === 'request.json' ? 0 : 1], plan.schemas?.registry)) return rootKey(e);
  }
  function bounded(e) {
    const at = contexts.get(e), array = identity(e.object), index = e.index;
    const constant = index?.kind === 'literal' && Number.isSafeInteger(index.value) && index.value >= 0;
    const counter = index?.kind === 'local' && at?.loops.has(index.id)
      && bindings.get(index.id)?.count === 1;
    if (!at || !array || !constant && !counter) return false;
    const sameIndex = x => constant ? x?.kind === 'literal' && x.value === index.value
      : x?.kind === 'local' && x.id === index.id;
    const length = x => x?.kind === 'property' && x.property === 'length' && identity(x.object) === array;
    function proves(test, truth) {
      if (test?.kind === 'unary' && test.operator === '!') return proves(test.value, !truth);
      if (test?.kind !== 'binary') return false;
      if (test.operator === '&&' && truth || test.operator === '||' && !truth) return proves(test.left, truth) || proves(test.right, truth);
      const op = truth ? test.operator : ({ '>=': '<', '<=': '>', '===': '!==', '!==': '===' })[test.operator];
      if (op === '<' && sameIndex(test.left) && length(test.right)
        || op === '>' && length(test.left) && sameIndex(test.right)) return true;
      return constant && index.value === 0 && op === '!=='
        && (length(test.left) && test.right?.kind === 'literal' && test.right.value === 0
          || length(test.right) && test.left?.kind === 'literal' && test.left.value === 0);
    }
    return at.guards.some(([test, truth]) => proves(test, truth));
  }
  function element(e, type) {
    if (!bounded(e)) { fail('flat-record projection requires a dominating matching array bound and live integer index'); return; }
    return type.element;
  }
  // A scalar copy is not an alias. Seed only the decoded graph supplying the
  // new element read, then follow structured aliases in both directions.
  function check(argument) {
    const seeds = new Set(), visited = new Set();
    function origins(e) {
      if (!e || typeof e !== 'object') return;
      if (e.kind === 'local') {
        if (seeds.has(e.id)) return;
        seeds.add(e.id); origins(definitions.get(e.id)); return;
      }
      if (e.kind === 'property') origins(e.object);
    }
    function discover(e) {
      if (!e || typeof e !== 'object') return;
      if (e.kind === 'local') {
        if (visited.has(e.id)) return; visited.add(e.id);
        discover(definitions.get(e.id));
        for (const w of writes.get(e.id) || []) discover(w.value);
      } else if (e.kind === 'element' && inputType(e.object)?.kind === 'flat-record-array') origins(e.object);
      else for (const child of Object.values(e)) {
        if (Array.isArray(child)) for (const item of child) discover(item);
        else if (child && typeof child === 'object') discover(child);
      }
    }
    discover(argument);
    if (!seeds.size || [...seeds].every(id => checkedRoots.has(id))) return;
    const aliases = new Set(seeds);
    function references(e) {
      if (!e || typeof e !== 'object') return false;
      if (e.kind === 'local') return aliases.has(e.id);
      if (['property', 'element'].includes(e.kind)) return typeof inputType(e) !== 'string' && references(e.object);
      if (e.kind === 'object') return e.entries.some(f => references(f.value));
      if (e.kind === 'array') return e.items.some(references);
      if (e.kind === 'conditional') return references(e.whenTrue) || references(e.whenFalse);
      if (e.kind === 'binary' && ['&&', '||', '??'].includes(e.operator)) return references(e.left) || references(e.right);
      return false;
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, value] of definitions) if (!aliases.has(id) && references(value)) { aliases.add(id); changed = true; }
      for (const [id, updates] of writes) if (!aliases.has(id) && updates.some(w => references(w.value))) { aliases.add(id); changed = true; }
    }
    for (const id of aliases) {
      const b = bindings.get(id);
      if (locals.get(id)?.declaration !== 'const' || writes.get(id)?.length || b?.count !== 1
        || b.statement.kind === 'local' && (b.statement.declaration !== 'const'
          || !['local', 'property', 'element', 'intrinsic'].includes(b.statement.value.kind))) fail('flat-record structured aliases must be direct const bindings');
    }
    for (const e of expressions) {
      if (e.kind === 'local' && aliases.has(e.id) && !bindingAt(e)) fail('flat-record alias read exceeds its binding or synchronous lifetime');
      if (['assignment', 'update'].includes(e.kind) && references(e.target?.object)) fail('flat-record caller graph is mutated');
      if (!references(e)) continue;
      const parent = parents.get(e);
      const projection = ['property', 'element'].includes(parent?.kind) && parent.object === e;
      const alias = parent?.kind === 'local' && parent.value === e && aliases.has(parent.localId);
      if (!projection && !alias) fail('flat-record structured value cannot escape a caller projection');
    }
    for (const id of seeds) checkedRoots.add(id);
  }
  return { element, check };
}

module.exports = { flatRecordProjectionProof };
