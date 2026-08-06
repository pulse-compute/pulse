#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  buildWorkspacePackage,
  cleanupWorkspacePackageBuilds
} = require('../support/workspace-package-build.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function run(label, script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${label} failed.\n${String(result.stdout || '')}${String(result.stderr || '')}`
  );
}

buildWorkspacePackage('packages/grip');

run(
  'GRIP package runtime tests',
  path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
  [
    'run',
    '--config',
    'vitest.config.ts',
    'packages/grip/test/javascript-runtime.test.ts',
    'packages/grip/test/pulsewasm.test.ts'
  ]
);

cleanupWorkspacePackageBuilds();
console.log('ok - GRIP package root builds and its JavaScript plus compatibility runtime tests pass');
