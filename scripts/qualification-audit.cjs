#!/usr/bin/env node
'use strict';

// Observation only. This command does not execute tasks, decide qualification,
// read checkpoint artifacts, or authorize cache reuse. JSON is written to stdout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { tasks, profiles, expandProfile, installedCorpusOwners } = require('../wasm/test/suite/registry.cjs');
const { shardPlan } = require('./maintainer-portable-validation.cjs');
const { REQUIRED_TASKS, SEPARATE_GATES } = require('./release-feature-acceptance.cjs');
const { FAST_TASKS } = require('./maintainer-fast-validation.cjs');
const { scheduling } = require('./release-parallel.cjs');
const ROOT = path.resolve(__dirname, '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const OWNERS = [
  'wasm/test/suite/registry.cjs', 'wasm/scripts/run-wasm-tests.cjs',
  'scripts/maintainer-portable-validation.cjs', 'scripts/maintainer-fast-validation.cjs',
  'scripts/maintainer-validation-routing.cjs', 'scripts/validate-release.cjs',
  'scripts/release-feature-acceptance.cjs', 'scripts/release-parallel.cjs',
  'scripts/release-recovery.cjs', 'scripts/release-checkpoints.cjs',
  'scripts/release-shared-pack.cjs', 'scripts/release-source-checks.cjs',
  'scripts/release-seal-measure.cjs', 'scripts/pack-release.cjs',
  'scripts/documentation-release.cjs', 'release/maintenance-policy.json',
  '.github/workflows/validate.yml', '.github/workflows/release-qualify.yml',
  '.github/workflows/documentation.yml'
];

function inventory() {
  const selections = Object.fromEntries(Object.keys(profiles).map(name => [name, expandProfile(name)]));
  const portable = shardPlan();
  const membership = id => Object.keys(selections).filter(name => selections[name].includes(id));
  const normalize = arg => path.isAbsolute(arg) && arg.startsWith(ROOT + path.sep)
    ? path.relative(ROOT, arg).split(path.sep).join('/') : arg;
  const rows = Object.entries(tasks).map(([id, task]) => ({
    id, evidence: task.evidence, description: task.description, timeoutMs: task.timeoutMs,
    // Avoid resolving Vitest's installed entry point: inventory needs no install.
    invocation: task.testFiles ? { runner: 'vitest', files: task.testFiles }
      : { runner: task.command === process.execPath ? 'node' : task.command, args: task.args.map(normalize) },
    profiles: membership(id), installedGate: REQUIRED_TASKS.includes(id),
    sealScheduling: scheduling(id, task)
  }));
  const commandGroups = new Map();
  for (const row of rows) {
    const key = JSON.stringify(row.invocation);
    commandGroups.set(key, [...(commandGroups.get(key) || []), row.id]);
  }
  const portableTasks = Object.values(portable).flat();
  const portableReleaseOverlap = portableTasks.filter(id => selections.release.includes(id));
  return {
    counts: { registered: rows.length, profiles: Object.fromEntries(Object.entries(selections).map(([k, v]) => [k, v.length])),
      portable: portableTasks.length, installed: REQUIRED_TASKS.length,
      portableReleaseOverlap: portableReleaseOverlap.length,
      portableOutsideRelease: portableTasks.filter(id => !selections.release.includes(id)).length },
    profiles: selections, portableShards: portable, installedGates: REQUIRED_TASKS,
    separateGates: SEPARATE_GATES, installedCorpusOwners,
    conservativeFastTemplate: FAST_TASKS,
    fastTemplateNote: 'Selection uses trusted-base path policy; schema-codecs replaces schema-codecs-smoke when full coverage is required.',
    duplicateInvocations: [...commandGroups.values()].filter(ids => ids.length > 1),
    overlapNote: 'Same task IDs across independent gates are not redundant proof. Workspace, installed, runtime-version and candidate identities remain distinct.',
    tasks: rows
  };
}

function uniqueNames(value, label) {
  assert(Array.isArray(value) && value.every(x => typeof x === 'string' && x.length > 0), `Invalid ${label}`);
  assert.equal(new Set(value).size, value.length, `Duplicate ${label}`);
  return value;
}
function finiteDuration(value, label) {
  assert(Number.isFinite(value) && value >= 0, `Invalid ${label}`);
  return value;
}

