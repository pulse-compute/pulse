#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  EXAMPLES,
  compileExample,
  internalFixture
} = require('../support/canonical-projects.cjs');
const { createCanonicalNodeRuntime, executeCanonicalProgram } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const canonicalHostRuntime = require('../../packages/host-runtime/src/runtime/canonical-api-runtime.js');
const { compileCanonicalSource, loadCanonicalModule } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { createContinuationRegistry } = require('../../packages/host-runtime/src/runtime/continuation-registry.js');
const streamingContract = require('../../packages/contracts/src/host/streaming-passthrough.js');

const exampleProgram = (id) => compileExample(id).program;
const internalProgram = (name) => internalFixture(name).program;
const body = (result) => JSON.parse(result.response.body);

async function main() {
  const nativeSecret = 'native-accessor-secret';
  let accessorInvoked = false;
  const hostileDetail = {};
  Object.defineProperty(hostileDetail, 'accessToken', {
    enumerable: true,
    get() { accessorInvoked = true; return nativeSecret; }
  });
  const hostileError = new Error(`native failure ${nativeSecret}`);
  Object.defineProperty(hostileError, 'detail', {
    enumerable: false,
    get() { accessorInvoked = true; return hostileDetail; }
  });
  const safeHostileError = canonicalHostRuntime.redactRuntimeError(hostileError, new Set([nativeSecret]));
  assert.equal(accessorInvoked, false, 'Native redaction must not invoke hostile accessors');
  assert.equal(safeHostileError.message, 'native failure <redacted>');
  assert.equal(safeHostileError.detail, undefined);
  assert.deepEqual(canonicalHostRuntime.redactRuntimeValue(hostileDetail, new Set([nativeSecret])), {
    accessToken: '<redacted>'
  });
  assert.equal(accessorInvoked, false, 'Native structured redaction must not invoke hostile accessors');

  const helloProgram = exampleProgram(EXAMPLES.hello);
  const health = await executeCanonicalProgram(helloProgram, { request: { method: 'GET', path: '/health' } });
  assert.deepEqual(body(health), { ok: true });
  const missingHello = await executeCanonicalProgram(helloProgram, { request: { method: 'GET', path: '/missing' } });
  assert.equal(missingHello.response.status, 404);
  assert.equal(missingHello.response.body, 'not found');

  const schemaProgram = exampleProgram(EXAMPLES.schema);
  const schemaExecution = await executeCanonicalProgram(schemaProgram, {
    request: {
      method: 'POST',
      path: '/users',
      headers: [['content-type', 'application/json']],
      body: JSON.stringify({ name: 'Ada', active: true })
    }
  });
  assert.deepEqual(body(schemaExecution), { id: 7, name: 'Ada', active: true, sameReference: true });
  assert.equal(schemaExecution.response.status, 201);
  assert.equal(schemaExecution.requestBodyStats.bodyCopies, 1);
  assert.equal(schemaExecution.requestBodyStats.textTransforms, 1, 'schema-backed decode must reuse one owned text snapshot');
  assert.equal(schemaExecution.requestBodyStats.jsonTransforms, 0, 'schema codecs bypass the generic JSON transform');
  assert.equal(schemaExecution.effectCount, 0);

  const structuredProgram = internalProgram('structured-body');
  const structured = await executeCanonicalProgram(structuredProgram, { request: { method: 'POST', path: '/users', headers: [['content-type', 'application/json'], ['x-request-id', 'req-7']], body: JSON.stringify({ id: 123 }) } });
  assert.deepEqual(body(structured), { id: 123, sameReference: true, requestId: 'req-7' });
  const ready = await executeCanonicalProgram(structuredProgram, { request: { method: 'GET', path: '/' } });
  assert.equal(ready.response.body, 'ready');
  const empty = await executeCanonicalProgram(structuredProgram, { request: { method: 'POST', path: '/empty', body: '{}' } });
  assert.equal(empty.response.status, 204);

  const singleProgram = exampleProgram(EXAMPLES.fetchComposition);
  await assert.rejects(
    () => executeCanonicalProgram({ ...singleProgram, version: 'pulse.canonical-program.incompatible' }, {}),
    { name: 'CanonicalProgramCompatibilityError', code: 'PULSE_CANONICAL_PROGRAM_INCOMPATIBLE' }
  );
  const single = await executeCanonicalProgram(singleProgram, { request: { path: '/user' }, fetches: {
    'https://users.example.test/users/123': { status: 200, headers: [['content-type', 'application/json'], ['x-source', 'node-provider']], value: { id: 123, name: 'Ada' } }
  } });
  assert.deepEqual(body(single), { found: true, user: { id: 123, name: 'Ada' } });
  assert.equal(single.effectCount, 1);
  assert.deepEqual(single.continuations[0].states, ['created', 'waiting', 'resumed', 'completed']);
  const missing = await executeCanonicalProgram(singleProgram, { request: { path: '/missing' } });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.response.body, 'Not Found');
  assert.equal(missing.effectCount, 0, 'the unmatched route must not dispatch the user fetch');
  const upstream404 = await executeCanonicalProgram(singleProgram, { request: { path: '/user' }, fetches: {
    'https://users.example.test/users/123': { status: 404, value: { error: 'not_found' } }
  } });
  assert.deepEqual(body(upstream404), { found: true, user: { error: 'not_found' } }, 'HTTP 404 must remain response data');

  const branchProgram = internalProgram('branching');
  const branchHealth = await executeCanonicalProgram(branchProgram, { request: { path: '/health' } });
  assert.deepEqual(body(branchHealth), { ok: true });
  assert.equal(branchHealth.effectCount, 0, 'untaken branch fetches must not dispatch');
  const dashboard = await executeCanonicalProgram(branchProgram, { request: { path: '/dashboard' }, fetches: {
    'https://dashboard.example.test/current': { value: { title: 'Overview' } }
  } });
  assert.deepEqual(body(dashboard), { dashboard: { title: 'Overview' } });
  assert.equal(dashboard.effectCount, 1);
  assert.equal(dashboard.trace.filter((entry) => entry.type === 'effect-start')[0].url, 'https://dashboard.example.test/current');

  const multiProgram = singleProgram;
  const multi = await executeCanonicalProgram(multiProgram, { request: { path: '/user-summary' }, fetches: {
    'https://users.example.test/users/123': { value: { id: 123, name: 'Ada' }, delayMs: 25 },
    'https://stats.example.test/users/123': { value: { score: 42 }, delayMs: 10 },
    'https://flags.example.test/users/123': { value: { enabled: true }, delayMs: 1 }
  } });
  assert.deepEqual(body(multi), { id: 123, name: 'Ada', score: 42, enabled: true });
  assert.deepEqual(
    multi.resolutionOrder,
    ['fetch-4', 'fetch-3', 'fetch-2'],
    'host resolution order should be diagnostic only'
  );
  assert.equal(multi.continuations.length, 1);
  assert.deepEqual(
    multi.continuations[0].effectIds,
    ['fetch-2', 'fetch-3', 'fetch-4']
  );
  assert.equal(multi.effectCount, 3);

  const explicitParallelCompiled = compileCanonicalSource(`
export default async function handler(ctx) {
  const users = ctx.kv('users');
  const { profile, mode, stored } = await ctx.parallel({
    profile: ctx.fetch('https://parallel.example.test/profile').json(),
    mode: ctx.config.get('MODE'),
    stored: users.get('last')
  });
  return ctx.json({ profile, mode, stored });
}
`, { fileName: 'runtime-explicit-parallel.ts', strict: true });
  const explicitParallelProgram = loadCanonicalModule(explicitParallelCompiled);
  const explicitParallelExecution = await executeCanonicalProgram(explicitParallelProgram, {
    request: { path: '/' },
    config: { MODE: 'test' },
    kv: { users: { last: { id: 9 } } },
    fetches: {
      'https://parallel.example.test/profile': { value: { id: 7, name: 'Ada' }, delayMs: 10 }
    }
  });
  assert.deepEqual(body(explicitParallelExecution), {
    profile: { id: 7, name: 'Ada' },
    mode: 'test',
    stored: { id: 9 }
  });
  assert.equal(explicitParallelExecution.continuations.length, 1);
  assert.deepEqual(explicitParallelExecution.continuations[0].effectIds, ['fetch-1', 'config-1', 'kv-get-1']);
  assert.deepEqual(
    explicitParallelExecution.trace.filter((entry) => entry.type === 'effect-start').map((entry) => [entry.effectId, entry.groupKey]),
    [['fetch-1', 'profile'], ['config-1', 'mode'], ['kv-get-1', 'stored']],
    'explicit parallel dispatch registration and group identity must follow source property order'
  );
  assert.deepEqual(explicitParallelExecution.resolutionOrder, ['config-1', 'kv-get-1', 'fetch-1']);

  const explicitParallelFailureCompiled = compileCanonicalSource(`
export default async function handler(ctx) {
  await ctx.parallel({
    declaredFirst: ctx.fetch('https://parallel.example.test/first', { timeoutMs: 5 }).json(),
    declaredSecond: ctx.fetch('https://parallel.example.test/second').json()
  });
  return ctx.text('unreachable');
}
`, { fileName: 'runtime-explicit-parallel-failure.ts', strict: true });
  const explicitParallelFailureProgram = loadCanonicalModule(explicitParallelFailureCompiled);
  await assert.rejects(() => executeCanonicalProgram(explicitParallelFailureProgram, {
    fetches: {
      'https://parallel.example.test/first': { value: { ok: true }, delayMs: 20 },
      'https://parallel.example.test/second': { kind: 'network-error' }
    }
  }), (error) => {
    assert.equal(error.name, 'FetchTimeoutError', 'the first declared failure owns the primary error even when another effect fails sooner');
    assert.equal(error.code, 'PULSE_FETCH_TIMEOUT');
    assert.deepEqual(error.effectFailures, [
      { key: 'declaredFirst', index: 0, effectId: 'fetch-1', kind: 'fetch', name: 'FetchTimeoutError', code: 'PULSE_FETCH_TIMEOUT' },
      { key: 'declaredSecond', index: 1, effectId: 'fetch-2', kind: 'fetch', name: 'FetchNetworkError', code: 'PULSE_FETCH_NETWORK' }
    ]);
    assert.equal(error.execution.continuations.length, 1);
    assert.equal(error.execution.continuations[0].state, 'failed');
    return true;
  });

  const sharedRegistry = createContinuationRegistry();
  const sharedRuntime = createCanonicalNodeRuntime({
    continuationRegistry: sharedRegistry,
    fetches: {
      'https://users.example.test/users/123': { value: { id: 123, name: 'Ada' } },
      'https://stats.example.test/users/123': { value: { score: 42 } },
      'https://flags.example.test/users/123': { value: { enabled: true } }
    }
  });
  const sharedExecution = await sharedRuntime.execute(multiProgram, { executionId: 'shared-registry-proof', request: { path: '/user-summary' } });
  assert.equal(sharedExecution.continuations.length, 1);
  const completedContinuation = sharedExecution.continuations[0].id;
  assert.throws(() => sharedRegistry.resume(completedContinuation), { name: 'ContinuationDoubleResumeError', code: 'PULSE_CONTINUATION_DOUBLE_RESUME' });

  await assert.rejects(() => executeCanonicalProgram(multiProgram, { request: { path: '/user-summary' }, fetches: {
    'https://users.example.test/users/123': { value: { id: 123, name: 'Ada' }, delayMs: 10 },
    'https://stats.example.test/users/123': { kind: 'network-error' },
    'https://flags.example.test/users/123': { value: { enabled: true }, delayMs: 1 }
  } }), (error) => {
    assert.equal(error.name, 'FetchNetworkError');
    assert.equal(error.execution.continuations.length, 1);
    assert.equal(error.execution.continuations[0].state, 'failed');
    assert.deepEqual(
      error.execution.continuations[0].effectIds,
      ['fetch-2', 'fetch-3', 'fetch-4']
    );
    return true;
  });

  const dependent = await executeCanonicalProgram(internalProgram('continuation-chain'), { fetches: {
    'https://users.example.test/users/123': { value: { id: 123 } },
    'https://details.example.test/users/123': { value: { city: 'Denver' } }
  } });
  assert.deepEqual(body(dependent), { id: 123, city: 'Denver' });
  assert.equal(dependent.continuations.length, 2);
  assert.ok(dependent.continuations.every((entry) => entry.state === 'completed'));

  await assert.rejects(() => executeCanonicalProgram(singleProgram, {
    request: { path: '/user' },
    continuationTtlMs: 2,
    fetches: { 'https://users.example.test/users/123': { value: { id: 123, name: 'Ada' }, delayMs: 10 } }
  }), (error) => {
    assert.equal(error.name, 'ContinuationExpiredError');
    assert.equal(error.code, 'PULSE_CONTINUATION_EXPIRED');
    assert.equal(error.execution.continuations[0].state, 'expired');
    return true;
  });

  const stream = { chunks: ['chunk-a', 'chunk-b'] };
  const opaque = await executeCanonicalProgram(exampleProgram(EXAMPLES.opaqueProxy), { request: { path: '/archive' }, fetches: {
    'https://assets.example.com/archive.bin': { opaque: true, status: 206, headers: [['content-type', 'application/octet-stream'], ['set-cookie', 'a=1'], ['set-cookie', 'b=2']], bodyStream: stream, responseRef: 77, streamRef: 88 }
  } });
  assert.equal(opaque.response.kind, 'stream');
  assert.equal(opaque.response.bodyClass, 'opaque');
  assert.equal(opaque.response.bodyStream, stream);
  assert.equal(opaque.response.hostOwnsStream, true);
  assert.equal(opaque.response.wasmOwnsBytes, false);
  assert.equal(opaque.response.responseRef, 77);
  assert.equal(opaque.response.streamRef, 88);
  assert.equal(opaque.response.streamResultAbiVersion, streamingContract.STREAM_RESULT_ABI_VERSION);
  assert.deepEqual(opaque.response.headers.filter(([name]) => name.toLowerCase() === 'set-cookie'), [['set-cookie', 'a=1'], ['set-cookie', 'b=2']]);
  assert.equal(opaque.response.bodyHandle.lifecycle.finalState, 'detached');

  const fastlyProgram = exampleProgram(EXAMPLES.fastlyCapabilities);
  const configSecret = await executeCanonicalProgram(fastlyProgram, {
    request: { path: '/users/7' },
    config: { API_BASE: 'https://api.example.com' },
    secrets: { API_TOKEN: 'top-secret-token' },
    fetches: { 'https://api.example.com/users/7': { value: { id: 7, name: 'Ada' } } }
  });
  assert.deepEqual(body(configSecret), { user: { id: 7, name: 'Ada' } });
  const traceText = JSON.stringify(configSecret.trace);
  assert.doesNotMatch(traceText, /top-secret-token/);
  assert.match(traceText, /<redacted>/);

  const kv = await executeCanonicalProgram(fastlyProgram, {
    request: { path: '/session' },
    kv: { sessions: { 'session:123': { userId: 123 } } }
  });
  assert.deepEqual(body(kv), { session: { userId: 123 } });
  assert.ok(kv.trace.some((entry) => entry.type === 'effect-start' && entry.kind === 'kv.put' && entry.key === 'session:last'));
  assert.ok(configSecret.trace.some((entry) => entry.type === 'effect-start' && entry.kind === 'config.get'));
  assert.ok(configSecret.trace.some((entry) => entry.type === 'effect-start' && entry.kind === 'secret.get'));

  const failures = internalProgram('failure-diagnostics');
  await assert.rejects(() => executeCanonicalProgram(failures, { request: { path: '/decode', headers: [['content-type', 'application/json']], body: '{bad json' } }), { name: 'BodyDecodeError' });
  await assert.rejects(() => executeCanonicalProgram(failures, { fetches: { 'https://assets.example.test/archive.bin': { opaque: true, bodyStream: { chunks: [] } } } }), (error) => {
    assert.equal(error.name, 'OpaqueBodyInspectionError');
    assert.ok(error.execution.continuations.some((entry) => entry.state === 'failed'));
    return true;
  });
  await assert.rejects(() => executeCanonicalProgram(singleProgram, { request: { path: '/user' }, fetches: { 'https://users.example.test/users/123': { kind: 'network-error' } } }), { name: 'FetchNetworkError' });
  await assert.rejects(() => executeCanonicalProgram(singleProgram, { request: { path: '/user' }, fetches: { 'https://users.example.test/users/123': { kind: 'timeout' } } }), { name: 'FetchTimeoutError' });

  await assert.rejects(() => executeCanonicalProgram(singleProgram, { request: { path: '/user' }, fetches: {
    'https://users.example.test/users/123': { status: 200, headers: [['content-type', 'application/json']], body: '{bad json' }
  } }), (error) => {
    assert.equal(error.name, 'BodyDecodeError');
    assert.equal(error.execution.continuations.length, 1);
    assert.equal(error.execution.continuations[0].state, 'failed', 'decode failure after host resume must fail the active continuation');
    return true;
  });

  const failureRuntime = createCanonicalNodeRuntime({ fetches: {
    'https://users.example.test/users/123': { value: { id: 123, name: 'Ada' }, delayMs: 20 },
    'https://stats.example.test/users/123': { kind: 'network-error' },
    'https://flags.example.test/users/123': { value: { enabled: true }, delayMs: 5 }
  } });
  await assert.rejects(() => failureRuntime.execute(multiProgram, { executionId: 'joined-failure-proof', request: { path: '/user-summary' } }), (error) => {
    assert.equal(error.name, 'FetchNetworkError');
    assert.deepEqual(
      error.execution.resolutionOrder,
      ['fetch-4', 'fetch-2'],
      'the joined group must settle already-dispatched effects before returning failure'
    );
    assert.equal(error.execution.continuations.length, 1);
    assert.equal(error.execution.continuations[0].state, 'failed');
    assert.deepEqual(error.effectFailures, [{
      effectId: 'fetch-3',
      name: 'FetchNetworkError',
      code: 'PULSE_FETCH_NETWORK'
    }]);
    return true;
  });
  const traceLengthAfterFailure = failureRuntime.trace().length;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(failureRuntime.trace().length, traceLengthAfterFailure, 'joined failure must not leave effect work running after execute rejects');

  console.log('ok - documented canonical projects execute through real Node effects while only branch, dependency, body-edge, and failure mechanics use internal canonical fixtures');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
