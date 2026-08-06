'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadContractsDiagnostics();
const {
  HANDLER_LIBRARY_CONTRACTS_VERSION,
  HANDLER_LIBRARY_CONTRACTS_PHASE,
  HANDLER_EXECUTION_MODES_VERSION,
  LIBRARY_CONTRACT_SCHEMA_VERSION,
  LIBRARY_CONTRACT_VERSION,
  LIBRARY_CAPABILITIES_VERSION,
  LIBRARY_COMPATIBILITY_REPORT_VERSION,
  ALLOWED_HANDLER_EXECUTION_MODES,
  ALLOWED_LIBRARY_MODES,
  ALLOWED_HOST_CAPABILITIES,
  sortedUnique,
  defaultLibraryContracts,
  libraryContractFromLowerableManifest,
  validateLibraryContract
} = loadContractsLibraryContracts();
const {
  LOWERABLE_LIBRARY_MANIFEST_VERSION,
  validateLowerableLibraryManifest
} = loadContractsLibraryManifest();
const {
  PACKAGE_BUILDER_INVOCATION_VERSION,
  normalizePackageBuilderInvocation,
  normalizePackageBuilderResult
} = loadContractsPackageContract();

const PHASE = HANDLER_LIBRARY_CONTRACTS_PHASE;

function loadContractsDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/diagnostics.js');
    }
    throw error;
  }
}

function loadContractsLibraryContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/library/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/library/contracts.js');
    }
    throw error;
  }
}


function loadContractsLibraryManifest() {
  try {
    return require('@pulse-compute/wasm-contracts/library/manifest');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/library/manifest.js');
    }
    throw error;
  }
}

function loadContractsPackageContract() {
  try {
    return require('@pulse-compute/wasm-contracts/package/package-contract');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/package/package-contract.js');
    }
    throw error;
  }
}

function loadAssetsContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/assets/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/assets/contracts.js');
    }
    throw error;
  }
}




function loadGripContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/grip/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/grip/contracts.js');
    }
    throw error;
  }
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findWorkspaceRoot(cwd) {
  let current = path.resolve(cwd || process.cwd());
  while (true) {
    const manifest = readJsonIfExists(path.join(current, 'package.json'));
    if ((manifest && manifest.workspaces) || fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd || process.cwd());
    current = parent;
  }
}

function workspacePatterns(root) {
  const manifest = readJsonIfExists(path.join(root, 'package.json')) || {};
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  if (manifest.workspaces && Array.isArray(manifest.workspaces.packages)) return manifest.workspaces.packages;
  const pnpmWorkspace = path.join(root, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmWorkspace)) {
    return fs.readFileSync(pnpmWorkspace, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, ''))
      .filter((line) => line && !line.startsWith('#'));
  }
  return ['packages/*'];
}

function expandWorkspacePattern(root, pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/');
  if (!normalized.endsWith('/*')) return [];
  const base = path.join(root, normalized.slice(0, -2));
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(base, entry.name));
}


function candidateNodeModulesRoots(root, cwd) {
  const roots = [];
  const seen = new Set();
  function add(dir) {
    const resolved = path.resolve(dir);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      roots.push(resolved);
    }
  }
  add(path.join(root, 'node_modules'));
  let current = path.resolve(cwd || root || process.cwd());
  const stop = path.dirname(path.resolve(root || current));
  while (true) {
    add(path.join(current, 'node_modules'));
    if (current === path.resolve(root || current)) break;
    const parent = path.dirname(current);
    if (parent === current || parent === stop) break;
    current = parent;
  }
  return roots;
}

