'use strict';

const { fail, sha256 } = require('./data');
const owned = new WeakSet();

// Failure-only metadata. Never retain source bytes, absolute paths or lease
// tokens. The first rejected comparison supplies the evidence; do not reread.
function record(identity, row, stamp) {
  if (!row) return null;
  return {
    identitySha256: sha256(String(identity)),
    bytes: row.bytes,
    sha256: row.sha256,
    ...(stamp === undefined ? {} : { stampSha256: sha256(String(stamp)) })
  };
}
function reject(code, stage, expected, actual) {
  const detail = Object.freeze({ version: 1, stage, expected, actual });
  owned.add(detail);
  fail(code, '$.identity', detail);
}
function retainedDetail(error) {
  return owned.has(error?.detail) ? { detail: error.detail } : {};
}
module.exports = { record, reject, retainedDetail };
