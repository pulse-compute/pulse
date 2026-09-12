'use strict';
const assert = require('node:assert/strict');
const ts = require('typescript');
const crypto = require('node:crypto');
const protocol = require('../../../packages/s3/src/provider.js');
const { buildS3LoweringPlan } = require('../../../packages/s3/pulsewasm.compiler.cjs');
const { bindJavascriptDigestMac } = require('../../../packages/crypto/src/provider.cjs');
const lower = (call) => buildS3LoweringPlan({ sourceText: `import { s3 } from '@pulse-compute/s3'; app.post('/', async (ctx) => { ${call} });`, sourcePath: 'consumer.ts', typescript: ts });
async function main() {
  for (const suffix of ['', ', {}', ", { contentType: 'application/json' }"]) {
    const plan = lower(`const r = await s3.putText(ctx, 'objects', key, text${suffix})`);
    assert.equal(plan.hasErrors, false);
    const effect = plan.canonicalEffects[0];
    assert.deepEqual(effect.runtimeInputs.map(({ name, argumentIndex }) => [name, argumentIndex]), [['key', 2], ['text', 3]]);
    assert.deepEqual(Object.keys(effect.payload).sort(), ['binding', 'contentType']);
    assert.equal(effect.payload.contentType, suffix.includes('application/json') ? 'application/json' : 'text/plain; charset=utf-8');
    assert.deepEqual(effect.redaction, ['key', 'text', 'sha256', 'etag', 'contentType']);
  }
  for (const suffix of [', options', ', { ...options }', ', { contentType }', ', { contentType: type }', ", { ['contentType']: 'x' }", ", { contentType: 'x', contentType: 'y' }", ", { contentType: 'x', cache: true }", ", { contentType: '' }", ", { contentType: ' x' }", ", { contentType: 'é' }", ", { contentType: 'a\\r\\nb' }"]) {
    assert.equal(lower(`const r = await s3.putText(ctx, 'objects', key, text${suffix})`).hasErrors, true, suffix);
  }
  for (const call of ["return await s3.putText(ctx, 'objects', key, text)", "const r = await s3.putText(other, 'objects', key, text)", "const r = await s3.putText(ctx, name, key, text)"]) assert.equal(lower(call).hasErrors, true);
  for (const result of [
    { status: 'stored', byteLength: 32769, sha256: '0'.repeat(64) },
    { status: 'stored', byteLength: 0, sha256: '0'.repeat(64), text: '' },
    { status: 'stored', byteLength: 0, sha256: '0'.repeat(64), etag: '' },
    { status: 'unknown', reason: 'rejected', httpStatus: 400 },
    { status: 'not-stored', reason: 'unavailable', httpStatus: 500 },
    { status: 'unknown', reason: 'transport', httpStatus: 600 }
  ]) assert.throws(() => protocol.normalizeResult('putText', result));

  const selected = bindJavascriptDigestMac(['SHA-256', 'HMAC-SHA256']);
  assert.equal(selected.realization.automaticFallback, false);
  for (const length of [0, 1, 64, 32768]) {
    const data = new Uint8Array(length).fill(0xa7);
    assert.deepEqual(Buffer.from(await selected.bytes.sha256(data)), crypto.createHash('sha256').update(data).digest());
    for (const keyLength of [0, 1, 64, 8192]) {
      const key = new Uint8Array(keyLength).fill(0x51);
      assert.deepEqual(Buffer.from(await selected.bytes.hmacSha256(key, data)), crypto.createHmac('sha256', key).update(data).digest());
    }
  }
  await assert.rejects(selected.bytes.sha256(new Uint8Array(32769)));
  await assert.rejects(selected.bytes.hmacSha256(new Uint8Array(8193), new Uint8Array()));
  await assert.rejects(selected.bytes.hmacSha256(new Uint8Array(), new Uint8Array(32769)));
  assert.throws(() => bindJavascriptDigestMac(['SHA-256'], {}));
  assert.throws(() => bindJavascriptDigestMac(['HMAC-SHA256'], { importKey() {} }));
  assert.throws(() => bindJavascriptDigestMac(['SHA-256', 'SHA-256']));
  assert.throws(() => bindJavascriptDigestMac(['unknown']));
  assert.equal(bindJavascriptDigestMac(['SHA-256']).bytes.hmacSha256, undefined);
  let capturedKey, capturedData, resume;
  const fake = bindJavascriptDigestMac(['HMAC-SHA256'], {
    importKey(_format, key) { capturedKey = key; return new Promise((resolve) => { resume = resolve; }); },
    async sign(_algorithm, _key, data) { capturedData = data; assert.deepEqual([...data], [3, 4]); throw new Error('Injected failure'); }
  });
  const key = new Uint8Array([1, 2]), data = new Uint8Array([3, 4]);
  const pending = fake.bytes.hmacSha256(key, data);
  key.fill(9); data.fill(8);
  assert.deepEqual([...capturedKey], [1, 2]); resume({});
  await assert.rejects(pending, /Injected failure/);
  assert.deepEqual([...capturedKey], [0, 0]); assert.deepEqual([...capturedData], [0, 0]);
  const { readS3 } = require('../../../packages/provider-node/src/runtime/s3-reader.js');
  const binding = require('./o1/bindings.json').node.bindings.s3.objects;
  const effect = { kind: 's3.putText', capability: 's3.putText', operation: 'putText', package: '@pulse-compute/s3', contractId: 'pulse.s3', providerKind: 's3', payload: { binding: 'objects', key: 'write', text: 'payload' } };
  let sends = 0;
  const options = { s3: { objects: { ...binding, timeoutMs: 20 } }, cryptoTarget: 'javascript', cryptoVerifier: selected, cryptoRealization: selected.realization,
    fetchImplementation() { sends++; throw new Error('Lost after entering send'); } };
  assert.deepEqual(await readS3(effect, options, () => new Promise(() => {})), { status: 'not-stored', reason: 'timeout' });
  assert.equal(sends, 0, 'Credential deadline includes asynchronous lookup before send');
  assert.deepEqual(await readS3(effect, { ...options, s3: { objects: { ...binding, maxTextBytes: 3 } } }, () => 'credential'), { status: 'not-stored', reason: 'too-large' });
  assert.equal(sends, 0);
  const cancellation = new AbortController();
  const cancelled = readS3(effect, { ...options, signal: cancellation.signal }, () => new Promise(() => {}));
  cancellation.abort(new Error('cancelled during credentials'));
  await assert.rejects(cancelled, /cancelled during credentials/); assert.equal(sends, 0);
  assert.deepEqual(await readS3(effect, { ...options, s3: { objects: binding } }, () => 'credential'), { status: 'unknown', reason: 'transport' });
  assert.equal(sends, 1, 'A throwing send primitive cannot prove no write');
  console.log('ok - S3 PUT literal lowering, bounded results, explicit Crypto JavaScript vectors, snapshot and wipe');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
