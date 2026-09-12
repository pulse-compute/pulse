'use strict';

const { PulseRuntimeContractError } = require('./errors.js');

const DEFAULT_MAX_BINDING_NAME_BYTES = 256;
const DEFAULT_MAX_BINDING_VALUE_BYTES = 65_536;
const DEFAULT_MAX_KV_NAMESPACE_BYTES = 256;
const DEFAULT_MAX_KV_KEY_BYTES = 1_024;
const DEFAULT_MAX_KV_VALUE_BYTES = 65_536;
const DEFAULT_MAX_KV_VALUE_DEPTH = 64;
const DEFAULT_MAX_KV_VALUE_ENTRIES = 10_000;
const textEncoder = new TextEncoder();

function byteLength(value) {
  return textEncoder.encode(String(value)).byteLength;
}

function positiveLimit(label, value, fallback) {
  const normalized = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError(`Pulse ${label} must be a positive safe integer.`);
  }
  return normalized;
}

function contractError(code, message, detail) {
  return new PulseRuntimeContractError(code, message, {
    detail: detail === undefined ? undefined : Object.freeze({ ...detail })
  });
}

function boundedString(label, value, options) {
  const {
    invalidCode,
    tooLargeCode,
    maxBytes,
    detail = {}
  } = options;
  if (typeof value !== 'string' || value.length === 0) {
    throw contractError(invalidCode, `Pulse ${label} must be a non-empty string.`, {
      ...detail,
      valueType: typeof value
    });
  }
  const bytes = byteLength(value);
  if (bytes > maxBytes) {
    throw contractError(tooLargeCode, `Pulse ${label} exceeds the ${maxBytes} byte limit.`, {
      ...detail,
      bytes,
      maxBytes
    });
  }
  return value;
}

function normalizeBindingName(kind, value, options = {}) {
  const bindingKind = String(kind || 'binding');
  return boundedString(`${bindingKind} name`, value, {
    invalidCode: 'PULSE_BINDING_NAME_INVALID',
    tooLargeCode: 'PULSE_BINDING_NAME_TOO_LARGE',
    maxBytes: positiveLimit('maxBindingNameBytes', options.maxBindingNameBytes, DEFAULT_MAX_BINDING_NAME_BYTES),
    detail: { bindingKind }
  });
}

function normalizeKvNamespace(value, options = {}) {
  return boundedString('KV namespace', value, {
    invalidCode: 'PULSE_KV_NAMESPACE_INVALID',
    tooLargeCode: 'PULSE_KV_NAMESPACE_TOO_LARGE',
    maxBytes: positiveLimit('maxKvNamespaceBytes', options.maxKvNamespaceBytes, DEFAULT_MAX_KV_NAMESPACE_BYTES)
  });
}

function normalizeKvKey(value, options = {}) {
  return boundedString('KV key', value, {
    invalidCode: 'PULSE_KV_KEY_INVALID',
    tooLargeCode: 'PULSE_KV_KEY_TOO_LARGE',
    maxBytes: positiveLimit('maxKvKeyBytes', options.maxKvKeyBytes, DEFAULT_MAX_KV_KEY_BYTES)
  });
}

function normalizeBindingValueInternal(kind, value, options = {}) {
  if (value === undefined) return undefined;
  const bindingKind = String(kind || 'binding');
  if (typeof value !== 'string') {
    throw contractError(
      'PULSE_BINDING_VALUE_INVALID',
      `Pulse ${bindingKind} providers must return a string or undefined.`,
      { bindingKind, valueType: value === null ? 'null' : typeof value }
    );
  }
  const maxBytes = positiveLimit('maxBindingValueBytes', options.maxBindingValueBytes, DEFAULT_MAX_BINDING_VALUE_BYTES);
  const bytes = byteLength(value);
  if (bytes > maxBytes) {
    throw contractError(
      'PULSE_BINDING_VALUE_TOO_LARGE',
      `Pulse ${bindingKind} value exceeds the ${maxBytes} byte limit.`,
      { bindingKind, bytes, maxBytes }
    );
  }
  return value;
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function kvValueError(message, path, value, extra = {}) {
  return contractError('PULSE_KV_VALUE_INVALID', message, {
    path,
    valueType: valueType(value),
    ...extra
  });
}

function definePortableProperty(target, key, value) {
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: false,
    writable: false,
    value
  });
}

