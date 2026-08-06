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

const PHASE = '13C-pre';
const FASTLY_HOSTCALL_BINDING_CONTRACT_VERSION = 'pulsewasm.fastly-hostcall-binding-contract.v1';
const FASTLY_HOSTCALL_MODULES_VERSION = 'pulsewasm.fastly-hostcall-modules.v1';
const FASTLY_REF_LIFECYCLE_VERSION = 'pulsewasm.fastly-ref-lifecycle.v1';
const FASTLY_STREAM_BINDING_PLAN_VERSION = 'pulsewasm.fastly-stream-binding-plan.v1';
const FASTLY_PACK_INPUTS_VERSION = 'pulsewasm.fastly-pack-inputs.v1';
const FASTLY_BINDING_RISK_REPORT_VERSION = 'pulsewasm.fastly-binding-risk-report.v1';

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function makeFile(file, text) {
  return { file, text, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Text(text) };
}

function diag(code, message, hint, details) {
  return normalizeDiagnostic({
    phase: 'fastly-hostcall-binding',
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: { file: '<fastly-hostcall-binding>' }
  });
}

function source(url, title, notes) {
  return { url, title, notes };
}

function buildHostcallModules() {
  const requiredFirstProof = [
    {
      module: 'fastly_http_req',
      status: 'required-first-proof',
      pulseSurface: ['HostRequest', 'incoming method/path/header extraction', 'request handoff'],
      notes: 'Fastly custom SDK documentation calls out fastly_http_req as required for basic request handling.'
    },
    {
      module: 'fastly_http_body',
      status: 'required-first-proof',
      pulseSurface: ['RESULT_STREAM', 'response/body handle creation', 'host-owned byte movement'],
      notes: 'Fastly custom SDK documentation calls out fastly_http_body as required for responding to incoming requests.'
    }
  ];

  const candidateLater = [
    {
      module: 'backend/dynamic backend hostcall surface',
      status: 'candidate-later',
      pulseSurface: ['backend-capabilities.json', 'ctx.fetch backend-fetch effect'],
      blockedBy: 'effect runtime implementation',
      notes: 'Backend fetch remains behind declared ctx.fetch effects; do not add arbitrary backend access in the adapter.'
    },
    {
      module: 'config store surface',
      status: 'candidate-later',
      pulseSurface: ['profile runtime config', 'runtime.capabilities'],
      blockedBy: 'profile-to-store mapping proof'
    },
    {
      module: 'secret store surface',
      status: 'candidate-later',
      pulseSurface: ['env secret refs', 'backend auth headers'],
      blockedBy: 'secret mapping proof; secrets must not be compiled into Wasm'
    },
    {
      module: 'Fanout / WebSockets passthrough surface',
      status: 'candidate-later',
      pulseSurface: ['channel-broadcaster.json', 'future pulse.grip package contract'],
      blockedBy: 'real pulse.grip package analysis and sidecar contract'
    },
    {
      module: 'logging surface',
      status: 'candidate-later',
      pulseSurface: ['diagnostics/logging host capability'],
      blockedBy: 'logging capability contract'
    },
    {
      module: 'clock/timer provider',
      status: 'candidate-later',
      pulseSurface: ['effect-timeout-policy.json', 'timer/sleep effects'],
      blockedBy: 'effect runtime proof and provider binding'
    }
  ];

  return {
    version: FASTLY_HOSTCALL_MODULES_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    posture: {
      minimalFirstProof: true,
      officialSdkDependency: false,
      customHostcallBinding: true,
      adapterImplementation: false
    },
    requiredFirstProof,
    candidateLater,
    unavailableOrDeferred: [
      {
        module: 'AssemblyScript Fastly SDK',
        status: 'do-not-use',
        reason: 'Deprecated/unsupported; use SDKs only as references and bind PulseWasm contract directly later.'
      }
    ],
    summary: {
      requiredFirstProofModules: requiredFirstProof.length,
      candidateLaterModules: candidateLater.length,
      adapterImplemented: false,
      readyForStreamHeaderProof: true
    }
  };
}

