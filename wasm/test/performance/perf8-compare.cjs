#!/usr/bin/env node
'use strict';
// Offline evidence tool; deliberately separate from the measured harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isDeepStrictEqual: equal } = require('node:util');
const { validatePerf8 } = require('./perf8-report.cjs');
const { statistics, hash } = require('./report.cjs');
const text = value => typeof value === 'string' && value.length > 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function admission(report) {
  validatePerf8(report);
  const e = report.environment, d = report.dependencies;
  assert(e && d, 'Missing environment/dependency identity');
  assert(text(e.node) && e.versions && text(e.versions.node) && text(e.versions.v8) && digest(e.executableSha256));
  assert(typeof e.nodeOptions === 'string' && Array.isArray(e.execArgv) && e.execArgv.every(value => typeof value === 'string'));
  for (const key of ['platform', 'release', 'arch']) assert(text(e.os?.[key]), 'Missing OS identity');
  for (const key of ['cpu', 'cgroupCpuMax', 'cgroupMemoryMax']) assert(text(e.hardware?.[key]), 'Missing hardware identity');
  for (const key of ['logicalCpus', 'availableParallelism', 'hostMemoryBytes']) assert(Number.isSafeInteger(e.hardware[key]) && e.hardware[key] > 0);
  for (const key of ['lockfileSha256', 'installedLockfileSha256']) assert(digest(d[key]), 'Missing dependency digest');
  assert(text(d.workspacePreparation));
  for (const name of ['typescript', 'assemblyscript', 'json-as']) assert(text(d.packages?.[name]?.version) && digest(d.packages[name].manifestSha256));
  for (const cell of report.cells) {
    assert(cell.settings?.provider === 'node' && 'node-' + cell.settings.target === cell.target, 'Missing target settings');
    if (cell.target === 'node-native') for (const { buildMetadata: m } of cell.buildSamples) {
      assert(text(m.producer?.pulseVersion) && text(m.producer?.reporterVersion));
      assert(text(m.context.profile) && text(m.context.representation));
      assert(text(m.build.cache) && text(m.build.providerArtifactReuse));
      for (const c of m.build.compilers) {
        assert(text(c.phase) && text(c.compilerVersion) && text(c.cache));
        assert(Number.isSafeInteger(c.timeoutMs) && c.timeoutMs > 0);
        assert(c.toolchain.every(t => text(t.name) && text(t.version)));
        assert(c.flags.every(f => text(f.name) && (f.value === null || typeof f.value === 'string')));
      }
    }
  }
}
function buildBasis(cell) {
  return cell.buildSamples.map(({ buildMetadata: m }) => {
    if (m.status === 'unavailable') return m;
    const { primaryArtifactId, ...context } = m.context;
    const { totalDurationMs, compilationDurationMs, stages, compilers, ...build } = m.build;
    return { context, producer: m.producer, build: { ...build,
      stages: stages.map(({ durationMs, ...stage }) => stage),
      compilers: compilers.map(({ durationMs, artifactId, ...compiler }) => compiler) } };
  });
}
function summarize(summary) {
  if (summary.status !== 'measured') return { ...summary };
  return { ...summary, range: summary.max - summary.min,
    rangePercentOfMedian: summary.p50 === 0 ? null : 100 * (summary.max - summary.min) / summary.p50 };
}
function delta(before, after) {
  const result = { before: summarize(before), after: summarize(after) };
  if (before.status !== 'measured' || after.status !== 'measured') return { ...result, status: 'unavailable', reason: 'Both sides require measurements; missing values are not zero' };
  return { ...result, status: 'observed', medianDelta: after.p50 - before.p50,
    medianPercentChange: before.p50 === 0 ? null : 100 * (after.p50 / before.p50 - 1),
    observedRangesOverlap: before.min <= after.max && after.min <= before.max };
}
function metricComparison(name, before, after) {
  const result = { unit: name.endsWith('Bytes') ? 'bytes' : name.endsWith('Us') ? 'microseconds' : 'milliseconds',
    ...delta(before.metrics[name], after.metrics[name]) };
  if (name.startsWith('warmRequest') && before.runtimeSamples.length) {
    result.sampling = '30 sequential requests per worker; 3 workers, not 90 independent processes';
    result.workerMedians = delta(statistics(before.runtimeSamples.map(r => statistics(r[name]).p50)), statistics(after.runtimeSamples.map(r => statistics(r[name]).p50)));
  }
  return result;
}
function comparePerf8(before, after) {
  admission(before); admission(after);
  const reasons = [];
  for (const key of ['protocol', 'environment', 'dependencies']) if (!equal(before[key], after[key])) reasons.push('Different ' + key);
  for (const report of [before, after]) if (report.environment.hardware.cpu === 'unavailable') reasons.push('CPU identity unavailable');
  const pairs = before.cells.map(left => [left, after.cells.find(c => c.fixture.id === left.fixture.id && c.target === left.target)]);
  for (const [left, right] of pairs) {
    const id = left.fixture.id + '/' + left.target;
    for (const key of ['fixture', 'target', 'settings', 'workload', 'artifactKind']) if (!equal(left[key], right[key])) reasons.push(id + ': different ' + key);
    const l = buildBasis(left), r = buildBasis(right);
    if (!l.every(b => equal(b, l[0])) || !r.every(b => equal(b, r[0])) || !equal(l[0], r[0])) reasons.push(id + ': different effective build metadata');
    for (const cell of [left, right]) if (cell.buildSamples.some(s => s.buildMetadata.build?.compilers.some(c => !c.flagsComplete))) reasons.push(id + ': incomplete compiler flags');
  }
  const identity = report => ({ source: report.source, environment: report.environment, dependencies: report.dependencies, protocol: report.protocol });
  const output = { schemaVersion: 'pulse.performance-comparison.v2',
    status: reasons.length ? 'incompatible' : 'compared', reasons: [...new Set(reasons)],
    before: identity(before), after: identity(after),
    thresholdPolicy: { status: 'not-established', gate: false, reason: 'Small local samples do not establish regression thresholds; observed ranges are descriptive, not confidence intervals' },
    interpretation: 'Compare like-for-like cells only. Source revisions may differ; environment, dependencies, protocol, fixture and effective build settings must match. OS caches and host load are uncontrolled. No production inference or statistical significance claim.',
    cells: [] };
  if (reasons.length) return output;
  output.cells = pairs.map(([left, right]) => ({ fixture: left.fixture, target: left.target, workload: left.workload,
    artifactKind: left.artifactKind, settings: left.settings, buildBasis: buildBasis(left)[0],
    artifacts: { before: left.artifactSha256, after: right.artifactSha256,
      stableWithinBefore: new Set(left.artifactSha256).size === 1, stableWithinAfter: new Set(right.artifactSha256).size === 1,
      sameAcrossRuns: equal([...new Set(left.artifactSha256)].sort(), [...new Set(right.artifactSha256)].sort()) },
    metrics: Object.fromEntries(Object.keys(left.metrics).map(name => [name, metricComparison(name, left, right)])),
    memorySnapshots: left.runtimeSamples.length ? { status: 'observed', unit: 'bytes',
      interpretation: 'Three process snapshots at each phase; V8/host/guest combined, no forced GC, not peak or leak attribution',
      phases: Object.fromEntries(Object.keys(left.runtimeSamples[0].memory).map(phase => [phase,
        Object.fromEntries(Object.keys(left.runtimeSamples[0].memory[phase]).map(name => [name,
          delta(statistics(left.runtimeSamples.map(r => r.memory[phase][name])), statistics(right.runtimeSamples.map(r => r.memory[phase][name]))) ]))])) }
      : { status: 'unavailable', reason: 'Compile-only fixture; runtime is not measured' } }));
  return output;
}
function main(args) {
  assert.equal(args.length, 2, 'Usage: node wasm/test/performance/perf8-compare.cjs <before.json> <after.json>');
  const inputs = args.map(file => fs.readFileSync(file));
  const result = comparePerf8(...inputs.map(bytes => JSON.parse(bytes.toString('utf8'))));
  result.inputSha256 = { before: hash(inputs[0]), after: hash(inputs[1]) };
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'incompatible') process.exitCode = 2;
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { comparePerf8, admission };
