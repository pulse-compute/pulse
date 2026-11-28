'use strict';
const assert = require('node:assert/strict');
const { distribution, union, trend, validate } = require('./metrics.cjs');
assert.equal(union([[0, 10], [2, 5], [8, 15], [20, 25]]), 20);
assert.equal(union([]), 0);
assert.throws(() => union([[3, 2]]));
assert.equal(distribution([10, 1, 3, 2]).p50, 2);
assert.equal(distribution([10, 1, 3, 2]).p99, 10);
assert.equal(distribution([]).count, 0);
assert.throws(() => distribution([NaN]));
assert.equal(trend([{ atMs: 0, memory: { heapUsed: 10 } }, { atMs: 60000, memory: { heapUsed: 30 } }]).heapBytesPerMinute, 20);
const clean = { activeRequests: 0, sockets: 0, pendingEffects: 0, records: 0, injectedWaits: 0, resources: { PipeWrap: 1 } };
const report = { cycles: 3, phaseMs: 10000,
  phases: Array.from({ length: 3 }, () => ['normal', 'contention', 'outage', 'recovery'].map(name => ({ name, elapsedMs: 10000, offered: 1, backlogEnd: name === 'outage' ? 1 : 0, workerFailures: name === 'outage' ? 1 : 0, projected: 1 }))).flat(),
  jobs: { accepted: 1, projected: 1, remaining: 0, reconciled: 1 },
  host: { lostAcknowledgements: 1, outageRejections: 1, commandCommits: 1, projectionCommits: 1 },
  quiet: ['baseline', 'cycle-0', 'cycle-1', 'cycle-2', 'cooldown'].map(label=>({label,...structuredClone(clean)})), cleanup: clean, cpuProfile: { samples: 1 }, nativeQualified: false, hostedQualified: false };
validate(report);
for (const corrupt of [
  r => r.quiet.pop(), r => r.phases.pop(), r => r.phases[2].workerFailures = 0, r => r.jobs.projected = 0,
  r => r.host.commandCommits++, r => r.host.projectionCommits++, r => r.host.lostAcknowledgements = 0,
  r => r.quiet[1].pendingEffects++, r => r.quiet[1].records++, r => r.quiet[1].resources.Timeout = 1,
  r => r.cleanup.sockets++, r => r.nativeQualified = true
]) { const bad = structuredClone(report); corrupt(bad); assert.throws(() => validate(bad)); }
console.log('STAB-04 attribution and evidence rejection controls passed');
