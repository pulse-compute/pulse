'use strict';

const { Readable } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');
const hostRuntime = require('@pulse-compute/wasm-host-runtime/runtime/canonical-api-runtime');
const { createFastlyProviderPrimitiveSurface } = require('./provider-primitives.js');
const { FASTLY_PROVIDER_DESCRIPTOR, createFastlyLoweringPlan } = require('../provider-contract.js');

const CANONICAL_FASTLY_RUNTIME_VERSION = 'pulse.canonical-fastly-runtime.v3';

function normalizeHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) return headers.map(([name, value]) => [String(name), String(value)]);
  if (typeof headers.entries === 'function') return [...headers.entries()].map(([name, value]) => [String(name), String(value)]);
  return Object.entries(headers).flatMap(([name, value]) => Array.isArray(value) ? value.map((entry) => [String(name), String(entry)]) : [[String(name), String(value)]]);
}

function headerValue(headers, name) {
  const lower = String(name).toLowerCase();
  const found = (headers || []).find(([key]) => String(key).toLowerCase() === lower);
  return found && String(found[1]);
}

function responseIsStructured(method, headers) {
  if (String(method).toUpperCase() === 'HEAD') return true;
  const contentType = String(headerValue(headers, 'content-type') || '').toLowerCase();
  return contentType.startsWith('text/')
    || contentType.includes('application/json')
    || contentType.includes('+json')
    || contentType.includes('application/xml')
    || contentType.includes('+xml')
    || contentType.includes('application/x-www-form-urlencoded');
}

function normalizeFetchFixtures(fetches = {}) {
  return fetches instanceof Map ? new Map(fetches) : new Map(Object.entries(fetches || {}));
}

function responseSpec(input = {}) {
  const spec = input && typeof input === 'object' ? input : { body: input };
  if (spec.opaque || spec.kind === 'stream' || spec.bodyStream !== undefined || spec.bodyHandle !== undefined) {
    return {
      status: Number(Object.prototype.hasOwnProperty.call(spec, 'status') ? spec.status : 200),
      kind: 'stream',
      bodyClass: 'opaque',
      headers: normalizeHeaders(spec.headers || [['content-type', 'application/octet-stream']]),
      bodyStream: spec.bodyStream || { chunks: Array.isArray(spec.chunks) ? [...spec.chunks] : [] },
      bodyHandle: spec.bodyHandle,
      responseRef: spec.responseRef,
      streamRef: spec.streamRef,
      providerSource: 'fastly'
    };
  }
  const body = Object.prototype.hasOwnProperty.call(spec, 'body') ? spec.body : JSON.stringify(Object.prototype.hasOwnProperty.call(spec, 'value') ? spec.value : {});
  return {
    status: Number(Object.prototype.hasOwnProperty.call(spec, 'status') ? spec.status : 200),
    kind: spec.kind || 'text',
    bodyClass: 'structured',
    headers: normalizeHeaders(spec.headers || [['content-type', 'application/json; charset=utf-8']]),
    body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
    providerSource: 'fastly'
  };
}

