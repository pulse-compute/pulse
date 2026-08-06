#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Pulse } = require('../../../packages/pulse/src/index.js');
const eventContracts = require('../../packages/contracts/src/events/contracts.js');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const {
  CanonicalProjectCompileError,
  compileCanonicalProject
} = require('../../packages/compiler/src/canonical-project-compiler.js');
const { CanonicalRouterCompileError } = require('../../packages/compiler/src/canonical-router-compiler.js');
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

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const corpusFile = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'conformance', 'event-conformance-corpus.json');
const FRAME_VERSION = eventContracts.EVENT_FRAME_VERSION;
const RESULT_VERSION = eventContracts.EVENT_EXECUTION_RESULT_VERSION;
const REDACTION_SENTINEL = 'event-redaction-secret-ev8';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function readCorpus() {
  const source = fs.readFileSync(corpusFile, 'utf8');
  const corpus = deepFreeze(JSON.parse(source));
  assert.equal(corpus.version, 'pulse.event-conformance-corpus.v1');
  assert.equal(corpus.contractVersion, eventContracts.EVENT_CONTRACT_VERSION);
  assert.deepEqual(corpus.targets, ['node-javascript', 'node-native']);
  assert.deepEqual(corpus.limits, {
    maxTypeBytes: eventContracts.EVENT_DEFAULT_LIMITS.maxTypeBytes,
    maxPayloadBytes: eventContracts.EVENT_DEFAULT_LIMITS.maxPayloadBytes,
    maxQueueDepth: 1,
    maxEffects: 1
  });
  assert.ok(Array.isArray(corpus.cases) && corpus.cases.length === 19);
  assert.ok(Array.isArray(corpus.boundaryCases) && corpus.boundaryCases.length === 2);
  const ids = [...corpus.cases, ...corpus.boundaryCases].map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'event corpus case IDs must be unique');
  for (const entry of [...corpus.cases, ...corpus.boundaryCases]) {
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(Object.isFrozen(entry), true);
  }
  return Object.freeze({ corpus, source, hash: sha256(source) });
}

function write(root, relative, source) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

function projectMetadata() {
  return {
    selectedProfile: { name: 'test', source: 'events-conformance' },
    strict: true,
    target: 'native',
    host: 'node',
    projectHash: '7'.repeat(64),
    configPlanHash: '8'.repeat(64),
    bindings: { config: [], secret: [] },
    fragments: {}
  };
}

