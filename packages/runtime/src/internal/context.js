'use strict';

const { createStructuredBodyReader, normalizeBodyLimit } = require('./body.js');
const { normalizeFetchRequest } = require('./fetch.js');
const { decodeSchemaText, encodeSchemaValue, requireExplicitSchemaId, strictSchemaPolicy } = require('./schema.js');
const {
  cloneKvValue,
  normalizeBindingName,
  normalizeKvKey,
  normalizeKvNamespace
} = require('./bindings.js');
const { bindPackageRuntimeContext } = require('./package-runtime.js');
const { normalizeEventEmission } = require('./event-emission.js');
const { createPulseLogger } = require('./logging.js');
const {
  createJsonResult,
  createResponseResult,
  createTextResult,
  normalizeFetchResponse,
  projectFetchResponse
} = require('./response.js');

function headersToPairs(headers) {
  const pairs = [];
  for (const [name, value] of headers.entries()) pairs.push(Object.freeze([name, value]));
  return Object.freeze(pairs);
}

function normalizeRequestHeaderPairs(headers, fallback) {
  if (!Array.isArray(headers)) return headersToPairs(fallback);
  return Object.freeze(headers.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError('Pulse request headers must be [name, value] pairs.');
    return Object.freeze([String(entry[0]), String(entry[1])]);
  }));
}

function createRequestView(request, requestHeaders, effectExecution, options = {}) {
  const url = new URL(request.url);
  const headers = normalizeRequestHeaderPairs(requestHeaders, request.headers);
  const body = createStructuredBodyReader(request, {
    label: 'request',
    maxBytes: normalizeBodyLimit(options.maxRequestBodyBytes ?? options.maxStructuredBodyBytes),
    contentType: request.headers.get('content-type') || '',
    signal: options.signal || request.signal
  });
  let textEffect;
  let jsonEffect;
  const schemaJsonEffects = new Map();

  return Object.freeze({
    method: request.method.toUpperCase(),
    url: request.url,
    path: url.pathname || '/',
    headers,
    header(name) {
      const lower = String(name).toLowerCase();
      const match = headers.find(([header]) => header.toLowerCase() === lower);
      return match ? match[1] : undefined;
    },
    text() {
      if (!textEffect) textEffect = effectExecution.local('request.body.text', () => body.text());
      return textEffect;
    },
    json(schemaId) {
      if (schemaId === undefined && !strictSchemaPolicy(options)) {
        if (!jsonEffect) jsonEffect = effectExecution.local('request.body.json', () => body.json());
        return jsonEffect;
      }
      const key = schemaId === undefined ? '<missing>' : String(schemaId);
      if (!schemaJsonEffects.has(key)) {
        schemaJsonEffects.set(key, effectExecution.local(`request.body.json:${key}`, async () => decodeSchemaText(
          schemaId,
          await body.text(),
          options,
          {
            source: 'request',
            headers,
            operationId: `request:${key}`
          }
        )));
      }
      return schemaJsonEffects.get(key);
    }
  });
}

function createStateView(map) {
  return Object.freeze({
    get(key) {
      requireString('state key', key);
      return map.get(key);
    },
    set(key, value) {
      requireString('state key', key);
      requireString('state value', value);
      map.set(key, value);
    }
  });
}

function requireString(label, value) {
  if (typeof value !== 'string') throw new TypeError(`Pulse ${label} must be a string.`);
}

function createFetchOperation(effectExecution, fetchEffect, fetchRequest, options, effectId) {
  const projectionOptions = Object.freeze({
    ...options,
    maxBodyBytes: normalizeBodyLimit(options.maxFetchBodyBytes ?? options.maxStructuredBodyBytes),
    signal: options.signal,
    requestMethod: fetchRequest.init.method,
    effectId
  });
  const operation = effectExecution.project(
    fetchEffect,
    'response',
    (value) => normalizeFetchResponse(value, projectionOptions)
  );
  Object.defineProperties(operation, {
    text: {
      enumerable: false,
      value: () => effectExecution.project(
        operation,
        'text',
        (response) => projectFetchResponse(response, 'text', undefined, projectionOptions)
      )
    },
    json: {
      enumerable: false,
      value: (schemaId) => effectExecution.project(
        operation,
        'json',
        (response) => projectFetchResponse(response, 'json', schemaId, projectionOptions)
      )
    }
  });
  return operation;
}

