'use strict';
const portableKv = require('@pulse-compute/runtime/host');

const crypto = require('node:crypto');
const {
  createNativeGuestSourceCryptoVerifier
} = require('./native-crypto-verifier.js');

function loadRuntimeContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/handler/canonical-native-runtime.js');
    throw error;
  }
}

function loadCanonicalRuntime() {
  try { return require('@pulse-compute/wasm-host-runtime/runtime/canonical-api-runtime'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('./canonical-api-runtime.js');
    throw error;
  }
}

function loadSchemaCodecTools() {
  try { return require('@pulse-compute/wasm-schema-json/compiler/canonical-schema-codecs'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../schema-json/src/compiler/canonical-schema-codecs.js');
    }
    throw error;
  }
}

function loadEventContract() {
  try { return require('@pulse-compute/wasm-contracts/events'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/events/contracts.js');
    throw error;
  }
}

const runtimeContract = loadRuntimeContract();
const canonicalRuntime = loadCanonicalRuntime();
const schemaCodecTools = loadSchemaCodecTools();
const eventContract = loadEventContract();
let executionSequence = 0;
const DEFAULT_MAX_EFFECTS = 1024;

class CanonicalNativeHostError extends Error {
  constructor(message, code = 'PULSE_CANONICAL_NATIVE_HOST_FAILED', detail = {}) {
    super(message);
    this.name = 'CanonicalNativeHostError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeMaxEffects(value) {
  const maxEffects = value === undefined ? DEFAULT_MAX_EFFECTS : Number(value);
  if (!Number.isSafeInteger(maxEffects) || maxEffects <= 0) {
    throw new TypeError('Pulse maxEffects must be a positive safe integer.');
  }
  return maxEffects;
}

function staticDecoderArgument(expression, effect) {
  if (expression && expression.kind === 'literal' && ['string', 'number', 'boolean'].includes(typeof expression.value)) return expression.value;
  if (expression && expression.kind === 'literal' && expression.value === null) return null;
  throw new CanonicalNativeHostError(
    'Native decoder arguments must be canonical literal values.',
    'PULSE_CANONICAL_NATIVE_DECODER_ARGUMENT_UNSUPPORTED',
    { effectId: effect && effect.id, expression }
  );
}

function normalizeProviderAdapter(input) {
  if (!input || typeof input !== 'object') {
    return Object.freeze({
      id: 'unconfigured',
      prepareConditionalKv() { return undefined; },
      version: 'pulse.canonical-native-unconfigured-provider.v1',
      async dispatchEffect(effect) {
        throw new CanonicalNativeHostError(`No provider adapter is configured for native effect ${effect.kind}.`, 'PULSE_PROVIDER_CAPABILITY_MISSING', { effectId: effect.id, kind: effect.kind });
      },
      resultMetadata() { return undefined; },
      disposeExecution() {}
    });
  }
  const id = String(input.id || input.name || '').trim();
  if (!id) throw new TypeError('Canonical native provider adapter requires an id.');
  const dispatchEffect = typeof input.dispatchEffect === 'function'
    ? input.dispatchEffect.bind(input)
    : (typeof input.dispatchFetch === 'function'
      ? (effect, context) => {
        if (effect.kind !== 'fetch') throw new CanonicalNativeHostError(`Provider ${id} does not implement ${effect.kind}.`, 'PULSE_PROVIDER_CAPABILITY_MISSING', { provider: id, effectId: effect.id, kind: effect.kind });
        return input.dispatchFetch(effect, context);
      }
      : undefined);
  if (!dispatchEffect) throw new TypeError(`Canonical native provider ${id} must implement dispatchEffect() or dispatchFetch().`);
  return Object.freeze({
    id,
    version: String(input.version || `pulse.canonical-native-${id}-provider.v1`),
    dispatchEffect,
    prepareConditionalKv: typeof input.prepareConditionalKv === 'function' ? input.prepareConditionalKv.bind(input) : undefined,
    resultMetadata: typeof input.resultMetadata === 'function' ? input.resultMetadata.bind(input) : () => undefined,
    disposeExecution: typeof input.disposeExecution === 'function' ? input.disposeExecution.bind(input) : () => undefined
  });
}

function createSchemaCodecs(registryInput = {}) {
  return schemaCodecTools.createCanonicalSchemaCodecs(registryInput);
}

class ValueHeap {
  constructor() {
    this.values = new Map();
    this.next = 1;
  }
  put(value) {
    const handle = this.next++;
    this.values.set(handle, value);
    return handle;
  }
  has(handle) { return this.values.has(Number(handle)); }
  get(handle) {
    const key = Number(handle);
    if (!this.values.has(key)) throw new CanonicalNativeHostError(`Unknown native value handle ${key}.`, 'PULSE_CANONICAL_NATIVE_VALUE_HANDLE_INVALID', { handle: key });
    return this.values.get(key);
  }
  size() { return this.values.size; }
}

function binary(operator, left, right) {
  switch (operator) {
    case '===': return left === right;
    case '!==': return left !== right;
    case '==': return left == right; // intentional canonical JavaScript compatibility
    case '!=': return left != right; // intentional canonical JavaScript compatibility
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/': return left / right;
    case '%': return left % right;
    case '**': return left ** right;
    case '&&': return left && right;
    case '||': return left || right;
    case '??': return left ?? right;
    case '&': return left & right;
    case '|': return left | right;
    case '^': return left ^ right;
    case '<<': return left << right;
    case '>>': return left >> right;
    case '>>>': return left >>> right;
    case 'in': return left in right;
    default: throw new CanonicalNativeHostError(`Unsupported native binary operator ${String(operator)}.`, 'PULSE_CANONICAL_NATIVE_OPERATOR_UNSUPPORTED', { operator });
  }
}

function unary(operator, value) {
  switch (operator) {
    case '!': return !value;
    case '+': return +value;
    case '-': return -value;
    case '~': return ~value;
    case 'typeof': return typeof value;
    case 'void': return undefined;
    default: throw new CanonicalNativeHostError(`Unsupported native unary operator ${String(operator)}.`, 'PULSE_CANONICAL_NATIVE_OPERATOR_UNSUPPORTED', { operator });
  }
}

function normalizeHeaders(headers) {
  return canonicalRuntime.normalizeHeaders(headers || []);
}

function routerSegments(input) {
  const text = String(input || '/');
  if (text === '/') return [];
  return text.replace(/^\/+|\/+$/g, '').split('/');
}

function routerMatch(pathValue, patternValue) {
  const actual = routerSegments(pathValue);
  const expected = routerSegments(patternValue);
  const wildcard = expected.length > 0 && expected[expected.length - 1] === '*';
  if ((!wildcard && actual.length !== expected.length) || (wildcard && actual.length < expected.length - 1)) return false;
  const limit = wildcard ? expected.length - 1 : expected.length;
  for (let index = 0; index < limit; index += 1) {
    const part = expected[index];
    if (part.startsWith(':')) { if (!actual[index]) return false; continue; }
    if (actual[index] !== part) return false;
  }
  return true;
}

function routerParam(pathValue, patternValue, nameValue) {
  const actual = routerSegments(pathValue);
  const expected = routerSegments(patternValue);
  const target = `:${String(nameValue)}`;
  for (let index = 0; index < expected.length; index += 1) if (expected[index] === target) return actual[index];
  return undefined;
}

function kvStoreName(value) {
  if (value && typeof value === 'object' && value.kind === 'kv-namespace' && value.name !== undefined) return String(value.name);
  return value;
}

function literalPlanEffectInput(planEffect, name) {
  const input = (planEffect.inputs || []).find((entry) => entry && entry.name === name);
  const value = input && input.value;
  return value && value.kind === 'literal' ? value.value : undefined;
}

function nativeFetchResponseContract(planEffect, payload = {}) {
  const explicitMode = payload.responseMode === undefined
    ? literalPlanEffectInput(planEffect, 'responseMode')
    : payload.responseMode;
  const decoder = planEffect.decoder || (planEffect.result && planEffect.result.decoder && planEffect.result.decoder.kind);
  const responseMode = explicitMode === undefined
    ? (decoder ? 'structured' : planEffect.result && planEffect.result.valueKind === 'opaque-response' ? 'opaque' : 'auto')
    : String(explicitMode);
  const explicitProjection = payload.projection === undefined
    ? literalPlanEffectInput(planEffect, 'projection')
    : payload.projection;
  const projection = explicitProjection === undefined
    ? (decoder || (responseMode === 'structured' ? 'text' : 'response'))
    : String(explicitProjection);
  return Object.freeze({ responseMode, projection });
}

function nativeEffect(planEffect, payload) {
  const base = {
    id: String(planEffect.id),
    kind: String(planEffect.kind),
    resource: planEffect.resource,
    source: planEffect.source
  };
  if (planEffect.kind === 'fetch') {
    const response = nativeFetchResponseContract(planEffect, payload);
    return { ...base, url: payload.url, init: payload.init, ...response };
  }
  if (planEffect.kind === 'config.get' || planEffect.kind === 'secret.get') return { ...base, name: payload.name };
  if (planEffect.kind === 'kv.get' || planEffect.kind === 'kv.put') return { ...base, store: kvStoreName(payload.store), key: payload.key, value: planEffect.kind === 'kv.put' ? payload.value : undefined };
  if (portableKv.isConditionalKv(planEffect.kind)) return { ...base, store: kvStoreName(payload.store), key: payload.key, value: payload.value, generation: payload.generation };
  if (planEffect.kind === 'event.emit') {
    return {
      ...base,
      providerKind: 'event',
      operation: 'emit',
      capability: 'event.emit',
      type: payload.type,
      emission: payload.emission
    };
  }
  if (planEffect.package && planEffect.contractId && planEffect.operation) {
    const staticPayload = payload && payload.payload && typeof payload.payload === 'object'
      ? payload.payload
      : {};
    const invocation = payload && payload.invocation && typeof payload.invocation === 'object'
      ? payload.invocation
      : {};
    return {
      ...base,
      package: String(planEffect.package),
      contractId: String(planEffect.contractId),
      providerKind: String(planEffect.providerKind || 'package'),
      operation: String(planEffect.operation),
      capability: String(planEffect.capability || planEffect.kind),
      result: String(planEffect.declaredResult || (planEffect.result && planEffect.result.valueKind) || 'value'),
      payload: { ...staticPayload, ...invocation }
    };
  }
  return { ...base, ...payload };
}

function decodeAssemblyScriptString(memory, pointer, length) {
  if (!(memory instanceof WebAssembly.Memory)) throw new CanonicalNativeHostError('AssemblyScript string decode requires WebAssembly memory.', 'PULSE_CANONICAL_NATIVE_MEMORY_MISSING');
  const ptr = Number(pointer);
  const size = Number(length);
  if (!Number.isSafeInteger(ptr) || ptr < 0 || (ptr & 1) !== 0 || !Number.isSafeInteger(size) || size < 0) {
    throw new CanonicalNativeHostError('AssemblyScript string pointer or length is invalid.', 'PULSE_CANONICAL_NATIVE_STRING_BOUNDS', { pointer, length });
  }
  if (size === 0) return '';
  const byteLength = size * 2;
  if (!Number.isSafeInteger(byteLength) || ptr + byteLength > memory.buffer.byteLength) {
    throw new CanonicalNativeHostError('AssemblyScript string exceeds module memory.', 'PULSE_CANONICAL_NATIVE_STRING_BOUNDS', { pointer: ptr, length: size, memoryBytes: memory.buffer.byteLength });
  }
  const view = new Uint16Array(memory.buffer, ptr, size);
  let output = '';
  const chunk = 8192;
  for (let index = 0; index < view.length; index += chunk) output += String.fromCharCode(...view.subarray(index, Math.min(view.length, index + chunk)));
  return output;
}

function decodeManagedAssemblyScriptString(memory, pointer) {
  const ptr = Number(pointer);
  if (!Number.isSafeInteger(ptr) || ptr < 4 || ptr > memory.buffer.byteLength) {
    throw new CanonicalNativeHostError('AssemblyScript managed string pointer is invalid.', 'PULSE_CANONICAL_NATIVE_STRING_BOUNDS', {
      pointer,
      memoryBytes: memory.buffer.byteLength
    });
  }
  const byteLength = new DataView(memory.buffer).getUint32(ptr - 4, true);
  if ((byteLength & 1) !== 0) {
    throw new CanonicalNativeHostError('AssemblyScript managed string byte length is invalid.', 'PULSE_CANONICAL_NATIVE_STRING_BOUNDS', {
      pointer: ptr,
      byteLength
    });
  }
  return decodeAssemblyScriptString(memory, ptr, byteLength >>> 1);
}

function decodePlanHash(instance) {
  const pointer = instance.exports.pulse_plan_hash_ptr();
  const length = instance.exports.pulse_plan_hash_length();
  return decodeAssemblyScriptString(instance.exports.memory, pointer, length);
}

function validateNativeModule(module, plan) {
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);
  const unsupportedModules = [...new Set(imports.map((entry) => entry.module).filter((name) => !['pulse_host', 'env'].includes(name)))];
  if (unsupportedModules.length > 0) {
    throw new CanonicalNativeHostError('Native module imports an unsupported module.', 'PULSE_CANONICAL_NATIVE_ABI_IMPORT_MISMATCH', { unsupportedModules, imports });
  }
  const allowedPulseImports = new Set(runtimeContract.CANONICAL_NATIVE_IMPORT_NAMES);
  const pulseImports = imports.filter((entry) => entry.module === 'pulse_host').map((entry) => entry.name).sort();
  const unexpectedPulseImports = pulseImports.filter((name) => !allowedPulseImports.has(name));
  if (unexpectedPulseImports.length > 0) {
    throw new CanonicalNativeHostError('Native module import surface exceeds the versioned pulse_host ABI.', 'PULSE_CANONICAL_NATIVE_ABI_IMPORT_MISMATCH', { unexpectedPulseImports, pulseImports });
  }
  const allowedEnvImports = new Set(runtimeContract.CANONICAL_NATIVE_ALLOWED_ENV_IMPORTS);
  const unexpectedEnvImports = imports.filter((entry) => entry.module === 'env' && !allowedEnvImports.has(entry.name));
  if (unexpectedEnvImports.length > 0) {
    throw new CanonicalNativeHostError('Native module imports an unsupported AssemblyScript environment function.', 'PULSE_CANONICAL_NATIVE_ABI_IMPORT_MISMATCH', { unexpectedEnvImports });
  }
  const exportNames = new Set(exports.map((entry) => entry.name));
  const missing = runtimeContract.CANONICAL_NATIVE_EXPORT_NAMES.filter((name) => !exportNames.has(name));
  if (missing.length > 0) throw new CanonicalNativeHostError('Native module is missing required ABI exports.', 'PULSE_CANONICAL_NATIVE_ABI_EXPORT_MISMATCH', { missing });
  if (!plan || typeof plan !== 'object' || !plan.planHash) throw new TypeError('Native module execution requires its canonical native plan.');
  const eventReachable = Boolean(plan.events && plan.events.catalog && plan.events.catalog.events.length > 0);
  const eventExportNames = eventContract.EVENT_NATIVE_ABI_EXTENSION.exports.map((entry) => entry.name);
  const presentEventExports = eventExportNames.filter((name) => exportNames.has(name));
  if (eventReachable && presentEventExports.length !== eventExportNames.length) {
    throw new CanonicalNativeHostError('Event-reachable Native module is missing its conditional event ABI.', 'PULSE_CANONICAL_NATIVE_EVENT_ABI_MISMATCH', {
      missing: eventExportNames.filter((name) => !exportNames.has(name))
    });
  }
  if (!eventReachable && presentEventExports.length > 0) {
    throw new CanonicalNativeHostError('HTTP-only Native module unexpectedly exposes the conditional event ABI.', 'PULSE_CANONICAL_NATIVE_EVENT_ABI_MISMATCH', { present: presentEventExports });
  }
  return Object.freeze({ imports, exports });
}

function instantiateCanonicalNativeModule(compiled, options = {}) {
  const plan = options.plan || compiled && compiled.plan;
  const wasm = Buffer.isBuffer(compiled) ? compiled : compiled && compiled.wasm;
  if (!Buffer.isBuffer(wasm)) throw new TypeError('instantiateCanonicalNativeModule requires compiled Wasm bytes.');
  if (!WebAssembly.validate(wasm)) throw new CanonicalNativeHostError('Canonical native Wasm validation failed.', 'PULSE_CANONICAL_NATIVE_WASM_INVALID');
  const module = new WebAssembly.Module(wasm);
  const moduleShape = validateNativeModule(module, plan);
  const adapter = normalizeProviderAdapter(options.providerAdapter || options.provider);
  const executionPlane = options.executionPlane === 'event' ? 'event' : 'http';
  const heap = new ValueHeap();
  const pending = [];
  const trace = [];
  const sensitiveValues = new Set();
  const configuredSecrets = options.secrets && typeof options.secrets === 'object' ? options.secrets : {};
  for (const value of Object.values(configuredSecrets)) if (typeof value === 'string' && value.length > 0) sensitiveValues.add(value);
  for (const value of Array.isArray(options.redactionValues) ? options.redactionValues : []) {
    if (typeof value === 'string' && value.length > 0) sensitiveValues.add(value);
  }
  let instance;
  const preflightSchemaCodecs = options.schemaCodecs || createSchemaCodecs(plan.schemas && plan.schemas.registry);
  const schemaIndexes = new Map((preflightSchemaCodecs.ids || []).map((id, index) => [String(id), index]));

  function nativeCodecRoundtrip(mode, schemaId, text) {
    const schemaIndex = schemaIndexes.get(String(schemaId));
    if (!Number.isInteger(schemaIndex)) {
      const failure = new Error(`Unknown compiled schema ${String(schemaId)}.`);
      failure.name = 'SchemaReferenceError';
      failure.code = 'PULSE_SCHEMA_REFERENCE';
      failure.detail = Object.freeze({ schemaId: String(schemaId), source: mode });
      throw failure;
    }
    const exports = instance && instance.exports;
    const method = mode === 'encode' ? 'pulse_schema_encode' : 'pulse_schema_decode';
    if (!exports
      || typeof exports.__new !== 'function'
      || typeof exports.__pin !== 'function'
      || typeof exports.__unpin !== 'function'
      || typeof exports.pulse_schema_string_id !== 'function'
      || typeof exports[method] !== 'function') {
      throw new CanonicalNativeHostError(
        'Native schema codec exports are unavailable.',
        'PULSE_CANONICAL_NATIVE_SCHEMA_ABI_MISSING',
        { schemaId: String(schemaId), mode, required: runtimeContract.CANONICAL_NATIVE_SCHEMA_EXPORT_NAMES }
      );
    }
    const input = String(text);
    const pointer = exports.__pin(exports.__new(input.length * 2, exports.pulse_schema_string_id()));
    try {
      if (input.length > 0) {
        const view = new Uint16Array(memory().buffer, pointer, input.length);
        for (let index = 0; index < input.length; index += 1) view[index] = input.charCodeAt(index);
      }
      const outputPointer = exports[method](schemaIndex, pointer);
      return decodeManagedAssemblyScriptString(memory(), outputPointer);
    } catch (cause) {
      if (cause && cause.code === 'PULSE_SCHEMA_REFERENCE') throw cause;
      const failure = new Error(`Native json-as ${mode} failed for schema ${String(schemaId)}.`);
      failure.name = mode === 'encode' ? 'SchemaEncodeError' : 'SchemaDecodeError';
      failure.code = mode === 'encode' ? 'PULSE_SCHEMA_ENCODE' : 'PULSE_SCHEMA_DECODE';
      failure.detail = Object.freeze({
        schemaId: String(schemaId),
        source: mode,
        backend: 'json-as',
        causeCode: cause && cause.code || null
      });
      failure.cause = cause;
      throw failure;
    } finally {
      exports.__unpin(pointer);
    }
  }

  const schemaCodecs = Object.freeze({
    ...preflightSchemaCodecs,
    version: 'pulse.canonical-native-json-as-schema-codecs.v2',
    backend: 'json-as',
    decodeJsonText(schemaId, text, source = 'json') {
      const normalized = preflightSchemaCodecs.decodeJsonText(schemaId, text, source);
      const filtered = preflightSchemaCodecs.encodeJsonText(schemaId, normalized, `${source}-preflight`);
      const output = nativeCodecRoundtrip('decode', schemaId, filtered);
      return preflightSchemaCodecs.decodeJsonText(schemaId, output, `${source}-postflight`);
    },
    encodeJsonText(schemaId, value, source = 'response') {
      const filtered = preflightSchemaCodecs.encodeJsonText(schemaId, value, `${source}-preflight`);
      const output = nativeCodecRoundtrip('encode', schemaId, filtered);
      preflightSchemaCodecs.decodeJsonText(schemaId, output, `${source}-postflight`);
      return output;
    }
  });
  const traceSink = Object.freeze({
    push(...events) {
      for (const event of events) trace.push(canonicalRuntime.redactRuntimeValue(event, sensitiveValues));
    },
    json(input, value) {
      const safeValue = value === undefined
        ? undefined
        : canonicalRuntime.redactRuntimeValue(value, sensitiveValues);
      const safeHeaders = input.headers === undefined
        ? undefined
        : canonicalRuntime.redactRuntimeValue(input.headers, sensitiveValues);
      trace.push(schemaCodecs.createTraceEvent({
        ...input,
        ...(safeHeaders === undefined ? {} : { headers: safeHeaders }),
        ...(safeValue === undefined ? {} : { semanticValue: safeValue }),
        target: input.target || 'native',
        provider: input.provider || adapter.id
      }));
    }
  });
  const plannedMaxBodyBytes = Number(plan.json && plan.json.limits && plan.json.limits.maxBytes || plan.schemas && plan.schemas.registry && plan.schemas.registry.maxBytes || 65536);
  const strict = options.strict === undefined ? plan.json && plan.json.strict === true : options.strict === true;
  const context = canonicalRuntime.createCanonicalContext({
    ...options,
    strict,
    maxBodyBytes: options.maxBodyBytes === undefined ? plannedMaxBodyBytes : options.maxBodyBytes,
    schemaCodecs,
    trace: traceSink,
    target: 'native',
    provider: adapter.id,
    reporting: options.reporting === undefined
      ? plan.logging && plan.logging.reporting && plan.logging.reporting.name
      : options.reporting,
    redactLogMessage(message) {
      return canonicalRuntime.redactRuntimeValue(message, sensitiveValues);
    }
  }, traceSink);
  function value(handle) { return heap.get(handle); }
  function put(input) { return heap.put(input); }
  function requireHttpSurface(surface) {
    if (executionPlane === 'event') {
      throw new CanonicalNativeHostError(`Event execution cannot access HTTP-only Native surface ${surface}.`, 'PULSE_CANONICAL_NATIVE_EVENT_HTTP_SURFACE', { surface });
    }
  }
  function requireExecutionPlane(expected) {
    if (executionPlane !== expected) {
      throw new CanonicalNativeHostError(
        `Native ${expected} entry cannot run through an ${executionPlane} execution controller.`,
        'PULSE_CANONICAL_NATIVE_EXECUTION_PLANE_MISMATCH',
        { expected, actual: executionPlane }
      );
    }
  }
  function memory() {
    if (!instance || !instance.exports || !(instance.exports.memory instanceof WebAssembly.Memory)) throw new CanonicalNativeHostError('Native module memory is unavailable.', 'PULSE_CANONICAL_NATIVE_MEMORY_MISSING');
    return instance.exports.memory;
  }

  function gripHeaderPairs(input) {
    const pairs = [];
    if (Array.isArray(input)) {
      for (const pair of input) {
        if (Array.isArray(pair) && pair.length === 2) pairs.push([String(pair[0]), String(pair[1])]);
      }
    } else if (input && typeof input === 'object') {
      for (const [name, entry] of Object.entries(input)) {
        if (Array.isArray(entry)) {
          for (const item of entry) pairs.push([String(name), String(item)]);
        } else pairs.push([String(name), String(entry)]);
      }
    }
    return pairs;
  }

  function gripHeaderValue(input, name) {
    const lower = String(name).toLowerCase();
    if (input && typeof input.header === 'function') return input.header(name);
    const matches = gripHeaderPairs(input && input.headers !== undefined ? input.headers : input)
      .filter(([key]) => key.toLowerCase() === lower)
      .map(([, entry]) => entry);
    return matches.length > 0 ? matches.join(', ') : undefined;
  }

  function gripChannels(options) {
    const input = options && options.channels !== undefined
      ? options.channels
      : (options && options.channel !== undefined ? [options.channel] : []);
    if (!Array.isArray(input) || input.length === 0) {
      throw new CanonicalNativeHostError('GRIP framing requires at least one channel.', 'PULSE_GRIP_CHANNEL_INVALID');
    }
    return input.map((entry) => {
      const channel = typeof entry === 'string' ? entry.trim() : '';
      if (!channel || /[,\r\n]/.test(channel)) {
        throw new CanonicalNativeHostError('GRIP channel names must be non-empty strings without commas or line breaks.', 'PULSE_GRIP_CHANNEL_INVALID');
      }
      return channel;
    });
  }

  function gripSubscriptionHeaders(inputHeaders, options) {
    const mode = options && options.mode === undefined ? 'stream' : options && options.mode;
    if (!['stream', 'response'].includes(mode)) {
      throw new CanonicalNativeHostError('GRIP subscription mode must be stream or response.', 'PULSE_GRIP_MODE_UNSUPPORTED');
    }
    const headers = gripHeaderPairs(inputHeaders).filter(([name]) => !['grip-hold', 'grip-channel', 'grip-timeout'].includes(name.toLowerCase()));
    headers.push(['Grip-Hold', mode]);
    for (const channel of gripChannels(options || {})) headers.push(['Grip-Channel', channel]);
    if (options && options.timeoutMs !== undefined) {
      const timeout = Number(options.timeoutMs);
      if (!Number.isSafeInteger(timeout) || timeout < 0) {
        throw new CanonicalNativeHostError('GRIP timeoutMs must be a non-negative safe integer.', 'PULSE_GRIP_TIMEOUT_INVALID');
      }
      headers.push(['Grip-Timeout', String(timeout)]);
    }
    return Object.freeze(headers.map((pair) => Object.freeze(pair)));
  }

  const pulseHost = {
    value_undefined() { return put(undefined); },
    value_null() { return put(null); },
    value_boolean(input) { return put(Number(input) !== 0); },
    value_number(input) { return put(Number(input)); },
    value_string(pointer, length) { return put(decodeAssemblyScriptString(memory(), pointer, length)); },
    value_array() { return put([]); },
    value_array_push(arrayHandle, valueHandle) {
      const target = value(arrayHandle);
      if (!Array.isArray(target)) throw new CanonicalNativeHostError('value_array_push target is not an array.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE', { arrayHandle });
      target.push(value(valueHandle));
    },
    value_array_spread(arrayHandle, valueHandle) {
      const target = value(arrayHandle);
      const source = value(valueHandle);
      if (!Array.isArray(target) || !source || typeof source[Symbol.iterator] !== 'function') throw new CanonicalNativeHostError('value_array_spread requires iterable input.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE');
      target.push(...source);
    },
    value_object() { return put({}); },
    value_object_set(objectHandle, keyHandle, valueHandle) {
      const target = value(objectHandle);
      if (!target || typeof target !== 'object') throw new CanonicalNativeHostError('value_object_set target is not an object.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE', { objectHandle });
      target[String(value(keyHandle))] = value(valueHandle);
    },
    value_object_spread(objectHandle, valueHandle) {
      const target = value(objectHandle);
      const source = value(valueHandle);
      if (!target || typeof target !== 'object') throw new CanonicalNativeHostError('value_object_spread target is not an object.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE');
      if (source === null || source === undefined) return;
      Object.assign(target, source);
    },
    value_property(objectHandle, keyHandle) {
      const target = value(objectHandle);
      if (target === null || target === undefined) throw new CanonicalNativeHostError('Cannot read a property from null or undefined.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE', { objectHandle });
      return put(target[String(value(keyHandle))]);
    },
    value_property_set(objectHandle, keyHandle, valueHandle) {
      const target = value(objectHandle);
      if (target === null || target === undefined) throw new CanonicalNativeHostError('Cannot write a property on null or undefined.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE', { objectHandle });
      const assigned = value(valueHandle);
      target[String(value(keyHandle))] = assigned;
      return valueHandle;
    },
    value_element(objectHandle, keyHandle) {
      const target = value(objectHandle);
      if (target === null || target === undefined) throw new CanonicalNativeHostError('Cannot read an element from null or undefined.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE', { objectHandle });
      return put(target[value(keyHandle)]);
    },
    value_element_set(objectHandle, keyHandle, valueHandle) {
      const target = value(objectHandle);
      if (target === null || target === undefined) throw new CanonicalNativeHostError('Cannot write an element on null or undefined.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE', { objectHandle });
      const assigned = value(valueHandle);
      target[value(keyHandle)] = assigned;
      return valueHandle;
    },
    value_binary(operatorIndex, leftHandle, rightHandle) {
      const operator = runtimeContract.CANONICAL_NATIVE_BINARY_OPERATORS[Number(operatorIndex)];
      return put(binary(operator, value(leftHandle), value(rightHandle)));
    },
    value_unary(operatorIndex, valueHandle) {
      const operator = runtimeContract.CANONICAL_NATIVE_UNARY_OPERATORS[Number(operatorIndex)];
      return put(unary(operator, value(valueHandle)));
    },
    value_truthy(valueHandle) { return value(valueHandle) ? 1 : 0; },
    value_string_trim(valueHandle) {
      const input = value(valueHandle);
      if (typeof input !== 'string') throw new CanonicalNativeHostError('String trim requires a string value.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE');
      return put(input.trim());
    },
    value_nullish(valueHandle) { return value(valueHandle) === null || value(valueHandle) === undefined ? 1 : 0; },
    log(level, messageHandle) {
      const methods = Object.freeze({ 1: 'error', 2: 'warn', 3: 'info', 4: 'debug' });
      const method = methods[Number(level)];
      if (!method) return;
      const message = value(messageHandle);
      if (typeof message !== 'string') return;
      try { context.ctx.log[method](message); }
      catch (_) { /* Logging is best effort at the host boundary. */ }
    },
    request_method() { requireHttpSurface('ctx.req.method'); return put(context.ctx.req.method); },
    request_url() { requireHttpSurface('ctx.req.url'); return put(context.ctx.req.url); },
    request_path() { requireHttpSurface('ctx.req.path'); return put(context.ctx.req.path); },
    request_headers() { requireHttpSurface('ctx.req.headers'); return put(context.ctx.req.headers); },
    request_header(nameHandle) {
      requireHttpSurface('ctx.req.header');
      const name = String(value(nameHandle)).toLowerCase();
      const header = context.ctx.req.headers.find(([key]) => String(key).toLowerCase() === name);
      return put(header ? header[1] : undefined);
    },
    request_text() { requireHttpSurface('ctx.req.text'); return put(context.ctx.req.text()); },
    request_json(schemaHandle) {
      requireHttpSurface('ctx.req.json');
      const schema = value(schemaHandle);
      return put(schema === undefined ? context.ctx.req.json() : context.ctx.req.json(schema));
    },
    router_match(pathHandle, patternHandle) { return put(routerMatch(value(pathHandle), value(patternHandle))); },
    router_param(pathHandle, patternHandle, nameHandle) { return put(routerParam(value(pathHandle), value(patternHandle), value(nameHandle))); },
    response_json(valueHandle, optionsHandle) { requireHttpSurface('ctx.json'); return put(context.ctx.json(value(valueHandle), value(optionsHandle))); },
    schema_encode(valueHandle, schemaHandle) { return put(context.ctx.encodeJson(value(valueHandle), value(schemaHandle))); },
    schema_decode(textHandle, schemaHandle) { return put(context.ctx.decodeJson(value(textHandle), value(schemaHandle))); },
    response_text(valueHandle, optionsHandle) { requireHttpSurface('ctx.text'); return put(context.ctx.text(value(valueHandle), value(optionsHandle))); },
    response_custom(valueHandle) { requireHttpSurface('ctx.response'); return put(context.ctx.response(value(valueHandle))); },
    grip_is_websocket() {
      requireHttpSurface('grip.isWebSocket');
      const request = context.ctx.req;
      const contentType = String(gripHeaderValue(request, 'content-type') || '').toLowerCase();
      const accept = String(gripHeaderValue(request, 'accept') || '').toLowerCase();
      const upgrade = String(gripHeaderValue(request, 'upgrade') || '').toLowerCase();
      const connection = String(gripHeaderValue(request, 'connection') || '').toLowerCase();
      return put(
        contentType.includes('application/websocket-events')
        || accept.includes('application/websocket-events')
        || (upgrade === 'websocket' && connection.split(',').some((entry) => entry.trim() === 'upgrade'))
      );
    },
    grip_subscribe(responseHandle, optionsHandle) {
      requireHttpSurface('grip.subscribe');
      const response = value(responseHandle);
      const optionsValue = value(optionsHandle);
      if (!response || typeof response !== 'object') {
        throw new CanonicalNativeHostError('grip.subscribe requires a canonical response.', 'PULSE_GRIP_RESPONSE_REQUIRED');
      }
      return put(Object.freeze({
        ...response,
        headers: gripSubscriptionHeaders(response.headers, optionsValue || {})
      }));
    },
    grip_handoff(optionsHandle) {
      requireHttpSurface('grip.handoff');
      const optionsValue = value(optionsHandle);
      if (!optionsValue || typeof optionsValue !== 'object' || Array.isArray(optionsValue)) {
        throw new CanonicalNativeHostError('grip.handoff requires a static options object.', 'PULSE_GRIP_OPTIONS_REQUIRED');
      }
      const headers = gripHeaderPairs(optionsValue.headers);
      if (!headers.some(([name]) => name.toLowerCase() === 'content-type')) {
        headers.push(['Content-Type', 'application/websocket-events']);
      }
      const framed = gripSubscriptionHeaders(headers, optionsValue);
      const status = optionsValue.status === undefined ? 200 : Number(optionsValue.status);
      if (!Number.isSafeInteger(status) || status < 200 || status > 599) {
        throw new CanonicalNativeHostError('GRIP handoff status must be an integer from 200 through 599.', 'PULSE_GRIP_STATUS_INVALID');
      }
      return put(Object.freeze({
        status,
        kind: optionsValue.body === undefined || optionsValue.body === null || String(optionsValue.body).length === 0 ? 'empty' : 'text',
        bodyClass: 'structured',
        body: optionsValue.body === undefined || optionsValue.body === null ? '' : String(optionsValue.body),
        headers: framed,
        builder: 'grip.handoff'
      }));
    },
    kv_namespace(nameHandle) { return put(Object.freeze({ kind: 'kv-namespace', name: String(value(nameHandle)) })); },
    fetch_json(responseHandle, schemaHandle) {
      const response = value(responseHandle);
      if (!response || typeof response.json !== 'function') throw new CanonicalNativeHostError('fetch_json requires a structured fetch response.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE');
      const schema = value(schemaHandle);
      return put(schema === undefined ? response.json() : response.json(schema));
    },
    fetch_text(responseHandle) {
      const response = value(responseHandle);
      if (!response || typeof response.text !== 'function') throw new CanonicalNativeHostError('fetch_text requires a structured fetch response.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE');
      return put(response.text());
    },
    fetch_header(responseHandle, nameHandle) {
      const response = value(responseHandle);
      if (!response || typeof response.header !== 'function') throw new CanonicalNativeHostError('fetch_header requires a fetch response.', 'PULSE_CANONICAL_NATIVE_VALUE_TYPE');
      return put(response.header(value(nameHandle)));
    },
    effect_begin(effectIndex, payloadHandle) {
      const index = Number(effectIndex);
      const effect = plan.effects && plan.effects[index];
      if (!effect) throw new CanonicalNativeHostError(`Native module requested unknown effect index ${index}.`, 'PULSE_CANONICAL_NATIVE_EFFECT_INDEX_INVALID', { effectIndex: index });
      const payload = value(payloadHandle);
      const kvAdmission = portableKv.isConditionalKv(effect.kind) ? portableKv.admitConditionalKv(nativeEffect(effect, payload), options) : undefined;
      if (kvAdmission) portableKv.registerKvRedactions(kvAdmission, (value) => sensitiveValues.add(value));
      pending.push(Object.freeze({ index, effect, payload, ...(kvAdmission ? { kvAdmission } : {}) }));
    }
  };

  const env = {};
  for (const item of moduleShape.imports.filter((entry) => entry.module === 'env')) {
    if (item.kind !== 'function') continue;
    if (item.name === 'abort') {
      env.abort = (messagePointer, filePointer, line, column) => {
        const message = decodeAssemblyScriptString(memory(), messagePointer, new DataView(memory().buffer).getUint32((Number(messagePointer) >>> 0) - 4, true) >>> 1);
        const file = decodeAssemblyScriptString(memory(), filePointer, new DataView(memory().buffer).getUint32((Number(filePointer) >>> 0) - 4, true) >>> 1);
        throw new CanonicalNativeHostError(`AssemblyScript abort: ${message}`, 'PULSE_CANONICAL_NATIVE_AS_ABORT', { file, line, column });
      };
    } else if (item.name === 'seed') env.seed = () => 0;
    else env[item.name] = () => { throw new CanonicalNativeHostError(`Unsupported AssemblyScript env import ${item.name}.`, 'PULSE_CANONICAL_NATIVE_ENV_IMPORT_UNSUPPORTED', { name: item.name }); };
  }

  let applicationError = 0;
  const applicationErrors = executionPlane === 'http' && (plan.routing?.entries || []).some(entry => entry.kind === 'error');
  function captureApplicationError(error) {
    if (!applicationErrors || options.signal?.aborted || !portableKv.isApplicationError(error)) return false;
    if (!applicationError) {
      const safe = canonicalRuntime.redactRuntimeError(error, sensitiveValues);
      applicationError = put(Object.freeze({ name: safe.name, code: safe.code, message: safe.message }));
    }
    return true;
  }
  if (applicationErrors) for (const [name, implementation] of Object.entries(pulseHost)) {
    pulseHost[name] = (...args) => {
      if (applicationError) return 0;
      try { return implementation(...args); }
      catch (error) { if (!captureApplicationError(error)) throw error; return 0; }
    };
  }
  pulseHost.router_error_take = () => { const error = applicationError; applicationError = 0; return error; };
  instance = new WebAssembly.Instance(module, { pulse_host: pulseHost, env });
  if (schemaIndexes.size > 0) {
    const available = new Set(moduleShape.exports.map((entry) => entry.name));
    const missingSchemaExports = runtimeContract.CANONICAL_NATIVE_SCHEMA_EXPORT_NAMES.filter((name) => !available.has(name));
    if (missingSchemaExports.length > 0) {
      throw new CanonicalNativeHostError(
        'Native module is missing its generated schema codec ABI.',
        'PULSE_CANONICAL_NATIVE_SCHEMA_ABI_MISSING',
        { missing: missingSchemaExports, schemaIds: [...schemaIndexes.keys()] }
      );
    }
  }
  if (instance.exports.pulse_abi_version() !== runtimeContract.CANONICAL_NATIVE_ABI_VERSION) {
    throw new CanonicalNativeHostError('Native module ABI version mismatch.', 'PULSE_CANONICAL_NATIVE_ABI_VERSION_MISMATCH', { expected: runtimeContract.CANONICAL_NATIVE_ABI_VERSION, actual: instance.exports.pulse_abi_version() });
  }
  const eventReachable = Boolean(plan.events && plan.events.catalog && plan.events.catalog.events.length > 0);
  if (eventReachable && instance.exports.pulse_event_abi_version() !== eventContract.EVENT_NATIVE_ABI_EXTENSION.abiVersion) {
    throw new CanonicalNativeHostError('Native module event ABI version mismatch.', 'PULSE_CANONICAL_NATIVE_EVENT_ABI_VERSION_MISMATCH', {
      expected: eventContract.EVENT_NATIVE_ABI_EXTENSION.abiVersion,
      actual: instance.exports.pulse_event_abi_version()
    });
  }
  const actualPlanHash = decodePlanHash(instance);
  if (actualPlanHash !== plan.planHash) throw new CanonicalNativeHostError('Native module plan hash does not match its supplied plan.', 'PULSE_CANONICAL_NATIVE_PLAN_HASH_MISMATCH', { expected: plan.planHash, actual: actualPlanHash });
  const nativeCrypto = createNativeGuestSourceCryptoVerifier({
    plan,
    exports: instance.exports
  });

  function takePending() {
    const items = pending.splice(0, pending.length);
    return Object.freeze(items);
  }

  function prepareEffectResult(index, rawResult) {
    const effectIndex = Number(index);
    const effect = plan.effects && plan.effects[effectIndex];
    if (!effect) {
      throw new CanonicalNativeHostError(`Native host cannot prepare an unknown effect index ${effectIndex}.`, 'PULSE_CANONICAL_NATIVE_EFFECT_INDEX_INVALID', { effectIndex });
    }

    let result = portableKv.isConditionalKv(effect.kind) ? portableKv.normalizeConditionalKvResult(effect, rawResult, options) : rawResult;
    if (effect.kind === 'event.emit' && result !== undefined) {
      throw new canonicalRuntime.CanonicalRuntimeError(
        'EventAcceptanceError',
        'PULSE_RUNTIME_EVENT_EMIT_ACCEPTANCE_INVALID',
        'Pulse event emit providers must acknowledge host acceptance with undefined.',
        { receivedType: Array.isArray(result) ? 'array' : result === null ? 'null' : typeof result }
      );
    }
    if (effect.kind === 'fetch' || (effect.result && effect.result.valueKind === 'opaque-response')) {
      const response = effect.kind === 'fetch'
        ? nativeFetchResponseContract(effect)
        : Object.freeze({ responseMode: 'opaque', projection: 'response' });
      result = canonicalRuntime.normalizeFetchResponse(rawResult, effect.id, adapter.id, schemaCodecs, {
        maxBytes: options.maxFetchBodyBytes || options.maxStructuredBodyBytes || options.maxBodyBytes,
        strict,
        responseMode: response.responseMode,
        trace: traceSink,
        target: 'native',
        provider: adapter.id,
        effectId: effect.id,
        groupId: effect.groupKey
      });
    }

    const decoder = effect.result && effect.result.decoder;
    if (decoder && decoder.kind === 'json') {
      const decoderArguments = (decoder.arguments || []).map((argument) => staticDecoderArgument(argument, effect));
      result = result.json(...decoderArguments);
    } else if (decoder && decoder.kind === 'text') {
      result = result.text();
    }

    if (effect.kind === 'secret.get' && typeof result === 'string') sensitiveValues.add(result);
    return result;
  }

  function setEffectResult(index, result) {
    const handle = put(result);
    const accepted = instance.exports.pulse_set_effect_result(Number(index), handle);
    if (accepted !== runtimeContract.CANONICAL_NATIVE_RESULT_STATUS.ACCEPTED) {
      throw new CanonicalNativeHostError(`Native module rejected effect result index ${index}.`, 'PULSE_CANONICAL_NATIVE_EFFECT_INDEX_INVALID', { effectIndex: Number(index), errorCode: instance.exports.pulse_last_error_code() });
    }
    return handle;
  }

  function resultValue() {
    const handle = instance.exports.pulse_result_handle();
    return handle === 0 ? undefined : value(handle);
  }

  let activeEvent;
  function startEvent(inputFrame) {
    requireExecutionPlane('event');
    if (!eventReachable) {
      throw new CanonicalNativeHostError('Native plan does not contain an event entry.', 'PULSE_CANONICAL_NATIVE_EVENT_UNREACHABLE');
    }
    const frame = eventContract.normalizeEventFrame(inputFrame, options.eventLimits);
    const selected = plan.events.catalog.events.find((entry) => entry.type === frame.type);
    if (!selected) {
      throw new CanonicalNativeHostError(`Native event type ${JSON.stringify(frame.type)} is not registered.`, 'PULSE_CANONICAL_NATIVE_EVENT_HANDLER_NOT_FOUND', { type: frame.type });
    }
    if (selected.schemaId !== frame.schemaId) {
      throw new CanonicalNativeHostError('Native event frame schema does not match its registration.', 'PULSE_CANONICAL_NATIVE_EVENT_SCHEMA_MISMATCH', {
        type: frame.type,
        expectedSchemaId: selected.schemaId,
        actualSchemaId: frame.schemaId
      });
    }
    const validated = frame.schemaId === null
      ? frame
      : eventContract.normalizeEventFrame({
          ...frame,
          payload: schemaCodecs.decode(frame.schemaId, frame.payload, 'event-ingress')
        }, options.eventLimits);
    const payloadHandle = frame.schemaId === null ? 0 : put(validated.payload);
    activeEvent = Object.freeze({
      runtimeId: selected.runtimeId,
      stableId: selected.stableId,
      type: selected.type,
      schemaId: selected.schemaId,
      payloadHandle
    });
    return instance.exports.pulse_event_start(selected.runtimeId, payloadHandle);
  }

  return Object.freeze({
    version: runtimeContract.CANONICAL_NATIVE_HOST_VERSION,
    plan,
    module,
    instance,
    exports: instance.exports,
    heap,
    adapter,
    context,
    schemaCodecs,
    trace,
    traceSink,
    sensitiveValues,
    cryptoVerifier: nativeCrypto.verifier,
    cryptoRealization: nativeCrypto.realization,
    executionPlane,
    start() { requireExecutionPlane('http'); return instance.exports.pulse_start(); },
    startEvent,
    eventSelection() { return activeEvent; },
    resume() { return instance.exports.pulse_resume(); },
    pendingEffects: takePending,
    prepareEffectResult,
    captureApplicationError,
    setEffectResult,
    resultValue,
    response() { requireHttpSurface('HTTP completion'); return canonicalRuntime.finalResponse(resultValue(), context.ctx.req.method); },
    programCounter() { return instance.exports.pulse_program_counter(); },
    continuationState() { return instance.exports.pulse_continuation_state(); },
    lastErrorCode() { return instance.exports.pulse_last_error_code(); },
    wasmSha256: sha256(wasm)
  });
}

function redactValue(value, sensitiveValues) {
  return canonicalRuntime.redactRuntimeValue(value, sensitiveValues);
}

function nativeEventCancelled(message) {
  return new CanonicalNativeHostError(message, 'PULSE_CANONICAL_NATIVE_EVENT_CANCELLED');
}

function nativeRequestCancelled(signal) {
  return new portableKv.PulseRuntimeContractError('PULSE_RUNTIME_EFFECT_ABORTED',
    signal.reason instanceof Error ? signal.reason.message : 'Native execution was cancelled.',
    { cause: signal.reason });
}

function raceNativeSignal(value, signal, eventMode = true) {
  if (!signal) return Promise.resolve(value);
  const cancelled = () => eventMode ? nativeEventCancelled('Native event execution was cancelled during effect dispatch.')
    : nativeRequestCancelled(signal);
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(result);
    };
    const onAbort = () => finish(reject, cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error)
    );
  });
}

