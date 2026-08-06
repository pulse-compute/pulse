#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/entities-native-runtime');
const compilerRoot = path.join(repoRoot, 'wasm/packages/compiler');
process.chdir(repoRoot);

const entitiesLowerer = require('../../../packages/entities/pulsewasm.compiler.cjs');
const entitiesNative = require('../../../packages/entities/pulsewasm.native.cjs');
const graphApi = require('../../packages/compiler/src/project/reachable-graph-builder.js');
const managed = require('../../packages/compiler/src/spine/handler-ir-managed.js');
const registryContract = require('../../packages/contracts/src/schema-json/registry.js');
const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');

const assemblyScriptRoot = path.dirname(require.resolve('assemblyscript/package.json', { paths: [compilerRoot] }));
const asc = path.join(assemblyScriptRoot, 'bin/asc.js');
const jsonAsTransform = require.resolve('json-as', { paths: [compilerRoot] });
const jsonAsRoot = path.resolve(jsonAsTransform, '..', '..', '..');
const jsonAsDependencyRoot = path.dirname(jsonAsRoot);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function schemaSource(line) {
  return Object.freeze({ file: 'src/pulse/schemas.ts', line, column: 1 });
}

function objectSchema(id, fields, line) {
  return Object.freeze({
    id,
    typeName: id.split('.').pop(),
    root: Object.freeze({
      kind: 'object',
      fields: Object.freeze(fields.map(([name, kind], index) => Object.freeze({
        name,
        required: true,
        value: Object.freeze({ kind }),
        source: schemaSource(line + index + 1)
      })))
    }),
    source: schemaSource(line)
  });
}

function schemaBundle() {
  const registry = registryContract.normalizeSchemaRegistry({
    source: schemaSource(1),
    schemas: Object.freeze([
      objectSchema('tools.LookupInput', [['id', 'string']], 10),
      objectSchema('tools.LookupOutput', [['id', 'string'], ['name', 'string']], 20),
      objectSchema('tools.UnrelatedCatalogSchema', [['UNRELATED_SCHEMA_SENTINEL', 'string']], 30)
    ]),
    responses: Object.freeze([])
  });
  return buildCanonicalSchemaBundle(registry, { contentTypePolicy: 'require-json', maxBytes: 32_768 });
}

function descriptorFromEntry(entry) {
  const start = entry.loc && entry.loc.start || { line: 1, column: 1 };
  return Object.freeze({
    version: managed.MANAGED_HANDLER_DESCRIPTOR_VERSION,
    id: `${entry.router}:${entry.discriminator}`,
    role: managed.MANAGED_HANDLER_ROLE,
    origin: Object.freeze({ file: entry.loc.file, line: start.line, column: start.column }),
    source: Object.freeze({
      file: entry.handler.file,
      exportName: entry.handler.exportName,
      localName: entry.handler.localName
    }),
    input: Object.freeze({
      kind: entry.inputSchema === null ? 'empty-value' : 'schema-value',
      schemaId: entry.inputSchema
    }),
    result: Object.freeze({
      kind: entry.outputSchema === null ? 'completion' : 'schema-value',
      schemaId: entry.outputSchema
    })
  });
}

function compileModel(reverse = false) {
  const entryFile = path.join(fixture, 'src/index.ts');
  const schemas = schemaBundle();
  const graphBuild = graphApi.buildReachableProjectGraph(entryFile, {
    rootDir: fixture,
    workspaceRoot: repoRoot,
    configFile: path.join(fixture, 'tsconfig.json')
  });
  const lowered = entitiesLowerer.createEntitiesPackageCompilerBuilder({
    cwd: fixture,
    sourcePath: entryFile,
    sourceText: fs.readFileSync(entryFile, 'utf8'),
    schemaBundle: schemas
  });
  assert.equal(lowered.hasErrors, false, lowered.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('\n'));
  const descriptors = lowered.entries.map(descriptorFromEntry);
  const managedBundle = managed.compileManagedHandlerDescriptors({
    graphBuild,
    descriptors: reverse ? [...descriptors].reverse() : descriptors
  });
  const nativeBundle = managed.compileManagedHandlerNativeBundle(managedBundle);
  const nativeSource = entitiesNative.buildEntitiesNativeSource({
    plan: lowered.artifact.plan,
    managedHandlerNativeBundle: nativeBundle,
    schemaBundle: schemas
  });
  return Object.freeze({ lowered, descriptors, managedBundle, nativeBundle, nativeSource, schemas });
}

