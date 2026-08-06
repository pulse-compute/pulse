'use strict';

const { executeCanonicalRouterSpine } = require('./spine/canonical-router.js');
const {
  CANONICAL_ROUTER_COMPILER_VERSION,
  CANONICAL_ROUTER_AUTHORING_VERSION,
  CANONICAL_ROUTER_EXECUTION_VERSION,
  CanonicalRouterCompileError,
  detectCanonicalRouterSource,
  routerPreludeSource
} = require('./spine/router-topology-frontend.js');

function compileCanonicalRouterSource(sourceText, options = {}) {
  return executeCanonicalRouterSpine(sourceText, options);
}

module.exports = Object.freeze({
  CANONICAL_ROUTER_COMPILER_VERSION,
  CANONICAL_ROUTER_AUTHORING_VERSION,
  CANONICAL_ROUTER_EXECUTION_VERSION,
  CanonicalRouterCompileError,
  detectCanonicalRouterSource,
  compileCanonicalRouterSource,
  routerPreludeSource
});
