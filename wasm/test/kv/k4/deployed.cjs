'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

// T2 owns authenticated remote probe transport and deployment. A probe invokes
// the K2 consumer and returns { result, metadata }, where metadata is captured
// by the service-side probe (not copied from caller-supplied location headers).
async function deployed({ identity, probes, readTimeoutMs = 30000 }) {
  for (const field of ['serviceId', 'serviceVersion', 'storeId']) assert.ok(typeof identity?.[field] === 'string' && identity[field].length > 0, `T2 identity requires ${field}`);
  assert.match(identity.moduleSha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(probes) && probes.length >= 2 && probes.length <= 8, 'two to eight remote probes required');
  assert.equal(new Set(probes.map((p) => p.id)).size, probes.length);
  for (const probe of probes) assert.ok(typeof probe.id === 'string' && probe.id.length > 0 && typeof probe.invoke === 'function');
  assert.equal(typeof probes[0].loseResponse, 'function', 'T2 requires a controlled response-loss probe');
  assert.ok(Number.isInteger(readTimeoutMs) && readTimeoutMs > 0 && readTimeoutMs <= 120000);
  const locations = new Map(), requestIds = new Set();
  const prefix = `pulse-k4-${randomUUID()}`;
  function metadata(probe, reply) {
    for (const field of ['serviceId', 'serviceVersion', 'storeId', 'moduleSha256']) assert.equal(reply.metadata?.[field], identity[field], `${probe.id}: ${field} differs from reviewed T2 deployment`);
    assert.match(reply.metadata.pop, /^[A-Za-z0-9_-]{2,64}$/);
    assert.doesNotMatch(reply.metadata.pop, /local|viceroy|localhost/i);
    assert.ok(typeof reply.metadata.requestId === 'string' && reply.metadata.requestId.length > 0 && reply.metadata.requestId.length <= 256);
    assert.equal(requestIds.has(reply.metadata.requestId), false, 'cached/replayed request evidence');
    requestIds.add(reply.metadata.requestId);
    if (locations.has(probe.id)) assert.equal(locations.get(probe.id), reply.metadata.pop, 'probe changed execution POP during a schedule');
    else locations.set(probe.id, reply.metadata.pop);
  }
  async function request(probe, operation, command, timeoutMs = 15000) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([probe[operation](command, { signal: controller.signal }), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Remote probe deadline expired; write disposition may be unknown')); }, timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function call(probe, command, timeoutMs) {
    const reply = await request(probe, 'invoke', command, timeoutMs);
    metadata(probe, reply);
    return reply.result;
  }
  // Reads may be stale. Poll only reads, with a bounded visibility budget;
  // never retry/rebase mutations or infer their acknowledgements from reads.
  async function observe(probe, key, value) {
    const until = Date.now() + readTimeoutMs;
    do {
      const result = await call(probe, { operation: 'get', key }, Math.max(1, Math.min(15000, until - Date.now())));
      if (result.status === 'found' && isDeepStrictEqual(result.value, value)) return result;
      assert.ok(['found', 'not-found'].includes(result.status), 'read failure is inconclusive, not acceptance');
      if (Date.now() >= until) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < until);
    throw new Error('Cross-location visibility budget exhausted; no production acceptance claim');
  }
  for (const probe of probes) assert.deepEqual(await call(probe, { operation: 'get', key: `${prefix}-absent` }), { status: 'not-found' });
  assert.equal(new Set(locations.values()).size, probes.length, 'distinct verified execution POPs required');
  const schedules = [];
  for (let schedule = 0; schedule < 3; schedule++) {
    const key = `${prefix}-${schedule}`;
    const values = probes.map((_, writer) => ({ writer, schedule, revision: 0, receipt: randomUUID() }));
    const created = await Promise.all(probes.map((p, i) => call(p, { operation: 'create', key, value: values[i] })));
    assert.equal(created.filter((r) => r.status === 'stored').length, 1);
    assert.equal(created.filter((r) => r.status === 'conflict').length, probes.length - 1, 'unknown writes are inconclusive');
    const winner = values[created.findIndex((r) => r.status === 'stored')];
    const reads = await Promise.all(probes.map((p) => observe(p, key, winner)));
    assert.equal(new Set(reads.map((r) => r.generation)).size, 1, 'same accepted value/generation observation across POPs');
    const candidates = values.map((v) => ({ ...v, revision: 1 }));
    const replaced = await Promise.all(probes.map((p, i) => call(p, { operation: 'cas', key, generation: reads[i].generation, value: candidates[i] })));
    assert.equal(replaced.filter((r) => r.status === 'stored').length, 1);
    assert.equal(replaced.filter((r) => r.status === 'conflict').length, probes.length - 1);
    const accepted = candidates[replaced.findIndex((r) => r.status === 'stored')];
    const current = await Promise.all(probes.map((p) => observe(p, key, accepted)));
    for (let i = 0; i < probes.length; i++) {
      assert.notEqual(current[i].generation, reads[i].generation);
      assert.deepEqual(await call(probes[i], { operation: 'cas', key, generation: reads[i].generation, value: winner }), { status: 'conflict' });
      assert.deepEqual(await call(probes[i], { operation: 'cas', key: `${prefix}-absent`, generation: current[i].generation, value: null }), { status: 'conflict' });
    }
    assert.deepEqual(await call(probes[0], { operation: 'cas', key, generation: current[0].generation, value: { deleted: true } }), { status: 'stored' });
    await Promise.all(probes.map((p) => observe(p, key, { deleted: true })));
    for (const p of probes) assert.deepEqual(await call(p, { operation: 'create', key, value: winner }), { status: 'conflict' });
    schedules.push({ schedule, writers: probes.length, createWinners: 1, casWinners: 1, staleExcluded: true, missingExcluded: true, retainedTombstone: true });
  }
  const lostKey = `${prefix}-lost`, value = { receipt: randomUUID() };
  const lost = await request(probes[0], 'loseResponse', { operation: 'create', key: lostKey, value });
  metadata(probes[0], lost);
  assert.equal(lost.outcome, 'response-lost');
  assert.equal(lost.result, undefined, 'response-loss probe must not deliver a typed acknowledgement');
  await Promise.all(probes.map((p) => observe(p, lostKey, value)));
  // Retain a conditional tombstone instead of deleting the accepted authority.
  const afterLoss = await observe(probes[1], lostKey, value);
  assert.deepEqual(await call(probes[1], { operation: 'cas', key: lostKey, generation: afterLoss.generation, value: { deleted: true } }), { status: 'stored' });
  return { version: 'pulse.kv-k4-deployed.v1', status: 'passed', identity, keyPrefix: prefix,
    locations: Object.fromEntries(locations), schedules, requests: requestIds.size,
    mutationRetries: 0, visibilityBudgetMs: readTimeoutMs,
    ambiguousCompletion: { clientResponseLoss: true, committedReceiptObserved: true, typedKvUnknown: false },
    scope: 'bounded-deployed-probe-evidence', localK4GateStillRequired: true };
}
module.exports = { deployed };
