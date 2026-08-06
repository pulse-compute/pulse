#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packRelease } = require('../../../scripts/pack-release.cjs');
const { buildDocumentationSite } = require('../../../scripts/build-docs-site.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const tempRoot = process.env.PULSEWASM_TEST_TMP_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-artifact-determinism-'));

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function treeIdentity(root) {
  const entries = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) entries.push(Object.freeze({
        path: path.relative(root, file).replace(/\\/g, '/'),
        bytes: fs.statSync(file).size,
        sha256: sha256(fs.readFileSync(file))
      }));
    }
  }
  visit(root);
  return entries;
}

const firstPackages = path.join(tempRoot, 'packages-a');
const secondPackages = path.join(tempRoot, 'packages-b');
const firstRelease = packRelease({ repoRoot, outDir: firstPackages, build: false });
const secondRelease = packRelease({ repoRoot, outDir: secondPackages, build: false });

assert.deepEqual(
  firstRelease.manifest.packages.map(({ name, version, tarball, bytes, sha256: digest, integrity }) => ({ name, version, tarball, bytes, sha256: digest, integrity })),
  secondRelease.manifest.packages.map(({ name, version, tarball, bytes, sha256: digest, integrity }) => ({ name, version, tarball, bytes, sha256: digest, integrity })),
  'release package identities must be stable across independent construction'
);
assert.deepEqual(treeIdentity(firstPackages), treeIdentity(secondPackages), 'release package output trees must be byte-identical');

const firstSite = path.join(tempRoot, 'site-a');
const secondSite = path.join(tempRoot, 'site-b');
buildDocumentationSite({ output: firstSite, clean: true });
buildDocumentationSite({ output: secondSite, clean: true });
assert.deepEqual(treeIdentity(firstSite), treeIdentity(secondSite), 'documentation site output trees must be byte-identical');

console.log(`ok - independent release package and documentation site builds are byte-identical (${treeIdentity(firstPackages).length} package files, ${treeIdentity(firstSite).length} site files)`);
