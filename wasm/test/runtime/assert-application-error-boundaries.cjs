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
const { generateCanonicalNativeAssemblyScript } = require('../../packages/runtime-core-as/src/compiler/canonical-native.js');
const { layoutNativeControl } = require('../../packages/runtime-core-as/src/compiler/canonical-native-control.js');

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

function staticGuardLayout() {
  // Repeated pairs share a wrapper; equal cursors with different return blocks
  // cannot share. Stage/helper globals remain runtime arguments.
  const boundaries = [
    { nextIndex: 3, nextBlock: 12 }, { nextIndex: 3, nextBlock: 12 },
    { nextIndex: 3, nextBlock: 13 }, { nextIndex: 4, nextBlock: 12 },
    { nextIndex: '__pulse_stage_next', nextBlock: '__pulse_stage_return' },
    { nextIndex: '__pulse_helper_error_next', nextBlock: '__pulse_helper_error_return' }
  ];
  const blocks = boundaries.map((boundary, id) => ({ id, boundary, kind: 'return', expression: '__pulse_expr_0' }));
  const input = { blocks, stages: new Map(), helpers: new Map(), handlers: new Map(), applicationErrors: true,
    routerLocal: name => name, routerCursor: 'cursor', localName: name => '__local_' + name,
    fail: message => { throw new Error(message); } };
  const before = JSON.stringify(blocks);
  const layout = layoutNativeControl(input);
  assert.deepEqual(layoutNativeControl(input), layout, 'wrapper interning is deterministic across both rendering passes');
  assert.equal(JSON.stringify(blocks), before, 'boundary binding cannot mutate plan blocks');
  const declarations = layout.errorGuard.join('\n');
  assert.deepEqual([...declarations.matchAll(/return __pulse_route_error\((\d+)\.0, (\d+)\)/g)].map(m => m.slice(1)),
    [['3', '12'], ['3', '13'], ['4', '12']], 'each unique literal pair gets exactly one forwarding body');
  const guards = layout.renderedBlocks.map(block => block.source);
  assert.equal((guards.slice(0, 2).join('\n').match(/__pulse_static_error_0\(\)/g) || []).length, 4);
  assert.match(guards[4], /__pulse_route_error\(<f64>__pulse_stage_next, __pulse_stage_return\)/);
  assert.match(guards[5], /__pulse_route_error\(<f64>__pulse_helper_error_next, __pulse_helper_error_return\)/);
  for (const block of layout.renderedBlocks) {
    const expanded = block.source.replace(/__pulse_static_error_(\d+)\(\)/g, (_, i) => {
      const pair = [boundaries[0], boundaries[2], boundaries[3]][Number(i)];
      return `__pulse_route_error(${pair.nextIndex}.0, ${pair.nextBlock})`;
    });
    // Partition accounting charges the pre-sharing guard, not the shorter call.
    const inline = expanded.replace(/\{ const routed = __pulse_route_error\(([^,]+), ([^)]+)\)\n        if \(routed < 0\) return routed\n        if \(routed > 0\) continue\n      \}/g,
      (_, cursor, next) => `{ const failure = host_router_error_take()\n        if (failure < 0) { __pulse_error = 5; return -1 }\n        if (failure > 0) {\n          __local_error = failure\n          __local_mode = host_value_number(1.0)\n          __local_cursor = host_value_number(${cursor.replace('<f64>', '')})\n          __pulse_pending = 0; __pulse_state = 0; __pulse_result = 0\n          __pulse_pc = ${next}; continue\n        } }`);
    // Dynamic cursors retain the existing accounting spelling (global + .0).
    if (block.item.boundary && typeof block.item.boundary.nextIndex === 'number')
      assert.equal(block.partitionCharacters, inline.length, 'binding preserves the original partition budget');
  }
}

function stalledDispatcher(native) {
  // Test-only no-progress fault: preserve the module layout and original run
  // guard, but make the retained step return its private advance status forever.
  const names = [...native.wat.matchAll(/^ \(func \$([^\s(]+)/gm)].map(m => m[1]);
  const target = names.indexOf('canonical-native.as/__pulse_step');
  assert.ok(target >= 0);
  const bytes = Buffer.from(native.wasm);
  let offset = 8;
  const leb = () => { let value = 0, shift = 0, byte; do { byte = bytes[offset++]; value |= (byte & 127) << shift; shift += 7; } while (byte & 128); return value; };
  while (offset < bytes.length) {
    const section = bytes[offset++], length = leb(), end = offset + length;
    if (section === 10) {
      const count = leb();
      assert.equal(count, names.length);
      for (let index = 0; index < count; index++) {
        const size = leb();
        if (index === target) {
          assert.ok(size >= 5);
          bytes.fill(0x01, offset, offset + size); // nop padding
          bytes.set([0x00, 0x41, 0x02, 0x0f], offset); // no locals; i32.const 2; return
          bytes[offset + size - 1] = 0x0b;
          assert.equal(WebAssembly.validate(bytes), true);
          return bytes;
        }
        offset += size;
      }
    }
    offset = end;
  }
  throw new Error('Missing dispatcher body');
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
    const wrappers = [...native.source.matchAll(/@noinline\nfunction (__pulse_static_error_\d+)\(\): i32 \{\n  return __pulse_route_error\((\d+)\.0, (\d+)\)\n\}/g)];
    assert.ok(wrappers.length > 1, 'the anonymous consumer has multiple static boundaries');
    assert.equal(new Set(wrappers.map(m => m[2] + ':' + m[3])).size, wrappers.length);
    assert.equal(native.source, generateCanonicalNativeAssemblyScript(native.plan).source, 'binding emits deterministic source');
    for (const [, name] of wrappers) {
      assert.ok(new RegExp(`\\(func \\$canonical-native\\.as/${name}\\b`).test(native.wat), 'optimized Wasm retains ' + name);
      assert.ok(new RegExp(`call \\$canonical-native\\.as/${name}\\b`).test(native.wat), 'native callers reuse ' + name);
    }
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
    if (padding) {
      takes = 0;
      imports.pulse_host.router_error_take = () => { takes++; return 0; };
      const exhausted = new WebAssembly.Instance(new WebAssembly.Module(stalledDispatcher(native)), imports).exports;
      assert.equal(exhausted.pulse_start(), -1, 'no progress exhausts the existing run allowance');
      assert.equal(exhausted.pulse_last_error_code(), 5);
      assert.equal(takes, 0);
      assert.equal(effects, 0, 'guard exhaustion cannot dispatch effects');
    }
  }
}

async function main() {
  staticGuardLayout();
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
