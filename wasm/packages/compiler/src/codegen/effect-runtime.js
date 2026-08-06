'use strict';

const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = require('../diagnostics.js');

const PHASE = '11F';
const EFFECT_RUNTIME_VERSION = 'pulsewasm.effect-runtime.v1';
const EFFECT_RUNTIME_CONTRACT_VERSION = 'pulsewasm.effect-runtime-contract.v1';
const EFFECT_KIND_REGISTRY_VERSION = 'pulsewasm.effect-kind-registry.v1';
const EFFECT_RESUME_PROTOCOL_VERSION = 'pulsewasm.effect-resume-protocol.v1';
const EFFECT_TIMEOUT_POLICY_VERSION = 'pulsewasm.effect-timeout-policy.v1';

const CONTEXT_STATES = ['active', 'suspended', 'resuming', 'expired', 'completed', 'cleaned'];
const EFFECT_STATES = ['pending', 'completed', 'failed', 'expired', 'cancelled'];

const STEP_RESULTS = [
  { code: 'STEP_CONTINUE', value: 0, meaning: 'Continue scanning/executing the current Pulse execution plan.' },
  { code: 'STEP_DONE', value: 1, meaning: 'A result has been produced and the context is completed.' },
  { code: 'STEP_EFFECT', value: 2, meaning: 'A host effect was recorded; the context is suspended until host resume.' },
  { code: 'STEP_EXPIRED', value: 3, meaning: 'The context/effect deadline expired.' }
];

const EFFECT_KINDS = [
  {
    kind: 'sleep',
    code: 1,
    capability: 'timer',
    status: 'contract-first-proof-target',
    publicSurface: 'ctx.sleep(ms)',
    provider: { kind: 'host-scheduler', name: 'pulse-host-scheduler' },
    preferredProvider: { kind: 'wasi-provider', name: 'wasi:clocks', clock: 'monotonic-clock' },
    hostOwned: true,
    explicitResume: true,
    payload: { ms: 'positive bounded integer duration in milliseconds' },
    notes: 'Sleep is the smallest effect used to prove suspend/resume, deadlines, and stale-resume rejection.'
  },
  {
    kind: 'backend-fetch',
    code: 2,
    capability: 'backend-fetch',
    status: 'reserved-effect-runtime-required',
    publicSurface: 'ctx.fetch("backendKey", requestSpec)',
    provider: { kind: 'host-effect', name: 'pulse-backend-fetch-effect' },
    providerCandidates: [{ kind: 'wasi-provider-candidate', name: 'wasi:http' }],
    hostOwned: true,
    explicitResume: true,
    payload: { backend: 'declared backend key', request: 'static request spec / requestRef' },
    notes: 'Outbound fetch remains unsupported in Wasm mode until the effect/resume runtime is implemented.'
  },
  {
    kind: 'body-read',
    code: 4,
    capability: 'body',
    status: 'contract-implemented-lazy-text-effect-compatible',
    publicSurface: 'pulse_request_body_text(ctx) / future explicit body read effect',
    provider: { kind: 'host-runtime', name: 'pulse-body-adaptor' },
    hostOwned: true,
    explicitResume: true,
    payload: { mode: 'text | json', maxBytes: 'bounded by JSON/body contract when applicable' },
    notes: 'Body is explicit/lazy. Existing text body seeding remains valid; effect form is the future async/lazy extension.'
  }
];

const DIAGNOSTICS = {
  contextTimeout: {
    code: 'PULSEWASM_CONTEXT_TIMEOUT',
    message: 'PulseWasm context deadline expired.',
    statusCode: 504
  },
  effectTimeout: {
    code: 'PULSEWASM_EFFECT_TIMEOUT',
    message: 'PulseWasm host effect deadline expired.',
    statusCode: 504
  },
  requestTimeout: {
    code: 'PULSEWASM_REQUEST_TIMEOUT',
    message: 'Request body/client deadline expired.',
    statusCode: 408
  },
  staleResume: {
    code: 'PULSEWASM_STALE_EFFECT_RESUME',
    message: 'Host attempted to resume an expired, cleaned, or generation-mismatched PulseWasm effect.',
    statusCode: 500
  },
  effectUnsupported: {
    code: 'PULSEWASM_EFFECT_RUNTIME_UNSUPPORTED',
    message: 'The requested PulseWasm effect requires an effect runtime that is not enabled.',
    statusCode: 500
  }
};

