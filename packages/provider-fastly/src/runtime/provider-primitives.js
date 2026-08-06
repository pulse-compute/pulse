'use strict';

const contract = require('./provider-primitives-contract.js');

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

function createFastlyProviderPrimitiveSurface(options = {}) {
  const manifest = contract.createCapabilityManifest(options);
  const configAdapter = contract.createConfigAdapter(options.configValues || options.configProvider || {});
  const secretAdapter = contract.createSecretAdapter(options.secretValues || options.secretProvider || {});
  const kvAdapter = contract.createKvAdapter(options.kvStores || options.kvValues || {});
  const logAdapter = contract.createLogAdapter({ secretNames: Object.keys(options.secretValues || options.secretProvider || {}) });
  const logs = [];

  return Object.freeze({
    kind: 'FastlyProviderPrimitiveSurface',
    provider: 'fastly',
    manifest,
    providerSpecificUserland: false,
    providerSdkWrapper: false,
    request(input) {
      return contract.createRequestAdapter(input);
    },
    response(input) {
      return contract.createResponseAdapter(input);
    },
    fetch(input) {
      return contract.createFetchAdapter(input);
    },
    config: Object.freeze({
      get(name) {
        const value = configAdapter.get(name);
        return contract.deepFreeze({ kind: 'ProviderConfigRead', provider: 'fastly', name: contract.normalizeName(name), value, hit: value !== undefined, exactNameOnly: true, enumerable: false, providerSpecificUserland: false });
      },
      list() { return configAdapter.list(); },
      adapter: configAdapter
    }),
    secret: Object.freeze({
      get(name) {
        const secret = secretAdapter.get(name);
        return contract.deepFreeze({ kind: 'ProviderSecretRead', provider: 'fastly', name: contract.normalizeName(name), hit: Boolean(secret), valueRef: secret ? secret.redacted : undefined, traceValue: secret ? secret.redacted : undefined, traceRedacted: true, enumerable: false, providerSpecificUserland: false });
      },
      list() { return secretAdapter.list(); },
      adapter: secretAdapter
    }),
    kv: Object.freeze({
      get(store, key) { return kvAdapter.get(store || manifest.bindings.kvStore, key); },
      put(store, key, value) { return kvAdapter.put(store || manifest.bindings.kvStore, key, value); },
      delete(store, key) { return kvAdapter.delete(store, key); },
      adapter: kvAdapter
    }),
    log: Object.freeze({
      event(level, message, fields) {
        const event = logAdapter.event(level, message, fields);
        logs.push(event);
        return event;
      },
      info(message, fields) { return this.event('info', message, fields); },
      warn(message, fields) { return this.event('warn', message, fields); },
      error(message, fields) { return this.event('error', message, fields); },
      entries() { return logs.map(clone); },
      adapter: logAdapter
    }),
    diagnostics() {
      return contract.deepFreeze({ provider: 'fastly', primitiveCount: contract.primitiveNames.length, logs: logs.length, secretsRedacted: true, providerSpecificUserland: false, providerSdkWrapper: false });
    }
  });
}

function buildFastlyProviderPrimitiveManifest(options = {}) {
  return contract.createCapabilityManifest(options);
}

module.exports = {
  contract,
  createFastlyProviderPrimitiveSurface,
  buildFastlyProviderPrimitiveManifest
};
