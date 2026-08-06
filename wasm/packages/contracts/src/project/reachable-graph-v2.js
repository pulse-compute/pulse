'use strict';

const {
  MODULE_RESOLVER_CONTRACT_VERSION,
  MODULE_RESOLVER_INPUT_VERSION,
  RESOLUTION_KINDS,
  normalizeModuleResolverInput,
  normalizePortablePath,
  normalizeModuleSpecifier
} = require('./reachable-graph-resolver.js');
const {
  REACHABLE_GRAPH_IDENTITY_VERSION,
  HANDLER_REFERENCE_V2_VERSION,
  normalizeSourceLocation,
  createModuleIdentity,
  createEdgeIdentity,
  createHandlerReferenceIdentity,
  createCycleIdentity,
  createUnsupportedBoundaryIdentity,
  graphSemanticHash
} = require('./reachable-graph-identity.js');

const REACHABLE_GRAPH_MANIFEST_V2_VERSION = 'pulse.reachable-graph-manifest.v2';
const REACHABLE_GRAPH_IMPLEMENTATION_CONTRACT_VERSION = 'pulse.reachable-graph-implementation-contract.v1';
const MODULE_KINDS_V2 = Object.freeze(['project', 'package', 'generated', 'external']);
const MODULE_FORMATS_V2 = Object.freeze(['typescript', 'javascript', 'json', 'declaration', 'generated', 'external']);
const OWNERSHIP_KINDS_V2 = Object.freeze(['application', 'pulse-runtime', 'pulse-package', 'third-party', 'generated', 'external']);
const EDGE_KINDS_V2 = Object.freeze(['runtime-import', 'type-import', 're-export', 'package-contract', 'lifecycle']);
const HANDLER_ROLES_V2 = Object.freeze(['handler', 'route', 'middleware', 'event', 'error-middleware', 'router']);
const HANDLER_WRAPPERS_V2 = Object.freeze(['parentheses', 'as-cast', 'type-assertion', 'satisfies', 'non-null']);
const UNSUPPORTED_EDGE_KINDS_V2 = Object.freeze(['dynamic-import', 'commonjs-require', 'computed-specifier', 'loader-hook', 'unknown-runtime-side-effect']);
const CYCLE_EDGE_KINDS = Object.freeze(['runtime-import', 're-export', 'package-contract']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertKnownKeys(input, allowed, field) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`${field} contains unsupported field ${key}.`);
  }
}

function assertString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string.`);
  if (value.includes('\0')) throw new TypeError(`${field} must not contain NUL.`);
  return value.trim();
}

function assertBoolean(value, field) {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean.`);
  return value;
}

function assertSha256(value, field, options = {}) {
  if (value == null && options.nullable === true) return null;
  const text = assertString(value, field);
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`${field} must be a lowercase SHA-256 hex string.`);
  return text;
}

function optionalString(value, field) {
  return value == null ? null : assertString(value, field);
}

function sortedStrings(input, field) {
  if (input == null) return Object.freeze([]);
  if (!Array.isArray(input)) throw new TypeError(`${field} must be an array.`);
  return Object.freeze(Array.from(new Set(input.map((value, index) => assertString(value, `${field}[${index}]`)))).sort());
}

function normalizeOptionalSource(input, field) {
  return input == null ? null : normalizeSourceLocation(input, field);
}

