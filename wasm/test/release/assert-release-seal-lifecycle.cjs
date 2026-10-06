'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
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

async function verifyBootstrap(root) {
  const candidateRoot = path.join(root, 'candidate');
  fs.mkdirSync(candidateRoot);
  fs.writeFileSync(path.join(candidateRoot, 'source'), 'clean');
  const git = args => execFileSync('git', args, { cwd: candidateRoot, stdio: 'pipe' });
  git(['init', '-q']);
  git(['add', 'source']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const identity = { sourceRevision: git(['rev-parse', 'HEAD']).toString().trim(), sourceIdentityKind: 'git-commit' };
  const supervisor = require('../../../scripts/release-process.cjs');
  const statusOwner = require('../../../scripts/release-seal-status.cjs');
  const recovery = require('../../../scripts/release-recovery.cjs');
  const sourceModule = require.resolve('../../../scripts/source-identity.cjs');
  const sourceExports = require(sourceModule);
  const sourceOwner = { ...sourceExports };
  const acceptance = require('../../../scripts/release-feature-acceptance.cjs');
  const fastlyModule = require.resolve('../../../packages/provider-fastly/src/testing/fastly-cli.js');
  const fastlyExports = require(fastlyModule);
  const fastly = { ...fastlyExports };
  const sealModule = require.resolve('../../../scripts/validate-release.cjs');
  const original = { run: supervisor.runCommand, create: statusOwner.createSealStatus,
    acquire: recovery.acquireSealLock,
    source: sourceOwner.resolveSourceIdentity, candidate: acceptance.candidateIdentity,
    fastly: fastly.inspectFastlyCli, load: Module._load, mkdtemp: fs.mkdtempSync,
    now: Date.now, node: Object.getOwnPropertyDescriptor(process.versions, 'node'), write: process.stdout.write };
  let calls, lastReport;
  const unavailable = () => { throw Object.assign(new Error('Fixture CLI unavailable'), { code: 'PULSE_FASTLY_CLI_UNAVAILABLE' }); };
  async function attempt(args, configure = () => {}) {
    // Exercise real ownership in a private fixture, outside the candidate tree.
    recovery.acquireSealLock = (_root, directory) => original.acquire(path.join(root, 'bootstrap-lock-owner'), directory);
    calls = [];
    lastReport = null;
    sourceOwner.resolveSourceIdentity = () => identity;
    require.cache[sourceModule].exports = sourceOwner;
    acceptance.candidateIdentity = () => original.candidate(candidateRoot);
    fastly.inspectFastlyCli = unavailable;
    require.cache[fastlyModule].exports = fastly;
    supervisor.runCommand = async (command, argv, options) => {
      if (argv[0] === '-e') return original.run(command, argv, options); // actual cleanup
      calls.push({ command, argv, timeoutMs: options.timeoutMs });
      return { status: 23, signal: null }; // never execute product work or install
    };
    statusOwner.createSealStatus = options => {
      const reporter = original.create({ ...options, resultsRoot: path.join(root, 'bootstrap-reports'),
        attemptsRoot: path.join(root, 'bootstrap-reports/seal-runs'), output() {} });
      const finish = reporter.finish;
      reporter.finish = updates => { lastReport = finish(updates); return lastReport; };
      return reporter;
    };
    Object.defineProperty(process.versions, 'node', { ...original.node, value: '24.0.0' });
    process.stdout.write = () => true;
    // Model an absent dependency graph: every external/workspace package load
    // fails, even if this developer checkout happens to have node_modules.
    Module._load = function(request, ...rest) {
      if (/(?:release-shared-pack|pack-release|documentation-release)\.cjs$/.test(request)) {
        throw new Error(`Cold bootstrap loaded dependency-backed ${request}`);
      }
      if (!request.startsWith('.') && !path.isAbsolute(request) && !Module.isBuiltin(request)) {
        throw new Error(`Cold bootstrap loaded dependency ${request}`);
      }
      return original.load.call(this, request, ...rest);
    };
    try {
      configure();
      delete require.cache[sealModule];
      const seal = require(sealModule);
      await assert.rejects(() => seal.main(args));
      assert(lastReport?.completedAt, 'setup failure needs a terminal receipt');
      assert.notEqual(lastReport.status, 'running');
      if (lastReport.runDirectory) {
        const file = path.join(lastReport.runDirectory, 'report.json');
        const terminal = fs.readFileSync(file, 'utf8');
        await wait(20);
        assert.equal(fs.readFileSync(file, 'utf8'), terminal, 'setup terminal receipt must stop changing');
      }
      return lastReport;
    } finally {
      supervisor.runCommand = original.run;
      recovery.acquireSealLock = original.acquire;
      statusOwner.createSealStatus = original.create;
      require.cache[sourceModule].exports = sourceExports;
      acceptance.candidateIdentity = original.candidate;
      require.cache[fastlyModule].exports = fastlyExports;
      Module._load = original.load;
      fs.mkdtempSync = original.mkdtemp;
      Date.now = original.now;
      Object.defineProperty(process.versions, 'node', original.node);
      process.stdout.write = original.write;
      delete require.cache[sealModule];
    }
  }
  const cold = await attempt([]);
  assert.equal(cold.steps[0].id, 'dependencies');
  assert.equal(cold.steps[0].status, 'failed');
  assert.equal(calls.length, 1);
  assert(calls[0].argv.includes('--frozen-lockfile') && calls[0].argv.includes('--ignore-scripts'));
  assert.equal(cold.cleanup.status, 'passed');

  const node = await attempt([], () => Object.defineProperty(process.versions, 'node', { ...original.node, value: '22.14.0' }));
  assert.equal(node.error.code, 'PULSE_RELEASE_NODE_RANGE_MISMATCH');
  assert.equal(node.sourceRevision, null);
  assert.equal(node.cleanup.status, 'not-needed');
  assert.equal(calls.length, 0);
  const source = await attempt([], () => { sourceOwner.resolveSourceIdentity = () => { throw new Error('Fixture invalid source'); }; });
  assert.match(source.error.message, /invalid source/);
  assert.equal(calls.length, 0);

  fs.writeFileSync(path.join(candidateRoot, 'source'), 'dirty');
  const dirty = await attempt([]);
  assert.match(dirty.error.message, /clean candidate checkout/);
  assert.equal(calls.length, 0);
  git(['checkout', '--', 'source']);
  const mismatch = await attempt([], () => { sourceOwner.resolveSourceIdentity = () => ({ ...identity, sourceRevision: 'f'.repeat(40) }); });
  assert.equal(mismatch.error.code, 'PULSE_RELEASE_SOURCE_MISMATCH');
  assert.equal(calls.length, 0);
  const required = await attempt(['--require-fastly']);
  assert.equal(required.error.code, 'PULSE_FASTLY_CLI_UNAVAILABLE');
  assert.equal(required.externalFastly.status, 'unavailable');
  assert.equal(calls.length, 0);
  const bundle = await attempt(['--dependency-bundle', path.join(root, 'absent.tar.zst')]);
  assert.equal(bundle.error.code, 'ENOENT');
  assert.equal(calls.length, 0);
  const allocation = await attempt([], () => {
    fs.mkdtempSync = (prefix, ...args) => {
      if (String(prefix).includes('pulse-release-seal-package-manager-')) throw new Error('Fixture temporary allocation failed');
      return original.mkdtemp(prefix, ...args);
    };
  });
  assert.match(allocation.error.message, /allocation failed/);
  assert.equal(allocation.cleanup.status, 'not-needed');
  assert.equal(calls.length, 0);

  const signal = await attempt([], () => {
    fs.mkdtempSync = (prefix, ...args) => {
      const directory = original.mkdtemp(prefix, ...args);
      if (String(prefix).includes('pulse-release-seal-package-manager-')) process.emit('SIGTERM');
      return directory;
    };
  });
  assert.equal(signal.status, 'interrupted');
  assert.equal(signal.interruption, 'SIGTERM');
  assert.equal(signal.cleanup.status, 'passed');
  assert.equal(calls.length, 0);

  const timeout = await attempt([], () => {
    supervisor.runCommand = async (command, argv, options) => {
      if (argv[0] === '-e') return original.run(command, argv, options);
      calls.push({ argv, timeoutMs: options.timeoutMs });
      Date.now = () => original.now() + 56 * 60 * 1000;
      return { status: 0, signal: null };
    };
  });
  assert.equal(timeout.error.code, 'PULSE_RELEASE_SEAL_DEADLINE');
  assert.equal(timeout.status, 'failed');
  assert.equal(timeout.steps[0].status, 'passed');
  assert.equal(calls.length, 1, 'no new step may start after the parent deadline');
  assert.equal(timeout.cleanup.status, 'passed');

  const changed = await attempt(['--skip-install'], () => {
    supervisor.runCommand = async (command, argv, options) => {
      if (argv[0] === '-e') return original.run(command, argv, options);
      calls.push({ argv });
      if (argv.includes('docs:check')) fs.writeFileSync(path.join(candidateRoot, 'source'), 'changed during checks');
      return { status: 0, signal: null };
    };
  });
  assert.match(changed.error.message, /clean candidate checkout/);
  assert(!calls.some(call => call.argv.includes('scripts/release-shared-pack.cjs')));
  git(['checkout', '--', 'source']);
  const before = fs.readdirSync(path.join(root, 'bootstrap-reports', 'seal-runs'));
  const noReport = await attempt(['--no-report', '--require-fastly']);
  assert.equal(noReport.runDirectory, null);
  assert.deepEqual(fs.readdirSync(path.join(root, 'bootstrap-reports', 'seal-runs')), before);

  const seal = require(sealModule);
  assert.equal(seal.parseArgs([]).timeoutMs, 55 * 60 * 1000);
  assert.equal(seal.parseArgs(['--timeout-minutes', '2']).timeoutMs, 120000);
  for (const value of ['0', '-1', '1.5', '1441', 'bad']) assert.throws(() => seal.parseArgs(['--timeout-minutes', value]), /integer/);
  const controller = new AbortController();
  const deadline = seal.createDeadline(controller, 100);
  try {
    assert(deadline.remaining() <= 100);
    const child = await command('setInterval(() => {}, 1000)', { signal: controller.signal });
    assert.equal(child.interruptedBy, 'deadline');
    assert.throws(() => deadline.remaining(), error => error.code === 'PULSE_RELEASE_SEAL_DEADLINE');
  } finally { deadline.close(); }
  console.log('ok - dependency-free seal reaches restoration; setup failures terminalize; clean candidate and required tools fail early; parent deadline cancels work and preserves cleanup');
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-seal-lifecycle-'));
  const reporters = [];
  const retained = [];
  try {
    await verifyBootstrap(root);
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
    let observedPid;
    const observerFailure = await command('setInterval(() => {}, 1000)', {
      onChild(child) {
        if (child) { observedPid = child.pid; throw new Error('fixture lock write failure'); }
      }
    });
    assert.match(observerFailure.error.message, /lock write failure/);
    assert.equal(observerFailure.interruptedBy, 'child-observer-error');
    assert.equal(observerFailure.timedOut, false);
    assert(!alive(observedPid), 'failed lock persistence must terminate the spawned child');
    const earlyController = new AbortController();
    const earlyInterruption = await command('setInterval(() => {}, 1000)', {
      signal: earlyController.signal,
      onChild(child) { if (child) { observedPid = child.pid; earlyController.abort('SIGINT'); } }
    });
    assert.equal(earlyInterruption.interruptedBy, 'SIGINT');
    assert.equal(earlyInterruption.timedOut, false);
    assert(!alive(observedPid), 'onChild cancellation must reach the spawned child');
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
