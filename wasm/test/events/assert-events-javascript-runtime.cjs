#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { Pulse } = require(path.join(repoRoot, 'packages/pulse/src/index.js'));
const runtimeHost = require(path.join(repoRoot, 'packages/runtime/src/host.js'));
const runtimeEvents = require(path.join(repoRoot, 'packages/runtime/src/internal/event-execution.js'));
const eventContracts = require(path.join(repoRoot, 'wasm/packages/contracts/src/events/contracts.js'));

const FRAME_VERSION = 'pulse.event-frame.v1';
const RESULT_VERSION = 'pulse.event-execution-result.v1';

function schemaFailure(message, detail) {
  const error = new runtimeHost.PulseRuntimeContractError('PULSE_SCHEMA_DECODE', message);
  if (detail !== undefined) Object.defineProperty(error, 'detail', { enumerable: false, value: detail });
  return error;
}

const schemaCodecs = Object.freeze({
  registry: Object.freeze({ maxBytes: 65_536 }),
  ids: Object.freeze(['events.DeviceButton']),
  has(schemaId) { return schemaId === 'events.DeviceButton'; },
  decode(schemaId, value) {
    if (schemaId !== 'events.DeviceButton') throw schemaFailure('unknown schema');
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.enabled !== 'boolean'
      || !Number.isSafeInteger(value.sequence)) {
      throw schemaFailure('invalid device payload', { token: 'must-never-cross' });
    }
    return {
      enabled: value.enabled,
      sequence: value.sequence,
      nested: value.nested === undefined ? null : value.nested
    };
  }
});

function frame(type, schemaId, payload) {
  return schemaId === null
    ? { version: FRAME_VERSION, type, schemaId }
    : { version: FRAME_VERSION, type, schemaId, payload };
}

function assertCompleted(result) {
  assert.deepEqual(result, { version: RESULT_VERSION, status: 'completed' });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(eventContracts.normalizeEventExecutionResult(result), result);
}

