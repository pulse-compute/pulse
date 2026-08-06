'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');
const { fastlyJavascriptProviderError, isPulseRuntimeError } = require('./errors.js');

const FASTLY_JAVASCRIPT_ASSETS_ADAPTER_VERSION = 'pulse.fastly-javascript-assets-adapter.v1';

function contentTypeForKey(key) {
  const extension = String(key).toLowerCase().split('.').pop();
  return Object.freeze({
    css: 'text/css; charset=utf-8',
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    svg: 'image/svg+xml',
    txt: 'text/plain; charset=utf-8',
    webp: 'image/webp',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    ico: 'image/x-icon'
  })[extension] || 'application/octet-stream';
}

function responseHeaders(payload) {
  const headers = new Headers(payload && payload.headers);
  if (!headers.has('content-type')) headers.set('content-type', contentTypeForKey(payload && payload.key));
  if (payload && payload.cacheControl !== undefined) headers.set('cache-control', String(payload.cacheControl));
  return headers;
}

function createFastlyJavascriptAssetsLookup(options = {}) {
  const apis = options.apis || {};
  const bindings = options.bindings && typeof options.bindings === 'object' ? options.bindings : {};
  const kvBindings = bindings.kv && typeof bindings.kv === 'object' ? bindings.kv : {};
  const stores = new Map();

  function storeFor(logicalStore) {
    const store = typeof logicalStore === 'string' ? logicalStore.trim() : '';
    const resource = store && typeof kvBindings[store] === 'string' ? kvBindings[store].trim() : '';
    if (!store || !resource) {
      throw fastlyJavascriptProviderError(
        'PULSE_FASTLY_ASSETS_BINDING_REQUIRED',
        'Fastly JavaScript Assets requires a logical store-to-KV mapping.',
        { store, configuration: store ? `bindings.kv.${store}` : 'bindings.kv' }
      );
    }
    if (!stores.has(resource)) {
      if (typeof apis.KVStore !== 'function') {
        throw fastlyJavascriptProviderError(
          'PULSE_FASTLY_JAVASCRIPT_API_UNAVAILABLE',
          'Fastly JavaScript Assets requires the KVStore API.',
          { api: 'KVStore' }
        );
      }
      try { stores.set(resource, new apis.KVStore(resource)); }
      catch (error) {
        throw fastlyJavascriptProviderError(
          'PULSE_FASTLY_ASSETS_STORE_OPEN_FAILED',
          'Fastly JavaScript could not open the configured Assets KV Store.',
          { store, resource },
          error
        );
      }
    }
    return Object.freeze({ store, resource, value: stores.get(resource) });
  }

  return async function fastlyJavascriptAssetsLookup(payload = {}) {
    const opened = storeFor(payload.store);
    const key = typeof payload.key === 'string' ? payload.key : '';
    if (!key) {
      throw fastlyJavascriptProviderError(
        'PULSE_FASTLY_ASSETS_KEY_INVALID',
        'Fastly JavaScript Assets requires a non-empty asset key.',
        { store: opened.store }
      );
    }
    let entry;
    try { entry = await opened.value.get(key); }
    catch (error) {
      if (isPulseRuntimeError(error)) throw error;
      throw fastlyJavascriptProviderError(
        'PULSE_FASTLY_ASSETS_LOOKUP_FAILED',
        'Fastly JavaScript Assets lookup failed.',
        { store: opened.store, key },
        error
      );
    }
    if (entry === null || entry === undefined) {
      return runtimeHost.markOpaqueResponse(new Response(null, {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      }));
    }
    if (!entry || !('body' in Object(entry))) {
      throw fastlyJavascriptProviderError(
        'PULSE_FASTLY_ASSETS_ENTRY_INVALID',
        'Fastly JavaScript Assets received an invalid KV entry.',
        { store: opened.store, key }
      );
    }
    const body = entry.body;
    const method = String(payload.method || 'GET').toUpperCase();
    const headers = responseHeaders(payload);
    if (method === 'HEAD') {
      if (body && typeof body.cancel === 'function') {
        try { await body.cancel(); } catch (_) { /* Best-effort host stream cleanup. */ }
      }
      return runtimeHost.markOpaqueResponse(new Response(null, { status: 200, headers }));
    }
    return runtimeHost.markOpaqueResponse(new Response(body, { status: 200, headers }));
  };
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_ASSETS_ADAPTER_VERSION,
  contentTypeForKey,
  createFastlyJavascriptAssetsLookup
});
