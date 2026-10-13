'use strict';

const MAX_BODY_BYTES = 1048576;
function forwardingError(message) {
  const error = new TypeError(message);
  error.code = 'PULSE_FASTLY_BODY_FORWARDING_INVALID';
  return error;
}
function normalizeBodyForwarding(value, maxDurationMs) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['requestMaxBytes', 'responseMaxBytes'].includes(key))) {
    throw forwardingError('fastly.bodyForwarding requires requestMaxBytes and responseMaxBytes.');
  }
  for (const key of ['requestMaxBytes', 'responseMaxBytes']) {
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > MAX_BODY_BYTES) {
      throw forwardingError(`fastly.bodyForwarding.${key} must be an integer from 1 to ${MAX_BODY_BYTES}.`);
    }
  }
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 30000) {
    throw forwardingError('fastly.bodyForwarding requires maxDurationMs from 1 to 30000.');
  }
  return Object.freeze({requestMaxBytes: value.requestMaxBytes, responseMaxBytes: value.responseMaxBytes});
}
module.exports = {normalizeBodyForwarding, forwardingError, MAX_BODY_BYTES};
