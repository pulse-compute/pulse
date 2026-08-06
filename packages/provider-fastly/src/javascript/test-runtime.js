'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');
const { createFastlyJavascriptHandler } = require('./lifecycle.js');
const { createHash } = require('./sha256.js');

const FASTLY_JAVASCRIPT_TEST_RUNTIME_VERSION = 'pulse.fastly-javascript-test-runtime.v1';
const FASTLY_JAVASCRIPT_LOCAL_EXECUTION_MODE = 'provider-emulation';

function recordEntries(input, label) {
  if (input === undefined || input === null) return [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`Pulse Fastly JavaScript ${label} fixtures must be an object record.`);
  }
  const entries = [];
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string') throw new TypeError(`Pulse Fastly JavaScript ${label} fixtures may not use symbol keys.`);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable) continue;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`Pulse Fastly JavaScript ${label} fixtures may only use data properties.`);
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key])]));
}

function semanticBodySha256(body) {
  if (body === null) return null;
  try {
    return createHash('sha256').update(JSON.stringify(canonicalizeJson(JSON.parse(body)))).digest('hex');
  } catch (_) {
    return null;
  }
}

function fixtureHeaders(input, defaultContentType) {
  const headers = new Headers();
  if (Array.isArray(input)) {
    for (const pair of input) {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new TypeError('Fastly JavaScript fetch fixture headers must be [name, value] pairs.');
      }
      headers.append(String(pair[0]), String(pair[1]));
    }
  } else if (input instanceof Headers) {
    for (const [name, value] of input.entries()) headers.append(name, value);
  } else {
    for (const [name, value] of recordEntries(input, 'fetch header')) headers.append(name, String(value));
  }
  if (defaultContentType && !headers.has('content-type')) headers.set('content-type', defaultContentType);
  return headers;
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

function fixtureKey(fetches, url, method) {
  const exact = `${String(method || 'GET').toUpperCase()} ${String(url)}`;
  if (Object.prototype.hasOwnProperty.call(fetches, exact)) return exact;
  if (Object.prototype.hasOwnProperty.call(fetches, String(url))) return String(url);
  return undefined;
}

