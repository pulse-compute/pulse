'use strict';

// Public collection surface and canonical Native execution acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const runtime = require(path.join(root, 'packages/runtime/src/host.js'));
const { createContext } = require(path.join(root, 'packages/runtime/src/internal/context.js'));
const { compileCanonicalSource } = require(path.join(root, 'wasm/packages/compiler/src/canonical-api-compiler.js'));
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require(path.join(root, 'wasm/packages/compiler/src/canonical-native-plan.js'));
const { compileCanonicalNativePlan } = require(path.join(root, 'wasm/packages/compiler/src/canonical-native-compiler.js'));
const nativeHost = require(path.join(root, 'wasm/packages/host-runtime/src/runtime/canonical-native-host.js'));
const MAX = 32;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function until(predicate) {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
  throw new Error('Deterministic proof checkpoint was not reached');
}
async function main() {
  const cases = [];
  const check = async (name, fn) => { await fn(); cases.push({ name, status: 'passed' }); };
  const source = `export default async function handler(ctx) {
    const input = await ctx.req.json();
    const effects = ctx.effects({ max: 32 });
    for (const endpoint of input.endpoints) { effects.add(ctx.fetch(endpoint).json()); }
    const results = await ctx.parallel(effects);
    return ctx.json(results);
  }`;
  function makeExecution(options = {}) {
    const calls = [];
    const execution = runtime.createJavascriptEffectExecution({ ...options, effectAdapter: { id: 'collection-contract', dispatch: async effect => { calls.push(effect); return effect.kind === 'fetch' ? new Response('ok') : 'value'; } } });
    const ctx = createContext({ effectExecution: execution, state: new Map(), req: {}, request: new Request('https://proof.invalid/'), executionOptions: {} });
    return { calls, execution, ctx };
  }
  for (const max of [0, -1, 1.5, NaN, Infinity, 33]) await check(`JS invalid capacity ${max}`, async () => {
    const { execution, ctx } = makeExecution();
    assert.throws(() => ctx.effects({ max }), { code: 'PULSE_EFFECT_COLLECTION_CAPACITY' }); await execution.close();
  });
  for (const kind of ['duplicate', 'foreign', 'promise', 'started', 'unflushed', 'budget']) await check(`JS collection ${kind}`, async () => {
    const a = makeExecution(kind === 'budget' ? { maxEffects: 1 } : {}), b = makeExecution();
    try {
      const bag = a.ctx.effects({ max: 2 });
      if (kind === 'foreign') assert.throws(() => bag.add(b.ctx.config.get('X')), { code: 'PULSE_EFFECT_COLLECTION_OWNER' });
      if (kind === 'promise') assert.throws(() => bag.add(Promise.resolve('x')), { code: 'PULSE_EFFECT_COLLECTION_MEMBER' });
      if (kind === 'started') { const effect = a.ctx.config.get('X'); await effect; assert.throws(() => bag.add(effect), { code: 'PULSE_EFFECT_COLLECTION_CLAIMED' }); }
      if (kind === 'duplicate') { const effect = a.ctx.fetch('https://proof.invalid/'); bag.add(effect.text()); assert.throws(() => bag.add(effect.json()), { code: 'PULSE_EFFECT_COLLECTION_CLAIMED' }); }
      if (kind === 'budget') { bag.add(a.ctx.config.get('X')); assert.throws(() => bag.add(a.ctx.config.get('Y')), { code: 'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED' }); }
      if (kind === 'unflushed') { bag.add(a.ctx.config.get('X')); await assert.rejects(a.execution.assertIdle(), { code: 'PULSE_EFFECT_COLLECTION_UNFLUSHED' }); }
      await new Promise(resolve => setImmediate(resolve)); if (kind !== 'started') assert.equal(a.calls.length, 0);
    } finally { await a.execution.close(); await b.execution.close(); }
  });
  for (const action of ['flush', 'add']) await check(`JS sealed ${action}`, async () => {
    const { execution, ctx } = makeExecution();
    const bag = ctx.effects({ max: 1 }); assert.deepEqual(await ctx.parallel(bag), []);
    assert.throws(() => action === 'flush' ? ctx.parallel(bag) : bag.add(ctx.config.get('X')), { code: 'PULSE_EFFECT_COLLECTION_SEALED' });
    await execution.close();
  });
  await check('JS snapshots request arguments and starts timeout at flush', async () => {
    const { execution, ctx, calls } = makeExecution();
    const bag = ctx.effects({ max: 1 }), headers = { 'x-snapshot': 'before' };
    bag.add(ctx.fetch('https://proof.invalid/', { headers, timeoutMs: 5 }).text()); headers['x-snapshot'] = 'after';
    await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls.length, 0);
    assert.deepEqual(await ctx.parallel(bag), ['ok']);
    assert.equal(calls[0].init.headers.find(([name]) => name === 'x-snapshot')[1], 'before');
    await execution.close();
  });
  for (const changed of [
    source.replace('const results = await ctx.parallel(effects);', 'const results = ctx.parallel(effects);'),
    source.replace('const effects = ctx.effects({ max: 32 });', 'const effects = identity(ctx.effects({ max: 32 }));'),
    source.replace('max: 32', 'max: 33'), source.replace('max: 32', 'max: input.max'),
    source.replace('effects.add(ctx.fetch(endpoint).json());', 'if (endpoint) effects.add(ctx.fetch(endpoint).json());'),
    source.replace('effects.add(ctx.fetch(endpoint).json());', 'effects.add(ctx.fetch(endpoint).json()); break;'),
    source.replace('const results = await ctx.parallel(effects);', 'const alias = effects; const results = await ctx.parallel(effects);'),
    source.replace('return ctx.json(results);', 'const again = await ctx.parallel(effects); return ctx.json(results);')
  ]) await check('unsupported collection source rejected', async () => {
    assert.throws(() => compileCanonicalSource(changed, { fileName: 'invalid-collection.ts', strict: false }), error => error.diagnostics.some(d => d.code === 'PULSE_CANONICAL_EFFECT_COLLECTION_UNSUPPORTED'));
  });

  await check('Native substitutes shorthand member arguments without changing property names', async () => {
    const projected = source.replace('ctx.fetch(endpoint)', 'ctx.fetch(endpoint, { headers: { endpoint } })');
    const plan = buildCanonicalNativePlan(compileCanonicalSource(projected, { fileName:'collection-shorthand.ts', strict:false }));
    assert.equal(plan.effects.length, MAX);
    for (const effect of plan.effects) {
      const headers = effect.inputs.find(input => input.name === 'init').value.entries[0];
      assert.equal(headers.key.value, 'headers');
      const endpoint = headers.value.entries[0];
      assert.equal(endpoint.key.value, 'endpoint');
      assert.deepEqual(endpoint.value, effect.inputs.find(input => input.name === 'url').value);
    }
  });
  const compiled = compileCanonicalSource(source, { fileName: 'bounded-effects.ts', strict: false });
  const native = compileCanonicalNativePlan(buildCanonicalNativePlan(compiled), { cwd: root });
  assert.equal(native.manifest.policy.javascriptRuntime, false);
  assert(native.inspection.importModules.every(x => ['pulse_host', 'env'].includes(x)));
  for (const [name, mutate] of [
    ['duplicate slots', statement => { statement.effectIds[1] = statement.effectIds[0]; }],
    ['reordered results', statement => { statement.results.reverse(); }],
    ['duplicate result locals', statement => { statement.results[1].localId = statement.results[0].localId; }],
    ['output alias', statement => { statement.localId = statement.results[0].localId; }],
    ['foreign continuation', statement => { statement.continuationId = 'foreign'; }],
    ['oversized capacity', statement => { statement.max = 33; }]
  ]) await check(`Native rejects rehashed ${name}`, async () => {
    const forged = JSON.parse(JSON.stringify(native.plan));
    mutate(forged.entry.body.find(statement => statement.kind === 'effect-collection'));
    delete forged.planHash; forged.planHash = hash(stableStringify(forged));
    assert.throws(() => validateCanonicalNativePlan(forged), /validation failed/);
  });
  await check('Native active prefix rejects missing, duplicate, forged and stale results', async () => {
    const controller = nativeHost.instantiateCanonicalNativeModule(native, {request: {method:'POST', path:'/', body:JSON.stringify({endpoints:['https://proof.invalid/a','https://proof.invalid/b']})}});
    const status = nativeHost.CANONICAL_NATIVE_RUN_STATUS;
    try {
      assert.equal(controller.start(), status.SUSPENDED);
      const pending = controller.pendingEffects(); assert.equal(pending.length, 2);
      assert.throws(() => controller.consumeCollectionAdmission(controller.continuationState(), 3));
      controller.consumeCollectionAdmission(controller.continuationState(), 2);
      assert.throws(() => controller.consumeCollectionAdmission(controller.continuationState(), 2));
      assert.equal(controller.resume(), status.INVALID_RESUME);
      assert.throws(() => controller.setEffectResult({...pending[0].ticket, slot:31}, {}));
      controller.setEffectResult(pending[0].ticket, {index:0});
      assert.throws(() => controller.setEffectResult(pending[0].ticket, {index:0}));
      assert.equal(controller.resume(), status.INVALID_RESUME);
      controller.setEffectResult(pending[1].ticket, {index:1});
      assert.equal(controller.resume(), status.COMPLETE);
      assert.deepEqual(JSON.parse(controller.response().body), [{index:0},{index:1}]);
      controller.close();
      assert.throws(() => controller.setEffectResult(pending[1].ticket, {late:true}));
    } finally { controller.close(); }
  });
  await check('Native whole-cohort budget admission dispatches nothing', async () => {
    let calls = 0;
    await assert.rejects(nativeHost.executeCanonicalNativeModule(native, {maxEffects:1,
      request:{method:'POST',path:'/',body:JSON.stringify({endpoints:['https://proof.invalid/a','https://proof.invalid/b']})},
      providerAdapter:{id:'budget',dispatchEffect(){calls++;}}}));
    assert.equal(calls,0);
  });
  const smaller = compileCanonicalNativePlan(buildCanonicalNativePlan(compileCanonicalSource(source.replace('max: 32','max: 4'), {fileName:'bounded-effects.ts',strict:false})), {cwd:root});
  assert.equal(smaller.plan.effects.length,4); assert.equal(native.plan.effects.length,32);
  assert(native.wasm.length < smaller.wasm.length * 8, 'slot-bank code growth must remain linear');
  const urls = Array.from({ length: MAX + 1 }, (_, i) => `https://proof.invalid/runtime-${i}`);

  function start(target, endpoints, signal) {
    const controls = [], dispatched = [], completed = [];
    const dispatch = (effect, execution) => {
      assert.equal(effect.kind, 'fetch');
      const control = deferred(); const url = effect.url || effect.parts?.url;
      dispatched.push(url); controls.push({ ...control, signal: execution.signal });
      return control.promise.then(value => {
        completed.push(url);
        return target === 'javascript' ? new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
          : { status: 200, headers: [['content-type', 'application/json']], body: JSON.stringify(value), kind: 'text' };
      });
    };
    let execution;
    const promise = target === 'native'
      ? nativeHost.executeCanonicalNativeModule(native, {
        signal, request: { method: 'POST', path: '/', body: JSON.stringify({ endpoints }) },
        providerAdapter: { id: 'bounded-native-proof', dispatchEffect: dispatch }
      }).then(result => ({ status: result.response.status, value: JSON.parse(result.response.body), effectCount: result.effectCount }))
      : (async () => {
        execution = runtime.createJavascriptEffectExecution({ signal, effectAdapter: { id: 'bounded-js-proof', dispatch } });
        const ctx = createContext({ effectExecution: execution, state: new Map(), req: {}, request: new Request('https://proof.invalid/'), signal, executionOptions: {} });
        const bag = ctx.effects({ max: MAX });
        try {
          for (const endpoint of endpoints) bag.add(ctx.fetch(endpoint).json());
          await new Promise(resolve => setImmediate(resolve)); assert.equal(dispatched.length, 0);
          const values = await ctx.parallel(bag);
          await execution.assertIdle();
          return { status: 200, value: values, effectCount: execution.summary().effectCount };
        } finally { await execution.close(); }

      })();
    // Observe immediately, including cancellation before dispatch.
    promise.catch(() => {});
    return { promise, controls, dispatched, completed };
  }

  for (const target of ['javascript', 'native']) {
    for (const n of [0, 1, 3, MAX]) await check(`${target}: runtime membership ${n}, reverse completion, ordered reconstruction`, async () => {
      const run = start(target, urls.slice(0, n));
      if (n) await until(() => run.controls.length === n);
      assert.deepEqual(run.dispatched, urls.slice(0, n));
      for (let i = n - 1; i >= 0; i--) { run.controls[i].resolve({ index: i }); await until(() => run.completed.length === n - i); }
      const result = await run.promise;
      assert.equal(result.status, 200); assert.equal(result.effectCount, n);
      assert.deepEqual(result.value, Array.from({ length: n }, (_, index) => ({ index })));
    });
    await check(`${target}: overflow dispatches nothing`, async () => {
      const run = start(target, urls); await assert.rejects(run.promise, { code: 'PULSE_EFFECT_COLLECTION_OVERFLOW' }); assert.deepEqual(run.dispatched, []);
    });
    await check(`${target}: first insertion failure wins after all members settle`, async () => {
      const run = start(target, urls.slice(0, 3)); let terminal = false;
      const observed = run.promise.then(() => { terminal = true; throw new Error('unexpected success'); }, error => { terminal = true; return error; });
      await until(() => run.controls.length === 3);
      run.controls[1].reject(Object.assign(new Error('second'), { code: 'PROOF_SECOND' }));
      await new Promise(resolve => setImmediate(resolve)); assert.equal(terminal, false);
      run.controls[0].reject(Object.assign(new Error('first'), { code: 'PROOF_FIRST' }));
      run.controls[2].resolve({ index: 2 });
      const error = await observed;
      assert.equal(error.code, 'PROOF_FIRST');
      assert.deepEqual(error.effectFailures.map(({key,index,kind,name,code})=>({key,index,kind,name,code})), [
        {key:'0',index:0,kind:'fetch',name:'Error',code:'PROOF_FIRST'},
        {key:'1',index:1,kind:'fetch',name:'Error',code:'PROOF_SECOND'}
      ]);
    });
    await check(`${target}: terminal failure outranks earlier application failure`, async () => {
      const run = start(target, urls.slice(0, 2));
      const observed = run.promise.catch(error => error);
      await until(() => run.controls.length === 2);
      run.controls[0].reject(Object.assign(new Error('application'), {code:'PULSE_SCHEMA_DECODE'}));
      run.controls[1].reject(Object.assign(new Error('terminal'), {code:'PULSE_RUNTIME_CONTRACT_ERROR'}));
      const error = await observed;
      assert.equal(error.code, 'PULSE_RUNTIME_CONTRACT_ERROR');
      assert.deepEqual(error.effectFailures.map(item=>item.index),[0,1]);
    });
    await check(`${target}: cancel in flight fences continuation and late completion`, async () => {
      const abort = new AbortController(), run = start(target, urls.slice(0, 3), abort.signal);
      await until(() => run.controls.length === 3); abort.abort(new Error('proof cancellation'));
      await assert.rejects(run.promise);
      assert(run.controls.every(x => x.signal.aborted));
      for (const control of run.controls) control.resolve({ late: true });
      await new Promise(resolve => setImmediate(resolve)); assert.equal(run.dispatched.length, 3);
    });
    for (const n of [0, 1]) await check(`${target}: cancel before entry with ${n} members dispatches nothing`, async () => {
      const abort = new AbortController(); abort.abort(new Error('before entry'));
      const run = start(target, urls.slice(0, n), abort.signal);
      await assert.rejects(run.promise); assert.deepEqual(run.dispatched, []);
    });
  }
  const report = {
    status: 'passed', sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }),
    lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    testSha256: hash(fs.readFileSync(__filename)), sourceSha256: hash(source),
    node: process.version, maximumMembers: MAX,
    native: { wasmSha256: hash(native.wasm), bytes: native.wasm.length, planHash: native.plan.planHash, importModules: native.inspection.importModules },
    cases, limits: ['deterministic injected adapters; provider and installed cells run separately']
  };
  if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
const watchdog = setTimeout(() => { console.error('Bounded effects test exceeded 120 seconds'); process.exit(1); }, 120000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
