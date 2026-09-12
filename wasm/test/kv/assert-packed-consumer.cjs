#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute'), compute = args.includes('--compute');
  const [rootArgument, releaseArgument] = args.filter((a) => !a.startsWith('--'));
  assert.ok(rootArgument && releaseArgument, 'Usage: assert-packed-consumer.cjs <isolated-install> <release-pack> [--compute]');
  const packedRoot = fs.realpathSync(rootArgument), releaseDir = fs.realpathSync(releaseArgument);
  const repoRoot = path.resolve(__dirname, '../../..');
  assert.ok(packedRoot !== repoRoot && !packedRoot.startsWith(repoRoot + path.sep), 'Consumer must be outside the workspace');
  assert.equal(process.env.NODE_PATH, undefined);
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'pulse-release-manifest.json')));
  if (!execute) {
    const { readTarEntries } = require('../../../scripts/pack-release.cjs');
    const verify = () => {
      for (const entry of manifest.packages) {
        const tarball = path.join(releaseDir, entry.tarball);
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex'), entry.sha256);
        const packageRoot = path.join(packedRoot, 'node_modules', entry.name);
        assert.equal(fs.realpathSync(packageRoot), packageRoot, 'no package symlinks');
        for (const [name, bytes] of readTarEntries(tarball)) {
          const file = path.join(packageRoot, name.replace(/^package\//, '').replace(/(^|\/)\.gitignore$/, '$1.npmignore'));
          assert.ok(fs.realpathSync(file).startsWith(packageRoot + path.sep), 'no workspace links');
          assert.deepEqual(fs.readFileSync(file), bytes, `${entry.name}/${name}: exact tarball bytes`);
        }
      }
    };
    verify();
    const child = spawnSync(process.execPath, [__filename, '--execute', packedRoot, releaseDir, ...(compute ? ['--compute'] : [])], {
      cwd: packedRoot, env: process.env, encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024,
    });
    assert.ok(child.status === 0 || child.status === 1, child.stderr || String(child.error));
    assert.ok(child.stdout.trim(), child.stderr || String(child.error));
    const consumer = JSON.parse(child.stdout);
    assert.equal(consumer.providerReality, compute);
    assert.equal(child.status, consumer.status === 'passed' ? 0 : 1);
    verify();
    console.log(JSON.stringify({ ...consumer, version: 'pulse.kv-k4-packed.v1', installedBytesUnchanged: true,
      packageCount: manifest.packages.length, packages: manifest.packages.map(({ name, version, sha256 }) => ({ name, version, sha256 })) }));
    if (consumer.status !== 'passed') process.exitCode = 1;
    return;
  }
  const installed = createRequire(path.join(packedRoot, 'package.json'));
  const typeFile = path.join(packedRoot, 'kv-types.ts');
  fs.copyFileSync(path.join(__dirname, 'k4/types.ts'), typeFile);
  const ts = installed('typescript');
  const program = ts.createProgram([typeFile], { noEmit: true, strict: true, skipLibCheck: false, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (n) => n, getCurrentDirectory: () => packedRoot, getNewLine: () => '\n',
  }));
  const consumer = await require('./run-k4-consumer.cjs').main({ packedRoot, compute, quiet: true });
  for (const file of Object.keys(require.cache)) {
    assert.equal(file.startsWith(path.join(repoRoot, 'packages') + path.sep)
      || file.startsWith(path.join(repoRoot, 'wasm/packages') + path.sep), false, `workspace product module loaded: ${file}`);
  }
  console.log(JSON.stringify({ ...consumer, publicTypes: 'passed', workspaceProductModules: 0 }));
  if (consumer.status !== 'passed') process.exitCode = 1;
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
