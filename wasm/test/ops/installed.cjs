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

const { packageDirectory } = require('../mcp/package-directory.cjs');
const { pnpmInvocation } = require('../../../scripts/pnpm-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-ops01-installed-'));
assert.ok(!temporary.startsWith(root + path.sep), 'installed consumer must be outside the checkout');
const consumer = path.join(temporary, 'consumer');
const pack = path.join(temporary, 'packages');
const reportParent = path.join(root, 'wasm/.test-results');
fs.mkdirSync(reportParent, { recursive: true });
const reportDir = fs.mkdtempSync(path.join(reportParent, 'ops01-installed-'));
const reportFile = path.join(reportDir, 'ops01-installed-acceptance.json');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const clean = text => text.replaceAll(temporary, '<acceptance>').replaceAll(root, '<checkout>');
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_audit: 'false', npm_config_fund: 'false',
  npm_config_cache: path.join(temporary, 'npm-cache'), npm_config_fetch_retries: '0' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY']) delete env[key];
const report = { version: 'pulse.ops01-installed-acceptance.v1', status: 'running',
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  workingDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })),
  acceptanceScriptSha256: hash(fs.readFileSync(__filename)),
  node: process.version, fixture: 'packages/mcp/examples/resource-directory', lifecycleScripts: false,
  providerRealityValidated: false, deployed: false, liveGate: 'pending', results: [] };

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
      const record = { command: path.basename(command), args: args.map(clean), code, signal, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
      report.results.push(record); saveReport();
      if (failure || code !== 0 || signal) reject(new Error(`${failure?.message || 'command failed'}: ${JSON.stringify(record)} ${clean((stdout + stderr).slice(-3000))}`));
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
    console.log('ops01-installed - pack exact Pulse candidates, private adapter and application');
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
      console.log('ops01-installed - install extracted application dependency graph outside checkout');
      await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { timeout: 180000 });
      assert.equal(registry.requests.missing, 0); assert.equal(registry.requests.rejected, 0);
      report.registry = registry.requests;
    } finally { await new Promise(resolve => registry.server.close(resolve)); }
    const before = verifyInstalled(manifest); report.installed = before;
    // Keep exact candidates and the client runner for the operator handoff.
    const client = path.join(temporary, 'client'); fs.mkdirSync(client);
    for (const file of ['package.json', 'pnpm-lock.yaml', 'ops-probe.mjs', 'ops-run.mjs']) {
      fs.copyFileSync(path.join(__dirname, '../mcp/reference', file), path.join(client, file));
    }
    fs.mkdirSync(path.join(client, 'ops'));
    for (const file of ['artifacts.cjs', 'exercise.cjs']) fs.copyFileSync(path.join(__dirname, file), path.join(client, 'ops', file));
    fs.copyFileSync(path.join(__dirname, 'rehearsal.mjs'), path.join(client, 'rehearsal.mjs'));
    fs.copyFileSync(path.join(__dirname, '../mcp/authorization-fixture.cjs'), path.join(client, 'authorization-fixture.cjs'));
    fs.cpSync(path.join(root, 'examples/01-hello-json'), path.join(consumer, 'hello'), { recursive: true });
    const pnpm = pnpmInvocation(root);
    await run(pnpm.command, [...pnpm.prefix, 'install', '--frozen-lockfile', '--ignore-scripts'], { cwd: client });
    assert.equal(readJson(path.join(client, 'node_modules/@modelcontextprotocol/client/package.json')).version, '2.2.0');
    const candidates = path.join(reportDir, 'candidates'); fs.mkdirSync(candidates);
    const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
    const mcpFile = path.join(consumer, 'src/index.ts');
    const helloFile = path.join(consumer, 'hello/src/index.ts');
    const originalMcp = fs.readFileSync(mcpFile, 'utf8'), originalHello = fs.readFileSync(helloFile, 'utf8');
    report.artifacts = {};
    for (const revision of ['baseline-rehearsal', 'candidate']) {
      // The baseline is intentionally synthetic, not an earlier production
      // release. Only the candidate contains the unmodified application source.
      fs.writeFileSync(mcpFile, revision === 'candidate' ? originalMcp : originalMcp.replace('Search resources', 'Search resources (rehearsal baseline)'));
      fs.writeFileSync(helloFile, revision === 'candidate' ? originalHello : originalHello.replace('hello from Pulse', 'hello from Pulse rehearsal baseline'));
      await run(process.execPath, [cli, 'build', '--json']);
      await run(process.execPath, [cli, 'build', '--json'], { cwd: path.join(consumer, 'hello') });
      const destination = path.join(candidates, revision); fs.mkdirSync(destination);
      for (const file of ['package.json', 'package-lock.json', 'mcp-server.cjs']) fs.copyFileSync(path.join(consumer,file),path.join(destination,file));
      for (const [from,to] of [['dist-node-javascript','mcp'], ['hello/dist','hello'], ['node_modules','node_modules']]) {
        require('./artifacts.cjs').materialize(path.join(consumer,from),path.join(destination,to));
      }
      const inventory = require('./artifacts.cjs').inventory(destination);
      report.artifacts[revision] = inventory;
      fs.writeFileSync(path.join(candidates, revision + '.json'), JSON.stringify(inventory,null,2) + '\n');
    }
    // Retain exact package hashes and locked installed closure beside artifacts.
    fs.writeFileSync(path.join(candidates, 'packages.json'), JSON.stringify(manifest,null,2) + '\n');
    console.log('ops01-installed - production launchers and SDK: baseline -> candidate -> rollback');
    await run(process.execPath, [path.join(client, 'rehearsal.mjs'), candidates, path.join(reportDir, 'exercise.json')], { cwd: client, timeout: 180000 });
    report.exercise = readJson(path.join(reportDir, 'exercise.json')); assert.equal(report.exercise.status, 'passed');
    assert.deepEqual(report.exercise.stages.map(stage => [stage.name, stage.status]),
      [['baseline', 'passed'], ['candidate', 'passed'], ['rollback', 'passed']]);
    assert.equal(report.exercise.deployed, false);
    assert.equal(report.exercise.liveGate, 'pending');
    fs.cpSync(client, path.join(reportDir, 'client'), {recursive:true,filter:source=>!source.split(path.sep).includes('node_modules')});
    assert.deepEqual(verifyInstalled(manifest), before); report.installed.unchanged = true;
    assert.equal(hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })), report.workingDiffSha256, 'packaging modified tracked source');
    assert.deepEqual(readJson(path.join(reportDir, 'exercise.json')), report.exercise, 'Terminal phase report changed');
    report.status = 'passed'; console.log('ok - exact artifact Node operational rehearsal');
  } catch (error) { report.status = 'failed'; report.error = clean(error.stack || String(error)); throw error; }
  finally { saveReport(); fs.rmSync(temporary, { recursive: true, force: true }); console.log(`acceptance report - ${reportFile}`); }
}
main().catch(error => { console.error(clean(error.stack || String(error))); process.exitCode = 1; });
