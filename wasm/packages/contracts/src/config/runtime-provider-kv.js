'use strict';

const {
  CONFIG_AUTHORING_SHAPE_VERSION,
  PLATFORM_STORE_MAP_VERSION
} = require('./symbolic-refs.js');

const RUNTIME_PROVIDER_KV_PHASE = '14B';
const KV_ADAPTER_INTEGRATION_PHASE = '14C';
const KV_ADAPTER_PHASE = KV_ADAPTER_INTEGRATION_PHASE;

const RUNTIME_PROVIDER_CONTRACT_VERSION = 'pulsewasm.runtime-provider-contract.v1';
const RUNTIME_PROVIDER_KV_RESOLUTION_VERSION = 'pulsewasm.runtime-provider-kv-resolution.v1';
const KV_CAPABILITY_CONTRACT_VERSION = 'pulsewasm.kv-capability-contract.v1';
const KV_PROVIDER_MAP_VERSION = 'pulsewasm.kv-provider-map.v1';
const RUNTIME_PROVIDER_API_SURFACE_VERSION = 'pulsewasm.runtime-provider-api-surface.v1';
const RUNTIME_PROVIDER_SMOKE_VERSION = 'pulsewasm.runtime-provider-smoke.v1';
const KV_ADAPTER_INTEGRATION_VERSION = 'pulsewasm.kv-adapter-integration.v1';
const KV_PROVIDER_RUNTIME_MAP_VERSION = 'pulsewasm.kv-provider-runtime-map.v1';

const RUNTIME_PROVIDER_AUTHORING_SHAPE = 'runtime.provider';
const RUNTIME_PROVIDER_DEFAULT_POLICY = 'one provider per profile';
const RUNTIME_PROVIDER_KINDS = Object.freeze(['fastly', 'local', 'node']);

const KV_CAPABILITY_POLICY = Object.freeze({
  handlerSurface: 'ctx.kv(name)',
  compiledHandlerLowering: 'reserved',
  hostEffectExecution: 'reserved',
  localAdapterProof: 'phase14C',
  reservedExecution: 'reserved-effect'
});

const KV_HANDLER_SURFACE = KV_CAPABILITY_POLICY.handlerSurface;
const KV_COMPILED_HANDLER_LOWERING = KV_CAPABILITY_POLICY.compiledHandlerLowering;
const KV_HOST_EFFECT_EXECUTION = KV_CAPABILITY_POLICY.hostEffectExecution;
const KV_LOCAL_ADAPTER_PROOF = KV_CAPABILITY_POLICY.localAdapterProof;
const KV_RESERVED_EXECUTION = KV_CAPABILITY_POLICY.reservedExecution;

const RUNTIME_PROVIDER_API_SURFACES = Object.freeze([
  Object.freeze({ name: 'runtime.provider', scope: 'config', status: 'canonical' }),
  Object.freeze({ name: 'ctx.kv(name)', scope: 'handler', status: 'reserved for compiled-handler lowering; available in local adapter proof' })
]);

function runtimeProviderApiSurfaces() {
  return RUNTIME_PROVIDER_API_SURFACES.map((surface) => ({ ...surface }));
}

module.exports = {
  RUNTIME_PROVIDER_KV_PHASE,
  KV_ADAPTER_PHASE,
  KV_ADAPTER_INTEGRATION_PHASE,
  RUNTIME_PROVIDER_CONTRACT_VERSION,
  RUNTIME_PROVIDER_KV_RESOLUTION_VERSION,
  CONFIG_AUTHORING_SHAPE_VERSION,
  PLATFORM_STORE_MAP_VERSION,
  KV_CAPABILITY_CONTRACT_VERSION,
  KV_PROVIDER_MAP_VERSION,
  RUNTIME_PROVIDER_API_SURFACE_VERSION,
  RUNTIME_PROVIDER_SMOKE_VERSION,
  KV_ADAPTER_INTEGRATION_VERSION,
  KV_PROVIDER_RUNTIME_MAP_VERSION,
  RUNTIME_PROVIDER_AUTHORING_SHAPE,
  RUNTIME_PROVIDER_DEFAULT_POLICY,
  RUNTIME_PROVIDER_KINDS,
  KV_HANDLER_SURFACE,
  KV_COMPILED_HANDLER_LOWERING,
  KV_HOST_EFFECT_EXECUTION,
  KV_LOCAL_ADAPTER_PROOF,
  KV_RESERVED_EXECUTION,
  KV_CAPABILITY_POLICY,
  RUNTIME_PROVIDER_API_SURFACES,
  runtimeProviderApiSurfaces
};
