'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const { discoverLowerableLibraryManifests } = require('@pulse-compute/wasm-library-kit/compiler/handler-library-contracts');
const { buildPackageOwnedLoweringPlan } = require('@pulse-compute/wasm-library-kit/compiler/package-lowering');
const {
  CANONICAL_PACKAGE_OPERATION_VERSION,
  PACKAGE_LOWERING_BUNDLE_VERSION,
  PACKAGE_CONTRACT_CATALOG_VERSION,
  PACKAGE_CRYPTO_REQUIREMENT_VERSION,
  PACKAGE_INTRINSIC_VERSION,
  PACKAGE_INSPECTION_ARTIFACT_VERSION,
  PACKAGE_MANAGED_HANDLER_DESCRIPTOR_VERSION,
  CANONICAL_PACKAGE_EFFECT_FIELDS,
  createCanonicalPackageOperation,
  normalizeCanonicalPackageOperation,
  normalizePackageLoweringBundle,
  normalizeGuestUnitContribution,
  normalizeCanonicalGuestUnitContribution
} = require('@pulse-compute/wasm-contracts/package/package-contract');
const {
  CRYPTO_SEMANTIC_OWNER
} = require('@pulse-compute/wasm-contracts/crypto/contracts');

function loadPackageContractDiscovery() {
  try {
    return require('@pulse-compute/wasm-library-kit/compiler/package-contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-library-kit')) {
      return require('../../../library-kit/src/compiler/package-contracts.js');
    }
    throw error;
  }
}
const { discoverPulsePackageContracts } = loadPackageContractDiscovery();

const PACKAGE_OPERATION_RECOGNITION_VERSION = 'pulse.package-operation-recognition.v1';
const PACKAGE_RESULT_ADAPTER_VERSION = 'pulse.package-result-adapter.v1';
const recognitionsByCompiled = new WeakMap();

