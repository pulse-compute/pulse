'use strict';
// One representative A/B sample, not a seal or a new aggregate gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runCommand, canInspectDescendants } = require('../../../scripts/release-process.cjs');
const recovery = require('../../../scripts/release-recovery.cjs');
const workers = require('../../../scripts/release-parallel.cjs');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const { sharedPackEnv } = require('../../../scripts/release-shared-pack.cjs');
const root = path.resolve(__dirname, '../../..');
const names = ['cli-project-workflow', 'cli-schema-json-workflow', 'events-cli-workflow', 'bounded-app-logic'];
function treeRSS(pid) {
  if (process.platform !== 'linux' || !canInspectDescendants()) return null;
  const rows = [];
  for (const name of fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const rss = Number(fs.readFileSync(`/proc/${name}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1]) || 0;
      rows.push({ pid: Number(name), parent: Number(fields[1]), rss });
    } catch (_) { /* exited between samples */ }
  }
  const owned = new Set([pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const item of rows) if (owned.has(item.parent) && !owned.has(item.pid)) { owned.add(item.pid); changed = true; }
  }
  return rows.filter(item => owned.has(item.pid)).reduce((sum, item) => sum + item.rss, 0);
}
async function main() {
  const candidate = candidateIdentity(root);
  const out = path.join(root, '.pulse-seal/measurements/ps05-cluster');
  assert(!fs.existsSync(out), 'Never overwrite a completed or failed sample');
  fs.mkdirSync(out, { recursive: true });
  const packageDirectory = path.join(out, 'packages');
  const pack = await runCommand(process.execPath, ['scripts/release-shared-pack.cjs', '--out', packageDirectory], { cwd: root, timeoutMs: 600000,
    onOutput(name, bytes) { process[name].write(bytes); } });
  assert.equal(pack.status, 0);
  const env = { ...process.env, ...sharedPackEnv(packageDirectory) }, results = [];
  try {
    for (const count of [1, 4]) {
      const options = { install: false, requireFastly: false, workers: count, memoryBudgetMiB: 6144 };
      const setupStarted = Date.now();
      if (count > 1) {
        const setup = await runCommand(process.execPath, ['scripts/release-parallel.cjs', root, String(count), String(options.memoryBudgetMiB)],
          { cwd: root, timeoutMs: 600000, onOutput(name, bytes) { process[name].write(bytes); } });
        assert.equal(setup.status, 0, 'Worker setup failed');
      }
      const setupMs = Date.now() - setupStarted;
      const context = { ...recovery.createContext(root, candidate, options, { status: 'unavailable' }), schemaVersion: 'pulse.ps05-development.v1' };
      const directory = path.join(out, String(count)), reportFile = path.join(directory, 'tasks.json');
      const config = { schemaVersion: 'pulse.seal-task-recovery.v1', context, selectedTasks: names,
        directory: path.join(directory, 'checkpoints'), taskOptions: {}, dependencies: { 'shared-pack': env.PULSE_RELEASE_SHARED_PACK_SHA256 } };
      const configFile = path.join(directory, 'config.json'); recovery.atomicJson(configFile, config);
      let childPid, peak = null;
      const sample = () => { if (childPid) { const value = treeRSS(childPid); if (value !== null) peak = Math.max(peak || 0, value); } };
      const timer = setInterval(sample, 200), started = Date.now();
      const log = fs.openSync(path.join(directory, 'runner.log'), 'w');
      let execution;
      try {
        execution = await runCommand(process.execPath, ['wasm/scripts/run-wasm-tests.cjs', ...names.flatMap(name => ['--task', name]),
          '--report', reportFile, '--recovery-config', configFile], { cwd: root, env, timeoutMs: 15 * 60 * 1000,
          onChild(child) { childPid = child.pid; sample(); }, onOutput(name, bytes) { fs.writeSync(log, bytes); process[name].write(bytes); } });
      } finally { clearInterval(timer); fs.closeSync(log); }
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      assert.equal(execution.status, 0); assert.equal(report.status, 'passed');
      assert.deepEqual(report.results.map(item => [item.name, item.status, item.execution]), names.map(name => [name, 'passed', 'executed']));
      assert.deepEqual(candidateIdentity(root), candidate);
      assert.deepEqual({ ...recovery.createContext(root, candidate, options, { status: 'unavailable' }), schemaVersion: context.schemaVersion },
        context, 'Source, dependency or build inputs changed during the sample');
      const result = { workers: count, setupMs, wallMs: Date.now() - started, peakSummedRSSKiB: peak,
        report: reportFile, reportSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(reportFile)).digest('hex') };
      results.push(result); recovery.atomicJson(path.join(directory, 'measurement.json'), result);
    }
    const [serial, parallel] = results;
    const comparison = { schemaVersion: 'pulse.ps05-scheduling-sample.v1', candidate, node: process.version,
      availableParallelism: os.availableParallelism(), tasks: names, results,
      rssDefinition: '200 ms samples of summed descendant-process RSS; shared pages may be counted more than once. Null when PID inspection is unavailable.',
      speedup: serial.wallMs / parallel.wallMs, withSetupSpeedup: serial.wallMs / (parallel.wallMs + parallel.setupMs),
      memoryBudgetMiB: 6144, memoryWithinBudget: parallel.peakSummedRSSKiB === null ? null : parallel.peakSummedRSSKiB <= 6144 * 1024,
      scope: 'Single representative development sample, serial first; no full-seal speedup or release claim' };
    recovery.atomicJson(path.join(out, 'comparison.json'), comparison);
    console.log(JSON.stringify(comparison, null, 2));
    assert(comparison.withSetupSpeedup > 1, 'Parallel execution did not repay workspace setup');
    assert.notEqual(comparison.memoryWithinBudget, false, 'Sample exceeded the configured RSS budget');
  } finally { workers.cleanupWorkspaces(root, candidate.sourceTree, 4); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { treeRSS, names };
