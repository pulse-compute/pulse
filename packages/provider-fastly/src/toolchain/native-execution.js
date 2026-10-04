'use strict';

const { inspectFastlyCanonicalTarget } = require('../build/canonical-target.js');
const { executeFastlyNativePlatformCapabilities } = require('../testing/native-platform-capabilities-host.js');
const { createConditionalKvAuthority } = require('../testing/conditional-kv-host.js');

// Execute the provider artifact against the existing fixture ABI. This is local
// conformance evidence, never Viceroy or deployed Fastly acceptance.
function prepareFastlyNativeExecution(invocation) {
  const bindings = invocation.providerConfig.bindings;
  const { native } = inspectFastlyCanonicalTarget({
    plan: invocation.applicationPlan,
    providerConfig: invocation.providerConfig,
    projectRoot: invocation.project.root,
    profile: invocation.project.profile,
    targetDescriptor: invocation.selectedTarget,
    synchronizedPackages: invocation.synchronizedPackages,
    realizationArtifacts: invocation.nativeArtifact.realizationArtifacts,
    guestUnits: invocation.nativeArtifact.guestUnits,
    nativeOptimization: invocation.optimization,
    emitWat: invocation.nativeArtifact.manifest.wat?.emitted === true,
    compileTimeoutMs: invocation.timeoutMs || undefined
  });
  const evidence = Object.freeze({
    kind: 'fastly-native-fixture-abi',
    provider: 'fastly',
    target: 'fastly-compute-native',
    wasmSha256: native.manifest.wasm.sha256,
    providerRealityValidated: false,
    effectObservations: 'unavailable'
  });
  return (options = {}) => {
    if (options.liveFetch === true) throw new TypeError('Fastly Native fixture execution cannot perform live fetches.');
    const kvStores = {};
    for (const [logical, physical] of Object.entries(bindings.kv || {})) {
      kvStores[physical] = { ...kvStores[physical], ...(options.kv && options.kv[logical] || {}) };
    }
    const authority = createConditionalKvAuthority();
    for (const [store, values] of Object.entries(kvStores)) {
      authority.stores.set(store, new Map());
      for (const [key, value] of Object.entries(values)) {
        authority.seed(store, key, Buffer.from(JSON.stringify({ __pulseKv: 1, value })));
      }
    }
    const execution = executeFastlyNativePlatformCapabilities(native, {
      request: options.request,
      fixtures: options.fetches,
      configStore: bindings.configStore,
      config: options.config,
      secretStore: bindings.secretStore,
      secrets: options.secrets,
      kvStores,
      conditionalKv: { authority }
    });
    const contentType = execution.response.headers.find(([name]) => name.toLowerCase() === 'content-type');
    const type = String(contentType && contentType[1] || '').toLowerCase();
    return Object.freeze({
      response: Object.freeze({
        ...execution.response,
        kind: type.includes('application/json') || type.includes('+json') ? 'json' : type.startsWith('text/') ? 'text' : 'response',
        bodyClass: execution.response.origin === true ? 'opaque' : 'structured'
      }),
      // The fixture ABI has hostcall traces, not canonical continuation telemetry.
      effectCount: null,
      continuations: Object.freeze([]),
      resolutionOrder: Object.freeze([]),
      evidence
    });
  };
}

module.exports = { prepareFastlyNativeExecution };
