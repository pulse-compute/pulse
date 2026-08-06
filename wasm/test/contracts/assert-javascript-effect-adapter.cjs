#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  JAVASCRIPT_EFFECT_ADAPTER_PROOF_VERSION,
  buildJavascriptEffectProof
} = require('../support/javascript-effect-adapter.cjs');

(async () => {
  const proof = await buildJavascriptEffectProof();
  assert.equal(proof.version, JAVASCRIPT_EFFECT_ADAPTER_PROOF_VERSION);
  assert.deepEqual(proof.report.summary, { total: 13, passed: 13, failed: 0 });
  assert.ok(proof.report.cases.every((entry) => entry.status === 'passed'));
  assert.equal(proof.report.policy.fullTargetSupportReady, true);
  assert.equal(proof.report.policy.generalAvailable, true);
  assert.equal(proof.report.policy.automaticFallback, false);
  assert.match(proof.sha256, /^[a-f0-9]{64}$/);
  console.log('ok - JavaScript effects preserve lifecycle, grouping, failure, and bounded-observation contracts');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
