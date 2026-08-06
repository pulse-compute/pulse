'use strict';

function loadAssetsContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/assets/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/assets/contracts.js');
    }
    throw error;
  }
}

function loadDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/diagnostics.js');
    }
    throw error;
  }
}

const assetsContracts = loadAssetsContracts();
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadDiagnostics();
const { buildFastlyAssetsProviderProof } = require('./assets-provider-proof.js');
const { buildFastlyAssetsProviderConfig } = require('../runtime/assets-provider.js');

const phaseName = 'fastly-assets-package-out-parity-proof';

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}

function normalize(input) {
  return input && input.artifact && typeof input.artifact === 'object' ? input.artifact : input;
}

function makeDiagnostic(code, message, severity = 'error', details) {
  return normalizeDiagnostic({
    phase: phaseName,
    severity,
    code,
    message,
    hint: details && details.hint,
    details,
    loc: { file: '<fastly-assets-package-out-parity-proof>' }
  });
}

function check(name, passed, details, failures, diagnostics) {
  const entry = { name, status: passed ? 'ok' : 'error', details: details || {} };
  if (!passed) {
    failures.push(entry);
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_PACKAGE_OUT_PARITY_SMOKE_FAILED,
      `Fastly assets package-out parity check failed: ${name}.`,
      'error',
      { check: name, details: entry.details }
    ));
  }
  return entry;
}

function checkByName(proof, needle) {
  const checks = proof && proof.smoke && Array.isArray(proof.smoke.checks) ? proof.smoke.checks : [];
  return checks.some((entry) => entry && String(entry.name || '').includes(needle) && entry.status === 'ok');
}

function summaryFlag(proof, name) {
  return Boolean(proof && proof.summary && proof.summary[name] === true);
}

function packageOutDiscovered(packageOutProof) {
  return Boolean(packageOutProof && (
    packageOutProof.discoveredFromNodeModules === true ||
    (packageOutProof.discovery && packageOutProof.discovery.discoveredFromNodeModules === true) ||
    (packageOutProof.summary && packageOutProof.summary.discoveredFromNodeModules === true)
  ));
}

function builderLoadedFromPackageOut(packageOutProof) {
  const compilerBuilder = packageOutProof && packageOutProof.discovery && packageOutProof.discovery.compilerBuilder;
  return Boolean(compilerBuilder &&
    compilerBuilder.builderOwner === '@pulse-compute/assets' &&
    String(compilerBuilder.entry || '').includes('node_modules/@pulse-compute/assets/pulsewasm.compiler.cjs'));
}

function packageOwnedLowerer(plan) {
  const policy = plan && plan.policy || {};
  return Boolean(plan &&
    plan.npmPackage === '@pulse-compute/assets' &&
    plan.lowerableSubpath === '@pulse-compute/assets' &&
    policy.builderOwner === '@pulse-compute/assets' &&
    policy.compilerOwnsPackageMapping === false);
}

function providerProofOrBuild(options, plan, diagnostics) {
  const provided = normalize(options.fastlyAssetsProviderProof || options.providerProof);
  if (provided) return { artifact: provided, diagnostics: [] };
  if (!plan) return undefined;
  const proof = buildFastlyAssetsProviderProof({
    cwd: options.cwd,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    assetsLoweringPlan: plan,
    resolvedConfig: options.resolvedConfig,
    fastlyHostcallBinding: options.fastlyHostcallBinding,
    fastlyAdapter: options.fastlyAdapter,
    requestResultHeaders: options.requestResultHeaders,
    streamingPassthrough: options.streamingPassthrough,
    wasmHostAbi: options.wasmHostAbi
  });
  diagnostics.push(...(proof.diagnostics || []));
  return proof;
}

