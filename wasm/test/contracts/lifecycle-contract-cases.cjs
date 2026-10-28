'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { executionLifecycle: execution, httpLifecycle: http } = require('../../packages/contracts/src/provider/toolchain');
const root = path.resolve(__dirname, '../../..');

function run({ packed = false } = {}) {
  const cases = [];
  const check = (name, body) => { body(); cases.push(name); };
  const contribution = (owner = 'probe', order = 0, point = 'effect.settle') => ({ point, owner, order });
  const invalid = fn => assert.throws(fn, { code: 'PULSEWASM_EXECUTION_LIFECYCLE_INVALID' });
  const points = { ...execution.POINTS, ...http.POINTS };
  check('execution capability does not imply HTTP', () => {
    assert.deepEqual(Object.keys(execution.POINTS), ['effect.settle', 'effect.deliver', 'effect.result', 'invocation.close', 'invocation.end', 'invocation.closed']);
    assert(!Object.keys(execution.POINTS).some(name => /request|response/.test(name)));
    invalid(() => execution.orderedContributions([contribution('probe', 0, 'response.authority')]));
  });
  check('HTTP points require explicit capability selection', () => {
    assert.deepEqual(Object.keys(http.POINTS), ['request.acquired', 'response.error', 'response.authority', 'result.claim']);
    assert.equal(execution.orderedContributions([contribution('probe', 0, 'response.authority')], points).length, 1);
    assert.deepEqual(http.POINTS['response.authority'].dominates, ['response.error']);
  });
  check('parameters carry roles without an ABI representation', () => {
    assert.deepEqual(execution.POINTS['effect.settle'].parameters, ['effect', 'ticket', 'result']);
    assert.deepEqual(execution.POINTS['effect.deliver'].afterParameters, ['accepted']);
    assert.doesNotMatch(JSON.stringify({ execution, http }), /AssemblyScript|Fastly|\bi32\b|__pulse_|anchor|usize/);
  });
  check('contracts are recursively immutable', () => {
    const visit = value => { if (value && typeof value === 'object') { assert(Object.isFrozen(value)); Object.values(value).forEach(visit); } };
    visit(execution); visit(http);
    assert.throws(() => { http.AUTHORITY.transitions.dispatch.to = 'completed'; }, TypeError);
  });
  check('composition kinds define result and short-circuit semantics', () => {
    assert.equal(execution.COMPOSITION.observe.dispatch, 'all');
    for (const kind of ['guard', 'predicate']) {
      assert.equal(execution.COMPOSITION[kind].dispatch, 'all-true');
      assert.equal(execution.COMPOSITION[kind].shortCircuit, true);
    }
    assert.equal(execution.COMPOSITION.claim.dispatch, 'first-true');
    assert.equal(execution.COMPOSITION.claim.shortCircuit, true);
  });
  check('after and exit notifications do not promise trap cleanup', () => {
    assert.equal(execution.COMPOSITION.around.afterOrder, 'descending');
    assert.equal(execution.COMPOSITION.around.afterOn, 'normal-return-only');
    for (const name of ['invocation.end', 'invocation.closed']) assert.equal(execution.POINTS[name].runsOn, 'normal-return-only');
    assert.equal(execution.POLICY.trap, 'no-after-or-exit-finalization-guarantee');
  });
  check('rejection postconditions precede ticket consumption and delivery', () => {
    assert.equal(execution.POINTS['effect.settle'].rejection, 'do-not-consume-ticket-or-deliver');
    assert.equal(execution.POINTS['effect.result'].rejection, 'do-not-deliver');
    assert.equal(http.POINTS['response.authority'].rejection, 'do-not-send-or-replace-response');
  });
  check('metadata validation does not require executable source', () => {
    assert.deepEqual(execution.orderedContributions([contribution()]), [contribution()]);
  });
  check('ordering is deterministic and does not mutate registration input', () => {
    const input = [contribution('late', 20), contribution('early', -10)];
    assert.deepEqual(execution.orderedContributions(input).map(c => c.owner), ['early', 'late']);
    assert.deepEqual(execution.orderedContributions(input), execution.orderedContributions([...input].reverse()));
    assert.equal(input[0].owner, 'late');
  });
  check('owners and orders are scoped per point', () => {
    assert.equal(execution.orderedContributions([contribution(), contribution('probe', 0, 'effect.result')]).length, 2);
  });
  for (const [name, values] of [
    ['non-list', {}], ['null record', [null]], ['array record', [[]]],
    ['unknown point', [contribution('probe', 0, 'missing')]],
    ['inherited point', [contribution('probe', 0, 'constructor')]],
    ['invalid owner', [contribution('Bad Owner')]], ['unbounded owner', [contribution('a'.repeat(97))]],
    ['fractional order', [contribution('probe', .5)]], ['unsafe order', [contribution('probe', 2 ** 53)]],
    ['duplicate owner', [contribution(), contribution('probe', 1)]],
    ['duplicate order', [contribution(), contribution('other')]]
  ]) check('reject ' + name, () => invalid(() => execution.orderedContributions(values)));
  check('provider may preserve its own diagnostic namespace', () => {
    assert.throws(() => execution.orderedContributions([contribution('bad owner')], points, message => Object.assign(new Error(message), { code: 'PROVIDER_INVALID' })), { code: 'PROVIDER_INVALID' });
  });
  check('authority has no automatic path back to owned', () => {
    assert.equal(http.AUTHORITY.initial, 'owned');
    assert.deepEqual(http.AUTHORITY.mayRespond, ['owned']);
    const transitions = http.AUTHORITY.transitions;
    assert.deepEqual(Object.values(transitions).map(t => [t.from, t.to]), [['owned', 'outcome-unknown'], ['outcome-unknown', 'transferred'], ['transferred', 'completed']]);
    assert.equal(transitions.dispatch.evidence, 'before-host-dispatch');
    assert.equal(transitions.transfer.evidence, 'provider-qualified-transfer');
    assert.equal(transitions.complete.evidence, 'provider-qualified-local-completion');
    assert.equal(http.AUTHORITY.unknownOutcome, 'retain-outcome-unknown');
    assert.equal(http.AUTHORITY.invalidTransition, 'no-state-change');
    assert.equal(http.AUTHORITY.automaticRetry, false);
  });
  check('completion does not prove delivery, quiescence or resource disposal', () => {
    for (const field of ['completionIsDeliveryReceipt', 'completionIsHostQuiescence', 'authorityIsHandleOwnership']) assert.equal(http.AUTHORITY[field], false);
  });
  check('execution contract loads without HTTP or a provider', () => {
    const file = path.join(root, 'wasm/packages/contracts/src/handler/execution-lifecycle.js');
    execFileSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict'),Module=require('node:module');
      const original=Module._load;
      Module._load=function(id,...rest){assert(!/http-lifecycle|provider-fastly/.test(id));return original.call(this,id,...rest)};
      const contract=require(process.argv[1]);
      assert.equal(contract.VERSION,'pulse.execution-lifecycle.v1');
      assert.equal(contract.orderedContributions([{point:'invocation.close',owner:'device-loop',order:0}]).length,1);
    `, file], { cwd: os.tmpdir(), stdio: 'pipe' });
  });
  let packedResult;
  if (packed) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-lifecycle-packed-'));
    try {
      const output = execFileSync('npm', ['pack', path.join(root, 'wasm/packages/contracts'), '--ignore-scripts', '--json', '--pack-destination', dir], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const [receipt] = JSON.parse(output), tarball = path.join(dir, receipt.filename);
      const installed = path.join(dir, 'node_modules/@pulse-compute/wasm-contracts'); fs.mkdirSync(installed, { recursive: true });
      execFileSync('tar', ['-xzf', tarball, '--strip-components=1', '-C', installed]);
      const probe = `const assert=require('node:assert/strict'),Module=require('node:module');
        const load=Module._load;Module._load=function(id,...rest){assert(!/provider-fastly/.test(id));return load.call(this,id,...rest)};
        const {executionLifecycle:e,httpLifecycle:h}=require('@pulse-compute/wasm-contracts/provider/toolchain');
        assert.equal(e.VERSION,'pulse.execution-lifecycle.v1');assert.equal(h.VERSION,'pulse.http-lifecycle.v1');
        assert.equal(e.POINTS['response.authority'],undefined);
        assert.equal(e.orderedContributions([{point:'response.authority',owner:'http-server',order:0}],h.POINTS).length,1);
        assert.deepEqual(h.AUTHORITY.mayRespond,['owned']);
        console.log(JSON.stringify({execution:e.VERSION,http:h.VERSION,fastlyLoaded:false}));`;
      fs.writeFileSync(path.join(dir, 'probe.cjs'), probe);
      const result = JSON.parse(execFileSync(process.execPath, [path.join(dir, 'probe.cjs')], { cwd: dir, encoding: 'utf8' }));
      packedResult = { ...result, packageSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(tarball)).digest('hex'), packageBytes: fs.statSync(tarball).size };
      cases.push('packed contracts load outside checkout without Fastly');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  console.log(`ok - shared lifecycle: ${cases.length} contract cases${packed ? ', including isolated packed consumer' : ''}`);
  return { cases, packed: packedResult || null };
}
if (require.main === module) {
  const receipt = run({ packed: process.argv.includes('--packed') });
  const output = process.argv.find(arg => arg.startsWith('--out='));
  if (output) fs.writeFileSync(output.slice(6), JSON.stringify(receipt, null, 2) + '\n');
}
module.exports = { run };
