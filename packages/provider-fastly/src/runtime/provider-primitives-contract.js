'use strict';

const runtimeApi = require('@pulse-compute/wasm-contracts/handler/runtime-api');

const FASTLY_PROVIDER_CONTRACT_VERSION = 'pulse.fastly-provider-contract.v2';
const primitiveNames = Object.freeze([
  'ProviderRequest',
  'ProviderResponse',
  'ProviderFetch',
  'ProviderConfig',
  'ProviderSecret',
  'ProviderKV',
  'ProviderLog'
]);
const ctxSurface = Object.freeze({
  request: Object.freeze(['ctx.req.method', 'ctx.req.url', 'ctx.req.path', 'ctx.req.headers', 'ctx.req.text()', 'ctx.req.json()']),
  response: Object.freeze(['ctx.json()', 'ctx.text()', 'ctx.response()', 'return ctx.fetch(url)']),
  fetch: Object.freeze(['ctx.fetch(url, options)']),
  config: 'ctx.config.get(name)',
  secret: 'ctx.secret.get(name)',
  kv: Object.freeze(['ctx.kv(store).get(key)', 'ctx.kv(store).put(key, value)']),
  log: Object.freeze(['ctx.log.info(message, fields)', 'ctx.log.warn(message, fields)', 'ctx.log.error(message, fields)'])
});
const defaults = Object.freeze({
  provider: 'fastly',
  configStore: 'pulse_config',
  secretStore: 'pulse_secrets',
  kvStore: 'pulse_kv',
  allowedMethods: Object.freeze(['GET', 'HEAD', 'POST']),
  defaultTimeoutMs: runtimeApi.limits.fetchTimeoutMs,
  structuredBodyMaxBytes: runtimeApi.limits.structuredBodyBytes,
  opaquePassThrough: true,
  secretRedaction: '[secret:redacted]'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableClone(value) {
  return runtimeApi.body.immutableClone(value);
}

function normalizeHeaders(headers) {
  return runtimeApi.body.normalizeHeaders(headers).map(([name, value]) => [String(name).toLowerCase(), String(value)]);
}

function normalizeName(value, fallback = 'VALUE') {
  return String(value || fallback).trim().replace(/[^A-Za-z0-9:_-]+/g, '_') || fallback;
}

function redactSecretValue(name) {
  return `[secret:${normalizeName(name, 'SECRET')}:redacted]`;
}

function redactSecrets(value, secretNames = []) {
  const names = Array.from(new Set(secretNames.map((name) => normalizeName(name, 'SECRET'))));
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, names));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const lower = String(key).toLowerCase();
      if (lower.includes('secret') || lower.includes('token') || names.some((name) => lower.includes(name.toLowerCase()))) out[key] = redactSecretValue(names[0] || key);
      else out[key] = redactSecrets(child, names);
    }
    return out;
  }
  const text = String(value ?? '');
  for (const name of names) if (text.includes(name) || /token|secret/i.test(text)) return redactSecretValue(name);
  return value;
}

function createCapabilityManifest(input = {}) {
  const configStore = normalizeName(input.configStore || defaults.configStore, defaults.configStore);
  const secretStore = normalizeName(input.secretStore || defaults.secretStore, defaults.secretStore);
  const kvStore = normalizeName(input.kvStore || defaults.kvStore, defaults.kvStore);
  return deepFreeze({
    kind: 'provider-capability-manifest',
    provider: 'fastly',
    contractVersion: FASTLY_PROVIDER_CONTRACT_VERSION,
    primitives: primitiveNames,
    ctxSurface,
    bindings: { configStore, secretStore, kvStore },
    config: { surface: ctxSurface.config, exactNameOnly: true, enumerable: false, provider: 'fastly.configStore', store: configStore },
    secret: { surface: ctxSurface.secret, exactNameOnly: true, enumerable: false, provider: 'fastly.secretStore', store: secretStore, traceRedacted: true },
    kv: { surface: ctxSurface.kv, provider: 'fastly.kvStore', store: kvStore, operations: ['get', 'put'], deleteReserved: true },
    fetch: { surface: ctxSurface.fetch, methods: defaults.allowedMethods, timeoutMs: defaults.defaultTimeoutMs, opaquePassThrough: true },
    request: { surface: ctxSurface.request, exposesProviderObject: false },
    response: { surface: ctxSurface.response, exposesProviderObject: false, opaquePassThrough: true },
    log: { surface: ctxSurface.log, secretRedaction: true },
    providerSpecificUserland: false,
    providerSdkWrapper: false,
    capabilityDiscoveryFromUserland: false
  });
}

