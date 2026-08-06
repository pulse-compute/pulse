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

module.exports = Object.freeze({ PulseRuntimeContractError, PulseUnhandledError });
