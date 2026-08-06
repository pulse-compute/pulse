'use strict';

const {
  LOWERABLE_LIBRARY_PAYLOAD_MODE_STATUSES
} = require('../library/manifest.js');

const ASSETS_CONTRACT_VERSION = 'pulsewasm.assets-contract.v1';
const ASSETS_HOST_ABI_VERSION = 'pulsewasm.assets-host-abi.v1';
const ASSETS_PROVIDER_CONFIG_VERSION = 'pulsewasm.assets-provider-config.v1';
const ASSETS_LOOKUP_RESULT_VERSION = 'pulsewasm.assets-lookup-result.v1';
const ASSETS_RESPONSE_POLICY_VERSION = 'pulsewasm.assets-response-policy.v1';
const ASSETS_LOWERING_PLAN_VERSION = 'pulsewasm.assets-lowering-plan.v1';
const ASSETS_ARTIFACT_VERSION = 'pulsewasm.assets-artifact.v1';
const ASSETS_NODE_PROVIDER_RUNTIME_VERSION = 'pulsewasm.assets-node-provider-runtime.v1';
const ASSETS_NODE_PROVIDER_PROOF_VERSION = 'pulsewasm.assets-node-provider-proof.v1';
const ASSETS_NODE_COMPILED_WASM_LIFECYCLE_RUNTIME_VERSION = 'pulsewasm.assets-node-compiled-wasm-lifecycle-runtime.v1';
const ASSETS_NODE_COMPILED_WASM_LIFECYCLE_PROOF_VERSION = 'pulsewasm.node-compiled-wasm-assets-lifecycle-proof.v1';
const ASSETS_NODE_COMPILED_WASM_LIFECYCLE_PROOF_ARTIFACT = 'node-compiled-wasm-assets-lifecycle-proof.json';
const ASSETS_FASTLY_PROVIDER_RUNTIME_VERSION = 'pulsewasm.assets-fastly-provider-runtime.v1';
const ASSETS_FASTLY_PROVIDER_PROOF_VERSION = 'pulsewasm.assets-fastly-provider-proof.v1';
const ASSETS_FASTLY_PACKAGE_OUT_PARITY_PROOF_VERSION = 'pulsewasm.fastly-assets-package-out-parity-proof.v1';
const ASSETS_FASTLY_PACKAGE_OUT_PARITY_PROOF_ARTIFACT = 'fastly-assets-package-out-parity-proof.json';
const ASSETS_PACKAGE_OWNED_LOWERING_PROOF_VERSION = 'pulsewasm.assets-package-owned-lowering-proof.v1';
const ASSETS_PACKAGE_OWNED_LOWERING_PROOF_ARTIFACT = 'assets-package-owned-lowering-proof.json';
const ASSETS_PACKAGE_OUT_DISCOVERY_PROOF_VERSION = 'pulsewasm.assets-package-out-discovery-proof.v1';
const ASSETS_PACKAGE_OUT_DISCOVERY_PROOF_ARTIFACT = 'assets-package-out-discovery-proof.json';
const ASSETS_COMPILED_WASM_SIDECAR_PLAN_VERSION = 'pulsewasm.assets-compiled-wasm-sidecar-plan.v1';
const ASSETS_COMPILED_WASM_SIDECAR_PLAN_ARTIFACT = 'assets-compiled-wasm-sidecar-plan.json';
const ASSETS_SIDECAR_COMPILE_LINK_PROOF_VERSION = 'pulsewasm.assets-sidecar-compile-link-proof.v1';
const ASSETS_SIDECAR_COMPILE_LINK_PROOF_ARTIFACT = 'assets-sidecar-compile-link-proof.json';

const ASSETS_CONTRACT_ID = 'pulse.assets';

const ASSETS_ALLOWED_METHODS = Object.freeze(['GET', 'HEAD']);
const ASSETS_ALLOWED_MODES = Object.freeze(['hosted-origin', 'provider-object-store']);
const ASSETS_INITIAL_PROVIDER_TARGETS = Object.freeze(['node', 'fastly']);

const ASSETS_PAYLOAD_MODE_STATUSES = LOWERABLE_LIBRARY_PAYLOAD_MODE_STATUSES;

