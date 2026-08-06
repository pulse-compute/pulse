'use strict';

const { stableStringify, sha256Hex } = require('../stable-id.js');
const reachableGraphResolver = require('./reachable-graph-resolver.js');
const reachableGraphIdentity = require('./reachable-graph-identity.js');
const reachableGraphV2 = require('./reachable-graph-v2.js');
const reachableGraphProjections = require('./reachable-graph-projections.js');
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
const REACHABLE_GRAPH_MANIFEST_V2_SCHEMA = deepFreeze(require('./reachable-graph-v2.schema.json'));

const REACHABLE_GRAPH_CONTRACT_VERSION = 'pulse.reachable-graph-contract.v1';
const REACHABLE_GRAPH_MANIFEST_VERSION = 'pulse.reachable-graph-manifest.v1';
const HANDLER_REFERENCE_VERSION = 'pulse.handler-reference.v1';
const MODULE_KINDS = Object.freeze(['project', 'package', 'generated', 'external']);
const EDGE_KINDS = Object.freeze(['runtime-import', 'type-import', 're-export', 'package-contract', 'lifecycle']);
const OWNERSHIP_KINDS = Object.freeze(['application', 'pulse-runtime', 'pulse-package', 'third-party', 'generated', 'external']);
const HANDLER_ROLES = Object.freeze(['handler', 'route', 'middleware', 'event', 'error-middleware', 'router']);
const HANDLER_WRAPPERS = Object.freeze(['parentheses', 'as-cast', 'type-assertion', 'satisfies', 'non-null']);
const UNSUPPORTED_EDGE_KINDS = Object.freeze(['dynamic-import', 'commonjs-require', 'computed-specifier', 'loader-hook', 'unknown-runtime-side-effect']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function assertString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string.`);
  return value.trim();
}
function assertPositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${field} must be a positive safe integer.`);
  return number;
}
function strings(input, field) {
  if (input == null) return Object.freeze([]);
  if (!Array.isArray(input)) throw new TypeError(`${field} must be an array.`);
  return Object.freeze(Array.from(new Set(input.map((value, index) => assertString(value, `${field}[${index}]`)))).sort());
}
function normalizeSource(input, field) {
  if (!isPlainObject(input)) throw new TypeError(`${field} must be an object.`);
  return Object.freeze({
    file: assertString(input.file, `${field}.file`),
    line: assertPositiveInteger(input.line, `${field}.line`),
    column: assertPositiveInteger(input.column, `${field}.column`)
  });
}
function normalizeModule(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`modules[${index}] must be an object.`);
  const kind = assertString(input.kind, `modules[${index}].kind`);
  const owner = assertString(input.owner, `modules[${index}].owner`);
  if (!MODULE_KINDS.includes(kind)) throw new TypeError(`Unsupported module kind ${kind}.`);
  if (!OWNERSHIP_KINDS.includes(owner)) throw new TypeError(`Unsupported module owner ${owner}.`);
  return Object.freeze({
    id: assertString(input.id, `modules[${index}].id`),
    kind,
    owner,
    resolved: assertString(input.resolved, `modules[${index}].resolved`),
    packageName: input.packageName == null ? null : assertString(input.packageName, `modules[${index}].packageName`),
    packageContract: input.packageContract == null ? null : assertString(input.packageContract, `modules[${index}].packageContract`),
    contentHash: input.contentHash == null ? null : assertString(input.contentHash, `modules[${index}].contentHash`),
    exports: strings(input.exports, `modules[${index}].exports`),
    reExports: strings(input.reExports, `modules[${index}].reExports`),
    source: input.source == null ? null : normalizeSource(input.source, `modules[${index}].source`)
  });
}
function normalizeEdge(input, index, moduleIds) {
  if (!isPlainObject(input)) throw new TypeError(`edges[${index}] must be an object.`);
  const kind = assertString(input.kind, `edges[${index}].kind`);
  if (!EDGE_KINDS.includes(kind)) throw new TypeError(`Unsupported graph edge kind ${kind}.`);
  const from = assertString(input.from, `edges[${index}].from`);
  const to = assertString(input.to, `edges[${index}].to`);
  if (!moduleIds.has(from) || !moduleIds.has(to)) throw new TypeError(`edges[${index}] must reference declared modules.`);
  return Object.freeze({
    id: assertString(input.id, `edges[${index}].id`),
    kind,
    from,
    to,
    specifier: assertString(input.specifier, `edges[${index}].specifier`),
    importedNames: strings(input.importedNames, `edges[${index}].importedNames`),
    exportedNames: strings(input.exportedNames, `edges[${index}].exportedNames`),
    packageContract: input.packageContract == null ? null : assertString(input.packageContract, `edges[${index}].packageContract`),
    source: normalizeSource(input.source, `edges[${index}].source`)
  });
}
function normalizeHandlerReference(input, index, moduleIds) {
  if (!isPlainObject(input)) throw new TypeError(`handlers[${index}] must be an object.`);
  const moduleId = assertString(input.moduleId, `handlers[${index}].moduleId`);
  if (!moduleIds.has(moduleId)) throw new TypeError(`handlers[${index}] references unknown module ${moduleId}.`);
  const role = assertString(input.role, `handlers[${index}].role`);
  if (!HANDLER_ROLES.includes(role)) throw new TypeError(`Unsupported handler role ${role}.`);
  const wrappers = strings(input.wrappers, `handlers[${index}].wrappers`);
  for (const wrapper of wrappers) if (!HANDLER_WRAPPERS.includes(wrapper)) throw new TypeError(`Unsupported handler wrapper ${wrapper}.`);
  return Object.freeze({
    version: HANDLER_REFERENCE_VERSION,
    id: assertString(input.id, `handlers[${index}].id`),
    moduleId,
    exportName: input.exportName == null ? null : assertString(input.exportName, `handlers[${index}].exportName`),
    localName: input.localName == null ? null : assertString(input.localName, `handlers[${index}].localName`),
    role,
    wrappers,
    source: normalizeSource(input.source, `handlers[${index}].source`)
  });
}
function normalizeCycle(input, index, moduleIds) {
  if (!Array.isArray(input) || input.length === 0) throw new TypeError(`cycles[${index}] must be a non-empty module-ID array.`);
  const ids = Array.from(new Set(input.map((value, moduleIndex) => assertString(value, `cycles[${index}][${moduleIndex}]`)))).sort();
  for (const id of ids) if (!moduleIds.has(id)) throw new TypeError(`cycles[${index}] references unknown module ${id}.`);
  return Object.freeze(ids);
}
function normalizeUnsupportedBoundary(input, moduleIds) {
  if (input == null) return null;
  if (!isPlainObject(input)) throw new TypeError('firstUnsupportedBoundary must be null or an object.');
  const kind = assertString(input.kind, 'firstUnsupportedBoundary.kind');
  if (!UNSUPPORTED_EDGE_KINDS.includes(kind)) throw new TypeError(`Unsupported boundary kind ${kind}.`);
  const from = input.from == null ? null : assertString(input.from, 'firstUnsupportedBoundary.from');
  if (from !== null && !moduleIds.has(from)) throw new TypeError(`firstUnsupportedBoundary.from references unknown module ${from}.`);
  return Object.freeze({
    kind,
    specifier: assertString(input.specifier, 'firstUnsupportedBoundary.specifier'),
    from,
    source: normalizeSource(input.source, 'firstUnsupportedBoundary.source')
  });
}
function normalizeReachableGraphManifest(input) {
  if (!isPlainObject(input)) throw new TypeError('Reachable graph manifest must be an object.');
  const modules = Object.freeze([...(input.modules || [])].map(normalizeModule).sort((a, b) => a.id.localeCompare(b.id)));
  const moduleIds = new Set(modules.map((entry) => entry.id));
  if (moduleIds.size !== modules.length) throw new TypeError('Reachable graph module IDs must be unique.');
  const entry = assertString(input.entry, 'entry');
  if (!moduleIds.has(entry)) throw new TypeError(`Reachable graph entry references unknown module ${entry}.`);
  const edges = Object.freeze([...(input.edges || [])].map((edge, index) => normalizeEdge(edge, index, moduleIds)).sort((a, b) => a.id.localeCompare(b.id)));
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) throw new TypeError('Reachable graph edge IDs must be unique.');
  const handlers = Object.freeze([...(input.handlers || [])].map((handler, index) => normalizeHandlerReference(handler, index, moduleIds)).sort((a, b) => a.id.localeCompare(b.id)));
  if (new Set(handlers.map((handler) => handler.id)).size !== handlers.length) throw new TypeError('Reachable graph handler IDs must be unique.');
  const semantic = {
    version: REACHABLE_GRAPH_MANIFEST_VERSION,
    handlerReferenceVersion: HANDLER_REFERENCE_VERSION,
    entry,
    modules,
    edges,
    handlers,
    cycles: Object.freeze([...(input.cycles || [])].map((cycle, index) => normalizeCycle(cycle, index, moduleIds)).sort((a, b) => a.join('\0').localeCompare(b.join('\0')))),
    firstUnsupportedBoundary: normalizeUnsupportedBoundary(input.firstUnsupportedBoundary, moduleIds)
  };
  return Object.freeze({ ...semantic, graphHash: sha256Hex(stableStringify(semantic)) });
}
function defaultReachableGraphContract() {
  return Object.freeze({
    version: REACHABLE_GRAPH_CONTRACT_VERSION,
    manifestVersion: REACHABLE_GRAPH_MANIFEST_VERSION,
    handlerReferenceVersion: HANDLER_REFERENCE_VERSION,
    moduleKinds: MODULE_KINDS,
    edgeKinds: EDGE_KINDS,
    ownershipKinds: OWNERSHIP_KINDS,
    handlerRoles: HANDLER_ROLES,
    handlerWrappers: HANDLER_WRAPPERS,
    unsupportedEdgeKinds: UNSUPPORTED_EDGE_KINDS,
    policies: Object.freeze({
      oneAuthoritativeGraph: true,
      staticEsmOnly: true,
      typeOnlyEdgesDoNotCreateRuntimeReachability: true,
      packageUseFromResolvedReachabilityOnly: true,
      packageSubstringDetectionAllowed: false,
      reExportsPreserveOwningPackage: true,
      cyclesReportedAsStronglyConnectedComponents: true,
      sourceLocationsRequired: true,
      lifecycleSideEffectsAreReachabilityFindings: true,
      graphHashRequiredBeforeCache: true,
      dynamicImportImplemented: false,
      arbitraryRequireImplemented: false,
      bundlingImplemented: false,
      cacheImplemented: false
    }),
    consumers: Object.freeze(['native-compiler', 'javascript-build-planner', 'native-eligibility', 'watch-inputs', 'package-contract-selection', 'application-entry-safety'])
  });
}
module.exports = Object.freeze({
  REACHABLE_GRAPH_CONTRACT_VERSION,
  REACHABLE_GRAPH_MANIFEST_VERSION,
  HANDLER_REFERENCE_VERSION,
  MODULE_KINDS,
  EDGE_KINDS,
  OWNERSHIP_KINDS,
  HANDLER_ROLES,
  HANDLER_WRAPPERS,
  UNSUPPORTED_EDGE_KINDS,
  normalizeReachableGraphManifest,
  defaultReachableGraphContract,
  REACHABLE_GRAPH_MANIFEST_V2_SCHEMA,
  ...reachableGraphResolver,
  ...reachableGraphIdentity,
  ...reachableGraphV2,
  ...reachableGraphProjections
});