function buildFastlyAssetsPackageOutParityProof(options = {}) {
  const cwd = options.cwd || process.cwd();
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const plan = normalize(options.assetsLoweringPlan || options.plan);
  const sidecarPlan = normalize(options.assetsCompiledWasmSidecarPlan || options.sidecarPlan);
  const packageOutProof = normalize(options.assetsPackageOutDiscoveryProof || options.packageOutDiscoveryProof || options.packageOutProof);
  const nodeCompiledProof = normalize(options.nodeCompiledWasmAssetsLifecycleProof || options.nodeProof);
  const diagnostics = [];
  const failures = [];
  const checks = [];

  if (!plan) {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_PACKAGE_OUT_PARITY_PLAN_REQUIRED,
      'Fastly assets package-out parity proof requires assets-lowering-plan.json.',
      'error',
      { sourceArtifact: assetsContracts.ASSETS_LOWERING_PLAN_VERSION }
    ));
  }
  if (!sidecarPlan) {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.SIDECAR_FILE_MISSING,
      'Fastly assets package-out parity proof requires assets-compiled-wasm-sidecar-plan.json so compiled-Wasm readiness can be classified honestly.',
      'error',
      { sourceArtifact: assetsContracts.ASSETS_COMPILED_WASM_SIDECAR_PLAN_ARTIFACT }
    ));
  }
  const sidecarPackageOut = sidecarPlan && sidecarPlan.packageOut ? sidecarPlan.packageOut : undefined;
  if (!packageOutProof && !(sidecarPackageOut && sidecarPackageOut.discoveredFromNodeModules === true && sidecarPackageOut.builderLoadedFromNodeModules === true)) {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_PACKAGE_OUT_PARITY_PLAN_REQUIRED,
      'Fastly assets package-out parity proof requires assets-package-out-discovery-proof.json or sidecar package-out evidence to prove packaged @pulse-compute/assets discovery.',
      'error',
      { sourceArtifact: assetsContracts.ASSETS_PACKAGE_OUT_DISCOVERY_PROOF_ARTIFACT }
    ));
  }

  const fastlyProviderProof = providerProofOrBuild(options, plan, diagnostics);
  const providerProofArtifact = fastlyProviderProof && normalize(fastlyProviderProof);
  const providerConfig = options.providerConfig || (providerProofArtifact && providerProofArtifact.providerConfig) || buildFastlyAssetsProviderConfig({ plan, resolvedConfig: options.resolvedConfig });

  const packageOwnedLoweringConsumed = packageOwnedLowerer(plan);
  const discoveredFromPackagedAssets = packageOutDiscovered(packageOutProof) || Boolean(sidecarPackageOut && sidecarPackageOut.discoveredFromNodeModules === true);
  const packageBuilderLoaded = builderLoadedFromPackageOut(packageOutProof) || Boolean(sidecarPackageOut && sidecarPackageOut.builderLoadedFromNodeModules === true);
  const symbolicStoreConfigValidated = Boolean(providerConfig && providerConfig.provider === 'fastly' && providerConfig.symbolicRefsOnly === true && Array.isArray(providerConfig.stores) && providerConfig.stores.length > 0 && providerConfig.stores.every((store) => String(store.endpointRef || '').startsWith('$config:') && String(store.bucketRef || '').startsWith('$config:') && String(store.keyRef || '').startsWith('$secret:')));
  const getMappingValidated = summaryFlag(providerProofArtifact, 'getTextValidated');
  const headMappingValidated = summaryFlag(providerProofArtifact, 'headValidated');
  const headersValidated = checkByName(providerProofArtifact, 'headers/status pass through') || Boolean(providerProofArtifact && providerProofArtifact.payloadModes && providerProofArtifact.payloadModes.headerPassThrough && providerProofArtifact.payloadModes.headerPassThrough.status === 'implemented-now');
  const cacheControlValidated = checkByName(providerProofArtifact, 'cache-control policy is preserved');
  const notFoundPolicyValidated = summaryFlag(providerProofArtifact, 'notFoundValidated');
  const binaryBodyReserved = summaryFlag(providerProofArtifact, 'binaryReservedValidated') || Boolean(providerProofArtifact && providerProofArtifact.payloadModes && providerProofArtifact.payloadModes.binaryBodyBufferResponse && providerProofArtifact.payloadModes.binaryBodyBufferResponse.status === 'reserved-with-diagnostic');
  const streamProviderProofImplemented = Boolean(providerProofArtifact && providerProofArtifact.payloadModes && providerProofArtifact.payloadModes.streamPassThroughResponse && providerProofArtifact.payloadModes.streamPassThroughResponse.status === 'implemented-fastly-proof');
  const terminalSidecarPlanned = Boolean(sidecarPlan && sidecarPlan.summary && sidecarPlan.summary.terminalAssetResponseEffectPlanned === true);
  const sidecarPackaged = Boolean((sidecarPlan && sidecarPlan.summary && sidecarPlan.summary.packageOutSidecarValidated === true) || (sidecarPackageOut && sidecarPackageOut.discoveredFromNodeModules === true && sidecarPackageOut.sidecarFile));
  const nodeCompiledReferenceImplemented = Boolean(nodeCompiledProof && nodeCompiledProof.compiledWasmLowering === true && nodeCompiledProof.compiledWasmRuntimeBehaviorImplemented === true);

  checks.push(check('package_owned_lowering_consumed', packageOwnedLoweringConsumed, { package: plan && plan.npmPackage, lowerableSubpath: plan && plan.lowerableSubpath, policy: plan && plan.policy }, failures, diagnostics));
  checks.push(check('packaged_assets_discovered_from_node_modules', discoveredFromPackagedAssets && packageBuilderLoaded, { discoveredFromNodeModules: discoveredFromPackagedAssets, packageBuilderLoaded, compilerBuilder: packageOutProof && packageOutProof.discovery && packageOutProof.discovery.compilerBuilder }, failures, diagnostics));
  checks.push(check('symbolic_fastly_store_config_validated', symbolicStoreConfigValidated, { providerConfig }, failures, diagnostics));
  checks.push(check('get_mapping_validated', getMappingValidated, { summary: providerProofArtifact && providerProofArtifact.summary }, failures, diagnostics));
  checks.push(check('head_mapping_validated', headMappingValidated, { summary: providerProofArtifact && providerProofArtifact.summary }, failures, diagnostics));
  checks.push(check('headers_validated', headersValidated, { headerPassThrough: providerProofArtifact && providerProofArtifact.payloadModes && providerProofArtifact.payloadModes.headerPassThrough }, failures, diagnostics));
  checks.push(check('cache_control_validated', cacheControlValidated, { checks: providerProofArtifact && providerProofArtifact.smoke && providerProofArtifact.smoke.checks }, failures, diagnostics));
  checks.push(check('not_found_policy_validated', notFoundPolicyValidated, { summary: providerProofArtifact && providerProofArtifact.summary }, failures, diagnostics));
  checks.push(check('sidecar_readiness_classified', terminalSidecarPlanned && sidecarPackaged, { terminalAssetResponseEffectPlanned: terminalSidecarPlanned, packageOutSidecarValidated: sidecarPackaged, summary: sidecarPlan && sidecarPlan.summary }, failures, diagnostics));
  checks.push(check('binary_body_reserved', binaryBodyReserved, { binaryBodyBufferResponse: providerProofArtifact && providerProofArtifact.payloadModes && providerProofArtifact.payloadModes.binaryBodyBufferResponse }, failures, diagnostics));
  checks.push(check('no_external_fastly_service_required', Boolean(providerProofArtifact && providerProofArtifact.scope && providerProofArtifact.scope.configSecretRefs === 'symbolic-only') && providerProofArtifact.proofMode === 'direct-fastly-provider-smoke-connected-to-lowering-plan', { proofMode: providerProofArtifact && providerProofArtifact.proofMode, scope: providerProofArtifact && providerProofArtifact.scope }, failures, diagnostics));

  diagnostics.push(makeDiagnostic(
    assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_ASSETS_COMPILED_WASM_PLAN_ONLY,
    'Fastly compiled-Wasm assets terminal response execution is explicitly plan-only until a provider-owned compiled-Wasm Fastly bridge is wired.',
    'warning',
    { compiledWasmAssetsReadiness: 'plan-only', nodeReferenceCompiledLifecycleImplemented: nodeCompiledReferenceImplemented }
  ));

  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const artifact = normalizeArtifact({
    version: assetsContracts.ASSETS_FASTLY_PACKAGE_OUT_PARITY_PROOF_VERSION,
    generatedBy,
    phase: '50',
    artifact: assetsContracts.ASSETS_FASTLY_PACKAGE_OUT_PARITY_PROOF_ARTIFACT,
    contractId: assetsContracts.ASSETS_CONTRACT_ID,
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    provider: 'fastly',
    providerPackage: '@pulse-compute/provider-fastly',
    package: '@pulse-compute/assets',
    lowerableSubpath: plan && plan.lowerableSubpath || '@pulse-compute/assets',
    sourceAssetsLoweringPlanVersion: plan && plan.version,
    sourceAssetsCompiledWasmSidecarPlanVersion: sidecarPlan && sidecarPlan.version,
    sourcePackageOutDiscoveryProofVersion: packageOutProof && packageOutProof.version,
    sourceFastlyAssetsProviderProofVersion: providerProofArtifact && providerProofArtifact.version,
    sourceNodeCompiledWasmAssetsLifecycleProofVersion: nodeCompiledProof && nodeCompiledProof.version,
    packageOwnedLoweringConsumed,
    discoveredFromPackagedAssets,
    symbolicStoreConfigValidated,
    getMappingValidated,
    headMappingValidated,
    headersValidated,
    cacheControlValidated,
    notFoundPolicyValidated,
    compiledWasmAssetsReadiness: 'plan-only',
    compiledWasmPlanOnlyDiagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_ASSETS_COMPILED_WASM_PLAN_ONLY,
    binaryBodyReserved,
    streamBodyReadiness: streamProviderProofImplemented ? 'provider-proof-implemented-compiled-wasm-plan-only' : 'plan-only',
    noExternalFastlyServiceRequired: true,
    actualNetworkFetch: false,
    policy: {
      compilerOrchestratesOnly: true,
      packageOwnsLoweringSurface: true,
      packageOwnedLowererConsumed: packageOwnedLoweringConsumed,
      providerOwnsFastlyBehavior: true,
      noExternalFastlyServiceRequired: true,
      packageOutFixtureRequired: true,
      monorepoAssetsSourcePathRequired: false,
      compiledWasmAssetsReadiness: 'plan-only',
      directProviderProofFallback: false,
      symbolicStoreConfigOnly: true,
      objectStoreMutationApis: false,
      uploads: false,
      invalidation: false,
      binaryBody: false,
      streamProviderProofImplemented,
      streamCompiledWasmReadiness: 'plan-only'
    },
    packageOut: {
      packagePacked: Boolean(packageOutProof && packageOutProof.checks && packageOutProof.checks.packagePacked),
      discoveredFromNodeModules: discoveredFromPackagedAssets,
      compilerBuilderLoadedFromNodeModules: packageBuilderLoaded,
      packageTarballIncludesManifest: Boolean(packageOutProof && packageOutProof.checks && packageOutProof.checks.packageTarballIncludesManifest),
      packageTarballIncludesCompilerBuilder: Boolean(packageOutProof && packageOutProof.checks && packageOutProof.checks.packageTarballIncludesCompilerBuilder),
      packageTarballIncludesPulseWasmFacade: Boolean(packageOutProof && packageOutProof.checks && packageOutProof.checks.packageTarballIncludesPulseWasmFacade),
      packageTarballIncludesSidecar: Boolean(packageOutProof && packageOutProof.checks && packageOutProof.checks.packageTarballIncludesSidecar),
      monorepoSourcePathRequired: false,
      npmRegistryRequired: false
    },
    fastly: {
      providerConfig: clone(providerConfig),
      providerProof: providerProofArtifact ? {
        version: providerProofArtifact.version,
        status: providerProofArtifact.status,
        proofMode: providerProofArtifact.proofMode,
        summary: clone(providerProofArtifact.summary),
        payloadModes: clone(providerProofArtifact.payloadModes)
      } : undefined,
      symbolicStoreConfig: {
        validated: symbolicStoreConfigValidated,
        configStore: providerConfig && providerConfig.configStore,
        secretStore: providerConfig && providerConfig.secretStore,
        stores: providerConfig && providerConfig.stores
      },
      mapping: {
        get: getMappingValidated,
        head: headMappingValidated,
        headers: headersValidated,
        cacheControl: cacheControlValidated,
        notFound: notFoundPolicyValidated
      }
    },
    compiledWasm: {
      sidecarDeclared: Boolean(sidecarPlan && sidecarPlan.summary && sidecarPlan.summary.sidecarDeclared),
      sidecarFileExists: Boolean(sidecarPlan && sidecarPlan.summary && sidecarPlan.summary.sidecarFileExists),
      sidecarSymbolsValidated: Boolean(sidecarPlan && sidecarPlan.summary && sidecarPlan.summary.sidecarSymbolsValidated),
      terminalAssetResponseEffectPlanned: terminalSidecarPlanned,
      nodeReferenceImplemented: nodeCompiledReferenceImplemented,
      fastlyReadiness: 'plan-only',
      diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_ASSETS_COMPILED_WASM_PLAN_ONLY,
      asyncAwait: false,
      promises: false,
      asyncify: false
    },
    unsupported: {
      binaryBodyReserved,
      streamBodyReadiness: streamProviderProofImplemented ? 'provider-proof-implemented-compiled-wasm-plan-only' : 'plan-only',
      uploads: false,
      mutationApis: false,
      invalidation: false,
      externalFastlyService: false
    },
    smoke: {
      checks,
      failedChecks: failures
    },
    diagnostics,
    summary: {
      packageOwnedLoweringConsumed,
      discoveredFromPackagedAssets,
      symbolicStoreConfigValidated,
      getMappingValidated,
      headMappingValidated,
      headersValidated,
      cacheControlValidated,
      notFoundPolicyValidated,
      compiledWasmAssetsReadiness: 'plan-only',
      compiledWasmPlanOnlyDiagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_ASSETS_COMPILED_WASM_PLAN_ONLY,
      binaryBodyReserved,
      streamBodyReadiness: streamProviderProofImplemented ? 'provider-proof-implemented-compiled-wasm-plan-only' : 'plan-only',
      noExternalFastlyServiceRequired: true,
      actualNetworkFetch: false,
      checks: checks.length,
      failedChecks: failures.length,
      diagnostics: diagnostics.length,
      warnings: diagnostics.filter((entry) => (entry.severity || 'error') === 'warning').length,
      errors: errorDiagnostics.length
    }
  }, cwd);

  return {
    artifact,
    diagnostics,
    providerProof: fastlyProviderProof,
    failures,
    hasErrors: errorDiagnostics.length > 0
  };
}

module.exports = {
  phaseName,
  buildFastlyAssetsPackageOutParityProof
};
