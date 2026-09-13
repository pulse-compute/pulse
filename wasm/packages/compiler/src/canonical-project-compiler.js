'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { buildSchemaJsonCompile } = require('@pulse-compute/wasm-schema-json/compiler/schema-json-compile');
const { buildCanonicalSchemaBundle } = require('@pulse-compute/wasm-schema-json/compiler/canonical-schema-codecs');
const {
  recognizeProjectPackageOperations,
  combinePackageOperationRecognitions,
  packageExtensionsForRecognition,
  attachPackageOperationRecognition,
  packageOperationRecognitionForCompiled
} = require('./spine/package-operation-seam.js');
const { compileCanonicalFile, compileCanonicalSource, stableSourceName } = require('./canonical-api-compiler.js');
const { detectCanonicalRouterSource, compileCanonicalRouterSource } = require('./canonical-router-compiler.js');
const { handlerIrsForCanonicalRouterOutput } = require('./spine/canonical-router.js');
const {
  ManagedHandlerCompileError,
  compileManagedHandlerDescriptors
} = require('./spine/handler-ir-managed.js');
const { executeCanonicalProjectSpine } = require('./spine/canonical-project.js');
const { planProjectCrypto } = require('./crypto-requirement-planner.js');
const {
  PROJECT_GRAPH_BUILDER_VERSION,
  ReachableProjectGraphError,
  buildReachableProjectGraph,
  finalizeReachableProjectGraph,
  reachableProjectGraphProjections,
  projectGraphContext
} = require('./project/reachable-graph-builder.js');
const {
  ROUTER_MODULE_LINKER_VERSION,
  RouterModuleLinkError,
  linkProjectPlainHandler,
  linkProjectRouterModules,
  resolveProjectRoot
} = require('./project/router-module-linker.js');
const {
  APPLICATION_IR_ENVELOPE_VERSION
} = require('@pulse-compute/wasm-contracts/project/package-ownership');
const {
  CANONICAL_PACKAGE_INSPECTION_VERSION
} = require('@pulse-compute/wasm-contracts/package/package-contract');

const CANONICAL_PROJECT_COMPILER_VERSION = 'pulse.canonical-project-compiler.v4';

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

function managedHandlerInspection(bundle) {
  if (!bundle) return null;
  return deepFreeze({
    version: bundle.version,
    descriptorVersion: bundle.descriptorVersion,
    role: bundle.role,
    bundleHash: bundle.bundleHash,
    summary: bundle.summary,
    handlers: bundle.handlers.map((handler) => ({
      id: handler.id,
      source: {
        file: handler.source.file,
        exportName: handler.source.exportName
      },
      schemas: {
        input: handler.parameters.input.schemaId,
        output: handler.result.schemaId
      },
      effects: {
        count: handler.effects.count,
        sites: handler.effects.sites.map((site) => ({
          kind: site.kind,
          capability: site.capability,
          ...(site.providerKind ? { providerKind: site.providerKind } : {}),
          ...(site.operation ? { operation: site.operation } : {})
        })),
        packageOperations: handler.effects.packageOperations.map((effect) => ({
          contractId: effect.contractId,
          package: effect.package,
          kind: effect.kind,
          capability: effect.capability,
          ...(effect.providerKind ? { providerKind: effect.providerKind } : {}),
          ...(effect.operation ? { operation: effect.operation } : {})
        })),
        continuations: handler.effects.continuations.length,
        logging: handler.effects.logging.length
      },
      providerRequirements: {
        capabilities: handler.providerRequirements.capabilities,
        providerKinds: handler.providerRequirements.providerKinds,
        operations: handler.providerRequirements.operations.map((operation) => ({
          kind: operation.kind,
          capability: operation.capability,
          ...(operation.providerKind ? { providerKind: operation.providerKind } : {}),
          ...(operation.operation ? { operation: operation.operation } : {})
        })),
        packages: handler.providerRequirements.packages.map((entry) => ({
          contractId: entry.contractId,
          package: entry.package
        })),
        hostCapabilities: handler.providerRequirements.hostCapabilities
      },
      eligibility: handler.eligibility,
      handlerHash: handler.handlerHash
    })),
    policy: {
      declaredHandlersOnly: true,
      runtimeValuesExcluded: true,
      rawPayloadsExcluded: true,
      rawRequestIdsExcluded: true,
      resolvedSecretsExcluded: true,
      providerObjectsExcluded: true
    }
  });
}

function packageInspectionProjection(recognition, managedHandlers) {
  const artifacts = recognition.inspectionArtifacts || [];
  const managed = managedHandlerInspection(managedHandlers);
  return deepFreeze({
    version: CANONICAL_PACKAGE_INSPECTION_VERSION,
    artifacts,
    managedHandlers: managed,
    summary: {
      packages: recognition.packages.length,
      artifacts: artifacts.length,
      declaredHandlers: managed ? managed.handlers.length : 0,
      handlerEffects: managed ? managed.handlers.reduce((sum, handler) => sum + handler.effects.count, 0) : 0
    },
    policy: {
      packageOwnedStaticArtifacts: true,
      canonicalManagedHandlerInspection: true,
      buildArtifactFilesDeclaredByPackage: true,
      providerObjectsExcluded: true,
      runtimeValuesExcluded: true,
      automaticFallback: false
    }
  });
}

function managedHandlerRuntimeImportKeys(descriptors) {
  return (descriptors || [])
    .filter((descriptor) => descriptor.origin && descriptor.source && descriptor.origin.file !== descriptor.source.file)
    .map((descriptor) => `${descriptor.origin.file}\u0000${descriptor.source.localName}`)
    .sort();
}

function terminalPackageIntrinsicApplication(root, recognition) {
  if (!root || root.kind !== 'handler') return null;
  const candidates = (recognition.intrinsics || []).filter((intrinsic) => (
    intrinsic
    && intrinsic.valueKind === 'response'
    && typeof intrinsic.compilerName === 'string'
    && intrinsic.compilerName.length > 0
    && Array.isArray(intrinsic.argumentIndexes)
    && intrinsic.argumentIndexes.length === 1
    && intrinsic.argumentIndexes[0] === 0
    && intrinsic.loc
    && String(intrinsic.loc.file || '').replace(/\\/g, '/') === String(root.module.path || '').replace(/\\/g, '/')
  ));
  if (candidates.length !== 1) return null;
  const intrinsic = candidates[0];
  const staticArguments = (intrinsic.staticArguments || []).map((value) => JSON.stringify(value));
  const argumentsSource = [...staticArguments, 'ctx'].join(', ');
  return deepFreeze({
    version: 'pulse.terminal-package-intrinsic-application.v1',
    contractId: intrinsic.contractId,
    package: intrinsic.package,
    intrinsic: intrinsic.intrinsic,
    compilerName: intrinsic.compilerName,
    sourceText: `export default async function handler(ctx) {\n  return ${intrinsic.compilerName}(${argumentsSource});\n}\n`,
    policy: {
      inspectionAndLoweringOnly: true,
      providerRealizationRequired: true,
      automaticFallback: false
    }
  });
}

