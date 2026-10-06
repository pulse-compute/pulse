'use strict';
const assert = require('node:assert/strict');
const { SCHEMA, statistics, compare } = require('./report.cjs');
const { fixtures } = require('./fixtures.cjs');
const report = () => ({ schemaVersion: SCHEMA, status: 'passed', source: { workingTree: '', sourceRevision: 'a'.repeat(40), sourceTree: 'b'.repeat(40) },
  protocol: { serial: true }, dependencies: { lockfileSha256: 'locked' }, environment: { cpu: 'same' },
  cells: fixtures.flatMap(fixture => ['node-javascript', 'node-native'].map(target => ({ fixture: { id: fixture.id, sha256: fixture.id },
    target, settings: { optimization: target }, artifactKind: target, metrics: { buildMs: statistics([1, 2, 5]), missing: statistics([], 'not supported') } }))) });
assert.deepEqual(statistics([9, 1, 2]).p50, 2);
assert.equal(statistics([9, 1, 2]).p95, 9);
assert.equal(statistics([null], 'not supported').status, 'unavailable');
assert.throws(() => statistics([NaN]), /Invalid/);
const before = report(), after = report();
after.source.sourceTree = 'c'.repeat(40); after.cells.reverse();
assert.equal(compare(before, after).cells.length, 6, 'Source may change and cells are paired by fixture/target');
after.cells.find(cell => cell.fixture.id === 'minimal-request' && cell.target === 'node-native').metrics.buildMs = statistics([2, 4, 10]);
assert.equal(compare(before, after).cells.find(cell => cell.target === 'node-native').metrics.buildMs.percentChange, 100);
for (const mutate of [
  r => { r.status = 'failed'; }, r => { r.source.workingTree = 'dirty'; }, r => { r.schemaVersion = 'unknown'; },
  r => { r.dependencies.lockfileSha256 = 'different'; }, r => { r.environment.cpu = 'different'; },
  r => { r.protocol.serial = false; }, r => { r.cells.pop(); },
  r => { r.cells[0].target = 'node-native'; }, r => { r.cells[0].fixture.sha256 = 'changed'; },
  r => { r.cells[0].settings.optimization = 'changed'; }, r => { r.cells[0].artifactKind = 'changed'; },
  r => { r.cells[0].metrics.buildMs = statistics([1]); },
  r => { r.cells[0].metrics.buildMs = statistics([], 'not supported'); },
  r => { r.cells[0].metrics.buildMs.p50 = NaN; }, r => { r.cells[0].metrics.missing.reason = ''; },
  r => { r.cells[0].metrics.extra = statistics([1]); },
]) { const candidate = report(); mutate(candidate); assert.throws(() => compare(before, candidate)); }
console.log('ok - report comparison rejects mixed targets, settings, inputs, environments and incomplete evidence');
