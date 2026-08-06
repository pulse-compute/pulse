#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const { scanJsonRpcEnvelope } = require('./bounded-envelope-scanner.cjs');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const {
  buildCanonicalSchemaBundle,
  createCanonicalSchemaCodecs
} = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const {
  compileCanonicalSource,
  loadCanonicalModule
} = require('../../packages/compiler/src/canonical-api-compiler.js');
const { PACKAGE_INTRINSIC_VERSION } = require('../../packages/contracts/src/package/package-contract.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const compilerRoot = path.join(repoRoot, 'wasm/packages/compiler');
const corpusFile = path.join(__dirname, 'entities-envelope-corpus.json');
const freezeFile = path.join(__dirname, 'entities-i0-contract-freeze.json');
const rawFixture = path.join(repoRoot, 'wasm/test/fixtures/conformance/entities-json-raw.ts');
const schemaFixtureRoot = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-registry');
const schemaFile = path.join(schemaFixtureRoot, 'src/pulse/schemas/index.ts');
const assemblyScriptRoot = path.dirname(require.resolve('assemblyscript/package.json', { paths: [compilerRoot] }));
const asc = path.join(assemblyScriptRoot, 'bin/asc.js');
const jsonAsTransform = require.resolve('json-as', { paths: [compilerRoot] });
const jsonAsRoot = path.resolve(jsonAsTransform, '..', '..', '..');
const jsonAsDependencyRoot = path.dirname(jsonAsRoot);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function expectCode(callback, code, label) {
  let actual;
  try {
    callback();
  } catch (error) {
    actual = error;
  }
  assert.ok(actual, `${label}: expected ${code}`);
  assert.equal(actual.code, code, label);
}

function envelopeCorpusProof() {
  const corpusText = fs.readFileSync(corpusFile, 'utf8');
  const corpus = JSON.parse(corpusText);
  assert.equal(corpus.version, 'pulse.entities-envelope-corpus.v1');
  for (const entry of corpus.valid) {
    const scanned = scanJsonRpcEnvelope(entry.text, entry.limits);
    assert.equal(scanned.method, entry.method, entry.name);
    assert.equal(scanned.paramsRaw, entry.paramsRaw, entry.name);
    assert.equal(scanned.idKind, entry.idKind, entry.name);
    assert.equal(scanned.idRaw, entry.idRaw, entry.name);
    assert.equal(scanned.paramsPresent, entry.paramsRaw !== undefined, entry.name);
    assert.equal(scanned.idPresent, entry.idKind !== 'absent', entry.name);
  }
  for (const entry of corpus.invalid) {
    expectCode(() => scanJsonRpcEnvelope(entry.text, entry.limits), entry.code, entry.name);
  }
  return Object.freeze({
    valid: corpus.valid.length,
    invalid: corpus.invalid.length,
    sha256: sha256(corpusText)
  });
}

function compileJsonRawProof(temp) {
  const output = path.join(temp, 'entities-json-raw.wasm');
  const started = performance.now();
  const result = spawnSync(process.execPath, [
    asc,
    rawFixture,
    '--outFile', output,
    '--runtime', 'incremental',
    '--exportRuntime',
    '--exportTable',
    '-O3',
    '--transform', jsonAsTransform,
    '--path', jsonAsDependencyRoot,
    '--path', path.join(compilerRoot, 'node_modules')
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      JSON_STRICT: 'true',
      JSON_USE_FAST_PATH: '0'
    },
    maxBuffer: 1024 * 1024 * 16
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bytes = fs.readFileSync(output);
  const module = new WebAssembly.Module(bytes);
  function instance() {
    return new WebAssembly.Instance(module, {
      env: { abort() { throw new Error('json-as abort'); } }
    });
  }
  const raw = instance();
  assert.equal(raw.exports.raw_shape_matrix(), 1, 'JSON.Raw must preserve all required raw shapes and IDs');
  assert.equal(raw.exports.raw_serialization_matrix(), 1, 'JSON.Raw must serialize without adding quotes');
  const duplicateBehavior = raw.exports.duplicate_method_behavior();
  assert.ok(duplicateBehavior === 1 || duplicateBehavior === 2, 'JSON.Raw map parsing accepts a duplicate reserved key');
  assert.throws(() => instance().exports.malformed_nested(), /json-as abort|unreachable/, 'malformed nesting must trap the json-as parser');
  return Object.freeze({
    jsonAs: JSON.parse(fs.readFileSync(path.join(jsonAsRoot, 'package.json'), 'utf8')).version,
    wasmBytes: bytes.length,
    wasmSha256: sha256(bytes),
    compileMs: Number((performance.now() - started).toFixed(3)),
    rawShapesPreserved: true,
    untouchedSerialization: true,
    malformedNestingRejected: true,
    duplicateReservedKeyRejected: false,
    duplicateResolution: duplicateBehavior === 1 ? 'first-value' : 'last-value',
    verdict: 'carrier-only-insufficient-as-envelope-authority'
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function bridgeError(code, message, detail = {}) {
  const error = new Error(message);
  error.name = 'EntitiesSchemaBridgeError';
  error.code = code;
  error.detail = Object.freeze({ ...detail });
  return error;
}

function createProofBridge(codecs, declaredSchemaIds, trace) {
  const declared = new Set(declaredSchemaIds.map(String));
  function requireDeclared(schemaId) {
    const id = String(schemaId);
    if (!declared.has(id)) {
      throw bridgeError('PULSE_ENTITIES_SCHEMA_NOT_DECLARED', 'Entities bridge requires a statically declared schema ID.', { schemaId: id });
    }
    return id;
  }
  return Object.freeze({
    decodeEmbeddedJson(schemaId, packageOwnedText) {
      const id = requireDeclared(schemaId);
      if (typeof packageOwnedText !== 'string') throw new TypeError('Embedded schema decode requires package-owned JSON text.');
      trace.push(Object.freeze({ phase: 'decode', schemaId: id }));
      return deepFreeze(codecs.decodeJsonText(id, packageOwnedText, 'first-party-package'));
    },
    encodeEmbeddedJson(schemaId, packageOwnedValue) {
      const id = requireDeclared(schemaId);
      trace.push(Object.freeze({ phase: 'encode', schemaId: id }));
      return codecs.encodeJsonText(id, packageOwnedValue, 'first-party-package');
    }
  });
}

function schemaBridgeProof() {
  const extracted = extractSchemaRegistry(schemaFile, { projectRoot: schemaFixtureRoot });
  const bundle = buildCanonicalSchemaBundle(extracted.registry, { contentTypePolicy: 'require-json', maxBytes: 32_768 });
  const codecs = createCanonicalSchemaCodecs(bundle.registry);
  const trace = [];
  const declared = Object.freeze(['app.createInput', 'app.user']);
  const bridge = createProofBridge(codecs, declared, trace);
  assert.deepEqual(Object.keys(bridge), ['decodeEmbeddedJson', 'encodeEmbeddedJson']);

  const routes = new Map([
    ['user.create', Object.freeze({ schemaId: 'app.createInput', handler(input) {
      assert.equal(typeof input, 'object');
      assert.equal(Object.prototype.hasOwnProperty.call(input, 'paramsRaw'), false);
      assert.equal(Object.isFrozen(input), true);
      assert.equal(Object.isFrozen(input.address), true);
      assert.equal(Object.isFrozen(input.tags), true);
      return input.name;
    } })],
    ['user.read', Object.freeze({ schemaId: 'app.user', handler(input) {
      assert.equal(typeof input, 'object');
      assert.equal(Object.prototype.hasOwnProperty.call(input, 'paramsRaw'), false);
      assert.equal(Object.isFrozen(input), true);
      return input.id;
    } })]
  ]);

  function dispatch(text) {
    const envelope = scanJsonRpcEnvelope(text);
    const route = routes.get(envelope.method);
    assert.ok(route, `static selection for ${envelope.method}`);
    trace.push(Object.freeze({ phase: 'select', method: envelope.method, schemaId: route.schemaId }));
    assert.equal(envelope.paramsPresent, true);
    const input = bridge.decodeEmbeddedJson(route.schemaId, envelope.paramsRaw);
    trace.push(Object.freeze({ phase: 'handler', method: envelope.method }));
    return route.handler(input);
  }

  const created = dispatch(JSON.stringify({
    jsonrpc: '2.0',
    method: 'user.create',
    params: {
      name: 'Ada',
      attempts: 2,
      quota: 3,
      role: 'admin',
      address: { city: 'Denver', postalCode: '80202', ignored: 'drop' },
      tags: ['alpha'],
      referralCode: null,
      ignored: 'drop'
    },
    id: 'a'
  }));
  const read = dispatch(JSON.stringify({
    jsonrpc: '2.0',
    method: 'user.read',
    params: { id: '7', name: 'Ada', score: 98.5, active: true, ignored: 'drop' },
    id: 7
  }));
  assert.equal(created, 'Ada');
  assert.equal(read, '7');
  assert.deepEqual(trace.map((entry) => entry.phase), ['select', 'decode', 'handler', 'select', 'decode', 'handler']);
  const encoded = bridge.encodeEmbeddedJson('app.user', { id: '8', name: 'Grace', score: 42, active: true, ignored: 'drop' });
  assert.equal(encoded, '{"id":"8","name":"Grace","score":42,"active":true}');
  expectCode(() => bridge.decodeEmbeddedJson('app.error', '{}'), 'PULSE_ENTITIES_SCHEMA_NOT_DECLARED', 'undeclared codec access');

  return Object.freeze({
    registryVersion: bundle.registry.version,
    registryHash: bundle.registry.registryHash,
    codecVersion: codecs.version,
    selectedSchemaIds: declared,
    selectionBeforeDecode: true,
    handlerRawExposure: false,
    decodedDataDeeplyFrozen: true,
    encodedTextOwned: true,
    publicBridgeKeys: Object.freeze(Object.keys(bridge))
  });
}

function rpcHandleCall(tsNode) {
  if (!ts.isCallExpression(tsNode) || tsNode.arguments.length !== 1) return false;
  const target = tsNode.expression;
  return ts.isPropertyAccessExpression(target)
    && target.name.text === 'handle'
    && ts.isIdentifier(target.expression)
    && target.expression.text === 'rpc'
    && ts.isIdentifier(tsNode.arguments[0]);
}

function terminalIntrinsicProof() {
  const routeSource = [
    "import { Application } from '@pulse-compute/pulse'",
    "import { EntityRouter } from '@pulse-compute/entities'",
    'const rpc = new EntityRouter()',
    'const app = new Application()',
    "app.post('/rpc', (ctx) => { return rpc.handle(ctx) })",
    'export default app',
    ''
  ].join('\n');
  const routeFile = ts.createSourceFile('src/index.ts', routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matched = [];
  function visit(node) {
    if (rpcHandleCall(node)) matched.push(node);
    ts.forEachChild(node, visit);
  }
  visit(routeFile);
  assert.equal(matched.length, 1);
  const routeCall = matched[0];
  assert.ok(ts.isReturnStatement(routeCall.parent));
  assert.equal(routeCall.arguments[0].text, 'ctx');

  const handlerSource = 'export default function handler(ctx) { return rpc.handle(ctx) }\n';
  const handlerFile = ts.createSourceFile('src/entities-route.ts', handlerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let handlerCall;
  function findHandlerCall(node) {
    if (rpcHandleCall(node)) handlerCall = node;
    ts.forEachChild(node, findHandlerCall);
  }
  findHandlerCall(handlerFile);
  assert.ok(handlerCall);
  const plan = Object.freeze({ version: 'pulse.entities-plan.v1', adapter: 'json-rpc-2.0', entityCount: 2 });
  const intrinsic = Object.freeze({
    version: PACKAGE_INTRINSIC_VERSION,
    contractId: 'pulse.entities',
    package: '@pulse-compute/entities',
    import: '@pulse-compute/entities',
    kind: 'entities.handle',
    operation: 'handle',
    intrinsic: 'pulse.entities.handle.v1',
    compilerName: '__pulse_entities_handle',
    valueKind: 'response',
    argumentIndexes: Object.freeze([0]),
    staticArguments: Object.freeze([plan]),
    range: Object.freeze({ start: handlerCall.getStart(handlerFile), end: handlerCall.getEnd() })
  });
  const compiled = compileCanonicalSource(handlerSource, {
    fileName: 'src/entities-route.ts',
    compilerPrelude: 'function __pulse_entities_handle(plan, ctx) { return Object.freeze({ terminal: true, plan, ctx }); }',
    packageIntrinsics: Object.freeze([intrinsic])
  });
  assert.equal(compiled.ok, true);
  assert.equal(compiled.metadata.compilerOwnedIntrinsics.length, 1);
  assert.deepEqual(compiled.metadata.compilerOwnedIntrinsics[0], {
    compilerName: '__pulse_entities_handle',
    intrinsic: 'pulse.entities.handle.v1',
    valueKind: 'response'
  });
  assert.doesNotMatch(compiled.generatedSource, /rpc\.handle/);
  assert.match(compiled.generatedSource, /__pulse_entities_handle/);
  const loaded = loadCanonicalModule(compiled);
  const ctx = Object.freeze({ requestId: 'route-proof' });
  const execution = loaded.createHandler()(ctx);
  const result = execution.next();
  assert.equal(result.done, true);
  assert.equal(result.value.terminal, true);
  assert.equal(result.value.ctx, ctx);
  assert.deepEqual(result.value.plan, plan);

  return Object.freeze({
    routeBinding: "app.post('/rpc', (ctx) => rpc.handle(ctx))",
    matchedCalls: matched.length,
    routeTopologySymbolsRequired: Object.freeze([]),
    intrinsicVersion: PACKAGE_INTRINSIC_VERSION,
    intrinsic: 'pulse.entities.handle.v1',
    compilerOwnedCallCount: compiled.metadata.compilerOwnedIntrinsics.length,
    terminalResultAdopted: true
  });
}

function freezeProof() {
  const text = fs.readFileSync(freezeFile, 'utf8');
  const freeze = JSON.parse(text);
  assert.equal(freeze.version, 'pulse.entities-i0-contract-freeze.v1');
  assert.equal(freeze.status, 'frozen-for-i1');
  assert.equal(freeze.representation.selected, 'package-owned-bounded-scanner');
  assert.equal(freeze.representation.jsonAsRaw, 'contained-raw-value-carrier-only');
  assert.deepEqual(freeze.publicShape.bindingForms, ['rpc.handle(ctx)']);
  assert.equal(freeze.publicShape.bindingKind, 'terminal-package-intrinsic');
  assert.equal(freeze.schemaBridge.visibility, 'first-party-internal');
  assert.equal(freeze.staticPolicy.selectionBeforeDecode, true);
  assert.equal(freeze.ownership.compilerCoreKnowsJsonRpc, false);
  assert.equal(freeze.ownership.providerAuthorityAdded, false);
  assert.equal(freeze.futureRelationship.release, 'unassigned');
  return Object.freeze({ version: freeze.version, sha256: sha256(text) });
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-entities-i0-'));
try {
  const proof = Object.freeze({
    version: 'pulse.entities-i0-feasibility-evidence.v1',
    envelope: envelopeCorpusProof(),
    jsonAsRaw: compileJsonRawProof(temp),
    schemaBridge: schemaBridgeProof(),
    terminalBinding: terminalIntrinsicProof(),
    architectureFreeze: freezeProof(),
    decision: Object.freeze({
      representation: 'package-owned-bounded-scanner',
      publicBinding: 'rpc.handle(ctx)',
      schemaBridge: 'first-party-declared-codecs-only',
      readyForI1: true,
      automaticFallback: false
    })
  });
  console.log(JSON.stringify(proof));
  console.log('ok - Entities I0 freezes bounded envelope scanning, one terminal binding, and a narrow first-party schema bridge');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
