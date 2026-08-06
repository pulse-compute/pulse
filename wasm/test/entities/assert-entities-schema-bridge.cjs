#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeAuthoring = require('../../../packages/runtime/src/index.js');
const runtimeHost = require('../../../packages/runtime/src/internal/index.js');
const packageRuntime = require('../../../packages/runtime/src/package.js');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const {
  buildCanonicalSchemaBundle,
  createCanonicalSchemaCodecs
} = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');

const fixtureRoot = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-registry');
const schemaFile = path.join(fixtureRoot, 'src/pulse/schemas/index.ts');

function expectCode(run, code, label) {
  let caught;
  assert.throws(run, (error) => {
    caught = error;
    return error && error.code === code;
  }, `${label} must fail with ${code}`);
  return caught;
}

function codecs(maxBytes = 32_768) {
  const extracted = extractSchemaRegistry(schemaFile, { projectRoot: fixtureRoot });
  const bundle = buildCanonicalSchemaBundle(extracted.registry, {
    contentTypePolicy: 'require-json',
    maxBytes
  });
  return createCanonicalSchemaCodecs(bundle.registry);
}

function entitiesSchemaRuntime() {
  return packageRuntime.createPackageSchemaCodecRuntime({
    package: '@pulse-compute/entities',
    contractId: 'pulse.entities'
  });
}

function request(contentType = 'application/json') {
  return new Request('https://entities.test/rpc', {
    method: 'POST',
    headers: { 'content-type': contentType }
  });
}

async function executeProbe(schemaCodecs, handler, options = {}) {
  const app = new runtimeAuthoring.Router();
  let probeError;
  app.post('/rpc', handler);
  app.error(async (error, ctx) => {
    probeError = error;
    return ctx.text('probe-failed', { status: 500 });
  });
  const response = await runtimeHost.executeRouter(app, request(options.contentType), {
    schemaCodecs,
    strict: true,
    target: 'javascript',
    provider: 'node',
    onJsonTrace: options.onJsonTrace
  });
  if (probeError) throw probeError.cause || probeError;
  return response;
}

