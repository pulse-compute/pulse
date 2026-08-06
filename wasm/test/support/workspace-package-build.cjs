#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const OWNED_OUTPUTS_SCHEMA = 'pulse.test-workspace-package-outputs.v1';
const OWNED_OUTPUTS_FILE = 'workspace-package-outputs.json';
const builds = new Map();
let cleanupRegistered = false;

function ownedOutputsFile(taskTempRoot) {
  if (!taskTempRoot) return null;
  const root = path.resolve(taskTempRoot);
  return path.join(root, OWNED_OUTPUTS_FILE);
}

function recordOwnedOutput(outputRoot) {
  const file = ownedOutputsFile(process.env.PULSEWASM_TEST_TMP_ROOT);
  if (!file) return;
  const outputs = [...new Set([
    ...[...builds.values()].filter((build) => build.ownedOutput).map((build) => build.outputRoot),
    outputRoot
  ])].sort();
  fs.writeFileSync(file, `${JSON.stringify({
    schemaVersion: OWNED_OUTPUTS_SCHEMA,
    outputs
  }, null, 2)}\n`);
}

function cleanupRecordedWorkspacePackageBuilds(taskTempRoot) {
  const file = ownedOutputsFile(taskTempRoot);
  if (!file || !fs.existsSync(file)) return Object.freeze([]);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.schemaVersion !== OWNED_OUTPUTS_SCHEMA || !Array.isArray(record.outputs)) {
    throw new Error('workspace package output ownership record is invalid');
  }
  const removed = [];
  for (const output of record.outputs) {
    const absolute = path.resolve(output);
    const relative = path.relative(repoRoot, absolute).replace(/\\/g, '/');
    if (!/^packages\/[a-z0-9-]+\/dist$/.test(relative)) {
      throw new Error(`workspace package output ownership escapes the allowed package dist boundary: ${output}`);
    }
    fs.rmSync(absolute, { recursive: true, force: true });
    removed.push(relative);
  }
  return Object.freeze(removed);
}

function cleanup() {
  for (const build of builds.values()) {
    if (build.ownedOutput) {
      fs.rmSync(build.outputRoot, { recursive: true, force: true });
    }
  }
  builds.clear();
}

function buildWorkspacePackage(relativePackageRoot) {
  const normalized = String(relativePackageRoot).replace(/\\/g, '/');
  assert.match(normalized, /^packages\/[a-z0-9-]+$/, 'workspace package build must name one direct packages/ child');
  if (builds.has(normalized)) return builds.get(normalized);

  const packageRoot = path.join(repoRoot, normalized);
  const tsconfig = path.join(packageRoot, 'tsconfig.json');
  const compiler = path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js');
  assert.equal(fs.existsSync(tsconfig), true, `${normalized} must provide tsconfig.json`);
  assert.equal(fs.existsSync(compiler), true, 'workspace TypeScript compiler must be installed');

  const outputRoot = path.join(packageRoot, 'dist');
  const entry = path.join(outputRoot, 'index.js');
  if (fs.existsSync(outputRoot)) {
    assert.equal(fs.existsSync(entry), true, `${normalized} existing dist must contain index.js`);
    const build = Object.freeze({
      packageRoot,
      outputRoot,
      entry,
      ownedOutput: false
    });
    builds.set(normalized, build);
    return build;
  }

  recordOwnedOutput(outputRoot);
  const result = spawnSync(process.execPath, [
    compiler,
    '-p',
    tsconfig,
    '--outDir',
    outputRoot,
    '--tsBuildInfoFile',
    path.join(outputRoot, 'tsconfig.tsbuildinfo'),
    '--pretty',
    'false'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000
  });

  if (result.error || result.status !== 0) {
    fs.rmSync(outputRoot, { recursive: true, force: true });
    if (result.error) throw result.error;
    throw new Error(
      `${normalized} isolated TypeScript build failed.\n${String(result.stdout || '')}${String(result.stderr || '')}`
    );
  }

  if (!fs.existsSync(entry)) {
    fs.rmSync(outputRoot, { recursive: true, force: true });
    throw new Error(`${normalized} isolated TypeScript build did not emit dist/index.js`);
  }

  const build = Object.freeze({ packageRoot, outputRoot, entry, ownedOutput: true });
  builds.set(normalized, build);
  if (!cleanupRegistered) {
    process.once('exit', cleanup);
    cleanupRegistered = true;
  }
  return build;
}

module.exports = Object.freeze({
  buildWorkspacePackage,
  cleanupWorkspacePackageBuilds: cleanup,
  cleanupRecordedWorkspacePackageBuilds
});
