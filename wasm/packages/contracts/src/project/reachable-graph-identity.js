'use strict';

const { prefixedStableId, stableStringify, sha256Hex } = require('../stable-id.js');
const {
  normalizePortablePath,
  normalizeModuleSpecifier
} = require('./reachable-graph-resolver.js');

const REACHABLE_GRAPH_IDENTITY_VERSION = 'pulse.reachable-graph-identity.v1';
const MODULE_STABLE_INPUT_VERSION = 'pulse.reachable-module-stable-input.v1';
const EDGE_STABLE_INPUT_VERSION = 'pulse.reachable-edge-stable-input.v1';
const HANDLER_REFERENCE_V2_VERSION = 'pulse.handler-reference.v2';
const CYCLE_STABLE_INPUT_VERSION = 'pulse.reachable-cycle-stable-input.v1';
const UNSUPPORTED_BOUNDARY_STABLE_INPUT_VERSION = 'pulse.unsupported-module-boundary-stable-input.v1';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string.`);
  if (value.includes('\0')) throw new TypeError(`${field} must not contain NUL.`);
  return value.trim();
}

function assertSha256(value, field) {
  const text = assertString(value, field);
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`${field} must be a lowercase SHA-256 hex string.`);
  return text;
}

function nullableString(value, field) {
  return value == null ? null : assertString(value, field);
}

function sortedStrings(input, field) {
  if (input == null) return Object.freeze([]);
  if (!Array.isArray(input)) throw new TypeError(`${field} must be an array.`);
  return Object.freeze(Array.from(new Set(input.map((value, index) => assertString(value, `${field}[${index}]`)))).sort());
}

function normalizeSourceLocation(input, field = 'source') {
  if (!isPlainObject(input)) throw new TypeError(`${field} must be an object.`);
  const line = Number(input.line);
  const column = Number(input.column);
  if (!Number.isSafeInteger(line) || line < 1) throw new TypeError(`${field}.line must be a positive safe integer.`);
  if (!Number.isSafeInteger(column) || column < 1) throw new TypeError(`${field}.column must be a positive safe integer.`);
  return Object.freeze({
    file: normalizePortablePath(input.file, `${field}.file`),
    line,
    column
  });
}

function normalizePackageName(value, field = 'packageName') {
  const name = assertString(value, field);
  const pattern = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i;
  if (!pattern.test(name)) throw new TypeError(`${field} must be a valid package name.`);
  return name;
}

function normalizePackageSubpath(value, field = 'packageSubpath') {
  if (value == null || value === '' || value === '.') return '.';
  const text = assertString(value, field).replace(/\\/g, '/');
  const withPrefix = text.startsWith('./') ? text : `./${text}`;
  const pathPart = normalizePortablePath(withPrefix.slice(2), field);
  return `./${pathPart}`;
}

function moduleIdentityInput(input) {
  if (!isPlainObject(input)) throw new TypeError('Module identity input must be an object.');
  const kind = assertString(input.kind, 'module.kind');
  if (kind === 'project') {
    const modulePath = normalizePortablePath(input.path, 'module.path');
    return Object.freeze({
      artifact: MODULE_STABLE_INPUT_VERSION,
      kind,
      path: modulePath
    });
  }
  if (kind === 'package') {
    return Object.freeze({
      artifact: MODULE_STABLE_INPUT_VERSION,
      kind,
      packageName: normalizePackageName(input.packageName),
      packageVersion: assertString(input.packageVersion, 'module.packageVersion'),
      packageSubpath: normalizePackageSubpath(input.packageSubpath),
      packageManifestHash: assertSha256(input.packageManifestHash, 'module.packageManifestHash')
    });
  }
  if (kind === 'generated') {
    return Object.freeze({
      artifact: MODULE_STABLE_INPUT_VERSION,
      kind,
      generator: assertString(input.generator, 'module.generator'),
      logicalName: assertString(input.logicalName, 'module.logicalName')
    });
  }
  if (kind === 'external') {
    return Object.freeze({
      artifact: MODULE_STABLE_INPUT_VERSION,
      kind,
      specifier: normalizeModuleSpecifier(input.specifier, 'module.specifier')
    });
  }
  throw new TypeError(`Unsupported module identity kind ${kind}.`);
}

function createModuleIdentity(input) {
  const stableInput = moduleIdentityInput(input);
  const canonical = stableInput.kind === 'project'
    ? `project:${stableInput.path}`
    : stableInput.kind === 'package'
      ? `package:${stableInput.packageName}@${stableInput.packageVersion}:${stableInput.packageSubpath}`
      : stableInput.kind === 'generated'
        ? `generated:${stableInput.generator}:${stableInput.logicalName}`
        : `external:${stableInput.specifier}`;
  return Object.freeze({
    version: REACHABLE_GRAPH_IDENTITY_VERSION,
    id: prefixedStableId(`module_${stableInput.kind}`, stableInput, { length: 32 }),
    canonical,
    stableInput
  });
}

function createEdgeIdentity(input) {
  if (!isPlainObject(input)) throw new TypeError('Edge identity input must be an object.');
  const stableInput = Object.freeze({
    artifact: EDGE_STABLE_INPUT_VERSION,
    kind: assertString(input.kind, 'edge.kind'),
    from: assertString(input.from, 'edge.from'),
    to: assertString(input.to, 'edge.to'),
    specifier: normalizeModuleSpecifier(input.specifier, 'edge.specifier'),
    resolutionKind: assertString(input.resolutionKind, 'edge.resolutionKind'),
    runtime: Boolean(input.runtime),
    importedNames: sortedStrings(input.importedNames, 'edge.importedNames'),
    exportedNames: sortedStrings(input.exportedNames, 'edge.exportedNames'),
    packageContract: nullableString(input.packageContract, 'edge.packageContract'),
    source: normalizeSourceLocation(input.source, 'edge.source')
  });
  return Object.freeze({
    version: REACHABLE_GRAPH_IDENTITY_VERSION,
    id: prefixedStableId('edge', stableInput, { length: 32 }),
    stableInput
  });
}

function createHandlerReferenceIdentity(input) {
  if (!isPlainObject(input)) throw new TypeError('Handler reference identity input must be an object.');
  const stableInput = Object.freeze({
    artifact: HANDLER_REFERENCE_V2_VERSION,
    moduleId: assertString(input.moduleId, 'handler.moduleId'),
    exportName: nullableString(input.exportName, 'handler.exportName'),
    localName: nullableString(input.localName, 'handler.localName'),
    role: assertString(input.role, 'handler.role'),
    wrappers: sortedStrings(input.wrappers, 'handler.wrappers'),
    source: normalizeSourceLocation(input.source, 'handler.source')
  });
  if (stableInput.exportName === null && stableInput.localName === null) {
    throw new TypeError('Handler reference requires exportName or localName.');
  }
  return Object.freeze({
    version: REACHABLE_GRAPH_IDENTITY_VERSION,
    id: prefixedStableId('handlerref', stableInput, { length: 32 }),
    stableInput
  });
}

function createCycleIdentity(moduleIdsInput) {
  const moduleIds = sortedStrings(moduleIdsInput, 'cycle.modules');
  if (moduleIds.length === 0) throw new TypeError('cycle.modules must be non-empty.');
  const stableInput = Object.freeze({ artifact: CYCLE_STABLE_INPUT_VERSION, modules: moduleIds });
  return Object.freeze({
    version: REACHABLE_GRAPH_IDENTITY_VERSION,
    id: prefixedStableId('cycle', stableInput, { length: 32 }),
    stableInput
  });
}

function createUnsupportedBoundaryIdentity(input) {
  if (!isPlainObject(input)) throw new TypeError('Unsupported boundary identity input must be an object.');
  const stableInput = Object.freeze({
    artifact: UNSUPPORTED_BOUNDARY_STABLE_INPUT_VERSION,
    kind: assertString(input.kind, 'boundary.kind'),
    from: nullableString(input.from, 'boundary.from'),
    specifier: normalizeModuleSpecifier(input.specifier, 'boundary.specifier'),
    source: normalizeSourceLocation(input.source, 'boundary.source')
  });
  return Object.freeze({
    version: REACHABLE_GRAPH_IDENTITY_VERSION,
    id: prefixedStableId('boundary', stableInput, { length: 32 }),
    stableInput
  });
}

function graphSemanticHash(input) {
  return sha256Hex(stableStringify(input));
}

module.exports = Object.freeze({
  REACHABLE_GRAPH_IDENTITY_VERSION,
  MODULE_STABLE_INPUT_VERSION,
  EDGE_STABLE_INPUT_VERSION,
  HANDLER_REFERENCE_V2_VERSION,
  CYCLE_STABLE_INPUT_VERSION,
  UNSUPPORTED_BOUNDARY_STABLE_INPUT_VERSION,
  normalizeSourceLocation,
  normalizePackageName,
  normalizePackageSubpath,
  moduleIdentityInput,
  createModuleIdentity,
  createEdgeIdentity,
  createHandlerReferenceIdentity,
  createCycleIdentity,
  createUnsupportedBoundaryIdentity,
  graphSemanticHash
});
