#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { select, FAST_TASKS, withTrustedPolicy } = require('../../../scripts/maintainer-fast-validation.cjs');
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
  assert.equal(result.status, 'selected', files.join(', '));
  assert.equal(result.selectionMode, 'conservative');
  assert.deepEqual(result.selectedTasks, FAST_TASKS);
  assert.equal(result.fullCoverage, 'deferred-to-main');
  assert(result.blockers.length);
}
assert.equal(select(policy, ['README.md']).status, 'selected');
assert.throws(() => select(policy, ['../outside.js']), /Invalid changed path/);
assert.throws(() => select(policy, ['wasm/packages/compiler/src/codegen/unrelated.js'], {}), /missing from registry/);
assert.deepEqual(select(policy, []).selectedTasks, FAST_TASKS);
const slowFile = path.relative(path.resolve(__dirname, '../../..'), tasks['jwt-rs256'].args[0]).replace(/\\/g, '/');
const slow = select(policy, [slowFile]);
assert(slow.blockers.some((reason) => reason.includes('jwt-rs256 belongs to full validation')));
assert(!slow.selectedTasks.includes('jwt-rs256'), 'Fast selection must stay within its explicit budget');
assert.throws(() => select({ pathRules: [] }, ['README.md']), /no path rules/);
// A trusted matcher must control classification, even if the proposed matcher disagrees.
assert.equal(select(policy, ['README.md'], tasks, () => false).selectionMode, 'conservative');
const { execFileSync } = require('node:child_process');
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' }).trim();
withTrustedPolicy(base, (trusted, match) => {
  assert(trusted.pathRules.length);
  assert.equal(match('docs/maintainers/testing.md', 'docs/**'), true);
  assert.equal(select(trusted, ['README.md'], tasks, match).status, 'selected');
});
console.log('Fast validation selection contract passed');
