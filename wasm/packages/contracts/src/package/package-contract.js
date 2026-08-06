'use strict';

const {
  CANONICAL_PACKAGE_EFFECT_VERSION
} = require('../handler/canonical-runtime.js');

const PACKAGE_CONTRACT_VERSION = 'pulse.package-contract.v1';
const PACKAGE_REALIZATION_ARTIFACT_SET_VERSION = 'pulse.package-realization-artifact-set.v1';
const PACKAGE_CONTRACT_KIND = 'pulse.package-contract';
const PACKAGE_TARGET_SUPPORT_VERSION = 'pulse.package-target-support.v1';
const PACKAGE_COMPOSITION_VERSION = 'pulse.package-composition.v1';
const PACKAGE_CONFORMANCE_VERSION = 'pulse.package-conformance.v1';
const PACKAGE_CONTRACT_CATALOG_VERSION = 'pulse.package-contract-catalog.v2';
const PACKAGE_CONTRACT_DISCOVERY_VERSION = 'pulse.package-contract-discovery.v1';
const PACKAGE_PRODUCT_METADATA_PACKAGE_POLICY = 'any-static-npm-package';
const PACKAGE_NATIVE_LOWERING_TRUST_POLICY = 'first-party-only';
const PROFILE_TOKEN_POLICY = 'opaque-direct-use';
const CANONICAL_PACKAGE_OPERATION_VERSION = 'pulse.canonical-package-operation.v1';
const PACKAGE_LOWERING_BUNDLE_VERSION = 'pulse.package-lowering-bundle.v1';
const PACKAGE_INTRINSIC_VERSION = 'pulse.package-intrinsic.v1';
const PACKAGE_CRYPTO_REQUIREMENT_VERSION = 'pulse.package-crypto-requirement.v1';
const PROVIDER_REQUIREMENT_RECORD_VERSION = 'pulse.provider-requirement-record.v1';
const GUEST_UNIT_CONTRIBUTION_VERSION = 'pulse.guest-unit-contribution.v1';
const PACKAGE_BUILDER_INVOCATION_VERSION = 'pulse.package-builder-invocation.v1';
const PACKAGE_BUILDER_RESULT_VERSION = 'pulse.package-builder-result.v1';
const PACKAGE_INSPECTION_ARTIFACT_VERSION = 'pulse.package-inspection-artifact.v1';
const CANONICAL_PACKAGE_INSPECTION_VERSION = 'pulse.canonical-package-inspection.v1';
const PACKAGE_MANAGED_HANDLER_DESCRIPTOR_VERSION = 'pulse.managed-handler-descriptor.v1';

const PACKAGE_BUILDER_INVOCATION_FIELDS = Object.freeze([
  'version',
  'cwd',
  'workspaceRoot',
  'sourcePath',
  'sourceText',
  'sourceFile',
  'typescript',
  'manifest',
  'libraryContracts',
  'packageCompilerBuilder',
  'generatedBy',
  'routePlan',
  'schemaBundle'
]);
const PACKAGE_BUILDER_RAW_RESULT_FIELDS = Object.freeze([
  'artifact',
  'entries',
  'canonicalEffects',
  'canonicalIntrinsics',
  'schemaReferences',
  'cryptoRequirements',
  'keyArtifacts',
  'realizationArtifacts',
  'inspectionArtifacts',
  'managedHandlers',
  'guestUnits',
  'resultAdapters',
  'diagnostics',
  'warnings',
  'unsupported',
  'payloadModes',
  'manifest',
  'packageCompilerBuilder',
  'dependencies',
  'hasErrors'
]);
const CANONICAL_PACKAGE_EFFECT_FIELDS = Object.freeze([
  'version',
  'contractId',
  'package',
  'import',
  'kind',
  'providerKind',
  'operation',
  'capability',
  'result',
  'placement',
  'range',
  'resource',
  'payload',
  'runtimeInputs',
  'providerRequirements',
  'schemaReferences',
  'redaction',
  'clock',
  'loc'
]);
const CANONICAL_PACKAGE_OPERATION_FIELDS = Object.freeze([
  'version',
  'id',
  'order',
  'contractId',
  'package',
  'lowerableSubpath',
  'kind',
  'providerKind',
  'operation',
  'capability',
  'result',
  'placement',
  'range',
  'resource',
  'payload',
  'runtimeInputs',
  'source',
  'hostCapabilities',
  'providerRequirements',
  'schemaReferences',
  'canonicalEffect'
]);
const PROVIDER_REQUIREMENT_RECORD_FIELDS = Object.freeze([
  'version',
  'authorityVersion',
  'planVersion',
  'planHash',
  'providerNeutral',
  'capabilities',
  'providerKinds',
  'operations',
  'packageEffects',
  'packages',
  'packageOperationIds',
  'hostCapabilities',
  'policy'
]);
const GUEST_UNIT_CONTRIBUTION_FIELDS = Object.freeze([
  'version',
  'id',
  'manifest',
  'owner',
  'packageVersion',
  'origin'
]);

const TARGET_STATUSES = Object.freeze(['supported', 'provider-dependent', 'not-realized', 'unsupported']);
const REALIZATION_KINDS = Object.freeze(['canonical-package-lowering', 'javascript-package-runtime', 'provider-runtime', 'none']);
const COMPOSITION_STATUSES = Object.freeze(['supported', 'reserved', 'not-realized', 'unsupported']);
const CONFORMANCE_STATUSES = Object.freeze(['native-contract-only', 'target-overlap', 'not-realized']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length > 0) throw new TypeError(`${field} contains unsupported field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
}

function ownDataProperties(value, field) {
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length > 0) throw new TypeError(`${field} must not contain symbol fields.`);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`${field}.${key} must be an enumerable data property.`);
    }
  }
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${field} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value, field) {
  if (value == null) return null;
  return nonEmptyString(value, field);
}

function sortedUnique(values, field) {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array.`);
  const normalized = values.map((value, index) => nonEmptyString(value, `${field}[${index}]`));
  return Object.freeze([...new Set(normalized)].sort());
}

