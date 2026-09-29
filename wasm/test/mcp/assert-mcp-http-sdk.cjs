#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { pnpmInvocation } = require('../../../scripts/pnpm-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const authorization = process.argv.includes('--authorization');
const proofFile = authorization ? 'authorization-proof.mjs' : 'adapter-proof.mjs';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mcp-02-sdk-'));
const parent = path.join(root, 'wasm/.test-results');
fs.mkdirSync(parent, { recursive: true });
const evidence = fs.mkdtempSync(path.join(parent, authorization ? 'mcp-authorization-sdk-' : 'mcp-http-sdk-'));
const reportFile = path.join(evidence, 'proof.json');
const report = { status: 'running', source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version, files: {}, commands: [] };
for (const file of ['packages/mcp/src/index.js', 'packages/mcp/src/node.js', 'packages/mcp/src/authorization.js',
  'packages/mcp/src/tools.js', 'packages/mcp/src/bounded.js', `wasm/test/mcp/reference/${proofFile}`,
  'wasm/test/mcp/authorization-fixture.cjs', 'wasm/test/mcp/reference/pnpm-lock.yaml']) {
  report.files[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
}
const save = () => { fs.writeFileSync(reportFile + '.tmp', JSON.stringify(report, null, 2) + '\n'); fs.renameSync(reportFile + '.tmp', reportFile); };
function run(command, args, timeout) {
  const result = spawnSync(command, args, { cwd: temp, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_fetch_retries: '0' } });
  report.commands.push({ code: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }); save();
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
try {
  save();
  for (const file of ['package.json', 'pnpm-lock.yaml', proofFile]) fs.copyFileSync(path.join(__dirname, 'reference', file), path.join(temp, file));
  console.log('mcp-http-sdk - install pinned reference client with lifecycle scripts disabled');
  const pnpm = pnpmInvocation(root);
  run(pnpm.command, [...pnpm.prefix, 'install', '--frozen-lockfile', '--ignore-scripts'], 120000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'node_modules/@modelcontextprotocol/client/package.json'))).version, '2.2.0');
  run(process.execPath, [path.join(temp, proofFile), path.join(root, 'packages/mcp/src/node.js'), path.join(evidence, 'wire.json'),
    path.join(__dirname, 'authorization-fixture.cjs')], 15000);
  report.wire = JSON.parse(fs.readFileSync(path.join(evidence, 'wire.json')));
  assert.equal(report.wire.status, 'passed'); report.status = 'passed';
  console.log(`ok - independent client interoperability; evidence ${reportFile}`);
} catch (error) {
  report.status = 'failed'; report.error = error.stack || String(error); console.error(error); process.exitCode = 1;
} finally { save(); fs.rmSync(temp, { recursive: true, force: true }); }
