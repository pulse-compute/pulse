#!/usr/bin/env node
'use strict';

// Shared finite harness: MCP-01 reference facade or MCP-03 actual Pulse adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { buildWorkspacePackage } = require('../support/workspace-package-build.cjs');
const { pnpmInvocation } = require('../../../scripts/pnpm-toolchain.cjs');

const root = path.resolve(__dirname, '../../..');
const reference = path.join(__dirname, 'reference');
const actualAdapter = process.argv.includes('--adapter');
const proofFile = actualAdapter ? 'tools-proof.mjs' : 'proof.mjs';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mcp-reference-'));
const parent = path.join(root, 'wasm/.test-results');
fs.mkdirSync(parent, { recursive: true });
const evidence = fs.mkdtempSync(path.join(parent, actualAdapter ? 'mcp-tools-sdk-' : 'mcp-wire-'));
const project = path.join(evidence, 'application');
const reportFile = path.join(evidence, 'proof.json');
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_fetch_retries: '0' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE']) delete env[key];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const clean = value => value.replaceAll(temp, '<reference>').replaceAll(root, '<checkout>');
const report = {
  schemaVersion: 'pulse.mcp-wire-proof.v1', status: 'running', node: process.version,
  source: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']),
  workingTree: git(['status', '--porcelain']),
  workingDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })),
  fixtureFiles: Object.fromEntries(['profile.json', 'assert-mcp-wire-proof.cjs',
    'reference/package.json', 'reference/pnpm-lock.yaml', `reference/${proofFile}`,
    ...(actualAdapter ? ['reference/tools-handlers.ts'] : [])]
    .map(file => [file, hash(fs.readFileSync(path.join(__dirname, file)))])),
  productionAdapter: actualAdapter, installedConsumer: false, authorizationValidated: false,
  target: 'node-javascript', commands: []
};
const children = new Set();
function save() {
  fs.writeFileSync(reportFile + '.tmp', JSON.stringify(report, null, 2) + '\n');
  fs.renameSync(reportFile + '.tmp', reportFile);
}
function run(command, args, cwd, { timeout = 120000, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    children.add(child);
    let stdout = '', stderr = '', failure;
    const stop = error => {
      failure ||= error;
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
    };
    const timer = setTimeout(() => stop(new Error(`timeout after ${timeout}ms`)), timeout);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length + stderr.length > 4 * 1024 * 1024) stop(new Error('output exceeded 4 MiB'));
      try { onOutput?.(stdout); } catch (error) { stop(error); }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (stdout.length + stderr.length > 4 * 1024 * 1024) stop(new Error('output exceeded 4 MiB'));
    });
    child.once('error', error => { clearTimeout(timer); children.delete(child); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); children.delete(child);
      const record = { command: path.basename(command), args: args.map(clean), code, signal,
        stdout: clean(stdout), stderr: clean(stderr) };
      report.commands.push(record); save();
      if (failure || code !== 0 || signal) reject(new Error(`${failure?.message || 'command failed'}: ${JSON.stringify(record)}`));
      else resolve(stdout);
    });
  });
}

async function main() {
  save();
  try {
    const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'profile.json')));
    const pkg = JSON.parse(fs.readFileSync(path.join(reference, 'package.json')));
    assert.equal(pkg.private, true);
    assert.deepEqual(pkg.dependencies, profile.referencePackages);
    for (const file of ['package.json', 'pnpm-lock.yaml', proofFile]) {
      fs.copyFileSync(path.join(reference, file), path.join(temp, file));
    }
    fs.copyFileSync(path.join(__dirname, 'profile.json'), path.join(temp, 'profile.json'));
    console.log('mcp-wire-proof - install exact reference SDK lock, lifecycle scripts disabled');
    const pnpm = pnpmInvocation(root);
    await run(pnpm.command, [...pnpm.prefix, 'install', '--frozen-lockfile', '--ignore-scripts'], temp);
    for (const [name, version] of Object.entries(profile.referencePackages)) {
      assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'node_modules', name, 'package.json'))).version, version);
    }
    buildWorkspacePackage('packages/entities');
    const example = path.join(root, 'examples/10-entities-tools');
    fs.cpSync(example, project, { recursive: true, filter: file => !path.relative(example, file)
      .split(path.sep).some(part => part === 'node_modules' || part.startsWith('dist') || part.startsWith('.pulse-')) });
    if (actualAdapter) {
      fs.copyFileSync(path.join(reference, 'tools-handlers.ts'), path.join(project, 'src/handlers.ts'));
      report.adapterFiles = Object.fromEntries(['index.js', 'node.js', 'catalog.js', 'tools.js', 'bounded.js']
        .map(file => [file, hash(fs.readFileSync(path.join(root, 'packages/mcp/src', file)))]));
    }
    fs.mkdirSync(path.join(project, 'node_modules/@pulse-compute'), { recursive: true });
    fs.symlinkSync(path.join(root, 'packages/entities'), path.join(project, 'node_modules/@pulse-compute/entities'), 'dir');
    const cli = path.join(root, 'wasm/scripts/pulse.cjs');
    console.log('mcp-wire-proof - build catalog from example 10 on node-javascript');
    const build = JSON.parse(await run(process.execPath, [cli, 'build', '--profile', profile.proof.target, '--json'], project));
    assert.equal(build.status, 'built');
    const catalogFile = path.join(project, 'dist-node-javascript/entities-catalog.json');
    let started = false, readyResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    console.log('mcp-wire-proof - real HTTP discovery, list and governed entity call');
    const dev = run(process.execPath, [cli, 'dev', '--profile', profile.proof.target,
      '--port', '0', '--no-watch', '--once', '--json'], project, {
      timeout: 45000,
      onOutput(stdout) {
        for (const line of stdout.split('\n')) {
          let event; try { event = JSON.parse(line); } catch { continue; }
          if (started || event.event !== 'ready') continue;
          started = true;
          readyResolve(event.url);
        }
      }
    }).then(stdout => ({ stdout }), error => ({ error }));
    const url = await Promise.race([ready, dev.then(result => {
      throw result.error || new Error('Pulse dev exited before readiness');
    })]);
    try {
      await run(process.execPath, [path.join(temp, proofFile), url, catalogFile,
        path.join(evidence, 'wire.json'), ...(actualAdapter ? [path.join(root, 'packages/mcp/src/node.js'),
          path.join(project, 'dist-node-javascript/schema-json-registry.json')] : [])], temp, { timeout: 30000 });
    } catch (error) {
      for (const child of children) {
        try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
      await dev;
      throw error;
    }
    const devResult = await dev;
    if (devResult.error) throw devResult.error;
    const events = devResult.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.filter(event => event.event === 'request').length, 1);
    assert.ok(!events.some(event => event.event.endsWith('error')));
    report.wire = JSON.parse(fs.readFileSync(path.join(evidence, 'wire.json')));
    assert.equal(report.wire.status, 'passed');
    report.status = 'passed';
    console.log(`ok - ${actualAdapter ? 'MCP-03 actual adapter' : 'MCP-01 reference'} exchange; evidence ${reportFile}`);
  } catch (error) {
    report.status = 'failed'; report.error = clean(error.stack || String(error));
    throw error;
  } finally {
    for (const child of children) {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    save();
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
