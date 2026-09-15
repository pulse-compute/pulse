'use strict';
const { createPackageRuntime } = require('@pulse-compute/runtime/package');
const { S3_PACKAGE, S3_CONTRACT_ID, S3_OPERATIONS, S3_LIMITS } = require('@pulse-compute/wasm-contracts/s3/contracts');
const { normalizeResult, normalizePutOptions } = require('./provider.js');
const runtime = createPackageRuntime({ package: S3_PACKAGE, contractId: S3_CONTRACT_ID, providerKind: 's3', operations: S3_OPERATIONS });
exports.s3 = Object.freeze({
  head(ctx, binding, key) { return runtime.effect(ctx, 'head', { binding, key }, (result) => normalizeResult('head', result)); },
  getText(ctx, binding, key) { return runtime.effect(ctx, 'getText', { binding, key }, (result) => normalizeResult('getText', result)); },
  putText(ctx, binding, key, text, options) {
    // Retain an over-limit sentinel without copying an unbounded string into
    // the effect envelope. Providers reject it before encoding or dispatch.
    const boundedText = typeof text === 'string' ? text.slice(0, S3_LIMITS.textBytes + 1) : null;
    return runtime.effect(ctx, 'putText', { binding, key, text: boundedText, ...normalizePutOptions(options) }, (result) => normalizeResult('putText', result));
  }
});
