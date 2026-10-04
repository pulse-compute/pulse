#!/usr/bin/env node
'use strict';

const {
  assertSchemaCodecProof,
  buildSchemaCodecProof
} = require('../support/schema-codecs.cjs');

(async () => {
  await require('../support/schema-admission.cjs').assertSchemaAdmission();
  const proof = await buildSchemaCodecProof();
  await require('../support/schema-value-encoding.cjs').assertSchemaValueEncoding();
  await require('../support/schema-text-decoding.cjs').assertSchemaTextDecoding();
  await require('../support/schema-optional-properties.cjs').assertSchemaOptionalProperties();
  await require('../support/schema-scalar-records.cjs').assertSchemaScalarRecords();
  await require('../support/schema-nested-json.cjs').assertSchemaNestedJson();
  await require('../support/schema-nested-json.cjs').assertSchemaNestedJson(true);
  assertSchemaCodecProof(proof);
  console.log('ok - pulse.schema codecs preserve strict boundaries and semantic parity across targets');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