function terminalPackageApplicationInspection(application, recognition) {
  if (!application) return null;
  const plan = recognition.publicExtensions && recognition.publicExtensions.plans
    && recognition.publicExtensions.plans.find((entry) => entry.contractId === application.contractId);
  const inspectionArtifact = (recognition.inspectionArtifacts || [])
    .find((entry) => entry.contractId === application.contractId && entry.kind === 'declaration-and-target-evidence');
  return deepFreeze({
    version: application.version,
    contractId: application.contractId,
    package: application.package,
    intrinsic: application.intrinsic,
    compilerName: application.compilerName,
    planHash: inspectionArtifact && inspectionArtifact.data && inspectionArtifact.data.planHash || null,
    declarationStatus: plan && plan.status || 'ok',
    realization: 'provider-dependent',
    policy: application.policy
  });
}

const APPLICATION_TOOLING_FRAGMENT_KEYS = new Set(['dev', 'outDir', 'schemas']);

function applicationPackageFragments(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([key]) => !APPLICATION_TOOLING_FRAGMENT_KEYS.has(key)));
}

function createApplicationEnvelope(router, projectMetadata) {
  if (!router || !projectMetadata) return undefined;
  const selected = projectMetadata.selectedProfile;
  const selectedProfile = selected && typeof selected === 'object'
    ? { name: selected.name, source: selected.source }
    : (selected ? { name: String(selected), source: projectMetadata.profileSource || 'unknown' } : null);
  const project = deepFreeze({
    constructionMode: router.applicationConstructionMode || 'router',
    projectHash: projectMetadata.projectHash || null,
    configPlanHash: projectMetadata.configPlanHash || projectMetadata.planHash || null,
    selectedProfile,
    strict: projectMetadata.strict !== false,
    symbolicBindings: projectMetadata.bindings || { config: [], secret: [] },
    packageFragments: applicationPackageFragments(projectMetadata.fragments),
    target: projectMetadata.target || (selected && selected.target) || null,
    host: projectMetadata.host || (selected && selected.host) || null
  });
  return deepFreeze({
    version: APPLICATION_IR_ENVELOPE_VERSION,
    kind: 'pulse.application-ir',
    rootKind: router.applicationKind || 'router',
    router: router.metadata,
    project
  });
}

class CanonicalProjectCompileError extends Error {
  constructor(message, diagnostics = [], detail = {}, code = 'PULSE_PROJECT_COMPILE_FAILED') {
    super(message);
    this.name = 'CanonicalProjectCompileError';
    this.code = code;
    this.diagnostics = Object.freeze([...diagnostics]);
    this.detail = Object.freeze({ ...detail });
  }
}

function projectionDiagnostic(blocker) {
  return Object.freeze({
    code: blocker.code,
    kind: 'CanonicalProjectCompileDiagnostic',
    severity: 'error',
    message: blocker.message,
    file: blocker.source.file,
    position: Object.freeze({ line: blocker.source.line, column: blocker.source.column }),
    detail: Object.freeze({
      blockerId: blocker.id,
      blockerKind: blocker.kind,
      moduleId: blocker.moduleId,
      handlerIds: blocker.handlerIds,
      packageName: blocker.packageName,
      packageSubpath: blocker.packageSubpath,
      contractId: blocker.contractId,
      specifier: blocker.specifier,
      automaticFallback: false
    })
  });
}

function cryptoPlanningDiagnostic(error, entryFile) {
  return Object.freeze({
    code: error && error.code || 'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
    kind: 'CanonicalProjectCompileDiagnostic',
    severity: 'error',
    message: error && error.message || 'Crypto realization planning failed.',
    file: entryFile,
    position: Object.freeze({ line: 1, column: 1 }),
    detail: Object.freeze({
      ...(error && error.details || {}),
      automaticFallback: false
    })
  });
}

function planCanonicalProjectCrypto(options, entryFile, recognizedRequirements = []) {
  const metadata = options.applicationProjectMetadata || {};
  const selected = metadata.selectedProfile;
  const profile = selected && typeof selected === 'object'
    ? selected.name
    : (selected ? String(selected) : null);
  const packageRequirements = [
    ...(options.cryptoRequirements || []),
    ...(recognizedRequirements || [])
  ];
  const hasReachableCryptoRequirement = packageRequirements.some(
    (entry) => entry && entry.reachable === true && Array.isArray(entry.algorithms) && entry.algorithms.length > 0
  );
  if (!metadata.crypto && !hasReachableCryptoRequirement) return undefined;
  try {
    return planProjectCrypto({
      declaration: metadata.crypto && metadata.crypto.declaration,
      packageRequirements,
      targetDescriptor: options.packageTargetDescriptor,
      target: options.target || options.packageTarget || metadata.target || null,
      profile,
      profileSelectionSource: selected && typeof selected === 'object'
        ? selected.source
        : metadata.profileSource,
      configurationSource: metadata.crypto && metadata.crypto.source
    });
  } catch (error) {
    if (!error || !String(error.code || '').startsWith('PULSE_CRYPTO_')) throw error;
    const diagnostic = cryptoPlanningDiagnostic(error, entryFile);
    throw new CanonicalProjectCompileError(
      diagnostic.message,
      [diagnostic],
      diagnostic.detail,
      diagnostic.code
    );
  }
}

function assertGraphPreflight(graphBuild, entryFile, options = {}) {
  const nativeEligibilityMode = options.nativeEligibilityMode || (options.target === 'javascript' ? 'record' : 'enforce');
  if (!['enforce', 'record'].includes(nativeEligibilityMode)) {
    throw new TypeError('nativeEligibilityMode must be enforce or record.');
  }
  if (nativeEligibilityMode === 'record') return;
  if (graphBuild.entrySafety && graphBuild.entrySafety.importSafe === false) {
    const blocker = graphBuild.nativeEligibility.blockers.find((entry) => entry.kind === 'application-entry-lifecycle-side-effect');
    throw new CanonicalProjectCompileError(
      'The configured Pulse application entry starts a known provider lifecycle during module evaluation.',
      blocker ? [projectionDiagnostic(blocker)] : [],
      { entryFile, entrySafety: graphBuild.entrySafety },
      'PULSE_APPLICATION_ENTRY_LIFECYCLE_SIDE_EFFECT'
    );
  }
  const blockers = graphBuild.nativeEligibility
    ? graphBuild.nativeEligibility.blockers.filter((entry) => entry.kind !== 'application-entry-lifecycle-side-effect')
    : [];
  if (blockers.length > 0) {
    throw new CanonicalProjectCompileError(
      `The reachable project graph has ${blockers.length} native eligibility blocker(s).`,
      blockers.map(projectionDiagnostic),
      {
        entryFile,
        nativeEligibility: graphBuild.nativeEligibility,
        packageReachability: graphBuild.packageReachability,
        automaticFallback: false
      },
      blockers[0].code
    );
  }
}