function writeNativeApplication(root) {
  write(root, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  write(root, 'src/pulse/schemas/models.ts', `
export interface Payload {
  label: string
  sequence: number
}

export interface SecretPayload {
  token: string
}

export interface StatePayload {
  previous: string
}
`);
  const schemaFile = write(root, 'src/pulse/schemas/index.ts', `
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { Payload, SecretPayload, StatePayload } from './models.js'

export default defineSchemaRegistry({
  schemas: {
    'events.Payload': schema<Payload>(),
    'events.Secret': schema<SecretPayload>(),
    'events.State': schema<StatePayload>(),
  },
})
`);
  const extracted = extractSchemaRegistry(schemaFile, { projectRoot: root });
  write(root, 'src/handlers.ts', `
export async function schemaInput(ctx) {
  ctx.state.set('schema', 'accepted')
}

export async function noPayloadInput(ctx) {
  ctx.state.set('complete', 'yes')
}

export async function detachInput(ctx) {
  await ctx.emit('output.detached', {
    schema: 'events.Payload',
    payload: { label: ctx.event.payload.label, sequence: ctx.event.payload.sequence },
  })
}

export async function emitAccept(ctx) {
  await ctx.emit('output.one', { schema: null })
}

export async function emitReject(ctx) {
  await ctx.emit('output.rejected', { schema: null })
}

export async function parallelEmit(ctx) {
  const accepted = await ctx.parallel({
    first: ctx.emit('output.one', { schema: null }),
    second: ctx.emit('output.two', { schema: null }),
  })
  void accepted
}

export async function limitEmit(ctx) {
  await ctx.emit('output.one', { schema: null })
  await ctx.emit('output.two', { schema: null })
}

export async function fifoOne(ctx) {
  await ctx.emit('fifo.output.one', { schema: null })
}

export async function fifoTwo(ctx) {
  await ctx.emit('fifo.output.two', { schema: null })
}

export async function cancelEmit(ctx) {
  await ctx.emit('cancel.pending', { schema: null })
}

export async function secretEmit(ctx) {
  const token = await ctx.secret.get('TOKEN')
  await ctx.emit('secret.output', { schema: 'events.Secret', payload: { token } })
}

export async function unexpectedEffect(ctx) {
  await ctx.config.get('FAIL')
}

export async function stateCheck(ctx) {
  const previous = ctx.state.get('seen') ?? 'empty'
  ctx.state.set('seen', 'set')
  await ctx.emit('state.result', { schema: 'events.State', payload: { previous } })
}

export async function completionInput(ctx) {
  ctx.state.set('completed', 'yes')
}

export async function loopStart(ctx) {
  await ctx.emit('loop.output', { schema: null })
}

export async function loopOutput(ctx) {
  await ctx.emit('loop.invoked', { schema: null })
}
`);
  const entry = write(root, 'src/index.ts', `
import { Pulse } from '@pulse-compute/pulse'
import {
  schemaInput,
  noPayloadInput,
  detachInput,
  emitAccept,
  emitReject,
  parallelEmit,
  limitEmit,
  fifoOne,
  fifoTwo,
  cancelEmit,
  secretEmit,
  unexpectedEffect,
  stateCheck,
  completionInput,
  loopStart,
  loopOutput,
} from './handlers.js'

const app = new Pulse({ auto: true })
app.on('schema.input', { schema: 'events.Payload' }, schemaInput)
app.on('no-payload.input', { schema: null }, noPayloadInput)
app.on('detach.input', { schema: 'events.Payload' }, detachInput)
app.on('emit.accept', { schema: null }, emitAccept)
app.on('emit.reject', { schema: null }, emitReject)
app.on('parallel.emit', { schema: null }, parallelEmit)
app.on('limit.emit', { schema: null }, limitEmit)
app.on('fifo.one', { schema: null }, fifoOne)
app.on('fifo.two', { schema: null }, fifoTwo)
app.on('cancel.emit', { schema: null }, cancelEmit)
app.on('secret.emit', { schema: null }, secretEmit)
app.on('unexpected.effect', { schema: null }, unexpectedEffect)
app.on('state.check', { schema: null }, stateCheck)
app.on('completion.input', { schema: null }, completionInput)
app.on('loop.start', { schema: null }, loopStart)
app.on('loop.output', { schema: null }, loopOutput)
export default app
`);
  return Object.freeze({
    entry,
    schemas: {
      registry: extracted.registry,
      dependencies: extracted.dependencies,
      codecInputs: extracted.codecInputs
    }
  });
}

function compileNativeApplication(root) {
  const project = writeNativeApplication(root);
  const compiled = compileCanonicalProject(project.entry, {
    rootDir: root,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(root, 'tsconfig.json'),
    applicationProjectMetadata: projectMetadata(),
    schemas: project.schemas,
    strict: true,
    requireAsync: true,
    requireEffectAwait: true
  });
  const plan = buildCanonicalNativePlan(compiled);
  return Object.freeze({
    compiled: compileCanonicalNativePlan(plan, { cwd: repoRoot, timeoutMs: 180000 }),
    project: compiled,
    plan
  });
}

function codecFailure(message) {
  const error = new Error(message);
  error.code = 'PULSE_SCHEMA_DECODE';
  return error;
}

const javascriptSchemaCodecs = Object.freeze({
  registry: Object.freeze({ maxBytes: eventContracts.EVENT_DEFAULT_LIMITS.maxPayloadBytes }),
  ids: Object.freeze(['events.Payload', 'events.Secret', 'events.State']),
  has(schemaId) { return this.ids.includes(schemaId); },
  decode(schemaId, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw codecFailure(`invalid ${schemaId}`);
    if (schemaId === 'events.Payload') {
      if (typeof value.label !== 'string' || !Number.isSafeInteger(value.sequence)) throw codecFailure('invalid events.Payload');
      return { label: value.label, sequence: value.sequence };
    }
    if (schemaId === 'events.Secret') {
      if (typeof value.token !== 'string') throw codecFailure('invalid events.Secret');
      return { token: value.token };
    }
    if (schemaId === 'events.State') {
      if (typeof value.previous !== 'string') throw codecFailure('invalid events.State');
      return { previous: value.previous };
    }
    throw codecFailure(`unknown schema ${schemaId}`);
  }
});

function createJavascriptApplication() {
  const app = new Pulse({ auto: true });
  app.on('schema.input', { schema: 'events.Payload' }, async (ctx) => {
    ctx.state.set('schema', 'accepted');
  });
  app.on('no-payload.input', { schema: null }, async (ctx) => {
    ctx.state.set('complete', 'yes');
  });
  app.on('detach.input', { schema: 'events.Payload' }, async (ctx) => {
    await ctx.emit('output.detached', {
      schema: 'events.Payload',
      payload: { label: ctx.event.payload.label, sequence: ctx.event.payload.sequence }
    });
  });
  app.on('emit.accept', { schema: null }, async (ctx) => {
    await ctx.emit('output.one', { schema: null });
  });
  app.on('emit.reject', { schema: null }, async (ctx) => {
    await ctx.emit('output.rejected', { schema: null });
  });
  app.on('parallel.emit', { schema: null }, async (ctx) => {
    const accepted = await ctx.parallel({
      first: ctx.emit('output.one', { schema: null }),
      second: ctx.emit('output.two', { schema: null })
    });
    void accepted;
  });
  app.on('limit.emit', { schema: null }, async (ctx) => {
    await ctx.emit('output.one', { schema: null });
    await ctx.emit('output.two', { schema: null });
  });
  app.on('fifo.one', { schema: null }, async (ctx) => {
    await ctx.emit('fifo.output.one', { schema: null });
  });
  app.on('fifo.two', { schema: null }, async (ctx) => {
    await ctx.emit('fifo.output.two', { schema: null });
  });
  app.on('cancel.emit', { schema: null }, async (ctx) => {
    await ctx.emit('cancel.pending', { schema: null });
  });
  app.on('secret.emit', { schema: null }, async (ctx) => {
    const token = await ctx.secret.get('TOKEN');
    await ctx.emit('secret.output', { schema: 'events.Secret', payload: { token } });
  });
  app.on('unexpected.effect', { schema: null }, async (ctx) => {
    await ctx.config.get('FAIL');
  });
  app.on('state.check', { schema: null }, async (ctx) => {
    const previous = ctx.state.get('seen') ?? 'empty';
    ctx.state.set('seen', 'set');
    await ctx.emit('state.result', { schema: 'events.State', payload: { previous } });
  });
  app.on('completion.input', { schema: null }, async (ctx) => {
    ctx.state.set('completed', 'yes');
  });
  app.on('loop.start', { schema: null }, async (ctx) => {
    await ctx.emit('loop.output', { schema: null });
  });
  app.on('loop.output', { schema: null }, async (ctx) => {
    await ctx.emit('loop.invoked', { schema: null });
  });
  return app;
}

function frame(type, schemaId = null, payload) {
  return schemaId === null
    ? { version: FRAME_VERSION, type, schemaId }
    : { version: FRAME_VERSION, type, schemaId, payload };
}

function targetRuntimes(javascript, native) {
  return Object.freeze({
    'node-javascript': Object.freeze({
      application: javascript,
      execute(input, options = {}) {
        return executeNodeJavascriptEvent(javascript, input, {
          schemaCodecs: javascriptSchemaCodecs,
          ...options
        });
      }
    }),
    'node-native': Object.freeze({
      application: native.compiled,
      execute(input, options = {}) {
        return executeNodeNativeEvent(native.compiled, input, options);
      }
    })
  });
}

function assertResult(result, expected, label) {
  assert.equal(result.version, RESULT_VERSION, `${label}: result version`);
  assert.equal(result.status, expected.status, `${label}: status`);
  if (expected.category !== undefined) assert.equal(result.error && result.error.category, expected.category, `${label}: category`);
  if (result.status === 'completed') {
    assert.deepEqual(Object.keys(result), ['version', 'status'], `${label}: completion must not carry response metadata`);
  } else {
    assert.equal(Object.isFrozen(result.error), true, `${label}: failure must be immutable`);
  }
  assert.equal(Object.isFrozen(result), true, `${label}: result must be immutable`);
}

function projection(result, emittedFrames) {
  return Object.freeze({
    status: result.status,
    ...(result.status === 'failed' ? { category: result.error.category } : {}),
    emittedFrames: Object.freeze(emittedFrames.map((entry) => eventContracts.normalizeEventFrame(entry)))
  });
}

function assertExpectedEmissionTypes(emittedFrames, expected, label) {
  assert.deepEqual(emittedFrames.map((entry) => entry.type), expected.emittedTypes, `${label}: emitted type order`);
  assert.ok(emittedFrames.every((entry) => Object.isFrozen(entry)), `${label}: emitted frames must be immutable`);
}

function waitFor(promise, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 10000);
    })
  ]).finally(() => clearTimeout(timeout));
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function executeOrdinary(target, testCase) {
  const adapter = createNodeEventReferenceAdapter({ id: `${target.id}-${testCase.id}`, maxQueueDepth: 16 });
  const result = await target.runtime.execute(testCase.frame, { eventAdapter: adapter });
  assertResult(result, testCase.expect, `${target.id}/${testCase.id}`);
  const emittedFrames = adapter.acceptedFrames();
  assertExpectedEmissionTypes(emittedFrames, testCase.expect, `${target.id}/${testCase.id}`);
  return projection(result, emittedFrames);
}