function buildRefLifecycle() {
  const refs = [
    {
      ref: 'FastlyRequestRef',
      owner: 'Fastly host/runtime',
      createdBy: 'incoming Compute request hostcall surface',
      consumedBy: 'PulseWasm adapter request normalization',
      validUntil: 'active request processing completes',
      pulseMapping: 'HostRequest -> method/path/ordered headers/body handle seed',
      rules: [
        'do not persist beyond active request',
        'do not expose to user handlers',
        'adapter translates into PulseWasm HostRequest facts'
      ]
    },
    {
      ref: 'FastlyBodyRef',
      owner: 'Fastly host/runtime',
      createdBy: 'incoming request body or outgoing response body hostcall surface',
      consumedBy: 'stream/pass-through adapter',
      validUntil: 'active request/result lifetime',
      pulseMapping: 'HostStreamRef / streamRef / responseRef payload body',
      rules: [
        'host owns stream bytes',
        'PulseWasm owns opaque refs only',
        'do not copy bytes into Wasm unless explicitly requested by a future body-read/binary path'
      ]
    },
    {
      ref: 'FastlyResponseRef',
      owner: 'Fastly host/runtime',
      createdBy: 'adapter response construction or backend response passthrough',
      consumedBy: 'PulseWasm RESULT_STREAM/responseRef bridge',
      validUntil: 'response is returned/sent',
      pulseMapping: 'HostResult(kind="stream", responseRef, streamRef, headers)',
      rules: [
        'response headers may be merged with Pulse response mutations',
        'backend/platform response headers are preserved unless deleted/overridden',
        'ordered/repeated headers must remain observable'
      ]
    },
    {
      ref: 'PulseCtxRef',
      owner: 'PulseWasm runtime',
      createdBy: 'PulseWasm request execution',
      consumedBy: 'compiled handlers and adapter capability calls',
      validUntil: 'active dispatch/effect context lifetime',
      pulseMapping: 'existing ctx ABI',
      rules: [
        'do not store Fastly refs directly in user-visible ctx',
        'context generations guard future effect resumes',
        'setup failures throw; Pulse routing outcomes return HostResult'
      ]
    }
  ];

  return {
    version: FASTLY_REF_LIFECYCLE_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    posture: {
      hostOwnsPlatformHandles: true,
      wasmOwnsOpaqueRefsOnly: true,
      activeRequestLifetime: true,
      noLongLivedBorrowedPointers: true,
      adapterImplementation: false
    },
    refs,
    cleanupPolicy: {
      firstProof: 'active-request lifetime only',
      streamFailureBeforeStart: 'return normal Pulse error/result',
      streamFailureAfterStart: 'host/platform transport failure policy',
      clientDisconnect: 'host cancels stream/body handles',
      bodyReadEffect: 'reserved'
    },
    summary: {
      refs: refs.length,
      streamBytesOwnedByHost: true,
      pulseWasmCopiesBytesByDefault: false,
      adapterImplemented: false
    }
  };
}

function buildStreamBindingPlan() {
  const steps = [
    {
      order: 0,
      name: 'incoming-request-normalization',
      pulseSurface: 'HostRequest',
      fastlySurface: 'request hostcall handle',
      status: 'contracted-not-implemented'
    },
    {
      order: 1,
      name: 'ordered-header-extraction',
      pulseSurface: 'ordered repeated header bag',
      fastlySurface: 'request/response header hostcall surface',
      status: 'critical-first-proof'
    },
    {
      order: 2,
      name: 'compiled-runtime-execution',
      pulseSurface: 'compiled-wasm runtime',
      fastlySurface: 'custom Wasm binary packaged for Compute',
      status: 'platform-neutral-ready'
    },
    {
      order: 3,
      name: 'result-stream-translation',
      pulseSurface: 'RESULT_STREAM / responseRef / streamRef',
      fastlySurface: 'response/body handle',
      status: 'critical-first-proof'
    },
    {
      order: 4,
      name: 'header-merge-application',
      pulseSurface: 'delete/set/append ordered response mutations',
      fastlySurface: 'response header mutation hostcalls',
      status: 'critical-first-proof'
    },
    {
      order: 5,
      name: 'body-return',
      pulseSurface: 'host-owned stream bytes',
      fastlySurface: 'Compute response body',
      status: 'critical-first-proof'
    }
  ];

  return {
    version: FASTLY_STREAM_BINDING_PLAN_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    posture: {
      firstAdapterProofShouldBeStreamHeaderOnly: true,
      backendFetchBlockedByEffectRuntime: true,
      pulseGripBlockedByPackageAnalysis: true,
      pulseAssetsBlockedByPackageAnalysis: true
    },
    headerMergePolicy: {
      preserveBackendHeaders: true,
      deleteCaseInsensitive: true,
      setOverridesExistingName: true,
      appendPreservesRepeatedHeaders: true,
      preserveGripChannelRepeats: true
    },
    streamPolicy: {
      hostOwnedBytes: true,
      wasmOwnsBytes: false,
      resultKind: 'RESULT_STREAM',
      resultBinaryReserved: true,
      responseRefPassthrough: true,
      streamRefPassthrough: true,
      requestBodyParsingTouched: false
    },
    steps,
    proofCases: [
      'GET/POST request maps into HostRequest facts',
      'repeated request headers survive extraction',
      'PulseWasm RESULT_STREAM maps to Fastly response/body handle',
      'backend/platform response headers are preserved',
      'Pulse response header delete/set/append mutates pass-through headers deterministically',
      'Grip-Channel repeated headers survive the response mapping'
    ],
    summary: {
      steps: steps.length,
      criticalProofSteps: steps.filter((step) => /critical/.test(step.status)).length,
      streamPassthroughReadyForProof: true,
      adapterImplemented: false
    }
  };
}

