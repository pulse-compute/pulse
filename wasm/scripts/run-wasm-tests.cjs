#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { wasmRoot, tasks, profiles, expandProfile } = require('../test/suite/registry.cjs');
const {
  cleanupRecordedWorkspacePackageBuilds
} = require('../test/support/workspace-package-build.cjs');
const { resolveSourceIdentity, sourceIdentityEnv } = require('../../scripts/source-identity.cjs');

const REPORT_SCHEMA = 2;
const TIMEOUT_EXIT = 124;
const INTERRUPT_EXIT = Object.freeze({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 });
const DIAGNOSTIC_SIGNAL = 'SIGUSR2';
const DIAGNOSTIC_GRACE_MS = 750;
const TERMINATION_GRACE_MS = 4000;
const KILL_GRACE_MS = 1000;

function parseArgs(argv) {
  const out = { profiles: [], tasks: [], report: true, json: false, list: false };
  const readValue = (index, option) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('-')) throw new Error(`${option} requires a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--profile' || token === '-p') { out.profiles.push(readValue(i, token)); i += 1; continue; }
    if (token.startsWith('--profile=')) { out.profiles.push(token.slice(10)); continue; }
    if (token === '--task' || token === '-t') { out.tasks.push(readValue(i, token)); i += 1; continue; }
    if (token.startsWith('--task=')) { out.tasks.push(token.slice(7)); continue; }
    if (token === '--from') { out.fromTask = readValue(i, token); i += 1; continue; }
    if (token.startsWith('--from=')) { out.fromTask = token.slice(7); continue; }
    if (token === '--through') { out.throughTask = readValue(i, token); i += 1; continue; }
    if (token.startsWith('--through=')) { out.throughTask = token.slice(10); continue; }
    if (token === '--list') { out.list = true; continue; }
    if (token === '--json') { out.json = true; continue; }
    if (token === '--no-report') { out.report = false; continue; }
    if (token === '--report') { out.reportPath = readValue(i, token); i += 1; continue; }
    if (token.startsWith('--report=')) { out.reportPath = token.slice(9); continue; }
    if (token === '--help' || token === '-h') { out.help = true; continue; }
    if (profiles[token]) { out.profiles.push(token); continue; }
    if (tasks[token]) { out.tasks.push(token); continue; }
    throw new Error(`Unknown PulseWasm test selection: ${token}`);
  }
  return out;
}

function usage() {
  return [
    'Usage: node ./scripts/run-wasm-tests.cjs [profile|task ...] [options]',
    '',
    'Options:',
    '  --profile, -p <name>  select a truth profile',
    '  --task, -t <name>     select a single task',
    '  --from <task>         start a selected profile at this task',
    '  --through <task>      stop a selected profile after this task',
    '  --list                list profiles and tasks',
    '  --json                emit final summary as JSON',
    '  --report <path>       write an atomic incremental JSON report',
    '  --no-report           do not write task logs or a report',
    '',
    `Profiles: ${Object.keys(profiles).sort().join(', ')}`,
    `Tasks: ${Object.keys(tasks).sort().join(', ')}`
  ].join('\n');
}

function selectedTasks(options) {
  const names = [];
  const selectedProfiles = options.profiles.length ? options.profiles : (options.tasks.length ? [] : ['release']);
  for (const profile of selectedProfiles) names.push(...expandProfile(profile));
  names.push(...options.tasks);
  const requested = [...new Set(names)];
  if (requested.length === 0) return Object.freeze({ requested, selected: requested });

  let start = 0;
  let end = requested.length - 1;
  if (options.fromTask) {
    start = requested.indexOf(options.fromTask);
    if (start < 0) throw new Error(`--from task is not in the selected run: ${options.fromTask}`);
  }
  if (options.throughTask) {
    end = requested.indexOf(options.throughTask);
    if (end < 0) throw new Error(`--through task is not in the selected run: ${options.throughTask}`);
  }
  if (end < start) throw new Error(`--through task ${options.throughTask} occurs before --from task ${options.fromTask}`);
  return Object.freeze({ requested, selected: requested.slice(start, end + 1) });
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function runIdentifier() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}--${process.pid}`;
}

