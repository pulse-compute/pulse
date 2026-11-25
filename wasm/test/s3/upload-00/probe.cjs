'use strict';

// UPLOAD-00 current-boundary evidence. No replacement signer, upload effect,
// network transport or production mutation is introduced by this probe.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../../..');
const load = file => require(path.join(root, file));
const { s3 } = load('packages/s3/src/index.js');
const protocol = load('packages/s3/src/provider.js');
const { buildS3LoweringPlan } = load('packages/s3/pulsewasm.compiler.cjs');
const { validateIncomingBodySource } = load('wasm/packages/compiler/src/spine/incoming-body-source.js');
const { createIncomingBodyOwnership, isIncomingBody } = load('packages/runtime/src/internal/incoming-body.js');
const { clonePackageEffectPayload } = load('packages/runtime/src/internal/package-runtime.js');
const { createIncomingBody } = load('packages/provider-node/src/javascript/incoming-body.js');
const { MAX_BODY_BYTES } = load('packages/provider-fastly/src/toolchain/body-forwarding.js');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const cases = [];
  const check = async (name, run) => { cases.push({ name, observed: await run(), status: 'passed' }); };
  await check('upload-operation-not-admitted', () => {
    assert.equal(s3.putBody, undefined);
    const sourceText = "import { s3 } from '@pulse-compute/s3'; app.post('/upload', async ctx => { const result = await s3.putBody(ctx, 'objects', 'key', ctx.req.body()); return ctx.text('done'); });";
    const result = buildS3LoweringPlan({ sourceText });
    assert(result.diagnostics.some(d => d.code === 'PULSEWASM_S3_OPERATION_UNSUPPORTED'));
    return result.diagnostics.map(d => d.code);
  });
  await check('body-source-admission', () => {
    const codes = expression => {
      const sourceFile = ts.createSourceFile('upload-probe.ts', `async function handler(ctx) { return ${expression}; }`, ts.ScriptTarget.ES2022, true);
      return validateIncomingBodySource(sourceFile.statements[0], { sourceFile, ctxName: 'ctx', frontend: 'canonical-source' }).map(d => d.code);
    };
    assert.deepEqual(codes("ctx.fetch('https://origin.test/', {method:'POST', body:ctx.req.body()})"), []);
    const put = codes("ctx.fetch('https://origin.test/', {method:'PUT', body:ctx.req.body()})");
    const packaged = codes("s3.putBody(ctx, 'objects', 'key', ctx.req.body())");
    assert(put.includes('PULSE_REQUEST_FORWARDING_FORM_UNSUPPORTED'));
    assert(packaged.includes('PULSE_REQUEST_FORWARDING_FORM_UNSUPPORTED'));
    return { post: 'admitted', put, packaged };
  });
  await check('marker-is-not-a-package-payload-capability', () => {
    const owner = createIncomingBodyOwnership({ validate() {}, cancel() {} });
    const marker = owner.marker();
    const cloned = clonePackageEffectPayload({ body: marker });
    assert(isIncomingBody(marker));
    assert.notEqual(cloned.body, marker);
    assert.equal(isIncomingBody(cloned.body), false);
    assert.equal(JSON.stringify(cloned), '{"body":{}}');
    return { identityPreserved: false, serialized: JSON.stringify(cloned) };
  });
  await check('node-put-denied-before-read-or-dispatch', async () => {
    let reads = 0, dispatches = 0;
    const body = new ReadableStream({ pull() { reads++; } }, { highWaterMark: 0 });
    const request = new Request('https://app.test/upload', { method: 'POST', body, duplex: 'half' });
    const owner = createIncomingBody(request, { bodyForwarding: { maxBytes: 1048576 }, maxDurationMs: 1000,
      fetchImplementation() { dispatches++; throw Error('unexpected dispatch'); } });
    assert.throws(() => owner.claim(owner.marker(), { method: 'PUT', headers: [] }), { code: 'PULSE_FETCH_BODY_METHOD_UNSUPPORTED' });
    await owner.close();
    assert.equal(reads, 0); assert.equal(dispatches, 0);
    return { code: 'PULSE_FETCH_BODY_METHOD_UNSUPPORTED', reads, dispatches };
  });
  await check('current-s3-signer-requires-complete-bytes', async () => {
    const binding = protocol.normalizeBinding({ endpoint: 'https://objects.example.invalid', bucket: 'upload-probe', region: 'us-east-1', accessKeyIdSecret: 'ID', secretAccessKeySecret: 'SECRET' });
    const inputs = { binding, method: 'PUT', encodedKey: 'binary', accessId: 'fixture-id', secret: 'fixture-secret', now: 0, contentType: 'application/octet-stream' };
    const primitives = { sha256: async data => crypto.createHash('sha256').update(data).digest(), hmacSha256: async (key, data) => crypto.createHmac('sha256', key).update(data).digest() };
    const body = new Uint8Array([0, 255, 128, 10]);
    const signed = await protocol.signRequest({ ...inputs, body }, primitives);
    assert.equal(signed.headers['x-amz-content-sha256'], sha(body));
    assert.equal(signed.body, body);
    const stream = new ReadableStream({}, { highWaterMark: 0 });
    await assert.rejects(protocol.signRequest({ ...inputs, body: stream }, primitives), TypeError);
    await stream.cancel();
    return { bufferedBytesAccepted: body.length, payloadDigest: sha(body), streamRejected: true };
  });
  await check('fastly-forwarding-current-cap', () => {
    assert.equal(MAX_BODY_BYTES, 1048576);
    return { maxBodyBytes: MAX_BODY_BYTES };
  });
  const sources = [
    'packages/s3/src/index.d.ts', 'packages/s3/src/index.js', 'packages/s3/src/provider.js', 'packages/s3/src/signing.js',
    'packages/s3/pulsewasm.compiler.cjs', 'packages/s3/as/read.as.ts', 'wasm/packages/contracts/src/s3/contracts.js',
    'packages/runtime/src/internal/incoming-body.js', 'packages/runtime/src/internal/package-runtime.js',
    'wasm/packages/compiler/src/spine/incoming-body-source.js', 'packages/provider-node/src/javascript/incoming-body.js',
    'packages/provider-node/src/runtime/s3-reader.js', 'packages/provider-fastly/src/build/native-body-forwarding.js',
    'packages/provider-fastly/src/build/native-body-forwarding.as.ts', 'packages/provider-fastly/src/toolchain/body-forwarding.js',
    'packages/provider-fastly/src/build/s3-native.as.ts', 'wasm/test/s3/upload-00/probe.cjs'
  ];
  const report = { schemaVersion: 'pulse.upload-00.boundaries.v1', status: 'passed',
    inspectedBase: '8faa3f9ff64d79598b5281ed14373c194a04418e',
    executionHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    node: process.version, cases, sourceSha256: Object.fromEntries(sources.map(file => [file, sha(fs.readFileSync(path.join(root, file)))])),
    limits: { networkUsed: false, uploadImplemented: false, originCompatibilityProven: false, apiFrozen: false } };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), output);
  else process.stdout.write(output);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