function immutableData(value, field, seen = new Set()) {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${field} must contain only finite numbers.`);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${field} must contain only immutable data values.`);
  if (seen.has(value)) throw new TypeError(`${field} must not contain cycles.`);
  seen.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((entry, index) => immutableData(entry, `${field}[${index}]`, seen));
  } else {
    if (!isPlainObject(value)) throw new TypeError(`${field} must contain only ordinary objects.`);
    ownDataProperties(value, field);
    normalized = Object.fromEntries(Object.keys(value)
      .sort()
      .map((key) => [key, immutableData(value[key], `${field}.${key}`, seen)]));
  }
  seen.delete(value);
  return deepFreeze(normalized);
}

function optionalImmutableData(value, field) {
  return value == null ? null : immutableData(value, field);
}

function assertSortedUnique(values, field) {
  const normalized = sortedUnique(values, field);
  if (normalized.length !== values.length || normalized.some((value, index) => value !== values[index])) {
    throw new TypeError(`${field} must be sorted and contain no duplicates.`);
  }
  return normalized;
}

function packageName(value, field) {
  const normalized = nonEmptyString(value, field);
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(normalized)) throw new TypeError(`${field} must be a valid npm package name.`);
  return normalized;
}

function contractId(value, field) {
  const normalized = nonEmptyString(value, field);
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(normalized)) throw new TypeError(`${field} must be a stable dotted contract identity.`);
  return normalized;
}

function fragmentKey(value, field) {
  const normalized = nonEmptyString(value, field);
  if (!/^[a-z][a-z0-9-]*$/.test(normalized)) throw new TypeError(`${field} must be a lowercase profile-fragment key.`);
  return normalized;
}

function packageSpecifier(value, field) {
  const normalized = nonEmptyString(value, field);
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*$/.test(normalized)) {
    throw new TypeError(`${field} must be a package root or subpath.`);
  }
  return normalized;
}

function packageRelativePath(value, field) {
  const normalized = nonEmptyString(value, field).replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new TypeError(`${field} must remain package-relative.`);
  }
  return normalized.startsWith('./') ? normalized : `./${normalized}`;
}

function normalizePackageBuilderAuthority(authority = {}) {
  if (!isPlainObject(authority)) throw new TypeError('Package builder authority must be an object.');
  assertKnownKeys(authority, ['contractId', 'npmPackage', 'lowerableSubpath', 'hostCapabilities'], 'package builder authority');
  return deepFreeze({
    contractId: contractId(authority.contractId, 'package builder authority.contractId'),
    npmPackage: packageName(authority.npmPackage, 'package builder authority.npmPackage'),
    lowerableSubpath: packageSpecifier(authority.lowerableSubpath, 'package builder authority.lowerableSubpath')
  });
}

function normalizePackageCompilerBuilder(input, authority) {
  if (!isPlainObject(input)) throw new TypeError('packageCompilerBuilder must be an object.');
  assertKnownKeys(input, ['owner', 'entry', 'export', 'trust'], 'packageCompilerBuilder');
  ownDataProperties(input, 'packageCompilerBuilder');
  const normalized = {
    owner: packageName(input.owner, 'packageCompilerBuilder.owner'),
    entry: nonEmptyString(input.entry, 'packageCompilerBuilder.entry').replace(/\\/g, '/'),
    export: nonEmptyString(input.export, 'packageCompilerBuilder.export'),
    trust: nonEmptyString(input.trust, 'packageCompilerBuilder.trust')
  };
  if (normalized.owner !== authority.npmPackage) throw new TypeError('packageCompilerBuilder.owner must equal the manifest npmPackage.');
  if (normalized.trust !== 'first-party') throw new TypeError('packageCompilerBuilder.trust must be first-party.');
  return deepFreeze(normalized);
}

function normalizePackageBuilderInvocation(input, authorityInput = {}) {
  if (!isPlainObject(input)) throw new TypeError('Package builder invocation must be an object.');
  assertKnownKeys(input, PACKAGE_BUILDER_INVOCATION_FIELDS, 'package builder invocation');
  ownDataProperties(input, 'package builder invocation');
  if (input.version !== PACKAGE_BUILDER_INVOCATION_VERSION) {
    throw new TypeError(`Package builder invocation must use ${PACKAGE_BUILDER_INVOCATION_VERSION}.`);
  }
  const authority = normalizePackageBuilderAuthority(authorityInput);
  if (!isPlainObject(input.manifest)) throw new TypeError('package builder invocation.manifest must be an object.');
  if (
    input.manifest.contractId !== authority.contractId
    || input.manifest.npmPackage !== authority.npmPackage
    || input.manifest.lowerableSubpath !== authority.lowerableSubpath
  ) {
    throw new TypeError('Package builder invocation manifest identity must equal its selected authority.');
  }
  if (input.sourceFile != null && typeof input.sourceFile !== 'object') {
    throw new TypeError('package builder invocation.sourceFile must be a compiler-owned source file or null.');
  }
  if (input.typescript != null && typeof input.typescript !== 'object') {
    throw new TypeError('package builder invocation.typescript must be the compiler-owned TypeScript API or null.');
  }
  const sourcePath = nonEmptyString(input.sourcePath, 'package builder invocation.sourcePath').replace(/\\/g, '/');
  const sourceText = typeof input.sourceText === 'string'
    ? input.sourceText
    : (() => { throw new TypeError('package builder invocation.sourceText must be a string.'); })();
  const libraryContracts = immutableData(input.libraryContracts || [], 'package builder invocation.libraryContracts');
  if (!Array.isArray(libraryContracts)) throw new TypeError('package builder invocation.libraryContracts must be an array.');
  return Object.freeze({
    version: PACKAGE_BUILDER_INVOCATION_VERSION,
    cwd: nonEmptyString(input.cwd, 'package builder invocation.cwd').replace(/\\/g, '/'),
    workspaceRoot: input.workspaceRoot == null
      ? null
      : nonEmptyString(input.workspaceRoot, 'package builder invocation.workspaceRoot').replace(/\\/g, '/'),
    sourcePath,
    sourceText,
    // TypeScript owns these syntax objects. The exact invocation envelope is
    // immutable; builders receive no Program, language service, cache, CLI
    // configuration, provider descriptor, or runtime object.
    sourceFile: input.sourceFile || null,
    typescript: input.typescript || null,
    manifest: immutableData(input.manifest, 'package builder invocation.manifest'),
    libraryContracts,
    packageCompilerBuilder: normalizePackageCompilerBuilder(input.packageCompilerBuilder, authority),
    generatedBy: nonEmptyString(input.generatedBy, 'package builder invocation.generatedBy'),
    routePlan: optionalImmutableData(input.routePlan, 'package builder invocation.routePlan'),
    schemaBundle: optionalImmutableData(input.schemaBundle, 'package builder invocation.schemaBundle')
  });
}