class PackageOperationSeamError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PackageOperationSeamError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function cloneJson(value) {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)]));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sortedUnique(values) {
  return Object.freeze([...new Set((values || []).filter((value) => typeof value === 'string' && value.length > 0))].sort());
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function catalogDescriptor(record, productRecord) {
  const manifest = record && record.manifest || {};
  const validation = record && record.validation || {};
  const compiler = manifest.compiler && typeof manifest.compiler === 'object' ? manifest.compiler : {};
  const facade = manifest.facade && typeof manifest.facade === 'object' ? manifest.facade : {};
  const wasm = manifest.modes && manifest.modes.wasm || {};
  const jsEngine = manifest.modes && (manifest.modes.jsEngine || manifest.modes.js_engine || manifest.modes['js-engine']) || {};
  const product = productRecord && productRecord.contract || null;
  const nativeSupported = Boolean(
    product
    && ['supported', 'provider-dependent'].includes(product.targets.native.status)
    && compiler.trust === 'first-party'
    && validation.status === 'ok'
    && wasm.mode !== 'lowering-plan-only'
    && wasm.sidecar
  );
  const javascriptDeclared = Boolean(
    product
    && ['supported', 'provider-dependent'].includes(product.targets.javascript.status)
    && jsEngine.behavior
    && !['lowering-marker-only', 'runtime-not-realized'].includes(jsEngine.behavior)
  );
  return deepFreeze({
    contractId: String(manifest.contractId || ''),
    packageName: String(manifest.npmPackage || record && record.packageName || ''),
    lowerableSubpath: String(manifest.lowerableSubpath || ''),
    compatibilitySubpaths: sortedUnique(manifest.publicApi && manifest.publicApi.compatibilitySubpaths || []),
    facadeSymbols: sortedUnique(facade.symbols || []),
    compilerTrust: String(compiler.trust || ''),
    compilerOwner: String(compiler.builderOwner || ''),
    validationStatus: String(validation.status || 'unknown'),
    manifestVersion: String(manifest.version || ''),
    manifestHash: sha256(JSON.stringify(manifest)),
    manifestFile: record && record.manifestFile ? path.resolve(record.manifestFile) : null,
    packageDir: record && record.packageDir ? path.resolve(record.packageDir) : null,
    hostCapabilities: sortedUnique(wasm.hostCapabilities || []),
    targetSupport: Object.freeze({
      native: nativeSupported,
      javascript: javascriptDeclared ? 'declared' : 'not-realized'
    }),
    productContract: product ? Object.freeze({
      version: product.version,
      metadataHash: productRecord.metadataHash,
      profileFragment: product.ownership.profileFragment,
      helperImports: product.ownership.helperImports,
      reExportImports: product.ownership.reExportImports,
      composition: product.composition,
      targets: product.targets,
      conformance: product.conformance,
      docs: product.docs
    }) : null
  });
}

function discoverPackageContractCatalog(options = {}) {
  const cwd = path.resolve(options.cwd || options.rootDir || process.cwd());
  const records = discoverLowerableLibraryManifests({
    cwd,
    workspaceRoot: options.workspaceRoot,
    scanNodeModules: options.scanNodeModules !== false
  });
  const productCatalog = discoverPulsePackageContracts({
    cwd,
    workspaceRoot: options.workspaceRoot,
    scanNodeModules: options.scanNodeModules !== false
  });
  const productsByContract = new Map(productCatalog.contracts.map((entry) => [entry.contractId, { contract: entry, metadataHash: entry.metadataHash }]));
  const contracts = records.map((record) => {
    const contractId = record.manifest && record.manifest.contractId;
    const productRecord = productsByContract.get(contractId);
    if (!productRecord) throw new TypeError(`Trusted package lowerer ${contractId || record.packageName} requires static Pulse product metadata.`);
    return catalogDescriptor(record, productRecord);
  })
    .filter((entry) => entry.contractId && entry.packageName && entry.lowerableSubpath)
    .sort((left, right) => left.contractId.localeCompare(right.contractId));
  const seenContracts = new Set();
  const seenSubpaths = new Set();
  for (const entry of contracts) {
    if (seenContracts.has(entry.contractId)) throw new PackageOperationSeamError('PULSE_PACKAGE_CONTRACT_DUPLICATE', `Duplicate package contract ${entry.contractId}.`, { contractId: entry.contractId });
    for (const subpath of new Set([entry.lowerableSubpath, ...entry.compatibilitySubpaths])) {
      if (seenSubpaths.has(subpath)) throw new PackageOperationSeamError('PULSE_PACKAGE_SUBPATH_DUPLICATE', `Package subpath ${subpath} is owned by more than one package contract.`, { lowerableSubpath: subpath });
      seenSubpaths.add(subpath);
    }
    seenContracts.add(entry.contractId);
  }
  return deepFreeze({
    version: PACKAGE_CONTRACT_CATALOG_VERSION,
    productCatalog: Object.freeze({
      version: productCatalog.version,
      discoveryVersion: productCatalog.discoveryVersion,
      contracts: productCatalog.contracts,
      profileFragments: productCatalog.profileFragments,
      helperImports: productCatalog.helperImports,
      policy: productCatalog.policy
    }),
    contracts: Object.freeze(contracts),
    policy: Object.freeze({
      trustedFirstPartyOnly: true,
      sourceSubstringSelection: false,
      graphReachabilitySelection: true,
      publicRegistration: false,
      dynamicDiscoveryHooks: false,
      productMetadataVersion: productCatalog.version,
      productMetadataSeparateFromLowerer: true,
      profileFragmentOwnershipRequired: true,
      javascriptSupportExplicit: true
    })
  });
}

function effectWithSourceFile(effect, sourceFile) {
  if (!sourceFile || !effect || typeof effect !== 'object') return deepFreeze(cloneJson(effect));
  const value = cloneJson(effect);
  if (value.loc && typeof value.loc === 'object') value.loc.file = String(sourceFile);
  return deepFreeze(value);
}

function schemaReferenceWithSourceFile(reference, sourceFile) {
  if (!reference || typeof reference !== 'object') return deepFreeze(cloneJson(reference));
  const value = cloneJson(reference);
  if (sourceFile) value.file = String(sourceFile);
  return deepFreeze(value);
}

function canonicalPackageSchemaReference(reference) {
  const id = String(reference && reference.id || '');
  const usage = String(reference && reference.usage || '');
  const capability = String(reference && reference.capability || '');
  const position = reference && reference.position;
  if (
    !id
    || !usage
    || !['schema.decode', 'schema.encode'].includes(capability)
    || !position
    || !Number.isSafeInteger(Number(position.line))
    || Number(position.line) < 1
    || !Number.isSafeInteger(Number(position.column))
    || Number(position.column) < 1
    || !Number.isSafeInteger(Number(position.offset))
    || Number(position.offset) < 0
  ) {
    throw new PackageOperationSeamError(
      'PULSE_PACKAGE_SCHEMA_REFERENCE_INVALID',
      'Package-owned schema references require an ID, usage, schema capability, and source position.',
      { id, usage, capability }
    );
  }
  return deepFreeze({
    id,
    usage,
    capability,
    ...(reference.file ? { file: String(reference.file).replace(/\\/g, '/') } : {}),
    ...(reference.responseCaseId ? { responseCaseId: String(reference.responseCaseId) } : {}),
    position: Object.freeze({
      line: Number(position.line),
      column: Number(position.column),
      offset: Number(position.offset)
    })
  });
}

function planWithSourceFile(plan, sourceFile) {
  const value = cloneJson(plan);
  if (sourceFile && Array.isArray(value.canonicalEffects)) {
    value.canonicalEffects = value.canonicalEffects.map((effect) => effectWithSourceFile(effect, sourceFile));
  }
  if (sourceFile && Array.isArray(value.canonicalIntrinsics)) {
    value.canonicalIntrinsics = value.canonicalIntrinsics.map((intrinsic) => effectWithSourceFile(intrinsic, sourceFile));
  }
  if (sourceFile && Array.isArray(value.schemaReferences)) {
    value.schemaReferences = value.schemaReferences.map((reference) => schemaReferenceWithSourceFile(reference, sourceFile));
  }
  return deepFreeze(value);
}

function packageDescriptor(record, operationCount, intrinsicCount = 0) {
  const manifest = record && record.manifest || {};
  const compiler = manifest.compiler && typeof manifest.compiler === 'object' ? manifest.compiler : {};
  const wasm = manifest.modes && manifest.modes.wasm || {};
  return deepFreeze({
    contractId: String(manifest.contractId || ''),
    package: String(manifest.npmPackage || record && record.packageName || ''),
    lowerableSubpath: String(manifest.lowerableSubpath || ''),
    builder: {
      owner: String(compiler.builderOwner || manifest.npmPackage || record && record.packageName || ''),
      trust: String(compiler.trust || ''),
      entry: String(compiler.entry || ''),
      export: String(compiler.export || '')
    },
    mode: String(wasm.mode || ''),
    sidecar: typeof wasm.sidecar === 'string' ? wasm.sidecar : undefined,
    hostCapabilities: sortedUnique(wasm.hostCapabilities || []),
    operationCount,
    intrinsicCount
  });
}

function canonicalPackageIntrinsic(intrinsic, record) {
  if (!intrinsic || intrinsic.version !== PACKAGE_INTRINSIC_VERSION) {
    throw new PackageOperationSeamError(
      'PULSE_PACKAGE_INTRINSIC_INVALID',
      `Trusted package intrinsics require ${PACKAGE_INTRINSIC_VERSION}.`,
      { intrinsic }
    );
  }
  const manifest = record && record.manifest || {};
  const value = {
    ...cloneJson(intrinsic),
    contractId: String(intrinsic.contractId || manifest.contractId || ''),
    package: String(intrinsic.package || manifest.npmPackage || ''),
    import: String(intrinsic.import || manifest.lowerableSubpath || ''),
    kind: String(intrinsic.kind || ''),
    operation: String(intrinsic.operation || ''),
    intrinsic: String(intrinsic.intrinsic || ''),
    packageIntrinsic: intrinsic.packageIntrinsic ? String(intrinsic.packageIntrinsic) : undefined,
    compilerName: String(intrinsic.compilerName || ''),
    valueKind: String(intrinsic.valueKind || 'unknown'),
    argumentIndexes: Array.isArray(intrinsic.argumentIndexes) ? intrinsic.argumentIndexes.map(Number) : [],
    staticArguments: Array.isArray(intrinsic.staticArguments)
      ? intrinsic.staticArguments.map((entry) => cloneJson(entry))
      : []
  };
  for (const field of ['contractId', 'package', 'import', 'kind', 'operation', 'intrinsic', 'compilerName']) {
    if (!value[field]) {
      throw new PackageOperationSeamError('PULSE_PACKAGE_INTRINSIC_INVALID', `Package intrinsic requires ${field}.`, { field, intrinsic });
    }
  }
  if (
    !value.range
    || !Number.isSafeInteger(Number(value.range.start))
    || value.argumentIndexes.some((index) => !Number.isSafeInteger(index) || index < 0)
  ) {
    throw new PackageOperationSeamError('PULSE_PACKAGE_INTRINSIC_INVALID', 'Package intrinsic requires a source range and non-negative argument indexes.', { intrinsic });
  }
  return deepFreeze(value);
}

function canonicalRealizationArtifact(artifact, record) {
  const manifest = record && record.manifest || {};
  const value = cloneJson(artifact);
  const id = String(value && value.id || '');
  const contractId = String(value && value.contractId || '');
  const packageName = String(value && value.package || '');
  const version = String(value && value.version || '');
  const kind = String(value && value.kind || '');
  const mediaType = String(value && value.mediaType || '');
  if (
    !id
    || !version
    || !kind
    || !mediaType
    || contractId !== String(manifest.contractId || '')
    || packageName !== String(manifest.npmPackage || '')
    || !value.data
    || typeof value.data !== 'object'
  ) {
    throw new PackageOperationSeamError(
      'PULSE_PACKAGE_REALIZATION_ARTIFACT_INVALID',
      'Package realization artifacts require versioned owner identity, media type, and private data.',
      { id, version, kind, mediaType, contractId, package: packageName }
    );
  }
  return deepFreeze(value);
}

function canonicalInspectionArtifact(artifact, record) {
  const manifest = record && record.manifest || {};
  const value = cloneJson(artifact);
  const id = String(value && value.id || '');
  const contractId = String(value && value.contractId || '');
  const packageName = String(value && value.package || '');
  const version = String(value && value.version || '');
  const kind = String(value && value.kind || '');
  const mediaType = String(value && value.mediaType || '');
  const file = String(value && value.file || '').replace(/\\/g, '/');
  const unsafeFile = !file
    || path.posix.isAbsolute(file)
    || file === '..'
    || file.startsWith('../')
    || file.includes('/../')
    || !file.endsWith('.json');
  if (
    version !== PACKAGE_INSPECTION_ARTIFACT_VERSION
    || !id
    || !kind
    || mediaType !== 'application/json'
    || unsafeFile
    || contractId !== String(manifest.contractId || '')
    || packageName !== String(manifest.npmPackage || '')
    || !value.data
    || typeof value.data !== 'object'
    || Array.isArray(value.data)
  ) {
    throw new PackageOperationSeamError(
      'PULSE_PACKAGE_INSPECTION_ARTIFACT_INVALID',
      `Package inspection artifacts require ${PACKAGE_INSPECTION_ARTIFACT_VERSION}, exact owner identity, a safe JSON file, and static data.`,
      { id, version, kind, mediaType, file, contractId, package: packageName }
    );
  }
  return deepFreeze(value);
}

function canonicalManagedHandlerDescriptor(descriptor) {
  const value = cloneJson(descriptor);
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.version !== PACKAGE_MANAGED_HANDLER_DESCRIPTOR_VERSION
    || typeof value.id !== 'string'
    || value.id.length === 0
  ) {
    throw new PackageOperationSeamError(
      'PULSE_MANAGED_HANDLER_DESCRIPTOR_INVALID',
      `Package managed-handler contributions require ${PACKAGE_MANAGED_HANDLER_DESCRIPTOR_VERSION} and a stable ID.`,
      { version: value && value.version, id: value && value.id }
    );
  }
  return deepFreeze(value);
}

