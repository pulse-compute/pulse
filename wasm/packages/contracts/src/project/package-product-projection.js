
'use strict';

const { prefixedStableId, stableStringify, sha256Hex } = require('../stable-id.js');

const PACKAGE_PRODUCT_PROJECTION_VERSION = 'pulse.package-product-projection.v1';
const PACKAGE_PRODUCT_BINDING_VERSION = 'pulse.package-product-binding.v1';
const PACKAGE_FRAGMENT_OWNERSHIP_VERSION = 'pulse.package-fragment-ownership.v1';
const PACKAGE_BINDING_ROLES = Object.freeze(['authoring', 'helper', 're-export']);
const PACKAGE_COMPOSITION_STATUSES = Object.freeze(['supported', 'reserved', 'not-realized', 'unsupported']);

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
  return Object.freeze([...new Set(values.map((value, index) => string(value, `${field}[${index}]`)))].sort());
}

function source(input, field) {
  if (!isPlainObject(input)) throw new TypeError(`${field} must be an object.`);
  assertKnownKeys(input, new Set(['file', 'line', 'column']), field);
  return Object.freeze({
    file: string(input.file, `${field}.file`).replace(/\\/g, '/'),
    line: Number(input.line || 1),
    column: Number(input.column || 1)
  });
}

function normalizeTarget(input, field) {
  if (!isPlainObject(input)) throw new TypeError(`${field} must be an object.`);
  assertKnownKeys(input, new Set(['version', 'status', 'realization', 'entry', 'lowerableSubpath', 'providerRequirements', 'reasonCode']), field);
  return Object.freeze({
    status: string(input.status, `${field}.status`),
    realization: string(input.realization || 'none', `${field}.realization`),
    entry: nullableString(input.entry, `${field}.entry`),
    lowerableSubpath: nullableString(input.lowerableSubpath, `${field}.lowerableSubpath`),
    providerRequirements: strings(input.providerRequirements, `${field}.providerRequirements`),
    reasonCode: nullableString(input.reasonCode, `${field}.reasonCode`)
  });
}

function normalizeContract(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`contracts[${index}] must be an object.`);
  assertKnownKeys(input, new Set([
    'contractId', 'packageName', 'packageVersion', 'metadataHash', 'profileFragment',
    'helperImports', 'reExportImports', 'authoringImport', 'authoringSymbols',
    'compositionStatus', 'compositionHelper', 'compositionReasonCode',
    'nativeTarget', 'javascriptTarget', 'conformanceStatus', 'conformanceFixtureRoots', 'conformanceSemanticCases'
  ]), `contracts[${index}]`);
  const compositionStatus = string(input.compositionStatus, `contracts[${index}].compositionStatus`);
  if (!PACKAGE_COMPOSITION_STATUSES.includes(compositionStatus)) throw new TypeError(`Unsupported composition status ${compositionStatus}.`);
  return Object.freeze({
    contractId: string(input.contractId, `contracts[${index}].contractId`),
    packageName: string(input.packageName, `contracts[${index}].packageName`),
    packageVersion: string(input.packageVersion, `contracts[${index}].packageVersion`),
    metadataHash: string(input.metadataHash, `contracts[${index}].metadataHash`),
    profileFragment: string(input.profileFragment, `contracts[${index}].profileFragment`),
    helperImports: strings(input.helperImports, `contracts[${index}].helperImports`),
    reExportImports: strings(input.reExportImports, `contracts[${index}].reExportImports`),
    authoringImport: string(input.authoringImport, `contracts[${index}].authoringImport`),
    authoringSymbols: strings(input.authoringSymbols, `contracts[${index}].authoringSymbols`),
    compositionStatus,
    compositionHelper: nullableString(input.compositionHelper, `contracts[${index}].compositionHelper`),
    compositionReasonCode: nullableString(input.compositionReasonCode, `contracts[${index}].compositionReasonCode`),
    nativeTarget: normalizeTarget(input.nativeTarget, `contracts[${index}].nativeTarget`),
    javascriptTarget: normalizeTarget(input.javascriptTarget, `contracts[${index}].javascriptTarget`),
    conformanceStatus: string(input.conformanceStatus, `contracts[${index}].conformanceStatus`),
    conformanceFixtureRoots: strings(input.conformanceFixtureRoots, `contracts[${index}].conformanceFixtureRoots`),
    conformanceSemanticCases: strings(input.conformanceSemanticCases, `contracts[${index}].conformanceSemanticCases`)
  });
}

