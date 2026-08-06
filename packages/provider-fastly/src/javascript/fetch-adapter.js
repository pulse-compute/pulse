'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');
const { fastlyJavascriptProviderError, isPulseRuntimeError } = require('./errors.js');

const FASTLY_JAVASCRIPT_FETCH_ADAPTER_VERSION = 'pulse.fastly-javascript-fetch-adapter.v1';

function normalizeOrigin(url) {
  try {
    const parsed = new URL(String(url));
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('unsupported protocol');
    return parsed.origin;
  } catch (error) {
    throw fastlyJavascriptProviderError(
      'PULSE_FASTLY_FETCH_URL_INVALID',
      'Fastly JavaScript fetch requires an absolute HTTP or HTTPS URL.',
      { url: String(url) },
      error
    );
  }
}

function createFastlyJavascriptFetchCapability(options = {}) {
  const implementation = options.fetchImplementation;
  const bindings = options.bindings && typeof options.bindings === 'object' ? options.bindings : {};
  const backends = bindings.backends && typeof bindings.backends === 'object' ? bindings.backends : {};
  const dynamicBackends = bindings.dynamicBackends === true;

  return async function fastlyJavascriptFetch(url, init = {}, execution = {}) {
    if (typeof implementation !== 'function') {
      throw fastlyJavascriptProviderError(
        'PULSE_FASTLY_FETCH_IMPLEMENTATION_UNAVAILABLE',
        'Fastly JavaScript fetch is unavailable.',
        { capability: 'fetch' }
      );
    }
    const origin = normalizeOrigin(url);
    const configuredBackend = typeof backends[origin] === 'string' ? backends[origin].trim() : '';
    if (!configuredBackend && !dynamicBackends) {
      throw fastlyJavascriptProviderError(
        'PULSE_FASTLY_FETCH_BACKEND_REQUIRED',
        'Fastly JavaScript fetch requires an origin-to-backend mapping unless dynamic backends are enabled.',
        { origin, configuration: `bindings.backends.${origin}`, dynamicBackends: false }
      );
    }

    const requestInit = {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: execution.signal || init.signal,
      redirect: 'follow',
      ...(configuredBackend ? { backend: configuredBackend } : {})
    };
    try {
      const response = await implementation(String(url), requestInit);
      if (!(response instanceof Response) && !runtimeHost.isPulseFetchResponse(response)) {
        throw fastlyJavascriptProviderError(
          'PULSE_FASTLY_FETCH_RESPONSE_INVALID',
          'Fastly JavaScript fetch must resolve to a Web Response.',
          { origin, type: typeof response }
        );
      }
      return response;
    } catch (error) {
      if (isPulseRuntimeError(error)) throw error;
      if (requestInit.signal && requestInit.signal.aborted) {
        const reason = requestInit.signal.reason;
        if (reason instanceof Error) throw reason;
      }
      throw fastlyJavascriptProviderError(
        'PULSE_FASTLY_FETCH_NETWORK',
        'Fastly JavaScript fetch failed.',
        { origin, method: String(init.method || 'GET').toUpperCase() },
        error
      );
    }
  };
}

function withFastlyFetchCapability(capabilities, options = {}) {
  const base = capabilities && typeof capabilities === 'object' ? capabilities : {};
  return Object.freeze({
    ...base,
    ...(typeof base.fetch === 'function' ? {} : { fetch: createFastlyJavascriptFetchCapability(options) })
  });
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_FETCH_ADAPTER_VERSION,
  createFastlyJavascriptFetchCapability,
  withFastlyFetchCapability
});
