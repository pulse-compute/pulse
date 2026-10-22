'use strict';

// Local workers owned by one seal checkout. No remote scheduler or proof pool.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { candidateIdentity } = require('./release-feature-acceptance.cjs');
const { atomicJson, inputIdentity } = require('./release-recovery.cjs');

const WORKER_MIB = 768;
function workerCount(requested = 1, memoryMiB = 4096) {
  assert(Number.isSafeInteger(requested) && requested >= 1 && requested <= 8, '--workers must be an integer from 1 to 8');
  assert(Number.isSafeInteger(memoryMiB) && memoryMiB >= WORKER_MIB && memoryMiB <= 65536,
    '--memory-budget-mib must be an integer from 768 to 65536');
  return Math.min(requested, Math.floor(memoryMiB / WORKER_MIB));
}
function compilerCount(requested = 2, workers = 1) {
  assert(Number.isSafeInteger(requested) && requested >= 1 && requested <= 8, '--compiler-workers must be an integer from 1 to 8');
  return Math.min(requested, workers);
}
function workspaceRoot(root, tree, workers) {
  assert.match(tree, /^[a-f0-9]{40}$/);
  return path.join(root, '.pulse-seal/workspaces', `${tree}-${workers}`);
}
function directories(root) {
  const found = [root, path.join(root, 'wasm')].filter(fs.existsSync);
  for (const parent of ['packages', 'wasm/packages']) {
    const directory = path.join(root, parent);
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory)) {
      const item = path.join(directory, name);
      if (fs.existsSync(path.join(item, 'package.json'))) found.push(item);
    }
  }
  return found;
}
function removeWorker(root, directory) {
  // The caller has verified the controller-owned parent. A removed worktree
  // can leave output files behind; it is no longer a Git worktree in that case.
  if (!fs.existsSync(directory)) return;
  assert.equal(fs.realpathSync(directory), directory, 'Worker checkout traverses a symlink');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15000 });
  const registered = git(['worktree', 'list', '--porcelain', '-z']).split('\0').includes(`worktree ${directory}`);
  if (registered) git(['worktree', 'remove', '--force', directory]);
  else {
    // Never treat an unrelated repository or a foreign gitdir as our residue.
    const marker = path.join(directory, '.git');
    if (fs.existsSync(marker)) {
      assert(fs.lstatSync(marker).isFile(), 'Orphan worker has an unsafe Git marker');
      const match = fs.readFileSync(marker, 'utf8').trim().match(/^gitdir: (.+)$/);
      const common = fs.realpathSync(path.resolve(root, git(['rev-parse', '--git-common-dir']).trim()));
      const target = match && path.resolve(directory, match[1]);
      assert(target && path.dirname(target) === path.join(common, 'worktrees') && !fs.existsSync(target),
        'Orphan worker has a live or foreign Git marker');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert(!fs.existsSync(directory), 'Worker removal left an output directory');
}
function prepareWorkspaces(root, candidate, requested, memoryMiB, compilerWorkers = 2) {
  assert.deepEqual(candidateIdentity(root), candidate, 'Worker setup requires the same clean candidate');
  const count = workerCount(requested, memoryMiB);
  const parent = workspaceRoot(root, candidate.sourceTree, count);
  for (const item of [path.join(root, '.pulse-seal'), path.join(root, '.pulse-seal/workspaces'), parent]) {
    if (fs.existsSync(item)) assert(fs.lstatSync(item).isDirectory() && !fs.lstatSync(item).isSymbolicLink(), 'Worker parent must be an ordinary directory');
  }
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe', timeout: 60000 });
  const copy = (source, target) => fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
  fs.mkdirSync(parent, { recursive: true });
  assert(!fs.lstatSync(parent).isSymbolicLink(), 'Worker parent must be an ordinary directory');
  const owned = path.join(parent, 'owner.json');
  if (fs.existsSync(owned)) assert.deepEqual(JSON.parse(fs.readFileSync(owned, 'utf8')), { root, tree: candidate.sourceTree });
  else {
    assert.equal(fs.readdirSync(parent).length, 0, 'Worker parent has unowned contents');
    atomicJson(owned, { root, tree: candidate.sourceTree });
  }
  const packageDirs = directories(root);
  const packages = new Map(packageDirs.filter(dir => fs.existsSync(path.join(dir, 'package.json')))
    .map(dir => [JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name, path.relative(root, dir)]));
  const workspaces = [];
  for (let index = 0; index < count; index++) {
    const id = `worker-${index + 1}`, directory = path.join(parent, id);
    removeWorker(root, directory);
    git(['worktree', 'add', '--detach', directory, candidate.sourceRevision]);
    for (const source of packageDirs) {
      for (const name of ['node_modules', 'dist']) {
        const input = path.join(source, name);
        if (fs.existsSync(input)) copy(fs.realpathSync(input), path.join(directory, path.relative(root, input)));
      }
    }
    const tool = path.join(root, '.validation-tools/pnpm');
    if (fs.existsSync(tool)) copy(tool, path.join(directory, '.validation-tools/pnpm'));
    // Relative pnpm links stay relative; developer graphs may have absolute
    // workspace links. Rebind those to the worker's own source and build outputs.
    function rebind(target, source) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        let name;
        try { name = JSON.parse(fs.readFileSync(path.join(fs.realpathSync(source), 'package.json'), 'utf8')).name; } catch (_) { return; }
        if (packages.has(name)) {
          fs.unlinkSync(target);
          fs.symlinkSync(path.relative(path.dirname(target), path.join(directory, packages.get(name))), target, 'dir');
        }
      } else if (stat.isDirectory()) for (const name of fs.readdirSync(target)) rebind(path.join(target, name), path.join(source, name));
    }
    for (const source of packageDirs) {
      const modules = path.join(source, 'node_modules');
      if (fs.existsSync(modules)) rebind(path.join(directory, path.relative(root, modules)), modules);
    }
    assert.deepEqual(candidateIdentity(directory), candidate, 'Isolated worker source differs');
    workspaces.push({ id, directory });
  }
  const layout = { schemaVersion: 'pulse.seal-workers.v1', root, candidate, workers: count, memoryBudgetMiB: memoryMiB,
    estimatedWorkerMiB: WORKER_MIB, compilerWorkers: compilerCount(compilerWorkers, count), workspaces };
  atomicJson(path.join(parent, 'layout.json'), layout);
  return layout;
}
function readLayout(root, candidate, requested, memoryMiB, compilerWorkers = 2, { allowUntracked = false } = {}) {
  const { repoRoot: _checkout, ...source } = candidate;
  candidate = source;
  const count = workerCount(requested, memoryMiB);
  const layout = JSON.parse(fs.readFileSync(path.join(workspaceRoot(root, candidate.sourceTree, count), 'layout.json'), 'utf8'));
  assert.equal(layout.schemaVersion, 'pulse.seal-workers.v1');
  assert.equal(layout.estimatedWorkerMiB, WORKER_MIB);
  assert.equal(layout.root, root);
  assert.deepEqual(layout.candidate, candidate);
  assert.equal(layout.workers, count);
  assert.equal(layout.memoryBudgetMiB, memoryMiB);
  assert.equal(layout.compilerWorkers, compilerCount(compilerWorkers, count));
  assert.deepEqual(layout.workspaces, Array.from({ length: count }, (_, index) => ({ id: `worker-${index + 1}`,
    directory: path.join(workspaceRoot(root, candidate.sourceTree, count), `worker-${index + 1}`) })));
  for (const item of layout.workspaces) {
    assert.equal(fs.realpathSync(item.directory), item.directory, 'Worker checkout traverses a symlink');
    // Active siblings create temporary untracked fixtures. They must retain the
    // bound revision and tracked source; full cleanliness is checked at barriers.
    const git = args => execFileSync('git', args, { cwd: item.directory, encoding: 'utf8', timeout: 10000 }).trim();
    const identity = allowUntracked ? { sourceRevision: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']),
      workingTree: git(['status', '--porcelain', '--untracked-files=no']) } : candidateIdentity(item.directory);
    assert.deepEqual(identity, candidate, 'Worker candidate differs');
  }
  return layout;
}
function cleanupWorkspaces(root, tree, count) {
  const parent = workspaceRoot(root, tree, count);
  if (!fs.existsSync(parent)) return;
  assert.equal(fs.realpathSync(parent), parent, 'Worker parent traverses a symlink');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(parent, 'owner.json'), 'utf8')), { root, tree });
  for (let index = 0; index < count; index++) {
    const directory = path.join(parent, `worker-${index + 1}`);
    removeWorker(root, directory);
  }
  fs.rmSync(parent, { recursive: true, force: true });
}
function verifyWorker({ root, candidate, directory, layoutFile, inputs }, { clean = true } = {}) {
  const { repoRoot: _checkout, ...source } = candidate;
  assertManagedWorker(directory, root, source, layoutFile);
  if (clean) assert.deepEqual(candidateIdentity(directory), source, 'Worker is dirty before task execution');
  assert(inputs && typeof inputs === 'object', 'Worker cleanup requires bound executable inputs');
  assert.deepEqual(inputIdentity(directory), inputs, 'Worker dependency/build inputs changed');
}
function cleanupWorker(binding) {
  // One scheduler slot owns this disposable checkout until cleanup completes.
  // Never reset tracked source or discard changes to dependency/build inputs.
  verifyWorker(binding, { clean: false });
  const git = args => execFileSync('git', args, { cwd: binding.directory, encoding: 'utf8', timeout: 15000 });
  const removed = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  for (const relative of removed) {
    const target = path.resolve(binding.directory, relative);
    assert(target.startsWith(`${binding.directory}${path.sep}`), 'Worker output escapes its checkout');
    assert.equal(fs.realpathSync(path.dirname(target)), path.dirname(target), 'Worker output traverses a symlink');
    const stat = fs.lstatSync(target);
    assert(stat.isFile() || stat.isSymbolicLink(), 'Worker output is not an ordinary file or symlink');
    // Delete and observe removal in the verifying process, not through Git.
    // Its owner must await successful terminal reconciliation before reuse.
    fs.rmSync(target, { force: true });
    assert(!fs.existsSync(target), 'Worker output remains after removal');
  }
  verifyWorker(binding);
  return { status: 'passed', removed };
}
async function runWorkerVerification(operation, binding, options = {}) {
  // A fresh, supervised invocation, never a cached proof. The caller continues
  // owning the scheduler slot until this promise settles, including escalation.
  const request = { id: require('node:crypto').randomUUID(), operation, binding };
  const output = [];
  let outputBytes = 0, diagnostic = '';
  const completed = await require('./release-process.cjs').runCommand(process.execPath, ['-e', `
    const request = JSON.parse(process.argv[2]);
    const worker = require(process.argv[1]);
    const result = request.operation === 'verify'
      ? (worker.verifyWorker(request.binding), { status: 'passed', removed: [] })
      : worker.cleanupWorker(request.binding);
    process.stdout.write(JSON.stringify({ request, result }));
  `, __filename, JSON.stringify(request)], {
    timeoutMs: 30000, ...options,
    onOutput(name, chunk) {
      if (name === 'stdout') {
        outputBytes += chunk.length;
        assert(outputBytes <= 1024 * 1024, 'Worker verification output exceeds its bound');
        output.push(chunk);
      } else diagnostic = (diagnostic + chunk).slice(-16000);
    }
  });
  assert(completed.status === 0 && !completed.error && !completed.timedOut &&
    !completed.interruptedBy && !completed.forcedCompletion,
  `Worker ${operation} did not complete: ${completed.error?.message || completed.interruptedBy ||
    (completed.timedOut ? 'timeout' : completed.signal || completed.status)}${diagnostic ? `; ${diagnostic.trim()}` : ''}`);
  const receipt = JSON.parse(Buffer.concat(output).toString('utf8'));
  assert.deepEqual(receipt.request, request, 'Foreign or stale worker verification result');
  assert.equal(receipt.result?.status, 'passed', 'Missing worker verification result');
  assert(Array.isArray(receipt.result.removed) && receipt.result.removed.every(item => typeof item === 'string'),
    'Invalid worker cleanup result');
  return receipt.result;
}
const verifyWorkerAsync = (binding, options) => runWorkerVerification('verify', binding, options);
const cleanupWorkerAsync = (binding, options) => runWorkerVerification('cleanup', binding, options);
function assertManagedWorker(directory, owner, candidate, layoutFile) {
  assert(typeof layoutFile === 'string' && path.isAbsolute(layoutFile), 'Shared pack belongs to another checkout');
  const supplied = JSON.parse(fs.readFileSync(layoutFile, 'utf8'));
  const layout = readLayout(owner, candidate, supplied.workers, supplied.memoryBudgetMiB, supplied.compilerWorkers, { allowUntracked: true });
  assert.equal(layoutFile, path.join(workspaceRoot(owner, candidate.sourceTree, layout.workers), 'layout.json'), 'Foreign worker layout');
  assert(layout.workspaces.some(workspace => workspace.directory === fs.realpathSync(directory)), 'Unowned shared-pack consumer');
}

