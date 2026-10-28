'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const b = require('./build.cjs');
const {execute} = require('./host.cjs');
const output = path.resolve(process.argv[2] || '/tmp/hex-nonterminal-lifecycle');
fs.mkdirSync(output, {recursive: true});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const relative = file => path.relative(b.root, file).split(path.sep).join('/');
const inputs = [__filename, ...['build.cjs', 'host.cjs', 'service.as.ts'].map(n => path.join(__dirname, n)),
  ...['build.cjs', 'service.as.ts'].map(n => path.join(__dirname, '../resource-accounting/ra03/native', n)),
  ...['lifecycle-hooks.js', 'response-authority.js', 'effect-invocations.js', 'request-budget.js',
    'request-budget.as.ts', 'native-platform-capabilities.js', 'native-application-errors.js']
    .map(n => path.join(b.root, 'packages/provider-fastly/src/build', n)),
  ...['handler/execution-lifecycle.js', 'host/http-lifecycle.js']
    .map(n => path.join(b.root, 'wasm/packages/contracts/src', n)),
  path.join(b.root, 'pnpm-lock.yaml')];
const identities = () => inputs.map(file => ({file: relative(file), sha256: hash(fs.readFileSync(file))}));
const receipt = {version: 'hex.nonterminal-lifecycle.v1', status: 'running',
  base: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: b.root, encoding: 'utf8'}).trim(),
  node: process.version, compiler: {scriptSha256: hash(fs.readFileSync(b.asc.script)),
    version: JSON.parse(fs.readFileSync(path.join(path.dirname(b.asc.script), '../package.json'))).version},
  inputs: identities(), artifacts: [], cases: [], mutations: [],
  scope: {compiledNative: true, productionAdmission: false, providerReality: false,
    serviceSlots: 1, coreFetchSlots: 1, packageCompletion: false, secondHost: false,
    sourceSubstitution: 'one config.get string slot in this checked fixture only',
    accounting: 'probe pending and lease handle/record claims only; no byte or global-resource census'}};