function normalizeModuleV2(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`modules[${index}] must be an object.`);
  assertKnownKeys(input, new Set([
    'key', 'kind', 'owner', 'format', 'runtime', 'path', 'packageName', 'packageVersion',
    'packageSubpath', 'packageManifestHash', 'generator', 'logicalName', 'specifier',
    'packageContract', 'contentHash', 'exports', 'reExports', 'source'
  ]), `modules[${index}]`);
  const key = assertString(input.key, `modules[${index}].key`);
  const kind = assertString(input.kind, `modules[${index}].kind`);
  const owner = assertString(input.owner, `modules[${index}].owner`);
  const format = assertString(input.format, `modules[${index}].format`);
  if (!MODULE_KINDS_V2.includes(kind)) throw new TypeError(`Unsupported module kind ${kind}.`);
  if (!OWNERSHIP_KINDS_V2.includes(owner)) throw new TypeError(`Unsupported module owner ${owner}.`);
  if (!MODULE_FORMATS_V2.includes(format)) throw new TypeError(`Unsupported module format ${format}.`);
  const runtime = assertBoolean(input.runtime, `modules[${index}].runtime`);
  if (format === 'declaration' && runtime) throw new TypeError(`modules[${index}] declaration modules cannot be runtime-reachable.`);
  if (kind === 'external' && format !== 'external') throw new TypeError(`modules[${index}] external modules must use format external.`);
  if (kind === 'generated' && format !== 'generated') throw new TypeError(`modules[${index}] generated modules must use format generated.`);
  const identity = createModuleIdentity(input);
  const contentHash = kind === 'external'
    ? assertSha256(input.contentHash, `modules[${index}].contentHash`, { nullable: true })
    : assertSha256(input.contentHash, `modules[${index}].contentHash`);
  const common = {
    id: identity.id,
    kind,
    owner,
    canonical: identity.canonical,
    format,
    runtime,
    path: null,
    packageName: null,
    packageVersion: null,
    packageSubpath: null,
    packageManifestHash: null,
    generator: null,
    logicalName: null,
    externalSpecifier: null,
    packageContract: optionalString(input.packageContract, `modules[${index}].packageContract`),
    contentHash,
    exports: sortedStrings(input.exports, `modules[${index}].exports`),
    reExports: sortedStrings(input.reExports, `modules[${index}].reExports`),
    source: normalizeOptionalSource(input.source, `modules[${index}].source`)
  };
  if (kind === 'project') {
    common.path = identity.stableInput.path;
    if (owner !== 'application' && owner !== 'pulse-runtime') throw new TypeError(`modules[${index}] project modules require application or pulse-runtime ownership.`);
  } else if (kind === 'package') {
    common.packageName = identity.stableInput.packageName;
    common.packageVersion = identity.stableInput.packageVersion;
    common.packageSubpath = identity.stableInput.packageSubpath;
    common.packageManifestHash = identity.stableInput.packageManifestHash;
    if (!['pulse-runtime', 'pulse-package', 'third-party'].includes(owner)) throw new TypeError(`modules[${index}] package modules require package ownership.`);
  } else if (kind === 'generated') {
    common.generator = identity.stableInput.generator;
    common.logicalName = identity.stableInput.logicalName;
    if (owner !== 'generated') throw new TypeError(`modules[${index}] generated modules require generated ownership.`);
  } else {
    common.externalSpecifier = identity.stableInput.specifier;
    if (owner !== 'external') throw new TypeError(`modules[${index}] external modules require external ownership.`);
    if (common.packageContract !== null) throw new TypeError(`modules[${index}] external modules cannot own a package contract.`);
  }
  return Object.freeze({ key, record: Object.freeze(common) });
}

function expectedRuntimeForEdge(kind, input, index) {
  if (kind === 'type-import') {
    if (input.runtime != null && input.runtime !== false) throw new TypeError(`edges[${index}] type-import must not be runtime-reachable.`);
    return false;
  }
  if (kind === 're-export') return assertBoolean(input.runtime, `edges[${index}].runtime`);
  if (input.runtime != null && input.runtime !== true) throw new TypeError(`edges[${index}] ${kind} must be runtime-reachable.`);
  return true;
}

function validateResolutionTarget(resolutionKind, target, index) {
  if ((resolutionKind === 'project-relative' || resolutionKind === 'tsconfig-path') && !['project', 'generated'].includes(target.kind)) {
    throw new TypeError(`edges[${index}] ${resolutionKind} must resolve to a project or generated module.`);
  }
  if ((resolutionKind === 'package-root' || resolutionKind === 'package-subpath') && target.kind !== 'package') {
    throw new TypeError(`edges[${index}] ${resolutionKind} must resolve to a package module.`);
  }
  if (resolutionKind === 'generated' && target.kind !== 'generated') throw new TypeError(`edges[${index}] generated resolution must target a generated module.`);
  if (resolutionKind === 'external' && target.kind !== 'external') throw new TypeError(`edges[${index}] external resolution must target an external module.`);
}

