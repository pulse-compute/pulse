'use strict';

function createKvError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  err.details = details || null;
  return err;
}

function createNamespaceStore(namespace, map) {
  return {
    namespace,
    getText(key) {
      const normalized = String(key);
      return map.has(normalized) ? String(map.get(normalized)) : null;
    },
    setText(key, value) {
      map.set(String(key), String(value));
      return { ok: true };
    },
    delete(key) {
      const existed = map.delete(String(key));
      return { ok: true, existed };
    },
    has(key) {
      return map.has(String(key));
    },
    entries() {
      return Array.from(map.entries());
    }
  };
}

function createKvProvider(options = {}) {
  const provider = options.provider || options.runtimeProvider || { kind: 'local', kv: {} };
  const stores = new Map();
  const configured = provider && provider.kv ? provider.kv : {};
  const seed = options.seed || {};
  for (const [logicalName, physicalName] of Object.entries(configured)) {
    const initial = new Map(Object.entries(seed[logicalName] || {}));
    stores.set(String(logicalName), createNamespaceStore(String(physicalName), initial));
  }
  return {
    kind: provider.kind || 'unknown',
    configuredNamespaces: Array.from(stores.keys()),
    kv(name) {
      const key = String(name);
      if (!stores.has(key)) {
        throw createKvError('PULSEWASM_KV_NAMESPACE_UNKNOWN', `Unknown KV namespace: ${key}`, { namespace: key, configured: Array.from(stores.keys()) });
      }
      return stores.get(key);
    }
  };
}

module.exports = { createKvProvider, createKvError, createNamespaceStore };
