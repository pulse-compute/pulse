'use strict';

const HOST_CAPABILITIES_VERSION = 'pulsewasm.host-capabilities.v1';
const WASI_PROVIDER_MAP_VERSION = 'pulsewasm.wasi-provider-map.v1';
const CAPABILITY_PROVIDER_REPORT_VERSION = 'pulsewasm.capability-provider-report.v1';
const HOST_CAPABILITY_CONTRACT_VERSION = 'pulsewasm.host-capability-contract.v1';

const CAPABILITY_DEFINITIONS = [
  {
    capability: 'headers',
    category: 'request-result',
    status: 'implemented',
    provider: { kind: 'host-runtime', name: 'pulse-host-headers' },
    effectRuntimeRequired: false,
    publicHandlerSurface: true,
    notes: 'Ordered multi-value request/response headers are already exposed through the host ABI.'
  },
  {
    capability: 'result',
    category: 'request-result',
    status: 'implemented',
    provider: { kind: 'host-runtime', name: 'pulse-result-builders' },
    effectRuntimeRequired: false,
    publicHandlerSurface: true,
    notes: 'Text, JSON text, and empty result builders are available; binary remains reserved.'
  },
  {
    capability: 'params',
    category: 'routing',
    status: 'implemented',
    provider: { kind: 'routing-core', name: 'pulse-params-view' },
    effectRuntimeRequired: false,
    publicHandlerSurface: true,
    notes: 'Params are backed by compiled path metadata and request-path slices.'
  },
  {
    capability: 'state',
    category: 'runtime',
    status: 'implemented-proof',
    provider: { kind: 'host-runtime', name: 'pulse-state-adapter' },
    effectRuntimeRequired: false,
    publicHandlerSurface: true,
    notes: 'Node/local proof uses a Map-backed state adapter; production storage remains replaceable.'
  },
  {
    capability: 'error',
    category: 'runtime',
    status: 'implemented',
    provider: { kind: 'host-runtime', name: 'pulse-error-refs' },
    effectRuntimeRequired: false,
    publicHandlerSurface: true,
    notes: 'Structured error refs with code, message, statusCode, and optional cause.'
  },
  {
    capability: 'lifecycle',
    category: 'runtime',
    status: 'implemented',
    provider: { kind: 'execution-plan', name: 'pulse-lifecycle-dispatch' },
    effectRuntimeRequired: false,
    publicHandlerSurface: true,
    notes: 'Connect/disconnect lifecycle hooks are explicit host runtime entrypoints.'
  },
  {
    capability: 'channel',
    category: 'routing-control',
    status: 'implemented',
    provider: { kind: 'routing-core', name: 'pulse-channel-resolution' },
    effectRuntimeRequired: false,
    publicHandlerSurface: true,
    notes: 'Static and handler-produced channels normalize to an ordered channel list surface.'
  },
  {
    capability: 'broadcaster',
    category: 'routing-control',
    status: 'implemented-proof',
    provider: { kind: 'host-adapter', name: 'pulse-broadcaster-adaptor' },
    effectRuntimeRequired: false,
    publicHandlerSurface: false,
    notes: 'Broadcaster is an injected host adapter. Missing broadcaster fails explicitly when channels resolve.'
  },
  {
    capability: 'body',
    category: 'payload',
    status: 'contract-implemented-lazy-text',
    provider: { kind: 'host-runtime', name: 'pulse-body-adaptor' },
    effectRuntimeRequired: false,
    publicHandlerSurface: true,
    notes: 'Body access is explicit and lazy. Streaming/binary body is reserved.'
  },
  {
    capability: 'json',
    category: 'payload',
    status: 'contract-implemented-generic-default',
    provider: { kind: 'payload-runtime', name: 'pulse-json-adaptor' },
    effectRuntimeRequired: false,
    publicHandlerSurface: true,
    notes: 'Generic JSON is the ergonomic default; schema JSON sidecars are a future optimization lane.'
  },
  {
    capability: 'clock',
    category: 'time',
    status: 'provider-mapped-not-wired',
    provider: { kind: 'wasi-provider', name: 'wasi:clocks', role: 'preferred monotonic deadline/sleep provider' },
    providerFallback: { kind: 'host-adapter', name: 'pulse-host-clock', role: 'Node/local proof fallback until WASI/component wiring exists' },
    effectRuntimeRequired: false,
    publicHandlerSurface: false,
    notes: 'Pulse exposes clock/deadline capability; WASI is a provider, not app ergonomics.'
  },
  {
    capability: 'assets',
    category: 'resource',
    status: 'reserved-host-capability-payload-streaming-required',
    provider: { kind: 'host-adapter', name: 'pulse-assets-provider' },
    providerCandidates: [
      { kind: 'host-adapter', name: 'static-file-provider' },
      { kind: 'host-adapter', name: 'object-store-provider' }
    ],
    effectRuntimeRequired: false,
    publicHandlerSurface: true,
    notes: 'Assets are a reserved host capability/adaptor surface. They are not a v1 core effect kind; streaming/binary payload mechanics remain a future payload ABI.'
  },
  {
    capability: 'backend-fetch',
    category: 'network-effect',
    status: 'reserved-effect-runtime-required',
    provider: { kind: 'host-effect', name: 'pulse-backend-fetch-effect' },
    providerCandidates: [
      { kind: 'host-adapter', name: 'declared-backend-http-client' },
      { kind: 'wasi-provider', name: 'wasi:http', role: 'candidate provider once component/HTTP wiring is explicit' }
    ],
    effectRuntimeRequired: true,
    publicHandlerSurface: true,
    notes: 'ctx.fetch is declared and visible, but Wasm execution awaits the effect runtime.'
  },
  {
    capability: 'timer',
    category: 'time-effect',
    status: 'reserved-effect-runtime-required',
    provider: { kind: 'wasi-provider', name: 'wasi:clocks', role: 'preferred monotonic sleep/deadline provider' },
    providerFallback: { kind: 'host-adapter', name: 'pulse-host-scheduler' },
    effectRuntimeRequired: true,
    publicHandlerSurface: true,
    notes: 'Sleep/timeouts are explicit effects, not language async.'
  }
];

