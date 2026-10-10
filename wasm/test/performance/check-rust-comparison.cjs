#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validate } = require('./rust-baseline.cjs');
assert.equal(process.argv.length, 3, 'Usage: check-rust-comparison.cjs <completed-report.json>');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
validate(source);
for (const mutate of [
  r => { r.status = 'interrupted'; }, r => { r.source.workingTree = 'dirty'; },
  r => { r.cells.pop(); }, r => { r.cells[0] = r.cells[1]; },
  r => { r.validation[0].results[0].rust.response.status = 500; },
  r => { r.validation[0].results[0].rust.trace = []; },
  r => { r.validation[0].results[0].wireBodyEqual = !r.validation[0].results[0].wireBodyEqual; },
  r => { r.cells[0].buildSamples[0].artifactSha256 = 'e'.repeat(64); },
  r => { r.cells[0].metrics.buildMs.p50++; }, r => { r.cells[0].runtimeSamples[0].warmRequestMs.pop(); },
  r => { r.cells[0].runtimeSamples[0].memory.afterWarm.rss = -1; },
  r => { r.cells.at(-1).runtimeSamples.push({}); }, r => { r.comparisons[0].metrics.artifactBytes.rustMinusPulseMedian++; },
  r => { delete r.rust.rustcSha256; }, r => { r.protocol.rustTarget = 'native'; },
]) { const altered = structuredClone(source); mutate(altered); assert.throws(() => validate(altered)); }
console.log('ok - PERF8-03 behavior, identity, coverage, sample reconciliation, missing/dirty/partial evidence rejection');
