#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tasks, profiles, expandProfile, wasmRoot } = require('./registry.cjs');
const { canonicalizeEphemeralPaths } = require('../../packages/build-support/src/files.js');

const shallowStaging = canonicalizeEphemeralPaths('$../../tmp/pulsewasm-compiled-handlers-a1B2c3/generated/as/app.as');
const deepStaging = canonicalizeEphemeralPaths('$../../../../../../../tmp/pulsewasm-compiled-handlers-Z9y8X7/generated/as/app.as');
assert.equal(shallowStaging, '$tmp/pulsewasm-compiled-handlers-STAGING/generated/as/app.as');
assert.equal(deepStaging, shallowStaging);

const evidenceKinds = new Set([
  'unit',
  'native',
  'javascript',
  'conformance',
  'cli',
  'providers',
  'release',
  'external'
]);
const signatures = new Map();

for (const [name, task] of Object.entries(tasks)) {
  assert.ok(task.command, `${name} must define a command`);
  assert.ok(Array.isArray(task.args) && task.args.length > 0, `${name} must define args`);
  assert.ok(Number.isInteger(task.timeoutMs) && task.timeoutMs >= 1000, `${name} must define a finite timeout`);
  assert.ok(evidenceKinds.has(task.evidence), `${name} must use a known evidence kind`);
  assert.equal(fs.existsSync(task.args[0]), true, `${name} must reference an existing executable`);
  assert.equal(path.relative(wasmRoot, task.args[0]).startsWith(`audit${path.sep}`), false, `${name} must not execute archived evidence`);
  const signature = `${task.command}\0${task.args.join('\0')}`;
  assert.equal(signatures.has(signature), false, `${name} duplicates ${signatures.get(signature) || 'another task'}`);
  signatures.set(signature, name);
}

assert.deepEqual(
  Object.keys(profiles).sort(),
  ['cli', 'conformance', 'javascript', 'native', 'providers', 'release', 'unit']
);

for (const name of Object.keys(profiles)) {
  const expanded = expandProfile(name);
  assert.ok(expanded.length > 0, `${name} must not be empty`);
  assert.equal(new Set(expanded).size, expanded.length, `${name} must deduplicate tasks`);
  for (const taskName of expanded) assert.ok(tasks[taskName], `${name} references unknown task ${taskName}`);
}

