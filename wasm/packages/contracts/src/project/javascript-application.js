'use strict';

const { sha256Hex, stableStringify } = require('../stable-id.js');

const JAVASCRIPT_APPLICATION_PLAN_VERSION = 'pulse.javascript-application-plan.v1';
const JAVASCRIPT_APPLICATION_LOADER_VERSION = 'pulse.javascript-application-loader.v1';
const JAVASCRIPT_TARGET_DESCRIPTOR_VERSION = 'pulse.javascript-target-descriptor.v2';
const JAVASCRIPT_RUNTIME_CLASS = 'javascript';

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value);
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) deepFreeze(entry);
    return Object.freeze(value);
  }
  return value;
}

function requireString(label, value) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

function normalizeSource(source) {
  if (!source) return null;
  return Object.freeze({
    file: requireString('JavaScript application source file', source.file),
    line: Number.isInteger(source.line) && source.line > 0 ? source.line : 1,
    column: Number.isInteger(source.column) && source.column > 0 ? source.column : 1
  });
}

function normalizeModule(module, index) {
  if (!module || typeof module !== 'object') throw new TypeError(`JavaScript application module ${index} must be an object.`);
  return Object.freeze({
    id: requireString(`JavaScript application module ${index} id`, module.id),
    kind: requireString(`JavaScript application module ${index} kind`, module.kind),
    format: requireString(`JavaScript application module ${index} format`, module.format),
    runtime: module.runtime === true,
    path: module.path == null ? null : requireString(`JavaScript application module ${index} path`, module.path),
    packageName: module.packageName == null ? null : requireString(`JavaScript application module ${index} packageName`, module.packageName),
    packageSubpath: module.packageSubpath == null ? null : String(module.packageSubpath),
    packageContract: module.packageContract == null ? null : String(module.packageContract),
    externalSpecifier: module.externalSpecifier == null ? null : String(module.externalSpecifier),
    contentHash: requireString(`JavaScript application module ${index} contentHash`, module.contentHash)
  });
}

function normalizeEdge(edge, index) {
  if (!edge || typeof edge !== 'object') throw new TypeError(`JavaScript application edge ${index} must be an object.`);
  return Object.freeze({
    id: requireString(`JavaScript application edge ${index} id`, edge.id),
    kind: requireString(`JavaScript application edge ${index} kind`, edge.kind),
    from: requireString(`JavaScript application edge ${index} from`, edge.from),
    to: requireString(`JavaScript application edge ${index} to`, edge.to),
    specifier: requireString(`JavaScript application edge ${index} specifier`, edge.specifier),
    resolutionKind: requireString(`JavaScript application edge ${index} resolutionKind`, edge.resolutionKind),
    runtime: edge.runtime === true,
    packageContract: edge.packageContract == null ? null : String(edge.packageContract),
    source: normalizeSource(edge.source)
  });
}


function normalizeBlocker(blocker, index) {
  if (!blocker || typeof blocker !== 'object') throw new TypeError(`JavaScript application blocker ${index} must be an object.`);
  return Object.freeze({
    code: requireString(`JavaScript application blocker ${index} code`, blocker.code),
    kind: requireString(`JavaScript application blocker ${index} kind`, blocker.kind),
    message: requireString(`JavaScript application blocker ${index} message`, blocker.message),
    moduleId: blocker.moduleId == null ? null : String(blocker.moduleId),
    packageName: blocker.packageName == null ? null : String(blocker.packageName),
    packageSubpath: blocker.packageSubpath == null ? null : String(blocker.packageSubpath),
    contractId: blocker.contractId == null ? null : String(blocker.contractId),
    source: normalizeSource(blocker.source)
  });
}

function normalizePackage(entry, index) {
  if (!entry || typeof entry !== 'object') throw new TypeError(`JavaScript application package ${index} must be an object.`);
  const status = requireString(`JavaScript application package ${index} status`, entry.status);
  if (!['supplied-core', 'node-require', 'package-runtime', 'unavailable'].includes(status)) {
    throw new TypeError(`Unsupported JavaScript application package status ${status}.`);
  }
  return Object.freeze({
    moduleId: requireString(`JavaScript application package ${index} moduleId`, entry.moduleId),
    packageName: requireString(`JavaScript application package ${index} packageName`, entry.packageName),
    packageSubpath: entry.packageSubpath == null ? '.' : String(entry.packageSubpath),
    contractId: entry.contractId == null ? null : String(entry.contractId),
    status,
    runtimeEntry: entry.runtimeEntry == null ? null : String(entry.runtimeEntry),
    reasonCode: entry.reasonCode == null ? null : String(entry.reasonCode),
    sources: Object.freeze((entry.sources || []).map(normalizeSource).filter(Boolean))
  });
}

