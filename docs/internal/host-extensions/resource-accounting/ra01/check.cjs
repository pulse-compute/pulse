'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { initial, step, summary } = require('./model.cjs');
const contract = require('./contract.json');
const root = path.resolve(__dirname, '../../../../..');
const output = path.resolve(process.argv[2] || '/tmp/hex-ra01-receipt.json');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const receipt = { version: 'hex.ra01-checks.v0', status: 'running', revision: git('rev-parse', 'HEAD'),
  workingTree: git('status', '--porcelain'), node: process.version,
  inputs: ['contract.json', 'model.cjs', 'check.cjs', 'README.md'].map(file => ({ file, sha256: hash(path.join(__dirname, file)) })),
  inherited: { file: '../ra00/receipt.json', sha256: hash(path.join(__dirname, '../ra00/receipt.json')), execution: 'not rerun' }, cases: [] };
const ref = (slot = 0, generation = 1, execution = 'execution-1') => ({ execution, slot, generation });
const own = (id = 'root', parent, kind = 'operation') => ({ type: 'owner', id, parent, kind });
const item = (slot = 0, kind = 'reader', owner = 'root', extra = {}) => ({ ref: ref(slot), kind, owner,
  namespace: kind === 'reader' || kind === 'writer' ? 'fastly.body' : 'fixture.' + kind,
  payload: slot, access: 'quiescent', binding: { capability: 'fixture.' + kind, service: 'fixture.service', useSite: 'fixture.site', implementation: 'fixture.v0' }, ...extra });
const acquire = resource => ({ type: 'adopt', resource });
const begin = (id = 'call', action = 'close', refs = [ref()], actor = 'root', mode = 'work', outputKinds = []) =>
  ({ type: 'begin', id, actor, mode, inputs: refs.map(ref => ({ ref, action })), outputKinds });
