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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-entities-installed-'));
assert.ok(!temporary.startsWith(root + path.sep), 'installed consumer must be outside the checkout');
const consumer = path.join(temporary, 'consumer');
const pack = path.join(temporary, 'packages');
const reportParent = path.join(root, 'wasm/.test-results');
fs.mkdirSync(reportParent, { recursive: true });
const reportDir = fs.mkdtempSync(path.join(reportParent, 'entities-installed-'));
const reportFile = path.join(reportDir, 'entities-installed-acceptance.json');
const profiles = ['node-javascript', 'node-native', 'fastly-javascript', 'fastly-native'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const clean = text => text.replaceAll(temporary, '<acceptance>').replaceAll(root, '<checkout>');
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_audit: 'false', npm_config_fund: 'false',
  npm_config_cache: path.join(temporary, 'npm-cache'), npm_config_fetch_retries: '0' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY']) delete env[key];
const report = { version: 'pulse.entities-installed-acceptance.v1', status: 'running',
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  workingDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })),
  acceptanceScriptSha256: hash(fs.readFileSync(__filename)),
  node: process.version, fixture: 'examples/10-entities-tools', lifecycleScripts: false,
  providerRealityValidated: false, results: [] };

function saveReport() {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportFile + '.tmp', JSON.stringify(report, null, 2) + '\n');
  fs.renameSync(reportFile + '.tmp', reportFile);
}

function run(command, args, { timeout = 120000, onOutput } = {}) {
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
  for (const name of ['entities', 'pulse', 'cli', 'provider-node', 'provider-fastly']) assert.ok(packages.some(entry => entry.name === '@pulse-compute/' + name));
  return { packages, files: digests.length, sha256: hash(JSON.stringify(digests.sort())) };
}

