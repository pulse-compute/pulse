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
const {
  createNodeProviderAdapter,
  executeCanonicalProgram
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const fastly = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const fastlyMock = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

const proofArgIndex = process.argv.indexOf('--proof');
const proofOutputFile = proofArgIndex >= 0 && process.argv[proofArgIndex + 1]
  ? path.resolve(process.argv[proofArgIndex + 1])
  : null;

const SOURCE = `import { Router } from '@pulse-compute/runtime'

const admin = new Router()
const app = new Router()

app.use((ctx, next) => {
  const auth = ctx.fetch('https://auth.example.test/check').json()
  if (!auth.allowed) return ctx.json({ blocked: true }, { status: 401 })
  return next()
})

app.use('/admin', (ctx, next) => {
  if (ctx.req.header('x-area') !== 'admin') return ctx.text('area denied', { status: 403 })
  return next()
})

admin.use((ctx, next) => {
  if (ctx.req.header('x-child') !== 'ready') return ctx.text('child denied', { status: 409 })
  return next()
})

admin.get('/items/:id', (ctx, next) => {
  if (ctx.req.header('x-owner') !== 'primary') return next()
  const id = ctx.param('id')
  return ctx.json({ handler: 'primary', id })
})

admin.get('/items/:id', (ctx) => ctx.json({ handler: 'fallback', id: ctx.param('id') }))

admin.get('/handled-error', (ctx, next) => {
  return next({ code: 'E_HANDLED', message: 'boom' })
})

admin.get('/unhandled-error', (ctx, next) => {
  return next({ code: 'E_UNHANDLED', message: 'unhandled' })
})

app.mount('/admin', admin)

app.error((error, ctx, next) => {
  if (error.code === 'E_HANDLED') return ctx.json({ handled: error.message }, { status: 418 })
  return next(error)
})

app.error((error, ctx, next) => next(error))

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

function authFetches(allowed) {
  return { 'https://auth.example.test/check': { value: { allowed } } };
}

function request(pathname, headers = {}) {
  return { method: 'GET', path: pathname, headers };
}

function assertResponse(result, expected) {
  assert.equal(result.response.status, expected.status);
  assert.equal(result.response.body, expected.body);
}

function assertRouterDiagnostic(source, code) {
  assert.throws(
    () => compileCanonicalRouterSource(source, { fileName: 'src/index.ts', rootDir: repoRoot }),
    (error) => {
      assert.ok(error instanceof CanonicalRouterCompileError);
      assert.ok(
        error.diagnostics.some((entry) => entry.code === code),
        `expected Router diagnostic ${code}; got ${error.diagnostics.map((entry) => entry.code).join(', ')}`
      );
      return true;
    }
  );
}

async function executeJavaScript(program, testCase) {
  return executeCanonicalProgram(program, {
    request: testCase.request,
    fetches: authFetches(testCase.authAllowed)
  });
}

async function executePortable(nativeArtifact, testCase) {
  const fetches = authFetches(testCase.authAllowed);
  return nativeHost.executeCanonicalNativeModule(nativeArtifact, {
    request: testCase.request,
    fetches,
    providerAdapter: createNodeProviderAdapter({ fetches })
  });
}

function executeFastly(fastlyArtifact, testCase) {
  return fastlyMock.executeFastlyNativePlatformCapabilities(fastlyArtifact, {
    request: testCase.request,
    fixtures: {
      auth: {
        '/check': { status: 200, json: { allowed: testCase.authAllowed } }
      }
    }
  });
}

async function main() {
  assert.equal(CANONICAL_ROUTER_COMPILER_VERSION, 'pulse.canonical-router-compiler.v2');
  assert.equal(CANONICAL_ROUTER_AUTHORING_VERSION, 'pulse.router-authoring.v2');
  assert.equal(CANONICAL_ROUTER_EXECUTION_VERSION, 'pulse.router-terminal-execution.v1');

  const tempRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-router-terminal-middleware-'));
  try {
    const compiledA = compileAt(path.join(tempRoot, 'copy-a'));
    const compiledB = compileAt(path.join(tempRoot, 'copy-b'));
    assert.equal(compiledA.generatedSource, compiledB.generatedSource, 'terminal Router lowering must be checkout-independent');
    assert.equal(compiledA.metadata.loweredSourceHash, compiledB.metadata.loweredSourceHash);
    assert.equal(compiledA.metadata.router.executionVersion, CANONICAL_ROUTER_EXECUTION_VERSION);
    assert.deepEqual(compiledA.metadata.router.semantics, {
      nextIsTerminal: true,
      onionResume: false,
      normalExhaustionStatus: 404,
      errorExhaustionStatus: 500,
      explicitErrorTransfer: 'return next(error)'
    });

    const entries = compiledA.metadata.router.entries;
    assert.deepEqual(entries.map((entry) => entry.kind), [
      'use', 'use', 'mount', 'use', 'route', 'route', 'route', 'route', 'error', 'error'
    ]);
    assert.equal(entries[1].scoped, true);
    assert.equal(entries[1].pattern, '/admin/*');
    assert.equal(entries[2].childStartIndex, 3);
    assert.equal(entries[2].parentContinueIndex, 8);

    const planA = buildCanonicalNativePlan(compiledA);
    const planB = buildCanonicalNativePlan(compiledB);
    assert.equal(planA.planHash, planB.planHash);
    assert.equal(stableStringify(planA), stableStringify(planB));
    assert.equal(planA.effects.length, 1, 'middleware fetch must be lowered exactly once');
    assert.equal(planA.continuations.length, 1);
    const middlewareEntry = entries[0];
    for (const record of [planA.effects[0], planA.continuations[0]]) {
      assert.equal(record.routerEntryStableId, middlewareEntry.stableId);
      assert.equal(record.routerEntryKind, 'use');
      assert.equal(record.routerEntryIndex, 0);
      assert.equal(record.routeStableId, undefined);
    }
    assert.equal(compiledA.metadata.providerOperations[0].routerEntryStableId, middlewareEntry.stableId);
    assert.equal(compiledA.metadata.providerOperations[0].routerEntryKind, 'use');

    const portableA = compileCanonicalNativePlan(planA, { cwd: repoRoot });
    const portableB = compileCanonicalNativePlan(planB, { cwd: os.tmpdir() });
    assert.deepEqual(portableA.wasm, portableB.wasm, 'portable middleware Wasm must be deterministic');

    const fastlyA = fastly.compileFastlyNativePlatformCapabilitiesPlan(planA, {
      cwd: repoRoot,
      bindings: { effectBackends: { [planA.effects[0].id]: 'auth' } },
      requirePlatformCapability: false,
      canonicalBuild: true
    });
    const fastlyB = fastly.compileFastlyNativePlatformCapabilitiesPlan(planB, {
      cwd: os.tmpdir(),
      bindings: { effectBackends: { [planB.effects[0].id]: 'auth' } },
      requirePlatformCapability: false,
      canonicalBuild: true
    });
    assert.deepEqual(fastlyA.wasm, fastlyB.wasm, 'native Fastly middleware Wasm must be deterministic');
    assert.equal(fastlyA.inspection.imports.some((entry) => /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)), false);

    const program = loadCanonicalModule(compiledA);
    const cases = [
      {
        name: 'global middleware short-circuits',
        authAllowed: false,
        request: request('/admin/items/42', { 'x-area': 'admin', 'x-child': 'ready' }),
        expected: { status: 401, body: '{"blocked":true}' }
      },
      {
        name: 'scoped middleware short-circuits only its subtree',
        authAllowed: true,
        request: request('/admin/items/42', { 'x-child': 'ready' }),
        expected: { status: 403, body: 'area denied' }
      },
      {
        name: 'mounted middleware short-circuits',
        authAllowed: true,
        request: request('/admin/items/42', { 'x-area': 'admin' }),
        expected: { status: 409, body: 'child denied' }
      },
      {
        name: 'first matching route handles request',
        authAllowed: true,
        request: request('/admin/items/42', { 'x-area': 'admin', 'x-child': 'ready', 'x-owner': 'primary' }),
        expected: { status: 200, body: '{"handler":"primary","id":"42"}' }
      },
      {
        name: 'route fallthrough reaches next matching route',
        authAllowed: true,
        request: request('/admin/items/42', { 'x-area': 'admin', 'x-child': 'ready' }),
        expected: { status: 200, body: '{"handler":"fallback","id":"42"}' }
      },
      {
        name: 'normal lane exhaustion returns 404',
        authAllowed: true,
        request: request('/missing'),
        expected: { status: 404, body: 'Not Found' }
      },
      {
        name: 'next(error) reaches error middleware',
        authAllowed: true,
        request: request('/admin/handled-error', { 'x-area': 'admin', 'x-child': 'ready' }),
        expected: { status: 418, body: '{"handled":"boom"}' }
      },
      {
        name: 'error lane exhaustion returns 500',
        authAllowed: true,
        request: request('/admin/unhandled-error', { 'x-area': 'admin', 'x-child': 'ready' }),
        expected: { status: 500, body: 'Internal Server Error' }
      }
    ];

    for (const testCase of cases) {
      const javascriptResult = await executeJavaScript(program, testCase);
      const portableResult = await executePortable(portableA, testCase);
      const fastlyResult = executeFastly(fastlyA, testCase);
      assertResponse(javascriptResult, testCase.expected);
      assertResponse(portableResult, testCase.expected);
      assertResponse(fastlyResult, testCase.expected);
    }

    const base = `import { Router } from '@pulse-compute/runtime'; const app = new Router();`;
    assertRouterDiagnostic(`${base} app.use((ctx, next) => { next(); return ctx.text('bad'); }); app.get('/', (ctx) => ctx.text('ok')); export default app;`, 'PULSE_CANONICAL_ROUTER_NEXT_NOT_TERMINAL');
    assertRouterDiagnostic(`${base} app.use((ctx, next) => { const value = next(); return value; }); app.get('/', (ctx) => ctx.text('ok')); export default app;`, 'PULSE_CANONICAL_ROUTER_NEXT_NOT_TERMINAL');
    assertRouterDiagnostic(`${base} app.use((ctx, next) => { return next('a', 'b'); }); app.get('/', (ctx) => ctx.text('ok')); export default app;`, 'PULSE_CANONICAL_ROUTER_NEXT_ARITY');
    assertRouterDiagnostic(`${base} app.use((ctx, next) => { return next(); return ctx.text('bad'); }); app.get('/', (ctx) => ctx.text('ok')); export default app;`, 'PULSE_CANONICAL_ROUTER_UNREACHABLE_AFTER_TERMINAL');
    assertRouterDiagnostic(`${base} app.use((ctx, next) => { if (ctx.req.path === '/') return next(); }); app.get('/', (ctx) => ctx.text('ok')); export default app;`, 'PULSE_CANONICAL_ROUTER_HANDLER_FALLTHROUGH');
    assertRouterDiagnostic(`${base} app.use((ctx, next) => { return ctx.text(ctx.param('id')); }); app.get('/:id', (ctx) => ctx.text('ok')); export default app;`, 'PULSE_CANONICAL_ROUTER_PARAM_OUTSIDE_ROUTE');
    assertRouterDiagnostic(`${base} app.use((ctx, next) => { throw new Error('boom'); }); app.get('/', (ctx) => ctx.text('ok')); export default app;`, 'PULSE_CANONICAL_ROUTER_THROW_UNSUPPORTED');
    assertRouterDiagnostic(`${base} app.get('/', (ctx) => ctx.resolve(ctx.fetch('https://example.test'))); export default app;`, 'PULSE_CANONICAL_ROUTER_RESOLVE_RETIRED');

    const proof = {
      version: 'pulse.router-terminal-middleware-proof.v1',
      compilerVersion: CANONICAL_ROUTER_COMPILER_VERSION,
      authoringVersion: CANONICAL_ROUTER_AUTHORING_VERSION,
      executionVersion: CANONICAL_ROUTER_EXECUTION_VERSION,
      semantics: compiledA.metadata.router.semantics,
      entries: entries.map((entry) => ({
        stableId: entry.stableId,
        index: entry.index,
        nextIndex: entry.nextIndex,
        kind: entry.kind,
        path: entry.path,
        pattern: entry.pattern,
        scoped: entry.scoped,
        routeStableId: entry.routeStableId
      })),
      middlewareEffect: {
        id: planA.effects[0].id,
        continuationId: planA.continuations[0].id,
        routerEntryStableId: planA.effects[0].routerEntryStableId,
        routerEntryKind: planA.effects[0].routerEntryKind
      },
      cases: cases.map((entry) => ({ name: entry.name, expected: entry.expected })),
      portableWasm: { bytes: portableA.wasm.length, sha256: portableA.inspection.sha256 },
      fastlyWasm: { bytes: fastlyA.wasm.length, sha256: fastlyA.inspection.sha256 }
    };
    if (proofOutputFile) {
      fs.mkdirSync(path.dirname(proofOutputFile), { recursive: true });
      fs.writeFileSync(proofOutputFile, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(proof, null, 2));
    console.log('ok - terminal Router middleware, scoped mounts, route fallthrough, error transfer, 404/500 exhaustion, and middleware effects execute identically through JavaScript, portable Wasm, and native Fastly Wasm');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
