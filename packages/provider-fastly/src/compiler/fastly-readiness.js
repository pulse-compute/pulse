'use strict';

const crypto = require('node:crypto');
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadContractsDiagnostics();


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

const PHASE = '13B';
const FASTLY_READINESS_VERSION = 'pulsewasm.fastly-readiness.v1';
const FASTLY_SDK_AUDIT_VERSION = 'pulsewasm.fastly-sdk-audit.v1';
const FASTLY_HOSTCALL_MAP_VERSION = 'pulsewasm.fastly-hostcall-map.v1';
const FASTLY_CAPABILITY_MAP_VERSION = 'pulsewasm.fastly-capability-map.v1';
const FASTLY_PACKAGING_PLAN_VERSION = 'pulsewasm.fastly-packaging-plan.v1';
const FASTLY_RISK_REPORT_VERSION = 'pulsewasm.fastly-risk-report.v1';
const FASTLY_ADAPTER_PLAN_VERSION = 'pulsewasm.fastly-adapter-plan.v1';

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function makeFile(file, text) {
  return { file, text, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Text(text) };
}

function diag(code, message, hint, details) {
  return normalizeDiagnostic({ phase: 'fastly-readiness', severity: 'error', code, message, hint, details, loc: { file: '<fastly-readiness>' } });
}

function source(url, title, notes) {
  return { url, title, notes };
}

function buildSdkAudit() {
  const sources = [
    source('https://www.fastly.com/documentation/reference/compute/sdks/', 'Compute language SDKs', 'Official SDKs are Rust, JavaScript, and Go; current supported capability list includes Fanout, WebSockets passthrough, dynamic backends, config stores, secret stores, KV stores, cache APIs, and related features.'),
    source('https://www.fastly.com/documentation/guides/compute/developer-guides/custom/', 'Unofficial SDKs on the Compute platform', 'Custom SDKs are possible because Compute is WASI-powered, but Fastly warns they are unsupported; hostcalls are defined in Viceroy .witx files and custom binaries can be packed with fastly compute pack.'),
    source('https://www.fastly.com/documentation/reference/changes/2023/05/assemblyscript-sdk-deprecation/', 'AssemblyScript SDK deprecated', 'Fastly announced the AssemblyScript SDK is no longer actively developed or maintained.'),
    source('https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/', 'Pub/Sub at the edge with Fanout', 'Fanout is a Compute service capability for pub/sub and handoff flows; real pulse.grip remains package-level work.'),
    source('https://www.fastly.com/documentation/guides/integrations/non-fastly-services/developer-guide-backends', 'Developer guide: Backends', 'Dynamic backends are available via Compute SDKs and should not accept unvalidated user input as backend definitions.')
  ];
  const sdks = [
    {
      name: 'rust',
      support: 'official-sdk',
      useInPulseWasm: 'reference-only',
      baggageRisk: 'medium',
      usefulForAudit: ['hostcall coverage', 'stream/body behavior', 'backend/fanout/config/secret store patterns', 'packaging expectations'],
      dependencyDecision: 'do-not-depend'
    },
    {
      name: 'javascript',
      support: 'official-sdk',
      useInPulseWasm: 'reference-only',
      baggageRisk: 'high-for-core',
      usefulForAudit: ['web-platform request/response ergonomics', 'streams/fetch behavior', 'dynamic backend surface', 'local dev reference'],
      dependencyDecision: 'do-not-depend'
    },
    {
      name: 'go',
      support: 'official-sdk',
      useInPulseWasm: 'reference-only',
      baggageRisk: 'medium',
      usefulForAudit: ['SDK capability coverage', 'hostcall mapping patterns', 'packaging expectations'],
      dependencyDecision: 'do-not-depend'
    },
    {
      name: 'assemblyscript',
      support: 'deprecated-unsupported',
      useInPulseWasm: 'do-not-use-as-core-path',
      baggageRisk: 'high',
      usefulForAudit: ['historical caution only'],
      dependencyDecision: 'do-not-depend'
    }
  ];
  return {
    version: FASTLY_SDK_AUDIT_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    posture: {
      officialSdksAsDependencies: false,
      officialSdksAsReferences: true,
      customHostcallPathStillPossible: true,
      assemblyScriptSdkRevival: false,
      reason: 'PulseWasm should consume Fastly platform capabilities through its own host/runtime contract; SDKs are audited for hostcall and packaging behavior only.'
    },
    sources,
    sdks,
    summary: {
      sdksEvaluated: sdks.length,
      officialSdksEvaluated: sdks.filter((item) => item.support === 'official-sdk').length,
      dependenciesAdopted: 0,
      usedAsReference: true,
      assemblyScriptSdkUnsupported: true
    }
  };
}