function sortedUnique(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort();
}

function makeDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({
    phase: 'effect-runtime',
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: { file: '<effect-runtime>' }
  });
}

function requiredCapabilitiesFromHostCapabilities(hostCapabilities) {
  const fromArtifact = hostCapabilities?.artifact?.requiredCapabilities || hostCapabilities?.requiredCapabilities || [];
  const fromReport = hostCapabilities?.capabilityProviderReport?.capabilities
    ?.filter((capability) => capability.requiredByCurrentArtifacts)
    ?.map((capability) => capability.capability) || [];
  return sortedUnique([...fromArtifact, ...fromReport]);
}

function buildEffectRuntimeContract({ generatedBy, requiredCapabilities }) {
  return {
    version: EFFECT_RUNTIME_CONTRACT_VERSION,
    generatedBy,
    phase: PHASE,
    status: 'locked',
    scope: {
      contractOnly: true,
      runtimeImplemented: false,
      sleepImplemented: false,
      fetchImplemented: false,
      assetsImplemented: false,
      bodyReadEffectImplemented: false,
      languageAsyncImplemented: false,
      promisesImplemented: false
    },
    policy: {
      explicitEffectsOnly: true,
      languageLevelAsync: false,
      asyncAwaitAllowed: false,
      promiseHandlersAllowed: false,
      hiddenSuspension: false,
      hostOwnedScheduling: true,
      monotonicClockForDeadlines: true,
      wallClockForDeadlines: false,
      cpuPreemptionV1: false,
      deadlinesEnforcedAtRuntimeAndEffectBoundaries: true,
      loopsRemainRejected: true,
      arbitraryTimersRejected: true,
      noUserTimerQueue: true
    },
    contextStates: CONTEXT_STATES,
    effectStates: EFFECT_STATES,
    stepResults: STEP_RESULTS,
    requiredCapabilities,
    diagnostics: []
  };
}

function buildEffectKindRegistry({ generatedBy, requiredCapabilities }) {
  const requiredSet = new Set(requiredCapabilities || []);
  return {
    version: EFFECT_KIND_REGISTRY_VERSION,
    generatedBy,
    phase: PHASE,
    status: 'locked',
    policy: {
      sleepIsFirstProofEffect: true,
      effectKindsAreClosedForV1Contract: true,
      addingEffectRequiresContractUpdate: true,
      effectsAreNotPromises: true
    },
    summary: {
      effectKinds: EFFECT_KINDS.length,
      requiredByCurrentArtifacts: EFFECT_KINDS.filter((effect) => requiredSet.has(effect.capability)).length,
      firstProofTarget: 'sleep',
      fetchReserved: true,
      assetsExcludedFromV1EffectKinds: true,
      streamingBinaryReserved: true,
      bodyReadEffectReserved: true
    },
    effects: EFFECT_KINDS.map((effect) => ({
      ...effect,
      requiredByCurrentArtifacts: requiredSet.has(effect.capability)
    }))
  };
}

function buildEffectResumeProtocol({ generatedBy }) {
  return {
    version: EFFECT_RESUME_PROTOCOL_VERSION,
    generatedBy,
    phase: PHASE,
    status: 'locked',
    resumeToken: {
      fields: [
        { name: 'ctxId', type: 'string | i64', required: true },
        { name: 'effectId', type: 'string | i64', required: true },
        { name: 'generation', type: 'i32', required: true },
        { name: 'effectKind', type: 'EffectKindCode', required: true },
        { name: 'resumeEntryIndex', type: 'i32', required: true },
        { name: 'deadlineAtMonotonicMs', type: 'i64', required: true }
      ],
      opaqueToUserHandlers: true,
      hostVisible: true
    },
    pulseFrameStack: {
      model: 'runtime-owned Pulse execution frame stack, not the Wasm call stack',
      frameKinds: ['entry', 'mount', 'effect'],
      wasmCallStackCaptured: false,
      continuationIsTableBacked: true
    },
    resumeRules: [
      'context must still exist',
      'context status must be suspended or resuming',
      'resume token generation must match current context generation',
      'effect must still be pending',
      'effect deadline must not be expired',
      'stale resumes are rejected with PULSEWASM_STALE_EFFECT_RESUME'
    ],
    hostEntryPoints: {
      reserved: [
        'pulse_resume_effect(ctxRef, effectId, resultRef)',
        'pulse_resume_effect_error(ctxRef, effectId, errorRef)',
        'pulse_cancel_effect(ctxRef, effectId)'
      ],
      implementedIn11F: false
    },
    diagnostics: DIAGNOSTICS
  };
}