function compileWasm(source, root, label) {
  fs.mkdirSync(root, { recursive: true });
  const input = path.join(root, 'entities-native.as.ts');
  const output = path.join(root, `${label}.wasm`);
  const wat = path.join(root, `${label}.wat`);
  fs.writeFileSync(input, source, 'utf8');
  const result = spawnSync(process.execPath, [
    asc,
    path.basename(input),
    '--outFile', output,
    '--textFile', wat,
    '--runtime', 'incremental',
    '--exportRuntime',
    '--exportTable',
    '--noAssert',
    '-O3',
    '--transform', jsonAsTransform,
    '--path', jsonAsDependencyRoot,
    '--path', path.join(compilerRoot, 'node_modules')
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0' },
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return Object.freeze({ bytes: fs.readFileSync(output), wat: fs.readFileSync(wat, 'utf8') });
}

function stringAt(exports, pointer, length) {
  if (pointer <= 0 || length <= 0) return '';
  const view = new Uint16Array(exports.memory.buffer, pointer, length);
  let output = '';
  const chunk = 4096;
  for (let offset = 0; offset < view.length; offset += chunk) output += String.fromCharCode(...view.subarray(offset, Math.min(view.length, offset + chunk)));
  return output;
}

function allocateString(exports, value) {
  const text = String(value);
  const pointer = exports.__new(text.length * 2, exports.pulse_entities_string_id());
  const view = new Uint16Array(exports.memory.buffer, pointer, text.length);
  for (let index = 0; index < text.length; index += 1) view[index] = text.charCodeAt(index);
  return pointer;
}

function instantiate(bytes, resolver) {
  const module = new WebAssembly.Module(bytes);
  let runtimeExports;
  const effects = [];
  const logs = [];
  const instance = new WebAssembly.Instance(module, {
    env: {
      abort() { throw new Error('Entities Native json-as abort'); },
      seed() { return 0; }
    },
    pulse_entities_host: {
      effect_begin(index, pointer, length) {
        const payload = JSON.parse(stringAt(runtimeExports, pointer, length));
        effects.push(Object.freeze({ index, payload }));
      },
      log(level, pointer, length) {
        logs.push(Object.freeze({ level, payload: JSON.parse(stringAt(runtimeExports, pointer, length)) }));
      }
    }
  });
  runtimeExports = instance.exports;

  function execute(body) {
    const requestPointer = allocateString(runtimeExports, body);
    assert.equal(runtimeExports.pulse_entities_set_request(requestPointer), 1);
    let status = runtimeExports.pulse_entities_start();
    let consumed = 0;
    while (status === runtimeExports.pulse_entities_run_suspended()) {
      const pending = effects.slice(consumed);
      assert.ok(pending.length > 0, 'a suspended module must announce at least one effect');
      consumed = effects.length;
      for (const effect of pending) {
        const resolution = resolver(effect);
        const pointer = allocateString(runtimeExports, JSON.stringify(resolution.value));
        assert.equal(runtimeExports.pulse_entities_set_effect_result(effect.index, resolution.ok === false ? 0 : 1, pointer), 1);
      }
      status = runtimeExports.pulse_entities_resume();
    }
    assert.equal(status, runtimeExports.pulse_entities_run_complete());
    return Object.freeze({
      status: runtimeExports.pulse_entities_response_status(),
      body: stringAt(runtimeExports, runtimeExports.pulse_entities_response_ptr(), runtimeExports.pulse_entities_response_length()),
      bodyReads: runtimeExports.pulse_entities_body_read_count(),
      selected: runtimeExports.pulse_entities_selected_index(),
      invocations: [0, 1].map((index) => runtimeExports.pulse_entities_invocation_count(index)),
      effects: Object.freeze([...effects]),
      logs: Object.freeze([...logs])
    });
  }
  return Object.freeze({ module, exports: runtimeExports, execute });
}

function run(bytes, body, resolver = () => ({ value: null })) {
  return instantiate(bytes, resolver).execute(body);
}

const positive = compileModel();
const reordered = compileModel(true);
assert.equal(positive.nativeBundle.version, managed.MANAGED_HANDLER_NATIVE_BUNDLE_VERSION);
assert.equal(positive.nativeBundle.nativeFactsVersion, managed.MANAGED_HANDLER_NATIVE_FACTS_VERSION);
assert.equal(positive.nativeBundle.handlerIrBundleVersion, managed.MANAGED_HANDLER_IR_BUNDLE_VERSION);
assert.equal(positive.nativeBundle.summary.handlers, 2);
assert.equal(positive.nativeBundle.summary.effects, 2);
assert.ok(positive.nativeBundle.summary.runtimeInputs >= 2);
assert.equal(positive.nativeBundle.policy.publicHandlerIrVersionFrozen, true);
assert.equal(positive.nativeBundle.policy.automaticFallback, false);
assert.deepEqual(reordered.nativeBundle, positive.nativeBundle);
assert.equal(reordered.nativeSource.source, positive.nativeSource.source);
assert.equal(reordered.nativeSource.sourceSha256, positive.nativeSource.sourceSha256);

const artifact = positive.nativeSource;
assert.equal(artifact.version, entitiesNative.ENTITIES_NATIVE_SOURCE_VERSION);
assert.deepEqual(artifact.discriminatorTable.map((entry) => entry.discriminator), ['customer.lookup', 'system.notify']);
assert.deepEqual(artifact.schemas, ['tools.LookupInput', 'tools.LookupOutput']);
assert.deepEqual(artifact.imports, [
  { module: 'pulse_entities_host', name: 'effect_begin' },
  { module: 'pulse_entities_host', name: 'log' }
]);
assert.equal(artifact.policy.requestBodyReads, 1);
assert.equal(artifact.policy.selectBeforeDecode, true);
assert.equal(artifact.policy.exactlyOneSelectedHandler, true);
assert.equal(artifact.policy.catalogMetadataIncluded, false);
assert.equal(artifact.policy.javascriptHandlerImports, false);
assert.equal(artifact.policy.javascriptRuntime, false);
assert.equal(artifact.policy.automaticFallback, false);
assert.doesNotMatch(artifact.source, /CATALOG_ONLY_NATIVE_SENTINEL|UNRELATED_SCHEMA_SENTINEL|tools\.UnrelatedCatalogSchema|UNREACHABLE_NATIVE_HANDLER/);
assert.doesNotMatch(artifact.source, /\bPromise\b|Asyncify|async function|await |javascript[_ -]handler/i);
assert.match(artifact.source, /function __pulse_entities_scan_envelope/);
assert.match(artifact.source, /customer\.lookup/);

assert.throws(() => entitiesNative.buildEntitiesNativeSource({
  plan: positive.lowered.artifact.plan,
  managedHandlerNativeBundle: positive.nativeBundle,
  schemaBundle: positive.schemas,
  javascriptFallback: true
}), (error) => error && error.code === 'PULSE_ENTITIES_NATIVE_INPUT_UNSUPPORTED');
assert.throws(() => entitiesNative.buildEntitiesNativeSource({
  plan: positive.lowered.artifact.plan,
  managedHandlerNativeBundle: { ...positive.nativeBundle, policy: { ...positive.nativeBundle.policy, automaticFallback: true } },
  schemaBundle: positive.schemas
}), (error) => error && error.code === 'PULSE_ENTITIES_NATIVE_HANDLER_BUNDLE_POLICY');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-entities-native-runtime-'));
try {
  const first = compileWasm(artifact.source, path.join(temp, 'checkout-a'), 'entities-native');
  const second = compileWasm(artifact.source, path.join(temp, 'checkout-b'), 'entities-native');
  assert.deepEqual(second.bytes, first.bytes, 'Entities Native Wasm must be checkout-independent');
  assert.doesNotMatch(first.wat, /Promise|Asyncify|javascript[_ -]handler/i);
  const module = new WebAssembly.Module(first.bytes);
  const imports = WebAssembly.Module.imports(module);
  assert.deepEqual(imports.filter((entry) => entry.module !== 'env').map((entry) => [entry.module, entry.name]).sort((left, right) => left[1].localeCompare(right[1])), [
    ['pulse_entities_host', 'effect_begin'],
    ['pulse_entities_host', 'log']
  ]);
  assert.equal(imports.some((entry) => /js|javascript/i.test(`${entry.module}:${entry.name}`)), false);

  const lookupBody = '{"jsonrpc":"2.0","method":"customer.lookup","params":{"ignored":"drop-input","id":"7"},"id":"req\\u002d7"}';
  const lookup = run(first.bytes, lookupBody, ({ payload }) => {
    assert.equal(payload.kind, 'fetch');
    assert.equal(payload.inputs.url, 'https://directory.example.test/7');
    return { value: 'Ada' };
  });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.bodyReads, 1);
  assert.equal(lookup.selected, 0);
  assert.deepEqual(lookup.invocations, [1, 0]);
  assert.equal(lookup.effects.length, 1);
  assert.equal(lookup.logs.length, 1);
  assert.equal(lookup.body, '{"jsonrpc":"2.0","result":{"id":"7","name":"Ada"},"id":"req\\u002d7"}');
  assert.doesNotMatch(lookup.body, /ignored|drop-input|drop-from-output/);

  const unknown = run(first.bytes, '{"jsonrpc":"2.0","method":"unknown.method","params":[],"id":3}');
  assert.equal(unknown.status, 200);
  assert.equal(JSON.parse(unknown.body).error.code, -32601);
  assert.deepEqual(unknown.invocations, [0, 0]);
  assert.equal(unknown.effects.length, 0);

  const invalidParams = run(first.bytes, '{"jsonrpc":"2.0","method":"customer.lookup","params":{"missing":"id"},"id":4}');
  assert.equal(JSON.parse(invalidParams.body).error.code, -32602);
  assert.deepEqual(invalidParams.invocations, [0, 0]);
  assert.equal(invalidParams.effects.length, 0);

  const notifyRequest = run(first.bytes, '{"jsonrpc":"2.0","method":"system.notify","params":{},"id":null}', ({ payload }) => {
    assert.equal(payload.kind, 'secret.get');
    assert.equal(payload.inputs.name, 'TOKEN');
    return { value: 'provider-sensitive-secret' };
  });
  assert.equal(notifyRequest.status, 200);
  assert.equal(notifyRequest.body, '{"jsonrpc":"2.0","result":null,"id":null}');
  assert.deepEqual(notifyRequest.invocations, [0, 1]);
  assert.equal(notifyRequest.effects.length, 1);

  const notification = run(first.bytes, '{"jsonrpc":"2.0","method":"system.notify"}', () => ({ value: 'provider-sensitive-secret' }));
  assert.equal(notification.status, 204);
  assert.equal(notification.body, '');
  assert.deepEqual(notification.invocations, [0, 1]);

  const malformed = run(first.bytes, '{"jsonrpc":"2.0","method":');
  assert.equal(JSON.parse(malformed.body).error.code, -32700);
  assert.deepEqual(malformed.invocations, [0, 0]);
  const duplicate = run(first.bytes, '{"jsonrpc":"2.0","method":"customer.lookup","method":"system.notify","id":1}');
  assert.equal(JSON.parse(duplicate.body).error.code, -32600);
  assert.deepEqual(duplicate.invocations, [0, 0]);
  const unsafeId = run(first.bytes, '{"jsonrpc":"2.0","method":"customer.lookup","params":{"id":"7"},"id":9007199254740992}');
  assert.equal(JSON.parse(unsafeId.body).error.code, -32600);
  assert.deepEqual(unsafeId.invocations, [0, 0]);

  const failed = run(first.bytes, '{"jsonrpc":"2.0","method":"customer.lookup","params":{"id":"7"},"id":5}', () => ({ ok: false, value: 'SENSITIVE_PROVIDER_FAILURE' }));
  assert.equal(JSON.parse(failed.body).error.code, -32603);
  assert.doesNotMatch(failed.body, /SENSITIVE_PROVIDER_FAILURE/);
  assert.deepEqual(failed.invocations, [1, 0]);

  console.log(JSON.stringify({
    version: artifact.version,
    sourceSha256: artifact.sourceSha256,
    wasmSha256: sha256(first.bytes),
    wasmBytes: first.bytes.length,
    routes: artifact.summary.routes,
    schemas: artifact.summary.schemas,
    effects: artifact.summary.effects,
    imports: imports.map((entry) => `${entry.module}:${entry.name}`)
  }));
  console.log('ok - Entities I7 package-owned Native scanner, schema codecs, static dispatcher, managed handlers, effects, and exact JSON-RPC framer execute without JavaScript fallback');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
