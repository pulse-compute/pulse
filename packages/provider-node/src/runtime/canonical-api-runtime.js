'use strict';
const { createNodeKvReference } = require('./conditional-kv.js');

const path = require('node:path');
const { Readable } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');
const routeHandlerEffects = require('./route-handler-effects.js');
const portableRuntimeHost = require('@pulse-compute/runtime/host');
const hostRuntime = require('@pulse-compute/wasm-host-runtime/runtime/canonical-api-runtime');
const nativeHost = require('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host');
const handlerEffectContract = require('@pulse-compute/wasm-contracts/handler/effects');
const providerContract = require('@pulse-compute/wasm-contracts/provider/canonical-provider');
const { createNodeJavascriptGripBroadcast } = require('../javascript/grip-broadcast.js');
const { createNodeNativeJwtVerify } = require('./jwt-verifier.js');
const {
  NODE_CANONICAL_PROVIDER_CAPABILITIES,
  NODE_CANONICAL_PROVIDER_LOWERING
} = require('../capabilities.js');

const CANONICAL_NODE_RUNTIME_VERSION = 'pulse.canonical-node-runtime.v4';
const NODE_PROVIDER_DESCRIPTOR = providerContract.normalizeDescriptor({
  id: 'node',
  package: '@pulse-compute/provider-node',
  runtime: CANONICAL_NODE_RUNTIME_VERSION,
  buildTarget: 'node',
  deployable: true,
  capabilities: NODE_CANONICAL_PROVIDER_CAPABILITIES,
  lowering: NODE_CANONICAL_PROVIDER_LOWERING
});

function normalizeFetchFixtures(fetches = {}) {
  if (fetches instanceof Map) return new Map(fetches);
  return new Map(Object.entries(fetches || {}));
}

function providerResponseSpec(spec = {}) {
  if (spec.opaque || spec.kind === 'stream' || spec.bodyStream !== undefined || spec.bodyHandle !== undefined) {
    return {
      status: Number(Object.prototype.hasOwnProperty.call(spec, 'status') ? spec.status : 200),
      kind: 'stream',
      headers: hostRuntime.createCanonicalContext ? normalizeHeaders(spec.headers || [['content-type', 'application/octet-stream']]) : spec.headers,
      bodyStream: spec.bodyStream || { chunks: Array.isArray(spec.chunks) ? [...spec.chunks] : [] },
      bodyHandle: spec.bodyHandle,
      responseRef: spec.responseRef,
      streamRef: spec.streamRef
    };
  }
  const body = Object.prototype.hasOwnProperty.call(spec, 'body') ? spec.body : JSON.stringify(Object.prototype.hasOwnProperty.call(spec, 'value') ? spec.value : {});
  return {
    status: Number(Object.prototype.hasOwnProperty.call(spec, 'status') ? spec.status : 200),
    kind: spec.kind || 'text',
    headers: normalizeHeaders(spec.headers || [['content-type', 'application/json; charset=utf-8']]),
    body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  };
}

function normalizeHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) return headers.map(([name, value]) => [String(name), String(value)]);
  if (typeof headers.entries === 'function') return [...headers.entries()].map(([name, value]) => [String(name), String(value)]);
  return Object.entries(headers).flatMap(([name, value]) => Array.isArray(value) ? value.map((entry) => [String(name), String(entry)]) : [[String(name), String(value)]]);
}

function buildProviderBackends(fetchFixtures) {
  const backends = {};
  const specs = new Map();
  for (const [fixtureKey, input] of fetchFixtures.entries()) {
    const matched = /^([A-Za-z]+)\s+(\S.*)$/.exec(String(fixtureKey));
    const url = matched ? matched[2] : String(fixtureKey);
    const parts = hostRuntime.urlParts(url);
    const spec = input && typeof input === 'object' ? input : { body: input };
    const method = String(spec.method || (matched && matched[1]) || 'GET').toUpperCase();
    if (!backends[parts.origin]) backends[parts.origin] = {};
    backends[parts.origin][`${method} ${parts.path}`] = providerResponseSpec(spec);
    if (method === 'GET') backends[parts.origin][parts.path] = providerResponseSpec(spec);
    specs.set(`${method} ${parts.url}`, spec);
    if (method === 'GET') specs.set(parts.url, spec);
  }
  return Object.freeze({ backends, specs });
}

