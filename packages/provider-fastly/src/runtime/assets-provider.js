'use strict';

function loadAssetsContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/assets/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/assets/contracts.js');
    }
    throw error;
  }
}

function loadDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/diagnostics.js');
    }
    throw error;
  }
}

const assetsContracts = loadAssetsContracts();
const { normalizeDiagnostic } = loadDiagnostics();

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}

function normalizeHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) {
    return headers
      .filter((pair) => pair && pair[0] !== undefined && pair[1] !== undefined)
      .map((pair) => [String(pair[0]), String(pair[1])]);
  }
  if (typeof headers[Symbol.iterator] === 'function') {
    return Array.from(headers, ([key, value]) => [String(key), String(value)]);
  }
  return Object.entries(headers).flatMap(([key, value]) => Array.isArray(value)
    ? value.map((item) => [String(key), String(item)])
    : [[String(key), String(value)]]);
}

function headerValue(headers, name) {
  const lower = String(name).toLowerCase();
  const found = normalizeHeaders(headers).find(([key]) => String(key).toLowerCase() === lower);
  return found ? found[1] : undefined;
}

function setHeader(headers, name, value) {
  const out = normalizeHeaders(headers).filter(([key]) => String(key).toLowerCase() !== String(name).toLowerCase());
  if (value !== undefined && value !== null) out.push([String(name), String(value)]);
  return out;
}

function appendMissingHeader(headers, name, value) {
  if (headerValue(headers, name) !== undefined) return headers;
  return headers.concat([[String(name), String(value)]]);
}

function normalizeKey(key) {
  const text = String(key || '');
  return text.startsWith('/') ? text : `/${text}`;
}

function normalizePlan(input) {
  const artifact = input && input.artifact ? input.artifact : input;
  if (!artifact || typeof artifact !== 'object') return undefined;
  return {
    ...artifact,
    entries: Array.isArray(artifact.entries) ? artifact.entries.map(clone) : [],
    payloadModes: artifact.payloadModes ? clone(artifact.payloadModes) : {
      classification: assetsContracts.assetsPayloadModeClassification(),
      responsePolicy: clone(assetsContracts.ASSETS_RESPONSE_POLICY)
    }
  };
}

function entriesFromPlan(plan) {
  return (plan && Array.isArray(plan.entries) ? plan.entries : [])
    .filter((entry) => entry && entry.status !== 'unsupported' && entry.lookup && entry.lookup.store && entry.lookup.key)
    .map(clone);
}

function normalizeAssetRecord(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || Buffer.isBuffer(value)) return { status: 200, body: value, headers: [] };
  if (typeof value === 'object') {
    return {
      status: value.status || 200,
      body: value.body !== undefined ? value.body : value.text !== undefined ? value.text : value.content,
      headers: normalizeHeaders(value.headers),
      cacheControl: value.cacheControl,
      contentType: value.contentType,
      payloadMode: value.payloadMode,
      metadata: clone(value.metadata || {})
    };
  }
  return { status: 200, body: String(value), headers: [] };
}

function normalizeStores(stores) {
  const out = new Map();
  for (const [storeName, records] of Object.entries(stores || {})) {
    const byKey = new Map();
    for (const [key, value] of Object.entries(records || {})) byKey.set(normalizeKey(key), normalizeAssetRecord(value));
    out.set(String(storeName), byKey);
  }
  return out;
}

function createDefaultStoresFromPlan(plan) {
  const stores = {};
  for (const entry of entriesFromPlan(plan)) {
    const lookup = entry.lookup;
    const store = lookup.store;
    const key = normalizeKey(lookup.key);
    if (!stores[store]) stores[store] = {};
    if (!stores[store][key]) {
      stores[store][key] = {
        status: entry.response && entry.response.status ? entry.response.status : 200,
        body: `fastly-asset:${store}:${key}`,
        headers: [
          ['Content-Type', key.endsWith('.js') ? 'application/javascript' : 'text/plain; charset=utf-8'],
          ['X-PulseWasm-Fastly-Asset-Store', store],
          ['X-PulseWasm-Fastly-Asset-Key', key]
        ],
        cacheControl: lookup.cacheControl
      };
    }
  }
  return stores;
}

