'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validate } = require('./gc-baseline.cjs');
const report = JSON.parse(fs.readFileSync(process.argv[2])); validate(report);
const changes = [
  r => { r.status = 'running'; },
  r => { r.source.workingTree = ' M source'; },
  r => { r.guests.pop(); },
  r => { r.guests[0].rows.pop(); },
  r => { r.guests[0].rows[0].sha256 = '0'.repeat(64); },
  r => { r.guests[0].rows.find(r => r.mode === 'trace').capacityBytes++; },
  r => { r.guests[0].rows.find(r => r.mode === 'trace').events.find(e => e.phase === 'released-table-GC' && e.kind === 'cycle').managed = 100000000; },
  r => { r.hosts.pop(); },
  r => { r.hosts[0].status = 'running'; },
  r => { r.hosts[0].gcEvents = []; },
  r => { r.hosts[0].artifactSha256 = '0'.repeat(64); },
  r => { r.hosts[0].checkpoints.pop(); },
];
for (const change of changes) { const copy = structuredClone(report); change(copy); assert.throws(() => validate(copy)); }
console.log('ok - GC report and ' + changes.length + ' rejection cases');
