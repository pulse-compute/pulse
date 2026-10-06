#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { runCommand, canInspectDescendants } = require('../../scripts/release-process.cjs');
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
    if (token === '--recovery-config') { out.recoveryConfig = path.resolve(readValue(i, token)); i += 1; continue; }
    if (token === '--help' || token === '-h') { out.help = true; continue; }
    if (profiles[token]) { out.profiles.push(token); continue; }
    if (tasks[token]) { out.tasks.push(token); continue; }
    throw new Error(`Unknown PulseWasm test selection: ${token}`);
  }
  if (out.recoveryConfig && (out.fromTask || out.throughTask || !out.report)) {
    throw new Error('Seal recovery requires a complete selection and a report; --from, --through and --no-report cannot be combined with --recovery-config');
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
    '  --recovery-config <path> internal same-candidate seal checkpoint configuration',
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
  // Managed execution can expose a host /proc unrelated to Node's PID namespace.
  // Such rows are neither diagnostics nor authority to signal a process.
  if (process.platform === 'linux' && !canInspectDescendants()) return [];
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

function finishLog(stream) {
  if (!stream) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => { stream.destroy(); resolve('task log close exceeded its deadline'); }, 1000);
    stream.once('close', () => { clearTimeout(timer); resolve(); });
    stream.once('error', error => { clearTimeout(timer); stream.destroy(); resolve(error.message); });
    stream.end();
  });
}

function cleanupTaskOutputs(taskTempRoot, diagnosticsDir, retainFailure) {
  let failureArtifacts = [], failureEvidenceError = null;
  if (retainFailure) {
    try { failureArtifacts = copyTaskFailureLogs(taskTempRoot, diagnosticsDir).map(relativeToWasm); }
    catch (error) { failureEvidenceError = error.message; }
  }
  cleanupRecordedWorkspacePackageBuilds(taskTempRoot);
  fs.rmSync(taskTempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  return { failureArtifacts, failureEvidenceError };
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
    ...(options.taskEnv || {}),
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
      // Registry argv contains absolute source/tool paths. Keep the canonical
      // definition for checkpoint signatures, but execute the worker's copy.
      const executionPath = value => {
        if (!options.executionRoot || !path.isAbsolute(value)) return value;
        const relative = path.relative(path.dirname(wasmRoot), value);
        if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) ||
            relative === '.pulse-seal' || relative.startsWith(`.pulse-seal${path.sep}`)) return value;
        return path.join(options.executionRoot, relative);
      };
      child = spawn(executionPath(task.command), task.args.map(executionPath), {
        cwd: options.cwd || wasmRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        detached
      });
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
      await wait(options.terminationGraceMs ?? TERMINATION_GRACE_MS);
      if (processGroupRows(child.pid).length || !resolved) signalTaskTree(child, 'SIGKILL');
      await wait(options.killGraceMs ?? KILL_GRACE_MS);
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
    // Tracking/persistence failures must not abandon a spawned worker.
    try { options.onChild?.(child); }
    catch (error) { spawnError = error; terminationPromise = terminate('observer-failure'); }
  });

  const completed = await completion;
  const childPassed = completed.code === 0 && !spawnError;

  if (terminationPromise) await terminationPromise;

  options.onPhase?.('cleanup');
  let cleanupOutput = '';
  const cleanupCommand = options.cleanupCommand || {
    command: process.execPath,
    args: ['-e', `const { cleanupTaskOutputs } = require(process.argv[1]);
      const result = cleanupTaskOutputs(...JSON.parse(process.argv[2]));
      process.stdout.write(JSON.stringify(result));`, __filename,
    JSON.stringify([taskTempRoot, diagnosticsDir, !childPassed && Boolean(options.runDir)])]
  };
  const cleaned = await runCommand(cleanupCommand.command, cleanupCommand.args, {
    timeoutMs: options.cleanupTimeoutMs || 30000,
    ...(options.cleanupGraceMs === undefined ? {} : { termGraceMs: options.cleanupGraceMs, killGraceMs: options.cleanupGraceMs }),
    onOutput(name, chunk) { if (name === 'stdout') cleanupOutput += chunk; }
  });
  if (cleaned.status !== 0 || cleaned.error || cleaned.timedOut) {
    cleanupError = new Error(`cleanup failed or exceeded its deadline; retained task root: ${taskTempRoot}`);
  } else {
    try {
      const result = JSON.parse(cleanupOutput);
      failureArtifacts = result.failureArtifacts;
      if (result.failureEvidenceError) failureEvidenceError = new Error(result.failureEvidenceError);
      if (failureArtifacts.length) writeLine(`[pulsewasm] ${name}: copied ${failureArtifacts.length} task-owned failure log(s) into the durable run report`);
    } catch (error) { cleanupError = error; }
  }
  if (options.signal?.aborted) interruptedBy ||= String(options.signal.reason || 'SIGTERM');
  const logError = await finishLog(logStream);
  if (logError) cleanupError ||= new Error(logError);
  if (typeof options.onChild === 'function') options.onChild(null);

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
    timedOut,
    interruptedBy,
    error,
    cleanup: Object.freeze({ status: cleanupError ? 'failed' : 'passed' }),
    logPath: relativeToWasm(logPath),
    retainedTaskRoot: cleanupError ? taskTempRoot : null,
    diagnosticReports: Object.freeze(diagnosticReports),
    failureArtifacts: Object.freeze(failureArtifacts),
    processTree: Object.freeze(processTree),
    remainingProcessTree: Object.freeze(remainingProcessTree)
  });
}

