'use strict';

const { fastlyConfigDefault } = require('./config-schema.js');

const FASTLY_PROVIDER_API_VERSION = 'pulse.provider-fastly-api.v2';

function stringMap(input = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(input || {}).map(([key, value]) => [String(key), String(value)])));
}

function gripAuthentication(input) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('fastly.grip.authentication must be an object.');
  }
  const scheme = String(input.scheme || 'bearer').toLowerCase();
  if (scheme !== 'bearer') throw new TypeError('fastly.grip.authentication.scheme must be bearer.');
  return Object.freeze({
    scheme: 'bearer',
    secretRef: String(input.secretRef || '')
  });
}

function gripBindings(input = {}) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return Object.freeze({
    fanoutBackend: value.fanoutBackend === undefined ? undefined : String(value.fanoutBackend),
    publishEndpoint: value.publishEndpoint === undefined ? undefined : String(value.publishEndpoint),
    publishUrl: value.publishUrl === undefined ? undefined : String(value.publishUrl),
    publishBackend: value.publishBackend === undefined ? undefined : String(value.publishBackend),
    authentication: gripAuthentication(value.authentication),
    directHold: value.directHold === undefined ? fastlyConfigDefault('fastly.grip.directHold') : value.directHold !== false
  });
}

function fastly(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('fastly() requires an options object.');
  const normalizedGrip = options.grip === undefined ? undefined : gripBindings(options.grip);
  return Object.freeze({
    kind: 'fastly',
    version: FASTLY_PROVIDER_API_VERSION,
    bindings: Object.freeze({
      configStore: String(options.configStore ?? fastlyConfigDefault('fastly.configStore')),
      secretStore: String(options.secretStore ?? fastlyConfigDefault('fastly.secretStore')),
      kv: stringMap(options.kv),
      backends: stringMap(options.backends),
      ...(normalizedGrip ? { grip: normalizedGrip } : {}),
      dynamicBackends: options.dynamicBackends === undefined ? fastlyConfigDefault('fastly.dynamicBackends') : options.dynamicBackends === true
    }),
    build: Object.freeze({
      name: String(options.name ?? fastlyConfigDefault('fastly.name')),
      description: String(options.description ?? fastlyConfigDefault('fastly.description')),
      authors: Object.freeze((Array.isArray(options.authors) ? options.authors : fastlyConfigDefault('fastly.authors')).map(String)),
      language: 'other'
    }),
    local: Object.freeze({
      networkFetch: Boolean(options.local?.networkFetch ?? fastlyConfigDefault('fastly.local.networkFetch'))
    }),
    providerSpecificUserland: false
  });
}

module.exports = Object.freeze({ FASTLY_PROVIDER_API_VERSION, fastly });