function canonicalPackageCryptoRequirement(requirement, record) {
  const manifest = record && record.manifest || {};
  const value = cloneJson(requirement);
  const allowed = new Set([
    'version',
    'requestedBy',
    'semanticOwner',
    'reachable',
    'algorithms'
  ]);
  const unsupported = Object.keys(value || {}).filter((key) => !allowed.has(key)).sort();
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.version !== PACKAGE_CRYPTO_REQUIREMENT_VERSION
    || value.requestedBy !== String(manifest.npmPackage || record && record.packageName || '')
    || value.semanticOwner !== CRYPTO_SEMANTIC_OWNER
    || value.reachable !== true
    || !Array.isArray(value.algorithms)
    || value.algorithms.length === 0
    || value.algorithms.some((algorithm) => typeof algorithm !== 'string' || algorithm.trim().length === 0)
    || unsupported.length > 0
  ) {
    throw new PackageOperationSeamError(
      'PULSE_PACKAGE_CRYPTO_REQUIREMENT_INVALID',
      'Package crypto requirements require versioned package ownership, crypto semantic ownership, reachability, and non-empty algorithms.',
      {
        version: value && value.version,
        requestedBy: value && value.requestedBy,
        semanticOwner: value && value.semanticOwner,
        reachable: value && value.reachable,
        unsupported
      }
    );
  }
  return deepFreeze({
    version: PACKAGE_CRYPTO_REQUIREMENT_VERSION,
    requestedBy: value.requestedBy,
    semanticOwner: value.semanticOwner,
    reachable: true,
    algorithms: sortedUnique(value.algorithms.map((algorithm) => algorithm.trim()))
  });
}

