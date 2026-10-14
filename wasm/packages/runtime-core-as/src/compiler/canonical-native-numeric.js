'use strict';

// Private realization policy. This proof ignores valueKind annotations: every
// read must be definitely initialized and every write must preserve f64. Checking
// the first loop entry plus all writes establishes the invariant by induction;
// values initialized only in a loop/one branch never become definite live-outs.
const POLICY = 'fastly-numeric-regions-v1';
const HOST_POLICY = 'host-numeric-regions-v1';
const arithmetic = new Set(['+', '-', '*', '/', '%']);
const comparisons = new Set(['===', '!==', '==', '!=', '<', '<=', '>', '>=']);
function prepareNumericRegions({ plan, policy, schemaActive, budgeted, localName }) {
  if (policy !== undefined && policy !== POLICY && policy !== HOST_POLICY) throw new TypeError('Unknown private numeric-region emission policy');
  // Host values live outside Wasm; schema codec/collector availability does not
  // determine their lifetime. Fastly retains its separately qualified gate.
  const realizationEligible = policy === HOST_POLICY || policy === POLICY && schemaActive;
  const enabled = realizationEligible && !budgeted;
  const globals = [], regions = [], declined = [];
  const localIds = new Set((plan.locals || []).map(x => x.id));
  function proveExpression(e, definite) {
    if (!e) return null;
    if (e.kind === 'literal') return typeof e.value === 'number' && Number.isFinite(e.value) ? 'number' : null;
    if (e.kind === 'local') return definite.has(e.id) ? 'number' : null;
    if (e.kind === 'binary' && proveExpression(e.left, definite) === 'number' && proveExpression(e.right, definite) === 'number') {
      return arithmetic.has(e.operator) ? 'number' : comparisons.has(e.operator) ? 'boolean' : null;
    }
    if (e.kind === 'unary' && proveExpression(e.value, definite)) {
      if (e.operator === '!') return 'boolean';
      if (['+', '-'].includes(e.operator) && proveExpression(e.value, definite) === 'number') return 'number';
    }
    if (e.kind === 'conditional' && proveExpression(e.test, definite)
      && proveExpression(e.whenTrue, definite) === 'number' && proveExpression(e.whenFalse, definite) === 'number') return 'number';
    return null;
  }
  function proveStatement(s, definite, writes, inLoop = false) {
    const write = id => { if (!localIds.has(id)) return false; writes.add(id); definite.add(id); return true; };
    if (s.kind === 'local') return proveExpression(s.value, definite) === 'number' && write(s.localId);
    if (s.kind === 'expression') {
      const e = s.expression, target = e?.target;
      if (target?.kind !== 'local') return false;
      if (e.kind === 'assignment' && (e.operator === '=' || arithmetic.has(e.operator.slice(0, -1)) && e.operator.endsWith('=') && definite.has(target.id))) {
        return proveExpression(e.value, definite) === 'number' && write(target.id);
      }
      return e.kind === 'update' && ['++', '--'].includes(e.operator) && definite.has(target.id) && write(target.id);
    }
    if (inLoop && ['break', 'continue'].includes(s.kind)) return true;
    if (inLoop && s.kind === 'if' && proveExpression(s.test, definite)) {
      const yes = new Set(definite), no = new Set(definite);
      if (!proveSequence(s.then || [], yes, writes) || !proveSequence(s.else || [], no, writes)) return false;
      for (const id of yes) if (no.has(id)) definite.add(id);
      return true;
    }
    if (s.kind === 'pure-loop' && localIds.has(s.localId) && Number.isInteger(s.maxIterations) && s.maxIterations >= 0 && s.maxIterations <= 256) {
      const body = new Set(definite); body.add(s.localId); writes.add(s.localId);
      return !!proveExpression(s.test, body) && proveSequence(s.body || [], body, writes);
    }
    return false;
  }
  function proveSequence(statements, definite, writes) {
    return statements.every(s => proveStatement(s, definite, writes, true));
  }
  function select(statements) {
    const selected = new Map();
    if (!enabled) return selected;
    for (let start = 0; start < statements.length; start++) {
      let definite = new Set(), writes = new Set(), end = start, loop = false;
      for (; end < statements.length; end++) {
        const nextDefinite = new Set(definite), nextWrites = new Set(writes);
        if (!proveStatement(statements[end], nextDefinite, nextWrites)) break;
        definite = nextDefinite; writes = nextWrites;
        loop ||= statements[end].kind === 'pure-loop';
      }
      if (!loop) continue;
      const index = regions.length, ids = [...writes];
      const names = new Map(ids.map((id, i) => [id, `__pulse_numeric_${index}_${i}`]));
      for (const name of names.values()) globals.push(`let ${name}: f64 = 0`, `let ${name}_written: bool = false`);
      regions.push(Object.freeze({ index, statementPaths: statements.slice(start, end).map(s => s.statementPath), localIds: ids }));
      for (let i = start; i < end; i++) selected.set(statements[i], {
        names, reset: i === start, box: i === end - 1
      });
      start = end - 1;
    }
    for (const s of statements) if (s.kind === 'pure-loop' && !selected.has(s)) declined.push({ statementPath: s.statementPath, reason: 'unsupported-operation-or-live-in' });
    return selected;
  }
  function render(statement, region, counterName) {
    const name = id => region.names.get(id);
    const truthy = e => proveExpression(e, new Set(region.names.keys())) === 'boolean'
      ? expression(e) : `(${expression(e)} != 0.0 && !isNaN(${expression(e)}))`;
    function expression(e) {
      if (e.kind === 'literal') return Object.is(e.value, -0) ? '(-0.0)' : `(<f64>${e.value})`;
      if (e.kind === 'local') return name(e.id);
      if (e.kind === 'binary') return `(${expression(e.left)} ${e.operator.replace('===', '==').replace('!==', '!=')} ${expression(e.right)})`;
      if (e.kind === 'unary') return e.operator === '!' ? `(!${truthy(e.value)})` : `(${e.operator}${expression(e.value)})`;
      if (e.kind === 'conditional') return `(${truthy(e.test)} ? ${expression(e.whenTrue)} : ${expression(e.whenFalse)})`;
      throw new Error('Unproven numeric expression');
    }
    function lines(s) {
      const set = (id, value) => [`${name(id)} = ${value}`, `${name(id)}_written = true`];
      if (s.kind === 'local') return set(s.localId, expression(s.value));
      if (s.kind === 'expression') {
        const e = s.expression, id = e.target.id;
        if (e.kind === 'update') return set(id, `${name(id)} ${e.operator === '++' ? '+' : '-'} 1.0`);
        return set(id, e.operator === '=' ? expression(e.value) : `(${name(id)} ${e.operator.slice(0, -1)} ${expression(e.value)})`);
      }
      if (['break', 'continue'].includes(s.kind)) return [s.kind];
      if (s.kind === 'if') return [`if (${truthy(s.test)}) {`, ...(s.then || []).flatMap(lines).map(x => '  ' + x), '} else {', ...(s.else || []).flatMap(lines).map(x => '  ' + x), '}'];
      const counter = counterName();
      return [`for (let ${counter}: i32 = 0; ${counter} < ${s.maxIterations}; ${counter} += 1) {`,
        ...set(s.localId, `<f64>${counter}`).map(x => '  ' + x), `  if (!${truthy(s.test)}) break`,
        ...s.body.flatMap(lines).map(x => '  ' + x), '}'];
    }
    return [
      ...(region.reset ? [...region.names.values()].map(n => `${n}_written = false`) : []),
      ...lines(statement),
      ...(region.box ? [...region.names].map(([id, n]) => `if (${n}_written) ${localName(id)} = host_value_number(${n})`) : [])
    ];
  }
  return { select, render, globals, manifest: () => Object.freeze({ policy: policy || POLICY, enabled,
    reason: policy === POLICY && !schemaActive ? 'schema-inactive' : budgeted ? 'execution-budget' : !realizationEligible ? 'not-selected' : 'proven-regions-only',
    regions: Object.freeze(regions), declined: Object.freeze(declined) }) };
}
module.exports = { POLICY, HOST_POLICY, prepareNumericRegions };
