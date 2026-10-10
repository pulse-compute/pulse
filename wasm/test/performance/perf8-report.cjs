'use strict';
// Admission and measurement reconciliation only. Baseline comparison/thresholds
// belong to PERF8-02; legacy PS-08 comparison deliberately retains its v1 schema.
const assert = require('node:assert/strict');
const { perf8Fixtures } = require('./fixtures.cjs');
const { statistics, hash } = require('./report.cjs');
const SCHEMA = 'pulse.performance-baseline.v2';
const compileOnly = 'Compile-only fixture; runtime is not measured';
const nativeTiming = 'Native build timing not recorded for this target';
const runtimeMetrics = ['coldLoadMs', 'firstRequestMs', 'warmRequestMs', 'firstRequestCpuUserUs', 'firstRequestCpuSystemUs', 'warmRequestCpuUserUs', 'warmRequestCpuSystemUs', 'runtimePeakRssBytes'];
function validatePerf8(report) {
  assert.equal(report.schemaVersion, SCHEMA);
  assert.equal(report.status, 'passed', 'Only a completed successful campaign is a baseline');
  assert.equal(report.source.workingTree, '', 'Baseline source must be clean');
  for (const name of ['sourceRevision', 'sourceTree']) assert.match(report.source[name], /^[a-f0-9]{40}$/);
  const { perf8Protocol } = require('./baseline.cjs');
  for (const [key, value] of Object.entries(perf8Protocol)) assert.deepEqual(report.protocol[key], value, 'Unexpected protocol ' + key);
  assert.match(report.protocol.harnessSha256, /^[a-f0-9]{64}$/);
  const expected = perf8Fixtures.flatMap(fixture => (fixture.targets || ['javascript', 'native']).map(target => ({ fixture, target: 'node-' + target })));
  assert.equal(report.cells.length, expected.length, 'Incomplete benchmark matrix');
  assert.equal(report.validation.length, expected.length, 'Incomplete correctness preflight');
  const keys = report.cells.map(cell => cell.fixture.id + '/' + cell.target);
  assert.equal(new Set(keys).size, expected.length, 'Duplicate benchmark cell');
  assert.equal(new Set(report.validation.map(row => row.fixture + '/node-' + row.target)).size, expected.length, 'Duplicate preflight cell');
  for (const { fixture, target } of expected) {
    const cell = report.cells.find(row => row.fixture.id === fixture.id && row.target === target);
    assert(cell, 'Missing fixture/target');
    assert.deepEqual(cell.fixture, { id: fixture.id, sha256: hash(JSON.stringify(fixture)), verifiedCases: fixture.cases.length });
    const checked = report.validation.find(row => row.fixture === fixture.id && 'node-' + row.target === target);
    assert(checked?.status === 'passed' && checked.cases === fixture.cases.length, 'Incorrect preflight coverage');
    const native = target === 'node-native', runtime = fixture.runtime !== false;
    assert.equal(cell.workload, runtime ? 'build-and-runtime' : 'compile-only');
    assert.equal(cell.artifactKind, native ? 'executable-wasm' : 'emitted-javascript-and-codecs');
    assert.equal(cell.buildSamples.length, perf8Protocol.buildSamples);
    assert.equal(cell.runtimeSamples.length, runtime ? perf8Protocol.coldProcesses : 0);
    for (const sample of cell.buildSamples) {
      assert.deepEqual(sample.settings, cell.settings, 'Compiler settings drift');
      assert.match(sample.artifactSha256, /^[a-f0-9]{64}$/);
      assert(Number.isSafeInteger(sample.artifactBytes) && sample.artifactBytes > 0);
      if (native) {
        const metadata = sample.buildMetadata;
        assert.equal(metadata.status, 'recorded'); assert.match(metadata.capsuleHash, /^[a-f0-9]{64}$/);
        assert.equal(metadata.context.primaryArtifactId, 'artifact:' + sample.artifactSha256);
        assert.equal(metadata.context.host, 'node'); assert.equal(metadata.context.target, 'native');
        const build = metadata.build;
        assert.equal(build.version, 1); assert.equal(build.operation, 'native-build');
        assert.equal(build.timingScope, 'build-start-through-inventory-capture');
        assert(build.compilers.length && build.stages.length);
        assert(build.stages.every(row => Number.isSafeInteger(row.durationMs) && row.durationMs >= 0));
        assert.equal(build.totalDurationMs, build.stages.reduce((n, row) => n + row.durationMs, 0));
        assert.equal(build.compilationDurationMs, build.compilers.reduce((n, row) => n + row.durationMs, 0));
        for (const compiler of build.compilers) {
          assert(Array.isArray(compiler.flags) && typeof compiler.flagsComplete === 'boolean' && compiler.optimization && compiler.toolchain.length);
          assert(Number.isSafeInteger(compiler.durationMs) && compiler.durationMs >= 0);
        }
      } else assert.deepEqual(sample.buildMetadata, { status: 'unavailable', reason: 'Native build capsule does not apply to JavaScript source packages' });
    }
    for (const sample of cell.runtimeSamples) {
      for (const name of ['warmRequestMs', 'warmRequestCpuUserUs', 'warmRequestCpuSystemUs']) assert.equal(sample[name].length, perf8Protocol.warmSamplesPerProcess);
      assert.deepEqual(Object.keys(sample.memory).sort(), ['beforeLoad', 'afterLoad', 'afterFirst', 'afterWarmup', 'afterWarm'].sort());
      for (const snapshot of Object.values(sample.memory)) for (const name of ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']) assert(Number.isSafeInteger(snapshot[name]) && snapshot[name] >= 0, 'Invalid process memory snapshot');
    }
    const expectedMetrics = {
      buildMs: statistics(cell.buildSamples.map(row => row.buildMs)),
      compilerPeakRssBytes: statistics(cell.buildSamples.map(row => row.compilerPeakRssBytes), 'Compiler process did not supply resourceUsage RSS'),
      artifactBytes: statistics(cell.buildSamples.map(row => row.artifactBytes)),
      retainedBuildMs: statistics(cell.buildSamples.map(row => row.buildMetadata.build?.totalDurationMs ?? null), nativeTiming),
      retainedCompilationMs: statistics(cell.buildSamples.map(row => row.buildMetadata.build?.compilationDurationMs ?? null), nativeTiming),
      cleanupMs: cell.metrics.cleanupMs,
      requestCleanupMs: statistics([], runtime ? 'Mandatory request disposal is inside the provider invocation; no separate public timing hook' : compileOnly),
    };
    const cleanup = cell.metrics.cleanupMs;
    assert(cleanup.status === 'measured' && cleanup.sampleCount === 1 && Number.isFinite(cleanup.p50) && cleanup.p50 >= 0);
    assert.deepEqual(cleanup, statistics([cleanup.p50]));
    for (const name of runtimeMetrics) expectedMetrics[name] = statistics(cell.runtimeSamples.flatMap(row => row[name]), runtime ? 'Runtime process RSS unavailable' : compileOnly);
    assert.deepEqual(cell.metrics, expectedMetrics, 'Summary does not reconcile with raw observations');
    assert.deepEqual(cell.artifactSha256, cell.buildSamples.map(row => row.artifactSha256));
    assert.deepEqual(cell.coldSamples, { buildMs: cell.buildSamples.map(row => row.buildMs), coldLoadMs: cell.runtimeSamples.map(row => row.coldLoadMs), firstRequestMs: cell.runtimeSamples.map(row => row.firstRequestMs) });
    assert.deepEqual(cell.warmProcesses, cell.runtimeSamples.map(row => statistics(row.warmRequestMs)));
  }
  return report;
}
module.exports = { SCHEMA, validatePerf8 };