function normalizeEdgeV2(input, index, modulesByKey) {
  if (!isPlainObject(input)) throw new TypeError(`edges[${index}] must be an object.`);
  assertKnownKeys(input, new Set([
    'kind', 'from', 'to', 'specifier', 'resolutionKind', 'runtime', 'importedNames',
    'exportedNames', 'packageContract', 'source'
  ]), `edges[${index}]`);
  const kind = assertString(input.kind, `edges[${index}].kind`);
  if (!EDGE_KINDS_V2.includes(kind)) throw new TypeError(`Unsupported graph edge kind ${kind}.`);
  const fromKey = assertString(input.from, `edges[${index}].from`);
  const toKey = assertString(input.to, `edges[${index}].to`);
  const from = modulesByKey.get(fromKey);
  const to = modulesByKey.get(toKey);
  if (!from || !to) throw new TypeError(`edges[${index}] must reference declared module keys.`);
  const resolutionKind = assertString(input.resolutionKind, `edges[${index}].resolutionKind`);
  if (!RESOLUTION_KINDS.includes(resolutionKind)) throw new TypeError(`Unsupported resolution kind ${resolutionKind}.`);
  validateResolutionTarget(resolutionKind, to, index);
  const runtime = expectedRuntimeForEdge(kind, input, index);
  const packageContract = optionalString(input.packageContract, `edges[${index}].packageContract`);
  if (kind === 'package-contract') {
    if (to.kind !== 'package' || to.packageContract == null) throw new TypeError(`edges[${index}] package-contract must target a package module with a contract.`);
    if (packageContract !== to.packageContract) throw new TypeError(`edges[${index}] package contract must match its target module.`);
  }
  const source = normalizeSourceLocation(input.source, `edges[${index}].source`);
  const identity = createEdgeIdentity({
    kind,
    from: from.id,
    to: to.id,
    specifier: normalizeModuleSpecifier(input.specifier, `edges[${index}].specifier`),
    resolutionKind,
    runtime,
    importedNames: input.importedNames,
    exportedNames: input.exportedNames,
    packageContract,
    source
  });
  return Object.freeze({
    id: identity.id,
    kind,
    from: from.id,
    to: to.id,
    specifier: identity.stableInput.specifier,
    resolutionKind,
    runtime,
    importedNames: identity.stableInput.importedNames,
    exportedNames: identity.stableInput.exportedNames,
    packageContract,
    source
  });
}

function normalizeHandlerV2(input, index, modulesByKey) {
  if (!isPlainObject(input)) throw new TypeError(`handlers[${index}] must be an object.`);
  assertKnownKeys(input, new Set(['module', 'exportName', 'localName', 'role', 'wrappers', 'source']), `handlers[${index}]`);
  const moduleKey = assertString(input.module, `handlers[${index}].module`);
  const moduleRecord = modulesByKey.get(moduleKey);
  if (!moduleRecord) throw new TypeError(`handlers[${index}] references unknown module key ${moduleKey}.`);
  const role = assertString(input.role, `handlers[${index}].role`);
  if (!HANDLER_ROLES_V2.includes(role)) throw new TypeError(`Unsupported handler role ${role}.`);
  const wrappers = sortedStrings(input.wrappers, `handlers[${index}].wrappers`);
  for (const wrapper of wrappers) if (!HANDLER_WRAPPERS_V2.includes(wrapper)) throw new TypeError(`Unsupported handler wrapper ${wrapper}.`);
  const source = normalizeSourceLocation(input.source, `handlers[${index}].source`);
  const identity = createHandlerReferenceIdentity({
    moduleId: moduleRecord.id,
    exportName: input.exportName,
    localName: input.localName,
    role,
    wrappers,
    source
  });
  return Object.freeze({
    version: HANDLER_REFERENCE_V2_VERSION,
    id: identity.id,
    moduleId: moduleRecord.id,
    exportName: identity.stableInput.exportName,
    localName: identity.stableInput.localName,
    role,
    wrappers,
    source
  });
}

function cycleEdge(edge) {
  return edge.runtime && CYCLE_EDGE_KINDS.includes(edge.kind);
}

