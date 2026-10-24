'use strict';

// Design evidence only. No proposed capability is implemented by these probes.
// Run from any cwd; stdout is the receipt. No network, host ABI or Wasm build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const load = file => require(path.join(root, file));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const runtime = load('packages/runtime/src/internal/effect-adapter.js');
const packages = load('packages/runtime/src/internal/package-runtime.js');
const { compileCanonicalSource } = load('wasm/packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = load('wasm/packages/compiler/src/canonical-native-plan.js');
const { bindingOwnership } = load('wasm/packages/compiler/src/spine/binding-ownership.js');
const ts = require('typescript');
const { collectRegions } = load('wasm/packages/compiler/src/spine/effect-collection-source.js');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const receipt = { version: 'pulse.hex-design02-probe.v1', status: 'running',
  revision: git('rev-parse', 'HEAD'), workingTree: git('status', '--porcelain'),
  node: process.version, typescript: ts.version,
  scope: 'Current source admission, Native plan construction and injected JavaScript adapter only',
  cases: [] };
const inputs = [
  'pnpm-lock.yaml', 'packages/runtime/src/internal/effect-adapter.js',
  'packages/runtime/src/internal/package-runtime.js',
  'wasm/packages/compiler/src/spine/effect-collection-source.js',
  'wasm/packages/compiler/src/spine/handler-ir.js',
  'wasm/packages/compiler/src/spine/binding-ownership.js',
  'wasm/packages/compiler/src/canonical-native-plan.js',
  'wasm/test/runtime/effect-collection-size.json',
  'docs/internal/host-extensions/design02-probe.cjs'
];
receipt.inputs = inputs.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) }));
const check = async (name, fn) => {
  try { receipt.cases.push({ name, status: 'passed', detail: await fn() }); }
  catch (error) { receipt.cases.push({ name, status: 'failed', error: error.message }); throw error; }
};
const collectionSource = (expression, max = 4) => `export default async function handler(ctx) {
  const input = await ctx.req.json();
  const effects = ctx.effects({ max: ${max} });
  for (const item of input.items) { effects.add(${expression}); }
  const results = await ctx.parallel(effects);
  return ctx.json(results);
}`;
const inspect = source => collectRegions(ts.createSourceFile('shape.ts', source,
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), 'ctx');

async function main() {
  await check('Existing Native collection reserves declared capacity', () => {
    const rows = [1, 4, 32].map(max => {
      const source = collectionSource('ctx.fetch(item.url).json()', max);
      const plan = buildCanonicalNativePlan(compileCanonicalSource(source, { fileName: 'shape.ts', strict: false }));
      const slots = plan.effects.filter(effect => effect.kind === 'fetch').length;
      assert.equal(slots, max);
      return { max, fetchSlots: slots, sourceSha256: hash(source) };
    });
    return rows;
  });
  await check('Inline deferred loader rejected by collection source gate', () => {
    const result = inspect(collectionSource("cache.getOrSet(ctx, 'products', item.key, { load: () => ctx.fetch(item.url).json() })"));
    assert.equal(result.regions.length, 0);
    assert(result.errors.some(error => error.message.includes('cannot await, mutate or call helpers')));
    return result.errors.map(error => error.message);
  });
  await check('Named loader passes only collection structural gate', () => {
    const result = inspect(collectionSource("cache.getOrSet(ctx, 'products', item.key, { loader: loadProduct, input: { url: item.url } })"));
    assert.equal(result.errors.length, 0); assert.equal(result.regions.length, 1);
    return 'Structural acceptance only; no package recognition or named loader execution exists here.';
  });
  await check('Package payload cannot carry callback', () => {
    assert.throws(() => packages.clonePackageEffectPayload({ load: () => 1 }),
      { code: 'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID' });
    return 'Function payload rejected; a serializable child plan or other explicit contract would be needed.';
  });
  await check('JavaScript package bridge rejects undeclared observation operation', () => {
    assert.throws(() => packages.createPackageRuntime({ package: '@design/observations',
      contractId: 'design.observations', providerKind: 'observations',
      operations: { snapshot: { kind: 'observations.snapshot', capability: 'observations.snapshot', result: 'json' } } }),
    { code: 'PULSE_RUNTIME_PACKAGE_EFFECT_UNTRUSTED' });
    return 'Native lowerer admission is not JavaScript operation admission.';
  });
  await check('Cache logical binding lacks current binding ownership mapping', () => {
    assert.equal(bindingOwnership('cache', 'products'), undefined);
    assert.equal(bindingOwnership('kv', 'products').state, 'resolved');
    return 'KV control resolves; cache mapping is absent.';
  });
  await check('Existing effect roots work directly, keyed and held until collection flush', async () => {
    let dispatches = 0;
    const execution = runtime.createJavascriptEffectExecution({ effectAdapter: {
      id: 'design02-existing-time-control', dispatch() {
        dispatches++; return { status: 'ok', unixEpochMs: 0, iso8601: '1970-01-01T00:00:00.000Z' };
      }
    } });
    const effect = () => execution.dispatch({ kind: 'time.now' });
    try {
      assert.equal((await effect()).status, 'ok');
      assert.equal((await execution.parallel({ sample: effect() })).sample.status, 'ok');
      const collection = execution.effects({ max: 2 });
      collection.add(effect()); collection.add(effect());
      // Deliberately yield inside this internal probe to test the hold. This is
      // not an example of admitted authored collection source.
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(dispatches, 2);
      assert.equal((await execution.parallel(collection)).length, 2);
      assert.equal(dispatches, 4);
      return { dispatchesBeforeFlush: 2, dispatchesAfterFlush: dispatches,
        ownedEffects: execution.summary().ownedEffectCount };
    } finally { await execution.close(); }
  });
  await check('An async wrapper loses parallel effect identity', async () => {
    const execution = runtime.createJavascriptEffectExecution({ capabilities: { time: () =>
      ({ status: 'ok', unixEpochMs: 0, iso8601: '1970-01-01T00:00:00.000Z' }) } });
    const wrapped = (async () => execution.dispatch({ kind: 'time.now' }))();
    // Observe the wrapper even if the assertion fails, before closing its owner.
    try {
      assert.throws(() => execution.parallel({ sample: wrapped }), { code: 'PULSE_RUNTIME_PARALLEL_EFFECT_REQUIRED' });
      return 'Promise syntax does not preserve the execution-owned parallel root.';
    } finally { try { await wrapped; } finally { await execution.close(); } }
  });
  receipt.status = 'passed';
}
main().catch(error => { receipt.status = 'failed'; receipt.error = error.message; process.exitCode = 1; })
  .finally(() => process.stdout.write(JSON.stringify(receipt, null, 2) + '\n'));
