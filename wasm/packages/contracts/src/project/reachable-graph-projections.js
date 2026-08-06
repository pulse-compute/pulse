'use strict';

const { prefixedStableId, stableStringify, sha256Hex } = require('../stable-id.js');
const { normalizeSourceLocation, normalizePackageName, normalizePackageSubpath } = require('./reachable-graph-identity.js');

const PACKAGE_REACHABILITY_PROJECTION_VERSION = 'pulse.package-reachability-projection.v1';
const PACKAGE_BINDING_OWNERSHIP_VERSION = 'pulse.package-binding-ownership.v1';
const APPLICATION_ENTRY_SAFETY_VERSION = 'pulse.application-entry-safety.v1';
const NATIVE_ELIGIBILITY_PROJECTION_VERSION = 'pulse.native-eligibility-projection.v1';

const PACKAGE_NATIVE_STATUSES = Object.freeze(['core-authoring', 'trusted-lowerable', 'unsupported']);
const PACKAGE_BINDING_VIA = Object.freeze(['direct-import', 'direct-re-export', 'project-import', 'project-re-export']);
const ELIGIBILITY_BLOCKER_KINDS = Object.freeze([
  'unsupported-package',
  'unsupported-package-subpath',
  'package-re-export-lowering-deferred',
  'package-composition-not-realized',
  'application-entry-lifecycle-side-effect'
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertKnownKeys(input, allowed, field) {
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`${field} contains unsupported field ${key}.`);
}

function string(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string.`);
  if (value.includes('\0')) throw new TypeError(`${field} must not contain NUL.`);
  return value.trim();
}

function nullableString(value, field) {
  return value == null ? null : string(value, field);
}

function bool(value, field) {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean.`);
  return value;
}

function strings(values, field) {
  if (values == null) return Object.freeze([]);
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array.`);
  return Object.freeze(Array.from(new Set(values.map((value, index) => string(value, `${field}[${index}]`)))).sort());
}

function sources(values, field) {
  if (values == null) return Object.freeze([]);
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array.`);
  const normalized = values.map((value, index) => normalizeSourceLocation(value, `${field}[${index}]`));
  normalized.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column);
  return Object.freeze(normalized);
}

function compareSource(left, right) {
  return left.source.file.localeCompare(right.source.file)
    || left.source.line - right.source.line
    || left.source.column - right.source.column
    || String(left.id || left.edgeId || '').localeCompare(String(right.id || right.edgeId || ''));
}

function normalizePackageRecord(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`packages[${index}] must be an object.`);
  assertKnownKeys(input, new Set([
    'moduleId', 'packageName', 'packageVersion', 'packageSubpath', 'owner', 'runtime',
    'contractId', 'lowerableSubpath', 'facadeSymbols', 'importSources', 'reExportSources', 'nativeStatus'
  ]), `packages[${index}]`);
  const nativeStatus = string(input.nativeStatus, `packages[${index}].nativeStatus`);
  if (!PACKAGE_NATIVE_STATUSES.includes(nativeStatus)) throw new TypeError(`Unsupported package native status ${nativeStatus}.`);
  return Object.freeze({
    moduleId: string(input.moduleId, `packages[${index}].moduleId`),
    packageName: normalizePackageName(input.packageName, `packages[${index}].packageName`),
    packageVersion: string(input.packageVersion, `packages[${index}].packageVersion`),
    packageSubpath: normalizePackageSubpath(input.packageSubpath, `packages[${index}].packageSubpath`),
    owner: string(input.owner, `packages[${index}].owner`),
    runtime: bool(input.runtime, `packages[${index}].runtime`),
    contractId: nullableString(input.contractId, `packages[${index}].contractId`),
    lowerableSubpath: nullableString(input.lowerableSubpath, `packages[${index}].lowerableSubpath`),
    facadeSymbols: strings(input.facadeSymbols, `packages[${index}].facadeSymbols`),
    importSources: sources(input.importSources, `packages[${index}].importSources`),
    reExportSources: sources(input.reExportSources, `packages[${index}].reExportSources`),
    nativeStatus
  });
}

