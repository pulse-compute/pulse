'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const host = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const root = path.resolve(__dirname, '../../..');

function compile(source) {
  const canonical = compileCanonicalSource(source, { fileName: 'conditional-normalization.ts', strict: false, requireAsync: true });
  assert.equal(canonical.ok, true, JSON.stringify(canonical.diagnostics));
  return compileCanonicalNativePlan(buildCanonicalNativePlan(canonical), { cwd: root });
}
async function main() {
  const compiled = compile(`export default async function handler(ctx) {
    const row = await ctx.kv('pages').getVersioned('private-key');
    if (row.status !== 'found') return ctx.text(row.status + ':' + row.reason);
    const barrier = await ctx.config.get('BARRIER');
    ctx.log.info('' + row.value.secret);
    return ctx.text(row.value.nested[0].n + ':' + row.generation);
  }`);
  let raw = { status: 'found', generation: 'private-generation', value: { secret: 'private-payload', nested: [{ n: 7 }] } };
  let disposed = 0;
  const result = await host.executeCanonicalNativeModule(compiled, { strict: false, providerAdapter: {
    id: 'normalization', dispatchEffect(effect) {
      if (effect.kind === 'kv.getVersioned') return raw;
      assert.equal(effect.kind, 'config.get');
      // Mutation after normalization must not alter the admitted result.
      raw.generation = 'changed'; raw.value.secret = 'changed'; raw.value.nested[0].n = 99;
      return 'ready';
    }, disposeExecution() { disposed++; }
  } });
  assert.equal(result.response.body, '7:private-generation');
  assert.equal(disposed, 1);
  const trace = JSON.stringify(result.trace);
  for (const secret of ['private-key', 'private-generation', 'private-payload']) assert.ok(!trace.includes(secret), secret);

  let getterCalls = 0;
  const accessor = Object.defineProperty({}, 'status', { enumerable: true, get() { getterCalls++; return 'found'; } });
  const nestedAccessor = Object.defineProperty({}, 'private', { enumerable: true, get() { getterCalls++; return 'payload'; } });
  const found = value => ({ status: 'found', generation: 'g', value });
  const rows = [
    [accessor, {}, 'failed:protocol'],
    [found(nestedAccessor), {}, 'failed:invalid-value'],
    [{ ...found({}), extra: true }, {}, 'failed:protocol'],
    [{ ...found({}), generation: 42 }, {}, 'failed:protocol'],
    [found({ text: 'x'.repeat(128) }), { maxKvValueBytes: 64 }, 'failed:too-large'],
    [{ status: 'failed', reason: 'unavailable' }, {}, 'failed:unavailable']
  ];
  for (const [value, limits, expected] of rows) {
    let calls = 0;
    const actual = await host.executeCanonicalNativeModule(compiled, { strict: false, ...limits,
      providerAdapter: { id: 'normalization', dispatchEffect() { calls++; return value; } } });
    assert.equal(actual.response.body, expected); assert.equal(calls, 1);
  }
  assert.equal(getterCalls, 0, 'malformed providers never execute getters');

  // Public raw-controller preparation keeps its full validation boundary.
  const controller = host.instantiateCanonicalNativeModule(compiled, { strict: false, maxKvValueBytes: 64 });
  controller.start();
  const entry = controller.pendingEffects()[0];
  raw = found({ nested: [{ n: 7 }] });
  const prepared = controller.prepareEffectResult(entry.index, raw);
  assert.notEqual(prepared, raw); assert.notEqual(prepared.value, raw.value);
  assert.ok(Object.isFrozen(prepared) && Object.isFrozen(prepared.value) && Object.isFrozen(prepared.value.nested)
    && Object.isFrozen(prepared.value.nested[0]));
  raw.value.nested[0].n = 99; assert.equal(prepared.value.nested[0].n, 7);
  assert.deepEqual(controller.prepareEffectResult(entry.index, accessor), { status: 'failed', reason: 'protocol' });
  assert.deepEqual(controller.prepareEffectResult(entry.index, found({ text: 'x'.repeat(128) })), { status: 'failed', reason: 'too-large' });
  assert.equal(getterCalls, 0);
  assert.throws(() => controller.prepareEffectResult(9999, raw), { code: 'PULSE_CANONICAL_NATIVE_EFFECT_INDEX_INVALID' });
  controller.close();

  for (const operation of ["insertIfAbsent('private-key', {n:1})", "compareAndSwap('private-key', 'g', {n:1})"]) {
    const write = compile(`export default async function handler(ctx) {
      const row = await ctx.kv('pages').${operation};return ctx.text(row.status);
    }`);
    for (const [value, expected] of [[{ status: 'stored' }, 'stored'], [{ status: 'conflict' }, 'conflict'],
      [{ status: 'stored', extra: true }, 'unknown']]) {
      const actual = await host.executeCanonicalNativeModule(write, { strict: false,
        providerAdapter: { id: 'normalization', dispatchEffect() { return value; } } });
      assert.equal(actual.response.body, expected);
    }
  }
  console.log('ok - Native conditional KV normalized handoff, raw validation, isolation, redaction and limits');
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
