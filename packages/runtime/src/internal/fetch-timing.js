'use strict';
const { PulseRuntimeContractError } = require('./errors.js');

// Private provider observation record. Millisecond monotonic samples retain
// native precision; invalid/unavailable samples produce null, never wall time.
function createFetchTiming(clock) {
  const now = clock?.now ? () => clock.now() : typeof globalThis.performance?.now === 'function' ? () => globalThis.performance.now() : undefined;
  if (!now) throw new PulseRuntimeContractError('PULSE_FETCH_TIMING_UNSUPPORTED', 'This host has no monotonic fetch timing source.');
  let previous = -1, invalid = false;
  const sample = () => { try { const n = now(); if (!Number.isFinite(n) || n < previous || n < 0 || n > Number.MAX_SAFE_INTEGER) invalid = true; previous = n; return invalid ? null : n; } catch (_) { invalid = true; return null; } };
  let started = false, start, headers, body, failure;
  return Object.freeze({
    begin() { if (!started) { started = true; start = sample(); } },
    headers() { if (headers === undefined) headers = sample(); },
    body(complete = false) { if (!complete || body === undefined) body = sample(); },
    fail() { if (failure === undefined && started) failure = sample(); },
    elapsed(projection = 'response', rejected = false) {
      if (!started) {
        if (rejected) return null;
        throw new PulseRuntimeContractError('PULSE_FETCH_TIMING_UNSUPPORTED', 'The fetch provider did not observe transport timing.');
      }
      const end = rejected ? failure : projection === 'response' ? headers : body;
      if (!rejected && end === undefined) throw new PulseRuntimeContractError('PULSE_FETCH_TIMING_UNSUPPORTED', 'The fetch provider did not observe the selected transport endpoint.');
      return start !== null && end != null && end >= start && end - start <= Number.MAX_SAFE_INTEGER ? end - start : null;
    }
  });
}
module.exports = { createFetchTiming };
