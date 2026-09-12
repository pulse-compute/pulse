#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler.js');
const { loadCanonicalModule } = require('../../packages/compiler/src/canonical-api-compiler.js');
const {
  CANONICAL_ROUTER_COMPILER_VERSION,
  CANONICAL_ROUTER_AUTHORING_VERSION,
  CANONICAL_ROUTER_EXECUTION_VERSION,
  CanonicalRouterCompileError,
  compileCanonicalRouterSource
} = require('../../packages/compiler/src/canonical-router-compiler.js');
const { buildCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const { executeCanonicalProgram } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const fastly = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const fastlyMock = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

const proofArgIndex = process.argv.indexOf('--proof');
const proofOutputFile = proofArgIndex >= 0 && process.argv[proofArgIndex + 1]
  ? path.resolve(process.argv[proofArgIndex + 1])
  : null;

const SOURCE = `import { Router } from '@pulse-compute/runtime'

const api = new Router()
const app = new Router()

function health(ctx) {
  return ctx.json({ ok: true })
}

function user(ctx) {
  const id = ctx.param('id')
  const origin = ctx.fetch('https://users.example.test/users/' + id).json()
  return ctx.json({ id, origin })
}

api.get('/health', health)
api.get('/users/:id', user)
api.head('/status', (ctx) => ctx.text('', { status: 204, headers: [['x-route', 'status']] }))
api.post('/echo', (ctx) => ctx.json({ method: ctx.req.method }))
api.put('/users/:id', async (ctx) => ctx.json({ method: ctx.req.method, id: ctx.param('id') }))
api.patch('/users/:id', async (ctx) => ctx.json({ method: ctx.req.method, id: ctx.param('id') }))
api.delete('/users/:id', async (ctx) => ctx.json({ method: ctx.req.method, id: ctx.param('id') }))
api.get('/files/*', (ctx) => ctx.text(ctx.req.path))
app.mount('/api', api)
export default app
`;

function writeProject(root) {
  const entry = path.join(root, 'src', 'index.ts');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, SOURCE, 'utf8');
  return entry;
}

function compileAt(root) {
  return compileCanonicalProject(writeProject(root), { rootDir: root, workspaceRoot: repoRoot });
}

function bodyJson(result) {
  return JSON.parse(result.response.body);
}

async function assertMutationRoutes(execute) {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const result = await execute({ method, path: '/api/users/7' });
    assert.equal(result.response.status, 200);
    assert.deepEqual(bodyJson(result), { method, id: '7' });
  }
  const unsupported = await execute({ method: 'OPTIONS', path: '/api/users/7' });
  assert.equal(unsupported.response.status, 404, 'method mismatch preserves Router exhaustion semantics');
}

function assertRouterDiagnostic(source, code) {
  assert.throws(
    () => compileCanonicalRouterSource(source, { fileName: 'src/index.ts', rootDir: repoRoot }),
    (error) => {
      assert.ok(error instanceof CanonicalRouterCompileError);
      assert.ok(error.diagnostics.some((entry) => entry.code === code), `expected Router diagnostic ${code}; got ${error.diagnostics.map((entry) => entry.code).join(', ')}`);
      return true;
    }
  );
}

