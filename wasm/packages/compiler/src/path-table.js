'use strict';

const { PACKAGE_VERSION, normalizeArtifact } = require('./diagnostics.js');
const { PATH_POLICY, compileRoutePath, publicPathPattern } = require('./path.js');
const { PATH_TABLE_VERSION } = loadContractsPathTable();

function loadContractsPathTable() {
  try {
    return require('@pulse-compute/wasm-contracts/path-table');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../contracts/src/path-table.js');
    }
    throw error;
  }
}

function buildPathTable(routePlan, options = {}) {
  const cwd = options.cwd || process.cwd();
  const routes = (routePlan.routes || []).map((route) => {
    const compiled = route.pathPattern || publicPathPattern(compileRoutePath(route.path, { allowWildcard: true }));
    return {
      stableId: route.stableId,
      runtimeId: route.runtimeId ?? route.id,
      method: route.method,
      path: route.path,
      params: route.params || [],
      pattern: compiled,
      scopedMiddleware: route.scopedMiddleware || []
    };
  });

  const scopedMiddlewareMatches = routes.reduce((sum, route) => sum + (route.scopedMiddleware || []).length, 0);
  const wildcardRoutes = routes.filter((route) => route.pattern && route.pattern.wildcard).length;
  const paramNames = new Set();
  for (const route of routes) {
    for (const param of route.params || []) paramNames.add(param);
  }

  return normalizeArtifact({
    version: PATH_TABLE_VERSION,
    generatedBy: options.generatedBy || routePlan.generatedBy || PACKAGE_VERSION,
    source: routePlan.source,
    entryRouter: routePlan.entryRouter,
    policy: PATH_POLICY,
    routes,
    summary: {
      routes: routes.length,
      wildcardRoutes,
      scopedMiddlewareMatches,
      uniqueParams: paramNames.size,
      paramNames: Array.from(paramNames).sort()
    }
  }, cwd);
}

module.exports = {
  PATH_TABLE_VERSION,
  buildPathTable
};
