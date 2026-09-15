'use strict';

const { PulseRuntimeContractError } = require('./errors.js');

// UTC years 1970–9999; integer milliseconds remain exactly representable.
const WALL_TIME_MAX_MS = 253402300799999;
const unavailable = Object.freeze({ status: 'failed', reason: 'unavailable' });
const invalid = Object.freeze({ status: 'failed', reason: 'invalid-clock' });

function validMilliseconds(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= WALL_TIME_MAX_MS;
}

/** The provider supplies the clock. Formatting never samples ambient time. */
function readWallTime(clock) {
  if (typeof clock !== 'function') return unavailable;
  let value;
  try { value = clock(); } catch { return unavailable; }
  if (!validMilliseconds(value)) return invalid;
  return Object.freeze({ status: 'ok', unixEpochMs: value === 0 ? 0 : value, iso8601: new Date(value).toISOString() });
}

/** Validate and detach a trusted adapter result before guest/application use. */
function normalizeTimeResult(input) {
  const fail = () => { throw new PulseRuntimeContractError('PULSE_TIME_RESULT_INVALID', 'Pulse time provider returned an invalid result.'); };
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return fail();
  const properties = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(properties);
  if (keys.some(key => typeof key !== 'string' || !Object.hasOwn(properties[key], 'value'))) return fail();
  const status = properties.status?.value;
  if (status === 'failed' && keys.length === 2 && properties.reason
    && ['unavailable', 'invalid-clock'].includes(properties.reason.value)) {
    return properties.reason.value === 'unavailable' ? unavailable : invalid;
  }
  const ms = properties.unixEpochMs?.value;
  if (status !== 'ok' || keys.length !== 3 || !validMilliseconds(ms)
    || properties.iso8601?.value !== new Date(ms).toISOString()) return fail();
  return Object.freeze({ status: 'ok', unixEpochMs: ms === 0 ? 0 : ms, iso8601: properties.iso8601.value });
}

module.exports = Object.freeze({ WALL_TIME_MAX_MS, readWallTime, normalizeTimeResult });
