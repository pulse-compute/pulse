#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  SCHEMA_CODEC_PROOF_VERSION,
  buildSchemaCodecProof
} = require('../support/schema-codecs.cjs');

(async () => {
  const proof = await buildSchemaCodecProof();
  assert.equal(proof.version, SCHEMA_CODEC_PROOF_VERSION);
  assert.equal(proof.authority.registry, 'pulse.schema');
  assert.equal(proof.authority.fullCodecRealization, true);
  assert.equal(proof.parity.responseSemanticEqual, true);
  assert.equal(proof.parity.outboundSemanticEqual, true);
  assert.equal(proof.parity.tracesEqualIgnoringTargetIdentity, true);
  assert.equal(proof.native.jsonAs.version, '1.5.0');
  assert.equal(proof.native.jsonAs.strict, true);
  assert.deepEqual(proof.packaging.emitted, ['schema-json-registry.json', 'schema-json-codecs.cjs']);
  assert.equal(proof.availability.generalAvailable, true);
  assert.equal(proof.availability.fullTargetSupportReady, true);
  assert.equal(proof.availability.automaticFallback, false);
  assert.match(proof.proofSha256, /^[a-f0-9]{64}$/);
  console.log('ok - pulse.schema codecs preserve strict boundaries and semantic parity across targets');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