function createRequestAdapter(input = {}) {
  return deepFreeze({
    kind: 'ProviderRequest',
    provider: 'fastly',
    method: String(input.method || 'GET').toUpperCase(),
    url: String(input.url || 'https://edge.example.test/'),
    path: String(input.path || '/'),
    query: immutableClone(input.query || {}),
    headers: normalizeHeaders(input.headers || []),
    bodyClass: input.bodyClass || 'structured',
    exposesProviderObject: false,
    providerSpecificUserland: false,
    authority: 'ctx-only'
  });
}

function createResponseAdapter(input = {}) {
  const status = Number(input.status || 200);
  const headers = normalizeHeaders(input.headers || [['content-type', input.contentType || 'application/json; charset=utf-8']]);
  const bodyClass = input.bodyClass || 'structured';
  return deepFreeze({
    kind: 'ProviderResponse',
    provider: 'fastly',
    status,
    headers,
    bodyClass,
    bodyKind: input.bodyKind || (bodyClass === 'opaque' ? 'stream' : 'json'),
    preserveStatus: true,
    preserveHeaders: true,
    preserveBodyHandle: bodyClass === 'opaque',
    exposesProviderObject: false,
    providerSpecificUserland: false,
    traceBodyContents: bodyClass !== 'opaque',
    bodyCopiedIntoWasm: bodyClass === 'opaque' ? false : Boolean(input.bodyCopiedIntoWasm)
  });
}

function createFetchAdapter(input = {}) {
  const method = String(input.method || 'GET').toUpperCase();
  if (!defaults.allowedMethods.includes(method)) return deepFreeze({ ok: false, error: runtimeApi.errors.hostEffect, method });
  const headers = normalizeHeaders(input.headers || [['accept', 'application/json']]);
  const timeoutMs = Number(input.timeoutMs || defaults.defaultTimeoutMs);
  return deepFreeze({
    kind: 'ProviderFetch',
    provider: 'fastly',
    effect: {
      ok: true,
      kind: 'fetch-request-effect',
      effectKind: 'backend-fetch',
      method,
      url: String(input.url || 'https://api.example.test/'),
      headers,
      timeoutMs,
      bodyClass: Object.prototype.hasOwnProperty.call(input, 'body') ? 'structured' : 'none',
      body: Object.prototype.hasOwnProperty.call(input, 'body') ? String(input.body ?? '') : undefined,
      providerSpecificUserland: false
    },
    dispatch: 'backend-fetch',
    providerSpecificUserland: false,
    supportsStructuredBodies: true,
    supportsOpaquePassThrough: true,
    timeoutMs,
    methods: defaults.allowedMethods
  });
}

function createConfigAdapter(values = {}) {
  const store = Object.fromEntries(Object.entries(values).map(([key, value]) => [normalizeName(key), String(value)]));
  return Object.freeze({
    kind: 'ProviderConfig',
    provider: 'fastly',
    store: defaults.configStore,
    exactNameOnly: true,
    enumerable: false,
    providerSpecificUserland: false,
    get(name) {
      const key = normalizeName(name);
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : undefined;
    },
    list() { return deepFreeze({ ok: false, error: 'CapabilityDiscoveryError', enumerable: false }); },
    snapshot() { return deepFreeze({ keys: Object.keys(store).sort(), valuesVisibleInTrace: false, exactNameOnly: true }); }
  });
}

