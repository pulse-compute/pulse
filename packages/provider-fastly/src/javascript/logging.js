'use strict';

const FASTLY_JAVASCRIPT_LOGGING_VERSION = 'pulse.fastly-javascript-logging.v1';

function createFastlyJavascriptLogEmitter(options = {}) {
  const output = options.console || globalThis.console;
  const methods = Object.freeze({
    1: 'error',
    2: 'warn',
    3: 'info',
    4: 'debug'
  });
  return function fastlyJavascriptLog(level, message, event) {
    if (!output) return;
    const method = methods[Number(level)] || 'log';
    const write = typeof output[method] === 'function'
      ? output[method]
      : (typeof output.log === 'function' ? output.log : undefined);
    if (write) write.call(output, `[pulse][${event && event.name || method}] ${String(message)}`);
  };
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_LOGGING_VERSION,
  createFastlyJavascriptLogEmitter
});