function commandSignature(task) {
  return createHash('sha256').update(JSON.stringify({ command: task.command, args: task.args, timeoutMs: task.timeoutMs, evidence: task.evidence })).digest('hex');
}

function writeReportAtomic(target, report) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

function createRunPaths(options, runId) {
  if (!options.report) return Object.freeze({ reportPath: null, runDir: null });
  const reportPath = path.resolve(wasmRoot, options.reportPath || '.test-results/last-run.json');
  const runDir = path.join(path.dirname(reportPath), 'runs', runId);
  fs.mkdirSync(path.join(runDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'diagnostics'), { recursive: true });
  return Object.freeze({ reportPath, runDir });
}

function relativeToWasm(file) {
  if (!file) return null;
  const relative = path.relative(wasmRoot, file).replace(/\\/g, '/');
  return relative.startsWith('../') ? file : relative;
}

function copyTaskFailureLogs(sourceRoot, diagnosticsDir) {
  const targetRoot = path.join(diagnosticsDir, 'task-root-logs');
  const copied = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(source);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
      const relative = path.relative(sourceRoot, source);
      const target = path.join(targetRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      copied.push(target);
    }
  };
  visit(sourceRoot);
  return copied.sort((left, right) => left.localeCompare(right));
}

function processGroupRows(groupId) {
  if (process.platform === 'win32' || !Number.isInteger(groupId)) return [];
  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,pgid=,sid=,stat=,etime=,command='], { encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) {
    if (process.platform !== 'linux') return [];
    const rows = [];
    let entries;
    try { entries = fs.readdirSync('/proc', { withFileTypes: true }); }
    catch (_) { return rows; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const pid = Number(entry.name);
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const close = stat.lastIndexOf(')');
        if (close < 0) continue;
        const commandName = stat.slice(stat.indexOf('(') + 1, close);
        const fields = stat.slice(close + 2).trim().split(/\s+/);
        const state = fields[0];
        const ppid = Number(fields[1]);
        const pgid = Number(fields[2]);
        const sid = Number(fields[3]);
        if (pgid !== groupId) continue;
        let command = '';
        try {
          command = fs.readFileSync(`/proc/${pid}/cmdline`).toString('utf8').split('\0').filter(Boolean).join(' ');
        } catch (_) { /* process may have exited between reads */ }
        rows.push(Object.freeze({
          pid,
          ppid,
          pgid,
          sid,
          state,
          elapsed: 'unknown',
          command: command || `[${commandName}]`
        }));
      } catch (_) { /* process exited while /proc was being inspected */ }
    }
    return rows.sort((left, right) => left.pid - right.pid);
  }
  const rows = [];
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match || Number(match[3]) !== groupId) continue;
    rows.push(Object.freeze({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      sid: Number(match[4]),
      state: match[5],
      elapsed: match[6],
      command: match[7]
    }));
  }
  return rows;
}