const save = () => fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
save();
const calls = (r, name) => r.trace.filter(row => row.call === name);
const hooks = (r, code) => r.trace.filter(row => row.call === 'hook' && row.code === code);
const checkNoBusiness = r => assert.equal(calls(r, 'fetch.send').length, 0, 'no continued core fetch');
function closedCleanup(r) {
  assert.equal(r.thrown, null);
  assert.equal(r.accounting.cleanupAttempts, 1);
  assert.equal(calls(r, 'probe.close').length, 1);
  const close = calls(r, 'probe.close')[0];
  assert.equal(close.closed, 1, 'cleanup after invocation closure');
  assert.equal(close.ticket, 0, 'cleanup after ticket invalidation');
}
function successful(r) {
  assert.equal(r.thrown, null);
  assert.deepEqual(r.sent, [{status: 200, body: '42:loaded'}]);
  assert.equal(calls(r, 'fetch.send').length, 1);
  assert.equal(r.accounting.accepted, 1);
  assert.equal(r.accounting.businessSucceeded, 1);
  assert.equal(r.accounting.handles, 0);
  assert.equal(r.accounting.records, 0);
  assert.deepEqual(r.probeRemaining, []);
  assert.equal(r.authority, 3);
  closedCleanup(r);
}
function authenticated(r) {
  successful(r);
  const attack = calls(r, 'attack')[0];
  assert(attack);
  assert.equal(attack.result, 0);
  assert.equal(attack.before, attack.after, 'rejected attempt cannot consume ticket');
}
function failedCompletion(r, stage) {
  assert.equal(r.thrown, null);
  assert.equal(r.stage, stage, 'driver preserves the original service failure');
  assert.equal(r.accounting.accepted, 1, 'driver may accept a failure placeholder');
  assert.equal(r.accounting.businessSucceeded, 0, 'failure delivery is not business success');
  assert.equal(r.accounting.outcome, 2);
  assert.equal(r.sent[0].status, 500);
  checkNoBusiness(r);
}
function record(name, wasm, options, verify) {
  const result = execute(wasm, options);
  try { verify(result); }
  catch (error) { receipt.failedCase = {name, options, result}; throw error; }
  receipt.cases.push({name, options, status: 'passed', result}); save(); console.log('ok - ' + name);
  return result;
}
function compile(name, source) {
  const wasm = b.compile(source, output, name);
  receipt.artifacts.push({name, bytes: wasm.length, sha256: hash(wasm), sourceSha256: hash(source),
    imports: WebAssembly.Module.imports(new WebAssembly.Module(wasm))}); save();
  return wasm;
}
try {
  const original = b.generate(output);
  assert.equal(b.instrument(original, {enabled: false}), original);
  const baseline = compile('baseline', original);
  const disabled = compile('disabled', b.instrument(original, {enabled: false}));
  assert.deepEqual(disabled, baseline);
  const control = compile('authority-control', b.control(original));
  const source = b.instrument(original);
  assert.equal(b.instrument(original, {reverse: true}), source, 'registration order independent');
  const active = compile('active', source);
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(active));
  assert(imports.some(i => i.module === 'nonterminal_proof'));
  assert(!imports.some(i => i.module === 'fastly_config_store'), 'carrier ABI pruned from active artifact');
  receipt.identity = {disabledSourceIdentical: true, disabledWasmIdentical: true, reversedContributionsIdentical: true,
    diagnosticFixtureDeltaBytes: active.length - control.length, productionOverheadClaim: false};
  const normal = record('nonterminal completion continues into ordinary fetch', active, {}, r => {
    successful(r);
    assert.equal(calls(r, 'select')[0].probe, true, 'existing driver waits on private pending handle');
    assert.equal(calls(r, 'select')[0].pending, 1, 'compiled handler is suspended on one effect');
    assert.equal(hooks(r, 4)[0].ticket, 1, 'settle guard precedes ticket consumption');
    assert.equal(hooks(r, 5)[0].ticket, 0, 'delivery follows ticket consumption');
    assert.equal(hooks(r, 6)[0].b, 1, 'result setter enclosed by delivery');
    assert.equal(hooks(r, 7)[0].a, 1);
    assert(r.trace.indexOf(hooks(r, 7)[0]) < r.trace.indexOf(calls(r, 'fetch.send')[0]));
    assert(r.trace.indexOf(calls(r, 'send')[0]) < r.trace.indexOf(calls(r, 'probe.close')[0]));
    assert(r.trace.filter(row => row.call.startsWith('probe.') && row.call !== 'probe.close' && row.call !== 'probe.release')
      .every(row => row.authority === 0), 'service does not transfer downstream authority');
  });
  const normalizeCore = r => r.trace.filter(row => row.call.startsWith('core.') || row.call.startsWith('fetch.')
    || row.call === 'send' || (row.call === 'select' && !row.probe))
    .map(({authority, ticket, closed, charged, pending, ...row}) => row);
  record('ordinary core-fetch trace and response match authority control', control, {}, r => {
    assert.equal(r.thrown, null); assert.deepEqual(r.sent, normal.sent);
    assert.deepEqual(normalizeCore(r), normalizeCore(normal));
    assert.deepEqual(r.coreRemaining, normal.coreRemaining);
  });
  record('zero-valued probe handle is owned and disposed', active, {probeStart: 0}, successful);
  record('probe delay consumes the original request deadline', active, {probeDelayMs: 37}, r => {
    successful(r);
    assert.equal(calls(r, 'select')[0].timeout, 1000);
    assert(calls(r, 'select').filter(row => !row.probe).every(row => row.timeout === 963));
  });
  record('repeat closure and responders cannot duplicate cleanup or send', active,
    {repeatClose: true, postResponders: true, reenter: true}, r => { successful(r); assert.equal(calls(r, 'send').length, 1); });
  for (const attack of ['wrong-ticket', 'wrong-result', 'direct-result', 'undefined-success'])
    record('authenticate ' + attack, active, {attack}, authenticated);
  record('settlement rejection leaves ticket intact until closure', active, {rejectSettle: true}, r => {
    closedCleanup(r); checkNoBusiness(r); assert.equal(hooks(r, 9)[0].ticket, 1);
    assert.equal(hooks(r, 5).length, 0); assert.equal(r.accounting.accepted, 0);
  });
  record('result rejection still executes normal-return after notification', active, {rejectResult: true}, r => {
    closedCleanup(r); checkNoBusiness(r); assert.equal(hooks(r, 9)[0].ticket, 0);
    assert.equal(hooks(r, 7)[0].a, 0); assert.equal(r.accounting.delivering, 0);
  });
  record('capacity shortage has no resource acquisition', active, {short: true}, r => {
    failedCompletion(r, 390); assert.equal(calls(r, 'probe.acquire').length, 0); assert.equal(r.accounting.handles, 0);
  });
  for (const consumeFailure of [false, true]) {
    for (const [fail, stage] of [['probe.acquire', 391], ['probe.complete', 392]])
      record('uncertain ' + fail + '/' + consumeFailure, active, {fail, consumeFailure, repeatClose: true}, r => {
        failedCompletion(r, stage); assert.equal(r.accounting.handles, 2); assert.equal(r.accounting.records, 2);
        assert.equal(r.accounting.cleanupAttempts, 0); assert.equal(r.accounting.leaseState, 4);
      });
    record('failed cleanup stays charged/' + consumeFailure, active, {fail: 'probe.close', consumeFailure, repeatClose: true}, r => {
      closedCleanup(r); assert.deepEqual(r.sent, normal.sent); assert.equal(r.error, 0);
      assert.equal(r.accounting.handles, 1); assert.equal(r.accounting.leaseState, 4);
      assert.equal(r.probeRemaining.length, consumeFailure ? 0 : 1);
    });
    record('uncertain response send does not prevent owned probe cleanup/' + consumeFailure, active,
      {fail: 'send.downstream', consumeFailure, repeatClose: true, postResponders: true}, r => {
        closedCleanup(r); assert.equal(r.accounting.handles, 0); assert.equal(r.authority, 1);
        assert.equal(calls(r, 'send').length, 1); assert.equal(r.sent.length, 0);
      });
  }
  record('read failure is delivered as failure and known lease closes', active, {fail: 'probe.read'}, r => {
    failedCompletion(r, 393); closedCleanup(r); assert.equal(r.accounting.handles, 0);
  });
  record('known failure rejects a forged success without consuming the ticket', active,
    {fail: 'probe.acquire', attack: 'success-on-failure'}, r => {
      failedCompletion(r, 391);
      const attack = calls(r, 'attack')[0]; assert(attack);
      assert.equal(attack.result, 0); assert.equal(attack.before, attack.after);
      assert.equal(r.accounting.handles, 2);
    });
  record('cleanup failure preserves original read error', active, {fail: ['probe.read', 'probe.close'], repeatClose: true}, r => {
    failedCompletion(r, 393); closedCleanup(r); assert.equal(r.accounting.handles, 1);
  });
  record('cancel before completion retains unknown output claims', active, {cancelAt: 'select'}, r => {
    failedCompletion(r, 394); assert.equal(calls(r, 'probe.complete').length, 0); assert.equal(r.accounting.handles, 2);
  });
  record('cancel during completion cleans qualified late lease without delivery', active, {cancelAt: 'complete'}, r => {
    failedCompletion(r, 394); closedCleanup(r); assert.equal(calls(r, 'probe.read').length, 0);
    assert.equal(r.accounting.handles, 0);
  });
  for (const options of [{timeout: 'probe'}, {cancelAt: 'select'}])
    record('post-closure completion cannot revive invocation/' + JSON.stringify(options), active,
      {...options, late: true, postResponders: true, repeatClose: true}, r => {
        assert.equal(r.thrown, null); checkNoBusiness(r); assert.equal(r.accounting.handles, 2);
        assert.equal(r.accounting.cleanupAttempts, 0); assert.equal(r.accounting.lateCount, 1);
        assert.equal(r.post[0].settle, 0); assert.equal(r.post[0].direct, 0);
        assert.equal(calls(r, 'send').length, 1); assert.equal(r.authority, 3);
      });
  for (const options of [{timeout: 'fetch'}, {expireAt: 'ready'}])
    record('cleanup cannot borrow the error-response time allowance/' + JSON.stringify(options), active, options, r => {
      assert.equal(r.thrown, null); assert.equal(r.sent[0].status, 504); assert.equal(r.accounting.handles, 1);
      assert.equal(r.accounting.cleanupAttempts, 0); assert.equal(r.accounting.leaseState, 4);
      if (options.expireAt) { checkNoBusiness(r); assert.equal(hooks(r, 5).length, 0); }
    });
  for (const fail of ['fetch.wait', 'fetch.read']) {
    const expected = execute(control, {fail});
    record('core failure remains primary/' + fail, active, {fail}, r => {
      closedCleanup(r); assert.deepEqual(r.sent, expected.sent); assert.equal(r.error, expected.error);
      assert.equal(r.stage, expected.stage); assert.equal(r.accounting.handles, 0);
    });
  }
  for (const trap of ['probe.acquire', 'probe.complete', 'probe.read', 'hook.6', 'fetch.read', 'send.downstream', 'probe.close'])
    record('trap has no implied finalizer/' + trap, active, {trap}, r => {
      assert(r.thrown?.includes('injected')); assert(r.accounting.handles > 0);
      assert.equal(r.accounting.cleanupAttempts, trap === 'probe.close' ? 1 : 0);
      if (trap !== 'probe.close') { assert.equal(r.closed, 0); assert.equal(hooks(r, 10).length, 0); }
      if (trap === 'hook.6') { assert.equal(r.accounting.delivering, 1); assert.equal(hooks(r, 7).length, 0); }
      if (trap === 'probe.close') assert.equal(r.accounting.leaseState, 7);
      if (trap === 'send.downstream') assert.equal(r.authority, 1);
    });
  for (const [mutation, options, verify] of [
    ['no-settle-guard', {attack: 'wrong-result'}, authenticated],
    ['no-result-guard', {attack: 'direct-result'}, authenticated],
    ['no-cleanup', {}, successful], ['early-cleanup', {}, successful],
    ['success-only', {fail: 'probe.acquire'}, r => failedCompletion(r, 391)]
  ]) {
    const wasm = compile('mutation-' + mutation, b.instrument(original, {mutation}));
    const result = execute(wasm, options);
    let detected = null;
    try { verify(result); } catch (error) { if (!(error instanceof assert.AssertionError)) throw error; detected = error.message; }
    assert(detected, 'mutation must be detected: ' + mutation);
    receipt.mutations.push({mutation, options, detected: true, assertion: detected, result}); save();
    console.log('ok - mutation detected: ' + mutation);
  }
  receipt.status = 'passed';
} catch (error) {
  receipt.status = 'failed'; receipt.error = error.stack; process.exitCode = 1;
}
if (JSON.stringify(identities()) !== JSON.stringify(receipt.inputs)) {
  receipt.status = 'failed'; receipt.error = 'Inputs changed during run'; process.exitCode = 1;
}
save(); console.log(JSON.stringify({status: receipt.status, cases: receipt.cases.length,
  mutations: receipt.mutations.length, error: receipt.error, output}));
