#!/usr/bin/env node
'use strict';
// Explicit post-publication smoke, not a second release gate or permission to publish.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { releaseVersion, publication } = require('../../../release/pulse-release-manifest.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
async function smoke({ version, registry = publication.registry, reportFile }) {
  assert.equal(version, releaseVersion, 'Use the checkout for the exact published release; no floating versions');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-context-registry-'));
  const report = { schemaVersion: 'pulse.context-registry-smoke.v1', status: 'running', version, registry,
    node: process.version, lifecycleScripts: false, publicationPerformed: false, commands: [] };
  const start = performance.now(); let host, done;
  const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false', npm_config_fund: 'false', npm_config_fetch_retries: '0', npm_config_cache: path.join(temp, '.npm-cache') };
  const run = (command, args) => {
    const began = performance.now();
    const stdout = execFileSync(command, args, { cwd: temp, env, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    report.commands.push({ command: path.basename(command), args, elapsedMs: performance.now() - began }); return stdout;
  };
  try {
    fs.writeFileSync(path.join(temp, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=${registry}\nreplace-registry-host=never\n`);
    fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ private: true, devDependencies: { '@pulse-compute/cli': version } }));
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    const template = path.join(temp, 'node_modules/@pulse-compute/cli/examples/12-pulse-context-mcp');
    for (const file of fs.readdirSync(template)) fs.cpSync(path.join(template, file), path.join(temp, file), { recursive: true });
    const pkg = read(path.join(temp, 'package.json'));
    for (const [name, value] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) if (name.startsWith('@pulse-compute/')) assert.equal(value, version);
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    const lock = read(path.join(temp, 'package-lock.json'));
    report.packages = fs.readdirSync(path.join(temp, 'node_modules/@pulse-compute')).sort().map(name => {
      const id = '@pulse-compute/' + name, manifest = read(path.join(temp, 'node_modules', id, 'package.json'));
      assert.equal(manifest.version, version);
      const entry = lock.packages['node_modules/' + id]; assert.match(entry.integrity, /^sha512-/);
      return { name: id, version: manifest.version, resolved: entry.resolved, integrity: entry.integrity };
    });
    assert.ok(report.packages.some(item => item.name === '@pulse-compute/mcp'));
    const cli = path.join(temp, 'node_modules/@pulse-compute/cli/bin/pulse.js');
    assert.equal(JSON.parse(run(process.execPath, [cli, 'build', '--json'])).status, 'built');
    run(process.execPath, [path.join(temp, 'host/prepare.cjs')]);
    const manifestFile = path.join(temp, 'dist-node-javascript/pulse-context-host.json');
    report.build = { ...read(manifestFile), sha256: hash(fs.readFileSync(manifestFile)) };
    let buffer = '', stderr = ''; const began = performance.now();
    host = spawn(process.execPath, [path.join(temp, 'host/start.cjs'), '--port', '0'], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    done = new Promise(resolve => host.once('close', (code, signal) => resolve({ code, signal })));
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Registry host readiness timeout: ' + stderr)), 10000);
      host.once('error', error => { clearTimeout(timer); reject(error); });
      done.then(() => { clearTimeout(timer); reject(new Error('Registry host exited before readiness: ' + stderr)); });
      host.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-65536); });
      host.stdout.on('data', bytes => {
        buffer += bytes; if (buffer.length > 1048576) { clearTimeout(timer); reject(new Error('Host output limit')); }
        for (let n; (n = buffer.indexOf('\n')) !== -1;) {
          const line = buffer.slice(0, n); buffer = buffer.slice(n + 1); let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.event === 'ready') { clearTimeout(timer); resolve(event); }
        }
      });
    });
    report.startupMs = performance.now() - began; assert.equal(ready.identity, report.build.identity); assert.equal(ready.corpus.pulseVersion, version);
    const { request } = require(path.join(temp, 'client/request.cjs'));
    await request(ready.endpoint, 'server/discover');
    assert.equal((await request(ready.endpoint, 'tools/list')).tools.length, 5);
    const result = await request(ready.endpoint, 'pulse.start', { version, goal: 'json-api', provider: 'node', target: 'javascript' });
    assert.equal(result.structuredContent.status, 'ok'); assert.equal(result.structuredContent.meta.corpusHash, ready.corpus.corpusHash);
    report.startResponseBytes = Buffer.byteLength(JSON.stringify(result));
    host.kill('SIGTERM');
    const timer = setTimeout(() => host.kill('SIGKILL'), 5000); const stopped = await done; clearTimeout(timer);
    assert.deepEqual(stopped, { code: 0, signal: null }); report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = String(error.stack || error).replaceAll(temp, '<registry-smoke>'); throw error; }
  finally {
    if (host && host.exitCode === null && host.signalCode === null) { host.kill('SIGKILL'); await done; }
    fs.rmSync(temp, { recursive: true, force: true }); report.cleanup = 'passed'; report.elapsedMs = performance.now() - start;
    fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
module.exports = { smoke };
if (require.main === module) {
  const [version, ...extra] = process.argv.slice(2);
  if (!version || extra.length) throw new Error('Usage: node wasm/test/mcp/smoke-context-registry.cjs <exact-release-version>');
  const reportFile = path.resolve(__dirname, '../../.test-results/context-registry-smoke.json');
  smoke({ version, reportFile }).then(report => console.log(`ok - published context smoke ${report.elapsedMs.toFixed(0)}ms; ${reportFile}`))
    .catch(error => { console.error(error.message); console.error(`report - ${reportFile}`); process.exitCode = 1; });
}