function combinePackageCryptoRequirements(requirements) {
  const grouped = new Map();
  for (const requirement of requirements || []) {
    const key = `${requirement.requestedBy}\u0000${requirement.semanticOwner}`;
    const current = grouped.get(key) || {
      version: PACKAGE_CRYPTO_REQUIREMENT_VERSION,
      requestedBy: requirement.requestedBy,
      semanticOwner: requirement.semanticOwner,
      reachable: true,
      algorithms: new Set()
    };
    for (const algorithm of requirement.algorithms || []) current.algorithms.add(algorithm);
    grouped.set(key, current);
  }
  return Object.freeze([...grouped.values()]
    .map((entry) => deepFreeze({
      version: entry.version,
      requestedBy: entry.requestedBy,
      semanticOwner: entry.semanticOwner,
      reachable: true,
      algorithms: Object.freeze([...entry.algorithms].sort())
    }))
    .sort((left, right) => left.requestedBy.localeCompare(right.requestedBy)
      || left.semanticOwner.localeCompare(right.semanticOwner)));
}

function canonicalGuestUnitSelection(contribution, record) {
  let contributingPackageManifest;
  let packageRoot;
  try {
    const requestingPackageManifest = JSON.parse(
      fs.readFileSync(path.join(record.packageDir, 'package.json'), 'utf8')
    );
    const declaredOwner = contribution && typeof contribution.owner === 'string'
      ? contribution.owner
      : record.packageName;
    if (declaredOwner === record.packageName) {
      packageRoot = fs.realpathSync(record.packageDir);
    } else {
      if (!Object.prototype.hasOwnProperty.call(
        requestingPackageManifest.dependencies || {},
        declaredOwner
      )) {
        throw new TypeError('guest-unit owner is not a declared package dependency');
      }
      const resolvedEntry = createRequire(path.join(record.packageDir, 'package.json')).resolve(declaredOwner);
      let candidate = path.dirname(fs.realpathSync(resolvedEntry));
      let found = false;
      while (candidate !== path.dirname(candidate)) {
        const candidateManifest = path.join(candidate, 'package.json');
        if (fs.existsSync(candidateManifest)) {
          const parsed = JSON.parse(fs.readFileSync(candidateManifest, 'utf8'));
          if (parsed.name === declaredOwner) {
            packageRoot = fs.realpathSync(candidate);
            found = true;
            break;
          }
        }
        candidate = path.dirname(candidate);
      }
      if (!found) throw new TypeError('guest-unit owner package root could not be resolved');
    }
    contributingPackageManifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
    );
    if (
      contributingPackageManifest.name !== declaredOwner
    ) {
      throw new TypeError('guest-unit owner is not the contributing package or a declared package dependency');
    }
  } catch (error) {
    throw new PackageOperationSeamError(
      'PULSE_GUEST_UNIT_OWNER_MISMATCH',
      `Guest-unit owner package ${contribution && contribution.owner || record.packageName || '<unknown>'} has no readable declared package identity.`,
      { cause: error && error.message }
    );
  }
  let normalized;
  try {
    normalized = normalizeGuestUnitContribution({
      version: contribution.version,
      id: contribution.id,
      manifest: contribution.manifest
    }, {
      owner: contributingPackageManifest.name,
      packageVersion: contributingPackageManifest.version
    });
    if (
      contribution.packageVersion !== undefined
      && contribution.packageVersion !== contributingPackageManifest.version
    ) throw new TypeError('guest-unit package version does not match its owner');
  } catch (error) {
    throw new PackageOperationSeamError(
      'PULSE_GUEST_UNIT_INVALID',
      `Trusted package ${record.packageName || '<unknown>'} produced an invalid guest-unit contribution.`,
      { cause: error && error.message }
    );
  }
  return deepFreeze({
    ...normalizeCanonicalGuestUnitContribution(normalized),
    packageRoot
  });
}

function operationHostCapabilities(manifest, effect) {
  const wasm = manifest && manifest.modes && manifest.modes.wasm;
  const lowerings = wasm && Array.isArray(wasm.lowerings) ? wasm.lowerings : [];
  const lowering = lowerings.find((entry) => String(entry.tsSymbol || '') === String(effect.kind || ''));
  return sortedUnique(lowering && lowering.hostCapabilities || []);
}

function canonicalPackageOperation(effect, record, order) {
  const manifest = record && record.manifest || {};
  try {
    return createCanonicalPackageOperation(effect, {
      contractId: manifest.contractId,
      npmPackage: manifest.npmPackage || record && record.packageName,
      lowerableSubpath: manifest.lowerableSubpath,
      hostCapabilities: operationHostCapabilities(manifest, effect)
    }, order);
  } catch (error) {
    throw new PackageOperationSeamError(
      'PULSE_PACKAGE_OPERATION_INVALID',
      `Trusted package ${manifest.contractId || record && record.packageName || '<unknown>'} produced an invalid canonical operation.`,
      { order, cause: error && error.message }
    );
  }
}

function assertCanonicalPackageOperation(operation) {
  try {
    return normalizeCanonicalPackageOperation(operation);
  } catch (error) {
    throw new PackageOperationSeamError(
      'PULSE_PACKAGE_OPERATION_INVALID',
      `Expected an exact ${CANONICAL_PACKAGE_OPERATION_VERSION} record.`,
      { id: operation && operation.id, cause: error && error.message }
    );
  }
}