function sourceOrder(value) {
  const range = value && value.range;
  return range && Number.isSafeInteger(range.start) ? range.start : Number.MAX_SAFE_INTEGER;
}

function assertSourceOrdered(values, field) {
  let previous = -1;
  for (const [index, value] of values.entries()) {
    const current = sourceOrder(value);
    if (current < previous) throw new TypeError(`${field} must remain in deterministic source order.`);
    previous = current;
    if (!isPlainObject(value)) throw new TypeError(`${field}[${index}] must be an object.`);
  }
}

function artifactPackageIdentity(artifact) {
  const packageValue = artifact.package === undefined ? artifact.npmPackage : artifact.package;
  return packageValue === undefined ? '' : String(packageValue);
}

function assertNoForbiddenBoundaryFields(value, field) {
  const forbidden = new Set([
    'targetDescriptor',
    'packageTarget',
    'providerDriver',
    'runtimeObject',
    'rawCliConfig',
    'compilerCache',
    'program',
    'languageService',
    'typeChecker',
    'resolvedSecret',
    'resolvedSecrets',
    'secretValue',
    'secretValues'
  ]);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenBoundaryFields(entry, `${field}[${index}]`));
    return;
  }
  for (const key of Object.keys(value)) {
    if (forbidden.has(key)) throw new TypeError(`${field} must not contain compiler, provider, runtime, or resolved-secret field ${key}.`);
    assertNoForbiddenBoundaryFields(value[key], `${field}.${key}`);
  }
}

function normalizePackageBuilderResult(input, authorityInput = {}) {
  if (!isPlainObject(input)) throw new TypeError('Package builder result must be an object.');
  assertKnownKeys(input, PACKAGE_BUILDER_RAW_RESULT_FIELDS, 'package builder result');
  ownDataProperties(input, 'package builder result');
  const authority = normalizePackageBuilderAuthority(authorityInput);
  if (!isPlainObject(input.artifact)) throw new TypeError('package builder result.artifact must be an object.');
  if (
    input.artifact.contractId !== authority.contractId
    || artifactPackageIdentity(input.artifact) !== authority.npmPackage
    || (
      input.artifact.lowerableSubpath !== undefined
      && input.artifact.lowerableSubpath !== authority.lowerableSubpath
    )
  ) {
    throw new TypeError('Package builder result artifact identity must equal its selected authority.');
  }
  if (typeof input.artifact.version !== 'string' || input.artifact.version.length === 0) {
    throw new TypeError('package builder result.artifact.version must be a non-empty package-owned identity.');
  }
  if (!['ok', 'error'].includes(String(input.artifact.status || ''))) {
    throw new TypeError('package builder result.artifact.status must be ok or error.');
  }
  assertNoForbiddenBoundaryFields(input.artifact, 'package builder result.artifact');
  const array = (name) => {
    const value = input[name] == null ? [] : input[name];
    if (!Array.isArray(value)) throw new TypeError(`package builder result.${name} must be an array.`);
    const normalized = immutableData(value, `package builder result.${name}`);
    assertNoForbiddenBoundaryFields(normalized, `package builder result.${name}`);
    return normalized;
  };
  const canonicalEffects = Object.freeze(array('canonicalEffects')
    .map((entry) => normalizeCanonicalPackageEffect(entry, authority)));
  const canonicalIntrinsics = array('canonicalIntrinsics');
  assertSourceOrdered(canonicalEffects, 'package builder result.canonicalEffects');
  assertSourceOrdered(canonicalIntrinsics, 'package builder result.canonicalIntrinsics');
  const diagnostics = array('diagnostics');
  const warnings = array('warnings');
  const hasErrors = input.hasErrors === undefined
    ? diagnostics.some((entry) => String(entry && entry.severity || 'error') === 'error')
    : input.hasErrors;
  if (typeof hasErrors !== 'boolean') throw new TypeError('package builder result.hasErrors must be a boolean.');
  if (hasErrors !== diagnostics.some((entry) => String(entry && entry.severity || 'error') === 'error')) {
    throw new TypeError('package builder result.hasErrors must equal its normalized diagnostic error state.');
  }
  return deepFreeze({
    version: PACKAGE_BUILDER_RESULT_VERSION,
    contractId: authority.contractId,
    npmPackage: authority.npmPackage,
    lowerableSubpath: authority.lowerableSubpath,
    artifact: immutableData(input.artifact, 'package builder result.artifact'),
    contributions: {
      canonicalEffects,
      canonicalIntrinsics,
      resultAdapters: array('resultAdapters'),
      schemaReferences: array('schemaReferences'),
      cryptoRequirements: array('cryptoRequirements'),
      realizationArtifacts: array('realizationArtifacts'),
      inspectionArtifacts: array('inspectionArtifacts'),
      managedHandlers: array('managedHandlers'),
      guestUnits: Object.freeze(array('guestUnits').map(normalizeCanonicalGuestUnitContribution))
    },
    diagnostics,
    warnings,
    hasErrors
  });
}

