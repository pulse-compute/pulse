#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Pulse } = require('../../../packages/pulse/src/index.js');
const events = require('../../packages/contracts/src/events/contracts.js');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const {
  NODE_EVENT_ADAPTER_CODES,
  createNodeEventReferenceAdapter
} = require('../../../packages/provider-node/src/events/reference-adapter.js');
const {
  executeNodeJavascriptEvent
} = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const {
  executeNodeNativeEvent
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const {
  NODE_CANONICAL_PROVIDER_CAPABILITIES,
  NODE_NATIVE_TARGET_CAPABILITIES
} = require('../../../packages/provider-node/src/capabilities.js');
const {
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/javascript/target.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/native/target.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function frame(type) {
  return Object.freeze({ version: events.EVENT_FRAME_VERSION, type, schemaId: null });
}

function completed() {
  return Object.freeze({
    version: events.EVENT_EXECUTION_RESULT_VERSION,
    status: events.EVENT_EXECUTION_STATUS.COMPLETED
  });
}

function javascriptApplication() {
  const app = new Pulse({ auto: true });
  app.on('input.one', { schema: null }, async (ctx) => {
    await ctx.emit('output.one', { schema: null });
  });
  app.on('input.two', { schema: null }, async (ctx) => {
    await ctx.emit('output.two', { schema: null });
  });
  return app;
}

function write(root, relative, source) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

function nativeApplication(root) {
  write(root, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  write(root, 'src/handlers.ts', `
export async function onOne(ctx) {
  await ctx.emit('output.one', { schema: null })
}

export async function onTwo(ctx) {
  await ctx.emit('output.two', { schema: null })
}
`);
  const entry = write(root, 'src/index.ts', `
import { Pulse } from '@pulse-compute/pulse'
import { onOne, onTwo } from './handlers.js'
const app = new Pulse({ auto: true })
app.on('input.one', { schema: null }, onOne)
app.on('input.two', { schema: null }, onTwo)
export default app
`);
  const compiled = compileCanonicalProject(entry, {
    rootDir: root,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(root, 'tsconfig.json'),
    applicationProjectMetadata: {
      selectedProfile: { name: 'test', source: 'events-node-reference' },
      strict: true,
      target: 'native',
      host: 'node',
      projectHash: '5'.repeat(64),
      configPlanHash: '6'.repeat(64),
      bindings: { config: [], secret: [] },
      fragments: {}
    },
    strict: true,
    requireAsync: true,
    requireEffectAwait: true
  });
  const plan = buildCanonicalNativePlan(compiled);
  return Object.freeze({
    compiled: compileCanonicalNativePlan(plan, { cwd: repoRoot, timeoutMs: 180000 }),
    plan
  });
}

async function drainJavascript(adapter, application) {
  return adapter.drain((input, execution) => executeNodeJavascriptEvent(application, input, {
    eventAdapter: adapter,
    signal: execution.signal
  }));
}

async function drainNative(adapter, compiled) {
  return adapter.drain((input, execution) => executeNodeNativeEvent(compiled, input, {
    eventAdapter: adapter,
    signal: execution.signal
  }));
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-events-node-reference-'));
  try {
    const javascript = javascriptApplication();
    const native = nativeApplication(path.join(tempRoot, 'native'));

    for (const capability of ['event.ingress', 'event.emit']) {
      assert.ok(NODE_CANONICAL_PROVIDER_CAPABILITIES.includes(capability));
      assert.ok(NODE_NATIVE_TARGET_CAPABILITIES.includes(capability));
      assert.ok(NODE_NATIVE_TARGET_DESCRIPTOR.capabilities.includes(capability));
    }
    assert.equal(NODE_JAVASCRIPT_TARGET_DESCRIPTOR.capabilities.events.ingress, true);
    assert.equal(NODE_JAVASCRIPT_TARGET_DESCRIPTOR.capabilities.events.emit, true);
    assert.equal(NODE_JAVASCRIPT_TARGET_DESCRIPTOR.capabilities.events.automaticLoopback, false);
    assert.equal(NODE_JAVASCRIPT_TARGET_DESCRIPTOR.automaticFallback, false);
    assert.equal(NODE_NATIVE_TARGET_DESCRIPTOR.automaticFallback, false);

    const javascriptDirectAdapter = createNodeEventReferenceAdapter({ id: 'javascript-direct', maxQueueDepth: 8 });
    const nativeDirectAdapter = createNodeEventReferenceAdapter({ id: 'native-direct', maxQueueDepth: 8 });
    let nativeEvidence;
    const javascriptDirect = await executeNodeJavascriptEvent(javascript, frame('input.one'), {
      eventAdapter: javascriptDirectAdapter
    });
    const nativeDirect = await executeNodeNativeEvent(native.compiled, frame('input.one'), {
      eventAdapter: nativeDirectAdapter,
      onEventExecutionEvidence(value) { nativeEvidence = value; }
    });
    assert.deepEqual(javascriptDirect, completed());
    assert.deepEqual(nativeDirect, javascriptDirect, 'Node JavaScript and Native direct event results must match exactly');
    assert.deepEqual(javascriptDirectAdapter.acceptedFrames(), [frame('output.one')]);
    assert.deepEqual(nativeDirectAdapter.acceptedFrames(), javascriptDirectAdapter.acceptedFrames(), 'accepted outbound frame evidence must match exactly');
    assert.deepEqual(javascriptDirectAdapter.pendingFrames(), [], 'outbound acceptance must not loop back into ingress');
    assert.deepEqual(nativeDirectAdapter.pendingFrames(), [], 'Native outbound acceptance must not loop back into ingress');
    assert.equal(nativeEvidence.effectCount, 1);
    assert.deepEqual(nativeEvidence.continuations[0].states, ['created', 'waiting', 'resumed', 'completed']);

    const javascriptQueue = createNodeEventReferenceAdapter({ id: 'javascript-fifo', maxQueueDepth: 8 });
    javascriptQueue.enqueue(frame('input.one'));
    javascriptQueue.enqueue(frame('input.two'));
    const javascriptOutcomes = await drainJavascript(javascriptQueue, javascript);
    assert.deepEqual(javascriptOutcomes.map((entry) => entry.frame.type), ['input.one', 'input.two']);
    assert.ok(javascriptOutcomes.every((entry) => entry.result.status === events.EVENT_EXECUTION_STATUS.COMPLETED));
    assert.deepEqual(javascriptQueue.acceptedFrames().map((entry) => entry.type), ['output.one', 'output.two']);
    assert.equal(javascriptQueue.summary().maximumActiveInvocations, 1);

    const nativeQueue = createNodeEventReferenceAdapter({ id: 'native-fifo', maxQueueDepth: 8 });
    nativeQueue.enqueue(frame('input.one'));
    nativeQueue.enqueue(frame('input.two'));
    const nativeOutcomes = await drainNative(nativeQueue, native.compiled);
    assert.deepEqual(nativeOutcomes, javascriptOutcomes, 'Node JavaScript and Native FIFO ingress outcomes must match exactly');
    assert.deepEqual(nativeQueue.acceptedFrames(), javascriptQueue.acceptedFrames());
    assert.equal(nativeQueue.summary().maximumActiveInvocations, 1);

    const bounded = createNodeEventReferenceAdapter({ id: 'bounded', maxQueueDepth: 1 });
    bounded.enqueue(frame('input.one'));
    assert.throws(
      () => bounded.enqueue(frame('input.two')),
      (error) => error && error.code === NODE_EVENT_ADAPTER_CODES.QUEUE_FULL
    );

    const busy = createNodeEventReferenceAdapter({ id: 'busy', maxQueueDepth: 2 });
    busy.enqueue(frame('input.one'));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const firstDrain = busy.drain(async () => {
      await gate;
      return completed();
    });
    await assert.rejects(
      busy.drain(async () => completed()),
      (error) => error && error.code === NODE_EVENT_ADAPTER_CODES.INSTANCE_BUSY
    );
    release();
    await firstDrain;
    assert.equal(busy.summary().maximumActiveInvocations, 1);

    function pendingAcceptance(started) {
      return Object.freeze({
        acceptOutbound(_frame, execution) {
          started();
          return new Promise((_resolve, reject) => {
            const onAbort = () => reject(execution.signal.reason || new Error('cancelled'));
            if (execution.signal.aborted) onAbort();
            else execution.signal.addEventListener('abort', onAbort, { once: true });
          });
        }
      });
    }
    const javascriptInFlightController = new AbortController();
    let javascriptStarted;
    const javascriptStartedPromise = new Promise((resolve) => { javascriptStarted = resolve; });
    const javascriptInFlightPromise = executeNodeJavascriptEvent(javascript, frame('input.one'), {
      eventAdapter: pendingAcceptance(javascriptStarted),
      signal: javascriptInFlightController.signal
    });
    await javascriptStartedPromise;
    javascriptInFlightController.abort(new Error('javascript in-flight cancellation'));
    const javascriptInFlightCancelled = await javascriptInFlightPromise;

    const nativeInFlightController = new AbortController();
    let nativeStarted;
    const nativeStartedPromise = new Promise((resolve) => { nativeStarted = resolve; });
    const nativeInFlightPromise = executeNodeNativeEvent(native.compiled, frame('input.one'), {
      eventAdapter: pendingAcceptance(nativeStarted),
      signal: nativeInFlightController.signal
    });
    await nativeStartedPromise;
    nativeInFlightController.abort(new Error('native in-flight cancellation'));
    const nativeInFlightCancelled = await nativeInFlightPromise;
    assert.equal(javascriptInFlightCancelled.error.category, 'cancelled');
    assert.equal(nativeInFlightCancelled.error.category, javascriptInFlightCancelled.error.category);

    const cancelledSignal = new AbortController();
    cancelledSignal.abort(new Error('cancelled by test'));
    const javascriptCancelled = await executeNodeJavascriptEvent(javascript, frame('input.one'), {
      eventAdapter: createNodeEventReferenceAdapter({ id: 'javascript-cancelled' }),
      signal: cancelledSignal.signal
    });
    const nativeCancelled = await executeNodeNativeEvent(native.compiled, frame('input.one'), {
      eventAdapter: createNodeEventReferenceAdapter({ id: 'native-cancelled' }),
      signal: cancelledSignal.signal
    });
    assert.equal(javascriptCancelled.error.category, 'cancelled');
    assert.equal(nativeCancelled.error.category, javascriptCancelled.error.category);

    const javascriptMissing = await executeNodeJavascriptEvent(javascript, frame('input.missing'), {
      eventAdapter: createNodeEventReferenceAdapter({ id: 'javascript-missing' })
    });
    const nativeMissing = await executeNodeNativeEvent(native.compiled, frame('input.missing'), {
      eventAdapter: createNodeEventReferenceAdapter({ id: 'native-missing' })
    });
    assert.equal(javascriptMissing.error.category, 'handler-not-found');
    assert.equal(nativeMissing.error.category, javascriptMissing.error.category);

    const javascriptFull = createNodeEventReferenceAdapter({ id: 'javascript-full', maxQueueDepth: 1 });
    const nativeFull = createNodeEventReferenceAdapter({ id: 'native-full', maxQueueDepth: 1 });
    javascriptFull.acceptOutbound(frame('prefilled'));
    nativeFull.acceptOutbound(frame('prefilled'));
    const javascriptAcceptanceFailure = await executeNodeJavascriptEvent(javascript, frame('input.one'), { eventAdapter: javascriptFull });
    const nativeAcceptanceFailure = await executeNodeNativeEvent(native.compiled, frame('input.one'), { eventAdapter: nativeFull });
    assert.equal(javascriptAcceptanceFailure.error.category, 'handler-failed');
    assert.equal(nativeAcceptanceFailure.error.category, javascriptAcceptanceFailure.error.category);

    const invalidAcceptance = Object.freeze({ acceptOutbound() { return true; } });
    const javascriptInvalidAcceptance = await executeNodeJavascriptEvent(javascript, frame('input.one'), {
      eventAdapter: invalidAcceptance
    });
    const nativeInvalidAcceptance = await executeNodeNativeEvent(native.compiled, frame('input.one'), {
      eventAdapter: invalidAcceptance
    });
    assert.equal(javascriptInvalidAcceptance.error.category, 'handler-failed');
    assert.equal(nativeInvalidAcceptance.error.category, javascriptInvalidAcceptance.error.category);

    const isolatedA = createNodeEventReferenceAdapter({ id: 'isolated-a' });
    const isolatedB = createNodeEventReferenceAdapter({ id: 'isolated-b' });
    isolatedA.enqueue(frame('input.one'));
    isolatedA.acceptOutbound(frame('output.one'));
    assert.deepEqual(isolatedB.pendingFrames(), []);
    assert.deepEqual(isolatedB.acceptedFrames(), []);

    const forbiddenNativeImports = native.compiled.inspection.imports.filter((entry) => /javascript|asyncify/i.test(`${entry.module}.${entry.name}`));
    const eventImports = native.compiled.inspection.imports.filter((entry) => String(entry.name).startsWith('pulse_event_'));
    assert.deepEqual(forbiddenNativeImports, []);
    assert.deepEqual(eventImports, []);

    console.log(JSON.stringify({
      version: 'pulse.events-node-reference-proof.v1',
      directParity: true,
      fifoParity: true,
      acceptedFrames: nativeQueue.acceptedFrames(),
      cancellationCategory: nativeCancelled.error.category,
      inFlightCancellationCategory: nativeInFlightCancelled.error.category,
      failureCategories: [nativeMissing.error.category, nativeAcceptanceFailure.error.category, nativeInvalidAcceptance.error.category],
      queueBound: bounded.eventAdapter.maxQueueDepth,
      maximumActiveInvocations: nativeQueue.summary().maximumActiveInvocations,
      automaticLoopback: false,
      nativeImports: native.compiled.inspection.imports.length,
      forbiddenNativeImports: forbiddenNativeImports.length,
      automaticFallback: false
    }));
    console.log('ok - Node JavaScript and Native event ingress, acceptance, FIFO, cancellation, failures, isolation, and continuation semantics match');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  if (error && Array.isArray(error.diagnostics)) console.error(JSON.stringify(error.diagnostics, null, 2));
  process.exitCode = 1;
});
