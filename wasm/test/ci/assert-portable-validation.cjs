#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PROFILES, shardPlan, aggregate, validateWorkflow } = require('../../../scripts/maintainer-portable-validation.cjs');
const { expandProfile } = require('../suite/registry.cjs');

const plan = shardPlan();
assert.deepEqual(Object.values(plan).flat().sort(), PROFILES.flatMap((profile) => expandProfile(profile)).sort());
assert.throws(() => shardPlan((profile) => expandProfile(profile).filter((task) => task !== 'jwt-rs256')), /anchor missing/);
const expanded = shardPlan((profile) => [...expandProfile(profile), ...(profile === 'conformance' ? ['future-conformance-task'] : [])]);
assert(expanded['conformance-rest'].includes('future-conformance-task'), 'New conformance tasks must be included');

const expected = { testedSha: 'a'.repeat(40), workflowRunId: '123', attempt: 2 };
const reports = Object.entries(plan).map(([shard, tasks]) => ({
  metadata: { schemaVersion: 'pulse.portable-shard.v1', ...expected, attempt: 1, shard, tasks, exitCode: 0 },
  report: {
    schemaVersion: 2, sourceRevision: expected.testedSha, sourceIdentity: { sourceRevision: expected.testedSha },
    status: 'passed', currentTask: null, startedAt: '2026-09-27T01:00:00Z', finishedAt: '2026-09-27T01:00:01Z', durationMs: 1000,
    requestedTasks: tasks, selectedTasks: tasks, completedTasks: tasks.length,
    results: tasks.map((name) => ({ name, status: 'passed', exitCode: 0 }))
  }
}));
const copy = () => structuredClone(reports);
assert.equal(aggregate(reports, expected, 'success').completedTasks, Object.values(plan).flat().length);
for (const result of ['failure', 'cancelled', 'skipped', undefined]) assert.throws(() => aggregate(reports, expected, result), /did not all succeed/);
for (const mutate of [
  (rows) => rows.pop(),
  (rows) => rows.push(rows[0]),
  (rows) => { rows[0].metadata.testedSha = 'b'.repeat(40); },
  (rows) => { rows[0].metadata.workflowRunId = '456'; },
  (rows) => { rows[0].metadata.attempt = 3; },
  (rows) => { rows[0].metadata.exitCode = 1; },
  (rows) => { rows[0].metadata.shard = 'unknown'; },
  (rows) => { rows[0].report = null; },
  (rows) => { rows[0].report.sourceRevision = 'b'.repeat(40); },
  (rows) => { rows[0].report.status = 'running'; },
  (rows) => { rows[0].report.finishedAt = null; },
  (rows) => { rows[0].report.completedTasks -= 1; },
  (rows) => { rows[0].report.requestedTasks = []; },
  (rows) => { rows[0].report.selectedTasks = []; },
  (rows) => { rows[0].report.results.pop(); },
  (rows) => { rows[0].report.results[0].status = 'failed'; },
  (rows) => { rows[0].report.results[0].exitCode = 1; }
]) {
  const rows = copy();
  mutate(rows);
  assert.throws(() => aggregate(rows, expected, 'success'), 'Missing, failed, malformed, or mismatched evidence must fail the gate');
}
const retried = copy();
const retry = structuredClone(retried[0]);
retry.metadata.attempt = 2;
retried.push(retry);
assert.equal(aggregate(retried, expected, 'success').shards[0].attempt, 2);
retry.metadata.exitCode = 1;
assert.throws(() => aggregate(retried, expected, 'success'), /did not exit successfully/, 'Never fall back from failed latest evidence');

const workflow = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/validate.yml'), 'utf8');
validateWorkflow(workflow);
for (const changed of [
  workflow.replace('conformance-schema, conformance-rest]', 'conformance-schema]'),
  workflow.replace('fail-fast: false', 'fail-fast: true'),
  workflow.replace('needs: portable-shards\n    if: always()', 'needs: portable-shards\n    if: success()'),
  workflow.replace('PORTABLE_SHARDS_RESULT: ${{ needs.portable-shards.result }}', "PORTABLE_SHARDS_RESULT: 'success'")
]) assert.throws(() => validateWorkflow(changed));

const root = path.resolve(__dirname, '../../..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-portable-aggregate-'));
try {
  for (const candidate of reports) {
    const directory = path.join(fixture, `pulse-portable-shard-123-1-${candidate.metadata.shard}`);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'identity.json'), JSON.stringify(candidate.metadata));
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(candidate.report));
  }
  const run = () => spawnSync(process.execPath, ['scripts/maintainer-portable-validation.cjs', 'aggregate', fixture], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, GITHUB_SHA: expected.testedSha, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', PORTABLE_SHARDS_RESULT: 'success', GITHUB_STEP_SUMMARY: '' }
  });
  const passed = run();
  assert.equal(passed.status, 0, passed.stderr);
  const output = path.join(root, 'wasm/.test-results/portable-aggregate.json');
  assert.equal(JSON.parse(fs.readFileSync(output)).status, 'passed');
  fs.rmSync(path.join(fixture, 'pulse-portable-shard-123-1-unit'), { recursive: true });
  assert.notEqual(run().status, 0, 'Missing artifact must fail the aggregate CLI');
  const failed = JSON.parse(fs.readFileSync(output));
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /Missing shard: unit/);
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }

console.log(`ok - ${Object.keys(plan).length} portable shards cover ${Object.values(plan).flat().length} registered tasks; missing/failed/stale coverage fails closed`);