function createContext(frame) {
  const effects = frame.effectExecution;
  if (!effects) throw new TypeError('Pulse context requires an execution-owned JavaScript effect execution.');
  const state = createStateView(frame.state);
  const req = frame.req;
  const options = Object.freeze({
    ...(frame.executionOptions || {}),
    signal: frame.signal
  });
  let fetchSequence = 0;
  const log = createPulseLogger({
    reporting: options.reporting,
    redact(message) { return effects.redactValue(message); },
    emit: options.log,
    observe: options.onLogObservation,
    target: options.target || 'javascript',
    provider: options.provider
  });

  const eventContext = frame.event !== undefined;
  const ctx = {
    encodeJson(value, schemaId) {
      const id = requireExplicitSchemaId(schemaId, options, 'application-value');
      return encodeSchemaValue(id, value, options, { source: 'application-value' }).text;
    },
    decodeJson(text, schemaId) {
      const id = requireExplicitSchemaId(schemaId, options, 'application-text');
      return decodeSchemaText(id, text, options, { source: 'application-text' });
    },
    ...(eventContext ? {} : { req }),
    state,
    log,
    fetch(url, init) {
      fetchSequence += 1;
      const effectId = `fetch-${fetchSequence}`;
      const fetchRequest = normalizeFetchRequest(url, init, {
        ...options,
        operationId: `fetch-request:${effectId}`,
        effectId
      });
      const fetchEffect = effects.dispatch({
        id: effectId,
        kind: 'fetch',
        providerKind: 'fetch',
        operation: 'dispatch',
        capability: 'fetch',
        url: fetchRequest.url,
        init: fetchRequest.init
      });
      return createFetchOperation(effects, fetchEffect, fetchRequest, options, effectId);
    },
    parallel(record) { return effects.parallel(record); },
    config: Object.freeze({
      get(name) {
        const normalizedName = normalizeBindingName('config', name, options);
        return effects.dispatch({
          kind: 'config.get',
          providerKind: 'config',
          operation: 'get',
          capability: 'config.get',
          name: normalizedName
        });
      }
    }),
    secret: Object.freeze({
      get(name) {
        const normalizedName = normalizeBindingName('secret', name, options);
        return effects.dispatch({
          kind: 'secret.get',
          providerKind: 'secret',
          operation: 'get',
          capability: 'secret.get',
          name: normalizedName
        });
      }
    }),
    kv(name) {
      const namespace = normalizeKvNamespace(name, options);
      return Object.freeze({
        ...Object.fromEntries(['getVersioned', 'insertIfAbsent', 'compareAndSwap'].map((operation) => [operation, (key, generationOrValue, value) => effects.dispatch({
          kind: `kv.${operation}`, providerKind: 'kv', operation, capability: `kv.${operation}`, namespace, key,
          ...(operation === 'compareAndSwap' ? { generation: generationOrValue, value } : operation === 'insertIfAbsent' ? { value: generationOrValue } : {})
        })])),
        get(key) {
          const normalizedKey = normalizeKvKey(key, options);
          return effects.dispatch({
            kind: 'kv.get',
            providerKind: 'kv',
            operation: 'get',
            capability: 'kv.get',
            namespace,
            key: normalizedKey
          });
        },
        put(key, value) {
          const normalizedKey = normalizeKvKey(key, options);
          const normalizedValue = cloneKvValue(value, options);
          return effects.dispatch({
            kind: 'kv.put',
            providerKind: 'kv',
            operation: 'put',
            capability: 'kv.put',
            namespace,
            key: normalizedKey,
            value: normalizedValue
          });
        }
      });
    },
    emit(type, event) {
      const outboundFrame = normalizeEventEmission(type, event, options);
      return effects.dispatch({
        kind: 'event.emit',
        providerKind: 'event',
        operation: 'emit',
        capability: 'event.emit',
        frame: outboundFrame
      });
    }
  };

  if (eventContext) {
    ctx.event = frame.event;
  } else {
    ctx.json = (value, descriptor) => createJsonResult(value, descriptor, options);
    ctx.text = (value, responseOptions) => createTextResult(value, responseOptions);
    ctx.response = (input) => createResponseResult(input);
  }
  if (!eventContext && frame.routeContext) {
    ctx.param = (name) => {
      requireString('route parameter name', name);
      return frame.params[name];
    };
  }
  const frozen = Object.freeze(ctx);
  if (!eventContext) bindPackageRuntimeContext(frozen, frame);
  return frozen;
}

function createEventContext(frame) {
  if (!frame || !frame.event) throw new TypeError('Pulse event context requires one normalized event view.');
  return createContext({ ...frame, routeContext: false });
}

module.exports = Object.freeze({ createContext, createEventContext, createRequestView });
