'use strict';

const S3_CONTRACT_ID = 'pulse.s3';
const S3_PACKAGE = '@pulse-compute/s3';
const S3_LOWERING_PLAN_VERSION = 'pulse.s3-lowering-plan.v1';
const S3_LIMITS = Object.freeze({ keyBytes: 1024, tokenBytes: 4096, listKeys: 1000, listBytes: 2097152, textBytes: 2097152, defaultTextBytes: 32768, metadataBytes: 1024, headerBytes: 16384, envelopeBytes: 12648448 });
const S3_OPERATIONS = Object.freeze(Object.fromEntries(['head', 'getText', 'putText', 'getBody', 'list', 'delete'].map((name) => [name, Object.freeze({
  kind: `s3.${name}`, capability: `s3.${name}`, result: name === 'list' ? 's3-list-result' : name === 'delete' ? 's3-delete-result' : name === 'getBody' ? 'opaque-response' : name === 'head' ? 's3-head-result' : name === 'getText' ? 's3-get-text-result' : 's3-put-text-result'
})])));
const S3_PROVIDER_REQUIREMENTS = Object.freeze(['s3.head', 's3.getText', 's3.putText', 's3.getBody', 's3.list', 's3.delete', 'secret.get', 'time.wall-clock']);
const S3_CRYPTO_ALGORITHMS = Object.freeze(['SHA-256', 'HMAC-SHA256']);
module.exports = Object.freeze({ S3_CONTRACT_ID, S3_PACKAGE, S3_LOWERING_PLAN_VERSION, S3_LIMITS, S3_OPERATIONS, S3_PROVIDER_REQUIREMENTS, S3_CRYPTO_ALGORITHMS });
