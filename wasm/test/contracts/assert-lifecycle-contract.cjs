#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const toolchain = process.argv.includes('--installed')
  ? require('@pulse-compute/wasm-contracts/provider/toolchain')
  : require('../../packages/contracts/src/provider/toolchain.js');
const { executionLifecycle: execution, httpLifecycle: http, lifecyclePlanner: planner } = toolchain;
let cases = 0;
function test(name, run) { run(); cases++; console.log(`ok - ${name}`); }
const clone = value => JSON.parse(JSON.stringify(value));
const contribution = (point, owner = 'service', order = 0) => ({ point, owner, order });
function fixture() {
  return {
    bindings: {
      version: 'pulse.lifecycle-bindings.v1', executionVersion: 'pulse.execution-lifecycle.v1',
      httpVersion: 'pulse.http-lifecycle.v1',
      sites: [
        { id: 'settle', points: [{ point: 'effect.settle', parameters: { effect: 'slot', ticket: 'ticket', result: 'value' }, reject: 'reject-stale' }] },
        { id: 'deliver', points: [{ point: 'effect.deliver', parameters: { effect: 'slot', result: 'value' }, afterParameters: { accepted: 'accepted' } }] },
        { id: 'setter', points: [{ point: 'effect.result', parameters: { effect: 'slot', result: 'value' }, reject: 'reject-external' }] },
        { id: 'close', points: [{ point: 'invocation.close', parameters: {} }] },
        { id: 'end', points: [{ point: 'invocation.end', parameters: {} }] },
        { id: 'closed', points: [{ point: 'invocation.closed', parameters: {} }] },
        { id: 'request', points: [{ point: 'request.acquired', parameters: {} }] },
        { id: 'error', points: [
          { point: 'response.authority', parameters: {}, reject: 'suppress-error' },
          { point: 'response.error', parameters: {}, onClaim: 'finish-error' }
        ] },
        { id: 'timeout', points: [{ point: 'response.authority', parameters: {}, reject: 'suppress-timeout' }] },
        { id: 'result', points: [{ point: 'result.claim', parameters: { result: 'response' }, onClaim: 'finish-result' }] }
      ]
    },
    contributions: ['effect.settle', 'effect.deliver', 'effect.result', 'invocation.close', 'invocation.end',
      'invocation.closed', 'request.acquired', 'response.authority', 'response.error', 'result.claim'].map(point => contribution(point))
  };
}
const at = (input, id) => input.bindings.sites.find(site => site.id === id);
const planned = (plan, id) => plan.sites.find(site => site.id === id).points[0];
function rejects(name, mutate) {
  test(name, () => {
    const input = fixture();
    const replacement = mutate(input);
    assert.throws(() => planner.createPlan(replacement === undefined ? input : replacement), { code: 'PULSEWASM_EXECUTION_LIFECYCLE_INVALID' });
  });
}