async function main() {
  assert.equal(CANONICAL_ROUTER_COMPILER_VERSION, 'pulse.canonical-router-compiler.v2');
  assert.equal(CANONICAL_ROUTER_AUTHORING_VERSION, 'pulse.router-authoring.v2');

  const tempRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-router-lowering-'));
  try {
    const copyA = compileAt(path.join(tempRoot, 'copy-a'));
    const copyB = compileAt(path.join(tempRoot, 'copy-b'));
    assert.equal(copyA.router.version, CANONICAL_ROUTER_COMPILER_VERSION);
    assert.equal(copyA.metadata.authoring.kind, 'router');
    assert.equal(copyA.metadata.router.version, CANONICAL_ROUTER_AUTHORING_VERSION);
    assert.equal(copyA.metadata.router.executionVersion, CANONICAL_ROUTER_EXECUTION_VERSION);
    assert.equal(copyA.metadata.router.semantics.nextIsTerminal, true);
    assert.equal(copyA.metadata.router.semantics.onionResume, false);
    assert.deepEqual(copyA.metadata.router.routes.map((route) => [route.method, route.path]), [
      ['GET', '/api/health'],
      ['GET', '/api/users/:id'],
      ['HEAD', '/api/status'],
      ['POST', '/api/echo'],
      ['PUT', '/api/users/:id'],
      ['PATCH', '/api/users/:id'],
      ['DELETE', '/api/users/:id'],
      ['GET', '/api/files/*']
    ]);
    assert.equal(copyA.metadata.sourceHash, copyB.metadata.sourceHash, 'authoring hash must not depend on checkout location');
    assert.equal(copyA.metadata.loweredSourceHash, copyB.metadata.loweredSourceHash, 'lowered Router source must be deterministic');
    assert.equal(copyA.generatedSource, copyB.generatedSource, 'generated canonical handler must be deterministic');

    const program = loadCanonicalModule(copyA);
    await assertMutationRoutes((request) => executeCanonicalProgram(program, { request }));
    let result = await executeCanonicalProgram(program, { request: { method: 'GET', path: '/api/health' } });
    assert.deepEqual(bodyJson(result), { ok: true });
    result = await executeCanonicalProgram(program, { request: { method: 'POST', path: '/api/echo' } });
    assert.deepEqual(bodyJson(result), { method: 'POST' });
    result = await executeCanonicalProgram(program, { request: { method: 'GET', path: '/api/files/a/b' } });
    assert.equal(result.response.body, '/api/files/a/b');
    result = await executeCanonicalProgram(program, { request: { method: 'GET', path: '/api/missing' } });
    assert.equal(result.response.status, 404);
    assert.equal(result.response.body, 'Not Found');
    result = await executeCanonicalProgram(program, {
      request: { method: 'GET', path: '/api/users/42' },
      fetches: { 'https://users.example.test/users/42': { value: { id: 42, name: 'Ada' } } }
    });
    assert.deepEqual(bodyJson(result), { id: '42', origin: { id: 42, name: 'Ada' } });

    const planA = buildCanonicalNativePlan(copyA);
    const planB = buildCanonicalNativePlan(copyB);
    assert.equal(planA.entry.kind, 'router');
    assert.equal(planA.planHash, planB.planHash, 'route-aware native plan hash must be checkout-independent');
    assert.equal(stableStringify(planA), stableStringify(planB), 'route-aware native plan JSON must be deterministic');
    assert.equal(planA.routing.routes.length, 8);
    const planJson = stableStringify(planA);
    assert.match(planJson, /\"name\":\"router\.match\"/);
    assert.match(planJson, /\"name\":\"router\.param\"/);
    assert.equal(planA.effects.length, 1);
    assert.equal(planA.continuations.length, 1);
    const userRoute = planA.routing.routes.find((route) => route.path === '/api/users/:id');
    assert.ok(userRoute);
    for (const record of [planA.effects[0], planA.continuations[0]]) {
      assert.equal(record.routeStableId, userRoute.stableId);
      assert.equal(record.routeRuntimeId, userRoute.runtimeId);
      assert.equal(record.routeMethod, 'GET');
      assert.equal(record.routePath, '/api/users/:id');
    }

    const nativeA = compileCanonicalNativePlan(planA, { cwd: repoRoot });
    await assertMutationRoutes((request) => nativeHost.executeCanonicalNativeModule(nativeA, {
      request, providerAdapter: createNodeProviderAdapter()
    }));
    const nativeB = compileCanonicalNativePlan(planB, { cwd: os.tmpdir() });
    assert.deepEqual(nativeA.wasm, nativeB.wasm, 'portable routed Wasm must be deterministic');
    assert.ok(nativeA.inspection.imports.some((entry) => entry.module === 'pulse_host' && entry.name === 'router_match'));
    assert.ok(nativeA.inspection.imports.some((entry) => entry.module === 'pulse_host' && entry.name === 'router_param'));
    result = await nativeHost.executeCanonicalNativeModule(nativeA, {
      request: { method: 'GET', path: '/api/users/42' },
      fetches: { 'https://users.example.test/users/42': { value: { id: 42, name: 'Ada' } } },
      providerAdapter: createNodeProviderAdapter({ fetches: { 'https://users.example.test/users/42': { value: { id: 42, name: 'Ada' } } } })
    });
    assert.deepEqual(bodyJson(result), { id: '42', origin: { id: 42, name: 'Ada' } });
    result = await nativeHost.executeCanonicalNativeModule(nativeA, {
      request: { method: 'GET', path: '/api/missing' },
      providerAdapter: createNodeProviderAdapter()
    });
    assert.equal(result.response.status, 404);

    const fastlyA = fastly.compileFastlyNativePlatformCapabilitiesPlan(planA, {
      cwd: repoRoot,
      bindings: { effectBackends: { [planA.effects[0].id]: 'users' } },
      requirePlatformCapability: false,
      canonicalBuild: true
    });
    const fastlyB = fastly.compileFastlyNativePlatformCapabilitiesPlan(planB, {
      cwd: os.tmpdir(),
      bindings: { effectBackends: { [planB.effects[0].id]: 'users' } },
      requirePlatformCapability: false,
      canonicalBuild: true
    });
    await assertMutationRoutes((request) => fastlyMock.executeFastlyNativePlatformCapabilities(fastlyA, { request }));
    assert.deepEqual(fastlyA.wasm, fastlyB.wasm, 'native Fastly routed Wasm must be deterministic');
    assert.equal(fastlyA.inspection.imports.some((entry) => /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)), false);
    result = fastlyMock.executeFastlyNativePlatformCapabilities(fastlyA, {
      request: { method: 'GET', path: '/api/users/42' },
      fixtures: { users: { '/users/42': { status: 200, json: { id: 42, name: 'Ada' } } } }
    });
    assert.deepEqual(JSON.parse(result.response.body), { id: '42', origin: { id: 42, name: 'Ada' } });
    result = fastlyMock.executeFastlyNativePlatformCapabilities(fastlyA, { request: { method: 'GET', path: '/api/missing' } });
    assert.equal(result.response.status, 404);

    const base = `import { Router } from '@pulse-compute/runtime'; const app = new Router();`;
    assertRouterDiagnostic(`${base} app.options('/', async (ctx) => ctx.text('x')); export default app;`, 'PULSEWASM_UNSUPPORTED_ROUTER_METHOD');
    assertRouterDiagnostic(`${base} app.on('connect', (ctx) => ctx.text('x')); app.get('/', (ctx) => ctx.text('ok')); export default app;`, 'PULSE_CANONICAL_ROUTER_OPERATION_RETIRED');
    assertRouterDiagnostic(`${base} app.get('/users/:id', (ctx) => ctx.json({ value: ctx.param(name) })); export default app;`, 'PULSE_CANONICAL_ROUTER_PARAM_DYNAMIC');
    assertRouterDiagnostic(`${base} app.get('/', (ctx) => ctx.resolve(ctx.fetch('https://example.test'))); export default app;`, 'PULSE_CANONICAL_ROUTER_RESOLVE_RETIRED');
    const duplicate = compileCanonicalRouterSource(`${base} app.get('/', (ctx, next) => next()); app.get('/', (ctx) => ctx.text('b')); export default app;`, { fileName: 'src/index.ts', rootDir: repoRoot });
    assert.equal(duplicate.metadata.routes.length, 2, 'ordered duplicate routes are required for terminal fallthrough');

    const proof = {
      version: 'pulse.router-lowering-proof.v1',
      routes: planA.routing.routes.map((route) => ({ stableId: route.stableId, runtimeId: route.runtimeId, method: route.method, path: route.path, params: route.params })),
      effects: planA.effects.map((effect) => ({ id: effect.id, routeStableId: effect.routeStableId, method: effect.routeMethod, path: effect.routePath })),
      continuations: planA.continuations.map((continuation) => ({ id: continuation.id, routeStableId: continuation.routeStableId, method: continuation.routeMethod, path: continuation.routePath })),
      portableWasm: { bytes: nativeA.wasm.length, sha256: nativeA.inspection.sha256 },
      fastlyWasm: { bytes: fastlyA.wasm.length, sha256: fastlyA.inspection.sha256 }
    };
    if (proofOutputFile) {
      fs.mkdirSync(path.dirname(proofOutputFile), { recursive: true });
      fs.writeFileSync(proofOutputFile, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(proof, null, 2));
    console.log('ok - canonical Router preserves mounted exact, parameter, wildcard, method, fetch, and 404 lowering across Node and Fastly');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
