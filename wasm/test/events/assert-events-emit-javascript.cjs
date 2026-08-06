#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { Pulse } = require(path.join(repoRoot, 'packages/pulse/src/index.js'));
const runtimeHost = require(path.join(repoRoot, 'packages/runtime/src/host.js'));
const eventContracts = require(path.join(repoRoot, 'wasm/packages/contracts/src/events/contracts.js'));

const FRAME_VERSION = 'pulse.event-frame.v1';

const schemaCodecs = Object.freeze({
  registry: Object.freeze({ maxBytes: 65_536 }),
  ids: Object.freeze(['events.DeviceLedSet']),
  has(schemaId) { return schemaId === 'events.DeviceLedSet'; },
  decode(schemaId, value) {
    if (schemaId !== 'events.DeviceLedSet') throw new Error('unknown schema');
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.enabled !== 'boolean') {
      const error = new Error('payload leaked invalid-event-secret');
      error.code = 'PULSE_SCHEMA_DECODE';
      throw error;
    }
    return { enabled: value.enabled, token: value.token === undefined ? null : value.token };
  }
});

function inbound(type) {
  return { version: FRAME_VERSION, type, schemaId: null };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function main() {
  assert.equal(runtimeHost.RUNTIME_HOST_API_VERSION, 'pulse.runtime-host.v3');
  assert.equal(runtimeHost.EVENT_ADAPTER_VERSION, eventContracts.EVENT_ADAPTER_VERSION);
  assert.deepEqual(runtimeHost.EVENT_ADAPTER_SEMANTICS, eventContracts.EVENT_ADAPTER_SEMANTICS);
  let coercionCalls = 0;
  assert.throws(
    () => runtimeHost.createEventRecordingAdapter({ id: { toString() { coercionCalls += 1; return 'unsafe'; } } }),
    (error) => error && error.code === 'PULSE_RUNTIME_EVENT_ADAPTER_INVALID'
  );
  assert.throws(
    () => runtimeHost.createEventRecordingAdapter({ maxQueueDepth: { valueOf() { coercionCalls += 1; return 1; } } }),
    (error) => error && error.code === 'PULSE_RUNTIME_EVENT_ADAPTER_INVALID'
  );
  assert.equal(coercionCalls, 0, 'reference adapter options must never invoke coercion hooks');

  const app = new Pulse({ auto: true });
  let loopbackCalls = 0;
  let httpEmitResult;
  app.on('device.led.set', { schema: 'events.DeviceLedSet' }, async () => { loopbackCalls += 1; });
  app.on('source.event', { schema: null }, async (ctx) => {
    const accepted = await ctx.emit('event.outbound', { schema: null });
    assert.equal(accepted, undefined);
  });
  app.get('/emit', async (ctx) => {
    const payload = { enabled: true, token: 'outbound-sensitive-token' };
    const first = ctx.emit('device.led.set', { schema: 'events.DeviceLedSet', payload });
    payload.enabled = false;
    payload.token = 'mutated';
    const grouped = await ctx.parallel({
      led: first,
      tick: ctx.emit('system.tick', { schema: null })
    });
    httpEmitResult = grouped;
    return ctx.text('accepted');
  });

  const observations = [];
  const httpAdapter = runtimeHost.createEventRecordingAdapter({ id: 'events.http-recording', maxQueueDepth: 4 });
  const response = await runtimeHost.executeApplication(app, new Request('https://example.test/emit'), {
    schemaCodecs,
    effectAdapter: httpAdapter,
    onEffectObservation(observation) { observations.push(observation); }
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'accepted');
  assert.deepEqual(httpEmitResult, { led: undefined, tick: undefined });
  assert.deepEqual(httpAdapter.acceptedFrames(), [
    {
      version: FRAME_VERSION,
      type: 'device.led.set',
      schemaId: 'events.DeviceLedSet',
      payload: { enabled: true, token: 'outbound-sensitive-token' }
    },
    { version: FRAME_VERSION, type: 'system.tick', schemaId: null }
  ]);
  assert.ok(httpAdapter.acceptedFrames().every((entry) => Object.isFrozen(entry)));
  assert.equal(loopbackCalls, 0, 'outbound acceptance must never invoke a matching local event registration');
  assert.doesNotMatch(JSON.stringify(observations), /outbound-sensitive-token|mutated/);
  assert.match(JSON.stringify(observations), /<redacted>/);
  assert.ok(observations.filter((entry) => entry.type === 'effect-dispatched').every((entry) => entry.effect.capability === 'event.emit'));

  const eventAdapter = runtimeHost.createEventRecordingAdapter({ id: 'events.event-recording', maxQueueDepth: 2 });
  const eventResult = await runtimeHost.executeEvent(app, inbound('source.event'), {
    schemaCodecs,
    effectAdapter: eventAdapter
  });
  assert.deepEqual(eventResult, { version: 'pulse.event-execution-result.v1', status: 'completed' });
  assert.deepEqual(eventAdapter.acceptedFrames(), [
    { version: FRAME_VERSION, type: 'event.outbound', schemaId: null }
  ]);
  assert.equal(loopbackCalls, 0);

  let invalidSchemaCode;
  let invalidSchemaDispatches = 0;
  const invalidSchemaApp = new Pulse({ auto: true });
  invalidSchemaApp.get('/invalid', async (ctx) => {
    try {
      await ctx.emit('device.led.set', {
        schema: 'events.DeviceLedSet',
        payload: { enabled: 'yes', token: 'invalid-event-secret' }
      });
    } catch (error) {
      invalidSchemaCode = error.code;
    }
    return ctx.text('contained');
  });
  const invalidSchemaResponse = await runtimeHost.executeApplication(invalidSchemaApp, new Request('https://example.test/invalid'), {
    schemaCodecs,
    capabilities: {
      emit() { invalidSchemaDispatches += 1; }
    }
  });
  assert.equal(invalidSchemaResponse.status, 200);
  assert.equal(invalidSchemaCode, 'PULSE_RUNTIME_EVENT_EMIT_SCHEMA_INVALID');
  assert.equal(invalidSchemaDispatches, 0, 'schema rejection must precede adapter dispatch');

  let accessorCalls = 0;
  let accessorCode;
  const accessorApp = new Pulse({ auto: true });
  accessorApp.get('/accessor', async (ctx) => {
    const event = { schema: 'events.DeviceLedSet' };
    Object.defineProperty(event, 'payload', { enumerable: true, get() { accessorCalls += 1; return {}; } });
    try { await ctx.emit('device.led.set', event); }
    catch (error) { accessorCode = error.code; }
    return ctx.text('contained');
  });
  const accessorResponse = await runtimeHost.executeApplication(accessorApp, new Request('https://example.test/accessor'), {
    schemaCodecs,
    capabilities: { emit() { throw new Error('must not dispatch'); } }
  });
  assert.equal(accessorResponse.status, 200);
  assert.equal(accessorCalls, 0);
  assert.equal(accessorCode, 'PULSE_RUNTIME_EVENT_EMIT_INPUT_INVALID');

  let receiptCode;
  const receiptApp = new Pulse({ auto: true });
  receiptApp.get('/receipt', async (ctx) => {
    try { await ctx.emit('receipt.invalid', { schema: null }); }
    catch (error) { receiptCode = error.code; }
    return ctx.text('contained');
  });
  const receiptResponse = await runtimeHost.executeApplication(receiptApp, new Request('https://example.test/receipt'), {
    capabilities: { emit() { return { receipt: 'forbidden' }; } }
  });
  assert.equal(receiptResponse.status, 200);
  assert.equal(receiptCode, 'PULSE_RUNTIME_EVENT_EMIT_ACCEPTANCE_INVALID');

  const overflowApp = new Pulse({ auto: true });
  overflowApp.on('overflow', { schema: null }, async (ctx) => {
    await ctx.emit('first', { schema: null });
    await ctx.emit('second', { schema: null });
  });
  const overflowAdapter = runtimeHost.createEventRecordingAdapter({ maxQueueDepth: 1 });
  const overflowResult = await runtimeHost.executeEvent(overflowApp, inbound('overflow'), { effectAdapter: overflowAdapter });
  assert.equal(overflowResult.status, 'failed');
  assert.equal(overflowResult.error.category, 'handler-failed');
  assert.deepEqual(overflowAdapter.acceptedFrames(), [{ version: FRAME_VERSION, type: 'first', schemaId: null }]);

  const limitAdapter = runtimeHost.createEventRecordingAdapter({ maxQueueDepth: 4 });
  const limitResult = await runtimeHost.executeEvent(overflowApp, inbound('overflow'), {
    effectAdapter: limitAdapter,
    maxEffects: 1
  });
  assert.equal(limitResult.status, 'failed');
  assert.equal(limitResult.error.category, 'handler-failed');
  assert.deepEqual(limitAdapter.acceptedFrames(), [{ version: FRAME_VERSION, type: 'first', schemaId: null }]);

  const cancellationApp = new Pulse({ auto: true });
  let adapterStarted = false;
  cancellationApp.on('cancel.emit', { schema: null }, async (ctx) => {
    await ctx.emit('pending.outbound', { schema: null });
  });
  const controller = new AbortController();
  const cancelled = runtimeHost.executeEvent(cancellationApp, inbound('cancel.emit'), {
    signal: controller.signal,
    effectAdapter: {
      id: 'events.cancel-emit',
      dispatch(_effect, execution) {
        adapterStarted = true;
        return new Promise((_resolve, reject) => {
          execution.signal.addEventListener('abort', () => reject(execution.signal.reason), { once: true });
        });
      }
    }
  });
  await waitFor(() => adapterStarted, 'event adapter dispatch');
  controller.abort(new Error('cancel outbound event-secret'));
  const cancelledResult = await cancelled;
  assert.equal(cancelledResult.status, 'failed');
  assert.equal(cancelledResult.error.category, 'cancelled');
  assert.doesNotMatch(JSON.stringify(cancelledResult), /event-secret/);

  const proof = Object.freeze({
    version: 'pulse.events-emit-javascript-proof.v1',
    runtimeHostVersion: runtimeHost.RUNTIME_HOST_API_VERSION,
    eventAdapterVersion: runtimeHost.EVENT_ADAPTER_VERSION,
    httpAcceptedFrames: httpAdapter.acceptedFrames().length,
    eventAcceptedFrames: eventAdapter.acceptedFrames().length,
    parallelEligible: true,
    schemaBeforeDispatch: true,
    detachedFrames: true,
    effectLimitContained: true,
    queueBounded: true,
    cancellationContained: true,
    observationsRedacted: true,
    automaticLoopback: false,
    deliveryReceiptReturned: false,
    nativeSupportChanged: false,
    providerSupportChanged: false,
    callReserved: false
  });
  console.log(JSON.stringify(proof, null, 2));
  console.log('ok - ctx.emit is schema-bound, parallel-eligible, bounded, redacted, cancellation-owned, and strictly one-way in JavaScript');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