function buildHostcallMap() {
  const capabilityMap = {
    headers: {
      pulseSurface: 'request-result-headers.json / ordered repeated header bags',
      fastlySurface: 'HTTP request/response hostcalls via SDK/compute ABI',
      readiness: 'ready-for-adapter-mapping',
      adapterNeed: 'map ordered repeated headers without collapsing Grip-Channel/Set-Cookie-like repeats'
    },
    streamResult: {
      pulseSurface: 'RESULT_STREAM / responseRef / streamRef',
      fastlySurface: 'body/response streaming hostcalls or SDK response stream primitives',
      readiness: 'critical-adapter-proof-needed',
      adapterNeed: 'prove host-owned response/body passthrough without copying bytes into PulseWasm'
    },
    backendFetch: {
      pulseSurface: 'backend-capabilities.json + ctx.fetch reserved effect',
      fastlySurface: 'backend request hostcalls / dynamic backend support',
      readiness: 'blocked-by-effect-runtime',
      adapterNeed: 'wait for explicit effect/resume runtime; validate declared backends and secret/config lookups'
    },
    broadcaster: {
      pulseSurface: 'channel-broadcaster.json + pulse.grip future contract',
      fastlySurface: 'Fanout / WebSockets passthrough capability',
      readiness: 'blocked-by-pulse-grip-package-analysis',
      adapterNeed: 'do not implement Fastly Fanout until pulse.grip contract and sidecar are real'
    },
    config: {
      pulseSurface: 'profile runtime config / env-resolved capabilities',
      fastlySurface: 'Config stores',
      readiness: 'mapping-needed',
      adapterNeed: 'map profile/capability config keys to attached Fastly config stores'
    },
    secrets: {
      pulseSurface: 'env secret refs in resolved config/backend capabilities',
      fastlySurface: 'Secret stores',
      readiness: 'mapping-needed',
      adapterNeed: 'ensure secret refs are never compiled into Wasm binary'
    },
    clock: {
      pulseSurface: 'host-capabilities clock/timer provider contract',
      fastlySurface: 'WASI/host time provider candidate',
      readiness: 'needs-provider-mapping',
      adapterNeed: 'map monotonic deadline/timer needs surgically; no broad WASI leakage'
    },
    assets: {
      pulseSurface: 'reserved host capability; streaming/passthrough primitive ready',
      fastlySurface: 'backend/object/resource storage depending on future asset strategy',
      readiness: 'reserved',
      adapterNeed: 'wait for pulse.assets package contract and streaming/binary decisions'
    },
    body: {
      pulseSurface: 'seeded body text / schema JSON; body-read effect reserved',
      fastlySurface: 'request body hostcalls / SDK body APIs',
      readiness: 'partial',
      adapterNeed: 'seed body text only when explicitly requested; do not add implicit parse/read'
    }
  };
  return {
    version: FASTLY_HOSTCALL_MAP_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    posture: {
      useOfficialSdkHostcallsAsReference: true,
      directBindingCandidate: true,
      noWitGeneratedYet: true,
      noFastlySemanticsInCore: true
    },
    pulseCapabilities: capabilityMap,
    criticalPath: ['headers', 'streamResult', 'config', 'secrets'],
    blockedCapabilities: ['backendFetch', 'broadcaster', 'assets', 'body-read-effect'],
    summary: {
      capabilitiesMapped: Object.keys(capabilityMap).length,
      readyForAdapterMapping: Object.values(capabilityMap).filter((item) => item.readiness.includes('ready')).length,
      blockedOrReserved: Object.values(capabilityMap).filter((item) => item.readiness.includes('blocked') || item.readiness === 'reserved').length,
      noHostcallImplementation: true
    }
  };
}