// Scheduling hints affect order and resource admission, never coverage authority.
// Ordering weights are not deadlines or reported durations. Check independent
// worker packaging early, before spending the compiler lane.
const EARLY_CHECKS = new Set(['suite-shape', 'package-exports', 'boundaries', 'workspace-hygiene',
  'release-feature-acceptance', 'release-runtime-policy']);
const ORDER_WEIGHT = { 'release-artifact-determinism': 1000, 'jwt-rs256': 284, 'jwt-installed-workflow': 250, 'clean-machine-acceptance': 190,
  'schema-codecs': 95, 'fastly-native-platform-capabilities': 75, 'cli-entities-installed-workflow': 69,
  'fastly-entities-native-workflow': 57, 'cli-project-workflow': 50, 'cli-schema-json-workflow': 47,
  'events-cli-workflow': 42, 'canonical-native-wasm': 40, 'bounded-read-loops': 36, 'pure-guarded-arguments': 34 };
// Evidence categories describe assertions, not transitive compiler demand.
// These unit tasks construct Native artifacts through helpers, direct asc, or
// in-process Binaryen. Reserve one token for the entire task, including cleanup;
// this is not a count of asc processes. Audit: docs/internal/b10-ci04/ledger.json.
const COMPILER_TASKS = new Set([
  'report-capsule-contract', 'cli-report-viewer', 'cli-report-retained-evidence',
  'cli-report-relationships', 'cli-report-resource-inventory', 'cli-report-graph-diagnostics',
  'entities-orchestration-demo', 's3-body-read', 'shared-stage-o19'
]);
function scheduling(name, task) {
  const hints = task.scheduling || {};
  return { priority: EARLY_CHECKS.has(name) ? 2 : name === 'str02b-installed' ? 1 : 0,
    cost: hints.cost || ORDER_WEIGHT[name] || 10, resources: hints.resources || [],
    compiler: hints.compiler === undefined ? COMPILER_TASKS.has(name) || !['unit', 'javascript'].includes(task.evidence) : hints.compiler,
    exclusive: hints.exclusive === true || /benchmark|measure|timing/i.test(`${name} ${task.description}`),
    after: hints.after || [] };
}

module.exports = { workerCount, compilerCount, workspaceRoot, prepareWorkspaces, cleanupWorkspaces, readLayout, assertManagedWorker,
  verifyWorker, cleanupWorker, verifyWorkerAsync, cleanupWorkerAsync, scheduling, WORKER_MIB };
if (require.main === module) {
  const [root, requested, memory, compilers = '2'] = process.argv.slice(2);
  const layout = prepareWorkspaces(root, candidateIdentity(root), Number(requested), Number(memory), Number(compilers));
  console.log(`Prepared ${layout.workers} isolated seal workers, ${layout.compilerWorkers} compiler slots (${layout.memoryBudgetMiB} MiB admission budget)`);
}