function normalizeCanonicalRuntimeInputs(values) {
  if (values == null) return Object.freeze([]);
  if (!Array.isArray(values)) throw new TypeError('canonical package effect.runtimeInputs must be an array.');
  const names = new Set();
  return Object.freeze(values.map((input, index) => {
    if (!isPlainObject(input)) throw new TypeError(`canonical package effect.runtimeInputs[${index}] must be an object.`);
    assertKnownKeys(input, ['name', 'argumentIndex', 'source'], `canonical package effect.runtimeInputs[${index}]`);
    ownDataProperties(input, `canonical package effect.runtimeInputs[${index}]`);
    const normalized = {
      name: nonEmptyString(input.name, `canonical package effect.runtimeInputs[${index}].name`),
      argumentIndex: input.argumentIndex,
      source: nonEmptyString(input.source, `canonical package effect.runtimeInputs[${index}].source`)
    };
    if (names.has(normalized.name)) throw new TypeError('canonical package effect.runtimeInputs names must be unique.');
    if (!Number.isSafeInteger(normalized.argumentIndex) || normalized.argumentIndex < 0) {
      throw new TypeError('canonical package effect.runtimeInputs argument indexes must be non-negative integers.');
    }
    if (normalized.source !== 'package-call-argument') {
      throw new TypeError('canonical package effect.runtimeInputs source must be package-call-argument.');
    }
    names.add(normalized.name);
    return deepFreeze(normalized);
  }));
}

function normalizeCanonicalPackageEffect(input, authorityInput = {}) {
  if (!isPlainObject(input)) throw new TypeError('Canonical package effect must be an object.');
  assertKnownKeys(input, CANONICAL_PACKAGE_EFFECT_FIELDS, 'canonical package effect');
  ownDataProperties(input, 'canonical package effect');
  if (input.version !== CANONICAL_PACKAGE_EFFECT_VERSION) {
    throw new TypeError(`Canonical package effect must use ${CANONICAL_PACKAGE_EFFECT_VERSION}.`);
  }
  const authority = normalizePackageBuilderAuthority(authorityInput);
  if (
    input.contractId !== authority.contractId
    || input.package !== authority.npmPackage
    || input.import !== authority.lowerableSubpath
  ) {
    throw new TypeError('Canonical package effect identity must equal its manifest authority.');
  }
  for (const field of ['kind', 'providerKind', 'operation', 'capability', 'result', 'placement']) {
    nonEmptyString(input[field], `canonical package effect.${field}`);
  }
  if (
    !isPlainObject(input.range)
    || !Number.isSafeInteger(input.range.start)
    || !Number.isSafeInteger(input.range.end)
    || input.range.start < 0
    || input.range.end < input.range.start
  ) {
    throw new TypeError('canonical package effect.range must contain a bounded start and end.');
  }
  const providerRequirements = sortedUnique(input.providerRequirements || [], 'canonical package effect.providerRequirements');
  return deepFreeze({
    ...immutableData(input, 'canonical package effect'),
    runtimeInputs: normalizeCanonicalRuntimeInputs(input.runtimeInputs),
    providerRequirements
  });
}

function createCanonicalPackageOperation(effectInput, authorityInput = {}, order) {
  if (!Number.isSafeInteger(order) || order < 1) throw new TypeError('Canonical package operation order must be a positive integer.');
  const authority = normalizePackageBuilderAuthority(authorityInput);
  const effect = normalizeCanonicalPackageEffect(effectInput, authority);
  const hostCapabilities = sortedUnique(authorityInput.hostCapabilities || [], 'canonical package operation.hostCapabilities');
  return deepFreeze({
    version: CANONICAL_PACKAGE_OPERATION_VERSION,
    id: `${authority.contractId}:${order}:${effect.kind}`,
    order,
    contractId: authority.contractId,
    package: authority.npmPackage,
    lowerableSubpath: authority.lowerableSubpath,
    kind: effect.kind,
    providerKind: effect.providerKind,
    operation: effect.operation,
    capability: effect.capability,
    result: effect.result,
    placement: effect.placement,
    range: effect.range,
    resource: effect.resource,
    payload: effect.payload,
    runtimeInputs: effect.runtimeInputs,
    source: effect.loc,
    hostCapabilities,
    providerRequirements: effect.providerRequirements,
    schemaReferences: Object.freeze((effect.schemaReferences || []).map((entry, index) => immutableData(entry, `canonical package effect.schemaReferences[${index}]`))),
    canonicalEffect: effect
  });
}

function normalizeCanonicalPackageOperation(input, authorityInput) {
  if (!isPlainObject(input)) throw new TypeError('Canonical package operation must be an object.');
  assertKnownKeys(input, CANONICAL_PACKAGE_OPERATION_FIELDS, 'canonical package operation');
  ownDataProperties(input, 'canonical package operation');
  if (input.version !== CANONICAL_PACKAGE_OPERATION_VERSION) {
    throw new TypeError(`Canonical package operation must use ${CANONICAL_PACKAGE_OPERATION_VERSION}.`);
  }
  const authority = normalizePackageBuilderAuthority(authorityInput || {
    contractId: input.contractId,
    npmPackage: input.package,
    lowerableSubpath: input.lowerableSubpath
  });
  const effect = normalizeCanonicalPackageEffect(input.canonicalEffect, authority);
  const expected = createCanonicalPackageOperation(effect, {
    ...authority,
    hostCapabilities: input.hostCapabilities
  }, input.order);
  const actual = immutableData(input, 'canonical package operation');
  const canonicalExpected = immutableData(expected, 'canonical package operation expected');
  if (JSON.stringify(actual) !== JSON.stringify(canonicalExpected)) {
    throw new TypeError('Canonical package operation fields must exactly match its owned effect and deterministic identity.');
  }
  return expected;
}

