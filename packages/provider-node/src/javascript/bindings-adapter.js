'use strict';

const { createNodeKvReference } = require('../runtime/conditional-kv.js');
const runtimeHost = require('@pulse-compute/runtime/host');

const NODE_JAVASCRIPT_BINDINGS_ADAPTER_VERSION = 'pulse.node-javascript-bindings-adapter.v1';

function recordEntries(input, label = 'binding record') {
  if (input === undefined || input === null) return [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`Pulse Node JavaScript ${label} must be an object record.`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Pulse Node JavaScript ${label} must be an ordinary object record.`);
  }
  const entries = [];
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string') {
      throw new TypeError(`Pulse Node JavaScript ${label} may not contain symbol keys.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable) continue;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`Pulse Node JavaScript ${label} may only contain enumerable data properties.`);
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function createNodeJavascriptBindingCapabilities(options = {}) {
  const config = new Map();
  const secrets = new Map();
  const reference = options.kvReference || createNodeKvReference(options);

  for (const [rawName, rawValue] of recordEntries(options.config, 'config')) {
    const name = runtimeHost.normalizeBindingName('config', rawName, options);
    config.set(name, runtimeHost.normalizeBindingValue('config.get', name, rawValue, options));
  }
  for (const [rawName, rawValue] of recordEntries(options.secrets, 'secrets')) {
    const name = runtimeHost.normalizeBindingName('secret', rawName, options);
    secrets.set(name, runtimeHost.normalizeBindingValue('secret.get', name, rawValue, options));
  }
  return Object.freeze({
    version: NODE_JAVASCRIPT_BINDINGS_ADAPTER_VERSION,
    config(nameInput) {
      const name = runtimeHost.normalizeBindingName('config', nameInput, options);
      return config.has(name) ? config.get(name) : undefined;
    },
    secret(nameInput) {
      const name = runtimeHost.normalizeBindingName('secret', nameInput, options);
      return secrets.has(name) ? secrets.get(name) : undefined;
    },
    prepareConditionalKv: reference.prepareConditionalKv,
    kv: reference.kv
  });
}

function withNodeBindingCapabilities(capabilities, options = {}) {
  const value = capabilities && typeof capabilities === 'object' ? capabilities : {};
  const output = { ...value };
  const needsConfig = typeof value.config !== 'function';
  const needsSecret = typeof value.secret !== 'function';
  const needsKv = typeof value.kv !== 'function';
  if (!needsConfig && !needsSecret && !needsKv) return Object.freeze(output);
  const configured = options.bindings || createNodeJavascriptBindingCapabilities(options);
  if (needsConfig) output.config = configured.config;
  if (needsSecret) output.secret = configured.secret;
  if (needsKv) { output.kv = configured.kv; output.prepareConditionalKv = configured.prepareConditionalKv; }
  return Object.freeze(output);
}

function nodeJavascriptRedactionValues(options = {}) {
  const output = [];
  for (const [, value] of recordEntries(options.secrets, 'secrets')) {
    if (typeof value === 'string' && value.length > 0) output.push(value);
  }
  for (const value of Array.isArray(options.redactionValues) ? options.redactionValues : []) {
    if (typeof value === 'string' && value.length > 0) output.push(value);
  }
  return Object.freeze([...new Set(output)]);
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_BINDINGS_ADAPTER_VERSION,
  createNodeJavascriptBindingCapabilities,
  nodeJavascriptRedactionValues,
  withNodeBindingCapabilities
});
