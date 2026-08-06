#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wasmRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(wasmRoot, '..');

function read(relative) {
  return fs.readFileSync(path.join(
    /^packages\/provider-(?:fastly|node)\//.test(relative) ? repoRoot : wasmRoot,
    relative
  ), 'utf8');
}

const extractor = read('packages/compiler/src/extractor.js');
for (const owner of [
  '@pulse-compute/wasm-library-kit/compiler',
  '@pulse-compute/wasm-host-runtime/compiler',
  '@pulse-compute/wasm-schema-json/compiler'
]) {
  assert.ok(extractor.includes(owner), `compiler extractor must delegate to ${owner}`);
}
assert.doesNotMatch(extractor, /@pulse-compute\/provider-(?:node|fastly)/, 'compiler extractor must not import concrete provider implementations');
const providerProofComposition = read('packages/compiler/bin/provider-proof-composition.js');
for (const owner of ['@pulse-compute/provider-node/compiler', '@pulse-compute/provider-fastly/compiler']) {
  assert.ok(providerProofComposition.includes(owner), `legacy provider proofs must be confined to the CLI/testing composition root for ${owner}`);
}

const requiredContractImports = new Map([
  ['packages/compiler/src/project/reachable-graph-builder.js', 'project/reachable-graph'],
  ['packages/compiler/src/spine/package-operation-seam.js', 'package/package-contract'],
  ['packages/provider-node/src/javascript/support.js', 'project/target-support-evidence'],
  ['packages/provider-fastly/src/compiler/fastly-readiness.js', 'diagnostics']
]);
for (const [file, contract] of requiredContractImports) {
  const source = read(file);
  assert.ok(
    source.includes(`@pulse-compute/wasm-contracts/${contract}`) || source.includes(`/contracts/src/${contract}.js`),
    `${file} must consume the shared ${contract} contract`
  );
}

const eventEmit = read('packages/compiler/src/events/event-emit.js');
assert.match(eventEmit, /@pulse-compute\/wasm-contracts\/stable-id/);
assert.doesNotMatch(eventEmit, /contracts\/src\/stable-id/, 'event lowering must not reach across the compiler package boundary for stable IDs');

const stableId = read('packages/contracts/src/stable-id.js');
assert.doesNotMatch(stableId, /node:crypto/, 'shared stable-ID contracts must remain portable across provider JavaScript targets');
assert.match(stableId, /require\(['"]\.\/sha256\.js['"]\)/);
const contractsManifest = JSON.parse(read('packages/contracts/package.json'));
assert.equal(contractsManifest.exports['./sha256'], './src/sha256.js', 'portable SHA-256 must be an explicit contracts package export');

for (const removed of [
  'packages/compiler/src/codegen/handler-library-contracts.js',
  'packages/compiler/src/codegen/library-sidecars.js',
  'packages/compiler/src/codegen/wasm-host-abi.js',
  'packages/compiler/src/codegen/schema-json-sidecar.js',
  'packages/compiler/src/codegen/node-adapter.js'
]) {
  const relative = `./${path.relative(path.join(wasmRoot, 'packages/compiler/src'), path.join(wasmRoot, removed)).replace(/\\/g, '/')}`;
  assert.equal(extractor.includes(relative), false, `${removed} must not be compiler-owned orchestration`);
}

console.log('ok - compiler orchestration delegates implementation and contract ownership to the owning packages');
