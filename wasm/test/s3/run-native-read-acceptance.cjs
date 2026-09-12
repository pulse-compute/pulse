#!/usr/bin/env node
'use strict';

// O1 read corpus, extended to three-target and exact packed acceptance by O4.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('./o1/contract.json');
const bindings = require('./o1/bindings.json');
const root = path.resolve(__dirname, '../../..');

const { acceptanceToolchain } = require('./acceptance-toolchain.cjs');

function cases(vectors) {
  const rows = [];
  const metadata = (body) => ({ byteLength: body.length, etag: '"opaque-o1"', contentType: 'text/plain; charset=utf-8' });
  function add(id, route, key, encoded, body, overrides = {}, expected) {
    const meta = metadata(body);
    const object = { status: 'found', ...meta, text: body.toString('utf8'), sha256: crypto.createHash('sha256').update(body).digest('hex') };
    const head = { status: 'found', ...meta };
    rows.push({
      id, route, key, url: `https://objects.example.invalid/o1-fixture/${encoded}`,
      origin: {
        status: 200,
        headers: { 'content-length': String(body.length), etag: meta.etag, 'content-type': meta.contentType },
        body, ...overrides,
      },
      expected: expected || (route === '/head' ? head : route === '/parallel' ? { metadata: head, object } : object),
    });
  }
  for (const [i, { key, encoded }] of vectors.keys.entries()) {
    for (const route of ['/head', '/get']) add(`key-${i}${route}`, route, key, encoded, Buffer.from('object\n'));
  }
  for (const v of vectors.bodies) add(`body-${v.id}`, '/get', 'body', 'body', Buffer.from(v.hex, 'hex'));
  add('maximum-json-escaping', '/get', 'escaped', 'escaped', Buffer.alloc(32768));
  add('parallel', '/parallel', '/a//b/', '/a//b/', Buffer.from('parallel'));
  const failure = (reason, httpStatus = 200) => ({ status: 'failed', reason, httpStatus });
  for (const hex of vectors.invalidUtf8) {
    add(`utf8-${hex}`, '/get', 'invalid', 'invalid', Buffer.from(hex, 'hex'), {}, failure('invalid-utf8'));
  }
  for (const size of [contract.limits.textUtf8Bytes, contract.limits.textUtf8Bytes + 1]) {
    const bytes = Buffer.alloc(size, 0x61);
    add(`size-${size}`, '/get', 'size', 'size', bytes, {}, size > contract.limits.textUtf8Bytes ? failure('too-large') : undefined);
    add(`head-size-${size}`, '/head', 'size', 'size', bytes);
  }
  for (const [status, reason] of [[403, 'not-authorized'], [429, 'throttled'], [500, 'unavailable'], [408, 'timeout'], [302, 'protocol'], [204, 'protocol']]) {
    for (const route of ['/head', '/get']) add(`status-${status}${route}`, route, 'status', 'status', Buffer.alloc(0), { status }, failure(reason, status));
  }
  for (const route of ['/head', '/get']) add(`absent${route}`, route, 'absent', 'absent', Buffer.alloc(0), { status: 404 }, { status: 'not-found' });
  add('head-missing-length', '/head', 'length', 'length', Buffer.alloc(0), { headers: {} }, failure('protocol'));
  add('get-wrong-length', '/get', 'length', 'length', Buffer.from('abc'), { headers: { 'content-length': '4' } }, failure('protocol'));
  add('get-truncated-stream', '/get', 'truncated', 'truncated', Buffer.from('abc'), { bodyReadStatus: 1 }, failure('protocol'));
  for (const route of ['/head', '/get']) add(`transport${route}`, route, 'transport', 'transport', Buffer.alloc(0), { transportStatus: 1 }, { status: 'failed', reason: 'transport' });
  add('get-encoded', '/get', 'encoded', 'encoded', Buffer.from('abc'), { headers: { 'content-encoding': 'gzip' } }, failure('protocol'));
  for (const [i, key] of ['', '.', 'a/../b', 'a'.repeat(contract.limits.keyUtf8Bytes + 1)].entries()) {
    rows.push({ id: `invalid-key-${i}`, route: '/get', key, expected: { status: 'failed', reason: 'invalid-key' } });
  }
  for (const headers of [[['content-length', '1'], ['Content-Length', '1']], [['etag', 'a'], ['etag', 'b']], [['content-length', '01']], [['etag', 'x'.repeat(1025)]], [['x-extra', 'x'.repeat(16384)]]]) add(`headers-${rows.length}`, '/get', 'headers', 'headers', Buffer.from('a'), { headers }, failure('protocol'));
  add('utf8-metadata', '/get', 'meta', 'meta', Buffer.from('a'), { headers: { 'content-length': '1', etag: '"é"' } }, { status: 'found', byteLength: 1, etag: '"é"', text: 'a', sha256: crypto.createHash('sha256').update('a').digest('hex') });
  add('request-deadline', '/get', 'timeout', 'timeout', Buffer.from('a'), { delayMs: 2000 }, { status: 'failed', reason: 'timeout' });
  add('body-deadline', '/get', 'timeout', 'timeout', Buffer.from('a'), { bodyDelayMs: 2000 }, failure('timeout'));
  for (const field of ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_SESSION_TOKEN']) rows.push({ id: `credentials-${field}`, route: '/get', key: 'key', secrets: { [field]: '' }, expected: { status: 'failed', reason: 'credentials' } });
  return rows;
}

function verifySignature(request, secrets) {
  const headers = Object.fromEntries(request.headers instanceof Headers ? request.headers : request.headers);
  const authorization = headers.authorization;
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8}\/[^/]+\/s3\/aws4_request), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(authorization);
  assert.ok(match, 'SigV4 authorization syntax');
  assert.equal(match[1], secrets.S3_ACCESS_KEY_ID);
  const names = match[3].split(';'); assert.deepEqual(names, [...names].sort());
  assert.equal(headers['x-amz-content-sha256'], crypto.createHash('sha256').update('').digest('hex'));
  assert.equal(headers['x-amz-security-token'], secrets.S3_SESSION_TOKEN);
  const url = new URL(request.url);
  assert.equal(url.search, ''); assert.equal(headers.host, url.host);
  const canonical = [request.method, url.pathname, '', names.map((name) => `${name}:${headers[name]}\n`).join(''), names.join(';'), headers['x-amz-content-sha256']].join('\n');
  const signing = ['AWS4-HMAC-SHA256', headers['x-amz-date'], match[2], crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
  let key = Buffer.from('AWS4' + secrets.S3_SECRET_ACCESS_KEY);
  for (const part of match[2].split('/')) key = crypto.createHmac('sha256', key).update(part).digest();
  assert.equal(match[4], crypto.createHmac('sha256', key).update(signing).digest('hex'), 'independent SigV4 verification');
}

