'use strict';
const { createPackageRuntime } = require('@pulse-compute/runtime/package');
const { S3_PACKAGE, S3_CONTRACT_ID, S3_OPERATIONS } = require('@pulse-compute/wasm-contracts/s3/contracts');
const { normalizeResult, normalizePutOptions } = require('./provider.js');
const runtime = createPackageRuntime({ package: S3_PACKAGE, contractId: S3_CONTRACT_ID, providerKind: 's3', operations: S3_OPERATIONS });
exports.s3 = Object.freeze({
  head(ctx, binding, key) { return runtime.effect(ctx, 'head', { binding, key }, (result) => normalizeResult('head', result)); },
  getText(ctx, binding, key) { return runtime.effect(ctx, 'getText', { binding, key }, (result) => normalizeResult('getText', result)); },
  putText(ctx, binding, key, text, options) { return runtime.effect(ctx, 'putText', { binding, key, text, ...normalizePutOptions(options) }, (result) => normalizeResult('putText', result)); }
});
