'use strict';

const BACKEND_CAPABILITIES_VERSION = 'pulsewasm.backend-capabilities.v1';
const BACKEND_CAPABILITIES_PHASE = '10G';
const DEFAULT_BACKEND_TIMEOUT_MS = 1500;
const METHOD_NAMES = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function normalizeBackendMethods(value) {
  if (!Array.isArray(value)) return [];
  return value.map((method) => String(method || '').toUpperCase()).filter(Boolean);
}

function isSupportedBackendMethod(method) {
  return METHOD_NAMES.has(String(method || '').toUpperCase());
}

module.exports = {
  BACKEND_CAPABILITIES_VERSION,
  BACKEND_CAPABILITIES_PHASE,
  DEFAULT_BACKEND_TIMEOUT_MS,
  METHOD_NAMES,
  normalizeBackendMethods,
  isSupportedBackendMethod
};
