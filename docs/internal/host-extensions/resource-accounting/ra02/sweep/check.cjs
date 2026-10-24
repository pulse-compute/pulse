'use strict';
// Synthetic lifecycle pressure against the unchanged RA-02 oracle; no host work.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const M = require('../model.cjs');
const policy = require('../policy.json');
const D = policy.dimensions;
const v = (handles = 0, bytes = 0, records = 0) => ({ handles, bytes, records });
const add = (a, b) => Object.fromEntries(D.map(d => [d, a[d] + b[d]]));
const mul = (a, n) => Object.fromEntries(D.map(d => [d, a[d] * n]));
const sub = (a, b) => Object.fromEntries(D.map(d => [d, a[d] - b[d]]));
const max = (a, b) => Object.fromEntries(D.map(d => [d, Math.max(a[d], b[d])]));
const sum = xs => xs.reduce(add, v());
const work = v(3, 192, 4), cleanup = v(2, 64, 2), exit = v(2, 64, 2);
const binding = { capability: 'fixture.cache-fetch', service: 'fixture.service', useSite: 'fixture.sweep', implementation: 'fixture.v0' };
const profile = { version: policy.version, id: 'recipe', binding, coverage: 'complete-for-accounted-domain', work, cleanup, effects: 4, exclusive: [] };
const demand = n => add(exit, mul(add(work, cleanup), n));
const names = (n, prefix = 'r') => Array.from({ length: n }, (_, i) => prefix + i);
const ref = slot => ({ execution: 'execution-1', slot, generation: 1 });
const resource = (root, slot, extra = {}) => ({ ref: ref(slot), root, owner: root, state: 'owned', disposition: 'retained', access: 'quiescent', binding, ...extra });
const base = path.resolve(__dirname, '../../../../../..');
const git = (...args) => execFileSync('git', args, { cwd: base, encoding: 'utf8' }).trim();
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const inputs = ['check.cjs', '../model.cjs', '../policy.json'].map(file => ({ file, sha256: hash(fs.readFileSync(path.join(__dirname, file))) }));
const receipt = { version: 'hex.ra02-sweep.v1', status: 'running', revision: git('rev-parse', 'HEAD'), workingTree: git('status', '--porcelain'), node: process.version,
  inputs, scope: 'Synthetic oracle traces, not runtime memory/CPU or host qualification', work, cleanup, exit, widths: [8, 16, 32], cases: [] };

function harness(n, capacity = demand(n), effectsLimit = 1024) {
  let state = M.initial({ profile: 'fixture-qualified-v0', capacity, baseline: v(), exit, effectsLimit });
  const trace = [], checkpoints = [];
  let peakCharged = v(), peakCleanupLane = v(), peakCommitted = v();
  function snapshot() {
    const s = M.summary(state);
    const charged = sum([...s.charges.map(c => c.remaining), ...Object.values(state.exitClaims)]);
    const cleanupLane = sum(Object.values(state.claims).filter(c => c.lane === 'cleanup').map(c => c.remaining));
    peakCharged = max(peakCharged, charged); peakCleanupLane = max(peakCleanupLane, cleanupLane); peakCommitted = max(peakCommitted, s.committed);
    for (const d of D) assert.ok(charged[d] <= s.committed[d] && s.committed[d] <= capacity[d]);
    return { committed: s.committed, charged, cleanupLane, carry: s.carry, carryCleanupReserve: s.carryCleanupReserve, usedEffects: s.usedEffects, promisedEffects: s.promisedEffects };
  }
  return {
    send(event) { state = M.step(state, event); trace.push({ event, after: snapshot() }); },
    reject(event, code) {
      const before = JSON.stringify(state);
      assert.throws(() => M.step(state, event), e => e.code === 'RA02_' + code);
      assert.equal(JSON.stringify(state), before);
      trace.push({ event, rejection: code, after: snapshot() });
    },
    capture(ids) { ids.forEach(root => this.send({ type: 'capture', root })); },
    admit(ids) { this.capture(ids); this.send({ type: 'admit', fresh: true, members: ids.map(root => ({ root, profile })) }); },
    acquire(root, slot, charge, lane = 'work') { this.send({ type: 'acquire', root, resource: resource(root, slot), charge, lane, ...(lane === 'cleanup' ? { authority: 'fixture-cleanup-owner' } : {}) }); },
    release(root, slot, amount) {
      this.send({ type: 'observe', resource: resource(root, slot, { state: 'released', disposition: 'released' }) });
      this.send({ type: 'refund', ref: ref(slot), amount, proof: 'released-quiescent' });
    },
    unknown(root, slot) { this.send({ type: 'observe', resource: resource(root, slot, { state: 'unresolved', disposition: 'unknown', access: 'unknown' }) }); },
    child(root, id) { this.send({ type: 'ticket', root, id }); this.send({ type: 'settle-child', root, id }); },
    finish(ids) { ids.forEach(root => this.send({ type: 'finish', root, settled: true })); },
    checkpoint(name) { const row = { name, ...snapshot() }; checkpoints.push(row); return row; },
    get state() { return state; },
    result() { return { peakCommitted, peakCharged, peakCleanupLane, minimumUnusedCleanupAllowance: sub(mul(cleanup, n), peakCleanupLane), checkpoints, trace }; }
  };
}

