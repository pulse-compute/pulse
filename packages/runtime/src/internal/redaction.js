'use strict';

const { PulseRuntimeContractError, PulseUnhandledError } = require('./errors.js');

const REDACTED_VALUE = '<redacted>';
const CIRCULAR_VALUE = '<circular>';
const BINARY_VALUE = '<binary>';
const BOUNDED_VALUE = '<bounded>';
const MAX_REDACTION_DEPTH = 32;
const MAX_REDACTION_ENTRIES = 1024;

const SENSITIVE_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'token',
  'secret',
  'password',
  'credential',
  'credentials'
]);

function isSensitiveKey(value) {
  const key = String(value || '').toLowerCase();
  if (SENSITIVE_KEYS.has(key)) return true;
  const compact = key.replace(/[^a-z0-9]/g, '');
  return compact.endsWith('token')
    || compact.endsWith('secret')
    || compact.endsWith('password')
    || compact.endsWith('credential')
    || compact.endsWith('credentials')
    || compact.endsWith('apikey');
}

function ownDataValue(object, key) {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function normalizeInitialValues(input) {
  if (input === undefined || input === null) return [];
  if (typeof input === 'string') return input.length > 0 ? [input] : [];
  if (!input || typeof input[Symbol.iterator] !== 'function') return [];
  const output = [];
  for (const value of input) {
    if (typeof value === 'string' && value.length > 0) output.push(value);
  }
  return output;
}

function createRedactionState(initialValues = []) {
  const registered = new Set(normalizeInitialValues(initialValues));

  function tokens() {
    return [...registered].sort((left, right) => right.length - left.length);
  }

  function redactString(value) {
    let output = String(value);
    for (const token of tokens()) output = output.split(token).join(REDACTED_VALUE);
    return output;
  }

  function redactValue(value, keyName = '', seen = new WeakSet(), depth = 0) {
    if (isSensitiveKey(keyName)) return REDACTED_VALUE;
    if (typeof value === 'string') return redactString(value);
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return BINARY_VALUE;
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) return BINARY_VALUE;
    if (depth >= MAX_REDACTION_DEPTH) return BOUNDED_VALUE;
    if (value instanceof Error) return redactError(value, seen, depth);
    if (seen.has(value)) return CIRCULAR_VALUE;
    seen.add(value);

    if (Array.isArray(value)) {
      const output = [];
      const length = Math.min(value.length, MAX_REDACTION_ENTRIES);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          output.push('<accessor>');
          continue;
        }
        const entry = descriptor.value;
        if (Array.isArray(entry) && entry.length >= 2) {
          const keyDescriptor = Object.getOwnPropertyDescriptor(entry, '0');
          const key = keyDescriptor && Object.prototype.hasOwnProperty.call(keyDescriptor, 'value')
            ? keyDescriptor.value
            : undefined;
          if (isSensitiveKey(key)) {
            const pair = [redactString(key), REDACTED_VALUE];
            for (let pairIndex = 2; pairIndex < Math.min(entry.length, MAX_REDACTION_ENTRIES); pairIndex += 1) {
              const pairDescriptor = Object.getOwnPropertyDescriptor(entry, String(pairIndex));
              pair.push(pairDescriptor && Object.prototype.hasOwnProperty.call(pairDescriptor, 'value')
                ? redactValue(pairDescriptor.value, '', seen, depth + 1)
                : '<accessor>');
            }
            output.push(Object.freeze(pair));
            continue;
          }
        }
        output.push(redactValue(entry, '', seen, depth + 1));
      }
      return Object.freeze(output);
    }

    const output = {};
    for (const key of Reflect.ownKeys(value).slice(0, MAX_REDACTION_ENTRIES)) {
      if (typeof key !== 'string') continue;
      const outputKey = redactString(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const outputValue = !descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? (isSensitiveKey(key) ? REDACTED_VALUE : '<accessor>')
        : redactValue(descriptor.value, key, seen, depth + 1);
      Object.defineProperty(output, outputKey, {
        enumerable: true,
        // Different private keys can redact to the same spelling. Their value
        // association is lost, so collapse the collision to a redacted marker.
        // Properties remain replaceable only until the completed record freezes.
        configurable: true,
        writable: false,
        value: Object.prototype.hasOwnProperty.call(output, outputKey) ? REDACTED_VALUE : outputValue
      });
    }
    return Object.freeze(output);
  }

  function redactError(error, seen = new WeakSet(), depth = 0) {
    if (!(error instanceof Error)) return redactValue(error, '', seen, depth);
    if (depth >= MAX_REDACTION_DEPTH) {
      const bounded = new Error(BOUNDED_VALUE);
      bounded.name = 'PulseRedactedError';
      return bounded;
    }
    if (seen.has(error)) return new Error(CIRCULAR_VALUE);
    seen.add(error);

    const rawMessage = ownDataValue(error, 'message');
    const rawName = ownDataValue(error, 'name');
    const rawCode = ownDataValue(error, 'code');
    const message = redactString(typeof rawMessage === 'string' ? rawMessage : 'Pulse runtime failure.');
    const causeDescriptor = Object.getOwnPropertyDescriptor(error, 'cause');
    const cause = causeDescriptor && Object.prototype.hasOwnProperty.call(causeDescriptor, 'value')
      ? redactValue(causeDescriptor.value, 'cause', seen, depth + 1)
      : undefined;
    const detailDescriptor = Object.getOwnPropertyDescriptor(error, 'detail');
    const detail = detailDescriptor && Object.prototype.hasOwnProperty.call(detailDescriptor, 'value')
      ? redactValue(detailDescriptor.value, 'detail', seen, depth + 1)
      : undefined;

    let safe;
    if (error instanceof PulseRuntimeContractError) {
      safe = new PulseRuntimeContractError(
        typeof rawCode === 'string' ? redactString(rawCode) : 'PULSE_RUNTIME_CONTRACT_ERROR',
        message,
        { cause, detail }
      );
    } else if (error instanceof PulseUnhandledError) {
      safe = new PulseUnhandledError(cause);
    } else {
      safe = new Error(message, cause === undefined ? undefined : { cause });
      safe.name = typeof rawName === 'string' ? redactString(rawName) : 'Error';
    }

    const reserved = new Set(['name', 'message', 'stack', 'cause', 'detail']);
    for (const key of Reflect.ownKeys(error).slice(0, MAX_REDACTION_ENTRIES)) {
      if (typeof key !== 'string' || reserved.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
      const outputKey = redactString(key);
      const value = redactValue(descriptor.value, key, seen, depth + 1);
      try {
        Object.defineProperty(safe, outputKey, {
          enumerable: descriptor.enumerable,
          configurable: true,
          writable: false,
          value
        });
      } catch (_) {
        // A hostile error object must not prevent containment or redaction.
      }
    }
    if (detail !== undefined && !(safe instanceof PulseRuntimeContractError)) {
      Object.defineProperty(safe, 'detail', { enumerable: false, configurable: true, value: detail });
    }
    const rawStack = ownDataValue(error, 'stack');
    const stack = typeof rawStack === 'string' ? redactString(rawStack) : undefined;
    if (stack !== undefined) {
      try { Object.defineProperty(safe, 'stack', { configurable: true, writable: true, value: stack }); }
      catch (_) { /* best effort */ }
    }
    return safe;
  }

  return Object.freeze({
    add(value) {
      if (typeof value === 'string' && value.length > 0) registered.add(value);
      return value;
    },
    count() { return registered.size; },
    redactString,
    redactValue(value) { return redactValue(value); },
    redactError(error) { return redactError(error); },
    values() { return Object.freeze([...registered].map(() => REDACTED_VALUE)); },
    summary() { return Object.freeze({ registeredSecretCount: registered.size }); }
  });
}

// Compatibility aliases for the earlier internal helper name.
function createRedactionRegistry(initialValues) {
  const state = createRedactionState(initialValues);
  return Object.freeze({
    add: state.add,
    redact: state.redactValue,
    redactString: state.redactString,
    summary: state.summary
  });
}

module.exports = Object.freeze({
  REDACTED_VALUE,
  BOUNDED_VALUE,
  SENSITIVE_KEYS,
  createRedactionRegistry,
  createRedactionState,
  isSensitiveKey
});