function buildCapabilityMap(hostCapabilities, sdkAudit, hostcallMap) {
  const hostSummary = hostCapabilities?.artifact?.summary || hostCapabilities?.summary || {};
  const capabilities = Object.entries(hostcallMap.pulseCapabilities).map(([key, value]) => ({
    key,
    pulseSurface: value.pulseSurface,
    fastlySurface: value.fastlySurface,
    readiness: value.readiness,
    adapterNeed: value.adapterNeed,
    source: 'fastly-hostcall-map.json'
  }));
  return {
    version: FASTLY_CAPABILITY_MAP_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    capabilities,
    pulseHostCapabilitySummary: hostSummary,
    sdkAuditSummary: sdkAudit.summary,
    summary: {
      capabilities: capabilities.length,
      readyOrPartial: capabilities.filter((item) => item.readiness.includes('ready') || item.readiness === 'partial').length,
      blocked: capabilities.filter((item) => item.readiness.includes('blocked')).length,
      reserved: capabilities.filter((item) => item.readiness === 'reserved').length
    }
  };
}

function buildPackagingPlan() {
  return {
    version: FASTLY_PACKAGING_PLAN_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    strategies: [
      {
        id: 'official-sdk-wrapper',
        status: 'not-preferred-for-core',
        support: 'official',
        benefit: 'lower platform integration risk',
        cost: 'SDK/runtime baggage; risks letting SDK wrapper shape PulseWasm core semantics',
        recommendation: 'audit only; do not adopt as 13B dependency'
      },
      {
        id: 'custom-hostcall-adapter',
        status: 'preferred-research-path',
        support: 'unsupported-custom-sdk-risk',
        benefit: 'preserves PulseWasm architecture and minimal runtime boundary',
        cost: 'we own hostcall bindings, packaging, and platform drift',
        recommendation: 'plan but do not implement until Fastly adapter phase'
      },
      {
        id: 'hybrid-reference-first',
        status: 'recommended-13b-posture',
        support: 'uses-docs-and-sdk-source-as-reference',
        benefit: 'learn from SDKs without importing baggage',
        cost: 'requires later hostcall binding work',
        recommendation: 'selected audit posture'
      }
    ],
    nearTerm: {
      buildArtifact: 'PulseWasm compiled runtime .wasm remains platform-neutral',
      packageCommandCandidate: 'fastly compute pack --wasm-binary <pulsewasm.wasm>',
      requiresFastlyManifest: true,
      manifestGeneration: 'deferred',
      localTesting: 'candidate fastly compute serve / Viceroy after adapter exists',
      noDeploymentPackageYet: true
    },
    summary: {
      strategies: 3,
      selected: 'hybrid-reference-first',
      implementationReady: false,
      packagingOnlyAfterAdapter: true
    }
  };
}

function buildRiskReport() {
  const risks = [
    {
      code: 'FASTLY_CUSTOM_SDK_UNSUPPORTED',
      severity: 'high',
      area: 'platform-support',
      message: 'Direct/custom hostcall path preserves PulseWasm minimalism but is not officially supported by Fastly.',
      mitigation: 'Use SDKs as references, keep an explicit adapter plan, and test through local Fastly tooling before deployment.'
    },
    {
      code: 'FASTLY_AS_SDK_DEPRECATED',
      severity: 'high',
      area: 'tooling',
      message: 'The prior Fastly AssemblyScript SDK is deprecated/unsupported and should not become the PulseWasm path.',
      mitigation: 'Generate PulseWasm-owned AS and bind platform hostcalls deliberately.'
    },
    {
      code: 'FASTLY_STREAM_PASSTHROUGH_CRITICAL',
      severity: 'medium',
      area: 'streaming',
      message: 'RESULT_STREAM maps to host-owned body/response refs; Fastly adapter must prove passthrough without byte copies.',
      mitigation: 'Make stream passthrough the first Fastly adapter proof after audit.'
    },
    {
      code: 'FASTLY_FANOUT_GRIP_BLOCKED',
      severity: 'medium',
      area: 'realtime',
      message: 'Fanout/GRIP readiness depends on the real pulse.grip package contract and sidecar analysis.',
      mitigation: 'Do package analysis before implementing Fastly Fanout behavior.'
    },
    {
      code: 'FASTLY_BACKEND_FETCH_EFFECT_BLOCKED',
      severity: 'medium',
      area: 'effects',
      message: 'Backend fetch requires the explicit effect runtime/resume model, not direct async/Promise behavior.',
      mitigation: 'Implement effect runtime proof before Fastly backend fetch support.'
    },
    {
      code: 'FASTLY_DEBUG_ARTIFACT_STRIP_REQUIRED',
      severity: 'low',
      area: 'packaging',
      message: 'Proof/debug artifacts, especially WAT, must not be part of deployment packages.',
      mitigation: 'Keep .wat opt-in and emit production artifact filters before deployment packaging.'
    }
  ];
  return {
    version: FASTLY_RISK_REPORT_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    risks,
    summary: {
      risks: risks.length,
      high: risks.filter((item) => item.severity === 'high').length,
      medium: risks.filter((item) => item.severity === 'medium').length,
      low: risks.filter((item) => item.severity === 'low').length,
      adapterBlocked: true
    }
  };
}

