#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const fixtureRoot = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects', 'package-root');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { compileProject } = require('../../packages/cli/src/project-execution.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const { traceForCanonicalNativeModule } = require('../../packages/compiler/src/spine/canonical-native-module.js');

const project = resolveProject({ cwd: fixtureRoot, env: { PULSE_PROFILE: 'native' } });
const compiled = compileProject(project);
assert.deepEqual(compiled.metadata.effectSites.map((entry) => entry.kind), [
  'assets.lookup',
  'assets.lookup',
  'assets.lookup'
]);
assert.deepEqual(
  compiled.metadata.effectSites.filter((entry) => entry.grouped).map((entry) => entry.groupKey),
  ['first', 'second']
);
assert.deepEqual(compiled.metadata.continuationSites.map((entry) => entry.kind), ['assets.lookup', 'parallel-group']);
assert.deepEqual(compiled.packageReachability.selectedContracts, ['pulse.assets']);

const plan = buildCanonicalNativePlan(compiled);
assert.deepEqual(plan.effects.map((entry) => entry.kind), ['assets.lookup', 'assets.lookup', 'assets.lookup']);
assert.deepEqual(plan.effects.filter((entry) => entry.grouped).map((entry) => entry.groupIndex), [0, 1]);
assert.deepEqual(plan.continuations.map((entry) => entry.kind), ['assets.lookup', 'parallel-group']);
assert.deepEqual(plan.packages.effects.map((entry) => entry.import), [
  '@pulse-compute/assets',
  '@pulse-compute/assets',
  '@pulse-compute/assets'
]);

const native = compileCanonicalNativePlan(plan, { cwd: fixtureRoot, timeoutMs: 180000 });
assert.equal(native.inspection.valid, true);
assert.match(native.inspection.sha256, /^[a-f0-9]{64}$/);
assert.doesNotMatch(native.source, /\bPromise\b|Asyncify|async function|await /);
assert.doesNotMatch(native.wat, /Promise|Asyncify/);
assert.deepEqual(traceForCanonicalNativeModule(native).phases.map((entry) => entry.phase), [
  'native-realization',
  'guest-realization',
  'artifact-verification'
]);

console.log(`ok - package-root Assets and keyed parallel compile to valid ${native.inspection.bytes}-byte Native Wasm ${native.inspection.sha256}`);
