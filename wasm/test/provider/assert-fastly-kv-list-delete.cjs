'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const mock = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { createConditionalKvAuthority } = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
const codec = require('../../../packages/runtime/src/host');
const fileName = path.join(__dirname, '../kv/list-delete/consumer.ts');
function compile() {
  const compiled = compileCanonicalSource(fs.readFileSync(fileName, 'utf8'), { fileName, strict: false, schemaBundle: buildCanonicalSchemaBundle([], { maxBytes: 262144 }) });
  return platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(compiled), { cwd: path.resolve(__dirname, '../../..'), bindings: { kv: { catalog: 'catalog' } } });
}
function main() {
  const native = compile(); let count = 0;
  assert.equal(native.manifest.policy.javascriptRuntime, false);
  for (const name of ['list', 'list_wait', 'delete', 'delete_wait']) assert.ok(native.inspection.imports.some(x => x.module === 'fastly_kv_store' && x.name === name));
  const authority = createConditionalKvAuthority(); authority.stores.set('catalog', new Map());
  function run(command, onCall = () => {}) {
    const calls = [];
    const result = mock.executeFastlyNativePlatformCapabilities(native, {
      request: { method: 'POST', body: JSON.stringify(command) },
      conditionalKv: { authority, onCall(stage, detail) { calls.push({ stage, detail }); return onCall(stage, detail); } }
    });
    assert.equal(result.response.status, 200); assert.equal(result.kvEvidence.bodyFixtures.size, 0);
    count++; return { body: JSON.parse(result.response.body), calls, result };
  }
  const list = (options = { limit: 2 }, fault) => run({ operation: 'list', options }, fault);
  const del = (key, fault) => run({ operation: 'delete', key }, fault);
  assert.deepEqual(list().body, { status: 'listed', keys: [], cursor: null });
  for (const key of ['item/a', 'item/b', 'item/雪', 'other']) authority.seed('catalog', key, codec.encodeConditionalKvValue(null));
  const first = list({ limit: 2, prefix: 'item/' });
  assert.deepEqual(first.body.keys, ['item/a', 'item/b']); assert.equal(typeof first.body.cursor, 'string');
  assert.equal(first.calls.filter(x => x.stage === 'list').length, 1);
  const final = list({ limit: 2, prefix: 'item/', cursor: first.body.cursor });
  assert.deepEqual(final.body, { status: 'listed', keys: ['item/雪'], cursor: null });
  assert.deepEqual(list({ limit: 2, prefix: 'missing/' }).body, { status: 'listed', keys: [], cursor: null });
  assert.deepEqual(list({ limit: 100, prefix: '' }).body.keys, ['item/a', 'item/b', 'item/雪', 'other']);
  assert.deepEqual(list({ limit: 1, cursor: 'opaque-invalid' }).body, { status: 'failed', reason: 'invalid-cursor' });
  for (const options of [undefined, {}, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '1' }, { limit: 1, extra: true }, { limit: 1, prefix: '\ud800' }]) {
    const r = run({ operation: 'list', options }); assert.deepEqual(r.body, { status: 'failed', reason: 'invalid-options' }); assert.equal(r.calls.some(x => x.stage === 'open'), false);
  }
  for (const cursor of ['', '\ud800', 'x'.repeat(8193)]) assert.deepEqual(list({ limit: 1, cursor }).body, { status: 'failed', reason: 'invalid-cursor' });
  assert.deepEqual(del('item/a').body, { status: 'deleted' });
  assert.deepEqual(del('item/a').body, { status: 'not-found' });
  assert.deepEqual(del('absent').body, { status: 'not-found' });
  for (const key of ['', '\ud800', 'x'.repeat(1025), '.']) {
    const r = del(key); assert.deepEqual(r.body, { status: 'not-deleted', reason: 'invalid-key' }); assert.equal(r.calls.some(x => x.stage === 'delete'), false);
  }
  const faultAt = (stage, fault) => s => s === stage ? fault : undefined;
  for (const [operation, success, rejected] of [['delete', 'unknown', 'not-deleted'], ['list', 'failed', 'failed']]) {
    const invoke = fault => operation === 'delete' ? del('other', fault) : list({ limit: 1 }, fault);
    assert.deepEqual(invoke(faultAt('open', { status: 10 })).body, { status: operation === 'delete' ? 'not-deleted' : 'failed', reason: 'configuration' });
    assert.deepEqual(invoke(faultAt(operation, { status: 1 })).body, { status: success, reason: 'transport' });
    assert.deepEqual(invoke(faultAt(operation, { readyDelayMs: 10001 })).body, { status: success, reason: 'timeout' });
    assert.deepEqual(invoke(faultAt(operation + '_wait', { status: 1 })).body, { status: success, reason: 'transport' });
    assert.deepEqual(invoke(faultAt(operation + '_wait', { kvError: 7 })).body, { status: rejected, reason: 'throttled' });
    assert.deepEqual(invoke(faultAt(operation + '_wait', { kvError: 4 })).body, { status: success, reason: 'protocol' });
  }
  for (const [wire, reason] of [
    ['{"data":["item/b"],"meta":{"limit":1}}', null],
    ['{"data":[],"data":[],"meta":{"limit":1}}', 'protocol'],
    ['{"data":["x","x"],"meta":{"limit":1}}', 'protocol'],
    ['{"data":[],"meta":{"limit":1,"next_cursor":""}}', 'protocol'],
    ['{"data":[],"meta":{"limit":2}}', 'protocol'],
    ['{"data":["' + 'x'.repeat(1025) + '"],"meta":{"limit":1}}', 'protocol'],
    [Buffer.from([255]), 'protocol'], [' '.repeat(262145), 'too-large']
  ]) {
    const r = list({ limit: 1 }, faultAt('list_wait', { wire }));
    assert.equal(r.body.status, reason ? 'failed' : 'listed'); if (reason) assert.equal(r.body.reason, reason);
    assert.equal(r.calls.filter(x => x.stage === 'body_close').length, 1);
  }
  for (const [stage, fault, reason] of [['list_wait', { bodyDelayMs: 10001 }, 'timeout'], ['body_read', { status: 1 }, 'transport'], ['body_read', { written: 262146 }, 'protocol']]) {
    const r = list({ limit: 1 }, faultAt(stage, fault)); assert.deepEqual(r.body, { status: 'failed', reason });
    assert.equal(r.calls.filter(x => x.stage === 'body_close').length, 1);
  }
  const parallel = run({ operation: 'parallel', key: 'item/b', options: { limit: 1 } });
  assert.deepEqual([parallel.body.first.status, parallel.body.second.status].sort(), ['deleted', 'not-found']);
  assert.equal(parallel.result.kvEvidence.pending.size, 0);
  console.log(`ok - ${count} Fastly Native KV list/delete final-Wasm scenarios (enforcing ABI host; no deployed claim)`);
  return native;
}
if (require.main === module) main();
module.exports = { main, compile };
