#!/usr/bin/env node
'use strict';
// Opt-in development qualification. Creates local and private-prefix global
// installs in owned scratch; never touches the user's real global installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../..'));
const output = path.resolve(process.argv[3] || '/tmp/r11-installed');
const { packRelease, readTarEntries } = require(path.join(root, 'scripts/pack-release.cjs'));
const { catalogFromTarballs, createReadOnlyRegistry } = require(path.join(root, 'wasm/test/release/read-only-npm-registry.cjs'));
const { runDocsLocatorCases } = require(path.join(root, 'wasm/test/cli/docs-locator-cases.cjs'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse r11 installations '));
const local = path.join(temporary, 'local install'), prefix = path.join(temporary, 'global prefix');
const report = { schemaVersion: 'pulse.b10-r11.installed.v1', status: 'running', source: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']), workingTree: git(['status', '--porcelain']), scriptSha256: hash(fs.readFileSync(__filename)), node: process.version, nodeBinarySha256: hash(fs.readFileSync(process.execPath)), platform: process.platform, lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), startedAt: new Date().toISOString(), layouts: [], acquisitionMayUseNetwork: true, cliCasesGuardNetwork: true, cleanup: { status: 'pending' } };
const env = { ...process.env, npm_config_cache: path.join(temporary, 'cache'), npm_config_fetch_retries: '0' };
for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY']) delete env[key];
function run(command, args, cwd, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeout);
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 && !timedOut ? resolve(stdout) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-5000)}`)); });
  });
}
function verify(scope, manifest, pack) {
  const files = [], packages = [], dependencies = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    if (path.basename(path.dirname(directory)) === 'node_modules' || path.basename(path.dirname(directory)) === '@pulse-compute') {
      const file = path.join(directory, 'package.json');
      if (fs.existsSync(file)) { const p = JSON.parse(fs.readFileSync(file)); if (p.name) dependencies.push({ path: path.relative(scope, directory), name: p.name, version: p.version }); }
    }
    if (path.basename(directory) === '@pulse-compute') {
      for (const child of entries) {
        if (!child.isDirectory()) continue;
        const packageDirectory = path.join(directory, child.name);
        assert(fs.realpathSync(packageDirectory).startsWith(fs.realpathSync(scope) + path.sep));
        const p = manifest.packages.find(p => p.name === '@pulse-compute/' + child.name); assert(p);
        const tarball = path.join(pack, p.tarball); assert.equal(hash(fs.readFileSync(tarball)), p.sha256);
        packages.push({ path: path.relative(scope, packageDirectory), name: p.name, version: p.version, sha256: p.sha256 });
        for (const [file, bytes] of readTarEntries(tarball)) {
          let target = path.join(packageDirectory, file.replace(/^package\//, ''));
          if (!fs.existsSync(target) && path.basename(target) === '.gitignore') target = path.join(path.dirname(target), '.npmignore');
          assert.deepEqual(fs.readFileSync(target), bytes, p.name + '/' + file);
          files.push([path.relative(scope, target), hash(bytes)]);
        }
      }
    }
    for (const child of entries) if (child.isDirectory() && child.name !== '.bin') visit(path.join(directory, child.name));
  }
  visit(scope); assert(packages.some(p => p.name === '@pulse-compute/cli'));
  return { packages, dependencies, files: files.length, sha256: hash(JSON.stringify(files)) };
}
async function main() {
  assert(!fs.existsSync(output), 'Use a fresh output directory'); fs.mkdirSync(output, { recursive: true });
  const start = Date.now(); let registry;
  const save = () => fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    assert.equal(report.workingTree, '', 'Use a committed clean source');
    await run('npm', ['run', 'build'], root); report.workspaceBuild = 'passed';
    const pack = path.join(output, 'packages'), packed = packRelease({ repoRoot: root, outDir: pack, build: false, fresh: true });
    report.packages = packed.manifest.packages.map(p => ({ name: p.name, version: p.version, sha256: p.sha256 }));
    registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(p => path.join(pack, p.tarball))));
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    const userconfig = path.join(temporary, 'npmrc');
    fs.writeFileSync(userconfig, `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    env.npm_config_userconfig = userconfig;
    const cli = packed.manifest.packages.find(p => p.name === '@pulse-compute/cli');
    fs.mkdirSync(local); fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify({ private: true, dependencies: { [cli.name]: cli.version } }));
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], local);
    await run('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', cli.name + '@' + cli.version], temporary);
    const layouts = [
      { kind: 'local', scope: local, packageRoot: path.join(local, 'node_modules/@pulse-compute/cli'), binary: path.join(local, 'node_modules/.bin/pulse') },
      { kind: 'private-prefix-global', scope: prefix, packageRoot: path.join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', '@pulse-compute/cli'), binary: path.join(prefix, process.platform === 'win32' ? 'pulse.cmd' : 'bin/pulse') }
    ];
    for (const layout of layouts) {
      assert(layout.packageRoot.includes(' '));
      const before = verify(layout.scope, packed.manifest, pack);
      if (process.platform !== 'win32') assert.equal(fs.realpathSync(layout.binary), fs.realpathSync(path.join(layout.packageRoot, 'bin/pulse.js')));
      const cases = runDocsLocatorCases(layout.packageRoot, { binary: layout.binary });
      assert.deepEqual(verify(layout.scope, packed.manifest, pack), before);
      report.layouts.push({ kind: layout.kind, packageRoot: layout.packageRoot, cases, installed: before, installedBytesUnchanged: true }); save();
    }
    report.installedLockSha256 = hash(fs.readFileSync(path.join(local, 'package-lock.json')));
    report.lifecycleScripts = false; report.registry = { ...registry.requests };
    assert.equal(registry.requests.missing, 0); assert.equal(registry.requests.rejected, 0);
    assert.equal(git(['status', '--porcelain']), ''); assert.equal(git(['rev-parse', 'HEAD']), report.source);
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
  finally {
    if (registry) await new Promise(resolve => registry.server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true }); report.cleanup = { status: fs.existsSync(temporary) ? 'failed' : 'passed', consumersRemoved: !fs.existsSync(temporary) };
    report.durationMs = Date.now() - start; save();
  }
  console.log(JSON.stringify({ status: report.status, layouts: report.layouts.length, output, cleanup: report.cleanup.status }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
