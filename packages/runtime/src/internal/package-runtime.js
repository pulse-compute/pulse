'use strict';

const { PulseRuntimeContractError } = require('./errors.js');
const {
  decodeSchemaText,
  encodeSchemaValue,
  requireExplicitSchemaId
} = require('./schema.js');

const PACKAGE_RUNTIME_BRIDGE_VERSION = 'pulse.package-runtime-bridge.v1';
const PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION = 'pulse.first-party-embedded-schema-codec-bridge.v1';
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_MAX_PAYLOAD_DEPTH = 32;
const DEFAULT_MAX_PAYLOAD_ENTRIES = 4096;

const PACKAGE_CONTEXTS = new WeakMap();

const TRUSTED_PACKAGE_EFFECT_CATALOG = Object.freeze({
  '@pulse-compute/assets': Object.freeze({
    contractId: 'pulse.assets',
    providerKind: 'assets',
    operations: Object.freeze({
      lookup: Object.freeze({
        kind: 'assets.lookup',
        capability: 'assets.lookup',
        result: 'asset'
      })
    })
  }),
  '@pulse-compute/grip': Object.freeze({
    contractId: 'pulse.grip',
    providerKind: 'grip',
    operations: Object.freeze({
      broadcast: Object.freeze({
        kind: 'grip.broadcast',
        capability: 'grip.broadcast',
        result: 'ack'
      })
    })
  }),
  '@pulse-compute/jwt': Object.freeze({
    contractId: 'pulse.jwt',
    providerKind: 'jwt',
    operations: Object.freeze({
      verify: Object.freeze({
        kind: 'jwt.verify',
        capability: 'jwt.verify',
        result: 'jwt-verification'
      })
    })
  })
});

const trustedPackageSchemaOwners = Object.freeze({
  '@pulse-compute/entities': Object.freeze({
    contractId: 'pulse.entities'
  })
});

function contractError(code, message, detail) {
  return new PulseRuntimeContractError(code, message, detail === undefined ? {} : { detail });
}

function requireObject(label, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_DEFINITION_INVALID',
      `Pulse ${label} must be an ordinary object.`
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_DEFINITION_INVALID',
      `Pulse ${label} must use an ordinary object prototype.`
    );
  }
  return value;
}

function enumerableDataEntries(value, label) {
  requireObject(label, value);
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw contractError(
        'PULSE_RUNTIME_PACKAGE_EFFECT_DEFINITION_INVALID',
        `Pulse ${label} may not contain symbol keys.`
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable) continue;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw contractError(
        'PULSE_RUNTIME_PACKAGE_EFFECT_DEFINITION_INVALID',
        `Pulse ${label} may only contain enumerable data properties.`
      );
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function definePayloadProperty(target, key, value) {
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: false,
    writable: false,
    value
  });
}

function clonePayloadValue(value, state, path, depth) {
  if (depth > state.maxDepth) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
      `Pulse package effect payload exceeds the maximum depth of ${state.maxDepth}.`,
      Object.freeze({ path })
    );
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw contractError(
        'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
        'Pulse package effect payload numbers must be finite.',
        Object.freeze({ path })
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
      `Pulse package effect payload contains unsupported ${typeof value} data.`,
      Object.freeze({ path })
    );
  }
  if (!value || typeof value !== 'object') {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
      'Pulse package effect payload contains unsupported data.',
      Object.freeze({ path })
    );
  }
  if (state.seen.has(value)) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
      'Pulse package effect payload may not contain cycles or repeated object references.',
      Object.freeze({ path })
    );
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    const allowed = new Set(['length']);
    for (let index = 0; index < value.length; index += 1) allowed.add(String(index));
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowed.has(key)) {
        throw contractError(
          'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
          'Pulse package effect payload arrays may only contain indexed data properties.',
          Object.freeze({ path, key: String(key) })
        );
      }
    }
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        throw contractError(
          'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
          'Pulse package effect payload arrays may not be sparse.',
          Object.freeze({ path: `${path}[${index}]` })
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw contractError(
          'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
          'Pulse package effect payload arrays may only contain enumerable data properties.',
          Object.freeze({ path: `${path}[${index}]` })
        );
      }
      state.entries += 1;
      if (state.entries > state.maxEntries) {
        throw contractError(
          'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
          `Pulse package effect payload exceeds the maximum of ${state.maxEntries} entries.`
        );
      }
      definePayloadProperty(
        output,
        key,
        clonePayloadValue(descriptor.value, state, `${path}[${index}]`, depth + 1)
      );
    }
    Object.defineProperty(output, 'length', { writable: false });
    return Object.freeze(output);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
      'Pulse package effect payload objects must use an ordinary object prototype.',
      Object.freeze({ path })
    );
  }
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw contractError(
        'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
        'Pulse package effect payload may not contain symbol keys.',
        Object.freeze({ path })
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw contractError(
        'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
        'Pulse package effect payload may only contain enumerable data properties.',
        Object.freeze({ path: `${path}.${key}` })
      );
    }
    state.entries += 1;
    if (state.entries > state.maxEntries) {
      throw contractError(
        'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
        `Pulse package effect payload exceeds the maximum of ${state.maxEntries} entries.`
      );
    }
    definePayloadProperty(
      output,
      key,
      clonePayloadValue(descriptor.value, state, `${path}.${key}`, depth + 1)
    );
  }
  return Object.freeze(output);
}