function fixtureResponse(fixture, init) {
  const status = Number(fixture.status || 200);
  let body = null;
  let defaultContentType;
  if (Array.isArray(fixture.chunks)) {
    body = new ReadableStream({
      start(controller) {
        for (const chunk of fixture.chunks) {
          controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
        }
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
  const method = String(init.method || 'GET').toUpperCase();
  const bodyAllowed = method !== 'HEAD'
    && status !== 204
    && status !== 205
    && status !== 304
    && !(status >= 100 && status < 200);
  return new Response(bodyAllowed ? body : null, {
    status,
    headers: fixtureHeaders(fixture.headers, defaultContentType)
  });
}

function initialKvRecord(value) {
  return Object.freeze({
    json: cloneJson(value),
    body: typeof value === 'string' ? value : JSON.stringify(value)
  });
}

function createFastlyJavascriptLocalEnvironment(options = {}) {
  const bindings = options.bindings && typeof options.bindings === 'object' ? options.bindings : {};
  const kvBindings = bindings.kv && typeof bindings.kv === 'object' ? bindings.kv : {};
  const configValues = new Map(recordEntries(options.config, 'config').map(([key, value]) => [key, String(value)]));
  const secretValues = new Map(recordEntries(options.secrets, 'secret').map(([key, value]) => [key, String(value)]));
  const physicalKv = new Map();
  const observations = {
    constructors: [],
    fetches: [],
    logs: [],
    errors: []
  };
  let activeRequests = 0;

  for (const [logicalName, values] of recordEntries(options.kv, 'KV namespace')) {
    const resource = typeof kvBindings[logicalName] === 'string' ? kvBindings[logicalName].trim() : '';
    if (!resource) continue;
    if (!physicalKv.has(resource)) physicalKv.set(resource, new Map());
    const entries = physicalKv.get(resource);
    for (const [key, value] of recordEntries(values, `KV namespace ${logicalName}`)) {
      entries.set(String(key), initialKvRecord(value));
    }
  }

  function assertRequestScope(api, resource) {
    if (activeRequests <= 0) {
      throw new TypeError(`Fastly JavaScript local ${api}(${JSON.stringify(resource)}) was constructed outside request handling.`);
    }
    observations.constructors.push(Object.freeze({ api, resource: String(resource) }));
  }

  class ConfigStore {
    constructor(resource) {
      assertRequestScope('ConfigStore', resource);
      if (String(resource) !== String(bindings.configStore || '')) {
        throw new TypeError(`Unknown Fastly local Config Store ${String(resource)}.`);
      }
    }
    get(name) {
      return configValues.has(String(name)) ? configValues.get(String(name)) : null;
    }
  }

  class SecretStore {
    constructor(resource) {
      assertRequestScope('SecretStore', resource);
      if (String(resource) !== String(bindings.secretStore || '')) {
        throw new TypeError(`Unknown Fastly local Secret Store ${String(resource)}.`);
      }
    }
    async get(name) {
      if (!secretValues.has(String(name))) return null;
      const value = secretValues.get(String(name));
      return Object.freeze({ plaintext: () => value });
    }
  }

  class KVStore {
    constructor(resource) {
      assertRequestScope('KVStore', resource);
      this.resource = String(resource);
      if (!physicalKv.has(this.resource)) physicalKv.set(this.resource, new Map());
    }
    async get(key) {
      const record = physicalKv.get(this.resource).get(String(key));
      if (!record) return null;
      return Object.freeze({
        json: async () => cloneJson(record.json),
        text: async () => String(record.body),
        get body() {
          const bytes = new TextEncoder().encode(String(record.body));
          return new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            }
          });
        }
      });
    }
    async put(key, body) {
      const text = String(body);
      let value;
      try { value = JSON.parse(text); }
      catch (error) { throw new TypeError('Fastly local KVStore.put requires JSON text.', { cause: error }); }
      physicalKv.get(this.resource).set(String(key), Object.freeze({ json: cloneJson(value), body: text }));
    }
  }

  const fetches = Object.fromEntries(recordEntries(options.fetches, 'fetch'));
  const fallback = options.networkFetch === true ? (options.fetchImplementation || globalThis.fetch) : undefined;
  async function fetchImplementation(url, init = {}) {
    const headers = new Headers(init.headers);
    const body = init.body === undefined || init.body === null ? null : String(init.body);
    observations.fetches.push(Object.freeze({
      url: String(url),
      method: String(init.method || 'GET').toUpperCase(),
      backend: init.backend === undefined ? null : String(init.backend),
      authenticated: headers.has('authorization'),
      contentType: headers.get('content-type'),
      headerNames: Object.freeze([...headers.keys()].map((name) => name.toLowerCase()).sort()),
      hasBody: body !== null,
      bodyBytes: body === null ? 0 : new TextEncoder().encode(body).byteLength,
      bodySha256: body === null ? null : createHash('sha256').update(body).digest('hex'),
      bodySemanticSha256: semanticBodySha256(body)
    }));
    const key = fixtureKey(fetches, url, init.method);
    if (key === undefined) {
      if (typeof fallback === 'function') return fallback(url, init);
      throw new Error(`No Fastly JavaScript fetch fixture is configured for ${String(init.method || 'GET')} ${String(url)}.`);
    }
    const fixture = fetches[key] || {};
    if (fixture.kind === 'network-error' || fixture.networkError === true) {
      throw new Error(fixture.message || 'Configured Fastly JavaScript fetch network failure.');
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
    return fixtureResponse(fixture, init);
  }

  const localConsole = Object.freeze({
    error(value) { observations.logs.push(Object.freeze({ level: 'error', message: String(value) })); },
    warn(value) { observations.logs.push(Object.freeze({ level: 'warn', message: String(value) })); },
    info(value) { observations.logs.push(Object.freeze({ level: 'info', message: String(value) })); },
    debug(value) { observations.logs.push(Object.freeze({ level: 'debug', message: String(value) })); },
    log(value) { observations.logs.push(Object.freeze({ level: 'log', message: String(value) })); }
  });

  return Object.freeze({
    version: FASTLY_JAVASCRIPT_TEST_RUNTIME_VERSION,
    mode: FASTLY_JAVASCRIPT_LOCAL_EXECUTION_MODE,
    provider: 'fastly',
    providerReality: false,
    bindings,
    apis: Object.freeze({ ConfigStore, SecretStore, KVStore }),
    fetchImplementation,
    console: localConsole,
    beginRequest() { activeRequests += 1; },
    endRequest() { activeRequests -= 1; },
    recordError(error) {
      observations.errors.push(Object.freeze({
        name: error && error.name ? String(error.name) : 'Error',
        code: error && error.code ? String(error.code) : null
      }));
    },
    snapshot() {
      return Object.freeze({
        mode: FASTLY_JAVASCRIPT_LOCAL_EXECUTION_MODE,
        providerReality: false,
        realityRunner: 'fastly compute serve',
        constructors: Object.freeze([...observations.constructors]),
        fetches: Object.freeze([...observations.fetches]),
        logs: Object.freeze([...observations.logs]),
        errors: Object.freeze([...observations.errors])
      });
    }
  });
}

function createFastlyJavascriptTestRequest(input = {}) {
  const method = String(input.method || 'GET').toUpperCase();
  const headers = new Headers();
  for (const [name, value] of input.headers || []) headers.append(String(name), String(value));
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && input.body !== undefined) {
    init.body = typeof input.body === 'string' || input.body instanceof Uint8Array
      ? input.body
      : JSON.stringify(input.body);
  }
  return new Request(input.url || `https://pulse-fastly.local${String(input.path || '/')}`, init);
}

function responseKind(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json') || contentType.includes('+json')) return 'json';
  if (contentType.startsWith('text/')) return 'text';
  return 'response';
}

async function executeFastlyJavascriptLocalRequest(application, request, options = {}) {
  const environment = options.environment || createFastlyJavascriptLocalEnvironment(options);
  let effectSummary;
  const handler = createFastlyJavascriptHandler(application, {
    apis: environment.apis,
    bindings: options.bindings || environment.bindings,
    fetchImplementation: environment.fetchImplementation,
    console: environment.console,
    application: options.application,
    maxEffects: options.maxEffects,
    maxRequestBodyBytes: options.maxRequestBodyBytes ?? options.maxBodyBytes,
    maxFetchBodyBytes: options.maxFetchBodyBytes ?? options.maxBodyBytes,
    maxStructuredBodyBytes: options.maxStructuredBodyBytes,
    schemaCodecs: options.schemaCodecs,
    strict: options.strict === true,
    reporting: options.reporting,
    onLogObservation: options.onLogObservation,
    onJsonTrace: options.onJsonTrace,
    onEffectObservation: options.onEffectObservation,
    onEffectSummary(summary) {
      effectSummary = summary;
      if (typeof options.onEffectSummary === 'function') options.onEffectSummary(summary);
    },
    onError(error) {
      environment.recordError(error);
      if (typeof options.onError === 'function') options.onError(error);
    }
  });
  environment.beginRequest();
  try {
    const response = await handler(request);
    return Object.freeze({ response, effectSummary, environment });
  } finally {
    environment.endRequest();
  }
}

async function executeFastlyJavascriptTestCase(application, testCase, options = {}) {
  const environment = createFastlyJavascriptLocalEnvironment({
    ...options,
    config: testCase.config || {},
    secrets: testCase.secrets || {},
    kv: testCase.kv || {},
    fetches: testCase.fetches || {}
  });
  const request = createFastlyJavascriptTestRequest(testCase.request);
  const execution = await executeFastlyJavascriptLocalRequest(application, request, {
    ...options,
    environment
  });
  const method = String(testCase.request && testCase.request.method || 'GET').toUpperCase();
  const body = method === 'HEAD' ? '' : Buffer.from(await execution.response.arrayBuffer()).toString('utf8');
  const effectSummary = execution.effectSummary;
  return Object.freeze({
    version: FASTLY_JAVASCRIPT_TEST_RUNTIME_VERSION,
    mode: FASTLY_JAVASCRIPT_LOCAL_EXECUTION_MODE,
    providerReality: false,
    response: Object.freeze({
      status: execution.response.status,
      kind: responseKind(execution.response),
      bodyClass: runtimeHost.responseBodyClass(execution.response),
      headers: runtimeHost.responseHeaderPairs(execution.response),
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
    resolutionOrder: effectSummary ? effectSummary.resolutionOrder : Object.freeze([]),
    provider: environment.snapshot()
  });
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_TEST_RUNTIME_VERSION,
  FASTLY_JAVASCRIPT_LOCAL_EXECUTION_MODE,
  createFastlyJavascriptLocalEnvironment,
  createFastlyJavascriptTestRequest,
  executeFastlyJavascriptLocalRequest,
  executeFastlyJavascriptTestCase,
  responseKind
});