async function executeOversizeType(target, testCase, limits) {
  const adapter = createNodeEventReferenceAdapter({ id: `${target.id}-${testCase.id}`, maxQueueDepth: 1 });
  const result = await target.runtime.execute(frame('x'.repeat(limits.maxTypeBytes + 1)), { eventAdapter: adapter });
  assertResult(result, testCase.expect, `${target.id}/${testCase.id}`);
  assertExpectedEmissionTypes(adapter.acceptedFrames(), testCase.expect, `${target.id}/${testCase.id}`);
  return projection(result, adapter.acceptedFrames());
}

async function executeOversizePayload(target, testCase, limits) {
  const adapter = createNodeEventReferenceAdapter({ id: `${target.id}-${testCase.id}`, maxQueueDepth: 1 });
  const result = await target.runtime.execute(frame('schema.input', 'events.Payload', {
    label: 'x'.repeat(limits.maxPayloadBytes),
    sequence: 1
  }), { eventAdapter: adapter });
  assertResult(result, testCase.expect, `${target.id}/${testCase.id}`);
  assertExpectedEmissionTypes(adapter.acceptedFrames(), testCase.expect, `${target.id}/${testCase.id}`);
  return projection(result, adapter.acceptedFrames());
}

async function executeImmutableDetachment(target, testCase) {
  const payload = { label: 'original', sequence: 7 };
  const input = frame('detach.input', 'events.Payload', payload);
  let captured;
  let release;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const adapter = Object.freeze({
    acceptOutbound(output) {
      captured = output;
      started();
      return gate;
    }
  });
  const pending = target.runtime.execute(input, { eventAdapter: adapter });
  await waitFor(startedPromise, `${target.id} immutable emission`);
  payload.label = 'mutated';
  payload.sequence = 999;
  release();
  const result = await pending;
  assertResult(result, testCase.expect, `${target.id}/${testCase.id}`);
  assert.deepEqual(captured, frame('output.detached', 'events.Payload', { label: 'original', sequence: 7 }));
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(Object.isFrozen(captured.payload), true);
  assertExpectedEmissionTypes([captured], testCase.expect, `${target.id}/${testCase.id}`);
  return projection(result, [captured]);
}