function signalTaskTree(child, signal) {
  if (!child || !Number.isInteger(child.pid)) return false;
  if (process.platform === 'win32') {
    if (signal === 'SIGKILL') {
      const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
      return result.status === 0;
    }
    try { return child.kill(signal); } catch (_) { return false; }
  }
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (_) {
    try { return child.kill(signal); } catch (_) { return false; }
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendNodeReportOptions(existing, diagnosticsDir) {
  const additions = [
    '--report-on-signal',
    `--report-signal=${DIAGNOSTIC_SIGNAL}`,
    `--report-directory=${diagnosticsDir}`,
    '--report-compact'
  ];
  return [existing || '', ...additions].filter(Boolean).join(' ');
}

async function finishLog(stream) {
  if (!stream) return;
  stream.end();
  if (!stream.closed) await once(stream, 'close').catch(() => {});
}

async function runTask(name, task, options = {}) {
  const startedAt = Date.now();
  const taskTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `pulse-suite-task-${safeName(name)}-`));
  const taskRunDir = options.runDir ? path.join(options.runDir, 'tasks') : null;
  const diagnosticsDir = options.runDir ? path.join(options.runDir, 'diagnostics', safeName(name)) : path.join(taskTempRoot, 'diagnostics');
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  const logPath = taskRunDir ? path.join(taskRunDir, `${safeName(name)}.log`) : null;
  const logStream = logPath ? fs.createWriteStream(logPath, { flags: 'w' }) : null;
  let child = null;
  let cleanupError = null;
  let failureEvidenceError = null;
  let failureArtifacts = [];
  let timedOut = false;
  let interruptedBy = null;
  let spawnError = null;
  let processTree = [];
  let terminationStarted = false;
  let forcedCompletion = false;
  let terminationPromise = null;
  let remainingProcessTree = [];

  const writeOutput = (target, chunk) => {
    target.write(chunk);
    if (logStream) logStream.write(chunk);
  };
  const writeLine = (line) => {
    process.stderr.write(`${line}\n`);
    if (logStream) logStream.write(`${line}\n`);
  };

  console.log(`\n[pulsewasm:${task.evidence}] ${name}`);
  console.log(`[pulsewasm] ${task.description} (timeout ${formatDuration(task.timeoutMs)})`);

  const env = {
    ...process.env,
    ...(options.sourceEnv || {}),
    TMPDIR: taskTempRoot,
    TMP: taskTempRoot,
    TEMP: taskTempRoot,
    PULSEWASM_TEST_TMP_ROOT: taskTempRoot,
    PULSEWASM_SUITE_TASK: name,
    PULSEWASM_SUITE_TASK_TIMEOUT_MS: String(task.timeoutMs),
    NODE_OPTIONS: appendNodeReportOptions(process.env.NODE_OPTIONS, diagnosticsDir),
    ...(task.isolatedArtifacts ? { PULSEWASM_ARTIFACTS_DIR: path.join(taskTempRoot, 'artifacts') } : {})
  };

  const completion = new Promise((resolve) => {
    const detached = process.platform !== 'win32';
    try {
      child = spawn(task.command, task.args, {
        cwd: wasmRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        detached
      });
      if (typeof options.onChild === 'function') options.onChild(child);
    } catch (error) {
      spawnError = error;
      resolve(Object.freeze({ code: null, signal: null }));
      return;
    }

    child.stdout.on('data', (chunk) => writeOutput(process.stdout, chunk));
    child.stderr.on('data', (chunk) => writeOutput(process.stderr, chunk));

    let resolved = false;
    const settle = (code, signal) => {
      if (resolved) return;
      resolved = true;
      resolve(Object.freeze({ code, signal }));
    };
    child.once('error', (error) => {
      spawnError = error;
      settle(null, null);
    });
    child.once('close', settle);

    const terminate = async (reason) => {
      if (terminationStarted) return;
      terminationStarted = true;
      if (reason === 'timeout') timedOut = true;
      else interruptedBy = reason;
      processTree = processGroupRows(child.pid);
      writeLine(`[pulsewasm] ${name}: ${reason === 'timeout' ? 'timeout' : `interrupted by ${reason}`}; process group ${child.pid} contains ${processTree.length} process(es)`);
      for (const row of processTree) writeLine(`[pulsewasm:process] pid=${row.pid} ppid=${row.ppid} state=${row.state} elapsed=${row.elapsed} ${row.command}`);

      try { child.kill(DIAGNOSTIC_SIGNAL); } catch (_) { /* best effort diagnostic report */ }
      await wait(DIAGNOSTIC_GRACE_MS);

      // The immediate child may exit while descendants remain in its detached
      // process group. Always terminate the group rather than treating the
      // child's close event as proof that task-owned resources are gone.
      if (processGroupRows(child.pid).length || !resolved) signalTaskTree(child, 'SIGTERM');
      await wait(TERMINATION_GRACE_MS);
      if (processGroupRows(child.pid).length || !resolved) signalTaskTree(child, 'SIGKILL');
      await wait(KILL_GRACE_MS);
      remainingProcessTree = processGroupRows(child.pid);
      if (!resolved) {
        forcedCompletion = true;
        settle(null, 'SIGKILL');
      }
    };

    const timer = setTimeout(() => { terminationPromise = terminate('timeout'); }, task.timeoutMs);
    timer.unref();
    let abortListener = null;
    if (options.signal) {
      abortListener = () => { terminationPromise = terminate(options.signal.reason || 'SIGTERM'); };
      if (options.signal.aborted) abortListener();
      else options.signal.addEventListener('abort', abortListener, { once: true });
    }
    child.once('close', () => {
      clearTimeout(timer);
      if (options.signal && abortListener) options.signal.removeEventListener('abort', abortListener);
    });
  });

  const completed = await completion;
  const childPassed = completed.code === 0 && !spawnError;

  if (terminationPromise) await terminationPromise;
  if (typeof options.onChild === 'function') options.onChild(null);

  if (!childPassed && options.runDir) {
    try {
      failureArtifacts = copyTaskFailureLogs(taskTempRoot, diagnosticsDir).map(relativeToWasm);
      if (failureArtifacts.length) {
        writeLine(`[pulsewasm] ${name}: copied ${failureArtifacts.length} task-owned failure log(s) into the durable run report`);
      }
    } catch (error) {
      failureEvidenceError = error;
      writeLine(`[pulsewasm] ${name}: could not copy task-owned failure logs: ${error.message || error}`);
    }
  }

  try {
    cleanupRecordedWorkspacePackageBuilds(taskTempRoot);
    fs.rmSync(taskTempRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50
    });
  } catch (error) {
    cleanupError = error;
  }
  await finishLog(logStream);

  const durationMs = Date.now() - startedAt;
  const diagnosticReports = fs.existsSync(diagnosticsDir)
    ? fs.readdirSync(diagnosticsDir).filter((entry) => entry.endsWith('.json')).sort().map((entry) => relativeToWasm(path.join(diagnosticsDir, entry)))
    : [];

  const status = timedOut
    ? 'timeout'
    : interruptedBy
      ? 'interrupted'
      : childPassed && !cleanupError
        ? 'passed'
        : 'failed';
  const exitCode = timedOut
    ? TIMEOUT_EXIT
    : interruptedBy
      ? (INTERRUPT_EXIT[interruptedBy] || 1)
      : childPassed && !cleanupError
        ? 0
        : (typeof completed.code === 'number' ? completed.code || 1 : 1);
  const error = cleanupError
    ? `temporary test root cleanup failed: ${cleanupError.message || cleanupError}`
    : failureEvidenceError
      ? `failure evidence copy failed: ${failureEvidenceError.message || failureEvidenceError}`
      : spawnError
        ? String(spawnError.message || spawnError)
        : remainingProcessTree.length
          ? `task process group retained ${remainingProcessTree.length} process(es) after SIGKILL`
          : forcedCompletion
            ? 'task process group did not report close after SIGKILL'
            : null;

  console.log(`[pulsewasm] ${name}: ${status} in ${formatDuration(durationMs)}`);
  return Object.freeze({
    name,
    evidence: task.evidence,
    description: task.description,
    commandSignature: commandSignature(task),
    timeoutMs: task.timeoutMs,
    durationMs,
    status,
    exitCode,
    signal: completed.signal || null,
    interruptedBy,
    error,
    logPath: relativeToWasm(logPath),
    diagnosticReports: Object.freeze(diagnosticReports),
    failureArtifacts: Object.freeze(failureArtifacts),
    processTree: Object.freeze(processTree),
    remainingProcessTree: Object.freeze(remainingProcessTree)
  });
}