async function executeCanonicalNativeInvocation(compiled, options = {}, invocation = Object.freeze({ plane: 'http' })) {
  const eventMode = invocation && invocation.plane === 'event';
  const maxEffects = normalizeMaxEffects(options.maxEffects);
  const controller = instantiateCanonicalNativeModule(compiled, { ...options, executionPlane: eventMode ? 'event' : 'http' });
  const adapter = controller.adapter;
  const packageArtifacts = Object.freeze([
    ...(Array.isArray(options.packageArtifacts)
      ? options.packageArtifacts
      : compiled && Array.isArray(compiled.realizationArtifacts)
        ? compiled.realizationArtifacts
        : [])
  ]);
  const executionId = String(options.executionId || `canonical-native-${eventMode ? 'event-' : ''}${++executionSequence}`);
  const resolutionOrder = [];
  const continuations = [];
  let effectCount = 0;
  let status;
  let executionFailure;
  let activeContinuation;
  try {
    if (!eventMode && options.signal?.aborted) throw nativeRequestCancelled(options.signal);
    if (eventMode && options.signal && options.signal.aborted) {
      throw nativeEventCancelled('Native event execution was cancelled before handler entry.');
    }
    status = eventMode ? controller.startEvent(invocation.frame) : controller.start();
    while (status === runtimeContract.CANONICAL_NATIVE_RUN_STATUS.SUSPENDED) {
      if (eventMode && options.signal && options.signal.aborted) {
        throw nativeEventCancelled('Native event execution was cancelled while suspended.');
      }
      const pending = controller.pendingEffects();
      if (pending.length !== controller.exports.pulse_pending_count()) {
        throw new CanonicalNativeHostError('Native pending-effect count differs from host queue.', 'PULSE_CANONICAL_NATIVE_PENDING_MISMATCH', { moduleCount: controller.exports.pulse_pending_count(), hostCount: pending.length });
      }
      const continuationState = controller.continuationState();
      const continuation = controller.plan.continuations.find((entry) => Number(entry.stateIndex) === Number(continuationState));
      if (!continuation) throw new CanonicalNativeHostError('Native suspension references an unknown continuation state.', 'PULSE_CANONICAL_NATIVE_CONTINUATION_MISMATCH', { continuationState });
      const pendingEffectIds = pending.map((entry) => entry.effect.id);
      if (JSON.stringify(pendingEffectIds) !== JSON.stringify(continuation.effectIds)) {
        throw new CanonicalNativeHostError('Native pending effects do not match the continuation contract.', 'PULSE_CANONICAL_NATIVE_CONTINUATION_MISMATCH', { continuationId: continuation.id, expected: continuation.effectIds, actual: pendingEffectIds });
      }
      activeContinuation = {
        id: continuation.id,
        kind: continuation.kind,
        effectIds: Object.freeze([...pendingEffectIds]),
        stateIndex: continuationState,
        state: 'waiting',
        states: ['created', 'waiting']
      };
      continuations.push(activeContinuation);
      controller.trace.push(Object.freeze(redactValue({ type: 'native-continuation-waiting', executionId, continuationId: continuation.id, continuationState, effectIds: Object.freeze([...pendingEffectIds]) }, controller.sensitiveValues)));
      if (effectCount + pending.length > maxEffects) {
        throw new CanonicalNativeHostError(
          eventMode
            ? `Pulse event invocation exceeded the maximum of ${maxEffects} execution-owned effects.`
            : `Pulse request exceeded the maximum of ${maxEffects} request-owned effects.`,
          'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED',
          { effectCount, pendingEffects: pending.length, maxEffects, executionKind: eventMode ? 'event' : 'request' }
        );
      }
      effectCount += pending.length;

      const settled = await raceNativeSignal(Promise.allSettled(pending.map(async (entry) => {
        if (eventMode && options.signal && options.signal.aborted) {
          throw nativeEventCancelled('Native event execution was cancelled before effect dispatch.');
        }
        const rawEffect = { ...nativeEffect(entry.effect, entry.payload), ...entry.kvAdmission };
        const conditional = portableKv.isConditionalKv(rawEffect.kind);
        const privateEffect = conditional || ((controller.plan.packages && controller.plan.packages.effects) || []).some((item) =>
          item.package === entry.effect.package && item.contractId === entry.effect.contractId && item.operation === entry.effect.operation
          && item.redaction && Object.keys(item.redaction).length > 0);
        const normalized = canonicalRuntime.normalizeProviderEffect(rawEffect, controller.schemaCodecs, {
          ...options,
          strict: options.strict === undefined
            ? controller.plan.json && controller.plan.json.strict === true
            : options.strict === true,
          trace: controller.traceSink,
          target: 'native',
          provider: adapter.id
        });
        controller.trace.push(Object.freeze(redactValue({ type: 'native-effect-start', executionId, provider: adapter.id, effectId: normalized.id, kind: normalized.kind, payload: privateEffect ? '<redacted>' : entry.payload }, controller.sensitiveValues)));
        const effectExecution = {
          ...options,
          executionId,
          metadata: compiled && compiled.plan ? compiled.plan.canonical : controller.plan.canonical,
          plan: controller.plan,
          packageArtifacts,
          cryptoVerifier: controller.cryptoVerifier,
          cryptoRealization: controller.cryptoRealization,
          trace: controller.trace,
          registerRedactionValue(value) {
            if (typeof value === 'string' && value.length > 0) controller.sensitiveValues.add(value);
          },
          validateSchemaValue(schemaId, value, context = {}) {
            return controller.schemaCodecs.decode(String(schemaId), value, context.source || 'package-effect');
          }
        };
        const rawResult = conditional
          ? await portableKv.executeConditionalKv(normalized, adapter.prepareConditionalKv || ((_admitted, kvExecution) => () => adapter.dispatchEffect(normalized, kvExecution)),
              { ...effectExecution, onKvObservation: (event) => controller.trace.push(event) }, options)
          : await raceNativeSignal(adapter.dispatchEffect(normalized, effectExecution), eventMode ? options.signal : undefined);
        const result = controller.prepareEffectResult(entry.index, rawResult);
        controller.trace.push(Object.freeze(redactValue({ type: 'native-effect-resolved', executionId, provider: adapter.id, effectId: normalized.id, kind: normalized.kind, result: privateEffect || entry.effect.kind === 'secret.get' ? '<redacted>' : result && typeof result.toJSON === 'function' ? result.toJSON() : result }, controller.sensitiveValues)));
        resolutionOrder.push(entry.effect.id);
        return { entry, result };
      })), options.signal, eventMode);

      if (eventMode && options.signal && options.signal.aborted) {
        throw nativeEventCancelled('Native event execution was cancelled while suspended.');
      }
      if (!eventMode && options.signal?.aborted) throw nativeRequestCancelled(options.signal);
      const failures = settled.filter(entry => entry.status === 'rejected');
      const failed = failures.find(entry => !portableKv.isApplicationError(entry.reason)) || failures[0];
      if (failed && (!failures.every(entry => portableKv.isApplicationError(entry.reason))
        || !controller.captureApplicationError(failed.reason))) {
        throw canonicalRuntime.redactRuntimeError(failed.reason, controller.sensitiveValues);
      }
      settled.forEach((item, index) => controller.setEffectResult(pending[index].index,
        item.status === 'fulfilled' ? item.value.result : undefined));
      const previousPc = controller.programCounter();
      activeContinuation.state = 'resumed';
      activeContinuation.states.push('resumed');
      status = controller.resume();
      if (status === runtimeContract.CANONICAL_NATIVE_RUN_STATUS.INVALID_RESUME) {
        throw new CanonicalNativeHostError('Native module rejected a complete effect-result set.', 'PULSE_CANONICAL_NATIVE_INVALID_RESUME', { programCounter: previousPc, errorCode: controller.lastErrorCode() });
      }
      activeContinuation.state = failed ? 'failed' : 'completed';
      activeContinuation.states.push(activeContinuation.state);
      controller.trace.push(Object.freeze(redactValue({ type: 'native-continuation-resumed', executionId, continuationId: continuation.id, continuationState }, controller.sensitiveValues)));
      activeContinuation = undefined;
    }

    if (status !== runtimeContract.CANONICAL_NATIVE_RUN_STATUS.COMPLETE) {
      throw new CanonicalNativeHostError('Native module execution failed.', 'PULSE_CANONICAL_NATIVE_EXECUTION_FAILED', { status, errorCode: controller.lastErrorCode(), programCounter: controller.programCounter() });
    }
    if (eventMode) {
      if (options.signal && options.signal.aborted) {
        throw nativeEventCancelled('Native event execution was cancelled before completion.');
      }
      if (controller.resultValue() !== undefined) {
        throw new CanonicalNativeHostError('Native event handlers must complete with void.', 'PULSE_CANONICAL_NATIVE_EVENT_RESULT_INVALID', {
          resultType: typeof controller.resultValue()
        });
      }
      const selection = controller.eventSelection();
      controller.trace.push(Object.freeze(redactValue({ type: 'native-event-execution-completed', executionId, eventStableId: selection.stableId, eventType: selection.type }, controller.sensitiveValues)));
      return Object.freeze({
        kind: 'event',
        executionId,
        planHash: controller.plan.planHash,
        wasmSha256: controller.wasmSha256,
        event: selection,
        effectCount,
        resolutionOrder: Object.freeze([...resolutionOrder]),
        continuations: Object.freeze(continuations.map((entry) => Object.freeze({ ...entry, states: Object.freeze([...entry.states]) }))),
        trace: Object.freeze([...controller.trace]),
        valueHandleCount: controller.heap.size()
      });
    }
    if (options.signal?.aborted) throw nativeRequestCancelled(options.signal);
    const response = controller.response();
    controller.trace.push(Object.freeze(redactValue({ type: 'native-execution-completed', executionId, provider: adapter.id, status: response.status, bodyClass: response.bodyClass }, controller.sensitiveValues)));
    return Object.freeze({
      status: 'completed',
      version: runtimeContract.CANONICAL_NATIVE_HOST_VERSION,
      abiVersion: runtimeContract.CANONICAL_NATIVE_ABI_VERSION,
      provider: adapter.id,
      providerVersion: adapter.version,
      providerMetadata: adapter.resultMetadata({ ...options, executionId, metadata: controller.plan.canonical, plan: controller.plan }),
      executionId,
      planHash: controller.plan.planHash,
      wasmSha256: controller.wasmSha256,
      response,
      effectCount,
      resolutionOrder: Object.freeze([...resolutionOrder]),
      continuations: Object.freeze(continuations.map((entry) => Object.freeze({ ...entry, states: Object.freeze([...entry.states]) }))),
      trace: Object.freeze([...controller.trace]),
      valueHandleCount: controller.heap.size()
    });
  } catch (error) {
    executionFailure = canonicalRuntime.redactRuntimeError(error, controller.sensitiveValues);
    if (activeContinuation && activeContinuation.state !== 'completed') {
      activeContinuation.state = 'failed';
      activeContinuation.states.push('failed');
    }
    Object.defineProperty(executionFailure, 'execution', { configurable: true, value: Object.freeze({
      executionId,
      planHash: controller.plan.planHash,
      trace: Object.freeze([...controller.trace]),
      resolutionOrder: Object.freeze([...resolutionOrder]),
      continuations: Object.freeze(continuations.map((entry) => Object.freeze({ ...entry, states: Object.freeze([...entry.states]) })))
    }) });
    throw executionFailure;
  } finally {
    try { adapter.disposeExecution(Object.freeze({ executionId, metadata: controller.plan.canonical, plan: controller.plan, status: executionFailure ? 'failed' : 'completed', error: executionFailure })); }
    catch (_) { /* provider cleanup must not mask execution */ }
  }
}

