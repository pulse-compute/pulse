'use strict';
const assert = require('node:assert/strict');
function distribution(values) {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  for (const v of sorted) assert(Number.isFinite(v) && v >= 0);
  const at = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { count: sorted.length, min: sorted[0], p50: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1) };
}
function union(intervals) {
  let total = 0, end = -Infinity;
  for (const [a, b] of [...intervals].sort((a, b) => a[0] - b[0])) {
    assert(b >= a); total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b);
  }
  return total;
}
function trend(points) {
  const x0 = points[0].atMs, xs = points.map(p => (p.atMs - x0) / 60000), ys = points.map(p => p.memory.heapUsed);
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length, mx = avg(xs), my = avg(ys);
  const denominator = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return { count: points.length, heapDeltaBytes: ys.at(-1) - ys[0], heapBytesPerMinute: denominator ? xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / denominator : null };
}
function validate(report) {
  assert.equal(report.cycles, 3);
  assert.equal(report.phaseMs, 10000);
  assert.equal(report.phases.length, 12);
  for (let cycle = 0; cycle < 3; cycle++) assert.deepEqual(report.phases.slice(cycle * 4, cycle * 4 + 4).map(p => p.name), ['normal', 'contention', 'outage', 'recovery']);
  assert(report.phases.every(p => p.elapsedMs >= report.phaseMs && p.offered > 0));
  assert(report.phases.filter(p => p.name === 'outage').every(p => p.backlogEnd > 0 && p.workerFailures > 0));
  assert(report.phases.filter(p => p.name === 'recovery').every(p => p.projected > 0));
  assert.equal(report.jobs.accepted, report.jobs.projected);
  assert.equal(report.jobs.remaining, 0);
  assert(report.jobs.accepted > 0 && report.jobs.reconciled > 0);
  assert(report.host.lostAcknowledgements > 0 && report.host.outageRejections > 0);
  assert.equal(report.host.commandCommits, report.jobs.accepted);
  assert.equal(report.host.projectionCommits, report.jobs.projected);
  assert.deepEqual(report.quiet.map(p => p.label), ['baseline', 'cycle-0', 'cycle-1', 'cycle-2', 'cooldown']);
  for (const p of report.quiet) {
    assert.equal(p.activeRequests, 0); assert.equal(p.sockets, 0); assert.equal(p.pendingEffects, 0);
    assert.equal(p.records, 0); assert.equal(p.injectedWaits, 0);
    assert.deepEqual(p.resources, report.quiet[0].resources, 'quiescent resource drift');
  }
  assert.equal(report.cleanup.activeRequests, 0); assert.equal(report.cleanup.sockets, 0);
  assert.equal(report.cleanup.pendingEffects, 0); assert.equal(report.cleanup.injectedWaits, 0);
  assert(report.cpuProfile.samples > 0);
  assert.equal(report.nativeQualified, false); assert.equal(report.hostedQualified, false);
}
module.exports = { distribution, union, trend, validate };