async function main() {
  try {
    console.log('acceptance - pack current candidate with the release packer');
    const packed = packRelease({ repoRoot: root, outDir: pack });
    const example = path.join(root, 'examples/10-entities-tools');
    fs.cpSync(example, consumer, { recursive: true, filter: file => !path.relative(example, file).split(path.sep).some(part => part === 'node_modules' || part.startsWith('dist') || part.startsWith('.pulse-')) });
    // Install only the example's declared dependency graph, from exact candidate
    // packages. Ordinary third-party dependencies use npm; Pulse cannot escape
    // the read-only candidate registry to pick up a previously published version.
    const registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(entry => path.join(pack, entry.tarball))));
    await new Promise((resolve, reject) => { registry.server.once('error', reject); registry.server.listen(0, '127.0.0.1', resolve); });
    try {
      fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
      console.log('acceptance - install declared example dependencies outside the checkout');
      await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { timeout: 180000 });
      assert.equal(registry.requests.missing, 0);
      assert.equal(registry.requests.rejected, 0);
      report.registry = registry.requests;
    } finally { await new Promise(resolve => registry.server.close(resolve)); }
    const before = verifyInstalled(packed.manifest);
    report.installed = before;
    report.applicationSourceSha256 = hash(fs.readFileSync(path.join(consumer, 'src/index.ts')));
    const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
    const pulse = async args => JSON.parse((await run(process.execPath, [cli, ...args, '--json'])).stdout);
    report.profiles = [];
    for (const profile of profiles) {
      console.log(`acceptance - ${profile}: doctor, inspect, test, dev, build, artifacts`);
      const [provider, target] = profile.split('-');
      const doctor = await pulse(['doctor', '--profile', profile]);
      assert.equal(doctor.status, 'passed'); assert.equal(doctor.summary.failed, 0);
      const inspection = await pulse(['inspect', '--profile', profile]);
      assert.equal(inspection.status, 'ok');
      const artifacts = inspection.compiler.packageInspection.artifacts;
      const catalog = artifacts.find(entry => entry.id === 'pulse.entities-catalog.v1').data;
      assert.deepEqual(catalog.routers[0].entities.map(entry => entry.name), ['customer.lookup', 'system.status']);
      assert.ok(catalog.routers[0].entities.every(entry => entry.eligibility[profile]));
      const tests = await pulse(['test', '--profile', profile]);
      assert.deepEqual(tests.summary, { total: 2, passed: 2, failed: 0 });
      let sent = false, response;
      const dev = await run(process.execPath, [cli, 'dev', '--profile', profile, '--port', '0', '--no-watch', '--once', '--json'], {
        timeout: 60000,
        onOutput(stdout) {
          for (const line of stdout.split('\n')) {
            let event; try { event = JSON.parse(line); } catch { continue; }
            if (sent || event.event !== 'ready') continue;
            sent = true;
            response = fetch(event.url, { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', method: 'system.status', id: 'installed-dev' }), signal: AbortSignal.timeout(5000) })
              .then(async result => ({ status: result.status, body: await result.json() }))
              .catch(error => ({ error: error.message }));
          }
        }
      });
      assert.ok(sent, dev.stdout);
      assert.deepEqual(await response, { status: 200, body: { jsonrpc: '2.0', result: null, id: 'installed-dev' } });
      const devEvents = dev.stdout.trim().split('\n').map(line => JSON.parse(line));
      assert.equal(devEvents.filter(event => event.event === 'ready').length, 1);
      assert.equal(devEvents.filter(event => event.event === 'request').length, 1);
      assert.ok(!devEvents.some(event => event.event.endsWith('error')));
      const build = await pulse(['build', '--profile', profile]);
      assert.equal(build.status, 'built');
      const out = path.join(consumer, 'dist-' + profile);
      const manifest = readJson(path.join(out, 'pulse-build.json'));
      assert.equal(manifest.provider, provider); assert.equal(manifest.configuredTarget, target);
      assert.deepEqual(readJson(path.join(out, 'entities-catalog.json')), catalog);
      assert.equal(readJson(path.join(out, 'entities-inspection.json')).catalogHash, catalog.catalogHash);
      const inspected = await pulse(['inspect', '--artifact', path.join(out, 'pulse-build.json')]);
      assert.deepEqual(inspected.value, manifest);
      const cell = { profile, status: 'passed', devRequests: 1, devExit: 0, catalogHash: catalog.catalogHash, buildMode: manifest.buildMode };
      if (target === 'native') {
        const wasm = fs.readFileSync(path.join(out, provider === 'node' ? 'canonical-native.wasm' : 'bin/main.wasm'));
        const plan = readJson(path.join(out, provider === 'node' ? 'canonical-native-plan.json' : 'fastly-native-plan.json'));
        cell.wasmSha256 = hash(wasm); cell.planHash = plan.planHash;
        assert.equal(plan.packages.application.contractId, 'pulse.entities');
        assert.equal(plan.packages.application.automaticFallback, false);
        if (provider === 'fastly') {
          const providerManifest = readJson(path.join(out, 'fastly-native-manifest.json'));
          assert.equal(providerManifest.planHash, cell.planHash);
          assert.equal(providerManifest.wasm.sha256, cell.wasmSha256);
        }
        const module = new WebAssembly.Module(wasm);
        assert.ok(WebAssembly.Module.imports(module).every(entry => entry.module === 'env' || (provider === 'node' ? entry.module === 'pulse_host' : entry.module.startsWith('fastly_') || entry.module === 'wasi_snapshot_preview1')));
        for (const test of tests.cases) {
          assert.equal(test.executionEvidence.wasmSha256, cell.wasmSha256);
          if (provider === 'node') {
            assert.equal(test.executionEvidence.planHash, cell.planHash);
            assert.equal(test.executionEvidence.automaticFallback, false);
          } else {
            assert.equal(test.executionEvidence.kind, 'fastly-native-fixture-abi');
            assert.equal(test.executionEvidence.providerRealityValidated, false);
          }
        }
      } else {
        assert.equal(manifest.automaticFallback, false);
        assert.ok(fs.existsSync(path.join(out, provider === 'node' ? 'pulse-javascript-source-package.json' : 'pulse-fastly-javascript-source-package.json')));
        assert.equal(manifest.providerTarget.nativeWasm, false);
      }
      report.profiles.push(cell); saveReport();
    }
    assert.deepEqual(verifyInstalled(packed.manifest), before, 'installed candidate bytes changed during lifecycle');
    report.installed.unchanged = true;
    report.status = 'passed';
    console.log('ok - installed example 10 passes all four ordinary lifecycles, exact Native artifacts and unchanged package bytes; Fastly execution uses its local fixture runtime, not live deployment');
  } catch (error) {
    report.status = 'failed'; report.error = clean(error.stack || String(error)); throw error;
  } finally {
    saveReport();
    fs.rmSync(temporary, { recursive: true, force: true });
    console.log(`acceptance report - ${reportFile}`);
  }
}
main().catch(error => { console.error(clean(error.stack || String(error))); process.exitCode = 1; });
