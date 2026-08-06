'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');
const { executeFastlyJavascriptApplication } = require('./runtime-host.js');

const FASTLY_JAVASCRIPT_LIFECYCLE_VERSION = 'pulse.fastly-javascript-lifecycle.v1';

function requestForInput(input) {
  if (input instanceof Request) return input;
  if (input && input.request instanceof Request) return input.request;
  throw new TypeError('Pulse Fastly JavaScript lifecycle requires a FetchEvent or Web Request.');
}

function safeFailureResponse() {
  return new Response('Internal Server Error', {
    status: 500,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  });
}

function createFastlyJavascriptHandler(application, options = {}) {
  const normalizedApplication = runtimeHost.normalizeApplication(application);
  return async function pulseFastlyJavascriptHandler(input) {
    try {
      const request = requestForInput(input);
      return await executeFastlyJavascriptApplication(normalizedApplication, request, {
        ...options,
        signal: options.signal || request.signal
      });
    } catch (error) {
      if (typeof options.onError === 'function') {
        try { options.onError(error); } catch (_) { /* Lifecycle evidence is best effort. */ }
      }
      return safeFailureResponse();
    }
  };
}

function installFastlyJavascriptApplication(application, options = {}) {
  const handler = createFastlyJavascriptHandler(application, options);
  const addEventListener = options.addEventListener || globalThis.addEventListener;
  if (typeof addEventListener !== 'function') {
    throw new TypeError('Pulse Fastly JavaScript lifecycle requires addEventListener.');
  }
  addEventListener('fetch', (event) => event.respondWith(handler(event)));
  return handler;
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_LIFECYCLE_VERSION,
  createFastlyJavascriptHandler,
  installFastlyJavascriptApplication,
  requestForInput,
  safeFailureResponse
});
