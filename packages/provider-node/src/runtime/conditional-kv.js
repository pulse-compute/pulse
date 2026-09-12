'use strict';

const { randomUUID } = require('node:crypto');
const host = require('@pulse-compute/runtime/host');

// One explicit instance is one local authority. Reuse it across requests/targets
// to exercise shared storage. Identity/sequence injection is for deterministic
// host tests, never application input. This is not durable production storage.
function createNodeKvReference(options = {}) {
  const identity = options.kvInstanceId === undefined ? randomUUID() : options.kvInstanceId;
  if (typeof identity !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(identity)) throw new TypeError('Node KV instance identity must be bounded ASCII.');
  let sequence = options.kvGenerationStart === undefined ? 0n : BigInt(options.kvGenerationStart);
  if (sequence < 0n || sequence >= (1n << 128n)) throw new TypeError('Node KV generation sequence is out of range.');
  const stores = new Map(), records = new Map();
  const hooks = options.kvHooks || {};
  function nextGeneration() {
    if (sequence >= (1n << 128n) - 1n) throw new Error('Node KV generation space exhausted.');
    sequence += 1n;
    return `node-kv-v1:${identity}:${sequence.toString(16).padStart(32, '0')}`;
  }
  function namespace(name) {
    host.normalizeKvNamespace(name, options);
    if (!stores.has(name)) { stores.set(name, new Map()); records.set(name, new Map()); }
    return { values: stores.get(name), entries: records.get(name) };
  }
  function put(name, key, value) {
    const { entries, values } = namespace(name);
    const wire = host.encodeConditionalKvValue(value, options);
    const detached = host.decodeConditionalKvValue(wire, options);
    const generation = nextGeneration();
    entries.set(key, { wire, generation }); values.set(key, detached);
  }
  // Reject accessors instead of executing configuration as ambient code.
  function entries(input) {
    if (input === undefined || input === null) return [];
    if (typeof input !== 'object' || Array.isArray(input) || ![null, Object.prototype].includes(Object.getPrototypeOf(input))) throw new TypeError('Node KV seed must be a data record.');
    return Reflect.ownKeys(input).map((key) => {
      const d = Object.getOwnPropertyDescriptor(input, key);
      if (typeof key !== 'string' || !d.enumerable || !Object.prototype.hasOwnProperty.call(d, 'value')) throw new TypeError('Node KV seed must contain data properties.');
      return [key, d.value];
    });
  }
  for (const [name, values] of entries(options.kv)) for (const [key, value] of entries(values)) {
    host.normalizeKvKey(key, options); put(name, key, value);
  }
  function apply(effect) {
    const { entries } = namespace(effect.namespace);
    const current = entries.get(effect.key);
    if (effect.kind === 'kv.getVersioned') return current
      ? Object.freeze({ status: 'found', generation: current.generation, value: host.decodeConditionalKvValue(current.wire, options) })
      : Object.freeze({ status: 'not-found' });
    if (effect.kind === 'kv.compareAndSwap' && !new RegExp(`^node-kv-v1:${identity}:[0-9a-f]{32}$`).test(effect.generation)) {
      return Object.freeze({ status: 'not-stored', reason: 'invalid-generation' });
    }
    // No await, callback, or provider GET/PUT between predicate and mutation.
    const matches = effect.kind === 'kv.insertIfAbsent' ? !current : current && current.generation === effect.generation;
    if (!matches) return Object.freeze({ status: 'conflict' });
    put(effect.namespace, effect.key, effect.value);
    return Object.freeze({ status: 'stored' });
  }
  async function prepareConditionalKv(effect, execution = {}) {
    if (hooks.prepare) await hooks.prepare(effect, execution);
    return async () => {
      if (hooks.dispatch) await hooks.dispatch(effect, execution);
      if (execution.signal && execution.signal.aborted) throw new Error('Node KV operation stopped before acceptance.');
      const result = apply(effect);
      if (result.status === 'found' && hooks.read) return hooks.read(result, effect, execution);
      if (result.status === 'stored' && hooks.afterCommit) await hooks.afterCommit(effect, execution);
      return result;
    };
  }
  return Object.freeze({
    version: 'pulse.node-kv-reference.v1',
    prepareConditionalKv,
    // Historical Assets reads use this semantic view, never the generation table.
    legacyStores() { return stores; },
    kv(name) {
      const { values } = namespace(name);
      const conditional = (operation, key, generation, value) => {
        const admitted = host.admitConditionalKv({ kind: `kv.${operation}`, namespace: name, key, generation, value }, options);
        return host.executeConditionalKv(admitted, prepareConditionalKv, {}, options);
      };
      return Object.freeze({
        get(key) { host.normalizeKvKey(key, options); return host.cloneKvValue(values.get(key), { ...options, allowUndefined: true }); },
        put(key, value) { host.normalizeKvKey(key, options); put(name, key, value); return true; },
        getVersioned(key) { return conditional('getVersioned', key); },
        insertIfAbsent(key, value) { return conditional('insertIfAbsent', key, undefined, value); },
        compareAndSwap(key, generation, value) { return conditional('compareAndSwap', key, generation, value); }
      });
    }
  });
}
module.exports = Object.freeze({ createNodeKvReference });
