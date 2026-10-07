#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');

const { packageDirectory } = require('./package-directory.cjs');
const { pnpmInvocation } = require('../../../scripts/pnpm-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mcp-installed-'));
assert.ok(!temporary.startsWith(root + path.sep), 'installed consumer must be outside the checkout');
const consumer = path.join(temporary, 'consumer');
const pack = path.join(temporary, 'packages');
const reportParent = path.join(root, 'wasm/.test-results');
fs.mkdirSync(reportParent, { recursive: true });
const reportDir = fs.mkdtempSync(path.join(reportParent, 'mcp-installed-'));
const { installedAcceptanceReport } = require('../support/installed-acceptance-report.cjs');
const reportFile = installedAcceptanceReport(path.join(reportDir, 'mcp-installed-acceptance.json'));

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const clean = text => text.replaceAll(temporary, '<acceptance>').replaceAll(root, '<checkout>');
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_audit: 'false', npm_config_fund: 'false',
  npm_config_cache: path.join(temporary, 'npm-cache'), npm_config_fetch_retries: '0' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY']) delete env[key];
const report = { version: 'pulse.mcp-installed-acceptance.v1', status: 'running',
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  workingDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })),
  acceptanceScriptSha256: hash(fs.readFileSync(__filename)),
  node: process.version, fixture: 'packages/mcp/examples/resource-directory', lifecycleScripts: false,
  providerRealityValidated: false, results: [] };

function saveReport() {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportFile + '.tmp', JSON.stringify(report, null, 2) + '\n');
  fs.renameSync(reportFile + '.tmp', reportFile);
}

function run(command, args, { timeout = 120000, onOutput, cwd = consumer } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
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
      const record = { command: path.basename(command), args: args.map(clean), code, signal, stdout: clean(stdout), stderr: clean(stderr) };
      report.results.push(record); saveReport();
      if (failure || code !== 0 || signal) reject(new Error(`${failure?.message || 'command failed'}: ${JSON.stringify(record)}`));
      else resolve({ stdout, stderr });
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
  for (const name of ['entities', 'pulse', 'cli', 'provider-node', 'mcp']) assert.ok(packages.some(entry => entry.name === '@pulse-compute/' + name));
  return { packages, files: digests.length, sha256: hash(JSON.stringify(digests.sort())) };
}

async function main() {
  try {
    saveReport();
    console.log('mcp-installed - pack standard public Pulse candidates and private application fixture');
    const manifest = packageDirectory(pack);
    const app = manifest.packages.find(entry => entry.name === '@pulse-examples/13-mcp-resource-directory');
    for (const [file, bytes] of readTarEntries(path.join(pack, app.tarball))) {
      if (!file.startsWith('package/') || file.endsWith('/')) continue;
      const destination = path.resolve(consumer, file.slice(8));
      assert.ok(destination.startsWith(consumer + path.sep));
      fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes);
    }
    report.applicationPackage = app;
    const registry = createReadOnlyRegistry(catalogFromTarballs(manifest.packages.map(entry => path.join(pack, entry.tarball))));
    await new Promise((resolve, reject) => { registry.server.once('error', reject); registry.server.listen(0, '127.0.0.1', resolve); });
    try {
      fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
      console.log('mcp-installed - install extracted application dependency graph outside checkout');
      await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { timeout: 180000 });
      assert.equal(registry.requests.missing, 0); assert.equal(registry.requests.rejected, 0);
      report.registry = registry.requests;
    } finally { await new Promise(resolve => registry.server.close(resolve)); }
    const before = verifyInstalled(manifest); report.installed = before;
    const client = path.join(temporary, 'client'); fs.mkdirSync(client);
    for (const file of ['package.json', 'pnpm-lock.yaml', 'directory-proof.mjs']) {
      fs.copyFileSync(path.join(__dirname, 'reference', file), path.join(client, file));
    }
    fs.copyFileSync(path.join(__dirname, 'authorization-fixture.cjs'), path.join(consumer, 'authorization-fixture.cjs'));
    report.fixtureFiles = Object.fromEntries(['authorization-fixture.cjs', 'reference/directory-proof.mjs', 'reference/pnpm-lock.yaml', 'package-directory.cjs']
      .map(file => [file, hash(fs.readFileSync(path.join(__dirname, file)))]));
    const pnpm = pnpmInvocation(root);
    await run(pnpm.command, [...pnpm.prefix, 'install', '--frozen-lockfile', '--ignore-scripts'], { cwd: client });
    assert.equal(readJson(path.join(client, 'node_modules/@modelcontextprotocol/client/package.json')).version, '2.2.0');
    console.log('mcp-installed - ordinary CLI and independent OAuth client over real HTTP');
    await run(process.execPath, [path.join(client, 'directory-proof.mjs'), consumer, path.join(reportDir, 'wire.json')], { cwd: client, timeout: 105000 });
    report.wire = readJson(path.join(reportDir, 'wire.json')); assert.equal(report.wire.status, 'passed');
    assert.deepEqual(verifyInstalled(manifest), before); report.installed.unchanged = true;
    assert.equal(hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })), report.workingDiffSha256, 'packaging modified tracked source');
    report.status = 'passed'; console.log('ok - packaged installed MCP directory acceptance');
  } catch (error) { report.status = 'failed'; report.error = clean(error.stack || String(error)); throw error; }
  finally { saveReport(); fs.rmSync(temporary, { recursive: true, force: true }); console.log(`acceptance report - ${reportFile}`); }
}
main().catch(error => { console.error(clean(error.stack || String(error))); process.exitCode = 1; });
