#!/usr/bin/env node
'use strict';

// Diagnostic evidence, not a passing-product test. Preserve observed failures.
// Usage: node bh01-installed-baseline.cjs <pack-dir> <new-consumer-dir>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');
const { readTarEntries } = require('../../../scripts/pack-release.cjs');
const root = path.resolve(__dirname, '../../..');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const [packArg, consumerArg] = process.argv.slice(2);
assert(packArg && consumerArg, 'Expected pack directory and NEW consumer directory');
const pack = path.resolve(packArg), consumer = path.resolve(consumerArg);
assert(!fs.existsSync(consumer), 'Consumer directory must not already exist');
assert(!consumer.startsWith(root + path.sep), 'Consumer must be outside the source checkout');
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_audit: 'false', npm_config_fund: 'false' };
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
delete env.PULSE_PROFILE;
function run(command, args, timeout = 120000, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', timedOut = false;
    const stop = () => {
      timedOut = true;
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
    };
    const timer = setTimeout(stop, timeout);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length + stderr.length > 8 * 1024 * 1024) stop();
      if (onOutput) onOutput(stdout);
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stdout.length + stderr.length > 8 * 1024 * 1024) stop(); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut, stdout, stderr }); });
  });
}
function verifyInstalled(manifest) {
  let files = 0;
  const digests = [];
  for (const entry of manifest.packages) {
    const packageRoot = path.join(consumer, 'node_modules', entry.name);
    assert(fs.realpathSync(packageRoot).startsWith(consumer + path.sep), 'Workspace package link detected');
    assert.equal(json(path.join(packageRoot, 'package.json')).version, entry.version);
    const tarball = path.join(pack, entry.tarball);
    assert.equal(hash(fs.readFileSync(tarball)), entry.sha256);
    for (const [name, bytes] of readTarEntries(tarball)) {
      if (!name.startsWith('package/') || name.endsWith('/')) continue;
      const relative = name.slice(8);
      // npm's tar extractor renames .gitignore to .npmignore. Check the bytes.
      const installedPath = path.join(packageRoot, relative);
      const actualPath = !fs.existsSync(installedPath) && path.basename(relative) === '.gitignore'
        ? path.join(path.dirname(installedPath), '.npmignore') : installedPath;
      const installed = fs.readFileSync(actualPath);
      assert(installed.equals(bytes), `${entry.name}/${name} differs from candidate`);
      digests.push([entry.name + '/' + name.slice(8), hash(installed)]);
      files++;
    }
  }
  return { files, sha256: hash(JSON.stringify(digests.sort())) };
}
async function main() {
  const manifest = json(path.join(pack, 'pulse-release-manifest.json'));
  const tarballs = manifest.packages.map((entry) => path.join(pack, entry.tarball));
  const registry = createReadOnlyRegistry(catalogFromTarballs(tarballs));
  fs.cpSync(path.join(root, 'examples/10-entities-tools'), consumer, { recursive: true });
  await new Promise((resolve, reject) => { registry.server.once('error', reject); registry.server.listen(0, '127.0.0.1', resolve); });
  fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
  let install;
  try {
    install = await run('npm', ['install', '--ignore-scripts', '--no-save', '--no-audit', '--no-fund', ...tarballs], 360000);
    fs.writeFileSync(path.join(consumer, 'install.log'), install.stdout + install.stderr);
    assert.equal(install.code, 0, `Candidate install failed: ${install.stderr}`);
    assert.equal(registry.requests.missing, 0);
  } finally { await new Promise((resolve) => registry.server.close(resolve)); }
  const before = verifyInstalled(manifest);
  const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
  const results = [];
  for (const profile of ['node-javascript', 'node-native']) {
    for (const command of ['doctor', 'inspect', 'test', 'build', 'dev']) {
      const args = [cli, command, '--profile', profile, '--json'];
      let requested = false, requestResult = null, requestPromise;
      if (command === 'dev') args.push('--port', '0', '--no-watch', '--once');
      const result = await run(process.execPath, args, command === 'dev' ? 30000 : 120000, (stdout) => {
        if (command !== 'dev' || requested) return;
        for (const line of stdout.split('\n')) {
          let event; try { event = JSON.parse(line); } catch { continue; }
          if (event.event !== 'ready' || !event.url) continue;
          requested = true;
          requestPromise = fetch(event.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'system.status', id: 'bh01' }), signal: AbortSignal.timeout(5000) })
            .then(async (response) => { requestResult = { status: response.status, body: await response.text() }; })
            .catch((error) => { requestResult = { error: error.message }; });
        }
      });
      if (requestPromise) await requestPromise;
      const clean = (s) => s.replaceAll(consumer, '<consumer>').replaceAll(root, '<repo>');
      results.push({ profile, command, ...result, stdout: clean(result.stdout), stderr: clean(result.stderr), request: requestResult });
      console.log(`${profile} ${command}: exit=${result.code} timeout=${result.timedOut}`);
    }
  }
  const after = verifyInstalled(manifest);
  assert.deepEqual(after, before, 'Installed candidate bytes changed');
  const report = {
    schema: 'pulse.bh01.installed-baseline.v1',
    source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
    node: process.version, platform: `${process.platform}/${process.arch}`,
    fixture: 'examples/10-entities-tools (unchanged application/configuration)',
    packages: manifest.packages.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
    install: { code: install.code, lifecycleScripts: false, pulseRegistry: 'loopback read-only exact candidate', requests: registry.requests },
    installed: { ...before, unchanged: true },
    results
  };
  fs.writeFileSync(path.join(consumer, 'bh01-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Evidence complete; command failures are observations, not passing product acceptance.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
