#!/usr/bin/env node
'use strict';

// Checkout-local diagnostic recovery. These receipts are never release evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const runner = require('../wasm/scripts/run-wasm-tests.cjs');
const { tasks } = require('../wasm/test/suite/registry.cjs');
const { fingerprint } = require('./release-checkpoints.cjs');
const { inputIdentity, atomicJson, acquireSealLock } = require('./release-recovery.cjs');
const { scheduling } = require('./release-parallel.cjs');
const SCHEMA = 'pulse.development-run.v1';
const MANIFEST = 'pulse.development-attempt.v1';
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const usage = 'Usage: node scripts/development-recovery.cjs --profile <name> [--task <name> ...]\n       node scripts/development-recovery.cjs --resume <attempt-directory>\nClean committed checkout required; development evidence only.';

function ordinary(file) {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) || fs.lstatSync(current, { throwIfNoEntry: false })) {
      assert(!fs.lstatSync(current).isSymbolicLink(), `Development path traverses a symlink: ${current}`);
    }
  }
  return absolute;
}
function parseArgs(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  if (argv[0] === '--resume') {
    assert(argv.length === 2 && argv[1] && !argv[1].startsWith('-'), '--resume requires exactly one explicit attempt directory');
    return { resume: path.resolve(argv[1]) };
  }
  const options = { profiles: [], tasks: [] };
  for (let i = 0; i < argv.length; i += 2) {
    assert(['--profile', '--task'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('-'), usage);
    options[argv[i] === '--profile' ? 'profiles' : 'tasks'].push(argv[i + 1]);
  }
  assert(options.profiles.length || options.tasks.length, 'An explicit development selection is required');
  return options;
}
function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
function createContext(root, selected, env = process.env, taskMap = tasks) {
  assert.equal(git(root, 'status', '--porcelain', '--untracked-files=all'), '', 'Development recovery requires a clean committed checkout');
  const files = git(root, 'ls-files', '-z').split('\0').filter(Boolean).map(file => {
    const absolute = ordinary(path.join(root, file)), stat = fs.lstatSync(absolute);
    assert(stat.isFile(), `Unsupported source input: ${file}`);
    return { file, mode: stat.mode & 0o777, sha256: hashFile(absolute) };
  });
  const environment = Object.fromEntries(Object.entries(env).filter(([key]) => !['_', 'SHLVL', 'PWD', 'OLDPWD'].includes(key)));
  const toolFiles = new Set([process.execPath, require('./pnpm-toolchain.cjs').binaryPath(root)]);
  for (const name of ['git', 'npm', 'pnpm', 'sh', 'bash', 'fastly', 'viceroy', 'wasm-opt', 'wasm-tools', 'rustc', 'cargo', 'clang']) {
    const found = (env.PATH || '').split(path.delimiter).map(dir => path.resolve(dir, name)).find(file => {
      try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
    });
    if (found) toolFiles.add(fs.realpathSync(found));
  }
  for (const [key, value] of Object.entries(env)) {
    if (/FASTLY|VICEROY|WASM.*(?:BIN|PATH)/.test(key) && path.isAbsolute(value) && fs.existsSync(value) && fs.statSync(value).isFile()) toolFiles.add(fs.realpathSync(value));
  }
  return {
    schemaVersion: MANIFEST, checkout: fs.realpathSync(root), sourceRevision: git(root, 'rev-parse', 'HEAD').trim(),
    sourceTree: git(root, 'rev-parse', 'HEAD^{tree}').trim(), sourceSha256: fingerprint(files),
    environmentSha256: fingerprint(environment),
    platform: { node: process.version, versions: process.versions, os: os.release(), arch: process.arch, platform: process.platform },
    tools: [...toolFiles].sort().map(file => ({ file, sha256: hashFile(file) })),
    inputs: inputIdentity(root), selectedTasks: selected,
    definitions: selected.map(name => { assert(taskMap[name], `Unknown task: ${name}`); return runner.checkpointDefinition(name, taskMap[name], {}); })
  };
}
function readAttempt(root, directory) {
  const attempts = ordinary(path.join(root, '.pulse-development/attempts'));
  assert.equal(path.dirname(ordinary(directory)), attempts, 'Resume requires an attempt in this checkout');
  const file = ordinary(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(manifest.schemaVersion, MANIFEST, 'Invalid development manifest');
  assert.equal(manifest.directory, directory, 'Attempt directory identity changed');
  assert.equal(manifest.context.checkout, fs.realpathSync(root), 'Foreign checkout');
  assert.equal(manifest.contextHash, fingerprint(manifest.context), 'Corrupt development context');
  assert(Array.isArray(manifest.selectedTasks) && manifest.selectedTasks.length > 0, 'Missing selection');
  assert.deepEqual(manifest.selectedTasks, manifest.context.selectedTasks, 'Manifest selection differs');
  assert.equal(new Set(manifest.selectedTasks).size, manifest.selectedTasks.length, 'Duplicate tasks');
  ordinary(path.join(directory, 'checkpoints'));
  return manifest;
}
function allowReuse(name, task) {
  return ['unit', 'native', 'javascript', 'conformance', 'cli'].includes(task.evidence) && !scheduling(name, task).exclusive;
}
function snapshot(state, previousDirectory) {
  return { ...runner.reportSnapshot(state), schemaVersion: SCHEMA, evidenceKind: 'development-only',
    qualification: false, previousDirectory, inputCheckMs: state.inputCheckMs || 0 };
}
function groupAlive(pid) {
  if (!pid) return false;
  try { process.kill(process.platform === 'win32' ? pid : -pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
async function runDevelopment({ root, options, taskMap = tasks, contextFactory = createContext, onChild }) {
  root = fs.realpathSync(root);
  const parent = ordinary(path.join(root, '.pulse-development/attempts'));
  const directory = path.join(parent, `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`);
  // Share the seal's checkout lock; neither controller may mutate a checkout
  // while the other is testing it. Stale takeover checks the child process group.
  const lock = acquireSealLock(root, directory);
  const state = { runId: path.basename(directory), status: 'running', startedAt: new Date().toISOString(),
    startMs: Date.now(), finishedAt: null, results: [], profiles: options.profiles || [],
    requestedTasks: [], selectedTasks: [], runDir: path.join(directory, 'run'), inputCheckMs: 0 };
  const reportFile = path.join(directory, 'report.json');
  const persist = () => atomicJson(reportFile, snapshot(state, options.resume || null));
  const controller = new AbortController();
  let child = null, lastChildPid = null;
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => controller.abort(signal)]));
  const exit = () => { if (child) runner.signalTaskTree(child, 'SIGKILL'); };
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
  process.on('exit', exit);
  const heartbeat = setInterval(persist, 10000); heartbeat.unref();
  try {
    fs.mkdirSync(path.join(state.runDir, 'tasks'), { recursive: true });
    persist();
    console.log(`[development] attempt ${directory}`);
    const prior = options.resume ? readAttempt(root, options.resume) : null;
    const selection = prior ? { requested: prior.selectedTasks, selected: prior.selectedTasks } : runner.selectedTasks(options);
    state.requestedTasks = selection.requested; state.selectedTasks = selection.selected;
    for (const name of selection.selected) assert(taskMap[name], `Unknown task: ${name}`);
    const capture = () => {
      const start = Date.now();
      try { return contextFactory(root, selection.selected, process.env, taskMap); }
      finally { state.inputCheckMs += Date.now() - start; }
    };
    const context = capture();
    state.sourceRevision = context.sourceRevision;
    state.sourceIdentity = { sourceRevision: context.sourceRevision, sourceIdentityKind: 'git-commit' };
    state.sourceEnv = require('./source-identity.cjs').sourceIdentityEnv(state.sourceIdentity);
    const contextHash = fingerprint(context);
    if (prior) {
      const changed = Object.keys(context).filter(key => fingerprint(context[key]) !== fingerprint(prior.context[key] ?? null));
      assert.equal(contextHash, prior.contextHash, `Development inputs changed (${changed.join(', ')}); start a fresh attempt`);
    }
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: MANIFEST, directory,
      createdAt: state.startedAt, selectedTasks: selection.selected, context, contextHash }, null, 2) + '\n', { flag: 'wx' });
    const verifyInputs = () => assert.equal(fingerprint(capture()), contextHash, 'Development inputs changed during execution');
    await runner.runSelectedTasks({ state, selection, taskMap, persist, signal: controller.signal, verifyInputs, allowReuse,
      recoveryConfig: { schemaVersion: runner.RECOVERY_SCHEMA, kind: 'development-only', context,
        directory: path.join(directory, 'checkpoints'), previousDirectory: prior ? path.join(options.resume, 'checkpoints') : null,
        selectedTasks: selection.selected },
      onChild(value, name) {
        child = value;
        if (value) { lastChildPid = value.pid; lock.child(lastChildPid); }
        state.activeChildPid = value?.pid || null; persist(); onChild?.(value, name);
      } });
    verifyInputs();
    state.status = controller.signal.aborted ? 'interrupted'
      : state.results.length === selection.selected.length && state.results.every(result => result.status === 'passed') ? 'passed' : 'failed';
  } catch (error) {
    state.status = controller.signal.aborted ? 'interrupted' : 'failed';
    state.error = { message: error.message, code: error.code || null };
  } finally {
    clearInterval(heartbeat);
    state.finishedAt = new Date().toISOString(); state.currentTask = null; state.currentTaskPhase = null;
    try { persist(); } finally {
      for (const [signal, handler] of Object.entries(handlers)) process.removeListener(signal, handler);
      process.removeListener('exit', exit);
      // Preserve ownership if cleanup could not terminate the task group. A
      // later controller must not erase that evidence or overlap its processes.
      if (!groupAlive(lastChildPid)) lock.release();
    }
  }
  const report = snapshot(state, options.resume || null);
  console.log(`[development] ${report.status}: ${report.completedTasks}/${report.selectedTasks.length}; input checks ${state.inputCheckMs}ms; report ${reportFile}`);
  if (state.error) console.error(state.error.message);
  return { report, directory };
}
if (require.main === module) {
  (async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(usage); return; }
    const result = await runDevelopment({ root: path.resolve(__dirname, '..'), options });
    process.exitCode = result.report.status === 'passed' ? 0 : result.report.status === 'interrupted' ? 130 : 1;
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { SCHEMA, parseArgs, createContext, readAttempt, allowReuse, snapshot, runDevelopment };