function prepareProjectPackageOperations(entryFile, options = {}) {
  const recognition = recognizeProjectPackageOperations(entryFile, {
    ...options,
    generatedBy: CANONICAL_PROJECT_COMPILER_VERSION
  });
  if (recognition.errors.length > 0) {
    throw new CanonicalProjectCompileError(
      `Package-owned canonical lowering failed with ${recognition.errors.length} diagnostic(s).`,
      recognition.errors,
      { entryFile: path.resolve(entryFile), contracts: recognition.selectedContracts },
      'PULSE_PACKAGE_LOWERING_FAILED'
    );
  }
  return recognition;
}

function prepareReachableProjectPackageOperations(graphBuild, options = {}) {
  const context = projectGraphContext(graphBuild);
  if (!context) throw new TypeError('prepareReachableProjectPackageOperations requires a reachable project graph build.');
  const recognitions = [];
  for (const module of [...context.projectModules.values()].filter((entry) => entry.runtime).sort((left, right) => left.path.localeCompare(right.path))) {
    const selectedContracts = new Set();
    for (const relation of [...module.imports, ...module.reExports]) {
      if (relation.kind === 'type-import' || relation.typeOnly === true) continue;
      const resolution = module.resolutions.find((entry) => entry.relation === relation);
      const target = resolution && context.packageModules.get(resolution.targetKey);
      if (target && target.packageContract) selectedContracts.add(target.packageContract);
    }
    if (selectedContracts.size === 0) continue;
    const preserveSingleFilePublicEnvelope = graphBuild.summary.runtimeProjectModules === 1 && module.path === graphBuild.entryKey;
    recognitions.push(prepareProjectPackageOperations(module.absolutePath, {
      ...options,
      sourceText: module.sourceText,
      sourceName: module.path,
      // Keep the sealed single-file envelope while making its public source
      // identity checkout-independent. Absolute paths remain private graph
      // facts and must not feed project or native-plan hashes.
      ...(preserveSingleFilePublicEnvelope ? { publicSourceName: module.path } : {}),
      selectedContracts: [...selectedContracts].sort()
    }));
  }
  const recognition = combinePackageOperationRecognitions(recognitions);
  const expected = graphBuild.packageReachability.selectedContracts;
  const missing = expected.filter((contractId) => !recognition.selectedContracts.includes(contractId));
  if (missing.length > 0) throw new CanonicalProjectCompileError(
    `Reachable package contract(s) were not recognized in their owning project modules: ${missing.join(', ')}.`,
    [],
    { missing, selectedContracts: expected },
    'PULSE_PACKAGE_CONTRACT_NOT_RECOGNIZED'
  );
  return recognition;
}

function packageEffectLookup(recognition) {
  const byFileAndStart = new Map();
  for (const operation of recognition.operations || []) {
    const effect = operation.canonicalEffect;
    const file = String(effect && effect.loc && effect.loc.file || '').replace(/\\/g, '/');
    const start = Number(effect && effect.range && effect.range.start);
    if (file && Number.isSafeInteger(start)) byFileAndStart.set(`${file}\u0000${start}`, effect);
  }
  return (call) => {
    const sourceFile = call && typeof call.getSourceFile === 'function' ? call.getSourceFile() : undefined;
    const file = String(sourceFile && sourceFile.fileName || '').replace(/\\/g, '/');
    const start = call && sourceFile && typeof call.getStart === 'function' ? call.getStart(sourceFile) : NaN;
    return byFileAndStart.get(`${file}\u0000${start}`);
  };
}

function packageIntrinsicLookup(recognition) {
  const byFileAndStart = new Map();
  for (const intrinsic of recognition.intrinsics || []) {
    const file = String(intrinsic && intrinsic.loc && intrinsic.loc.file || '').replace(/\\/g, '/');
    const start = Number(intrinsic && intrinsic.range && intrinsic.range.start);
    if (file && Number.isSafeInteger(start)) byFileAndStart.set(`${file}\u0000${start}`, intrinsic);
  }
  return (call) => {
    const sourceFile = call && typeof call.getSourceFile === 'function' ? call.getSourceFile() : undefined;
    const file = String(sourceFile && sourceFile.fileName || '').replace(/\\/g, '/');
    const start = call && sourceFile && typeof call.getStart === 'function' ? call.getStart(sourceFile) : NaN;
    return byFileAndStart.get(`${file}\u0000${start}`);
  };
}


function packageResultAdapterLookup(recognition) {
  const byFileAndStart = new Map();
  for (const adapter of recognition.resultAdapters || []) {
    const file = String(adapter && adapter.loc && adapter.loc.file || '').replace(/\\/g, '/');
    const start = Number(adapter && adapter.range && adapter.range.start);
    if (file && Number.isSafeInteger(start)) byFileAndStart.set(`${file}\u0000${start}`, adapter);
  }
  return (call) => {
    const sourceFile = call && typeof call.getSourceFile === 'function' ? call.getSourceFile() : undefined;
    const file = String(sourceFile && sourceFile.fileName || '').replace(/\\/g, '/');
    const start = call && sourceFile && typeof call.getStart === 'function' ? call.getStart(sourceFile) : NaN;
    return byFileAndStart.get(`${file}\u0000${start}`);
  };
}

function normalizedModulePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function modulePathCandidates(value, rootDir) {
  const normalized = normalizedModulePath(value);
  if (!normalized) return new Set();
  const candidates = new Set([normalized]);
  if (path.isAbsolute(normalized)) {
    candidates.add(normalizedModulePath(path.normalize(normalized)));
    return candidates;
  }
  candidates.add(normalizedModulePath(path.resolve(rootDir || process.cwd(), normalized)));
  candidates.add(normalizedModulePath(path.resolve(process.cwd(), normalized)));
  return candidates;
}

function sameModulePath(left, right, rootDir) {
  const leftCandidates = modulePathCandidates(left, rootDir);
  const rightCandidates = modulePathCandidates(right, rootDir);
  return [...leftCandidates].some((candidate) => rightCandidates.has(candidate));
}

function callPrintKey(printer, sourceFile, call) {
  return printer.printNode(ts.EmitHint.Expression, call, sourceFile).trim();
}

function callExpressions(sourceFile) {
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return calls;
}

