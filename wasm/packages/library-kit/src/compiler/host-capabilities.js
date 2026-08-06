'use strict';

const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadContractsDiagnostics();

const PHASE = '11E';

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

const {
  HOST_CAPABILITIES_VERSION,
  WASI_PROVIDER_MAP_VERSION,
  CAPABILITY_PROVIDER_REPORT_VERSION,
  HOST_CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_DEFINITIONS,
  PROVIDER_DEFINITIONS,
  knownHostCapabilities,
  isKnownHostCapability
} = loadContractsHostCapabilities();

function loadContractsHostCapabilities() {
  try {
    return require('@pulse-compute/wasm-contracts/host/capabilities');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/host/capabilities.js');
    }
    throw error;
  }
}

function sortedUnique(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort();
}

function makeDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({
    phase: 'host-capabilities',
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: { file: '<host-capabilities>' }
  });
}

function capabilitiesFromLibraries(handlerLibraryContracts) {
  const libraries = handlerLibraryContracts?.libraryCapabilities?.libraries
    || handlerLibraryContracts?.libraryCapabilities?.artifact?.libraries
    || handlerLibraryContracts?.libraryCapabilities?.libraries
    || [];
  const capabilities = [];
  for (const library of libraries) {
    capabilities.push(...(library.hostCapabilities || []));
    for (const lowering of library.lowerings || []) {
      capabilities.push(...(lowering.hostCapabilities || []));
    }
  }
  return sortedUnique(capabilities);
}

function buildHostCapabilityContract(requiredCapabilities) {
  return {
    version: HOST_CAPABILITY_CONTRACT_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    status: 'ok',
    policy: {
      pulseCapabilitiesArePublicContract: true,
      providersAreImplementationChoices: true,
      wasiIsProviderNotAppApi: true,
      noDirectWasiInHandlers: true,
      noPlatformTargetIn11E: true,
      effectRuntimeDeferredTo11F: true,
      asyncIsExplicitEffectsNotLanguageAsync: true
    },
    requiredCapabilities,
    allowedCapabilities: knownHostCapabilities(),
    providerKinds: sortedUnique(PROVIDER_DEFINITIONS.map((provider) => provider.kind)),
    diagnostics: []
  };
}

function buildWasiProviderMap(requiredCapabilities) {
  const wasiCapabilities = CAPABILITY_DEFINITIONS
    .filter((capability) => capability.provider?.kind === 'wasi-provider' || (capability.providerCandidates || []).some((candidate) => candidate.kind === 'wasi-provider'))
    .map((capability) => ({
      pulseCapability: capability.capability,
      requiredByCurrentArtifacts: requiredCapabilities.includes(capability.capability),
      status: capability.status,
      primaryProvider: capability.provider,
      fallbackProvider: capability.providerFallback,
      candidates: capability.providerCandidates || [],
      effectRuntimeRequired: Boolean(capability.effectRuntimeRequired),
      publicAppApi: false,
      notes: capability.notes
    }));

  return {
    version: WASI_PROVIDER_MAP_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    status: 'ok',
    policy: {
      wasiIsProviderNotHandlerApi: true,
      pulseCapabilitiesWrapWasi: true,
      clocksUseMonotonicForDeadlines: true,
      wallClockIsNotDeadlineProvider: true,
      wasiHttpIsCandidateOnly: true,
      componentWiringDeferred: true,
      noWitDefinedIn11E: true
    },
    summary: {
      mappedPulseCapabilities: wasiCapabilities.length,
      requiredMappedPulseCapabilities: wasiCapabilities.filter((entry) => entry.requiredByCurrentArtifacts).length,
      wiredProviders: 0,
      deferredProviders: wasiCapabilities.length
    },
    providers: PROVIDER_DEFINITIONS.filter((provider) => provider.kind.includes('wasi')),
    mappings: wasiCapabilities
  };
}

function buildCapabilityProviderReport(requiredCapabilities, diagnostics) {
  const capabilities = CAPABILITY_DEFINITIONS.map((capability) => ({
    ...capability,
    requiredByCurrentArtifacts: requiredCapabilities.includes(capability.capability),
    providerResolved: Boolean(capability.provider),
    providerStatus: capability.provider ? capability.status : 'missing-provider'
  }));

  const required = capabilities.filter((capability) => capability.requiredByCurrentArtifacts);
  const effectRequired = capabilities.filter((capability) => capability.effectRuntimeRequired);
  const providerMapped = capabilities.filter((capability) => capability.providerResolved);
  const wiredNow = capabilities.filter((capability) => ['implemented', 'implemented-proof', 'contract-implemented-lazy-text', 'contract-implemented-generic-default'].includes(capability.status));

  return {
    version: CAPABILITY_PROVIDER_REPORT_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    status: diagnostics.length === 0 ? 'ok' : 'error',
    summary: {
      capabilities: capabilities.length,
      requiredCapabilities: required.length,
      providerMapped: providerMapped.length,
      wiredNow: wiredNow.length,
      effectRuntimeRequired: effectRequired.length,
      diagnostics: diagnostics.length,
      readyFor11F: diagnostics.length === 0,
      readyForFastly: false
    },
    capabilities,
    providers: PROVIDER_DEFINITIONS,
    diagnostics
  };
}