function normalizeBinding(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`bindings[${index}] must be an object.`);
  assertKnownKeys(input, new Set([
    'moduleId', 'localName', 'exportName', 'importedName', 'packageModuleId', 'packageName',
    'contractId', 'role', 'source', 'via', 'direct', 'used'
  ]), `bindings[${index}]`);
  const role = string(input.role, `bindings[${index}].role`);
  if (!PACKAGE_BINDING_ROLES.includes(role)) throw new TypeError(`Unsupported package product binding role ${role}.`);
  const semantic = Object.freeze({
    version: PACKAGE_PRODUCT_BINDING_VERSION,
    moduleId: string(input.moduleId, `bindings[${index}].moduleId`),
    localName: nullableString(input.localName, `bindings[${index}].localName`),
    exportName: nullableString(input.exportName, `bindings[${index}].exportName`),
    importedName: string(input.importedName, `bindings[${index}].importedName`),
    packageModuleId: string(input.packageModuleId, `bindings[${index}].packageModuleId`),
    packageName: string(input.packageName, `bindings[${index}].packageName`),
    contractId: string(input.contractId, `bindings[${index}].contractId`),
    role,
    source: source(input.source, `bindings[${index}].source`),
    via: string(input.via, `bindings[${index}].via`),
    direct: bool(input.direct, `bindings[${index}].direct`),
    used: bool(input.used, `bindings[${index}].used`)
  });
  return Object.freeze({ ...semantic, id: prefixedStableId('pkgproduct', semantic, { length: 32 }) });
}

function normalizeFragment(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`fragments[${index}] must be an object.`);
  assertKnownKeys(input, new Set(['key', 'contractId', 'packageName', 'present', 'selected']), `fragments[${index}]`);
  return Object.freeze({
    version: PACKAGE_FRAGMENT_OWNERSHIP_VERSION,
    key: string(input.key, `fragments[${index}].key`),
    contractId: nullableString(input.contractId, `fragments[${index}].contractId`),
    packageName: nullableString(input.packageName, `fragments[${index}].packageName`),
    present: bool(input.present, `fragments[${index}].present`),
    selected: bool(input.selected, `fragments[${index}].selected`)
  });
}

function normalizePackageProductProjection(input) {
  if (!isPlainObject(input)) throw new TypeError('Package product projection must be an object.');
  assertKnownKeys(input, new Set(['graphHash', 'contracts', 'bindings', 'fragments', 'selectedContracts', 'composedContracts']), 'Package product projection');
  const contracts = Object.freeze([...(input.contracts || [])].map(normalizeContract)
    .sort((a, b) => a.contractId.localeCompare(b.contractId)));
  const bindings = Object.freeze([...(input.bindings || [])].map(normalizeBinding)
    .sort((a, b) => a.moduleId.localeCompare(b.moduleId) || (a.localName || a.exportName || '').localeCompare(b.localName || b.exportName || '') || a.id.localeCompare(b.id)));
  const fragments = Object.freeze([...(input.fragments || [])].map(normalizeFragment)
    .sort((a, b) => a.key.localeCompare(b.key)));
  const semantic = Object.freeze({
    version: PACKAGE_PRODUCT_PROJECTION_VERSION,
    graphHash: string(input.graphHash, 'graphHash'),
    contracts,
    bindings,
    fragments,
    selectedContracts: strings(input.selectedContracts, 'selectedContracts'),
    composedContracts: strings(input.composedContracts, 'composedContracts'),
    policy: Object.freeze({
      graphOwnsAttribution: true,
      productMetadataExecutesCode: false,
      helperOwnershipUnique: true,
      profileFragmentOwnershipUnique: true,
      nativeLoweringTrustSeparate: true,
      automaticFallback: false
    })
  });
  return Object.freeze({ ...semantic, projectionHash: sha256Hex(stableStringify(semantic)) });
}

module.exports = Object.freeze({
  PACKAGE_PRODUCT_PROJECTION_VERSION,
  PACKAGE_PRODUCT_BINDING_VERSION,
  PACKAGE_FRAGMENT_OWNERSHIP_VERSION,
  PACKAGE_BINDING_ROLES,
  normalizePackageProductProjection
});