async function executeEmitRejection(target, testCase) {
  let calls = 0;
  const result = await target.runtime.execute(frame('emit.reject'), {
    eventAdapter: Object.freeze({
      acceptOutbound() {
        calls += 1;
        throw codedError('PULSE_TEST_EVENT_REJECTED', 'event acceptance rejected');
      }
    })
  });
  assert.equal(calls, 1);
  assertResult(result, testCase.expect, `${target.id}/${testCase.id}`);
  assertExpectedEmissionTypes([], testCase.expect, `${target.id}/${testCase.id}`);
  return projection(result, []);
}

async function executeEffectLimit(target, testCase, limits) {
  const adapter = createNodeEventReferenceAdapter({ id: `${target.id}-${testCase.id}`, maxQueueDepth: 4 });
  const result = await target.runtime.execute(frame('limit.emit'), {
    eventAdapter: adapter,
    maxEffects: limits.maxEffects
  });
  assertResult(result, testCase.expect, `${target.id}/${testCase.id}`);
  assertExpectedEmissionTypes(adapter.acceptedFrames(), testCase.expect, `${target.id}/${testCase.id}`);
  return projection(result, adapter.acceptedFrames());
}

async function executeFifo(target, testCase) {
  const adapter = createNodeEventReferenceAdapter({ id: `${target.id}-${testCase.id}`, maxQueueDepth: 4 });
  for (const type of testCase.expect.ingressTypes) adapter.enqueue(frame(type));
  const outcomes = await adapter.drain((input, execution) => target.runtime.execute(input, {
    eventAdapter: adapter,
    signal: execution.signal
  }));
  assert.deepEqual(outcomes.map((entry) => entry.frame.type), testCase.expect.ingressTypes);
  assert.ok(outcomes.every((entry) => entry.result.status === testCase.expect.status));
  assertExpectedEmissionTypes(adapter.acceptedFrames(), testCase.expect, `${target.id}/${testCase.id}`);
  assert.equal(adapter.summary().maximumActiveInvocations, testCase.expect.maximumActiveInvocations);
  return Object.freeze({
    status: testCase.expect.status,
    ingressTypes: Object.freeze(outcomes.map((entry) => entry.frame.type)),
    emittedFrames: adapter.acceptedFrames(),
    maximumActiveInvocations: adapter.summary().maximumActiveInvocations
  });
}