function buildPackInputs(inputs = {}) {
  return {
    version: FASTLY_PACK_INPUTS_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    posture: {
      packagingContractOnly: true,
      packCommandCandidate: 'fastly compute pack --wasm-binary <compiled-pulsewasm.wasm>',
      fastlyTomlGeneration: 'deferred',
      viceroyExecution: 'deferred',
      deployCommand: 'deferred'
    },
    requiredInputs: [
      {
        name: 'compiledPulseWasmBinary',
        source: 'generated/compiled-wasm-runtime/pulsewasm-compiled-runtime.wasm',
        status: inputs.compiledWasmRuntime ? 'available-from-prior-phase' : 'required'
      },
      {
        name: 'fastlyManifest',
        source: 'fastly.toml / Compute manifest inputs',
        status: 'deferred-contract-needed'
      },
      {
        name: 'hostcallBindingLayer',
        source: 'future generated Fastly binding shim',
        status: 'not-implemented'
      },
      {
        name: 'deploymentPosture',
        source: 'deployment-posture.json',
        status: inputs.deploymentPosture ? 'available' : 'required'
      },
      {
        name: 'hostCapabilities',
        source: 'host-capabilities.json',
        status: inputs.hostCapabilities ? 'available' : 'required'
      },
      {
        name: 'fastlyCapabilityMap',
        source: 'fastly-capability-map.json',
        status: inputs.fastlyReadiness?.capabilityMap ? 'available' : 'required'
      }
    ],
    explicitNonInputs: [
      'Fastly official SDK dependency',
      'deprecated AssemblyScript SDK',
      'real pulse.grip implementation',
      'real pulse.assets implementation',
      'ctx.fetch effect runtime'
    ],
    summary: {
      requiredInputs: 6,
      availableInputs: [inputs.compiledWasmRuntime, inputs.deploymentPosture, inputs.hostCapabilities, inputs.fastlyReadiness?.capabilityMap].filter(Boolean).length,
      implementationReady: false,
      adapterPackagingReady: false
    }
  };
}

function buildBindingRiskReport() {
  const risks = [
    {
      code: 'FASTLY_CUSTOM_HOSTCALL_UNSUPPORTED_BY_VENDOR',
      severity: 'high',
      status: 'accepted-risk-for-audit',
      message: 'Custom SDK/hostcall paths are possible but not supported by Fastly; adapter work must be isolated and testable.'
    },
    {
      code: 'FASTLY_HOSTCALL_SIGNATURE_DRIFT',
      severity: 'high',
      status: 'must-track',
      message: 'Binding layer must track Viceroy/Fastly hostcall interface changes and avoid baking assumptions into PulseWasm core.'
    },
    {
      code: 'FASTLY_STREAM_LIFECYCLE_RISK',
      severity: 'high',
      status: 'critical-first-proof',
      message: 'Stream/body handles require explicit lifetime and cleanup behavior; first adapter proof must focus on stream/header mapping.'
    },
    {
      code: 'FASTLY_HEADER_REPEAT_COLLAPSE_RISK',
      severity: 'medium',
      status: 'must-test',
      message: 'Repeated headers such as Grip-Channel must not collapse during request/response mapping.'
    },
    {
      code: 'FASTLY_BACKEND_FETCH_EFFECT_BLOCKED',
      severity: 'medium',
      status: 'blocked',
      message: 'Backend fetch mapping waits for PulseWasm effect runtime and declared backend capability execution.'
    },
    {
      code: 'FASTLY_FANOUT_GRIP_BLOCKED',
      severity: 'medium',
      status: 'blocked',
      message: 'Fanout/GRIP waits for real pulse.grip package contract and sidecar analysis.'
    },
    {
      code: 'FASTLY_DEBUG_ARTIFACT_STRIP_REQUIRED',
      severity: 'medium',
      status: 'future-optimization',
      message: 'Production package must strip debug/proof artifacts and avoid shipping WAT/diagnostic bulk.'
    }
  ];
  return {
    version: FASTLY_BINDING_RISK_REPORT_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    risks,
    mitigations: [
      'Keep 13C-pre contract-only.',
      'Implement first Fastly proof as stream/header mapping only.',
      'Use SDKs and Viceroy hostcall definitions as references, not dependencies.',
      'Keep platform behavior out of PulseWasm core semantics.',
      'Gate backend fetch and Fanout behind existing Pulse contracts.'
    ],
    summary: {
      risks: risks.length,
      high: risks.filter((risk) => risk.severity === 'high').length,
      blocked: risks.filter((risk) => risk.status === 'blocked').length,
      adapterImplementationAllowed: false
    }
  };
}

