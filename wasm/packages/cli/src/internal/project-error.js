'use strict';

class PulseProjectError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PulseProjectError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

module.exports = { PulseProjectError };
