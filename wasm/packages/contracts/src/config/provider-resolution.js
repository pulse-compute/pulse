'use strict';

const {
  plainObject,
  hasOwn,
  platformFastly,
  collectRefs,
  collectSymbolicRefs,
  isSymbolicRef,
  refKind,
  refKey
} = require('./symbolic-refs.js');

const CONFIG_PROVIDER_RESOLUTION_PHASE = '13D';
const CONFIG_PROVIDER_CONTRACT_VERSION = 'pulsewasm.config-provider-contract.v1';
const RUNTIME_PROVIDER_RESOLUTION_VERSION = 'pulsewasm.runtime-provider-resolution.v1';
const FASTLY_PROVIDER_MAP_VERSION = 'pulsewasm.fastly-provider-map.v1';
const CONFIG_PROVIDER_SMOKE_VERSION = 'pulsewasm.config-provider-smoke.v1';

const CONFIG_PROVIDER_SURFACE = Object.freeze({
  config: 'get(name): string | undefined',
  secret: 'get(name): string | undefined'
});
const RUNTIME_CONFIG_PROVIDER_SURFACE = CONFIG_PROVIDER_SURFACE;

const CONFIG_PROVIDER_POLICY = Object.freeze({
  runtimeResolved: true,
  secretsCompiledIntoBinary: false,
  fastlyStoresAreProviders: true,
  localProvidersSupported: true,
  envHelperRequired: false
});

module.exports = {
  CONFIG_PROVIDER_RESOLUTION_PHASE,
  CONFIG_PROVIDER_CONTRACT_VERSION,
  RUNTIME_PROVIDER_RESOLUTION_VERSION,
  FASTLY_PROVIDER_MAP_VERSION,
  CONFIG_PROVIDER_SMOKE_VERSION,
  CONTRACT_VERSION: CONFIG_PROVIDER_CONTRACT_VERSION,
  RESOLUTION_VERSION: RUNTIME_PROVIDER_RESOLUTION_VERSION,
  SMOKE_VERSION: CONFIG_PROVIDER_SMOKE_VERSION,
  CONFIG_PROVIDER_SURFACE,
  RUNTIME_CONFIG_PROVIDER_SURFACE,
  CONFIG_PROVIDER_POLICY,
  plainObject,
  hasOwn,
  platformFastly,
  collectRefs,
  collectSymbolicRefs,
  isSymbolicRef,
  refKind,
  refKey
};
