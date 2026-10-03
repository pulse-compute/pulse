#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');

const root = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-arc01-installed-'));
assert.ok(!temporary.startsWith(root + path.sep), 'installed consumer must be outside the checkout');
let consumer;
const pack = path.join(temporary, 'packages');
const reportParent = path.join(root, 'wasm/.test-results');
fs.mkdirSync(reportParent, { recursive: true });
const reportDir = fs.mkdtempSync(path.join(reportParent, 'arc01-installed-'));
const reportFile = path.join(reportDir, 'arc01-installed-acceptance.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sensitive = [];
const clean = text => sensitive.reduce((value, secret) => value.replaceAll(secret, '<redacted>'),
  text.replaceAll(temporary, '<acceptance>').replaceAll(root, '<checkout>')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<token>'));
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_audit: 'false', npm_config_fund: 'false',
  npm_config_cache: path.join(temporary, 'npm-cache'), npm_config_fetch_retries: '0' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY']) delete env[key];
const report = { version: 'pulse.arc01-installed-acceptance.v1', status: 'running',
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  workingDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })),
  acceptanceScriptSha256: hash(fs.readFileSync(__filename)),
  node: process.version, fixture: 'arc01-installed-workflow', lifecycleScripts: false,
  providerRealityValidated: false, results: [] };

function saveReport() {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportFile + '.tmp', JSON.stringify(report, null, 2) + '\n');
  fs.renameSync(reportFile + '.tmp', reportFile);
}

function run(command, args, { timeout = 120000, onOutput, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', failure;
    const stop = error => {
      failure ||= error;
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
    };
    const timer = setTimeout(() => stop(new Error(`command timed out after ${timeout}ms`)), timeout);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length + stderr.length > 8 * 1024 * 1024) stop(new Error('command output exceeded 8 MiB'));
      if (onOutput) { try { onOutput(stdout); } catch (error) { stop(error); } }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (stdout.length + stderr.length > 8 * 1024 * 1024) stop(new Error('command output exceeded 8 MiB'));
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const record = { command: path.basename(command), args: args.map(clean), code, signal, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
      report.results.push(record); saveReport();
      let diagnostic;
      try { const value=JSON.parse(stdout);diagnostic=JSON.stringify({error:value.error,checks:value.checks?.filter(c=>c.status==='failed'),cases:value.cases?.filter(c=>c.status==='failed'),diagnostics:value.diagnostics}); }
      catch { diagnostic=(stdout+stderr).slice(-6000); }
      if (failure || (!allowFailure && code !== 0) || signal) reject(new Error(`${failure?.message || 'command failed'}: ${JSON.stringify(record)} ${clean(diagnostic)}`));
      else resolve({ stdout, stderr, code });
    });
  });
}

function verifyInstalled(manifest) {
  const digests = [], packages = [];
  for (const name of fs.readdirSync(path.join(consumer, 'node_modules/@pulse-compute')).sort()) {
    const id = '@pulse-compute/' + name;
    const entry = manifest.packages.find(item => item.name === id);
    assert.ok(entry, `unexpected installed Pulse package ${id}`);
    const packageRoot = path.join(consumer, 'node_modules', id);
    assert.ok(fs.realpathSync(packageRoot).startsWith(consumer + path.sep), `workspace link: ${id}`);
    assert.equal(readJson(path.join(packageRoot, 'package.json')).version, entry.version);
    const tarball = path.join(pack, entry.tarball);
    assert.equal(hash(fs.readFileSync(tarball)), entry.sha256);
    for (const [file, bytes] of readTarEntries(tarball)) {
      if (!file.startsWith('package/') || file.endsWith('/')) continue;
      let installed = path.join(packageRoot, file.slice(8));
      if (!fs.existsSync(installed) && path.basename(installed) === '.gitignore') installed = path.join(path.dirname(installed), '.npmignore');
      assert.deepEqual(fs.readFileSync(installed), bytes, `${id}/${file} differs from candidate`);
      digests.push([id + '/' + file.slice(8), hash(bytes)]);
    }
    packages.push({ name: id, version: entry.version, sha256: entry.sha256 });
  }
  assert.ok(packages.some(entry => entry.name === '@pulse-compute/wasm-compiler'));
  return { packages, files: digests.length, sha256: hash(JSON.stringify(digests.sort())) };
}

async function main() {
  try {
    saveReport();
    console.log('arc01-installed - pack exact candidates and install outside checkout');
    const packed = packRelease({ repoRoot: root, outDir: pack });
    const version = packed.manifest.packages.find(p => p.name === '@pulse-compute/pulse').version;
    const cells = { core: ['wasm-compiler', 'runtime'], node: ['wasm-compiler', 'runtime', 'provider-node'],
      fastly: ['wasm-compiler', 'runtime', 'provider-fastly'], cli: ['cli', 'pulse'] };
    const registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(p => path.join(pack, p.tarball))));
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    report.cells = {};
    try {
      for (const [cell, dependencies] of Object.entries(cells)) {
        consumer = path.join(temporary, cell);
        fs.mkdirSync(consumer, { recursive: true });
        fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'arc01-' + cell, private: true,
          dependencies: Object.fromEntries(dependencies.map(name => ['@pulse-compute/' + name, version])) }));
        fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
        console.log(`arc01-installed - ${cell}: exact install, compile and execution`);
        await run('npm', ['install','--ignore-scripts','--no-audit','--no-fund'], { timeout: 180000 });
        const before = verifyInstalled(packed.manifest);
        for (const id of ['node', 'fastly']) {
          const expected = cell === 'cli' || cell === id;
          assert.equal(before.packages.some(p => p.name === '@pulse-compute/provider-' + id), expected, `${cell}: ${id} physical presence`);
        }
        const fixture = 'arc01-fixture.cjs';
        fs.copyFileSync(path.join(__dirname, fixture), path.join(consumer, fixture));
        report.fixtureSha256 = hash(fs.readFileSync(path.join(consumer, fixture)));
        const result = await run(process.execPath, [fixture, cell], { timeout: 180000 });
        const qualification = JSON.parse(result.stdout);
        assert.equal(qualification.status, 'passed');
        assert.deepEqual(verifyInstalled(packed.manifest), before);
        report.cells[cell] = { installed: before, unchanged: true, qualification };
        saveReport();
      }
      assert.equal(registry.requests.missing, 0); assert.equal(registry.requests.rejected, 0);
      report.registry = registry.requests;
    } finally { await new Promise(resolve => registry.server.close(resolve)); }
    assert.equal(hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })), report.workingDiffSha256);
    report.status = 'passed';
    console.log('ok - ARC-01 exact installed compiler/provider independence and bundled CLI qualification');
  } catch (error) { report.status = 'failed'; report.error = clean(error.stack || String(error)); throw error; }
  finally { saveReport(); fs.rmSync(temporary, { recursive: true, force: true }); console.log(`acceptance report - ${reportFile}`); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
