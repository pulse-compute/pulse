#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  REPORT_SCHEMA,
  parseArgs,
  selectedTasks,
  writeReportAtomic,
  runTask
} = require('../../scripts/run-wasm-tests.cjs');

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    if (process.platform !== 'win32') {
      const status = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2];
      return status !== 'Z';
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function waitForProcessExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(processAlive(pid), false, `descendant process ${pid} survived task timeout cleanup`);
}

function processGroupInspectionAvailable() {
  if (process.platform === 'win32') return false;
  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,pgid=,sid=,stat=,etime=,command='], {
    encoding: 'utf8',
    timeout: 5000
  });
  return result.status === 0;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-test-orchestration-'));
  const runDir = path.join(root, 'run');
  fs.mkdirSync(path.join(runDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'diagnostics'), { recursive: true });
  try {
    const reportPath = path.join(root, 'report.json');
    writeReportAtomic(reportPath, { schemaVersion: REPORT_SCHEMA, status: 'running', currentTask: 'fixture' });
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), { schemaVersion: REPORT_SCHEMA, status: 'running', currentTask: 'fixture' });
    assert.equal(fs.existsSync(`${reportPath}.tmp-${process.pid}`), false, 'atomic report temporary file must not survive the rename');

    assert.throws(() => parseArgs(['--profile', '--task', 'static']), /--profile requires a value/);

    const ranged = selectedTasks({ profiles: ['unit'], tasks: [], fromTask: 'boundaries', throughTask: 'hidden-contracts' });
    assert.deepEqual(ranged.selected, ['boundaries', 'workspace-hygiene', 'hidden-contracts']);

    const passed = await runTask('orchestration-pass-fixture', {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("fixture-pass\\n")'],
      timeoutMs: 5000,
      evidence: 'unit',
      description: 'orchestration pass fixture'
    }, { runDir });
    assert.equal(passed.status, 'passed');
    assert.equal(passed.exitCode, 0);
    assert.ok(passed.logPath && fs.readFileSync(path.resolve(path.dirname(__dirname), '..', '..', passed.logPath), 'utf8').includes('fixture-pass'));
    assert.deepEqual(passed.failureArtifacts, []);

    const failed = await runTask('orchestration-failure-evidence-fixture', {
      command: process.execPath,
      args: ['-e', [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const file = path.join(process.env.PULSEWASM_TEST_TMP_ROOT, 'pack-cache', '_logs', 'npm-debug.log');",
        "fs.mkdirSync(path.dirname(file), { recursive: true });",
        "fs.writeFileSync(file, 'fixture npm failure evidence\\n');",
        'process.exit(7);'
      ].join('\n')],
      timeoutMs: 5000,
      evidence: 'unit',
      description: 'orchestration failure evidence fixture'
    }, { runDir });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.exitCode, 7);
    assert.equal(failed.failureArtifacts.length, 1);
    assert.match(failed.failureArtifacts[0], /task-root-logs\/pack-cache\/_logs\/npm-debug\.log$/);
    assert.equal(
      fs.readFileSync(path.resolve(path.dirname(__dirname), '..', '..', failed.failureArtifacts[0]), 'utf8'),
      'fixture npm failure evidence\n'
    );

    const descendantPidFile = path.join(root, 'descendant.pid');
    const source = [
      "const fs = require('node:fs');",
      "const { spawn } = require('node:child_process');",
      `const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });`,
      `fs.writeFileSync(${JSON.stringify(descendantPidFile)}, String(child.pid));`,
      "process.stdout.write('fixture-timeout-ready\\n');",
      'setInterval(() => {}, 1000);'
    ].join('\n');
    const timedOut = await runTask('orchestration-timeout-fixture', {
      command: process.execPath,
      args: ['-e', source],
      timeoutMs: 1200,
      evidence: 'unit',
      description: 'orchestration timeout and descendant cleanup fixture'
    }, { runDir });
    assert.equal(timedOut.status, 'timeout');
    assert.equal(timedOut.exitCode, 124);
    assert.ok(
      timedOut.processTree.length >= 1 || !processGroupInspectionAvailable(),
      'timeout result must preserve a process-group snapshot when process inspection is available'
    );
    assert.deepEqual(timedOut.remainingProcessTree, [], 'timeout cleanup must leave no process-group members');
    assert.ok(timedOut.diagnosticReports.length >= 1, 'timeout must request a Node diagnostic report before termination');
    const descendantPid = Number(fs.readFileSync(descendantPidFile, 'utf8'));
    await waitForProcessExit(descendantPid);

    console.log('ok - test orchestration writes atomic reports, slices profiles deterministically, preserves task and failure logs, captures timeout diagnostics, and terminates descendant process groups');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