function sourceDiagnosticForPackageEffect(effect, message, detail = {}) {
  const start = effect && effect.loc && effect.loc.start;
  return Object.freeze({
    code: 'PULSE_PACKAGE_EFFECT_SOURCE_LINK_FAILED',
    kind: 'CanonicalProjectCompileDiagnostic',
    severity: 'error',
    message,
    file: normalizedModulePath(effect && effect.loc && effect.loc.file || '<unknown>'),
    position: Object.freeze({
      line: Number(start && start.line || 1),
      column: Number(start && start.column || 1)
    }),
    detail: Object.freeze({ ...detail })
  });
}

function routerGeneratedPackageEffectLookup(router, recognition, options = {}) {
  const effects = [...(recognition && recognition.operations || [])].map((operation) => operation.canonicalEffect);
  if (!router || effects.length === 0) return undefined;
  const records = handlerIrsForCanonicalRouterOutput(router) || [];
  const generatedSourceFile = ts.createSourceFile(
    String(router.fileName || 'app.ts'),
    String(router.sourceText || ''),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  );
  const generatedCalls = callExpressions(generatedSourceFile);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const generatedByStart = new Map();
  const usedGeneratedStarts = new Set();

  for (const record of records) {
    const operationIr = record && record.operationIr;
    const generatedRange = record && record.canonicalIr && record.canonicalIr.router
      && record.canonicalIr.router.entry && record.canonicalIr.router.entry.generatedRange;
    if (!operationIr || !generatedRange || !operationIr.sourceFile || !operationIr.handler) continue;
    const originalFile = normalizedModulePath(operationIr.sourceFile.fileName || operationIr.file);
    const handlerStart = Number(operationIr.handler.getStart(operationIr.sourceFile));
    const handlerEnd = Number(operationIr.handler.getEnd());
    const expected = effects.filter((effect) => {
      const effectFile = normalizedModulePath(effect && effect.loc && effect.loc.file);
      const start = Number(effect && effect.range && effect.range.start);
      const end = Number(effect && effect.range && effect.range.end);
      return sameModulePath(effectFile, originalFile, options.rootDir)
        && Number.isSafeInteger(start)
        && Number.isSafeInteger(end)
        && start >= handlerStart
        && end <= handlerEnd;
    }).sort((left, right) => Number(left.range.start) - Number(right.range.start));
    if (expected.length === 0) continue;

    const originalCalls = callExpressions(operationIr.sourceFile);
    const originalByStart = new Map(originalCalls.map((call) => [call.getStart(operationIr.sourceFile), call]));
    const candidates = generatedCalls.filter((call) => {
      const start = call.getStart(generatedSourceFile);
      return start >= Number(generatedRange.start) && start < Number(generatedRange.end);
    });

    for (const effect of expected) {
      const originalCall = originalByStart.get(Number(effect.range.start));
      if (!originalCall) {
        throw new CanonicalProjectCompileError(
          `Unable to recover the source call for reachable package effect ${effect.kind}.`,
          [sourceDiagnosticForPackageEffect(effect, `Unable to recover the source call for reachable package effect ${effect.kind}.`, {
            contractId: effect.contractId,
            range: effect.range
          })],
          { effect },
          'PULSE_PACKAGE_EFFECT_SOURCE_LINK_FAILED'
        );
      }
      const key = callPrintKey(printer, operationIr.sourceFile, originalCall);
      const candidate = candidates.find((call) => {
        const start = call.getStart(generatedSourceFile);
        return !usedGeneratedStarts.has(start) && callPrintKey(printer, generatedSourceFile, call) === key;
      });
      if (!candidate) {
        throw new CanonicalProjectCompileError(
          `Unable to link generated Router source to package effect ${effect.kind} from ${originalFile}.`,
          [sourceDiagnosticForPackageEffect(effect, `Unable to link generated Router source to package effect ${effect.kind}.`, {
            contractId: effect.contractId,
            call: key,
            routerEntry: record.entryStableId
          })],
          { effect, generatedRange, call: key },
          'PULSE_PACKAGE_EFFECT_SOURCE_LINK_FAILED'
        );
      }
      const generatedStart = candidate.getStart(generatedSourceFile);
      usedGeneratedStarts.add(generatedStart);
      generatedByStart.set(generatedStart, effect);
    }
  }

  if (generatedByStart.size !== effects.length) {
    const linked = new Set([...generatedByStart.values()]);
    const missing = effects.filter((effect) => !linked.has(effect));
    const first = missing[0];
    throw new CanonicalProjectCompileError(
      `Generated Router source linked ${generatedByStart.size} of ${effects.length} reachable package effect(s).`,
      missing.map((effect) => sourceDiagnosticForPackageEffect(effect, `Reachable package effect ${effect.kind} was not linked into generated Router source.`, {
        contractId: effect.contractId
      })),
      { missing },
      'PULSE_PACKAGE_EFFECT_SOURCE_LINK_FAILED'
    );
  }

  return (call) => {
    if (!call) return undefined;
    const sourceFile = call.getSourceFile && call.getSourceFile();
    return sourceFile ? generatedByStart.get(call.getStart(sourceFile)) : undefined;
  };
}

