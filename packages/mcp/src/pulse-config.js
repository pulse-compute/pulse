'use strict';
const { configuration } = require('./protocol.js');
const LIMITS = Object.freeze({ maxRequestBytes: 32768, maxResponseBytes: 131072, maxDepth: 32, deadlineMs: 5000 });
function pulseConfiguration(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype
    || Object.keys(options).some(key => !['path', 'serverInfo', 'legacyProtocol', 'limits', 'allowedOrigins'].includes(key))) throw new TypeError('MCP binding requires static protocol options only');
  if (options.allowedOrigins !== undefined && (!Array.isArray(options.allowedOrigins) || options.allowedOrigins.length)) throw new TypeError('Native MCP v1 rejects every supplied Origin');
  if (options.limits && Object.keys(options.limits).some(key => !Object.hasOwn(LIMITS, key))) throw new TypeError('Unknown MCP limit');
  const limits = { ...LIMITS, ...options.limits };
  for (const key of Object.keys(LIMITS)) if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > LIMITS[key]) throw new TypeError('Invalid MCP binding limit');
  const config = configuration({ ...options, limits });
  return { path: config.path, serverInfo: config.info, limits, allowedOrigins: [], ...(config.legacyProtocol ? { legacyProtocol: config.legacyProtocol } : {}) };
}
module.exports = { pulseConfiguration, LIMITS, MAX_TOOL_RESULT_BYTES: 24576 };
