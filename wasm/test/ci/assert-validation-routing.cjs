#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tierFor, route, requireTier, revisionRange, validateWorkflow } = require('../../../scripts/maintainer-validation-routing.cjs');
const sha = 'a'.repeat(40), base = 'b'.repeat(40), head = 'c'.repeat(40);
const pr = (target) => ({ pull_request: { base: { ref: target, sha: base }, head: { sha: head } } });
const needs = (tier) => ({
  route: { result: 'success', outputs: { run: 'true', tier } },
  maintenance: { result: 'success' }, 'node-floor': { result: 'success' },
  'fast-selection': { result: tier === 'fast' ? 'success' : 'skipped' },
  'fast-portable': { result: tier === 'fast' ? 'success' : 'skipped' },
  'full-portable': { result: tier === 'full' ? 'success' : 'skipped' }
});
for (const [event, payload, ref, tier] of [
  ['pull_request', pr('latest'), 'refs/pull/1/merge', 'fast'],
  ['pull_request', pr('feature/optimization'), 'refs/pull/1/merge', 'fast'],
  ['pull_request', pr('main'), 'refs/pull/1/merge', 'full'],
  ['push', {}, 'refs/heads/latest', 'fast'],
  ['push', {}, 'refs/heads/feature/optimization', 'fast'],
  ['push', {}, 'refs/heads/main', 'full'],
  ['workflow_dispatch', {}, 'refs/heads/main', 'full'],
  ['workflow_dispatch', {}, 'refs/heads/latest', 'fast']
]) {
  assert.equal(tierFor(event, payload, ref), tier);
  assert.equal(requireTier(event, payload, ref, needs(tier)), tier);
  for (const job of ['route', 'maintenance', 'node-floor', ...(tier === 'full' ? ['full-portable'] : ['fast-selection', 'fast-portable'])]) {
    for (const result of [undefined, 'skipped', 'failure', 'cancelled']) {
      const missing = needs(tier); missing[job].result = result;
      assert.throws(() => requireTier(event, payload, ref, missing), /did not succeed/);
    }
  }
  const wrongTier = needs(tier === 'full' ? 'fast' : 'full');
  assert.throws(() => requireTier(event, payload, ref, wrongTier), /tier differs/);
  const suppressed = needs(tier); suppressed.route.outputs.run = 'false';
  assert.throws(() => requireTier(event, payload, ref, suppressed), /suppressed/);
}
assert.throws(() => tierFor('push', {}, 'refs/tags/v1'), /branch ref/);
assert.throws(() => tierFor('push', { deleted: true }, 'refs/heads/main'), /Deleted/);
assert.throws(() => tierFor('pull_request_target', pr('main'), ''), /Unsupported/);
assert.throws(() => tierFor('pull_request', {}, ''), /Missing/);
// Retargeting cannot reuse the fast tier's success.
assert.throws(() => requireTier('pull_request', { ...pr('main'), action: 'edited' }, 'refs/pull/1/merge', needs('fast')), /tier differs/);
const git = (args) => args[0] === 'rev-parse' ? sha : `${sha} ${base} ${head}`;
assert.deepEqual(revisionRange('pull_request', pr('main'), sha, git), { base, head, tested: sha, mode: 'merge' });
assert.throws(() => revisionRange('pull_request', pr('latest'), sha, () => sha), /exact PR base and head/);
assert.throws(() => revisionRange('pull_request', pr('latest'), sha, () => head), /Checkout differs/);
for (const before of [base, '0'.repeat(40), undefined]) {
  assert.deepEqual(revisionRange('push', { before }, sha, git), { base, head: sha, tested: sha, mode: 'branch' });
}
assert.equal(revisionRange('workflow_dispatch', {}, sha, git).base, base);
// Force pushes need not have an ancestor base; diff the exact previous tree.
assert.equal(revisionRange('push', { before: head }, sha, git).base, head);
assert.throws(() => revisionRange('push', { before: '--unsafe' }, sha, git), /prior commit/);

const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, '.github/workflows/validate.yml'), 'utf8');
validateWorkflow(source);
for (const mutation of [
  source.replace("branches: ['**']", 'branches: [main]'),
  source.replace('reopened, edited, ready_for_review', 'reopened, ready_for_review'),
  source.replace("if: always() && (github.event_name", "if: success() && (github.event_name"),
  source.replace('node-floor, fast-selection, fast-portable, full-portable]', 'node-floor, fast-selection, fast-portable]'),
  source.replace('VALIDATION_NEEDS: ${{ toJSON(needs) }}', 'VALIDATION_NEEDS: {}'),
  source.replace("needs.route.outputs.tier == 'full'", "needs.route.outputs.tier == 'fast'")
]) assert.throws(() => validateWorkflow(mutation));
for (const workflow of ['documentation', 'maintainer-scope']) validateWorkflow(fs.readFileSync(path.join(root, `.github/workflows/${workflow}.yml`), 'utf8'), workflow);

async function checkRoute(eventName, ref, payload, prs, expectedRun, expectedTier, apiFails = false) {
  let calls = 0;
  const outputs = {};
  const result = await route({
    github: { rest: { pulls: { list() {} } }, async paginate() { calls++; if (apiFails) throw new Error('unavailable'); return prs; } },
    context: { eventName, ref, payload, sha, repo: { owner: 'pulse-compute', repo: 'pulse' } },
    core: { setOutput(key, value) { outputs[key] = value; }, info() {}, warning() {} }
  });
  assert.deepEqual(result, { tier: expectedTier, run: expectedRun });
  assert.equal(outputs.run, String(expectedRun));
  if (eventName !== 'push' || expectedTier === 'full') assert.equal(calls, 0);
}
(async () => {
  const same = [{ head: { sha, repo: { full_name: 'pulse-compute/pulse' } } }];
  await checkRoute('push', 'refs/heads/latest', {}, same, false, 'fast');
  await checkRoute('push', 'refs/heads/latest', {}, [], true, 'fast');
  await checkRoute('push', 'refs/heads/latest', {}, [{ head: { sha: head, repo: same[0].head.repo } }], true, 'fast');
  await checkRoute('push', 'refs/heads/latest', {}, [{ head: { sha, repo: { full_name: 'fork/pulse' } } }], true, 'fast');
  await checkRoute('push', 'refs/heads/latest', {}, same, true, 'fast', true);
  await checkRoute('push', 'refs/heads/main', {}, same, true, 'full');
  await checkRoute('pull_request', 'refs/pull/1/merge', pr('latest'), same, true, 'fast');
  await checkRoute('pull_request', 'refs/pull/1/merge', pr('main'), same, true, 'full');
  console.log('Validation routing contract passed: main requires full, all other branches fast; missing tier coverage fails closed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