function routerGeneratedPackageResultAdapterLookup(router, recognition, options = {}) {
  const adapters = [...(recognition && recognition.resultAdapters || [])];
  if (!router || adapters.length === 0) return undefined;
  const records = handlerIrsForCanonicalRouterOutput(router) || [];
  const generatedSourceFile = ts.createSourceFile(String(router.fileName || 'app.ts'), String(router.sourceText || ''), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const generatedCalls = callExpressions(generatedSourceFile);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const generatedByStart = new Map();
  const usedGeneratedStarts = new Set();
  for (const record of records) {
    const operationIr = record && record.operationIr;
    const generatedRange = record && record.canonicalIr && record.canonicalIr.router && record.canonicalIr.router.entry && record.canonicalIr.router.entry.generatedRange;
    if (!operationIr || !generatedRange || !operationIr.sourceFile || !operationIr.handler) continue;
    const originalFile = normalizedModulePath(operationIr.sourceFile.fileName || operationIr.file);
    const handlerStart = Number(operationIr.handler.getStart(operationIr.sourceFile));
    const handlerEnd = Number(operationIr.handler.getEnd());
    const expected = adapters.filter((adapter) => sameModulePath(
      normalizedModulePath(adapter && adapter.loc && adapter.loc.file),
      originalFile,
      options.rootDir
    )
      && Number(adapter && adapter.range && adapter.range.start) >= handlerStart
      && Number(adapter && adapter.range && adapter.range.end) <= handlerEnd)
      .sort((a,b)=>Number(a.range.start)-Number(b.range.start));
    const originalCalls = callExpressions(operationIr.sourceFile);
    const originalByStart = new Map(originalCalls.map((call) => [call.getStart(operationIr.sourceFile), call]));
    const candidates = generatedCalls.filter((call) => {
      const start = call.getStart(generatedSourceFile);
      return start >= Number(generatedRange.start) && start < Number(generatedRange.end);
    });
    for (const adapter of expected) {
      const originalCall = originalByStart.get(Number(adapter.range.start));
      if (!originalCall) continue;
      const key = callPrintKey(printer, operationIr.sourceFile, originalCall);
      const candidate = candidates.find((call) => {
        const start = call.getStart(generatedSourceFile);
        return !usedGeneratedStarts.has(start) && callPrintKey(printer, generatedSourceFile, call) === key;
      });
      if (!candidate) continue;
      const start = candidate.getStart(generatedSourceFile);
      usedGeneratedStarts.add(start);
      generatedByStart.set(start, adapter);
    }
  }
  return (call) => {
    if (!call) return undefined;
    const sourceFile = call.getSourceFile && call.getSourceFile();
    return sourceFile ? generatedByStart.get(call.getStart(sourceFile)) : undefined;
  };
}

function routerGeneratedPackageIntrinsicLookup(router, recognition, options = {}) {
  const intrinsics = [...(recognition && recognition.intrinsics || [])];
  if (!router || intrinsics.length === 0) return undefined;
  const records = handlerIrsForCanonicalRouterOutput(router) || [];
  const generatedSourceFile = ts.createSourceFile(
    String(router.fileName || 'app.ts'),
    String(router.sourceText || ''),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  );
  const generatedCalls = callExpressions(generatedSourceFile);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const generatedByStart = new Map();
  const usedGeneratedStarts = new Set();

  for (const record of records) {
    const operationIr = record && record.operationIr;
    const generatedRange = record && record.canonicalIr && record.canonicalIr.router
      && record.canonicalIr.router.entry && record.canonicalIr.router.entry.generatedRange;
    if (!operationIr || !generatedRange || !operationIr.sourceFile || !operationIr.handler) continue;
    const originalFile = normalizedModulePath(operationIr.sourceFile.fileName || operationIr.file);
    const handlerStart = Number(operationIr.handler.getStart(operationIr.sourceFile));
    const handlerEnd = Number(operationIr.handler.getEnd());
    const expected = intrinsics.filter((intrinsic) => {
      const intrinsicFile = normalizedModulePath(intrinsic && intrinsic.loc && intrinsic.loc.file);
      const start = Number(intrinsic && intrinsic.range && intrinsic.range.start);
      const end = Number(intrinsic && intrinsic.range && intrinsic.range.end);
      return sameModulePath(intrinsicFile, originalFile, options.rootDir)
        && Number.isSafeInteger(start)
        && Number.isSafeInteger(end)
        && start >= handlerStart
        && end <= handlerEnd;
    }).sort((left, right) => Number(left.range.start) - Number(right.range.start));
    if (expected.length === 0) continue;

    const originalCalls = callExpressions(operationIr.sourceFile);
    const originalByStart = new Map(originalCalls.map((call) => [call.getStart(operationIr.sourceFile), call]));
    const candidates = generatedCalls.filter((call) => {
      const start = call.getStart(generatedSourceFile);
      return start >= Number(generatedRange.start) && start < Number(generatedRange.end);
    });

    for (const intrinsic of expected) {
      const originalCall = originalByStart.get(Number(intrinsic.range.start));
      const key = originalCall && callPrintKey(printer, operationIr.sourceFile, originalCall);
      const candidate = key && candidates.find((call) => {
        const start = call.getStart(generatedSourceFile);
        return !usedGeneratedStarts.has(start) && callPrintKey(printer, generatedSourceFile, call) === key;
      });
      if (!candidate) {
        throw new CanonicalProjectCompileError(
          `Unable to link generated Router source to package intrinsic ${intrinsic.kind} from ${originalFile}.`,
          [sourceDiagnosticForPackageEffect(intrinsic, `Unable to link generated Router source to package intrinsic ${intrinsic.kind}.`, {
            contractId: intrinsic.contractId,
            call: key || null,
            routerEntry: record.entryStableId
          })],
          { intrinsic, generatedRange, call: key || null },
          'PULSE_PACKAGE_EFFECT_SOURCE_LINK_FAILED'
        );
      }
      const generatedStart = candidate.getStart(generatedSourceFile);
      usedGeneratedStarts.add(generatedStart);
      generatedByStart.set(generatedStart, intrinsic);
    }
  }

  if (generatedByStart.size !== intrinsics.length) {
    const linked = new Set([...generatedByStart.values()]);
    const missing = intrinsics.filter((intrinsic) => !linked.has(intrinsic));
    throw new CanonicalProjectCompileError(
      `Generated Router source linked ${generatedByStart.size} of ${intrinsics.length} reachable package intrinsic(s).`,
      missing.map((intrinsic) => sourceDiagnosticForPackageEffect(
        intrinsic,
        `Reachable package intrinsic ${intrinsic.kind} was not linked into generated Router source.`,
        { contractId: intrinsic.contractId }
      )),
      { missing },
      'PULSE_PACKAGE_EFFECT_SOURCE_LINK_FAILED'
    );
  }

  return (call) => {
    if (!call) return undefined;
    const sourceFile = call.getSourceFile && call.getSourceFile();
    return sourceFile ? generatedByStart.get(call.getStart(sourceFile)) : undefined;
  };
}

function compileProjectPackageExtensions(entryFile, options = {}) {
  return packageExtensionsForRecognition(prepareProjectPackageOperations(entryFile, options));
}

function emptySchemaBundle(options = {}) {
  return buildCanonicalSchemaBundle([], {
    defaultNamespace: options.defaultNamespace || 'app',
    contentTypePolicy: options.contentTypePolicy || 'accept-json-or-missing',
    maxBytes: options.maxBytes || 65536
  });
}

function attachSchemaRegistryDeclaration(bundle, registry) {
  if (!registry) return bundle;
  return Object.freeze({
    ...bundle,
    declaredSchemaIds: Object.freeze(registry.schemas.map((entry) => entry.id)),
    deferredSchemaIds: Object.freeze([]),
    registryIrVersion: registry.version,
    registryHash: registry.registryHash,
    fullCodecRealization: true
  });
}

function schemaResolvedConfig(schemaConfig = {}, options = {}) {
  const schemas = Array.isArray(schemaConfig.entries) ? schemaConfig.entries : [];
  return {
    source: options.configFile ? path.resolve(options.configFile) : path.join(path.resolve(options.rootDir || process.cwd()), 'pulse.config.ts'),
    runtime: {
      payload: {
        json: {
          target: schemas.length > 0 ? 'schema' : 'generic',
          defaultNamespace: schemaConfig.defaultNamespace || 'app',
          contentTypePolicy: schemaConfig.contentTypePolicy || 'accept-json-or-missing',
          maxBytes: schemaConfig.maxBytes || 65536,
          schemas: schemas.map((schema) => ({
            namespace: schema.namespace,
            name: schema.name,
            type: schema.type,
            source: schema.source,
            codec: 'json',
            fields: schema.fields
          }))
        }
      }
    }
  };
}

function compileProjectSchemas(schemaConfig = {}, options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const entries = Array.isArray(schemaConfig.entries) ? schemaConfig.entries : [];
  const registry = schemaConfig.registry || null;
  const registryActive = Boolean(registry && Array.isArray(registry.schemas) && registry.schemas.length > 0);
  const declaredDependencies = Array.isArray(schemaConfig.dependencies)
    ? schemaConfig.dependencies.map((file) => path.resolve(file))
    : [];
  if (registry) {
    const bundle = attachSchemaRegistryDeclaration(buildCanonicalSchemaBundle(registry, {
      contentTypePolicy: schemaConfig.contentTypePolicy,
      maxBytes: schemaConfig.maxBytes
    }), registry);
    return Object.freeze({
      active: registryActive,
      bundle,
      diagnostics: Object.freeze([]),
      warnings: Object.freeze([]),
      dependencies: Object.freeze([...new Set(declaredDependencies)].sort()),
      compiledSchemas: registry.schemas,
      compilerVersion: 'pulse.schema-registry-extractor.v1',
      summary: Object.freeze({
        schemas: registry.schemas.length,
        responseCases: registry.responses.length,
        codecTableHash: bundle.codecTableHash
      }),
      registry,
      codecInputs: schemaConfig.codecInputs || null,
      legacyBridge: null,
      realization: registryActive ? 'cross-target-codecs' : 'inactive'
    });
  }
  if (entries.length === 0) {
    const bundle = emptySchemaBundle(schemaConfig);
    return Object.freeze({
      active: registryActive,
      bundle,
      diagnostics: Object.freeze([]),
      warnings: Object.freeze([]),
      dependencies: Object.freeze([...new Set(declaredDependencies)].sort()),
      compiledSchemas: Object.freeze([]),
      compilerVersion: undefined,
      registry,
      codecInputs: schemaConfig.codecInputs || null,
      legacyBridge: schemaConfig.legacyBridge || null,
      realization: 'inactive'
    });
  }

  const resolvedConfig = schemaResolvedConfig(schemaConfig, { ...options, rootDir });
  const result = buildSchemaJsonCompile({
    cwd: rootDir,
    generatedBy: CANONICAL_PROJECT_COMPILER_VERSION,
    resolvedConfig
  });
  const errors = (result.diagnostics || []).filter((entry) => String(entry.severity || 'error') === 'error');
  if (errors.length > 0 || result.artifact.status !== 'ok') {
    throw new CanonicalProjectCompileError(
      `JSON schema compilation failed with ${errors.length || result.diagnostics.length} diagnostic(s).`,
      errors.length > 0 ? errors : result.diagnostics,
      { rootDir, configFile: options.configFile, schemaIds: entries.map((entry) => entry.id) }
    );
  }

  const bundle = buildCanonicalSchemaBundle(result.compiledSchemas, {
    defaultNamespace: schemaConfig.defaultNamespace,
    contentTypePolicy: schemaConfig.contentTypePolicy,
    maxBytes: schemaConfig.maxBytes
  });
  const compiledDependencies = result.dependencies && result.dependencies.length > 0
    ? result.dependencies
    : entries.filter((entry) => typeof entry.source === 'string' && entry.source).map((entry) => path.resolve(rootDir, entry.source));
  const dependencies = [...new Set([...declaredDependencies, ...compiledDependencies].map((file) => path.resolve(file)))].sort();
  return Object.freeze({
    active: true,
    bundle,
    diagnostics: Object.freeze([...(result.diagnostics || [])]),
    warnings: Object.freeze([...(result.warnings || [])]),
    dependencies: Object.freeze(dependencies),
    compiledSchemas: Object.freeze(result.compiledSchemas.map((schema) => Object.freeze({ ...schema, fields: Object.freeze(schema.fields.map((field) => Object.freeze({ ...field }))) }))),
    compilerVersion: result.artifact.version,
    summary: Object.freeze({ ...result.artifact.summary }),
    registry,
    codecInputs: schemaConfig.codecInputs || null,
    legacyBridge: schemaConfig.legacyBridge || null,
    realization: 'legacy'
  });
}

function replaceGeneratedMetadata(source, metadata, mode) {
  const text = String(source);
  const metadataSource = JSON.stringify(metadata, null, 2);
  const startMarker = mode === 'esm'
    ? 'export const metadata = Object.freeze('
    : 'const __pulse_metadata = ';
  const endMarker = mode === 'esm'
    ? ');\nexport const schemaCodecs'
    : ';\nmodule.exports = Object.freeze({';
  const start = text.indexOf(startMarker);
  const end = start < 0 ? -1 : text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new CanonicalProjectCompileError(
      'Package schema references could not be linked into generated canonical metadata.',
      [],
      { mode },
      'PULSE_PACKAGE_SCHEMA_METADATA_LINK_FAILED'
    );
  }
  const suffix = `${endMarker}${text.slice(end + endMarker.length)}`;
  return `${text.slice(0, start)}${startMarker}${metadataSource}${suffix}`;
}

