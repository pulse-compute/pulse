#!/usr/bin/env node
'use strict';
// Opt-in exact-package and real-engine evidence for #309; never deploys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');
const fastly = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const root = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-stdio-installed-'));
const consumer = path.join(temporary, 'consumer');
const pack = path.join(temporary, 'packages');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const env = { ...process.env, npm_config_cache: path.join(temporary, 'cache') };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE']) delete env[key];
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code}): ${error.slice(-6000)}`)); });
  });
}
function verifyInstalled(manifest) {
  const files = [];
  for (const name of fs.readdirSync(path.join(consumer, 'node_modules/@pulse-compute')).sort()) {
    const entry = manifest.packages.find(item => item.name === '@pulse-compute/' + name);
    assert.ok(entry);
    const directory = path.join(consumer, 'node_modules', entry.name);
    assert.ok(fs.realpathSync(directory).startsWith(consumer + path.sep));
    const tarball = path.join(pack, entry.tarball);
    assert.equal(hash(fs.readFileSync(tarball)), entry.sha256);
    for (const [file, bytes] of readTarEntries(tarball)) {
      let target = path.join(directory, file.replace(/^package\//, ''));
      if (!fs.existsSync(target) && path.basename(target) === '.gitignore') target = path.join(path.dirname(target), '.npmignore');
      assert.deepEqual(fs.readFileSync(target), bytes, `installed candidate changed: ${entry.name}/${file}`);
      files.push([entry.name + '/' + file, hash(bytes)]);
    }
  }
  return hash(JSON.stringify(files));
}
async function main() {
  let registry, server;
  try {
    assert.ok(process.env.PULSE_VICEROY_BIN, 'Installed stdio qualification requires explicit PULSE_VICEROY_BIN');
    const launcher = fastly.inspectFastlyComputeLauncher({ viceroyBinary: process.env.PULSE_VICEROY_BIN, required: true });
    const packed = packRelease({ repoRoot: root, outDir: pack });
    fs.mkdirSync(consumer, { recursive: true });
    const version = packed.manifest.packages[0].version;
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: Object.fromEntries(['pulse', 'cli', 'provider-fastly'].map(name => ['@pulse-compute/' + name, version])) }));
    registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(entry => path.join(pack, entry.tarball))));
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.equal(registry.requests.missing, 0);
    assert.equal(registry.requests.rejected, 0);
    const installedHash = verifyInstalled(packed.manifest);
    fs.mkdirSync(path.join(consumer, '.pulse'));
    fs.mkdirSync(path.join(consumer, 'src'));
    fs.writeFileSync(path.join(consumer, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig(scope => ({pulse:{entry:'src/index.ts',defaultProfile:'native',strict:false},native:{host:'fastly',target:'native',outDir:'dist',fastly:{bindings:{secretStore:'secrets'}}}}));`);
    fs.writeFileSync(path.join(consumer, 'src/index.ts'), `export default async function handler(ctx) {
      const token = await ctx.secret.get('TOKEN');
      if (ctx.req.header('authorization') !== token) return ctx.text('denied', {status:401});
      ctx.log.info('probe.arrival ' + token);
      ctx.log.warn('probe.outcome café 😀');
      return ctx.text('ok');
    }`);
    const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
    const built = JSON.parse(await run(process.execPath, [cli, 'build', '--json']));
    assert.equal(built.status, 'built');
    const dist = path.join(consumer, 'dist');
    const wasmFile = path.join(dist, 'bin/main.wasm');
    const wasm = fs.readFileSync(wasmFile);
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
    assert.ok(imports.some(entry => entry.module === 'wasi_snapshot_preview1' && entry.name === 'fd_write'));
    assert.ok(!imports.some(entry => entry.module === 'fastly_log'));
    const plan = JSON.parse(fs.readFileSync(path.join(dist, 'fastly-native-plan.json')));
    const secret = 'stdio-private-value';
    for (const failure of [{}, { logWriteFailure: true }, { logWriteMaxBytes: 0 }, { logWriteMaxBytes: 7 }]) {
      const result = executeFastlyNativePlatformCapabilities({ wasm, plan }, { request: { headers: { authorization: secret } }, secretStore: 'secrets', secrets: { TOKEN: secret }, ...failure });
      assert.equal(result.response.status, 200);
      assert.equal(result.response.body, 'ok');
      assert.equal(result.trace.filter(entry => entry.name === 'fd_write').length, 2);
    }
    const manifestFile = path.join(dist, 'fastly.toml');
    fs.writeFileSync(manifestFile, fastly.renderFastlyLocalConfig({ name: 'stdio-installed', secretStores: { secrets: { TOKEN: secret } } }));
    server = await fastly.startFastlyComputeServe({ launcher, packageRoot: dist, wasmFile, manifestFile, startTimeoutMs: 60000 });
    const denied = await fastly.requestFastlyCompute(server, {});
    assert.equal(denied.status, 401);
    const accepted = await fastly.requestFastlyCompute(server, { headers: { authorization: secret } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.toString(), 'ok');
    await server.stop();
    assert.equal(server.logs.stdout.split('[pulse:info] probe.arrival <redacted>').length - 1, 1);
    assert.equal(server.logs.stdout.split('[pulse:warn] probe.outcome café 😀').length - 1, 1);
    assert.ok(!JSON.stringify(server.logs).includes(secret));
    assert.equal(verifyInstalled(packed.manifest), installedHash);
    assert.equal(hash(fs.readFileSync(wasmFile)), hash(wasm));
    const proof = { status: 'passed', source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), installedHash, wasmSha256: hash(wasm), engine: launcher.inspection.version, engineSha256: hash(fs.readFileSync(launcher.inspection.binary)), lifecycleScripts: false, positiveStdout: true, secretAbsent: true, failedWritesNonblocking: true, deployed: false };
    console.log('ok - installed Fastly stdio ' + JSON.stringify(proof));
  } finally {
    if (server) await server.stop();
    if (registry) await new Promise(resolve => registry.server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
