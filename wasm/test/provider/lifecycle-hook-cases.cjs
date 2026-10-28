'use strict';
const assert = require('node:assert/strict');
const lifecycle = require('../../../packages/provider-fastly/src/build/lifecycle-hooks');
const hooks = { ...lifecycle, compose: (source, items, features = { requestBudget: false }) => lifecycle.compose(source, items, features) };

function run() {
  const driver = [
    'function __pulse_invocation_settle(index: i32, ticket: i32, result: i32): i32 {',
    '  return pulse_set_effect_result(index, result)',
    '}',
    'function __pulse_fastly_jwt_send_error(): void {',
    '}',
    'function __pulse_fastly_send_result(handle: i32): i32 {',
    '  return 0',
    '}'
  ].join('\n');
  const code = error => error.code === 'PULSE_FASTLY_LIFECYCLE_HOOK_INVALID';
  let checks = 0;
  const throws = (fn, message) => { assert.throws(fn, code, message); checks++; };

  // No contributions: the driver is untouched, so unused builds stay byte-identical.
  assert.equal(hooks.compose(driver, []).source, driver); checks++;
  assert.deepEqual(hooks.compose(driver, []).record, []); checks++;

  const guard = (owner, order, body = '  return true') => ({ point: 'effect.settle', owner, order, body });
  throws(() => hooks.compose(driver, [{ point: 'effect.nope', owner: 'a', order: 0, body: '' }]), 'unknown point');
  throws(() => hooks.compose(driver, [guard('a', 0), guard('a', 1)]), 'one contribution per owner and point');
  throws(() => hooks.compose(driver, [guard('a', 0), guard('b', 0)]), 'distinct orders on one point');
  throws(() => hooks.compose(driver, [guard('a', 0.5)]), 'integer order');
  throws(() => hooks.compose(driver, [guard('Bad Owner', 0)]), 'bounded owner identifier');
  throws(() => hooks.compose(driver, [guard('a', 0, 'export function leak(): void {}')]), 'no export widening');
  throws(() => hooks.compose(driver, [{ point: 'effect.deliver', owner: 'a', order: 0, before: '' }]), 'around needs before and after');
  // Anchor drift fails closed instead of silently skipping the fence.
  throws(() => hooks.compose(driver.replace('function __pulse_fastly_jwt_send_error(): void {', 'function __renamed(): void {'),
    [{ point: 'response.authority', owner: 'a', order: 0, body: '  return true' }]), 'required responder anchor drift');
  throws(() => hooks.compose(driver + '\n' + driver, [guard('a', 0)]), 'duplicate anchor');
  throws(() => hooks.compose(driver, [{ point: 'invocation.close', owner: 'a', order: 0, body: '' }]), 'required anchor absent in this driver mode');

  // The optional timeout responder is skipped when absent, and every present
  // responder is fenced by the one authority predicate with its own rejection.
  const fenced = hooks.compose(driver, [{ point: 'response.authority', owner: 'a', order: 0, body: '  return false' }]);
  assert.match(fenced.source, /__pulse_fastly_jwt_send_error\(\): void \{\n  if \(!__pulse_hook_response_authority\(\)\) return;/); checks++;
  assert.match(fenced.source, /__pulse_fastly_send_result\(handle: i32\): i32 \{\n  if \(!__pulse_hook_response_authority\(\)\) \{ __pulse_fastly_fail\(PULSE_ERROR_STATE, 282/); checks++;
  assert.equal(fenced.record[0].sites.length, 2); checks++;

  const authority = [{ point: 'response.authority', owner: 'a', order: 0, body: 'return true' }];
  throws(() => hooks.compose(driver, authority, { requestBudget: true }), 'enabled budget requires timeout anchor');
  throws(() => lifecycle.compose(driver, authority), 'explicit budget mode required');
  const timed = driver + '\nfunction __request_send_timeout(): void {}';
  throws(() => hooks.compose(timed, authority), 'disabled budget rejects unexpected timeout');
  throws(() => hooks.compose(timed.replace('__request_send_timeout', '__renamed_timeout'), authority, { requestBudget: true }), 'enabled timeout drift');
  throws(() => hooks.compose(timed + '\nfunction __request_send_timeout(): void {}', authority, { requestBudget: true }), 'duplicate timeout');
  assert.equal(hooks.compose(timed, authority, { requestBudget: true }).record[0].sites.length, 3); checks++;
  throws(() => hooks.compose(driver, [{ point: 'constructor', owner: 'a', order: 0, body: '' }]), 'inherited names are not points');
  throws(() => hooks.compose(driver, [guard('a', Number.MAX_SAFE_INTEGER + 1)]), 'unsafe integer order');
  const bound = () => structuredClone(hooks.BINDINGS);
  let invalid = bound(); delete invalid['effect.settle'].params.ticket;
  throws(() => hooks.bindPoints(invalid), 'missing semantic role');
  invalid = bound(); invalid['effect.result'].params.pointer = ['address', 'usize'];
  throws(() => hooks.bindPoints(invalid), 'extra provider role');
  invalid = bound(); invalid['effect.deliver'].afterParams = {};
  throws(() => hooks.bindPoints(invalid), 'missing acceptance role');
  invalid = bound(); invalid['effect.settle'].kind = 'observe';
  throws(() => hooks.bindPoints(invalid), 'provider cannot redefine composition');
  invalid = bound(); invalid['response.authority'].doc = 'a different semantic';
  throws(() => hooks.bindPoints(invalid), 'provider cannot redefine semantics');
  throws(() => hooks.bindPoints(Object.fromEntries(Object.entries(bound()).reverse())), 'authority must remain outside error claims');
  for (const [file, contract] of [['lifecycle-hooks', 'executionLifecycle'], ['lifecycle-hooks', 'httpLifecycle'], ['response-authority', 'httpLifecycle']]) {
    require('node:child_process').execFileSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict'),Module=require('node:module');
      const contracts=Module.createRequire(process.argv[1])('@pulse-compute/wasm-contracts/provider/toolchain'),load=Module._load;
      Module._load=function(id,...rest){return id==='@pulse-compute/wasm-contracts/provider/toolchain'
        ? {...contracts,[process.argv[2]]:{...contracts[process.argv[2]],VERSION:'unreviewed.v2'}} : load.call(this,id,...rest)};
      assert.throws(()=>require(process.argv[1]),{code:'PULSE_FASTLY_LIFECYCLE_HOOK_INVALID'});
    `, require.resolve('../../../packages/provider-fastly/src/build/' + file), contract], { cwd: require('node:path').resolve(__dirname, '../../..'), stdio: 'pipe' });
    checks++;
  }

  // Composition is deterministic: contribution order never changes the output,
  // guards run in declared order and short-circuit, around() unwinds in reverse.
  const many = [guard('b', 2), guard('a', 1), { point: 'effect.deliver', owner: 'x', order: 1, before: '  // x before', after: '  // x after' },
    { point: 'effect.deliver', owner: 'y', order: 2, before: '  // y before', after: '  // y after' }];
  const forward = hooks.compose(driver, many).source, reverse = hooks.compose(driver, [...many].reverse()).source;
  assert.equal(forward, reverse); checks++;
  assert.match(forward, /if \(!__pulse_hook_effect_settle_0\(index, ticket, result\)\) return false; if \(!__pulse_hook_effect_settle_1/); checks++;
  assert.match(forward, /__pulse_hook_effect_deliver_1_after\(index, result, accepted\); __pulse_hook_effect_deliver_0_after/); checks++;
  assert.match(forward, /const accepted = pulse_set_effect_result\(index, result\)\n  __pulse_hook_effect_deliver_after\(index, result, accepted\)\n  return accepted/); checks++;

  assert.deepEqual(hooks.describe().map(p => p.point),
    ['request.acquired', 'effect.settle', 'effect.deliver', 'effect.result', 'invocation.close', 'invocation.end', 'invocation.closed', 'response.error', 'response.authority', 'result.claim']); checks++;
  console.log(`ok - lifecycle hooks: ${checks} composer cases (identity when unused, validation, anchor drift, ordering, responder fence)`);
}
if (require.main === module) run();
module.exports = { run };
