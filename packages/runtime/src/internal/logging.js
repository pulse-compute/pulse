'use strict';

// Portable mirror of @pulse-compute/wasm-contracts/logging. The authoring
// runtime intentionally has no dependency on compiler packages.
const REPORTING_LEVELS = Object.freeze({ off: 0, error: 1, warn: 2, info: 3, debug: 4 });
const LOG_METHODS = Object.freeze(['error', 'warn', 'info', 'debug']);
const DEFAULT_REPORTING_LEVEL = 'info';

function reportingLevel(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 4) return value;
  const name = value === undefined || value === null
    ? DEFAULT_REPORTING_LEVEL
    : String(value).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(REPORTING_LEVELS, name)) {
    throw new TypeError('Pulse reporting must be off, error, warn, info, or debug.');
  }
  return REPORTING_LEVELS[name];
}

function createPulseLogger(options = {}) {
  const threshold = reportingLevel(options.reporting);
  const redact = typeof options.redact === 'function' ? options.redact : String;
  const emit = typeof options.emit === 'function' ? options.emit : undefined;
  const observe = typeof options.observe === 'function' ? options.observe : undefined;
  const target = options.target == null ? null : String(options.target);
  const provider = options.provider == null ? null : String(options.provider);
  const logger = {};

  for (const name of LOG_METHODS) {
    const level = REPORTING_LEVELS[name];
    logger[name] = (message) => {
      if (typeof message !== 'string') throw new TypeError(`ctx.log.${name} requires one string message.`);
      if (level > threshold) return;
      let safeMessage;
      try { safeMessage = String(redact(message)); }
      catch (_) { safeMessage = '<redacted>'; }
      const event = Object.freeze({
        version: 'pulse.log-event.v1',
        type: 'log',
        level,
        name,
        message: safeMessage,
        target,
        provider
      });
      if (observe) {
        try { observe(event); }
        catch (_) { /* Logging evidence is best effort. */ }
      }
      if (emit) {
        try { emit(level, safeMessage, event); }
        catch (_) { /* Provider logging failures never fail the request. */ }
      }
    };
  }
  return Object.freeze(logger);
}

module.exports = Object.freeze({
  REPORTING_LEVELS,
  LOG_METHODS,
  DEFAULT_REPORTING_LEVEL,
  reportingLevel,
  createPulseLogger
});
