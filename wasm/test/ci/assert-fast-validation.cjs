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

const fullFastTasks = [...FAST_TASKS.filter((id) => id !== 'schema-codecs-smoke'), 'schema-codecs'].sort();
for (const [files, expected] of [
  [['.github/workflows/validate.yml'], FAST_TASKS],
  [['packages/provider-node/src/index.ts'], fullFastTasks],
  [['release/maintenance-policy.json'], FAST_TASKS],
  [['wasm/test/fixtures/some-new-fixture.json'], fullFastTasks],
  [['unrecognized-directory/example.js'], fullFastTasks],
  [['wasm/packages/compiler/src/codegen/unrelated.js', '.github/workflows/validate.yml'], fullFastTasks],
  [['README.md', 'unrecognized-directory/example.js'], fullFastTasks]
]) {
  const result = select(policy, files);
  assert.equal(result.status, 'selected', files.join(', '));
  assert.equal(result.selectionMode, 'conservative');
  assert.deepEqual(result.selectedTasks, expected);
  assert.equal(result.fullCoverage, 'deferred-to-main');
  assert(result.blockers.length);
}
assert.equal(select(policy, ['README.md']).status, 'selected');
assert.throws(() => select(policy, ['../outside.js']), /Invalid changed path/);
assert.throws(() => select(policy, ['wasm/packages/compiler/src/codegen/unrelated.js'], {}), /missing from registry/);
assert.deepEqual(select(policy, []).selectedTasks, fullFastTasks);

// Shared dependencies and schema inputs retain full coverage even without a
// protected boundary or a schema-named implementation file. Mixed/renamed path
// sets must never downgrade that choice, and the two schema tasks never double up.
for (const file of [
  'wasm/packages/schema-json/src/compiler/canonical-schema-codecs.js',
  'wasm/packages/compiler/src/codegen/unrelated.js',
  'wasm/packages/build-support/src/native-optimization.js',
  'wasm/packages/runtime-core-as/src/compiler/canonical-native.js',
  'wasm/packages/host-runtime/src/runtime/canonical-native-host.js',
  'wasm/packages/contracts/src/handler/canonical-runtime.js',
  'wasm/packages/cli/src/project-execution.js',
  'packages/pulse/src/schema.ts',
  'packages/runtime/src/internal/body.js',
  'packages/provider-fastly/src/build/native-platform-capabilities.js',
  'wasm/test/contracts/assert-schema-codecs.cjs',
  'wasm/test/contracts/assert-schema-codecs-smoke.cjs',
  'wasm/test/provider/assert-fastly-json-parser.cjs',
  'wasm/test/support/schema-optional-properties.cjs',
  'wasm/test/support/new-shared-helper.cjs',
  'wasm/test/fixtures/projects/schema-registry/src/pulse/schemas/index.ts',
  'wasm/test/suite/registry.cjs',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'release/pulse-release-manifest.json', 'new-unknown-path.js'
]) {
  const result = select(policy, ['README.md', file, file]);
  assert(result.selectedTasks.includes('schema-codecs'), file);
  assert(result.selectedTasks.includes('schema-registry'), file);
  assert(!result.selectedTasks.includes('schema-codecs-smoke'), file);
  assert.equal(result.schemaCoverage.task, 'schema-codecs');
  assert.equal(result.schemaCoverage.extendedCoverage, 'included');
  assert(result.schemaCoverage.fullReasons.some((reason) => reason.startsWith(file)), file);
}
for (const file of [
  'README.md', 'docs/maintainers/testing.md', 'wasm/packages/cli/docs/maintainers/testing.md',
  '.github/workflows/validate.yml', 'scripts/maintainer-fast-validation.cjs',
  'wasm/test/api/assert-api-surface.cjs', 'wasm/test/ci/assert-fast-validation.cjs'
]) {
  const result = select(policy, [file]);
  assert(result.selectedTasks.includes('schema-codecs-smoke'), file);
  assert(!result.selectedTasks.includes('schema-codecs'), file);
  assert.equal(result.schemaCoverage.task, 'schema-codecs-smoke');
  assert.equal(result.schemaCoverage.extendedCoverage, 'deferred-to-main-and-release');
  assert.deepEqual(result.schemaCoverage.fullReasons, []);
}
const slowFile = path.relative(path.resolve(__dirname, '../../..'), tasks['jwt-rs256'].args[0]).replace(/\\/g, '/');
const slow = select(policy, [slowFile]);
assert(slow.blockers.some((reason) => reason.includes('jwt-rs256 belongs to full validation')));
assert(!slow.selectedTasks.includes('jwt-rs256'), 'Fast selection must stay within its explicit budget');
assert.throws(() => select({ pathRules: [] }, ['README.md']), /no path rules/);
// A trusted matcher must control classification, even if the proposed matcher disagrees.
assert.equal(select(policy, ['README.md'], tasks, () => false).selectionMode, 'conservative');
assert.equal(select(policy, ['README.md'], tasks, () => false).schemaCoverage.task, 'schema-codecs');
const { execFileSync } = require('node:child_process');
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' }).trim();
withTrustedPolicy(base, (trusted, match) => {
  assert(trusted.pathRules.length);
  assert.equal(match('docs/maintainers/testing.md', 'docs/**'), true);
  assert.equal(select(trusted, ['README.md'], tasks, match).status, 'selected');
});
console.log('Fast validation selection contract passed');
