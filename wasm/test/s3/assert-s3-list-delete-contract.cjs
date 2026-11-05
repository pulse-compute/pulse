'use strict';
const assert = require('node:assert/strict');
const ts = require('typescript');
const protocol = require('../../../packages/s3/src/provider.js');
const { buildS3LoweringPlan } = require('../../../packages/s3/pulsewasm.compiler.cjs');
const lower = call => buildS3LoweringPlan({ sourceText: `import { s3 } from '@pulse-compute/s3'; app.post('/', async (ctx) => { ${call} });`, typescript: ts });
function main() {
  for (const suffix of ['', ', {}', ', options', ", { prefix: prefix, maxKeys: count, continuationToken: cursor }"]) {
    const plan = lower(`const result = await s3.list(ctx, 'objects'${suffix})`);
    assert.equal(plan.hasErrors, false);
    const effect = plan.canonicalEffects[0];
    assert.equal(effect.kind, 's3.list');
    assert.deepEqual(effect.runtimeInputs.map(({ name, argumentIndex }) => [name, argumentIndex]), suffix ? [['options', 2]] : []);
    assert.deepEqual(effect.redaction, ['options', 'entries', 'nextContinuationToken']);
    if (!suffix) assert.deepEqual(effect.payload.options, {});
  }
  const parallel = lower("const result = await ctx.parallel({ page: s3.list(ctx, 'objects', options), removed: s3.delete(ctx, 'objects', key) })");
  assert.equal(parallel.hasErrors, false);
  assert.deepEqual(parallel.canonicalEffects.map(e => e.kind), ['s3.list', 's3.delete']);
  for (const call of ["const x = await s3.list(ctx, name)", "const x = await s3.list(other, 'objects')", "return await s3.list(ctx, 'objects')", "const x = s3.list;", "const x = await s3.delete(ctx, 'objects')", "const x = await s3.delete(ctx, binding, key)", "const x = await s3.list(ctx, 'objects', options, extra)"]) assert.equal(lower(call).hasErrors, true, call);
  assert.deepEqual(protocol.listOptions(), { prefix: '', continuationToken: '', maxKeys: 100 });
  for (const options of [null, [], new Date(), { maxKeys: 0 }, { maxKeys: NaN }, { maxKeys: 1001 }, { prefix: '\ud800' }, { prefix: '雪'.repeat(342) }, { continuationToken: '\n' }, { continuationToken: 'x'.repeat(4097) }, { bucket: 'other' }, Object.create({ prefix: 'inherited' }), Object.defineProperty({}, 'prefix', { get() { throw Error('must not read getter'); }, enumerable: true })]) assert.equal(protocol.listOptions(options), null);
  assert.equal(protocol.listQuery(protocol.listOptions({ prefix: "a/b +!'()*", continuationToken: 'opaque+/%2F&雪' })), 'continuation-token=opaque%2B%2F%252F%26%E9%9B%AA&encoding-type=url&list-type=2&max-keys=100&prefix=a%2Fb%20%2B%21%27%28%29%2A');
  const page = { status: 'listed', entries: [{ key: 'x', byteLength: 1 }], isTruncated: false };
  assert.deepEqual(protocol.normalizeResult('list', page), page);
  const getter = Object.defineProperty({}, 'status', { enumerable: true, get() { throw Error('must not read getter'); } });
  const sparse = Array(1);
  for (const invalid of [getter, Object.assign(Object.create({}), page), { ...page, secret: 'x' }, { ...page, entries: sparse }, { ...page, entries: [{ key: 'x', byteLength: -1 }] }, { ...page, entries: [page.entries[0], page.entries[0]] }, { ...page, isTruncated: true }, { ...page, nextContinuationToken: 'x' }, { ...page, entries: [Object.defineProperty({}, 'key', { enumerable: true, get() { throw Error('getter'); } })] }, { status: 'not-found' }]) assert.throws(() => protocol.normalizeResult('list', invalid), TypeError);
  for (const invalid of [{ status: 'deleted', existed: true }, { status: 'not-deleted', reason: 'too-large' }, { status: 'not-deleted', reason: 'invalid-text' }, { status: 'unknown', reason: 'rejected' }, { status: 'not-deleted', reason: 'unavailable' }, { status: 'unknown', reason: 'transport', httpStatus: 600 }]) assert.throws(() => protocol.normalizeResult('delete', invalid), TypeError);
  assert.deepEqual(protocol.normalizeResult('delete', { status: 'deleted' }), { status: 'deleted' });
  console.log('ok - S3 list/delete lowering, authority, options, opaque tokens and bounded result contracts');
}
main();
