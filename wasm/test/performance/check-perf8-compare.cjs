#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { synthetic } = require('./check-perf8.cjs');
const { comparePerf8 } = require('./perf8-compare.cjs');
const { statistics } = require('./report.cjs');
function fixture() {
  const r = structuredClone(synthetic());
  r.environment = { node: 'v24.0.0', versions: { node: '24.0.0', v8: 'test' }, executableSha256: 'a'.repeat(64), nodeOptions: '', execArgv: [],
    os: { platform: 'linux', release: 'test', arch: 'x64' }, hardware: { cpu: 'test', logicalCpus: 4, availableParallelism: 4, hostMemoryBytes: 1024, cgroupCpuMax: 'max 100000', cgroupMemoryMax: 'max' } };
  r.dependencies = { lockfileSha256: 'b'.repeat(64), installedLockfileSha256: 'b'.repeat(64), workspacePreparation: 'test',
    packages: Object.fromEntries(['typescript', 'assemblyscript', 'json-as'].map(name => [name, { version: '1', manifestSha256: 'c'.repeat(64) }])) };
  for (const c of r.cells) {
    c.settings.provider = 'node';
    for (const s of c.buildSamples) if (s.buildMetadata.status === 'recorded') {
      const m = s.buildMetadata;
      Object.assign(m.context, { profile: 'node', representation: 'canonical-native-wasm' });
      m.producer = { pulseVersion: 'test', reporterVersion: '1' };
      Object.assign(m.build, { cache: 'not-recorded', providerArtifactReuse: 'reused' });
      Object.assign(m.build.compilers[0], { phase: 'portable', compilerVersion: 'test', timeoutMs: 120000, cache: 'not-reused', flagsComplete: true,
        toolchain: [{ name: 'AssemblyScript', version: 'test' }] });
    }
  }
  return r;
}
const before = fixture(), after = fixture();
after.source.sourceRevision = 'f'.repeat(40);
after.source.sourceTree = 'e'.repeat(40);
after.cells.reverse();
let out = comparePerf8(before, after);
assert.equal(out.status, 'compared'); assert.equal(out.cells.length, 7);
assert.equal(out.cells[0].metrics.buildMs.medianDelta, 0);
assert.equal(out.cells[0].metrics.warmRequestMs.workerMedians.before.sampleCount, 3);
assert.equal(out.cells[0].metrics.warmRequestMs.before.sampleCount, 90);
assert.equal(out.cells[0].metrics.firstRequestCpuSystemUs.medianPercentChange, null);
assert.equal(out.cells.at(-1).memorySnapshots.status, 'unavailable');
assert.equal(out.cells.at(-1).metrics.warmRequestMs.status, 'unavailable');
assert.equal(out.thresholdPolicy.gate, false);
const faster = fixture(), c = faster.cells[0];
c.buildSamples.forEach((s, i) => { s.buildMs = [1, 2, 3][i]; });
c.coldSamples.buildMs = [1, 2, 3]; c.metrics.buildMs = statistics([1, 2, 3]);
out = comparePerf8(before, faster);
assert.equal(out.cells[0].metrics.buildMs.medianDelta, -2);
assert.equal(out.cells[0].metrics.buildMs.medianPercentChange, -50);
assert.equal(out.cells[0].metrics.buildMs.after.range, 2);
assert.equal(out.cells[0].metrics.buildMs.observedRangesOverlap, false);
// Unequal process medians remain visible instead of treating 90 requests as independent.
const clustered = fixture(), w = clustered.cells[0];
w.runtimeSamples.forEach((s, i) => { s.warmRequestMs = Array(30).fill([1, 2, 50][i]); });
w.warmProcesses = w.runtimeSamples.map(s => statistics(s.warmRequestMs));
w.metrics.warmRequestMs = statistics(w.runtimeSamples.flatMap(s => s.warmRequestMs));
out = comparePerf8(before, clustered);
assert.equal(out.cells[0].metrics.warmRequestMs.workerMedians.after.max, 50);
const missing = fixture(); missing.cells[0].runtimeSamples[0].runtimePeakRssBytes = null;
missing.cells[0].metrics.runtimePeakRssBytes = statistics([null, 20, 20], 'Runtime process RSS unavailable');
out = comparePerf8(before, missing);
assert.equal(out.cells[0].metrics.runtimePeakRssBytes.status, 'unavailable');
assert(!('medianDelta' in out.cells[0].metrics.runtimePeakRssBytes));
for (const mutate of [
  r => { r.environment.hardware.cpu = 'other'; }, r => { r.environment.nodeOptions = '--jitless'; },
  r => { r.dependencies.lockfileSha256 = 'd'.repeat(64); }, r => { r.protocol.harnessSha256 = 'd'.repeat(64); },
  r => { r.cells[0].settings.reporting = 'debug'; },
  r => { r.cells[1].buildSamples[0].buildMetadata.build.compilers[0].flagsComplete = false; },
  r => { r.cells[1].buildSamples[0].buildMetadata.build.compilers[0].optimization.shrinkLevel = 2; },
  r => { r.cells[1].buildSamples[0].buildMetadata.build.compilers[0].toolchain[0].version = 'other'; },
]) {
  const candidate = fixture(); mutate(candidate);
  out = comparePerf8(before, candidate); assert.equal(out.status, 'incompatible'); assert.deepEqual(out.cells, []); assert(out.reasons.length);
}
for (const mutate of [
  r => { delete r.environment; }, r => { delete r.dependencies.packages['json-as']; },
  r => { r.status = 'interrupted'; }, r => { r.cells.pop(); }, r => { r.cells[0].metrics.buildMs.p50++; },
  r => { r.environment.hardware.hostMemoryBytes = 0; }, r => { r.cells[1].buildSamples[0].buildMetadata.producer = {}; },
]) { const candidate = fixture(); mutate(candidate); assert.throws(() => comparePerf8(before, candidate)); }
assert.equal(spawnSync(process.execPath, [require.resolve('./perf8-compare.cjs')]).status, 1);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'perf8-compare-check-'));
try {
  const left = path.join(directory, 'before.json'), right = path.join(directory, 'after.json');
  fs.writeFileSync(left, JSON.stringify(before));
  const incompatible = fixture(); incompatible.environment.hardware.cpu = 'other';
  fs.writeFileSync(right, JSON.stringify(incompatible));
  let run = spawnSync(process.execPath, [require.resolve('./perf8-compare.cjs'), left, right], { encoding: 'utf8' });
  assert.equal(run.status, 2); assert.equal(JSON.parse(run.stdout).status, 'incompatible');
  fs.writeFileSync(right, '{invalid');
  run = spawnSync(process.execPath, [require.resolve('./perf8-compare.cjs'), left, right], { encoding: 'utf8' });
  assert.equal(run.status, 1); assert.equal(run.stdout, '');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
if (process.argv.length === 4) {
  const reports = process.argv.slice(2).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(comparePerf8(...reports).status, 'compared');
  const run = spawnSync(process.execPath, [require.resolve('./perf8-compare.cjs'), ...process.argv.slice(2)], { encoding: 'utf8' });
  assert.equal(run.status, 0); assert.equal(JSON.parse(run.stdout).inputSha256.before.length, 64);
}
console.log('ok - PERF8-02 compatibility, variation, worker clustering, zero/missing observations, provenance, malformed input and CLI');