async function executeQueueOverflow(target, testCase, limits) {
  const adapter = createNodeEventReferenceAdapter({ id: `${target.id}-${testCase.id}`, maxQueueDepth: limits.maxQueueDepth });
  adapter.enqueue(frame('fifo.one'));
  assert.throws(
    () => adapter.enqueue(frame('fifo.two')),
    (error) => error && error.code === testCase.expect.code
  );
  assert.equal(adapter.summary().enqueued, testCase.expect.acceptedIngress);
  assert.equal(adapter.summary().pending, testCase.expect.acceptedIngress);
  return Object.freeze({ code: testCase.expect.code, acceptedIngress: adapter.summary().enqueued });
}

async function executeCancellation(target, testCase) {
  const controller = new AbortController();
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const pending = target.runtime.execute(frame('cancel.emit'), {
    signal: controller.signal,
    eventAdapter: Object.freeze({
      acceptOutbound(_output, execution) {
        started();
        return new Promise((_resolve, reject) => {
          const abort = () => reject(execution.signal.reason || new Error('cancelled'));
          if (execution.signal.aborted) abort();
          else execution.signal.addEventListener('abort', abort, { once: true });
        });
      }
    })
  });
  await waitFor(startedPromise, `${target.id} cancellation dispatch`);
  controller.abort(new Error('cancel event conformance'));
  const result = await pending;
  assertResult(result, testCase.expect, `${target.id}/${testCase.id}`);
  assertExpectedEmissionTypes([], testCase.expect, `${target.id}/${testCase.id}`);
  return projection(result, []);
}

async function executeRedaction(target, testCase) {
  const result = await target.runtime.execute(frame('secret.emit'), {
    secrets: { TOKEN: REDACTION_SENTINEL },
    redactionValues: [REDACTION_SENTINEL],
    eventAdapter: Object.freeze({
      acceptOutbound(output) {
        throw codedError('PULSE_TEST_EVENT_REDACTION', `adapter exposed ${output.payload.token}`);
      }
    })
  });
  assertResult(result, testCase.expect, `${target.id}/${testCase.id}`);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(REDACTION_SENTINEL));
  assertExpectedEmissionTypes([], testCase.expect, `${target.id}/${testCase.id}`);
  return projection(result, []);
}

async function executeUnexpectedFailure(target, testCase) {
  const failure = () => {
    throw codedError('PULSE_TEST_EVENT_UNEXPECTED', 'unexpected event effect failure');
  };
  const options = target.id === 'node-javascript'
    ? { capabilities: Object.freeze({ config: failure }) }
    : {
        providerAdapter: Object.freeze({
          id: 'events-conformance-unexpected',
          version: 'pulse.events-conformance-provider-adapter.v1',
          dispatchEffect: failure,
          disposeExecution() {}
        })
      };
  const result = await target.runtime.execute(frame('unexpected.effect'), options);
  assertResult(result, testCase.expect, `${target.id}/${testCase.id}`);
  assertExpectedEmissionTypes([], testCase.expect, `${target.id}/${testCase.id}`);
  return projection(result, []);
}

