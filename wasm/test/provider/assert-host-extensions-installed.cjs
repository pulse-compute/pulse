#!/usr/bin/env node
'use strict';
// Opt-in packed consumer proof. Product entry points are the installed CLI and
// declared package exports; repository imports below are evidence tooling only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');
const root = path.resolve(__dirname, '../../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const [packArg, outputArg, baselineArg] = process.argv.slice(2);
assert(packArg && outputArg, 'Usage: assert-host-extensions-installed.cjs PACK OUTPUT [BASELINE_PROOF]');
const pack = path.resolve(packArg), output = path.resolve(outputArg);
assert(!fs.existsSync(output), 'Use a fresh output directory');
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-hex04-installed-'));
const consumer = path.join(temporary, 'consumer');
fs.mkdirSync(consumer);
const manifestBytes = fs.readFileSync(path.join(pack, 'pulse-release-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const proof = { version: 'hex04.installed.v1', status: 'running', packManifestSha256: hash(manifestBytes),
  packageContext: manifest.context, recipe: 'installed-cli-build-v1; default optimization; static fanout_backend binding',
  node: process.version, harnessSha256: hash(fs.readFileSync(__filename)), packages: [], fixtures: {}, matrix: [],
  hosted: { status: 'not-run', reason: 'No separately authorized hosted window' }, phases: [] };
const save = () => fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
save();
const env = { ...process.env };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'PULSE_RELEASE_SHARED_PACK']) delete env[key];
function run(command, args, label, expected = 0) {
  return new Promise((resolve, reject) => {
    const started = Date.now(), child = spawn(command, args, { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '', expired = false;
    const timer = setTimeout(() => { expired = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 180000);
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      fs.writeFileSync(path.join(output, label + '.stdout'), stdout); fs.writeFileSync(path.join(output, label + '.stderr'), stderr);
      proof.phases.push({ label, code, timedOut: expired, durationMs: Date.now() - started }); save();
      if (expired || (expected === 'failure' ? code === 0 : code !== expected)) reject(Error(label + ': ' + code + '\n' + stderr.slice(-5000)));
      else resolve({ stdout, stderr, code });
    });
  });
}
function verifyInstalled() {
  const files = [];
  for (const entry of manifest.packages) {
    const directory = path.join(consumer, 'node_modules', entry.name);
    if (!fs.existsSync(directory)) continue;
    assert(fs.realpathSync(directory).startsWith(consumer + path.sep), 'No workspace links');
    const tarball = path.join(pack, entry.tarball); assert.equal(hash(fs.readFileSync(tarball)), entry.sha256);
    for (const [file, bytes] of readTarEntries(tarball)) {
      let target = path.join(directory, file.replace(/^package\//, ''));
      if (!fs.existsSync(target) && path.basename(target) === '.gitignore') target = path.join(path.dirname(target), '.npmignore');
      assert.deepEqual(fs.readFileSync(target), bytes, entry.name + '/' + file);
      files.push({ file: entry.name + '/' + file, sha256: hash(bytes) });
    }
  }
  return files;
}
function source(name) { return fs.readFileSync(path.join(root, 'docs/internal/host-extensions/fixtures', name + '.ts'), 'utf8'); }
async function main() {
  let registry;
  try {
    registry = createReadOnlyRegistry(catalogFromTarballs(manifest.packages.map(entry => path.join(pack, entry.tarball))));
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    const version = manifest.releaseVersion;
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: Object.fromEntries(['pulse', 'grip', 'cli', 'provider-node', 'provider-fastly'].map(name => ['@pulse-compute/' + name, version])) }));
    fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], 'install');
    assert.equal(registry.requests.missing, 0); assert.equal(registry.requests.rejected, 0);
    const installedFiles = verifyInstalled();
    fs.writeFileSync(path.join(output, 'installed-files.json'), JSON.stringify(installedFiles, null, 2) + '\n');
    proof.installedFilesSha256 = hash(JSON.stringify(installedFiles));
    proof.packages = manifest.packages.filter(entry => fs.existsSync(path.join(consumer, 'node_modules', entry.name))).map(({ name, version, sha256, tarball }) => ({ name, version, sha256, tarball }));
    fs.mkdirSync(path.join(consumer, '.pulse')); fs.mkdirSync(path.join(consumer, 'src'));
    const config = `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig(scope => ({pulse:{entry:'src/index.ts',defaultProfile:'fastlyNative',strict:false},fastlyNative:{host:'fastly',target:'native',outDir:'dist',fastly:{bindings:{backends:{fanout:'fanout_backend'}}}},nodeNative:{host:'node',target:'native',outDir:'dist'},nodeJS:{host:'node',target:'javascript',outDir:'dist'},fastlyJS:{host:'fastly',target:'javascript',outDir:'dist'}}));`;
    fs.writeFileSync(path.join(consumer, '.pulse/config.ts'), config); proof.configSha256 = hash(config);
    const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
    const invoke = (args, label, expected) => run(process.execPath, [cli, ...args, '--json'], label, expected);
    for (const name of ['absent', 'unused', 'generic', 'fanout', 'websocket']) {
      const authored = source(name); fs.writeFileSync(path.join(consumer, 'src/index.ts'), authored);
      await invoke(['build'], name + '-build');
      const dist = path.join(consumer, 'dist'), bytes = fs.readFileSync(path.join(dist, 'bin/main.wasm'));
      const native = JSON.parse(fs.readFileSync(path.join(dist, 'fastly-native-manifest.json')));
      fs.writeFileSync(path.join(output, name + '.wasm'), bytes);
      fs.copyFileSync(path.join(dist, 'fastly-native-manifest.json'), path.join(output, name + '-manifest.json'));
      fs.copyFileSync(path.join(dist, 'fastly-native-plan.json'), path.join(output, name + '-plan.json'));
      const report = JSON.parse((await invoke(['report'], name + '-report')).stdout);
      assert.equal(report.provenance.sourceFingerprint, null);
      assert(!report.evidence.some(row => row.kind === 'test'), 'Build collection must not invent execution');
      fs.writeFileSync(path.join(output, name + '-report.json'), JSON.stringify(report, null, 2) + '\n');
      if (baselineArg) {
        assert.equal(report.hostExtensions.length, ['fanout', 'websocket'].includes(name) ? 1 : 0);
        if (report.hostExtensions.length) {
          const row = report.hostExtensions[0]; assert.equal(row.sourceSha256, native.hostExtensions[0].sha256);
          assert.equal(row.policySha256, native.hostExtensionPolicy.sha256); assert.deepEqual(row.declaredImports, row.observedImports);
        }
      }
      proof.fixtures[name] = { sourceSha256: hash(authored), bytes: bytes.length, sha256: hash(bytes),
        imports: WebAssembly.Module.imports(new WebAssembly.Module(bytes)), contributions: native.hostExtensions || [], policy: native.hostExtensionPolicy || null,
        reportSha256: hash(fs.readFileSync(path.join(output, name + '-report.json'))) };
      save(); console.log('ok - installed ' + name);
    }
    for (const profile of ['nodeNative', 'nodeJS', 'fastlyJS']) {
      fs.writeFileSync(path.join(consumer, 'src/index.ts'), source('generic'));
      await invoke(['build', '--profile', profile], 'generic-' + profile);
      proof.matrix.push({ profile, operation: 'generic GRIP', result: 'build passed' });
      for (const name of ['fanout', 'websocket']) {
        fs.writeFileSync(path.join(consumer, 'src/index.ts'), source(name));
        const result = await invoke(['build', '--profile', profile], name + '-' + profile, 'failure');
        assert.equal(JSON.parse(result.stderr).error.code, 'PULSE_HOST_EXTENSION_TARGET', result.stderr);
        proof.matrix.push({ profile, operation: name, result: 'static admission rejected', diagnostic: 'PULSE_HOST_EXTENSION_TARGET' });
      }
    }
    const dynamic = `import {grip} from '@pulse-compute/grip'; for (const key of ['handoffFanout','handoffWebSocket']) { try { grip[key]('fanout'); throw Error('guard missing'); } catch(e) { if(!/not implemented for this host/.test(e.message)) throw e; console.log(key+': '+e.message); } }`;
    fs.writeFileSync(path.join(consumer, 'guard.mjs'), dynamic);
    await run(process.execPath, ['guard.mjs'], 'opaque-node-js-guard');
    proof.matrix.push({ profile: 'nodeJS', operation: 'opaque lookup, both methods', result: 'runtime package guard threw' });
    if (baselineArg) {
      const baseline = JSON.parse(fs.readFileSync(path.resolve(baselineArg)));
      assert.equal(baseline.status, 'passed'); assert.equal(baseline.configSha256, proof.configSha256);
      proof.baselineProofSha256 = hash(fs.readFileSync(path.resolve(baselineArg)));
      proof.deltas = {};
      for (const [name, row] of Object.entries(proof.fixtures)) {
        const before = baseline.fixtures[name]; assert.equal(row.sourceSha256, before.sourceSha256);
        assert.equal(row.sha256, before.sha256, name + ' final Wasm changed');
        assert.deepEqual(row.imports, before.imports);
        proof.deltas[name] = { baselineBytes: before.bytes, bytes: row.bytes, deltaBytes: row.bytes - before.bytes, exactBytesUnchanged: true,
          versusAbsentBytes: row.bytes - proof.fixtures.absent.bytes };
      }
    }
    assert.deepEqual(verifyInstalled(), installedFiles);
    proof.registry = { ...registry.requests }; proof.status = 'passed';
  } catch (error) { proof.status = 'failed'; proof.error = error.stack; throw error; }
  finally {
    if (registry) await new Promise(resolve => registry.server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
    proof.cleanup = !fs.existsSync(temporary); save();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
