#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  repoRoot,
  run,
  parseJson,
  parseError,
  waitForJsonEvent,
  waitForClose,
  spawnDev
} = require('./helpers.cjs');

const expectedSchemaIds = Object.freeze([
  'app.CreateUserInput',
  'app.OriginUser',
  'app.UserResponse'
]);

function copyFixture(target) {
  const source = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects', 'schema-json');
  fs.cpSync(source, target, { recursive: true });
  fs.rmSync(path.join(target, 'dist'), { recursive: true, force: true });
  fs.rmSync(path.join(target, 'dist-fastly'), { recursive: true, force: true });
  const packageScope = path.join(target, 'node_modules', '@pulse-compute');
  fs.mkdirSync(packageScope, { recursive: true });
  fs.symlinkSync(
    path.join(repoRoot, 'wasm', 'packages', 'contracts'),
    path.join(packageScope, 'wasm-contracts'),
    'dir'
  );
  const jsonAsRoot = fs.realpathSync(path.join(repoRoot, 'wasm', 'packages', 'compiler', 'node_modules', 'json-as'));
  fs.symlinkSync(jsonAsRoot, path.join(target, 'node_modules', 'json-as'), 'dir');
  fs.symlinkSync(
    fs.realpathSync(path.join(path.dirname(jsonAsRoot), 'xjb-as')),
    path.join(target, 'node_modules', 'xjb-as'),
    'dir'
  );
  const handlerFile = path.join(target, 'src', 'index.ts');
  const handlerSource = fs.readFileSync(handlerFile, 'utf8')
    .replace("from './schemas';", "from './schemas.js';")
    .replace('export default function handler(ctx: PulseContext): PulseResult {', 'export default async function handler(ctx: PulseContext): Promise<PulseResult> {')
    .replace('const first = ctx.req.json', 'const first = await ctx.req.json')
    .replace('const second = ctx.req.json', 'const second = await ctx.req.json')
    .replace('const origin = ctx.fetch', 'const origin = await ctx.fetch');
  fs.writeFileSync(handlerFile, handlerSource);
  fs.mkdirSync(path.join(target, '.pulse'), { recursive: true });
  fs.mkdirSync(path.join(target, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(target, 'src', 'schemas.ts'), `import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema';

export interface CreateUserInput {
  name: string;
  active: boolean;
}

export interface OriginUser {
  id: number;
  score: number;
}

export interface UserResponse {
  id: number;
  name: string;
  score: number;
  active: boolean;
  sameReference: boolean;
}

export default defineSchemaRegistry({
  schemas: {
    'app.CreateUserInput': schema<CreateUserInput>(),
    'app.OriginUser': schema<OriginUser>(),
    'app.UserResponse': schema<UserResponse>(),
  },
});
`);
  fs.writeFileSync(path.join(target, 'tests', 'pulse.harness.ts'), `const validRequest = {
  method: 'POST',
  path: '/users',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Ada', active: true, ignored: 'projected-out' }),
};

const validFetch = {
  'https://api.example.test/users/7': {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    value: { id: 7, score: 98.5, ignored: true },
  },
};

export default { cases: [
  {
    name: 'schema-roundtrip',
    request: validRequest,
    fetches: validFetch,
    expect: {
      status: 201,
      headers: { 'x-pulse-schema': 'app.UserResponse' },
      json: { id: 7, name: 'Ada', score: 98.5, active: true, sameReference: true },
    },
  },
  {
    name: 'request-invalid-json',
    request: { ...validRequest, body: '{bad-json' },
    expect: { error: { name: 'SchemaDecodeError', code: 'PULSE_SCHEMA_JSON_MALFORMED' } },
  },
  {
    name: 'request-invalid-field',
    request: { ...validRequest, body: JSON.stringify({ name: 12, active: true }) },
    expect: { error: { name: 'SchemaDecodeError', code: 'PULSE_SCHEMA_DECODE' } },
  },
  {
    name: 'request-content-type',
    request: { ...validRequest, headers: { 'content-type': 'text/plain' } },
    expect: { error: { name: 'SchemaDecodeError', code: 'PULSE_SCHEMA_CONTENT_TYPE' } },
  },
  {
    name: 'origin-invalid-field',
    request: validRequest,
    fetches: {
      'https://api.example.test/users/7': {
        status: 200,
        headers: { 'content-type': 'application/json' },
        value: { id: 'wrong', score: 98.5 },
      },
    },
    expect: { error: { name: 'SchemaDecodeError', code: 'PULSE_SCHEMA_DECODE' } },
  },
  {
    name: 'response-invalid-field',
    request: { ...validRequest, path: '/bad-response' },
    expect: { error: { name: 'SchemaEncodeError', code: 'PULSE_SCHEMA_ENCODE' } },
  },
  {
    name: 'request-too-large',
    request: { ...validRequest, body: JSON.stringify({ name: 'x'.repeat(300), active: true }) },
    expect: { error: { name: 'BodyTooLargeError', code: 'PULSE_BODY_TOO_LARGE' } },
  },
] };
`);
  fs.writeFileSync(path.join(target, '.pulse', 'config.ts'), `import { defineConfig } from '@pulse-compute/pulse';

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'node',
    strict: true,
  },
  node: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    schemas: {
      contentTypePolicy: 'accept-json-or-missing',
      maxBytes: 256,
    },
    dev: {
      host: '127.0.0.1',
      port: 0,
      watch: true,
      networkFetch: false,
      fetches: {
        'https://api.example.test/users/7': {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          value: { id: 7, score: 98.5, ignored: true },
        },
      },
    },
  },
  fastly: {
    host: 'fastly',
    target: 'native',
    outDir: 'dist-fastly',
    schemas: {
      contentTypePolicy: 'accept-json-or-missing',
      maxBytes: 256,
    },
    dev: { networkFetch: false },
    fastly: {
      bindings: {
        configStore: 'pulse_config',
        secretStore: 'pulse_secrets',
        backends: { 'https://api.example.test': 'api_backend' },
        dynamicBackends: false,
      },
    },
  },
}));
`);
}

function parseNonzeroJson(result, expectedStatus, stream = 'stdout') {
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result[stream]);
}

