'use strict';

const { fastlyConfigDefault } = require('../config-schema.js');
const DEFAULT_FASTLY_MAX_WASM_BYTES = fastlyConfigDefault('fastly.build.maxWasmBytes');

function normalizeFastlyMaxWasmBytes(value) {
  if (value === undefined) return DEFAULT_FASTLY_MAX_WASM_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    const error = new TypeError('fastly.build.maxWasmBytes must be a positive safe integer byte count.');
    error.code = 'PULSE_FASTLY_MAX_WASM_BYTES_INVALID';
    throw error;
  }
  return value;
}

function assertFastlyWasmBudget(bytes, value) {
  const maxBytes = normalizeFastlyMaxWasmBytes(value);
  if (bytes > maxBytes) {
    const error = new Error('Generated Fastly Native module exceeds the configured Pulse compilation budget.');
    error.name = 'FastlyNativePlatformCapabilitiesError';
    error.code = 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_WASM_TOO_LARGE';
    error.detail = Object.freeze({ bytes, maxBytes });
    throw error;
  }
  return maxBytes;
}

module.exports = Object.freeze({ DEFAULT_FASTLY_MAX_WASM_BYTES, normalizeFastlyMaxWasmBytes, assertFastlyWasmBudget });