const ASSETS_SUPPORTED_BODY_KINDS = Object.freeze(['text-response-body']);
const ASSETS_LOWERING_PLAN_ONLY_BODY_KINDS = Object.freeze(['stream-pass-through-response']);
const ASSETS_RESERVED_BODY_KINDS = Object.freeze(['binary-buffer']);
const ASSETS_UNSUPPORTED_BODY_KINDS = Object.freeze(['json-response-body']);

const ASSETS_DIAGNOSTIC_CODES = Object.freeze({
  NON_LITERAL_LOOKUP: 'PULSEWASM_ASSETS_NON_LITERAL_LOOKUP',
  UNSUPPORTED_METHOD: 'PULSEWASM_ASSETS_UNSUPPORTED_METHOD',
  ROUTE_METHOD_MISMATCH: 'PULSEWASM_ASSETS_ROUTE_METHOD_MISMATCH',
  RUNTIME_EXECUTION_UNSUPPORTED: 'PULSEWASM_ASSETS_RUNTIME_EXECUTION_UNSUPPORTED',
  RESPOND_REQUIRES_LOOKUP: 'PULSEWASM_ASSETS_RESPOND_REQUIRES_LOOKUP',
  BINARY_BODY_RESERVED: 'PULSEWASM_ASSETS_BINARY_BODY_RESERVED',
  STREAM_PROVIDER_NOT_WIRED: 'PULSEWASM_ASSETS_STREAM_PROVIDER_NOT_WIRED',
  PAYLOAD_MODE_UNSUPPORTED: 'PULSEWASM_ASSETS_PAYLOAD_MODE_UNSUPPORTED',
  NODE_PROVIDER_PLAN_REQUIRED: 'PULSEWASM_ASSETS_NODE_PROVIDER_PLAN_REQUIRED',
  NODE_PROVIDER_ASSET_NOT_FOUND: 'PULSEWASM_ASSETS_NODE_PROVIDER_ASSET_NOT_FOUND',
  NODE_PROVIDER_SMOKE_FAILED: 'PULSEWASM_ASSETS_NODE_PROVIDER_SMOKE_FAILED',
  NODE_COMPILED_LIFECYCLE_SMOKE_FAILED: 'PULSEWASM_ASSETS_NODE_COMPILED_LIFECYCLE_SMOKE_FAILED',
  STORE_CONFIG_REQUIRED: 'PULSEWASM_ASSETS_STORE_CONFIG_REQUIRED',
  STORE_NOT_CONFIGURED: 'PULSEWASM_ASSETS_STORE_NOT_CONFIGURED',
  STORE_CONFIG_INVALID: 'PULSEWASM_ASSETS_STORE_CONFIG_INVALID',
  STORE_ASSET_FILE_NOT_FOUND: 'PULSEWASM_ASSETS_STORE_ASSET_FILE_NOT_FOUND',
  FASTLY_PROVIDER_PLAN_REQUIRED: 'PULSEWASM_ASSETS_FASTLY_PROVIDER_PLAN_REQUIRED',
  FASTLY_PROVIDER_ASSET_NOT_FOUND: 'PULSEWASM_ASSETS_FASTLY_PROVIDER_ASSET_NOT_FOUND',
  FASTLY_PROVIDER_SMOKE_FAILED: 'PULSEWASM_ASSETS_FASTLY_PROVIDER_SMOKE_FAILED',
  FASTLY_PACKAGE_OUT_PARITY_PLAN_REQUIRED: 'PULSEWASM_FASTLY_ASSETS_PACKAGE_OUT_PARITY_PLAN_REQUIRED',
  FASTLY_PACKAGE_OUT_PARITY_SMOKE_FAILED: 'PULSEWASM_FASTLY_ASSETS_PACKAGE_OUT_PARITY_SMOKE_FAILED',
  FASTLY_ASSETS_COMPILED_WASM_PLAN_ONLY: 'PULSEWASM_FASTLY_ASSETS_COMPILED_WASM_PLAN_ONLY',
  DYNAMIC_KEY_UNSUPPORTED: 'PULSEWASM_ASSETS_DYNAMIC_KEY_UNSUPPORTED',
  COMPILED_BINARY_RESERVED: 'PULSEWASM_ASSETS_COMPILED_BINARY_RESERVED',
  COMPILED_STREAM_PLAN_ONLY: 'PULSEWASM_ASSETS_COMPILED_STREAM_PLAN_ONLY',
  HANDLE_ESCAPE_UNSUPPORTED: 'PULSEWASM_ASSETS_HANDLE_ESCAPE_UNSUPPORTED',
  COMPILED_METHOD_UNSUPPORTED: 'PULSEWASM_ASSETS_COMPILED_METHOD_UNSUPPORTED',
  SIDECAR_FILE_MISSING: 'PULSEWASM_ASSETS_SIDECAR_FILE_MISSING',
  SIDECAR_SYMBOL_MISSING: 'PULSEWASM_ASSETS_SIDECAR_SYMBOL_MISSING',
  SIDECAR_HOST_IMPORT_MISSING: 'PULSEWASM_ASSETS_SIDECAR_HOST_IMPORT_MISSING',
  SIDECAR_LINK_SMOKE_FAILED: 'PULSEWASM_ASSETS_SIDECAR_LINK_SMOKE_FAILED',
  SIDECAR_ASC_DEPENDENCY_GATED: 'PULSEWASM_ASSETS_SIDECAR_ASC_DEPENDENCY_GATED'
});