function selectPackageRecords(manifestRecords, sourceText, selectedContracts) {
  const selected = [];
  const seen = new Set();
  const requested = Array.isArray(selectedContracts)
    ? new Set(selectedContracts.map((value) => String(value)).filter(Boolean))
    : null;
  for (const record of manifestRecords) {
    const manifest = record && record.manifest || {};
    const lowerableSubpath = String(manifest.lowerableSubpath || '');
    const contractId = String(manifest.contractId || '');
    const selectedByGraph = requested && requested.has(contractId);
    const compatibilitySubpaths = manifest.publicApi && Array.isArray(manifest.publicApi.compatibilitySubpaths)
      ? manifest.publicApi.compatibilitySubpaths.map(String)
      : [];
    const selectedByCompatibilityScan = !requested && [lowerableSubpath, ...compatibilitySubpaths].some((specifier) => sourceText.includes(specifier));
    if (!lowerableSubpath || !contractId || seen.has(contractId) || (!selectedByGraph && !selectedByCompatibilityScan)) continue;
    seen.add(contractId);
    selected.push(record);
  }
  if (requested) {
    const missing = [...requested].filter((contractId) => !seen.has(contractId)).sort();
    if (missing.length > 0) throw new PackageOperationSeamError(
      'PULSE_PACKAGE_CONTRACT_NOT_FOUND',
      `Reachable graph selected package contract(s) that are absent from the trusted manifest catalog: ${missing.join(', ')}.`,
      { missing }
    );
  }
  return selected;
}

