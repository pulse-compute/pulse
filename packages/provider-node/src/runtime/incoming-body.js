'use strict';

const host = require('@pulse-compute/runtime/host');
const { createIncomingBody } = require('../javascript/incoming-body.js');
const { createNodeJavascriptFixtureFetch } = require('../javascript/fetch-adapter.js');
const { nodeRequestToWebRequest } = require('../javascript/node-adapter.js');

function forwardingOptions(options) {
  return {
    ...options,
    fetchImplementation: createNodeJavascriptFixtureFetch(options.fetches || {},
      options.fetchImplementation || (options.liveFetch === true ? globalThis.fetch : undefined), { rawResponse: true })
  };
}

async function prepareNativeRequest(request, options) {
  const adapted = await nodeRequestToWebRequest(request, options);
  let incomingBody;
  try {
    incomingBody = createIncomingBody(adapted.request, {
      ...forwardingOptions(options), responseWriterOwnsCompletion: true
    });
  } catch (error) {
    if (adapted.request.body && !adapted.request.body.locked) void adapted.request.body.cancel(error).catch(() => {});
    throw error;
  }
  return Object.freeze({
    request: { method: adapted.method, url: adapted.request.url, headers: adapted.headerPairs },
    options: { incomingBody },
    get signal() { return incomingBody.responseSignal || options.signal; },
    close() { return incomingBody.close(); }
  });
}

async function executeNativeWithIncomingBody(native, options) {
  const { executeCanonicalNativeModule } = require('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host');
  if (!native.plan.capabilities.includes('request.body.forward')) return executeCanonicalNativeModule(native, options);
  if (!options.bodyForwarding) throw new host.PulseRuntimeContractError('PULSE_REQUEST_FORWARDING_UNAVAILABLE', 'Node Native forwarding requires node.bodyForwarding.');
  const forwardedBodies = new Set();
  let incomingBody = options.incomingBody, result;
  if (!incomingBody) {
    const input = options.request || {};
    const method = input.method || 'GET';
    const request = new Request(input.url || 'http://pulse.local' + (input.path || '/'), {
      method, headers: input.headers,
      ...(!['GET','HEAD'].includes(method) && input.body !== undefined ? {body:input.body,duplex:'half'} : {})
    });
    incomingBody = createIncomingBody(request, forwardingOptions(options));
  }
  try {
    result = await executeCanonicalNativeModule(native, { ...options, incomingBody, forwardedBodies });
    if (incomingBody.failure) throw incomingBody.failure;
    return result;
  } finally {
    for (const body of forwardedBodies) if (body !== result?.response.bodyStream) {
      try { void body.cancel().catch(() => {}); } catch (_) {}
    }
    if (!options.incomingBody) await incomingBody.close();
  }
}

module.exports = { prepareNativeRequest, executeNativeWithIncomingBody };
