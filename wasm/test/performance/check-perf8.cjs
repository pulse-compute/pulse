#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { perf8Fixtures } = require('./fixtures.cjs');
const { perf8Protocol } = require('./baseline.cjs');
const { statistics, hash, compare } = require('./report.cjs');
const { validatePerf8, SCHEMA } = require('./perf8-report.cjs');
function synthetic() {
  const report = { schemaVersion: SCHEMA, status: 'passed', source: { workingTree: '', sourceRevision: 'a'.repeat(40), sourceTree: 'b'.repeat(40) },
    protocol: { ...perf8Protocol, harnessSha256: 'c'.repeat(64) }, cells: [], validation: [] };
  for (const fixture of perf8Fixtures) for (const target of fixture.targets || ['javascript', 'native']) {
    const native = target === 'native', runtime = fixture.runtime !== false;
    const settings = { target }, artifactSha256 = 'd'.repeat(64);
    const buildMetadata = native ? { status: 'recorded', capsuleHash: 'e'.repeat(64), context: { host: 'node', target: 'native', primaryArtifactId: 'artifact:' + artifactSha256 },
      build: { version: 1, operation: 'native-build', timingScope: 'build-start-through-inventory-capture', totalDurationMs: 3, compilationDurationMs: 2,
        stages: [{ name: 'build', durationMs: 3 }], compilers: [{ durationMs: 2, flags: [], flagsComplete: false, optimization: {}, toolchain: ['synthetic'] }] } }
      : { status: 'unavailable', reason: 'Native build capsule does not apply to JavaScript source packages' };
    const buildSamples = Array.from({ length: 3 }, () => ({ settings, buildMs: 4, compilerPeakRssBytes: 10, artifactBytes: 8, artifactSha256, buildMetadata }));
    const runtimeSamples = runtime ? Array.from({ length: 3 }, () => ({ coldLoadMs: 1, firstRequestMs: 2, firstRequestCpuUserUs: 10, firstRequestCpuSystemUs: 0,
      warmRequestMs: Array(30).fill(1), warmRequestCpuUserUs: Array(30).fill(4), warmRequestCpuSystemUs: Array(30).fill(0), runtimePeakRssBytes: 20,
      memory: Object.fromEntries(['beforeLoad', 'afterLoad', 'afterFirst', 'afterWarmup', 'afterWarm'].map(name => [name, { rss: 10, heapTotal: 8, heapUsed: 4, external: 2, arrayBuffers: 1 }])) })) : [];
    const noRuntime = 'Compile-only fixture; runtime is not measured';
    const metrics = { buildMs: statistics([4, 4, 4]), compilerPeakRssBytes: statistics([10, 10, 10]), artifactBytes: statistics([8, 8, 8]),
      retainedBuildMs: statistics(Array(3).fill(native ? 3 : null), 'Native build timing not recorded for this target'),
      retainedCompilationMs: statistics(Array(3).fill(native ? 2 : null), 'Native build timing not recorded for this target'), cleanupMs: statistics([1]),
      requestCleanupMs: statistics([], runtime ? 'Mandatory request disposal is inside the provider invocation; no separate public timing hook' : noRuntime) };
    for (const name of ['coldLoadMs', 'firstRequestMs', 'warmRequestMs', 'firstRequestCpuUserUs', 'firstRequestCpuSystemUs', 'warmRequestCpuUserUs', 'warmRequestCpuSystemUs', 'runtimePeakRssBytes']) metrics[name] = statistics(runtimeSamples.flatMap(row => row[name]), noRuntime);
    report.validation.push({ fixture: fixture.id, target, status: 'passed', cases: fixture.cases.length });
    report.cells.push({ fixture: { id: fixture.id, sha256: hash(JSON.stringify(fixture)), verifiedCases: fixture.cases.length }, target: 'node-' + target,
      workload: runtime ? 'build-and-runtime' : 'compile-only', settings, artifactKind: native ? 'executable-wasm' : 'emitted-javascript-and-codecs',
      artifactSha256: buildSamples.map(row => row.artifactSha256), buildSamples, runtimeSamples, metrics,
      coldSamples: { buildMs: [4, 4, 4], coldLoadMs: runtimeSamples.map(row => row.coldLoadMs), firstRequestMs: runtimeSamples.map(row => row.firstRequestMs) },
      warmProcesses: runtimeSamples.map(row => statistics(row.warmRequestMs)) });
  }
  return report;
}
const source = synthetic(); validatePerf8(source);
assert.equal(source.cells.length, 7); assert.equal(source.validation.at(-1).cases, 64);
assert.equal(source.cells.at(-1).metrics.warmRequestMs.status, 'unavailable');
for (const mutate of [
  r => { r.status = 'interrupted'; }, r => { r.source.workingTree = 'dirty'; }, r => { r.cells.pop(); },
  r => { r.cells[1] = r.cells[0]; }, r => { r.validation.pop(); }, r => { r.validation[0].cases++; },
  r => { r.cells[0].fixture.sha256 = 'wrong'; }, r => { r.cells[0].runtimeSamples[0].warmRequestCpuUserUs.pop(); },
  r => { r.cells[0].metrics.firstRequestCpuUserUs.p50++; }, r => { r.cells[0].runtimeSamples[0].memory.afterWarm.rss = -1; },
  r => { r.cells[1].buildSamples[0].buildMetadata.build.totalDurationMs++; }, r => { r.cells[1].buildSamples[0].buildMetadata.context.primaryArtifactId = 'wrong'; },
  r => { r.cells.at(-1).runtimeSamples.push({}); }, r => { r.cells[0].buildSamples.pop(); }, r => { r.protocol.warmup = 0; },
]) { const candidate = structuredClone(source); mutate(candidate); assert.throws(() => validatePerf8(candidate)); }
assert.throws(() => compare(source, source), /Unsupported report schema/, 'v2 does not silently enter legacy comparisons');
if (process.argv[2]) validatePerf8(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
console.log('ok - PERF8-01 seven-cell coverage, raw/summary reconciliation, CPU units, memory snapshots, build metadata, compile-only and partial-report rejection');