function run(n, scenario) {
  const h = harness(n), ids = names(n), light = scenario === 'hit' || scenario === 'retained-result';
  const costs = [v(1, 64, 1), v(1, 64, 1), v(1, 64, 2)];
  h.admit(ids);
  assert.deepEqual(h.checkpoint('admitted').committed, demand(n));
  for (let i = 0; i < n; i++) {
    h.child(ids[i], 'lookup');
    if (!light) { h.child(ids[i], 'fetch'); h.child(ids[i], 'store'); }
    for (let j = 0; j < (light ? 1 : 3); j++) h.acquire(ids[i], i * 10 + j, costs[j]);
  }
  // Charge the declared exit strategy as well, so peak usage and reservation
  // share the same domain. This is chosen overlap, not observed host timing.
  h.send({ type: 'exit-acquire', id: 'terminal', charge: exit, authority: 'fixture-execution-owner' });
  const workPeak = h.checkpoint('work-peak');
  assert.deepEqual(workPeak.charged, add(exit, mul(light ? costs[0] : work, n)));
  const hasCleanup = ['cancellation', 'failed-disposal', 'mixed'].includes(scenario);
  if (scenario === 'cancellation') {
    h.send({ type: 'stop' });
    h.reject({ type: 'acquire', root: ids[0], resource: resource(ids[0], 9), charge: costs[0], lane: 'work' }, 'STOPPED');
  }
  if (hasCleanup) {
    for (let i = 0; i < n; i++) h.acquire(ids[i], i * 10 + 3, cleanup, 'cleanup');
    assert.deepEqual(h.checkpoint('cleanup-overlap').charged, demand(n));
    for (let i = 0; i < n; i++) h.release(ids[i], i * 10 + 3, cleanup);
  }
  let unresolved = 0;
  for (let i = 0; i < n; i++) {
    const failed = scenario === 'failed-disposal' || (scenario === 'mixed' && i % 2 === 0);
    if (failed) {
      unresolved++; h.unknown(ids[i], i * 10);
      h.reject({ type: 'refund', ref: ref(i * 10), amount: costs[0], proof: 'released-quiescent' }, 'NO_RELEASE_EVIDENCE');
    } else if (scenario !== 'retained-result') h.release(ids[i], i * 10, costs[0]);
    if (!light) for (let j = 1; j < 3; j++) h.release(ids[i], i * 10 + j, costs[j]);
  }
  h.finish(ids);
  const retained = scenario === 'retained-result' ? n : unresolved;
  const settled = h.checkpoint('settled');
  assert.deepEqual(settled.carry, mul(costs[0], retained));
  assert.deepEqual(settled.carryCleanupReserve, mul(cleanup, retained));
  assert.deepEqual(settled.committed, add(exit, mul(add(costs[0], cleanup), retained)));
  assert.equal(settled.promisedEffects, 0);
  assert.equal(settled.usedEffects, n * (light ? 2 : 4));
  if (retained) {
    // Same-width subsequent group cannot fit in the exact original capacity.
    // Rejection is atomic and captured admissions stay spent. No hidden retry.
    const next = names(n, 'next'); h.capture(next);
    h.reject({ type: 'admit', fresh: true, members: next.map(root => ({ root, profile })) }, 'RESOURCE_CAPACITY');
    h.send({ type: 'deny', roots: next });
    assert.deepEqual(h.checkpoint('next-cohort-rejected').committed, settled.committed);
  }
  if (scenario === 'retained-result') {
    for (let i = 0; i < n; i++) h.acquire(ids[i], i * 10 + 3, cleanup, 'cleanup');
    assert.deepEqual(h.checkpoint('late-cleanup').carryCleanupReserve, v());
    for (let i = 0; i < n; i++) { h.release(ids[i], i * 10 + 3, cleanup); h.release(ids[i], i * 10, costs[0]); }
    assert.deepEqual(h.checkpoint('after-late-cleanup').committed, exit);
    // A distinct explicit cohort can now fit; never resurrect rejected roots.
    const fresh = names(n, 'fresh'); h.admit(fresh); h.finish(fresh);
    assert.deepEqual(h.checkpoint('fresh-cohort-finished').committed, exit);
  }
  const beforeEnd = h.checkpoint('before-end'); h.send({ type: 'end' });
  assert.deepEqual(h.checkpoint('ended').committed, beforeEnd.committed);
  const result = h.result();
  const expectedPeak = hasCleanup ? demand(n) : add(exit, mul(scenario === 'hit' ? costs[0] : scenario === 'retained-result' ? add(costs[0], cleanup) : work, n));
  assert.deepEqual(result.peakCharged, expectedPeak);
  assert.deepEqual(result.peakCleanupLane, hasCleanup || scenario === 'retained-result' ? mul(cleanup, n) : v());
  assert.deepEqual(result.peakCommitted, demand(n));
  return { width: n, scenario, status: 'passed', ...result };
}

