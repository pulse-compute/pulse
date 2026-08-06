#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  NODE_CROSS_TARGET_PROOF_VERSION,
  buildNodeCrossTargetProof
} = require('../support/node-cross-target-conformance.cjs');

(async () => {
  const proof = await buildNodeCrossTargetProof();
  assert.equal(proof.version, NODE_CROSS_TARGET_PROOF_VERSION);
  assert.deepEqual(proof.summary, {
    total: 37,
    matched: 37,
    mismatches: 0,
    javascriptPassed: 37,
    nativePassed: 37
  });
  assert.equal(proof.negativeControls.total, 5);
  assert.equal(proof.negativeControls.rejected, 5);
  assert.ok(proof.cases.every((entry) => entry.matched));
  assert.equal(proof.targetIntegrity.automaticFallback, false);
  assert.equal(proof.availability.fullTargetSupportReady, true);
  assert.equal(proof.availability.generalAvailable, true);
  assert.equal(proof.availability.automaticFallback, false);
  assert.match(proof.proofSha256, /^[a-f0-9]{64}$/);
  console.log('ok - Node native and JavaScript targets conform across the canonical JSON corpus');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
