'use strict';

function loadGraphContract() {
  try {
    return require('@pulse-compute/wasm-contracts/project/reachable-graph');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/project/reachable-graph.js');
    }
    throw error;
  }
}

const graph = loadGraphContract();

const COMPILER_REACHABLE_GRAPH_CONTRACT_VERSION = 'pulse.compiler-reachable-graph-contract.v1';

function compilerReachableGraphContract() {
  const implementation = graph.defaultReachableGraphImplementationContract();
  const resolver = graph.defaultModuleResolverContract();
  return Object.freeze({
    version: COMPILER_REACHABLE_GRAPH_CONTRACT_VERSION,
    manifestVersion: implementation.manifestVersion,
    identityVersion: implementation.identityVersion,
    resolverVersion: implementation.resolverVersion,
    handlerReferenceVersion: implementation.handlerReferenceVersion,
    authorities: Object.freeze({
      resolverRules: '@pulse-compute/wasm-contracts/project/reachable-graph',
      stableIdentity: '@pulse-compute/wasm-contracts/project/reachable-graph',
      manifestSchema: '@pulse-compute/wasm-contracts/project/reachable-graph',
      handlerSemantics: 'canonical Handler IR',
      packageLowering: 'canonical package-operation seam'
    }),
    implementation: Object.freeze({
      resolverRulesLocked: true,
      manifestSchemaLocked: true,
      deterministicIdentityLocked: true,
      recursiveWalkerImplemented: false,
      importedHandlerCompilationImplemented: false,
      packageReachabilityImplemented: false,
      lifecycleReachabilityImplemented: false,
      eligibilityProjectionImplemented: false,
      cacheImplemented: false,
      bundlerImplemented: false
    }),
    resolverPolicies: resolver.policies,
    consumers: implementation.consumers
  });
}

module.exports = Object.freeze({
  COMPILER_REACHABLE_GRAPH_CONTRACT_VERSION,
  compilerReachableGraphContract
});