try {
  for (const n of receipt.widths) {
    for (const scenario of ['hit', 'miss', 'cancellation', 'failed-disposal', 'retained-result', 'mixed']) receipt.cases.push(run(n, scenario));
    {
      const h = harness(n, demand(n), 4 * n), ids = names(n);
      h.admit(ids);
      const admitted = h.checkpoint('exact-effects-admitted');
      assert.equal(admitted.usedEffects + admitted.promisedEffects, 4 * n);
      for (const root of ids) for (const id of ['lookup', 'fetch', 'store']) h.child(root, id);
      h.finish(ids);
      const final = h.checkpoint('exact-effects-spent');
      assert.equal(final.usedEffects, 4 * n); assert.equal(final.promisedEffects, 0);
      assert.deepEqual(final.committed, exit);
      receipt.cases.push({ width: n, scenario: 'exact-effects', status: 'passed', ...h.result() });
    }
    for (const dimension of [...D, 'effects']) {
      const capacity = demand(n); if (dimension !== 'effects') capacity[dimension]--;
      const h = harness(n, capacity, dimension === 'effects' ? 4 * n - 1 : 1024), ids = names(n);
      h.capture(ids);
      h.reject({ type: 'admit', fresh: true, members: ids.map(root => ({ root, profile })) }, dimension === 'effects' ? 'EFFECT_CAPACITY' : 'RESOURCE_CAPACITY');
      h.send({ type: 'deny', roots: ids });
      const final = h.checkpoint('denied');
      assert.deepEqual(final.committed, exit); assert.deepEqual(final.charged, v());
      assert.equal(final.usedEffects, n); assert.equal(final.promisedEffects, 0);
      assert.equal(Object.keys(h.state.roots).length, 0);
      receipt.cases.push({ width: n, scenario: 'one-below-' + dimension, status: 'passed', ...h.result() });
    }
  }
  receipt.status = 'passed';
} catch (error) { receipt.status = 'failed'; receipt.error = error.stack; process.exitCode = 1; }
const output = path.resolve(process.argv[2] || '/tmp/hex-ra02-sweep.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ status: receipt.status, cases: receipt.cases.length, output, error: receipt.error }));
