'use strict';

const S3_CONTRACT_ID = 'pulse.s3';
const S3_PACKAGE = '@pulse-compute/s3';
const S3_LOWERING_PLAN_VERSION = 'pulse.s3-lowering-plan.v1';
const S3_LIMITS = Object.freeze({ keyBytes: 1024, textBytes: 2097152, defaultTextBytes: 32768, metadataBytes: 1024, headerBytes: 16384, envelopeBytes: 12648448 });
const S3_OPERATIONS = Object.freeze(Object.fromEntries(['head', 'getText', 'putText'].map((name) => [name, Object.freeze({
  kind: `s3.${name}`, capability: `s3.${name}`, result: name === 'head' ? 's3-head-result' : name === 'getText' ? 's3-get-text-result' : 's3-put-text-result'
})])));
const S3_PROVIDER_REQUIREMENTS = Object.freeze(['s3.head', 's3.getText', 's3.putText', 'secret.get', 'time.wall-clock']);
const S3_CRYPTO_ALGORITHMS = Object.freeze(['SHA-256', 'HMAC-SHA256']);
module.exports = Object.freeze({ S3_CONTRACT_ID, S3_PACKAGE, S3_LOWERING_PLAN_VERSION, S3_LIMITS, S3_OPERATIONS, S3_PROVIDER_REQUIREMENTS, S3_CRYPTO_ALGORITHMS });