function clonePackageEffectPayload(payload, limits = {}) {
  if (payload === undefined) return Object.freeze({});
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
      'Pulse package effect payload must be an ordinary object.'
    );
  }
  const state = {
    seen: new Set(),
    entries: 0,
    maxDepth: limits.maxDepth === undefined ? DEFAULT_MAX_PAYLOAD_DEPTH : Number(limits.maxDepth),
    maxEntries: limits.maxEntries === undefined ? DEFAULT_MAX_PAYLOAD_ENTRIES : Number(limits.maxEntries)
  };
  if (!Number.isSafeInteger(state.maxDepth) || state.maxDepth <= 0) throw new TypeError('Pulse package payload maxDepth must be a positive safe integer.');
  if (!Number.isSafeInteger(state.maxEntries) || state.maxEntries <= 0) throw new TypeError('Pulse package payload maxEntries must be a positive safe integer.');
  const cloned = clonePayloadValue(payload, state, '$', 0);
  const maxBytes = limits.maxBytes === undefined ? DEFAULT_MAX_PAYLOAD_BYTES : Number(limits.maxBytes);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('Pulse package payload maxBytes must be a positive safe integer.');
  const bytes = new TextEncoder().encode(JSON.stringify(cloned)).byteLength;
  if (bytes > maxBytes) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
      `Pulse package effect payload exceeds the maximum of ${maxBytes} UTF-8 bytes.`,
      Object.freeze({ bytes, maxBytes })
    );
  }
  return cloned;
}

function packageRequestBodyUnavailable() {
  return Promise.reject(contractError(
    'PULSE_RUNTIME_PACKAGE_REQUEST_BODY_UNAVAILABLE',
    'Trusted Pulse package request views do not expose the application request body; use ctx.req projections through the owning application contract.'
  ));
}

function createPackageRequestView(request, signal) {
  const lifecycleSignal = signal || request.signal;
  const view = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    signal: lifecycleSignal
  });
  for (const method of ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text']) {
    Object.defineProperty(view, method, {
      enumerable: false,
      configurable: false,
      writable: false,
      value: packageRequestBodyUnavailable
    });
  }
  Object.defineProperty(view, 'clone', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: () => createPackageRequestView(request, lifecycleSignal)
  });
  return view;
}

function bindPackageRuntimeContext(context, frame) {
  if (!context || (typeof context !== 'object' && typeof context !== 'function')) {
    throw new TypeError('Pulse package runtime context binding requires a context object.');
  }
  if (!frame || typeof frame !== 'object' || !frame.effectExecution || !(frame.request instanceof Request)) {
    throw new TypeError('Pulse package runtime context binding requires the request frame and effect execution.');
  }
  const pathname = new URL(frame.request.url).pathname || '/';
  const relativePath = frame.packageRelativePath == null
    ? (frame.relativePath == null ? pathname : frame.relativePath)
    : frame.packageRelativePath;
  const lifecycleSignal = frame.signal || frame.request.signal;
  const publicView = Object.freeze({
    request: createPackageRequestView(frame.request, lifecycleSignal),
    params: frame.params || Object.freeze({}),
    path: Object.freeze({
      absolute: pathname,
      relative: String(relativePath)
    }),
    signal: lifecycleSignal
  });
  const executionOptions = frame.executionOptions || {};
  PACKAGE_CONTEXTS.set(context, Object.freeze({
    effectExecution: frame.effectExecution,
    publicView,
    requestHeaders: frame.req && Array.isArray(frame.req.headers) ? frame.req.headers : Object.freeze([]),
    schemaCodecs: executionOptions.schemaCodecs,
    target: executionOptions.target,
    provider: executionOptions.provider,
    onJsonTrace: executionOptions.onJsonTrace,
    redactJsonTraceValue: executionOptions.redactJsonTraceValue
  }));
  return context;
}