function makeDiagnostic(code, message, severity, details) {
  return normalizeDiagnostic({
    phase: 'fastly-assets-provider',
    severity: severity || 'error',
    code,
    message,
    hint: details && details.hint,
    details,
    loc: { file: '<fastly-assets-provider>' }
  });
}

function symbolicRefName(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (value.$config) return `$config:${value.$config}`;
  if (value.$secret) return `$secret:${value.$secret}`;
  return undefined;
}

function normalizeResolvedConfig(input) {
  const resolved = input && input.artifact ? input.artifact : input;
  return resolved && typeof resolved === 'object' ? resolved : {};
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function assetCapabilityConfig(resolvedConfig) {
  const runtime = plainObject(normalizeResolvedConfig(resolvedConfig).runtime);
  return plainObject(plainObject(runtime.capabilities).assets);
}

function fastlyProviderConfig(resolvedConfig) {
  const runtime = plainObject(normalizeResolvedConfig(resolvedConfig).runtime);
  const provider = plainObject(runtime.provider);
  const platformFastly = plainObject(plainObject(runtime.platform).fastly);
  return {
    kind: provider.kind || 'fastly',
    configStore: provider.configStore || platformFastly.configStore || 'pulse_config',
    secretStore: provider.secretStore || platformFastly.secretStore || 'pulse_secrets'
  };
}

function sanitizeBindingName(value) {
  const text = String(value || 'public').replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'public';
  return `pulse_assets_${text}`.toLowerCase();
}

function uniqueStores(plan) {
  return Array.from(new Set(entriesFromPlan(plan).map((entry) => entry.lookup.store))).sort();
}

function buildFastlyAssetsProviderConfig(options = {}) {
  const plan = normalizePlan(options.plan || options.assetsLoweringPlan);
  const resolvedConfig = normalizeResolvedConfig(options.resolvedConfig || {});
  const assetConfig = assetCapabilityConfig(resolvedConfig);
  const provider = fastlyProviderConfig(resolvedConfig);
  const stores = uniqueStores(plan).map((logicalName) => ({
    logicalName,
    bindingName: sanitizeBindingName(logicalName),
    mode: 'provider-object-store',
    endpointRef: symbolicRefName(assetConfig.endpoint) || '$config:ASSET_ENDPOINT',
    bucketRef: symbolicRefName(assetConfig.bucket) || '$config:ASSET_BUCKET',
    keyRef: symbolicRefName(assetConfig.key) || '$secret:ASSET_KEY',
    contentAddressed: false,
    objectStoreSemanticsImplemented: false
  }));
  return {
    version: assetsContracts.ASSETS_PROVIDER_CONFIG_VERSION,
    provider: 'fastly',
    mode: options.mode || 'provider-object-store',
    configStore: provider.configStore,
    secretStore: provider.secretStore,
    symbolicRefsOnly: true,
    stores,
    unsupported: {
      uploads: 'unsupported',
      invalidation: 'unsupported',
      mutationApis: 'unsupported',
      fullObjectStoreSemantics: 'unsupported-in-proof'
    },
    summary: {
      stores: stores.length,
      configStore: provider.configStore,
      secretStore: provider.secretStore,
      symbolicRefs: stores.reduce((count, store) => count + [store.endpointRef, store.bucketRef, store.keyRef].filter(Boolean).length, 0)
    }
  };
}

function unsupportedMethodResult(method) {
  return {
    status: 405,
    kind: 'fastly-empty',
    headers: [['Allow', assetsContracts.ASSETS_ALLOWED_METHODS.join(', ')]],
    body: undefined,
    diagnostics: [makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.UNSUPPORTED_METHOD,
      `Fastly assets provider proof only accepts ${assetsContracts.ASSETS_ALLOWED_METHODS.join(' / ')} requests.`,
      'error',
      { method, allowedMethods: assetsContracts.ASSETS_ALLOWED_METHODS }
    )]
  };
}

function reservedBinaryResult(entry) {
  return {
    status: 501,
    kind: 'fastly-empty',
    headers: [['Content-Type', 'text/plain; charset=utf-8']],
    body: undefined,
    entryId: entry && entry.id,
    diagnostics: [makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED,
      'Fastly assets provider proof explicitly rejects binary-buffer assets until the binary body ABI is implemented.',
      'error',
      { payloadMode: 'binary-buffer', status: 'reserved-with-diagnostic' }
    )]
  };
}

