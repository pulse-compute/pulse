'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const M = require('./model.cjs'), O = require('../ra01/model.cjs');
const policy = require('./policy.json');
const rootPath = path.resolve(__dirname, '../../../../..');
const output = path.resolve(process.argv[2] || '/tmp/hex-ra02-receipt.json');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (...a) => execFileSync('git', a, { cwd: rootPath, encoding: 'utf8' }).trim();
const v = (handles = 0, bytes = 0, records = 0) => ({ handles, bytes, records });
const config = extra => ({ profile: 'fixture-qualified-v0', capacity: v(20, 1024, 20), baseline: v(), exit: v(2, 32, 2), effectsLimit: 1024, ...extra });
const binding = { capability: 'fixture.cache-fetch', service: 'fixture.service', useSite: 'fixture.site', implementation: 'fixture.v0' };
const profile = extra => ({ version: policy.version, id: 'recipe', binding, coverage: 'complete-for-accounted-domain', work: v(2, 64, 2), cleanup: v(1, 0, 1), effects: 4, exclusive: [], ...extra });
const ref = (slot = 0) => ({ execution: 'execution-1', slot, generation: 1 });
const resource = (slot = 0, root = 'a', extra = {}) => ({ ref: ref(slot), root, owner: root, state: 'owned', disposition: 'retained', access: 'quiescent', binding, ...extra });
const acquire = (slot = 0, charge = v(1, 0, 1), extra = {}) => ({ type: 'acquire', root: 'a', lane: 'work', charge, resource: resource(slot), ...extra });
const observe = (slot, disposition, extra = {}) => ({ type: 'observe', resource: resource(slot, 'a', { state: disposition === 'unknown' ? 'unresolved' : disposition, disposition, ...extra }) });
const refund = (slot = 0, amount = v(1, 0, 1), proof = 'released-quiescent', extra = {}) => ({ type: 'refund', ref: ref(slot), amount, proof, ...extra });
const finish = (root = 'a') => ({ type: 'finish', root, settled: true });
function harness(c = config()) {
  let state = M.initial(c); const trace = [];
  return {
    send(e) { state = M.step(state, e); trace.push(e); },
    reject(e, code) { const before = JSON.stringify(state); assert.throws(() => M.step(state, e), x => x.code === 'RA02_' + code); assert.equal(JSON.stringify(state), before); trace.push({ rejected: e, code }); },
    admit(names = ['a'], p = profile()) { for (const root of names) this.send({ type: 'capture', root }); this.send({ type: 'admit', fresh: true, members: names.map(root => ({ root, profile: p })) }); },
    get state() { return state; }, get trace() { return trace; }, summary() { return M.summary(state); }
  };
}
const receipt = { version: 'hex.ra02-checks.v0', status: 'running', revision: git('rev-parse', 'HEAD'), workingTree: git('status', '--porcelain'), node: process.version,
  inputs: ['policy.json', 'model.cjs', 'check.cjs', 'README.md', '../ra01/model.cjs', '../ra01/contract.json'].map(file => ({ file, sha256: hash(path.join(__dirname, file)) })), cases: [], comparisons: [] };
