'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');

const NODE_JAVASCRIPT_ASSETS_ADAPTER_VERSION = 'pulse.node-javascript-assets-adapter.v1';

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

function responseHeaders(payload, found) {
  const headers = new Headers(payload && payload.headers);
  if (!headers.has('content-type')) {
    headers.set(
      'content-type',
      found ? contentTypeForKey(payload && payload.key) : 'text/plain; charset=utf-8'
    );
  }
  if (payload && payload.cacheControl !== undefined) {
    headers.set('cache-control', String(payload.cacheControl));
  }
  return headers;
}

function bodyValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

function createNodeJavascriptAssetsLookup(bindingCapabilities) {
  if (!bindingCapabilities || typeof bindingCapabilities.kv !== 'function') {
    throw new TypeError('Node JavaScript Assets requires provider-owned KV capabilities.');
  }
  return async function nodeJavascriptAssetsLookup(payload = {}) {
    const store = bindingCapabilities.kv(payload.store);
    const entry = store.get(payload.key);
    const found = entry !== undefined;
    const headers = responseHeaders(payload, found);
    if (!found) return runtimeHost.markOpaqueResponse(new Response(null, { status: 404, headers }));
    const method = String(payload.method || 'GET').toUpperCase();
    return runtimeHost.markOpaqueResponse(new Response(method === 'HEAD' ? null : bodyValue(entry), {
      status: 200,
      headers
    }));
  };
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_ASSETS_ADAPTER_VERSION,
  contentTypeForKey,
  createNodeJavascriptAssetsLookup
});
