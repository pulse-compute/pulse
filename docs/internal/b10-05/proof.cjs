'use strict';

// Investigation only. No public ctx.effects implementation is installed here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const runtime = require(path.join(root, 'packages/runtime/src/host.js'));
const { createContext } = require(path.join(root, 'packages/runtime/src/internal/context.js'));
const { compileCanonicalSource } = require(path.join(root, 'wasm/packages/compiler/src/canonical-api-compiler.js'));
const { buildCanonicalNativePlan } = require(path.join(root, 'wasm/packages/compiler/src/canonical-native-plan.js'));
const { compileCanonicalNativePlan } = require(path.join(root, 'wasm/packages/compiler/src/canonical-native-compiler.js'));
const nativeHost = require(path.join(root, 'wasm/packages/host-runtime/src/runtime/canonical-native-host.js'));
const MAX = 4;
const tokens = new WeakMap();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function until(predicate) {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
  throw new Error('Deterministic proof checkpoint was not reached');
}
function fail(code) { throw Object.assign(new Error(code), { code }); }

// Descriptor-level semantic model: only fetch/json is exercised. This is NOT
// proof of intercepting today's eager ctx.fetch promise or Native source syntax.
function collection(owner, max) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 32) fail('CAPACITY');
  const members = []; let state = 'open';
  const open = () => { if (state !== 'open') fail('SEALED'); };
  return {
    token(url) { open(); const token = Object.freeze({ url: String(url) }); tokens.set(token, { owner, claimed: false }); return token; },
    add(token) {
      open();
      const data = token && tokens.get(token);
      if (data?.owner !== owner || data.claimed || members.length === max) {
        state = 'failed'; fail(data?.owner !== owner ? 'OWNER' : data.claimed ? 'DUPLICATE' : 'OVERFLOW');
      }
      data.claimed = true; members.push(token);
    },
    take() { open(); state = 'sealed'; return members.slice(); },
    finish() { if (state === 'open' && members.length) fail('UNFLUSHED'); state = 'closed'; },
    get length() { return members.length; }
  };
}

// Exactly one module, compiled before request lists are supplied. The expansion
// is intentionally bounded to four and is not the proposed production lowering.
function expandedSource() {
  const branches = [];
  for (let n = 1; n <= MAX; n++) {
    const props = Array.from({ length: n }, (_, i) => `slot${i}: ctx.fetch(endpoints[${i}]).json()`).join(',\n');
    const values = Array.from({ length: n }, (_, i) => `values.slot${i}`).join(', ');
    branches.push(`if (endpoints.length === ${n}) { const values = await ctx.parallel({${props}}); return ctx.json([${values}]); }`);
  }
  return `export default async function handler(ctx) {
    const input = await ctx.req.json(); const endpoints = input.endpoints;
    if (endpoints.length > ${MAX}) return ctx.json({ error: 'OVERFLOW' }, { status: 400 });
    ${branches.join('\n')}
    return ctx.json([]);
  }`;
}