async function executeStateIsolation(target, testCase) {
  const adapter = createNodeEventReferenceAdapter({ id: `${target.id}-${testCase.id}`, maxQueueDepth: 4 });
  const first = await target.runtime.execute(frame('state.check'), { eventAdapter: adapter });
  const second = await target.runtime.execute(frame('state.check'), { eventAdapter: adapter });
  assertResult(first, testCase.expect, `${target.id}/${testCase.id}/first`);
  assertResult(second, testCase.expect, `${target.id}/${testCase.id}/second`);
  const emitted = adapter.acceptedFrames();
  assertExpectedEmissionTypes(emitted, testCase.expect, `${target.id}/${testCase.id}`);
  assert.deepEqual(emitted.map((entry) => entry.payload.previous), testCase.expect.previousValues);
  return Object.freeze({ status: 'completed', emittedFrames: emitted });
}

async function executeNoLoopback(target, testCase) {
  const adapter = createNodeEventReferenceAdapter({ id: `${target.id}-${testCase.id}`, maxQueueDepth: 4 });
  const result = await target.runtime.execute(frame('loop.start'), { eventAdapter: adapter });
  assertResult(result, testCase.expect, `${target.id}/${testCase.id}`);
  assertExpectedEmissionTypes(adapter.acceptedFrames(), testCase.expect, `${target.id}/${testCase.id}`);
  assert.deepEqual(adapter.pendingFrames(), []);
  assert.equal(adapter.acceptedFrames().some((entry) => entry.type === 'loop.invoked'), false);
  assert.equal(adapter.summary().automaticLoopback, testCase.expect.automaticLoopback);
  assert.equal(eventContracts.EVENT_ADAPTER_SEMANTICS.sameStackReentry, testCase.expect.sameStackReentry);
  return projection(result, adapter.acceptedFrames());
}

async function runCase(target, testCase, limits) {
  switch (testCase.scenario) {
    case 'execute': return executeOrdinary(target, testCase);
    case 'oversize-type': return executeOversizeType(target, testCase, limits);
    case 'oversize-payload': return executeOversizePayload(target, testCase, limits);
    case 'immutable-detachment': return executeImmutableDetachment(target, testCase);
    case 'emit-rejection': return executeEmitRejection(target, testCase);
    case 'effect-limit': return executeEffectLimit(target, testCase, limits);
    case 'fifo-ingress': return executeFifo(target, testCase);
    case 'queue-overflow': return executeQueueOverflow(target, testCase, limits);
    case 'cancellation': return executeCancellation(target, testCase);
    case 'redaction': return executeRedaction(target, testCase);
    case 'unexpected-failure': return executeUnexpectedFailure(target, testCase);
    case 'state-isolation': return executeStateIsolation(target, testCase);
    case 'no-loopback': return executeNoLoopback(target, testCase);
    default: throw new Error(`Unknown event conformance scenario ${testCase.scenario}.`);
  }
}