function deriveCycles(modules, edges) {
  const moduleIds = modules.map((module) => module.id).sort();
  const adjacency = new Map(moduleIds.map((id) => [id, []]));
  const selfEdges = new Set();
  for (const edge of edges) {
    if (!cycleEdge(edge)) continue;
    adjacency.get(edge.from).push(edge.to);
    if (edge.from === edge.to) selfEdges.add(edge.from);
  }
  for (const targets of adjacency.values()) targets.sort();
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const low = new Map();
  const cycles = [];

  function visit(id) {
    indices.set(id, index);
    low.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);
    for (const next of adjacency.get(id)) {
      if (!indices.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id), indices.get(next)));
      }
    }
    if (low.get(id) !== indices.get(id)) return;
    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    component.sort();
    if (component.length > 1 || selfEdges.has(component[0])) {
      const identity = createCycleIdentity(component);
      cycles.push(Object.freeze({ id: identity.id, modules: identity.stableInput.modules }));
    }
  }

  for (const id of moduleIds) if (!indices.has(id)) visit(id);
  return Object.freeze(cycles.sort((a, b) => a.id.localeCompare(b.id)));
}

function normalizeUnsupportedBoundaryV2(input, index, modulesByKey) {
  if (!isPlainObject(input)) throw new TypeError(`unsupportedBoundaries[${index}] must be an object.`);
  assertKnownKeys(input, new Set(['kind', 'from', 'specifier', 'source']), `unsupportedBoundaries[${index}]`);
  const kind = assertString(input.kind, `unsupportedBoundaries[${index}].kind`);
  if (!UNSUPPORTED_EDGE_KINDS_V2.includes(kind)) throw new TypeError(`Unsupported boundary kind ${kind}.`);
  const fromKey = input.from == null ? null : assertString(input.from, `unsupportedBoundaries[${index}].from`);
  const from = fromKey == null ? null : modulesByKey.get(fromKey);
  if (fromKey != null && !from) throw new TypeError(`unsupportedBoundaries[${index}] references unknown module key ${fromKey}.`);
  const source = normalizeSourceLocation(input.source, `unsupportedBoundaries[${index}].source`);
  const identity = createUnsupportedBoundaryIdentity({
    kind,
    from: from ? from.id : null,
    specifier: normalizeModuleSpecifier(input.specifier, `unsupportedBoundaries[${index}].specifier`),
    source
  });
  return Object.freeze({
    id: identity.id,
    kind,
    from: from ? from.id : null,
    specifier: identity.stableInput.specifier,
    source
  });
}

function compareBoundaries(a, b) {
  return a.source.file.localeCompare(b.source.file)
    || a.source.line - b.source.line
    || a.source.column - b.source.column
    || a.id.localeCompare(b.id);
}

