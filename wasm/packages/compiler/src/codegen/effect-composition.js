'use strict';

const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = require('../diagnostics.js');

const PHASE = '11G';
const EFFECT_COMPOSITION_VERSION = 'pulsewasm.effect-composition.v1';
const EFFECT_PLAN_CONTRACT_VERSION = 'pulsewasm.effect-plan-contract.v1';
const EFFECT_CONTINUATION_CONTRACT_VERSION = 'pulsewasm.effect-continuation-contract.v1';
const TIMEOUT_SCOPE_POLICY_VERSION = 'pulsewasm.timeout-scope-policy.v1';

const DEFAULT_TIMEOUTS = Object.freeze({
  defaultMs: 5000,
  hardMs: 30000,
  effectDefaultMs: 5000,
  schedulerResolutionMs: 10
});

const EFFECT_GROUP_STRATEGIES = Object.freeze({
  all: { status: 'allowed-v1', meaning: 'Resolve all named effects, then invoke the continuation handler.' },
  sequence: { status: 'reserved', meaning: 'Use named continuation handlers instead of implicit sequence graphs in v1.' },
  race: { status: 'reserved', meaning: 'Race/first-result composition is reserved.' }
});

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && Math.floor(number) === number ? number : fallback;
}

function runtimeTimeouts(resolvedConfig) {
  const runtime = resolvedConfig?.runtime || resolvedConfig?.config?.runtime || {};
  const timeouts = runtime && typeof runtime === 'object' && !Array.isArray(runtime) ? runtime.timeouts || {} : {};
  const hardMs = positiveInt(timeouts.hardMs, DEFAULT_TIMEOUTS.hardMs);
  return {
    defaultMs: Math.min(positiveInt(timeouts.defaultMs, DEFAULT_TIMEOUTS.defaultMs), hardMs),
    hardMs,
    effectDefaultMs: Math.min(positiveInt(timeouts.effectDefaultMs, DEFAULT_TIMEOUTS.effectDefaultMs), hardMs),
    schedulerResolutionMs: positiveInt(timeouts.schedulerResolutionMs, DEFAULT_TIMEOUTS.schedulerResolutionMs),
    source: timeouts && Object.keys(timeouts).length > 0 ? 'config' : 'pulse-default'
  };
}

function makeDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({
    phase: 'effect-composition',
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: { file: '<effect-composition>' }
  });
}

function scopeTimeoutSummary(executionPlan) {
  const scopes = Array.isArray(executionPlan?.scopes) ? executionPlan.scopes : [];
  const overrides = Array.isArray(executionPlan?.timeoutOverrides) ? executionPlan.timeoutOverrides : [];
  return {
    scopes: scopes.length,
    scopesWithTimeout: scopes.filter((scope) => scope.timeout).length,
    overrides: overrides.length,
    appDefault: executionPlan?.timeoutPolicy?.appDefault,
    overrideRouters: overrides.map((override) => ({
      router: override.router,
      routerPath: override.routerPath,
      timeout: override.timeout
    }))
  };
}

function buildTimeoutScopePolicy({ generatedBy, resolvedConfig, executionPlan }) {
  const appDefault = runtimeTimeouts(resolvedConfig);
  return normalizeArtifact({
    version: TIMEOUT_SCOPE_POLICY_VERSION,
    generatedBy,
    phase: PHASE,
    status: 'locked',
    policy: {
      defaultsLiveInConfig: true,
      pulseDefaultsWhenConfigOmitted: true,
      scopeOverridesAreStaticMetadata: true,
      timeoutIsNotMiddleware: true,
      handlersNormallyDoNotInstrumentTimeouts: true,
      hardDeadlineCannotBeExtended: true,
      scopeMayTightenButNotExceedAppHardDeadline: true,
      effectGroupTimeoutCappedByScopeHardDeadline: true,
      clockSource: 'monotonic',
      wallClockForDeadlines: false,
      cpuPreemptionV1: false
    },
    defaults: appDefault,
    inheritance: {
      order: ['app default', 'router scope override', 'mounted child scope', 'effect group timeout'],
      hardMsRule: 'effectiveHardMs = min(parentHardMs, scopeHardMs)',
      omittedValueRule: 'omitted values inherit from parent/app defaults'
    },
    runtimeErrors: {
      contextTimeout: { code: 'PULSEWASM_CONTEXT_TIMEOUT', statusCode: 504 },
      effectTimeout: { code: 'PULSEWASM_EFFECT_TIMEOUT', statusCode: 504 },
      requestTimeout: { code: 'PULSEWASM_REQUEST_TIMEOUT', statusCode: 408 },
      contractViolation: { code: 'PULSEWASM_NO_RESULT', statusCode: 500 },
      normalFallthrough: { statusCode: 404 }
    },
    executionPlan: scopeTimeoutSummary(executionPlan)
  }, process.cwd());
}

