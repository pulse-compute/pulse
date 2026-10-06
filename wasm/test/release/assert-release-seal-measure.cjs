'use strict';

// Focused manual check; deliberately not another aggregate release task.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, observerSource, summarize } = require('../../../scripts/release-seal-measure.cjs');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-measure-check-'));
try {
  assert.throws(() => parseArgs(['--interrupt-at', 'workspace-unit']), /installed feature gate/);
  assert.throws(() => parseArgs(['--skip-install', '--dependency-bundle', 'bundle']), /cannot be combined/);
  assert.throws(() => parseArgs(['--resume', 'attempt']), /Unknown/);
  assert.equal(parseArgs(['--verify-resume']).verifyResume, true);
  assert.throws(() => parseArgs(['--verify-resume', '--interrupt-at', 's3-body-installed']), /cannot be combined/);
  assert.deepEqual(parseArgs(['--out', 'result']).sealArgs, ['--require-fastly']);
  const events = path.join(temporary, 'events.jsonl'), preload = path.join(temporary, 'observer.cjs');
  fs.writeFileSync(events, '');
  fs.writeFileSync(preload, observerSource(events));
  const result = spawnSync(process.execPath, ['--require', preload, '-e', `
    const cp = require('node:child_process');
    // Failed launches still count; the observer must preserve their outcome.
    const a = cp.spawnSync('pnpm', ['pack', 'private-value'], {env: {PATH: ''}});
    const b = cp.execFileSync.bind(cp, 'npm', ['install'], {env: {PATH: ''}});
    if (a.error.code !== 'ENOENT') throw new Error('spawn outcome changed');
    try { b(); throw new Error('exec outcome changed'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    cp.spawnSync(process.execPath, ['/missing/assemblyscript/bin/asc.js'], {stdio: 'ignore'});
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  const bytes = fs.readFileSync(events, 'utf8');
  assert(!bytes.includes('private-value'), 'Observer leaked an argument');
  const rows = bytes.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.filter(row => row.kind === 'launch').map(row => row.category), ['pack', 'install', 'asc']);
  assert(rows.some(row => row.kind === 'node-exit' && row.maxRSSKiB > 0));
  const tasks = path.join(temporary, 'tasks.json');
  fs.writeFileSync(tasks, JSON.stringify({results: [
    {status: 'passed', execution: 'reused', durationMs: 0, reusedDurationMs: 2000},
    {status: 'failed', execution: 'executed', durationMs: 40}
  ]}));
  const metrics = summarize({durationMs: 50, recovery: {artifacts: {taskReport: tasks}}}, 60, rows);
  assert.equal(metrics.workerOccupancyMs, 40);
  assert.equal(metrics.avoidedTaskOccupancyMs, 2000);
  assert.deepEqual(metrics.tasks, {completed: 2, passed: 1, executed: 1, reused: 1});
  assert.deepEqual(metrics.observedLaunches, {asc: 1, pack: 1, install: 1});
  assert.equal(metrics.workerCpuMs, null);
  assert.equal(metrics.peakProcessTreeRSSKiB, null);
  console.log('Release seal measurement: real launch observation and executed/reused accounting passed');
} finally { fs.rmSync(temporary, {recursive: true, force: true}); }
