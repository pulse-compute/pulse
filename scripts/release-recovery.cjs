'use strict';

// Local, checkout-bound seal recovery. No remote lookup or implicit cache scan.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fingerprint } = require('./release-checkpoints.cjs');

const SCHEMA = 'pulse.release-recovery.v1';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash = file => sha256(fs.readFileSync(file));
const slash = file => file.split(path.sep).join('/');
function ordinaryPath(file) {
  const target = path.resolve(file);
  let current = path.parse(target).root;
  for (const segment of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { assert(!fs.lstatSync(current).isSymbolicLink(), `Recovery path traverses a symlink: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}
function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}
function describeArtifact(file) {
  const entries = [];
  const visit = (current, relative) => {
    const stat = fs.lstatSync(current);
    assert(!stat.isSymbolicLink(), `Recovery artifact is a symlink: ${current}`);
    if (stat.isDirectory()) {
      entries.push({ path: relative, kind: 'directory', mode: stat.mode & 0o777 });
      for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name), relative ? `${relative}/${name}` : name);
    } else {
      assert(stat.isFile(), `Recovery artifact is not a regular file: ${current}`);
      entries.push({ path: relative, kind: 'file', mode: stat.mode & 0o777, bytes: stat.size, sha256: fileHash(current) });
    }
  };
  visit(file, '');
  return entries[0].kind === 'file'
    ? { kind: 'file', sha256: entries[0].sha256, mode: entries[0].mode, bytes: entries[0].bytes }
    : { kind: 'directory', sha256: fingerprint(entries) };
}
function workspaceDirectories(root) {
  const directories = [root, path.join(root, 'wasm')];
  for (const parent of [path.join(root, 'packages'), path.join(root, 'wasm/packages')]) {
    if (!fs.existsSync(parent)) continue;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(parent, entry.name, 'package.json'))) directories.push(path.join(parent, entry.name));
    }
  }
  return directories.sort();
}
function inputIdentity(root) {
  const directories = workspaceDirectories(root);
  const workspace = new Set(directories.map(directory => fs.realpathSync(directory)));
  const seen = new Set(), rows = [];
  const moduleRoots = new Set(directories.map(directory => path.join(directory, 'node_modules'))
    .filter(directory => fs.existsSync(directory)).map(directory => fs.realpathSync(directory)));
  // Hash actual dependency bytes, including native tools, rather than treating
  // a lockfile or version string as proof of the installed graph. Follow and
  // deduplicate symlinks; workspace source is already bound by the clean tree.
  const visit = (file, label) => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(file);
      rows.push({ path: label, link: fs.readlinkSync(file), target });
      if (workspace.has(target)) return;
      visit(target, `real:${target}`);
      return;
    }
    const real = fs.realpathSync(file);
    if (seen.has(real)) return;
    seen.add(real);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) {
        // Package-manager bookkeeping and caches are not executable inputs.
        if (moduleRoots.has(real) && ['.cache', '.vite', '.vite-temp', '.modules.yaml', '.pnpm-workspace-state-v1.json', '.package-lock.json'].includes(name)) continue;
        visit(path.join(file, name), `${label}/${name}`);
      }
    } else {
      assert(stat.isFile(), `Unsupported dependency input: ${file}`);
      rows.push({ path: label, mode: stat.mode & 0o777, bytes: stat.size, sha256: fileHash(file) });
    }
  };
  assert(fs.existsSync(path.join(root, 'node_modules')), 'Recovery requires installed dependencies');
  for (const directory of directories) {
    const modules = path.join(directory, 'node_modules');
    if (fs.existsSync(modules)) visit(modules, slash(path.relative(root, modules)));
  }
  const build = directories.flatMap(directory => {
    const dist = path.join(directory, 'dist');
    return fs.existsSync(dist) ? [{ path: slash(path.relative(root, dist)), ...describeArtifact(dist) }] : [];
  });
  return { dependenciesSha256: fingerprint(rows), dependencyFiles: seen.size, buildSha256: fingerprint(build), build };
}
function createContext(root, candidate, options, externalFastly, env = process.env) {
  const { PUBLICATION } = require('./package-support.cjs');
  const pnpm = require('./pnpm-toolchain.cjs').binaryPath(root);
  assert(fs.existsSync(pnpm), 'Release pnpm executable must exist before checkpointing');
  const environment = Object.fromEntries(Object.entries(env).filter(([key]) => !['_', 'SHLVL', 'PWD', 'OLDPWD'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  const layout = options.workers > 1
    ? require('./release-parallel.cjs').readLayout(root, candidate, options.workers, options.memoryBudgetMiB) : null;
  return {
    schemaVersion: SCHEMA,
    candidate: { ...candidate, repoRoot: fs.realpathSync(root) },
    lockfileSha256: fileHash(path.join(root, 'pnpm-lock.yaml')),
    toolchain: { node: process.version, versions: process.versions, platform: process.platform, arch: process.arch,
      osRelease: os.release(), nodeSha256: fileHash(process.execPath), pnpmVersion: PUBLICATION.pnpmVersion,
      pnpmSha256: fileHash(pnpm), fastly: externalFastly,
      fastlySha256: externalFastly.fastlyCli?.binary ? fileHash(externalFastly.fastlyCli.binary) : null },
    environmentSha256: fingerprint(environment),
    options: { requireFastly: options.requireFastly, install: options.install,
      workers: options.workers || 1, memoryBudgetMiB: options.memoryBudgetMiB || 4096,
      dependencyBundleSha256: options.dependencyBundle ? fileHash(options.dependencyBundle) : null },
    selections: { release: require('../wasm/test/suite/registry.cjs').expandProfile('release'),
      features: require('./release-feature-acceptance.cjs').REQUIRED_TASKS },
    inputs: inputIdentity(root),
    ...(layout ? { scheduling: {
      ...layout,
      workspaces: layout.workspaces
        .map(workspace => ({ ...workspace, inputs: inputIdentity(workspace.directory) }))
    } } : {})
  };
}
function artifactPaths(directory) {
  const parent = path.join(directory, 'artifacts');
  return {
    taskReport: path.join(parent, 'release-tasks.json'),
    featureReport: path.join(parent, 'release-feature-acceptance.json'),
    featureTasks: path.join(parent, 'feature-tasks.json'),
    installedReports: path.join(parent, 'installed'),
    fourMode: path.join(parent, 'four-mode-conformance.json'),
    candidateReport: path.join(parent, 'deployment-candidates.json'),
    candidates: path.join(parent, 'deployment-candidates'),
    cleanMachineCorpora: path.join(parent, 'clean-machine-corpora.json'),
    fastlyReality: path.join(parent, 'fastly-reality.json')
  };
}
function recoveryTaskOptions(artifacts, kind = 'release') {
  if (kind === 'features') return Object.fromEntries(require('./release-feature-acceptance.cjs').REQUIRED_TASKS.map(task => [task, {
    env: { PULSE_RELEASE_FEATURE_REPORT_DIR: artifacts.installedReports },
    artifacts: { installedReport: path.join(artifacts.installedReports, `${task}.json`) }
  }]));
  assert.equal(kind, 'release');
  const { tasks } = require('../wasm/test/suite/registry.cjs');
  return {
    'four-mode-conformance': { env: { PULSE_FOUR_MODE_EVIDENCE: artifacts.fourMode }, artifacts: { fourMode: artifacts.fourMode } },
    'deployment-candidates': { args: [...tasks['deployment-candidates'].args, '--out', artifacts.candidates, '--report', artifacts.candidateReport],
      artifacts: { candidates: artifacts.candidates, candidateReport: artifacts.candidateReport } },
    'clean-machine-acceptance': { args: [...tasks['clean-machine-acceptance'].args, '--corpus-report', artifacts.cleanMachineCorpora],
      artifacts: { corpora: artifacts.cleanMachineCorpora } }
  };
}
function sharedPackDefinition() {
  return { id: 'shared-pack', command: 'scripts/release-shared-pack.cjs', args: ['--out', '$artifact.pack'], fresh: true };
}
function recoveryConfig(recovery, kind, selectedTasks) {
  return { schemaVersion: 'pulse.seal-task-recovery.v1', kind, context: recovery.context,
    dependencies: { 'shared-pack': recovery.sharedPack.proofId }, artifacts: recovery.artifacts,
    directory: path.join(recovery.directory, 'checkpoints', kind),
    previousDirectory: recovery.previousDirectory ? path.join(recovery.previousDirectory, 'checkpoints', kind) : undefined,
    selectedTasks, taskOptions: recoveryTaskOptions(recovery.artifacts, kind) };
}
function previousAttempt(root, directory) {
  const parent = path.join(fs.realpathSync(root), '.pulse-seal/attempts');
  ordinaryPath(directory);
  const resolved = fs.realpathSync(directory);
  assert.equal(path.dirname(resolved), parent, 'Resume must name an attempt in this checkout .pulse-seal/attempts');
  assert(fs.lstatSync(directory).isDirectory(), 'Resume attempt must be a regular directory');
  const report = JSON.parse(fs.readFileSync(path.join(resolved, 'report.json'), 'utf8'));
  assert.equal(report.schemaVersion, 'pulse.release-seal.v1', 'Resume requires a seal attempt, not a focused development report');
  assert.equal(report.runDirectory, resolved, 'Resume attempt identity differs from its directory');
  if (report.recovery) assert.equal(report.recovery.directory, resolved, 'Resume checkpoint owner differs from its attempt');
  return resolved;
}
function alive(pid, group = false) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(group && process.platform !== 'win32' ? -pid : pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
function acquireSealLock(root, directory = null) {
  const parent = ordinaryPath(path.join(root, '.pulse-seal'));
  fs.mkdirSync(parent, { recursive: true });
  const file = path.join(parent, 'active.json');
  ordinaryPath(file);
  const guard = path.join(parent, 'lock-claim');
  const owner = { pid: process.pid, hostname: os.hostname(), token: crypto.randomUUID(), directory, childPid: null };
  // Serialize stale takeover as well as fresh acquisition. A second contender
  // must never unlink the first contender's newly acquired lock.
  try { fs.mkdirSync(guard); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('A seal lock acquisition is in progress; inspect an orphaned lock-claim before removing it');
    throw error;
  }
  try {
    if (fs.existsSync(file)) {
      const prior = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(prior.hostname, owner.hostname, 'Seal lock belongs to another host; verify its processes before removing it');
      assert(!alive(prior.pid) && !alive(prior.childPid, true), 'Another seal or its child process is still active');
      if (prior.directory) {
        for (const name of ['release-tasks.json', 'feature-tasks.json']) {
          const reportFile = path.join(prior.directory, 'artifacts', name);
          if (!fs.existsSync(reportFile)) continue;
          const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
          assert(![report.activeChildPid, ...(report.activeChildPids || [])].some(pid => alive(pid, true)), 'A prior seal task process group is still active');
        }
      }
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, prior.token, 'Seal lock owner changed during acquisition');
      fs.unlinkSync(file);
    }
    fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx' });
  } finally { fs.rmdirSync(guard); }
  return {
    child(pid) { owner.childPid = pid; atomicJson(file, owner); },
    release() { if (JSON.parse(fs.readFileSync(file, 'utf8')).token === owner.token) fs.unlinkSync(file); }
  };
}
function pruneRecovery(root, now = Date.now()) {
  const lock = acquireSealLock(root);
  const removed = [], retained = [];
  try {
    const parent = ordinaryPath(path.join(root, '.pulse-seal/attempts'));
    if (!fs.existsSync(parent)) return { removed, retained };
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      const directory = path.join(parent, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) { retained.push(entry.name); continue; }
      let report;
      try { report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8')); } catch (_) { retained.push(entry.name); continue; }
      if (!['passed', 'failed', 'interrupted'].includes(report.status) || !Number.isFinite(Date.parse(report.completedAt)) ||
          Date.parse(report.completedAt) + RETENTION_MS > now) { retained.push(entry.name); continue; }
      // A terminal failure can still retain resources. Keep its evidence until
      // those resources have been dealt with; expiry is not cleanup authority.
      if (report.cleanup?.status === 'failed' || report.cleanup?.retainedPath) { retained.push(entry.name); continue; }
      let live = alive(report.activeChildPid, true);
      for (const name of ['release-tasks.json', 'feature-tasks.json']) {
        const file = path.join(directory, 'artifacts', name);
        try { if (fs.existsSync(file)) {
          const taskReport = JSON.parse(fs.readFileSync(file, 'utf8'));
          live ||= [taskReport.activeChildPid, ...(taskReport.activeChildPids || [])].some(pid => alive(pid, true));
        } }
        catch (_) { live = true; }
      }
      if (live) { retained.push(entry.name); continue; }
      fs.rmSync(directory, { recursive: true });
      removed.push(entry.name);
    }
    return { removed, retained };
  } finally { lock.release(); }
}

module.exports = { SCHEMA, RETENTION_MS, atomicJson, describeArtifact, inputIdentity, createContext, artifactPaths,
  recoveryTaskOptions, sharedPackDefinition, recoveryConfig, previousAttempt, acquireSealLock, pruneRecovery };
