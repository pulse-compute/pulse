'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const SCHEMA = 'pulse.performance-baseline.v1';
function statistics(values, unavailableReason) {
  if (!values.length || values.some(value => value === null)) return { status: 'unavailable', reason: unavailableReason, sampleCount: 0 };
  assert(values.every(value => Number.isFinite(value) && value >= 0), 'Invalid measurement');
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { status: 'measured', sampleCount: values.length, min: sorted[0], max: sorted.at(-1),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length, p50: percentile(0.5), p95: percentile(0.95) };
}
function compare(before, after) {
  for (const report of [before, after]) {
    assert.equal(report.schemaVersion, SCHEMA, 'Unsupported report schema');
    assert.equal(report.status, 'passed', 'Only terminal, validated reports can be compared');
    assert.equal(report.source.workingTree, '', 'Baseline source must be clean');
    for (const key of ['sourceRevision', 'sourceTree']) assert.match(report.source[key], /^[a-f0-9]{40}$/, `Invalid ${key}`);
    assert(report.cells.length === 6, 'Expected three fixtures on both targets');
    assert.equal(new Set(report.cells.map(cell => `${cell.fixture.id}/${cell.target}`)).size, 6, 'Duplicate cell');
    for (const cell of report.cells) {
      assert(['node-javascript', 'node-native'].includes(cell.target), 'Unknown target');
      for (const metric of Object.values(cell.metrics)) {
        assert(['measured', 'unavailable'].includes(metric.status), 'Invalid metric status');
        if (metric.status === 'unavailable') { assert(metric.reason && metric.sampleCount === 0, 'Unlabeled missing metric'); continue; }
        assert(Number.isInteger(metric.sampleCount) && metric.sampleCount > 0, 'Invalid sample count');
        for (const name of ['min', 'max', 'mean', 'p50', 'p95']) assert(Number.isFinite(metric[name]) && metric[name] >= 0, 'Invalid statistic');
        assert(metric.min <= metric.p50 && metric.p50 <= metric.p95 && metric.p95 <= metric.max, 'Invalid percentile order');
      }
    }
  }
  for (const key of ['protocol', 'environment', 'dependencies']) assert.deepEqual(after[key], before[key], `Incompatible ${key}`);
  const cells = before.cells.map(left => {
    const right = after.cells.find(cell => cell.fixture.id === left.fixture.id && cell.target === left.target);
    assert(right, `Missing target/fixture: ${left.fixture.id}/${left.target}`);
    assert.deepEqual(Object.keys(right.metrics).sort(), Object.keys(left.metrics).sort(), 'Metric set differs');
    for (const key of ['fixture', 'settings', 'artifactKind']) assert.deepEqual(right[key], left[key], `Incompatible ${left.fixture.id}/${left.target} ${key}`);
    const metrics = Object.fromEntries(Object.entries(left.metrics).map(([name, baseline]) => {
      const candidate = right.metrics[name];
      assert(candidate, `Missing metric ${name}`);
      assert.equal(candidate.status, baseline.status, `Incompatible metric availability: ${name}`);
      if (baseline.status !== 'measured') { assert.equal(candidate.reason, baseline.reason, `Incompatible missing metric: ${name}`); return [name, { status: 'unavailable', reason: baseline.reason }]; }
      assert.equal(candidate.sampleCount, baseline.sampleCount, `Incompatible sample count: ${name}`);
      return [name, { beforeP50: baseline.p50, afterP50: candidate.p50,
        percentChange: baseline.p50 === 0 ? null : 100 * (candidate.p50 / baseline.p50 - 1) }];
    }));
    return { fixture: left.fixture.id, target: left.target, metrics };
  });
  return { schemaVersion: 'pulse.performance-comparison.v1', beforeSource: before.source, afterSource: after.source,
    interpretation: 'Descriptive medians; small local samples, no significance or performance gate.', cells };
}
module.exports = { SCHEMA, hash, statistics, compare };
