'use strict';
const assert = require('node:assert/strict');
const f = require('./report-fixtures.cjs');
const { observeAssemblyScript } = require('../../packages/build-support/src/build-observation');
const { createCapsule, serializeCapsule, parseCapsule } = require('../../packages/cli/src/internal/report/capsule');

function fixture() {
  const input = f.fixture(true);
  const args = ['/private/asc.js', 'app.ts', '--outFile', '/private/output.wasm', '--runtime', 'stub', '--noAssert', '--optimize',
    '--optimizeLevel', '3', '--shrinkLevel', '2', '--transform', '/private/native-retention-transform.cjs', '--runPasses', 'merge-similar-functions'];
  const original = [...args];
  const observation = observeAssemblyScript(args, { version: '0.28.18', compilerVersion: 'synthetic-compiler-v1', durationMs: 1200 });
  assert.deepEqual(args, original, 'metadata observation never changes the compiler invocation');
  assert.ok(!JSON.stringify(observation).includes('/private/'));
  assert.equal(observation.flagsComplete, true);
  input.provenance.recipe.optimization = 'experimental-native-bounded-size';
  input.build = { version: 1, operation: 'compile', timingScope: 'build-start-through-inventory-capture', totalDurationMs: 1500,
    compilationDurationMs: 1200, stages: [{ name: 'portable compilation', durationMs: 1500 }],
    compilers: [{ phase: 'portable', artifactId: f.aid, ...observation }], providerArtifactReuse: 'not-applicable', cache: 'not-recorded' };
  return input;
}
function contractCases() {
  const input = fixture(), capsule = createCapsule(input), wire = serializeCapsule(capsule);
  assert.equal(serializeCapsule(parseCapsule(wire)), wire);
  assert.equal(createCapsule(f.fixture()).build, undefined, 'historical capsules gain no invented facts');
  for (const change of [
    value => { value.build.totalDurationMs++; },
    value => { value.build.compilationDurationMs++; },
    value => { value.build.compilers[0].artifactId = 'missing'; },
    value => { value.build.compilers.push(value.build.compilers[0]); },
    value => { value.build.providerArtifactReuse = 'reused'; },
    value => { value.build.stages[0].durationMs = -1; }
  ]) {
    const value = structuredClone(input); change(value); assert.throws(() => createCapsule(value));
  }
  const extra = structuredClone(input); extra.build.compilers[0].secret = 'SECRET';
  assert.ok(!serializeCapsule(createCapsule(extra)).includes('SECRET'), 'collector projection strips unowned fields');
  const invalidWire = JSON.parse(wire); invalidWire.build.compilers[0].secret = 'SECRET';
  assert.throws(() => parseCapsule(JSON.stringify(invalidWire)), 'wire schema rejects unowned fields');
  const future = observeAssemblyScript(['asc', 'app', '--optimize', '--unknown', 'SECRET'], { version: 'future', compilerVersion: 'future', durationMs: 0 });
  assert.equal(future.optimization.optimizeLevel, null);
  assert.equal(future.flagsComplete, false);
  assert.ok(!JSON.stringify(future).includes('SECRET'));
  const converging = observeAssemblyScript(['asc', 'app', '--optimize', '--converge'], { version: '0.28.18', compilerVersion: 'v1', durationMs: 0 });
  assert.equal(converging.optimization.converge, true);
}
function viewerCases({ renderedTree }) {
  const capsule = createCapsule(fixture()), before = serializeCapsule(capsule), tree = renderedTree(capsule);
  const summary = tree.get('build-summary');
  assert.match(summary.textContent, /Total to capture1.50 s/);
  assert.match(summary.textContent, /AssemblyScript compilation1.20 s/);
  assert.match(summary.textContent, /O3 \/ shrink 2 \/ convergence off/);
  assert.match(summary.textContent, /synthetic-compiler-v1/);
  assert.match(summary.textContent, /report serialization and final publication are excluded/);
  const detail = summary.children.find(node => node.tag === 'details');
  assert.ok(detail); assert.equal(detail.attrs.open, undefined);
  assert.match(detail.textContent, /--runPasses merge-similar-functions/);
  assert.match(detail.textContent, /--outFile <wasm-output>/);
  assert.equal(serializeCapsule(capsule), before);
  const old = renderedTree(createCapsule(f.fixture()));
  assert.match(old.get('build-summary').textContent, /Not recorded/);
  assert.match(old.get('build-summary').textContent, /were not recorded for this artifact/);
}
module.exports = { fixture, contractCases, viewerCases };