function normalizeBinding(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`bindings[${index}] must be an object.`);
  assertKnownKeys(input, new Set([
    'moduleId', 'localName', 'exportName', 'importedName', 'packageModuleId', 'packageName',
    'contractId', 'source', 'via', 'direct', 'used'
  ]), `bindings[${index}]`);
  const via = string(input.via, `bindings[${index}].via`);
  if (!PACKAGE_BINDING_VIA.includes(via)) throw new TypeError(`Unsupported package binding path ${via}.`);
  const normalized = {
    version: PACKAGE_BINDING_OWNERSHIP_VERSION,
    moduleId: string(input.moduleId, `bindings[${index}].moduleId`),
    localName: nullableString(input.localName, `bindings[${index}].localName`),
    exportName: nullableString(input.exportName, `bindings[${index}].exportName`),
    importedName: string(input.importedName, `bindings[${index}].importedName`),
    packageModuleId: string(input.packageModuleId, `bindings[${index}].packageModuleId`),
    packageName: normalizePackageName(input.packageName, `bindings[${index}].packageName`),
    contractId: nullableString(input.contractId, `bindings[${index}].contractId`),
    source: normalizeSourceLocation(input.source, `bindings[${index}].source`),
    via,
    direct: bool(input.direct, `bindings[${index}].direct`),
    used: bool(input.used, `bindings[${index}].used`)
  };
  if (normalized.localName === null && normalized.exportName === null) throw new TypeError(`bindings[${index}] requires localName or exportName.`);
  const stableInput = Object.freeze({
    version: PACKAGE_BINDING_OWNERSHIP_VERSION,
    moduleId: normalized.moduleId,
    localName: normalized.localName,
    exportName: normalized.exportName,
    importedName: normalized.importedName,
    packageModuleId: normalized.packageModuleId,
    packageName: normalized.packageName,
    contractId: normalized.contractId,
    source: normalized.source,
    via: normalized.via
  });
  return Object.freeze({ ...normalized, id: prefixedStableId('pkgbinding', stableInput, { length: 32 }) });
}

function normalizePackageReachabilityProjection(input) {
  if (!isPlainObject(input)) throw new TypeError('Package reachability projection must be an object.');
  assertKnownKeys(input, new Set(['graphVersion', 'graphHash', 'packages', 'bindings', 'selectedContracts']), 'Package reachability projection');
  const packages = Object.freeze([...(input.packages || [])].map(normalizePackageRecord)
    .sort((left, right) => left.packageName.localeCompare(right.packageName) || left.packageSubpath.localeCompare(right.packageSubpath) || left.moduleId.localeCompare(right.moduleId)));
  if (new Set(packages.map((entry) => entry.moduleId)).size !== packages.length) throw new TypeError('Package reachability module identities must be unique.');
  const bindings = Object.freeze([...(input.bindings || [])].map(normalizeBinding)
    .sort((left, right) => left.moduleId.localeCompare(right.moduleId) || (left.localName || left.exportName).localeCompare(right.localName || right.exportName) || left.id.localeCompare(right.id)));
  if (new Set(bindings.map((entry) => entry.id)).size !== bindings.length) throw new TypeError('Package binding identities must be unique.');
  const semantic = Object.freeze({
    version: PACKAGE_REACHABILITY_PROJECTION_VERSION,
    graphVersion: string(input.graphVersion, 'graphVersion'),
    graphHash: string(input.graphHash, 'graphHash'),
    packages,
    bindings,
    selectedContracts: strings(input.selectedContracts, 'selectedContracts'),
    policy: Object.freeze({
      packageUseFromResolvedReachabilityOnly: true,
      typeOnlyImportsActivateContracts: false,
      substringSelection: false,
      firstPartyLowerersOnly: true,
      publicPluginApi: false
    })
  });
  return Object.freeze({ ...semantic, projectionHash: sha256Hex(stableStringify(semantic)) });
}

function normalizeLifecycleEdge(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`lifecycleEdges[${index}] must be an object.`);
  assertKnownKeys(input, new Set(['edgeId', 'moduleId', 'packageModuleId', 'packageName', 'symbol', 'source']), `lifecycleEdges[${index}]`);
  return Object.freeze({
    edgeId: string(input.edgeId, `lifecycleEdges[${index}].edgeId`),
    moduleId: string(input.moduleId, `lifecycleEdges[${index}].moduleId`),
    packageModuleId: string(input.packageModuleId, `lifecycleEdges[${index}].packageModuleId`),
    packageName: normalizePackageName(input.packageName, `lifecycleEdges[${index}].packageName`),
    symbol: string(input.symbol, `lifecycleEdges[${index}].symbol`),
    source: normalizeSourceLocation(input.source, `lifecycleEdges[${index}].source`)
  });
}

function normalizeApplicationEntrySafety(input) {
  if (!isPlainObject(input)) throw new TypeError('Application entry safety projection must be an object.');
  assertKnownKeys(input, new Set(['graphHash', 'lifecycleEdges']), 'Application entry safety projection');
  const lifecycleEdges = Object.freeze([...(input.lifecycleEdges || [])].map(normalizeLifecycleEdge).sort(compareSource));
  const semantic = Object.freeze({
    version: APPLICATION_ENTRY_SAFETY_VERSION,
    graphHash: string(input.graphHash, 'graphHash'),
    importSafe: lifecycleEdges.length === 0,
    lifecycleEdges,
    firstLifecycleEdge: lifecycleEdges.length === 0 ? null : lifecycleEdges[0],
    policy: Object.freeze({
      knownPulseLifecycleOperationsOnly: true,
      arbitraryPurityAnalysis: false,
      lifecycleOwnership: 'provider',
      configuredEntryMustBeImportSafe: true
    })
  });
  return Object.freeze({ ...semantic, projectionHash: sha256Hex(stableStringify(semantic)) });
}

