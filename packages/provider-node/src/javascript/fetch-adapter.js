'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');

const NODE_JAVASCRIPT_FETCH_ADAPTER_VERSION = 'pulse.node-javascript-fetch-adapter.v1';

function fetchError(code, message, detail, cause) {
  const error = new runtimeHost.PulseRuntimeContractError(code, message, { cause });
  if (detail !== undefined) Object.defineProperty(error, 'detail', { enumerable: false, value: Object.freeze({ ...detail }) });
  return error;
}

function createNodeJavascriptFetchCapability(options = {}) {
  const implementation = options.fetchImplementation;
  return async function nodeJavascriptFetch(url, init = {}, execution = {}) {
    if (typeof implementation !== 'function') {
      throw fetchError(
        'PULSE_FETCH_IMPLEMENTATION_UNAVAILABLE',
        'Node JavaScript fetch is disabled or no provider-owned implementation was supplied.',
        { url: String(url), method: String(init.method || 'GET') }
      );
    }

    try {
      const response = await implementation(String(url), {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: execution.signal,
        redirect: 'follow'
      });
      if (execution.signal?.aborted) {
        if (response instanceof Response && response.body) void response.body.cancel(execution.signal.reason).catch(() => {});
        throw execution.signal.reason;
      }
      if (!(response instanceof Response) && !runtimeHost.isPulseFetchResponse(response)) {
        throw fetchError(
          'PULSE_FETCH_RESPONSE_INVALID',
          'Node JavaScript fetch implementations must resolve to a Web Response or Pulse fetch response.',
          { url: String(url), type: typeof response }
        );
      }
      return response;
    } catch (error) {
      if (error instanceof runtimeHost.PulseRuntimeContractError) throw error;
      if (execution.signal && execution.signal.aborted) {
        const reason = execution.signal.reason;
        if (reason instanceof runtimeHost.PulseRuntimeContractError) throw reason;
        throw reason || error;
      }
      throw fetchError(
        'PULSE_FETCH_NETWORK',
        `Node JavaScript fetch failed for ${String(init.method || 'GET')} ${String(url)}.`,
        { url: String(url), method: String(init.method || 'GET') },
        error
      );
    }
  };
}

function delayWithSignal(ms, signal) {
  const delay = Math.max(0, Number(ms) || 0);
  if (delay === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (callback, value) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason || new DOMException('Aborted', 'AbortError'));
    if (signal && signal.aborted) return onAbort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(resolve), delay);
  });
}

function fixtureHeaderPairs(input, defaultContentType) {
  const pairs = [];
  const hasContentType = () => pairs.some(([name]) => String(name).toLowerCase() === 'content-type');
  if (Array.isArray(input)) {
    for (const pair of input) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError('Node JavaScript fetch fixture headers must be [name, value] pairs.');
      pairs.push([String(pair[0]), String(pair[1])]);
    }
  } else if (input instanceof Headers) {
    for (const [name, value] of input.entries()) pairs.push([name, value]);
    if (typeof input.getSetCookie === 'function') {
      const cookies = input.getSetCookie();
      if (cookies.length > 1) {
        for (let index = pairs.length - 1; index >= 0; index -= 1) {
          if (pairs[index][0].toLowerCase() === 'set-cookie') pairs.splice(index, 1);
        }
        for (const cookie of cookies) pairs.push(['set-cookie', cookie]);
      }
    }
  } else if (input && typeof input === 'object') {
    for (const [name, value] of Object.entries(input)) pairs.push([name, String(value)]);
  }
  if (defaultContentType && !hasContentType()) pairs.push(['content-type', defaultContentType]);
  return Object.freeze(pairs.map(([name, value]) => Object.freeze([name, value])));
}

function fixtureHeaders(pairs) {
  const headers = new Headers();
  for (const [name, value] of pairs) headers.append(name, value);
  return headers;
}

function fixtureKey(fetches, url, method) {
  if (!fetches || typeof fetches !== 'object') return undefined;
  const exact = `${String(method || 'GET').toUpperCase()} ${String(url)}`;
  return Object.prototype.hasOwnProperty.call(fetches, exact) ? exact
    : Object.prototype.hasOwnProperty.call(fetches, String(url)) ? String(url)
      : undefined;
}

function createNodeJavascriptFixtureFetch(fetches = {}, fallback, options = {}) {
  return async function nodeJavascriptFixtureFetch(url, init = {}) {
    const key = fixtureKey(fetches, url, init.method);
    if (key === undefined) {
      if (typeof fallback === 'function') return fallback(url, init);
      throw new Error(`No Node JavaScript fetch fixture is configured for ${String(init.method || 'GET')} ${String(url)}.`);
    }
    const fixture = fetches[key] || {};
    if (fixture.kind === 'network-error' || fixture.networkError === true) {
      throw new Error(fixture.message || 'Configured Node JavaScript fetch network failure.');
    }
    if (fixture.kind === 'timeout' || fixture.timeout === true) {
      await new Promise((_resolve, reject) => {
        const signal = init.signal;
        const onAbort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        if (signal && signal.aborted) onAbort();
        else if (signal) signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    await delayWithSignal(fixture.delayMs, init.signal);

    const status = Number(fixture.status || 200);
    let body = null;
    let defaultContentType;
    if (fixture.opaque === true || Array.isArray(fixture.chunks)) {
      const chunks = Array.isArray(fixture.chunks) ? fixture.chunks : [];
      body = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
          controller.close();
        }
      });
      defaultContentType = 'application/octet-stream';
    } else if (Object.prototype.hasOwnProperty.call(fixture, 'value')) {
      body = JSON.stringify(fixture.value);
      defaultContentType = 'application/json; charset=utf-8';
    } else if (Object.prototype.hasOwnProperty.call(fixture, 'json')) {
      body = JSON.stringify(fixture.json);
      defaultContentType = 'application/json; charset=utf-8';
    } else if (Object.prototype.hasOwnProperty.call(fixture, 'text')) {
      body = String(fixture.text);
      defaultContentType = 'text/plain; charset=utf-8';
    } else if (Object.prototype.hasOwnProperty.call(fixture, 'body')) {
      body = fixture.body == null ? null : fixture.body;
    }
    const headerPairs = fixtureHeaderPairs(fixture.headers, defaultContentType);
    const headers = fixtureHeaders(headerPairs);
    const method = String(init.method || 'GET').toUpperCase();
    const bodyAllowed = method !== 'HEAD'
      && status !== 204
      && status !== 205
      && status !== 304
      && !(status >= 100 && status < 200);
    const response = new Response(bodyAllowed ? body : null, { status, headers });
    if (options.rawResponse === true) return response;
    return runtimeHost.createOpaqueFetchResponse({ response, headers: headerPairs });
  };
}

function withNodeFetchCapability(capabilities, options = {}) {
  const value = capabilities && typeof capabilities === 'object' ? capabilities : {};
  if (typeof value.fetch === 'function') return value;
  return Object.freeze({
    ...value,
    fetch: createNodeJavascriptFetchCapability(options)
  });
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_FETCH_ADAPTER_VERSION,
  createNodeJavascriptFetchCapability,
  createNodeJavascriptFixtureFetch,
  withNodeFetchCapability
});
