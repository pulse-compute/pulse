#!/usr/bin/env node
'use strict';

// Independently installed, pinned host qualification. Explicit external evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { pnpmInvocation } = require('../../../scripts/pnpm-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mcp-codex-client-'));
try {
  for (const file of ['package.json', 'pnpm-lock.yaml']) fs.copyFileSync(path.join(__dirname, 'codex-reference', file), path.join(temp, file));
  const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_ignore_scripts: 'true', npm_config_fetch_retries: '0' };
  const pnpm = pnpmInvocation(root);
  execFileSync(pnpm.command, [...pnpm.prefix, 'install', '--frozen-lockfile', '--ignore-scripts'], { cwd: temp, env, encoding: 'utf8', timeout: 120000 });
  const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'node_modules/@openai/codex/package.json')));
  assert.equal(manifest.version, '0.160.1');
  const codex = path.join(temp, 'node_modules/.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
  const stdout = execFileSync(process.execPath, [path.join(__dirname, 'probe-mcp-codex.cjs'), codex, '--qualify'],
    { cwd: root, env, encoding: 'utf8', timeout: 100000 });
  const directory = /; evidence (.+)\n?$/.exec(stdout)?.[1];
  assert.ok(directory, 'qualification must return its retained report');
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'proof.json')));
  assert.equal(report.status, 'passed'); assert.equal(report.toolInvocationQualified, true);
  console.log(stdout.trim());
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