async function main(options = {}) {
  const { resolveProject, inspectProject, compileNativeProjectInMemory, prepareJavascriptApplication,
    executeCanonicalNativeModule, executeNodeJavascriptApplication, compileFastly,
    executeFastlyNativePlatformCapabilities, driver } = acceptanceToolchain(options.packedRoot);
  const cwd = options.cwd || fs.mkdtempSync(path.join(__dirname, '.native-read-'));
  try {
    fs.cpSync(path.join(__dirname, 'o1/native-read'), cwd, { recursive: true });
    if (!options.packedRoot) {
      fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
      for (const name of ['pulse', 's3']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    }
    // Literal provider fragments go through the actual config compiler/schema.
    // They cannot be silently dropped and reintroduced through a custom host.
    const readBindings = structuredClone(bindings);
    for (const name of ['node', 'fastly']) Object.assign(readBindings[name].bindings.s3.objects, { timeoutMs: 1000, sessionTokenSecret: 'S3_SESSION_TOKEN' });
    const config = {
      pulse: { entry: 'src/index.ts', defaultProfile: 'node-native', strict: false, crypto: ['SHA-256', 'HMAC-SHA256'] },
      'node-native': { host: 'node', target: 'native', node: readBindings.node },
      'node-javascript': { host: 'node', target: 'javascript', node: readBindings.node },
      'fastly-native': { host: 'fastly', target: 'native', fastly: readBindings.fastly },
    };
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'),
      `import { defineConfig } from '@pulse-compute/pulse'\nexport default defineConfig((_scope) => (${JSON.stringify(config, null, 2)}))\n`);
    const nodeProject = resolveProject({ cwd, profile: 'node-native' });
    const fastlyProject = resolveProject({ cwd, profile: 'fastly-native' });
    for (const project of [nodeProject, fastlyProject]) {
      assert.equal(project.target, 'native');
      const inspection = inspectProject(project);
      assert.equal(inspection.provider.selectedTargetDescriptor.automaticFallback, false);
      assert.ok(project.providerConfig.bindings.s3.objects, 'provider config must preserve and validate the logical S3 binding');
    }
    const node = compileNativeProjectInMemory(nodeProject);
    const fastly = compileFastly(fastlyProject);
    const jsProject = resolveProject({ cwd, profile: 'node-javascript' });
    assert.equal(inspectProject(jsProject).provider.targetSupport.project.status, 'eligible');
    const js = prepareJavascriptApplication(jsProject);
    assert.ok(node.native.wasm.length > 0 && fastly.wasm.length > 0);
    assert.equal(fastly.inspection.imports.some(({ module }) => /pulse_host|js[_-]?compute/i.test(module)), false);
    const secrets = {
      S3_ACCESS_KEY_ID: 'o1-access-id-secret-sentinel',
      S3_SESSION_TOKEN: 'session-token-sentinel',
      S3_SECRET_ACCESS_KEY: 'o1-secret-key-sentinel-12345678901234567890',
    };
    for (const artifact of [node.native.wasm, fastly.wasm]) {
      for (const secret of Object.values(secrets)) assert.equal(Buffer.from(artifact).includes(Buffer.from(secret)), false);
    }
    const vectorsFile = options.packedRoot
      ? path.join(options.packedRoot, 'node_modules/@pulse-compute/s3/conformance/read.json')
      : path.join(root, 'packages/s3/conformance/read.json');
    const rows = cases(JSON.parse(fs.readFileSync(vectorsFile, 'utf8')));
    for (const row of rows) {
      const caseSecrets = { ...secrets, ...row.secrets };
      const request = { method: 'POST', path: row.route, url: `https://app.example.invalid${row.route}`, headers: [], body: row.key };
      const methods = !row.origin ? [] : row.route === '/parallel' ? ['GET', 'HEAD'] : [row.route === '/head' ? 'HEAD' : 'GET'];
      const captured = [];
      const fetchImplementation = async (input, init) => {
        const req = new Request(input, init);
        captured.push({ method: req.method, url: req.url });
        assert.ok(row.origin, `${row.id}: invalid input must not dispatch`);
        assert.equal(req.redirect, 'manual', `${row.id}: redirects must be disabled`);
        assert.equal(req.headers.get('accept-encoding'), 'identity');
        verifySignature({ method: req.method, url: req.url, headers: req.headers }, caseSecrets);
        if (row.origin.transportStatus) throw new Error('Fixture origin transport failed');
        if (row.origin.delayMs) return new Promise(() => {});
        const response = new Response(req.method === 'HEAD' || row.origin.status === 204 ? null : row.origin.body, { status: row.origin.status });
        return { status: row.origin.status, headers: Array.isArray(row.origin.headers) ? row.origin.headers : Object.entries(row.origin.headers),
          body: row.origin.bodyReadStatus ? new ReadableStream({ start(controller) { controller.error(new Error('Fixture origin body truncated')); } })
            : row.origin.bodyDelayMs ? new ReadableStream({ start() {} }) : response.body };
      };
      const nodeResult = await executeCanonicalNativeModule(node.native, driver.executionOptions(nodeProject.providerConfig, {
        request, strict: false, secrets: caseSecrets, fetchImplementation,
      }));
      assert.equal(nodeResult.status, 'completed', row.id);
      for (const event of nodeResult.trace.filter((event) => event.type === 'native-effect-start' || event.type === 'native-effect-resolved')) {
        assert.equal(event.payload || event.result, '<redacted>', 'S3 effect trace is private');
      }
      const jsCapturedStart = captured.length;
      const jsTrace = [];
      const jsResponse = await executeNodeJavascriptApplication(js.loaded.application,
        new Request(request.url, { method: 'POST', body: row.key }), {
          s3: readBindings.node.bindings.s3, secrets: caseSecrets, fetchImplementation,
          strict: false,
          onEffectObservation(event) { jsTrace.push(event); },
        });
      const jsResult = { response: { status: jsResponse.status, body: await jsResponse.text() }, trace: jsTrace };
      const jsCaptured = captured.splice(jsCapturedStart);
      const fixtures = Object.fromEntries(methods.map((method) => [`${method} ${row.url}`, {
        ...row.origin, body: method === 'HEAD' ? Buffer.alloc(0) : row.origin.body,
      }]));
      const fastlyCaptured = [];
      const fastlyResult = executeFastlyNativePlatformCapabilities(fastly, {
        request, secretStore: bindings.fastly.bindings.secretStore, secrets: caseSecrets, fixtures,
        clockUnixSeconds: 1369353600,
        onOutboundRequest(request) {
          verifySignature(request, caseSecrets); assert.equal(request.cacheOverride, 1); assert.equal(request.decompression, 0);
          assert.equal(Object.fromEntries(request.headers)['x-amz-date'], '20130524T000000Z');
          fastlyCaptured.push({ method: request.method, url: request.url });
        },
      });
      for (const [target, result, outbound] of [
        ['node-native', nodeResult, captured],
        ['node-javascript', jsResult, jsCaptured],
        ['fastly-native', fastlyResult, fastlyCaptured],
      ]) {
        assert.equal(result.response.status, 200, `${row.id}/${target}: consumer result`);
        assert.deepEqual(JSON.parse(result.response.body), row.expected, `${row.id}/${target}: exact result`);
        assert.deepEqual(outbound.map(({ method, url }) => `${method} ${url}`).sort(),
          methods.map((method) => `${method} ${row.url}`).sort(), `${row.id}/${target}: exact origin requests, no retries`);
        assert.ok(result.trace.length > 0, `${row.id}/${target}: actual observations required`);
        const observations = JSON.stringify({ trace: result.trace, requests: result.outboundRequests });
        if (row.origin) assert.equal(observations.includes(crypto.createHash('sha256').update(row.origin.body).digest('hex')), false, `${row.id}/${target}: raw-byte digest is private`);
        for (const secret of Object.values(secrets)) assert.equal(JSON.stringify(result).includes(secret), false, `${row.id}/${target}: secret redaction`);
      }
    }
    const evidence = { status: 'passed', cases: rows.length, executions: rows.length * 3,
      targets: ['node-native', 'node-javascript', 'fastly-native'], providerReality: false };
    if (!options.quiet) console.log(JSON.stringify(evidence));
    return evidence;
  } finally {
    if (!options.cwd) fs.rmSync(cwd, { recursive: true, force: true });
  }
}

module.exports = { main };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error);
  console.error(JSON.stringify(error.detail || error.diagnostics || {}));
  process.exitCode = 1;
});