function unsupportedPayloadResult(entry, payloadMode) {
  return {
    status: 415,
    kind: 'fastly-empty',
    headers: [['Content-Type', 'text/plain; charset=utf-8']],
    body: undefined,
    entryId: entry && entry.id,
    diagnostics: [makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.PAYLOAD_MODE_UNSUPPORTED,
      `Fastly assets provider proof cannot serve assets payload mode ${JSON.stringify(payloadMode)}.`,
      'error',
      { payloadMode }
    )]
  };
}

function notFoundResult(entry, request) {
  const lookup = entry && entry.lookup ? entry.lookup : {};
  const passThrough = lookup.passThroughOn404 !== false;
  const headers = [
    ['Content-Type', 'text/plain; charset=utf-8'],
    ['X-PulseWasm-Fastly-Asset-Miss', '1']
  ];
  return {
    status: 404,
    kind: 'fastly-empty',
    headers,
    body: undefined,
    passThroughOn404: passThrough,
    entryId: entry && entry.id,
    diagnostics: [makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_PROVIDER_ASSET_NOT_FOUND,
      'Fastly assets provider proof could not resolve the static store/key from the lowering plan.',
      'info',
      { store: lookup.store, key: lookup.key, path: request.path, passThroughOn404: passThrough }
    )]
  };
}

function resolveAsset(stores, store, key) {
  const byKey = stores.get(String(store));
  if (!byKey) return undefined;
  return byKey.get(normalizeKey(key)) || byKey.get(String(key));
}

function responseStatus(entry, asset) {
  if (entry && entry.response && entry.response.status) return entry.response.status;
  return asset && asset.status ? asset.status : 200;
}

function assetHeaders(entry, asset) {
  const lookup = entry.lookup || {};
  let headers = normalizeHeaders(asset && asset.headers);
  headers = appendMissingHeader(headers, 'Content-Type', (asset && asset.contentType) || 'text/plain; charset=utf-8');
  headers = setHeader(headers, 'X-PulseWasm-Fastly-Asset-Store', lookup.store);
  headers = setHeader(headers, 'X-PulseWasm-Fastly-Asset-Key', normalizeKey(lookup.key));
  const cacheControl = lookup.cacheControl || (asset && asset.cacheControl);
  if (cacheControl) headers = setHeader(headers, 'Cache-Control', cacheControl);
  return headers;
}

function bodyText(asset) {
  const body = asset && asset.body !== undefined ? asset.body : '';
  return Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
}

function payloadModeForEntry(entry, asset) {
  return (entry && entry.response && entry.response.payloadMode) ||
    (entry && entry.lookup && entry.lookup.payloadMode) ||
    (asset && asset.payloadMode) ||
    'text-response-body';
}

function matchEntry(entries, request) {
  const method = String(request.method || 'GET').toUpperCase();
  const path = normalizeKey(request.path || '/');
  const candidates = entries.filter((entry) => normalizeKey(entry.lookup.key) === path);
  return candidates.find((entry) => String(entry.lookup.method || 'GET').toUpperCase() === method) ||
    (method === 'HEAD' ? candidates.find((entry) => String(entry.lookup.method || 'GET').toUpperCase() === 'GET') : undefined) ||
    candidates[0];
}

function normalizeFastlyPath(request) {
  if (!request) return '/';
  if (request.path || request.key) return normalizeKey(request.path || request.key);
  if (request.url) {
    try { return new URL(String(request.url), 'https://pulsewasm.fastly.local').pathname || '/'; } catch (_) { return normalizeKey(String(request.url || '/').split('?')[0]); }
  }
  return '/';
}

function streamBindingFor(entry, asset, sourceArtifacts) {
  const body = bodyText(asset);
  return {
    kind: 'fastly-stream-binding-plan',
    sourceArtifact: sourceArtifacts.fastlyStreamBindingPlan || null,
    responseRef: `fastly-response-ref:${entry.id || normalizeKey(entry.lookup.key)}`,
    streamRef: `fastly-stream-ref:${entry.id || normalizeKey(entry.lookup.key)}`,
    chunks: [body],
    hostOwnedBytes: true,
    wasmOwnsBytes: false,
    binaryBufferReserved: true
  };
}