function normalizePackageLoweringBundle(input) {
  if (!isPlainObject(input)) throw new TypeError('Package lowering bundle must be an object.');
  assertKnownKeys(input, [
    'inputVersion',
    'operations',
    'packages',
    'schemaReferences',
    'realizationArtifacts',
    'guestUnits',
    'cryptoRequirements'
  ], 'package lowering bundle input');
  ownDataProperties(input, 'package lowering bundle input');
  const operations = (input.operations || []).map((operation) => normalizeCanonicalPackageOperation(operation));
  for (const [index, operation] of operations.entries()) {
    if (operation.order !== index + 1) throw new TypeError('Canonical package operations must be contiguous and source ordered.');
  }
  const packages = immutableData(input.packages || [], 'package lowering bundle.packages')
    .slice()
    .sort((left, right) => String(left.contractId || '').localeCompare(String(right.contractId || '')));
  const byId = (name) => immutableData(input[name] || [], `package lowering bundle.${name}`)
    .slice()
    .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));
  const cryptoRequirements = immutableData(input.cryptoRequirements || [], 'package lowering bundle.cryptoRequirements')
    .slice()
    .sort((left, right) => String(left.requestedBy || '').localeCompare(String(right.requestedBy || ''))
      || String(left.semanticOwner || '').localeCompare(String(right.semanticOwner || '')));
  return deepFreeze({
    version: PACKAGE_LOWERING_BUNDLE_VERSION,
    inputVersion: nonEmptyString(input.inputVersion, 'package lowering bundle.inputVersion'),
    operationVersion: CANONICAL_PACKAGE_OPERATION_VERSION,
    operations,
    packages,
    effects: operations.map((operation) => operation.canonicalEffect),
    requiredHostCapabilities: sortedUnique(operations.flatMap((operation) => operation.hostCapabilities), 'package lowering bundle.requiredHostCapabilities'),
    requiredProviderCapabilities: sortedUnique(operations.flatMap((operation) => operation.providerRequirements), 'package lowering bundle.requiredProviderCapabilities'),
    schemaReferences: immutableData(input.schemaReferences || [], 'package lowering bundle.schemaReferences'),
    realizationArtifacts: byId('realizationArtifacts'),
    guestUnits: byId('guestUnits'),
    cryptoRequirements,
    policy: {
      sourceAstAccepted: false,
      sourceTextAccepted: false,
      canonicalOperationsOnly: true,
      publicPluginApi: false,
      dynamicRegistration: false
    }
  });
}

function normalizeProviderRequirementRecord(input) {
  if (!isPlainObject(input)) throw new TypeError('Provider requirement record must be an object.');
  assertKnownKeys(input, PROVIDER_REQUIREMENT_RECORD_FIELDS, 'provider requirement record');
  ownDataProperties(input, 'provider requirement record');
  if (input.version !== PROVIDER_REQUIREMENT_RECORD_VERSION) {
    throw new TypeError(`Provider requirement record must use ${PROVIDER_REQUIREMENT_RECORD_VERSION}.`);
  }
  if (input.providerNeutral !== true) throw new TypeError('Provider requirement record must remain provider-neutral.');
  const policy = input.policy;
  if (!isPlainObject(policy)) throw new TypeError('provider requirement record.policy must be an object.');
  const expectedPolicy = {
    providerSelected: false,
    providerNeutralPlanRequired: true,
    sourceAstAccepted: false,
    sourceTextAccepted: false,
    canonicalPlanOnly: true,
    packageLoweringBundleOnly: true
  };
  assertKnownKeys(policy, Object.keys(expectedPolicy), 'provider requirement record.policy');
  for (const [key, expected] of Object.entries(expectedPolicy)) {
    if (policy[key] !== expected) throw new TypeError(`provider requirement record.policy.${key} must be ${expected}.`);
  }
  return deepFreeze({
    version: PROVIDER_REQUIREMENT_RECORD_VERSION,
    authorityVersion: nonEmptyString(input.authorityVersion, 'provider requirement record.authorityVersion'),
    planVersion: nonEmptyString(input.planVersion, 'provider requirement record.planVersion'),
    planHash: nonEmptyString(input.planHash, 'provider requirement record.planHash'),
    providerNeutral: true,
    capabilities: assertSortedUnique(input.capabilities || [], 'provider requirement record.capabilities'),
    providerKinds: assertSortedUnique(input.providerKinds || [], 'provider requirement record.providerKinds'),
    operations: immutableData(input.operations || [], 'provider requirement record.operations'),
    packageEffects: immutableData(input.packageEffects || [], 'provider requirement record.packageEffects'),
    packages: immutableData(input.packages || [], 'provider requirement record.packages')
      .slice()
      .sort((left, right) => String(left.contractId || '').localeCompare(String(right.contractId || ''))
        || String(left.package || '').localeCompare(String(right.package || ''))),
    packageOperationIds: immutableData(input.packageOperationIds || [], 'provider requirement record.packageOperationIds'),
    hostCapabilities: assertSortedUnique(input.hostCapabilities || [], 'provider requirement record.hostCapabilities'),
    policy: expectedPolicy
  });
}

function normalizeGuestUnitContribution(input, authority = {}) {
  if (!isPlainObject(input)) throw new TypeError('Guest-unit contribution must be an object.');
  assertKnownKeys(input, ['version', 'id', 'manifest'], 'guest-unit contribution');
  if (input.version !== GUEST_UNIT_CONTRIBUTION_VERSION) {
    throw new TypeError(`Guest-unit contribution must use ${GUEST_UNIT_CONTRIBUTION_VERSION}.`);
  }
  const id = contractId(input.id, 'guest-unit contribution.id');
  const owner = packageName(authority.owner, 'guest-unit contribution authority.owner');
  const packageVersion = nonEmptyString(authority.packageVersion, 'guest-unit contribution authority.packageVersion');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageVersion)) {
    throw new TypeError('guest-unit contribution authority.packageVersion must be an exact semantic version.');
  }
  return deepFreeze({
    version: GUEST_UNIT_CONTRIBUTION_VERSION,
    id,
    manifest: packageRelativePath(input.manifest, 'guest-unit contribution.manifest'),
    owner,
    packageVersion,
    origin: 'package-prebuilt'
  });
}

