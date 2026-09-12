'use strict';
const assert = require('node:assert/strict');
const ts = require('typescript');
const protocol = require('../../../packages/s3/src/provider.js');
const { buildS3LoweringPlan } = require('../../../packages/s3/pulsewasm.compiler.cjs');
const { normalizeNodeS3 } = require('../../../packages/provider-node/src/config/s3.js');
const { normalizeFastlyS3 } = require('../../../packages/provider-fastly/src/toolchain/s3.js');
const bindings = require('./o1/bindings.json');
const binding = bindings.node.bindings.s3.objects;
assert.equal(normalizeNodeS3({ objects: binding }).objects.endpoint, binding.endpoint);
assert.equal(normalizeFastlyS3(bindings.fastly.bindings.s3).objects.backend, 'object_origin');
for (const value of [null, [], { endpoint: 'http://origin.invalid' }, { ...binding, endpoint: 'https://origin.invalid/path' },
  { ...binding, endpoint: 'https://name:password@origin.invalid' }, { ...binding, region: '' }, { ...binding, secretAccessKey: 'inline' },
  { ...binding, maxTextBytes: 32769 }, { ...binding, timeoutMs: 30001 }, { ...binding, accessKeyIdSecret: '' }]) {
  assert.throws(() => normalizeNodeS3({ objects: value }));
}
assert.throws(() => normalizeFastlyS3({ objects: binding }));
for (const normalize of [normalizeNodeS3, normalizeFastlyS3]) {
  let read = false;
  assert.throws(() => normalize({ get objects() { read = true; return binding; } }));
  assert.equal(read, false, 'binding accessors must not execute');
}
assert.throws(() => require('../../../packages/provider-node/src/config/s3.js').validateNodeS3Operations({ providerOperations: [{ kind: 's3.head', resource: { binding: 'missing' } }] }, { s3: {} }));
assert.throws(() => require('../../../packages/provider-fastly/src/toolchain/s3.js').resolveFastlyS3([{ kind: 's3.head', resource: { binding: 'missing' } }], {}));
for (const key of ['', '.', '..', '/a/../b', 'x\u0000y', 'x\u0085y', '\ud800', '\udc00', 'é'.repeat(513)]) assert.equal(protocol.encodeKey(key), null);
assert.equal(protocol.encodeKey('/é//%2F/'), '/%C3%A9//%252F/');
assert.equal(protocol.encodeKey('é'), '%C3%A9'); assert.equal(protocol.encodeKey('e\u0301'), 'e%CC%81');
for (const headers of [[['content-length', '1'], ['Content-Length', '1']], [['content-length', '01']], [['content-length', '9007199254740992']],
  [['etag', '']], [['etag', 'a'], ['ETag', 'b']], [['etag', 'x'.repeat(1025)]], [['x-extra', 'a'.repeat(16384)]]]) assert.equal(protocol.metadataFromHeaders(headers, false), null);
assert.deepEqual(protocol.metadataFromHeaders([['content-length', '9007199254740991']], true), { byteLength: 9007199254740991 });
assert.throws(() => protocol.normalizeResult('head', { status: 'found', byteLength: 0, text: '' }));
assert.throws(() => protocol.normalizeResult('getText', { status: 'found', byteLength: 1, text: 'é', sha256: '0'.repeat(64) }));
const source = (body) => `import { s3 } from '@pulse-compute/s3'; app.post('/', async (ctx) => { ${body} });`;
const lower = (body) => buildS3LoweringPlan({ sourceText: source(body), sourcePath: 'consumer.ts', typescript: ts });
for (const body of ["const r = await s3.head(ctx, 'objects', key)", "const r = await ctx.parallel({ a: s3.head(ctx, 'objects', key), b: s3.getText(ctx, 'objects', key) })"]) {
  const plan = lower(body); assert.equal(plan.hasErrors, false); assert.equal(plan.canonicalEffects[0].providerKind, 's3');
  assert.deepEqual(plan.cryptoRequirements[0].algorithms, ['SHA-256', 'HMAC-SHA256']);
  assert.equal(plan.canonicalEffects[0].runtimeInputs[0].argumentIndex, 2);
}
for (const body of ["const r = await s3.head(ctx, name, key)", "const r = await s3.putText(ctx, 'objects', key)",
  "const read = s3.head; const r = await read(ctx, 'objects', key)", "return await s3.head(ctx, 'objects', key)",
  "const r = await s3.head(other, 'objects', key)", "const r = await s3.head(ctx, 'objects', key, {})"]) assert.equal(lower(body).hasErrors, true, body);
console.log('ok - S3 read bindings, literal authority, dynamic key seam and result bounds');
