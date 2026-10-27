#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('./resource-baseline/build.cjs');
const { checkPair } = require('./resource-baseline/check.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-resource-baseline-'));
try {
  let cases = 0;
  for (const width of [1, 8, 16, 32]) {
    cases += checkPair(build(directory, width), build(directory, width, true), width);
    console.log(`ok - width ${width} accounting-free ownership/observer parity`);
  }
  const observed = build(directory, 1, true);
  for (const mutation of ['cleanup', 'authentication', 'primary']) {
    const mutant = build(directory, 1, false, mutation);
    assert.throws(() => checkPair(mutant, observed, 1), assert.AssertionError);
    console.log('ok - rejects compiled mutation: ' + mutation);
  }
  console.log(`ok - ${cases} P11A ownership baseline checks; no accounting cost claim`);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