function normalizeCanonicalGuestUnitContribution(input) {
  if (!isPlainObject(input)) throw new TypeError('Canonical guest-unit contribution must be an object.');
  assertKnownKeys(input, GUEST_UNIT_CONTRIBUTION_FIELDS, 'canonical guest-unit contribution');
  ownDataProperties(input, 'canonical guest-unit contribution');
  if (input.origin !== 'package-prebuilt') {
    throw new TypeError('canonical guest-unit contribution.origin must be package-prebuilt.');
  }
  const normalized = normalizeGuestUnitContribution({
    version: input.version,
    id: input.id,
    manifest: input.manifest
  }, {
    owner: input.owner,
    packageVersion: input.packageVersion
  });
  for (const field of GUEST_UNIT_CONTRIBUTION_FIELDS) {
    if (input[field] !== normalized[field]) {
      throw new TypeError(`Canonical guest-unit contribution.${field} must match its normalized value.`);
    }
  }
  return normalized;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeTarget(name, input = {}) {
  if (!isPlainObject(input)) throw new TypeError(`targets.${name} must be an object.`);
  assertKnownKeys(input, ['version', 'status', 'realization', 'entry', 'lowerableSubpath', 'providerRequirements', 'reasonCode'], `targets.${name}`);
  if (input.version != null && input.version !== PACKAGE_TARGET_SUPPORT_VERSION) throw new TypeError(`targets.${name}.version must be ${PACKAGE_TARGET_SUPPORT_VERSION}.`);
  const status = nonEmptyString(input.status, `targets.${name}.status`);
  if (!TARGET_STATUSES.includes(status)) throw new TypeError(`targets.${name}.status must be one of ${TARGET_STATUSES.join(', ')}.`);
  const realization = nonEmptyString(input.realization || 'none', `targets.${name}.realization`);
  if (!REALIZATION_KINDS.includes(realization)) throw new TypeError(`targets.${name}.realization must be one of ${REALIZATION_KINDS.join(', ')}.`);
  const reasonCode = optionalString(input.reasonCode, `targets.${name}.reasonCode`);
  const entry = input.entry == null ? null : packageRelativePath(input.entry, `targets.${name}.entry`);
  const lowerableSubpath = input.lowerableSubpath == null ? null : packageSpecifier(input.lowerableSubpath, `targets.${name}.lowerableSubpath`);
  const providerRequirements = sortedUnique(input.providerRequirements || [], `targets.${name}.providerRequirements`);

  if (['not-realized', 'unsupported'].includes(status) && !reasonCode) throw new TypeError(`targets.${name}.reasonCode is required when status is ${status}.`);
  if (status === 'supported' && realization === 'none') throw new TypeError(`targets.${name}.realization cannot be none when the target is supported.`);
  if (status === 'not-realized' && (realization !== 'none' || entry || lowerableSubpath || providerRequirements.length > 0)) {
    throw new TypeError(`targets.${name} not-realized must use realization none without entry, lowerableSubpath, or provider requirements.`);
  }
  if (name === 'native' && status === 'supported' && realization !== 'canonical-package-lowering') {
    throw new TypeError('A supported native target must use canonical-package-lowering.');
  }
  if (name === 'javascript' && status === 'supported' && (realization !== 'javascript-package-runtime' || !entry)) {
    throw new TypeError('A supported JavaScript target must use javascript-package-runtime and declare entry.');
  }

  return deepFreeze({
    version: PACKAGE_TARGET_SUPPORT_VERSION,
    status,
    realization,
    entry,
    lowerableSubpath,
    providerRequirements,
    reasonCode
  });
}

function normalizePackageContract(input) {
  if (!isPlainObject(input)) throw new TypeError('Pulse package contract must be an object.');
  assertKnownKeys(input, ['version', 'kind', 'contractId', 'npmPackage', 'description', 'authoring', 'ownership', 'composition', 'targets', 'lowering', 'conformance', 'docs', 'policy'], 'package contract');
  if (input.version !== PACKAGE_CONTRACT_VERSION) throw new TypeError(`Package contract must use ${PACKAGE_CONTRACT_VERSION}.`);
  if (input.kind !== PACKAGE_CONTRACT_KIND) throw new TypeError(`Package contract kind must be ${PACKAGE_CONTRACT_KIND}.`);

  const normalizedPackage = packageName(input.npmPackage, 'npmPackage');
  const authoring = isPlainObject(input.authoring) ? input.authoring : {};
  const ownership = isPlainObject(input.ownership) ? input.ownership : {};
  const composition = isPlainObject(input.composition) ? input.composition : {};
  const lowering = isPlainObject(input.lowering) ? input.lowering : {};
  const conformance = isPlainObject(input.conformance) ? input.conformance : {};
  const docs = isPlainObject(input.docs) ? input.docs : {};
  const expectedPolicy = Object.freeze({
    externalCompilerPlugin: false,
    arbitraryCompilerAccess: false,
    resolvedProfileValues: false,
    resolvedSecretValues: false,
    targetFallback: false,
    packageOwnsProfileFragment: true,
    graphOwnsHelperAttribution: true,
    loweringConsumesCanonicalOperationsOnly: true
  });
  if (input.policy != null) {
    if (!isPlainObject(input.policy)) throw new TypeError('policy must be an object.');
    assertKnownKeys(input.policy, Object.keys(expectedPolicy), 'policy');
    for (const [key, expected] of Object.entries(expectedPolicy)) {
      if (input.policy[key] !== undefined && input.policy[key] !== expected) throw new TypeError(`policy.${key} is compiler-owned and must be ${expected}.`);
    }
  }
  assertKnownKeys(authoring, ['namespace', 'import', 'symbols'], 'authoring');
  assertKnownKeys(ownership, ['profileFragment', 'helperImports', 'reExportImports'], 'ownership');
  assertKnownKeys(composition, ['version', 'status', 'helperSymbol', 'profileToken', 'reasonCode'], 'composition');
  if (composition.version != null && composition.version !== PACKAGE_COMPOSITION_VERSION) throw new TypeError(`composition.version must be ${PACKAGE_COMPOSITION_VERSION}.`);
  assertKnownKeys(lowering, ['manifest', 'trust', 'canonicalOperationVersion', 'bundleVersion', 'providerRequirementVersion'], 'lowering');
  assertKnownKeys(conformance, ['version', 'status', 'fixtureRoots', 'semanticCases'], 'conformance');
  if (conformance.version != null && conformance.version !== PACKAGE_CONFORMANCE_VERSION) throw new TypeError(`conformance.version must be ${PACKAGE_CONFORMANCE_VERSION}.`);
  assertKnownKeys(docs, ['readme', 'contract'], 'docs');

  const authoringImport = packageSpecifier(authoring.import, 'authoring.import');
  if (authoringImport !== normalizedPackage && !authoringImport.startsWith(`${normalizedPackage}/`)) {
    throw new TypeError('authoring.import must be owned by npmPackage.');
  }

  const compositionStatus = nonEmptyString(composition.status || 'not-realized', 'composition.status');
  if (!COMPOSITION_STATUSES.includes(compositionStatus)) throw new TypeError(`composition.status must be one of ${COMPOSITION_STATUSES.join(', ')}.`);
  const helperSymbol = optionalString(composition.helperSymbol, 'composition.helperSymbol');
  const compositionReason = optionalString(composition.reasonCode, 'composition.reasonCode');
  if (compositionStatus === 'supported' && !helperSymbol) throw new TypeError('composition.helperSymbol is required when composition.status is supported.');
  if (['reserved', 'not-realized', 'unsupported'].includes(compositionStatus) && !compositionReason) {
    throw new TypeError(`composition.reasonCode is required when composition.status is ${compositionStatus}.`);
  }
  const profileToken = composition.profileToken === undefined ? PROFILE_TOKEN_POLICY : nonEmptyString(composition.profileToken, 'composition.profileToken');
  if (profileToken !== PROFILE_TOKEN_POLICY) throw new TypeError(`composition.profileToken must be ${PROFILE_TOKEN_POLICY}.`);

  const conformanceStatus = nonEmptyString(conformance.status || 'not-realized', 'conformance.status');
  if (!CONFORMANCE_STATUSES.includes(conformanceStatus)) throw new TypeError(`conformance.status must be one of ${CONFORMANCE_STATUSES.join(', ')}.`);
  const fixtureRoots = sortedUnique(conformance.fixtureRoots || [], 'conformance.fixtureRoots').map((value) => packageRelativePath(value, 'conformance.fixtureRoots'));
  const semanticCases = sortedUnique(conformance.semanticCases || [], 'conformance.semanticCases');
  if (conformanceStatus !== 'not-realized' && (fixtureRoots.length === 0 || semanticCases.length === 0)) {
    throw new TypeError(`conformance ${conformanceStatus} requires fixtureRoots and semanticCases.`);
  }

  const helperImports = sortedUnique(ownership.helperImports || [], 'ownership.helperImports').map((value) => packageSpecifier(value, 'ownership.helperImports'));
  const reExportImports = sortedUnique(ownership.reExportImports || [], 'ownership.reExportImports').map((value) => packageSpecifier(value, 'ownership.reExportImports'));
  for (const specifier of helperImports) {
    if (specifier !== normalizedPackage && !specifier.startsWith(`${normalizedPackage}/`)) throw new TypeError(`Helper import ${specifier} is not owned by ${normalizedPackage}.`);
  }

  const normalized = {
    version: PACKAGE_CONTRACT_VERSION,
    kind: PACKAGE_CONTRACT_KIND,
    contractId: contractId(input.contractId, 'contractId'),
    npmPackage: normalizedPackage,
    description: optionalString(input.description, 'description'),
    authoring: {
      namespace: nonEmptyString(authoring.namespace, 'authoring.namespace'),
      import: authoringImport,
      symbols: sortedUnique(authoring.symbols || [], 'authoring.symbols')
    },
    ownership: {
      profileFragment: fragmentKey(ownership.profileFragment, 'ownership.profileFragment'),
      helperImports: Object.freeze(helperImports),
      reExportImports: Object.freeze(reExportImports)
    },
    composition: {
      version: PACKAGE_COMPOSITION_VERSION,
      status: compositionStatus,
      helperSymbol,
      profileToken,
      reasonCode: compositionReason
    },
    targets: {
      native: normalizeTarget('native', input.targets && input.targets.native),
      javascript: normalizeTarget('javascript', input.targets && input.targets.javascript)
    },
    lowering: {
      manifest: lowering.manifest == null ? null : packageRelativePath(lowering.manifest, 'lowering.manifest'),
      trust: optionalString(lowering.trust, 'lowering.trust'),
      canonicalOperationVersion: optionalString(lowering.canonicalOperationVersion, 'lowering.canonicalOperationVersion'),
      bundleVersion: optionalString(lowering.bundleVersion, 'lowering.bundleVersion'),
      providerRequirementVersion: optionalString(lowering.providerRequirementVersion, 'lowering.providerRequirementVersion')
    },
    conformance: {
      version: PACKAGE_CONFORMANCE_VERSION,
      status: conformanceStatus,
      fixtureRoots: Object.freeze(fixtureRoots),
      semanticCases
    },
    docs: {
      readme: docs.readme == null ? null : packageRelativePath(docs.readme, 'docs.readme'),
      contract: docs.contract == null ? null : packageRelativePath(docs.contract, 'docs.contract')
    },
    policy: expectedPolicy
  };

  if (normalized.targets.native.status === 'supported') {
    if (!normalized.targets.native.lowerableSubpath || !normalized.lowering.manifest) throw new TypeError('A supported native package contract requires lowerableSubpath and lowering.manifest.');
    if (normalized.lowering.trust !== 'first-party') throw new TypeError('The current native package-lowering contract requires lowering.trust first-party.');
    if (normalized.lowering.canonicalOperationVersion !== CANONICAL_PACKAGE_OPERATION_VERSION
      || normalized.lowering.bundleVersion !== PACKAGE_LOWERING_BUNDLE_VERSION
      || normalized.lowering.providerRequirementVersion !== PROVIDER_REQUIREMENT_RECORD_VERSION) {
      throw new TypeError('Native package metadata must identify the sealed canonical operation, lowering bundle, and provider-requirement versions.');
    }
  }
  return deepFreeze(normalized);
}

function validatePackageContractCatalog(contracts) {
  const normalized = (contracts || []).map(normalizePackageContract).sort((a, b) => a.contractId.localeCompare(b.contractId));
  const contractIds = new Set();
  const packages = new Set();
  const fragments = new Set();
  const helperImports = new Map();
  for (const contract of normalized) {
    if (contractIds.has(contract.contractId)) throw new TypeError(`Duplicate package contractId ${contract.contractId}.`);
    if (packages.has(contract.npmPackage)) throw new TypeError(`Package ${contract.npmPackage} declares more than one Pulse package contract.`);
    if (fragments.has(contract.ownership.profileFragment)) throw new TypeError(`Profile fragment ${contract.ownership.profileFragment} is owned by more than one package.`);
    contractIds.add(contract.contractId);
    packages.add(contract.npmPackage);
    fragments.add(contract.ownership.profileFragment);
    for (const specifier of [...contract.ownership.helperImports, ...contract.ownership.reExportImports]) {
      const current = helperImports.get(specifier);
      if (current && current !== contract.contractId) throw new TypeError(`Helper import ${specifier} is owned by both ${current} and ${contract.contractId}.`);
      helperImports.set(specifier, contract.contractId);
    }
  }
  return deepFreeze({
    version: PACKAGE_CONTRACT_CATALOG_VERSION,
    contracts: normalized,
    profileFragments: Object.freeze([...fragments].sort()),
    helperImports: Object.freeze([...helperImports.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([specifier, id]) => Object.freeze({ specifier, contractId: id }))),
    policy: Object.freeze({
      graphOwnershipRequired: true,
      profileFragmentsUnique: true,
      helperOwnershipUnique: true,
      externalCompilerPluginApi: false,
      packageContractExecutesCompilerCode: false,
      loweringManifestSeparate: true
    })
  });
}

function defaultPackageContractDefinition() {
  return deepFreeze({
    version: PACKAGE_CONTRACT_VERSION,
    targetSupportVersion: PACKAGE_TARGET_SUPPORT_VERSION,
    compositionVersion: PACKAGE_COMPOSITION_VERSION,
    conformanceVersion: PACKAGE_CONFORMANCE_VERSION,
    catalogVersion: PACKAGE_CONTRACT_CATALOG_VERSION,
    cryptoRequirementVersion: PACKAGE_CRYPTO_REQUIREMENT_VERSION,
    builderInvocationVersion: PACKAGE_BUILDER_INVOCATION_VERSION,
    builderResultVersion: PACKAGE_BUILDER_RESULT_VERSION,
    inspectionArtifactVersion: PACKAGE_INSPECTION_ARTIFACT_VERSION,
    canonicalInspectionVersion: CANONICAL_PACKAGE_INSPECTION_VERSION,
    managedHandlerDescriptorVersion: PACKAGE_MANAGED_HANDLER_DESCRIPTOR_VERSION,
    targetStatuses: TARGET_STATUSES,
    realizationKinds: REALIZATION_KINDS,
    compositionStatuses: COMPOSITION_STATUSES,
    conformanceStatuses: CONFORMANCE_STATUSES,
    policies: {
      productMetadataSeparateFromTrustedLowerer: true,
      staticDataOnly: true,
      profileTokenOpaque: true,
      graphOwnsAttribution: true,
      packageLowererReceivesCanonicalOperationsOnly: true,
      javascriptSupportMustBeExplicit: true,
      unsupportedModesMustBeExplicit: true,
      automaticFallback: false,
      publicCompilerPluginApi: false
    }
  });
}

module.exports = Object.freeze({
  PACKAGE_CONTRACT_VERSION,
  PACKAGE_REALIZATION_ARTIFACT_SET_VERSION,
  PACKAGE_CONTRACT_KIND,
  PACKAGE_TARGET_SUPPORT_VERSION,
  PACKAGE_COMPOSITION_VERSION,
  PACKAGE_CONFORMANCE_VERSION,
  PACKAGE_CONTRACT_CATALOG_VERSION,
  PACKAGE_CONTRACT_DISCOVERY_VERSION,
  PACKAGE_PRODUCT_METADATA_PACKAGE_POLICY,
  PACKAGE_NATIVE_LOWERING_TRUST_POLICY,
  PROFILE_TOKEN_POLICY,
  CANONICAL_PACKAGE_OPERATION_VERSION,
  PACKAGE_LOWERING_BUNDLE_VERSION,
  PACKAGE_INTRINSIC_VERSION,
  PACKAGE_CRYPTO_REQUIREMENT_VERSION,
  PROVIDER_REQUIREMENT_RECORD_VERSION,
  GUEST_UNIT_CONTRIBUTION_VERSION,
  PACKAGE_BUILDER_INVOCATION_VERSION,
  PACKAGE_BUILDER_RESULT_VERSION,
  PACKAGE_INSPECTION_ARTIFACT_VERSION,
  CANONICAL_PACKAGE_INSPECTION_VERSION,
  PACKAGE_MANAGED_HANDLER_DESCRIPTOR_VERSION,
  PACKAGE_BUILDER_INVOCATION_FIELDS,
  PACKAGE_BUILDER_RAW_RESULT_FIELDS,
  CANONICAL_PACKAGE_EFFECT_FIELDS,
  CANONICAL_PACKAGE_OPERATION_FIELDS,
  PROVIDER_REQUIREMENT_RECORD_FIELDS,
  GUEST_UNIT_CONTRIBUTION_FIELDS,
  TARGET_STATUSES,
  REALIZATION_KINDS,
  COMPOSITION_STATUSES,
  CONFORMANCE_STATUSES,
  normalizePackageContract,
  normalizePackageBuilderInvocation,
  normalizePackageBuilderResult,
  normalizeCanonicalPackageEffect,
  createCanonicalPackageOperation,
  normalizeCanonicalPackageOperation,
  normalizePackageLoweringBundle,
  normalizeProviderRequirementRecord,
  normalizeGuestUnitContribution,
  normalizeCanonicalGuestUnitContribution,
  validatePackageContractCatalog,
  defaultPackageContractDefinition,
  clone
});