function buildBindingContract({ hostcallModules, refLifecycle, streamBindingPlan, packInputs, riskReport }, inputs = {}) {
  const sources = [
    source('https://www.fastly.com/documentation/guides/compute/developer-guides/custom/', 'Unofficial SDKs on the Compute platform', 'Custom SDKs are possible because Compute is WASI-powered, but unsupported; hostcalls live in Viceroy .witx definitions and basic functionality requires fastly_http_req and fastly_http_body.'),
    source('https://www.fastly.com/documentation/reference/cli/compute/pack/', 'fastly compute pack', 'Fastly CLI can package a pre-compiled Wasm binary using --wasm-binary.'),
    source('https://www.fastly.com/documentation/reference/compute/sdks/', 'Compute language SDKs', 'Official SDKs are references only for PulseWasm: Rust, JavaScript, and Go.'),
    source('https://github.com/fastly/Viceroy', 'Viceroy', 'Local testing server and Rust library used through fastly compute serve; useful reference for hostcall behavior and custom SDK testing.' )
  ];
  const readiness = inputs.fastlyReadiness?.artifact?.verdict || {};
  return {
    version: FASTLY_HOSTCALL_BINDING_CONTRACT_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    posture: {
      contractOnly: true,
      adapterImplemented: false,
      deploymentPackageGenerated: false,
      fastlyTomlGenerated: false,
      viceroyExecution: false,
      sdkDependency: false,
      sdkReference: true,
      fastlyDefinesPulseSemantics: false,
      pulseWasmMapsExistingRuntimeContract: true
    },
    bindingStrategy: {
      selected: 'custom-hostcall-binding-after-contract',
      immediateNextProof: 'Fastly stream/header adapter proof',
      sdkWrapperRejectedForCore: true,
      rustSdkPrimaryReference: true,
      jsGoSdksCrossCheck: true,
      assemblyScriptSdkRevival: false
    },
    currentReadiness: {
      from13B: readiness,
      compiledWasmRuntimeAvailable: Boolean(inputs.compiledWasmRuntime),
      streamPrimitiveAvailable: Boolean(inputs.streamingPassthrough || inputs.compiledWasmRuntime),
      hostCapabilitiesAvailable: Boolean(inputs.hostCapabilities),
      adapterReady: false
    },
    modules: {
      artifact: 'fastly-hostcall-modules.json',
      requiredFirstProof: hostcallModules.requiredFirstProof.map((module) => module.module),
      candidateLater: hostcallModules.candidateLater.map((module) => module.module)
    },
    lifecycle: {
      artifact: 'fastly-ref-lifecycle.json',
      streamBytesOwnedByHost: refLifecycle.summary.streamBytesOwnedByHost,
      activeRequestLifetimeOnly: true
    },
    streamBinding: {
      artifact: 'fastly-stream-binding-plan.json',
      critical: true,
      proofCases: streamBindingPlan.proofCases
    },
    packaging: {
      artifact: 'fastly-pack-inputs.json',
      packCommandCandidate: packInputs.posture.packCommandCandidate,
      implementationReady: false
    },
    riskReport: {
      artifact: 'fastly-binding-risk-report.json',
      highRisks: riskReport.summary.high,
      blocked: riskReport.summary.blocked
    },
    sources,
    verdict: {
      readyForHostcallBindingContract: true,
      readyForFastlyStreamHeaderProof: true,
      readyForFastlyAdapterImplementation: false,
      readyForFastlyPackaging: false,
      reason: 'The PulseWasm runtime contract is ready to be mapped to Fastly hostcalls, but 13C-pre intentionally stops before adapter/packaging implementation.'
    },
    summary: {
      requiredFirstProofModules: hostcallModules.summary.requiredFirstProofModules,
      candidateLaterModules: hostcallModules.summary.candidateLaterModules,
      refsTracked: refLifecycle.summary.refs,
      streamProofCases: streamBindingPlan.proofCases.length,
      packInputs: packInputs.summary.requiredInputs,
      risks: riskReport.summary.risks,
      adapterImplemented: false,
      readyForFastlyStreamHeaderProof: true,
      readyForFastlyAdapter: false,
      diagnostics: 0
    }
  };
}

