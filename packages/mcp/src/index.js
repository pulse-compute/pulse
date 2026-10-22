'use strict';
const { createProtocolHandler, PROTOCOL_VERSION, DEFAULT_LIMITS } = require('./protocol.js');
function createMcpHttpHandler(options = {}) { return createProtocolHandler(options); }
module.exports = { createMcpHttpHandler, PROTOCOL_VERSION, DEFAULT_LIMITS };