const PROVIDER_DEFINITIONS = [
  {
    id: 'pulse-host-headers',
    kind: 'host-runtime',
    capabilities: ['headers'],
    status: 'implemented',
    publicAppApi: false
  },
  {
    id: 'pulse-result-builders',
    kind: 'host-runtime',
    capabilities: ['result'],
    status: 'implemented',
    publicAppApi: false
  },
  {
    id: 'pulse-params-view',
    kind: 'routing-core',
    capabilities: ['params'],
    status: 'implemented',
    publicAppApi: false
  },
  {
    id: 'pulse-state-adapter',
    kind: 'host-runtime',
    capabilities: ['state'],
    status: 'implemented-proof',
    publicAppApi: false
  },
  {
    id: 'pulse-error-refs',
    kind: 'host-runtime',
    capabilities: ['error'],
    status: 'implemented',
    publicAppApi: false
  },
  {
    id: 'pulse-lifecycle-dispatch',
    kind: 'execution-plan',
    capabilities: ['lifecycle'],
    status: 'implemented',
    publicAppApi: false
  },
  {
    id: 'pulse-channel-resolution',
    kind: 'routing-core',
    capabilities: ['channel'],
    status: 'implemented',
    publicAppApi: false
  },
  {
    id: 'pulse-broadcaster-adaptor',
    kind: 'host-adapter',
    capabilities: ['broadcaster'],
    status: 'implemented-proof',
    publicAppApi: false
  },
  {
    id: 'pulse-body-adaptor',
    kind: 'host-runtime',
    capabilities: ['body'],
    status: 'contract-implemented-lazy-text',
    publicAppApi: false
  },
  {
    id: 'pulse-json-adaptor',
    kind: 'payload-runtime',
    capabilities: ['json'],
    status: 'contract-implemented-generic-default',
    publicAppApi: false
  },
  {
    id: 'wasi:clocks',
    kind: 'wasi-provider',
    capabilities: ['clock', 'timer'],
    status: 'mapped-not-wired',
    publicAppApi: false,
    role: 'monotonic deadlines/sleep provider; wall-clock only for timestamps if explicitly needed'
  },
  {
    id: 'pulse-assets-provider',
    kind: 'host-adapter',
    capabilities: ['assets'],
    status: 'reserved-host-capability-payload-streaming-required',
    publicAppApi: false
  },
  {
    id: 'pulse-backend-fetch-effect',
    kind: 'host-effect',
    capabilities: ['backend-fetch'],
    status: 'reserved-effect-runtime-required',
    publicAppApi: false
  },
  {
    id: 'wasi:http',
    kind: 'wasi-provider-candidate',
    capabilities: ['backend-fetch', 'body'],
    status: 'candidate-only-not-default',
    publicAppApi: false,
    role: 'future provider candidate; not a handler-facing API and not wired in Phase 11E'
  }
];

function knownHostCapabilities() {
  return CAPABILITY_DEFINITIONS.map((capability) => capability.capability).sort();
}

function isKnownHostCapability(name) {
  return knownHostCapabilities().includes(name);
}

function providerForCapability(name) {
  const capability = CAPABILITY_DEFINITIONS.find((entry) => entry.capability === name);
  return capability && capability.provider ? capability.provider : null;
}

module.exports = {
  HOST_CAPABILITIES_VERSION,
  WASI_PROVIDER_MAP_VERSION,
  CAPABILITY_PROVIDER_REPORT_VERSION,
  HOST_CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_DEFINITIONS,
  PROVIDER_DEFINITIONS,
  knownHostCapabilities,
  isKnownHostCapability,
  providerForCapability
};