function test(name, fn, c) {
  const h = harness(c);
  try { fn(h); receipt.cases.push({ name, status: 'passed', trace: h.trace, summary: h.summary() }); }
  catch (e) { receipt.cases.push({ name, status: 'failed', trace: h.trace, error: e.stack }); throw e; }
}
try {
  test('Direct root reserves work and cleanup without double counting charges', h => {
    h.admit(); assert.deepEqual(h.summary().committed, v(5, 96, 5)); h.send(acquire()); assert.deepEqual(h.summary().committed, v(5, 96, 5));
    assert.equal(h.summary().usedEffects, 1); assert.equal(h.summary().promisedEffects, 3);
  });
  test('Failed cohort reserves no resources; existing root admissions remain spent', h => {
    h.send({ type: 'capture', root: 'a' }); h.send({ type: 'capture', root: 'b' });
    h.reject({ type: 'admit', fresh: true, members: ['a', 'b'].map(root => ({ root, profile: profile() })) }, 'RESOURCE_CAPACITY');
    assert.equal(Object.keys(h.state.roots).length, 0); assert.equal(h.summary().usedEffects, 2); assert.deepEqual(h.summary().committed, v(2, 32, 2));
  }, config({ capacity: v(7, 1024, 20) }));
  for (const dimension of ['handles', 'bytes', 'records']) test('Independent exhaustion: ' + dimension, h => {
    h.send({ type: 'capture', root: 'a' }); const p = profile(); p.work[dimension] = 2000;
    h.reject({ type: 'admit', fresh: true, members: [{ root: 'a', profile: p }] }, 'RESOURCE_CAPACITY');
  });
  test('Unstarted keyed cohort and builder membership use the same reservation', h => {
    h.admit(['a', 'b']); assert.deepEqual(h.summary().committed, v(8, 160, 8)); assert.equal(h.summary().promisedEffects, 6);
  });
  test('Already-started effects cannot acquire retroactive atomic cohort semantics', h => {
    h.send({ type: 'capture', root: 'a' }); h.reject({ type: 'admit', fresh: false, members: [{ root: 'a', profile: profile() }] }, 'ADMISSION_BOUNDARY');
  });
  test('Empty collection acquires no root resources or tickets', h => {
    const before = h.summary(); h.send({ type: 'admit', fresh: true, members: [] }); assert.deepEqual(h.summary(), before);
  });
  test('Duplicate group member is rejected without partial reservation', h => {
    h.send({ type: 'capture', root: 'a' }); h.reject({ type: 'admit', fresh: true, members: [{ root: 'a', profile: profile() }, { root: 'a', profile: profile() }] }, 'CAPTURE');
  });
  test('A root cannot reserve its envelope twice', h => {
    h.admit(); h.reject({ type: 'admit', fresh: true, members: [{ root: 'a', profile: profile() }] }, 'CAPTURE');
  });
  test('Missing provider profile and impossible execution exit reserve reject', h => {
    assert.throws(() => M.initial({ ...config(), profile: undefined }), e => e.code === 'RA02_PROFILE');
    assert.throws(() => M.initial(config({ capacity: v(1, 32, 2) })), e => e.code === 'RA02_EXECUTION_RESERVE');
    assert.equal(h.summary().usedEffects, 0);
  });
  for (const bad of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null]) test('Invalid finite bound rejects: ' + String(bad), h => {
    h.send({ type: 'capture', root: 'a' }); const p = profile(); p.work.bytes = bad;
    h.reject({ type: 'admit', fresh: true, members: [{ root: 'a', profile: p }] }, 'BOUND');
  });
  test('Missing dimensions and unknown protocol do not get permissive defaults', h => {
    h.send({ type: 'capture', root: 'a' }); h.reject({ type: 'admit', fresh: true, members: [{ root: 'a', profile: profile({ version: 'future' }) }] }, 'PROTOCOL');
    h.reject({ type: 'admit', fresh: true, members: [{ root: 'a', profile: profile({ work: { handles: 1 } }) }] }, 'DIMENSIONS');
  });
  test('Unsafe integer sum rejects before overcommitting', h => {
    h.send({ type: 'capture', root: 'a' }); h.reject({ type: 'admit', fresh: true, members: [{ root: 'a', profile: profile({ work: v(Number.MAX_SAFE_INTEGER, 0, 0) }) }] }, 'BOUND');
  });
  test('Normal work cannot spend protected cleanup credit', h => {
    h.admit(); h.send(acquire(0, v(2, 64, 2))); h.reject(acquire(1), 'WORK_ENVELOPE');
    h.send(acquire(1, v(1, 0, 1), { lane: 'cleanup', authority: 'fixture-cleanup-owner' }));
    assert.deepEqual(h.summary().committed, v(5, 96, 5));
  });
  test('Cleanup lane requires private provider authority', h => {
    h.admit(); h.reject(acquire(0, v(1, 0, 1), { lane: 'cleanup' }), 'CLEANUP_AUTHORITY');
  });
  test('Cleanup may use unused work headroom but cannot exceed the root envelope', h => {
    h.admit(); h.send({ type: 'stop', root: 'a' }); h.send(acquire(0, v(3, 64, 3), { lane: 'cleanup', authority: 'fixture-cleanup-owner' }));
    h.reject(acquire(1, v(1, 0, 1), { lane: 'cleanup', authority: 'fixture-cleanup-owner' }), 'ROOT_ENVELOPE');
  });
  test('A root cannot steal unused reservation from its sibling', h => {
    h.admit(['a', 'b']); h.reject(acquire(0, v(3, 0, 1)), 'WORK_ENVELOPE');
  });
  test('Whole execution stop prevents captures and business acquisitions, permits cleanup', h => {
    h.admit(); h.send({ type: 'stop' }); h.reject({ type: 'capture', root: 'b' }, 'CAPTURE'); h.reject(acquire(), 'STOPPED');
    h.send(acquire(0, v(1, 0, 1), { lane: 'cleanup', authority: 'fixture-cleanup-owner' }));
  });
  test('Child admissions spend existing promised effects rather than a new budget', h => {
    h.admit(); for (let n = 0; n < 3; n++) { h.send({ type: 'ticket', root: 'a', id: 'child' + n }); h.send({ type: 'settle-child', root: 'a', id: 'child' + n }); }
    assert.equal(h.summary().usedEffects, 4); assert.equal(h.summary().promisedEffects, 0);
    h.reject({ type: 'ticket', root: 'a', id: 'extra' }, 'CHILD_BUDGET'); h.send(finish()); assert.equal(h.summary().usedEffects, 4);
  });
  test('Skipped children release promises, not already-spent effects', h => {
    h.admit(); h.send({ type: 'ticket', root: 'a', id: 'lookup' }); h.send({ type: 'settle-child', root: 'a', id: 'lookup' }); h.send(finish());
    assert.equal(h.summary().usedEffects, 2); assert.equal(h.summary().promisedEffects, 0);
  });
  test('Other captures cannot steal effect capacity promised to children', h => {
    h.admit(); h.reject({ type: 'capture', root: 'b' }, 'EFFECT_CAPACITY'); h.send({ type: 'ticket', root: 'a', id: 'lookup' }); assert.equal(h.summary().usedEffects, 2);
  }, config({ effectsLimit: 4 }));
  test('Insufficient future-effect capacity rejects before root resource acquisition', h => {
    h.send({ type: 'capture', root: 'a' }); h.reject({ type: 'admit', fresh: true, members: [{ root: 'a', profile: profile() }] }, 'EFFECT_CAPACITY');
  }, config({ effectsLimit: 3 }));
  test('Parent completion cannot release reservations while a child is live', h => {
    h.admit(); h.send({ type: 'ticket', root: 'a', id: 'lookup' }); h.reject(finish(), 'CHILD_LIVE');
    h.send({ type: 'stop', root: 'a' }); h.reject({ type: 'ticket', root: 'a', id: 'fetch' }, 'STOPPED');
    h.send({ type: 'settle-child', root: 'a', id: 'lookup' }); h.send(finish());
  });
  test('Consumed admission is not refunded when host work never starts', h => {
    h.admit(); h.send({ type: 'stop', root: 'a' }); h.send(finish()); assert.equal(h.summary().usedEffects, 1);
  });
  test('Two members requiring one exclusive binding fail as a cohort', h => {
    for (const root of ['a', 'b']) h.send({ type: 'capture', root });
    const p = profile({ exclusive: ['bus.main'] }); h.reject({ type: 'admit', fresh: true, members: ['a', 'b'].map(root => ({ root, profile: p })) }, 'EXCLUSIVE_CONFLICT');
    assert.deepEqual(h.summary().exclusive, []);
  });
  test('Distinct exclusive bindings can admit concurrently', h => {
    for (const root of ['a', 'b']) h.send({ type: 'capture', root });
    h.send({ type: 'admit', fresh: true, members: ['a', 'b'].map(root => ({ root, profile: profile({ exclusive: ['bus.' + root] }) })) });
    assert.deepEqual(h.summary().exclusive, ['bus.a', 'bus.b']);
  });
  test('Unacquired exclusive promise releases when operation finishes', h => {
    h.admit(['a'], profile({ exclusive: ['bus.main'] })); h.send(finish()); assert.deepEqual(h.summary().exclusive, []);
  });
  test('Unresolved exclusive lease survives effect completion and blocks next operation', h => {
    const p = profile({ exclusive: ['bus.main'] }); h.admit(['a'], p); h.send(acquire(0, v(0, 0, 1), { exclusive: 'bus.main' }));
    h.send(observe(0, 'unknown', { access: 'active' })); h.send(finish());
    h.send({ type: 'capture', root: 'b' }); h.reject({ type: 'admit', fresh: true, members: [{ root: 'b', profile: p }] }, 'EXCLUSIVE_CONFLICT');
  });
  test('Exclusive release requires both qualified disposition and quiescence', h => {
    h.admit(['a'], profile({ exclusive: ['bus.main'] })); h.send(acquire(0, v(0, 0, 1), { exclusive: 'bus.main' }));
    h.send(observe(0, 'released', { access: 'active' })); h.reject(refund(0, v(0, 0, 1), 'released-quiescent', { releaseExclusive: true }), 'QUIESCENCE');
    h.send(observe(0, 'released')); h.send(refund(0, v(0, 0, 1), 'released-quiescent', { releaseExclusive: true }));
    // Promise remains until root finish, even though its lease was released.
    assert.deepEqual(h.summary().exclusive, ['bus.main']); h.send(finish()); assert.deepEqual(h.summary().exclusive, []);
  });
  test('Undeclared and duplicate exclusive acquisition fail', h => {
    h.admit(['a'], profile({ exclusive: ['bus.main'] })); h.reject(acquire(0, v(0, 0, 1), { exclusive: 'bus.other' }), 'UNDECLARED_EXCLUSIVE');
    h.send(acquire(0, v(0, 0, 1), { exclusive: 'bus.main' })); h.reject(acquire(1, v(0, 0, 1), { exclusive: 'bus.main' }), 'DUPLICATE_EXCLUSIVE');
  });
  for (const state of ['owned', 'busy', 'unresolved']) test('No refund from ' + state + ' ownership', h => {
    h.admit(); h.send(acquire());
    if (state !== 'owned') h.send(observe(0, state === 'unresolved' ? 'unknown' : 'retained', { state }));
    h.reject(refund(), 'NO_RELEASE_EVIDENCE');
  });
  test('Released capacity still requires a qualified dimension proof', h => {
    h.admit(); h.send(acquire()); h.send(observe(0, 'released')); h.reject(refund(0, v(1, 0, 1), 'guess'), 'PROOF');
    h.send(refund()); h.reject(refund(), 'DOUBLE_REFUND');
  });
  test('Consumption can return logical handle capacity without freeing bytes or records', h => {
    h.admit(); h.send(acquire(0, v(1, 64, 1))); h.send(observe(0, 'consumed', { access: 'active' }));
    h.reject(refund(0, v(1, 64, 0), 'consumed-handle'), 'PROOF_DIMENSION');
    h.send(refund(0, v(1, 0, 0), 'consumed-handle')); h.reject(refund(0, v(0, 0, 1), 'consumed-record'), 'QUIESCENCE');
    h.send(finish()); assert.deepEqual(h.summary().carry, v(0, 64, 1));
  });
  test('Transfer outside the handle accounting domain does not refund guest bytes', h => {
    h.admit(); h.send(acquire(0, v(1, 64, 1))); h.send(observe(0, 'transferred', { access: 'active' }));
    h.send(refund(0, v(1, 0, 0), 'transferred-handle')); h.reject(refund(0, v(0, 64, 0), 'transferred-handle'), 'PROOF_DIMENSION');
    h.send(finish()); assert.equal(h.summary().carry.bytes, 64);
  });
  test('Failed commit acceptance does not change refund rules', h => {
    h.admit(); h.send(acquire()); h.send(observe(0, 'unknown', { acceptance: 'accepted' })); h.reject(refund(), 'NO_RELEASE_EVIDENCE');
    h.send(finish()); assert.deepEqual(h.summary().carry, v(1, 0, 1));
  });
  test('Unknown disposition cannot be rewritten into a refund in v0', h => {
    h.admit(); h.send(acquire()); h.send(observe(0, 'unknown')); h.reject(observe(0, 'released'), 'RESURRECTION');
  });
  test('Resource handoff preserves capacity and original operation attribution', h => {
    h.admit(); h.send(acquire()); const before = h.summary().committed;
    h.send({ type: 'observe', resource: resource(0, 'a', { owner: 'child' }) }); assert.deepEqual(h.summary().committed, before);
    h.reject({ type: 'observe', resource: resource(0, 'b') }, 'ATTRIBUTION');
  });
  test('Binding identity cannot change to conceal a resource charge', h => {
    h.admit(); h.send(acquire()); h.reject({ type: 'observe', resource: resource(0, 'a', { binding: { ...binding, useSite: 'other' } }) }, 'ATTRIBUTION');
    h.reject(acquire(), 'DUPLICATE_CLAIM');
  });
  test('Released credit is reusable inside root but not lent to new siblings', h => {
    h.admit(); h.send(acquire()); const before = h.summary().committed;
    h.send(observe(0, 'released')); h.send(refund()); assert.deepEqual(h.summary().committed, before);
    h.send(acquire(1, v(2, 64, 2))); h.send(finish()); assert.deepEqual(h.summary().carry, v(2, 64, 2));
  });
  test('Surviving result charges and cleanup headroom outlive effect settlement', h => {
    h.admit(); h.send(acquire()); h.send(finish());
    assert.deepEqual(h.summary().carry, v(1, 0, 1)); assert.deepEqual(h.summary().carryCleanupReserve, v(1, 0, 1));
    h.reject(acquire(1), 'STOPPED'); h.send(acquire(1, v(1, 0, 1), { lane: 'cleanup', authority: 'fixture-cleanup-owner' }));
    assert.deepEqual(h.summary().carryCleanupReserve, v()); h.reject(acquire(2, v(1, 0, 1), { lane: 'cleanup', authority: 'fixture-cleanup-owner' }), 'TAIL_ENVELOPE');
  });
  test('Final cleanup releases remaining charge and its now-unused tail reserve', h => {
    h.admit(); h.send(acquire()); h.send(finish()); h.send(observe(0, 'released')); h.send(refund());
    assert.deepEqual(h.summary().committed, v(2, 32, 2)); assert.deepEqual(h.summary().carryCleanupReserve, v());
  });
  test('Late cleanup can reuse proven released headroom within its original bound', h => {
    h.admit(); h.send(acquire()); h.send(finish()); h.send(acquire(1, v(1, 0, 1), { lane: 'cleanup', authority: 'fixture-cleanup-owner' }));
    h.send(observe(1, 'released')); h.send(refund(1)); assert.deepEqual(h.summary().carryCleanupReserve, v(1, 0, 1));
    h.send(acquire(2, v(1, 0, 1), { lane: 'cleanup', authority: 'fixture-cleanup-owner' }));
  });
  test('Root finish cannot increase global reservation after cleanup uses work slack', h => {
    h.admit(); h.send(acquire(0, v(3, 64, 3), { lane: 'cleanup', authority: 'fixture-cleanup-owner' }));
    const before = h.summary().committed; h.send(finish()); assert.deepEqual(h.summary().committed, before);
  });
  test('Retained resources from earlier operations reduce next admission capacity', h => {
    h.admit(); h.send(acquire(0, v(2, 64, 2))); h.send(finish()); h.send({ type: 'capture', root: 'b' });
    h.reject({ type: 'admit', fresh: true, members: [{ root: 'b', profile: profile() }] }, 'RESOURCE_CAPACITY');
  }, config({ capacity: v(7, 1024, 20) }));
  test('Known release allows a later independent operation to admit', h => {
    h.admit(); h.send(acquire()); h.send(finish()); h.send(observe(0, 'released')); h.send(refund()); h.admit(['b']);
    assert.equal(Object.keys(h.state.roots).length, 2);
  }, config({ capacity: v(5, 1024, 20) }));
  test('Execution exit reserve remains available under full work pressure', h => {
    h.admit(); h.send(acquire(0, v(2, 64, 2))); h.send({ type: 'exit-acquire', id: 'response', charge: v(2, 32, 2), authority: 'fixture-execution-owner' });
    h.reject({ type: 'exit-acquire', id: 'extra', charge: v(1, 0, 0), authority: 'fixture-execution-owner' }, 'EXIT_ENVELOPE');
  }, config({ capacity: v(5, 96, 5) }));
  test('Package work cannot impersonate execution exit ownership', h => {
    h.reject({ type: 'exit-acquire', id: 'response', charge: v(1, 0, 1) }, 'EXIT_AUTHORITY');
  });
  test('Baseline resources reduce capacity without being adopted by a package', h => {
    h.admit(); assert.deepEqual(h.summary().committed, v(7, 96, 7));
  }, config({ baseline: v(2, 0, 2) }));
  test('Trap/end does not refund charges or permit another action', h => {
    h.admit(); h.send(acquire()); const before = h.summary().committed; h.send({ type: 'end' });
    assert.deepEqual(h.summary().committed, before); h.reject(refund(), 'ENDED');
  });
  test('RA-01 failed-close trace feeds RA-02 without an optimistic refund', h => {
    let o = O.initial();
    for (const e of [
      { type: 'owner', id: 'a', kind: 'operation' },
      { type: 'adopt', resource: { ref: ref(), owner: 'a', namespace: 'body', payload: 0, kind: 'reader', access: 'quiescent', binding } },
      { type: 'begin', id: 'close', actor: 'a', mode: 'cleanup', inputs: [{ ref: ref(), action: 'close' }], outputKinds: [] },
      { type: 'complete', id: 'close', actor: 'a', status: 'error', acceptance: 'not-applicable', results: [{ ref: ref(), disposition: 'unknown', access: 'quiescent' }], outputs: [] }
    ]) o = O.step(o, e);
    h.admit(); h.send(acquire()); h.send({ type: 'observe', resource: O.summary(o).resources[0] }); h.reject(refund(), 'NO_RELEASE_EVIDENCE'); h.send(finish());
    assert.deepEqual(h.summary().carry, v(1, 0, 1));
  });
  test('RA-01 successful-close trace supports a qualified RA-02 refund', h => {
    let o = O.initial();
    for (const e of [
      { type: 'owner', id: 'a', kind: 'operation' },
      { type: 'adopt', resource: { ref: ref(), owner: 'a', namespace: 'body', payload: 0, kind: 'reader', access: 'quiescent', binding } },
      { type: 'begin', id: 'close', actor: 'a', mode: 'cleanup', inputs: [{ ref: ref(), action: 'close' }], outputKinds: [] },
      { type: 'complete', id: 'close', actor: 'a', status: 'ok', acceptance: 'not-applicable', results: [{ ref: ref(), disposition: 'released', access: 'quiescent' }], outputs: [] }
    ]) o = O.step(o, e);
    h.admit(); h.send(acquire()); h.send({ type: 'observe', resource: O.summary(o).resources[0] }); h.send(refund()); h.send(finish());
    assert.deepEqual(h.summary().carry, v());
  });
  // Numerical pressure is fixture policy arithmetic, not measured host capacity.
  for (const count of [0, 1, 2, 8]) {
    const p = profile({ work: v(3, 192, 4), cleanup: v(2, 64, 2) });
    const demand = v(2 + count * 5, 64 + count * 256, 2 + count * 6);
    test('Exact derived cohort boundary for ' + count + ' members', h => {
      h.admit(Array.from({ length: count }, (_, i) => 'r' + i), p); assert.deepEqual(h.summary().committed, demand);
      receipt.comparisons.push({ members: count, work: p.work, cleanup: p.cleanup, exit: v(2, 64, 2), totalReservation: demand, reservedEffects: count * 4 });
    }, config({ capacity: demand, exit: v(2, 64, 2) }));
    if (count) test('One handle below derived cohort boundary rejects ' + count + ' members', h => {
      const names = Array.from({ length: count }, (_, i) => 'r' + i); names.forEach(root => h.send({ type: 'capture', root }));
      h.reject({ type: 'admit', fresh: true, members: names.map(root => ({ root, profile: p })) }, 'RESOURCE_CAPACITY'); assert.equal(Object.keys(h.state.roots).length, 0);
    }, config({ capacity: { ...demand, handles: demand.handles - 1 }, exit: v(2, 64, 2) }));
  }
  test('First-fit admission order is explicit; no hidden fairness or rescheduling', h => {
    h.admit(['a']); h.send({ type: 'capture', root: 'b' }); h.reject({ type: 'admit', fresh: true, members: [{ root: 'b', profile: profile() }] }, 'RESOURCE_CAPACITY');
    h.send({ type: 'deny', roots: ['b'] }); h.send(finish());
    h.reject({ type: 'admit', fresh: true, members: [{ root: 'b', profile: profile() }] }, 'CAPTURE');
    h.admit(['c']); assert.equal(h.summary().usedEffects, 3);
  }, config({ capacity: v(5, 1024, 20) }));
  test('Every acquisition needs bounded bookkeeping before host entry', h => {
    h.admit(); h.reject(acquire(0, v(1, 0, 0)), 'RECORD_CHARGE');
  });
  test('Unknown mixed-operation demand cannot claim complete accounting', h => {
    h.send({ type: 'capture', root: 'a' });
    h.reject({ type: 'admit', fresh: true, members: [{ root: 'a', profile: profile({ coverage: 'partial' }) }] }, 'COVERAGE');
  });
  let refundDimensionChecks = 0;
  for (const [name, proof] of Object.entries(policy.fixtureProofs)) test('Qualified refund dimension matrix: ' + name, h => {
    for (const dimension of policy.dimensions) {
      const x = harness(); x.admit(); x.send(acquire(0, v(1, 1, 1))); x.send(observe(0, proof.dispositions[0]));
      const amount = v(); amount[dimension] = 1;
      if (proof.dimensions.includes(dimension)) x.send(refund(0, amount, name));
      else x.reject(refund(0, amount, name), 'PROOF_DIMENSION');
      h.trace.push({ dimension, trace: x.trace }); refundDimensionChecks++;
    }
  });
  receipt.refundDimensionChecks = refundDimensionChecks;
  receipt.status = 'passed';
} catch (e) { receipt.status = 'failed'; receipt.error = e.stack; process.exitCode = 1; }
finally { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify({ status: receipt.status, cases: receipt.cases.length, output, error: receipt.error })); }
