#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { inspectProject, compileNativeProjectInMemory, prepareJavascriptApplication } = require('../../packages/cli/src/project-execution.js');
const { getProviderDriver } = require('../../packages/cli/src/provider-drivers.js');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { executeNodeJavascriptApplication } = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const root = path.resolve(__dirname, '../../..');
const secrets = { S3_ACCESS_KEY_ID: 'o3-access-sentinel', S3_SECRET_ACCESS_KEY: 'o3-secret-sentinel', S3_SESSION_TOKEN: 'o3-token-sentinel' };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stored = (text) => ({ status: 'stored', byteLength: Buffer.byteLength(text), sha256: hash(Buffer.from(text)), etag: '"opaque"' });
const failure = (status, reason, httpStatus) => ({ status, reason, ...(httpStatus === undefined ? {} : { httpStatus }) });

function verify(request) {
  const headers = Object.fromEntries(request.headers instanceof Headers ? request.headers : request.headers);
  const body = request.body || Buffer.alloc(0);
  assert.equal(headers['x-amz-content-sha256'], hash(body));
  assert.equal(headers['x-amz-security-token'], secrets.S3_SESSION_TOKEN);
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8}\/[^/]+\/s3\/aws4_request), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(headers.authorization);
  assert.ok(match); assert.equal(match[1], secrets.S3_ACCESS_KEY_ID);
  const names = match[3].split(';'); assert.deepEqual(names, [...names].sort());
  assert.equal(names.includes('content-type'), request.method === 'PUT');
  const url = new URL(request.url); assert.equal(url.search, ''); assert.equal(headers.host, url.host);
  const canonical = [request.method, url.pathname, '', names.map((name) => `${name}:${headers[name].replace(/ +/g, ' ')}\n`).join(''), names.join(';'), headers['x-amz-content-sha256']].join('\n');
  const signing = ['AWS4-HMAC-SHA256', headers['x-amz-date'], match[2], hash(canonical)].join('\n');
  let key = Buffer.from('AWS4' + secrets.S3_SECRET_ACCESS_KEY);
  for (const part of match[2].split('/')) key = crypto.createHmac('sha256', key).update(part).digest();
  assert.equal(match[4], crypto.createHmac('sha256', key).update(signing).digest('hex'), 'Independent SigV4 oracle');
}

function cases() {
  const rows = ['', 'hello', '\ufeffé😀\u0000', 'a'.repeat(32768), '\u0000'.repeat(32768)].map((text, index) => ({ id: `flow-${index}`, route: '/flow', key: '/a//%2F/é', text }));
  rows.push({ id: 'parallel', route: '/parallel', text: 'first', key: 'parallel-first' });
  for (const [status, result, reason] of [[404, 'not-stored', 'rejected'], [400, 'not-stored', 'rejected'], [401, 'not-stored', 'not-authorized'], [403, 'not-stored', 'not-authorized'], [429, 'not-stored', 'throttled'], [408, 'unknown', 'timeout'], [500, 'unknown', 'unavailable'], [503, 'unknown', 'unavailable'], [302, 'unknown', 'protocol'], [201, 'unknown', 'protocol'], [204, 'unknown', 'protocol']]) rows.push({ id: `http-${status}`, status, expected: failure(result, reason, status) });
  rows.push(
    { id: 'cancel-before', cancel: 'before', dispatch: false },
    { id: 'cancel-after-send', cancel: 'after' },
    { id: 'write-buffer-failure', modes: ['fastly-native'], outboundBodyWriteStatus: 1, dispatch: false, expected: failure('not-stored', 'transport') },
    { id: 'credential-deadline', modes: ['fastly-native'], secretDelayMs: 1000, dispatch: false, expected: failure('not-stored', 'timeout') },
    { id: 'cancel-credentials', modes: ['fastly-native'], cancel: 'secret', dispatch: false },
    { id: 'truncated-rejection', status: 403, bodyReadStatus: 1, expected: failure('unknown', 'protocol', 403) },
    { id: 'rejection-body', status: 403, body: 'denied', expected: failure('not-stored', 'not-authorized', 403) },
    { id: 'optional-etag', headers: [['content-length', '0']], expected: { status: 'stored', byteLength: 7, sha256: hash('payload') } },
    { id: 'nonempty-ack', body: 'unexpected', expected: failure('unknown', 'protocol', 200) },
    { id: 'missing-ack', transportStatus: 1, expected: failure('unknown', 'transport') },
    { id: 'send-failure', sendStatus: 1, expected: failure('unknown', 'transport') },
    { id: 'truncated-ack', bodyReadStatus: 1, expected: failure('unknown', 'protocol', 200) },
    { id: 'deadline', delayMs: 1000, expected: failure('unknown', 'timeout') },
    { id: 'ack-deadline', bodyDelayMs: 1000, expected: failure('unknown', 'timeout', 200) },
    { id: 'malformed-ack', headers: [['etag', 'a'], ['etag', 'b']], expected: failure('unknown', 'protocol', 200) },
    { id: 'wrong-length', headers: [['content-length', '1']], expected: failure('unknown', 'protocol', 200) },
    { id: 'encoding', headers: [['content-encoding', 'gzip']], expected: failure('unknown', 'protocol', 200) },
    { id: 'too-large', text: 'a'.repeat(32769), dispatch: false, expected: failure('not-stored', 'too-large') },
    { id: 'invalid-key', key: 'a/../b', dispatch: false, expected: failure('not-stored', 'invalid-key') },
    { id: 'invalid-text', text: '\ud800', dispatch: false, expected: failure('not-stored', 'invalid-text') },
    { id: 'credentials', secrets: { S3_ACCESS_KEY_ID: '' }, dispatch: false, expected: failure('not-stored', 'credentials') }
  );
  return rows.map((row) => ({ route: '/put', key: 'write', text: 'payload', status: 200, body: '', ...row }));
}

