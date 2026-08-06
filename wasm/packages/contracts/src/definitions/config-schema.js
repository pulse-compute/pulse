'use strict';

const CONFIG_SCHEMA_VERSION = 'pulsewasm.config-schema.v1';
const ENV_PROFILE_NAME = 'PULSE_PROFILE';
const SEMANTIC_ENV_KEYS = new Set([
  'entry',
  'rootRouter',
  'router',
  'routers',
  'route',
  'routes',
  'handler',
  'handlers',
  'middleware',
  'mount',
  'mounts'
]);
const ALLOWED_ENV_METHODS = new Set(['number', 'boolean', 'define']);

function isSemanticConfigKey(key) {
  return SEMANTIC_ENV_KEYS.has(key);
}

module.exports = {
  CONFIG_SCHEMA_VERSION,
  ENV_PROFILE_NAME,
  SEMANTIC_ENV_KEYS,
  ALLOWED_ENV_METHODS,
  isSemanticConfigKey
};