const RECOVERY_SCHEMA = 'pulse.seal-task-recovery.v1';

function validateRecoveryConfig(config, selection) {
  assert.equal(config?.schemaVersion, RECOVERY_SCHEMA, 'Unsupported seal task recovery configuration');
  assert.deepEqual(selection.selected, selection.requested, 'Recovery cannot qualify a sliced selection');
  assert.deepEqual(config.selectedTasks, selection.selected, 'Recovery task selection differs from the complete requested selection');
  assert(config.context && typeof config.context === 'object' && !Array.isArray(config.context), 'Recovery requires candidate context');
  if (config.context.schemaVersion === 'pulse.release-recovery.v1') {
    assert(['release', 'features'].includes(config.kind), 'Production recovery must identify its release or features selection');
    assert.deepEqual(config.selectedTasks, config.context.selections?.[config.kind], 'Recovery selection differs from the candidate context');
    const required = config.kind === 'release' ? expandProfile('release') : require('../../scripts/release-feature-acceptance.cjs').REQUIRED_TASKS;
    assert.deepEqual(config.selectedTasks, required, 'Production recovery must cover the current required task set');
    assert.deepEqual(config.taskOptions, require('../../scripts/release-recovery.cjs').recoveryTaskOptions(config.artifacts, config.kind), 'Production recovery task options differ from their artifact owners');
  }
  assert(typeof config.directory === 'string' && path.isAbsolute(config.directory), 'Recovery checkpoint directory must be absolute');
  assert(!config.previousDirectory || (typeof config.previousDirectory === 'string' && path.isAbsolute(config.previousDirectory)), 'Previous recovery checkpoint directory must be absolute');
  assert(config.taskOptions === undefined || (config.taskOptions && typeof config.taskOptions === 'object' && !Array.isArray(config.taskOptions)), 'Recovery task options must be an object');
  for (const [name, options] of Object.entries(config.taskOptions || {})) {
    assert(selection.selected.includes(name), `Recovery options name an unselected task: ${name}`);
    assert(options && typeof options === 'object' && !Array.isArray(options), `Invalid recovery options for ${name}`);
    assert(Object.keys(options).every(key => ['args', 'env', 'artifacts'].includes(key)), `Unknown recovery options for ${name}`);
    assert(options.args === undefined || (Array.isArray(options.args) && options.args.every(arg => typeof arg === 'string')), `Invalid recovery arguments for ${name}`);
    assert(options.env === undefined || (options.env && typeof options.env === 'object' && !Array.isArray(options.env) && Object.values(options.env).every(value => typeof value === 'string')), `Invalid recovery environment for ${name}`);
    for (const key of Object.keys(options.env || {})) {
      assert(!/^(?:PULSE_SOURCE_|PULSEWASM_SUITE_TASK|PULSEWASM_TEST_TMP_ROOT$|TMPDIR$|TMP$|TEMP$)/.test(key), `Recovery cannot override runner-owned environment: ${key}`);
    }
    assert(options.artifacts === undefined || (options.artifacts && typeof options.artifacts === 'object' && !Array.isArray(options.artifacts)), `Invalid recovery artifacts for ${name}`);
    assert(!Object.hasOwn(options.artifacts || {}, 'task-log'), 'The task-log artifact belongs to the runner');
    for (const [key, target] of Object.entries(options.artifacts || {})) {
      assert(typeof target === 'string' && path.isAbsolute(target), `Recovery artifact ${name}/${key} must be an absolute path`);
    }
  }
  return config;
}

