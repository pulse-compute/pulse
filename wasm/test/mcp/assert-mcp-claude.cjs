#!/usr/bin/env node
'use strict';

// Explicit external host qualification; never part of the fast or seal profiles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { pnpmInvocation } = require('../../../scripts/pnpm-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mcp-claude-client-'));
try {
  for (const file of ['package.json', 'pnpm-lock.yaml']) fs.copyFileSync(path.join(__dirname, 'claude-reference', file), path.join(temp, file));
  const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_ignore_scripts: 'true', npm_config_fetch_retries: '0' };
  const pnpm = pnpmInvocation(root);
  execFileSync(pnpm.command, [...pnpm.prefix, 'install', '--frozen-lockfile', '--ignore-scripts'], { cwd: temp, env, encoding: 'utf8', timeout: 120000 });
  const installed = createRequire(path.join(temp, 'package.json'));
  const manifestPath = installed.resolve('@anthropic-ai/claude-code/package.json');
  assert.equal(JSON.parse(fs.readFileSync(manifestPath)).version, '2.1.292');
  // The native package is independently installed and integrity-bound by the lock.
  const wrapper = path.join(path.dirname(manifestPath), 'cli-wrapper.cjs');
  const stdout = execFileSync(process.execPath, [path.join(__dirname, 'probe-mcp-claude.cjs'), wrapper],
    { cwd: root, env, encoding: 'utf8', timeout: 100000 });
  const directory = /; evidence (.+)\n?$/.exec(stdout)?.[1];
  assert.ok(directory, 'qualification must return its retained report');
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'proof.json')));
  assert.equal(report.status, 'passed'); assert.equal(report.toolInvocationQualified, true);
  console.log(stdout.trim());
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