function buildEffectPlanContract({ generatedBy }) {
  return {
    version: EFFECT_PLAN_CONTRACT_VERSION,
    generatedBy,
    phase: PHASE,
    status: 'locked',
    model: {
      effectRefsOnly: true,
      resolveBoundaryRequired: true,
      effectGroupArtifact: 'effect-plan.json reserved for implementation phase',
      promises: false,
      asyncAwait: false,
      microScheduler: false,
      arbitraryCallbacks: false
    },
    allowedV1: {
      groupStrategy: 'all',
      failurePolicy: 'fail-fast',
      effectGroupShape: 'static object literal with string-literal keys',
      continuation: 'top-level named continuation handler',
      timeout: 'optional bounded timeoutMs, capped by current scope hard deadline',
      effects: [
        { kind: 'sleep', status: 'first-proof-target', surface: 'ctx.sleep(ms)' },
        { kind: 'backend-fetch', status: 'contracted-future', surface: 'ctx.fetch("backend", requestSpec)' },
        { kind: 'body-read', status: 'contracted-future', surface: 'ctx.bodyText() / ctx.bodyJson() reserved' }
      ]
    },
    explicitlyExcluded: {
      assets: {
        excludedFromV1EffectKinds: true,
        classification: 'host-capability/payload-streaming-surface',
        reason: 'Assets drag binary/streaming/cache/provider mechanics into the effect runtime too early.'
      }
    },
    rejectedV1: [
      'ctx.fetch(callback)',
      'Promise.then/catch/finally',
      'async/await',
      'dynamic effect names',
      'dynamic backend keys',
      'dynamic request builders',
      'helper-built effect groups',
      'loop-generated effects',
      'race/collect policies',
      'inline callbacks with closure capture',
      'arbitrary nested effect graphs'
    ],
    reserved: [
      'inline continuation lifting',
      'collect failure policy',
      'race',
      'dependent effect graph optimization',
      'template path lowering with ctx.param(...)',
      'effect-plan.json implementation artifact'
    ]
  };
}

function buildEffectContinuationContract({ generatedBy }) {
  return {
    version: EFFECT_CONTINUATION_CONTRACT_VERSION,
    generatedBy,
    phase: PHASE,
    status: 'locked',
    continuationModel: {
      namedContinuationHandlers: true,
      continuationHandlersUseHandlerEvalJail: true,
      continuationCapturesClosureState: false,
      continuationStoresResultsByName: true,
      effectResultAccess: ['ctx.resolved()', 'ctx.resolved("name")'],
      failurePolicyDefault: 'fail-fast'
    },
    abiReserved: {
      pulseEffectResult: 'pulse_effect_result(ctxRef, keyPtr, keyLen) -> EffectResultRef',
      pulseEffectError: 'reserved-after-Pass-30',
      pulseEffectHas: 'reserved-after-Pass-30'
    },
    staleResume: {
      generationChecked: true,
      contextMustExist: true,
      effectMustBePending: true,
      contextMustNotBeExpiredOrCleaned: true,
      diagnostic: 'PULSEWASM_STALE_EFFECT_RESUME'
    }
  };
}

