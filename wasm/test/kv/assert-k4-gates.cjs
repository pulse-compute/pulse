'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createNodeKvReference } = require('../../../packages/provider-node/src/runtime/conditional-kv.js');
const { deployed } = require('./k4/deployed.cjs');
const { localAcceptance } = require('./k4/local-acceptance.cjs');

async function main() {
  const recorded = require('./k4/viceroy-0.21.1-beta6-evidence.json').localK4.consumer;
  const known = localAcceptance(recorded);
  assert.equal(known.status, 'accepted-with-known-viceroy-discrepancy');
  assert.equal(known.releaseBlocking, false); assert.equal(known.semanticStatus, 'failed');
  assert.equal(known.deployedPulseCrossLocationStillRequired, true);
  assert.equal(localAcceptance(require('./k4/viceroy-0.21.0-evidence.json')).releaseBlocking, false);
  const fixed = structuredClone(recorded);
  fixed.status = fixed.results['fastly-compute'].status = 'passed';
  fixed.results['fastly-compute'].failures = [];
  assert.equal(localAcceptance(fixed).status, 'passed');
  for (const change of [
    e => { e.results['node-native'].status = 'failed'; },
    e => { e.results['node-javascript'].status = 'failed'; },
    e => { e.results['node-native'].failures.push({ check: 'another-failure' }); },
    e => { e.results['fastly-compute'].failures.push({ check: 'another-failure' }); },
    e => { e.results['fastly-compute'].failures[0].actual.subsequentRead = 'failed'; },
    e => { e.results['fastly-compute'].toolchain.viceroy.version = '0.21.2'; },
    e => { delete e.results['fastly-compute'].toolchain.viceroy; },
    e => { e.results['fastly-compute'].lostResponse.status = 'failed'; },
    e => { e.results['unexpected-target'] = { status: 'failed' }; },
    e => { e.installedBytesUnchanged = false; },
    e => { e.workspaceProductModules = 1; },
    e => { e.publicTypes = 'failed'; },
  ]) {
    const invalid = structuredClone(recorded); change(invalid);
    assert.equal(localAcceptance(invalid).releaseBlocking, true, 'unrelated or unverified failures still block');
  }
  // Missing dependencies must fail before packing/installing, not pass/skip.
  const unavailable = spawnSync(process.execPath, [path.join(__dirname, 'assert-k4-acceptance.cjs')], {
    env: { ...process.env, PULSE_FASTLY_BIN: path.join(__dirname, 'absent-fastly-executable'), PULSE_VICEROY_BIN: '' },
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(unavailable.status, 1); assert.equal(unavailable.stdout, '');
  assert.match(unavailable.stderr, /Fastly|executable/);
  function fixture(change) {
    const reference = createNodeKvReference(), store = reference.kv('catalog');
    const identity = { serviceId: 'test-service', serviceVersion: '1', storeId: 'test-store', moduleSha256: 'a'.repeat(64) };
    let id = 0, mutations = 0;
    const probes = ['TEST_A', 'TEST_B'].map((pop) => {
      async function invoke(command) {
        const metadata = { ...identity, pop, requestId: String(++id) };
        const result = command.operation === 'get' ? await store.getVersioned(command.key)
          : command.operation === 'create' ? (mutations++, await store.insertIfAbsent(command.key, command.value))
            : (mutations++, await store.compareAndSwap(command.key, command.generation, command.value));
        const reply = { metadata, result };
        if (change) change(reply, command);
        return reply;
      }
      return { id: pop, invoke, async loseResponse(command) { const reply = await invoke(command); return { metadata: reply.metadata, outcome: 'response-lost' }; } };
    });
    return { identity, probes, readTimeoutMs: 100, mutations: () => mutations };
  }
  const passed = await deployed(fixture());
  assert.equal(passed.status, 'passed'); assert.equal(passed.schedules.length, 3);
  assert.equal(passed.ambiguousCompletion.typedKvUnknown, false);
  assert.equal(passed.localK4GateStillRequired, true);
  for (const [change, pattern] of [
    [(r) => { r.metadata.pop = 'TEST_A'; }, /distinct verified/],
    [(r) => { r.metadata.storeId = 'other'; }, /storeId differs/],
    [(r) => { r.metadata.moduleSha256 = 'b'.repeat(64); }, /moduleSha256 differs/],
    [(r) => { r.metadata.requestId = 'cached'; }, /cached\/replayed/],
  ]) {
    const test = fixture(change);
    await assert.rejects(deployed(test), pattern);
    assert.equal(test.mutations(), 0, 'identity/location checks precede writes');
  }
  const noFault = fixture(); delete noFault.probes[0].loseResponse;
  await assert.rejects(deployed(noFault), /controlled response-loss/);
  assert.equal(noFault.mutations(), 0);
  const unknown = fixture((reply, command) => { if (command.operation === 'create') reply.result = { status: 'unknown', reason: 'transport' }; });
  await assert.rejects(deployed(unknown), /Expected values/);
  assert.equal(unknown.mutations(), 2, 'unknown acknowledgements do not trigger mutation retries');
  console.log('ok - K4 rejects missing executables, mixed deployment identities, repeated receipts, same-POP evidence and unknown write acceptance; deployed orchestration tested with a local fixture only');
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