function observeReport(report, shards = shardPlan()) {
  assert.equal(report.schemaVersion, 2, 'Expected runner report schema 2');
  assert(['running', 'passed', 'failed', 'interrupted'].includes(report.status), 'Invalid report status');
  const selected = uniqueNames(report.selectedTasks, 'selected tasks');
  const requested = uniqueNames(report.requestedTasks, 'requested tasks');
  assert(selected.every(id => requested.includes(id)), 'Selected task not requested');
  assert(Array.isArray(report.results), 'Missing results');
  const completed = uniqueNames(report.results.map(r => r.name), 'result tasks');
  assert.equal(report.completedTasks, completed.length, 'Completed count differs');
  assert(completed.every(id => selected.includes(id)), 'Unexpected result');
  const knownStatuses = ['passed', 'failed', 'timeout', 'interrupted'];
  for (const result of report.results) {
    assert(knownStatuses.includes(result.status), `Invalid result status: ${result.status}`);
    assert(result.execution === undefined || ['executed', 'reused'].includes(result.execution), 'Invalid execution kind');
    finiteDuration(result.durationMs, 'task duration');
    if (result.execution === 'reused') finiteDuration(result.reusedDurationMs, 'reused duration');
  }
  const missing = selected.filter(id => !completed.includes(id));
  if (report.status === 'passed') {
    assert.equal(missing.length, 0, 'Passing report is incomplete');
    assert(report.finishedAt, 'Passing report lacks finish time');
    assert(report.results.every(r => r.status === 'passed' && r.exitCode === 0), 'Passing report contains unsuccessful result');
  }
  const executed = report.results.filter(r => r.execution !== 'reused');
  const reused = report.results.filter(r => r.execution === 'reused');
  const sum = rows => rows.reduce((ms, row) => ms + row.durationMs, 0);
  const successful = executed.filter(r => r.status === 'passed' && r.exitCode === 0);
  const shardObservations = Object.entries(shards).map(([name, ids]) => {
    const rows = successful.filter(r => ids.includes(r.name));
    return { name, expectedTasks: ids.length, observedTasks: rows.length,
      observedTaskMs: sum(rows), missingTasks: ids.filter(id => !rows.some(r => r.name === id)) };
  });
  return {
    statusAsRecorded: report.status, runId: report.runId ?? null,
    sourceRevision: report.sourceRevision ?? null, sourceIdentityKind: report.sourceIdentity?.sourceIdentityKind ?? null,
    sourceDigestSha256: report.sourceIdentity?.sourceDigestSha256 ?? null,
    sourceNote: 'Reported identity only; this observer does not attest source bytes, environment, cleanup, exit of the parent process, or current-source equivalence.',
    requestedTasks: requested.length, selectedTasks: selected.length, completedTasks: completed.length,
    selectionIsWholeRequest: requested.length === selected.length && requested.every((id, i) => selected[i] === id),
    missingTasks: missing, statusCounts: Object.fromEntries(knownStatuses.map(s => [s, report.results.filter(r => r.status === s).length])),
    recordedElapsedMs: finiteDuration(report.durationMs, 'report duration'),
    executedTaskMs: sum(executed), successfulExecutedTaskMs: sum(successful),
    failedOrInterruptedTaskMs: sum(executed.filter(r => r.status !== 'passed' || r.exitCode !== 0)),
    reusedTasks: reused.length, reusedHistoricalTaskMs: reused.reduce((ms, r) => ms + r.reusedDurationMs, 0),
    slowestExecutedTasks: [...executed].sort((a, b) => b.durationMs - a.durationMs || a.name.localeCompare(b.name)).slice(0, 12)
      .map(r => ({ name: r.name, status: r.status, durationMs: r.durationMs })),
    portableShardObservations: shardObservations,
    idealizedPortableTaskFloorMs: shardObservations.every(s => s.missingTasks.length === 0)
      ? Math.max(...shardObservations.map(s => s.observedTaskMs)) : null,
    timingNote: 'Durations are elapsed task occupancy, not CPU. Shard sums project this one sample onto the current plan; they exclude setup, queueing and contention. The idealized floor is not a CI wall-time prediction.'
  };
}

function main(argv = process.argv.slice(2)) {
  let summary = false;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--summary') summary = true;
    else if (argv[i] === '--report' && argv[i + 1] && !argv[i + 1].startsWith('--')) files.push(argv[++i]);
    else if (argv[i] === '--help') {
      console.log('Usage: node scripts/qualification-audit.cjs [--summary] [--report <runner.json>]... > audit.json');
      return;
    } else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  const seen = new Set();
  const observations = files.map(file => {
    const bytes = fs.readFileSync(file), digest = sha256(bytes);
    assert(!seen.has(digest), 'Duplicate report bytes');
    seen.add(digest);
    return { file: path.basename(file), sha256: digest, ...observeReport(JSON.parse(bytes)) };
  });
  const data = inventory();
  if (summary) {
    delete data.tasks;
    delete data.profiles;
    data.portableShards = Object.fromEntries(Object.entries(data.portableShards).map(([k, v]) => [k, v.length]));
  }
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 10000 }).trim();
  const output = { schemaVersion: 'pulse.qualification-audit.v1', purpose: 'planning-only', qualificationDecision: 'not-evaluated',
    inventorySource: { revision: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']),
      dirty: git(['status', '--porcelain', '--untracked-files=all']) !== '',
      ownerHashes: Object.fromEntries(OWNERS.map(file => [file, sha256(fs.readFileSync(path.join(ROOT, file)))])) },
    ...data, observations,
    observationPolicy: 'Each report remains independent. Reports are never pooled into qualification or cache proofs; absent observations remain unknown.' };
  console.log(JSON.stringify(output, null, 2));
}

module.exports = { inventory, observeReport, main };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
