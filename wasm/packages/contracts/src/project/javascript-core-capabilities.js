'use strict';

const JAVASCRIPT_CORE_CAPABILITIES = Object.freeze([
  'error',
  'lifecycle',
  'params',
  'req.header',
  'req.headers',
  'req.method',
  'req.path',
  'req.text',
  'req.url',
  'request.header',
  'request.header.at',
  'request.header.count',
  'request.header.first',
  'request.headers',
  'request.method',
  'request.path',
  'request.text',
  'request.url',
  'response.custom',
  'response.header.append',
  'response.header.delete',
  'response.header.set',
  'response.json',
  'response.response',
  'response.text',
  'route.param',
  'state',
  'state.get',
  'state.set'
]);

const javascriptCoreCapabilitySet = new Set(JAVASCRIPT_CORE_CAPABILITIES);

function isJavascriptCoreCapability(value) {
  return javascriptCoreCapabilitySet.has(String(value));
}

module.exports = Object.freeze({
  JAVASCRIPT_CORE_CAPABILITIES,
  isJavascriptCoreCapability
});
