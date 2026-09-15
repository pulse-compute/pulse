#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler.js');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');

const rootDir = path.resolve(__dirname, '../../..');
const source = `import { Router } from '@pulse-compute/runtime';
const app = new Router();
app.get('/group', async (ctx) => {
  const { first, second } = await ctx.parallel({ first: ctx.config.get('FIRST'), second: ctx.config.get('SECOND') });
  const late = await ctx.config.get('TOO_LATE');
  return ctx.text(late);
});
app.error(async (error, ctx, next) => {
  const recovered = await ctx.config.get('RECOVER');
  return ctx.text(error.code + recovered, { status: 400 });
});
export default app;`;

function failure(code, cause) {
  return Object.assign(new Error('private failure', cause ? { cause } : undefined), { code });
}

async function main() {
  const router = compileCanonicalRouterSource(source, { fileName: 'error-boundaries.ts', rootDir });
  const compiled = compileCanonicalSource(router.sourceText, {
    fileName: 'error-boundaries.ts', rootDir,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata }
  });
  const native = compileCanonicalNativePlan(buildCanonicalNativePlan(compiled), { cwd: rootDir });
  for (const scenario of ['recover', 'fatal-sibling', 'trap-cause', 'abort']) {
    const seen = [];
    const abort = new AbortController();
    let release;
    let started;
    const waiting = new Promise(resolve => { started = resolve; });
    const sibling = new Promise(resolve => { release = resolve; });
    const adapter = {
      ...createNodeProviderAdapter(),
      async dispatchEffect(effect) {
        seen.push(effect.name);
        if (effect.name === 'FIRST') throw failure('PULSE_SCHEMA_DECODE', scenario === 'trap-cause' ? new WebAssembly.RuntimeError('trap') : undefined);
        if (effect.name === 'SECOND') {
          started();
          await sibling;
          seen.push('SECOND_SETTLED');
          if (scenario === 'fatal-sibling') throw failure('PULSE_PROVIDER_PROTOCOL_INVALID');
          return 'settled';
        }
        if (effect.name === 'RECOVER') return '!';
        throw new Error('Failed handler dispatched a later effect');
      }
    };
    const execution = executeCanonicalNativeModule(native, {
      request: { method: 'GET', path: '/group' }, providerAdapter: adapter, signal: abort.signal,
      redactionValues: ['private failure']
    });
    await waiting;
    assert.deepEqual(seen, ['FIRST', 'SECOND']);
    if (scenario === 'abort') {
      abort.abort(new Error('invocation stopped'));
      // Cancellation does not depend on an uncooperative provider settling.
      await assert.rejects(execution, /invocation stopped/);
      assert.equal(seen.includes('RECOVER'), false);
    }
    release();
    if (scenario === 'recover') {
      const result = await execution;
      assert.equal(result.response.status, 400);
      assert.equal(result.response.body, 'PULSE_SCHEMA_DECODE!');
      assert.deepEqual(seen, ['FIRST', 'SECOND', 'SECOND_SETTLED', 'RECOVER']);
      assert.equal(result.continuations[0].state, 'failed');
      assert.equal(result.continuations[1].state, 'completed');
      assert.equal(JSON.stringify(result).includes('private failure'), false);
    } else {
      await assert.rejects(execution, scenario === 'abort' ? /invocation stopped/
        : error => error.code === (scenario === 'fatal-sibling' ? 'PULSE_PROVIDER_PROTOCOL_INVALID' : 'PULSE_SCHEMA_DECODE'));
      assert.equal(seen.includes('RECOVER'), false);
    }
    assert.equal(seen.includes('TOO_LATE'), false);
  }
  const aborted = new AbortController();
  aborted.abort(new Error('before entry'));
  await assert.rejects(executeCanonicalNativeModule(native, {
    request: { method: 'GET', path: '/group' }, providerAdapter: createNodeProviderAdapter(), signal: aborted.signal
  }), /before entry/);
  console.log('ok - Native error recovery settles siblings once, stops later effects, and excludes traps, protocol faults and cancellation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