function buildAdapterPlan() {
  const stages = [
    {
      id: '13B',
      name: 'Fastly readiness + SDK implementation audit',
      status: 'this-phase',
      output: ['fastly-readiness.json', 'fastly-sdk-audit.json', 'fastly-hostcall-map.json', 'fastly-capability-map.json', 'fastly-risk-report.json']
    },
    {
      id: '13C-pre',
      name: 'Fastly hostcall binding contract',
      status: 'next-contract',
      output: ['fastly-hostcall-abi.json', 'fastly-stream-binding-contract.json', 'fastly-packaging-contract.json']
    },
    {
      id: '13C',
      name: 'Fastly stream/header adapter proof',
      status: 'future',
      output: ['fastly-adapter-smoke.json'],
      scope: 'headers + RESULT_STREAM passthrough only'
    },
    {
      id: '13D',
      name: 'Fastly config/secret mapping proof',
      status: 'future',
      scope: 'profile runtime capabilities → Fastly config/secret stores'
    },
    {
      id: 'later',
      name: 'Fanout/backend fetch/assets',
      status: 'blocked-by-package-and-effect-work',
      blockers: ['pulse.grip analysis', 'effect runtime', 'pulse.assets/package payload contract']
    }
  ];
  return {
    version: FASTLY_ADAPTER_PLAN_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    recommendedPath: 'hybrid-reference-first-custom-hostcall-adapter-later',
    stages,
    doNotImplementYet: ['Fastly adapter', 'fastly.toml generation', 'WIT generation', 'Fanout/GRIP behavior', 'ctx.fetch effect runtime'],
    summary: {
      stages: stages.length,
      next: '13C-pre Fastly hostcall binding contract',
      readyForImplementation: false,
      readyForAuditOnly: true
    }
  };
}

function buildMarkdown({ artifact, sdkAudit, hostcallMap, capabilityMap, packagingPlan, riskReport, adapterPlan }) {
  const lines = [];
  lines.push('# PulseWasm Fastly Readiness + SDK Implementation Audit');
  lines.push('');
  lines.push('13B is audit-only. Fastly SDKs are references, not dependencies. No adapter, WIT, fastly.toml, or deployment package is generated here.');
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(`- Preferred posture: \`${artifact.verdict.preferredStrategy}\``);
  lines.push(`- Ready for Fastly adapter implementation: \`${artifact.verdict.readyForFastlyAdapter}\``);
  lines.push(`- Ready for Fastly binding contract: \`${artifact.verdict.readyForFastlyBindingContract}\``);
  lines.push('');
  lines.push('## SDK audit posture');
  lines.push('');
  for (const sdk of sdkAudit.sdks) lines.push(`- ${sdk.name}: ${sdk.support}; dependency decision: ${sdk.dependencyDecision}`);
  lines.push('');
  lines.push('## Capability readiness');
  lines.push('');
  for (const cap of capabilityMap.capabilities) lines.push(`- ${cap.key}: ${cap.readiness}`);
  lines.push('');
  lines.push('## Risks');
  lines.push('');
  for (const risk of riskReport.risks) lines.push(`- ${risk.code} (${risk.severity}): ${risk.message}`);
  lines.push('');
  lines.push('## Next');
  lines.push('');
  lines.push(`- ${adapterPlan.summary.next}`);
  return `${lines.join('\n')}\n`;
}

