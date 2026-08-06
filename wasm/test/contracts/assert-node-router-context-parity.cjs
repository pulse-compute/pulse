#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  runNodeRouterContextParity
} = require('../support/node-router-context-parity.cjs');

(async () => {
  const result = await runNodeRouterContextParity();
  assert.equal(result.version, 'pulse.node-router-context-parity.v1');
  assert.deepEqual(result.projectTests.native.summary, { total: 12, passed: 12, failed: 0 });
  assert.deepEqual(result.projectTests.javascript.summary, result.projectTests.native.summary);
  assert.deepEqual(
    { status: result.parity.status, total: result.parity.total, matched: result.parity.matched, mismatches: result.parity.mismatches },
    { status: 'passed', total: 12, matched: 12, mismatches: 0 }
  );
  assert.ok(result.parity.cases.every((entry) => entry.equal));
  assert.equal(result.targets.native.automaticFallback, false);
  assert.equal(result.targets.javascript.automaticFallback, false);
  console.log('ok - native and JavaScript Node Router/context behavior matches at the HTTP boundary');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
