'use strict';

const {
  compilerReachableGraphContract
} = require('./reachable-graph-contract.js');

const COMPILER_REACHABLE_GRAPH_IMPLEMENTATION_VERSION = 'pulse.compiler-reachable-graph-contract.v3';

function compilerReachableGraphImplementationContract() {
  const legacy = compilerReachableGraphContract();
  return Object.freeze({
    ...legacy,
    version: COMPILER_REACHABLE_GRAPH_IMPLEMENTATION_VERSION,
    implementation: Object.freeze({
      ...legacy.implementation,
      recursiveWalkerImplemented: true,
      importedHandlerCompilationImplemented: true,
      importedRouterCompilationImplemented: true,
      sourceOwnershipImplemented: true,
      runtimeCycleDiagnosticsImplemented: true,
      unsupportedBoundaryDiagnosticsImplemented: true,
      packageReachabilityImplemented: true,
      packageBindingOwnershipImplemented: true,
      packageReExportOwnershipImplemented: true,
      lifecycleReachabilityImplemented: true,
      eligibilityProjectionImplemented: true,
      cacheImplemented: false,
      bundlerImplemented: false
    })
  });
}

module.exports = Object.freeze({
  COMPILER_REACHABLE_GRAPH_IMPLEMENTATION_VERSION,
  compilerReachableGraphImplementationContract
});
