'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');

// Literal expectations freeze the current admission policy, including the
// caller's existing coercive operators. This is not a new authoring contract.
module.exports = function characterizePolicy(compile) {
  const { plan } = compile(`export function check(unused:number,n:number,s:string,b:boolean,a:number[],r:{name:string}):number {return n;}`,
    `const result=check(0,2,'x',true,[1],{name:'x'});return ctx.text(''+result);`);
  const helper = plan.helpers[0];
  const scalarKinds = ['number', 'string', 'boolean'];
  const literal = type => ({ kind: 'literal', value: { number: 2, string: 'x', boolean: true }[type], valueKind: type });
  const local = i => ({ kind: 'local', id: helper.parameters[i].localId, valueKind: helper.parameters[i].valueKind });
  function find(value, predicate) {
    if (!value || typeof value !== 'object') return;
    if (predicate(value)) return value;
    for (const child of Object.values(value)) { const found = find(child, predicate); if (found) return found; }
  }
  const cases = [];
  const producerExpressions = [];
  function check(name, expected, mutate, rejectionReason) {
    const candidate = JSON.parse(JSON.stringify(plan));
    mutate(candidate);
    delete candidate.planHash;
    candidate.planHash = createHash('sha256').update(stableStringify(candidate)).digest('hex');
    let diagnostics = [];
    try { validateCanonicalNativePlan(JSON.parse(JSON.stringify(candidate))); }
    catch (error) {
      assert.equal(error.name, 'CanonicalNativePlanError', name);
      diagnostics = error.diagnostics;
      assert.ok(diagnostics.length, name);
      assert.ok(!diagnostics.some(d => d.message === 'plan hash mismatch'), 'a valid hash must not establish semantic proof');
    }
    assert.equal(diagnostics.length === 0, expected, `${name}: ${JSON.stringify(diagnostics)}`);
    if (rejectionReason) assert.ok(diagnostics.some(d => d.message === rejectionReason), `${name}: ${JSON.stringify(diagnostics)}`);
    cases.push({ name, accepted: expected, diagnostics });
  }
  function expressionCount(value) {
    if (!value || typeof value !== 'object') return 0;
    return (value.kind && value.valueKind ? 1 : 0) + Object.entries(value)
      .filter(([key]) => key !== 'key').reduce((sum, [, child]) => sum + expressionCount(child), 0);
  }
  const insert = expression => p => {
    p.helpers[0].body.unshift({ kind: 'expression', expression });
    p.summary.statementCount++;
    p.summary.expressionCount += expressionCount(expression);
  };
  function argument(expression, type) {
    return p => {
      const parameter = p.helpers[0].parameters[0];
      parameter.valueKind = type;
      p.locals.find(l => l.id === parameter.localId).valueKind = type;
      const call = find(p.handlers, e => e.kind === 'pure-helper-call');
      p.summary.expressionCount += expressionCount(expression) - expressionCount(call.arguments[0]);
      call.arguments[0] = expression;
    };
  }
  const groups = [
    [['===', '!==', '==', '!=', '<', '<=', '>', '>='], 'comparison'],
    [['&&', '||', '??'], 'logical'],
    [['+', '-', '*', '/', '%', '**', '&', '|', '^', '<<', '>>', '>>>'], 'numeric'],
    [['in', 'unrecognized'], 'excluded'],
  ];
  for (const [operators, group] of groups) for (const operator of operators) {
    for (const [i, a] of scalarKinds.entries()) for (const [j, b] of scalarKinds.entries()) {
      const type = group === 'comparison' ? 'boolean' : group === 'logical' ? a === b ? a : 'unknown'
        : operator === '+' && (a === 'string' || b === 'string') ? 'string' : 'number';
      const bodyAccepted = group === 'comparison' || group === 'logical' && a === b
        || group === 'numeric' && (a === 'number' && b === 'number' || operator === '+' && type === 'string');
      const callerAccepted = group !== 'excluded' && type !== 'unknown';
      if (bodyAccepted) producerExpressions.push({ source: `(${['n', 's', 'b'][i]} ${operator} ${['n', 's', 'b'][j]})`, type });
      check(`body:${operator}:${a}:${b}`, bodyAccepted,
        insert({ kind: 'binary', operator, left: local(i + 1), right: local(j + 1), valueKind: type }));
      check(`caller:${operator}:${a}:${b}`, callerAccepted,
        argument({ kind: 'binary', operator, left: literal(a), right: literal(b), valueKind: type }, type === 'unknown' ? 'number' : type));
    }
  }
  for (const operator of ['!', 'typeof', '+', '-', '~', 'void', 'delete']) for (const [i, type] of scalarKinds.entries()) {
    const result = operator === '!' ? 'boolean' : operator === 'typeof' ? 'string' : 'number';
    const admitted = !['void', 'delete'].includes(operator);
    if (admitted && (['!', 'typeof'].includes(operator) || type === 'number')) {
      producerExpressions.push({ source: `(${operator} ${['n', 's', 'b'][i]})`, type: result });
    }
    check(`body:${operator}:${type}`, admitted && (['!', 'typeof'].includes(operator) || type === 'number'),
      insert({ kind: 'unary', operator, value: local(i + 1), valueKind: result }));
    check(`caller:${operator}:${type}`, admitted,
      argument({ kind: 'unary', operator, value: literal(type), valueKind: result }, result));
  }
  for (const operator of ['||', '??']) for (const optionalLeft of [true, false]) {
    const optional = { kind: 'intrinsic', name: 'request.header', arguments: [literal('string')], valueKind: 'string-or-undefined' };
    const admitted = optionalLeft || operator === '??';
    check(`caller:optional-default:${operator}:${optionalLeft}`, admitted, argument({ kind: 'binary', operator,
      left: optionalLeft ? optional : literal('string'), right: optionalLeft ? literal('string') : optional, valueKind: 'string' }, 'string'),
      admitted ? undefined : 'pure argument kind mismatch');
    check(`body:forged-optional-default:${operator}:${optionalLeft}`, false, p => {
      const id = helper.id + ':uninitialized';
      p.helpers[0].localIds.push(id);
      p.locals.push({ id, name: 'uninitialized', scopeId: helper.id, valueKind: 'string-or-undefined', declaration: 'const' });
      p.summary.localCount++;
      const optionalLocal = { kind: 'local', id, valueKind: 'string-or-undefined' };
      insert({ kind: 'binary', operator, left: optionalLeft ? optionalLocal : local(2),
        right: optionalLeft ? local(2) : optionalLocal, valueKind: 'string' })(p);
    });
  }
  check('body:string-length', true, insert({ kind: 'property', object: local(2), property: 'length', valueKind: 'number' }));
  check('body:record-field', true, insert({ kind: 'property', object: local(5), property: 'name', valueKind: 'string' }));
  check('body:array-index', true, insert({ kind: 'element', object: local(4), index: literal('number'), valueKind: 'number' }));
  check('caller:string-index', true, argument({ kind: 'element', object: literal('string'), index: literal('number'), valueKind: 'string' }, 'string'));
  check('caller:array-index', true, argument({ kind: 'element', object: { kind: 'array', items: [literal('number')], valueKind: 'array' }, index: literal('number'), valueKind: 'number' }, 'number'));
  const produced = compile(`export function check(n:number,s:string,b:boolean):number {${producerExpressions.map(e => e.source + ';').join('')}return n;}`,
    `const result=check(2,'x',true);return ctx.text(''+result);`).plan;
  assert.deepEqual(produced.helpers[0].body.filter(s => s.kind === 'expression').map(s => s.expression.valueKind),
    producerExpressions.map(e => e.type), 'producer result tags must agree with the independently admitted scalar matrix');
  const malformed = [
    ['forged-result', insert({ kind: 'binary', operator: '+', left: local(1), right: local(1), valueKind: 'string' })],
    ['forged-literal', insert({ kind: 'literal', value: 'x', valueKind: 'number' })],
    ['foreign-local', p => insert({ kind: 'local', id: p.handlers[0].localIds[0], valueKind: 'number' })(p)],
    ['missing-field', insert({ kind: 'property', object: local(5), property: 'missing', valueKind: 'string' })],
    ['forged-field', insert({ kind: 'property', object: local(5), property: 'name', valueKind: 'number' })],
    ['invalid-index', insert({ kind: 'element', object: local(4), index: literal('string'), valueKind: 'number' })],
    ['string-index', insert({ kind: 'element', object: local(2), index: literal('number'), valueKind: 'string' })],
    ['forged-string-index', insert({ kind: 'element', object: local(2), index: literal('number'), valueKind: 'number' })],
    ['structured-operator', insert({ kind: 'binary', operator: '+', left: local(5), right: local(1), valueKind: 'number' })],
    ['structured-unary', insert({ kind: 'unary', operator: '!', value: local(5), valueKind: 'boolean' })],
    ['parameter-write', insert({ kind: 'assignment', operator: '=', target: local(1), value: literal('number'), valueKind: 'number' })],
    ['borrow-write', insert({ kind: 'assignment', operator: '=', target: { kind: 'property', object: local(5), property: 'name', valueKind: 'string' }, value: literal('string'), valueKind: 'string' })],
    ['borrow-escape', p => { p.helpers[0].body.at(-1).value = local(5); }],
    ['nested-call', p => insert(structuredClone(find(p.handlers, e => e.kind === 'pure-helper-call')))(p)],
    ['record-allocation', insert({ kind: 'object', entries: [], valueKind: 'object' })],
    ['forged-borrow', p => { p.helpers[0].parameters[5].borrow.type.fields[0].type = 'function'; }],
  ];
  for (const [name, mutate] of malformed) check(name, false, mutate);
  return { cases: cases.length, accepted: cases.filter(c => c.accepted).length,
    rejected: cases.filter(c => !c.accepted).length,
    matrixSha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    producerExpressions: producerExpressions.length, producerPlanHash: produced.planHash,
    malformed: cases.slice(-malformed.length) };
};
