#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

async function main() {
  const execute = process.argv[2] === '--execute';
  const [rootArgument, releaseArgument] = process.argv.slice(execute ? 3 : 2);
  assert.ok(rootArgument && releaseArgument, 'Usage: assert-packed-consumer.cjs <isolated-install> <release-pack>');
  const packedRoot = fs.realpathSync(rootArgument);
  const releaseDir = fs.realpathSync(releaseArgument);
  const repoRoot = path.resolve(__dirname, '../../..');
  assert.ok(!packedRoot.startsWith(repoRoot + path.sep), 'Consumer must be outside the workspace');
  assert.equal(process.env.NODE_PATH, undefined);
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'pulse-release-manifest.json'), 'utf8'));
  const installed = createRequire(path.join(packedRoot, 'package.json'));

  function verifyInstalledBytes() {
    // Artifact verification runs in the supervisor. The consumer subprocess
    // does not load the workspace packer or its documentation dependencies.
    const { readTarEntries } = require('../../../scripts/pack-release.cjs');
    for (const entry of manifest.packages) {
      const tarball = path.join(releaseDir, entry.tarball);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex'), entry.sha256);
      const packageRoot = path.join(packedRoot, 'node_modules', entry.name);
      const packageManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
      assert.equal(packageManifest.version, manifest.releaseVersion);
      for (const [name, bytes] of readTarEntries(tarball)) {
        // npm/pacote renames bundled .gitignore files to .npmignore while
        // extracting. Compare their exact bytes at that installer-owned name.
        const installedName = name.replace(/^package\//, '').replace(/(^|\/)\.gitignore$/, '$1.npmignore');
        const file = path.join(packageRoot, installedName);
        assert.ok(fs.realpathSync(file).startsWith(packageRoot + path.sep), `${entry.name}: no workspace links`);
        assert.deepEqual(fs.readFileSync(file), bytes, `${entry.name}/${name}: installed bytes must equal the exact tarball`);
      }
    }
  }
  if (!execute) {
    verifyInstalledBytes();
    const child = spawnSync(process.execPath, [__filename, '--execute', packedRoot, releaseDir], {
      cwd: packedRoot, env: process.env, encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr || String(child.error));
    const consumer = JSON.parse(child.stdout);
    assert.equal(consumer.status, 'passed');
    verifyInstalledBytes();
    console.log(JSON.stringify({
      ...consumer, version: 'pulse.s3-packed-acceptance.v1',
      releaseVersion: manifest.releaseVersion, packageCount: manifest.packages.length,
      packages: manifest.packages.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
      installedBytesUnchanged: true, liveOrigin: 'deferred-until-after-T2',
    }));
    return;
  }
  const s3 = installed('@pulse-compute/s3');
  for (const operation of ['head', 'getText', 'putText']) assert.equal(typeof s3.s3[operation], 'function');
  const support = manifest.packages.find(({ name }) => name === '@pulse-compute/s3');
  assert.equal(support.supportTier, 'supported-extension');
  assert.deepEqual(support.entryPoints, ['@pulse-compute/s3']);

  const typeConsumer = path.join(packedRoot, 's3-types.ts');
  fs.copyFileSync(path.join(__dirname, 'o4-types.ts'), typeConsumer);
  const ts = installed('typescript');
  const program = ts.createProgram([typeConsumer], {
    noEmit: true, strict: true, skipLibCheck: false, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name, getCurrentDirectory: () => packedRoot, getNewLine: () => '\n',
  }));

  const results = {};
  // Each corpus installs its application/configuration fixture at the actual
  // consumer root. Compiler contract discovery is project-local.
  for (const [kind, runner] of [['reads', './run-native-read-acceptance.cjs'], ['writes', './run-write-acceptance.cjs']]) {
    fs.writeFileSync(path.join(packedRoot, 'package.json'), JSON.stringify({
      name: `packed-s3-${kind}`, private: true, version: '0.0.0',
      dependencies: Object.fromEntries(['pulse', 'runtime', 's3', 'cli', 'provider-node', 'provider-fastly']
        .map((name) => [`@pulse-compute/${name}`, manifest.releaseVersion])),
    }));
    results[kind] = await require(runner).main({ packedRoot, cwd: packedRoot, quiet: true });
  }
  // No product package may be loaded from repository source. The one allowed
  // source module is the ABI host fixture; it imports only Node builtins.
  const hostFixture = path.join(repoRoot, 'packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(path.join(repoRoot, 'packages') + path.sep)
      || file.startsWith(path.join(repoRoot, 'wasm/packages') + path.sep)) assert.equal(file, hostFixture);
  }
  console.log(JSON.stringify({ status: 'passed', results, publicTypes: 'passed', providerReality: false }));
}

main().catch((error) => { console.error(error.stack || error); console.error(JSON.stringify(error.detail || error.diagnostics || {})); process.exitCode = 1; });