function recoveryDefinition(task, options = {}) {
  // Output destinations belong to an attempt, not to the task's meaning. Name
  // those paths by artifact key, including a report's parent directory used by
  // installed feature tasks. All other command/environment values stay bound.
  const entries = Object.entries(options.artifacts || {}).sort(([left], [right]) => left.localeCompare(right));
  const replacements = entries.map(([key, target]) => [target, `$artifact.${key}`])
    .sort(([left], [right]) => right.length - left.length);
  const normalize = value => {
    const parent = entries.find(([, target]) => path.dirname(target) === value);
    if (parent) return `$artifact.${parent[0]}.parent`;
    return replacements.reduce((current, [target, marker]) => current.split(target).join(marker), value);
  };
  const definition = {
    command: task.command,
    args: task.args.map(normalize),
    timeoutMs: task.timeoutMs,
    evidence: task.evidence,
    isolatedArtifacts: task.isolatedArtifacts === true,
    scheduling: task.scheduling || null,
    env: Object.fromEntries(Object.entries(options.env || {}).map(([key, value]) => [key, normalize(value)]))
  };
  return { ...definition, commandSignature: commandSignature(definition) };
}

function checkpointDefinition(name, task, options = {}) {
  return { name, ...recoveryDefinition({ ...task, args: options.args || task.args }, options) };
}

