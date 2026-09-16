#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  const execute = process.argv[2] === '--execute';
  const [rootArgument, releaseArgument] = process.argv.slice(execute ? 3 : 2);
  assert.ok(rootArgument && releaseArgument, 'Usage: assert-http-input-packages.cjs <isolated-install> <release-pack>');
  const packedRoot = fs.realpathSync(rootArgument), releaseDir = fs.realpathSync(releaseArgument);
  const repoRoot = path.resolve(__dirname, '../../..');
  assert.ok(packedRoot !== repoRoot && !packedRoot.startsWith(repoRoot + path.sep));
  assert.equal(process.env.NODE_PATH, undefined);
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'pulse-release-manifest.json')));

  if (!execute) {
    const { verifyClosure } = require('./assert-request-deadline-packages.cjs');
    verifyClosure(packedRoot, releaseDir, manifest);
    assert.throws(() => verifyClosure(packedRoot, releaseDir, { ...manifest, packages: manifest.packages.slice(1) }));
    const altered = structuredClone(manifest);
    altered.packages.find(entry => entry.name === '@pulse-compute/wasm-compiler').sha256 = '0'.repeat(64);
    assert.throws(() => verifyClosure(packedRoot, releaseDir, altered), /stale or altered tarball/);
    const child = spawnSync(process.execPath, [__filename, '--execute', packedRoot, releaseDir], {
      cwd: packedRoot, env: process.env, encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024
    });
    assert.equal(child.status, 0, child.stderr || String(child.error));
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'passed');
    assert.equal(result.rows.length, 104);
    assert.equal(result.providerReality, false);
    verifyClosure(packedRoot, releaseDir, manifest);
    console.log(JSON.stringify({ ...result, schemaVersion: 'pulse.http-input-packed.v1',
      packageCount: manifest.packageCount, packages: manifest.packages.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
      installedBytesUnchanged: true, incompleteClosureRejected: true, alteredCompilerRejected: true }));
    return;
  }

  const result = await require('../runtime/http-input-outcomes.cjs').main({ packedRoot, quiet: true });
  const hostFixtures = new Set(['native-platform-capabilities-host.js', 'conditional-kv-host.js']
    .map(file => path.join(repoRoot, 'packages/provider-fastly/src/testing', file)));
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(path.join(repoRoot, 'packages') + path.sep)
      || file.startsWith(path.join(repoRoot, 'wasm/packages') + path.sep)) assert.ok(hostFixtures.has(file), `Workspace product module loaded: ${file}`);
    if (file.includes('/node_modules/@pulse-compute/')) assert.ok(file.startsWith(path.join(packedRoot, 'node_modules') + path.sep));
  }
  console.log(JSON.stringify({ ...result, workspaceProductModules: 0 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
