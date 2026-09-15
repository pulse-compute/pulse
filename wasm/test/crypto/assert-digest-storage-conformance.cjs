#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
async function main(options = {}) {
  const { resolveProject, compileNativeProjectInMemory, prepareJavascriptApplication, executeCanonicalNativeModule,
    executeNodeJavascriptApplication, compileFastly, executeFastlyNativePlatformCapabilities, driver } = acceptanceToolchain(options.packedRoot);
  const cwd = options.cwd || fs.mkdtempSync(path.join(__dirname, '.digest-storage-'));
  const load = options.packedRoot ? createRequire(path.join(options.packedRoot, 'package.json')) : require;
  const { createCanonicalSchemaCodecs } = load(options.packedRoot ? '@pulse-compute/wasm-schema-json/compiler/canonical-schema-codecs' : '../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
  try {
    if (!options.packedRoot) {
      fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
      for (const name of ['pulse', 'crypto', 's3']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    }
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true }); fs.mkdirSync(path.join(cwd, '.pulse'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'digest-storage-consumer.ts'), path.join(cwd, 'src/index.ts'));
    fs.writeFileSync(path.join(cwd, 'src/schemas.ts'), "import {defineSchemaRegistry, schema} from '@pulse-compute/pulse/schema'; interface Resource { text: string }; export default defineSchemaRegistry({schemas:{'app.Resource':schema<Resource>()}})");
    const bindings = structuredClone(require('../s3/o1/bindings.json'));
    bindings.node.bindings.s3.objects.maxTextBytes = 2097152;
    bindings.fastly.bindings.s3.objects.maxTextBytes = 2097152;
    const config = { pulse: { entry: 'src/index.ts', schema: 'src/schemas.ts', defaultProfile: 'node-native', strict: false, crypto: ['SHA-256', 'HMAC-SHA256'] } };
    for (const [host, target] of [['node', 'native'], ['node', 'javascript'], ['fastly', 'native']]) config[`${host}-${target}`] = { host, target, schemas: { maxBytes: 12648448 }, [host]: bindings[host] };
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope) => (${JSON.stringify(config)}))`);
    const projects = Object.fromEntries(Object.keys(config).filter(name => name !== 'pulse').map(profile => [profile, resolveProject({ cwd, profile })]));
    const node = compileNativeProjectInMemory(projects['node-native']);
    const fastly = compileFastly(projects['fastly-native']);
    const js = prepareJavascriptApplication(projects['node-javascript']);
    const rows = ['', '\ufeffé😀\u0000\r\n', '{ "b":2, "a":1 }', 'a'.repeat(2097152), '\u0000'.repeat(2097152), 'a'.repeat(2097153)].map(text => ({ text, route: '/flow' }));
    rows.push({ text: '\ufeffé😀\u0000\r\n', route: '/encoded' });
    let executions = 0, nativeMemoryBytes = 0;
    for (const row of rows) for (const mode of Object.keys(projects)) {
      const text = row.route === '/encoded' ? JSON.stringify({ text: row.text }) : row.text;
      const bytes = Buffer.from(text), sha256 = createHash('sha256').update(bytes).digest('hex');
      const objectUrl = `${bindings.node.bindings.s3.objects.endpoint}/${bindings.node.bindings.s3.objects.bucket}/digest-proof`;
      const fixtures = { [`PUT ${objectUrl}`]: { status: 200, headers: [['content-length', '0']], body: '' } };
      let sends = 0;
      const accept = request => {
        sends++;
        if (request.method === 'PUT') {
          assert.deepEqual(Buffer.from(request.body), bytes, `${mode}: uploaded exact original/encoded bytes`);
          assert.equal(Object.fromEntries(request.headers)['x-amz-content-sha256'], sha256);
          fixtures[`GET ${objectUrl}`] = { status: 200, headers: [['content-length', String(bytes.length)]], body: bytes };
        }
      };
      const request = { method: 'POST', path: row.route, url: `https://digest.test${row.route}`, headers: [], body: JSON.stringify({ text: row.text, discarded: true }) };
      const secrets = { S3_ACCESS_KEY_ID: 'd1-access', S3_SECRET_ACCESS_KEY: 'd1-secret' };
      const fetchImplementation = async (url, init) => {
        accept({ url, method: init.method, headers: Object.entries(init.headers), body: init.body || Buffer.alloc(0) });
        const fixture = fixtures[`${init.method} ${url}`]; assert.ok(fixture);
        return { status: fixture.status, headers: fixture.headers, body: new Response(fixture.body).body };
      };
      let result;
      if (mode === 'fastly-native') result = executeFastlyNativePlatformCapabilities(fastly, { request, fixtures, secrets, secretStore: bindings.fastly.bindings.secretStore, clockUnixSeconds: 1369353600, bodyWriteChunkBytes: 97, onOutboundRequest: accept });
      else if (mode === 'node-native') result = await executeCanonicalNativeModule(node.native, driver.executionOptions(projects[mode].providerConfig, { request, secrets, fetchImplementation, strict: false, maxRequestBodyBytes: 12648448, maxStructuredBodyBytes: 12648448 }));
      else {
        const response = await executeNodeJavascriptApplication(js.loaded.application, new Request(request.url, { method: 'POST', body: request.body }), { schemaCodecs: createCanonicalSchemaCodecs(node.compiled.schema.bundle.registry), s3: bindings.node.bindings.s3, secrets, fetchImplementation, strict: false, maxRequestBodyBytes: 12648448, maxStructuredBodyBytes: 12648448 });
        result = { response: { status: response.status, body: await response.text() } };
      }
      if (mode === 'fastly-native') {
        nativeMemoryBytes = Math.max(nativeMemoryBytes, result.instance.exports.memory.buffer.byteLength);
        assert.ok(nativeMemoryBytes <= 268435456, 'Fastly storage execution stays within 256 MiB');
      }
      assert.equal(result.response.status, 200, mode);
      const actual = JSON.parse(result.response.body);
      if (bytes.length > 2097152) {
        assert.deepEqual(actual, { status: 'failed', reason: 'too-large' }); assert.equal(sends, 0);
      } else {
        const digest = { status: 'ok', sha256, byteLength: bytes.length };
        assert.deepEqual(actual.before, digest, `${mode}: before upload`);
        assert.deepEqual(actual.written, { status: 'stored', sha256, byteLength: bytes.length });
        assert.deepEqual(actual.downloaded, { status: 'found', sha256, byteLength: bytes.length, text });
        assert.deepEqual(actual.after, digest, `${mode}: after download`);
        assert.equal(sends, 2);
      }
      executions++;
    }
    const evidence = { status: 'passed', cases: rows.length, executions, nativeMemoryBytes, targets: Object.keys(projects), providerReality: false };
    if (!options.quiet) console.log(JSON.stringify(evidence));
    return evidence;
  } finally { if (!options.cwd) fs.rmSync(cwd, { recursive: true, force: true }); }
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error.stack || error); console.error(JSON.stringify({ detail: error.detail, diagnostics: error.diagnostics })); process.exitCode = 1; });
