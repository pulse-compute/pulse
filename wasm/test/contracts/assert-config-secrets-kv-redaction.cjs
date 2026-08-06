#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  BINDINGS_REDACTION_PROOF_VERSION,
  buildBindingsRedactionProof
} = require('../support/config-secrets-kv-redaction.cjs');

(async () => {
  const proof = await buildBindingsRedactionProof();
  assert.equal(proof.version, BINDINGS_REDACTION_PROOF_VERSION);
  assert.deepEqual(proof.report.summary, { total: 10, passed: 10, failed: 0 });
  assert.ok(proof.report.cases.every((entry) => entry.status === 'passed'));
  assert.equal(proof.report.contract.ambientFallback, false);
  assert.equal(proof.report.contract.javascriptAndNativeLoweringAligned, true);
  assert.equal(JSON.stringify(proof).includes('native-redaction-secret'), false);
  assert.match(proof.sha256, /^[a-f0-9]{64}$/);
  console.log('ok - config, secrets, and KV bindings preserve isolation and redaction contracts');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