function buildEffectTimeoutPolicy({ generatedBy }) {
  return {
    version: EFFECT_TIMEOUT_POLICY_VERSION,
    generatedBy,
    phase: PHASE,
    status: 'locked',
    defaults: {
      defaultTimeoutMs: 5000,
      hardTimeoutMs: 30000,
      defaultEffectTimeoutMs: 5000,
      schedulerResolutionMs: 10
    },
    policy: {
      hardDeadlineCannotBeExtended: true,
      contextTimeoutStatusCode: 504,
      effectTimeoutStatusCode: 504,
      requestBodyClientTimeoutStatusCode: 408,
      normalFallthroughStatusCode: 404,
      contractViolationStatusCode: 500,
      clockSource: 'monotonic',
      wallClockForDeadlines: false,
      deadlineChecks: ['before effect record', 'before suspend', 'on host resume', 'between runtime steps'],
      cpuPreemption: false
    },
    errors: {
      contextTimeout: DIAGNOSTICS.contextTimeout,
      effectTimeout: DIAGNOSTICS.effectTimeout,
      requestTimeout: DIAGNOSTICS.requestTimeout,
      staleResume: DIAGNOSTICS.staleResume
    }
  };
}

function markdownForEffectRuntime(artifact, contract, registry, resumeProtocol, timeoutPolicy) {
  const lines = [];
  lines.push('# PulseWasm Phase 11F Effect Runtime Contract');
  lines.push('');
  lines.push('## Status');
  lines.push('Locked as a contract/artifact phase. No effect execution, language-level async, promises, or platform scheduling is implemented here.');
  lines.push('');
  lines.push('## Core Rule');
  lines.push('PulseWasm async is explicit host effects with continuation/resume, not `async`/`await`, promises, hidden stack suspension, or arbitrary timers.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- effect kinds: ${registry.summary.effectKinds}`);
  lines.push(`- first proof target: ${registry.summary.firstProofTarget}`);
  lines.push(`- context states: ${contract.contextStates.join(', ')}`);
  lines.push(`- default timeout: ${timeoutPolicy.defaults.defaultTimeoutMs}ms`);
  lines.push(`- hard timeout: ${timeoutPolicy.defaults.hardTimeoutMs}ms`);
  lines.push(`- diagnostics: ${artifact.summary.diagnostics}`);
  lines.push('');
  lines.push('## Effect Kinds');
  lines.push('');
  for (const effect of registry.effects) {
    lines.push(`- \`${effect.kind}\` — ${effect.status}; capability: \`${effect.capability}\`; surface: ${effect.publicSurface}.`);
  }
  lines.push('');
  lines.push('## Resume Protocol');
  lines.push('');
  lines.push('Resume tokens include context id, effect id, generation, effect kind, resume entry index, and monotonic deadline. Stale resumes are rejected.');
  lines.push('');
  lines.push('## Timeout Policy');
  lines.push('');
  lines.push('- context/effect timeout => 504');
  lines.push('- request/client body timeout => 408');
  lines.push('- normal fallthrough remains 404');
  lines.push('- contract violation remains 500');
  lines.push('- CPU preemption is not part of v1; loop/long-running syntax remains rejected.');
  lines.push('');
  lines.push('## Non-goals');
  lines.push('');
  lines.push('- no effect runtime execution');
  lines.push('- no sleep implementation');
  lines.push('- no backend fetch execution');
  lines.push('- no asset read execution (assets are reserved host capability/payload surface, not a v1 effect kind)');
  lines.push('- no language-level async or Promise handlers');
  lines.push('- no platform adapter');
  lines.push('- no WIT definition');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildEffectRuntime(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const diagnostics = [];
  const requiredCapabilities = requiredCapabilitiesFromHostCapabilities(inputs.hostCapabilities);
  const knownEffectCapabilities = new Set(EFFECT_KINDS.map((effect) => effect.capability));
  for (const capability of ['timer', 'backend-fetch']) {
    if (requiredCapabilities.includes(capability) && !knownEffectCapabilities.has(capability)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_EFFECT_CAPABILITY_UNMAPPED',
        `Capability ${JSON.stringify(capability)} requires an effect runtime but has no Phase 11F effect mapping.`,
        'Add an effect kind mapping before using this capability in optimized Wasm mode.',
        { capability }
      ));
    }
  }

  const effectRuntimeContract = normalizeArtifact(buildEffectRuntimeContract({ generatedBy, requiredCapabilities }), cwd);
  const effectKindRegistry = normalizeArtifact(buildEffectKindRegistry({ generatedBy, requiredCapabilities }), cwd);
  const effectResumeProtocol = normalizeArtifact(buildEffectResumeProtocol({ generatedBy }), cwd);
  const effectTimeoutPolicy = normalizeArtifact(buildEffectTimeoutPolicy({ generatedBy }), cwd);

  const effectRuntimeCapabilities = sortedUnique(EFFECT_KINDS.map((effect) => effect.capability));
  const requiredEffectCapabilities = sortedUnique(requiredCapabilities.filter((capability) => effectRuntimeCapabilities.includes(capability)));
  const artifact = normalizeArtifact({
    version: EFFECT_RUNTIME_VERSION,
    generatedBy,
    phase: PHASE,
    status: diagnostics.length === 0 ? 'ok' : 'error',
    scope: {
      semanticsChanged: false,
      runtimeBehaviorChanged: false,
      contractOnly: true,
      effectRuntimeImplemented: false,
      sleepImplemented: false,
      backendFetchImplemented: false,
      assetsAreEffectKind: false,
      assetReadImplemented: false,
      bodyReadEffectImplemented: false,
      platformAdapterImplemented: false,
      witDefined: false,
      languageAsyncImplemented: false
    },
    policy: {
      explicitEffects: true,
      hostOwnedScheduling: true,
      monotonicDeadlines: true,
      resumeTokens: true,
      staleResumeRejected: true,
      pulseExecutionFrameStack: true,
      wasmCallStackCaptured: false,
      asyncAwait: false,
      promises: false,
      hiddenSuspension: false,
      cpuPreemptionV1: false,
      sleepFirstProofTarget: true,
      assetsAreNotV1EffectKind: true,
      assetsUseHostCapabilityAndFuturePayloadStreamingSurface: true,
      stackSwitchingWatchItem: true
    },
    summary: {
      effectKinds: EFFECT_KINDS.length,
      requiredEffectCapabilities: requiredEffectCapabilities.length,
      contextStates: CONTEXT_STATES.length,
      effectStates: EFFECT_STATES.length,
      stepResults: STEP_RESULTS.length,
      diagnostics: diagnostics.length,
      firstProofTarget: 'sleep',
      readyFor12A: diagnostics.length === 0,
      readyForEffectExecution: false,
      readyForFastly: false
    },
    requiredCapabilities,
    requiredEffectCapabilities,
    diagnostics
  }, cwd);

  const markdown = markdownForEffectRuntime(artifact, effectRuntimeContract, effectKindRegistry, effectResumeProtocol, effectTimeoutPolicy);

  return {
    artifact,
    effectRuntimeContract,
    effectKindRegistry,
    effectResumeProtocol,
    effectTimeoutPolicy,
    diagnostics,
    files: [
      { file: 'generated/host/effect-runtime.md', text: markdown }
    ]
  };
}

module.exports = {
  EFFECT_RUNTIME_VERSION,
  EFFECT_RUNTIME_CONTRACT_VERSION,
  EFFECT_KIND_REGISTRY_VERSION,
  EFFECT_RESUME_PROTOCOL_VERSION,
  EFFECT_TIMEOUT_POLICY_VERSION,
  EFFECT_KINDS,
  CONTEXT_STATES,
  EFFECT_STATES,
  STEP_RESULTS,
  DIAGNOSTICS,
  buildEffectRuntime,
  buildEffectRuntimeContract,
  buildEffectKindRegistry,
  buildEffectResumeProtocol,
  buildEffectTimeoutPolicy
};
