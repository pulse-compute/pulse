#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  FETCH_BODY_PROOF_VERSION,
  buildFetchBodyProof
} = require('../support/fetch-projections-request-bodies.cjs');

(async () => {
  const proof = await buildFetchBodyProof();
  assert.equal(proof.version, FETCH_BODY_PROOF_VERSION);
  assert.deepEqual(proof.report.summary, { total: 12, passed: 12, failed: 0 });
  assert.ok(proof.report.cases.every((entry) => entry.status === 'passed'));
  assert.equal(proof.report.contract.javascriptAndNativeModesExplicit, true);
  assert.equal(proof.report.policy.generalAvailable, true);
  assert.equal(proof.report.policy.automaticFallback, false);
  assert.match(proof.sha256, /^[a-f0-9]{64}$/);
  console.log('ok - fetch projections and request bodies preserve bounded ownership across targets');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