function packageContextData(context) {
  if (!context || (typeof context !== 'object' && typeof context !== 'function')) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_CONTEXT_REQUIRED',
      'Trusted Pulse package operations require the current request context.'
    );
  }
  const data = PACKAGE_CONTEXTS.get(context);
  if (!data) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_CONTEXT_REQUIRED',
      'The supplied context is not owned by an active managed Pulse request.'
    );
  }
  return data;
}

function assertPackageContextActive(data) {
  const summary = data.effectExecution.summary();
  if (summary.closed) {
    throw contractError(
      'PULSE_RUNTIME_EFFECT_EXECUTION_CLOSED',
      'Pulse package schema codecs are unavailable after their managed request has closed.'
    );
  }
}

function exactDataObject(label, value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_SCHEMA_BRIDGE_INVALID',
      `Pulse ${label} must be an ordinary object.`
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_SCHEMA_BRIDGE_INVALID',
      `Pulse ${label} must use an ordinary object prototype.`
    );
  }
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw contractError(
        'PULSE_RUNTIME_PACKAGE_SCHEMA_BRIDGE_INVALID',
        `Pulse ${label} must not contain symbol keys.`
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable) continue;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw contractError(
        'PULSE_RUNTIME_PACKAGE_SCHEMA_BRIDGE_INVALID',
        `Pulse ${label} may only contain enumerable data properties.`
      );
    }
    entries.push([key, descriptor.value]);
  }
  const unknown = entries.map(([key]) => key).filter((key) => !allowedKeys.includes(key)).sort();
  if (unknown.length > 0) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_SCHEMA_BRIDGE_INVALID',
      `Pulse ${label} contains unsupported fields: ${unknown.join(', ')}.`,
      Object.freeze({ unknown })
    );
  }
  return Object.fromEntries(entries);
}

function normalizePackageSchemaRuntimeDefinition(input) {
  const definition = exactDataObject('package schema runtime definition', input, ['package', 'contractId']);
  const packageName = typeof definition.package === 'string' ? definition.package : '';
  const contractId = typeof definition.contractId === 'string' ? definition.contractId : '';
  const trusted = trustedPackageSchemaOwners[packageName];
  if (!trusted || trusted.contractId !== contractId) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_SCHEMA_BRIDGE_UNTRUSTED',
      `Pulse package schema runtime ${JSON.stringify(packageName || contractId || '<unknown>')} is not a fixed first-party schema owner.`,
      Object.freeze({ package: packageName, contractId })
    );
  }
  return Object.freeze({ packageName, contractId });
}

function normalizePackageSchemaDeclaration(input) {
  const declaration = exactDataObject('package schema declaration', input, ['input', 'output']);
  const normalize = (role) => {
    const value = declaration[role];
    if (value === null) return null;
    if (typeof value !== 'string' || value.length === 0) {
      throw contractError(
        'PULSE_RUNTIME_PACKAGE_SCHEMA_BRIDGE_INVALID',
        `Pulse package ${role} schema must be a non-empty declared schema ID or null.`,
        Object.freeze({ role, schemaIdType: typeof value })
      );
    }
    return value;
  };
  return Object.freeze({ input: normalize('input'), output: normalize('output') });
}

function privateSchemaOptions(data) {
  return Object.freeze({
    schemaCodecs: data.schemaCodecs,
    strict: true,
    target: typeof data.target === 'string' ? data.target : undefined,
    provider: typeof data.provider === 'string' ? data.provider : undefined,
    onJsonTrace: data.onJsonTrace,
    redactJsonTraceValue: data.redactJsonTraceValue
  });
}

function assertDeclaredSchema(role, declaredSchemaId, schemaId) {
  if (typeof schemaId !== 'string' || declaredSchemaId === null || schemaId !== declaredSchemaId) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_SCHEMA_NOT_DECLARED',
      `Pulse package schema bridge may use only its declared ${role} schema.`,
      Object.freeze({ role, schemaId: typeof schemaId === 'string' ? schemaId : null })
    );
  }
  return schemaId;
}