async function executeCanonicalNativeModule(compiled, options = {}) {
  return executeCanonicalNativeInvocation(compiled, options, Object.freeze({ plane: 'http' }));
}

function nativeEventFailure(error) {
  const code = error && typeof error.code === 'string' ? error.code : 'PULSE_CANONICAL_NATIVE_EVENT_FAILED';
  const category = code === 'PULSE_CANONICAL_NATIVE_EVENT_HANDLER_NOT_FOUND'
    ? 'handler-not-found'
    : code === 'PULSE_CANONICAL_NATIVE_EVENT_CANCELLED'
      ? 'cancelled'
    : code === 'PULSE_CANONICAL_NATIVE_EVENT_SCHEMA_MISMATCH'
      ? 'schema-mismatch'
      : code.startsWith('PULSE_SCHEMA_')
        ? 'schema-validation-failed'
        : code.startsWith('PULSEWASM_EVENTS_')
          ? 'invalid-frame'
          : code === 'PULSE_CANONICAL_NATIVE_EVENT_RESULT_INVALID'
            ? 'completion-invalid'
            : 'handler-failed';
  return Object.freeze({
    category,
    name: String(error && error.name || 'Error').slice(0, 256),
    code: String(code).slice(0, 256),
    message: String(error && error.message || 'Native event execution failed.').slice(0, eventContract.EVENT_DEFAULT_LIMITS.maxErrorBytes)
  });
}