function fixtureWebResponse(spec = {}, method = 'GET') {
  const response = providerResponseSpec(spec);
  const status = Number(response.status || 200);
  const bodyAllowed = String(method).toUpperCase() !== 'HEAD'
    && status !== 204
    && status !== 205
    && status !== 304
    && !(status >= 100 && status < 200);
  return new Response(bodyAllowed ? response.body : null, {
    status,
    headers: normalizeHeaders(response.headers)
  });
}

function fixtureFetchImplementation(fetches) {
  const providerData = buildProviderBackends(normalizeFetchFixtures(fetches));
  return async function nodeCanonicalFixtureFetch(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    const fixture = providerData.specs.get(`${method} ${String(url)}`)
      || providerData.specs.get(String(url));
    if (!fixture) throw new Error(`No Node provider fixture is configured for ${method} ${String(url)}.`);
    if (fixture.kind === 'network-error') throw new Error('Node provider fixture produced a network failure.');
    if (fixture.kind === 'timeout') {
      await new Promise((_resolve, reject) => {
        const signal = init.signal;
        const onAbort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        if (signal && signal.aborted) onAbort();
        else if (signal) signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    const delayMs = Math.max(0, Number(fixture.delayMs) || 0);
    if (delayMs > 0) await delay(delayMs, undefined, { signal: init.signal });
    return fixtureWebResponse(fixture, method);
  };
}

function assetContentType(key) {
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

function assetResponse(payload, stores) {
  const storeName = portableRuntimeHost.normalizeKvNamespace(payload.store, {});
  const key = portableRuntimeHost.normalizeKvKey(payload.key, {});
  const store = stores.get(storeName);
  const found = store && store.has(key);
  const status = found ? 200 : 404;
  const headers = normalizeHeaders(payload.headers);
  if (!headers.some(([name]) => name.toLowerCase() === 'content-type')) {
    headers.push(['content-type', found ? assetContentType(key) : 'text/plain; charset=utf-8']);
  }
  if (payload.cacheControl !== undefined) headers.push(['cache-control', String(payload.cacheControl)]);
  const method = String(payload.method || 'GET').toUpperCase();
  const value = found ? store.get(key) : '';
  const body = method === 'HEAD' || !found
    ? ''
    : (typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array)
      ? value
      : JSON.stringify(value);
  return Object.freeze({
    status,
    kind: 'text',
    bodyClass: 'structured',
    headers: Object.freeze(headers.map((entry) => Object.freeze(entry))),
    body,
    providerSource: 'node'
  });
}

function responseHeaders(response) {
  const headers = [];
  if (response && response.headers && typeof response.headers.entries === 'function') {
    for (const [name, value] of response.headers.entries()) {
      if (String(name).toLowerCase() === 'set-cookie' && typeof response.headers.getSetCookie === 'function') continue;
      headers.push([String(name), String(value)]);
    }
    if (typeof response.headers.getSetCookie === 'function') {
      for (const value of response.headers.getSetCookie()) headers.push(['set-cookie', String(value)]);
    }
  }
  return headers;
}

function headerValue(headers, name) {
  const lower = String(name).toLowerCase();
  const found = (headers || []).find(([key]) => String(key).toLowerCase() === lower);
  return found && String(found[1]);
}

function responseStatusAllowsBody(status) {
  const value = Number(status);
  return value !== 204 && value !== 205 && value !== 304 && !(value >= 100 && value < 200);
}

function responseIsStructured(method, headers, status = 200) {
  if (String(method).toUpperCase() === 'HEAD' || !responseStatusAllowsBody(status)) return true;
  const contentType = String(headerValue(headers, 'content-type') || '').toLowerCase();
  return contentType.startsWith('text/')
    || contentType.includes('application/json')
    || contentType.includes('+json')
    || contentType.includes('application/xml')
    || contentType.includes('+xml')
    || contentType.includes('application/x-www-form-urlencoded');
}

async function readStructuredResponseText(response, maxBytes) {
  const limit = Number.isSafeInteger(Number(maxBytes)) && Number(maxBytes) > 0 ? Number(maxBytes) : 65_536;
  const declared = Number(response.headers && response.headers.get && response.headers.get('content-length'));
  if (Number.isSafeInteger(declared) && declared > limit) {
    throw new hostRuntime.CanonicalRuntimeError('BodyTooLargeError', 'PULSE_BODY_TOO_LARGE', `Fetched response exceeds the ${limit} byte structured-body limit.`, { bytes: declared, maxBytes: limit });
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value || 0);
      bytes += chunk.byteLength;
      if (bytes > limit) {
        try { await reader.cancel(); } catch (_) { /* best effort */ }
        throw new hostRuntime.CanonicalRuntimeError('BodyTooLargeError', 'PULSE_BODY_TOO_LARGE', `Fetched response exceeds the ${limit} byte structured-body limit.`, { bytes, maxBytes: limit });
      }
      chunks.push(chunk);
    }
  } finally {
    try { reader.releaseLock(); } catch (_) { /* already released */ }
  }
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

async function executeLiveFetch(normalized, fetchImplementation, options = {}) {
  const timeoutMs = Number(normalized.init.timeoutMs);
  const controller = Number.isFinite(timeoutMs) && timeoutMs > 0 ? new AbortController() : undefined;
  const timeout = controller ? setTimeout(() => controller.abort(new Error(`Fetch timed out after ${timeoutMs}ms.`)), timeoutMs) : undefined;
  try {
    const response = await fetchImplementation(normalized.parts.url, {
      method: normalized.init.method,
      headers: normalized.init.headers,
      body: normalized.init.body,
      signal: controller && controller.signal,
      redirect: 'follow'
    });
    const headers = responseHeaders(response);
    const responseMode = normalized.responseMode || 'auto';
    const structured = responseMode === 'structured'
      || (responseMode === 'auto' && responseIsStructured(normalized.init.method, headers, response.status));
    if (structured) {
      const body = normalized.init.method === 'HEAD' || !responseStatusAllowsBody(response.status)
        ? ''
        : await readStructuredResponseText(response, options.maxFetchBodyBytes || options.maxBodyBytes);
      return { status: response.status, kind: 'text', headers, body };
    }
    const bodyStream = response.body && typeof Readable.fromWeb === 'function' ? Readable.fromWeb(response.body) : response.body;
    return { status: response.status, kind: 'stream', headers, bodyStream };
  } catch (error) {
    if ((controller && controller.signal.aborted) || error && error.name === 'AbortError') {
      throw new hostRuntime.CanonicalRuntimeError('FetchTimeoutError', 'PULSE_FETCH_TIMEOUT', 'Live Node fetch exceeded the configured timeout.', { effectId: normalized.id, url: normalized.parts.url, timeoutMs });
    }
    if (error instanceof hostRuntime.CanonicalRuntimeError) throw error;
    throw new hostRuntime.CanonicalRuntimeError('FetchNetworkError', 'PULSE_FETCH_NETWORK', `Live Node fetch failed for ${normalized.init.method} ${normalized.parts.url}.`, { effectId: normalized.id, url: normalized.parts.url, message: error && error.message ? error.message : String(error) });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function fixtureBodyChunks(snapshot) {
  const stream = snapshot && snapshot.bodyStream;
  if (stream && Array.isArray(stream.chunks)) return stream.chunks;
  if (Array.isArray(snapshot && snapshot.chunks)) return snapshot.chunks;
  if (typeof stream === 'string' || Buffer.isBuffer(stream) || stream instanceof Uint8Array) return [stream];
  return undefined;
}

function structuredFixtureResponse(snapshot, normalized, options = {}) {
  const status = Number(snapshot.status || 0);
  if (normalized.init.method === 'HEAD' || !responseStatusAllowsBody(status)) {
    return { ...snapshot, kind: 'text', bodyClass: 'structured', body: '', bodyStream: undefined, bodyHandle: undefined };
  }
  if (snapshot.kind !== 'stream' && snapshot.bodyClass !== 'opaque' && snapshot.bodyStream === undefined && snapshot.bodyHandle === undefined) {
    return snapshot;
  }
  const chunks = fixtureBodyChunks(snapshot);
  if (!chunks) {
    throw new hostRuntime.CanonicalRuntimeError(
      'OpaqueBodyInspectionError',
      'PULSE_OPAQUE_BODY_INSPECTION',
      'The configured Node fetch fixture is pass-through only and cannot satisfy an explicit structured projection.',
      { effectId: normalized.id, url: normalized.parts.url, bodyCopiedIntoWasm: false }
    );
  }
  const buffers = chunks.map((chunk) => Buffer.isBuffer(chunk)
    ? chunk
    : chunk instanceof Uint8Array
      ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      : Buffer.from(String(chunk)));
  const bytes = buffers.reduce((total, chunk) => total + chunk.byteLength, 0);
  const configured = Number(options.maxFetchBodyBytes || options.maxBodyBytes);
  const maxBytes = Number.isSafeInteger(configured) && configured > 0 ? configured : 65_536;
  if (bytes > maxBytes) {
    throw new hostRuntime.CanonicalRuntimeError(
      'BodyTooLargeError',
      'PULSE_BODY_TOO_LARGE',
      `Fetched response exceeds the ${maxBytes} byte structured-body limit.`,
      { effectId: normalized.id, bytes, maxBytes }
    );
  }
  return {
    ...snapshot,
    kind: 'text',
    bodyClass: 'structured',
    body: Buffer.concat(buffers).toString('utf8'),
    bodyStream: undefined,
    bodyHandle: undefined
  };
}

function opaqueFixtureResponse(snapshot, normalized) {
  const status = Number(snapshot.status || 0);
  if (snapshot.kind === 'stream' || snapshot.bodyClass === 'opaque' || snapshot.bodyStream !== undefined || snapshot.bodyHandle !== undefined) return snapshot;
  const allowsBody = normalized.init.method !== 'HEAD' && responseStatusAllowsBody(status);
  const body = allowsBody && snapshot.body !== undefined && snapshot.body !== null ? snapshot.body : undefined;
  return {
    ...snapshot,
    kind: 'stream',
    bodyClass: 'opaque',
    body: undefined,
    bodyStream: body === undefined ? undefined : { chunks: [body] }
  };
}

function responseForMode(snapshot, normalized, options = {}) {
  if (normalized.responseMode === 'structured') return structuredFixtureResponse(snapshot, normalized, options);
  if (normalized.responseMode === 'opaque') return opaqueFixtureResponse(snapshot, normalized);
  return snapshot;
}

function minimalEffectPlan(metadata = {}) {
  return {
    version: handlerEffectContract.ROUTE_HANDLER_EFFECT_PLAN_VERSION,
    routes: [{ routeId: `canonical:${path.basename(metadata.file || 'app')}`, method: '*', path: '*', handlerName: '__pulse_handler', resolves: [] }],
    continuations: (metadata.continuationSites || []).map((site) => ({ name: site.id, resultAccesses: [], responseMethodCalls: [] }))
  };
}

function effectToProviderEffect(normalized) {
  return Object.freeze({
    kind: 'backend-fetch',
    name: normalized.id,
    backend: normalized.parts.origin,
    request: Object.freeze({
      method: normalized.init.method,
      path: Object.freeze({ kind: 'literal', value: normalized.parts.path }),
      headers: Object.freeze(normalized.init.headers.map(([name, value]) => Object.freeze({ name, value: Object.freeze({ kind: 'literal', value }) }))),
      body: normalized.init.body
    })
  });
}

function createNodeProviderAdapter(baseOptions = {}) {
  const kvExecutions = new Map();
  const sharedKv = baseOptions.kvReference || createNodeKvReference(baseOptions);
  const verifyNativeJwt = createNodeNativeJwtVerify({
    captureWallClock: baseOptions.captureJwtWallClock,
    secretLookup(name, executionOptions) {
      return portableRuntimeHost.normalizeBindingValue(
        'secret.get',
        name,
        bindingValue(executionOptions, 'secrets', name),
        bindingOptions(executionOptions)
      );
    }
  });

  function recordEntries(input, label) {
    if (input === undefined || input === null) return [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new hostRuntime.CanonicalRuntimeError(
        'BindingRecordError',
        'PULSE_BINDING_RECORD_INVALID',
        `Pulse Node ${label} must be an object record.`,
        { label, valueType: input === null ? 'null' : typeof input }
      );
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new hostRuntime.CanonicalRuntimeError(
        'BindingRecordError',
        'PULSE_BINDING_RECORD_INVALID',
        `Pulse Node ${label} must be an ordinary object record.`,
        { label, prototype: prototype && prototype.constructor && prototype.constructor.name || 'null' }
      );
    }
    const entries = [];
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string') {
        throw new hostRuntime.CanonicalRuntimeError(
          'BindingRecordError',
          'PULSE_BINDING_RECORD_INVALID',
          `Pulse Node ${label} may not contain symbol keys.`,
          { label }
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !descriptor.enumerable) continue;
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new hostRuntime.CanonicalRuntimeError(
          'BindingRecordError',
          'PULSE_BINDING_RECORD_INVALID',
          `Pulse Node ${label} may only contain enumerable data properties.`,
          { label, key }
        );
      }
      entries.push([key, descriptor.value]);
    }
    return entries;
  }

  function valuesFor(executionOptions, key) {
    const source = executionOptions[key] !== undefined ? executionOptions[key] : baseOptions[key];
    return source && typeof source === 'object' ? source : {};
  }

  function bindingValue(executionOptions, key, name) {
    const values = valuesFor(executionOptions, key);
    const descriptor = Object.getOwnPropertyDescriptor(values, name);
    if (!descriptor) return undefined;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new hostRuntime.CanonicalRuntimeError(
        'BindingValueError',
        'PULSE_BINDING_VALUE_INVALID',
        `Pulse ${key === 'secrets' ? 'secret' : 'config'} providers must expose data properties.`,
        { bindingKind: key === 'secrets' ? 'secret' : 'config', valueType: 'accessor' }
      );
    }
    return descriptor.value;
  }

  function bindingOptions(executionOptions) {
    return {
      maxBindingNameBytes: executionOptions.maxBindingNameBytes ?? baseOptions.maxBindingNameBytes,
      maxBindingValueBytes: executionOptions.maxBindingValueBytes ?? baseOptions.maxBindingValueBytes,
      maxKvNamespaceBytes: executionOptions.maxKvNamespaceBytes ?? baseOptions.maxKvNamespaceBytes,
      maxKvKeyBytes: executionOptions.maxKvKeyBytes ?? baseOptions.maxKvKeyBytes,
      maxKvValueBytes: executionOptions.maxKvValueBytes ?? baseOptions.maxKvValueBytes,
      maxKvValueDepth: executionOptions.maxKvValueDepth ?? baseOptions.maxKvValueDepth,
      maxKvValueEntries: executionOptions.maxKvValueEntries ?? baseOptions.maxKvValueEntries
    };
  }

  function kvReferenceFor(executionOptions) {
    if (executionOptions.kvReference) return executionOptions.kvReference;
    if (!Object.prototype.hasOwnProperty.call(executionOptions, 'kv') || executionOptions.kv === baseOptions.kv) return sharedKv;
    const executionId = String(executionOptions.executionId || 'default');
    if (!kvExecutions.has(executionId)) kvExecutions.set(executionId, createNodeKvReference({ ...baseOptions, ...executionOptions, ...bindingOptions(executionOptions) }));
    return kvExecutions.get(executionId);
  }
  function kvStoresFor(executionOptions) { return kvReferenceFor(executionOptions).legacyStores(); }

  async function dispatchFetch(normalized, executionOptions = {}) {
    const fetchFixtures = normalizeFetchFixtures(executionOptions.fetches || baseOptions.fetches);
    const providerData = buildProviderBackends(fetchFixtures);
    const fixture = providerData.specs.get(`${normalized.init.method} ${normalized.parts.url}`) || providerData.specs.get(normalized.parts.url);
    const liveFetchEnabled = executionOptions.liveFetch === true || baseOptions.liveFetch === true || typeof executionOptions.fetchImplementation === 'function' || typeof baseOptions.fetchImplementation === 'function';
    if (!fixture && liveFetchEnabled) {
      const fetchImplementation = executionOptions.fetchImplementation || baseOptions.fetchImplementation || globalThis.fetch;
      if (typeof fetchImplementation !== 'function') throw new hostRuntime.CanonicalRuntimeError('FetchNetworkError', 'PULSE_FETCH_NETWORK', 'Live Node fetch is unavailable in this runtime.', { effectId: normalized.id, url: normalized.parts.url });
      return executeLiveFetch(normalized, fetchImplementation, executionOptions);
    }
    if (!fixture) throw new hostRuntime.CanonicalRuntimeError('FetchNetworkError', 'PULSE_FETCH_NETWORK', `No Node provider fixture is configured for ${normalized.init.method} ${normalized.parts.url}.`, { effectId: normalized.id, url: normalized.parts.url });
    if (fixture.kind === 'network-error') throw new hostRuntime.CanonicalRuntimeError('FetchNetworkError', 'PULSE_FETCH_NETWORK', 'Node provider fixture produced a network failure.', { effectId: normalized.id, url: normalized.parts.url });
    if (fixture.kind === 'timeout') throw new hostRuntime.CanonicalRuntimeError('FetchTimeoutError', 'PULSE_FETCH_TIMEOUT', 'Node provider fixture exceeded the fetch timeout.', { effectId: normalized.id, url: normalized.parts.url });
    const delayMs = Math.max(0, Number(fixture.delayMs) || 0);
    const timeoutMs = Number(normalized.init.timeoutMs);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0 && delayMs > timeoutMs) {
      await delay(timeoutMs);
      throw new hostRuntime.CanonicalRuntimeError('FetchTimeoutError', 'PULSE_FETCH_TIMEOUT', 'Node provider fixture exceeded the fetch timeout.', { effectId: normalized.id, url: normalized.parts.url, timeoutMs, delayMs });
    }
    if (delayMs > 0) await delay(delayMs);
    const provider = routeHandlerEffects.createNodeRouteHandlerEffectProvider({ plan: minimalEffectPlan(executionOptions.metadata), backends: providerData.backends });
    const handle = provider.executeFetch(effectToProviderEffect(normalized), { route: provider.plan.routes[0] });
    let snapshot = handle;
    if (handle && typeof handle.toJSON === 'function') {
      snapshot = { ...handle.toJSON() };
      if (handle.bodyStream !== undefined) snapshot.bodyStream = handle.bodyStream;
      if (handle.body !== undefined) snapshot.body = handle.body;
    }
    return responseForMode(snapshot, normalized, executionOptions);
  }

  return Object.freeze({
    prepareConditionalKv(effect, execution) { return kvReferenceFor(execution).prepareConditionalKv(effect, execution); },
    id: 'node',
    version: CANONICAL_NODE_RUNTIME_VERSION,
    createCapabilities() { return {}; },
    resultMetadata({ metadata }) {
      return providerContract.createProviderLoweringPlan(metadata, NODE_PROVIDER_DESCRIPTOR, {});
    },
    dispatchFetch,
    async dispatchEffect(effect, executionOptions = {}) {
      if (['s3.head', 's3.getText', 's3.putText'].includes(effect.kind)) {
        return require('./s3-reader.js').readS3(effect, { ...baseOptions, ...executionOptions,
          fetchImplementation: executionOptions.s3FetchImplementation || baseOptions.s3FetchImplementation
            || executionOptions.fetchImplementation || baseOptions.fetchImplementation
        }, (name) => bindingValue(executionOptions, 'secrets', name));
      }
      if (effect.kind === 'fetch') return dispatchFetch(effect, executionOptions);
      if (effect.kind === 'jwt.verify') return verifyNativeJwt(effect, executionOptions);
      if (effect.kind === 'grip.broadcast') {
        const grip = executionOptions.grip || baseOptions.grip || {};
        const broadcast = createNodeJavascriptGripBroadcast({
          ...grip,
          fetchImplementation: executionOptions.fetchImplementation
            || baseOptions.fetchImplementation
            || fixtureFetchImplementation(executionOptions.fetches || baseOptions.fetches),
          secretLookup: (name) => bindingValue(executionOptions, 'secrets', name)
        });
        return broadcast(effect.payload, { signal: executionOptions.signal });
      }
      if (effect.kind === 'config.get') {
        return portableRuntimeHost.normalizeBindingValue(
          'config.get',
          effect.name,
          bindingValue(executionOptions, 'config', effect.name),
          bindingOptions(executionOptions)
        );
      }
      if (effect.kind === 'secret.get') {
        return portableRuntimeHost.normalizeBindingValue(
          'secret.get',
          effect.name,
          bindingValue(executionOptions, 'secrets', effect.name),
          bindingOptions(executionOptions)
        );
      }
      if (effect.kind === 'kv.get' || effect.kind === 'kv.put') {
        const namespace = portableRuntimeHost.normalizeKvNamespace(effect.store, bindingOptions(executionOptions));
        const store = kvReferenceFor(executionOptions).kv(namespace);
        return effect.kind === 'kv.get' ? store.get(effect.key) : store.put(effect.key, effect.value);
      }
      if (effect.kind === 'event.emit') {
        const eventAdapter = executionOptions.eventAdapter || baseOptions.eventAdapter;
        if (!eventAdapter || typeof eventAdapter.acceptOutbound !== 'function') {
          throw new hostRuntime.CanonicalRuntimeError(
            'ProviderCapabilityError',
            'PULSE_PROVIDER_CAPABILITY_UNSUPPORTED',
            'Node provider event.emit requires an invocation-scoped event adapter.',
            { provider: 'node', kind: effect.kind, effectId: effect.id }
          );
        }
        return eventAdapter.acceptOutbound(effect.frame, executionOptions);
      }
      if (effect.kind === 'assets.lookup') {
        return assetResponse(effect.payload || {}, kvStoresFor(executionOptions));
      }
      throw new hostRuntime.CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_PROVIDER_CAPABILITY_UNSUPPORTED', `Node provider does not implement ${effect.kind}.`, { provider: 'node', kind: effect.kind, effectId: effect.id });
    },
    disposeExecution({ executionId } = {}) {
      kvExecutions.delete(String(executionId || 'default'));
    }
  });
}

function createCanonicalNodeRuntime(options = {}) {
  return hostRuntime.createCanonicalHostRuntime({
    ...options,
    runtimeVersion: CANONICAL_NODE_RUNTIME_VERSION,
    providerAdapter: createNodeProviderAdapter(options)
  });
}

async function executeCanonicalProgram(programModule, options = {}) {
  return createCanonicalNodeRuntime(options).execute(programModule, options);
}

async function executeNodeNativeEvent(compiled, frame, options = {}) {
  if (options.providerAdapter !== undefined && options.eventAdapter !== undefined) {
    throw new TypeError('Pulse Node Native event execution cannot combine providerAdapter and eventAdapter.');
  }
  return nativeHost.executeCanonicalNativeEvent(compiled, frame, {
    ...options,
    providerAdapter: options.providerAdapter || createNodeProviderAdapter(options)
  });
}

module.exports = {
  CANONICAL_NODE_RUNTIME_VERSION,
  CANONICAL_RUNTIME_PROTOCOL_VERSION: hostRuntime.CANONICAL_RUNTIME_PROTOCOL_VERSION,
  CANONICAL_EFFECT_PROTOCOL_VERSION: hostRuntime.CANONICAL_EFFECT_PROTOCOL_VERSION,
  NODE_PROVIDER_DESCRIPTOR,
  CanonicalRuntimeError: hostRuntime.CanonicalRuntimeError,
  assertCanonicalProgramCompatibility: hostRuntime.assertCanonicalProgramCompatibility,
  createCanonicalNodeRuntime,
  executeCanonicalProgram,
  executeNodeNativeEvent,
  createNodeProviderAdapter,
  createCanonicalContext: hostRuntime.createCanonicalContext,
  normalizeFetchResponse: hostRuntime.normalizeFetchResponse,
  finalResponse: hostRuntime.finalResponse,
  redactedHeaders: hostRuntime.redactedHeaders,
  executeLiveFetch,
  responseIsStructured,
  responseForMode
};
