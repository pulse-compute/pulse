'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCommand, canInspectDescendants } = require('../../../scripts/release-process.cjs');
const { createSealStatus } = require('../../../scripts/release-seal-status.cjs');
const { runTask } = require('../../scripts/run-wasm-tests.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (source, options = {}) => runCommand(process.execPath, ['-e', source], {
  timeoutMs: 3000, termGraceMs: 100, killGraceMs: 100, ...options
});
function alive(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux' && canInspectDescendants()) {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
    }
    return true;
  } catch (_) { return false; }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-seal-lifecycle-'));
  const reporters = [];
  const retained = [];
  try {
    const initial = { schemaVersion: 'pulse.release-seal.v1', sourceRevision: 'a'.repeat(40) };
    fs.writeFileSync(path.join(root, 'release-seal.json'), JSON.stringify({ status: 'passed', sourceRevision: 'b'.repeat(40) }));
    const reporter = createSealStatus({ resultsRoot: root, initial, heartbeatMs: 20, output() {} });
    reporters.push(reporter);
    const read = () => JSON.parse(fs.readFileSync(path.join(root, 'release-seal.json')));
    const starting = read();
    assert.equal(starting.status, 'running');
    assert.equal(starting.sourceRevision, initial.sourceRevision);
    reporter.persist({ currentStep: 'quiet-child' });
    await wait(65);
    assert(Date.parse(read().updatedAt) > Date.parse(starting.updatedAt));
    assert(read().durationMs >= 40);
    assert.equal(read().currentStep, 'quiet-child');
    const passed = await command('process.stdout.write("done")');
    assert.equal(passed.status, 0);
    reporter.finish({ status: 'passed', steps: [{ id: 'fixture', status: 'passed' }] });
    const terminal = fs.readFileSync(path.join(root, 'release-seal.json'), 'utf8');
    await wait(50);
    assert.equal(fs.readFileSync(path.join(root, 'release-seal.json'), 'utf8'), terminal, 'terminal receipt must stop changing');
    assert.equal(read().currentStep, null);
    assert(read().completedAt);

    const older = createSealStatus({ resultsRoot: root, initial, output() {} });
    const newer = createSealStatus({ resultsRoot: root, initial, output() {} });
    reporters.push(older, newer);
    older.finish({ status: 'failed' });
    assert.equal(read().runId, path.basename(newer.directory));
    assert.equal(JSON.parse(fs.readFileSync(path.join(older.directory, 'report.json'))).status, 'failed');
    newer.close();
    assert.equal(read().status, 'interrupted');

    assert.equal((await command('process.exit(7)')).status, 7);
    const missing = await runCommand(path.join(root, 'missing-command'), [], { timeoutMs: 500 });
    assert(missing.error);
    const controller = new AbortController();
    const interrupted = await command('process.stdout.write("ready"); setInterval(() => {}, 1000)', {
      signal: controller.signal,
      onOutput() { controller.abort('SIGINT'); }
    });
    assert.equal(interrupted.interruptedBy, 'SIGINT');
    assert.equal(interrupted.timedOut, false);

    const pidFile = path.join(root, 'descendant.pid');
    const started = Date.now();
    const timedOut = await command(`
      const { spawn } = require('node:child_process');
      // A cleanup worker started by TERM must also be included in escalation.
      process.on('SIGTERM', () => {
        const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { detached: ${canInspectDescendants()}, stdio: 'ignore' });
        require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
      });
      setInterval(() => {}, 1000);
    `, { timeoutMs: 700 });
    assert.equal(timedOut.timedOut, true);
    assert(Date.now() - started < 4000, 'stubborn process must have a bounded result');
    const descendant = Number(fs.readFileSync(pidFile));
    for (let i = 0; i < 20 && alive(descendant); i++) await wait(50);
    assert.equal(alive(descendant), false, 'owned descendant must not outlive timeout');

    const runDir = path.join(root, 'tasks-run');
    fs.mkdirSync(path.join(runDir, 'tasks'), { recursive: true });
    const cleanupStall = await runTask('cleanup-stall-fixture', {
      command: process.execPath, args: ['-e', 'process.exit(0)'],
      evidence: 'unit', description: 'successful task with deliberately stalled cleanup', timeoutMs: 3000
    }, {
      runDir, cleanupTimeoutMs: 200, cleanupGraceMs: 100,
      cleanupCommand: { command: process.execPath, args: ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'] }
    });
    if (cleanupStall.retainedTaskRoot) retained.push(cleanupStall.retainedTaskRoot);
    assert.equal(cleanupStall.status, 'failed');
    assert.match(cleanupStall.error, /cleanup.*deadline/);
    assert(cleanupStall.retainedTaskRoot);
    assert(cleanupStall.durationMs < 4000);
    console.log('ok - seal heartbeat and immutable terminal receipts; failure, interruption, stubborn owned descendants and stalled cleanup return bounded results');
  } finally {
    for (const reporter of reporters) reporter.close();
    for (const directory of retained) fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