async function main() {
  const cases = [];
  const check = async (name, fn) => { await fn(); cases.push({ name, status: 'passed' }); };
  await check('descriptor model: capacity, ownership, duplicate, overflow, one shot, forgotten flush', async () => {
    const owner = {}, other = {};
    for (const max of [0, -1, 1.5, NaN, Infinity, 33]) assert.throws(() => collection(owner, max), { code: 'CAPACITY' });
    for (const max of [1, 32]) assert.equal(collection(owner, max).length, 0);
    const bag = collection(owner, 1), token = bag.token('https://proof.invalid/a');
    bag.add(token); assert.throws(() => bag.finish(), { code: 'UNFLUSHED' });
    assert.deepEqual(bag.take(), [token]); assert.throws(() => bag.take(), { code: 'SEALED' });
    assert.throws(() => bag.add(token), { code: 'SEALED' });
    const overflow = collection(owner, 1); overflow.add(overflow.token('a'));
    assert.throws(() => overflow.add(overflow.token('b')), { code: 'OVERFLOW' });
    assert.throws(() => overflow.take(), { code: 'SEALED' });
    const duplicate = collection(owner, 2), same = duplicate.token('a'); duplicate.add(same);
    assert.throws(() => duplicate.add(same), { code: 'DUPLICATE' });
    assert.throws(() => collection(owner, 2).add(collection(other, 2).token('a')), { code: 'OWNER' });
    assert.throws(() => collection(owner, 2).add({ owner, url: 'forged' }), { code: 'OWNER' });
    assert.throws(() => collection(owner, 2).add(token), { code: 'DUPLICATE' });
    const empty = collection(owner, 1); assert.deepEqual(empty.take(), []);
  });

  await check('current JS dispatch is eager before any explicit group', async () => {
    let calls = 0;
    const execution = runtime.createJavascriptEffectExecution({ effectAdapter: { id: 'eager-proof', dispatch() { calls++; return 'ok'; } } });
    const effect = execution.dispatch({ kind: 'config.get', name: 'PROBE', providerKind: 'config', operation: 'get', capability: 'config.get' });
    assert.equal(calls, 0); await until(() => calls === 1); await effect; await execution.close();
  });

  const source = expandedSource();
  await check('proposed authoring syntax is not yet admitted by the production compiler', async () => {
    assert.throws(() => compileCanonicalSource(`export default async function handler(ctx) {
      const effects = ctx.effects({ max: 4 });
      effects.add(ctx.fetch('https://proof.invalid/').json());
      const values = await ctx.parallel(effects); return ctx.json(values);
    }`, { fileName: 'b10-05-not-shipped.ts', strict: false }));
  });
  const compiled = compileCanonicalSource(source, { fileName: 'b10-05-expanded-proof.ts', strict: false });
  const native = compileCanonicalNativePlan(buildCanonicalNativePlan(compiled), { cwd: root });
  assert.equal(native.manifest.policy.javascriptRuntime, false);
  assert(native.inspection.importModules.every(x => ['pulse_host', 'env'].includes(x)));
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
        const bag = collection(execution, MAX);
        try {
          if (endpoints.length > MAX) return { status: 400, value: { error: 'OVERFLOW' }, effectCount: 0 };
          for (const endpoint of endpoints) bag.add(bag.token(endpoint));
          // Cross a turn deliberately: no provider work exists before take/flush.
          await new Promise(resolve => setImmediate(resolve)); assert.equal(dispatched.length, 0);
          if (signal?.aborted) throw signal.reason;
          const entries = bag.take();
          const record = Object.fromEntries(entries.map((entry, i) => [`slot${i}`, ctx.fetch(entry.url).json()]));
          const values = entries.length ? await ctx.parallel(record) : {};
          return { status: 200, value: entries.map((_, i) => values[`slot${i}`]), effectCount: execution.summary().effectCount };
        } finally { bag.finish(); await execution.close(); }
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
      const run = start(target, urls); assert.equal((await run.promise).status, 400); assert.deepEqual(run.dispatched, []);
    });
    await check(`${target}: first insertion failure wins after all members settle`, async () => {
      const run = start(target, urls.slice(0, 3)); let terminal = false;
      const observed = run.promise.then(() => { terminal = true; throw new Error('unexpected success'); }, error => { terminal = true; return error; });
      await until(() => run.controls.length === 3);
      run.controls[1].reject(Object.assign(new Error('second'), { code: 'PROOF_SECOND' }));
      await new Promise(resolve => setImmediate(resolve)); assert.equal(terminal, false);
      run.controls[0].reject(Object.assign(new Error('first'), { code: 'PROOF_FIRST' }));
      run.controls[2].resolve({ index: 2 });
      assert.equal((await observed).code, 'PROOF_FIRST');
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
    proofSha256: hash(fs.readFileSync(__filename)), expandedSourceSha256: hash(source),
    node: process.version, maximumProvedNativeMembers: MAX,
    native: { wasmSha256: hash(native.wasm), bytes: native.wasm.length, planHash: native.plan.planHash, importModules: native.inspection.importModules },
    cases, limits: ['private descriptor-level JS model; public capture syntax not implemented', 'Native bounded static-cardinality expansion, not dynamic-group lowering', 'deterministic injected adapters; no deployed host, network, installed-package or 32-member proof']
  };
  if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
const watchdog = setTimeout(() => { console.error('B10-05 proof exceeded 120 seconds'); process.exit(1); }, 120000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
