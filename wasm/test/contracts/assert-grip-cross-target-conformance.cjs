#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  GRIP_CONFORMANCE_PROOF_VERSION,
  buildGripConformanceProof
} = require('../support/grip-cross-target-conformance.cjs');
const {
  cleanupWorkspacePackageBuilds
} = require('../support/workspace-package-build.cjs');

(async () => {
  const proof = await buildGripConformanceProof();
  assert.equal(proof.version, GRIP_CONFORMANCE_PROOF_VERSION);
  assert.deepEqual(proof.summary, {
    total: 35,
    matched: 35,
    mismatches: 0,
    negativeControlsRejected: 5
  });
  assert.equal(proof.negativeControls.length, 5);
  assert.ok(proof.cases.every((entry) => entry.matched));
  assert.deepEqual(proof.availability.gates, { total: 12, satisfied: 12, pending: 0, blocked: 0 });
  assert.equal(proof.availability.fullTargetSupportReady, true);
  assert.equal(proof.availability.generalAvailable, true);
  assert.equal(proof.availability.automaticFallback, false);
  assert.equal(JSON.stringify(proof).includes('5d-secret-do-not-leak'), false);
  console.log('ok - GRIP framing and broadcast behavior conforms across Node and Fastly targets');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(cleanupWorkspacePackageBuilds);
