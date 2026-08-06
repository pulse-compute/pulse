'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');
const { fastlyJavascriptProviderError, isPulseRuntimeError } = require('./errors.js');

const FASTLY_JAVASCRIPT_BINDINGS_ADAPTER_VERSION = 'pulse.fastly-javascript-bindings-adapter.v1';

function requireConstructor(apis, name) {
  const value = apis && apis[name];
  if (typeof value !== 'function') {
    throw fastlyJavascriptProviderError(
      'PULSE_FASTLY_JAVASCRIPT_API_UNAVAILABLE',
      `Fastly JavaScript ${name} capability is unavailable.`,
      { api: name }
    );
  }
  return value;
}

function requireResourceName(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw fastlyJavascriptProviderError(
      'PULSE_FASTLY_JAVASCRIPT_BINDING_REQUIRED',
      `Fastly JavaScript ${field} must name a configured resource.`,
      { configuration: field }
    );
  }
  return normalized;
}

function providerFailure(error, code, message, detail) {
  if (isPulseRuntimeError(error)) throw error;
  throw fastlyJavascriptProviderError(code, message, detail, error);
}

function createFastlyJavascriptBindingCapabilities(options = {}) {
  const apis = options.apis || {};
  const bindings = options.bindings && typeof options.bindings === 'object' ? options.bindings : {};
  const kvBindings = bindings.kv && typeof bindings.kv === 'object' ? bindings.kv : {};
  const limits = {
    maxBindingNameBytes: options.maxBindingNameBytes,
    maxBindingValueBytes: options.maxBindingValueBytes,
    maxKvNamespaceBytes: options.maxKvNamespaceBytes,
    maxKvKeyBytes: options.maxKvKeyBytes,
    maxKvValueBytes: options.maxKvValueBytes,
    maxKvValueDepth: options.maxKvValueDepth,
    maxKvValueEntries: options.maxKvValueEntries
  };
  let configStore;
  let secretStore;
  const kvStores = new Map();

  function openConfigStore() {
    if (!configStore) {
      const ConfigStore = requireConstructor(apis, 'ConfigStore');
      const resource = requireResourceName(bindings.configStore, 'bindings.configStore');
      try { configStore = new ConfigStore(resource); }
      catch (error) {
        providerFailure(
          error,
          'PULSE_FASTLY_CONFIG_STORE_OPEN_FAILED',
          'Fastly JavaScript could not open the configured Config Store.',
          { configuration: 'bindings.configStore', resource }
        );
      }
    }
    return configStore;
  }

  function openSecretStore() {
    if (!secretStore) {
      const SecretStore = requireConstructor(apis, 'SecretStore');
      const resource = requireResourceName(bindings.secretStore, 'bindings.secretStore');
      try { secretStore = new SecretStore(resource); }
      catch (error) {
        providerFailure(
          error,
          'PULSE_FASTLY_SECRET_STORE_OPEN_FAILED',
          'Fastly JavaScript could not open the configured Secret Store.',
          { configuration: 'bindings.secretStore', resource }
        );
      }
    }
    return secretStore;
  }

  function physicalKvStore(namespaceInput) {
    const namespace = runtimeHost.normalizeKvNamespace(namespaceInput, limits);
    const resource = typeof kvBindings[namespace] === 'string' ? kvBindings[namespace].trim() : '';
    if (!resource) {
      throw fastlyJavascriptProviderError(
        'PULSE_FASTLY_KV_BINDING_REQUIRED',
        'Fastly JavaScript KV requires a logical namespace mapping.',
        { namespace, configuration: `bindings.kv.${namespace}` }
      );
    }
    if (!kvStores.has(resource)) {
      const KVStore = requireConstructor(apis, 'KVStore');
      try { kvStores.set(resource, new KVStore(resource)); }
      catch (error) {
        providerFailure(
          error,
          'PULSE_FASTLY_KV_STORE_OPEN_FAILED',
          'Fastly JavaScript could not open a configured KV Store.',
          { namespace, resource }
        );
      }
    }
    return Object.freeze({ namespace, resource, store: kvStores.get(resource) });
  }

  return Object.freeze({
    version: FASTLY_JAVASCRIPT_BINDINGS_ADAPTER_VERSION,
    config(nameInput) {
      const name = runtimeHost.normalizeBindingName('config', nameInput, limits);
      try {
        const value = openConfigStore().get(name);
        return value === null ? undefined : value;
      } catch (error) {
        providerFailure(
          error,
          'PULSE_FASTLY_CONFIG_GET_FAILED',
          'Fastly JavaScript Config Store lookup failed.',
          { name }
        );
      }
    },
    async secret(nameInput) {
      const name = runtimeHost.normalizeBindingName('secret', nameInput, limits);
      let entry;
      try { entry = await openSecretStore().get(name); }
      catch (error) {
        providerFailure(
          error,
          'PULSE_FASTLY_SECRET_GET_FAILED',
          'Fastly JavaScript Secret Store lookup failed.',
          { name }
        );
      }
      if (entry === null || entry === undefined) return undefined;
      try {
        if (!entry || typeof entry.plaintext !== 'function') {
          throw fastlyJavascriptProviderError(
            'PULSE_FASTLY_SECRET_ENTRY_INVALID',
            'Fastly JavaScript Secret Store returned an invalid entry.',
            { name }
          );
        }
        return entry.plaintext();
      } catch (error) {
        providerFailure(
          error,
          'PULSE_FASTLY_SECRET_PLAINTEXT_FAILED',
          'Fastly JavaScript could not read a Secret Store entry.',
          { name }
        );
      }
    },
    kv(namespaceInput) {
      const opened = physicalKvStore(namespaceInput);
      return Object.freeze({
        async get(keyInput) {
          const key = runtimeHost.normalizeKvKey(keyInput, limits);
          let entry;
          try { entry = await opened.store.get(key); }
          catch (error) {
            providerFailure(
              error,
              'PULSE_FASTLY_KV_GET_FAILED',
              'Fastly JavaScript KV lookup failed.',
              { namespace: opened.namespace, key }
            );
          }
          if (entry === null || entry === undefined) return undefined;
          try {
            if (!entry || typeof entry.json !== 'function') {
              throw fastlyJavascriptProviderError(
                'PULSE_FASTLY_KV_ENTRY_INVALID',
                'Fastly JavaScript KV returned an invalid entry.',
                { namespace: opened.namespace, key }
              );
            }
            return await entry.json();
          } catch (error) {
            providerFailure(
              error,
              'PULSE_FASTLY_KV_VALUE_INVALID',
              'Fastly JavaScript KV value is not valid Pulse JSON data.',
              { namespace: opened.namespace, key }
            );
          }
        },
        async put(keyInput, value) {
          const key = runtimeHost.normalizeKvKey(keyInput, limits);
          let body;
          try { body = JSON.stringify(value); }
          catch (error) {
            providerFailure(
              error,
              'PULSE_FASTLY_KV_VALUE_INVALID',
              'Fastly JavaScript KV value is not valid Pulse JSON data.',
              { namespace: opened.namespace, key }
            );
          }
          try { await opened.store.put(key, body); }
          catch (error) {
            providerFailure(
              error,
              'PULSE_FASTLY_KV_PUT_FAILED',
              'Fastly JavaScript KV write failed.',
              { namespace: opened.namespace, key }
            );
          }
          return true;
        }
      });
    }
  });
}

function withFastlyBindingCapabilities(capabilities, options = {}) {
  const base = capabilities && typeof capabilities === 'object' ? capabilities : {};
  const configured = options.bindingCapabilities || createFastlyJavascriptBindingCapabilities(options);
  return Object.freeze({
    ...base,
    ...(typeof base.config === 'function' ? {} : { config: configured.config }),
    ...(typeof base.secret === 'function' ? {} : { secret: configured.secret }),
    ...(typeof base.kv === 'function' ? {} : { kv: configured.kv })
  });
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_BINDINGS_ADAPTER_VERSION,
  createFastlyJavascriptBindingCapabilities,
  withFastlyBindingCapabilities
});
