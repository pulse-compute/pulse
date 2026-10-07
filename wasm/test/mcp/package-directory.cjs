#!/usr/bin/env node
'use strict';
// Local packaging only. Public packages come exclusively from the standard release pack.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const root = path.resolve(__dirname, '../../..');
function packageDirectory(outDir) {
  // The pinned package manager may auto-install before build. Suppress lifecycle
  // execution explicitly, including that implicit install, without changing policy.
  const previous = process.env.npm_config_ignore_scripts;
  let packed;
  try {
    process.env.npm_config_ignore_scripts = 'true';
    packed = packRelease({ repoRoot: root, outDir });
  } finally {
    if (previous === undefined) delete process.env.npm_config_ignore_scripts;
    else process.env.npm_config_ignore_scripts = previous;
  }
  if (packed.manifest.packages.filter(p => p.name === '@pulse-compute/mcp').length !== 1) throw new Error('Standard release pack must contain MCP exactly once');
  const extra = [];
  for (const relative of ['packages/mcp/examples/resource-directory']) {
    const result = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', outDir], {
      cwd: path.join(root, relative), encoding: 'utf8', timeout: 30000,
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, maxBuffer: 1024 * 1024,
    }))[0];
    const bytes = fs.readFileSync(path.join(outDir, result.filename));
    extra.push({ name: result.name, version: result.version, tarball: result.filename, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  const app = extra.find(p => p.name.startsWith('@pulse-examples/'));
  const entries = readTarEntries(path.join(outDir, app.tarball));
  if (!entries.has('package/.pulse/config.ts')) throw new Error('Application package omitted configuration');
  const manifest = { version: 'pulse.mcp-directory-package.v1', source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    published: false, packages: [...packed.manifest.packages, ...extra] };
  fs.writeFileSync(path.join(outDir, 'mcp-directory-pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
module.exports = { packageDirectory };
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node wasm/test/mcp/package-directory.cjs <output-directory>');
  packageDirectory(path.resolve(process.argv[2]));
}