function markdown({ artifact, hostcallModules, refLifecycle, streamBindingPlan, packInputs, riskReport }) {
  const lines = [];
  lines.push('# Fastly Hostcall Binding Contract');
  lines.push('');
  lines.push(`Generated by ${artifact.generatedBy}.`);
  lines.push('');
  lines.push('## Status');
  lines.push('');
  lines.push('Contract only. No Fastly adapter, package, `fastly.toml`, WIT generation, Viceroy execution, or deployment is implemented in this phase.');
  lines.push('');
  lines.push('## Binding posture');
  lines.push('');
  lines.push('- Fastly SDKs remain references, not dependencies.');
  lines.push('- PulseWasm maps its existing runtime/host ABI onto Fastly hostcalls later.');
  lines.push('- Fastly does not define PulseWasm core semantics.');
  lines.push('- The first adapter proof should focus on headers and stream/pass-through.');
  lines.push('');
  lines.push('## Required first-proof modules');
  lines.push('');
  for (const module of hostcallModules.requiredFirstProof) {
    lines.push(`- ${module.module}: ${module.notes}`);
  }
  lines.push('');
  lines.push('## Ref lifecycle');
  lines.push('');
  for (const ref of refLifecycle.refs) {
    lines.push(`- ${ref.ref}: owner=${ref.owner}; validUntil=${ref.validUntil}`);
  }
  lines.push('');
  lines.push('## Stream/header proof cases');
  lines.push('');
  for (const proof of streamBindingPlan.proofCases) lines.push(`- ${proof}`);
  lines.push('');
  lines.push('## Packaging inputs');
  lines.push('');
  for (const input of packInputs.requiredInputs) lines.push(`- ${input.name}: ${input.status}`);
  lines.push('');
  lines.push('## Risks');
  lines.push('');
  for (const risk of riskReport.risks) lines.push(`- ${risk.code} (${risk.severity}): ${risk.message}`);
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(`Ready for binding contract: ${artifact.verdict.readyForHostcallBindingContract}`);
  lines.push(`Ready for stream/header proof: ${artifact.verdict.readyForFastlyStreamHeaderProof}`);
  lines.push(`Ready for adapter implementation: ${artifact.verdict.readyForFastlyAdapterImplementation}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildFastlyHostcallBinding(inputs = {}, options = {}) {
  const diagnostics = [];
  if (!inputs.fastlyReadiness) {
    diagnostics.push(diag(
      'PULSEWASM_FASTLY_HOSTCALL_REQUIRES_READINESS_AUDIT',
      'Fastly hostcall binding contract requires the 13B Fastly readiness audit artifact.',
      'Run with --emit-fastly-readiness before --emit-fastly-hostcall-binding.'
    ));
  }
  const hostcallModules = buildHostcallModules();
  const refLifecycle = buildRefLifecycle();
  const streamBindingPlan = buildStreamBindingPlan();
  const packInputs = buildPackInputs(inputs);
  const riskReport = buildBindingRiskReport();
  const artifact = normalizeArtifact(buildBindingContract({ hostcallModules, refLifecycle, streamBindingPlan, packInputs, riskReport }, inputs), options.cwd || process.cwd());
  const files = [makeFile('generated/host/fastly-hostcall-binding-contract.md', markdown({ artifact, hostcallModules, refLifecycle, streamBindingPlan, packInputs, riskReport }))];
  return {
    artifact,
    hostcallModules: normalizeArtifact(hostcallModules, options.cwd || process.cwd()),
    refLifecycle: normalizeArtifact(refLifecycle, options.cwd || process.cwd()),
    streamBindingPlan: normalizeArtifact(streamBindingPlan, options.cwd || process.cwd()),
    packInputs: normalizeArtifact(packInputs, options.cwd || process.cwd()),
    riskReport: normalizeArtifact(riskReport, options.cwd || process.cwd()),
    files,
    diagnostics
  };
}

module.exports = { buildFastlyHostcallBinding };
