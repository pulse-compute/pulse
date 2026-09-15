#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const { executeNodeJavascriptApplication } = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const { executeFastlyJavascriptApplication } = require('../../../packages/provider-fastly/src/javascript/runtime-host.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const fastly = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const { readWallTime, WALL_TIME_MAX_MS } = require('../../../packages/runtime/src/host.js');
const root = path.resolve(__dirname, '../../..');

const handler = async ctx => {
  const sample = await ctx.time.now();
  if (sample.status === 'failed') return ctx.text(sample.reason, { status: 503 });
  return ctx.text(sample.iso8601 + '|' + sample.unixEpochMs);
};
const grouped = async ctx => {
  const first = await ctx.time.now();
  const { second, third } = await ctx.parallel({ second: ctx.time.now(), third: ctx.time.now() });
  if (first.status !== 'ok' || second.status !== 'ok' || third.status !== 'ok') return ctx.text('failed', { status: 503 });
  return ctx.text(first.iso8601 + '|' + second.iso8601 + '|' + third.iso8601);
};

function compile(fn) {
  const compiled = compileCanonicalSource('export default ' + fn.toString(), { fileName: 'time.ts', rootDir: root });
  assert.equal(compiled.ok, true);
  assert.ok(compiled.metadata.capabilities.includes('time.wall-clock'));
  assert.ok(compiled.metadata.effectSites.every(effect => effect.kind === 'time.now'));
  const plan = buildCanonicalNativePlan(compiled);
  const native = compileCanonicalNativePlan(plan, { cwd: root });
  const fastlyNative = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: root, bindings: {}, canonicalBuild: true });
  assert.ok(fastlyNative.inspection.imports.some(entry => entry.module === 'wasi_snapshot_preview1' && entry.name === 'clock_time_get'));
  assert.ok(!fastlyNative.inspection.imports.some(entry => /crypto|secret|config|kv_store|js.compute/.test(entry.module)));
  assert.equal(fastlyNative.manifest.policy.javascriptRuntime, false);
  return { native, fastlyNative, compiled };
}