const ASSETS_PAYLOAD_MODE_CLASSIFICATION = Object.freeze({
  textResponseBody: Object.freeze({
    mode: 'text-response-body',
    status: 'implemented-now',
    hostResultKind: 'RESULT_TEXT',
    hostCapabilities: Object.freeze(['result', 'body']),
    owner: '@pulse-compute/wasm-host-runtime',
    notes: 'Text results are already supported by the host result ABI and are sufficient for the first text-only provider proof.'
  }),
  jsonResponseBody: Object.freeze({
    mode: 'json-response-body',
    status: 'unsupported',
    hostResultKind: 'RESULT_JSON',
    hostCapabilities: Object.freeze(['json', 'result']),
    owner: '@pulse-compute/wasm-host-runtime',
    notes: 'Assets do not lower to parsed JSON result builders. JSON files should be served as text/stream payloads with headers, not through the generic JSON helper.'
  }),
  streamPassThroughResponse: Object.freeze({
    mode: 'stream-pass-through-response',
    status: 'lowering-plan-only',
    hostSurfaceStatus: 'implemented-now',
    hostResultKind: 'RESULT_STREAM',
    hostCapabilities: Object.freeze(['headers', 'result', 'body']),
    owner: '@pulse-compute/wasm-host-runtime',
    notes: 'Host-owned response/stream refs and header merge policy exist; assets lowering/provider proof has not consumed them yet.'
  }),
  binaryBodyBufferResponse: Object.freeze({
    mode: 'binary-buffer',
    status: 'reserved-with-diagnostic',
    hostResultKind: 'RESULT_BINARY',
    hostCapabilities: Object.freeze(['result', 'body']),
    owner: '@pulse-compute/wasm-host-runtime',
    diagnosticCode: ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED,
    notes: 'First-class byte buffers are intentionally reserved until a concrete binary ABI/provider path exists.'
  }),
  headerPassThrough: Object.freeze({
    mode: 'header-pass-through',
    status: 'implemented-now',
    hostCapabilities: Object.freeze(['headers']),
    owner: '@pulse-compute/wasm-host-runtime',
    notes: 'Request/result header exports and ordered response header merge policy are implemented.'
  }),
  statusResultPassThrough: Object.freeze({
    mode: 'status-result-pass-through',
    status: 'implemented-now',
    hostCapabilities: Object.freeze(['result']),
    owner: '@pulse-compute/wasm-host-runtime',
    notes: 'Status is already part of text, JSON, empty, stream, and response-ref result surfaces.'
  }),
  notFoundPassThrough: Object.freeze({
    mode: '404-pass-through',
    status: 'provider-specific',
    hostCapabilities: Object.freeze(['assets', 'result']),
    owner: '@pulse-compute/provider-node and @pulse-compute/provider-fastly',
    notes: '404/pass-through policy is stable, but concrete behavior depends on the provider proof that consumes the lowering plan.'
  })
});