function createPackageSchemaCodecRuntime(input) {
  const definition = normalizePackageSchemaRuntimeDefinition(input);
  return Object.freeze({
    version: PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION,
    package: definition.packageName,
    contractId: definition.contractId,
    bind(context, declarationInput) {
      const data = packageContextData(context);
      assertPackageContextActive(data);
      const declaration = normalizePackageSchemaDeclaration(declarationInput);
      const schemaOptions = privateSchemaOptions(data);
      if (declaration.input !== null) requireExplicitSchemaId(declaration.input, schemaOptions, 'request');
      if (declaration.output !== null) requireExplicitSchemaId(declaration.output, schemaOptions, 'application-response');
      return Object.freeze({
        decodeEmbeddedJson(schemaId, packageOwnedText) {
          assertPackageContextActive(data);
          const id = assertDeclaredSchema('input', declaration.input, schemaId);
          if (typeof packageOwnedText !== 'string') {
            throw contractError(
              'PULSE_RUNTIME_PACKAGE_SCHEMA_TEXT_REQUIRED',
              'Pulse package schema decode requires a package-owned JSON text slice.'
            );
          }
          return decodeSchemaText(id, packageOwnedText, schemaOptions, {
            source: 'request',
            headers: data.requestHeaders,
            operationId: `entities.decode:${id}`
          });
        },
        encodeEmbeddedJson(schemaId, packageOwnedValue) {
          assertPackageContextActive(data);
          const id = assertDeclaredSchema('output', declaration.output, schemaId);
          const encoded = encodeSchemaValue(id, packageOwnedValue, schemaOptions, {
            source: 'application-response',
            operationId: `entities.encode:${id}`
          });
          if (typeof encoded.text !== 'string') {
            throw contractError(
              'PULSE_RUNTIME_PACKAGE_SCHEMA_TEXT_REQUIRED',
              'Pulse package schema encode must produce package-owned JSON text.'
            );
          }
          return encoded.text;
        }
      });
    }
  });
}

function normalizePackageDefinition(input) {
  requireObject('package runtime definition', input);
  const packageName = String(input.package || '');
  const contractId = String(input.contractId || '');
  const providerKind = String(input.providerKind || '');
  const catalog = TRUSTED_PACKAGE_EFFECT_CATALOG[packageName];
  if (!catalog || catalog.contractId !== contractId || catalog.providerKind !== providerKind) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_UNTRUSTED',
      `Pulse package runtime ${JSON.stringify(packageName || contractId || '<unknown>')} is not in the fixed first-party package effect catalog.`,
      Object.freeze({ package: packageName, contractId, providerKind })
    );
  }
  const operations = {};
  for (const [operation, declared] of enumerableDataEntries(input.operations, 'package effect operations')) {
    const expected = catalog.operations[operation];
    requireObject(`package effect operation ${JSON.stringify(operation)}`, declared);
    if (!expected
      || String(declared.kind || '') !== expected.kind
      || String(declared.capability || '') !== expected.capability
      || String(declared.result || '') !== expected.result) {
      throw contractError(
        'PULSE_RUNTIME_PACKAGE_EFFECT_DEFINITION_INVALID',
        `Pulse package operation ${JSON.stringify(operation)} does not match the fixed first-party effect catalog.`,
        Object.freeze({ package: packageName, operation })
      );
    }
    operations[operation] = expected;
  }
  if (Object.keys(operations).length === 0) {
    throw contractError(
      'PULSE_RUNTIME_PACKAGE_EFFECT_DEFINITION_INVALID',
      'Pulse package runtime definitions must declare at least one trusted operation.'
    );
  }
  return Object.freeze({ packageName, contractId, providerKind, operations: Object.freeze(operations) });
}

function createPackageRuntime(input) {
  const definition = normalizePackageDefinition(input);
  return Object.freeze({
    version: PACKAGE_RUNTIME_BRIDGE_VERSION,
    package: definition.packageName,
    contractId: definition.contractId,
    providerKind: definition.providerKind,
    context(context) {
      return packageContextData(context).publicView;
    },
    effect(context, operationInput, payload, projector) {
      const operation = String(operationInput || '');
      const declared = definition.operations[operation];
      if (!declared) {
        throw contractError(
          'PULSE_RUNTIME_PACKAGE_EFFECT_OPERATION_UNSUPPORTED',
          `Pulse package ${definition.packageName} does not declare effect operation ${JSON.stringify(operation)}.`,
          Object.freeze({ package: definition.packageName, operation })
        );
      }
      if (projector !== undefined && typeof projector !== 'function') {
        throw new TypeError('Pulse package effect projector must be a function when supplied.');
      }
      const data = packageContextData(context);
      return data.effectExecution.dispatch({
        package: definition.packageName,
        contractId: definition.contractId,
        kind: declared.kind,
        providerKind: definition.providerKind,
        operation,
        capability: declared.capability,
        result: declared.result,
        payload: clonePackageEffectPayload(payload)
      }, projector);
    }
  });
}

module.exports = Object.freeze({
  PACKAGE_RUNTIME_BRIDGE_VERSION,
  PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION,
  TRUSTED_PACKAGE_EFFECT_CATALOG,
  bindPackageRuntimeContext,
  clonePackageEffectPayload,
  createPackageRequestView,
  createPackageRuntime,
  createPackageSchemaCodecRuntime
});