const release = expandProfile('release');
const externalTasks = new Set([
  // The S01 measurement task is a manually selected benchmark with sampled
  // process RSS, not a deterministic release acceptance check.
  'compiler-efficiency-p02',
  'compiler-efficiency-p03',
  'compiler-handler-boundary-b01',
  'compiler-retention-cost-t01',
  'compiler-bounded-merging',
  'compiler-guest-link-evidence',
  'guest-link-final-reality',
  'guest-link-memory-matrix',
  'guest-link-feasibility-decision',
  'guest-link-contract-design',
  'guest-link-b-seal',
  'guest-link-scalar-control',
  'crypto-verification-seal',
  'jwt-realization-integration',
  'jwt-d-seal',
  'jwt-native-reality',
  'jwt-fail-closed-audit',
  'jwt-e-seal',
  'jwt-evidence-consolidation',
  'jwt-impact-hardening',
  'jwt-guest-link-suitability',
  'jwt-asymmetric-recommendation',
  'jwt-final-proof-seal',
  'jwt-es256-contract-freeze',
  'crypto-es256-guest',
  'crypto-es256-guest-link',
  'jwt-es256-composition',
  'jwt-es256-cross-target',
  'jwt-es256-six-cell',
  'jwt-es256-final-seal',
  'boundary-authority-h0',
  'boundary-authority-h1',
  'boundary-authority-h2',
  'boundary-authority-h3',
  'boundary-authority-h4',
  'boundary-negative-h5',
  'boundary-authority-h5',
  'provider-toolchain',
  'provider-packages',
  'fastly-javascript-es256',
  'entities-cross-target',
  'entities-candidate-seal',
  'events-contract-feasibility',
  'events-static-topology',
  'events-javascript-runtime',
  'events-emit-javascript',
  'events-native-runtime',
  'events-node-reference',
  'events-candidate-seal',
  'provider-fastly-compute-reality',
  'kv-conditional-acceptance'
]);
assert.ok(expandProfile('unit').includes('test-orchestration'));
for (const required of [
  'api-surface',
  'reachable-graph',
  'target-support',
  'schema-codecs',
  'events-conformance',
  'node-cross-target-conformance',
  'grip-cross-target-conformance',
  'canonical-api-lowering',
  'canonical-api-runtime',
  'cli-command-spec',
  'provider-fastly-apps',
  'release-packages'
]) {
  assert.ok(release.includes(required), `release must include ${required}`);
}
for (const profile of ['unit', 'native', 'javascript', 'conformance', 'providers', 'cli']) {
  for (const taskName of expandProfile(profile)) {
    assert.ok(release.includes(taskName), `release must include ${profile} task ${taskName}`);
  }
}
assert.equal(release.includes('compiler-bounded-merging'), false);
assert.equal(release.includes('compiler-handler-boundary-b01'), false);
assert.equal(release.includes('compiler-retention-cost-t01'), false);
assert.equal(release.includes('compiler-guest-link-evidence'), false);
assert.equal(release.includes('provider-fastly-compute-reality'), false);
assert.equal(release.includes('guest-link-scalar-control'), false);
assert.equal(release.includes('guest-link-memory-matrix'), false);
assert.equal(release.includes('guest-link-final-reality'), false);
assert.equal(release.includes('guest-link-feasibility-decision'), false);
assert.equal(release.includes('guest-link-contract-design'), false);
assert.equal(release.includes('guest-link-b-seal'), false);
assert.ok(release.includes('clean-machine-acceptance'));
const releaseSet = new Set(release);
for (const taskName of Object.keys(tasks)) {
  if (externalTasks.has(taskName)) continue;
  assert.ok(releaseSet.has(taskName), `release must include current task ${taskName}`);
}

for (const name of [...Object.keys(tasks), ...Object.keys(profiles)]) {
  assert.doesNotMatch(name, /(?:^|[-_])(?:sprint|wave|phase|pass\d+|legacy|baseline|checkpoint)(?:$|[-_])/i);
}

const repoRoot = path.resolve(wasmRoot, '..');
const currentPipelineFiles = [
  'package.json',
  'wasm/package.json',
  'wasm/test/suite/registry.cjs',
  'wasm/scripts/run-wasm-tests.cjs',
  'scripts/validate-release.cjs',
  '.github/workflows/validate.yml',
  '.github/workflows/npm-publish.yml',
  'scripts/bundle_deps.sh',
  'scripts/restore_deps.sh',
  'docs/maintainers/testing.md',
  'wasm/docs/TESTING.md',
  'docs/maintainers/release-acceptance.md'
];
for (const relativeFile of currentPipelineFiles) {
  const source = fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8');
  assert.doesNotMatch(source, /\b(?:sprint|wave|phase\s*\d|pass\s*\d|legacy|baseline|checkpoint)\b/i, `${relativeFile} must describe only the current pipeline`);
}

const releaseValidator = fs.readFileSync(path.join(repoRoot, 'scripts/validate-release.cjs'), 'utf8');
for (const variable of ['COREPACK_HOME', 'PNPM_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'npm_config_cache']) {
  assert.match(releaseValidator, new RegExp(`\\b${variable}: path\\.join\\(packageManagerCache,`), `${variable} must stay inside the release-seal cache`);
}
assert.doesNotMatch(releaseValidator, /\bHOME\s*:/, 'the release seal must not repurpose HOME');

const checkedInScratchTrees = fs.readdirSync(wasmRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('artifacts-test-'))
  .map((entry) => entry.name);
assert.deepEqual(checkedInScratchTrees, []);

console.log(`ok - ${Object.keys(tasks).length} current tasks across ${Object.keys(profiles).length} profiles`);
