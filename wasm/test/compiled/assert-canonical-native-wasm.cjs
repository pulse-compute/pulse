#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EXAMPLES,
  compileExample,
  internalFixture
} = require('../support/canonical-projects.cjs');
const {
  buildCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler.js');
const {
  compileCanonicalNativePlan,
  inspectCanonicalNativeWasm,
  writeCanonicalNativeModule
} = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const canonicalHost = require('../../packages/host-runtime/src/runtime/canonical-api-runtime.js');
const {
  createNodeProviderAdapter
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const {
  createFastlyProviderAdapter
} = require('../../../packages/provider-fastly/src/runtime/canonical-api-runtime.js');
const runtimeContract = require('../../packages/contracts/src/handler/canonical-native-runtime.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const MAX_NATIVE_WASM_BYTES = 128 * 1024;

function planForExample(name) {
  return buildCanonicalNativePlan(compileExample(EXAMPLES[name]).compiled);
}

function planForFixture(name) {
  return buildCanonicalNativePlan(internalFixture(name).compiled);
}

function responseJson(result) {
  return result.response.body ? JSON.parse(result.response.body) : undefined;
}

function nodeOptions(options = {}) {
  return { ...options, providerAdapter: createNodeProviderAdapter(options) };
}

async function execute(compiled, options = {}) {
  return await nativeHost.executeCanonicalNativeModule(compiled, options);
}

function assertPortableModule(name, compiled) {
  assert.equal(compiled.version, runtimeContract.CANONICAL_NATIVE_WASM_VERSION, `${name} native module version`);
  assert.equal(compiled.manifest.abiVersion, runtimeContract.CANONICAL_NATIVE_ABI_VERSION, `${name} native ABI version`);
  assert.equal(compiled.manifest.planHash, compiled.plan.planHash, `${name} plan hash binding`);
  assert.equal(compiled.inspection.valid, true, `${name} valid Wasm`);
  assert.equal(compiled.inspection.magic, '0061736d01000000', `${name} Wasm magic`);
  assert.ok(compiled.wasm.length > 0 && compiled.wasm.length < MAX_NATIVE_WASM_BYTES, `${name} must remain compact Pulse-owned Wasm`);
  assert.ok(compiled.inspection.importModules.every((moduleName) => ['pulse_host', 'env'].includes(moduleName)), `${name} import modules must remain provider-neutral`);
  assert.equal(compiled.inspection.imports.some((entry) => /fastly|wasi|js-compute/i.test(`${entry.module}:${entry.name}`)), false, `${name} must not import a provider SDK or JavaScript runtime`);
  assert.equal(compiled.manifest.policy.providerNeutral, true, `${name} policy must remain provider-neutral`);
  assert.equal(compiled.manifest.policy.javascriptRuntime, false, `${name} must not embed a JavaScript runtime`);
}

async function main() {
  await require('./native-dispatcher-partitions.cjs').main();
  await require('../runtime/request-budget.cjs').main();
  const plans = new Map();
  for (const name of Object.keys(EXAMPLES)) plans.set(name, planForExample(name));
  for (const name of ['branching', 'continuation-chain', 'structured-body']) plans.set(name, planForFixture(name));

  const modules = new Map();
  const sizeLedger = [];
  for (const [name, plan] of plans) {
    const first = compileCanonicalNativePlan(plan, { cwd: repoRoot });
    const second = compileCanonicalNativePlan(plan, { cwd: os.tmpdir() });
    assert.deepEqual(first.wasm, second.wasm, `${name} Wasm bytes must be independent of the checkout and staging path`);
    assert.equal(first.source, second.source, `${name} generated AssemblyScript must be deterministic`);
    assert.equal(first.wat, second.wat, `${name} WAT must be deterministic`);
    assert.deepEqual(first.manifest, second.manifest, `${name} native manifest must be deterministic`);
    assertPortableModule(name, first);
    modules.set(name, first);
    sizeLedger.push(Object.freeze({ name, bytes: first.wasm.length, sha256: first.inspection.sha256 }));
  }

  let result = await execute(modules.get('hello'), nodeOptions({ request: { path: '/health' } }));
  assert.deepEqual(responseJson(result), { ok: true });
  result = await execute(modules.get('hello'), nodeOptions({ request: { path: '/hello' } }));
  assert.deepEqual(responseJson(result), { message: 'hello from Pulse' });
  result = await execute(modules.get('hello'), nodeOptions({ request: { path: '/missing' } }));
  assert.equal(result.response.status, 404);
  assert.equal(result.response.body, 'not found');

  result = await execute(modules.get('schema'), nodeOptions({
    request: {
      method: 'POST',
      path: '/users',
      headers: [['content-type', 'application/json']],
      body: JSON.stringify({ name: 'Ada', active: true })
    }
  }));
  assert.equal(result.response.status, 201);
  assert.deepEqual(responseJson(result), { id: 7, name: 'Ada', active: true, sameReference: true });
  await assert.rejects(() => execute(modules.get('schema'), nodeOptions({
    request: {
      method: 'POST',
      path: '/users',
      headers: [['content-type', 'application/json']],
      body: JSON.stringify({ name: 7, active: true })
    }
  })), (error) => error && error.name === 'SchemaDecodeError');

  result = await execute(modules.get('fetchComposition'), nodeOptions({
    request: { path: '/user' },
    fetches: {
      'https://users.example.test/users/123': {
        status: 200,
        headers: [['x-source', 'native']],
        value: { id: 123, name: 'Ada' }
      }
    }
  }));
  assert.deepEqual(responseJson(result), { found: true, user: { id: 123, name: 'Ada' } });
  assert.deepEqual(result.continuations[0].states, ['created', 'waiting', 'resumed', 'completed']);
  result = await execute(modules.get('fetchComposition'), nodeOptions({
    request: { path: '/missing' }
  }));
  assert.equal(result.response.status, 404);
  assert.equal(result.response.body, 'Not Found');
  assert.equal(result.effectCount, 0, 'the explicit missing route must not dispatch the user fetch');
  result = await execute(modules.get('fetchComposition'), nodeOptions({
    request: { path: '/user' },
    fetches: { 'https://users.example.test/users/123': { status: 404, value: { error: 'missing' } } }
  }));
  assert.deepEqual(responseJson(result), { found: true, user: { error: 'missing' } }, 'HTTP errors remain response data rather than transport failures');

  result = await execute(modules.get('fetchComposition'), nodeOptions({
    request: { path: '/user-summary' },
    fetches: {
      'https://users.example.test/users/123': { value: { id: 123, name: 'Ada' }, delayMs: 25 },
      'https://stats.example.test/users/123': { value: { score: 42 }, delayMs: 10 },
      'https://flags.example.test/users/123': { value: { enabled: true }, delayMs: 1 }
    }
  }));
  assert.deepEqual(responseJson(result), { id: 123, name: 'Ada', score: 42, enabled: true });
  assert.deepEqual(result.resolutionOrder, ['fetch-4', 'fetch-3', 'fetch-2'], 'host completion order must not change source-order continuation binding');
  assert.equal(result.continuations.length, 1);
  assert.deepEqual(result.continuations[0].effectIds, ['fetch-2', 'fetch-3', 'fetch-4']);

  result = await execute(modules.get('fetchComposition'), nodeOptions({
    request: { path: '/user-summary-parallel' },
    fetches: {
      'https://users.example.test/users/123': { value: { id: 123, name: 'Ada' }, delayMs: 25 },
      'https://stats.example.test/users/123': { value: { score: 42 }, delayMs: 10 },
      'https://flags.example.test/users/123': { value: { enabled: true }, delayMs: 1 }
    }
  }));
  assert.deepEqual(responseJson(result), { id: 123, name: 'Ada', score: 42, enabled: true });
  assert.deepEqual(result.resolutionOrder, ['fetch-7', 'fetch-6', 'fetch-5']);
  assert.deepEqual(result.continuations[0].effectIds, ['fetch-5', 'fetch-6', 'fetch-7']);

  result = await execute(modules.get('fastlyCapabilities'), nodeOptions({
    request: { path: '/users/7' },
    config: { API_BASE: 'https://api.example.com' },
    secrets: { API_TOKEN: 'top-secret-token' },
    fetches: { 'https://api.example.com/users/7': { value: { id: 7, name: 'Ada' } } }
  }));
  assert.deepEqual(responseJson(result), { user: { id: 7, name: 'Ada' } });
  assert.doesNotMatch(JSON.stringify(result.trace), /top-secret-token/);
  assert.match(JSON.stringify(result.trace), /<redacted>/);

  result = await execute(modules.get('fastlyCapabilities'), nodeOptions({ request: { path: '/session' }, kv: { sessions: { 'session:123': { userId: 123 } } } }));
  assert.deepEqual(responseJson(result), { session: { userId: 123 } });
  assert.equal(result.effectCount, 2);
  result = await execute(modules.get('fastlyCapabilities'), nodeOptions({ request: { path: '/session' }, kv: { sessions: {} } }));
  assert.equal(result.response.status, 404);
  assert.deepEqual(responseJson(result), { error: 'not_found' });
  assert.equal(result.effectCount, 1, 'untaken KV writes must not dispatch');

  const stream = { chunks: ['chunk-a', 'chunk-b'] };
  result = await execute(modules.get('opaqueProxy'), nodeOptions({
    request: { path: '/archive' },
    fetches: {
      'https://assets.example.com/archive.bin': {
        opaque: true,
        status: 206,
        headers: [['set-cookie', 'a=1'], ['set-cookie', 'b=2']],
        bodyStream: stream,
        responseRef: 77,
        streamRef: 88
      }
    }
  }));
  assert.equal(result.response.bodyClass, 'opaque');
  assert.equal(result.response.bodyStream, stream);
  assert.equal(result.response.hostOwnsStream, true);
  assert.equal(result.response.wasmOwnsBytes, false);
  assert.deepEqual(result.response.headers.filter(([name]) => name === 'set-cookie'), [['set-cookie', 'a=1'], ['set-cookie', 'b=2']]);

  const headSource = `
    import { Router } from '@pulse-compute/runtime'
    const app = new Router()
    function headHandler(ctx) {
      return ctx.text('must-not-survive', { status: 200, headers: [['x-head', 'yes']] })
    }
    app.head('/head', headHandler)
    export default app
  `;
  const headRouter = compileCanonicalRouterSource(headSource, {
    fileName: 'native-head.ts',
    rootDir: repoRoot
  });
  const headCompiled = compileCanonicalSource(headRouter.sourceText, {
    fileName: 'native-head.ts',
    rootDir: repoRoot,
    compilerPrelude: headRouter.compilerPrelude,
    compilerOwnedCalls: headRouter.compilerOwnedCalls,
    internalGeneratedHandler: true,
    metadataExtensions: { router: headRouter.metadata }
  });
  const headModule = compileCanonicalNativePlan(buildCanonicalNativePlan(headCompiled), { cwd: repoRoot });
  result = await execute(headModule, nodeOptions({ request: { method: 'HEAD', path: '/head' } }));
  assert.equal(result.response.status, 200);
  assert.equal(result.response.bodyClass, 'structured');
  assert.equal(result.response.body, '', 'compiled Native HEAD responses must strip application-owned bodies');

  result = await execute(modules.get('branching'), nodeOptions({ request: { path: '/health' } }));
  assert.deepEqual(responseJson(result), { ok: true });
  assert.equal(result.effectCount, 0, 'untaken branch effects must not dispatch');
  result = await execute(modules.get('branching'), nodeOptions({
    request: { path: '/dashboard' },
    fetches: { 'https://dashboard.example.test/current': { value: { title: 'Overview' } } }
  }));
  assert.deepEqual(responseJson(result), { dashboard: { title: 'Overview' } });

  result = await execute(modules.get('continuation-chain'), nodeOptions({
    fetches: {
      'https://users.example.test/users/123': { value: { id: 123 } },
      'https://details.example.test/users/123': { value: { city: 'Denver' } }
    }
  }));
  assert.deepEqual(responseJson(result), { id: 123, city: 'Denver' });
  assert.equal(result.continuations.length, 2);
  assert.ok(result.continuations.every((entry) => entry.state === 'completed'));

  result = await execute(modules.get('structured-body'), nodeOptions({
    request: {
      method: 'POST',
      path: '/body',
      headers: [['content-type', 'application/json'], ['x-request-id', 'req-1']],
      body: JSON.stringify({ id: 7 })
    }
  }));
  assert.deepEqual(responseJson(result), { id: 7, sameReference: true, requestId: 'req-1' });

  const fastlyOptions = {
    bindings: {
      configStore: 'pulse_config',
      secretStore: 'pulse_secrets',
      kv: { sessions: 'pulse_sessions' },
      backends: {},
      grip: {
        publishEndpoint: 'https://publisher.example.com/publish',
        authentication: { scheme: 'bearer', secretRef: 'GRIP_TOKEN' }
      }
    },
    secrets: { GRIP_TOKEN: 'grip-token' },
    fetchImplementation: async () => new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { 'content-type': 'application/json' }
    })
  };
  result = await execute(modules.get('fastlyCapabilities'), {
    ...fastlyOptions,
    providerAdapter: createFastlyProviderAdapter(fastlyOptions),
    request: { method: 'POST', path: '/publish' }
  });
  assert.equal(result.response.status, 202);
  assert.equal(result.effectCount, 1);
  assert.deepEqual(responseJson(result), { accepted: true });
  assert.deepEqual(result.providerMetadata.grip.broadcasts, [
    { channel: 'events:demo', accepted: true, status: 202 }
  ]);

  const lowLevel = modules.get('fetchComposition');
  const controller = nativeHost.instantiateCanonicalNativeModule(lowLevel, nodeOptions({ request: { path: '/user' } }));
  assert.throws(
    () => controller.prepareEffectResult(99, {}),
    (error) => error && error.code === 'PULSE_CANONICAL_NATIVE_EFFECT_INDEX_INVALID'
  );
  assert.equal(controller.start(), runtimeContract.CANONICAL_NATIVE_RUN_STATUS.SUSPENDED);
  const suspendedPc = controller.programCounter();
  const suspendedState = controller.continuationState();
  assert.equal(controller.pendingEffects().length, 1);
  assert.equal(controller.resume(), runtimeContract.CANONICAL_NATIVE_RUN_STATUS.INVALID_RESUME);
  assert.equal(controller.lastErrorCode(), runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INCOMPLETE_RESUME);
  assert.equal(controller.programCounter(), suspendedPc, 'incomplete resume must not advance the program counter');
  assert.equal(controller.continuationState(), suspendedState, 'incomplete resume must not consume continuation state');
  assert.equal(controller.exports.pulse_set_effect_result(99, 1), runtimeContract.CANONICAL_NATIVE_RESULT_STATUS.REJECTED);
  const manualResponse = canonicalHost.normalizeFetchResponse({
    status: 200,
    kind: 'text',
    headers: [['x-source', 'manual']],
    body: JSON.stringify({ id: 123, name: 'Ada' })
  }, 'fetch-1', 'manual', controller.schemaCodecs);
  assert.deepEqual(lowLevel.plan.effects[0].result.decoder, { kind: 'json', arguments: [] });
  controller.setEffectResult(0, controller.prepareEffectResult(0, manualResponse));
  assert.equal(controller.exports.pulse_set_effect_result(0, 1), runtimeContract.CANONICAL_NATIVE_RESULT_STATUS.REJECTED, 'duplicate effect results must be rejected');
  assert.equal(controller.resume(), runtimeContract.CANONICAL_NATIVE_RUN_STATUS.COMPLETE);
  assert.equal(controller.lastErrorCode(), runtimeContract.CANONICAL_NATIVE_ERROR_CODES.NONE);
  assert.deepEqual(JSON.parse(controller.response().body), { found: true, user: { id: 123, name: 'Ada' } });

  assert.throws(() => nativeHost.instantiateCanonicalNativeModule({
    ...lowLevel,
    plan: { ...lowLevel.plan, planHash: '0'.repeat(64) }
  }, nodeOptions()), (error) => error && error.code === 'PULSE_CANONICAL_NATIVE_PLAN_HASH_MISMATCH');
  assert.throws(() => inspectCanonicalNativeWasm(Buffer.from('not wasm')), (error) => error && error.name === 'CanonicalNativeCompileError');

  const textModule = compileCanonicalNativePlan(plans.get('hello'), { cwd: repoRoot, emitWat: true });
  assert.deepEqual(textModule.wasm, modules.get('hello').wasm, 'text emission must not change executable bytes');
  assert.ok(textModule.wat.startsWith('(module'));
  assert.equal(textModule.manifest.wat.emitted, true);
  assert.deepEqual(modules.get('hello').manifest.wat, { emitted: false, bytes: 0, sha256: null });
  assert.throws(() => compileCanonicalNativePlan(plans.get('hello'), { cwd: repoRoot, emitWat: 'yes' }), /emitWat must be a boolean/);

  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-canonical-native-write-'));
  try {
    const written = writeCanonicalNativeModule(modules.get('hello'), outputRoot);
    assert.ok(fs.existsSync(written.sourceFile));
    assert.ok(fs.existsSync(written.wasmFile));
    assert.equal(written.watFile, null);
    assert.equal(fs.existsSync(path.join(outputRoot, 'canonical-native.wat')), false);
    const withText = writeCanonicalNativeModule(textModule, outputRoot);
    assert.equal(fs.readFileSync(withText.watFile, 'utf8'), textModule.wat);
    writeCanonicalNativeModule(modules.get('hello'), outputRoot);
    assert.equal(fs.existsSync(withText.watFile), false, 'reusing an output directory removes stale diagnostic text');
    // Inspect the compiler output directly so generating and merely discarding
    // WAT cannot satisfy the default-omission contract.
    fs.writeFileSync(withText.watFile, 'stale diagnostic');
    const direct = compileCanonicalNativePlan(plans.get('hello'), { cwd: repoRoot, outDir: outputRoot });
    assert.equal(direct.output.watFile, null);
    assert.equal(fs.existsSync(withText.watFile), false, 'AssemblyScript must not emit default WAT');
    assert.deepEqual(direct.wasm, textModule.wasm);
    assert.ok(fs.existsSync(written.planFile));
    assert.ok(fs.existsSync(written.manifestFile));
    assert.equal(JSON.parse(fs.readFileSync(written.manifestFile, 'utf8')).wasm.sha256, modules.get('hello').inspection.sha256);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }

  const minimum = Math.min(...sizeLedger.map((entry) => entry.bytes));
  const maximum = Math.max(...sizeLedger.map((entry) => entry.bytes));
  console.log(`ok - ${plans.size} canonical plans compile deterministically to provider-neutral Pulse Wasm (${minimum}-${maximum} bytes) and execute through the narrow host ABI`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  if (error && error.detail) console.error(error.detail);
  if (error && error.execution) console.error(error.execution);
  process.exit(1);
});
