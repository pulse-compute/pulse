'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const { buildCanonicalSchemaBundle, createCanonicalSchemaCodecs } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const jsHost = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const { Router } = require('../../../packages/runtime/src/index.js');
const { Pulse } = require('../../../packages/pulse/src/index.js');
const runtimeHost = require('../../../packages/runtime/src/host.js');
const http = require('../../../packages/provider-fastly/src/build/native-http-effects.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const httpHost = require('../../../packages/provider-fastly/src/testing/native-http-effects-host.js');
const platformHost = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

const repoRoot = path.resolve(__dirname, '../../..');
const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-text-decoding');
const source = fs.readFileSync(path.join(fixture, 'src/index.ts'), 'utf8');
const handler = Function('"use strict"; ' + source.replace('export default ', '') + '\nreturn handler')();
const maxBytes = 256;
const candidate = (title = 'Catalog — café 🙂') => ({ title, score: 1.5, role: 'author', detail: { tags: ['one'], note: null } });

async function assertSchemaTextDecoding() {
  const extracted = extractSchemaRegistry(path.join(fixture, 'src/schemas.ts'), { projectRoot: fixture });
  const registry = extracted.registry;
  // An application text operation must not inherit the HTTP media-type policy.
  const bundle = buildCanonicalSchemaBundle(registry, { maxBytes, contentTypePolicy: 'require-json' });
  const codecs = createCanonicalSchemaCodecs(bundle.registry);
  const compile = (text, target = 'native', strict = true) => compileCanonicalSource(text, {
    fileName: 'schema-text-decoding.ts', schemaBundle: bundle, requireAsync: true, target, strict
  });
  for (const target of ['native', 'javascript']) {
    for (const strict of [true, false]) {
      for (const [args, code] of [
        ["'{}'", 'PULSE_CANONICAL_DECODER_ARGUMENTS_UNSUPPORTED'],
        ["'{}', 'app.Candidate', 1", 'PULSE_CANONICAL_DECODER_ARGUMENTS_UNSUPPORTED'],
        ["'{}', ctx.req.header('schema')", 'PULSE_CANONICAL_SCHEMA_ID_LITERAL_REQUIRED'],
        ["'{}', 'app.Unknown'", 'PULSE_CANONICAL_SCHEMA_MISSING'],
      ]) {
        assert.throws(() => compile(`export default async function handler(ctx) { const value = ctx.decodeJson(${args}); return ctx.text('ok'); }`, target, strict),
          (error) => error.diagnostics.some((item) => item.code === code), `${target}/${strict}: ${args}`);
      }
    }
  }
  const compiled = compile(source);
  assert.ok(compiled.metadata.schemaReferences.some((entry) => entry.id === 'app.Candidate' && entry.usage === 'text-decode' && entry.capability === 'schema.decode'));
  const plan = buildCanonicalNativePlan(compiled);
  const native = compileCanonicalNativePlan(plan, { cwd: repoRoot });
  const providerOptions = { cwd: repoRoot, backends: { 'https://objects.invalid': 'objects' }, requirePlatformCapability: false };
  const fastlyHttp = http.compileFastlyNativeHttpEffectsPlan(plan, providerOptions);
  const fastlyPlatform = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, providerOptions);
  for (const artifact of [fastlyHttp, fastlyPlatform]) {
    assert.ok(!artifact.inspection.imports.some((entry) => /env|pulse_host|js[_-]?compute/.test(entry.module)));
  }

  async function execute(lane, text, mode = '') {
    const request = { method: 'POST', path: '/', body: text, headers: [['content-type', 'text/plain'], ['x-mode', mode]] };
    assert.ok(Buffer.byteLength(text) <= maxBytes, 'the application decode must own oversize failures');
    const sent = [];
    const traces = [];
    try {
      if (lane === 'javascript') {
        const app = new Router();
        app.post('/', handler);
        app.error(async (error, ctx) => ctx.text(error.code === 'PULSE_RUNTIME_UNHANDLED_ERROR'
          ? error.cause.code || error.cause.name : error.code, { status: 400 }));
        const result = await jsHost.executeNodeJavascriptApplication(app, new Request('https://app.test/', request), {
          strict: true, schemaCodecs: codecs, onJsonTrace(event) { traces.push(event); },
          async fetchImplementation(_url, init) { sent.push(init.body); return new Response('stored'); },
        });
        const body = await result.text();
        return { body, error: result.status === 400 ? body : null, sent, trace: traces };
      }
      if (lane === 'native') {
        const result = await nativeHost.executeCanonicalNativeModule(native, { request, providerAdapter: { id: 'node', async dispatchEffect(effect) {
          sent.push(effect.init.body); return { status: 200, body: 'stored', headers: [] };
        } } });
        return { body: result.response.body, sent, trace: result.trace };
      }
      const options = { request, fixtures: { 'https://objects.invalid/candidate': { status: 200, body: 'stored' } } };
      const result = lane === 'fastly-http' ? httpHost.executeFastlyNativeHttpEffects(fastlyHttp, options)
        : platformHost.executeFastlyNativePlatformCapabilities(fastlyPlatform, options);
      return { body: result.response.body, sent: result.outboundRequests?.map((entry) => entry.body), trace: result.trace };
    } catch (error) { return { error: error.code || error.name, detail: error.detail, sent, trace: error.detail?.trace || [] }; }
  }
  const lanes = ['javascript', 'native', 'fastly-http', 'fastly-platform'];
  const basic = candidate();
  const canonical = JSON.stringify(basic);
  const exact = canonical + ' '.repeat(maxBytes - Buffer.byteLength(canonical));
  const vectors = [
    [canonical, basic], [exact, basic],
    [JSON.stringify({ ...basic, ignored: true, detail: { ...basic.detail, ignored: 1 } }), basic],
    // Existing JSON semantics: the last occurrence wins, including escaped names.
    ['{"title":17,' + canonical.slice(1), basic],
    [canonical.replace('"title":', '"ti\\u0074le":'), basic],
    [canonical.replace('1.5', '15e-1'), basic],
    [JSON.stringify(candidate('lone \ud800 \udfff; quote " slash \\')), candidate('lone \ud800 \udfff; quote " slash \\')],
    [JSON.stringify(candidate('é e\u0301 東京 🌍')), candidate('é e\u0301 東京 🌍')],
  ];
  for (const [text, expected] of vectors) {
    for (const lane of lanes) {
      const result = await execute(lane, text);
      assert.ok(!result.error, `${lane}: ${JSON.stringify(result)}`);
      assert.deepEqual(JSON.parse(result.body), { value: expected, original: text, sameReference: false }, `${lane}: schema projection, exact original text and detached reads`);
      if (lane === 'fastly-http') assert.equal(result.trace.filter((entry) => entry.name === 'send_async').length, 1);
      else assert.deepEqual(result.sent, [text], `${lane}: upload the original bytes, not re-encoded values`);
      if (lane === 'javascript' || lane === 'native') assert.equal(result.trace.filter((entry) => entry.kind === 'json.decode.text').length, 2);
    }
  }
  for (const [text, mode, code, stage] of [
    ['{"title":', '', 'PULSE_SCHEMA_JSON_MALFORMED', 3],
    [canonical + '!', '', 'PULSE_SCHEMA_JSON_MALFORMED', 3],
    [canonical.replace('1.5', '01'), '', 'PULSE_SCHEMA_JSON_MALFORMED', 3],
    ['{}', '', 'PULSE_SCHEMA_DECODE', 51],
    [canonical.replace('1.5', '1e999'), '', 'PULSE_SCHEMA_DECODE', 53],
    [canonical.replace('"author"', '"outsider"'), '', 'PULSE_SCHEMA_DECODE', 54],
    [exact, 'oversized', 'PULSE_BODY_TOO_LARGE', 21],
    [canonical, 'wrong-type', 'PULSE_SCHEMA_DECODE', 52],
    [canonical, 'mutate-object', 'Error', 32],
    [canonical, 'mutate-array', 'Error', 35],
  ]) {
    for (const lane of lanes) {
      const result = await execute(lane, text, mode);
      if (lane.startsWith('fastly')) {
        assert.ok(result.error, `${lane}: failure expected`);
        assert.equal(result.detail.errorStage, stage, `${lane}: ${mode || text}`);
        assert.ok(!result.trace.some((entry) => entry.name === 'send_async'), `${lane}: effect dispatched after ${mode || text}; ${JSON.stringify(result.detail)}`);
      } else assert.equal(result.error, code, `${lane}: ${mode || text}`);
      assert.deepEqual(result.sent, [], `${lane}: invalid or mutated input cannot reach the subsequent write`);
    }
  }
  const app = new Pulse({ auto: true });
  let eventValue;
  app.on('candidate.inspect', { schema: null }, async (ctx) => {
    eventValue = ctx.decodeJson(canonical, 'app.Candidate');
    assert.equal(ctx.req, undefined);
    assert.ok(Object.isFrozen(eventValue) && Object.isFrozen(eventValue.detail.tags));
    assert.throws(() => ctx.decodeJson(canonical), { code: 'PULSE_SCHEMA_ID_INVALID' });
    assert.throws(() => ctx.decodeJson(canonical, 'app.Unknown'), { code: 'PULSE_SCHEMA_REFERENCE' });
  });
  const frame = { version: 'pulse.event-frame.v1', type: 'candidate.inspect', schemaId: null };
  assert.equal((await runtimeHost.executeEvent(app, frame, { schemaCodecs: codecs, strict: false })).status, 'completed');
  assert.deepEqual(eventValue, basic);
  const eventProject = compileCanonicalProject(path.join(fixture, 'src/event.ts'), {
    rootDir: fixture, workspaceRoot: repoRoot,
    applicationProjectMetadata: {
      selectedProfile: { name: 'test', source: 'schema-text-decoding' },
      strict: true, target: 'native', host: 'node', projectHash: '3'.repeat(64),
      configPlanHash: '4'.repeat(64), bindings: { config: [], secret: [] }, fragments: {}
    },
    schemas: { registry, dependencies: extracted.dependencies, codecInputs: extracted.codecInputs },
    strict: true, requireAsync: true, requireEffectAwait: true
  });
  const eventNative = compileCanonicalNativePlan(buildCanonicalNativePlan(eventProject), { cwd: repoRoot });
  const eventLog = [];
  const eventResult = await nativeHost.executeCanonicalNativeEvent(eventNative, frame, { log: (_level, _message, entry) => eventLog.push(entry) });
  assert.equal(eventResult.status, 'completed');
  assert.ok(eventLog.some((entry) => entry.message === 'title:event'));
  console.log('ok - application text decoding: 16 compiler negatives, 32 successful and 40 rejected HTTP executions, plus JavaScript/Native event contexts');
}

module.exports = { assertSchemaTextDecoding };
