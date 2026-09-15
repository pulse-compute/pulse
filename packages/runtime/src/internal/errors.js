'use strict';

class PulseRuntimeContractError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PulseRuntimeContractError';
    this.code = code;
    if (options.detail !== undefined) {
      Object.defineProperty(this, 'detail', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: options.detail
      });
    }
  }
}

class PulseUnhandledError extends Error {
  constructor(cause) {
    super('Pulse contained an unexpected handler or runtime failure.', { cause });
    this.name = 'PulseUnhandledError';
    this.code = 'PULSE_RUNTIME_UNHANDLED_ERROR';
  }
}

// Data failures admitted to the Router error lane. Configuration, provider
// protocol failures and VM traps are deliberately outside this catalog.
const APPLICATION_ERROR_CODES = new Set([
  'PULSE_SCHEMA_DECODE', 'PULSE_SCHEMA_ENCODE',
  'PULSE_SCHEMA_JSON_MALFORMED', 'PULSE_SCHEMA_CONTENT_TYPE',
  'PULSE_BODY_TOO_LARGE',
  'PULSE_JWT_TOKEN_REQUIRED', 'PULSE_JWT_BEARER_INVALID',
  'PULSE_JWT_MALFORMED', 'PULSE_JWT_LIMIT_EXCEEDED',
  'PULSE_JWT_ALGORITHM_NOT_ALLOWED', 'PULSE_JWT_KEY_INVALID',
  'PULSE_JWT_SIGNATURE_INVALID', 'PULSE_JWT_CLAIMS_INVALID',
  'PULSE_JWT_CLAIMS_SCHEMA_INVALID', 'PULSE_JWT_CLOCK_INVALID'
]);

function isApplicationError(error) {
  if (!(error instanceof Error)) return false;
  const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
  if (!APPLICATION_ERROR_CODES.has(code)) return false;
  const seen = new Set();
  for (let cause = error; cause instanceof Error; cause = Object.getOwnPropertyDescriptor(cause, 'cause')?.value) {
    if (seen.has(cause)) return false;
    seen.add(cause);
    if (cause instanceof WebAssembly.RuntimeError
      || Object.getOwnPropertyDescriptor(cause, 'code')?.value === 'PULSE_CANONICAL_NATIVE_AS_ABORT'
      || Object.getOwnPropertyDescriptor(cause, 'name')?.value === 'AbortError') return false;
  }
  return true;
}

module.exports = Object.freeze({ PulseRuntimeContractError, PulseUnhandledError, isApplicationError });
