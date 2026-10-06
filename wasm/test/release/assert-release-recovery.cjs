'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const recovery = require('../../../scripts/release-recovery.cjs');
const { fingerprint } = require('../../../scripts/release-checkpoints.cjs');
const { parseArgs } = require('../../../scripts/validate-release.cjs');
const { createSealStatus } = require('../../../scripts/release-seal-status.cjs');
const { candidateIdentity, REQUIRED_TASKS } = require('../../../scripts/release-feature-acceptance.cjs');
const { tasks, expandProfile } = require('../suite/registry.cjs');
const { checkpointDefinition, validateRecoveryConfig } = require('../../scripts/run-wasm-tests.cjs');

let fixtures = 0;
function put(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function fixture(run, initialize = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-recovery-controls-'));
  try {
    if (initialize) {
      fs.mkdirSync(path.join(root, 'wasm'));
      put(path.join(root, 'packages/one/package.json'), '{"name":"one"}');
      put(path.join(root, 'packages/one/src.js'), 'module.exports = 1;\n');
      put(path.join(root, 'packages/one/dist/index.js'), 'module.exports = 1;\n');
      put(path.join(root, 'node_modules/dependency/index.js'), 'module.exports = 1;\n');
      put(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
      put(path.join(root, '.validation-tools/pnpm/bin', process.platform === 'win32' ? 'pnpm.exe' : 'pnpm'), 'pnpm fixture bytes\n');
      put(path.join(root, '.gitignore'), 'node_modules/\ndist/\n.validation-tools/\nstore/\n.pulse-seal/\n');
      git(root, 'init', '--quiet');
      git(root, 'add', '.');
      git(root, '-c', 'user.name=Recovery fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
    }
    await run(root);
    fixtures++;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function main() {
  await fixture(root => {
    const candidate = candidateIdentity(root);
    const options = { install: false, requireFastly: false };
    const fastly = { status: 'unavailable' };
    const env = { PATH: '/fixture/tools', FEATURE: 'on', PWD: root, SHLVL: '1' };
    const baseline = recovery.createContext(root, candidate, options, fastly, env);
    assert.equal(baseline.candidate.repoRoot, fs.realpathSync(root));
    assert.equal(baseline.candidate.sourceRevision, git(root, 'rev-parse', 'HEAD'));
    assert.equal(baseline.candidate.sourceTree, git(root, 'rev-parse', 'HEAD^{tree}'));
    assert.equal(baseline.toolchain.node, process.version);
    assert.match(baseline.toolchain.nodeSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(recovery.createContext(root, candidate, options, fastly, { ...env, PWD: '/changed', SHLVL: '2' }), baseline);
    assert.notEqual(fingerprint(recovery.createContext(root, candidate, options, fastly, { ...env, FEATURE: 'off' })), fingerprint(baseline));
    assert.notEqual(fingerprint(recovery.createContext(root, candidate, { ...options, requireFastly: true }, fastly, env)), fingerprint(baseline));
    assert.notEqual(fingerprint(recovery.createContext(root, candidate, options, { status: 'available', version: 'different' }, env)), fingerprint(baseline));

    fs.appendFileSync(path.join(root, 'pnpm-lock.yaml'), 'changed: true\n');
    assert.notEqual(recovery.createContext(root, candidate, options, fastly, env).lockfileSha256, baseline.lockfileSha256);
    assert.throws(() => candidateIdentity(root), /clean candidate/);
    git(root, 'checkout', '--', 'pnpm-lock.yaml');

    const pnpm = path.join(root, '.validation-tools/pnpm/bin', process.platform === 'win32' ? 'pnpm.exe' : 'pnpm');
    fs.appendFileSync(pnpm, 'different executable bytes\n');
    assert.notEqual(recovery.createContext(root, candidate, options, fastly, env).toolchain.pnpmSha256, baseline.toolchain.pnpmSha256);
    fs.rmSync(pnpm);
    assert.throws(() => recovery.createContext(root, candidate, options, fastly, env), /pnpm executable/);
  }, true);

  await fixture(root => {
    const options = { install: true, requireFastly: true };
    const oldCandidate = candidateIdentity(root);
    const original = recovery.createContext(root, oldCandidate, options, {}, {});
    put(path.join(root, 'packages/one/src.js'), 'module.exports = 2;\n');
    git(root, 'add', '.');
    git(root, '-c', 'user.name=Recovery fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'changed source');
    const changed = recovery.createContext(root, candidateIdentity(root), options, {}, {});
    assert.notEqual(fingerprint(changed), fingerprint(original));
    assert.notEqual(changed.candidate.sourceTree, original.candidate.sourceTree);
    const bundle = path.join(root, 'store/dependencies.tar.gz');
    put(bundle, 'exact bundle bytes');
    const bundled = recovery.createContext(root, candidateIdentity(root), { ...options, dependencyBundle: bundle }, {}, {});
    fs.appendFileSync(bundle, 'mutation');
    assert.notEqual(recovery.createContext(root, candidateIdentity(root), { ...options, dependencyBundle: bundle }, {}, {}).options.dependencyBundleSha256, bundled.options.dependencyBundleSha256);
  }, true);

  await fixture(root => {
    const baseline = recovery.inputIdentity(root);
    const dependency = path.join(root, 'node_modules/dependency/index.js');
    fs.appendFileSync(dependency, 'module.exports.extra = true;\n');
    assert.notEqual(recovery.inputIdentity(root).dependenciesSha256, baseline.dependenciesSha256);
    const beforeMode = recovery.inputIdentity(root);
    fs.chmodSync(dependency, 0o755);
    assert.notEqual(recovery.inputIdentity(root).dependenciesSha256, beforeMode.dependenciesSha256);
    const built = path.join(root, 'packages/one/dist/index.js');
    fs.appendFileSync(built, 'module.exports.extra = true;\n');
    assert.notEqual(recovery.inputIdentity(root).buildSha256, baseline.buildSha256);
    const beforeAdd = recovery.inputIdentity(root);
    put(path.join(root, 'packages/one/dist/additional.js'), 'additional built output');
    assert.notEqual(recovery.inputIdentity(root).buildSha256, beforeAdd.buildSha256);
    const cacheInput = path.join(root, 'node_modules/dependency/.cache/executable.js');
    put(cacheInput, 'module.exports = 1;');
    const beforeCacheMutation = recovery.inputIdentity(root);
    fs.appendFileSync(cacheInput, 'module.exports.extra = 2;');
    assert.notEqual(recovery.inputIdentity(root).dependenciesSha256, beforeCacheMutation.dependenciesSha256, 'Nested package content remains bound even under a directory named .cache');
  }, true);

  await fixture(root => {
    const store = path.join(root, 'store/a');
    put(path.join(store, 'index.js'), 'module.exports = 1;');
    fs.symlinkSync(store, path.join(root, 'node_modules/linked'), 'dir');
    fs.symlinkSync(store, path.join(store, 'cycle'), 'dir');
    const first = recovery.inputIdentity(root);
    assert(first.dependencyFiles < 30, 'A cyclic dependency link must terminate');
    fs.appendFileSync(path.join(store, 'index.js'), 'module.exports.changed = true;');
    assert.notEqual(recovery.inputIdentity(root).dependenciesSha256, first.dependenciesSha256, 'External symlink targets are hashed');
    const replacement = path.join(root, 'store/b');
    fs.mkdirSync(replacement, { recursive: true });
    fs.copyFileSync(path.join(store, 'index.js'), path.join(replacement, 'index.js'));
    fs.symlinkSync(replacement, path.join(replacement, 'cycle'), 'dir');
    const beforePointer = recovery.inputIdentity(root);
    fs.unlinkSync(path.join(root, 'node_modules/linked'));
    fs.symlinkSync(replacement, path.join(root, 'node_modules/linked'), 'dir');
    assert.notEqual(recovery.inputIdentity(root).dependenciesSha256, beforePointer.dependenciesSha256, 'Same bytes at a different dependency target invalidate');
    fs.symlinkSync(path.join(root, 'packages/one'), path.join(root, 'node_modules/workspace'), 'dir');
    const workspaceLinked = recovery.inputIdentity(root);
    fs.appendFileSync(path.join(root, 'packages/one/dist/index.js'), 'module.exports.changed = true;');
    assert.notEqual(recovery.inputIdentity(root).buildSha256, workspaceLinked.buildSha256, 'Skipping a workspace symlink still binds its generated outputs');
  }, true);

  await fixture(root => {
    const file = path.join(root, 'artifact.txt');
    put(file, 'artifact bytes');
    const first = recovery.describeArtifact(file);
    fs.chmodSync(file, 0o755);
    assert.notDeepEqual(recovery.describeArtifact(file), first, 'Direct-file artifact modes are pinned');
    const directory = path.join(root, 'artifacts');
    put(path.join(directory, 'report.json'), '{}');
    const original = recovery.describeArtifact(directory);
    put(path.join(directory, 'added.txt'), 'added');
    assert.notEqual(recovery.describeArtifact(directory).sha256, original.sha256);
    fs.symlinkSync(file, path.join(directory, 'unsafe'));
    assert.throws(() => recovery.describeArtifact(directory), /symlink/);
  });

  await fixture(root => {
    const directory = path.join(root, '.pulse-seal/attempts/first');
    const artifacts = recovery.artifactPaths(directory);
    for (const file of Object.values(artifacts)) assert(file.startsWith(`${directory}${path.sep}artifacts${path.sep}`));
    const context = { candidate: 'candidate' };
    const identity = { directory, previousDirectory: path.join(root, '.pulse-seal/attempts/previous'), context, artifacts, sharedPack: { proofId: 'first-package-proof' } };
    const release = recovery.recoveryConfig(identity, 'release', expandProfile('release'));
    assert.equal(validateRecoveryConfig(release, { selected: expandProfile('release'), requested: expandProfile('release') }), release);
    assert.equal(release.previousDirectory, path.join(identity.previousDirectory, 'checkpoints/release'));
    assert.deepEqual(release.dependencies, { 'shared-pack': 'first-package-proof' });
    const changed = recovery.recoveryConfig({ ...identity, sharedPack: { proofId: 'rebuilt-package-proof' } }, 'release', expandProfile('release'));
    assert.notDeepEqual(changed.dependencies, release.dependencies);
    const features = recovery.recoveryConfig(identity, 'features', REQUIRED_TASKS);
    assert.deepEqual(Object.keys(features.taskOptions), REQUIRED_TASKS);
    for (const [name, options] of Object.entries(features.taskOptions)) {
      assert.equal(options.artifacts.installedReport, path.join(artifacts.installedReports, `${name}.json`));
      assert.equal(options.env.PULSE_RELEASE_FEATURE_REPORT_DIR, artifacts.installedReports);
    }
    const secondArtifacts = recovery.artifactPaths(path.join(root, '.pulse-seal/attempts/second'));
    for (const name of ['four-mode-conformance', 'deployment-candidates', 'clean-machine-acceptance']) {
      const secondOptions = recovery.recoveryTaskOptions(secondArtifacts)[name];
      assert.deepEqual(checkpointDefinition(name, tasks[name], release.taskOptions[name]), checkpointDefinition(name, tasks[name], secondOptions), `Attempt-owned output paths do not change ${name}'s semantic definition`);
    }
    assert.throws(() => recovery.recoveryTaskOptions(artifacts, 'unknown'), /unknown|release/);
  });

  await fixture(root => {
    const attempt = path.join(root, '.pulse-seal/attempts/current');
    put(path.join(attempt, 'report.json'), JSON.stringify({ schemaVersion: 'pulse.release-seal.v1', runDirectory: attempt, status: 'failed' }));
    assert.equal(recovery.previousAttempt(root, attempt), attempt);
    const other = path.join(root, 'unrelated');
    put(path.join(other, 'report.json'), JSON.stringify({ runDirectory: other }));
    assert.throws(() => recovery.previousAttempt(root, other), /this checkout/);
    const alias = path.join(root, '.pulse-seal/attempts/alias');
    fs.symlinkSync(attempt, alias, 'dir');
    assert.throws(() => recovery.previousAttempt(root, alias), /regular|symlink|ordinary/);
    put(path.join(attempt, 'report.json'), JSON.stringify({ schemaVersion: 'pulse.release-seal.v1', runDirectory: other }));
    assert.throws(() => recovery.previousAttempt(root, attempt), /identity/);
    put(path.join(attempt, 'report.json'), JSON.stringify({ schemaVersion: 'pulse.wasm-test-report.v1', runDirectory: attempt, status: 'passed' }));
    assert.throws(() => recovery.previousAttempt(root, attempt), /focused development report/);
  });

  await fixture(root => {
    const lock = recovery.acquireSealLock(root);
    try {
      assert.throws(() => recovery.acquireSealLock(root), /active|lock|takeover/);
      lock.child(process.pid);
      const contents = JSON.parse(fs.readFileSync(path.join(root, '.pulse-seal/active.json'), 'utf8'));
      assert.equal(contents.childPid, process.pid);
      assert.throws(() => recovery.pruneRecovery(root), /active|lock|takeover/);
    } finally { lock.release(); }
    assert.equal(fs.existsSync(path.join(root, '.pulse-seal/active.json')), false);
    const file = path.join(root, '.pulse-seal/active.json');
    put(file, JSON.stringify({ pid: 2147483647, childPid: null, hostname: os.hostname(), token: 'stale', directory: null }));
    recovery.acquireSealLock(root).release();
    put(file, JSON.stringify({ pid: 2147483647, childPid: null, hostname: `${os.hostname()}-other`, token: 'foreign', directory: null }));
    assert.throws(() => recovery.acquireSealLock(root), /another host/);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'foreign');
  });

  await fixture(async root => {
    if (process.platform === 'win32') return;
    const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000);'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    await once(child.stdout, 'data');
    const exited = once(child, 'exit');
    try {
      put(path.join(root, '.pulse-seal/active.json'), JSON.stringify({ pid: 2147483647, childPid: child.pid, hostname: os.hostname(), token: 'orphaned-parent', directory: null }));
      assert.throws(() => recovery.acquireSealLock(root), /child process.*active|still active/);
      const directory = path.join(root, '.pulse-seal/attempts/orphaned');
      put(path.join(directory, 'artifacts/release-tasks.json'), JSON.stringify({ activeChildPid: child.pid }));
      put(path.join(root, '.pulse-seal/active.json'), JSON.stringify({ pid: 2147483647, childPid: null, hostname: os.hostname(), token: 'orphaned-runner', directory }));
      assert.throws(() => recovery.acquireSealLock(root), /process group.*active/);
    } finally { process.kill(-child.pid, 'SIGKILL'); await exited; }
  });

  await fixture(async root => {
    put(path.join(root, '.pulse-seal/active.json'), JSON.stringify({ pid: 2147483647, childPid: null, hostname: os.hostname(), token: 'stale', directory: null }));
    const helper = require.resolve('../../../scripts/release-recovery.cjs');
    const children = Array.from({ length: 5 }, () => spawn(process.execPath, ['-e', `
      const fs=require('node:fs');const path=require('node:path');
      const {acquireSealLock}=require(process.argv[1]);const root=process.argv[2];
      let lock;try{lock=acquireSealLock(root);process.stdout.write('acquired\\n');}
      catch(error){process.stdout.write('blocked\\n');process.exit(0);}
      const timer=setInterval(()=>{if(fs.existsSync(path.join(root,'release'))){clearInterval(timer);lock.release();}},10);
    `, helper, root], { stdio: ['ignore', 'pipe', 'pipe'] }));
    const exits = children.map(child => once(child, 'exit'));
    const timeout = setTimeout(() => children.forEach(child => child.kill('SIGKILL')), 5000);
    try {
      const outcomes = await Promise.all(children.map(child => new Promise((resolve, reject) => {
        child.stdout.once('data', chunk => resolve(String(chunk).trim()));
        child.once('error', reject);
      })));
      assert.equal(outcomes.filter(value => value === 'acquired').length, 1, 'Concurrent stale-lock takeover elects exactly one owner');
      put(path.join(root, 'release'), 'release');
      const completed = await Promise.all(exits);
      assert(completed.every(([code]) => code === 0));
    } finally { clearTimeout(timeout); for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); }
  });

  await fixture(root => {
    const now = Date.now();
    const parent = path.join(root, '.pulse-seal/attempts');
    const old = new Date(now - recovery.RETENTION_MS - 1000).toISOString();
    const recent = new Date(now - 1000).toISOString();
    for (const [name, status, completedAt] of [['expired', 'failed', old], ['recent', 'passed', recent], ['running', 'running', old], ['unknown', 'failed', null]]) {
      const directory = path.join(parent, name);
      put(path.join(directory, 'report.json'), JSON.stringify({ runDirectory: directory, status, completedAt }));
    }
    const outside = path.join(root, 'outside');
    put(path.join(outside, 'sentinel'), 'untouched');
    fs.symlinkSync(outside, path.join(parent, 'alias'), 'dir');
    const result = recovery.pruneRecovery(root, now);
    assert.deepEqual(result.removed, ['expired']);
    assert.deepEqual(result.retained.sort(), ['alias', 'recent', 'running', 'unknown']);
    assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'untouched');
  });

  await fixture(root => {
    const external = path.join(root, 'outside');
    const directory = path.join(external, 'expired');
    put(path.join(directory, 'report.json'), JSON.stringify({ runDirectory: directory, status: 'passed', completedAt: new Date(Date.now() - recovery.RETENTION_MS - 1000).toISOString() }));
    fs.mkdirSync(path.join(root, '.pulse-seal'));
    fs.symlinkSync(external, path.join(root, '.pulse-seal/attempts'), 'dir');
    assert.throws(() => recovery.pruneRecovery(root), /symlink|ordinary|checkout|recovery path/i);
    assert.equal(fs.existsSync(path.join(directory, 'report.json')), true);
  });

  await fixture(root => {
    fs.mkdirSync(path.join(root, '.pulse-seal/lock-claim'), { recursive: true });
    assert.throws(() => recovery.acquireSealLock(root), /acquisition.*progress|lock-claim/);
    assert.equal(fs.existsSync(path.join(root, '.pulse-seal/lock-claim')), true, 'An orphaned acquisition guard is never guessed safe to delete');
  });

  await fixture(root => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, '.pulse-seal'), 'dir');
    const resultsRoot = path.join(root, 'results');
    assert.throws(() => createSealStatus({ resultsRoot, attemptsRoot: path.join(root, '.pulse-seal/attempts'), initial: {}, output() {} }), /attempt path traverses a symlink/);
    assert.deepEqual(fs.readdirSync(outside), [], 'Status creation cannot write an attempt through a symlink before the seal lock');
    assert.equal(fs.existsSync(resultsRoot), false);
  });

  await fixture(root => {
    const resultsRoot = path.join(root, 'results');
    const attemptsRoot = path.join(root, '.pulse-seal/attempts');
    const options = { resultsRoot, attemptsRoot, initial: {}, output() {} };
    const active = createSealStatus(options);
    const rejected = createSealStatus({ ...options, deferLatest: true });
    let granted;
    const current = () => JSON.parse(fs.readFileSync(path.join(resultsRoot, 'release-seal.json'), 'utf8'));
    try {
      rejected.finish({ status: 'failed', error: { message: 'Another seal is active' } });
      assert.equal(JSON.parse(fs.readFileSync(path.join(rejected.directory, 'report.json'), 'utf8')).status, 'failed');
      assert.equal(current().runDirectory, active.directory, 'A rejected contender retains its own report without stealing current status');
      active.persist({ currentStep: 'release' });
      assert.equal(current().currentStep, 'release');
      active.finish({ status: 'passed' });
      assert.equal(current().status, 'passed');
      assert.throws(() => rejected.claimLatest(), /terminal seal attempt/);
      granted = createSealStatus({ ...options, deferLatest: true });
      assert.equal(current().runDirectory, active.directory);
      granted.claimLatest();
      assert.equal(current().runDirectory, granted.directory, 'The next lock owner explicitly claims latest');
      granted.finish({ status: 'passed' });
      assert.equal(current().status, 'passed');
    } finally { active.close(); rejected.close(); granted?.close(); }
  });

  assert.equal(parseArgs(['--resume', '/tmp/previous', '--skip-install']).resume, '/tmp/previous');
  assert.equal(parseArgs(['--prune-recovery']).pruneRecovery, true);
  assert.equal(parseArgs(['--timeout-minutes', '4']).timeoutMs, 240000);
  for (const args of [ ['--resume'], ['--resume', '--help'], ['--resume', '/tmp/previous', '--no-report'], ['--prune-recovery', '--skip-install'], ['--skip-install', '--dependency-bundle', '/tmp/bundle'], ['--timeout-minutes', '0'], ['--timeout-minutes', '1441'], ['--unknown'] ]) assert.throws(() => parseArgs(args));
  console.log(`release-recovery: ${fixtures} candidate, dependency, artifact, locking and pruning fixtures passed`);
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
