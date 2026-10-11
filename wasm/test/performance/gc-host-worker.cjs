'use strict';
// Additional telemetry only; reuse PERF8-04 request execution and GC scheduling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const v8 = require('node:v8');
const { PerformanceObserver, performance } = require('node:perf_hooks');
const [directory, scenario, gcMode, receipt] = process.argv.slice(2);
const events = [];
const watch = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) events.push({ startMs: entry.startTime, durationMs: entry.duration, kind: entry.detail.kind, flags: entry.detail.flags });
});
watch.observe({ entryTypes: ['gc'] });
const original = process.memoryUsage;
process.memoryUsage = function() {
  return { ...original(), sampleMs: performance.now(), heap: v8.getHeapStatistics(), spaces: v8.getHeapSpaceStatistics() };
};
require('./memory-worker.cjs').run(directory, scenario, gcMode).then(async result => {
  // Deliver GC entries queued by the final checkpoint; this is not a timing run.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  result.gcEvents = events;
  result.telemetry = 'V8 performance GC entries and heap/space statistics; existing request lifecycle, census and collection schedule';
  assert.equal(result.status, 'passed');
  fs.writeFileSync(receipt, JSON.stringify(result) + '\n');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { watch.disconnect(); process.memoryUsage = original; });