function markdownForHostCapabilities(artifact, wasiProviderMap, report) {
  const lines = [];
  lines.push('# PulseWasm Phase 11E Host Capability / WASI Provider Mapping');
  lines.push('');
  lines.push('## Status');
  lines.push('Locked as a contract/artifact phase. No runtime behavior, platform adapter, effect runtime, or WIT surface is implemented here.');
  lines.push('');
  lines.push('## Core Rule');
  lines.push('Pulse capabilities are the public runtime contract. Providers, including WASI, are implementation choices beneath that contract.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- capabilities: ${artifact.summary.capabilities}`);
  lines.push(`- required by current artifacts: ${artifact.summary.requiredCapabilities}`);
  lines.push(`- WASI-mapped capabilities: ${wasiProviderMap.summary.mappedPulseCapabilities}`);
  lines.push(`- effect-runtime-required capabilities: ${artifact.summary.effectRuntimeRequired}`);
  lines.push(`- diagnostics: ${artifact.summary.diagnostics}`);
  lines.push('');
  lines.push('## Required Capabilities');
  lines.push('');
  for (const capability of report.capabilities.filter((entry) => entry.requiredByCurrentArtifacts)) {
    lines.push(`- \`${capability.capability}\` — ${capability.status} via ${capability.provider?.name || '<missing>'}`);
  }
  lines.push('');
  lines.push('## WASI Provider Map');
  lines.push('');
  for (const mapping of wasiProviderMap.mappings) {
    lines.push(`- \`${mapping.pulseCapability}\`: ${mapping.primaryProvider?.name || 'candidate'} (${mapping.status})`);
  }
  lines.push('');
  lines.push('## Non-goals');
  lines.push('');
  lines.push('- no WIT definition');
  lines.push('- no platform adapter');
  lines.push('- no effect runtime');
  lines.push('- no language async');
  lines.push('- no direct WASI app API');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildHostCapabilities(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const diagnostics = [];
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const requiredFromLibraries = capabilitiesFromLibraries(inputs.handlerLibraryContracts);
  const requiredFromArtifacts = sortedUnique([
    ...requiredFromLibraries,
    ...(inputs.requestResultHeaders ? ['headers', 'result'] : []),
    ...(inputs.channelBroadcaster ? ['channel', 'broadcaster'] : []),
    ...(inputs.jsonBody ? ['json', 'body', 'result', 'headers'] : []),
    ...(inputs.backendCapabilities ? ['backend-fetch'] : []),
    ...(inputs.wasmHostAbi ? ['headers', 'result', 'params', 'state', 'error', 'lifecycle'] : [])
  ]);

  const knownCapabilities = new Set(knownHostCapabilities());
  for (const capability of requiredFromArtifacts) {
    if (!isKnownHostCapability(capability)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_HOST_CAPABILITY_UNKNOWN',
        `Unknown host capability ${JSON.stringify(capability)} was required by an artifact or library contract.`,
        'Add the capability to the locked Phase 11E capability registry before relying on it.',
        { capability }
      ));
    }
  }

  const requiredCapabilities = requiredFromArtifacts.filter((capability) => knownCapabilities.has(capability));
  const hostCapabilityContract = buildHostCapabilityContract(requiredCapabilities);
  const wasiProviderMap = buildWasiProviderMap(requiredCapabilities);
  const capabilityProviderReport = buildCapabilityProviderReport(requiredCapabilities, diagnostics);
  const artifact = normalizeArtifact({
    version: HOST_CAPABILITIES_VERSION,
    generatedBy,
    phase: PHASE,
    status: diagnostics.length === 0 ? 'ok' : 'error',
    scope: {
      semanticsChanged: false,
      runtimeBehaviorChanged: false,
      wasiWired: false,
      witDefined: false,
      effectRuntimeImplemented: false,
      platformAdapterImplemented: false
    },
    policy: {
      pulseCapabilitiesArePublicSurface: true,
      providersArePrivateImplementationChoices: true,
      wasiIsProviderNotAppApi: true,
      noDirectWasiInHandlers: true,
      noPlatformTargetIn11E: true,
      effectRuntimeDeferredTo11F: true,
      asyncIsEffectsNotLanguageAsync: true,
      clockUsesMonotonicForDeadlines: true,
      wallClockReservedForTimestamps: true
    },
    summary: capabilityProviderReport.summary,
    requiredCapabilities,
    capabilities: capabilityProviderReport.capabilities,
    providerMap: capabilityProviderReport.providers,
    next: {
      phase: '11F',
      name: 'Effect Runtime Contract',
      reason: 'Timer, ctx.fetch, and future body-read effects need explicit effect records/resume tokens; assets remain a host capability/payload streaming surface.'
    },
    diagnostics
  }, cwd);

  return {
    artifact,
    hostCapabilityContract: normalizeArtifact(hostCapabilityContract, cwd),
    wasiProviderMap: normalizeArtifact(wasiProviderMap, cwd),
    capabilityProviderReport: normalizeArtifact(capabilityProviderReport, cwd),
    files: [
      {
        file: 'generated/host/host-capabilities.md',
        text: markdownForHostCapabilities(artifact, wasiProviderMap, capabilityProviderReport)
      }
    ],
    diagnostics
  };
}

module.exports = {
  HOST_CAPABILITIES_VERSION,
  WASI_PROVIDER_MAP_VERSION,
  CAPABILITY_PROVIDER_REPORT_VERSION,
  HOST_CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_DEFINITIONS,
  PROVIDER_DEFINITIONS,
  buildHostCapabilities
};