async function runSelectedTasks({ state, selection, taskMap = tasks, recoveryConfig = null,
  persist = () => {}, signal, onChild, taskRunOptions = {}, workspaces = null, compilerWorkers = 2 }) {
  let store = null;
  if (recoveryConfig) {
    validateRecoveryConfig(recoveryConfig, selection);
    assert(state.runDir, 'Recovery requires durable task logs');
    const checkpoints = require('../../scripts/release-checkpoints.cjs');
    store = checkpoints.createCheckpointStore({
      directory: recoveryConfig.directory,
      previousDirectory: recoveryConfig.previousDirectory,
      context: recoveryConfig.context,
      ...(recoveryConfig.expiresAt ? { expiresAt: recoveryConfig.expiresAt } : {})
    });
    state.recovery = { schemaVersion: RECOVERY_SCHEMA, directory: recoveryConfig.directory,
      previousDirectory: recoveryConfig.previousDirectory || null,
      contextHash: checkpoints.fingerprint(recoveryConfig.context),
      dependencies: recoveryConfig.dependencies || {}, taskOptions: recoveryConfig.taskOptions || {},
      ...(recoveryConfig.kind ? { kind: recoveryConfig.kind } : {}),
      ...(recoveryConfig.artifacts ? { artifacts: recoveryConfig.artifacts } : {}),
      reusedTasks: [], executedTasks: [] };
  }
  const parallel = workspaces && workspaces.length > 1;
  const control = new AbortController();
  const abort = () => control.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const running = new Map(), finished = new Map();
  const refresh = () => {
    state.currentTasks = [...running.keys()];
    state.currentTask = state.currentTasks[0] || null;
    state.currentTaskPhases = Object.fromEntries([...running].map(([name, item]) => [name, item.phase]));
    state.currentTaskPhase = state.currentTaskPhases[state.currentTask] || null;
    state.results = selection.selected.filter(name => finished.has(name)).map(name => finished.get(name));
    if (state.recovery) {
      state.recovery.reusedTasks = state.results.filter(item => item.execution === "reused").map(item => item.name);
      state.recovery.executedTasks = state.results.filter(item => item.execution === "executed").map(item => item.name);
    }
    persist();
  };
  async function execute(name, workspace) {
    assert(taskMap[name], `Unknown task: ${name}`);
    const overrides = recoveryConfig?.taskOptions?.[name] || {};
    const task = { ...taskMap[name], args: overrides.args || taskMap[name].args };
    const artifacts = { ...(overrides.artifacts || {}),
      ...(store ? { 'task-log': path.join(state.runDir, 'tasks', `${safeName(name)}.log`) } : {}) };
    const spec = store ? { id: `task:${name}`, definition: checkpointDefinition(name, task, overrides),
      dependencies: recoveryConfig.dependencies || {}, artifacts } : null;
    running.set(name, { workspace, phase: store ? 'checkpoint' : 'execution' });
    refresh();
    const reuse = store?.tryReuse(spec);
    let result;
    if (reuse?.reused) {
      result = { ...reuse.result, execution: 'reused', durationMs: 0,
        reusedDurationMs: reuse.result.durationMs, originalResult: reuse.result,
        logPath: relativeToWasm(artifacts['task-log']) };
      state.recovery.reusedTasks.push(name);
      console.log(`[pulsewasm] ${name}: reused verified same-candidate checkpoint`);
    } else {
      running.get(name).phase = 'execution';
      refresh();
      result = await runTask(name, task, {
        ...taskRunOptions, runDir: state.runDir, sourceEnv: state.sourceEnv,
        taskEnv: { ...overrides.env, ...(workspace && recoveryConfig?.context.scheduling ? {
          PULSEWASM_SEAL_WORKER_LAYOUT: path.join(path.dirname(workspace.directory), 'layout.json')
        } : {}) }, signal: control.signal,
        ...(workspace ? { cwd: path.join(workspace.directory, 'wasm'), executionRoot: workspace.directory } : {}),
        onChild(child) { onChild?.(child, name); },
        onPhase(phase) { running.get(name).phase = phase; refresh(); }
      });
      if (workspace) result = { ...result, executionWorkspace: workspace.id };
      if (store) {
        state.recovery.executedTasks.push(name);
        let recorded;
        try { recorded = store.record({ ...spec, result }); }
        catch (error) {
          // A zero-exit task with missing or changed output is not reusable or
          // qualified. Keep the failed attempt instead of losing its receipt.
          result = { ...result, status: 'failed', exitCode: result.exitCode || 1,
            error: result.error ? `${result.error}; checkpoint capture failed: ${error.message}` : `checkpoint capture failed: ${error.message}` };
          try { recorded = store.record({ ...spec, result }); }
          catch (recordError) {
            // A disk failure may prevent even the failure receipt. Preserve
            // the actual task outcome in the outer runner report regardless.
            result = { ...result, checkpointError: recordError.message };
          }
        }
        result = { ...result, execution: 'executed',
          ...(recorded ? { checkpoint: checkpointReference(recorded) } : {}), recoveryReason: reuse.reason };
      }
    }
    if (reuse?.reused) result = { ...result, checkpoint: checkpointReference(reuse), recoveryReason: reuse.reason };
    finished.set(name, Object.freeze(result));
    running.delete(name);
    refresh();
    return result;
  }
  try {
    if (!parallel) {
      for (const name of selection.selected) {
        if (control.signal.aborted) break;
        if ((await execute(name, workspaces?.[0])).status !== 'passed') break;
      }
    } else {
      const { scheduling, compilerCount } = require('../../scripts/release-parallel.cjs');
      const compilerLimit = compilerCount(compilerWorkers, workspaces.length);
      const queue = selection.selected.map((name, index) => ({ name, index, ...scheduling(name, taskMap[name]) }))
        .sort((a, b) => b.cost - a.cost || a.index - b.index);
      const selected = new Set(selection.selected);
      for (const item of queue) for (const dependency of item.after) assert(selected.has(dependency), `Missing scheduling dependency: ${dependency}`);
      const free = [...workspaces], active = new Map(), held = new Set();
      while ((queue.length || active.size) && (!control.signal.aborted || active.size)) {
        let started = false;
        if (!control.signal.aborted) {
          for (let index = 0; index < queue.length && free.length; index++) {
            const item = queue[index];
            if (item.compiler && [...active.values()].filter(value => value.item.compiler).length >= compilerLimit) continue;
            if (item.after.some(name => finished.get(name)?.status !== 'passed') || item.resources.some(resource => held.has(resource))) continue;
            if ((item.exclusive && active.size) || [...active.values()].some(value => value.item.exclusive)) continue;
            queue.splice(index--, 1);
            const workspace = free.shift();
            item.resources.forEach(resource => held.add(resource));
            const promise = execute(item.name, workspace).then(result => {
              if (result.status !== 'passed' && !control.signal.aborted) {
                state.error = { code: 'PULSE_PARALLEL_TASK_FAILED', message: `${item.name} failed; sibling workers cancelled` };
                control.abort('sibling-failure');
              }
            }).catch(error => {
              state.error = { code: error.code || null, message: error.message };
              control.abort('sibling-failure');
            }).finally(() => {
              item.resources.forEach(resource => held.delete(resource));
              active.delete(item.name); free.push(workspace);
            });
            active.set(item.name, { promise, item });
            started = true;
          }
        }
        if (active.size) await Promise.race([...active.values()].map(value => value.promise));
        else if (queue.length && !control.signal.aborted) throw new Error('Scheduling dependencies cannot make progress');
        else if (!started) break;
      }
      await Promise.all([...active.values()].map(value => value.promise));
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    running.clear(); state.currentTaskPhase = null; refresh();
  }
  return state.results;
}

function checkpointReference(checkpoint) {
  return { proofId: checkpoint.proofId, receiptPath: checkpoint.receiptPath,
    receiptSha256: checkpoint.receiptSha256, contextHash: checkpoint.receipt.contextHash };
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
    currentTaskPhase: state.currentTaskPhase || null,
    activeChildPid: state.activeChildPid || null,
    ...(state.activeChildPids ? { activeChildPids: [...state.activeChildPids] } : {}),
    ...(state.currentTasks ? { currentTasks: [...state.currentTasks] } : {}),
    ...(state.currentTaskPhases ? { currentTaskPhases: { ...state.currentTaskPhases } } : {}),
    completedTasks: state.results.length,
    results: Object.freeze([...state.results]),
    runDirectory: relativeToWasm(state.runDir),
    ...(state.error ? { error: state.error } : {}),
    ...(state.recovery ? { recovery: state.recovery } : {})
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
  let recoveryConfig = null;
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
    sourceEnv: identityEnv,
    status: 'running',
    startedAt: new Date().toISOString(),
    startMs: Date.now(),
    finishedAt: null,
    profiles: options.profiles.length ? options.profiles : (options.tasks.length ? [] : ['release']),
    requestedTasks: selection.requested,
    selectedTasks: selection.selected,
    currentTask: null,
    activeChildPid: null,
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
  const activeChildren = new Map();
  let receivedSignal = null;
  const signalHandler = (signal) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    controller.abort(signal);
    persist({ status: 'interrupted', currentTask: state.currentTask });
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => signalHandler(signal));
  process.once('exit', () => { for (const child of activeChildren.values()) signalTaskTree(child, 'SIGKILL'); });

  const heartbeat = setInterval(() => {
    persist();
    console.log(`[pulsewasm] Running ${state.currentTask || 'selection'} (${state.currentTaskPhase || 'execution'}); elapsed ${formatDuration(Date.now() - state.startMs)}`);
  }, 10000);
  heartbeat.unref();
  try {
    if (options.recoveryConfig) {
      recoveryConfig = validateRecoveryConfig(JSON.parse(fs.readFileSync(options.recoveryConfig, 'utf8')), selection);
      if (recoveryConfig.context.schemaVersion === 'pulse.release-recovery.v1') {
        const root = path.resolve(wasmRoot, '..');
        const candidate = require('../../scripts/release-feature-acceptance.cjs').candidateIdentity(root);
        assert.deepEqual(recoveryConfig.context.candidate, { ...candidate, repoRoot: fs.realpathSync(root) }, 'Recovery candidate differs from this clean checkout');
        assert.equal(candidate.sourceRevision, state.sourceRevision, 'Recovery candidate differs from the runner source identity');
      }
    }
    let workspaces = null;
    if (recoveryConfig?.context.scheduling) {
      const { readLayout } = require('../../scripts/release-parallel.cjs');
      const root = path.resolve(wasmRoot, '..'), options = recoveryConfig.context.options;
      const layout = readLayout(root, recoveryConfig.context.candidate, options.workers, options.memoryBudgetMiB, options.compilerWorkers);
      workspaces = layout.workspaces;
      for (const workspace of workspaces) {
        const input = require('../../scripts/release-recovery.cjs').inputIdentity(workspace.directory);
        assert.deepEqual(input, recoveryConfig.context.scheduling.workspaces.find(item => item.id === workspace.id).inputs,
          'Worker dependency/build inputs changed before execution');
      }
    }
    await runSelectedTasks({ state, selection, recoveryConfig, persist, signal: controller.signal, workspaces,
      compilerWorkers: recoveryConfig?.context.scheduling?.compilerWorkers || 2,
      onChild(child, name) {
        if (child) activeChildren.set(name, child); else activeChildren.delete(name);
        state.activeChildPids = [...activeChildren.values()].map(value => value.pid);
        state.activeChildPid = state.activeChildPids[0] || null; persist();
      } });
  } catch (error) {
    state.error = { code: error.code || null, message: error.message || String(error) };
    console.error(error && error.stack ? error.stack : error);
  } finally { clearInterval(heartbeat); }

  const failed = state.results.find((result) => result.status !== 'passed');
  if (state.results.length !== selection.selected.length && !state.error && !failed && !controller.signal.aborted) {
    state.error = { code: null, message: 'Runner did not complete the selected task set' };
  }
  state.status = controller.signal.aborted ? 'interrupted' : state.error ? 'failed' : failed ? (failed.status === 'interrupted' ? 'interrupted' : 'failed') : 'passed';
  state.currentTask = null;
  state.currentTaskPhase = null;
  state.finishedAt = new Date().toISOString();
  const report = reportSnapshot(state, { status: state.status, currentTask: null, finishedAt: state.finishedAt });
  if (state.reportPath) writeReportAtomic(state.reportPath, report);

  console.log('\n[pulsewasm] test summary');
  for (const result of state.results) console.log(`  ${result.status.padEnd(11)} ${formatDuration(result.durationMs).padStart(8)}  ${result.name}${result.logPath ? `  (${result.logPath})` : ''}`);
  if (state.reportPath) console.log(`  report       ${relativeToWasm(state.reportPath)}`);
  if (state.runDir) console.log(`  run logs     ${relativeToWasm(state.runDir)}`);
  console.log(`  total        ${formatDuration(report.durationMs)}`);

  if (options.json) console.log(JSON.stringify(report, null, 2));
  if (controller.signal.aborted) process.exit(INTERRUPT_EXIT[controller.signal.reason] || 1);
  if (state.error) process.exit(1);
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
  cleanupTaskOutputs,
  runTask,
  reportSnapshot,
  RECOVERY_SCHEMA,
  validateRecoveryConfig,
  recoveryDefinition,
  checkpointDefinition,
  runSelectedTasks
});