function recognizeProjectPackageOperations(entryFile, options = {}) {
  const absoluteEntry = path.resolve(entryFile);
  const rootDir = path.resolve(options.rootDir || path.dirname(absoluteEntry));
  const sourceText = options.sourceText === undefined ? fs.readFileSync(absoluteEntry, 'utf8') : String(options.sourceText);
  const manifestRecords = discoverLowerableLibraryManifests({
    cwd: rootDir,
    workspaceRoot: options.workspaceRoot,
    scanNodeModules: true
  });
  const selected = selectPackageRecords(manifestRecords, sourceText, options.selectedContracts);
  const sourceName = String(options.sourceName || absoluteEntry).replace(/\\/g, '/');
  const sourceFile = ts.createSourceFile(sourceName, sourceText, ts.ScriptTarget.ES2022, true, /\.[cm]?tsx?$/.test(sourceName) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const operations = [];
  const packages = [];
  const plans = [];
  const resultAdapters = [];
  const intrinsics = [];
  const schemaReferences = [];
  const realizationArtifacts = [];
  const inspectionArtifacts = [];
  const managedHandlers = [];
  const guestUnits = [];
  const cryptoRequirements = [];
  const diagnostics = [];
  let order = 0;

  for (const record of selected) {
    // This source-aware step is package recognition and validation. The later
    // package-lowering phase receives only the canonical operations below.
    const result = buildPackageOwnedLoweringPlan({
      cwd: rootDir,
      workspaceRoot: options.workspaceRoot,
      manifestRecords,
      contractId: record.manifest.contractId,
      sourcePath: sourceName,
      sourceText,
      sourceFile,
      generatedBy: options.generatedBy,
      schemaBundle: options.schemaBundle
    });
    diagnostics.push(...(result.diagnostics || []));
    const contributions = result.contributions || {};
    const canonicalEffects = contributions.canonicalEffects || [];
    const recognized = canonicalEffects.map((effect) => canonicalPackageOperation(effect, record, ++order));
    const adapters = contributions.resultAdapters || [];
    for (const adapter of adapters) {
      if (!adapter || adapter.version !== PACKAGE_RESULT_ADAPTER_VERSION) {
        throw new PackageOperationSeamError('PULSE_PACKAGE_RESULT_ADAPTER_INVALID', `Package ${record.manifest.contractId} produced an invalid result adapter.`, { adapter });
      }
      resultAdapters.push(effectWithSourceFile(adapter, sourceName));
    }
    const recognizedIntrinsics = (contributions.canonicalIntrinsics || [])
      .map((intrinsic) => canonicalPackageIntrinsic(intrinsic, record));
    intrinsics.push(...recognizedIntrinsics.map((intrinsic) => effectWithSourceFile(intrinsic, sourceName)));
    const recognizedSchemaReferences = (contributions.schemaReferences || [])
      .map(canonicalPackageSchemaReference)
      .map((reference) => schemaReferenceWithSourceFile(reference, sourceName));
    schemaReferences.push(...recognizedSchemaReferences);
    realizationArtifacts.push(...(contributions.realizationArtifacts || [])
      .map((artifact) => canonicalRealizationArtifact(artifact, record)));
    inspectionArtifacts.push(...(contributions.inspectionArtifacts || [])
      .map((artifact) => canonicalInspectionArtifact(artifact, record)));
    managedHandlers.push(...(contributions.managedHandlers || [])
      .map(canonicalManagedHandlerDescriptor));
    guestUnits.push(...(contributions.guestUnits || [])
      .map((contribution) => canonicalGuestUnitSelection(contribution, record)));
    const recognizedCryptoRequirements = (contributions.cryptoRequirements || [])
      .map((requirement) => canonicalPackageCryptoRequirement(requirement, record));
    cryptoRequirements.push(...recognizedCryptoRequirements);
    operations.push(...recognized);
    packages.push(packageDescriptor(record, recognized.length, recognizedIntrinsics.length));
    plans.push(Object.freeze({
      contractId: String(record.manifest.contractId),
      package: String(record.manifest.npmPackage),
      lowerableSubpath: String(record.manifest.lowerableSubpath),
      status: result.artifact && result.artifact.status || (result.hasErrors ? 'error' : 'ok'),
      canonicalEffects: Object.freeze(canonicalEffects.map((effect) => Object.freeze({ ...effect }))),
      canonicalIntrinsics: Object.freeze(recognizedIntrinsics),
      schemaReferences: Object.freeze(recognizedSchemaReferences),
      cryptoRequirements: Object.freeze(recognizedCryptoRequirements)
    }));
  }

  const dependencies = Object.freeze(selected.map((record) => path.resolve(record.manifestFile)).filter(Boolean).sort());
  const publicSourceName = options.publicSourceName ? String(options.publicSourceName) : undefined;
  const publicExtensions = Object.freeze({
    active: operations.length > 0 || intrinsics.length > 0,
    allowedRuntimeImports: sortedUnique(selected.flatMap((record) => {
      const manifest = record.manifest || {};
      const compatibility = manifest.publicApi && Array.isArray(manifest.publicApi.compatibilitySubpaths)
        ? manifest.publicApi.compatibilitySubpaths.map(String)
        : [];
      return [String(manifest.lowerableSubpath), ...compatibility];
    })),
    effects: Object.freeze(operations.map((operation) => effectWithSourceFile(operation.canonicalEffect, publicSourceName))),
    intrinsics: Object.freeze(intrinsics.map((intrinsic) => effectWithSourceFile(intrinsic, publicSourceName))),
    schemaReferences: Object.freeze(schemaReferences.map((reference) => schemaReferenceWithSourceFile(reference, publicSourceName))),
    resultAdapters: Object.freeze(resultAdapters.map((adapter) => effectWithSourceFile(adapter, publicSourceName))),
    plans: Object.freeze(plans.map((plan) => planWithSourceFile(plan, publicSourceName))),
    diagnostics: Object.freeze(diagnostics),
    // Preserve the sealed public package-extension envelope. Graph-selected
    // manifest dependencies remain private recognition facts and join watch
    // inputs at the project compiler boundary.
    dependencies: Object.freeze([])
  });
  return deepFreeze({
    version: PACKAGE_OPERATION_RECOGNITION_VERSION,
    operations: Object.freeze(operations),
    intrinsics: Object.freeze(intrinsics),
    schemaReferences: Object.freeze(schemaReferences),
    realizationArtifacts: Object.freeze(realizationArtifacts),
    inspectionArtifacts: Object.freeze(inspectionArtifacts),
    managedHandlers: Object.freeze(managedHandlers),
    guestUnits: Object.freeze(guestUnits),
    cryptoRequirements: combinePackageCryptoRequirements(cryptoRequirements),
    resultAdapters: Object.freeze(resultAdapters),
    packages: Object.freeze(packages),
    selectedContracts: Object.freeze(selected.map((record) => String(record.manifest.contractId))),
    dependencies,
    publicExtensions,
    diagnostics: publicExtensions.diagnostics,
    errors: Object.freeze(publicExtensions.diagnostics.filter((entry) => String(entry.severity || 'error') === 'error')),
    policy: Object.freeze({
      sourceAwareRecognition: true,
      selection: Array.isArray(options.selectedContracts) ? 'reachable-graph' : 'compatibility-source-scan',
      lateLoweringReceivesSourceAst: false,
      lateLoweringReceivesSourceText: false,
      lateLoweringInput: CANONICAL_PACKAGE_OPERATION_VERSION,
      firstPartyBuildersOnly: true,
      externalRegistration: false
    })
  });
}

function combinePackageOperationRecognitions(recognitions = []) {
  const inputs = recognitions.filter((entry) => entry && entry.version === PACKAGE_OPERATION_RECOGNITION_VERSION);
  const flattened = inputs.flatMap((recognition) => recognition.operations || []).sort((left, right) => {
    const leftFile = String(left.source && left.source.file || '');
    const rightFile = String(right.source && right.source.file || '');
    return leftFile.localeCompare(rightFile)
      || Number(left.range && left.range.start || 0) - Number(right.range && right.range.start || 0)
      || left.contractId.localeCompare(right.contractId)
      || left.kind.localeCompare(right.kind);
  });
  const operations = flattened.map((operation, index) => deepFreeze({
    ...cloneJson(operation),
    id: `${operation.contractId}:${index + 1}:${operation.kind}`,
    order: index + 1
  }));
  const packageRecords = new Map();
  for (const recognition of inputs) {
    for (const record of recognition.packages || []) {
      if (!packageRecords.has(record.contractId)) packageRecords.set(record.contractId, cloneJson(record));
    }
  }
  const intrinsics = inputs.flatMap((entry) => entry.intrinsics || []).sort((a, b) => String(a.loc && a.loc.file || '').localeCompare(String(b.loc && b.loc.file || '')) || Number(a.range && a.range.start || 0) - Number(b.range && b.range.start || 0));
  const schemaReferences = inputs.flatMap((entry) => entry.schemaReferences || []).sort((a, b) => String(a.file || '').localeCompare(String(b.file || ''))
    || Number(a.position && a.position.offset || 0) - Number(b.position && b.position.offset || 0)
    || String(a.id || '').localeCompare(String(b.id || '')));
  const packages = [...packageRecords.values()].map((record) => deepFreeze({
    ...record,
    operationCount: operations.filter((operation) => operation.contractId === record.contractId).length,
    intrinsicCount: intrinsics.filter((intrinsic) => intrinsic.contractId === record.contractId).length
  })).sort((left, right) => left.contractId.localeCompare(right.contractId));
  const resultAdapters = inputs.flatMap((entry) => entry.resultAdapters || []).sort((a, b) => String(a.loc && a.loc.file || '').localeCompare(String(b.loc && b.loc.file || '')) || Number(a.range && a.range.start || 0) - Number(b.range && b.range.start || 0));
  const realizationArtifactRecords = new Map();
  for (const artifact of inputs.flatMap((entry) => entry.realizationArtifacts || [])) {
    const id = String(artifact && artifact.id || '');
    const fingerprint = sha256(JSON.stringify(artifact));
    const existing = realizationArtifactRecords.get(id);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new PackageOperationSeamError(
        'PULSE_PACKAGE_REALIZATION_ARTIFACT_CONFLICT',
        `Package realization artifact ${id} has conflicting private data.`,
        { id }
      );
    }
    if (!existing) realizationArtifactRecords.set(id, { fingerprint, artifact });
  }
  const realizationArtifacts = [...realizationArtifactRecords.values()]
    .map((entry) => deepFreeze(cloneJson(entry.artifact)))
    .sort((left, right) => left.id.localeCompare(right.id));
  const inspectionArtifactRecords = new Map();
  for (const artifact of inputs.flatMap((entry) => entry.inspectionArtifacts || [])) {
    const id = String(artifact && artifact.id || '');
    const fingerprint = sha256(JSON.stringify(artifact));
    const existing = inspectionArtifactRecords.get(id);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new PackageOperationSeamError(
        'PULSE_PACKAGE_INSPECTION_ARTIFACT_CONFLICT',
        `Package inspection artifact ${id} has conflicting static data.`,
        { id }
      );
    }
    if (!existing) inspectionArtifactRecords.set(id, { fingerprint, artifact });
  }
  const inspectionArtifacts = [...inspectionArtifactRecords.values()]
    .map((entry) => deepFreeze(cloneJson(entry.artifact)))
    .sort((left, right) => left.id.localeCompare(right.id));
  const managedHandlerRecords = new Map();
  for (const descriptor of inputs.flatMap((entry) => entry.managedHandlers || [])) {
    const id = String(descriptor && descriptor.id || '');
    const fingerprint = sha256(JSON.stringify(descriptor));
    const existing = managedHandlerRecords.get(id);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new PackageOperationSeamError(
        'PULSE_MANAGED_HANDLER_DESCRIPTOR_CONFLICT',
        `Managed handler descriptor ${id} has conflicting static declarations.`,
        { id }
      );
    }
    if (!existing) managedHandlerRecords.set(id, { fingerprint, descriptor });
  }
  const managedHandlers = [...managedHandlerRecords.values()]
    .map((entry) => deepFreeze(cloneJson(entry.descriptor)))
    .sort((left, right) => left.id.localeCompare(right.id));
  const guestUnitRecords = new Map();
  for (const unit of inputs.flatMap((entry) => entry.guestUnits || [])) {
    const id = String(unit && unit.id || '');
    const fingerprint = sha256(JSON.stringify(unit));
    const existing = guestUnitRecords.get(id);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new PackageOperationSeamError(
        'PULSE_GUEST_UNIT_CONFLICT',
        `Guest-unit contribution ${id} has conflicting package selections.`,
        { id }
      );
    }
    if (!existing) guestUnitRecords.set(id, { fingerprint, unit });
  }
  const guestUnits = [...guestUnitRecords.values()]
    .map((entry) => deepFreeze(cloneJson(entry.unit)))
    .sort((left, right) => left.id.localeCompare(right.id));
  const cryptoRequirements = combinePackageCryptoRequirements(
    inputs.flatMap((entry) => entry.cryptoRequirements || [])
  );
  const diagnostics = inputs.flatMap((entry) => entry.diagnostics || []);
  const dependencies = sortedUnique(inputs.flatMap((entry) => entry.dependencies || []));
  const publicExtensions = deepFreeze({
    active: operations.length > 0 || intrinsics.length > 0,
    allowedRuntimeImports: sortedUnique(inputs.flatMap((entry) => entry.publicExtensions && entry.publicExtensions.allowedRuntimeImports || [])),
    effects: Object.freeze(operations.map((operation) => deepFreeze(cloneJson(operation.canonicalEffect)))),
    intrinsics: Object.freeze(intrinsics.map((intrinsic) => deepFreeze(cloneJson(intrinsic)))),
    schemaReferences: Object.freeze(schemaReferences.map((reference) => deepFreeze(cloneJson(reference)))),
    resultAdapters: Object.freeze(resultAdapters.map((adapter) => deepFreeze(cloneJson(adapter)))),
    plans: Object.freeze(inputs.flatMap((entry) => entry.publicExtensions && entry.publicExtensions.plans || []).map((entry) => deepFreeze(cloneJson(entry)))),
    diagnostics: Object.freeze(diagnostics.map((entry) => deepFreeze(cloneJson(entry)))),
    dependencies: Object.freeze([])
  });
  return deepFreeze({
    version: PACKAGE_OPERATION_RECOGNITION_VERSION,
    operations: Object.freeze(operations),
    intrinsics: Object.freeze(intrinsics),
    schemaReferences: Object.freeze(schemaReferences),
    realizationArtifacts: Object.freeze(realizationArtifacts),
    inspectionArtifacts: Object.freeze(inspectionArtifacts),
    managedHandlers: Object.freeze(managedHandlers),
    guestUnits: Object.freeze(guestUnits),
    cryptoRequirements,
    resultAdapters: Object.freeze(resultAdapters),
    packages: Object.freeze(packages),
    selectedContracts: sortedUnique(inputs.flatMap((entry) => entry.selectedContracts || [])),
    dependencies,
    publicExtensions,
    diagnostics: publicExtensions.diagnostics,
    errors: Object.freeze(publicExtensions.diagnostics.filter((entry) => String(entry.severity || 'error') === 'error')),
    policy: Object.freeze({
      sourceAwareRecognition: true,
      selection: 'reachable-graph-per-module',
      lateLoweringReceivesSourceAst: false,
      lateLoweringReceivesSourceText: false,
      lateLoweringInput: CANONICAL_PACKAGE_OPERATION_VERSION,
      firstPartyBuildersOnly: true,
      externalRegistration: false
    })
  });
}

