#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const logging = require('../../packages/contracts/src/logging.js');
const configRuntime = require('../../packages/contracts/src/project/config-runtime.js');
const surfaces = require('../../packages/contracts/src/handler/surface-contract.js');

assert.deepEqual(logging.REPORTING_LEVELS, {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
});
assert.deepEqual(logging.LOG_METHOD_LEVELS, { error: 1, warn: 2, info: 3, debug: 4 });
assert.equal(logging.DEFAULT_REPORTING_LEVEL, 'info');
assert.equal(logging.PULSE_LOG_ABI.signature, 'pulse_log(level:i32,message_ptr:i32,message_len:i32)->void');
assert.equal(logging.PULSE_LOG_ABI.synchronous, true);
assert.equal(logging.PULSE_LOG_ABI.effect, false);
assert.equal(logging.PULSE_LOG_ABI.continuation, false);
assert.equal(logging.PULSE_LOG_ABI.providerAdapterOwned, true);
assert.equal(logging.logStatementEnabled('error', 'off'), false);
assert.equal(logging.logStatementEnabled('error', 'error'), true);
assert.equal(logging.logStatementEnabled('info', 'warn'), false);
assert.equal(logging.logStatementEnabled('debug', 'debug'), true);
assert.throws(() => logging.normalizeReportingLevel('verbose'), (error) => error.code === 'PULSE_REPORTING_LEVEL_UNSUPPORTED');

const declaration = configRuntime.defineConfig(() => ({
  pulse: {
    entry: 'src/index.ts',
    defaultProfile: 'local',
    reporting: 'warn'
  },
  local: {
    host: 'node',
    target: 'javascript'
  },
  edge: {
    host: 'fastly',
    target: 'javascript',
    reporting: 'error'
  }
}));
const local = configRuntime.evaluateConfigFactory(declaration, { profile: 'local', profileSource: 'cli' });
const edge = configRuntime.evaluateConfigFactory(declaration, { profile: 'edge', profileSource: 'cli' });
assert.equal(local.plan.profile.reporting, 'warn');
assert.equal(edge.plan.profile.reporting, 'error');
assert.notEqual(local.plan.planHash, edge.plan.planHash);
assert.equal(local.plan.fragments.reporting, undefined, 'reporting is canonical profile state rather than a provider fragment');

function configAt(reporting) {
  return configRuntime.evaluateConfigFactory(configRuntime.defineConfig(() => ({
    pulse: { entry: 'src/index.ts', defaultProfile: 'local', reporting },
    local: { host: 'node', target: 'javascript' }
  })), { profile: 'local', profileSource: 'cli' });
}
assert.notEqual(configAt('info').plan.planHash, configAt('debug').plan.planHash, 'reporting is part of the resolved plan hash');

for (const level of ['error', 'warn', 'info', 'debug']) {
  const definition = surfaces.DEFAULT_HANDLER_SURFACE_REGISTRY.get(`ctx.log.${level}`);
  assert.equal(definition.class, 'sync');
  assert.equal(definition.awaitPolicy, 'synchronous-statement-only');
  assert.deepEqual(definition.validPositions, ['statement']);
  assert.equal(definition.targetSupport.native, true);
  assert.equal(definition.targetSupport.javascript, true);
  assert.equal(surfaces.classifyAwaitUse(`ctx.log.${level}`, { position: 'statement' }).ok, true);
  assert.equal(surfaces.classifyAwaitUse(`ctx.log.${level}`, { awaited: true, position: 'await-expression' }).code, 'PULSE_LOG_AWAIT_FORBIDDEN');
}

console.log('ok - logging levels, synchronous ABI, flat reporting resolution, and handler surfaces are canonical');
