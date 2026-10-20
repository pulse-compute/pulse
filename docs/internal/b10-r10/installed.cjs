#!/usr/bin/env node
'use strict';
// Development qualification only: exact package install and public CLI replay.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../..'));
const output = path.resolve(process.argv[3] || '/tmp/r10-installed');
const { packRelease, readTarEntries } = require(path.join(root, 'scripts/pack-release.cjs'));
const { catalogFromTarballs, createReadOnlyRegistry } = require(path.join(root, 'wasm/test/release/read-only-npm-registry.cjs'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-r10-installed-'));
const bootstrap = path.join(temp, 'bootstrap'), project = path.join(temp, 'project');
const report = { schemaVersion: 'pulse.b10-r10.installed.v1', status: 'running', source: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']), workingTree: git(['status', '--porcelain']), node: process.version, nodeBinarySha256: hash(fs.readFileSync(process.execPath)), scriptSha256: hash(fs.readFileSync(__filename)), lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), startedAt: new Date().toISOString(), commands: [], cleanup: { status: 'pending' }, hosted: 'not-run', seal: 'not-run' };
const env = { ...process.env, npm_config_cache: path.join(temp, 'cache'), npm_config_fetch_retries: '0' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY', 'PULSE_RELEASE_SHARED_PACK']) delete env[key];
function run(command, args, cwd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeout);
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', status => { clearTimeout(timer); timedOut ? reject(new Error('Child timeout: ' + command)) : resolve({ status, stdout, stderr }); });
  });
}
function verifyInstalled(directory, manifest, pack) {
  const files = [], packages = [];
  for (const name of fs.readdirSync(path.join(directory, 'node_modules/@pulse-compute')).sort()) {
    const p = manifest.packages.find(p => p.name === '@pulse-compute/' + name); assert(p);
    packages.push({ name: p.name, version: p.version, sha256: p.sha256 });
    const installed = path.join(directory, 'node_modules', p.name);
    assert(fs.realpathSync(installed).startsWith(directory + path.sep));
    const tarball = path.join(pack, p.tarball); assert.equal(hash(fs.readFileSync(tarball)), p.sha256);
    for (const [file, bytes] of readTarEntries(tarball)) {
      let target = path.join(installed, file.replace(/^package\//, ''));
      if (!fs.existsSync(target) && path.basename(target) === '.gitignore') target = path.join(path.dirname(target), '.npmignore');
      assert.deepEqual(fs.readFileSync(target), bytes, p.name + '/' + file); files.push([p.name + '/' + file, hash(bytes)]);
    }
  }
  assert.equal(packages.length, 20); return { packages, files: files.length, sha256: hash(JSON.stringify(files)) };
}
async function main() {
  const start = Date.now(); let registry;
  assert(!fs.existsSync(output), 'Use a fresh output directory'); fs.mkdirSync(output, { recursive: true });
  const save = () => fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    assert.equal(report.workingTree, '', 'Qualify a committed clean source');
    const build = await run('npm', ['run', 'build'], root); assert.equal(build.status, 0, build.stderr); report.workspaceBuild = 'passed';
    const pack = path.join(output, 'packages');
    const packed = packRelease({ repoRoot: root, outDir: pack, build: false, fresh: true });
    report.packages = packed.manifest.packages.map(p => ({ name: p.name, version: p.version, sha256: p.sha256 }));
    registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(p => path.join(pack, p.tarball))));
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    const npmrc = `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`;
    const dependencies = Object.fromEntries(packed.manifest.packages.map(p => [p.name, p.version]));
    async function install(directory, manifest) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ ...manifest, private: true, type: 'module', dependencies, devDependencies: {} }));
      fs.writeFileSync(path.join(directory, '.npmrc'), npmrc);
      const result = await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], directory, 180000);
      assert.equal(result.status, 0, result.stderr); return verifyInstalled(directory, packed.manifest, pack);
    }
    const before = await install(bootstrap, {}); report.bootstrap = before; report.lifecycleScripts = false; save();
    const cliRoot = path.join(bootstrap, 'node_modules/@pulse-compute/cli');
    const fixtureDirectory = path.join(temp, 'projection-fixtures'); fs.mkdirSync(fixtureDirectory);
    require(path.join(root, 'wasm/test/cli/report-evidence-status-cases.cjs')).runEvidenceStatusCases(cliRoot, fixtureDirectory);
    report.projectionFixtures = 'passed';
    const retained = await run(process.execPath, [path.join(root, 'wasm/test/cli/assert-report-retained-evidence.cjs'), bootstrap, path.join(output, 'retained')], root, 180000);
    fs.writeFileSync(path.join(output, 'retained.log'), retained.stdout + retained.stderr);
    assert.equal(retained.status, 0, retained.stderr); report.retained = JSON.parse(fs.readFileSync(path.join(output, 'retained/acceptance.json')));
    assert.deepEqual(verifyInstalled(bootstrap, packed.manifest, pack), before);
    async function invoke(cli, command, args = [], expected = 0, cwd = project) {
      const result = await run(process.execPath, [cli, command, ...args, '--evidence-status'], cwd);
      assert.equal(result.status, expected, result.stderr);
      const diagnostic = expected === 2 || expected === 3;
      assert.equal(diagnostic ? result.stdout : result.stderr, '');
      const value = JSON.parse(diagnostic ? result.stderr : result.stdout);
      assert.equal(value.kind, 'pulse.command-evidence'); assert.equal(value.presentationVersion, 1);
      assert.equal(value.command, command); assert.equal(value.exitCode, expected);
      assert.equal(value.evidence.qualification, 'not-established-by-this-projection');
      report.commands.push({ command, args, status: expected, stream: diagnostic ? 'stderr' : 'stdout', outcome: value.outcome, evidence: value.evidence.state, snapshot: value.evidence.snapshot }); return value;
    }
    const init = await invoke(path.join(cliRoot, 'bin/pulse.js'), 'init', [project], 0, temp);
    assert.equal(init.outcome, 'completed'); assert.equal(init.evidence.state, 'not-collected');
    const projectBefore = await install(project, JSON.parse(fs.readFileSync(path.join(project, 'package.json')))); report.consumer = projectBefore;
    const cli = path.join(project, 'node_modules/@pulse-compute/cli/bin/pulse.js');
    for (const command of ['doctor', 'inspect', 'test', 'compile', 'build', 'report']) {
      const planned = await invoke(cli, command, ['--plan']); assert.equal(planned.outcome, 'planned'); assert.equal(planned.evidence.identity, null);
    }
    for (const command of ['doctor', 'inspect', 'test']) {
      const result = await invoke(cli, command); assert.equal(result.outcome, 'completed'); assert.equal(result.evidence.state, 'not-collected');
    }
    for (const command of ['compile', 'build']) {
      const built = await invoke(cli, command); assert.equal(built.outcome, 'completed'); assert.equal(built.evidence.state, 'not-collected');
      const verified = await invoke(cli, 'report'); assert.equal(verified.evidence.state, 'verified-completed-artifact'); assert.equal(verified.evidence.snapshot, 'current-inputs-matched');
      const plain = await run(process.execPath, [cli, 'report', '--json'], project); assert.equal(plain.status, 0); assert.equal(plain.stderr, ''); assert.deepEqual(JSON.parse(plain.stdout), verified.result);
      for (const field of Object.values(verified.evidence.source)) assert.deepEqual(field, { state: 'unknown', value: null });
      fs.writeFileSync(path.join(output, command + '-evidence.json'), JSON.stringify(verified, null, 2) + '\n');
    }
    fs.appendFileSync(path.join(project, 'src/index.ts'), '\n// R10 source mutation\n');
    const stale = await invoke(cli, 'report', [], 3); assert.equal(stale.evidence.state, 'stale'); assert.equal(stale.evidence.identity, null); assert.equal(stale.evidence.coverage, null);
    report.installedBytesUnchanged = true; assert.deepEqual(verifyInstalled(project, packed.manifest, pack), projectBefore);
    report.installedLockSha256 = hash(fs.readFileSync(path.join(project, 'package-lock.json')));
    report.registry = { ...registry.requests }; assert.equal(registry.requests.rejected, 0); assert.equal(registry.requests.missing, 0);
    assert.equal(git(['status', '--porcelain']), ''); assert.equal(git(['rev-parse', 'HEAD']), report.source);
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
  finally {
    if (registry) await new Promise(resolve => registry.server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true }); report.cleanup = { status: fs.existsSync(temp) ? 'failed' : 'passed', consumerRemoved: !fs.existsSync(temp) };
    report.durationMs = Date.now() - start; report.finishedAt = new Date().toISOString(); save();
  }
  console.log(JSON.stringify({ status: report.status, output, commands: report.commands.length, cleanup: report.cleanup.status }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
