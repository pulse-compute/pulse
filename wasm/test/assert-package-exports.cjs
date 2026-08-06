#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildWorkspacePackage,
  cleanupWorkspacePackageBuilds
} = require('./support/workspace-package-build.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const releaseManifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'release', 'pulse-release-manifest.json'), 'utf8')
);
const releasedPackages = new Map(
  releaseManifest.packages.map((entry) => [entry.name, entry.version])
);
const packageRoots = [
  ...fs.readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(repoRoot, 'packages', entry.name)),
  ...fs.readdirSync(path.join(repoRoot, 'wasm', 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(repoRoot, 'wasm', 'packages', entry.name))
].filter((root) => fs.existsSync(path.join(root, 'package.json')));

function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(exportTargets);
}

for (const root of packageRoots) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (exportTargets(manifest.exports || {}).some((target) => target.startsWith('./dist/'))) {
    buildWorkspacePackage(path.relative(repoRoot, root));
  }
}

const names = new Set();
for (const root of packageRoots) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(typeof manifest.name, 'string', `${root} must declare a package name`);
  assert.equal(names.has(manifest.name), false, `duplicate package name ${manifest.name}`);
  names.add(manifest.name);
  if (releasedPackages.has(manifest.name)) {
    assert.equal(
      manifest.version,
      releasedPackages.get(manifest.name),
      `${manifest.name} must use its synchronized release-manifest version`
    );
  }
  assert.doesNotMatch(JSON.stringify(manifest.exports || {}), /(?:sprint|wave|phase\d+|pass\d+|legacy|checkpoint)/i, `${manifest.name} exports must be current`);
  assert.doesNotMatch(JSON.stringify(manifest.files || []), /(?:audit|internal\/history)/i, `${manifest.name} package files must exclude archived material`);
  for (const target of exportTargets(manifest.exports || {})) {
    if (!target.startsWith('./')) continue;
    assert.equal(fs.existsSync(path.join(root, target)), true, `${manifest.name} export target ${target} must exist`);
  }
}

const runtime = require(path.join(repoRoot, 'packages/runtime/src/index.js'));
assert.equal(typeof runtime.Router, 'function');
assert.equal(runtime.RUNTIME_API_VERSION, 'pulse.runtime-authoring.v4');

const contracts = require(path.join(repoRoot, 'wasm/packages/contracts/src/index.js'));
for (const key of [
  'canonicalRuntime',
  'canonicalNativePlan',
  'canonicalNativeRuntime',
  'canonicalProvider',
  'reachableGraph',
  'targetSupportEvidence'
]) {
  assert.ok(Object.prototype.hasOwnProperty.call(contracts, key), `contracts must expose ${key}`);
}

const fastlyCompiler = require(path.join(repoRoot, 'packages/provider-fastly/src/compiler/index.js'));
assert.equal(typeof fastlyCompiler.buildFastlyReadiness, 'function');
assert.equal(typeof fastlyCompiler.buildFastlyCommandEntry, 'function');

const {
  NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION
} = require(path.join(repoRoot, 'packages/provider-node/src/javascript/support.js'));
assert.deepEqual(NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.summary, {
  total: 12,
  satisfied: 12,
  pending: 0,
  blocked: 0
});
assert.equal(NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.automaticFallback, false);

cleanupWorkspacePackageBuilds();
console.log(`ok - ${packageRoots.length} package manifests expose only existing current targets`);