function assertFailure(result, category, code) {
  assert.equal(result.version, RESULT_VERSION);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.category, category);
  if (code !== undefined) assert.equal(result.error.code, code);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
  assert.equal(result.error instanceof Error, false);
  assert.deepEqual(eventContracts.normalizeEventExecutionResult(result), result);
}

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function main() {
  assert.equal(runtimeHost.RUNTIME_HOST_API_VERSION, 'pulse.runtime-host.v3');

  const app = new Pulse({ auto: true });
  const handlerObservations = [];
  const hostExecutions = [];
  const effectSummaries = [];
  const logEvents = [];
  let eventCalls = 0;
  let tickCalls = 0;

  app.on('device.button', { schema: 'events.DeviceButton' }, async (ctx) => {
    eventCalls += 1;
    assert.equal(Object.isFrozen(ctx), true);
    assert.deepEqual(Object.keys(ctx), ['state', 'log', 'fetch', 'parallel', 'config', 'secret', 'kv', 'emit', 'event']);
    for (const httpField of ['req', 'param', 'json', 'text', 'response', 'next']) {
      assert.equal(Object.prototype.hasOwnProperty.call(ctx, httpField), false, `event context must not expose ${httpField}`);
    }
    assert.equal(Object.isFrozen(ctx.event), true);
    assert.equal(Object.isFrozen(ctx.event.payload), true);
    const before = ctx.state.get('seen');
    ctx.state.set('seen', String(ctx.event.payload.sequence));
    const bindings = await ctx.parallel({
      mode: ctx.config.get('MODE'),
      token: ctx.secret.get('TOKEN')
    });
    ctx.log.info(`device:${ctx.event.payload.sequence}`);
    handlerObservations.push(Object.freeze({
      before,
      type: ctx.event.type,
      payload: ctx.event.payload,
      mode: bindings.mode,
      token: bindings.token
    }));
  });
  app.on('system.tick', { schema: null }, async (ctx) => {
    tickCalls += 1;
    assert.equal(ctx.event.type, 'system.tick');
    assert.equal(ctx.event.payload, null);
  });
  app.get('/health', async (ctx) => ctx.text('ok'));

  const inputPayload = { sequence: 7, enabled: true, nested: { label: 'original' } };
  const execute = runtimeHost.executeEvent(app, frame('device.button', 'events.DeviceButton', inputPayload), {
    schemaCodecs,
    reporting: 'info',
    capabilities: {
      config(name, execution) {
        hostExecutions.push(execution);
        return name === 'MODE' ? 'test' : undefined;
      },
      secret(name, execution) {
        hostExecutions.push(execution);
        return name === 'TOKEN' ? 'event-secret' : undefined;
      }
    },
    onEffectSummary(summary) { effectSummaries.push(summary); },
    onLogObservation(event) { logEvents.push(event); }
  });
  inputPayload.sequence = 999;
  inputPayload.nested.label = 'mutated';
  assertCompleted(await execute);
  assert.equal(eventCalls, 1);
  assert.deepEqual(handlerObservations[0], {
    before: undefined,
    type: 'device.button',
    payload: { enabled: true, nested: { label: 'original' }, sequence: 7 },
    mode: 'test',
    token: 'event-secret'
  });
  assert.ok(hostExecutions.length >= 2);
  assert.ok(hostExecutions.every((entry) => entry.kind === 'event'));
  assert.ok(hostExecutions.every((entry) => entry.request === undefined));
  assert.ok(hostExecutions.every((entry) => entry.event.type === 'device.button' && Object.isFrozen(entry.event)));
  assert.deepEqual(effectSummaries[0], {
    ...effectSummaries[0],
    effectCount: 2,
    parallelCount: 1,
    redactedSecretCount: 1,
    closed: true
  });
  assert.ok(logEvents.some((entry) => entry.type === 'logging-config'));
  assert.ok(logEvents.some((entry) => entry.type === 'log' && entry.message === 'device:7'));

  assertCompleted(await runtimeHost.executeEvent(app, frame('device.button', 'events.DeviceButton', {
    enabled: false,
    sequence: 8
  }), {
    schemaCodecs,
    capabilities: { config: () => 'test', secret: () => 'second-secret' }
  }));
  assert.equal(handlerObservations[1].before, undefined, 'state must be empty for every event invocation');
  assertCompleted(await runtimeHost.executeEvent(app, frame('system.tick', null), { schemaCodecs }));
  assert.equal(tickCalls, 1);

  const httpResponse = await runtimeHost.executeApplication(app, new Request('https://example.test/health'));
  assert.equal(httpResponse.status, 200);
  assert.equal(await httpResponse.text(), 'ok');
  assert.equal(eventCalls, 2, 'HTTP dispatch must not execute event handlers');
  assert.equal(tickCalls, 1);

  const callsBeforeRejections = eventCalls;
  assertFailure(
    await runtimeHost.executeEvent(app, frame('device.unknown', null), { schemaCodecs }),
    'handler-not-found',
    'PULSE_RUNTIME_EVENT_HANDLER_NOT_FOUND'
  );
  assertFailure(
    await runtimeHost.executeEvent(app, frame('device.button', null), { schemaCodecs }),
    'schema-mismatch',
    'PULSE_RUNTIME_EVENT_SCHEMA_MISMATCH'
  );
  assertFailure(
    await runtimeHost.executeEvent(app, frame('device.button', 'events.DeviceButton', { enabled: 'yes', sequence: 9 }), { schemaCodecs }),
    'schema-validation-failed',
    'PULSE_SCHEMA_DECODE'
  );
  const accessorFrame = { version: FRAME_VERSION, type: 'device.button', schemaId: 'events.DeviceButton' };
  let accessorCalls = 0;
  Object.defineProperty(accessorFrame, 'payload', { enumerable: true, get() { accessorCalls += 1; return {}; } });
  assertFailure(
    await runtimeHost.executeEvent(app, accessorFrame, { schemaCodecs }),
    'invalid-frame',
    'PULSE_RUNTIME_EVENT_FRAME_INVALID'
  );
  assert.equal(accessorCalls, 0);
  assert.equal(eventCalls, callsBeforeRejections, 'selection and schema failures must precede handler entry');

  const noCodec = await runtimeHost.executeEvent(app, frame('device.button', 'events.DeviceButton', { enabled: true, sequence: 1 }));
  assertFailure(noCodec, 'schema-validation-failed', 'PULSE_SCHEMA_CODECS_UNAVAILABLE');

  const completionApp = new Pulse({ auto: true });
  completionApp.on('completion.invalid', { schema: null }, async () => ({ status: 200 }));
  assertFailure(
    await runtimeHost.executeEvent(completionApp, frame('completion.invalid', null)),
    'completion-invalid',
    'PULSE_RUNTIME_EVENT_HANDLER_RESULT_INVALID'
  );
  const syncCompletionApp = new Pulse({ auto: true });
  syncCompletionApp.on('completion.sync', { schema: null }, () => undefined);
  assertFailure(
    await runtimeHost.executeEvent(syncCompletionApp, frame('completion.sync', null)),
    'completion-invalid',
    'PULSE_RUNTIME_EVENT_HANDLER_ASYNC_REQUIRED'
  );

  const secretApp = new Pulse({ auto: true });
  let eventErrorMiddlewareCalls = 0;
  secretApp.error(async (_error, ctx) => {
    eventErrorMiddlewareCalls += 1;
    return ctx.text('must-not-run');
  });
  secretApp.on('secret.failure', { schema: null }, async (ctx) => {
    const secret = await ctx.secret.get('TOKEN');
    throw new Error(`handler exposed ${secret}`);
  });
  let secretDisposeCount = 0;
  let secretSummary;
  const secretResult = await runtimeHost.executeEvent(secretApp, frame('secret.failure', null), {
    effectAdapter: {
      id: 'events.secret-redaction',
      dispatch(effect, execution) {
        assert.equal(execution.kind, 'event');
        return effect.kind === 'secret.get' ? 'handler-secret-value' : undefined;
      },
      dispose() { secretDisposeCount += 1; }
    },
    onEffectSummary(summary) { secretSummary = summary; }
  });
  assertFailure(secretResult, 'handler-failed', 'PULSE_RUNTIME_UNHANDLED_ERROR');
  assert.equal(secretDisposeCount, 1);
  assert.equal(eventErrorMiddlewareCalls, 0, 'Router error middleware must not observe event failures');
  assert.equal(secretSummary.closed, true);
  assert.equal(secretSummary.redactedSecretCount, 1);
  assert.doesNotMatch(JSON.stringify(secretResult), /handler-secret-value/);
  assert.match(JSON.stringify(secretResult), /unexpected event handler/);

  const cancellationApp = new Pulse({ auto: true });
  cancellationApp.on('cancel.wait', { schema: null }, async (ctx) => {
    await ctx.fetch('https://origin.test/wait');
  });
  const controller = new AbortController();
  let adapterStarted = false;
  let cancellationDisposeCount = 0;
  const cancelled = runtimeHost.executeEvent(cancellationApp, frame('cancel.wait', null), {
    signal: controller.signal,
    effectAdapter: {
      id: 'events.cancellation',
      dispatch(_effect, execution) {
        adapterStarted = true;
        return new Promise((_resolve, reject) => {
          execution.signal.addEventListener('abort', () => reject(execution.signal.reason), { once: true });
        });
      },
      dispose() { cancellationDisposeCount += 1; }
    }
  });
  await waitUntil(() => adapterStarted, 'event effect adapter start');
  controller.abort(new Error('cancel event now'));
  assertFailure(await cancelled, 'cancelled', 'PULSE_RUNTIME_EVENT_CANCELLED');
  assert.equal(cancellationDisposeCount, 1);

  const pendingApp = new Pulse({ auto: true });
  pendingApp.on('pending.effect', { schema: null }, async (ctx) => {
    ctx.config.get('MODE');
  });
  const pendingResult = await runtimeHost.executeEvent(pendingApp, frame('pending.effect', null), {
    effectAdapter: {
      dispatch(_effect, execution) {
        return new Promise((_resolve, reject) => {
          execution.signal.addEventListener('abort', () => reject(execution.signal.reason), { once: true });
        });
      }
    }
  });
  assertFailure(pendingResult, 'handler-failed', 'PULSE_RUNTIME_UNHANDLED_ERROR');

  const disposalApp = new Pulse({ auto: true });
  disposalApp.on('dispose.failure', { schema: null }, async () => undefined);
  const disposalResult = await runtimeHost.executeEvent(disposalApp, frame('dispose.failure', null), {
    effectAdapter: {
      dispatch() { return undefined; },
      dispose() { throw new Error('dispose exposed disposal-secret'); }
    },
    redactionValues: ['disposal-secret']
  });
  assertFailure(disposalResult, 'disposal-failed');
  assert.doesNotMatch(JSON.stringify(disposalResult), /disposal-secret/);

  const latch = runtimeEvents.createEventCompletion();
  assertCompleted(latch.complete());
  assert.throws(() => latch.complete(), { code: 'PULSE_RUNTIME_EVENT_COMPLETION_DUPLICATE' });
  assert.throws(() => latch.fail('internal', new Error('late')), { code: 'PULSE_RUNTIME_EVENT_COMPLETION_DUPLICATE' });

  const normalizedFrame = runtimeEvents.normalizeEventFrame(frame('device.button', 'events.DeviceButton', {
    enabled: true,
    sequence: 11
  }));
  assert.deepEqual(normalizedFrame, eventContracts.normalizeEventFrame(frame('device.button', 'events.DeviceButton', {
    enabled: true,
    sequence: 11
  })));
  assert.equal(Object.isFrozen(normalizedFrame.payload), true);

  const proof = Object.freeze({
    version: 'pulse.events-javascript-runtime-proof.v1',
    eventResultVersion: RESULT_VERSION,
    runtimeHostVersion: runtimeHost.RUNTIME_HOST_API_VERSION,
    completedExecutions: 3,
    handlerCalls: eventCalls + tickCalls,
    exactSelection: true,
    schemaBeforeHandler: true,
    httpRegression: true,
    stateIsolation: true,
    cancellationContained: true,
    redactionContained: true,
    disposalContained: true,
    duplicateCompletionRejected: true,
    requestObjectsSynthesized: false,
    eventEmitPublished: true,
    providerSupportChanged: false,
    nativeSupportChanged: false
  });
  console.log(JSON.stringify(proof, null, 2));
  console.log('ok - direct JavaScript event execution is schema-bound, exactly selected, isolated, redacted, cancellable, and non-HTTP');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