const ASSETS_LOOKUP_RESULT_SHAPE = Object.freeze({
  version: ASSETS_LOOKUP_RESULT_VERSION,
  kind: 'pulse.assets.lookup-result',
  fields: Object.freeze({
    found: 'boolean',
    store: 'literal store name from assets.lookup',
    key: 'literal normalized asset key from assets.lookup',
    method: 'GET or HEAD',
    status: 'provider status, usually 200 or 404',
    headers: 'ordered response headers or header ref',
    body: 'text body, host stream/response ref, or reserved binary diagnostic'
  })
});

const ASSETS_PROVIDER_CONFIG_SHAPE = Object.freeze({
  version: ASSETS_PROVIDER_CONFIG_VERSION,
  modes: ASSETS_ALLOWED_MODES,
  providerTargets: ASSETS_INITIAL_PROVIDER_TARGETS,
  fields: Object.freeze({
    mode: 'one of ASSETS_ALLOWED_MODES',
    store: 'static lowerable store name',
    origin: 'symbolic hosted-origin ref when mode is hosted-origin',
    bucket: 'symbolic provider object-store bucket ref when mode is provider-object-store',
    credentials: 'symbolic refs only; never compiled into Wasm artifacts',
    cache: 'optional ASSETS_CACHE_POLICY-compatible cache metadata'
  })
});

const ASSETS_KEY_POLICY = Object.freeze({
  store: 'non-empty static string literal selected by a package-owned pulse.assets lookup facade',
  key: 'non-empty static string literal; canonical examples use absolute web paths such as /app.js',
  normalization: 'providers may normalize leading slash/prefix, but lowering records the literal key for diagnostics',
  traversal: 'dot-segment traversal is provider-invalid and must not be silently normalized into another store key',
  dynamicKeys: 'reserved for a later pass; first lowering plan diagnostics require static store/key literals',
  routeMethodAlignment: 'when route metadata is available, an asset lookup method must match the owning route method unless a later explicit override policy is introduced'
});

const ASSETS_CACHE_POLICY = Object.freeze({
  defaultCacheControl: 'provider default unless cacheControl is supplied by lookup/respond options',
  explicitCacheControl: 'preserved as a response header under header merge policy',
  immutable: 'represented through Cache-Control header text, not a separate Wasm ABI feature',
  ttl: 'provider-specific seconds value when supplied by provider config',
  revalidation: 'not implemented by the lowering contract'
});

const ASSETS_RESPONSE_POLICY = Object.freeze({
  version: ASSETS_RESPONSE_POLICY_VERSION,
  allowedMethods: ASSETS_ALLOWED_METHODS,
  headDropsBody: true,
  lookupMiss: Object.freeze({
    status: 404,
    behavior: 'provider-specific pass-through or explicit 404 according to provider proof',
    bodyMode: 'text-response-body or empty result for proof lanes'
  }),
  headers: Object.freeze({
    passThrough: true,
    mergePolicy: 'contracts/host/request-result-headers plus contracts/host/streaming-passthrough response header merge rules'
  }),
  bodyModes: Object.freeze(Object.fromEntries(
    Object.values(ASSETS_PAYLOAD_MODE_CLASSIFICATION).map((entry) => [entry.mode, entry.status])
  )),
  binary: Object.freeze({
    status: ASSETS_PAYLOAD_MODE_CLASSIFICATION.binaryBodyBufferResponse.status,
    diagnosticCode: ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED
  }),
  stream: Object.freeze({
    status: ASSETS_PAYLOAD_MODE_CLASSIFICATION.streamPassThroughResponse.status,
    hostSurfaceStatus: ASSETS_PAYLOAD_MODE_CLASSIFICATION.streamPassThroughResponse.hostSurfaceStatus,
    diagnosticCode: ASSETS_DIAGNOSTIC_CODES.STREAM_PROVIDER_NOT_WIRED
  })
});