async function main() {
  const one = compile(handler);
  const msValues = [0, 1, 999, 1000, 86399999, 86400000, 951827696789, 4107542399999,
    4107542400000, 13574563200123, 18446744073709, WALL_TIME_MAX_MS];
  let cells = 0;
  for (const ms of msValues) {
    const expected = new Date(ms).toISOString() + '|' + ms;
    for (const execute of [executeNodeJavascriptApplication, executeFastlyJavascriptApplication]) {
      let calls = 0;
      const response = await execute(handler, new Request('https://time.test/'), { wallClock: () => { calls++; return ms; } });
      assert.equal(await response.text(), expected);
      assert.equal(calls, 1);
      cells++;
    }
    let calls = 0;
    const response = await executeCanonicalNativeModule(one.native, { providerAdapter: createNodeProviderAdapter({ wallClock: () => { calls++; return ms; } }) });
    assert.equal(response.response.body, expected);
    assert.equal(calls, 1);
    cells++;
    // WASI represents unsigned 64-bit nanoseconds, a smaller clock range than
    // the portable four-digit-year result contract. Test its whole range.
    if (BigInt(ms) * 1000000n <= 0xffffffffffffffffn) {
      calls = 0;
      const result = fastly.executeFastlyNativePlatformCapabilities(one.fastlyNative, {
        realtimeClock: () => { calls++; return { nanoseconds: BigInt(ms) * 1000000n }; }
      });
      assert.equal(result.response.body, expected);
      assert.equal(calls, 1);
      cells++;
    }
  }
  // Sub-millisecond bits must be discarded before any floating-point conversion.
  const ns = 0xffffffffffffffffn;
  const max = Number(ns / 1000000n);
  assert.equal(fastly.executeFastlyNativePlatformCapabilities(one.fastlyNative, {
    realtimeClock: () => ({ nanoseconds: ns })
  }).response.body, new Date(max).toISOString() + '|' + max);

  for (const clock of [null, () => { throw new Error('private clock failure'); }, () => NaN, () => -1, () => 1.5, () => WALL_TIME_MAX_MS + 1]) {
    const expected = readWallTime(clock).reason;
    for (const execute of [executeNodeJavascriptApplication, executeFastlyJavascriptApplication]) {
      const result = await execute(handler, new Request('https://time.test/'), { wallClock: clock });
      assert.equal(result.status, 503);
      assert.equal(await result.text(), expected);
    }
    const result = await executeCanonicalNativeModule(one.native, { providerAdapter: createNodeProviderAdapter({ wallClock: clock }) });
    assert.equal(result.response.status, 503);
    assert.equal(result.response.body, expected);
  }
  const failed = fastly.executeFastlyNativePlatformCapabilities(one.fastlyNative, { realtimeClock: () => ({ status: 29 }) });
  assert.equal(failed.response.status, 503);
  assert.equal(failed.response.body, 'unavailable');

  const many = compile(grouped);
  const times = [2000, 1000, 3000];
  const expected = times.map(ms => new Date(ms).toISOString()).join('|');
  for (const execute of [executeNodeJavascriptApplication, executeFastlyJavascriptApplication]) {
    let index = 0;
    const result = await execute(grouped, new Request('https://time.test/'), { wallClock: () => times[index++] });
    assert.equal(await result.text(), expected);
    assert.equal(index, 3);
  }
  let index = 0;
  const nativeResult = await executeCanonicalNativeModule(many.native, { providerAdapter: createNodeProviderAdapter({ wallClock: () => times[index++] }) });
  assert.equal(nativeResult.response.body, expected);
  assert.equal(index, 3);
  index = 0;
  assert.equal(fastly.executeFastlyNativePlatformCapabilities(many.fastlyNative, {
    realtimeClock: () => ({ nanoseconds: BigInt(times[index++]) * 1000000n })
  }).response.body, expected);
  assert.equal(index, 3);

  // The shared execution context also retains Node's existing direct event lane.
  const fs = require('node:fs');
  const os = require('node:os');
  const { Pulse } = require('../../../packages/pulse/src/index.js');
  const { executeNodeJavascriptEvent } = require('../../../packages/provider-node/src/javascript/runtime-host.js');
  const { executeNodeNativeEvent } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
  const { createNodeEventReferenceAdapter } = require('../../../packages/provider-node/src/events/reference-adapter.js');
  const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler.js');
  const onTime = async ctx => {
    const sample = await ctx.time.now();
    if (sample.status === 'ok' && sample.unixEpochMs === 1234) await ctx.emit('time.sampled', { schema: null });
  };
  const app = new Pulse({ auto: true });
  app.on('time.requested', { schema: null }, onTime);
  const temp = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'time-event-'));
  try {
    const file = path.join(temp, 'index.ts');
    fs.writeFileSync(file, "import { Pulse } from '@pulse-compute/pulse'; const app = new Pulse({auto:true}); app.on('time.requested', {schema:null}, " + onTime.toString() + "); export default app;");
    const eventCompiled = compileCanonicalProject(file, { rootDir: temp, workspaceRoot: root,
      applicationProjectMetadata: { selectedProfile: { name: 'time', source: 'time-conformance' }, strict: true, target: 'native', host: 'node', projectHash: '5'.repeat(64), configPlanHash: '6'.repeat(64), bindings: { config: [], secret: [] }, fragments: {} },
      strict: true, requireAsync: true, requireEffectAwait: true });
    const eventNative = compileCanonicalNativePlan(buildCanonicalNativePlan(eventCompiled), { cwd: root });
    for (const [execute, application] of [[executeNodeJavascriptEvent, app], [executeNodeNativeEvent, eventNative]]) {
      const eventAdapter = createNodeEventReferenceAdapter();
      let calls = 0;
      const result = await execute(application, { version: 'pulse.event-frame.v1', type: 'time.requested', schemaId: null }, {
        eventAdapter, wallClock: () => { calls++; return 1234; }
      });
      assert.equal(result.status, 'completed');
      assert.equal(calls, 1);
      assert.equal(eventAdapter.acceptedFrames()[0].type, 'time.sampled');
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }

  // Invalid provider payloads stay protocol failures; never fabricate time.
  await assert.rejects(executeCanonicalNativeModule(one.native, {
    providerAdapter: { ...createNodeProviderAdapter(), dispatchEffect: () => ({ status: 'ok', unixEpochMs: 0, iso8601: 'wrong' }) }
  }), error => error.code === 'PULSE_TIME_RESULT_INVALID');
  const abort = new AbortController();
  let started, release;
  const waiting = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const execution = executeCanonicalNativeModule(one.native, { signal: abort.signal,
    providerAdapter: { ...createNodeProviderAdapter(), dispatchEffect() { started(); return pending; } } });
  await waiting;
  abort.abort(new Error('time invocation stopped'));
  await assert.rejects(execution, /time invocation stopped/);
  release(readWallTime(() => 0));

  for (const expression of ['ctx.time.now(123)', 'Date.now()', 'ctx.time.now().unixEpochMs']) {
    assert.throws(() => compileCanonicalSource(`export default async ctx => { const t = await ${expression}; return ctx.text('bad'); }`, { fileName: 'invalid-time.ts' }));
  }
  console.log(`ok - time: ${cells} date/range cells, four-mode grouped regression, failures, cancellation and strict admission; Fastly evidence is local Wasm`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