function attachPackageSchemaReferences(compiled, recognition) {
  const packageReferences = Array.isArray(recognition && recognition.schemaReferences)
    ? recognition.schemaReferences
    : [];
  if (packageReferences.length === 0) return compiled;
  const references = [];
  const seen = new Set();
  for (const input of [...(compiled.metadata.schemaReferences || []), ...packageReferences]) {
    const reference = {
      id: String(input.id || ''),
      usage: String(input.usage || ''),
      capability: String(input.capability || ''),
      ...(input.file ? { file: String(input.file).replace(/\\/g, '/') } : {}),
      position: Object.freeze({
        line: Number(input.position && input.position.line || 1),
        column: Number(input.position && input.position.column || 1),
        offset: Number(input.position && input.position.offset || 0)
      })
    };
    const key = [
      reference.id,
      reference.usage,
      reference.capability,
      reference.file || compiled.metadata.file || '',
      reference.position.offset
    ].join('\u0000');
    if (!reference.id || !reference.usage || !reference.capability || seen.has(key)) continue;
    seen.add(key);
    references.push(Object.freeze(reference));
  }
  references.sort((left, right) => String(left.file || compiled.metadata.file || '').localeCompare(String(right.file || compiled.metadata.file || ''))
    || left.position.offset - right.position.offset
    || left.id.localeCompare(right.id)
    || left.usage.localeCompare(right.usage));
  const metadata = deepFreeze({
    ...compiled.metadata,
    capabilities: Object.freeze([...new Set([
      ...(compiled.metadata.capabilities || []).map(String),
      ...packageReferences.map((reference) => String(reference.capability || '')).filter(Boolean)
    ])].sort()),
    schemaReferences: Object.freeze(references),
    schemaReferenceCount: references.length
  });
  return Object.freeze({
    ...compiled,
    metadata,
    ...(compiled.target !== 'javascript' ? {
      generatedSource: replaceGeneratedMetadata(compiled.generatedSource, metadata, 'commonjs'),
      generatedEsmSource: replaceGeneratedMetadata(compiled.generatedEsmSource, metadata, 'esm')
    } : {})
  });
}

