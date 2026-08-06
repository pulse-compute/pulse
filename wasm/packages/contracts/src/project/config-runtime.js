'use strict';

const {
  createConfigScope,
  normalizeProjectDeclaration,
  selectProfilePlan
} = require('./config-plan.js');
const {
  CONFIG_FACTORY_CONTRACT_VERSION,
  CONFIG_SCOPE_CONTRACT_VERSION,
  defineConfig,
  isConfigFactory
} = require('./config-factory.js');

const PULSE_PACKAGE_API_VERSION = 'pulse.package-authoring.v1';

function evaluateConfigFactory(factory, options = {}) {
  if (!isConfigFactory(factory)) {
    const error = new TypeError('Pulse config must export defineConfig((scope) => ({ ... })).');
    error.code = 'PULSE_CONFIG_FACTORY_REQUIRED';
    throw error;
  }
  const raw = factory(createConfigScope());
  if (raw && typeof raw.then === 'function') {
    const error = new TypeError('Pulse config factories must be synchronous.');
    error.code = 'PULSE_CONFIG_FACTORY_ASYNC_UNSUPPORTED';
    throw error;
  }
  const declaration = normalizeProjectDeclaration(raw, { source: options.source });
  const plan = selectProfilePlan(declaration, {
    cliProfile: options.cliProfile,
    environmentProfile: options.environmentProfile,
    name: options.profile,
    source: options.profileSource
  });
  return Object.freeze({ declaration, plan });
}

module.exports = Object.freeze({
  PULSE_PACKAGE_API_VERSION,
  CONFIG_FACTORY_CONTRACT_VERSION,
  CONFIG_SCOPE_CONTRACT_VERSION,
  defineConfig,
  isConfigFactory,
  evaluateConfigFactory
});