function packageOperationRecognitionFromEffects(effects = []) {
  const operations = effects.map((effect, index) => canonicalPackageOperation(
    Object.fromEntries(CANONICAL_PACKAGE_EFFECT_FIELDS
      .filter((field) => effect && Object.prototype.hasOwnProperty.call(effect, field))
      .map((field) => [field, effect[field]])),
    {
    packageName: effect && effect.package,
    manifest: {
      contractId: effect && effect.contractId,
      npmPackage: effect && effect.package,
      lowerableSubpath: effect && effect.import,
      compiler: { builderOwner: effect && effect.package, trust: 'first-party' },
      modes: { wasm: { hostCapabilities: [], lowerings: [] } }
    }
  }, index + 1));
  const counts = new Map();
  const records = new Map();
  for (const operation of operations) {
    counts.set(operation.contractId, (counts.get(operation.contractId) || 0) + 1);
    if (!records.has(operation.contractId)) records.set(operation.contractId, {
      contractId: operation.contractId,
      package: operation.package,
      lowerableSubpath: operation.lowerableSubpath,
      builder: { owner: operation.package, trust: 'first-party', entry: '', export: '' },
      mode: '',
      hostCapabilities: Object.freeze([])
    });
  }
  const packages = [...records.values()].map((record) => deepFreeze({ ...record, operationCount: counts.get(record.contractId) || 0 }));
  return deepFreeze({
    version: PACKAGE_OPERATION_RECOGNITION_VERSION,
    operations: Object.freeze(operations),
    intrinsics: Object.freeze([]),
    schemaReferences: Object.freeze(effects.flatMap((effect) => effect && Array.isArray(effect.schemaReferences) ? effect.schemaReferences : []).map(canonicalPackageSchemaReference)),
    realizationArtifacts: Object.freeze([]),
    inspectionArtifacts: Object.freeze([]),
    managedHandlers: Object.freeze([]),
    guestUnits: Object.freeze([]),
    cryptoRequirements: Object.freeze([]),
    resultAdapters: Object.freeze([]),
    packages: Object.freeze(packages),
    selectedContracts: Object.freeze(packages.map((entry) => entry.contractId)),
    dependencies: Object.freeze([]),
    publicExtensions: Object.freeze({
      active: operations.length > 0,
      allowedRuntimeImports: sortedUnique(packages.flatMap((entry) => [entry.lowerableSubpath, ...(entry.compatibilitySubpaths || [])])),
      effects: Object.freeze(operations.map((operation) => deepFreeze(cloneJson(operation.canonicalEffect)))),
      intrinsics: Object.freeze([]),
      schemaReferences: Object.freeze(effects.flatMap((effect) => effect && Array.isArray(effect.schemaReferences) ? effect.schemaReferences : []).map(canonicalPackageSchemaReference)),
      resultAdapters: Object.freeze([]),
      plans: Object.freeze([]), diagnostics: Object.freeze([]), dependencies: Object.freeze([])
    }),
    diagnostics: Object.freeze([]), errors: Object.freeze([]),
    policy: Object.freeze({
      sourceAwareRecognition: false,
      lateLoweringReceivesSourceAst: false,
      lateLoweringReceivesSourceText: false,
      lateLoweringInput: CANONICAL_PACKAGE_OPERATION_VERSION,
      firstPartyBuildersOnly: true,
      externalRegistration: false
    })
  });
}