function compileCanonicalProjectLegacy(entryFile, options = {}) {
  const absoluteEntry = path.resolve(entryFile);
  const rootDir = path.resolve(options.rootDir || path.dirname(absoluteEntry));
  let graphBuild;
  let rootResolution;
  try {
    graphBuild = buildReachableProjectGraph(absoluteEntry, {
      rootDir,
      workspaceRoot: options.workspaceRoot,
      tsconfigFile: options.tsconfigFile,
      resolver: options.moduleResolver,
      configFile: options.configFile,
      projectFragments: options.applicationProjectMetadata && options.applicationProjectMetadata.fragments
    });
    rootResolution = resolveProjectRoot(graphBuild);
  } catch (error) {
    if (error instanceof ReachableProjectGraphError || error instanceof RouterModuleLinkError) {
      throw new CanonicalProjectCompileError(error.message, error.diagnostics, error.detail, error.code);
    }
    throw error;
  }

  const root = rootResolution && rootResolution.root;
  const multiModule = graphBuild.summary.runtimeProjectModules > 1 || (root && root.module && root.module.path !== graphBuild.entryKey);
  if (!root || !['router', 'handler'].includes(root.kind)) throw new CanonicalProjectCompileError(
    'The configured entry must resolve its default export to a Router, Pulse application, or canonical handler.',
    [Object.freeze({
      code: 'PULSE_PROJECT_APPLICATION_ROOT_UNRESOLVED',
      kind: 'CanonicalProjectCompileDiagnostic',
      severity: 'error',
      message: 'The configured entry default export did not resolve to a project-owned Router or handler.',
      file: graphBuild.entryKey,
      position: Object.freeze({ line: 1, column: 1 }),
      detail: Object.freeze({ resolvedKind: root && root.kind || 'unknown', resolvedModule: root && root.module && root.module.path || null })
    })],
    { entryFile: absoluteEntry, graphVersion: graphBuild.graph.version },
    'PULSE_PROJECT_APPLICATION_ROOT_UNRESOLVED'
  );

  let cryptoRealizationPlan = planCanonicalProjectCrypto(options, graphBuild.entryKey || absoluteEntry);
  assertGraphPreflight(graphBuild, absoluteEntry, options);

  const schema = compileProjectSchemas(options.schemas || {}, {
    rootDir,
    configFile: options.configFile
  });
  const packageOperationRecognition = prepareReachableProjectPackageOperations(graphBuild, {
    rootDir,
    workspaceRoot: options.workspaceRoot,
    schemaBundle: schema.bundle
  });
  let managedHandlers = null;
  if (packageOperationRecognition.managedHandlers.length > 0) {
    try {
      managedHandlers = compileManagedHandlerDescriptors({
        graphBuild,
        descriptors: packageOperationRecognition.managedHandlers,
        packageOperationRecognition
      });
    } catch (error) {
      if (error instanceof ManagedHandlerCompileError) {
        throw new CanonicalProjectCompileError(
          error.message,
          error.diagnostics,
          { entryFile: absoluteEntry, descriptors: packageOperationRecognition.managedHandlers.length },
          error.code
        );
      }
      throw error;
    }
  }
  if (packageOperationRecognition.cryptoRequirements.length > 0) {
    cryptoRealizationPlan = planCanonicalProjectCrypto(
      options,
      graphBuild.entryKey || absoluteEntry,
      packageOperationRecognition.cryptoRequirements
    );
  }
  const terminalPackageApplication = terminalPackageIntrinsicApplication(root, packageOperationRecognition);

  let linkedProjectModules;
  if (multiModule) {
    try {
      linkedProjectModules = root.kind === 'router'
        ? linkProjectRouterModules(graphBuild, { rootDir, target: options.target })
        : linkProjectPlainHandler(graphBuild, {
            rootDir,
            target: options.target,
            consumedRuntimeImports: managedHandlerRuntimeImportKeys(packageOperationRecognition.managedHandlers)
          });
    } catch (error) {
      if (error instanceof RouterModuleLinkError) {
        throw new CanonicalProjectCompileError(error.message, error.diagnostics, error.detail, error.code);
      }
      throw error;
    }
  }

  const authoringSourceText = linkedProjectModules ? linkedProjectModules.rootSourceText : fs.readFileSync(absoluteEntry, 'utf8');
  const authoringFileName = linkedProjectModules ? linkedProjectModules.rootModule.path : stableSourceName(absoluteEntry, { ...options, rootDir });
  const baseAuthoringOptions = {
    ...options,
    rootDir,
    fileName: authoringFileName,
    strict: options.strict === true,
    handlerAuthoring: options.handlerAuthoring,
    requireAsync: options.requireAsync === true,
    requireEffectAwait: options.requireEffectAwait === true,
    eventSchemaIds: schema.bundle.declaredSchemaIds || schema.bundle.schemaIds || [],
    ...(linkedProjectModules && linkedProjectModules.kind === 'router' ? { linkedProjectModules } : {})
  };
  const isRouterAuthoring = linkedProjectModules ? linkedProjectModules.kind === 'router' : detectCanonicalRouterSource(authoringSourceText, baseAuthoringOptions);
  const packageExtensions = packageExtensionsForRecognition(packageOperationRecognition);
  const authoringOptions = {
    ...baseAuthoringOptions,
    packageEffects: packageExtensions.effects,
    packageIntrinsics: packageExtensions.intrinsics || [],
    packageResultAdapters: packageExtensions.resultAdapters || [],
    packageEffectForCall: packageEffectLookup(packageOperationRecognition),
    packageIntrinsicForCall: packageIntrinsicLookup(packageOperationRecognition),
    packageResultAdapterForCall: packageResultAdapterLookup(packageOperationRecognition)
  };
  const router = isRouterAuthoring
    ? compileCanonicalRouterSource(authoringSourceText, authoringOptions)
    : undefined;
  const compilerSourceText = router
    ? router.sourceText
    : terminalPackageApplication
      ? terminalPackageApplication.sourceText
      : authoringSourceText;
  const generatedPackageEffectForCall = router
    ? routerGeneratedPackageEffectLookup(router, packageOperationRecognition, { rootDir })
    : packageEffectLookup(packageOperationRecognition);
  const generatedPackageResultAdapterForCall = router
    ? routerGeneratedPackageResultAdapterLookup(router, packageOperationRecognition, { rootDir })
    : packageResultAdapterLookup(packageOperationRecognition);
  const generatedPackageIntrinsicForCall = router
    ? routerGeneratedPackageIntrinsicLookup(router, packageOperationRecognition, { rootDir })
    : packageIntrinsicLookup(packageOperationRecognition);
  const applicationEnvelope = createApplicationEnvelope(router, options.applicationProjectMetadata);
  const compileOptions = {
    ...options,
    rootDir,
    fileName: authoringFileName,
    schemaBundle: schema.bundle,
    packageEffects: packageExtensions.effects,
    packageIntrinsics: terminalPackageApplication ? [] : packageExtensions.intrinsics || [],
    packageResultAdapters: packageExtensions.resultAdapters || [],
    packageEffectForCall: generatedPackageEffectForCall,
    packageIntrinsicForCall: terminalPackageApplication ? undefined : generatedPackageIntrinsicForCall,
    packageResultAdapterForCall: generatedPackageResultAdapterForCall,
    allowedRuntimeImports: packageExtensions.allowedRuntimeImports,
    authoringSourceText,
    compilerPrelude: router && router.compilerPrelude,
    compilerOwnedCalls: router && router.compilerOwnedCalls,
    compilerOwnedIntrinsics: packageExtensions.intrinsics || [],
    metadataExtensions: Object.freeze({
      ...(router ? {
        authoring: Object.freeze({
          kind: router.applicationKind || 'router',
          version: router.applicationKind === 'pulse' ? 'pulse.application-authoring.v1' : router.authoringVersion,
          ...(router.applicationKind === 'pulse' ? { constructionMode: router.applicationConstructionMode } : {}),
          ...(router.normalization ? { normalization: router.normalization } : {})
        }),
        router: router.metadata,
        ...(router.userAuthoredAsync ? { userAuthoredAsync: true } : {}),
        ...((router.warnings && router.warnings.length > 0) ? { warnings: router.warnings } : {}),
        ...(router.normalization ? { routerNormalization: router.normalization } : {})
      } : {}),
      ...(applicationEnvelope ? { application: applicationEnvelope } : {})
    }),
    strict: options.strict === true,
    handlerAuthoring: router ? undefined : options.handlerAuthoring,
    requireAsync: router ? false : options.requireAsync === true,
    requireEffectAwait: router ? false : options.requireEffectAwait === true,
    internalGeneratedHandler: Boolean(router)
  };
  const compiledBase = router
    ? compileCanonicalSource(compilerSourceText, compileOptions)
    : terminalPackageApplication
      ? compileCanonicalSource(compilerSourceText, compileOptions)
      : compileCanonicalFile(linkedProjectModules ? linkedProjectModules.rootModule.absolutePath : absoluteEntry, compileOptions);
  const compiled = attachPackageSchemaReferences(compiledBase, packageOperationRecognition);
  const rootReference = root ? [{
    module: root.module.path,
    exportName: root.exportName || 'default',
    localName: root.localName,
    role: root.kind === 'router' ? 'router' : 'handler',
    wrappers: [],
    source: {
      file: root.module.path,
      line: Number(root.declaration && root.declaration.loc && root.declaration.loc.start && root.declaration.loc.start.line || 1),
      column: Number(root.declaration && root.declaration.loc && root.declaration.loc.start && root.declaration.loc.start.column || 1)
    }
  }] : [];
  const reachableGraph = linkedProjectModules ? linkedProjectModules.graph : finalizeReachableProjectGraph(graphBuild, rootReference);
  const graphProjections = reachableProjectGraphProjections(graphBuild, reachableGraph);
  const project = Object.freeze({
    ...compiled,
    projectCompilerVersion: CANONICAL_PROJECT_COMPILER_VERSION,
    graphBuilderVersion: PROJECT_GRAPH_BUILDER_VERSION,
    reachableGraph,
    packageReachability: graphProjections.packageReachability,
    packageProduct: graphProjections.packageProduct,
    entrySafety: graphProjections.entrySafety,
    nativeEligibility: graphProjections.nativeEligibility,
    cryptoRealizationPlan,
    moduleLinkage: Object.freeze({
      version: linkedProjectModules ? ROUTER_MODULE_LINKER_VERSION : 'pulse.router-module-linker.not-required.v1',
      linked: Boolean(linkedProjectModules),
      projectFiles: linkedProjectModules ? linkedProjectModules.projectFiles : graphBuild.projectModulePaths,
      runtimeProjectFiles: linkedProjectModules ? linkedProjectModules.runtimeProjectFiles : graphBuild.runtimeProjectModulePaths,
      summary: linkedProjectModules ? linkedProjectModules.summary : graphBuild.summary
    }),
    schema,
    packageExtensions,
    packageInspection: packageInspectionProjection(packageOperationRecognition, managedHandlers),
    ...(terminalPackageApplication ? {
      packageApplication: terminalPackageApplicationInspection(terminalPackageApplication, packageOperationRecognition)
    } : {}),
    router,
    ...(router && router.eventTopology ? {
      eventTopology: router.eventTopology,
      eventCatalog: router.eventCatalog,
      eventOutboundRequirements: router.eventOutboundRequirements
    } : {}),
    ...(applicationEnvelope ? { application: applicationEnvelope } : {}),
    watchFiles: Object.freeze([...new Set([
      ...graphBuild.projectFiles,
      ...schema.dependencies,
      ...(packageOperationRecognition.dependencies || [])
    ].map((file) => path.resolve(file)))])
  });
  attachPackageOperationRecognition(project, packageOperationRecognition);
  return project;
}

function compileCanonicalProject(entryFile, options = {}) {
  if (options.target !== undefined && !['native', 'javascript'].includes(options.target)) {
    throw new TypeError('target must be native or javascript.');
  }
  return executeCanonicalProjectSpine(entryFile, options, compileCanonicalProjectLegacy);
}

function packageRealizationArtifactsForCompiled(compiled) {
  const recognition = packageOperationRecognitionForCompiled(compiled);
  return Object.freeze([...(recognition && recognition.realizationArtifacts || [])]);
}

module.exports = Object.freeze({
  CANONICAL_PROJECT_COMPILER_VERSION,
  CanonicalProjectCompileError,
  schemaResolvedConfig,
  compileProjectSchemas,
  compileProjectPackageExtensions,
  compileCanonicalProject,
  packageRealizationArtifactsForCompiled
});
