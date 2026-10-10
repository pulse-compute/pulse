#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validate } = require('./memory-baseline.cjs');
assert.equal(process.argv.length, 3, 'Provide a completed memory campaign');
const report = JSON.parse(fs.readFileSync(process.argv[2])); validate(report);
function rejects(label, edit) { const copy = structuredClone(report); edit(copy); assert.throws(() => validate(copy), label); }
rejects('incomplete', r => r.status = 'running');
rejects('dirty', r => r.source.workingTree = ' M source');
rejects('missing worker', r => r.rows.pop());
rejects('duplicate worker', r => r.rows[1] = r.rows[0]);
rejects('missing control', r => r.controls.pop());
rejects('missing checkpoint', r => r.rows[0].checkpoints.pop());
rejects('missing phase', r => r.rows[0].phases = []);
rejects('artifact mismatch', r => r.rows[0].artifactSha256 = '0'.repeat(64));
rejects('ABI mismatch', r => r.rows[0].abi.imports = []);
rejects('behavior drift', r => r.behavior[0].results[0].pulse.response.status = 500);
rejects('GC in natural run', r => r.rows[0].execArgv.push('--expose-gc'));
rejects('missing forced collection', r => r.rows.find(v => v.gcMode === 'forced').checkpoints[0].afterGc = null);
rejects('invalid memory', r => r.rows[0].checkpoints[0].beforeGc.memory.rss = -1);
rejects('impossible live count', r => r.rows[0].checkpoints[0].beforeGc.guests.liveMemories = 2);
rejects('guest capacity drift', r => r.rows[0].checkpoints[0].beforeGc.guests.perInstanceInitialBytes = []);
rejects('missing disposal', r => r.rows[0].disposalCount = 0);
rejects('missing codec calls', r => r.rows.find(v => v.scenario === 'full-small').phases = r.rows[0].phases);
rejects('fabricated summary', r => r.summaries[0].checkpoints[0].beforeGc.rss.p50++);
console.log('ok - complete memory evidence and 18 rejection cases');