function lowerCanonicalPackageOperations(recognition) {
  if (!recognition || recognition.version !== PACKAGE_OPERATION_RECOGNITION_VERSION || !Array.isArray(recognition.operations)) {
    throw new PackageOperationSeamError('PULSE_PACKAGE_OPERATION_BUNDLE_INVALID', `Package lowering requires ${PACKAGE_OPERATION_RECOGNITION_VERSION}.`, {
      version: recognition && recognition.version
    });
  }
  try {
    return normalizePackageLoweringBundle({
      inputVersion: PACKAGE_OPERATION_RECOGNITION_VERSION,
      operations: recognition.operations,
      packages: recognition.packages || [],
      schemaReferences: recognition.schemaReferences || [],
      realizationArtifacts: recognition.realizationArtifacts || [],
      guestUnits: recognition.guestUnits || [],
      cryptoRequirements: recognition.cryptoRequirements || []
    });
  } catch (error) {
    throw new PackageOperationSeamError(
      'PULSE_PACKAGE_OPERATION_BUNDLE_INVALID',
      `Package lowering requires an exact ${PACKAGE_LOWERING_BUNDLE_VERSION} boundary.`,
      { cause: error && error.message }
    );
  }
}

function packageExtensionsForRecognition(recognition) {
  if (!recognition || recognition.version !== PACKAGE_OPERATION_RECOGNITION_VERSION) {
    throw new PackageOperationSeamError('PULSE_PACKAGE_OPERATION_BUNDLE_INVALID', 'Expected a package operation recognition bundle.');
  }
  return recognition.publicExtensions;
}

function attachPackageOperationRecognition(compiled, recognition) {
  if (!compiled || typeof compiled !== 'object') throw new TypeError('attachPackageOperationRecognition requires a compiled program.');
  if (!recognition || recognition.version !== PACKAGE_OPERATION_RECOGNITION_VERSION) throw new TypeError('attachPackageOperationRecognition requires a recognition bundle.');
  recognitionsByCompiled.set(compiled, recognition);
  return compiled;
}

function packageOperationRecognitionForCompiled(compiled) {
  return compiled && typeof compiled === 'object' ? recognitionsByCompiled.get(compiled) : undefined;
}

module.exports = Object.freeze({
  CANONICAL_PACKAGE_OPERATION_VERSION,
  PACKAGE_OPERATION_RECOGNITION_VERSION,
  PACKAGE_LOWERING_BUNDLE_VERSION,
  PACKAGE_RESULT_ADAPTER_VERSION,
  PACKAGE_INTRINSIC_VERSION,
  PACKAGE_CRYPTO_REQUIREMENT_VERSION,
  PACKAGE_INSPECTION_ARTIFACT_VERSION,
  PACKAGE_CONTRACT_CATALOG_VERSION,
  PackageOperationSeamError,
  assertCanonicalPackageOperation,
  discoverPackageContractCatalog,
  recognizeProjectPackageOperations,
  combinePackageOperationRecognitions,
  packageOperationRecognitionFromEffects,
  lowerCanonicalPackageOperations,
  packageExtensionsForRecognition,
  attachPackageOperationRecognition,
  packageOperationRecognitionForCompiled
});
