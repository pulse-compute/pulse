#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LOWERABLE_LIBRARY_MANIFEST_KIND,
  LOWERABLE_LIBRARY_MANIFEST_VERSION
} = require('../../packages/contracts/src/library/manifest.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

function includesAll(source, values, label) {
  for (const value of values) {
    assert.equal(source.includes(value), true, `${label} is missing ${value}`);
  }
}

const express = read('docs/guides/migrating-from-express.md');
includesAll(express, [
  'not an Express-compatible runtime or a drop-in replacement',
  '`new Pulse({ auto: true })`',
  '`ctx.req.header(\'name\')`',
  '`ctx.param(\'id\')`',
  '`ctx.state.get()` / `ctx.state.set()`',
  '`return next()` permanently finishes this middleware',
  '`put`, `patch`, `delete`, `mount`, and `error`',
  'does not support `options`, `trace`, `connect`',
  '`pulse dev` / `pulse build` plus a provider',
  'Express middleware packages cannot be mounted directly',
  'Pulse never changes targets or falls back automatically'
], 'Express migration guide');
assert.doesNotMatch(express, /drop-in replacement for Express/i);

const runtimeTypes = read('packages/runtime/src/index.d.ts');
const routerDeclaration = /export declare class Router \{([\s\S]*?)\n\}/.exec(runtimeTypes);
assert.ok(routerDeclaration, 'runtime declarations must expose Router');
for (const method of ['use', 'get', 'head', 'post', 'put', 'patch', 'delete', 'mount', 'error']) {
  assert.match(routerDeclaration[1], new RegExp(`\\n  ${method}\\(`), `runtime declarations must retain Router.${method}`);
}
for (const unsupported of ['options', 'trace', 'connect']) {
  assert.doesNotMatch(routerDeclaration[1], new RegExp(`\\n  ${unsupported}\\(`), `runtime declarations must not expose Router.${unsupported}`);
}
assert.match(runtimeTypes, /export type RouterNext = \(error\?: unknown\) => never;/);

const schemas = read('docs/guides/json-schemas.md');
includesAll(schemas, [
  'The compiler does not execute the registry module',
  'an object root with required or question-mark optional property signatures',
  'Encoding omits absent optional properties; decoding leaves them absent.',
  'A present `undefined` value is rejected rather',
  '## Add semantic response cases',
  "response(201, 'app.User')",
  "await ctx.req.json<T>('app.Input')",
  "await ctx.fetch(url).json<T>('app.Output')",
  "ctx.fetch(url, { json: value, schema: 'app.Input' })",
  "ctx.json(value, { schema: 'app.Output' })",
  "return ctx.json(user, 'user.created')",
  '`pulse.strict` defaults to `true`',
  '`schemas.contentTypePolicy`',
  '`schemas.maxBytes`',
  'unknown fields of closed declared objects are removed recursively',
  '`ScalarRecord`, `JsonObject` and `JsonValue` preserve their admitted dynamic keys',
  '## Typed open objects',
  'Declared names always select their declared validators.',
  '## Bounded scalar records',
  '## Configurable nested JSON',
  "schema<Event>({ json: { maxDepth: 64, maxNodes: 8192 } })",
  'PULSE_SCHEMA_JSON_DEPTH_UNSUPPORTED',
  'These fixed limits apply independently to every record on encode and decode',
  'Decoding rejects duplicate record keys after JSON unescaping',
  'generic JSON when an ID is missing from the registry'
], 'JSON schema guide');

const schemaTypes = read('packages/pulse/src/schema.d.ts');
includesAll(schemaTypes, [
  'export type ScalarRecord = Readonly<Record<string, string | number | boolean | null>>;',
  'export type JsonValue =',
  'export interface JsonObject',
  'export interface JsonLimits',
  'export declare function schema<Type>(options?: SchemaOptions)',
  'export declare function response<',
  'export declare function defineSchemaRegistry<'
], 'schema authoring declarations');

const bodies = read('docs/concepts/bodies.md');
includesAll(bodies, [
  '## Ownership transitions',
  '| Incoming request text/JSON | Request host owns body bytes',
  '| Opaque fetch or package response | Provider owns the body handle',
  'Provider retains ownership through terminal pass-through',
  'Request-owned values and caches end with that request',
  'cannot be converted into a structured body',
  'deeply immutable value'
], 'body ownership concept');

const lowerer = read('docs/contributing/package-lowerer-contract.md');
const ownerPaths = [
  'packages/assets/pulse.package.json',
  'packages/assets/pulsewasm.manifest.cjs',
  'packages/assets/pulsewasm.compiler.cjs',
  'wasm/packages/contracts/src/assets/contracts.js',
  'packages/grip/pulse.package.json',
  'packages/grip/pulsewasm.manifest.cjs',
  'packages/grip/pulsewasm.compiler.cjs',
  'wasm/packages/contracts/src/grip/contracts.js',
  'wasm/packages/contracts/src/library/manifest.js',
  'wasm/packages/library-kit/src/compiler/handler-library-contracts.js',
  'wasm/packages/compiler/src/project/package-reachability.js',
  'wasm/packages/compiler/src/spine/package-operation-seam.js',
  'wasm/packages/compiler/src/canonical-project-compiler.js',
  'release/pulse-release-manifest.json'
];
includesAll(lowerer, [
  '## Application support and protocol compatibility',
  '## Canonical owner map',
  '## Contract pipeline',
  LOWERABLE_LIBRARY_MANIFEST_VERSION,
  LOWERABLE_LIBRARY_MANIFEST_KIND,
  'build-dependency',
  'first-party'
], 'package lowerer reference');
for (const relative of ownerPaths) {
  assert.equal(fs.existsSync(path.join(repoRoot, relative)), true, `lowerer owner path does not exist: ${relative}`);
  assert.equal(lowerer.includes(`\`${relative}\``), true, `lowerer reference does not cite ${relative}`);
}

for (const relative of [
  'packages/assets/pulsewasm.manifest.cjs',
  'packages/grip/pulsewasm.manifest.cjs'
]) {
  const manifest = require(path.join(repoRoot, relative));
  assert.equal(manifest.version, LOWERABLE_LIBRARY_MANIFEST_VERSION);
  assert.equal(manifest.kind, LOWERABLE_LIBRARY_MANIFEST_KIND);
  assert.equal(manifest.compiler.version, 'pulsewasm.lowerable-compiler-builder.v1');
  assert.equal(manifest.compiler.trust, 'first-party');
}

const lowererTutorial = read('docs/contributing/adding-first-party-lowerer.md');
assert.match(lowererTutorial, /reachable module graph selects participating package contracts/);
assert.match(lowererTutorial, /not entry-source substring discovery/);
assert.doesNotMatch(lowererTutorial, /selects those whose import subpath appears in the entry source/);

async function assertExpressBehavior() {
  const { Router } = require('../../../packages/runtime/src/index.js');
  const { executeRouter } = require('../../../packages/runtime/src/host.js');
  const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler.js');
  const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
  const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
  const snippet = /<!-- pulse-express-input-error:start -->\s*```ts\n([\s\S]*?)```/.exec(express)?.[1];
  assert.ok(snippet, 'the documented input-error handler must remain executable');
  const route = "app.post('/body', async (ctx) => { const text = await ctx.req.text(); return ctx.text(text); });";
  // Compile the exact documented handler, rather than a separately maintained copy.
  const router = compileCanonicalRouterSource(`import { Router } from '@pulse-compute/runtime';
const app = new Router(); ${route} ${snippet} export default app;`, { fileName: 'express-input-error.ts', rootDir: repoRoot });
  const compiled = compileCanonicalSource(router.sourceText, {
    fileName: 'express-input-error.ts', rootDir: repoRoot, compilerPrelude: router.compilerPrelude,
    compilerOwnedCalls: router.compilerOwnedCalls, internalGeneratedHandler: true,
    metadataExtensions: { router: router.metadata }
  });
  assert.ok(buildCanonicalNativePlan(compiled).planHash, 'documented error handler must remain Native-eligible');
  for (const [call, code] of [
    ["app.get('/', async ctx => ctx.text('a'), async ctx => ctx.text('b'))", 'PULSEWASM_ARITY'],
    ["app.get('/', [async ctx => ctx.text('a')])", 'PULSEWASM_UNSUPPORTED_HANDLER']
  ]) {
    assert.throws(() => compileCanonicalRouterSource(
      `import { Router } from '@pulse-compute/runtime'; const app = new Router(); ${call}; export default app;`,
      { fileName: 'express-handler-chain.ts', rootDir: repoRoot }
    ), error => error.diagnostics?.some(item => item.code === code), 'Express handler chains are not admitted registrations');
  }
  const ts = require('typescript');
  const virtualFile = path.join(__dirname, '__express_input_error_typecheck.ts');
  const typeSource = `import { Router } from '../../../packages/runtime/src/index.js'; const app = new Router(); ${snippet}`;
  const compilerOptions = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(compilerOptions);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, ...rest) => file === virtualFile
    ? ts.createSourceFile(file, typeSource, languageVersion, true)
    : getSourceFile(file, languageVersion, ...rest);
  const program = ts.createProgram([virtualFile], compilerOptions, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [],
    'the exact error example must typecheck against the public unknown error parameter');
  const javascript = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const attach = new Function('app', javascript);
  const app = new Router();
  new Function('app', route)(app);
  attach(app);
  const invalid = await executeRouter(app, new Request('https://example.test/body', {
    method: 'POST', body: new Uint8Array([0xc3, 0x28]), headers: { 'content-type': 'text/plain' }
  }));
  assert.equal(invalid.status, 400);
  assert.equal(await invalid.text(), 'Invalid request body');
  const valid = await executeRouter(app, new Request('https://example.test/body', { method: 'POST', body: 'valid' }));
  assert.equal(valid.status, 200);
  assert.equal(await valid.text(), 'valid');
  for (const code of ['PULSE_SCHEMA_JSON_MALFORMED', 'PULSE_SCHEMA_DECODE', 'PULSE_JWT_MALFORMED']) {
    const errors = new Router();
    errors.use(async (_ctx, next) => next(Object.assign(new Error('data failure'), { code })));
    attach(errors);
    errors.error(async (error, ctx) => ctx.text(error.code, { status: 422 }));
    const response = await executeRouter(errors, new Request('https://example.test/'));
    assert.equal(response.status, code === 'PULSE_JWT_MALFORMED' ? 422 : 400);
    assert.equal(await response.text(), code === 'PULSE_JWT_MALFORMED' ? code : 'Invalid request body');
  }
  // Express skip strings (and other defined arguments) are errors, not skips.
  for (const value of ['route', 'router', null, false, 0]) {
    const transfer = new Router();
    const seen = [];
    transfer.use(async (_ctx, next) => { seen.push('start'); return next(value); });
    transfer.get('/', async ctx => { seen.push('skipped'); return ctx.text('wrong'); });
    transfer.error(async (error, _ctx, next) => { assert.equal(error, value); seen.push('recover'); return next(); });
    transfer.get('/', async ctx => { seen.push('tail'); return ctx.text('recovered'); });
    const response = await executeRouter(transfer, new Request('https://example.test/'));
    assert.equal(await response.text(), 'recovered');
    assert.deepEqual(seen, ['start', 'recover', 'tail']);
  }
  const methods = new Router();
  methods.get('/only-get', async ctx => ctx.text('get'));
  for (const method of ['HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await executeRouter(methods, new Request('https://example.test/only-get', { method }))).status, 404);
  }
  methods.head('/only-get', async ctx => ctx.text('', { status: 204 }));
  assert.equal((await executeRouter(methods, new Request('https://example.test/only-get', { method: 'HEAD' }))).status, 204);
  const mounted = new Router();
  const child = new Router();
  child.use(async (ctx, next) => { assert.equal(ctx.param, undefined); return next(); });
  child.post('/users/:id', async ctx => {
    const first = await ctx.req.json();
    const second = await ctx.req.json();
    assert.equal(first, second);
    assert.ok(Object.isFrozen(first) && Object.isFrozen(first.nested));
    return ctx.json({ url: ctx.req.url, path: ctx.req.path, id: ctx.param('id'), tenant: ctx.param('tenant'),
      first: ctx.req.header('X-REPEAT'), pairs: ctx.req.headers });
  });
  mounted.mount('/api/:tenant', child);
  const headers = [['x-repeat', 'first'], ['X-Repeat', 'second'], ['content-type', 'application/json']];
  const url = 'https://example.test/api/acme/users/7?q=1';
  const response = await executeRouter(mounted, new Request(url, { method: 'POST', body: '{"nested":{"value":1}}',
    headers: { 'content-type': 'application/json' } }), { requestHeaders: headers });
  assert.deepEqual(await response.json(), { url, path: '/api/acme/users/7', id: '7', tenant: 'acme', first: 'first', pairs: headers });
}

assertExpressBehavior().then(() => {
  console.log('ok - Express migration example and routing/request traps execute; schema/body/lowering owners match current contracts');
}).catch(error => { console.error(error); process.exitCode = 1; });
