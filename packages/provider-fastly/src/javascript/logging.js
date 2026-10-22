'use strict';

const { normalizeFastlyLogEndpoint, MAX_LOG_BYTES } = require('../toolchain/logging.js');

const FASTLY_JAVASCRIPT_LOGGING_VERSION = 'pulse.fastly-javascript-logging.v1';

function createFastlyJavascriptLogEmitter(options = {}) {
  const endpoint = normalizeFastlyLogEndpoint(options.logEndpoint);
  const output = options.console || globalThis.console;
  const methods = Object.freeze({
    1: 'error',
    2: 'warn',
    3: 'info',
    4: 'debug'
  });
  return function fastlyJavascriptLog(level, message, event) {
    const method = methods[Number(level)] || 'log';
    const record = `[pulse][${event && event.name || method}] ${String(message)}`;
    if (endpoint !== undefined) {
      if (new TextEncoder().encode(record).byteLength > MAX_LOG_BYTES) return;
      try { new options.Logger(endpoint).log(record); } catch { /* Best effort, no fallback or retry. */ }
      return;
    }
    if (!output) return;
    const write = typeof output[method] === 'function'
      ? output[method]
      : (typeof output.log === 'function' ? output.log : undefined);
    try { if (write) write.call(output, record); } catch { /* Logging does not change the HTTP outcome. */ }
  };
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_LOGGING_VERSION,
  createFastlyJavascriptLogEmitter
});
