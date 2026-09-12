'use strict';
const assert = require('node:assert/strict');

// Shared black-box corpus. Each call is a separate handler invocation. The
// expected winner comes from acknowledgements, never from request order.
async function scenarios(invoke, prefix = 'k4') {
  let requests = 0;
  const call = async (command) => { requests++; return invoke(command); };
  const get = (key) => call({ operation: 'get', key });
  const create = (key, value) => call({ operation: 'create', key, value });
  const cas = (key, generation, value) => call({ operation: 'cas', key, generation, value });
  const groups = [];
  assert.deepEqual(await get(`${prefix}-missing`), { status: 'not-found' });
  for (const width of [2, 8, 16]) {
    const key = `${prefix}-race-${width}`;
    const values = Array.from({ length: width }, (_, writer) => ({ writer, revision: 0, receipt: `${prefix}-${width}-${writer}` }));
    const created = await Promise.all(values.map((value) => create(key, value)));
    assert.equal(created.filter((r) => r.status === 'stored').length, 1, 'one create winner across requests');
    assert.equal(created.filter((r) => r.status === 'conflict').length, width - 1);
    let observed = await get(key);
    assert.equal(observed.status, 'found');
    assert.deepEqual(observed.value, values[created.findIndex((r) => r.status === 'stored')]);
    const generations = new Set([observed.generation]);
    const stale = observed;
    for (let revision = 1; revision <= 3; revision++) {
      const candidates = values.map((v) => ({ ...v, revision }));
      const replaced = await Promise.all(candidates.map((v) => cas(key, observed.generation, v)));
      assert.equal(replaced.filter((r) => r.status === 'stored').length, 1, 'one CAS winner per observed generation');
      assert.equal(replaced.filter((r) => r.status === 'conflict').length, width - 1);
      observed = await get(key);
      assert.deepEqual(observed.value, candidates[replaced.findIndex((r) => r.status === 'stored')]);
      assert.equal(typeof observed.generation, 'string');
      assert.equal(generations.has(observed.generation), false, 'retained-key generations change on every acceptance');
      generations.add(observed.generation);
      assert.deepEqual(await cas(key, stale.generation, stale.value), { status: 'conflict' });
    }
    // Tombstone/resurrection retain the authority key. An old token cannot
    // replace either state, including an ABA return to identical value bytes.
    assert.deepEqual(await cas(key, observed.generation, { deleted: true }), { status: 'stored' });
    const tombstone = await get(key);
    assert.deepEqual(tombstone.value, { deleted: true });
    assert.deepEqual(await create(key, stale.value), { status: 'conflict' });
    assert.deepEqual(await cas(key, stale.generation, stale.value), { status: 'conflict' });
    assert.deepEqual(await cas(key, tombstone.generation, stale.value), { status: 'stored' });
    const restored = await get(key);
    assert.deepEqual(restored.value, stale.value);
    assert.notEqual(restored.generation, stale.generation);
    assert.deepEqual(await cas(key, stale.generation, { invalid: true }), { status: 'conflict' });
    groups.push({ width, revisions: 3, createWinners: 1, casWinnersPerRevision: 1, retainedTombstone: true });
  }
  // Keyed parallel groups and separate requests exercise different scheduler paths.
  const key = `${prefix}-group`;
  const created = await call({ operation: 'create-race', key });
  assert.deepEqual(Object.values(created).map((r) => r.status).sort(), ['conflict', 'conflict', 'stored']);
  const read = await get(key);
  const replaced = await call({ operation: 'cas-race', key, generation: read.generation });
  assert.deepEqual(Object.values(replaced).map((r) => r.status).sort(), ['conflict', 'conflict', 'stored']);
  const values = [null, { __pulseKv: 1, value: { nested: true } }, '雪😀\ud800', 'x'.repeat(65534)];
  for (const [index, value] of values.entries()) {
    const key = `${prefix}-value-${index}`;
    assert.deepEqual(await create(key, value), { status: 'stored' });
    const before = await get(key);
    assert.deepEqual(before.value, value);
    assert.deepEqual(await cas(key, before.generation, value), { status: 'stored' });
    assert.notEqual((await get(key)).generation, before.generation, 'same bytes still get a new generation');
  }
  assert.deepEqual(await create(`${prefix}-large`, 'x'.repeat(65535)), { status: 'not-stored', reason: 'too-large' });
  assert.deepEqual(await get(`${prefix}-large`), { status: 'not-found' });
  assert.deepEqual(await cas(key, 9007199254740992, null), { status: 'not-stored', reason: 'invalid-generation' });
  const missingCas = await cas(`${prefix}-missing`, read.generation, null);
  const missingRead = await get(`${prefix}-missing`);
  const failures = [];
  if (missingCas.status !== 'conflict' || missingRead.status !== 'not-found') failures.push({
    check: 'missing-key-cas', expected: { acknowledgement: 'conflict', subsequentRead: 'not-found' },
    actual: { acknowledgement: missingCas.status, subsequentRead: missingRead.status },
  });
  return { status: failures.length ? 'failed' : 'passed', requests, groups, keyedParallel: true, boundaryValues: values.length, failures };
}

module.exports = { scenarios };