const result = (disposition = 'released', resourceRef = ref(), extra = {}) => ({ ref: resourceRef, disposition, access: 'quiescent', ...extra });
const complete = (results = [result()], extra = {}) => ({ type: 'complete', id: 'call', actor: 'root', status: 'ok', acceptance: 'not-applicable', results, outputs: [], ...extra });
function harness() {
  let state = initial(); const trace = [];
  return {
    send(e) { state = step(state, e); trace.push(e); return state; },
    reject(e, code) {
      const before = JSON.stringify(state);
      assert.throws(() => step(state, e), error => error.code === 'RA01_' + code);
      assert.equal(JSON.stringify(state), before, 'rejected event changed state');
      trace.push({ rejected: e, code });
    },
    get state() { return state; }, get trace() { return trace; },
    finish() { return summary(state); }
  };
}
function test(name, fn) {
  const h = harness();
  try { fn(h); receipt.cases.push({ name, status: 'passed', trace: h.trace, summary: h.finish() }); }
  catch (error) { receipt.cases.push({ name, status: 'failed', trace: h.trace, error: error.stack }); throw error; }
}
const setup = (h, kind = 'reader', extra = {}) => { h.send(own()); h.send(acquire(item(0, kind, 'root', extra))); };
try {
  test('Zero payload is valid; distinct ABI namespaces may reuse integers', h => {
    setup(h); h.send(acquire(item(1, 'response', 'root', { payload: 0 })));
    assert.equal(h.finish().resources.length, 2);
  });
  test('Semantic kinds do not split one ABI handle namespace', h => {
    setup(h); h.reject(acquire(item(1, 'writer', 'root', { payload: 0 })), 'DUPLICATE_PAYLOAD');
  });
  test('Identity fences execution and generation, not static call site', h => {
    setup(h); h.reject(begin('foreign', 'close', [ref(0, 1, 'other')]), 'EXECUTION');
    h.reject(begin('stale', 'close', [ref(0, 2)]), 'STALE_REFERENCE');
    h.reject(acquire(item(0, 'reader', 'root', { ref: ref(0, 2), payload: 9 })), 'LIVE_SLOT');
  });
  test('Released slot and numeric handle may be reused with a new generation', h => {
    setup(h); h.send(begin()); h.send(complete());
    h.send(acquire(item(0, 'reader', 'root', { ref: ref(0, 2) })));
    h.reject(begin('old', 'close', [ref()]), 'STATE');
    assert.equal(h.finish().resources[1].state, 'owned');
  });
  test('Foreign owner cannot consume a resource', h => {
    setup(h); h.send(own('sibling')); h.reject(begin('wrong', 'close', [ref()], 'sibling'), 'OWNER');
  });
  test('Pins prevent cleanup until explicitly released, even after stop', h => {
    setup(h); h.send(own('child', 'root'));
    h.send({ type: 'pin', id: 'borrow', actor: 'child', ref: ref() });
    h.reject(begin(), 'PINNED'); h.send({ type: 'stop', actor: 'root' });
    h.send({ type: 'unpin', id: 'borrow', actor: 'child' });
    h.send(begin('call', 'close', [ref()], 'root', 'cleanup')); h.send(complete());
  });
  test('Borrow does not grant owner authority or cross-root access', h => {
    setup(h); h.send(own('child', 'root')); h.send(own('other'));
    h.reject({ type: 'pin', id: 'x', actor: 'other', ref: ref() }, 'BORROW');
    h.send({ type: 'pin', id: 'b', actor: 'child', ref: ref() });
    h.reject({ type: 'unpin', id: 'b', actor: 'root' }, 'PIN');
    h.reject(begin('bad', 'close', [ref()], 'child'), 'OWNER');
  });
  test('Child handoff preserves root attribution and invalidates prior owner', h => {
    h.send(own()); h.send(own('lookup', 'root')); h.send(own('loader', 'root'));
    h.send(acquire(item(0, 'buffer', 'lookup')));
    h.send({ type: 'handoff', ref: ref(), actor: 'lookup', to: 'loader' });
    h.reject(begin('wrong', 'close', [ref()], 'lookup'), 'OWNER');
    assert.equal(h.finish().resources[0].root, 'root'); assert.equal(h.finish().resources[0].owner, 'loader');
  });
  test('Handoff cannot launder attribution into another parallel root', h => {
    setup(h); h.send(own('other')); h.reject({ type: 'handoff', ref: ref(), actor: 'root', to: 'other' }, 'ROOT');
  });
  test('Execution result ownership survives effect settlement', h => {
    setup(h); h.send(own('result', 'root', 'result'));
    h.send({ type: 'handoff', ref: ref(), actor: 'root', to: 'result' });
    h.send({ type: 'settle', actor: 'root', status: 'ok' });
    h.send(begin('call', 'close', [ref()], 'result', 'cleanup')); h.send(complete([result()], { actor: 'result' }));
    assert.equal(h.finish().resources[0].state, 'released');
  });
  test('Settling an effect does not dispose retained fetch resources', h => {
    setup(h); h.send({ type: 'settle', actor: 'root', status: 'ok' });
    assert.equal(h.finish().resources[0].state, 'owned');
    h.reject(begin('read', 'read'), 'CLOSED_OWNER');
    h.send(begin('call', 'close', [ref()], 'root', 'cleanup')); h.send(complete());
  });
  test('Opaque result can transfer after producing effect settles', h => {
    setup(h); h.send(own('result', 'root', 'result'));
    h.send({ type: 'handoff', ref: ref(), actor: 'root', to: 'result' });
    h.send({ type: 'settle', actor: 'root', status: 'ok' });
    h.send(begin('call', 'send', [ref()], 'result'));
    h.send(complete([result('transferred', ref(), { receiver: 'downstream' })], { actor: 'result' }));
  });
  test('Execution cancellation also fences a result whose effect already settled', h => {
    setup(h); h.send(own('result', 'root', 'result'));
    h.send({ type: 'handoff', ref: ref(), actor: 'root', to: 'result' });
    h.send({ type: 'settle', actor: 'root', status: 'ok' }); h.send({ type: 'stop', actor: 'root' });
    h.reject(begin('call', 'send', [ref()], 'result'), 'CLOSED_OWNER');
    h.send(begin('call', 'close', [ref()], 'result', 'cleanup')); h.send(complete([result()], { actor: 'result' }));
  });
  test('No implicit retry after known-retained send failure; safe close remains possible', h => {
    setup(h, 'request'); h.send(begin('call', 'send'));
    h.send(complete([result('retained', ref(), { basis: 'fixture-host-observation' })], { status: 'error', acceptance: 'not-accepted' }));
    h.reject(begin('retry', 'send'), 'RETRY'); h.send(begin('cleanup', 'close', [ref()], 'root', 'cleanup'));
    h.send(complete([result()], { id: 'cleanup' }));
  });
  for (const disposition of ['retained', 'consumed', 'unknown']) {
    test('Failed disposal preserves ' + disposition + ' without speculative retry', h => {
      setup(h); h.send(begin());
      h.send(complete([result(disposition, ref(), { basis: 'fixture-host-observation' })], { status: 'error' }));
      h.reject(begin('again'), 'STATE');
      const r = h.finish().resources[0]; assert.equal(r.disposition, disposition);
      assert.equal(r.state, disposition === 'consumed' ? 'consumed' : 'unresolved');
    });
  }
  test('Known failed-call consumption requires provider evidence', h => {
    setup(h); h.send(begin()); h.reject(complete([result('retained')], { status: 'error' }), 'DISPOSITION_PROOF');
  });
  test('Success status does not permit an invented disposition', h => {
    setup(h); h.send(begin()); h.reject(complete([result('retained')]), 'DISPOSITION');
  });
  test('Unknown failed-send ownership blocks handle and slot reuse', h => {
    setup(h, 'request'); h.send(begin('call', 'send'));
    h.send(complete([result('unknown')], { status: 'error', acceptance: 'unknown' }));
    h.reject(acquire(item(1, 'request', 'root', { payload: 0 })), 'DUPLICATE_PAYLOAD');
    h.reject(acquire(item(0, 'request', 'root', { ref: ref(0, 2), payload: 1 })), 'LIVE_SLOT');
  });
  test('Partial preparation leaves acquired resources visible for cleanup', h => {
    setup(h, 'request'); h.send({ type: 'stop', actor: 'root' });
    h.send(begin('call', 'close', [ref()], 'root', 'cleanup')); h.send(complete());
  });
  test('Multi-input send is fenced before host entry and requires every outcome', h => {
    setup(h, 'request'); h.send(acquire(item(1, 'writer')));
    h.reject(begin('bad', 'send', [ref(), ref()]), 'DUPLICATE_INPUT');
    h.send(begin('call', 'send', [ref(), ref(1)]));
    h.reject(complete([result('transferred', ref(), { receiver: 'origin' })]), 'PARTIAL_REPORT');
    h.send(complete([result('transferred', ref(), { receiver: 'origin' }), result('transferred', ref(1), { receiver: 'origin' })]));
  });
  test('Mixed per-input failure dispositions are retained independently', h => {
    setup(h, 'request'); h.send(acquire(item(1, 'writer'))); h.send(begin('call', 'send', [ref(), ref(1)]));
    h.send(complete([result('consumed', ref(), { basis: 'fixture-host-observation' }), result('unknown', ref(1))], { status: 'error', acceptance: 'unknown' }));
    assert.deepEqual(h.finish().resources.map(r => r.state), ['consumed', 'unresolved']);
  });
  test('Streaming send transfers request but retains the active writer', h => {
    setup(h, 'request'); h.send(acquire(item(1, 'writer')));
    const event = begin('call', 'send', [ref(), ref(1)]); event.inputs[1].action = 'send-retain'; h.send(event);
    h.send(complete([result('transferred', ref(), { receiver: 'origin' }), result('retained', ref(1), { access: 'active' })]));
    assert.deepEqual(h.finish().resources.map(r => r.state), ['transferred', 'owned']);
    h.reject(begin('cleanup', 'abandon', [ref(1)], 'root', 'cleanup'), 'EXTERNAL_ACCESS');
  });
  test('Failed input validation fences the whole call atomically', h => {
    setup(h, 'request'); h.send(acquire(item(1, 'reader', 'root', { access: 'active' })));
    h.reject(begin('call', 'close', [ref(), ref(1)]), 'EXTERNAL_ACCESS');
    assert.deepEqual(h.finish().resources.map(r => r.state), ['owned', 'owned']);
  });
  test('No duplicate completion, concurrent action or forged completion owner', h => {
    setup(h); h.send(begin()); h.reject(begin('second'), 'STATE');
    h.reject(complete([result()], { actor: 'other' }), 'OWNER'); h.send(complete());
    h.reject(complete(), 'CALL');
  });
  test('Pending replacement adopts response and body before resumption', h => {
    setup(h, 'pending'); h.send(begin('call', 'resolve', [ref()], 'root', 'work', ['response', 'reader']));
    h.reject(complete([result('consumed')], { outputs: [item(1, 'response')] }), 'PARTIAL_REPORT');
    h.send(complete([result('consumed')], { outputs: [item(1, 'response'), item(2, 'reader')] }));
    assert.deepEqual(h.finish().resources.map(r => r.state), ['consumed', 'owned', 'owned']);
  });
  test('Error may return an observed output; it remains owned', h => {
    setup(h, 'pending'); h.send(begin('call', 'resolve', [ref()], 'root', 'work', ['response', 'reader']));
    h.send(complete([result('consumed', ref(), { basis: 'fixture-host-observation' })], { status: 'error', outputs: [item(1, 'response')] }));
    assert.equal(h.finish().resources[1].state, 'owned');
  });
  test('Undeclared acquired output is a contract violation, not an invisible resource', h => {
    setup(h, 'pending'); h.send(begin('call', 'resolve'));
    h.reject(complete([result('consumed')], { outputs: [item(1, 'reader')] }), 'OUTPUT');
  });
  test('Late completion after stop only adopts cleanup-owned outputs', h => {
    setup(h, 'pending'); h.send(begin('call', 'resolve', [ref()], 'root', 'work', ['reader']));
    h.send({ type: 'stop', actor: 'root' });
    h.send(complete([result('consumed')], { outputs: [item(1, 'reader')] }));
    h.reject(begin('read', 'read', [ref(1)]), 'CLOSED_OWNER');
    h.send(begin('cleanup', 'close', [ref(1)], 'root', 'cleanup')); h.send(complete([result('released', ref(1))], { id: 'cleanup' }));
  });
  test('Stopping a root prevents new children and acquisitions', h => {
    setup(h); h.send({ type: 'stop', actor: 'root' });
    h.reject(own('child', 'root'), 'CLOSED_OWNER'); h.reject(acquire(item(1)), 'CLOSED_OWNER');
  });
  test('Parent settlement waits for admitted child settlement', h => {
    h.send(own()); h.send(own('child', 'root')); h.reject({ type: 'settle', actor: 'root', status: 'ok' }, 'CHILD_LIVE');
    h.send({ type: 'settle', actor: 'child', status: 'ok' }); h.send({ type: 'settle', actor: 'root', status: 'ok' });
  });
  test('An in-flight call cannot be silently settled or finalized', h => {
    setup(h); h.send(begin()); h.reject({ type: 'settle', actor: 'root', status: 'ok' }, 'IN_FLIGHT');
    h.reject({ type: 'end', reason: 'return' }, 'IN_FLIGHT');
  });
  test('Cache pending cleanup cannot introduce a blocking close', h => {
    setup(h, 'cache'); h.reject(begin('call', 'close', [ref()], 'root', 'cleanup'), 'WOULD_BLOCK');
    h.send({ ...begin('call', 'close', [ref()], 'root', 'cleanup'), ready: true }); h.send(complete());
  });
  test('Pending cleanup resolves only after nonblocking readiness evidence', h => {
    setup(h, 'pending'); h.reject(begin('call', 'resolve', [ref()], 'root', 'cleanup'), 'WOULD_BLOCK');
    h.send({ ...begin('call', 'resolve', [ref()], 'root', 'cleanup'), ready: true }); h.send(complete([result('consumed')]));
  });
  test('Writer cleanup abandons and cannot commit or substitute generic close', h => {
    setup(h, 'writer'); h.reject(begin('bad', 'commit', [ref()], 'root', 'cleanup'), 'CLEANUP_COMMIT');
    h.reject(begin('bad', 'close'), 'ACTION'); h.send(begin('call', 'abandon', [ref()], 'root', 'cleanup')); h.send(complete());
  });
  for (const acceptance of ['accepted', 'not-accepted', 'unknown']) {
    test('Commit failure consumption stays separate from acceptance ' + acceptance, h => {
      setup(h, 'writer'); h.send(begin('call', 'commit'));
      h.send(complete([result('consumed', ref(), { basis: 'fixture-host-observation' })], { status: 'error', acceptance }));
      h.reject({ type: 'settle', actor: 'root', status: 'ok' }, 'SETTLEMENT');
      h.send({ type: 'settle', actor: 'root', status: 'error' });
      assert.equal(h.finish().resources[0].acceptance, acceptance);
    });
  }
  test('Successful commit needs acceptance but does not establish delivery or release', h => {
    setup(h, 'writer'); h.send(begin('call', 'commit')); h.reject(complete([result('consumed')]), 'ACCEPTANCE');
    h.send(complete([result('consumed')], { acceptance: 'accepted' })); assert.equal(h.finish().resources[0].state, 'consumed');
  });
  test('Failed retained commit does not trigger abandon or commit retry', h => {
    setup(h, 'writer'); h.send(begin('call', 'commit'));
    h.send(complete([result('retained', ref(), { basis: 'fixture-host-observation' })], { status: 'error', acceptance: 'unknown' }));
    h.reject(begin('retry', 'commit'), 'STATE'); h.reject(begin('cleanup', 'abandon', [ref()], 'root', 'cleanup'), 'STATE');
  });
  for (const access of ['active', 'unknown']) {
    test('Cancellation cannot free a buffer with ' + access + ' external access', h => {
      setup(h, 'buffer', { access }); h.send({ type: 'stop', actor: 'root' });
      h.reject(begin('call', 'close', [ref()], 'root', 'cleanup'), 'EXTERNAL_ACCESS');
      h.reject({ type: 'quiesce', actor: 'root', ref: ref() }, 'QUIESCENCE_PROOF');
      h.send({ type: 'quiesce', actor: 'root', ref: ref(), proof: 'fixture-provider-completion' });
      h.send(begin('call', 'close', [ref()], 'root', 'cleanup')); h.send(complete());
    });
  }
  test('Active buffer transfer requires a receiver that owns continued access', h => {
    setup(h, 'buffer', { access: 'active' }); h.send(begin('call', 'send'));
    h.reject(complete([result('transferred', ref(), { access: 'active', receiver: 'host' })]), 'RECEIVER');
    h.send(complete([result('transferred', ref(), { access: 'active', receiver: 'host', receiverOwnsAccess: true })]));
  });
  test('Qualified disposal may itself establish quiescence; failure cannot assume it', h => {
    setup(h, 'buffer', { access: 'active' });
    h.send({ ...begin('call', 'close', [ref()], 'root', 'cleanup'), disposeProof: 'fixture-provider-dispose-quiescence' });
    h.reject(complete([result()]), 'QUIESCENCE_PROOF');
    h.send(complete([result('unknown', ref(), { access: 'unknown' })], { status: 'error' }));
    assert.equal(h.finish().resources[0].state, 'unresolved');
  });
  test('Qualified disposal completion establishes release only with quiescence evidence', h => {
    setup(h, 'buffer', { access: 'active' });
    h.send({ ...begin('call', 'close', [ref()], 'root', 'cleanup'), disposeProof: 'fixture-provider-dispose-quiescence' });
    h.send(complete([result('released', ref(), { proof: 'fixture-provider-completion' })]));
    assert.equal(h.finish().resources[0].state, 'released');
  });
  test('Consumed input with unknown external access remains unavailable for reuse', h => {
    setup(h, 'buffer', { access: 'active' }); h.send(begin('call', 'send'));
    h.send(complete([result('consumed', ref(), { access: 'unknown', basis: 'fixture-host-observation' })], { status: 'error', acceptance: 'unknown' }));
    h.reject(acquire(item(1, 'buffer', 'root', { payload: 0 })), 'DUPLICATE_PAYLOAD');
  });
  test('Result cannot invent quiescence after externally active work', h => {
    setup(h, 'buffer', { access: 'active' }); h.send(begin('call', 'send'));
    h.reject(complete([result('transferred', ref(), { receiver: 'host' })]), 'QUIESCENCE_PROOF');
  });
  test('External access and pins prevent internal ownership handoff', h => {
    setup(h, 'buffer', { access: 'active' }); h.send(own('child', 'root'));
    h.reject({ type: 'handoff', ref: ref(), actor: 'root', to: 'child' }, 'EXTERNAL_ACCESS');
  });
  test('Lease is distinct from byte storage and must close explicitly', h => {
    setup(h, 'lease'); h.send(acquire(item(1, 'buffer'))); h.send(begin()); h.send(complete());
    assert.deepEqual(h.finish().resources.map(r => r.state), ['released', 'owned']);
  });
  test('Best-effort Web cancellation cannot be reported as confirmed release', h => {
    setup(h, 'web-response'); h.send(begin('call', 'cancel', [ref()], 'root', 'cleanup'));
    h.reject(complete([result('released')]), 'DISPOSITION'); h.send(complete([result('unknown')]));
    assert.equal(h.finish().resources[0].state, 'unresolved');
  });
  test('Requesting cancellation is allowed while access remains active', h => {
    setup(h, 'web-response', { access: 'active' }); h.send(begin('call', 'cancel', [ref()], 'root', 'cleanup'));
    h.send(complete([result('unknown', ref(), { access: 'active' })]));
    assert.equal(h.finish().resources[0].access, 'active');
  });
  test('Read and EOF leave host ownership intact', h => {
    setup(h); h.send(begin('call', 'read')); h.send(complete([result('retained')]));
    h.send(begin('second', 'read')); h.send(complete([result('retained')], { id: 'second' }));
    assert.equal(h.finish().resources[0].state, 'owned');
  });
  test('Repeated successful reads do not authorize retry after a read error', h => {
    setup(h); h.send(begin('call', 'read'));
    h.send(complete([result('retained', ref(), { basis: 'fixture-host-observation' })], { status: 'error' }));
    h.reject(begin('retry', 'read'), 'RETRY');
    h.send(begin('cleanup', 'close', [ref()], 'root', 'cleanup')); h.send(complete([result()], { id: 'cleanup' }));
  });
  test('Result ownership cannot manufacture a new operation child', h => {
    setup(h); h.send(own('result', 'root', 'result')); h.reject(own('hidden-child', 'result'), 'OWNER_KIND');
  });
  test('Binding identity remains linked through child ownership handoff', h => {
    setup(h); h.send(own('child', 'root'));
    const binding = h.finish().resources[0].binding;
    h.send({ type: 'handoff', actor: 'root', to: 'child', ref: ref() });
    assert.deepEqual(h.finish().resources[0].binding, binding);
  });
  test('Acquisition without a static capability binding is rejected', h => {
    h.send(own()); h.reject(acquire(item(0, 'reader', 'root', { binding: null })), 'BINDING');
  });
  test('Failure cleanup can continue for independent resources', h => {
    setup(h); h.send(acquire(item(1, 'cache'))); h.send(begin()); h.send(complete([result('unknown')], { status: 'error' }));
    h.send({ ...begin('cache', 'close', [ref(1)], 'root', 'cleanup'), ready: true });
    h.send(complete([result('released', ref(1))], { id: 'cache' }));
    assert.deepEqual(h.finish().resources.map(r => r.state), ['unresolved', 'released']);
  });
  test('Whole-request timeout pending resource remains visible without a retirement list', h => {
    setup(h, 'pending'); h.send({ type: 'stop', actor: 'root' }); h.send({ type: 'end', reason: 'return' });
    assert.equal(h.finish().resources[0].state, 'unresolved'); assert.equal(h.finish().resources[0].disposition, 'retained');
  });
  test('Trap records uncertain in-flight consumption; no guest cleanup follows', h => {
    setup(h, 'writer'); h.send(begin('call', 'commit')); h.send({ type: 'end', reason: 'trap' });
    assert.equal(h.finish().resources[0].disposition, 'unknown');
    h.reject(complete([result('consumed')], { acceptance: 'accepted' }), 'EXECUTION_ENDED');
    h.reject(begin('cleanup', 'abandon', [ref()], 'root', 'cleanup'), 'EXECUTION_ENDED');
  });
  test('Return does not manufacture teardown release or drop unresolved records', h => {
    setup(h); h.send({ type: 'end', reason: 'return' }); assert.equal(h.finish().resources[0].state, 'unresolved');
  });
  test('Resource evidence omits raw payloads, namespaces and capacities', h => {
    setup(h, 'reader', { payload: 'private-host-identity' }); const text = JSON.stringify(h.finish());
    assert(!text.includes('private-host-identity')); assert(!text.includes('fastly.body')); assert(!text.includes('refund'));
  });
  // Enumerate every action/result disposition, including invalid alternatives.
  let transitions = 0;
  for (const [action, spec] of Object.entries(contract.actions)) for (const status of ['ok', 'error']) {
    test('Disposition matrix: ' + action + ' / ' + status, h => {
      for (const disposition of contract.dispositions) {
        const x = harness(); setup(x, spec.kinds[0]); x.send(begin('call', action));
        const event = complete([result(disposition, ref(), { basis: 'fixture-host-observation', receiver: 'host' })],
          { status, acceptance: action === 'commit' ? (status === 'ok' ? 'accepted' : 'unknown') : 'not-applicable' });
        if (spec[status === 'ok' ? 'success' : 'error'].includes(disposition)) x.send(event); else x.reject(event, 'DISPOSITION');
        h.trace.push({ matrixTrace: x.trace }); transitions++;
      }
    });
  }
  receipt.matrixTransitions = transitions;
  receipt.status = 'passed';
} catch (error) { receipt.status = 'failed'; receipt.error = error.stack; process.exitCode = 1; }
finally {
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: receipt.status, cases: receipt.cases.length, matrixTransitions: receipt.matrixTransitions, output, error: receipt.error }));
}