async function main() {
  const cwd = fs.mkdtempSync(path.join(__dirname, '.write-'));
  try {
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 's3']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    fs.mkdirSync(path.join(cwd, 'src')); fs.mkdirSync(path.join(cwd, '.pulse'));
    fs.copyFileSync(path.join(__dirname, 'o3-consumer.ts'), path.join(cwd, 'src/index.ts'));
    const bindings = structuredClone(require('./o1/bindings.json'));
    for (const provider of ['node', 'fastly']) Object.assign(bindings[provider].bindings.s3.objects, { sessionTokenSecret: 'S3_SESSION_TOKEN', timeoutMs: 250 });
    const config = { pulse: { entry: 'src/index.ts', defaultProfile: 'node-native', strict: false, crypto: ['SHA-256', 'HMAC-SHA256'] } };
    for (const provider of ['node', 'fastly']) for (const target of ['native', 'javascript']) config[`${provider}-${target}`] = { host: provider, target, schemas: { maxBytes: 262144 }, [provider]: bindings[provider] };
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import { defineConfig } from '@pulse-compute/pulse'\nexport default defineConfig((_scope) => (${JSON.stringify(config)}))`);
    const projects = Object.fromEntries(Object.keys(config).filter((name) => name !== 'pulse').map((profile) => [profile, resolveProject({ cwd, profile })]));
    const node = compileNativeProjectInMemory(projects['node-native']);
    const fastly = compileFastlyNativePlatformCapabilitiesPlan(compileNativeProjectInMemory(projects['fastly-native']).plan, { cwd: root, bindings: bindings.fastly.bindings, canonicalBuild: true });
    const jsInspection = inspectProject(projects['node-javascript']);
    assert.equal(jsInspection.provider.selectedTargetDescriptor.automaticFallback, false);
    assert.equal(jsInspection.provider.targetSupport.project.status, 'eligible', JSON.stringify(jsInspection.provider.targetSupport));
    const js = prepareJavascriptApplication(projects['node-javascript']);
    assert.ok(js.loaded && js.loaded.application);
    assert.throws(() => inspectProject(projects['fastly-javascript']), /has no HMAC-SHA256 realization/);
    const unsupported = require('../../../packages/provider-fastly/src/javascript/target-support-policy.js');
    assert.ok(JSON.stringify(unsupported.classifyFastlyJavascriptProviderRequirement('s3.putText')).includes('fastly-javascript-s3-raw-headers-unavailable'), 'SDK limitation is provider/target specific.');
    assert.equal(fastly.inspection.imports.some(({ module }) => /pulse_host|js[_-]?compute/i.test(module)), false);
    const driver = getProviderDriver('node', { projectRoot: cwd });
    const rows = cases(); let executions = 0;
    for (const row of rows) for (const mode of ['node-native', 'node-javascript', 'fastly-native']) {
      if (row.modes && !row.modes.includes(mode)) continue;
      executions++;
      const cancellation = new AbortController();
      const cancel = () => cancellation.abort(new Error('O3 invocation cancelled'));
      if (row.cancel === 'before') cancel();
      const origin = new Map(), attempts = [], fixtures = {};
      const initial = { status: row.status, headers: row.headers || [['content-length', String(Buffer.byteLength(row.body))], ['etag', '"opaque"']], body: row.body,
        transportStatus: row.transportStatus, sendStatus: row.sendStatus, bodyReadStatus: row.bodyReadStatus, delayMs: row.delayMs, bodyDelayMs: row.bodyDelayMs };
      const endpoint = bindings.node.bindings.s3.objects.endpoint, bucket = bindings.node.bindings.s3.objects.bucket;
      const objectUrl = (key) => `${endpoint}/${bucket}/` + key.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
      fixtures[`PUT ${objectUrl(row.key)}`] = initial;
      fixtures[`PUT ${objectUrl('parallel-other')}`] = initial;
      const accept = (request) => {
        verify(request); attempts.push(request);
        if (request.method === 'PUT') {
          assert.deepEqual(Buffer.from(request.body), Buffer.from(request.url === objectUrl('parallel-other') ? 'second' : row.text), `${row.id}/${mode}: exact encoded body`);
          const headers = Object.fromEntries(request.headers);
          assert.equal(headers['content-type'], row.route === '/flow' ? 'application/json;  charset=utf-8' : 'text/plain; charset=utf-8');
          if (row.status >= 400 && row.status <= 499 && row.status !== 408) return;
          // The origin accepts before a deliberately lost acknowledgement.
          origin.set(request.url, Buffer.from(request.body));
          const bytes = origin.get(request.url);
          const metadata = [['content-length', String(bytes.length)], ['etag', '"opaque"'], ['content-type', headers['content-type']]];
          fixtures[`GET ${request.url}`] = { status: 200, headers: metadata, body: bytes };
          fixtures[`HEAD ${request.url}`] = { status: 200, headers: metadata, body: '' };
          if (row.cancel === 'after') cancel();
        }
      };
      const fetchImplementation = async (url, init) => {
        const request = { url, method: init.method, headers: Object.entries(init.headers), body: init.body || Buffer.alloc(0) };
        assert.equal(init.redirect, 'manual'); assert.equal(init.cache, 'no-store');
        const fixture = fixtures[`${init.method} ${url}`]; assert.ok(fixture);
        accept(request);
        if (fixture.sendStatus || fixture.transportStatus) throw new Error('Injected loss after send entry.');
        if (fixture.delayMs) return new Promise(() => {});
        const body = fixture.bodyDelayMs ? new ReadableStream({ start() {} }) : fixture.bodyReadStatus ? new ReadableStream({ start(controller) { controller.error(new Error('Truncated acknowledgement')); } })
          : new Response(fixture.body).body;
        return { status: fixture.status, headers: fixture.headers, body };
      };
      const request = { method: 'POST', path: row.route, url: `https://app.example.test${row.route}`, headers: [], body: JSON.stringify({ key: row.key, text: row.text }) };
      let result;
      const execute = async () => {
      if (mode === 'fastly-native') {
        result = executeFastlyNativePlatformCapabilities(fastly, { request, fixtures, secrets: { ...secrets, ...row.secrets }, secretStore: bindings.fastly.bindings.secretStore,
          signal: cancellation.signal, secretDelayMs: row.secretDelayMs, outboundBodyWriteStatus: row.outboundBodyWriteStatus,
          onSecretLookup() { if (row.cancel === 'secret') cancel(); },
          bodyWriteChunkBytes: 97, clockUnixSeconds: 1369353600,
          onOutboundRequest(request) { assert.equal(request.cacheOverride, 1); assert.equal(request.decompression, 0); accept(request); }
        });
      } else if (mode === 'node-native') {
        result = await executeCanonicalNativeModule(node.native, driver.executionOptions(projects[mode].providerConfig, { signal: cancellation.signal, request, secrets: { ...secrets, ...row.secrets }, fetchImplementation, strict: false, maxRequestBodyBytes: 262144, maxStructuredBodyBytes: 262144 }));
      } else {
        const trace = [];
        const response = await executeNodeJavascriptApplication(js.loaded.application, new Request(request.url, { method: 'POST', body: request.body }), {
          signal: cancellation.signal, s3: bindings.node.bindings.s3, secrets: { ...secrets, ...row.secrets }, fetchImplementation, strict: false, maxRequestBodyBytes: 262144, maxStructuredBodyBytes: 262144,
          onEffectObservation(event) { trace.push(event); }
        });
        result = { response: { status: response.status, body: await response.text() }, trace };
      }
      return result;
      };
      if (row.cancel) {
        if (mode === 'node-javascript') {
          const cancelled = await execute();
          assert.equal(cancelled.response.status, 500, 'Router retains its existing aborted-request error response');
          assert.equal(cancelled.response.body.includes('"status":"stored"'), false);
          assert.equal(cancelled.response.body.includes('"status":"unknown"'), false, 'Cancellation is not a typed S3 outcome');
        } else await assert.rejects(execute(), /cancel/i, `${row.id}/${mode}: cancellation terminates invocation`);
        assert.equal(attempts.length, row.dispatch === false ? 0 : 1);
        if (row.cancel === 'after') assert.ok(origin.has(objectUrl(row.key)), 'Cancellation cannot promise rollback.');
        continue;
      }
      result = await execute();
      assert.equal(result.response.status, 200, `${row.id}/${mode}: application response`);
      const actual = JSON.parse(result.response.body);
      let expected = row.expected || stored(row.text);
      if (row.route === '/flow') expected = { written: stored(row.text), inspected: {
        metadata: { status: 'found', byteLength: Buffer.byteLength(row.text), etag: '"opaque"', contentType: 'application/json;  charset=utf-8' },
        object: { status: 'found', byteLength: Buffer.byteLength(row.text), etag: '"opaque"', contentType: 'application/json;  charset=utf-8', text: row.text, sha256: hash(Buffer.from(row.text)) }
      } };
      if (row.route === '/parallel') expected = { first: stored(row.text), second: stored('second') };
      assert.deepEqual(actual, expected, `${row.id}/${mode}`);
      if (actual.status === 'not-stored') assert.equal(origin.has(objectUrl(row.key)), false, 'Pre-dispatch failures and complete rejections do not write the fixture object');
      assert.equal(attempts.length, row.dispatch === false ? 0 : row.route === '/flow' ? 3 : row.route === '/parallel' ? 2 : 1, `${row.id}/${mode}: no retries`);
      const observations = JSON.stringify({ trace: result.trace, requests: result.outboundRequests });
      assert.ok(result.trace.length > 0, 'Every target supplies actual observations for redaction checks');
      assert.equal(observations.includes('application/json;  charset=utf-8'), false, `${row.id}/${mode}: object metadata omitted`);
      assert.equal(observations.includes(hash(Buffer.from(row.text))), false, `${row.id}/${mode}: digest omitted from provider observations`);
      for (const value of Object.values(secrets)) assert.equal(JSON.stringify(result).includes(value), false, `${row.id}/${mode}: redacted credentials`);
      if (row.transportStatus || row.sendStatus || row.delayMs || row.bodyDelayMs) assert.ok(origin.has(objectUrl(row.key)), 'Unknown may already have stored bytes.');
    }
    console.log(JSON.stringify({ status: 'passed', cases: rows.length, executions, targets: ['node-native', 'node-javascript', 'fastly-native'], fastlyJavascript: 'documented-sdk-limitation', providerReality: false }));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error.stack || error); console.error(JSON.stringify(error.detail || error.diagnostics || {})); process.exitCode = 1; });