(async () => {
  assert.equal(
    packageRuntime.PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION,
    'pulse.first-party-embedded-schema-codec-bridge.v1',
    'schema codec bridge runtime version must match the frozen I0 contract'
  );
  const typeSource = fs.readFileSync(path.join(repoRoot, 'packages/runtime/src/package.d.ts'), 'utf8');
  assert.match(
    typeSource,
    /PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION: 'pulse\.first-party-embedded-schema-codec-bridge\.v1'/,
    'schema codec bridge type mirror must match the CommonJS runtime version'
  );
  assert.match(typeSource, /decodeEmbeddedJson<Value = unknown>\(schemaId: string, packageOwnedText: string\): PulsePackageSchemaReadonly<Value>/);
  assert.match(typeSource, /encodeEmbeddedJson\(schemaId: string, packageOwnedValue: unknown\): string/);

  expectCode(() => packageRuntime.createPackageSchemaCodecRuntime({
    package: '@example/schema-consumer',
    contractId: 'example.schemas'
  }), 'PULSE_RUNTIME_PACKAGE_SCHEMA_BRIDGE_UNTRUSTED', 'untrusted package schema owner');
  expectCode(() => entitiesSchemaRuntime().bind({}, {
    input: 'app.createInput',
    output: 'app.user'
  }), 'PULSE_RUNTIME_PACKAGE_CONTEXT_REQUIRED', 'unmanaged context');

  const generatedCodecs = codecs();
  const trace = [];
  let capturedBridge;
  let decoded;
  let encoded;
  const response = await executeProbe(generatedCodecs, async (ctx) => {
    const bridge = entitiesSchemaRuntime().bind(ctx, {
      input: 'app.createInput',
      output: 'app.user'
    });
    capturedBridge = bridge;
    assert.equal(Object.isFrozen(bridge), true);
    assert.deepEqual(
      Reflect.ownKeys(bridge),
      ['decodeEmbeddedJson', 'encodeEmbeddedJson'],
      'schema bridge capability surface must not expose registry, codec, request, or provider authority'
    );
    for (const forbidden of ['ids', 'registry', 'codec', 'schema', 'request', 'provider', 'schemaCodecs']) {
      assert.equal(forbidden in bridge, false, `schema bridge must not expose ${forbidden}`);
    }

    decoded = bridge.decodeEmbeddedJson('app.createInput', JSON.stringify({
      name: 'Ada',
      attempts: 2,
      quota: 3,
      role: 'admin',
      address: { city: 'Denver', postalCode: '80202', ignored: 'drop' },
      tags: ['alpha'],
      referralCode: null,
      ignored: 'drop'
    }));
    assert.deepEqual(decoded, {
      name: 'Ada',
      attempts: 2,
      quota: 3,
      role: 'admin',
      address: { city: 'Denver', postalCode: '80202' },
      tags: ['alpha'],
      referralCode: null
    });
    assert.equal(Object.isFrozen(decoded), true);
    assert.equal(Object.isFrozen(decoded.address), true);
    assert.equal(Object.isFrozen(decoded.tags), true);

    encoded = bridge.encodeEmbeddedJson('app.user', {
      active: true,
      ignored: 'drop',
      score: 42.5,
      name: 'Grace',
      id: '8'
    });
    assert.equal(encoded, '{"id":"8","name":"Grace","score":42.5,"active":true}');

    expectCode(
      () => bridge.decodeEmbeddedJson('app.user', '{}'),
      'PULSE_RUNTIME_PACKAGE_SCHEMA_NOT_DECLARED',
      'undeclared input schema'
    );
    expectCode(
      () => bridge.encodeEmbeddedJson('app.error', {}),
      'PULSE_RUNTIME_PACKAGE_SCHEMA_NOT_DECLARED',
      'undeclared output schema'
    );
    expectCode(
      () => bridge.decodeEmbeddedJson('app.createInput', {}),
      'PULSE_RUNTIME_PACKAGE_SCHEMA_TEXT_REQUIRED',
      'non-text contained payload'
    );
    expectCode(
      () => bridge.decodeEmbeddedJson('app.createInput', '{"name":"missing-required-fields"}'),
      'PULSE_SCHEMA_DECODE',
      'required input field'
    );
    expectCode(
      () => bridge.encodeEmbeddedJson('app.user', { id: '8', name: 'Grace', score: Number.NaN, active: true }),
      'PULSE_SCHEMA_ENCODE',
      'finite output number'
    );
    return ctx.text('ok');
  }, { onJsonTrace(event) { trace.push(event); } });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
  assert.deepEqual(trace.map((event) => event.kind), [
    'json.decode.request',
    'json.encode.response',
    'json.decode.error',
    'json.encode.error'
  ]);
  assert.deepEqual(trace.map((event) => event.boundary), [
    'request',
    'application-response',
    'request',
    'application-response'
  ]);
  assert.equal(trace[0].bodyOwnership, 'request-snapshot');
  assert.equal(trace[1].bodyOwnership, 'application-owned');
  assert.equal(trace[0].schemaId, 'app.createInput');
  assert.equal(trace[1].schemaId, 'app.user');
  assert.match(trace[0].valueDigest, /^[a-f0-9]{64}$/);
  assert.match(trace[1].valueDigest, /^[a-f0-9]{64}$/);
  expectCode(
    () => capturedBridge.decodeEmbeddedJson('app.createInput', '{}'),
    'PULSE_RUNTIME_EFFECT_EXECUTION_CLOSED',
    'bridge use after managed request close'
  );

  const wrongContentType = await executeProbe(generatedCodecs, async (ctx) => {
    const bridge = entitiesSchemaRuntime().bind(ctx, { input: 'app.createInput', output: 'app.user' });
    return ctx.text(expectCode(
      () => bridge.decodeEmbeddedJson('app.createInput', '{}'),
      'PULSE_SCHEMA_CONTENT_TYPE',
      'current request content type'
    ).code);
  }, { contentType: 'text/plain' });
  assert.equal(await wrongContentType.text(), 'PULSE_SCHEMA_CONTENT_TYPE');

  const tooLarge = await executeProbe(codecs(8), async (ctx) => {
    const bridge = entitiesSchemaRuntime().bind(ctx, { input: 'app.createInput', output: 'app.user' });
    return ctx.text(expectCode(
      () => bridge.decodeEmbeddedJson('app.createInput', '{"name":"too-large"}'),
      'PULSE_BODY_TOO_LARGE',
      'schemas.maxBytes'
    ).code);
  });
  assert.equal(await tooLarge.text(), 'PULSE_BODY_TOO_LARGE');

  const unavailable = await executeProbe(undefined, async (ctx) => {
    return ctx.text(expectCode(
      () => entitiesSchemaRuntime().bind(ctx, { input: 'app.createInput', output: 'app.user' }),
      'PULSE_SCHEMA_CODECS_UNAVAILABLE',
      'missing generated codec registry'
    ).code);
  });
  assert.equal(await unavailable.text(), 'PULSE_SCHEMA_CODECS_UNAVAILABLE');

  const unknown = await executeProbe(generatedCodecs, async (ctx) => {
    return ctx.text(expectCode(
      () => entitiesSchemaRuntime().bind(ctx, { input: 'app.unknown', output: 'app.user' }),
      'PULSE_SCHEMA_REFERENCE',
      'unknown declared schema'
    ).code);
  });
  assert.equal(await unknown.text(), 'PULSE_SCHEMA_REFERENCE');

  const noSchema = await executeProbe(generatedCodecs, async (ctx) => {
    const bridge = entitiesSchemaRuntime().bind(ctx, { input: null, output: null });
    expectCode(() => bridge.decodeEmbeddedJson('app.createInput', '{}'), 'PULSE_RUNTIME_PACKAGE_SCHEMA_NOT_DECLARED', 'null input declaration');
    expectCode(() => bridge.encodeEmbeddedJson('app.user', {}), 'PULSE_RUNTIME_PACKAGE_SCHEMA_NOT_DECLARED', 'null output declaration');
    return ctx.text('closed');
  });
  assert.equal(await noSchema.text(), 'closed');

  const entitiesIndex = fs.readFileSync(path.join(repoRoot, 'packages/entities/src/index.ts'), 'utf8');
  const entitiesBridge = fs.readFileSync(path.join(repoRoot, 'packages/entities/src/internal/schema-codec-bridge.ts'), 'utf8');
  assert.doesNotMatch(entitiesIndex, /schema-codec-bridge|RawJson|json-as/);
  assert.match(entitiesBridge, /@pulse-compute\/runtime\/package/);
  assert.doesNotMatch(entitiesBridge, /schema-json|provider-(?:node|fastly)|RawJson|json-as/);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/entities/package.json'), 'utf8')).exports,
    {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js'
      },
      './pulsewasm/manifest': {
        require: './pulsewasm.manifest.cjs',
        default: './pulsewasm.manifest.cjs'
      },
      './pulsewasm/compiler': {
        require: './pulsewasm.compiler.cjs',
        default: './pulsewasm.compiler.cjs'
      },
      './pulsewasm-native': {
        require: './pulsewasm.native.cjs',
        default: './pulsewasm.native.cjs'
      }
    },
    'The I3 schema bridge remains internal while I7 exposes only its package-owned Native source builder'
  );

  console.log(JSON.stringify({
    version: packageRuntime.PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION,
    declaredSchemas: ['app.createInput', 'app.user'],
    bridgeKeys: Reflect.ownKeys(capturedBridge),
    traceKinds: trace.map((event) => event.kind),
    deeplyImmutable: Object.isFrozen(decoded) && Object.isFrozen(decoded.address) && Object.isFrozen(decoded.tags),
    encoded,
    schemaBridgePublicExportsAdded: false,
    nativeSourceBuilderExportedByI7: true
  }));
  console.log('ok - Entities I3 binds only declared generated schema codecs to contained request text and package-owned output text');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
