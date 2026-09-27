#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { select } = require('../../../scripts/maintainer-fast-validation.cjs');
const policy = require('../../../release/maintenance-policy.json');
const { tasks } = require('../suite/registry.cjs');

const source = select(policy, ['wasm/packages/compiler/src/codegen/unrelated.js']);
assert.equal(source.status, 'selected');
assert.deepEqual(source.selectedTasks, [...source.selectedTasks].sort());
for (const id of ['package-exports', 'api-surface', 'target-support', 'node-cross-target-conformance', 'canonical-api-lowering', 'javascript-effect-adapter']) {
  assert(source.selectedTasks.includes(id), `missing ${id}`);
}
assert.equal(select(policy, ['wasm/packages/compiler/src/schema-json-codec.js']).selectedTasks.includes('schema-codecs'), true);

const knownTest = Object.entries(tasks).find(([, task]) => {
  const args = Object.getOwnPropertyDescriptor(task, 'args')?.value;
  return args?.[0] && path.relative(path.resolve(__dirname, '../../..'), args[0]).replace(/\\/g, '/') === 'wasm/test/api/assert-api-surface.cjs';
});
assert(knownTest);
assert(select(policy, ['wasm/test/api/assert-api-surface.cjs']).selectedTasks.includes(knownTest[0]));

for (const files of [
  ['.github/workflows/validate.yml'],
  ['packages/provider-node/src/index.ts'],
  ['release/maintenance-policy.json'],
  ['wasm/test/fixtures/some-new-fixture.json'],
  ['unrecognized-directory/example.js'],
  ['wasm/packages/compiler/src/codegen/unrelated.js', '.github/workflows/validate.yml'],
  ['README.md', 'unrecognized-directory/example.js']
]) {
  const result = select(policy, files);
  assert.equal(result.status, 'requires-full', files.join(', '));
  assert.deepEqual(result.selectedTasks, []);
  assert(result.blockers.length);
}
assert.equal(select(policy, ['README.md']).status, 'selected');
assert.throws(() => select(policy, ['../outside.js']), /Invalid changed path/);
assert.throws(() => select(policy, ['wasm/packages/compiler/src/codegen/unrelated.js'], {}), /missing from registry/);
console.log('Fast validation selection contract passed');
