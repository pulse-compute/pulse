#!/usr/bin/env node
'use strict';
// Public package bytes come exclusively from the standard release pack/shared receipt.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { packRelease } = require('../../../scripts/pack-release.cjs');
const root = path.resolve(__dirname, '../../..');
function packageContext(outDir) {
  const previous = process.env.npm_config_ignore_scripts;
  try {
    process.env.npm_config_ignore_scripts = 'true';
    // pnpm 12's run command can auto-install and prompt for dependency builds.
    // Run the declared workspace build explicitly with lifecycle hooks disabled;
    // the ordinary packer still owns every package and source validation step.
    // A verified release-owned shared pack already carries its build receipt.
    if (!process.env.PULSE_RELEASE_SHARED_PACK) execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'build', '--ignore-scripts'], { cwd: root, env: process.env, stdio: 'pipe', timeout: 300000 });
    const packed = packRelease({ repoRoot: root, outDir, build: false });
    for (const name of ['@pulse-compute/mcp', '@pulse-compute/cli']) {
      if (packed.manifest.packages.filter(p => p.name === name).length !== 1) throw new Error('Standard release pack must contain ' + name + ' exactly once');
    }
    return packed.manifest;
  } finally {
    if (previous === undefined) delete process.env.npm_config_ignore_scripts;
    else process.env.npm_config_ignore_scripts = previous;
  }
}
module.exports = { packageContext };
