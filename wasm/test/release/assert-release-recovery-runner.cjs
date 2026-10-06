'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, runSelectedTasks, checkpointDefinition, validateRecoveryConfig } = require('../../scripts/run-wasm-tests.cjs');
const { readCheckpointReceipt } = require('../../../scripts/release-checkpoints.cjs');

// These subprocesses exercise checkpoint execution and cleanup. They are not a
// substitute release task set and never emit a release seal or qualification.
const source = `
  const fs = require('node:fs');
  const [name, output, trace, failure, interrupt] = process.argv.slice(1);
  fs.appendFileSync(trace, name + '\\n');
  if (fs.existsSync(failure)) { console.error('deliberate late failure'); process.exit(9); }
  if (fs.existsSync(interrupt)) { console.log('waiting-for-interruption'); setInterval(() => {}, 1000); }
  else { fs.writeFileSync(output, name + '-output'); console.log(name + ' passed'); }
`;

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-recovery-runner-'));
  const retained = [];
  const trace = path.join(root, 'executions');
  const failure = path.join(root, 'late-failure');
  const interrupt = path.join(root, 'interrupt');
  const context = { fixture: 'real-subprocess-recovery', sourceRevision: 'a'.repeat(40), selectedTasks: ['first', 'second'] };
  const tasks = Object.fromEntries(['first', 'second'].map(name => [name, {
    command: process.execPath, args: [], evidence: 'unit', description: `checkpoint fixture ${name}`, timeoutMs: 3000
  }]));
  const selections = names => ({ requested: names, selected: names });
  const executed = () => fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n') : [];
  function runnerSubprocess(label, configContents, options = {}) {
    const directory = path.join(root, label);
    fs.mkdirSync(directory, { recursive: true });
    const configFile = path.join(directory, 'config.json');
    const reportFile = path.join(directory, 'report.json');
    if (configContents !== null) fs.writeFileSync(configFile, typeof configContents === 'string' ? configContents : JSON.stringify(configContents));
    const result = spawnSync(process.execPath, [...(options.preload ? ['--require', options.preload] : []),
      path.resolve(__dirname, '../../scripts/run-wasm-tests.cjs'), '--task', 'api-surface',
      '--recovery-config', configFile, '--report', reportFile], { encoding: 'utf8', timeout: 10000 });
    assert(!result.error, result.error?.message);
    assert.notEqual(result.status, 0, 'invalid or interrupted runner must exit nonzero');
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    assert.equal(report.status, options.status || 'failed');
    assert(report.finishedAt, 'runner error must produce a terminal report');
    assert.equal(report.currentTask, null);
    assert.equal(report.currentTaskPhase, null);
    assert.equal(report.activeChildPid, null);
    assert.equal(report.completedTasks, 0);
    assert.deepEqual(report.results, []);
    assert.deepEqual(report.requestedTasks, ['api-surface']);
    assert.deepEqual(report.selectedTasks, ['api-surface']);
    return report;
  }
  async function attempt(label, previous = null, options = {}) {
    const directory = path.join(root, label);
    const runDir = path.join(directory, 'run');
    fs.mkdirSync(path.join(runDir, 'tasks'), { recursive: true });
    const selected = options.names || ['first', 'second'];
    const taskOptions = Object.fromEntries(selected.map(name => {
      const output = path.join(directory, `${name}.txt`);
      return [name, { args: ['-e', source, name, output, trace,
        name === 'second' ? failure : path.join(root, 'never-fail'), interrupt], artifacts: { output } }];
    }));
    const config = {
      schemaVersion: 'pulse.seal-task-recovery.v1', context: { ...context, selectedTasks: selected },
      directory: path.join(directory, 'checkpoints'), previousDirectory: previous?.config.directory,
      selectedTasks: selected, dependencies: options.dependencies || { 'shared-pack': 'fixture-pack-proof' }, taskOptions
    };
    const state = { results: [], runDir, sourceEnv: {}, currentTask: null, currentTaskPhase: null };
    await runSelectedTasks({ state, selection: selections(selected), taskMap: options.tasks || tasks,
      recoveryConfig: config, signal: options.signal, onChild: options.onChild, taskRunOptions: options.taskRunOptions });
    for (const result of state.results) if (result.retainedTaskRoot) retained.push(result.retainedTaskRoot);
    return { state, config };
  }
  try {
    for (const forbidden of [['--from', 'first'], ['--through', 'first'], ['--no-report']]) {
      assert.throws(() => parseArgs(['--recovery-config', path.join(root, 'config.json'), ...forbidden]), /complete selection/);
    }
    assert.throws(() => validateRecoveryConfig({ schemaVersion: 'pulse.seal-task-recovery.v1', selectedTasks: ['first'] }, selections(['first', 'second'])), /selection differs/);
    assert.throws(() => validateRecoveryConfig({ schemaVersion: 'pulse.seal-task-recovery.v1', kind: 'release', selectedTasks: ['api-surface'],
      context: { schemaVersion: 'pulse.release-recovery.v1', selections: { release: ['api-surface'] } } }, selections(['api-surface'])), /current required task set/);
    assert(runnerSubprocess('malformed-config', '{broken-json').error.message);
    assert.equal(runnerSubprocess('missing-config', null).error.code, 'ENOENT');
    const blockedStore = path.join(root, 'not-a-store-directory');
    fs.writeFileSync(blockedStore, 'ordinary file');
    const runnerConfig = { schemaVersion: 'pulse.seal-task-recovery.v1', context: { fixture: 'runner-terminal-errors' },
      selectedTasks: ['api-surface'], directory: blockedStore, taskOptions: {} };
    assert(runnerSubprocess('blocked-store', runnerConfig).error.message);

    // Signal deterministically after main installs its handler, while reading
    // recovery configuration and before any selected task may start.
    const preload = path.join(root, 'interrupt-before-first.cjs');
    const earlyConfig = path.join(root, 'early-interruption', 'config.json');
    fs.writeFileSync(preload, `const fs = require('node:fs'); const read = fs.readFileSync;
      fs.readFileSync = function(file, ...args) {
        const value = read.call(this, file, ...args);
        if (file === ${JSON.stringify(earlyConfig)}) process.emit('SIGTERM');
        return value;
      };`);
    runnerSubprocess('early-interruption', { ...runnerConfig, directory: path.join(root, 'early-store') }, { preload, status: 'interrupted' });

    fs.writeFileSync(failure, 'fail this external fixture attempt');
    const initial = await attempt('initial');
    assert.deepEqual(initial.state.results.map(result => result.status), ['passed', 'failed']);
    assert.deepEqual(executed(), ['first', 'second']);
    const firstReceipt = fs.readFileSync(initial.state.results[0].checkpoint.receiptPath);
    fs.rmSync(failure);
    const resumed = await attempt('resumed', initial);
    assert.deepEqual(resumed.state.results.map(result => result.status), ['passed', 'passed']);
    assert.deepEqual(resumed.state.results.map(result => result.execution), ['reused', 'executed']);
    assert.deepEqual(executed(), ['first', 'second', 'second'], 'only the failed task should execute on resume');
    assert.equal(resumed.state.results[0].checkpoint.proofId, initial.state.results[0].checkpoint.proofId);
    assert.equal(resumed.state.results[0].originalResult.status, 'passed');
    assert.equal(resumed.state.results[0].durationMs, 0);
    assert.deepEqual(fs.readFileSync(initial.state.results[0].checkpoint.receiptPath), firstReceipt, 'resumption cannot rewrite the original attempt');
    for (const result of resumed.state.results) {
      assert.equal(fs.readFileSync(resumed.config.taskOptions[result.name].artifacts.output, 'utf8'), `${result.name}-output`);
      const receipt = readCheckpointReceipt({ receiptPath: result.checkpoint.receiptPath, context,
        definition: checkpointDefinition(result.name, tasks[result.name], resumed.config.taskOptions[result.name]), dependencies: resumed.config.dependencies });
      assert.equal(receipt.receipt.id, `task:${result.name}`);
    }

    const changed = await attempt('changed-definition', resumed, { tasks: { ...tasks, first: { ...tasks.first, timeoutMs: 4000 } } });
    assert.deepEqual(changed.state.results.map(result => result.execution), ['executed', 'reused']);
    assert.match(changed.state.results[0].recoveryReason, /definition changed/);
    const dependency = await attempt('changed-dependency', resumed, { dependencies: { 'shared-pack': 'replacement-pack-proof' } });
    assert.deepEqual(dependency.state.results.map(result => result.execution), ['executed', 'executed']);
    assert(dependency.state.results.every(result => /dependency proof changed/.test(result.recoveryReason)));

    // The live destination is restorable. Losing retained evidence, however,
    // invalidates the checkpoint and reruns its owning task.
    const checkpointFile = resumed.state.results[0].checkpoint.receiptPath;
    const checkpointKey = path.basename(checkpointFile, '.json');
    fs.rmSync(path.join(path.dirname(checkpointFile), checkpointKey, 'output'));
    const missing = await attempt('missing-retained-output', resumed);
    assert.deepEqual(missing.state.results.map(result => result.execution), ['executed', 'reused']);
    assert.match(missing.state.results[0].recoveryReason, /missing-checkpoint-or-artifact/);

    const failedCleanup = await attempt('failed-cleanup', null, { names: ['first'], taskRunOptions: {
      cleanupCommand: { command: process.execPath, args: ['-e', 'process.exit(7)'] }, cleanupTimeoutMs: 1000
    } });
    assert.equal(failedCleanup.state.results[0].status, 'failed');
    assert.equal(failedCleanup.state.results[0].cleanup.status, 'failed');
    const afterCleanup = await attempt('after-cleanup', failedCleanup, { names: ['first'] });
    assert.equal(afterCleanup.state.results[0].execution, 'executed');
    assert.equal(afterCleanup.state.results[0].status, 'passed');

    const write = fs.writeFileSync;
    let diskFailure;
    try {
      fs.writeFileSync = function(file, ...args) {
        if (String(file).startsWith(path.join(root, 'receipt-write-failure', 'checkpoints')) && String(file).endsWith('.tmp')) {
          throw Object.assign(new Error('fixture disk full writing checkpoint receipt'), { code: 'ENOSPC' });
        }
        return write.call(this, file, ...args);
      };
      diskFailure = await attempt('receipt-write-failure', null, { names: ['first'] });
    } finally { fs.writeFileSync = write; }
    assert.equal(diskFailure.state.results[0].status, 'failed');
    assert.match(diskFailure.state.results[0].error, /disk full/);
    assert.match(diskFailure.state.results[0].checkpointError, /already recorded/);
    assert.equal(diskFailure.state.results[0].checkpoint, undefined);

    fs.writeFileSync(interrupt, 'interrupt this external fixture attempt');
    const controller = new AbortController();
    const interrupted = await attempt('interrupted', null, { names: ['first'], signal: controller.signal,
      onChild(child) { child?.stdout.once('data', () => controller.abort('SIGTERM')); } });
    assert.equal(interrupted.state.results[0].status, 'interrupted');
    fs.rmSync(interrupt);
    const afterInterruption = await attempt('after-interruption', interrupted, { names: ['first'] });
    assert.equal(afterInterruption.state.results[0].execution, 'executed');
    assert.equal(afterInterruption.state.results[0].status, 'passed');
    await require('./assert-release-parallel.cjs').verifyParallel();
    console.log('ok - real task recovery preserves late failures, changed inputs, lost outputs, interruption and failed cleanup; malformed configuration and checkpoint disk errors terminalize without invented passes');
  } finally {
    for (const directory of retained) fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

let terminal = false;
process.once('beforeExit', () => {
  if (!terminal) {
    console.error('Runner recovery fixture ended without completing its assertions');
    process.exitCode = 1;
  }
});
main().then(() => { terminal = true; }, error => { terminal = true; console.error(error.stack || error); process.exitCode = 1; });