test('reviewed execution and optional HTTP sets have no added points', () => {
  assert.equal(execution.VERSION, 'pulse.execution-lifecycle.v1');
  assert.equal(http.VERSION, 'pulse.http-lifecycle.v1');
  assert.deepEqual(Object.keys(execution.POINTS), ['effect.settle', 'effect.deliver', 'effect.result', 'invocation.close', 'invocation.end', 'invocation.closed']);
  assert.deepEqual(Object.keys(http.POINTS), ['request.acquired', 'response.error', 'response.authority', 'result.claim']);
  assert.equal(execution.INVOCATION.version, 'pulse.effect-invocation.v1');
  assert.equal(execution.INVOCATION.defaultMaxEffects, 1024);
  assert.match(execution.INVOCATION.settlement, /rejected or trapped delivery never reopens/);
  assert.match(execution.INVOCATION.authentication, /execution, reusable site and active ticket before/);
  assert.match(execution.INVOCATION.closure, /invalidate delivery authority before cleanup/);
  assert.match(execution.POLICY.cleanup, /protected-capacity-and-original-remaining-deadline/);
  assert.equal(execution.POLICY.scheduler, false);
  assert.equal(execution.POLICY.packageRegistration, false);
});
test('all five composition kinds preserve their independent semantics', () => {
  assert.deepEqual(execution.COMPOSITION, {
    observe: { dispatch: 'all', result: 'void', order: 'ascending' },
    guard: { dispatch: 'all-true', result: 'boolean', order: 'ascending', shortCircuit: true },
    predicate: { dispatch: 'all-true', result: 'boolean', order: 'ascending', shortCircuit: true },
    claim: { dispatch: 'first-true', result: 'boolean', order: 'ascending', shortCircuit: true },
    around: { dispatch: 'around', result: 'void', order: 'ascending', afterOrder: 'descending', afterOn: 'normal-return-only' }
  });
});
test('plan is JSON data with roles, rejection postconditions and normal-return rules', () => {
  const plan = planner.createPlan(fixture());
  assert.equal(plan.version, 'pulse.lifecycle-plan.v1');
  assert.equal(plan.invocationVersion, 'pulse.effect-invocation.v1');
  assert.equal(plan.httpVersion, 'pulse.http-lifecycle.v1');
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
  assert.deepEqual(planned(plan, 'settle').parameters, [
    { role: 'effect', binding: 'slot' }, { role: 'ticket', binding: 'ticket' }, { role: 'result', binding: 'value' }
  ]);
  assert.deepEqual(planned(plan, 'deliver').afterParameters, [{ role: 'accepted', binding: 'accepted' }]);
  assert.equal(planned(plan, 'settle').rejection, 'do-not-consume-ticket-or-deliver');
  assert.equal(planned(plan, 'setter').rejection, 'do-not-deliver');
  assert.equal(planned(plan, 'error').rejection, 'do-not-send-or-replace-response');
  assert.equal(planned(plan, 'end').runsOn, 'normal-return-only');
  assert.equal(planned(plan, 'closed').runsOn, 'normal-return-only');
});
test('registration, site and role object enumeration do not change plan bytes', () => {
  const input = fixture();
  for (const point of ['effect.deliver', 'invocation.end']) input.contributions.push(contribution(point, 'outer', -10), contribution(point, 'inner', 10));
  const expected = JSON.stringify(planner.createPlan(input));
  input.contributions.reverse();
  input.bindings.sites.reverse();
  at(input, 'settle').points[0].parameters = { result: 'value', ticket: 'ticket', effect: 'slot' };
  assert.equal(JSON.stringify(planner.createPlan(input)), expected);
  const delivery = planned(planner.createPlan(input), 'deliver');
  assert.deepEqual(delivery.contributions.map(item => item.owner), ['outer', 'service', 'inner']);
  assert.deepEqual(delivery.after.map(item => item.owner), ['inner', 'service', 'outer']);
});
test('plans clone input and deeply freeze results without freezing caller records', () => {
  const input = fixture();
  const plan = planner.createPlan(input);
  const before = JSON.stringify(plan);
  input.contributions[0].owner = 'changed';
  at(input, 'settle').points[0].parameters.effect = 'changed';
  assert.equal(JSON.stringify(plan), before);
  function frozen(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
  frozen(plan); frozen(execution); frozen(http);
  assert.equal(Object.isFrozen(input.bindings.sites), false);
});
test('no selected contributions means no emitted dispatch sites', () => {
  const input = fixture(); input.contributions = [];
  assert.deepEqual(planner.createPlan(input).sites, []);
});
test('execution-only bindings require no HTTP or device identity', () => {
  const input = fixture(); delete input.bindings.httpVersion;
  input.bindings.sites = input.bindings.sites.slice(0, 6);
  input.contributions = input.contributions.slice(0, 6);
  assert.equal(planner.createPlan(input).httpVersion, null);
  assert.equal(planner.createPlan(input).sites.length, 6);
});
test('safe integer endpoints order exactly and negative zero normalizes', () => {
  const input = fixture(); input.contributions = [contribution('invocation.end', 'max', Number.MAX_SAFE_INTEGER), contribution('invocation.end', 'min', Number.MIN_SAFE_INTEGER), contribution('invocation.end', 'zero', -0)];
  assert.deepEqual(planned(planner.createPlan(input), 'end').contributions, [
    { owner: 'min', order: Number.MIN_SAFE_INTEGER }, { owner: 'zero', order: 0 }, { owner: 'max', order: Number.MAX_SAFE_INTEGER }
  ]);
});
test('symbolic bindings accept different host representations without ABI types', () => {
  const input = fixture();
  at(input, 'settle').points[0].parameters = { effect: 'effect.record', ticket: 'opaque.ticket', result: 'host.object' };
  assert.deepEqual(planned(planner.createPlan(input), 'settle').parameters.map(item => item.binding), ['effect.record', 'opaque.ticket', 'host.object']);
});
test('HTTP authority cannot reopen or imply delivery, disposal or quiescence', () => {
  assert.deepEqual(http.AUTHORITY.states, ['owned', 'outcome-unknown', 'transferred', 'completed']);
  assert.deepEqual(http.AUTHORITY.mayRespond, ['owned']);
  assert.deepEqual(http.AUTHORITY.transitions, {
    dispatch: { from: 'owned', to: 'outcome-unknown', evidence: 'before-host-dispatch' },
    transfer: { from: 'outcome-unknown', to: 'transferred', evidence: 'provider-qualified-transfer' },
    complete: { from: 'transferred', to: 'completed', evidence: 'provider-qualified-local-completion' }
  });
  assert.equal(http.AUTHORITY.unknownOutcome, 'retain-outcome-unknown');
  for (const field of ['completionIsDeliveryReceipt', 'completionIsHostQuiescence', 'authorityIsHandleOwnership', 'automaticRetry']) assert.equal(http.AUTHORITY[field], false);
});

// Tiny reference interpreter tests the dispatch data, not a production adapter.
// Driver authentication, traps and actual sites remain P03/P09A conformance work.
function dispatch(point, outcomes, trace, deliver = () => true) {
  const visit = (item, phase = '') => { trace.push(item.owner + phase); return outcomes[item.owner]; };
  if (point.composition.dispatch === 'around') {
    point.contributions.forEach(item => visit(item, ':before'));
    const accepted = deliver();
    point.after.forEach(item => { trace.push(`${item.owner}:after:${accepted}`); });
    return accepted;
  }
  for (const item of point.contributions) {
    const result = visit(item);
    if (point.composition.dispatch === 'all-true' && !result) return false;
    if (point.composition.dispatch === 'first-true' && result) return true;
  }
  if (point.composition.dispatch === 'all-true') return true;
  if (point.composition.dispatch === 'first-true') return false;
}
for (const [id, point, outcomes, expected, visited] of [
  ['close', 'invocation.close', { a: false, b: true, c: false }, undefined, ['a', 'b', 'c']],
  ['settle', 'effect.settle', { a: true, b: false, c: true }, false, ['a', 'b']],
  ['settle', 'effect.settle', { a: true, b: true, c: true }, true, ['a', 'b', 'c']],
  ['timeout', 'response.authority', { a: false, b: true, c: true }, false, ['a']],
  ['result', 'result.claim', { a: false, b: true, c: true }, true, ['a', 'b']],
  ['result', 'result.claim', { a: false, b: false, c: false }, false, ['a', 'b', 'c']]
]) test(`dispatch trace ${id} ${String(expected)}`, () => {
  const input = fixture(); input.contributions = ['c', 'a', 'b'].map(owner => contribution(point, owner, { a: 1, b: 2, c: 3 }[owner]));
  const trace = [];
  assert.equal(dispatch(planned(planner.createPlan(input), id), outcomes, trace), expected);
  assert.deepEqual(trace, visited);
});
for (const accepted of [true, false]) test(`around normal-return ${accepted} reverses notification order`, () => {
  const input = fixture(); input.contributions = [contribution('effect.deliver', 'a', 1), contribution('effect.deliver', 'b', 2)];
  const trace = [];
  assert.equal(dispatch(planned(planner.createPlan(input), 'deliver'), {}, trace, () => accepted), accepted);
  assert.deepEqual(trace, ['a:before', 'b:before', `b:after:${accepted}`, `a:after:${accepted}`]);
});
test('trap skips after notifications and retains original failure', () => {
  const trace = [], trap = new Error('guest trap');
  assert.throws(() => dispatch(planned(planner.createPlan(fixture()), 'deliver'), {}, trace, () => { throw trap; }), error => error === trap);
  assert.deepEqual(trace, ['service:before']);
});
test('a denied HTTP fence prevents the error claim at that site', () => {
  const plan = planner.createPlan(fixture());
  const trace = [];
  for (const point of plan.sites.find(site => site.id === 'error').points) {
    const result = dispatch(point, { service: false }, trace);
    if (point.reject && !result) { trace.push(point.reject); break; }
  }
  assert.deepEqual(trace, ['service', 'suppress-error']);
});

rejects('null input', () => null);
rejects('unknown top-level field', x => { x.source = ''; });
rejects('missing bindings', x => { delete x.bindings; });
rejects('wrong bindings version', x => { x.bindings.version = 'pulse.lifecycle-bindings.v0'; });
rejects('wrong execution version', x => { x.bindings.executionVersion = 'pulse.execution-lifecycle.v0'; });
rejects('wrong HTTP version', x => { x.bindings.httpVersion = 'pulse.http-lifecycle.v0'; });
rejects('null HTTP is not explicit opt-in', x => { x.bindings.httpVersion = null; });
rejects('HTTP is unavailable by default', x => { delete x.bindings.httpVersion; });
rejects('binding semantics cannot be overridden', x => { at(x, 'settle').points[0].kind = 'observe'; });
rejects('provider source is excluded', x => { at(x, 'settle').points[0].body = 'return true'; });
rejects('anchors are excluded', x => { at(x, 'settle').anchor = 'function settle() {'; });
rejects('unknown point', x => { at(x, 'settle').points[0].point = 'other.point'; });
rejects('inherited name is not a point', x => { at(x, 'settle').points[0].point = 'constructor'; });
rejects('duplicate site', x => { x.bindings.sites.push(clone(x.bindings.sites[0])); });
rejects('duplicate point at site', x => { at(x, 'close').points.push(clone(at(x, 'close').points[0])); });
rejects('missing parameters', x => { delete at(x, 'settle').points[0].parameters; });
rejects('missing role', x => { delete at(x, 'settle').points[0].parameters.ticket; });
rejects('extra role', x => { at(x, 'settle').points[0].parameters.extra = 'extra'; });
rejects('ABI types belong outside planner', x => { at(x, 'settle').points[0].parameters.effect = ['index', 'i32']; });
rejects('missing after role', x => { at(x, 'deliver').points[0].afterParameters = {}; });
rejects('extra after role', x => { at(x, 'deliver').points[0].afterParameters.result = 'value'; });
rejects('after roles on non-around point', x => { at(x, 'close').points[0].afterParameters = {}; });
rejects('missing rejection action', x => { delete at(x, 'settle').points[0].reject; });
rejects('rejection source is not an action ID', x => { at(x, 'settle').points[0].reject = 'return 0'; });
rejects('wrong action kind', x => { at(x, 'close').points[0].reject = 'no'; });
rejects('missing claim action', x => { delete at(x, 'result').points[0].onClaim; });
rejects('empty site', x => { at(x, 'settle').points = []; });
rejects('empty site ID', x => { at(x, 'settle').id = ''; });
rejects('contribution without bound site', x => { x.bindings.sites = x.bindings.sites.filter(site => site.id !== 'settle'); });
rejects('duplicate owner on point', x => { x.contributions.push(contribution('effect.settle', 'service', 3)); });
rejects('duplicate order on point', x => { x.contributions.push(contribution('effect.settle', 'other', 0)); });
for (const order of [undefined, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) rejects(`invalid order ${String(order)}`, x => { x.contributions[0].order = order; });
for (const owner of ['', 'bad owner', 'a'.repeat(97), null, 1]) rejects(`invalid owner ${String(owner)}`, x => { x.contributions[0].owner = owner; });
rejects('source-bearing contribution is rejected', x => { x.contributions[0].body = ''; });
rejects('callback contribution is rejected', x => { x.contributions[0].before = () => {}; });
rejects('contribution kind override is rejected', x => { x.contributions[0].kind = 'claim'; });
rejects('missing contributions list', x => { delete x.contributions; });
rejects('sparse contributions list', x => { delete x.contributions[0]; });
rejects('custom array property', x => { x.contributions.extra = 1; });
rejects('accessor array element is not executed', x => { Object.defineProperty(x.contributions, '0', { get() { assert.fail('getter executed'); } }); });
rejects('accessor record field is not executed', x => { Object.defineProperty(x.contributions[0], 'owner', { get() { assert.fail('getter executed'); } }); });
rejects('symbol field is rejected', x => { x.contributions[0][Symbol('hidden')] = 'data'; });
rejects('non-record prototype', x => { Object.setPrototypeOf(x.contributions[0], { extra: true }); });
rejects('authority fence cannot follow error claim', x => { at(x, 'error').points.reverse(); });
rejects('authority binding must exist at every error site', x => { at(x, 'error').points.shift(); });
rejects('authority binding alone is not an active fence', x => { x.contributions = x.contributions.filter(item => item.point !== 'response.authority'); });
rejects('unused bindings still reject malformed schema', x => { x.contributions = []; at(x, 'error').points.reverse(); });

if (process.argv.includes('--installed')) {
  const path = require('node:path');
  // pnpm installs a content-addressed directory; realpath remains in this consumer.
  for (const file of Object.keys(require.cache)) assert.ok(file === __filename || file.startsWith(__dirname + path.sep), `external source dependency: ${file}`);
  assert.ok(require.resolve('@pulse-compute/wasm-contracts/provider/toolchain').includes('node_modules'));
}
console.log(`ok - ${cases} lifecycle contract/planner cases${process.argv.includes('--installed') ? ' from packed package' : ''}`);
