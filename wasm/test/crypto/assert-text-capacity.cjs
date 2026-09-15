#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const maximum = 2097152;
const digest = text => ({ status: 'ok', byteLength: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });
async function main(options = {}) {
  const t = acceptanceToolchain(options.packedRoot);
  const load = options.packedRoot ? createRequire(path.join(options.packedRoot, 'package.json')) : require;
  const { createCanonicalSchemaCodecs } = load(options.packedRoot ? '@pulse-compute/wasm-schema-json/compiler/canonical-schema-codecs' : '../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
  const cwd = options.cwd || fs.mkdtempSync(path.join(__dirname, '.capacity-'));
  try {
    if (!options.packedRoot) {
      fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
      for (const name of ['pulse', 'crypto', 's3']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    }
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true }); fs.mkdirSync(path.join(cwd, '.pulse'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'text-capacity-consumer.ts'), path.join(cwd, 'src/index.ts'));
    fs.writeFileSync(path.join(cwd, 'src/schemas.ts'), "import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema'; interface Text {text:string}; export default defineSchemaRegistry({schemas:{'app.Text':schema<Text>()}})");
    const bindings = structuredClone(require('../s3/o1/bindings.json'));
    for (const host of ['node', 'fastly']) {
      bindings[host].bindings.s3.objects.maxTextBytes = maximum;
      bindings[host].bindings.s3.small = { ...bindings[host].bindings.s3.objects, maxTextBytes: 3 };
    }
    const config = { pulse: { entry: 'src/index.ts', schema: 'src/schemas.ts', strict: false, crypto: ['SHA-256', 'HMAC-SHA256'] } };
    for (const [host, target] of [['node', 'native'], ['node', 'javascript'], ['fastly', 'native']]) config[`${host}-${target}`] = { host, target, schemas: { maxBytes: maximum }, [host]: bindings[host] };
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>(${JSON.stringify(config)}))`);
    const projects = Object.fromEntries(Object.keys(config).filter(p => p !== 'pulse').map(profile => [profile, t.resolveProject({ cwd, profile })]));
    const node = t.compileNativeProjectInMemory(projects['node-native']);
    const fastly = t.compileFastly(projects['fastly-native']);
    const js = t.prepareJavascriptApplication(projects['node-javascript']);
    const controller = t.instantiateCanonicalNativeModule(node.native, t.driver.executionOptions(projects['node-native'].providerConfig, { request: { method: 'GET', path: '/get', headers: [], body: '' }, strict: false }));
    assert.throws(() => controller.exports.memory.grow(4097), RangeError, 'Node Native enforces the 256 MiB module maximum');
    const exactAscii = 'a'.repeat(maximum - 11);
    const exactControls = '\0'.repeat(Math.floor((maximum - 11) / 6)) + 'a'.repeat((maximum - 11) % 6);
    const exactUnicode = '😀'.repeat(Math.floor((maximum - 11) / 4)) + 'a'.repeat((maximum - 11) % 4);
    const rows = [
      { route: '/scan', text: '😀'.repeat(8192), expected: { valid: true, points: 8192 }, noSend: true },
      ...[exactAscii, exactControls, exactUnicode].map(text => ({ route: '/encoded', text })),
      { route: '/response', text: exactUnicode },
      { route: '/encoded', text: exactAscii + 'a', rejected: true },
      { route: '/encode-over', text: 'a'.repeat(maximum / 2), rejected: true },
      { route: '/small', text: 'éa', expected: { status: 'stored', byteLength: 3, sha256: digest('éa').sha256 } },
      { route: '/small', text: '😀', expected: { status: 'not-stored', reason: 'too-large' }, noSend: true },
      ...['a'.repeat(maximum), '\0'.repeat(maximum), '😀'.repeat(maximum / 4)].map(get => ({ route: '/get', get, expected: digest(get) })),
      { route: '/get', get: 'a'.repeat(maximum + 1), expected: { status: 'failed', reason: 'too-large', httpStatus: 200 } },
      { route: '/get-small', get: '😀', expected: { status: 'failed', reason: 'too-large', httpStatus: 200 } },
      { route: '/get', get: Buffer.from([0xf0, 0x9f]), expected: { status: 'failed', reason: 'invalid-utf8', httpStatus: 200 } },
    ];
    let executions = 0, nativeMemoryBytes = 0;
    const objectUrl = `${bindings.node.bindings.s3.objects.endpoint}/${bindings.node.bindings.s3.objects.bucket}/capacity`;
    for (const row of rows) for (const mode of Object.keys(projects)) {
      const encoded = row.text === undefined ? undefined : JSON.stringify({ text: row.text });
      let sends = 0, stored = row.get === undefined ? undefined : Buffer.from(row.get);
      const fixtures = { [`PUT ${objectUrl}`]: { status: 200, headers: [['content-length', '0']], body: '' } };
      // Omit Content-Length to force streamed byte admission and EOF checks.
      const setGet = () => { fixtures[`GET ${objectUrl}`] = { status: 200, headers: [], body: stored, chunkBytes: 65535 }; };
      if (stored) setGet();
      const accept = req => {
        sends++;
        if (req.method === 'PUT') {
          const expected = row.route === '/small' ? row.text : encoded;
          assert.deepEqual(Buffer.from(req.body), Buffer.from(expected), `${mode}: exact schema bytes`);
          assert.equal(Object.fromEntries(req.headers)['x-amz-content-sha256'], digest(expected).sha256);
          stored = Buffer.from(req.body); setGet();
        }
      };
      const fetchImplementation = async (url, init) => {
        accept({ method: init.method, headers: Object.entries(init.headers), body: init.body });
        const f = fixtures[`${init.method} ${url}`]; assert.ok(f);
        return { status: f.status, headers: f.headers, body: new Response(f.body).body };
      };
      const request = { method: row.get === undefined ? 'POST' : 'GET', path: row.route, url: `https://capacity.test${row.route}`, headers: [], body: encoded || '' };
      const secrets = { S3_ACCESS_KEY_ID: 'capacity-access', S3_SECRET_ACCESS_KEY: 'capacity-secret' };
      const runtime = { request, secrets, fetchImplementation, strict: false, maxRequestBodyBytes: maximum, maxStructuredBodyBytes: maximum };
      let result, error;
      try {
        if (mode === 'fastly-native') {
          result = t.executeFastlyNativePlatformCapabilities(fastly, { request, fixtures, secrets, secretStore: bindings.fastly.bindings.secretStore, clockUnixSeconds: 1369353600, bodyWriteChunkBytes: 65535, onOutboundRequest: accept });
          nativeMemoryBytes = Math.max(nativeMemoryBytes, result.instance.exports.memory.buffer.byteLength);
          assert.ok(nativeMemoryBytes <= 268435456);
        } else if (mode === 'node-native') result = await t.executeCanonicalNativeModule(node.native, t.driver.executionOptions(projects[mode].providerConfig, runtime));
        else {
          const response = await t.executeNodeJavascriptApplication(js.loaded.application, new Request(request.url, { method: request.method, ...(request.method === 'POST' ? { body: encoded } : {}) }), { ...runtime, s3: bindings.node.bindings.s3, schemaCodecs: createCanonicalSchemaCodecs(node.compiled.schema.bundle.registry) });
          result = { response: { status: response.status, body: await response.text() } };
        }
      } catch (caught) { error = caught; }
      if (row.rejected) {
        if (error) assert.ok(['PULSE_BODY_TOO_LARGE', 'PULSE_CANONICAL_NATIVE_EXECUTION_FAILED', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED'].includes(error.code), error.code || error.message);
        if (mode === 'fastly-native' && error) assert.equal(error.detail.lastError, 1005, 'Fastly rejects through the schema boundary');
        assert.ok(error || result.response.status >= 400, `${mode}: oversized request/encoding fails`);
        assert.equal(sends, 0, 'Capacity rejection precedes preparation PUT');
      } else {
        if (error) throw error;
        assert.equal(result.response.status, 200, `${mode}: ${row.route}`);
        if (row.route === '/response') assert.equal(result.response.body, encoded);
        else if (row.expected) assert.deepEqual(JSON.parse(result.response.body), row.expected, `${mode}: ${row.route}`);
        else {
          assert.equal(Buffer.byteLength(encoded), maximum);
          const expected = digest(encoded);
          assert.deepEqual(JSON.parse(result.response.body), { before: expected, written: { ...expected, status: 'stored' }, after: expected });
          assert.equal(sends, 2);
        }
        if (row.noSend) assert.equal(sends, 0);
      }
      executions++;
    }
    const evidence = { status: 'passed', cases: rows.length, executions, nativeMemoryBytes, nativeMaximumBytes: 268435456, targets: Object.keys(projects), providerReality: false };
    if (!options.quiet) console.log(JSON.stringify(evidence));
    return evidence;
  } finally { if (!options.cwd) fs.rmSync(cwd, { recursive: true, force: true }); }
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
