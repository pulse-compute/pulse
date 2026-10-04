#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler.js');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const mock = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

function main() {
  const project = path.resolve(__dirname, '../../fixtures/projects/fastly-compute-reality');
  const source = `import { Router } from '@pulse-compute/runtime'
const app = new Router()
app.get('/config', async (ctx) => {
  const first = await ctx.config.get('GEN0')
  const second = await ctx.config.get('GEN1')
  const third = await ctx.config.get('GEN2')
  return ctx.text((first || '') + (second || '') + (third || ''))
})
export default app
`;
  const router = compileCanonicalRouterSource(source, { fileName: 'src/index.ts', rootDir: project });
  const compiled = compileCanonicalSource(router.sourceText, {
    fileName: 'src/index.ts', rootDir: project, strict: false,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata }
  });
  assert.equal(compiled.ok, true);
  const plan = buildCanonicalNativePlan(compiled);
  assert.deepEqual(plan.effects.map(effect => effect.kind), ['config.get', 'config.get', 'config.get']);
  assert.equal(new Set(plan.effects.map(effect => effect.id)).size, 3, 'static effect identities stay distinct');
  const options = { canonicalBuild: true, bindings: { configStore: 'gen04' }, emitWat: false };
  const native = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, options);
  assert.equal(native.inspection.valid, true);
  assert.match(native.source, /function __pulse_fastly_resolve_config_get\(effectIndex: i32\): i32/);
  assert.match(native.source, /case 0:\s+case 1:\s+case 2:\s+return __pulse_fastly_resolve_config_get\(effectIndex\)/);
  assert.equal((native.source.match(/function __pulse_fastly_resolve_config_get\(/g) || []).length, 1);
  assert.deepEqual(native.inspection.importModules.filter(module => module === 'fastly_config_store'), ['fastly_config_store']);

  const request = { method: 'GET', path: '/config' };
  const execute = config => mock.executeFastlyNativePlatformCapabilities(native, {
    request, configStore: 'gen04', config
  });
  const present = execute({ GEN0: 'A', GEN1: 'B', GEN2: 'C' });
  assert.equal(present.response.status, 200);
  assert.equal(present.response.body, 'ABC');
  assert.deepEqual(present.trace.filter(entry => entry.module === 'fastly_config_store' && entry.name === 'get')
    .map(entry => [entry.key, entry.found]), [['GEN0', true], ['GEN1', true], ['GEN2', true]]);
  const missing = execute({ GEN0: 'A', GEN2: 'C' });
  assert.equal(missing.response.status, 200);
  assert.equal(missing.response.body, 'AC');
  assert.deepEqual(missing.trace.filter(entry => entry.module === 'fastly_config_store' && entry.name === 'get')
    .map(entry => [entry.key, entry.found]), [['GEN0', true], ['GEN1', false], ['GEN2', true]]);
  assert.throws(() => execute({ GEN0: 'A', GEN1: 'x'.repeat(65537), GEN2: 'C' }),
    error => error.code === 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED'
      && error.detail.errorEffect === 1 && error.detail.errorStage === 113
      && JSON.stringify(error.detail.trace).includes('GEN1')
      && !JSON.stringify(error.detail.trace).includes('GEN2'),
    'the second site reports its own host error and suppresses the later effect');
  assert.throws(() => mock.executeFastlyNativePlatformCapabilities(native, { request }),
    error => error.code === 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED'
      && error.detail.lastError !== 0
      && !error.detail.trace.some(entry => entry.name === 'send_downstream'));
  const cancellation = new Error('GEN04 cancellation');
  assert.throws(() => mock.executeFastlyNativePlatformCapabilities(native, {
    request, configStore: 'gen04', config: { GEN0: 'A' }, signal: { aborted: true, reason: cancellation }
  }), error => error === cancellation);
  console.log('ok - repeated config effect handoff preserves site identities, order, missing values, errors, and cancellation');
}

if (require.main === module) main();
module.exports = { main };
