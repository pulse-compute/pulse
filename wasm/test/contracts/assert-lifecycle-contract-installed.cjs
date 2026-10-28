#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pnpmInvocation } = require('../../../scripts/pnpm-toolchain.cjs');
const repo = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-lifecycle-installed-'));
const pnpm = pnpmInvocation(repo);
function run(args, cwd = temporary) {
  return execFileSync(pnpm.command, [...pnpm.prefix, ...args], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, NODE_PATH: '', npm_config_ignore_scripts: 'true' }
  });
}
try {
  const packageRoot = path.join(repo, 'wasm/packages/contracts');
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts, undefined, 'contracts pack has no lifecycle scripts');
  run(['--dir', packageRoot, 'pack', '--pack-destination', temporary]);
  const tarballs = fs.readdirSync(temporary).filter(file => file.endsWith('.tgz'));
  assert.equal(tarballs.length, 1);
  fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'lifecycle-consumer', private: true }));
  run(['--ignore-workspace', 'add', '--offline', '--ignore-scripts', path.join(temporary, tarballs[0])]);
  for (const script of ['assert-lifecycle-contract.cjs', 'assert-resource-admission.cjs', 'assert-host-extension-contract.cjs']) {
    fs.copyFileSync(path.join(__dirname, script), path.join(temporary, 'check.cjs'));
    const output = execFileSync(process.execPath, [path.join(temporary, 'check.cjs'), '--installed'], {
      cwd: temporary, encoding: 'utf8', timeout: 30000, env: { ...process.env, NODE_PATH: '' }
    });
    process.stdout.write(output);
  }
  console.log('ok - actual pnpm pack, offline install and lifecycle/resource/host-extension contract replay outside checkout');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
