'use strict';

const RUNTIME_PULSE_LIVE_CONTRACT_VERSION = 'pulse.runtime-pulse-live-contract.v4';

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
}

const ROOT_VALUE_EXPORTS = freeze({
  '@pulse-compute/runtime': ['RUNTIME_API_VERSION', 'ROUTER_API_VERSION', 'Router'],
  '@pulse-compute/pulse': ['defineConfig', 'Pulse', 'PULSE_APPLICATION_API_VERSION']
});

const LIVE_RUNTIME_SURFACES = freeze([
  { id: 'router.registration', status: 'implemented', authority: 'historical TypeScript semantics adapted to Router IR ordering' },
  { id: 'router.paths-params-mounts', status: 'implemented', authority: 'sealed path grammar and Router IR' },
  { id: 'router.terminal-transfer', status: 'implemented', authority: 'forward-only next()/next(error) contract' },
  { id: 'router.error-recovery', status: 'implemented', authority: 'normal/error lane and forward cursor contract' },
  { id: 'router.default-404-500', status: 'implemented', authority: 'Router-owned response contract' },
  { id: 'context.request-metadata', status: 'implemented', authority: 'PulseRequest TypeScript contract' },
  { id: 'context.route-param', status: 'implemented', authority: 'PulseRouteContext TypeScript contract' },
  { id: 'context.request-state', status: 'implemented', authority: 'request-local string map contract' },
  { id: 'context.response-helpers', status: 'implemented', authority: 'Pulse result and response contracts' },
  { id: 'context.effects', status: 'implemented-adapter-boundary', authority: 'PulseEffect TypeScript contract; provider realization remains external' },
  { id: 'runtime.web-request-response', status: 'implemented-internal', authority: 'historical Web boundary adapted to current result algebra' },
  { id: 'pulse.application-root', status: 'implemented', authority: 'Pulse extends the live Router implementation and shares Router IR' },
  { id: 'pulse.event-registration', status: 'implemented-static-and-javascript-direct', authority: 'root Pulse-owned exact registration table, static compiler catalog, and transport-free JavaScript host execution' },
  { id: 'runtime.event-execution', status: 'implemented-node-javascript-direct', authority: 'canonical event frame normalization, schema validation, exact selection, isolated context, and data-only completion result' },
  { id: 'context.event-emit', status: 'implemented-node-javascript-direct', authority: 'schema-bound execution-owned event.emit effect with bounded host acceptance and no automatic loopback' },
  { id: 'runtime.event-recording-adapter', status: 'implemented-reference-only', authority: 'bounded deterministic accepted-frame evidence without provider transport or local handler dispatch' },
  { id: 'pulse.profile-token', status: 'implemented', authority: 'opaque stable token owned by one Pulse instance' },
  { id: 'pulse.deferred-config', status: 'implemented-preserved', authority: 'symbolic defineConfig factory; no runtime evaluation' }
]);

const SUPERSEDED_OR_DEFERRED = freeze([
  'recursive or onion next()',
  'authored throw as supported application control flow',
  'implicit handler fallthrough',
  'Router/Pulse bind, handle, listen, or serve on the public root surface',
  'dynamic context decoration',
  'raw host access',
  'ambient environment/profile resolution',
  'nested profiles and readable active profile state',
  'generic session/gateway core',
  'Native and provider-integrated event handler execution',
  'Native/provider event emit realization, channels, and local loopback',
  'public normalized semantic trace',
  'public JavaScript execution target',
  'compiler or lowerer plugin registration'
]);

function defaultRuntimePulseLiveContract() {
  return freeze({
    version: RUNTIME_PULSE_LIVE_CONTRACT_VERSION,
    internalRuntimeVersion: 'pulse.javascript-router-runtime.v1',
    internalEventRuntimeVersion: 'pulse.javascript-event-runtime.v2',
    internalApplicationVersion: 'pulse.javascript-application.v1',
    rootValueExports: ROOT_VALUE_EXPORTS,
    surfaces: LIVE_RUNTIME_SURFACES,
    supersededOrDeferred: SUPERSEDED_OR_DEFERRED,
    policies: {
      publicRootExportsChanged: false,
      rootHandleOrLifecyclePublished: false,
      executionIsPackageInternal: true,
      pulseSharesRouterImplementation: true,
      pulseOwnsEventRegistration: true,
      routerEventRegistration: false,
      eventHandlersExecuted: true,
      eventExecutionTarget: 'node-javascript-direct',
      eventEmitPublished: true,
      eventEmitTarget: 'node-javascript-direct',
      eventEmitParallelEligible: true,
      eventEmitAutomaticLoopback: false,
      providerCapabilitiesInjected: true,
      terminalTransferUsesBrandedInternalValue: true,
      unexpectedFailuresContained: true,
      requestStateIsolatedPerRequest: true,
      eventStateIsolatedPerInvocation: true,
      arbitraryObjectState: false,
      dynamicContextDecoration: false,
      rawHostAccess: false,
      publicJavascriptTargetShipped: false,
      handlerIrChanged: false,
      routerIrChanged: false,
      effectOrContinuationContractChanged: true,
      packageLoweringSeamChanged: false,
      providerRequirementContractChanged: false
    }
  });
}

module.exports = {
  RUNTIME_PULSE_LIVE_CONTRACT_VERSION,
  ROOT_VALUE_EXPORTS,
  LIVE_RUNTIME_SURFACES,
  SUPERSEDED_OR_DEFERRED,
  defaultRuntimePulseLiveContract
};