function markdownForEffectComposition(artifact, effectPlanContract, continuationContract, timeoutScopePolicy) {
  const lines = [];
  lines.push('# PulseWasm Phase 11G Effect Composition + Timeout Scope Contract');
  lines.push('');
  lines.push('## Status');
  lines.push('Locked as a contract/artifact phase. No effect execution or compiled handler lowering is implemented here.');
  lines.push('');
  lines.push('## Core Rules');
  lines.push('- `ctx.fetch(...)`, `ctx.sleep(...)`, and future body reads create effect refs; they do not perform work immediately.');
  lines.push('- `ctx.resolve({ name: effectRef }, continuationHandler)` submits the effect group and defines the explicit continuation.');
  lines.push('- `sleep` is the first proof target.');
  lines.push('- assets are not a v1 core effect kind; they remain a host capability and future payload/streaming surface.');
  lines.push('- timeouts are app defaults plus static router-scope metadata overrides.');
  lines.push('');
  lines.push('## Summary');
  lines.push(`- allowed effect group strategy: ${artifact.summary.allowedStrategies.join(', ')}`);
  lines.push(`- reserved strategies: ${artifact.summary.reservedStrategies.join(', ')}`);
  lines.push(`- timeout scopes: ${timeoutScopePolicy.executionPlan.scopes}`);
  lines.push(`- timeout overrides: ${timeoutScopePolicy.executionPlan.overrides}`);
  lines.push(`- diagnostics: ${artifact.summary.diagnostics}`);
  lines.push('');
  lines.push('## Allowed v1 Shape');
  lines.push('');
  lines.push('```ts');
  lines.push('function handler(ctx, next) {');
  lines.push('  return ctx.resolve({');
  lines.push('    wake: ctx.sleep(25)');
  lines.push('  }, afterWake)');
  lines.push('}');
  lines.push('');
  lines.push('function afterWake(ctx, next) {');
  lines.push('  const wake = ctx.resolved("wake")');
  lines.push('  return ctx.result.text(200, wake.text())');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('## Rejected v1');
  lines.push('');
  for (const rejected of effectPlanContract.rejectedV1) lines.push(`- ${rejected}`);
  lines.push('');
  lines.push('## Timeout Scope');
  lines.push('');
  lines.push(`- defaultMs: ${timeoutScopePolicy.defaults.defaultMs}`);
  lines.push(`- hardMs: ${timeoutScopePolicy.defaults.hardMs}`);
  lines.push(`- effectDefaultMs: ${timeoutScopePolicy.defaults.effectDefaultMs}`);
  lines.push(`- schedulerResolutionMs: ${timeoutScopePolicy.defaults.schedulerResolutionMs}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildEffectComposition(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const diagnostics = [];
  const effectPlanContract = normalizeArtifact(buildEffectPlanContract({ generatedBy }), cwd);
  const effectContinuationContract = normalizeArtifact(buildEffectContinuationContract({ generatedBy }), cwd);
  const timeoutScopePolicy = normalizeArtifact(buildTimeoutScopePolicy({ generatedBy, resolvedConfig: inputs.resolvedConfig, executionPlan: inputs.executionPlan }), cwd);

  const allowedStrategies = Object.entries(EFFECT_GROUP_STRATEGIES).filter(([, value]) => value.status === 'allowed-v1').map(([key]) => key);
  const reservedStrategies = Object.entries(EFFECT_GROUP_STRATEGIES).filter(([, value]) => value.status !== 'allowed-v1').map(([key]) => key);
  const effectKinds = effectPlanContract.allowedV1.effects.map((effect) => effect.kind);

  if (effectKinds.includes('asset-read')) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_ASSET_EFFECT_KIND_FORBIDDEN',
      'Assets must not be registered as a v1 core effect kind.',
      'Treat assets as a reserved host capability/payload streaming surface instead.',
      { effectKinds }
    ));
  }

  const artifact = normalizeArtifact({
    version: EFFECT_COMPOSITION_VERSION,
    generatedBy,
    phase: PHASE,
    status: diagnostics.length === 0 ? 'ok' : 'error',
    scope: {
      contractOnly: true,
      runtimeBehaviorChanged: false,
      effectExecutionImplemented: false,
      compiledHandlerLoweringImplemented: false,
      routerTimeoutExtractionImplemented: true,
      executionPlanTimeoutMetadataImplemented: true
    },
    policy: {
      effectRefsDeclaredNotExecuted: true,
      resolveBoundaryRequired: true,
      explicitContinuations: true,
      namedContinuationHandlers: true,
      noPromises: true,
      noAsyncAwait: true,
      noMicroScheduler: true,
      noCallbackInFetch: true,
      failurePolicy: 'fail-fast',
      assetsExcludedFromV1EffectKinds: true,
      assetsReservedForHostCapabilityAndPayloadStreaming: true,
      timeoutsFromMetadata: true
    },
    effectGroupStrategies: EFFECT_GROUP_STRATEGIES,
    summary: {
      allowedStrategies,
      reservedStrategies,
      effectKinds,
      firstProofTarget: 'sleep',
      timeoutScopes: timeoutScopePolicy.executionPlan.scopes,
      timeoutOverrides: timeoutScopePolicy.executionPlan.overrides,
      diagnostics: diagnostics.length,
      readyFor12A: diagnostics.length === 0,
      readyForEffectExecution: false,
      readyForFastly: false
    },
    diagnostics
  }, cwd);

  const markdown = markdownForEffectComposition(artifact, effectPlanContract, effectContinuationContract, timeoutScopePolicy);
  return {
    artifact,
    effectPlanContract,
    effectContinuationContract,
    timeoutScopePolicy,
    diagnostics,
    files: [{ file: 'generated/host/effect-composition.md', text: markdown }]
  };
}

module.exports = {
  PHASE,
  EFFECT_COMPOSITION_VERSION,
  EFFECT_PLAN_CONTRACT_VERSION,
  EFFECT_CONTINUATION_CONTRACT_VERSION,
  TIMEOUT_SCOPE_POLICY_VERSION,
  EFFECT_GROUP_STRATEGIES,
  DEFAULT_TIMEOUTS,
  buildEffectComposition,
  buildEffectPlanContract,
  buildEffectContinuationContract,
  buildTimeoutScopePolicy
};
