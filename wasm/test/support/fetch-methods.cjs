'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeFetchInit } = require('../../../packages/runtime/src/internal/fetch.js');
const canonicalHost = require('../../packages/host-runtime/src/runtime/canonical-api-runtime.js');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const { buildCanonicalSchemaBundle, createCanonicalSchemaCodecs } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const nodeJs = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const fastlyJs = require('../../../packages/provider-fastly/src/javascript/runtime-host.js');
const http = require('../../../packages/provider-fastly/src/build/native-http-effects.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const httpHost = require('../../../packages/provider-fastly/src/testing/native-http-effects-host.js');
const platformHost = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

module.exports = async function assertFetchMethods() {
  const root = path.resolve(__dirname, '../../..');
  const fixture = path.join(root, 'wasm/test/fixtures/projects/schema-registry');
  const extracted = extractSchemaRegistry(path.join(fixture, 'src/pulse/schemas/index.ts'), { projectRoot: fixture });
  const bundle = buildCanonicalSchemaBundle(extracted.registry);
  const codecs = createCanonicalSchemaCodecs(bundle.registry);
  const payload = { id: '7', name: 'PATCH/PUT é', score: 42.5, active: true };
  const json = { json: payload, schema: 'app.user' };

  // Both runtime admission paths preserve the body/schema/timeout boundaries.
  for (const normalize of [init => normalizeFetchInit(init, { schemaCodecs: codecs, strict: true }),
    init => canonicalHost.normalizedInit(init, codecs, { strict: true })]) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH']) {
      assert.equal(normalize({ method }).method, method);
      for (const body of [{ body: 'text' }, json]) {
        if (method === 'GET' || method === 'HEAD') {
          assert.throws(() => normalize({ method, ...body }), { code: 'PULSE_FETCH_BODY_METHOD_UNSUPPORTED' });
        } else {
          assert.equal(normalize({ method, ...body }).body,
            body.body || JSON.stringify(payload));
        }
      }
    }
    for (const method of ['DELETE', 'OPTIONS', 'TRACE']) {
      assert.throws(() => normalize({ method }), { code: 'PULSE_FETCH_METHOD_UNSUPPORTED' });
    }
    assert.throws(() => normalize({ method: 'PATCH', ...json, body: 'text' }), { code: 'PULSE_FETCH_BODY_AMBIGUOUS' });
    assert.throws(() => normalize({ method: 'PUT', schema: 'app.user' }), { code: 'PULSE_FETCH_SCHEMA_WITHOUT_JSON' });
    assert.throws(() => normalize({ method: 'PATCH', body: new Uint8Array([1]) }), { code: 'PULSE_FETCH_BODY_INVALID' });
    assert.throws(() => normalize({ method: 'PUT', ...json, timeoutMs: 0 }), { code: 'PULSE_FETCH_TIMEOUT_INVALID' });
    assert.throws(() => normalize({ method: 'PATCH', json: { ...payload, active: 'wrong' }, schema: 'app.user' }));
  }

  for (const method of ['PATCH', 'PUT']) {
    const source = `export default async function handler(ctx) {
      const response = await ctx.fetch('https://origin.test/users', {
        method: '${method}', json: ${JSON.stringify(payload)}, schema: 'app.user',
        headers: { 'x-request-id': '${method}' }, timeoutMs: 1000
      }).text();
      return ctx.text(response);
    }`;
    const handler = Function(source.replace('export default ', '') + ';return handler')();
    const sent = [];
    const options = { strict: true, schemaCodecs: codecs, bindings: { backends: { 'https://origin.test': 'origin' } },
      async fetchImplementation(url, init) { sent.push({ url, ...init }); return new Response('stored'); } };
    for (const execute of [nodeJs.executeNodeJavascriptApplication, fastlyJs.executeFastlyJavascriptApplication]) {
      const response = await execute(handler, new Request('https://app.test/'), options);
      assert.equal(await response.text(), 'stored');
    }
    const compiled = compileCanonicalSource(source, { fileName: `fetch-${method}.ts`, schemaBundle: bundle, strict: true, requireAsync: true });
    const plan = buildCanonicalNativePlan(compiled);
    const native = compileCanonicalNativePlan(plan, { cwd: root });
    const result = await nativeHost.executeCanonicalNativeModule(native, {
      providerAdapter: { id: 'node', dispatchEffect(effect) {
        sent.push({ url: effect.parts.url, ...effect.init });
        return { status: 200, body: 'stored', headers: [] };
      } },
    });
    assert.equal(result.response.body, 'stored');
    for (const [compile, execute] of [
      [http.compileFastlyNativeHttpEffectsPlan, httpHost.executeFastlyNativeHttpEffects],
      [platform.compileFastlyNativePlatformCapabilitiesPlan, platformHost.executeFastlyNativePlatformCapabilities],
    ]) {
      const artifact = compile(plan, { cwd: root, backends: { 'https://origin.test': 'origin' }, requirePlatformCapability: false });
      const result = execute(artifact, { fixtures: { [`${method} https://origin.test/users`]: { status: 200, body: 'stored' } } });
      assert.equal(result.response.body, 'stored');
      assert.equal(result.outboundRequests.length, 1);
      sent.push(...result.outboundRequests);
    }
    assert.equal(sent.length, 5);
    for (const [index, request] of sent.entries()) {
      assert.equal(request.method, method);
      assert.deepEqual(Buffer.from(request.body), Buffer.from(JSON.stringify(payload)));
      assert.equal(new Headers(request.headers).get('x-request-id'), method, `lane ${index}: ${JSON.stringify(request.headers)}`);
      assert.match(new Headers(request.headers).get('content-type'), /application\/json/);
    }
  }
  console.log('ok - PATCH/PUT types align with JavaScript, Node Native and both Fastly Native generators (injected transport)');
};
