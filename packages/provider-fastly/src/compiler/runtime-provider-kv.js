'use strict';

const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadContractsDiagnostics();
const { validateRuntimeProvider, extractProviderMap, extractKvCapabilities, normalizeRuntimeProvider } = require('./runtime-provider-shape.js');
const {
  CONFIG_AUTHORING_SHAPE_VERSION,
  PLATFORM_STORE_MAP_VERSION,
  RUNTIME_PROVIDER_KV_PHASE,
  KV_ADAPTER_INTEGRATION_PHASE,
  RUNTIME_PROVIDER_CONTRACT_VERSION,
  RUNTIME_PROVIDER_KV_RESOLUTION_VERSION,
  KV_CAPABILITY_CONTRACT_VERSION,
  KV_PROVIDER_MAP_VERSION,
  RUNTIME_PROVIDER_API_SURFACE_VERSION,
  RUNTIME_PROVIDER_SMOKE_VERSION,
  KV_ADAPTER_INTEGRATION_VERSION,
  KV_PROVIDER_RUNTIME_MAP_VERSION,
  RUNTIME_PROVIDER_AUTHORING_SHAPE,
  RUNTIME_PROVIDER_DEFAULT_POLICY,
  RUNTIME_PROVIDER_KINDS,
  KV_CAPABILITY_POLICY,
  RUNTIME_PROVIDER_API_SURFACES
} = loadContractsRuntimeProviderKv();


function loadContractsDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/diagnostics.js');
    }
    throw error;
  }
}

function loadContractsRuntimeProviderKv() {
  try {
    return require('@pulse-compute/wasm-contracts/config/runtime-provider-kv');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/config/runtime-provider-kv.js');
    }
    throw error;
  }
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function makeDiag(raw) {
  return normalizeDiagnostic({
    code: raw.code || 'PULSEWASM_RUNTIME_PROVIDER_INVALID',
    severity: 'error',
    phase: 'runtime-provider-kv',
    pass: 'runtime-provider-kv',
    loc: { file: '<config>' },
    message: raw.message || 'Invalid runtime provider configuration.',
    details: raw
  });
}

function normalizeResolvedConfig(input = {}) {
  return input && input.artifact ? input.artifact : input;
}

