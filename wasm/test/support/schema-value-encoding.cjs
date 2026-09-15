'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const { buildCanonicalSchemaBundle, createCanonicalSchemaCodecs } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const jsHost = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const { Router } = require('../../../packages/runtime/src/index.js');
const http = require('../../../packages/provider-fastly/src/build/native-http-effects.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const httpHost = require('../../../packages/provider-fastly/src/testing/native-http-effects-host.js');
const platformHost = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

const repoRoot = path.resolve(__dirname, '../../..');
const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-value-encoding');
const source = fs.readFileSync(path.join(fixture, 'src/index.ts'), 'utf8');
const sourceHandler = Function(source.replace('export default ', '') + '\nreturn handler')();
const maxBytes = 256;
const input = (title = 'Hello', score = 1.5) => ({ title, score, role: 'author', tags: ['one'], note: null });
const candidate = (value) => ({ schemaVersion: 1, resourceId: 'resource-1', title: value.title, score: value.score, role: value.role, detail: { tags: value.tags, note: value.note } });

async function assertSchemaValueEncoding() {
  const registry = extractSchemaRegistry(path.join(fixture, 'src/schemas.ts'), { projectRoot: fixture }).registry;
  const bundle = buildCanonicalSchemaBundle(registry, { maxBytes });
  const codecs = createCanonicalSchemaCodecs(bundle.registry);
  const compile = (text, target = 'native', strict = true) => compileCanonicalSource(text, { fileName: 'schema-value-encoding.ts', schemaBundle: bundle, requireAsync: true, target, strict });
  for (const target of ['native', 'javascript']) {
    for (const strict of [true, false]) {
      for (const [args, code] of [
        ['{}', 'PULSE_CANONICAL_DECODER_ARGUMENTS_UNSUPPORTED'],
        ["{}, 'app.Candidate', 1", 'PULSE_CANONICAL_DECODER_ARGUMENTS_UNSUPPORTED'],
        ["{}, ctx.req.header('schema')", 'PULSE_CANONICAL_SCHEMA_ID_LITERAL_REQUIRED'],
        ["{}, 'app.Unknown'", 'PULSE_CANONICAL_SCHEMA_MISSING'],
      ]) {
        assert.throws(() => compile(`export default async function handler(ctx) { return ctx.text(ctx.encodeJson(${args})) }`, target, strict),
          (error) => error.diagnostics.some((item) => item.code === code), `${target}/${strict}: ${args}`);
      }
    }
  }
  const compiled = compile(source);
  assert.ok(compiled.metadata.schemaReferences.some((entry) => entry.id === 'app.Candidate' && entry.usage === 'value-encode' && entry.capability === 'schema.encode'));
  const plan = buildCanonicalNativePlan(compiled);
  const native = compileCanonicalNativePlan(plan, { cwd: repoRoot });
  const providerOptions = { cwd: repoRoot, backends: { 'https://objects.invalid': 'objects' }, requirePlatformCapability: false };
  const fastlyHttp = http.compileFastlyNativeHttpEffectsPlan(plan, providerOptions);
  const fastlyPlatform = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, providerOptions);
  assert.equal(native.manifest.policy.javascriptRuntime, false);
  for (const artifact of [fastlyHttp, fastlyPlatform]) {
    assert.ok(!artifact.inspection.imports.some((entry) => /env|pulse_host|wasi|js[_-]?compute/.test(entry.module)));
  }

  async function execute(lane, value, mode = '') {
    const request = { method: 'POST', path: '/', body: JSON.stringify(value), headers: [['content-type', 'application/json'], ['x-mode', mode]] };
    assert.ok(Buffer.byteLength(request.body) <= maxBytes, 'fixture input must fit so output encoding owns the size failure');
    const sent = [];
    const traces = [];
    try {
      if (lane === 'javascript') {
        const app = new Router();
        app.post('/', sourceHandler);
        app.error(async (error, ctx) => ctx.text(error.code, { status: 400 }));
        const result = await jsHost.executeNodeJavascriptApplication(app, new Request('https://app.test/', request), {
          strict: true, schemaCodecs: codecs,
          onJsonTrace(event) { traces.push(event); },
          async fetchImplementation(_url, init) { sent.push(init.body); return new Response('stored'); },
        });
        const text = await result.text();
        return { text, error: result.status === 400 ? text : null, sent, trace: traces };
      }
      if (lane === 'native') {
        const result = await nativeHost.executeCanonicalNativeModule(native, { request, providerAdapter: { id: 'node', async dispatchEffect(effect) { sent.push(effect.init.body); return { status: 200, body: 'stored', headers: [] }; } } });
        return { text: result.response.body, sent, trace: result.trace };
      }
      const result = lane === 'fastly-http'
        ? httpHost.executeFastlyNativeHttpEffects(fastlyHttp, { request, fixtures: { 'https://objects.invalid/candidate': { status: 200, body: 'stored' } } })
        : platformHost.executeFastlyNativePlatformCapabilities(fastlyPlatform, { request, fixtures: { 'https://objects.invalid/candidate': { status: 200, body: 'stored' } } });
      return { text: result.response.body, sent: result.outboundRequests?.map((entry) => entry.body), trace: result.trace };
    } catch (error) { return { error: error.code || error.name, detail: error.detail, sent, trace: error.detail?.trace || [] }; }
  }

  const lanes = ['javascript', 'native', 'fastly-http', 'fastly-platform'];
  const fixtures = [input('lone \ud800 \udfff'), input('Quoted \"title\"\nwith backslash \\'), input('Catalog — café 🙂'), input(), input('quote " slash \\ control \b\f\n\r\t\u0000'), input('é e\u0301 東京 🌍'), input('', -0), { ...input(), tags: [], note: 'present' }];
  // Bound the returned UTF-8 text, including escaping, rather than JS string length.
  const remaining = maxBytes - Buffer.byteLength(JSON.stringify(candidate(input(''))));
  const exact = input('é'.repeat(Math.floor(remaining / 2)) + 'a'.repeat(remaining % 2));
  fixtures.push(exact);
  for (const value of fixtures) {
    const expected = JSON.stringify(candidate(value));
    for (const lane of lanes) {
      const result = await execute(lane, value);
      assert.ok(!result.error, `${lane}: ${JSON.stringify(result)}`);
      assert.equal(result.text, expected, `${lane}: exact candidate bytes, declaration order, detached snapshot`);
      if (lane === 'fastly-http') assert.equal(result.trace.filter((entry) => entry.name === 'send_async').length, 1);
      else assert.deepEqual(result.sent, [expected], `${lane}: same bytes dispatched once`);
      if (lane === 'native' || lane === 'javascript') assert.ok(result.trace.some((entry) => entry.kind === 'json.encode.value'));
    }
  }
  for (const score of [1e-7, 1e21, Number.MIN_VALUE, Number.MAX_VALUE]) {
    for (const lane of lanes) {
      const result = await execute(lane, input('number', score));
      assert.ok(!result.error, `${lane}: ${JSON.stringify(result)}`);
      assert.deepEqual(JSON.parse(result.text), candidate(input('number', score)), `${lane}: finite numeric semantic roundtrip`);
      if (lane !== 'fastly-http') assert.deepEqual(result.sent, [result.text]);
    }
  }
  for (const [value, mode, code, stage] of [
    [input(), 'missing', 'PULSE_SCHEMA_ENCODE', 51],
    [input(), 'wrong-type', 'PULSE_SCHEMA_ENCODE', 52],
    [input(), 'nonfinite', 'PULSE_SCHEMA_ENCODE', 53],
    [{ ...input(), role: 'outsider' }, '', 'PULSE_SCHEMA_ENCODE', 54],
    [{ ...exact, title: exact.title + 'a' }, '', 'PULSE_BODY_TOO_LARGE', 21],
  ]) {
    for (const lane of lanes) {
      const result = await execute(lane, value, mode);
      if (lane.startsWith('fastly')) {
        assert.ok(result.error, `${lane}: failure expected`);
        assert.equal(result.detail.errorStage, stage, `${lane}: schema failure stage`);
        assert.ok(!result.trace.some((entry) => entry.name === 'send_async'), `${lane}: reject before dispatch`);
      } else assert.equal(result.error, code, `${lane}: reject invalid candidate`);
      assert.deepEqual(result.sent, [], `${lane}: no external write on failed encoding`);
    }
  }
  // The compact single-field decoder takes a different json-as struct path.
  const singleBundle = buildCanonicalSchemaBundle([{ id: 'app.Single', type: 'Single', fields: [{ name: 'title', type: 'string' }] }]);
  const singleSource = "export default async function handler(ctx) { const value = await ctx.req.json('app.Single'); return ctx.text(ctx.encodeJson(value, 'app.Single')); }";
  const singlePlan = buildCanonicalNativePlan(compileCanonicalSource(singleSource, { schemaBundle: singleBundle, strict: true, requireAsync: true }));
  const singleNative = compileCanonicalNativePlan(singlePlan, { cwd: repoRoot });
  const singleFastly = platform.compileFastlyNativePlatformCapabilitiesPlan(singlePlan, { cwd: repoRoot, requirePlatformCapability: false });
  assert.equal(singleNative.manifest.jsonAs.mode, 'NAIVE');
  assert.equal(singleFastly.manifest.jsonAs.mode, 'NAIVE');
  const titles = [String.fromCharCode(92), String.fromCharCode(92).repeat(2), String.fromCharCode(92).repeat(3), String.fromCharCode(92) + 'u005c', 'Catalog — café 🙂', 'a🙂', 'ab🙂', 'abc🙂', 'Quoted "title"' + String.fromCharCode(10, 92)];
  for (const title of titles) {
    const body = JSON.stringify({ title });
    const request = { method: 'POST', path: '/', body, headers: [['content-type', 'application/json']] };
    const node = await nativeHost.executeCanonicalNativeModule(singleNative, { request });
    const fastly = platformHost.executeFastlyNativePlatformCapabilities(singleFastly, { request });
    assert.equal(node.response.body, body, 'single-field Node Native preserves string value');
    assert.equal(fastly.response.body, body, 'single-field Fastly Native preserves string value');
  }
  console.log('ok - 18 single-field Native string regressions; pinned scalar json-as and JSON-equivalent backslash spelling');
  console.log('ok - schema-bound value encoding: 16 compiler negatives; 52 positive and 20 rejected executions across JavaScript, Node Native and both Fastly Native generators');
}

module.exports = { assertSchemaValueEncoding };
