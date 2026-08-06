'use strict';

const CONFIG_FACTORY_CONTRACT_VERSION = 'pulse.config-factory.v1';
const CONFIG_SCOPE_CONTRACT_VERSION = 'pulse.config-scope.v1';
const CONFIG_FACTORY_BRAND = Symbol.for('pulse.config-factory.v1');
const CONFIG_FACTORY_METADATA = Symbol.for('pulse.config-factory.metadata.v1');

function isConfigFactory(value) {
  return typeof value === 'function' && value[CONFIG_FACTORY_BRAND] === CONFIG_FACTORY_CONTRACT_VERSION;
}

function defineConfig(factory) {
  if (typeof factory !== 'function') {
    throw new TypeError('defineConfig requires one synchronous configuration factory.');
  }
  if (factory.constructor && factory.constructor.name === 'AsyncFunction') {
    throw new TypeError('defineConfig does not accept async configuration factories.');
  }
  if (!Object.prototype.hasOwnProperty.call(factory, CONFIG_FACTORY_BRAND)) {
    Object.defineProperties(factory, {
      [CONFIG_FACTORY_BRAND]: {
        value: CONFIG_FACTORY_CONTRACT_VERSION,
        enumerable: false,
        configurable: false,
        writable: false
      },
      [CONFIG_FACTORY_METADATA]: {
        value: Object.freeze({
          version: CONFIG_FACTORY_CONTRACT_VERSION,
          scopeVersion: CONFIG_SCOPE_CONTRACT_VERSION
        }),
        enumerable: false,
        configurable: false,
        writable: false
      }
    });
  }
  return Object.freeze(factory);
}

module.exports = Object.freeze({
  CONFIG_FACTORY_CONTRACT_VERSION,
  CONFIG_SCOPE_CONTRACT_VERSION,
  CONFIG_FACTORY_BRAND,
  CONFIG_FACTORY_METADATA,
  isConfigFactory,
  defineConfig
});
