'use strict';

const path = require('node:path');
const {
  buildReachableProjectGraph,
  ReachableProjectGraphError
} = require('./project/reachable-graph-builder.js');
const {
  JAVASCRIPT_APPLICATION_PLAN_VERSION,
  normalizeJavascriptApplicationPlan
} = require('@pulse-compute/wasm-contracts/project/javascript-application');

const JAVASCRIPT_APPLICATION_PLANNER_VERSION = 'pulse.javascript-application-planner.v1';
const CORE_APPLICATION_PACKAGES = new Set(['@pulse-compute/runtime', '@pulse-compute/pulse']);

class JavascriptApplicationPlanError extends Error {
  constructor(code, message, detail = {}, diagnostics = []) {
    super(message);
    this.name = 'JavascriptApplicationPlanError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

function moduleSources(graph, moduleId) {
  return Object.freeze(graph.edges
    .filter((edge) => edge.runtime && edge.to === moduleId && edge.source)
    .map((edge) => edge.source)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column));
}

function packageStatus(module, graphBuild) {
  if (CORE_APPLICATION_PACKAGES.has(module.packageName)) {
    return Object.freeze({ status: 'supplied-core', runtimeEntry: module.packageName, reasonCode: null });
  }
  const product = graphBuild.packageProduct && graphBuild.packageProduct.contracts
    .find((entry) => entry.packageName === module.packageName);
  if (product) {
    const target = product.javascriptTarget;
    // Source loadability is separate from selected-provider eligibility. The
    // target-support owner checks provider-dependent requirements before build.
    if (target && ['supported', 'provider-dependent'].includes(target.status)
      && target.realization === 'javascript-package-runtime' && target.entry) {
      return Object.freeze({ status: 'package-runtime', runtimeEntry: target.entry, reasonCode: null });
    }
    return Object.freeze({
      status: 'unavailable',
      runtimeEntry: null,
      reasonCode: target && target.reasonCode || 'PULSE_JAVASCRIPT_PACKAGE_REALIZATION_UNAVAILABLE'
    });
  }
  if (module.packageContract) {
    return Object.freeze({
      status: 'unavailable',
      runtimeEntry: null,
      reasonCode: 'PULSE_JAVASCRIPT_PACKAGE_REALIZATION_UNAVAILABLE'
    });
  }
  return Object.freeze({ status: 'node-require', runtimeEntry: module.packageName, reasonCode: null });
}

function createPackageEntries(graphBuild) {
  return graphBuild.graph.modules
    .filter((module) => module.runtime && module.kind === 'package')
    .map((module) => {
      const status = packageStatus(module, graphBuild);
      return Object.freeze({
        moduleId: module.id,
        packageName: module.packageName,
        packageSubpath: module.packageSubpath,
        contractId: module.packageContract,
        status: status.status,
        runtimeEntry: status.runtimeEntry,
        reasonCode: status.reasonCode,
        sources: moduleSources(graphBuild.graph, module.id)
      });
    });
}

function createBlockers(graphBuild, packages) {
  const blockers = [];
  if (graphBuild.entrySafety && graphBuild.entrySafety.importSafe === false) {
    const first = graphBuild.nativeEligibility && graphBuild.nativeEligibility.blockers
      .find((entry) => entry.kind === 'application-entry-lifecycle-side-effect');
    blockers.push(Object.freeze({
      code: 'PULSE_APPLICATION_ENTRY_LIFECYCLE_SIDE_EFFECT',
      kind: 'application-entry-lifecycle-side-effect',
      message: 'The configured Pulse application entry starts a known provider lifecycle during module evaluation.',
      moduleId: first && first.moduleId || graphBuild.graph.entry,
      source: first && first.source || { file: graphBuild.entryKey, line: 1, column: 1 }
    }));
  }
  for (const entry of packages.filter((item) => item.status === 'unavailable')) {
    const source = entry.sources[0] || { file: graphBuild.entryKey, line: 1, column: 1 };
    blockers.push(Object.freeze({
      code: entry.reasonCode || 'PULSE_JAVASCRIPT_PACKAGE_REALIZATION_UNAVAILABLE',
      kind: 'javascript-package-realization-unavailable',
      message: `Package ${entry.packageName}${entry.packageSubpath && entry.packageSubpath !== '.' ? entry.packageSubpath.slice(1) : ''} has no JavaScript realization for the selected target.`,
      moduleId: entry.moduleId,
      packageName: entry.packageName,
      packageSubpath: entry.packageSubpath,
      contractId: entry.contractId,
      source
    }));
  }
  return blockers;
}

function buildJavascriptApplicationPlan(entryFile, options = {}) {
  const absoluteEntry = path.resolve(entryFile);
  let graphBuild;
  try {
    graphBuild = buildReachableProjectGraph(absoluteEntry, {
      rootDir: options.rootDir,
      workspaceRoot: options.workspaceRoot,
      configFile: options.configFile,
      projectFragments: options.projectFragments,
      tsconfig: options.tsconfig
    });
  } catch (error) {
    if (error instanceof ReachableProjectGraphError || error && error.name === 'ReachableProjectGraphError') {
      throw new JavascriptApplicationPlanError(
        error.code || 'PULSE_JAVASCRIPT_APPLICATION_GRAPH_FAILED',
        error.message,
        error.detail,
        error.diagnostics
      );
    }
    throw error;
  }
  const entryModule = graphBuild.graph.modules.find((module) => module.id === graphBuild.graph.entry);
  if (!entryModule || entryModule.kind !== 'project' || !entryModule.path) {
    throw new JavascriptApplicationPlanError(
      'PULSE_JAVASCRIPT_APPLICATION_ENTRY_INVALID',
      'JavaScript application plan entry must resolve to a project module.',
      { entryFile: absoluteEntry, graphEntry: graphBuild.graph.entry }
    );
  }
  const packages = createPackageEntries(graphBuild);
  const blockers = createBlockers(graphBuild, packages);
  const requestedEnvelope = options.capabilityEnvelope || {};
  const capabilityEnvelope = Object.freeze({
    version: requestedEnvelope.version || 'pulse.javascript-capability-envelope.v1',
    provider: requestedEnvelope.provider || options.provider || 'node',
    status: requestedEnvelope.status || 'provider-adapters-deferred',
    core: requestedEnvelope.core || Object.freeze({ request: true, response: true, state: true }),
    effects: requestedEnvelope.effects || Object.freeze({ fetch: false, config: false, secret: false, kv: false }),
    packages: Object.freeze(packages.map((entry) => Object.freeze({
      contractId: entry.contractId,
      packageName: entry.packageName,
      status: entry.status
    })))
  });
  const plan = normalizeJavascriptApplicationPlan({
    provider: options.provider || 'node',
    targetId: options.targetId || 'node-javascript',
    entryPath: entryModule.path,
    graphVersion: graphBuild.graph.version,
    graphHash: graphBuild.graph.graphHash,
    resolverHash: graphBuild.graph.resolver.resolverHash,
    entryModuleId: graphBuild.graph.entry,
    modules: graphBuild.graph.modules,
    edges: graphBuild.graph.edges,
    packages,
    blockers,
    packageProduct: graphBuild.packageProduct,
    nativeEligibility: graphBuild.nativeEligibility,
    entrySafety: graphBuild.entrySafety,
    capabilityEnvelope,
    providerLifecycleDeferred: options.providerLifecycleDeferred !== false
  });
  return Object.freeze({
    ...plan,
    plannerVersion: JAVASCRIPT_APPLICATION_PLANNER_VERSION
  });
}

module.exports = Object.freeze({
  JAVASCRIPT_APPLICATION_PLANNER_VERSION,
  JAVASCRIPT_APPLICATION_PLAN_VERSION,
  JavascriptApplicationPlanError,
  buildJavascriptApplicationPlan
});