function fixtureWebResponse(spec = {}, method = 'GET') {
  const response = responseSpec(spec);
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
  const fixtures = normalizeFetchFixtures(fetches);
  return async function fastlyCanonicalFixtureFetch(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    const fixture = fixtures.get(`${method} ${String(url)}`) || fixtures.get(String(url));
    if (!fixture) throw new Error(`No Fastly provider fixture is configured for ${method} ${String(url)}.`);
    if (fixture.kind === 'network-error') throw new Error('Fastly provider fixture produced a network failure.');
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

async function readBoundedResponseText(response, maxBytes) {
  const contentLength = Number(response.headers && response.headers.get && response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new hostRuntime.CanonicalRuntimeError(
      'ProviderCapabilityError',
      'PULSE_GRIP_BROADCAST_RESPONSE_TOO_LARGE',
      'Fastly GRIP broadcast response exceeded its configured byte limit.',
      { provider: 'fastly', maxResponseBytes: maxBytes }
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new hostRuntime.CanonicalRuntimeError(
          'ProviderCapabilityError',
          'PULSE_GRIP_BROADCAST_RESPONSE_TOO_LARGE',
          'Fastly GRIP broadcast response exceeded its configured byte limit.',
          { provider: 'fastly', maxResponseBytes: maxBytes }
        );
      }
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function executeLocalLiveFetch(normalized, fetchImplementation) {
  const timeoutMs = Number(normalized.init.timeoutMs);
  const controller = Number.isFinite(timeoutMs) && timeoutMs > 0 ? new AbortController() : undefined;
  const timeout = controller ? setTimeout(() => controller.abort(new Error(`Fetch timed out after ${timeoutMs}ms.`)), timeoutMs) : undefined;
  try {
    const response = await fetchImplementation(normalized.parts.url, {
      method: normalized.init.method,
      headers: normalized.init.headers,
      body: ['GET', 'HEAD'].includes(normalized.init.method) ? undefined : normalized.init.body,
      signal: controller && controller.signal,
      redirect: 'follow'
    });
    const headers = responseHeaders(response);
    if (responseIsStructured(normalized.init.method, headers)) {
      return { status: response.status, kind: 'text', bodyClass: 'structured', headers, body: normalized.init.method === 'HEAD' ? '' : await response.text(), providerSource: 'fastly' };
    }
    return {
      status: response.status,
      kind: 'stream',
      bodyClass: 'opaque',
      headers,
      bodyStream: response.body && typeof Readable.fromWeb === 'function' ? Readable.fromWeb(response.body) : response.body,
      responseRef: response,
      providerSource: 'fastly'
    };
  } catch (error) {
    if ((controller && controller.signal.aborted) || error && error.name === 'AbortError') {
      throw new hostRuntime.CanonicalRuntimeError('FetchTimeoutError', 'PULSE_FETCH_TIMEOUT', 'Fastly local fetch exceeded the configured timeout.', { effectId: normalized.id, url: normalized.parts.url, timeoutMs });
    }
    if (error instanceof hostRuntime.CanonicalRuntimeError) throw error;
    throw new hostRuntime.CanonicalRuntimeError('FetchNetworkError', 'PULSE_FETCH_NETWORK', `Fastly local fetch failed for ${normalized.init.method} ${normalized.parts.url}.`, { effectId: normalized.id, url: normalized.parts.url, message: error && error.message ? error.message : String(error) });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function valueMap(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function gripBound(value, fallback, field, effectId) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new hostRuntime.CanonicalRuntimeError(
      'ProviderCapabilityError',
      'PULSE_GRIP_BROADCAST_CAPABILITY_REQUIRED',
      `Fastly GRIP broadcast ${field} must be a positive safe integer.`,
      { provider: 'fastly', effectId, configuration: `grip.${field}` }
    );
  }
  return number;
}

function gripBroadcastBody(payload, effectId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new hostRuntime.CanonicalRuntimeError(
      'ProviderCapabilityError',
      'PULSE_GRIP_BROADCAST_MESSAGE_INVALID',
      'Fastly GRIP broadcast requires a structured message.',
      { provider: 'fastly', effectId }
    );
  }
  const channel = typeof payload.channel === 'string' ? payload.channel.trim() : '';
  if (!channel || /[,\r\n]/.test(channel)) {
    throw new hostRuntime.CanonicalRuntimeError(
      'ProviderCapabilityError',
      'PULSE_GRIP_BROADCAST_CHANNEL_INVALID',
      'Fastly GRIP broadcast channel must be a non-empty string without commas or line breaks.',
      { provider: 'fastly', effectId }
    );
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'data') || payload.data === undefined) {
    throw new hostRuntime.CanonicalRuntimeError(
      'ProviderCapabilityError',
      'PULSE_GRIP_BROADCAST_MESSAGE_INVALID',
      'Fastly GRIP broadcast requires a JSON-compatible data value.',
      { provider: 'fastly', effectId }
    );
  }
  try {
    const body = JSON.stringify({
      channel,
      data: payload.data,
      ...(payload.event === undefined ? {} : { event: String(payload.event) }),
      ...(payload.id === undefined ? {} : { id: String(payload.id) })
    });
    if (typeof body !== 'string') throw new TypeError('not JSON serializable');
    return body;
  } catch {
    throw new hostRuntime.CanonicalRuntimeError(
      'ProviderCapabilityError',
      'PULSE_GRIP_BROADCAST_MESSAGE_INVALID',
      'Fastly GRIP broadcast message must be JSON-compatible.',
      { provider: 'fastly', effectId }
    );
  }
}

function createFastlyProviderAdapter(baseOptions = {}) {
  const states = new Map();
  const bindings = baseOptions.bindings || {};

  function physicalKvName(logical) {
    const key = String(logical);
    return bindings.kv && bindings.kv[key] ? String(bindings.kv[key]) : key;
  }

  function stateFor(executionOptions = {}) {
    const id = String(executionOptions.executionId || 'default');
    if (!states.has(id)) {
      const config = valueMap(executionOptions.config || baseOptions.config);
      const secrets = valueMap(executionOptions.secrets || baseOptions.secrets);
      const inputKv = valueMap(executionOptions.kv || baseOptions.kv);
      const physicalKv = {};
      for (const [logical, entries] of Object.entries(inputKv)) {
        const physical = physicalKvName(logical);
        physicalKv[physical] = { ...(physicalKv[physical] || {}), ...valueMap(entries) };
      }
      for (const [logical, physical] of Object.entries(bindings.kv || {})) {
        if (inputKv[physical]) physicalKv[physical] = { ...(physicalKv[physical] || {}), ...valueMap(inputKv[physical]) };
        if (inputKv[logical]) physicalKv[physical] = { ...(physicalKv[physical] || {}), ...valueMap(inputKv[logical]) };
      }
      const surface = createFastlyProviderPrimitiveSurface({
        configStore: bindings.configStore,
        secretStore: bindings.secretStore,
        kvStore: 'pulse_kv',
        configValues: config,
        secretValues: secrets,
        kvStores: physicalKv
      });
      const grip = {
        channels: [],
        holds: [],
        publishes: [],
        broadcasts: []
      };
      states.set(id, Object.freeze({ surface, config, secrets, physicalKv, grip }));
    }
    return states.get(id);
  }

  async function dispatchFetch(normalized, executionOptions = {}) {
    const state = stateFor(executionOptions);
    const mappedBackend = bindings.backends && bindings.backends[normalized.parts.origin];
    state.surface.fetch({ url: normalized.parts.url, method: normalized.init.method, headers: normalized.init.headers, body: normalized.init.body, timeoutMs: normalized.init.timeoutMs, backend: mappedBackend });
    const fixtures = normalizeFetchFixtures(executionOptions.fetches || baseOptions.fetches);
    const fixture = fixtures.get(`${normalized.init.method} ${normalized.parts.url}`) || fixtures.get(normalized.parts.url);
    const liveFetchEnabled = executionOptions.liveFetch === true || baseOptions.liveFetch === true || typeof executionOptions.fetchImplementation === 'function' || typeof baseOptions.fetchImplementation === 'function';
    if (!fixture && liveFetchEnabled) {
      const implementation = executionOptions.fetchImplementation || baseOptions.fetchImplementation || globalThis.fetch;
      if (typeof implementation !== 'function') throw new hostRuntime.CanonicalRuntimeError('FetchNetworkError', 'PULSE_FETCH_NETWORK', 'Fastly local fetch implementation is unavailable.', { effectId: normalized.id, url: normalized.parts.url });
      return executeLocalLiveFetch(normalized, implementation);
    }
    if (!fixture) throw new hostRuntime.CanonicalRuntimeError('FetchNetworkError', 'PULSE_FETCH_NETWORK', `No Fastly provider fixture is configured for ${normalized.init.method} ${normalized.parts.url}.`, { effectId: normalized.id, url: normalized.parts.url, backend: mappedBackend });
    if (fixture.kind === 'network-error') throw new hostRuntime.CanonicalRuntimeError('FetchNetworkError', 'PULSE_FETCH_NETWORK', 'Fastly provider fixture produced a network failure.', { effectId: normalized.id, url: normalized.parts.url });
    if (fixture.kind === 'timeout') throw new hostRuntime.CanonicalRuntimeError('FetchTimeoutError', 'PULSE_FETCH_TIMEOUT', 'Fastly provider fixture exceeded the fetch timeout.', { effectId: normalized.id, url: normalized.parts.url });
    const delayMs = Math.max(0, Number(fixture.delayMs) || 0);
    const timeoutMs = Number(normalized.init.timeoutMs);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0 && delayMs > timeoutMs) {
      await delay(timeoutMs);
      throw new hostRuntime.CanonicalRuntimeError('FetchTimeoutError', 'PULSE_FETCH_TIMEOUT', 'Fastly provider fixture exceeded the fetch timeout.', { effectId: normalized.id, url: normalized.parts.url, timeoutMs, delayMs });
    }
    if (delayMs > 0) await delay(delayMs);
    return responseSpec(fixture);
  }

  return Object.freeze({
    id: 'fastly',
    version: CANONICAL_FASTLY_RUNTIME_VERSION,
    // This legacy JavaScript fixture surface has no Native KV host ABI. Keep
    // that absence pre-dispatch/configuration, rather than pretending a failed
    // fixture dispatch might have mutated storage. Real K3 evidence runs Wasm.
    prepareConditionalKv() { return undefined; },
    async dispatchEffect(effect, executionOptions = {}) {
      const state = stateFor(executionOptions);
      if (effect.kind === 'fetch') return dispatchFetch(effect, executionOptions);
      if (effect.kind === 'time.now') return require('@pulse-compute/runtime/host').readWallTime(baseOptions.wallClock === undefined ? () => Date.now() : baseOptions.wallClock);
      if (effect.kind === 'config.get') return state.surface.config.adapter.get(effect.name);
      if (effect.kind === 'secret.get') {
        const secret = state.surface.secret.adapter.get(effect.name);
        return secret && secret.value;
      }
      if (effect.kind === 'kv.get') {
        const result = state.surface.kv.get(physicalKvName(effect.store), effect.key);
        return result.hit ? result.value : undefined;
      }
      if (effect.kind === 'kv.put') return state.surface.kv.put(physicalKvName(effect.store), effect.key, effect.value).valueStored;
      if (effect.kind === 'assets.lookup') {
        const payload = valueMap(effect.payload);
        const result = state.surface.kv.get(physicalKvName(payload.store), payload.key);
        const found = result.hit === true;
        const headers = normalizeHeaders(payload.headers);
        if (!headers.some(([name]) => name.toLowerCase() === 'content-type')) {
          headers.push(['content-type', found ? assetContentType(payload.key) : 'text/plain; charset=utf-8']);
        }
        if (payload.cacheControl !== undefined) headers.push(['cache-control', String(payload.cacheControl)]);
        const method = String(payload.method || 'GET').toUpperCase();
        const body = method === 'HEAD' || !found
          ? ''
          : (typeof result.value === 'string' || Buffer.isBuffer(result.value) || result.value instanceof Uint8Array)
            ? result.value
            : JSON.stringify(result.value);
        return Object.freeze({
          status: found ? 200 : 404,
          kind: 'text',
          bodyClass: 'structured',
          headers: Object.freeze(headers.map((entry) => Object.freeze(entry))),
          body,
          providerSource: 'fastly'
        });
      }
      if (effect.kind === 'grip.channel') {
        const payload = valueMap(effect.payload);
        const declaration = Object.freeze({
          channel: String(payload.channel || ''),
          prefix: payload.prefix === undefined ? undefined : String(payload.prefix),
          fanout: payload.fanout !== false
        });
        if (!declaration.channel) {
          throw new hostRuntime.CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_FASTLY_GRIP_CHANNEL_REQUIRED', 'Fastly GRIP channel declarations require a non-empty channel.', { provider: 'fastly', effectId: effect.id });
        }
        state.grip.channels.push(declaration);
        return Object.freeze({ declared: true, ...declaration });
      }
      if (effect.kind === 'grip.hold') {
        const payload = valueMap(effect.payload);
        const declared = state.grip.channels.map((entry) => entry.prefix ? `${entry.prefix}${entry.channel}` : entry.channel);
        const explicit = Array.isArray(payload.channels) ? payload.channels.map(String) : [];
        const channels = [...new Set([...declared, ...explicit].filter(Boolean))];
        const hold = Object.freeze({
          mode: String(payload.mode || 'stream'),
          channels: Object.freeze(channels),
          timeoutMs: payload.timeoutMs === undefined ? undefined : Number(payload.timeoutMs),
          hostOwned: true
        });
        state.grip.holds.push(hold);
        const gripOptions = valueMap(executionOptions.grip || baseOptions.grip);
        const chunks = Array.isArray(gripOptions.holdChunks)
          ? gripOptions.holdChunks
          : [Buffer.from(String(gripOptions.holdBody || 'pulse-grip-hold'), 'utf8')];
        return responseSpec({
          opaque: true,
          status: Number(gripOptions.holdStatus || 200),
          headers: [
            ['content-type', String(gripOptions.holdContentType || 'application/octet-stream')],
            ['grip-hold', hold.mode],
            ...channels.map((channel) => ['grip-channel', channel]),
            ...(hold.timeoutMs === undefined ? [] : [['grip-timeout', String(Math.max(0, hold.timeoutMs))]])
          ],
          chunks,
          responseRef: Object.freeze({ provider: 'fastly', kind: 'grip-hold', channels, hostOwned: true })
        });
      }
      if (effect.kind === 'grip.publish') {
        const publication = Object.freeze({
          channel: String(effect.payload.channel),
          message: String(effect.payload.message),
          event: effect.payload.event === undefined ? undefined : String(effect.payload.event),
          id: effect.payload.id === undefined ? undefined : String(effect.payload.id)
        });
        state.grip.publishes.push(publication);
        return Object.freeze({
          status: 202,
          kind: 'json',
          bodyClass: 'structured',
          headers: Object.freeze([['content-type', 'application/json; charset=utf-8']]),
          body: JSON.stringify({ published: true, ...publication })
        });
      }
      if (effect.kind === 'grip.broadcast') {
        const gripBindings = valueMap(bindings.grip);
        const endpoint = String(gripBindings.publishEndpoint || '').trim();
        const implementation = executionOptions.fetchImplementation
          || baseOptions.fetchImplementation
          || fixtureFetchImplementation(executionOptions.fetches || baseOptions.fetches);
        if (!endpoint || typeof implementation !== 'function') {
          throw new hostRuntime.CanonicalRuntimeError(
            'ProviderCapabilityError',
            'PULSE_GRIP_BROADCAST_CAPABILITY_REQUIRED',
            'Fastly GRIP broadcast requires an explicit publish endpoint and local provider fetch implementation.',
            { provider: 'fastly', effectId: effect.id }
          );
        }
        try {
          const parsedEndpoint = new URL(endpoint);
          if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) throw new TypeError('unsupported protocol');
        } catch {
          throw new hostRuntime.CanonicalRuntimeError(
            'ProviderCapabilityError',
            'PULSE_GRIP_BROADCAST_ENDPOINT_INVALID',
            'Fastly GRIP broadcast publishEndpoint must be an absolute HTTP or HTTPS URL.',
            { provider: 'fastly', effectId: effect.id }
          );
        }
        const body = gripBroadcastBody(effect.payload, effect.id);
        const maxRequestBytes = gripBound(gripBindings.maxRequestBytes, 65536, 'maxRequestBytes', effect.id);
        if (new TextEncoder().encode(body).byteLength > maxRequestBytes) {
          throw new hostRuntime.CanonicalRuntimeError(
            'ProviderCapabilityError',
            'PULSE_GRIP_BROADCAST_REQUEST_TOO_LARGE',
            'Fastly GRIP broadcast request exceeded its configured byte limit.',
            { provider: 'fastly', effectId: effect.id, maxRequestBytes }
          );
        }
        const headers = new Headers({
          accept: 'application/json',
          'content-type': 'application/json; charset=utf-8'
        });
        const authentication = valueMap(gripBindings.authentication);
        if (authentication.scheme !== undefined && String(authentication.scheme).toLowerCase() !== 'bearer') {
          throw new hostRuntime.CanonicalRuntimeError(
            'ProviderCapabilityError',
            'PULSE_GRIP_BROADCAST_AUTH_SCHEME_UNSUPPORTED',
            'Fastly GRIP broadcast supports only bearer authentication.',
            { provider: 'fastly', effectId: effect.id }
          );
        }
        if (gripBindings.authentication !== undefined && !String(authentication.secretRef || '').trim()) {
          throw new hostRuntime.CanonicalRuntimeError(
            'ProviderCapabilityError',
            'PULSE_GRIP_BROADCAST_SECRET_REFERENCE_REQUIRED',
            'Fastly GRIP bearer authentication requires a named secret reference.',
            { provider: 'fastly', effectId: effect.id }
          );
        }
        if (authentication.secretRef) {
          const secret = state.surface.secret.adapter.get(String(authentication.secretRef));
          if (!secret || typeof secret.value !== 'string' || secret.value.length === 0) {
            throw new hostRuntime.CanonicalRuntimeError(
              'ProviderCapabilityError',
              'PULSE_GRIP_BROADCAST_SECRET_REQUIRED',
              'Fastly GRIP broadcast authentication secret is unavailable.',
              { provider: 'fastly', effectId: effect.id, secretRef: String(authentication.secretRef) }
            );
          }
          headers.set('authorization', `Bearer ${secret.value}`);
        }
        let response;
        let text;
        try {
          response = await implementation(endpoint, {
            method: 'POST',
            headers,
            body,
            signal: executionOptions.signal,
            redirect: 'error'
          });
          if (!(response instanceof Response)) {
            throw new hostRuntime.CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_GRIP_BROADCAST_RESPONSE_INVALID', 'Fastly GRIP broadcast provider must return a Web Response.', { provider: 'fastly', effectId: effect.id });
          }
          text = await readBoundedResponseText(
            response,
            gripBound(gripBindings.maxResponseBytes, 65536, 'maxResponseBytes', effect.id)
          );
        } catch (error) {
          if (error instanceof hostRuntime.CanonicalRuntimeError) throw error;
          if (executionOptions.signal && executionOptions.signal.aborted) {
            throw new hostRuntime.CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_GRIP_BROADCAST_ABORTED', 'Fastly GRIP broadcast was cancelled with its owning request.', { provider: 'fastly', effectId: effect.id });
          }
          throw new hostRuntime.CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_GRIP_BROADCAST_NETWORK', 'Fastly GRIP broadcast provider request failed.', { provider: 'fastly', effectId: effect.id });
        }
        if (response.status < 200 || response.status > 299) {
          throw new hostRuntime.CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_GRIP_BROADCAST_REJECTED', 'Fastly GRIP broadcast provider rejected the publication.', { provider: 'fastly', effectId: effect.id, status: response && response.status });
        }
        let providerAck = {};
        if (text.trim()) {
          try { providerAck = JSON.parse(text); }
          catch {
            throw new hostRuntime.CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_GRIP_BROADCAST_RESPONSE_INVALID', 'Fastly GRIP broadcast provider returned an invalid acknowledgement.', { provider: 'fastly', effectId: effect.id, status: response.status });
          }
        }
        if (!providerAck || typeof providerAck !== 'object' || Array.isArray(providerAck)) {
          throw new hostRuntime.CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_GRIP_BROADCAST_RESPONSE_INVALID', 'Fastly GRIP broadcast provider acknowledgement must be an object.', { provider: 'fastly', effectId: effect.id, status: response.status });
        }
        const ack = Object.freeze({
          accepted: providerAck.accepted !== false,
          status: response.status,
          ...(providerAck.messageId === undefined ? {} : { messageId: String(providerAck.messageId) })
        });
        state.grip.broadcasts.push(Object.freeze({ channel: String(effect.payload.channel), accepted: ack.accepted, status: ack.status }));
        return ack;
      }
      throw new hostRuntime.CanonicalRuntimeError('ProviderCapabilityError', 'PULSE_PROVIDER_CAPABILITY_UNSUPPORTED', `Fastly local runtime does not implement ${effect.kind}.`, { provider: 'fastly', kind: effect.kind, effectId: effect.id });
    },
    disposeExecution({ executionId } = {}) {
      states.delete(String(executionId || 'default'));
    },
    resultMetadata(executionOptions = {}) {
      const state = stateFor(executionOptions);
      return Object.freeze({
        contract: FASTLY_PROVIDER_DESCRIPTOR,
        lowering: createFastlyLoweringPlan(executionOptions.metadata, bindings),
        manifest: state.surface.manifest,
        localConformanceRuntime: true,
        executionMode: 'local-conformance',
        deploymentValidated: false,
        deployable: true,
        providerSpecificUserland: false,
        providerSdkUserland: false,
        grip: Object.freeze({
          channels: Object.freeze([...state.grip.channels]),
          holds: Object.freeze([...state.grip.holds]),
          publishes: Object.freeze([...state.grip.publishes]),
          broadcasts: Object.freeze([...state.grip.broadcasts])
        })
      });
    }
  });
}

function createCanonicalFastlyRuntime(options = {}) {
  return hostRuntime.createCanonicalHostRuntime({
    ...options,
    runtimeVersion: CANONICAL_FASTLY_RUNTIME_VERSION,
    providerAdapter: createFastlyProviderAdapter(options)
  });
}

async function executeCanonicalProgram(programModule, options = {}) {
  return createCanonicalFastlyRuntime(options).execute(programModule, options);
}

module.exports = {
  CANONICAL_FASTLY_RUNTIME_VERSION,
  FASTLY_PROVIDER_DESCRIPTOR,
  createFastlyProviderAdapter,
  createCanonicalFastlyRuntime,
  executeCanonicalProgram,
  executeLocalLiveFetch,
  responseIsStructured,
  responseSpec
};
