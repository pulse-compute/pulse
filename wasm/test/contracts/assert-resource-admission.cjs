#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { resourceAdmission: contract } = process.argv.includes('--installed')
  ? require('@pulse-compute/wasm-contracts/provider/toolchain')
  : require('../../packages/contracts/src/provider/toolchain.js');
let cases = 0;
function test(name, run) { run(); cases++; console.log(`ok - ${name}`); }
const clone = input => JSON.parse(JSON.stringify(input));
const zero = () => ({ handles: 0, backingBytes: 0, records: 0, cleanupSteps: 0, effects: 0 });
const reserve = () => ({ handles: [], allocations: [], records: 0, cleanupSteps: 0 });
const fixed = (id, bytes, copies = 1) => ({ id, kind: 'fixed', bytes, copies });
function fixture() {
  const fetch = {
    version: 'pulse.resource-profile.v1', owner: 'core.fetch', operation: 'fetch.text', realization: 'fixture.native', effects: 1,
    work: { handles: [{ namespace: 'http.request', count: 1 }, { namespace: 'http.body', count: 2 },
      { namespace: 'http.pending', count: 1 }, { namespace: 'http.response', count: 1 }],
    allocations: [fixed('request-encoding', 3, 2), { id: 'body-read', kind: 'chunked-text', maxBytes: 3, chunkBytes: 8 }], records: 1, cleanupSteps: 0 },
    cleanup: { handles: [], allocations: [fixed('cleanup-scratch', 8)], records: 0, cleanupSteps: 4 },
    exclusions: ['request-headers']
  };
  const lease = { ...clone(fetch), owner: 'fixture.lease', operation: 'lease',
    work: { handles: [{ namespace: 'lease', count: 1 }], allocations: [fixed('payload', 10, 2)], records: 0, cleanupSteps: 0 },
    cleanup: { handles: [], allocations: [fixed('scratch', 1)], records: 0, cleanupSteps: 1 }, exclusions: [] };
  return {
    version: 'pulse.resource-admission.v1', realization: 'fixture.native',
    selected: [{ site: 'fetch', count: 2, profile: fetch }, { site: 'lease', count: 1, profile: lease }],
    exit: { handles: [{ namespace: 'http.body', count: 1 }], allocations: [fixed('error-body', 16)], records: 0, cleanupSteps: 1 },
    occupied: zero(), limits: { handles: 12, backingBytes: 197, records: 23, cleanupSteps: 10, effects: 3 }
  };
}
function rejects(name, mutate) {
  test(name, () => { const input = fixture(); const replacement = mutate(input);
    assert.throws(() => contract.createPlan(replacement === undefined ? input : replacement), { code: 'PULSEWASM_RESOURCE_PROFILE_INVALID' }); });
}
test('heterogeneous cohort sums work, overlapping cleanup and one exit reserve', () => {
  const plan = contract.createPlan(fixture());
  assert.equal(plan.admitted, true);
  assert.deepEqual(plan.required, { handles: 12, backingBytes: 197, records: 23, cleanupSteps: 10, effects: 3 });
  assert.deepEqual(plan.partitions.work, { handles: 11, backingBytes: 164, records: 18, cleanupSteps: 0, effects: 3 });
  assert.deepEqual(plan.partitions.cleanup, { handles: 0, backingBytes: 17, records: 3, cleanupSteps: 9, effects: 0 });
  assert.deepEqual(plan.handlesByNamespace, [
    { namespace: 'http.body', count: 5 }, { namespace: 'http.pending', count: 2 },
    { namespace: 'http.request', count: 2 }, { namespace: 'http.response', count: 2 }, { namespace: 'lease', count: 1 }
  ]);
  assert.equal(plan.selected[0].profile.work.allocations[0].backingBytes, 66);
  assert.ok(plan.exclusions.includes('ledger-storage'));
  assert.ok(plan.exclusions.includes('request-headers'));
});
for (const dimension of ['handles', 'backingBytes', 'records', 'cleanupSteps', 'effects']) {
  test(`${dimension} shortage denies the entire selection without partial reservations`, () => {
    const input = fixture(), before = clone(input); input.limits[dimension]--;
    const plan = contract.createPlan(input);
    assert.equal(plan.admitted, false);
    assert.deepEqual(plan.shortages, [{ dimension, required: before.limits[dimension], occupied: 0, limit: input.limits[dimension], missing: 1 }]);
    assert.deepEqual(input.occupied, zero());
    assert.equal(plan.selected.length, 2);
  });
}
test('prior retained backing and unknown claims cannot disappear between sequential groups', () => {
  const input = fixture(); input.occupied = { handles: 1, backingBytes: 7, records: 2, cleanupSteps: 1, effects: 2 };
  const plan = contract.createPlan(input);
  assert.equal(plan.admitted, false);
  assert.deepEqual(plan.shortages.map(item => item.missing), [1, 7, 2, 1, 2]);
  for (const key of Object.keys(input.limits)) input.limits[key] += input.occupied[key];
  assert.equal(contract.createPlan(input).admitted, true);
});
test('metadata cannot erase already exhausted capacity even with no selected work', () => {
  const input = fixture(); input.selected = []; input.exit = reserve(); input.limits = zero(); input.occupied.effects = 1;
  assert.equal(contract.createPlan(input).admitted, false);
});
test('empty selection and exit need no accounting capacity', () => {
  const input = fixture(); input.selected = []; input.exit = reserve(); input.limits = zero();
  assert.deepEqual(contract.createPlan(input).required, zero());
});
test('fixed copies charge once per allocation family, never one record per byte', () => {
  const input = fixture(); input.selected = [input.selected[1]]; input.exit = reserve();
  assert.deepEqual(contract.createPlan(input).required, { handles: 1, backingBytes: 21, records: 3, cleanupSteps: 1, effects: 1 });
});
test('selected multiplicities 1/8/16/32 grow linearly and exit is reserved once', () => {
  for (const count of [1, 8, 16, 32]) {
    const input = fixture(); input.selected = [input.selected[1]]; input.selected[0].count = count;
    assert.deepEqual(contract.createPlan(input).required, { handles: count + 1, backingBytes: 21 * count + 16,
      records: 3 * count + 2, cleanupSteps: count + 1, effects: count });
  }
});
test('chunked reader envelope covers every small read partition and terminal allocation', () => {
  // Independent allocation oracle: enumerate all positive read lengths up to C.
  // One last chunk/slot is allocated on EOF, overflow or host failure.
  function worst(remaining, chunk, used = 0) {
    let maximum = chunk + 4;
    for (let read = 1; read <= Math.min(remaining, chunk); read++) {
      maximum = Math.max(maximum, chunk + 4 + 2 * read + 2 * (used + read) + worst(remaining - read, chunk, used + read));
    }
    return maximum;
  }
  for (let bound = 1; bound <= 8; bound++) for (const chunk of [1, 3, 16]) {
    const input = fixture(), allocation = input.selected[0].profile.work.allocations[1];
    allocation.maxBytes = bound; allocation.chunkBytes = chunk;
    const planned = contract.createPlan(input).selected[0].profile.work.allocations[0];
    assert.equal(planned.backingBytes, worst(bound, chunk));
  }
});
test('64KiB current reader model is expensive; a body limit is not its backing limit', () => {
  const input = fixture(), allocation = input.selected[0].profile.work.allocations[1];
  allocation.maxBytes = 65536; allocation.chunkBytes = 65536;
  const plan = contract.createPlan(input);
  assert.equal(plan.selected[0].profile.work.allocations[0].backingBytes, 8590458884);
  assert.equal(plan.admitted, false);
});
test('reordered input produces identical plan bytes and does not freeze caller data', () => {
  const input = fixture(), original = contract.createPlan(input);
  input.selected.reverse(); input.selected[1].profile.work.handles.reverse(); input.selected[1].profile.work.allocations.reverse();
  assert.equal(JSON.stringify(contract.createPlan(input)), JSON.stringify(original));
  function check(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(check); } }
  check(original); check(contract);
  assert.deepEqual(JSON.parse(JSON.stringify(original)), original);
  assert.equal(Object.isFrozen(input.selected), false);
  input.selected[0].profile.work.allocations[0].bytes = 100;
  assert.equal(original.selected[1].profile.work.allocations[0].bytes, 10);
});
test('identity and conservative disposition rules remain separate from HTTP authority', () => {
  assert.equal(contract.POLICY.identity, 'execution-namespace-slot-generation');
  assert.equal(contract.POLICY.generationExhaustion, 'reject-before-reuse-never-wrap');
  assert.equal(contract.POLICY.handleZero, 'valid-provider-value-not-an-empty-slot');
  assert.equal(contract.POLICY.unknownOutcome, 'retain-claims-no-retry-or-speculative-refund');
  assert.equal(contract.POLICY.admission, 'data-only-not-a-reservation-token');
});
rejects('version mismatch', x => { x.version = 'pulse.resource-admission.v0'; });
rejects('profile version mismatch', x => { x.selected[0].profile.version = 'old'; });
rejects('cross-realization profile', x => { x.selected[0].profile.realization = 'node.native'; });
rejects('duplicate site', x => { x.selected[1].site = 'fetch'; });
rejects('duplicate namespace in one reserve', x => { x.exit.handles.push(x.exit.handles[0]); });
rejects('duplicate allocation family', x => { x.exit.allocations.push(x.exit.allocations[0]); });
rejects('duplicate exclusion', x => { x.selected[0].profile.exclusions = ['x', 'x']; });
rejects('missing dimension is not zero', x => { delete x.limits.records; });
rejects('unmodelled dynamic allocation', x => { x.exit.allocations[0].kind = 'dynamic'; });
rejects('work cannot spend cleanup steps', x => { x.selected[0].profile.work.cleanupSteps = 1; });
rejects('zero body bound is unbounded, not free', x => { x.selected[0].profile.work.allocations[1].maxBytes = 0; });
rejects('no selected zero-width placeholder', x => { x.selected[0].count = 0; });
rejects('no zero effect budget for selected operation', x => { x.selected[0].profile.effects = 0; });
rejects('multiplication overflow', x => { x.exit.allocations[0].copies = Number.MAX_SAFE_INTEGER; });
rejects('addition overflow', x => { x.occupied.backingBytes = Number.MAX_SAFE_INTEGER; });
rejects('quadratic allocation overflow', x => { x.selected[0].profile.work.allocations[1].maxBytes = Number.MAX_SAFE_INTEGER; });
for (const value of [-1, 0.5, NaN, Infinity, '1', undefined, Number.MAX_SAFE_INTEGER + 1]) rejects(`invalid numeric quantity ${String(value)}`, x => { x.exit.records = value; });
rejects('executable dispatch field', x => { x.dispatch = () => assert.fail(); });
rejects('optimistic phase discount', x => { x.selected[0].profile.work.maximum = 1; });
rejects('sparse selection', x => { delete x.selected[0]; });
rejects('custom array prototype', x => { Object.setPrototypeOf(x.selected, { map() { assert.fail(); } }); });
rejects('record accessor never executes', x => { Object.defineProperty(x, 'realization', { get() { assert.fail('getter'); }, enumerable: true }); });
rejects('allocation kind accessor never executes', x => { Object.defineProperty(x.exit.allocations[0], 'kind', { get() { assert.fail('getter'); }, enumerable: true }); });
rejects('array accessor never executes', x => { Object.defineProperty(x.selected, '0', { get() { assert.fail('getter'); }, enumerable: true }); });
rejects('symbol field', x => { x.exit[Symbol()] = 1; });
rejects('non-record profile', x => { Object.setPrototypeOf(x.selected[0].profile, { effects: 1 }); });

if (process.argv.includes('--installed')) {
  const path = require('node:path');
  for (const file of Object.keys(require.cache)) assert.ok(file === __filename || file.startsWith(__dirname + path.sep), `external source dependency: ${file}`);
}
console.log(`ok - ${cases} resource admission cases${process.argv.includes('--installed') ? ' from packed package' : ''}`);
