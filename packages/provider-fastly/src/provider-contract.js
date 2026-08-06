'use strict';

const canonical = require('@pulse-compute/wasm-contracts/provider/canonical-provider');
const packageManifest = require('../package.json');

const FASTLY_PROVIDER_DESCRIPTOR = canonical.normalizeDescriptor({
  id: 'fastly',
  package: '@pulse-compute/provider-fastly',
  providerVersion: packageManifest.version,
  runtime: 'pulse.canonical-fastly-runtime.v2',
  buildTarget: 'fastly-compute',
  deployable: true,
  localExecution: true,
  capabilities: [
    'request', 'response.json', 'response.text', 'response.custom', 'fetch',
    'config.get', 'secret.get', 'kv.get', 'kv.put', 'assets.lookup',
    'grip.channel', 'grip.hold', 'grip.publish', 'grip.broadcast', 'jwt.verify',
    'opaque.pass-through'
  ],
  lowering: {
    request: 'fastly.compute.request',
    'response.json': 'fastly.compute.response.json',
    'response.text': 'fastly.compute.response.text',
    'response.custom': 'fastly.compute.response.custom',
    fetch: 'fastly.backend.fetch',
    'config.get': 'fastly.config-store.get',
    'secret.get': 'fastly.secret-store.get',
    'kv.get': 'fastly.kv-store.get',
    'kv.put': 'fastly.kv-store.put',
    'assets.lookup': 'fastly.kv-store.assets.lookup',
    'grip.channel': 'fastly.fanout.channel',
    'grip.hold': 'fastly.fanout.hold',
    'grip.publish': 'fastly.fanout.publish',
    'grip.broadcast': 'fastly.grip.publish-control',
    'jwt.verify': 'fastly.native.jwt.verify',
    'opaque.pass-through': 'fastly.response-body.stream'
  }
});

function validateStaticBackendBindings(metadata = {}, bindings = {}) {
  if (bindings.dynamicBackends === true) return;
  const configured = bindings.backends && typeof bindings.backends === 'object' ? bindings.backends : {};
  for (const operation of metadata.providerOperations || []) {
    if (!operation || operation.kind !== 'fetch') continue;
    const origin = operation.resource && operation.resource.origin;
    if (!origin || configured[origin]) continue;
    const error = new Error(`No Fastly backend binding is configured for ${origin}.`);
    error.name = 'CanonicalProviderContractError';
    error.code = 'PULSE_FASTLY_BACKEND_REQUIRED';
    error.detail = Object.freeze({ origin, effectId: operation.id, dynamicBackends: false });
    throw error;
  }
}

function createFastlyLoweringPlan(metadata, bindings = {}) {
  validateStaticBackendBindings(metadata, bindings);
  return canonical.createProviderLoweringPlan(metadata, FASTLY_PROVIDER_DESCRIPTOR, {
    ...bindings,
    grip: bindings.grip || 'fastly-fanout'
  });
}

function assertFastlySupports(metadata) {
  return canonical.assertProviderSupports(metadata, FASTLY_PROVIDER_DESCRIPTOR);
}

module.exports = Object.freeze({
  FASTLY_PROVIDER_DESCRIPTOR,
  createFastlyLoweringPlan,
  validateStaticBackendBindings,
  assertFastlySupports
});