function buildRuntimeProviderKv(options = {}) {
  const cwd = options.cwd || process.cwd();
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const resolvedConfig = normalizeResolvedConfig(options.resolvedConfig || {});
  const profileName = resolvedConfig.profile || resolvedConfig.selectedProfile || options.profile || 'edge';
  const profile = { runtime: plainObject(resolvedConfig.runtime) };
  const provider = normalizeRuntimeProvider(profile.runtime) || {};
  const rawDiagnostics = validateRuntimeProvider(profileName, profile);
  const diagnostics = rawDiagnostics.map(makeDiag);
  const providerMap = extractProviderMap(profileName, profile);
  const kvCapabilities = extractKvCapabilities(profileName, profile);

  const contract = normalizeArtifact({
    version: RUNTIME_PROVIDER_CONTRACT_VERSION,
    generatedBy,
    phase: RUNTIME_PROVIDER_KV_PHASE,
    status: diagnostics.length ? 'error' : 'ok',
    authoringShape: RUNTIME_PROVIDER_AUTHORING_SHAPE,
    defaultPolicy: RUNTIME_PROVIDER_DEFAULT_POLICY,
    providerKinds: RUNTIME_PROVIDER_KINDS.slice(),
    provider,
    summary: {
      profile: profileName,
      provider: provider.kind || null,
      kvNamespaces: kvCapabilities.length,
      configStore: provider.configStore || null,
      secretStore: provider.secretStore || null
    }
  }, cwd);

  const resolution = normalizeArtifact({
    version: RUNTIME_PROVIDER_KV_RESOLUTION_VERSION,
    generatedBy,
    phase: RUNTIME_PROVIDER_KV_PHASE,
    status: diagnostics.length ? 'error' : 'ok',
    profile: profileName,
    provider,
    providerMap,
    kvCapabilities,
    summary: contract.summary
  }, cwd);

  const configAuthoringShape = normalizeArtifact({
    version: CONFIG_AUTHORING_SHAPE_VERSION,
    generatedBy,
    phase: RUNTIME_PROVIDER_KV_PHASE,
    canonical: RUNTIME_PROVIDER_AUTHORING_SHAPE,
    rootConfigDefinesTopologyOnly: true,
    profileRuntimeDefinesBehavior: true,
    examples: {
      provider: {
        kind: 'fastly',
        configStore: 'pulse_config',
        secretStore: 'pulse_secrets',
        kv: { sessions: 'sessions' }
      }
    },
    summary: { canonical: RUNTIME_PROVIDER_AUTHORING_SHAPE }
  }, cwd);

  const platformStoreMap = normalizeArtifact({
    version: PLATFORM_STORE_MAP_VERSION,
    generatedBy,
    phase: RUNTIME_PROVIDER_KV_PHASE,
    providerKind: provider.kind || null,
    stores: providerMap.stores,
    kv: providerMap.kv,
    generatedOutputOnly: true,
    summary: { stores: Object.keys(providerMap.stores || {}).length, kvNamespaces: Object.keys(providerMap.kv || {}).length }
  }, cwd);

  const kvCapabilityContract = normalizeArtifact({
    version: KV_CAPABILITY_CONTRACT_VERSION,
    generatedBy,
    phase: RUNTIME_PROVIDER_KV_PHASE,
    handlerSurface: KV_CAPABILITY_POLICY.handlerSurface,
    compiledHandlerLowering: KV_CAPABILITY_POLICY.compiledHandlerLowering,
    hostEffectExecution: KV_CAPABILITY_POLICY.hostEffectExecution,
    localAdapterProof: KV_CAPABILITY_POLICY.localAdapterProof,
    namespaces: kvCapabilities,
    summary: { namespaces: kvCapabilities.length, execution: 'reserved-effect' }
  }, cwd);

  const kvProviderMap = normalizeArtifact({
    version: KV_PROVIDER_MAP_VERSION,
    generatedBy,
    phase: RUNTIME_PROVIDER_KV_PHASE,
    provider: provider.kind || null,
    kv: providerMap.kv,
    summary: { namespaces: Object.keys(providerMap.kv || {}).length }
  }, cwd);

  const apiSurface = normalizeArtifact({
    version: RUNTIME_PROVIDER_API_SURFACE_VERSION,
    generatedBy,
    phase: RUNTIME_PROVIDER_KV_PHASE,
    surfaces: RUNTIME_PROVIDER_API_SURFACES.map((surface) => ({ ...surface })),
    summary: { surfaces: RUNTIME_PROVIDER_API_SURFACES.length }
  }, cwd);

  const smoke = normalizeArtifact({
    version: RUNTIME_PROVIDER_SMOKE_VERSION,
    generatedBy,
    phase: RUNTIME_PROVIDER_KV_PHASE,
    status: diagnostics.length ? 'error' : 'ok',
    checks: [
      { name: 'provider_kind_valid', status: provider.kind ? 'ok' : 'error' },
      { name: 'fastly_stores_declared', status: provider.kind === 'fastly' && provider.configStore && provider.secretStore ? 'ok' : 'skipped' },
      { name: 'kv_namespaces_declared', status: kvCapabilities.length > 0 ? 'ok' : 'skipped' }
    ],
    summary: { failedChecks: diagnostics.length, kvNamespaces: kvCapabilities.length }
  }, cwd);

  const markdown = `# Runtime provider / KV contract\n\n- Canonical authoring shape: \`runtime.provider\`\n- Provider: \`${provider.kind || 'unknown'}\`\n- KV namespaces: ${kvCapabilities.map((entry) => `\`${entry.logicalName}\``).join(', ') || 'none'}\n\nKV execution and compiled-handler lowering remain reserved here; the local runtime/adapter store is validated separately.\n`;

  return {
    artifact: contract,
    resolution,
    configAuthoringShape,
    platformStoreMap,
    kvCapabilityContract,
    kvProviderMap,
    apiSurface,
    smoke,
    files: [{ file: 'generated/host/runtime-provider-kv-contract.md', text: markdown }],
    diagnostics,
    summary: contract.summary
  };
}

function buildKvAdapterIntegration(options = {}) {
  const cwd = options.cwd || process.cwd();
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const resolvedConfig = normalizeResolvedConfig(options.resolvedConfig || {});
  const profileName = resolvedConfig.profile || resolvedConfig.selectedProfile || options.profile || 'edge';
  const runtime = plainObject(resolvedConfig.runtime);
  const provider = normalizeRuntimeProvider(runtime) || {};
  const kv = provider.kv || {};
  return {
    integration: normalizeArtifact({
      version: KV_ADAPTER_INTEGRATION_VERSION,
      generatedBy,
      phase: KV_ADAPTER_INTEGRATION_PHASE,
      status: 'ok',
      profile: profileName,
      providerKind: provider.kind || null,
      hostRuntimeModule: 'src/compiled-wasm-host-runtime-kv.js',
      nodeAdapterModule: 'src/compiled-wasm-node-adapter-kv.js',
      kvProviderModule: 'src/kv-provider.js',
      compiledHandlerLowering: KV_CAPABILITY_POLICY.compiledHandlerLowering,
      fastlyKvHostcalls: 'reserved',
      summary: { namespaces: Object.keys(kv).length, localAdapterProof: true }
    }, cwd),
    runtimeMap: normalizeArtifact({
      version: KV_PROVIDER_RUNTIME_MAP_VERSION,
      generatedBy,
      phase: KV_ADAPTER_INTEGRATION_PHASE,
      status: 'ok',
      provider: provider.kind || null,
      namespaces: Object.entries(kv).map(([logicalName, physicalName]) => ({ logicalName, physicalName, storage: 'in-memory-local-proof' })),
      summary: { namespaces: Object.keys(kv).length }
    }, cwd),
    files: [{
      file: 'generated/host/runtime-provider-kv-adapter-proof.md',
      text: `# Runtime provider KV adapter proof\n\nThis proof wires provider-neutral KV namespaces into the local compiled-Wasm host runtime and Node adapter. It does not lower \`ctx.kv(...)\` inside compiled handlers or bind Fastly KV hostcalls.\n`
    }]
  };
}

module.exports = { buildRuntimeProviderKv, buildKvAdapterIntegration };
