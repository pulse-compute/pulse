'use strict';

// Private realization policy. This proof ignores valueKind annotations: every
// read must be definitely initialized and every write must preserve f64. Checking
// the first loop entry plus all writes establishes the invariant by induction;
// values initialized only in a loop/one branch never become definite live-outs.
const POLICY = 'fastly-numeric-regions-v2';
const LINKED_POLICY = 'fastly-linked-numeric-regions-v1';
const HOST_POLICY = 'host-numeric-regions-v1';
const arithmetic = new Set(['+', '-', '*', '/', '%']);
const comparisons = new Set(['===', '!==', '==', '!=', '<', '<=', '>', '>=']);
function prepareNumericRegions({ plan, resources, policy, schemaActive, budgeted, readLoopBudget = false, localName }) {
  if (policy !== undefined && policy !== POLICY && policy !== LINKED_POLICY && policy !== HOST_POLICY) throw new TypeError('Unknown private numeric-region emission policy');
  // MEM9-06 qualifies allocation avoidance without a collector for Fastly stub
  // builds. Linked fixed-memory builds remain excluded when codecs are active,
  // including with arena elision; the provider selects this narrower policy.
  const realizationEligible = policy === HOST_POLICY || policy === POLICY || policy === LINKED_POLICY && !schemaActive;
  // Only the unlinked Fastly writer supplies the private charge/materialization
  // helpers. Host caches and linked memory need independent qualification.
  const accounting = budgeted && readLoopBudget && policy === POLICY;
  const enabled = realizationEligible && (!budgeted || accounting);
  const globals = [], resets = [], regions = [], declined = [];
  const localIds = new Set((plan.locals || []).map(x => x.id));
  function proveExpression(e, definite) {
    if (!e) return null;
    if (e.kind === 'workspace-read') return resources?.workspaces && e.version === 'pulse.numeric-workspace.v1' && plan.numericWorkspaces?.some(r => r.id === e.workspaceId) && (!e.offset || proveExpression(e.offset, definite) === 'number') ? 'number' : null;
    if (e.kind === 'resource-read') return resources && e.version === 'pulse.binary-resource-read.v1'
      && plan.binaryResources?.records.some(record => record.id === e.resourceId)
      && ['byteLength', 'readU8', 'readU32LE', 'readF32LE'].includes(e.operation)
      && (!e.offset || proveExpression(e.offset, definite) === 'number') ? 'number' : null;
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
      if (e?.kind === 'workspace-write') return proveExpression(e.offset, definite) === 'number' && proveExpression(e.value, definite) === 'number';
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
      for (const name of names.values()) {
        globals.push(`let ${name}: f64 = 0`, `let ${name}_written: bool = false`);
        resets.push(`${name} = 0`, `${name}_written = false`);
      }
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
    const number = value => accounting ? `__pulse_numeric_charge_number(${value})` : value;
    const boolean = value => accounting ? `__pulse_numeric_charge_boolean(${value})` : value;
    const truthy = e => proveExpression(e, new Set(region.names.keys())) === 'boolean'
      ? expression(e) : accounting ? `__pulse_numeric_truthy(${expression(e)})`
        : `(${expression(e)} != 0.0 && !isNaN(${expression(e)}))`;
    function expression(e) {
      if (e.kind === 'workspace-read') return number(resources.workspaces.read(e, e.offset ? expression(e.offset) : '0.0'));
      if (e.kind === 'resource-read') return number(resources.read(e, e.offset ? expression(e.offset) : '0.0'));
      if (e.kind === 'literal') return number(Object.is(e.value, -0) ? '(-0.0)' : `(<f64>${e.value})`);
      if (e.kind === 'local') return name(e.id);
      if (e.kind === 'binary') {
        // Fastly inequality first boxes equality, then its negation. Both
        // boolean cache admissions must happen in that order.
        if (accounting && ['!=', '!=='].includes(e.operator)) return boolean(`!${boolean(`(${expression(e.left)} == ${expression(e.right)})`)}`);
        const value = `(${expression(e.left)} ${e.operator.replace('===', '==').replace('!==', '!=')} ${expression(e.right)})`;
        return arithmetic.has(e.operator) ? number(value) : boolean(value);
      }
      if (e.kind === 'unary') return e.operator === '!' ? boolean(`(!${truthy(e.value)})`) : number(`(${e.operator}${expression(e.value)})`);
      if (e.kind === 'conditional') return `(${truthy(e.test)} ? ${expression(e.whenTrue)} : ${expression(e.whenFalse)})`;
      throw new Error('Unproven numeric expression');
    }
    function lines(s) {
      const set = (id, value) => [`${name(id)} = ${value}`, `${name(id)}_written = true`];
      if (s.kind === 'local') return set(s.localId, expression(s.value));
      if (s.kind === 'expression') {
        const e = s.expression;
        if (e.kind === 'workspace-write') return [resources.workspaces.write(e, expression(e.offset), expression(e.value))];
        const id = e.target.id;
        if (e.kind === 'update') {
          const value = `${name(id)} ${e.operator === '++' ? '+' : '-'} ${number('1.0')}`;
          return set(id, accounting ? number(`(${value})`) : value);
        }
        return set(id, e.operator === '=' ? expression(e.value) : number(`(${name(id)} ${e.operator.slice(0, -1)} ${expression(e.value)})`));
      }
      if (['break', 'continue'].includes(s.kind)) return [s.kind];
      if (s.kind === 'if') return [`if (${truthy(s.test)}) {`, ...(s.then || []).flatMap(lines).map(x => '  ' + x), '} else {', ...(s.else || []).flatMap(lines).map(x => '  ' + x), '}'];
      const counter = counterName();
      return [`for (let ${counter}: i32 = 0; ${counter} < ${s.maxIterations}; ${counter} += 1) {`,
        ...set(s.localId, number(`<f64>${counter}`)).map(x => '  ' + x), `  if (!${truthy(s.test)}) break`,
        ...s.body.flatMap(lines).map(x => '  ' + x), '}'];
    }
    return [
      ...(region.reset ? [...region.names.values()].map(n => `${n}_written = false`) : []),
      ...lines(statement),
      ...(region.box ? [...region.names].map(([id, n]) => `if (${n}_written) ${localName(id)} = ${accounting ? '__pulse_numeric_box' : 'host_value_number'}(${n})`) : [])
    ];
  }
  return { select, render, globals, clear: () => resets, manifest: () => Object.freeze({ policy: policy || POLICY, enabled,
    reason: policy === LINKED_POLICY && schemaActive ? 'schema-active-linked' : budgeted && !accounting ? 'execution-budget' : !realizationEligible ? 'not-selected' : 'proven-regions-only',
    ...(accounting ? { accounting: 'fastly-read-loop-v1' } : {}),
    regions: Object.freeze(regions), declined: Object.freeze(declined) }) };
}
module.exports = { POLICY, LINKED_POLICY, HOST_POLICY, prepareNumericRegions };
