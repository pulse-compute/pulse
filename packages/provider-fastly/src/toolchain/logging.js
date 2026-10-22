'use strict';

const MAX_LOG_BYTES = 65536;

function normalizeFastlyLogEndpoint(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 255 || value.trim() !== value
      || new TextEncoder().encode(value).byteLength > 255 || /[\u0000-\u001f\u007f]/u.test(value)
      || /[\ud800-\udfff]/u.test(value.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))
      || /^(?:stdout$|stderr$|fst_managed_)/i.test(value)) {
    const error = new TypeError('Fastly logEndpoint must be a non-reserved endpoint name of 1–255 UTF-8 bytes without control characters or surrounding whitespace.');
    error.code = 'PULSE_FASTLY_LOG_ENDPOINT_INVALID';
    throw error;
  }
  return value;
}

module.exports = { normalizeFastlyLogEndpoint, MAX_LOG_BYTES };
