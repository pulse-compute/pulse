'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { repoRoot } = require('./helpers.cjs');

function storageFixture(root) {
  fs.cpSync(path.join(repoRoot, 'wasm/test/fixtures/projects/cli-storage'), root, {
    recursive: true, filter: (file) => !file.split(path.sep).includes('node_modules')
  });
  const scope = path.join(root, 'node_modules/@pulse-compute');
  fs.mkdirSync(scope, { recursive: true });
  for (const name of ['pulse', 's3', 'runtime']) {
    fs.symlinkSync(path.join(repoRoot, 'packages', name), path.join(scope, name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  return root;
}
module.exports = { storageFixture };