function normalizeReachableGraphManifestV2(input) {
  if (!isPlainObject(input)) throw new TypeError('Reachable graph v2 input must be an object.');
  assertKnownKeys(input, new Set(['resolver', 'entry', 'modules', 'edges', 'handlers', 'unsupportedBoundaries']), 'Reachable graph v2 input');
  const resolver = normalizeModuleResolverInput(input.resolver || {});
  const normalizedModules = [...(input.modules || [])].map(normalizeModuleV2);
  const modulesByKey = new Map();
  const modulesById = new Map();
  for (const entry of normalizedModules) {
    if (modulesByKey.has(entry.key)) throw new TypeError(`Duplicate graph module key ${entry.key}.`);
    if (modulesById.has(entry.record.id)) throw new TypeError(`Duplicate graph module identity ${entry.record.id}.`);
    modulesByKey.set(entry.key, entry.record);
    modulesById.set(entry.record.id, entry.record);
  }
  const entryKey = assertString(input.entry, 'entry');
  const entryModule = modulesByKey.get(entryKey);
  if (!entryModule) throw new TypeError(`Reachable graph entry references unknown module key ${entryKey}.`);
  if (!entryModule.runtime || !['project', 'generated'].includes(entryModule.kind)) {
    throw new TypeError('Reachable graph entry must be a runtime project or generated module.');
  }
  const modules = Object.freeze(Array.from(modulesById.values()).sort((a, b) => a.id.localeCompare(b.id)));
  const edges = Object.freeze([...(input.edges || [])].map((edge, index) => normalizeEdgeV2(edge, index, modulesByKey)).sort((a, b) => a.id.localeCompare(b.id)));
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) throw new TypeError('Reachable graph v2 edge identities must be unique.');
  const handlers = Object.freeze([...(input.handlers || [])].map((handler, index) => normalizeHandlerV2(handler, index, modulesByKey)).sort((a, b) => a.id.localeCompare(b.id)));
  if (new Set(handlers.map((handler) => handler.id)).size !== handlers.length) throw new TypeError('Reachable graph v2 handler identities must be unique.');
  const unsupportedBoundaries = Object.freeze([...(input.unsupportedBoundaries || [])]
    .map((boundary, index) => normalizeUnsupportedBoundaryV2(boundary, index, modulesByKey))
    .sort(compareBoundaries));
  if (new Set(unsupportedBoundaries.map((boundary) => boundary.id)).size !== unsupportedBoundaries.length) {
    throw new TypeError('Reachable graph v2 unsupported-boundary identities must be unique.');
  }
  const cycles = deriveCycles(modules, edges);
  const semantic = Object.freeze({
    version: REACHABLE_GRAPH_MANIFEST_V2_VERSION,
    identityVersion: REACHABLE_GRAPH_IDENTITY_VERSION,
    resolverVersion: MODULE_RESOLVER_CONTRACT_VERSION,
    handlerReferenceVersion: HANDLER_REFERENCE_V2_VERSION,
    resolver,
    entry: entryModule.id,
    modules,
    edges,
    handlers,
    cycles,
    unsupportedBoundaries,
    firstUnsupportedBoundary: unsupportedBoundaries.length === 0 ? null : unsupportedBoundaries[0]
  });
  return Object.freeze({ ...semantic, graphHash: graphSemanticHash(semantic) });
}

function defaultReachableGraphImplementationContract() {
  return Object.freeze({
    version: REACHABLE_GRAPH_IMPLEMENTATION_CONTRACT_VERSION,
    manifestVersion: REACHABLE_GRAPH_MANIFEST_V2_VERSION,
    identityVersion: REACHABLE_GRAPH_IDENTITY_VERSION,
    resolverVersion: MODULE_RESOLVER_CONTRACT_VERSION,
    handlerReferenceVersion: HANDLER_REFERENCE_V2_VERSION,
    moduleKinds: MODULE_KINDS_V2,
    moduleFormats: MODULE_FORMATS_V2,
    ownershipKinds: OWNERSHIP_KINDS_V2,
    edgeKinds: EDGE_KINDS_V2,
    handlerRoles: HANDLER_ROLES_V2,
    handlerWrappers: HANDLER_WRAPPERS_V2,
    unsupportedEdgeKinds: UNSUPPORTED_EDGE_KINDS_V2,
    policies: Object.freeze({
      callerProvidedStableIdsAccepted: false,
      absoluteFilesystemPathsInManifest: false,
      moduleIdentityIncludesContentHash: false,
      graphHashIncludesContentHashes: true,
      graphHashIncludesResolverHash: true,
      cyclesDerivedFromRuntimeDependencyEdges: true,
      unsupportedBoundariesSortedBySource: true,
      firstUnsupportedBoundaryDerived: true,
      typeOnlyEdgesCreateRuntimeReachability: false,
      runtimePackageUseFromResolvedEdgesOnly: true,
      hostPlatformAffectsIdentity: false,
      cacheImplemented: false,
      recursiveWalkerImplemented: false,
      javascriptBundlerImplemented: false
    }),
    consumers: Object.freeze([
      'native-compiler',
      'javascript-build-planner',
      'native-eligibility',
      'watch-inputs',
      'package-contract-selection',
      'application-entry-safety'
    ])
  });
}

module.exports = Object.freeze({
  REACHABLE_GRAPH_MANIFEST_V2_VERSION,
  REACHABLE_GRAPH_IMPLEMENTATION_CONTRACT_VERSION,
  MODULE_KINDS_V2,
  MODULE_FORMATS_V2,
  OWNERSHIP_KINDS_V2,
  EDGE_KINDS_V2,
  HANDLER_ROLES_V2,
  HANDLER_WRAPPERS_V2,
  UNSUPPORTED_EDGE_KINDS_V2,
  normalizeReachableGraphManifestV2,
  defaultReachableGraphImplementationContract
});
