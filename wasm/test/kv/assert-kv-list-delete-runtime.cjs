'use strict';
const assert = require('node:assert/strict');
const host = require('../../../packages/runtime/src/host');
const { createNodeKvReference } = require('../../../packages/provider-node/src/runtime/conditional-kv');
async function main() {
  let dispatches = 0, accesses = 0;
  const accessor = { limit: 1 }; Object.defineProperty(accessor, 'cursor', { enumerable: true, get() { accesses++; return 'private'; } });
  for (const options of [undefined, null, [], {}, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: NaN }, { limit: 1, all: true }, accessor, { limit: 1, prefix: '\ud800' }]) {
    const result = await host.executeConditionalKv({ kind: 'kv.list', namespace: 'n', options }, () => { dispatches++; });
    assert.deepEqual(result, { status: 'failed', reason: 'invalid-options' });
  }
  assert.equal(accesses, 0); assert.equal(dispatches, 0);
  for (const cursor of ['', '\ud800', '\n', 'x'.repeat(8193)]) {
    assert.deepEqual(await host.executeConditionalKv({ kind: 'kv.list', namespace: 'n', options: { limit: 1, cursor } }, () => { dispatches++; }), { status: 'failed', reason: 'invalid-cursor' });
  }
  const ref = createNodeKvReference();
  for (const key of ['a', 'b', 'c', '雪']) ref.kv('n').put(key, null);
  const first = await ref.kv('n').list({ limit: 2 }); assert.deepEqual(first.keys, ['a', 'b']);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.keys));
  // Cursor continuation seeks the live index; deleting the cursor key remains valid.
  await ref.kv('n').delete('b'); ref.kv('n').put('aa', null); ref.kv('n').put('d', null);
  const next = await ref.kv('n').list({ limit: 100, cursor: first.cursor });
  assert.deepEqual(next, { status: 'listed', keys: ['c', 'd', '雪'], cursor: null });
  for (const [reference, namespace, options] of [
    [ref, 'n', { limit: 1, prefix: 'a', cursor: first.cursor }], [ref, 'other', { limit: 1, cursor: first.cursor }],
    [createNodeKvReference(), 'n', { limit: 1, cursor: first.cursor }], [ref, 'n', { limit: 1, cursor: first.cursor + 'x' }]
  ]) assert.deepEqual(await reference.kv(namespace).list(options), { status: 'failed', reason: 'invalid-cursor' });
  assert.deepEqual(await ref.kv('n').delete('a'), { status: 'deleted' });
  assert.equal(ref.kv('n').get('a'), undefined); assert.equal(ref.legacyStores().get('n').has('a'), false);
  assert.deepEqual(await ref.kv('n').getVersioned('a'), { status: 'not-found' });
  assert.deepEqual(await ref.kv('n').delete('a'), { status: 'not-found' });
  assert.deepEqual(await ref.kv('n').insertIfAbsent('a', 1), { status: 'stored' });
  const longPrefix = '雪'.repeat(340);
  for (let i = 0; i < 101; i++) ref.kv('bounded').put(longPrefix + String(i).padStart(4, '0'), null);
  const maximum = await ref.kv('bounded').list({ limit: 100, prefix: longPrefix });
  assert.equal(maximum.keys.length, 100); assert.ok(maximum.keys.every(key => Buffer.byteLength(key) === 1024));
  assert.ok(Buffer.byteLength(maximum.cursor) <= 8192);
  const last = await ref.kv('bounded').list({ limit: 100, prefix: longPrefix, cursor: maximum.cursor });
  assert.deepEqual(last, { status: 'listed', keys: [longPrefix + '0100'], cursor: null });
  const exactKey = '雪'.repeat(341) + 'a'; ref.kv('bounded').put(exactKey, null);
  assert.deepEqual(await ref.kv('bounded').list({ limit: 1, prefix: exactKey }), { status: 'listed', keys: [exactKey], cursor: null });
  assert.deepEqual(await ref.kv('bounded').delete(exactKey), { status: 'deleted' });
  const legacy = ref.kv('legacy'); legacy.put('\ud800', 1); legacy.put('\ufffd', 2);
  assert.deepEqual(await legacy.delete('\ufffd'), { status: 'deleted' });
  assert.equal(legacy.get('\ud800'), 1); assert.equal(legacy.get('\ufffd'), undefined);
  assert.deepEqual(await legacy.list({ limit: 1, prefix: '\ufffd' }), { status: 'listed', keys: [], cursor: null });
  const effect = host.admitConditionalKv({ kind: 'kv.list', namespace: 'n', options: { limit: 1, prefix: 'private/' } });
  const bad = [null, { status: 'listed', keys: ['other'], cursor: null }, { status: 'listed', keys: ['private/a', 'private/b'], cursor: null }, { status: 'listed', keys: [], cursor: '' }, { status: 'listed', keys: [], cursor: null, extra: true }];
  const keys = []; Object.defineProperty(keys, 0, { enumerable: true, get() { accesses++; return 'private/a'; } }); bad.push({ status: 'listed', keys, cursor: null });
  for (const result of bad) assert.deepEqual(host.normalizeConditionalKvResult(effect, result), { status: 'failed', reason: 'protocol' });
  assert.equal(accesses, 0);
  // Shared lifecycle: deadline before dispatch, uncertain delete after dispatch,
  // cancellation, and eventual late provider completion cannot publish a result.
  for (const kind of ['kv.list', 'kv.delete']) {
    let time = 0, timer, cleared = 0, sent = 0;
    const clock = { now: () => time, setTimeout(fn) { timer = fn; return 1; }, clearTimeout() { cleared++; } };
    const input = { kind, namespace: 'n', key: 'a', options: { limit: 1 } };
    const result = await host.executeConditionalKv(input, () => { sent++; }, {}, { kvClock: clock, deadlineMonotonicMs: 0 });
    assert.deepEqual(result, { status: kind === 'kv.list' ? 'failed' : 'not-deleted', reason: 'timeout' }); assert.equal(sent, 0);
    let finish;
    const pending = host.executeConditionalKv(input, () => () => new Promise(resolve => { finish = resolve; }), {}, { kvClock: clock });
    for (let i = 0; i < 5 && !finish; i++) await Promise.resolve();
    time = 10000; timer();
    assert.deepEqual(await pending, { status: kind === 'kv.list' ? 'failed' : 'unknown', reason: 'timeout' });
    finish(kind === 'kv.list' ? { status: 'listed', keys: [], cursor: null } : { status: 'deleted' });
    assert.equal(cleared, 1);
    const controller = new AbortController();
    const cancelled = host.executeConditionalKv(input, () => () => new Promise(() => {}), { signal: controller.signal }, { kvClock: clock });
    await Promise.resolve(); controller.abort(); await assert.rejects(cancelled, { code: 'PULSE_RUNTIME_EFFECT_ABORTED' });
  }
  const privateRef = createNodeKvReference({ kv: { n: { 'private/a': null, 'private/b': null } } });
  const execution = host.createJavascriptEffectExecution({ capabilities: { prepareConditionalKv: privateRef.prepareConditionalKv } });
  const page = await execution.dispatch({ kind: 'kv.list', namespace: 'n', options: { limit: 1, prefix: 'private/' } });
  const trace = JSON.stringify(execution.summary());
  for (const secret of ['private/', 'private/a', page.cursor]) assert.equal(trace.includes(secret), false);
  await execution.close();
  console.log('ok - KV list/delete admission, opaque scoped cursors, live index, atomic deletion, result bounds, redaction and deadline lifecycle');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