function normalizeEligibilityBlocker(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`blockers[${index}] must be an object.`);
  assertKnownKeys(input, new Set([
    'kind', 'code', 'moduleId', 'handlerIds', 'packageName', 'packageSubpath', 'contractId',
    'specifier', 'source', 'message'
  ]), `blockers[${index}]`);
  const kind = string(input.kind, `blockers[${index}].kind`);
  if (!ELIGIBILITY_BLOCKER_KINDS.includes(kind)) throw new TypeError(`Unsupported native eligibility blocker ${kind}.`);
  const normalized = {
    kind,
    code: string(input.code, `blockers[${index}].code`),
    moduleId: string(input.moduleId, `blockers[${index}].moduleId`),
    handlerIds: strings(input.handlerIds, `blockers[${index}].handlerIds`),
    packageName: nullableString(input.packageName, `blockers[${index}].packageName`),
    packageSubpath: input.packageSubpath == null ? null : normalizePackageSubpath(input.packageSubpath, `blockers[${index}].packageSubpath`),
    contractId: nullableString(input.contractId, `blockers[${index}].contractId`),
    specifier: string(input.specifier, `blockers[${index}].specifier`),
    source: normalizeSourceLocation(input.source, `blockers[${index}].source`),
    message: string(input.message, `blockers[${index}].message`)
  };
  const stableInput = Object.freeze({ version: NATIVE_ELIGIBILITY_PROJECTION_VERSION, ...normalized });
  return Object.freeze({ ...normalized, id: prefixedStableId('eligibility', stableInput, { length: 32 }) });
}

function normalizeHandlerEligibility(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`handlers[${index}] must be an object.`);
  assertKnownKeys(input, new Set(['handlerId', 'moduleId', 'eligible', 'blockerIds']), `handlers[${index}]`);
  return Object.freeze({
    handlerId: string(input.handlerId, `handlers[${index}].handlerId`),
    moduleId: string(input.moduleId, `handlers[${index}].moduleId`),
    eligible: bool(input.eligible, `handlers[${index}].eligible`),
    blockerIds: strings(input.blockerIds, `handlers[${index}].blockerIds`)
  });
}

function normalizeNativeEligibilityProjection(input) {
  if (!isPlainObject(input)) throw new TypeError('Native eligibility projection must be an object.');
  assertKnownKeys(input, new Set(['graphHash', 'blockers', 'handlers']), 'Native eligibility projection');
  const blockers = Object.freeze([...(input.blockers || [])].map(normalizeEligibilityBlocker).sort(compareSource));
  if (new Set(blockers.map((entry) => entry.id)).size !== blockers.length) throw new TypeError('Native eligibility blocker identities must be unique.');
  const handlers = Object.freeze([...(input.handlers || [])].map(normalizeHandlerEligibility)
    .sort((left, right) => left.handlerId.localeCompare(right.handlerId)));
  const semantic = Object.freeze({
    version: NATIVE_ELIGIBILITY_PROJECTION_VERSION,
    graphHash: string(input.graphHash, 'graphHash'),
    eligible: blockers.length === 0,
    blockers,
    firstUnsupportedBoundary: blockers.length === 0 ? null : blockers[0],
    handlers,
    policy: Object.freeze({
      automaticFallback: false,
      selectedTargetChangesEligibility: false,
      packageUseFromResolvedGraphOnly: true,
      routeProjectionDeferred: true
    })
  });
  return Object.freeze({ ...semantic, projectionHash: sha256Hex(stableStringify(semantic)) });
}

function defaultReachableGraphProjectionContract() {
  return Object.freeze({
    packageReachabilityVersion: PACKAGE_REACHABILITY_PROJECTION_VERSION,
    packageBindingVersion: PACKAGE_BINDING_OWNERSHIP_VERSION,
    applicationEntrySafetyVersion: APPLICATION_ENTRY_SAFETY_VERSION,
    nativeEligibilityVersion: NATIVE_ELIGIBILITY_PROJECTION_VERSION,
    packageNativeStatuses: PACKAGE_NATIVE_STATUSES,
    packageBindingPaths: PACKAGE_BINDING_VIA,
    eligibilityBlockerKinds: ELIGIBILITY_BLOCKER_KINDS,
    policies: Object.freeze({
      graphManifestVersionUnchanged: true,
      projectionsDerivedFromAuthoritativeGraph: true,
      packageLoweringSeamUnchanged: true,
      externalCompilerPlugins: false,
      automaticTargetFallback: false
    })
  });
}

module.exports = Object.freeze({
  PACKAGE_REACHABILITY_PROJECTION_VERSION,
  PACKAGE_BINDING_OWNERSHIP_VERSION,
  APPLICATION_ENTRY_SAFETY_VERSION,
  NATIVE_ELIGIBILITY_PROJECTION_VERSION,
  PACKAGE_NATIVE_STATUSES,
  PACKAGE_BINDING_VIA,
  ELIGIBILITY_BLOCKER_KINDS,
  normalizePackageReachabilityProjection,
  normalizeApplicationEntrySafety,
  normalizeNativeEligibilityProjection,
  defaultReachableGraphProjectionContract
});