function nodeModulesPackageDirs(nodeModulesRoot) {
  if (!fs.existsSync(nodeModulesRoot)) return [];
  const out = [];
  for (const entry of fs.readdirSync(nodeModulesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(nodeModulesRoot, entry.name);
    if (entry.name.startsWith('@')) {
      if (!fs.existsSync(full)) continue;
      for (const scoped of fs.readdirSync(full, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
        if (scoped.name.startsWith('.')) continue;
        out.push(path.join(full, scoped.name));
      }
    } else {
      out.push(full);
    }
  }
  return out;
}

function packageDirsFromNodeModules(root, cwd) {
  return candidateNodeModulesRoots(root, cwd).flatMap((nodeModulesRoot) => nodeModulesPackageDirs(nodeModulesRoot));
}

function packageManifestPath(packageJson) {
  const pulsewasm = packageJson && packageJson.pulsewasm;
  if (!pulsewasm || typeof pulsewasm !== 'object') return undefined;
  if (typeof pulsewasm.manifest === 'string') return pulsewasm.manifest;
  if (typeof pulsewasm.lowerableManifest === 'string') return pulsewasm.lowerableManifest;
  return undefined;
}

function loadManifestFile(file) {
  delete require.cache[require.resolve(file)];
  const loaded = require(file);
  return loaded && loaded.pulseWasmManifest ? loaded.pulseWasmManifest : loaded;
}

function makeLowerableBuilderDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({
    phase: PHASE,
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: { file: '<lowerable-compiler-builder>' }
  });
}

function resolveLowerableCompilerBuilder(record) {
  const manifest = record && record.manifest ? record.manifest : {};
  const compiler = manifest.compiler && typeof manifest.compiler === 'object' ? manifest.compiler : {};
  const entry = compiler.entry;
  const exportName = compiler.export;
  const diagnostics = [];

  if (compiler.trust !== 'first-party') {
    diagnostics.push(makeLowerableBuilderDiagnostic(
      'PULSEWASM_LOWERABLE_COMPILER_BUILDER_TRUST_REQUIRED',
      `Lowerable compiler builder for ${manifest.contractId || '<unknown>'} must declare trust "first-party".`,
      'Pass 46 only executes first-party package-owned builders; arbitrary third-party lowerers remain disabled.',
      { contractId: manifest.contractId, trust: compiler.trust }
    ));
  }

  if (!entry || typeof entry !== 'string') {
    diagnostics.push(makeLowerableBuilderDiagnostic(
      'PULSEWASM_LOWERABLE_COMPILER_BUILDER_ENTRY_REQUIRED',
      `Lowerable compiler builder for ${manifest.contractId || '<unknown>'} must declare compiler.entry.`,
      'Add compiler.entry to the package-owned PulseWasm manifest.',
      { contractId: manifest.contractId, compiler }
    ));
  }

  if (!exportName || typeof exportName !== 'string') {
    diagnostics.push(makeLowerableBuilderDiagnostic(
      'PULSEWASM_LOWERABLE_COMPILER_BUILDER_EXPORT_REQUIRED',
      `Lowerable compiler builder for ${manifest.contractId || '<unknown>'} must declare compiler.export.`,
      'Add compiler.export to the package-owned PulseWasm manifest.',
      { contractId: manifest.contractId, compiler }
    ));
  }

  return {
    status: diagnostics.length === 0 ? 'ok' : 'error',
    packageDir: record && record.packageDir,
    packageName: record && record.packageName,
    manifest,
    compiler,
    entry: entry && record && record.packageDir ? path.resolve(record.packageDir, entry) : undefined,
    exportName,
    diagnostics
  };
}

function loadLowerableCompilerBuilder(record) {
  const resolution = resolveLowerableCompilerBuilder(record);
  if (resolution.status !== 'ok') {
    const error = new Error(resolution.diagnostics[0].message);
    error.diagnostics = resolution.diagnostics;
    throw error;
  }

  delete require.cache[require.resolve(resolution.entry)];
  const loaded = require(resolution.entry);
  const builder = loaded && loaded[resolution.exportName];
  if (typeof builder !== 'function') {
    const diagnostic = makeLowerableBuilderDiagnostic(
      'PULSEWASM_LOWERABLE_COMPILER_BUILDER_EXPORT_NOT_FOUND',
      `Lowerable compiler builder ${resolution.exportName} was not exported by ${resolution.entry}.`,
      'Export the package-owned builder function named by compiler.export.',
      { entry: resolution.entry, exportName: resolution.exportName }
    );
    const error = new Error(diagnostic.message);
    error.diagnostics = [diagnostic];
    throw error;
  }

  return {
    ...resolution,
    builder,
    module: loaded
  };
}

function packageBuilderAuthority(record) {
  const manifest = record && record.manifest || {};
  return Object.freeze({
    contractId: manifest.contractId,
    npmPackage: manifest.npmPackage,
    lowerableSubpath: manifest.lowerableSubpath
  });
}

function sourceTextForInvocation(inputs, sourceFile) {
  if (inputs.sourceText !== undefined) return String(inputs.sourceText);
  if (sourceFile && typeof sourceFile.getFullText === 'function') return sourceFile.getFullText();
  if (sourceFile && typeof sourceFile.text === 'string') return sourceFile.text;
  return '';
}

function invokeLowerableCompilerBuilder(loaded, record, libraryContracts, inputs = {}) {
  const sourceFile = inputs.sourceFile || null;
  const sourcePath = String(
    inputs.sourcePath
    || sourceFile && sourceFile.fileName
    || '<package-lowering-source>'
  ).replace(/\\/g, '/');
  const authority = packageBuilderAuthority(record);
  const invocation = normalizePackageBuilderInvocation({
    version: PACKAGE_BUILDER_INVOCATION_VERSION,
    cwd: path.resolve(inputs.cwd || process.cwd()),
    workspaceRoot: inputs.workspaceRoot == null ? null : path.resolve(inputs.workspaceRoot),
    sourcePath,
    sourceText: sourceTextForInvocation(inputs, sourceFile),
    sourceFile,
    typescript: inputs.typescript || inputs.ts || null,
    manifest: record.manifest,
    libraryContracts,
    packageCompilerBuilder: {
      owner: record.manifest && record.manifest.compiler ? record.manifest.compiler.builderOwner : record.packageName,
      entry: loaded.entry,
      export: loaded.exportName,
      trust: loaded.compiler && loaded.compiler.trust
    },
    generatedBy: inputs.generatedBy || PACKAGE_BUILDER_INVOCATION_VERSION,
    routePlan: inputs.routePlan || null,
    schemaBundle: inputs.schemaBundle || null
  }, authority);
  const result = loaded.builder(invocation);
  return normalizePackageBuilderResult(result, authority);
}

function discoverLowerableLibraryManifests(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const root = inputs.workspaceRoot || findWorkspaceRoot(cwd);
  const workspaceDirs = workspacePatterns(root).flatMap((pattern) => expandWorkspacePattern(root, pattern));
  const nodeModuleDirs = inputs.scanNodeModules === false ? [] : packageDirsFromNodeModules(root, cwd);
  const packageDirs = [];
  const seenDirs = new Set();
  for (const packageDir of workspaceDirs.concat(nodeModuleDirs)) {
    const resolved = path.resolve(packageDir);
    const identity = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
    if (seenDirs.has(identity)) continue;
    seenDirs.add(identity);
    packageDirs.push(resolved);
  }
  const manifests = [];
  const seenManifests = new Set();

  for (const packageDir of packageDirs) {
    const packageJsonPath = path.join(packageDir, 'package.json');
    const packageJson = readJsonIfExists(packageJsonPath);
    const manifestRef = packageManifestPath(packageJson);
    if (!manifestRef) continue;
    const manifestFile = path.resolve(packageDir, manifestRef);
    const manifestKey = manifestFile;
    if (seenManifests.has(manifestKey)) continue;
    seenManifests.add(manifestKey);
    const manifest = loadManifestFile(manifestFile);
    const validation = validateLowerableLibraryManifest(manifest);
    manifests.push({
      packageDir,
      packageName: packageJson.name,
      manifestFile,
      manifest,
      validation,
      source: workspaceDirs.includes(packageDir) ? 'workspace' : 'node_modules'
    });
  }

  manifests.sort((a, b) => String(a.manifest.contractId || a.packageName).localeCompare(String(b.manifest.contractId || b.packageName)));
  return manifests;
}

function enrichKnownProtocolContract(contract) {
  const assetsContracts = loadAssetsContracts();
  const gripContracts = loadGripContracts();
  if (contract && contract.package === assetsContracts.ASSETS_CONTRACT_ID) {
    const extension = assetsContracts.assetsProtocolExtension();
    return {
      ...contract,
      assets: extension.assets,
      policy: {
        ...(contract.policy || {}),
        ...extension.policy
      }
    };
  }
  if (contract && contract.package === gripContracts.GRIP_CONTRACT_ID) {
    const extension = gripContracts.gripProtocolExtension();
    return {
      ...contract,
      grip: extension.grip,
      policy: {
        ...(contract.policy || {}),
        ...extension.policy
      }
    };
  }
  return contract;
}

function lowerableManifestRecordToLibraryContract(record) {
  const contract = libraryContractFromLowerableManifest(record.manifest);
  return enrichKnownProtocolContract(contract);
}

function resolveDefaultLibraryContracts(inputs = {}) {
  const byPackage = new Map(defaultLibraryContracts().map((contract) => [contract.package, { ...contract, fixture: true }]));
  for (const record of discoverLowerableLibraryManifests(inputs)) {
    const contract = lowerableManifestRecordToLibraryContract(record);
    byPackage.set(contract.package, {
      ...contract,
      fixture: false,
      supersedesFixture: Boolean(defaultLibraryContracts().some((entry) => entry.package === contract.package))
    });
  }
  return Array.from(byPackage.values()).sort((a, b) => String(a.package).localeCompare(String(b.package)));
}

function findLowerableManifestRecord(inputs = {}) {
  const manifestRecords = Array.isArray(inputs.manifestRecords) && inputs.manifestRecords.length > 0
    ? inputs.manifestRecords
    : discoverLowerableLibraryManifests({ cwd: inputs.cwd || process.cwd(), workspaceRoot: inputs.workspaceRoot, scanNodeModules: inputs.scanNodeModules });
  const explicitManifest = inputs.manifest;
  if (explicitManifest) {
    const record = manifestRecords.find((entry) => entry.manifest === explicitManifest || (
      entry.manifest &&
      entry.manifest.contractId === explicitManifest.contractId &&
      entry.manifest.npmPackage === explicitManifest.npmPackage
    ));
    if (record) return { record, manifestRecords };
  }
  const contractId = inputs.contractId;
  const npmPackage = inputs.npmPackage;
  const lowerableSubpath = inputs.lowerableSubpath;
  return {
    record: manifestRecords.find((entry) => {
      const manifest = entry.manifest || {};
      if (contractId && manifest.contractId !== contractId) return false;
      if (npmPackage && manifest.npmPackage !== npmPackage) return false;
      if (lowerableSubpath && manifest.lowerableSubpath !== lowerableSubpath) return false;
      return Boolean(contractId || npmPackage || lowerableSubpath);
    }),
    manifestRecords
  };
}

function buildPackageOwnedLoweringPlan(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const { record, manifestRecords } = findLowerableManifestRecord(inputs);
  if (!record) {
    const error = new Error(`Could not discover package-owned lowerable manifest ${inputs.contractId || inputs.npmPackage || inputs.lowerableSubpath || '<unknown>'}.`);
    error.diagnostics = [];
    throw error;
  }
  const loaded = loadLowerableCompilerBuilder(record);
  const libraryContracts = Array.isArray(inputs.libraryContracts) && inputs.libraryContracts.length > 0
    ? inputs.libraryContracts
    : resolveDefaultLibraryContracts({ cwd, workspaceRoot: inputs.workspaceRoot, scanNodeModules: inputs.scanNodeModules });
  return invokeLowerableCompilerBuilder(loaded, record, libraryContracts, inputs);
}

function buildHandlerExecutionModes(inputs = {}) {
  const modes = [
    {
      mode: 'host-imports',
      status: 'implemented-proof-local-node',
      current: true,
      description: 'Wasm routing core calls host JS handlers through deterministic imports. This is the current bridge/local/Node adapter mode.',
      evidence: ['assemblyscript-handlers.json', 'wasm-host-bridge.json', 'host-runtime-kernel.json', 'node-adapter.json'],
      optimizedTarget: false,
      debtBehavior: 'none when selected intentionally for bridge/local mode'
    },
    {
      mode: 'compiled-wasm',
      status: 'planned-optimized-target',
      current: false,
      description: 'Routing core, user handlers, and compatible library sidecars compile/link into the Wasm artifact.',
      evidence: [],
      optimizedTarget: true,
      requires: ['compiled user handler pipeline', 'library sidecar validation', 'host capability/provider mapping'],
      notImplementedYet: true
    },
    {
      mode: 'js-engine',
      status: 'manual-escape-hatch',
      current: false,
      description: 'Manual JS engine path for shipping when the Wasm target is not viable. Never automatic fallback.',
      evidence: ['deployment-posture.json'],
      optimizedTarget: false,
      debtBehavior: 'deployment-posture.json records manual escape-hatch debt'
    }
  ];
  return {
    version: HANDLER_EXECUTION_MODES_VERSION,
    generatedBy: inputs.generatedBy || PACKAGE_VERSION,
    phase: PHASE,
    status: 'locked',
    policy: {
      noAutomaticFallback: true,
      noModeInference: true,
      hostImportsAreProofAndBridgeMode: true,
      compiledWasmIsOptimizedTarget: true,
      jsEngineIsManualDebt: true
    },
    summary: {
      modes: modes.length,
      currentMode: 'host-imports',
      optimizedTarget: 'compiled-wasm',
      manualEscapeHatch: 'js-engine'
    },
    modes
  };
}

function buildLibraryContractSchema(inputs = {}) {
  return {
    version: LIBRARY_CONTRACT_SCHEMA_VERSION,
    generatedBy: inputs.generatedBy || PACKAGE_VERSION,
    phase: PHASE,
    contractVersion: LIBRARY_CONTRACT_VERSION,
    status: 'locked',
    description: 'Schema summary for pulse.library.json. This is a validation artifact, not a public plugin API.',
    required: ['version', 'package', 'modes.typescript.entry', 'modes.jsEngine.entry', 'modes.wasm.sidecar', 'modes.wasm.lowerings'],
    modes: ALLOWED_LIBRARY_MODES.map((mode) => ({ mode })),
    allowedHostCapabilities: ALLOWED_HOST_CAPABILITIES,
    manifestVersion: LOWERABLE_LIBRARY_MANIFEST_VERSION,
    packageIdentity: {
      sourceOfTruth: 'package-owned lowerable manifests discovered from package.json pulsewasm.manifest',
      corePackageRegistry: false
    },
    loweringShape: {
      tsSymbol: 'static imported TS symbol declared by the package-owned manifest',
      asSymbol: 'static AS sidecar symbol declared by the package-owned manifest',
      callShape: 'declared call-shape name; validation remains strict',
      hostCapabilities: 'subset of allowedHostCapabilities'
    },
    policies: {
      contractRequiredForWasm: true,
      sidecarRequiredForWasm: true,
      arbitraryTsCompilationForbidden: true,
      inferredCompatibilityForbidden: true,
      hintsAreContracts: true,
      publicPluginApi: false
    },
    diagnostics: {
      errors: [
        'PULSEWASM_LIBRARY_CONTRACT_VERSION_UNSUPPORTED',
        'PULSEWASM_LIBRARY_WASM_SIDECAR_REQUIRED',
        'PULSEWASM_LIBRARY_LOWERINGS_REQUIRED',
        'PULSEWASM_LIBRARY_UNKNOWN_HOST_CAPABILITY'
      ],
      debt: ['PULSEWASM_LIBRARY_REQUIRES_JS_ENGINE']
    }
  };
}

function buildLibraryCompatibilityReport(contracts, inputs = {}) {
  const reports = contracts.map((contract) => validateLibraryContract(contract));
  const diagnostics = reports.flatMap((report) => report.diagnostics);
  return {
    version: LIBRARY_COMPATIBILITY_REPORT_VERSION,
    generatedBy: inputs.generatedBy || PACKAGE_VERSION,
    phase: PHASE,
    status: diagnostics.length === 0 ? 'ok' : 'error',
    summary: {
      libraries: reports.length,
      ok: reports.filter((report) => report.status === 'ok').length,
      error: reports.filter((report) => report.status === 'error').length,
      lowerings: reports.reduce((sum, report) => sum + report.lowerings.length, 0),
      hostCapabilities: sortedUnique(reports.flatMap((report) => report.hostCapabilities)).length,
      diagnostics: diagnostics.length
    },
    reports,
    diagnostics
  };
}

function buildLibraryCapabilities(contracts, compatibilityReport, inputs = {}) {
  const reports = compatibilityReport.reports || [];
  return {
    version: LIBRARY_CAPABILITIES_VERSION,
    generatedBy: inputs.generatedBy || PACKAGE_VERSION,
    phase: PHASE,
    status: compatibilityReport.status,
    policy: {
      sourceOfTruth: 'pulse.library.json contract manifests',
      noGuessedPackageCompatibility: true,
      sidecarsExplicit: true,
      effectsExplicit: true,
      wasiProviderDeferredTo11E: true,
      effectRuntimeDeferredTo11F: true
    },
    summary: {
      libraries: reports.length,
      wasmSidecars: reports.filter((report) => report.modes.wasmSidecar).length,
      lowerings: reports.reduce((sum, report) => sum + report.lowerings.length, 0),
      requiredHostCapabilities: sortedUnique(reports.flatMap((report) => report.hostCapabilities)).length,
      diagnostics: compatibilityReport.diagnostics.length
    },
    hostCapabilities: sortedUnique(reports.flatMap((report) => report.hostCapabilities)).map((capability) => ({
      capability,
      status: 'declared-required-by-library-contract',
      providerMapping: 'deferred-to-11E'
    })),
    libraries: reports.map((report) => ({
      package: report.package,
      status: report.status,
      modes: report.modes,
      sidecar: report.sidecar,
      hostCapabilities: report.hostCapabilities,
      lowerings: report.lowerings,
      policy: report.policy
    }))
  };
}

function markdownForContracts(handlerModes, schema, capabilities, compatibilityReport) {
  const lines = [];
  lines.push('# PulseWasm Phase 11D — Handler Modes + Library Capability Contracts');
  lines.push('');
  lines.push('## Status');
  lines.push('Locked.');
  lines.push('');
  lines.push('## Handler execution modes');
  for (const mode of handlerModes.modes) {
    lines.push(`- **${mode.mode}** — ${mode.status}. ${mode.description}`);
  }
  lines.push('');
  lines.push('## Library compatibility rule');
  lines.push('PulseWasm never guesses that an arbitrary TS package is Wasm-compatible. A Wasm-compatible library must provide a validated `pulse.library.json` contract and an explicit AssemblyScript sidecar.');
  lines.push('');
  lines.push('## Library fixtures validated in 11D');
  for (const library of capabilities.libraries) {
    lines.push(`- **${library.package}** — ${library.status}; sidecar: \`${library.sidecar}\`; capabilities: ${library.hostCapabilities.join(', ') || 'none'}.`);
  }
  lines.push('');
  lines.push('## Contract schema');
  lines.push(`Contract version: \`${schema.contractVersion}\`.`);
  lines.push('Required fields:');
  for (const field of schema.required) lines.push(`- \`${field}\``);
  lines.push('');
  lines.push('## Non-goals');
  lines.push('- no compiled user handlers');
  lines.push('- no sidecar compilation');
  lines.push('- no GRIP or assets implementation');
  lines.push('- no WASI provider mapping');
  lines.push('- no effect runtime');
  lines.push('- no platform target');
  lines.push('');
  lines.push('## Compatibility report');
  lines.push(`Libraries: ${compatibilityReport.summary.libraries}; lowerings: ${compatibilityReport.summary.lowerings}; diagnostics: ${compatibilityReport.summary.diagnostics}.`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildHandlerLibraryContracts(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const contracts = Array.isArray(inputs.libraryContracts) && inputs.libraryContracts.length > 0
    ? inputs.libraryContracts
    : resolveDefaultLibraryContracts({ cwd: inputs.cwd || cwd, workspaceRoot: inputs.workspaceRoot });

  const handlerExecutionModes = normalizeArtifact(buildHandlerExecutionModes({ generatedBy }), cwd);
  const libraryContractSchema = normalizeArtifact(buildLibraryContractSchema({ generatedBy }), cwd);
  const libraryCompatibilityReport = normalizeArtifact(buildLibraryCompatibilityReport(contracts, { generatedBy }), cwd);
  const libraryCapabilities = normalizeArtifact(buildLibraryCapabilities(contracts, libraryCompatibilityReport, { generatedBy }), cwd);
  const markdown = markdownForContracts(handlerExecutionModes, libraryContractSchema, libraryCapabilities, libraryCompatibilityReport);
  const diagnostics = (libraryCompatibilityReport.diagnostics || []).map((diag) => normalizeDiagnostic(diag));

  const artifact = normalizeArtifact({
    version: HANDLER_LIBRARY_CONTRACTS_VERSION,
    generatedBy,
    phase: PHASE,
    status: diagnostics.length === 0 ? 'ok' : 'error',
    scope: {
      semanticsChanged: false,
      runtimeBehaviorChanged: false,
      compiledHandlersImplemented: false,
      sidecarsCompiled: false,
      wasiMapped: false,
      effectRuntimeImplemented: false
    },
    decisions: {
      handlerExecutionModes: ALLOWED_HANDLER_EXECUTION_MODES,
      libraryCompatibilityModes: ALLOWED_LIBRARY_MODES,
      libraryContractsRequiredForWasm: true,
      sidecarsExplicit: true,
      effectsExplicit: true,
      wasiIsProviderNotAppApi: true,
      asyncIsEffectsNotLanguageAsync: true,
      automaticFallback: false
    },
    summary: {
      handlerModes: handlerExecutionModes.summary.modes,
      libraries: libraryCapabilities.summary.libraries,
      wasmSidecars: libraryCapabilities.summary.wasmSidecars,
      lowerings: libraryCapabilities.summary.lowerings,
      hostCapabilities: libraryCapabilities.summary.requiredHostCapabilities,
      diagnostics: diagnostics.length,
      readyFor11E: true,
      readyFor11F: false,
      readyForCompiledHandlers: false,
      readyForFastly: false
    }
  }, cwd);

  return {
    artifact,
    handlerExecutionModes,
    libraryContractSchema,
    libraryCapabilities,
    libraryCompatibilityReport,
    diagnostics,
    files: [
      { file: 'generated/host/handler-library-contracts.md', text: markdown }
    ]
  };
}

module.exports = {
  HANDLER_LIBRARY_CONTRACTS_VERSION,
  HANDLER_EXECUTION_MODES_VERSION,
  LIBRARY_CONTRACT_SCHEMA_VERSION,
  LIBRARY_CONTRACT_VERSION,
  LIBRARY_CAPABILITIES_VERSION,
  LIBRARY_COMPATIBILITY_REPORT_VERSION,
  ALLOWED_HANDLER_EXECUTION_MODES,
  ALLOWED_LIBRARY_MODES,
  ALLOWED_HOST_CAPABILITIES,
  defaultLibraryContracts,
  packageDirsFromNodeModules,
  discoverLowerableLibraryManifests,
  resolveLowerableCompilerBuilder,
  loadLowerableCompilerBuilder,
  invokeLowerableCompilerBuilder,
  resolveDefaultLibraryContracts,
  validateLibraryContract,
  buildHandlerLibraryContracts
};
