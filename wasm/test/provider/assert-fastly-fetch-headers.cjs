'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');

function main(kind = 'both') {
  const root = path.resolve(__dirname, '../../..');
  const fixture = path.join(root, 'wasm/test/fixtures/projects/schema-registry');
  const extracted = extractSchemaRegistry(path.join(fixture, 'src/pulse/schemas/index.ts'), { projectRoot: fixture });
  const schemaBundle = buildCanonicalSchemaBundle(extracted.registry);
  // Dynamic input exercises admission in emitted Wasm, including malformed values.
  const source = `export default async function handler(ctx) {
    const input = await ctx.req.json();
    if (input.json) {
      const response = await ctx.fetch('https://origin.test/users', {
        method: input.method, headers: input.headers,
        json: { id: '7', name: 'tuple é', score: 42.5, active: true }, schema: 'app.user'
      }).text();
      return ctx.text(response);
    }
    const response = await ctx.fetch('https://origin.test/users', {
      method: input.method, headers: input.headers, body: 'plain é'
    }).text();
    return ctx.text(response);
  }`;
  const plan = buildCanonicalNativePlan(compileCanonicalSource(source, { fileName: 'fetch-headers.ts', schemaBundle, strict: false }));
  for (const mode of ['http', 'platform']) {
    if (kind !== 'both' && mode !== kind) continue;
    const suffix = mode === 'http' ? 'http-effects' : 'platform-capabilities';
    const name = mode === 'http' ? 'HttpEffects' : 'PlatformCapabilities';
    const compile = require(`../../../packages/provider-fastly/src/build/native-${suffix}.js`)[`compileFastlyNative${name}Plan`];
    const execute = require(`../../../packages/provider-fastly/src/testing/native-${suffix}-host.js`)[`executeFastlyNative${name}`];
    const artifact = compile(plan, { cwd: root, backends: { 'https://origin.test': 'origin' }, requirePlatformCapability: false });
    const run = input => execute(artifact, {
      request: { method: 'POST', headers: [['content-type', 'application/json']], body: JSON.stringify(input) },
      fixtures: { [`${input.method} https://origin.test/users`]: { status: 200, body: 'stored' } },
    });
    for (const method of ['POST', 'PUT', 'PATCH']) {
      for (const json of [true, false]) {
        for (const headers of [
          { 'x-request-id': method }, [['x-request-id', method]],
          { 'Content-Type': 'application/custom', 'x-empty': '' },
          [['Content-Type', 'application/custom'], ['x-empty', '']],
          [['x-repeat', 'first'], ['X-Repeat', 'second'], ['x-empty', '']],
          [['Content-Type', 'first/type'], ['content-type', 'second/type']],
          {}, [], undefined,
        ]) {
          const result = run({ method, headers, json });
          assert.equal(result.response.body, 'stored', mode);
          assert.equal(result.outboundRequests.length, 1, mode);
          const outbound = result.outboundRequests[0];
          const expected = headers === undefined ? [] : Array.isArray(headers) ? [...headers] : Object.entries(headers);
          if (json && !expected.some(([name]) => name.toLowerCase() === 'content-type')) expected.push(['content-type', 'application/json; charset=utf-8']);
          assert.deepEqual(outbound.headers, expected, `${mode} ${method} json=${json} ${JSON.stringify(headers)}`);
          assert.equal(outbound.method, method);
          assert.equal(Buffer.from(outbound.body).toString(), json ? JSON.stringify({ id: '7', name: 'tuple é', score: 42.5, active: true }) : 'plain é');
        }
      }
    }
    for (const headers of [null, 'headers', 7, [null], [['x']], [['x', 'y', 'z']], [[7, 'value']], [['x', 7]], { x: 7 },
      [['', 'value']], [['bad name', 'value']], [['x', 'a\r\nb']], [['x', 'a\0b']]]) {
      for (const json of [true, false]) {
        assert.throws(() => run({ method: 'POST', headers, json }), error => {
          assert.equal(error.detail.errorStage, 74, `${mode} ${JSON.stringify(headers)}`);
          assert.equal(error.detail.trace.some(entry => entry.module === 'fastly_http_req' && ['new', 'send_async'].includes(entry.name)), false,
            `${mode} invalid headers must fail before allocating or dispatching an outbound request`);
          return true;
        });
      }
    }
  }
  console.log(`ok - Fastly ${kind} outbound record/tuple headers, JSON content type, duplicates and invalid admission`);
}

module.exports = { main };
if (require.main === module) main(process.argv[2]);