function createSecretAdapter(values = {}) {
  const store = Object.fromEntries(Object.entries(values).map(([key, value]) => [normalizeName(key), String(value)]));
  return Object.freeze({
    kind: 'ProviderSecret',
    provider: 'fastly',
    store: defaults.secretStore,
    exactNameOnly: true,
    enumerable: false,
    traceRedacted: true,
    providerSpecificUserland: false,
    get(name) {
      const key = normalizeName(name);
      if (!Object.prototype.hasOwnProperty.call(store, key)) return undefined;
      return deepFreeze({ kind: 'secret-value', name: key, value: store[key], redacted: redactSecretValue(key), traceRedacted: true, enumerable: false });
    },
    list() { return deepFreeze({ ok: false, error: 'CapabilityDiscoveryError', enumerable: false, traceRedacted: true }); }
  });
}

function createKvAdapter(stores = {}) {
  const normalizedStores = {};
  for (const [storeName, entries] of Object.entries(stores)) normalizedStores[normalizeName(storeName, 'default')] = { ...(entries || {}) };
  function ensureStore(storeName) {
    const name = normalizeName(storeName, 'default');
    if (!normalizedStores[name]) normalizedStores[name] = {};
    return { name, entries: normalizedStores[name] };
  }
  return Object.freeze({
    kind: 'ProviderKV',
    provider: 'fastly',
    exactStoreBinding: true,
    operations: Object.freeze(['get', 'put']),
    deleteReserved: true,
    providerSpecificUserland: false,
    get(storeName, key) {
      const store = ensureStore(storeName);
      const normalizedKey = String(key || '');
      const hit = Object.prototype.hasOwnProperty.call(store.entries, normalizedKey);
      return deepFreeze({ ok: true, operation: 'get', store: store.name, key: normalizedKey, hit, value: hit ? immutableClone(store.entries[normalizedKey]) : undefined });
    },
    put(storeName, key, value) {
      const store = ensureStore(storeName);
      const normalizedKey = String(key || '');
      store.entries[normalizedKey] = immutableClone(value);
      return deepFreeze({ ok: true, operation: 'put', store: store.name, key: normalizedKey, valueStored: true, generation: `${store.name}:${normalizedKey}:1` });
    },
    delete() { return deepFreeze({ ok: false, operation: 'delete', error: 'CapabilityReservedError', reserved: true }); }
  });
}

function createLogAdapter(options = {}) {
  const secretNames = Array.isArray(options.secretNames) ? options.secretNames : [];
  const adapter = {
    kind: 'ProviderLog',
    provider: 'fastly',
    traceRedacted: true,
    providerSpecificUserland: false,
    event(level, message, fields = {}) {
      const safeLevel = ['debug', 'info', 'warn', 'error'].includes(String(level)) ? String(level) : 'info';
      return deepFreeze({ level: safeLevel, message: String(message || ''), fields: redactSecrets(fields, secretNames), secretRedactionApplied: true });
    },
    info(message, fields) { return adapter.event('info', message, fields); },
    warn(message, fields) { return adapter.event('warn', message, fields); },
    error(message, fields) { return adapter.event('error', message, fields); }
  };
  return Object.freeze(adapter);
}

module.exports = Object.freeze({
  version: FASTLY_PROVIDER_CONTRACT_VERSION,
  primitiveNames,
  ctxSurface,
  ctxSurfaces: ctxSurface,
  defaults,
  capabilityDefaults: defaults,
  deepFreeze,
  immutableClone,
  normalizeHeaders,
  normalizeName,
  redactSecretValue,
  redactSecrets,
  createCapabilityManifest,
  createRequestAdapter,
  createResponseAdapter,
  createFetchAdapter,
  createConfigAdapter,
  createSecretAdapter,
  createKvAdapter,
  createLogAdapter
});
