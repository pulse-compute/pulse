'use strict';

// Complete, fresh development selection; no release/checkpoint authority.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '../../..');
const out = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Usage: node docs/internal/b10-ci03/diagnose.cjs <new-output-directory>');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw Error('Diagnostic requires a clean candidate');
for (const key of ['PULSE_RELEASE_SHARED_PACK', 'PULSE_RELEASE_SHARED_PACK_SHA256']) {
  if (process.env[key]) throw Error('Run without shared-pack overrides');
}
fs.mkdirSync(out);
for (const name of ['phases', 'installed', 'resources']) fs.mkdirSync(path.join(out, name));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const phaseFile = path.join(root, 'wasm/test/support/phase-observer.cjs');
const tasks = ['jwt-rs256', 'jwt-installed-workflow'];
const args = ['wasm/scripts/run-wasm-tests.cjs', ...tasks.flatMap(task => ['--task', task]), '--report', path.join(out, 'tasks.json')];
const report = { status: 'running', source: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'),
  workingTree: '', controllerPid: process.pid, node: process.version, nodeSha256: hash(fs.readFileSync(process.execPath)),
  driverSha256: hash(fs.readFileSync(__filename)), observerSha256: hash(fs.readFileSync(phaseFile)),
  lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), tasks, args,
  startedAt: new Date().toISOString(),
  conditions: 'Serial complete JWT pair; warm dependency/tool caches; fresh package construction and private consumer; no checkpoint reuse; opt-in observer overhead included.' };
const save = () => fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
save();
const { runCommand } = require(path.join(root, 'scripts/release-process.cjs'));
const { startObserver } = require(path.join(root, 'scripts/release-resource-observer.cjs'));
async function main() {
  const observer = startObserver(process.pid, path.join(out, 'resources'), root);
  const log = fs.openSync(path.join(out, 'tasks.log'), 'wx');
  const start = performance.now();
  try {
    report.command = await runCommand(process.execPath, args, { cwd: root, timeoutMs: 1800000,
      env: { ...process.env, PULSEWASM_TEST_PHASE_DIR: path.join(out, 'phases'),
        PULSE_RELEASE_FEATURE_REPORT_DIR: path.join(out, 'installed'),
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${phaseFile}`.trim() },
      onOutput(_stream, chunk) { fs.writeSync(log, chunk); } });
    const terminal = JSON.parse(fs.readFileSync(path.join(out, 'tasks.json'), 'utf8'));
    report.coverage = { status: terminal.status, selected: terminal.selectedTasks,
      results: terminal.results.map(row => ({ name: row.name, status: row.status, durationMs: row.durationMs })) };
    if (report.command.status !== 0 || report.command.error || report.command.timedOut
      || terminal.status !== 'passed' || JSON.stringify(terminal.selectedTasks) !== JSON.stringify(tasks)
      || terminal.results.length !== tasks.length || terminal.results.some(row => row.status !== 'passed')) throw Error('Incomplete JWT selection');
    report.status = 'completed';
  } catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
  finally {
    report.elapsedMs = performance.now() - start;
    fs.closeSync(log); report.resources = await observer.stop();
    report.terminalWorkingTree = git('status', '--porcelain'); save();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
