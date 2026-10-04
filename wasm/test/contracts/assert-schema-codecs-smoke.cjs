#!/usr/bin/env node
'use strict';

const { buildSchemaCodecProof, assertSchemaCodecProof } = require('../support/schema-codecs.cjs');

(async () => {
  assertSchemaCodecProof(await buildSchemaCodecProof());
  console.log('ok - schema smoke: one Native compile, strict boundaries, cross-target parity and packaging');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
