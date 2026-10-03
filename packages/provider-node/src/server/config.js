'use strict';

const { normalizeRequestDuration } = require('@pulse-compute/runtime/host');

const defaults = Object.freeze({
  host: '127.0.0.1', port: 8787, readinessPath: '/_pulse/ready',
  maxDurationMs: 10000, shutdownTimeoutMs: 10000, headersTimeoutMs: 10000,
  keepAliveTimeoutMs: 5000, maxRequestBodyBytes: 65536, maxFetchBodyBytes: 65536,
  maxEffects: 128, maxConcurrentRequests: 128, maxConnections: 512, networkFetch: false, strict: true
});

function normalizeOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Node launcher options are required.');
  const allowed = new Set([...Object.keys(defaults), 'target', 'buildDir', 'config', 'secrets', 'kv']);
  for (const key of Reflect.ownKeys(input)) {
    if (!allowed.has(key)) throw new TypeError('Unknown Node launcher option.');
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value')) throw new TypeError('Node launcher options must be data properties.');
  }
  const options = { ...defaults, ...input };
  if (!['native', 'javascript'].includes(options.target)) throw new TypeError('Explicit Node target native or javascript is required.');
  if (typeof options.buildDir !== 'string' || !options.buildDir) throw new TypeError('Node launcher buildDir is required.');
  if (typeof options.host !== 'string' || !options.host.trim()) throw new TypeError('Node launcher host must be nonempty.');
  if (typeof options.strict !== 'boolean') throw new TypeError('Node launcher strict must be boolean.');
  if (typeof options.networkFetch !== 'boolean') throw new TypeError('Node launcher networkFetch must be boolean.');
  if (typeof options.readinessPath !== 'string' || !/^\/[A-Za-z0-9_/-]+$/.test(options.readinessPath) || options.readinessPath.includes('//')) {
    throw new TypeError('Node launcher readinessPath must be a non-root absolute path without a query.');
  }
  for (const key of ['port', 'shutdownTimeoutMs', 'headersTimeoutMs', 'keepAliveTimeoutMs', 'maxRequestBodyBytes', 'maxFetchBodyBytes', 'maxEffects', 'maxConcurrentRequests', 'maxConnections']) {
    const maximum = key === 'port' ? 65535 : key.endsWith('Ms') ? 30000 : key.endsWith('Bytes') ? 2097152 : 65536;
    if (!Number.isSafeInteger(options[key]) || options[key] < (key === 'port' ? 0 : 1) || options[key] > maximum) throw new TypeError(`Invalid Node launcher ${key}.`);
  }
  normalizeRequestDuration(options.maxDurationMs);
  if (options.maxDurationMs === undefined) throw new TypeError('Node launcher requires a finite maxDurationMs.');
  for (const key of ['config', 'secrets']) {
    const value = options[key] ?? {};
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new TypeError(`Node launcher ${key} must be a string record.`);
    const entries = [];
    for (const name of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (typeof name !== 'string' || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') throw new TypeError(`Node launcher ${key} must be a string record.`);
      entries.push([name, descriptor.value]);
    }
    options[key] = Object.freeze(Object.fromEntries(entries));
  }
  // JSON seed data is process-local reference KV, never a durable store.
  if (options.kv !== undefined) {
    if (!options.kv || typeof options.kv !== 'object' || Array.isArray(options.kv)) throw new TypeError('Node launcher kv must be an object.');
    require('../runtime/conditional-kv.js').createNodeKvReference({ kv: options.kv });
    options.kv = structuredClone(options.kv);
  }
  return Object.freeze(options);
}

module.exports = { normalizeOptions };