function assertDuplicateRegistration(root, boundaryCase) {
  const javascript = new Pulse({ auto: true });
  javascript.on('duplicate.input', { schema: null }, async () => undefined);
  assert.throws(
    () => javascript.on('duplicate.input', { schema: null }, async () => undefined),
    (error) => error && error.code === boundaryCase.expectedCode
  );

  write(root, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  write(root, 'src/handlers.ts', 'export async function handler(ctx) { ctx.state.set(\'seen\', \'yes\') }\n');
  const entry = write(root, 'src/index.ts', `
import { Pulse } from '@pulse-compute/pulse'
import { handler } from './handlers.js'
const app = new Pulse({ auto: true })
app.on('duplicate.input', { schema: null }, handler)
app.on('duplicate.input', { schema: null }, handler)
export default app
`);
  assert.throws(
    () => compileCanonicalProject(entry, {
      rootDir: root,
      workspaceRoot: repoRoot,
      tsconfigFile: path.join(root, 'tsconfig.json'),
      applicationProjectMetadata: projectMetadata(),
      strict: true,
      requireAsync: true,
      requireEffectAwait: true
    }),
    (error) => {
      assert.ok(error instanceof CanonicalProjectCompileError || error instanceof CanonicalRouterCompileError || Array.isArray(error && error.diagnostics));
      assert.ok((error.diagnostics || []).some((entry) => entry.code === boundaryCase.expectedCode));
      return true;
    }
  );
}

function assertNoCallSurface(native, boundaryCase) {
  assert.deepEqual(eventContracts.EVENT_CALL_DISPOSITION, {
    status: 'deferred',
    publicSurfaceReserved: false,
    compilerOpcodeReserved: false,
    runtimeCapabilityReserved: false,
    adapterOperationReserved: false,
    reevaluateAfter: ['a real browser Worker host exists', 'ordinary Entities lifecycle blockers are resolved']
  });
  const pulse = new Pulse({ auto: true });
  const adapter = createNodeEventReferenceAdapter({ id: 'events-conformance-surface' });
  for (const name of boundaryCase.forbiddenNames) {
    assert.equal(name in pulse, false, `Pulse must not expose event ${name}`);
    assert.equal(name in adapter, false, `Node event adapter must not expose ${name}`);
    assert.equal(native.plan.effects.some((entry) => entry.kind === `event.${name}`), false);
    assert.equal(native.compiled.inspection.imports.some((entry) => new RegExp(`(?:^|_)event_${name}(?:$|_)`).test(entry.name)), false);
    assert.equal(native.compiled.inspection.exports.some((entry) => new RegExp(`(?:^|_)event_${name}(?:$|_)`).test(entry.name)), false);
  }
  assert.equal(eventContracts.EVENT_ADAPTER_SEMANTICS.autoLoopback, false);
  assert.equal(eventContracts.EVENT_ADAPTER_SEMANTICS.sameStackReentry, false);
}

async function main() {
  const loaded = readCorpus();
  const tempRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-events-conformance-'));
  try {
    const javascript = createJavascriptApplication();
    const native = compileNativeApplication(path.join(tempRoot, 'native'));
    assert.equal(native.plan.events.catalog.events.length, 16);
    assert.deepEqual(native.compiled.inspection.imports.filter((entry) => /javascript|asyncify/i.test(`${entry.module}.${entry.name}`)), []);
    assert.deepEqual(native.compiled.inspection.imports.filter((entry) => String(entry.name).startsWith('pulse_event_')), []);

    const runtimes = targetRuntimes(javascript, native);
    const results = {};
    for (const targetId of loaded.corpus.targets) {
      const target = Object.freeze({ id: targetId, runtime: runtimes[targetId] });
      results[targetId] = {};
      for (const testCase of loaded.corpus.cases) {
        results[targetId][testCase.id] = await runCase(target, testCase, loaded.corpus.limits);
      }
    }

    for (const testCase of loaded.corpus.cases) {
      assert.deepEqual(
        results['node-native'][testCase.id],
        results['node-javascript'][testCase.id],
        `${testCase.id}: Node JavaScript and Node Native semantic projections must match exactly`
      );
    }

    const duplicate = loaded.corpus.boundaryCases.find((entry) => entry.id === 'duplicate-registration');
    const noCall = loaded.corpus.boundaryCases.find((entry) => entry.id === 'no-call-exec-invoke-surface');
    assertDuplicateRegistration(path.join(tempRoot, 'duplicate'), duplicate);
    assertNoCallSurface(native, noCall);

    console.log(JSON.stringify({
      version: loaded.corpus.version,
      corpusSha256: loaded.hash,
      targets: loaded.corpus.targets,
      crossTargetCases: loaded.corpus.cases.length,
      boundaryCases: loaded.corpus.boundaryCases.length,
      semanticEvaluations: loaded.corpus.cases.length * loaded.corpus.targets.length,
      exactSemanticParity: true,
      schemaBeforeHandler: true,
      fifoIngress: true,
      queueBounded: true,
      cancellationContained: true,
      redactionContained: true,
      stateIsolation: true,
      automaticLoopback: false,
      sameStackReentry: false,
      callExecInvokeSurface: false,
      nativeJavascriptImports: 0,
      automaticFallback: false
    }, null, 2));
    console.log('ok - canonical event corpus matches exactly across Node JavaScript and Native with bounded ingress, one-way emit, containment, and no reflexive call surface');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  if (error && Array.isArray(error.diagnostics)) console.error(JSON.stringify(error.diagnostics, null, 2));
  process.exitCode = 1;
});
