#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler.js');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');

const rootDir = path.resolve(__dirname, '../../..');
const source = `import { Router } from '@pulse-compute/runtime';
const app = new Router();
app.get('/group', async (ctx) => {
  let padding = 0;
  ${'padding += 1;\n'.repeat(160)}
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

async function sharedGuardBoundaries() {
  for (const padding of [0, 160]) {
    const text = `import { Router } from '@pulse-compute/runtime';
const app = new Router();
app.get('/', async (ctx, next) => next());
app.use(async (ctx, next) => {
  let count = 0; ${'count += 1;'.repeat(padding)}
  const first = await ctx.config.get('FIRST');
  const second = await ctx.config.get('SECOND');
  return ctx.text(first + second + count);
});
app.error(async (error, ctx, next) => {
  const recovered = await ctx.config.get('RECOVER');
  return ctx.text(error.code + recovered, { status: 400 });
});
export default app;`;
    const router = compileCanonicalRouterSource(text, { fileName: 'shared-guard.ts', rootDir });
    const compiled = compileCanonicalSource(router.sourceText, {
      fileName: 'shared-guard.ts', rootDir, compilerPrelude: router.compilerPrelude,
      compilerOwnedCalls: router.compilerOwnedCalls, internalGeneratedHandler: true,
      metadataExtensions: { router: router.metadata }
    });
    const plan = buildCanonicalNativePlan(compiled);
    // Slot order is an emitter detail, not a fixed Router ABI.
    const { planHash, ...unsigned } = plan;
    const reordered = { ...unsigned, locals: [...plan.locals].reverse() };
    const native = compileCanonicalNativePlan({ ...reordered,
      planHash: createHash('sha256').update(stableStringify(reordered)).digest('hex')
    }, { cwd: rootDir, emitWat: true });
    assert.equal(native.manifest.dispatcher.strategy, padding ? 'bounded-state-chunks' : 'single-function');
    assert.equal((native.source.match(/function __pulse_route_error\(/g) || []).length, 1);
    assert.match(native.wat, /\(func \$canonical-native\.as\/__pulse_route_error\b/,
      'the optimizer must retain the shared routing body');
    for (const recover of [false, true]) {
      const seen = [];
      const result = await executeCanonicalNativeModule(native, {
        request: { method: 'GET', path: '/' },
        providerAdapter: { ...createNodeProviderAdapter(), dispatchEffect(effect) {
          seen.push(effect.name);
          if (effect.name === 'FIRST' && recover) throw failure('PULSE_SCHEMA_DECODE');
          return { FIRST: 'A', SECOND: 'B', RECOVER: '!' }[effect.name];
        } }
      });
      assert.equal(result.response.status, recover ? 400 : 200);
      assert.equal(result.response.body, recover ? 'PULSE_SCHEMA_DECODE!' : `AB${padding}`);
      assert.deepEqual(seen, recover ? ['FIRST', 'RECOVER'] : ['FIRST', 'SECOND']);
      assert.deepEqual(result.continuations.map(item => item.state), recover ? ['failed', 'completed'] : ['completed', 'completed']);
    }
    // Exercise the negative ABI sentinel directly; the ordinary Node adapter
    // throws fatal errors instead of returning this Fastly-used sentinel.
    const module = new WebAssembly.Module(native.wasm), imports = {};
    let takes = 0, effects = 0;
    for (const entry of WebAssembly.Module.imports(module)) {
      (imports[entry.module] ||= {})[entry.name] = () => 0;
    }
    imports.pulse_host.value_truthy = () => 1;
    imports.pulse_host.router_error_take = () => { takes++; return -1; };
    imports.pulse_host.effect_begin = () => { effects++; };
    const fatal = new WebAssembly.Instance(module, imports).exports;
    assert.equal(fatal.pulse_start(), -1);
    assert.equal(fatal.pulse_last_error_code(), 5);
    assert.equal(takes, 1);
    assert.equal(effects, 0);
  }
}

async function main() {
  await sharedGuardBoundaries();
  const router = compileCanonicalRouterSource(source, { fileName: 'error-boundaries.ts', rootDir });
  const compiled = compileCanonicalSource(router.sourceText, {
    fileName: 'error-boundaries.ts', rootDir,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata }
  });
  const native = compileCanonicalNativePlan(buildCanonicalNativePlan(compiled), { cwd: rootDir });
  assert.equal(native.manifest.dispatcher.strategy, 'bounded-state-chunks');
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
