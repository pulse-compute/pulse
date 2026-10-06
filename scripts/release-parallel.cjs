'use strict';

// Local workers owned by one seal checkout. No remote scheduler or proof pool.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { candidateIdentity } = require('./release-feature-acceptance.cjs');
const { atomicJson } = require('./release-recovery.cjs');

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
    if (fs.existsSync(directory)) {
      assert(!fs.lstatSync(directory).isSymbolicLink(), 'Worker checkout must not be a symlink');
      git(['worktree', 'remove', '--force', directory]);
    }
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
function readLayout(root, candidate, requested, memoryMiB, compilerWorkers = 2) {
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
    assert.deepEqual(candidateIdentity(item.directory), candidate, 'Worker candidate differs');
  }
  return layout;
}
function cleanupWorkspaces(root, tree, count) {
  const parent = workspaceRoot(root, tree, count);
  if (!fs.existsSync(parent)) return;
  assert(!fs.lstatSync(parent).isSymbolicLink());
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(parent, 'owner.json'), 'utf8')), { root, tree });
  for (let index = 0; index < count; index++) {
    const directory = path.join(parent, `worker-${index + 1}`);
    if (fs.existsSync(directory)) execFileSync('git', ['worktree', 'remove', '--force', directory],
      { cwd: root, stdio: 'pipe', timeout: 15000 });
  }
  fs.rmSync(parent, { recursive: true, force: true });
}
function assertManagedWorker(directory, owner, candidate, layoutFile) {
  assert(typeof layoutFile === 'string' && path.isAbsolute(layoutFile), 'Shared pack belongs to another checkout');
  const supplied = JSON.parse(fs.readFileSync(layoutFile, 'utf8'));
  const layout = readLayout(owner, candidate, supplied.workers, supplied.memoryBudgetMiB, supplied.compilerWorkers);
  assert.equal(layoutFile, path.join(workspaceRoot(owner, candidate.sourceTree, layout.workers), 'layout.json'), 'Foreign worker layout');
  assert(layout.workspaces.some(workspace => workspace.directory === fs.realpathSync(directory)), 'Unowned shared-pack consumer');
}

// Scheduling hints affect order only. The registry remains coverage authority.
const COST_SECONDS = { 'jwt-rs256': 284, 'jwt-installed-workflow': 250, 'clean-machine-acceptance': 190,
  'schema-codecs': 95, 'fastly-native-platform-capabilities': 75, 'cli-entities-installed-workflow': 69,
  'fastly-entities-native-workflow': 57, 'cli-project-workflow': 50, 'cli-schema-json-workflow': 47,
  'events-cli-workflow': 42, 'canonical-native-wasm': 40, 'bounded-read-loops': 36, 'pure-guarded-arguments': 34 };
function scheduling(name, task) {
  const hints = task.scheduling || {};
  return { cost: hints.cost || COST_SECONDS[name] || 10, resources: hints.resources || [],
    compiler: hints.compiler === undefined ? ['native', 'conformance', 'cli', 'external'].includes(task.evidence) : hints.compiler,
    exclusive: hints.exclusive === true || /benchmark|measure|timing/i.test(`${name} ${task.description}`),
    after: hints.after || [] };
}

module.exports = { workerCount, compilerCount, workspaceRoot, prepareWorkspaces, cleanupWorkspaces, readLayout, assertManagedWorker, scheduling, WORKER_MIB };
if (require.main === module) {
  const [root, requested, memory, compilers = '2'] = process.argv.slice(2);
  const layout = prepareWorkspaces(root, candidateIdentity(root), Number(requested), Number(memory), Number(compilers));
  console.log(`Prepared ${layout.workers} isolated seal workers, ${layout.compilerWorkers} compiler slots (${layout.memoryBudgetMiB} MiB admission budget)`);
}
