'use strict';

// Diagnostic-tool tests only; no new qualification task or scheduling policy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inventory, observeReport } = require('../../../scripts/qualification-audit.cjs');
const root = path.resolve(__dirname, '../../..');
const shards = { first: ['a'], second: ['b'] };
const report = {
  schemaVersion: 2, sourceRevision: 'a'.repeat(40), status: 'running', durationMs: 50,
  requestedTasks: ['a', 'b'], selectedTasks: ['a', 'b'], completedTasks: 1,
  results: [{ name: 'a', status: 'passed', exitCode: 0, durationMs: 40 }]
};
const partial = observeReport(report, shards);
assert.equal(partial.statusAsRecorded, 'running');
assert.deepEqual(partial.missingTasks, ['b']);
assert.equal(partial.idealizedPortableTaskFloorMs, null);
assert.equal(partial.executedTaskMs, 40);

const complete = { ...report, status: 'passed', finishedAt: '2026-10-13T00:00:00Z', completedTasks: 2,
  results: [...report.results, { name: 'b', status: 'passed', exitCode: 0, durationMs: 20 }] };
assert.equal(observeReport(complete, shards).idealizedPortableTaskFloorMs, 40);
const reused = structuredClone(complete);
Object.assign(reused.results[0], { execution: 'reused', durationMs: 0, reusedDurationMs: 400 });
const reuse = observeReport(reused, shards);
assert.equal(reuse.executedTaskMs, 20);
assert.equal(reuse.reusedHistoricalTaskMs, 400);
assert.equal(reuse.idealizedPortableTaskFloorMs, null, 'Reused time is not a new measurement');
const timeout = structuredClone(report);
Object.assign(timeout.results[0], { status: 'timeout', exitCode: 124 });
timeout.status = 'failed';
assert.equal(observeReport(timeout, shards).failedOrInterruptedTaskMs, 40);
assert.equal(observeReport(timeout, shards).successfulExecutedTaskMs, 0);
const sliced = { ...complete, requestedTasks: ['a', 'b', 'c'] };
assert.equal(observeReport(sliced, shards).selectionIsWholeRequest, false);

for (const mutate of [
  r => { r.status = 'passed'; },
  r => { r.completedTasks = 2; },
  r => { r.results.push(r.results[0]); r.completedTasks = 2; },
  r => { r.selectedTasks.push('a'); },
  r => { r.results[0].name = 'outside'; },
  r => { r.requestedTasks = ['b']; },
  r => { r.results[0].durationMs = -1; },
  r => { r.results[0].durationMs = Infinity; },
  r => { r.results[0].durationMs = null; },
  r => { r.results[0].status = 'unknown'; },
  r => { r.results[0].execution = 'unknown'; },
  r => { r.results[0].execution = 'reused'; },
  r => { r.schemaVersion = 99; }
]) {
  const changed = structuredClone(report); mutate(changed);
  assert.throws(() => observeReport(changed, shards));
}
for (const mutate of [r => { delete r.finishedAt; }, r => { r.results[0].exitCode = 1; }]) {
  const changed = structuredClone(complete); mutate(changed);
  assert.throws(() => observeReport(changed, shards));
}
const data = inventory();
assert.deepEqual(data, inventory(), 'Inventory ordering is deterministic');
assert.equal(data.counts.registered, data.tasks.length);
assert.equal(new Set(Object.values(data.portableShards).flat()).size, data.counts.portable);
assert(data.installedGates.every(id => !data.profiles.release.includes(id)));
assert(data.tasks.every(row => row.invocation.runner && Number.isFinite(row.timeoutMs)));

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-qualification-audit-'));
try {
  const first = path.join(temporary, 'partial.json'), second = path.join(temporary, 'other-source.json');
  fs.writeFileSync(first, JSON.stringify(report));
  fs.writeFileSync(second, JSON.stringify({ ...complete, sourceRevision: 'b'.repeat(40) }));
  const run = args => spawnSync(process.execPath, ['scripts/qualification-audit.cjs', '--summary', ...args],
    { cwd: root, encoding: 'utf8', timeout: 15000 });
  const combined = run(['--report', first, '--report', second]);
  assert.equal(combined.status, 0, combined.stderr);
  const output = JSON.parse(combined.stdout);
  assert.equal(output.qualificationDecision, 'not-evaluated');
  assert.equal(output.observations.length, 2);
  assert.equal(output.observations[0].statusAsRecorded, 'running');
  assert.equal(output.observations[1].sourceRevision, 'b'.repeat(40));
  assert.equal(run(['--report', first, '--report', first]).status, 1, 'Repeated input cannot inflate observations');
  assert.equal(run(['--report']).status, 1);
  assert.equal(run(['--unknown']).status, 1);
  assert.equal(fs.readFileSync(first, 'utf8'), JSON.stringify(report), 'Input evidence remains unchanged');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log('ok - qualification audit preserves partial/source/status boundaries; rejects malformed inputs; separates reused timing');