function assertNestedJsonCli(projectRoot) {
  copyFixture(projectRoot);
  const schemaFile = path.join(projectRoot, 'src', 'schemas.ts');
  const schemaSource = `import { defineSchemaRegistry, schema, type JsonObject, type JsonValue, type OpenObject } from '@pulse-compute/pulse/schema';
type Event = OpenObject<{ properties: JsonObject; data?: JsonValue; context: OpenObject<{ source: string }> }>
export default defineSchemaRegistry({ schemas: {
  'app.Event': schema<Event>({ json: { maxDepth: 8, maxNodes: 32 } }),
} });
`;
  fs.writeFileSync(schemaFile, schemaSource);
  fs.writeFileSync(path.join(projectRoot, 'src', 'index.ts'), `export default async function handler(ctx) {
  const value = await ctx.req.json('app.Event');
  const sent = await ctx.fetch('https://api.example.test/users/7', { method: 'POST', json: value, schema: 'app.Event' }).text();
  return ctx.json(value, { schema: 'app.Event' });
}
`);
  const value = { properties: { items: [null, { active: true, label: 'é😀' }] }, data: [0, false], context: { source: 'cli', extra: [{ active: true }] }, extension: { array: [] } };
  fs.writeFileSync(path.join(projectRoot, 'tests', 'pulse.harness.ts'), `export default { cases: [{
  name: 'nested-json',
  request: { method: 'POST', path: '/', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(value))} },
  fetches: { 'https://api.example.test/users/7': { status: 200, body: 'stored' } },
  expect: { status: 200, json: ${JSON.stringify(value)} },
}] };
`);
  const inspected = parseJson(run(['inspect', '--profile', 'node', '--json'], projectRoot));
  const schema = inspected.compiler.schemas.registry.schemas[0];
  assert.deepEqual(schema.root.additionalProperties, { kind: 'json-value' });
  assert.equal(schema.jsonLimits.maxDepth, 8);
  assert.equal(schema.jsonLimits.maxNodes, 32);
  assert.equal(schema.jsonLimits.maxArrayItems, 1024);
  assert.ok(JSON.stringify(schema.root).includes('json-object'));
  assert.ok(JSON.stringify(schema.root).includes('json-value'));
  for (const profile of ['node', 'fastly']) {
    const tested = parseJson(run(['test', '--profile', profile, '--json'], projectRoot, { timeout: 60000 }));
    assert.deepEqual(tested.summary, { total: 1, passed: 1, failed: 0 });
    const built = parseJson(run(['build', '--profile', profile, '--json'], projectRoot, { timeout: 120000 }));
    assert.equal(built.status, 'built');
    const out = path.join(projectRoot, profile === 'node' ? 'dist' : 'dist-fastly');
    const registry = JSON.parse(fs.readFileSync(path.join(out, 'schema-json-registry.json'), 'utf8'));
    assert.deepEqual(registry.schemas, inspected.compiler.schemas.registry.schemas);
    const codecs = require(path.join(out, 'schema-json-codecs.cjs'));
    const decoded = codecs.decodeJsonText('app.Event', JSON.stringify(value));
    assert.deepEqual(decoded, value);
    assert.ok(Object.isFrozen(decoded.properties.items[1]));
    assert.ok(Object.isFrozen(decoded.context.extra[0]));
    assert.throws(() => codecs.encodeJsonText('app.Event', { ...value, context: { source: 1 } }), { code: 'PULSE_SCHEMA_ENCODE' });
    assert.throws(() => codecs.decodeJsonText('app.Event', JSON.stringify(value).replace('"source":"cli"', '"source":"cli","source":"duplicate"')));
  }
  fs.writeFileSync(schemaFile, schemaSource.replace('maxDepth: 8', 'maxDepth: 0'));
  const invalid = parseNonzeroJson(run(['doctor', '--profile', 'node', '--json'], projectRoot), 3, 'stderr');
  assert.equal(invalid.error.code, 'PULSE_SCHEMA_JSON_LIMITS_INVALID');
  assert.equal(invalid.error.scope, 'public');
  assert.match(invalid.error.docs, /#pulse-schema-json-limits-invalid$/);
  fs.writeFileSync(schemaFile, schemaSource.replace('maxDepth: 8', 'maxDepth: 129'));
  const unsupported = parseError(run(['build', '--profile', 'node', '--json'], projectRoot, { timeout: 60000 }), 3);
  assert.equal(unsupported.error.code, 'PULSE_SCHEMA_JSON_DEPTH_UNSUPPORTED');
}

async function main() {
  const parent = process.env.PULSEWASM_TEST_TMP_ROOT
    ? path.join(process.env.PULSEWASM_TEST_TMP_ROOT, 'schema-json-cli')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-schema-json-'));
  const ownsParent = !process.env.PULSEWASM_TEST_TMP_ROOT;
  fs.mkdirSync(parent, { recursive: true });
  const projectRoot = path.join(parent, 'project');
  const children = new Set();

  try {
    copyFixture(projectRoot);

    const inspected = parseJson(run(['inspect', '--profile', 'node', '--json'], projectRoot));
    assert.equal(inspected.status, 'ok');
    assert.equal(inspected.project.schemas.active, true);
    assert.deepEqual(inspected.project.schemas.ids, expectedSchemaIds);
    assert.equal(inspected.compiler.schemas.active, true);
    assert.deepEqual(inspected.compiler.schemas.registry.schemas.map((entry) => entry.id), expectedSchemaIds);
    assert.deepEqual(inspected.compiler.schemas.unused, []);
    assert.equal(inspected.compiler.schemas.references.length, 5);
    assert.deepEqual(
      [...new Set(inspected.compiler.schemas.references.map((entry) => entry.usage))].sort(),
      ['fetch-decode', 'request-decode', 'response-encode']
    );
    assert.match(inspected.compiler.schemas.sourceHash, /^[a-f0-9]{64}$/);

    const doctor = parseJson(run(['doctor', '--profile', 'node', '--json'], projectRoot));
    assert.equal(doctor.status, 'passed');
    const schemaCheck = doctor.checks.find((entry) => entry.id === 'schemas');
    assert.equal(schemaCheck.status, 'passed');
    assert.deepEqual(schemaCheck.detail.ids, expectedSchemaIds);
    assert.ok(schemaCheck.detail.dependencies.includes('src/schemas.ts'));

    const nativeCompiled = parseJson(run(['compile', '--profile', 'node', '--out', 'dist-native', '--json'], projectRoot, { timeout: 60000 }));
    assert.equal(nativeCompiled.status, 'compiled');
    assert.equal(nativeCompiled.provider, null);
    assert.equal(nativeCompiled.providerNeutral, true);
    assert.equal(nativeCompiled.configuredProvider, 'node');
    assert.equal(nativeCompiled.manifest.schemas.active, true);
    assert.deepEqual(nativeCompiled.manifest.schemas.ids, expectedSchemaIds);
    assert.ok(nativeCompiled.native.wasm.bytes > 0 && nativeCompiled.native.wasm.bytes < 128 * 1024);
    assert.deepEqual(nativeCompiled.native.importModules, ['env', 'pulse_host']);
    const nativeWasm = fs.readFileSync(path.join(projectRoot, 'dist-native', 'canonical-native.wasm'));
    assert.equal(WebAssembly.validate(nativeWasm), true);
    assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(nativeWasm)).some((entry) => /fastly|wasi|js-compute/i.test(`${entry.module}:${entry.name}`)), false);

    const tested = parseJson(run(['test', '--profile', 'node', '--json'], projectRoot, { timeout: 60000 }));
    assert.equal(tested.status, 'passed');
    assert.deepEqual(tested.summary, { total: 7, passed: 7, failed: 0 });
    assert.deepEqual(tested.metadata.schemaIds, expectedSchemaIds);
    assert.equal(tested.metadata.schemaReferenceCount, 5);

    const built = parseJson(run(['build', '--profile', 'node', '--json'], projectRoot, { timeout: 60000 }));
    assert.equal(built.status, 'built');
    for (const file of ['canonical-handler.cjs', 'canonical-program.json', 'pulse-build.json', 'schema-json-registry.json', 'schema-json-codecs.cjs']) {
      assert.equal(fs.existsSync(path.join(projectRoot, 'dist', file)), true, `schema-aware Node build should emit ${file}`);
    }
    assert.equal(built.manifest.schemas.active, true);
    assert.deepEqual(built.manifest.schemas.ids, expectedSchemaIds);
    assert.equal(built.manifest.schemas.sourceHash, inspected.compiler.schemas.sourceHash);

    const registry = JSON.parse(fs.readFileSync(path.join(projectRoot, 'dist', 'schema-json-registry.json'), 'utf8'));
    assert.equal(registry.sourceHash, inspected.compiler.schemas.sourceHash);
    assert.deepEqual(registry.schemas.map((entry) => entry.id), expectedSchemaIds);

    const codecs = require(path.join(projectRoot, 'dist', 'schema-json-codecs.cjs'));
    assert.deepEqual(codecs.ids, expectedSchemaIds);
    assert.deepEqual(
      codecs.decode('app.CreateUserInput', { name: 'Ada', active: true, ignored: 'projected-out' }, 'test'),
      { name: 'Ada', active: true }
    );
    assert.throws(
      () => codecs.decode('app.OriginUser', { id: 'wrong', score: 1 }, 'test'),
      (error) => error.name === 'SchemaDecodeError' && error.code === 'PULSE_SCHEMA_DECODE'
    );
    assert.throws(
      () => codecs.encode('app.UserResponse', { id: 'wrong', name: 'Ada', score: 1, active: true, sameReference: true }, 'test'),
      (error) => error.name === 'SchemaEncodeError' && error.code === 'PULSE_SCHEMA_ENCODE'
    );
    const handlerModule = require(path.join(projectRoot, 'dist', 'canonical-handler.cjs'));
    assert.deepEqual(handlerModule.schemaCodecs.ids, expectedSchemaIds);
    assert.equal(handlerModule.metadata.schemaSourceHash, registry.sourceHash);

    const fastlyInspect = parseJson(run(['inspect', '--profile', 'fastly', '--json'], projectRoot));
    assert.equal(fastlyInspect.project.provider, 'fastly');
    assert.equal(fastlyInspect.compiler.schemas.sourceHash, inspected.compiler.schemas.sourceHash);
    assert.deepEqual(fastlyInspect.compiler.schemas.registry, inspected.compiler.schemas.registry);

    const fastlyTest = parseJson(run(['test', '--profile', 'fastly', '--json'], projectRoot, { timeout: 60000 }));
    assert.equal(fastlyTest.status, 'passed');
    assert.deepEqual(fastlyTest.summary, { total: 7, passed: 7, failed: 0 });

    const fastlyBuild = parseJson(run(['build', '--profile', 'fastly', '--json'], projectRoot, { timeout: 120000 }));
    assert.equal(fastlyBuild.status, 'built');
    for (const file of ['schema-json-registry.json', 'schema-json-codecs.cjs', 'canonical-handler.cjs', 'canonical-native-plan.json', 'canonical-native.wasm', 'src/main.as.ts', 'fastly-build.json', 'bin/main.wasm']) {
      assert.equal(fs.existsSync(path.join(projectRoot, 'dist-fastly', file)), true, `schema-aware Fastly build should emit ${file}`);
    }
    const fastlyRegistry = JSON.parse(fs.readFileSync(path.join(projectRoot, 'dist-fastly', 'schema-json-registry.json'), 'utf8'));
    assert.deepEqual(fastlyRegistry, registry, 'Node and Fastly builds must consume the same compiled schema registry');
    const fastlyBuildMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'dist-fastly', 'fastly-build.json'), 'utf8'));
    assert.equal(fastlyBuildMetadata.schemas.active, true);
    assert.deepEqual(fastlyBuildMetadata.schemas.ids, expectedSchemaIds);
    assert.equal(fastlyBuildMetadata.schemas.sourceHash, registry.sourceHash);
    assert.equal(fastlyBuildMetadata.sourceHash, built.metadata.sourceHash);
    assert.equal(fastlyBuildMetadata.projectSourceHash, built.metadata.projectSourceHash);
    assert.equal(fastlyBuildMetadata.handlerSourceHash, built.metadata.sourceHash);
    assert.equal(fastlyBuildMetadata.sourceOnly, false);
    assert.equal(fastlyBuildMetadata.compiledWasmPresent, true);
    assert.equal(fastlyBuildMetadata.target, 'fastly-compute-native');
    assert.equal(fastlyBuildMetadata.javascriptRuntime, false);
    assert.equal(fastlyBuildMetadata.jsComputeRuntime, false);
    assert.equal(fastlyBuildMetadata.compiler.package, 'assemblyscript');
    assert.equal(fastlyBuildMetadata.compiler.version, '0.28.18');
    const fastlyWasm = fs.readFileSync(path.join(projectRoot, 'dist-fastly', 'bin', 'main.wasm'));
    assert.equal(fastlyWasm.subarray(0, 8).toString('hex'), '0061736d01000000');
    assert.equal(fastlyBuildMetadata.wasm.bytes, fastlyWasm.length);
    assert.equal(fastlyBuildMetadata.wasm.sha256, crypto.createHash('sha256').update(fastlyWasm).digest('hex'));
    assert.equal(fastlyBuildMetadata.wasm.magic, '0061736d01000000');
    const sourceEntry = fs.readFileSync(path.join(projectRoot, 'dist-fastly', 'src', 'main.as.ts'), 'utf8');
    assert.match(sourceEntry, /fastly_http_req/);
    assert.match(sourceEntry, /__pulse_fastly_schema/);
    assert.doesNotMatch(sourceEntry, /js-compute-runtime|Promise/);
    const fastlyImports = WebAssembly.Module.imports(new WebAssembly.Module(fastlyWasm));
    assert.ok(fastlyImports.some((entry) => entry.module === 'fastly_abi' && entry.name === 'init'));
    assert.equal(fastlyImports.some((entry) => /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)), false);

    const experimentalFastlyBuild = parseJson(run([
      'build',
      '--profile', 'fastly',
      '--out', 'dist-fastly-experimental',
      '--experimental-native-size',
      '--json'
    ], projectRoot, { timeout: 120000 }));
    const expectedOptimization = {
      version: 'pulse.native-optimization.v1',
      mode: 'experimental-native-size',
      experimental: true,
      goal: 'size',
      assemblyScript: {
        optimize: true,
        optimizeLevel: 3,
        shrinkLevel: 2,
        converge: true
      }
    };
    assert.deepEqual(experimentalFastlyBuild.manifest.providerTarget.optimization, expectedOptimization);
    const experimentalFastlyMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'dist-fastly-experimental', 'fastly-build.json'), 'utf8'));
    const experimentalNativeMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'dist-fastly-experimental', 'fastly-native-manifest.json'), 'utf8'));
    assert.deepEqual(experimentalFastlyMetadata.optimization, expectedOptimization);
    assert.deepEqual(experimentalNativeMetadata.optimization, expectedOptimization);
    const experimentalFastlyWasm = fs.readFileSync(path.join(projectRoot, 'dist-fastly-experimental', 'bin', 'main.wasm'));
    assert.ok(experimentalFastlyWasm.length < fastlyWasm.length, 'experimental O3z optimization should reduce the schema-aware Fastly Native module');
    assert.deepEqual(
      WebAssembly.Module.imports(new WebAssembly.Module(experimentalFastlyWasm)),
      WebAssembly.Module.imports(new WebAssembly.Module(fastlyWasm)),
      'experimental size optimization must preserve the Fastly import surface'
    );
    assert.deepEqual(
      WebAssembly.Module.exports(new WebAssembly.Module(experimentalFastlyWasm)),
      WebAssembly.Module.exports(new WebAssembly.Module(fastlyWasm)),
      'experimental size optimization must preserve the Fastly export surface'
    );

    const missingRoot = path.join(parent, 'missing-schema');
    copyFixture(missingRoot);
    const missingHandler = path.join(missingRoot, 'src', 'index.ts');
    fs.writeFileSync(missingHandler, fs.readFileSync(missingHandler, 'utf8').replace("'app.OriginUser'", "'app.MissingOrigin'"));
    const missing = parseError(run(['inspect', '--profile', 'node', '--json'], missingRoot), 3);
    assert.equal(missing.error.code, 'PULSE_CANONICAL_COMPILE_FAILED');
    assert.ok(missing.error.diagnostics.some((entry) => entry.code === 'PULSE_CANONICAL_SCHEMA_MISSING'));

    const dynamicRoot = path.join(parent, 'dynamic-schema');
    copyFixture(dynamicRoot);
    const dynamicHandler = path.join(dynamicRoot, 'src', 'index.ts');
    fs.writeFileSync(dynamicHandler, fs.readFileSync(dynamicHandler, 'utf8').replace("ctx.req.json<CreateUserInput>('app.CreateUserInput')", 'ctx.req.json<CreateUserInput>(ctx.req.path)'));
    const dynamic = parseError(run(['inspect', '--profile', 'node', '--json'], dynamicRoot), 3);
    assert.ok(dynamic.error.diagnostics.some((entry) => entry.code === 'PULSE_CANONICAL_SCHEMA_ID_LITERAL_REQUIRED'));

    const badSourceRoot = path.join(parent, 'bad-schema-source');
    copyFixture(badSourceRoot);
    const badSchema = path.join(badSourceRoot, 'src', 'schemas.ts');
    fs.writeFileSync(badSchema, fs.readFileSync(badSchema, 'utf8').replace('schema<CreateUserInput>()', 'schema<MissingInput>()'));
    const badDoctorResult = run(['doctor', '--profile', 'node', '--json'], badSourceRoot);
    const badDoctor = parseNonzeroJson(badDoctorResult, 3, 'stderr');
    assert.equal(badDoctor.status, 'error');
    assert.equal(badDoctor.error.code, 'PULSE_SCHEMA_TYPE_NOT_FOUND');
    assert.equal(badDoctor.error.detail.typeName, 'MissingInput');
    assert.equal(badDoctor.error.detail.source.file, 'src/schemas.ts');

    const watched = spawnDev(['dev', '--profile', 'node', '--port', '0', '--watch', '--json'], projectRoot, children);
    const ready = await waitForJsonEvent(watched.child, 'ready', watched.stderrText);
    assert.equal(ready.watch, true);
    assert.ok(ready.watchFiles.includes('src/index.ts'));
    assert.ok(ready.watchFiles.includes('src/schemas.ts'), 'pulse dev must watch schema source dependencies');
    const reloadPromise = waitForJsonEvent(watched.child, 'reloaded', watched.stderrText);
    fs.appendFileSync(path.join(projectRoot, 'src', 'schemas.ts'), '\n// schema dependency watch proof\n');
    const reloaded = await reloadPromise;
    assert.ok(reloaded.watchFiles.includes('src/schemas.ts'));
    assert.equal(reloaded.schemaSourceHash, registry.sourceHash);
    watched.child.kill('SIGTERM');
    await waitForClose(watched.child, watched.stderrText);

    assertNestedJsonCli(path.join(parent, 'nested-json'));

    console.log('ok - pulse CLI compiles explicit TypeScript JSON schemas, links exact handler references, executes shared Node/Fastly codecs, emits registry/codecs for both targets, rejects invalid references, and reloads schema dependencies');
  } finally {
    for (const child of children) { try { child.kill('SIGKILL'); } catch (_) { /* best effort */ } }
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