const ASSETS_PROTOCOL_POLICY = Object.freeze({
  packageIdentityOwnedByManifest: true,
  lowerableFacadeOwnedByPackage: true,
  protocolPayloadRulesOwnedByContracts: true,
  compilerOwnsPackageMappings: false,
  thirdPartyPackagesRequireCoreConstants: false,
  binaryBodyStillReserved: true,
  payloadModesExplicit: true,
  routeMethodAlignmentExplicit: true
});

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

function assetsPayloadModeClassification() {
  return clone(ASSETS_PAYLOAD_MODE_CLASSIFICATION);
}

function assetsPayloadMode(mode) {
  return Object.values(ASSETS_PAYLOAD_MODE_CLASSIFICATION).find((entry) => entry.mode === mode) || null;
}

function assetsProtocolExtension() {
  return {
    assets: {
      payloadModes: assetsPayloadModeClassification(),
      responsePolicy: clone(ASSETS_RESPONSE_POLICY)
    },
    policy: {
      binaryBodyStillReserved: true,
      payloadModesExplicit: true,
  routeMethodAlignmentExplicit: true
    }
  };
}

module.exports = {
  ASSETS_CONTRACT_VERSION,
  ASSETS_HOST_ABI_VERSION,
  ASSETS_PROVIDER_CONFIG_VERSION,
  ASSETS_LOOKUP_RESULT_VERSION,
  ASSETS_RESPONSE_POLICY_VERSION,
  ASSETS_LOWERING_PLAN_VERSION,
  ASSETS_ARTIFACT_VERSION,
  ASSETS_NODE_PROVIDER_RUNTIME_VERSION,
  ASSETS_NODE_PROVIDER_PROOF_VERSION,
  ASSETS_NODE_COMPILED_WASM_LIFECYCLE_RUNTIME_VERSION,
  ASSETS_NODE_COMPILED_WASM_LIFECYCLE_PROOF_VERSION,
  ASSETS_NODE_COMPILED_WASM_LIFECYCLE_PROOF_ARTIFACT,
  ASSETS_FASTLY_PROVIDER_RUNTIME_VERSION,
  ASSETS_FASTLY_PROVIDER_PROOF_VERSION,
  ASSETS_FASTLY_PACKAGE_OUT_PARITY_PROOF_VERSION,
  ASSETS_FASTLY_PACKAGE_OUT_PARITY_PROOF_ARTIFACT,
  ASSETS_PACKAGE_OWNED_LOWERING_PROOF_VERSION,
  ASSETS_PACKAGE_OWNED_LOWERING_PROOF_ARTIFACT,
  ASSETS_PACKAGE_OUT_DISCOVERY_PROOF_VERSION,
  ASSETS_PACKAGE_OUT_DISCOVERY_PROOF_ARTIFACT,
  ASSETS_COMPILED_WASM_SIDECAR_PLAN_VERSION,
  ASSETS_COMPILED_WASM_SIDECAR_PLAN_ARTIFACT,
  ASSETS_SIDECAR_COMPILE_LINK_PROOF_VERSION,
  ASSETS_SIDECAR_COMPILE_LINK_PROOF_ARTIFACT,
  ASSETS_CONTRACT_ID,
  ASSETS_ALLOWED_METHODS,
  ASSETS_ALLOWED_MODES,
  ASSETS_INITIAL_PROVIDER_TARGETS,
  ASSETS_PAYLOAD_MODE_STATUSES,
  ASSETS_SUPPORTED_BODY_KINDS,
  ASSETS_LOWERING_PLAN_ONLY_BODY_KINDS,
  ASSETS_RESERVED_BODY_KINDS,
  ASSETS_UNSUPPORTED_BODY_KINDS,
  ASSETS_DIAGNOSTIC_CODES,
  ASSETS_PAYLOAD_MODE_CLASSIFICATION,
  ASSETS_LOOKUP_RESULT_SHAPE,
  ASSETS_PROVIDER_CONFIG_SHAPE,
  ASSETS_RESPONSE_POLICY,
  ASSETS_KEY_POLICY,
  ASSETS_CACHE_POLICY,
  ASSETS_PROTOCOL_POLICY,
  assetsPayloadModeClassification,
  assetsPayloadMode,
  assetsProtocolExtension
};