function reportSnapshot(state, updates = {}) {
  return Object.freeze({
    schemaVersion: REPORT_SCHEMA,
    runId: state.runId,
    sourceRevision: state.sourceRevision,
    sourceIdentity: state.sourceIdentity,
    status: updates.status || state.status,
    startedAt: state.startedAt,
    updatedAt: new Date().toISOString(),
    finishedAt: updates.finishedAt === undefined ? state.finishedAt : updates.finishedAt,
    durationMs: Date.now() - state.startMs,
    profiles: state.profiles,
    requestedTasks: state.requestedTasks,
    selectedTasks: state.selectedTasks,
    currentTask: updates.currentTask === undefined ? state.currentTask : updates.currentTask,
    completedTasks: state.results.length,
    results: Object.freeze([...state.results]),
    runDirectory: relativeToWasm(state.runDir)
  });
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }
  if (options.help) { console.log(usage()); return; }
  if (options.list) {
    console.log('Profiles:');
    for (const name of Object.keys(profiles).sort()) console.log(`  ${name}: ${expandProfile(name).join(', ')}`);
    console.log('\nTasks:');
    for (const [name, task] of Object.entries(tasks).sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${name} [${task.evidence}] ${task.description} (${formatDuration(task.timeoutMs)})`);
    return;
  }

  let selection;
  try { selection = selectedTasks(options); }
  catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const runId = runIdentifier();
  const paths = createRunPaths(options, runId);
  const sourceIdentity = resolveSourceIdentity(path.resolve(wasmRoot, '..'));
  const identityEnv = sourceIdentityEnv(sourceIdentity);
  const state = {
    runId,
    sourceRevision: sourceIdentity.sourceRevision,
    sourceIdentity,
    status: 'running',
    startedAt: new Date().toISOString(),
    startMs: Date.now(),
    finishedAt: null,
    profiles: options.profiles.length ? options.profiles : (options.tasks.length ? [] : ['release']),
    requestedTasks: selection.requested,
    selectedTasks: selection.selected,
    currentTask: null,
    results: [],
    reportPath: paths.reportPath,
    runDir: paths.runDir
  };
  const persist = (updates = {}) => {
    if (!state.reportPath) return;
    writeReportAtomic(state.reportPath, reportSnapshot(state, updates));
  };
  persist();

  const controller = new AbortController();
  let activeChild = null;
  let receivedSignal = null;
  const signalHandler = (signal) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    controller.abort(signal);
    persist({ status: 'interrupted', currentTask: state.currentTask });
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => signalHandler(signal));
  process.once('exit', () => { if (activeChild) signalTaskTree(activeChild, 'SIGKILL'); });

  for (const name of selection.selected) {
    state.currentTask = name;
    persist({ currentTask: name });
    const result = await runTask(name, tasks[name], {
      runDir: state.runDir,
      sourceEnv: identityEnv,
      signal: controller.signal,
      onChild(child) { activeChild = child; }
    });
    state.results.push(result);
    state.currentTask = null;
    persist({ currentTask: null });
    if (result.status !== 'passed') break;
  }

  const failed = state.results.find((result) => result.status !== 'passed');
  state.status = failed ? (failed.status === 'interrupted' ? 'interrupted' : 'failed') : 'passed';
  state.finishedAt = new Date().toISOString();
  const report = reportSnapshot(state, { status: state.status, currentTask: null, finishedAt: state.finishedAt });
  if (state.reportPath) writeReportAtomic(state.reportPath, report);

  console.log('\n[pulsewasm] test summary');
  for (const result of state.results) console.log(`  ${result.status.padEnd(11)} ${formatDuration(result.durationMs).padStart(8)}  ${result.name}${result.logPath ? `  (${result.logPath})` : ''}`);
  if (state.reportPath) console.log(`  report       ${relativeToWasm(state.reportPath)}`);
  if (state.runDir) console.log(`  run logs     ${relativeToWasm(state.runDir)}`);
  console.log(`  total        ${formatDuration(report.durationMs)}`);

  if (options.json) console.log(JSON.stringify(report, null, 2));
  if (failed) process.exit(failed.exitCode || 1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

module.exports = Object.freeze({
  REPORT_SCHEMA,
  parseArgs,
  selectedTasks,
  formatDuration,
  writeReportAtomic,
  createRunPaths,
  processGroupRows,
  signalTaskTree,
  copyTaskFailureLogs,
  runTask,
  reportSnapshot
});