function buildFastlyReadiness(inputs = {}, options = {}) {
  const diagnostics = [];
  const sdkAudit = buildSdkAudit();
  const hostcallMap = buildHostcallMap();
  const capabilityMap = buildCapabilityMap(inputs.hostCapabilities, sdkAudit, hostcallMap);
  const packagingPlan = buildPackagingPlan();
  const riskReport = buildRiskReport();
  const adapterPlan = buildAdapterPlan();
  const compiledRuntimeReady = Boolean(inputs.compiledWasmRuntime?.artifact?.summary?.compiled || inputs.pulseWrapper?.artifact?.summary?.compiledWasmRuntime);
  const streamReady = Boolean(inputs.streamingPassthrough?.artifact?.summary?.streamImplemented || inputs.compiledWasmRuntime?.artifact?.summary?.streamResult || inputs.pulseWrapper?.artifact?.summary?.nodeAdapterPath);
  const artifact = normalizeArtifact({
    version: FASTLY_READINESS_VERSION,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    phase: PHASE,
    posture: {
      auditOnly: true,
      sdkDependency: false,
      sdkReference: true,
      adapterImplemented: false,
      platformSemanticsAdded: false,
      fastlyDefinesPulseSemantics: false,
      officialSdkWrapperNotSelected: true,
      customHostcallAdapterNotImplemented: true
    },
    currentPulseWasmState: {
      compiledWasmRuntime: compiledRuntimeReady,
      highLevelWrapper: Boolean(inputs.pulseWrapper),
      hostRuntimeKernel: Boolean(inputs.compiledWasmRuntime || inputs.pulseWrapper),
      streamPassthroughPrimitive: streamReady,
      schemaJsonSidecars: Boolean(inputs.schemaJsonSidecar),
      librarySidecarMechanism: Boolean(inputs.librarySidecars),
      effectRuntimeContract: Boolean(inputs.effectRuntime || inputs.effectComposition),
      backendFetchExecution: false,
      realGripPackage: false,
      realAssetsPackage: false
    },
    verdict: {
      preferredStrategy: 'hybrid-reference-first-custom-hostcall-adapter-later',
      readyForFastlyReadinessAudit: true,
      readyForFastlyBindingContract: true,
      readyForFastlyAdapter: false,
      reason: 'PulseWasm has a platform-neutral compiled runtime and stream primitive, but Fastly adapter work still needs a hostcall binding contract. SDKs should be audited as references only.'
    },
    artifacts: {
      sdkAudit: 'fastly-sdk-audit.json',
      hostcallMap: 'fastly-hostcall-map.json',
      capabilityMap: 'fastly-capability-map.json',
      packagingPlan: 'fastly-packaging-plan.json',
      riskReport: 'fastly-risk-report.json',
      adapterPlan: 'fastly-adapter-plan.json'
    },
    sourceSummary: sdkAudit.sources,
    summary: {
      sdkReferences: sdkAudit.summary.sdksEvaluated,
      capabilitiesMapped: capabilityMap.summary.capabilities,
      risks: riskReport.summary.risks,
      adapterImplemented: false,
      readyForFastlyAdapter: false,
      readyForFastlyBindingContract: true,
      diagnostics: diagnostics.length
    }
  }, options.cwd || process.cwd());
  const files = [makeFile('generated/host/fastly-readiness.md', buildMarkdown({ artifact, sdkAudit, hostcallMap, capabilityMap, packagingPlan, riskReport, adapterPlan }))];
  return {
    artifact,
    sdkAudit: normalizeArtifact(sdkAudit, options.cwd || process.cwd()),
    hostcallMap: normalizeArtifact(hostcallMap, options.cwd || process.cwd()),
    capabilityMap: normalizeArtifact(capabilityMap, options.cwd || process.cwd()),
    packagingPlan: normalizeArtifact(packagingPlan, options.cwd || process.cwd()),
    riskReport: normalizeArtifact(riskReport, options.cwd || process.cwd()),
    adapterPlan: normalizeArtifact(adapterPlan, options.cwd || process.cwd()),
    files,
    diagnostics
  };
}

module.exports = { buildFastlyReadiness };