function sourceArtifactVersions(input = {}) {
  const versionOf = (value) => typeof value === 'string' ? value : value && value.artifact ? value.artifact.version : value && value.version;
  return {
    fastlyStreamBindingPlan: versionOf(input.fastlyStreamBindingPlan),
    fastlyStreamHeaderAdapter: versionOf(input.fastlyStreamHeaderAdapter),
    requestResultHeaders: versionOf(input.requestResultHeaders),
    streamingPassthrough: versionOf(input.streamingPassthrough),
    wasmHostAbi: versionOf(input.wasmHostAbi)
  };
}

function createFastlyAssetsProvider(options = {}) {
  const plan = normalizePlan(options.plan || options.assetsLoweringPlan);
  const diagnostics = [];
  if (!plan) {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_PROVIDER_PLAN_REQUIRED,
      'Fastly assets provider proof requires an assets-lowering-plan artifact.',
      'error',
      { hint: 'Emit --assets-lowering-plan before invoking the Fastly assets provider proof.' }
    ));
  }
  const entries = entriesFromPlan(plan);
  const stores = normalizeStores(options.stores || createDefaultStoresFromPlan(plan));
  const providerConfig = options.providerConfig || buildFastlyAssetsProviderConfig({ plan, resolvedConfig: options.resolvedConfig, mode: options.mode });
  const sourceArtifacts = sourceArtifactVersions(options.sourceArtifacts || options);

  function executeRequest(input = {}) {
    const request = {
      method: String(input.method || 'GET').toUpperCase(),
      path: normalizeFastlyPath(input)
    };
    if (!assetsContracts.ASSETS_ALLOWED_METHODS.includes(request.method)) return unsupportedMethodResult(request.method);
    const entry = matchEntry(entries, request);
    if (!entry) return notFoundResult({ lookup: { key: request.path, store: '<none>', passThroughOn404: true } }, request);
    const asset = resolveAsset(stores, entry.lookup.store, entry.lookup.key);
    if (!asset) return notFoundResult(entry, request);
    const payloadMode = payloadModeForEntry(entry, asset);
    if (payloadMode === 'binary-buffer') return reservedBinaryResult(entry);
    const mode = assetsContracts.assetsPayloadMode(payloadMode);
    if (mode && mode.status === 'unsupported') return unsupportedPayloadResult(entry, payloadMode);
    const headers = assetHeaders(entry, asset);
    const status = responseStatus(entry, asset);
    if (request.method === 'HEAD') {
      return { status, kind: 'fastly-empty', headers, body: undefined, entryId: entry.id, lookup: clone(entry.lookup), diagnostics: [] };
    }
    if (payloadMode === 'stream-pass-through-response') {
      const bodyStream = streamBindingFor(entry, asset, sourceArtifacts);
      return {
        status,
        kind: 'fastly-stream',
        headers,
        body: bodyStream.chunks.join(''),
        bodyStream,
        responseRef: bodyStream.responseRef,
        streamRef: bodyStream.streamRef,
        entryId: entry.id,
        lookup: clone(entry.lookup),
        payloadMode,
        fastlyStreamBindingPlanConnected: Boolean(sourceArtifacts.fastlyStreamBindingPlan),
        diagnostics: []
      };
    }
    return {
      status,
      kind: 'fastly-response',
      headers,
      body: bodyText(asset),
      entryId: entry.id,
      lookup: clone(entry.lookup),
      payloadMode,
      fastlyResponsePath: true,
      diagnostics: []
    };
  }

  return {
    version: assetsContracts.ASSETS_FASTLY_PROVIDER_RUNTIME_VERSION,
    provider: 'fastly',
    mode: options.mode || 'provider-object-store',
    plan,
    entries: entries.map(clone),
    providerConfig: clone(providerConfig),
    sourceArtifacts,
    diagnostics,
    executeRequest,
    lookup(store, key) { return resolveAsset(stores, store, key); },
    stores
  };
}

module.exports = {
  createFastlyAssetsProvider,
  createDefaultStoresFromPlan,
  buildFastlyAssetsProviderConfig,
  normalizeHeaders,
  normalizeFastlyPath
};