function clonePortableKvValue(value, state, path, depth) {
  state.entries += 1;
  if (state.entries > state.maxEntries) {
    throw contractError(
      'PULSE_KV_VALUE_ENTRIES_EXCEEDED',
      `Pulse KV values may not exceed ${state.maxEntries} entries.`,
      { path, maxEntries: state.maxEntries }
    );
  }
  if (depth > state.maxDepth) {
    throw contractError(
      'PULSE_KV_VALUE_DEPTH_EXCEEDED',
      `Pulse KV values may not exceed ${state.maxDepth} nested levels.`,
      { path, maxDepth: state.maxDepth }
    );
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw kvValueError('Pulse KV numbers must be finite.', path, value);
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined && state.allowUndefined && path === '$') return undefined;
  if (value === undefined) throw kvValueError('Pulse KV values may not contain undefined.', path, value);
  if (typeof value !== 'object') {
    throw kvValueError('Pulse KV values must be JSON-compatible data.', path, value);
  }
  if (state.seen.has(value)) {
    throw kvValueError('Pulse KV values may not contain cycles or repeated object references.', path, value);
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    const allowed = new Set(['length']);
    for (let index = 0; index < value.length; index += 1) allowed.add(String(index));
    for (const key of ownKeys) {
      if (typeof key !== 'string' || !allowed.has(key)) {
        throw kvValueError('Pulse KV arrays may only contain indexed data properties.', path, value, { key: String(key) });
      }
    }
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw kvValueError('Pulse KV arrays may not contain sparse entries.', `${path}[${index}]`, undefined);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw kvValueError('Pulse KV arrays may not contain accessors.', `${path}[${index}]`, undefined);
      }
      definePortableProperty(output, String(index), clonePortableKvValue(descriptor.value, state, `${path}[${index}]`, depth + 1));
    }
    Object.defineProperty(output, 'length', { writable: false });
    return Object.freeze(output);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw kvValueError('Pulse KV objects must be ordinary object literals.', path, value, {
      prototype: prototype && prototype.constructor && prototype.constructor.name || 'null'
    });
  }
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw kvValueError('Pulse KV objects may not contain symbol keys.', path, value);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw kvValueError('Pulse KV objects may only contain enumerable data properties.', `${path}.${key}`, value);
    }
    definePortableProperty(output, key, clonePortableKvValue(descriptor.value, state, `${path}.${key}`, depth + 1));
  }
  return Object.freeze(output);
}

function normalizeKvValue(value, options = {}) {
  const allowUndefined = options.allowUndefined === true;
  if (value === undefined && allowUndefined) return undefined;
  const maxBytes = positiveLimit('maxKvValueBytes', options.maxKvValueBytes, DEFAULT_MAX_KV_VALUE_BYTES);
  const maxDepth = positiveLimit('maxKvValueDepth', options.maxKvValueDepth ?? options.maxDepth, DEFAULT_MAX_KV_VALUE_DEPTH);
  const maxEntries = positiveLimit('maxKvValueEntries', options.maxKvValueEntries ?? options.maxEntries, DEFAULT_MAX_KV_VALUE_ENTRIES);
  const cloned = clonePortableKvValue(value, {
    allowUndefined,
    maxDepth,
    maxEntries,
    entries: 0,
    seen: new WeakSet()
  }, '$', 0);
  const serialized = JSON.stringify(cloned);
  const bytes = byteLength(serialized);
  if (bytes > maxBytes) {
    throw contractError(
      'PULSE_KV_VALUE_TOO_LARGE',
      `Pulse KV value exceeds the ${maxBytes} byte limit.`,
      { bytes, maxBytes }
    );
  }
  return cloned;
}

function normalizeBindingValue(capability, name, value, options = {}) {
  const bindingKind = String(capability || 'binding').startsWith('secret') ? 'secret' : 'config';
  // Name is intentionally validated separately from the returned value so error detail never includes it as a value.
  normalizeBindingName(bindingKind, name, options);
  return normalizeBindingValueResult(bindingKind, value, options);
}

function normalizeBindingValueResult(kind, value, options = {}) {
  return normalizeBindingValueInternal(kind, value, options);
}

function normalizeKvAcknowledgement(value) {
  if (typeof value !== 'boolean') {
    throw contractError(
      'PULSE_KV_ACK_INVALID',
      'Pulse KV put providers must return a boolean acknowledgement.',
      { valueType: valueType(value) }
    );
  }
  return value;
}

function cloneKvValue(value, options = {}) {
  return normalizeKvValue(value, {
    allowUndefined: options.allowUndefined === true,
    maxKvValueBytes: options.maxKvValueBytes ?? options.maxBytes,
    maxKvValueDepth: options.maxKvValueDepth ?? options.maxDepth,
    maxKvValueEntries: options.maxKvValueEntries ?? options.maxEntries
  });
}

function normalizeKvPutResult(value) {
  return normalizeKvAcknowledgement(value);
}

module.exports = Object.freeze({
  DEFAULT_MAX_BINDING_NAME_BYTES,
  DEFAULT_MAX_BINDING_VALUE_BYTES,
  DEFAULT_MAX_KV_NAMESPACE_BYTES,
  DEFAULT_MAX_KV_KEY_BYTES,
  DEFAULT_MAX_KV_VALUE_BYTES,
  DEFAULT_MAX_KV_VALUE_DEPTH,
  DEFAULT_MAX_KV_VALUE_ENTRIES,
  byteLength,
  cloneKvValue,
  normalizeBindingName,
  normalizeBindingValue,
  normalizeBindingValueResult,
  normalizeKvAcknowledgement,
  normalizeKvKey,
  normalizeKvNamespace,
  normalizeKvPutResult,
  normalizeKvValue,
  positiveLimit
});