function normalizeJavascriptApplicationPlan(input) {
  if (!input || typeof input !== 'object') throw new TypeError('JavaScript application plan input must be an object.');
  const modules = Object.freeze((input.modules || []).map(normalizeModule).sort((a, b) => a.id.localeCompare(b.id)));
  const edges = Object.freeze((input.edges || []).map(normalizeEdge).sort((a, b) => a.id.localeCompare(b.id)));
  const packages = Object.freeze((input.packages || []).map(normalizePackage).sort((a, b) => a.moduleId.localeCompare(b.moduleId)));
  const blockers = Object.freeze((input.blockers || []).map(normalizeBlocker).sort((a, b) => (a.source?.file || '').localeCompare(b.source?.file || '') || (a.source?.line || 0) - (b.source?.line || 0) || a.code.localeCompare(b.code)));
  const moduleIds = new Set(modules.map((entry) => entry.id));
  if (moduleIds.size !== modules.length) throw new TypeError('JavaScript application plan module IDs must be unique.');
  for (const edge of edges) {
    if (!moduleIds.has(edge.from) || !moduleIds.has(edge.to)) throw new TypeError(`JavaScript application edge ${edge.id} references an unknown module.`);
  }
  const entryModuleId = requireString('JavaScript application entry module id', input.entryModuleId);
  if (!moduleIds.has(entryModuleId)) throw new TypeError('JavaScript application entry module must be present in modules.');
  const document = {
    version: JAVASCRIPT_APPLICATION_PLAN_VERSION,
    kind: 'pulse.javascript-application-plan',
    provider: requireString('JavaScript application provider', input.provider),
    target: 'javascript',
    targetId: requireString('JavaScript application target id', input.targetId),
    runtimeClass: JAVASCRIPT_RUNTIME_CLASS,
    sourceApplication: true,
    automaticFallback: false,
    workspace: Object.freeze({
      root: '.',
      entry: requireString('JavaScript application entry path', input.entryPath)
    }),
    graph: Object.freeze({
      version: requireString('JavaScript application graph version', input.graphVersion),
      graphHash: requireString('JavaScript application graph hash', input.graphHash),
      resolverHash: requireString('JavaScript application resolver hash', input.resolverHash),
      entryModuleId,
      modules,
      edges
    }),
    packages,
    loadable: blockers.length === 0,
    blockers,
    packageProduct: input.packageProduct || null,
    nativeEligibility: input.nativeEligibility || null,
    entrySafety: input.entrySafety || null,
    capabilityEnvelope: input.capabilityEnvelope || null,
    policy: Object.freeze({
      graphBackedResolution: true,
      oneModuleCache: true,
      sourceHashVerifiedAtLoad: true,
      applicationDefaultMustBeManaged: true,
      packageSupportCheckedBeforeLoad: true,
      providerLifecycleDeferred: input.providerLifecycleDeferred !== false,
      automaticFallback: false
    })
  };
  const planHash = sha256Hex(stableStringify(document));
  return deepFreeze({ ...document, planHash });
}

function isJavascriptApplicationPlan(value) {
  return Boolean(value && value.version === JAVASCRIPT_APPLICATION_PLAN_VERSION && value.kind === 'pulse.javascript-application-plan');
}

function normalizeJavascriptTargetDescriptor(input) {
  if (!input || typeof input !== 'object') throw new TypeError('JavaScript target descriptor input must be an object.');
  const commands = input.commands || {};
  return deepFreeze({
    version: JAVASCRIPT_TARGET_DESCRIPTOR_VERSION,
    provider: requireString('JavaScript target provider', input.provider),
    target: 'javascript',
    targetId: requireString('JavaScript target id', input.targetId),
    runtimeClass: JAVASCRIPT_RUNTIME_CLASS,
    sourceApplication: true,
    automaticFallback: false,
    status: requireString('JavaScript target status', input.status),
    hostBridge: input.hostBridge === true,
    applicationLoader: input.applicationLoader === true,
    requestAdapter: input.requestAdapter === true,
    lifecycle: input.lifecycle === true,
    capabilities: deepFreeze(input.capabilities || {
      version: 'pulse.javascript-capability-envelope.v1',
      provider: input.provider,
      status: input.requestAdapter === true ? 'request-lifecycle-ready' : 'provider-adapters-deferred',
      core: Object.freeze({
        request: input.requestAdapter === true,
        response: input.requestAdapter === true,
        state: true
      }),
      effects: Object.freeze({ fetch: false, config: false, secret: false, kv: false }),
      packages: Object.freeze([])
    }),
    reporting: deepFreeze(input.reporting || {
      supported: true,
      default: 'info',
      levels: ['off', 'error', 'warn', 'info', 'debug']
    }),
    ...(input.crypto ? { crypto: deepFreeze(input.crypto) } : {}),
    commands: Object.freeze({
      compile: commands.compile === true,
      inspect: commands.inspect === true,
      doctor: commands.doctor === true,
      build: commands.build === true,
      test: commands.test === true,
      dev: commands.dev === true
    })
  });
}

module.exports = Object.freeze({
  JAVASCRIPT_APPLICATION_PLAN_VERSION,
  JAVASCRIPT_APPLICATION_LOADER_VERSION,
  JAVASCRIPT_TARGET_DESCRIPTOR_VERSION,
  JAVASCRIPT_RUNTIME_CLASS,
  isJavascriptApplicationPlan,
  normalizeJavascriptApplicationPlan,
  normalizeJavascriptTargetDescriptor
});
