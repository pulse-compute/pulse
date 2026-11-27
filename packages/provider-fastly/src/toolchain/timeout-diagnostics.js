'use strict';

function normalizeTimeoutDiagnostics(value, maxDurationMs) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new TypeError('fastly.timeoutDiagnostics must be a boolean.');
  if (value && require('@pulse-compute/runtime/host').normalizeRequestDuration(maxDurationMs) === undefined) {
    throw new TypeError('fastly.timeoutDiagnostics requires maxDurationMs.');
  }
  return value;
}

module.exports = {normalizeTimeoutDiagnostics};
