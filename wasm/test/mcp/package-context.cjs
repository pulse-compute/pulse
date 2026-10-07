#!/usr/bin/env node
'use strict';
// Public package bytes come exclusively from the standard release pack/shared receipt.
const path = require('node:path');
const { packRelease } = require('../../../scripts/pack-release.cjs');
const root = path.resolve(__dirname, '../../..');
function packageContext(outDir) {
  const previous = process.env.npm_config_ignore_scripts;
  try {
    process.env.npm_config_ignore_scripts = 'true';
    const packed = packRelease({ repoRoot: root, outDir });
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