async function executeCanonicalNativeEvent(compiled, frame, options = {}) {
  try {
    const evidence = await executeCanonicalNativeInvocation(compiled, options, Object.freeze({ plane: 'event', frame }));
    if (typeof options.onEventExecutionEvidence === 'function') options.onEventExecutionEvidence(evidence);
    return eventContract.normalizeEventExecutionResult({
      version: eventContract.EVENT_EXECUTION_RESULT_VERSION,
      status: eventContract.EVENT_EXECUTION_STATUS.COMPLETED
    }, options.eventLimits);
  } catch (error) {
    const evidence = error && error.execution;
    if (evidence && typeof options.onEventExecutionEvidence === 'function') options.onEventExecutionEvidence(evidence);
    return eventContract.normalizeEventExecutionResult({
      version: eventContract.EVENT_EXECUTION_RESULT_VERSION,
      status: eventContract.EVENT_EXECUTION_STATUS.FAILED,
      error: nativeEventFailure(error)
    }, options.eventLimits);
  }
}

module.exports = Object.freeze({
  CANONICAL_NATIVE_HOST_VERSION: runtimeContract.CANONICAL_NATIVE_HOST_VERSION,
  CANONICAL_NATIVE_ABI_VERSION: runtimeContract.CANONICAL_NATIVE_ABI_VERSION,
  CANONICAL_NATIVE_RUN_STATUS: runtimeContract.CANONICAL_NATIVE_RUN_STATUS,
  CANONICAL_NATIVE_ERROR_CODES: runtimeContract.CANONICAL_NATIVE_ERROR_CODES,
  CanonicalNativeHostError,
  ValueHeap,
  createSchemaCodecs,
  createNativeGuestSourceCryptoVerifier,
  instantiateCanonicalNativeModule,
  executeCanonicalNativeModule,
  executeCanonicalNativeEvent,
  decodeAssemblyScriptString,
  redactValue
});
