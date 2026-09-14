'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');
const { executeNodeJavascriptApplication } = require('./runtime-host.js');
const { createNodeJavascriptFixtureFetch } = require('./fetch-adapter.js');

const NODE_JAVASCRIPT_TEST_RUNTIME_VERSION = 'pulse.node-javascript-test-runtime.v1';

function createTestRequest(input = {}) {
  const method = String(input.method || 'GET').toUpperCase();
  const headerPairs = Object.freeze((input.headers || []).map(([name, value]) => Object.freeze([String(name), String(value)])));
  const headers = new Headers();
  for (const [name, value] of headerPairs) headers.append(name, value);
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && input.body !== undefined) {
    init.body = typeof input.body === 'string' || Buffer.isBuffer(input.body) || input.body instanceof Uint8Array
      ? input.body
      : JSON.stringify(input.body);
  }
  return Object.freeze({
    request: new Request(input.url || `http://127.0.0.1${String(input.path || '/')}`, init),
    headerPairs
  });
}

function responseKind(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json') || contentType.includes('+json')) return 'json';
  if (contentType.startsWith('text/')) return 'text';
  return 'response';
}

async function executeNodeJavascriptTestCase(application, testCase, options = {}) {
  const adapted = createTestRequest(testCase.request);
  let effectSummary;
  const fixtureFetch = options.fetchImplementation || createNodeJavascriptFixtureFetch(
    testCase.fetches || {},
    options.networkFetch === true ? globalThis.fetch : undefined
  );
  const gripFixtureFetch = options.gripFetchImplementation || createNodeJavascriptFixtureFetch(
    testCase.fetches || {},
    options.networkFetch === true ? globalThis.fetch : undefined,
    { rawResponse: true }
  );
  const response = await executeNodeJavascriptApplication(application, adapted.request, {
    capabilities: options.capabilities,
    effectAdapter: options.effectAdapter,
    fetchImplementation: fixtureFetch,
    gripFetchImplementation: gripFixtureFetch,
    s3FetchImplementation: options.s3FetchImplementation || createNodeJavascriptFixtureFetch(
      testCase.fetches || {}, options.fetchImplementation || (options.networkFetch === true ? globalThis.fetch : undefined),
      { rawResponse: true }
    ),
    grip: testCase.grip || options.grip,
    gripBroadcast: options.gripBroadcast,
    jwtCaptureWallClock: options.jwtCaptureWallClock,
    config: testCase.config || {},
    secrets: testCase.secrets || {},
    s3: options.s3 || options.bindings && options.bindings.s3,
    kv: testCase.kv || {},
    application: options.application,
    requestHeaders: adapted.headerPairs,
    maxEffects: options.maxEffects,
    maxRequestBodyBytes: options.maxRequestBodyBytes ?? options.maxBodyBytes ?? testCase.maxBodyBytes,
    maxFetchBodyBytes: options.maxFetchBodyBytes ?? testCase.maxBodyBytes,
    maxStructuredBodyBytes: options.maxStructuredBodyBytes,
    maxBindingNameBytes: options.maxBindingNameBytes,
    maxBindingValueBytes: options.maxBindingValueBytes,
    maxKvNamespaceBytes: options.maxKvNamespaceBytes,
    maxKvKeyBytes: options.maxKvKeyBytes,
    maxKvValueBytes: options.maxKvValueBytes,
    maxKvValueDepth: options.maxKvValueDepth,
    maxKvValueEntries: options.maxKvValueEntries,
    schemaCodecs: options.schemaCodecs,
    strict: options.strict === true,
    provider: options.provider || 'node',
    reporting: options.reporting,
    log: options.log,
    onLogObservation: options.onLogObservation,
    onJsonTrace: options.onJsonTrace,
    onEffectObservation: options.onEffectObservation,
    onEffectSummary(summary) {
      effectSummary = summary;
      if (typeof options.onEffectSummary === 'function') options.onEffectSummary(summary);
    }
  });
  const method = String(testCase.request && testCase.request.method || 'GET').toUpperCase();
  const body = method === 'HEAD' ? '' : Buffer.from(await response.arrayBuffer()).toString('utf8');
  return Object.freeze({
    version: NODE_JAVASCRIPT_TEST_RUNTIME_VERSION,
    response: Object.freeze({
      status: response.status,
      kind: responseKind(response),
      bodyClass: runtimeHost.responseBodyClass(response),
      headers: runtimeHost.responseHeaderPairs(response),
      body
    }),
    effectCount: effectSummary ? effectSummary.ownedEffectCount : 0,
    externalEffectCount: effectSummary ? effectSummary.effectCount : 0,
    localEffectCount: effectSummary ? effectSummary.localEffectCount : 0,
    continuations: Object.freeze((effectSummary && effectSummary.groups || []).map((group) => Object.freeze({
      id: group.id,
      kind: 'parallel',
      effectIds: group.effectIds,
      keys: group.keys
    }))),
    resolutionOrder: effectSummary ? effectSummary.resolutionOrder : Object.freeze([])
  });
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_TEST_RUNTIME_VERSION,
  createTestRequest,
  executeNodeJavascriptTestCase,
  responseKind
});
