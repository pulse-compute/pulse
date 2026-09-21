'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const { compileCanonicalSource, loadCanonicalModule } = require('../../packages/compiler/src/canonical-api-compiler');
const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const generatorHost = require('../../packages/host-runtime/src/runtime/canonical-api-runtime');
const jsHost = require('../../../packages/provider-node/src/javascript/runtime-host');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const platformHost = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { createConditionalKvAuthority } = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
const fastlyInvocations = require('../../../packages/provider-fastly/src/build/effect-invocations');
const { resolveAsc } = require('../../packages/build-support/src/assemblyscript-compile');
const root = path.resolve(__dirname, '../../..');
const missing = () => ({ status: 'not-found' });
const readLoop = count => `for(let i=0;i<${count};i++){const row=await ctx.kv('pages').getVersioned('p');if(row.status!=='not-found')return ctx.text('poison');count++;}`;
const sourceFor = body => `export default async function h(ctx){let count=0;${body}return ctx.text(''+count)}`;
const compile = source => compileCanonicalSource(source, { fileName: 'read-loop-lifecycle.ts', requireAsync: true, strict: false });
const invalidTicket = { code: 'PULSE_EFFECT_INVOCATION_INVALID' };

function clock() {
  let time = 0; const timers = new Map();
  return { now: () => time, setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, pending: () => timers.size,
    advance(ms) { time += ms; for (const [id, t] of [...timers]) if (t.at <= time) { timers.delete(id); t.fn(); } } };
}

function nativeTickets(native) {
  const a = nativeHost.instantiateCanonicalNativeModule(native, { strict: false });
  const b = nativeHost.instantiateCanonicalNativeModule(native, { strict: false });
  assert.equal(a.start(), 1); assert.equal(b.start(), 1);
  const first = a.pendingEffects()[0], foreign = b.pendingEffects()[0];
  function reject(ticket) {
    const size = a.heap.size(), pc = a.programCounter();
    assert.throws(() => a.setEffectResult(ticket, { status: 'found', value: 'poison' }), invalidTicket);
    assert.equal(a.heap.size(), size, 'invalid results must not allocate handles');
    assert.equal(a.programCounter(), pc, 'invalid results must not advance the guest');
  }
  reject({ ...first.ticket }); reject(foreign.ticket); reject(first.index);
  assert.equal(a.resume(), -2, 'an incomplete resume leaves the pending invocation usable');
  a.setEffectResult(first.ticket, missing()); reject(first.ticket);
  for (let i = 1; i < 4; i++) {
    assert.equal(a.resume(), 1);
    const pending = a.pendingEffects()[0];
    assert.equal(pending.index, first.index);
    assert.notEqual(pending.ticket.invocationId, first.ticket.invocationId);
    reject(first.ticket);
    a.setEffectResult(pending.ticket, missing()); reject(pending.ticket);
  }
  assert.equal(a.resume(), 0); assert.equal(a.response().body, '4');
  reject(first.ticket); assert.throws(() => a.resume(), invalidTicket);
  b.setEffectResult(foreign.ticket, missing()); b.close();
  assert.throws(() => b.resume(), invalidTicket);

  const abort = new AbortController();
  const cancelled = nativeHost.instantiateCanonicalNativeModule(native, { strict: false, signal: abort.signal });
  cancelled.start(); const ticket = cancelled.pendingEffects()[0].ticket, size = cancelled.heap.size();
  abort.abort();
  assert.throws(() => cancelled.setEffectResult(ticket, missing()), invalidTicket);
  assert.equal(cancelled.heap.size(), size); assert.deepEqual(cancelled.pendingEffects(), []);
}

async function managedHosts(compiled, native, source) {
  const program = loadCanonicalModule(compiled);
  const authored = {};
  Function('exports', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(authored);
  for (const target of ['native', 'generator', 'javascript']) {
    const execute = (dispatch, options = {}) => {
      options = { strict: false, ...options };
      if (target === 'javascript') return jsHost.executeNodeJavascriptApplication(authored.default,
        new Request('https://example.invalid/'), { ...options, effectAdapter: { id: 'lifecycle', dispatch } });
      options.providerAdapter = { id: 'lifecycle', dispatchEffect: dispatch };
      return target === 'native' ? nativeHost.executeCanonicalNativeModule(native, options)
        : generatorHost.createCanonicalHostRuntime(options).execute(program, options);
    };
    const ids = []; let calls = 0;
    const exact = await execute((effect, context) => { calls++; ids.push(context.invocationId || effect.id); return missing(); }, { maxEffects: 4 });
    assert.equal(target === 'javascript' ? await exact.text() : exact.response.body, '4', target);
    assert.equal(calls, 4); assert.equal(new Set(ids).size, 4, target + ' invocation identity');
    if (target !== 'javascript') {
      assert.equal(exact.effectCount, 4); assert.equal(exact.continuations.length, 4);
      assert.ok(exact.continuations.every(c => c.state === 'completed'));
      assert.equal(new Set(exact.continuations.map(c => c.invocationId || c.id)).size, 4);
    }
    calls = 0;
    const limited = execute(() => { calls++; return missing(); }, { maxEffects: 3 });
    if (target === 'javascript') assert.equal((await limited).status, 500);
    else await assert.rejects(limited, { code: 'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED' });
    assert.equal(calls, 3, target + ' cumulative effect cap');

    const c = clock(); calls = 0;
    await assert.rejects(execute(() => { calls++; c.advance(4); return missing(); }, { maxDurationMs: 10, requestClock: c }),
      { code: 'PULSE_REQUEST_DEADLINE_EXCEEDED' });
    assert.equal(calls, 3, target + ' inherited deadline'); assert.equal(c.pending(), 0);

    for (const lateFailure of [false, true]) {
      const abort = new AbortController(), lateClock = clock();
      let ready, settle, providerSignal; const admitted = new Promise(resolve => { ready = resolve; });
      calls = 0;
      const pending = execute((_effect, context) => {
        if (++calls === 1) return missing();
        providerSignal = context.signal; ready();
        return new Promise((resolve, reject) => { settle = () => lateFailure ? reject(new Error('late failure')) : resolve(missing()); });
      }, { signal: abort.signal, maxDurationMs: 100, requestClock: lateClock });
      let failure;
      const rejected = assert.rejects(pending, error => { failure = error; return /CANCELLED|ABORTED/.test(error.code) || error.name === 'AbortError'; });
      await admitted; abort.abort(); await rejected;
      const terminal = JSON.stringify(failure.execution);
      assert.equal(providerSignal.aborted, true);
      settle(); await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls, 2, target + ' late settlement cannot continue the loop');
      assert.equal(JSON.stringify(failure.execution), terminal); assert.equal(lateClock.pending(), 0);
    }
    calls = 0;
    const failed = await execute(() => { if (++calls === 2) throw new Error('provider failed'); return missing(); });
    // Conditional KV normalizes provider failures to a typed result. The handler
    // exits on that result, and no later iteration may be dispatched.
    assert.equal(target === 'javascript' ? await failed.text() : failed.response.body, 'poison');
    assert.equal(calls, 2);
  }
  // A caller label is not invocation authority, including on a shared registry.
  const shared = generatorHost.createCanonicalHostRuntime({ strict: false, providerAdapter: { id: 'shared', dispatchEffect: missing } });
  const results = await Promise.all([shared.execute(program, { executionId: 'same' }), shared.execute(program, { executionId: 'same' })]);
  assert.deepEqual(results.map(r => r.continuations.length), [4, 4]);
  assert.equal(new Set(results.flatMap(r => r.continuations.map(c => c.id))).size, 8);
}

function fastlyTicketBoundary() {
  // Compile the exact provider helper with a counting guest setter, so stale
  // tickets are checked independently of the driver's normal settlement order.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-invocations-'));
  try {
    const source = `const PULSE_FASTLY_EFFECT_COUNT:i32=2;const PULSE_ERROR_STATE:i32=1007;
      let writes:i32=0;function __pulse_fastly_fail(code:i32,stage:i32,index:i32):void{}
      function pulse_set_effect_result(index:i32,result:i32):i32{writes++;return 1;}
      ${fastlyInvocations.runtimeSource()}
      export function begin(index:i32):i32{return __pulse_invocation_begin(index)?unchecked(__pulse_invocation_tickets[index]):0;}
      export function settle(index:i32,ticket:i32):i32{return __pulse_invocation_settle(index,ticket,1);}
      export function close():void{__pulse_invocation_close();}
      export function count():i32{return writes;}`;
    const entry = path.join(cwd, 'test.ts'), wasm = path.join(cwd, 'test.wasm'); fs.writeFileSync(entry, source);
    const asc = resolveAsc(path.join(root, 'wasm/packages/compiler'));
    const built = spawnSync(asc.executable, [asc.script, entry, '--outFile', wasm, '--runtime', 'stub'], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const e = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(wasm)), { env: { abort() { throw new Error('AS abort'); } } }).exports;
    const first = e.begin(0); assert.ok(first > 0); assert.equal(e.begin(0), 0);
    assert.equal(e.settle(0, first + 1), 0); assert.equal(e.settle(1, first), 0);
    assert.equal(e.settle(0, first), 1); assert.equal(e.settle(0, first), 0);
    const next = e.begin(0); assert.notEqual(next, first);
    assert.equal(e.settle(0, first), 0); assert.equal(e.count(), 1);
    assert.equal(e.settle(0, next), 1);
    const pending = e.begin(1); e.close(); assert.equal(e.settle(1, pending), 0); assert.equal(e.begin(0), 0); assert.equal(e.count(), 2);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

function fastlyLoops() {
  const authority = createConditionalKvAuthority(); authority.stores.set('pages', new Map());
  const build = (body, options = {}) => platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(compile(sourceFor(body))),
    { cwd: root, bindings: { kv: { pages: 'pages' } }, ...options });
  for (const loops of [16, 17]) {
    const native = build(readLoop(64).repeat(loops)); let reads = 0;
    assert.equal(native.manifest.effectInvocations.defaultMaxEffects, 1024);
    const execute = () => platformHost.executeFastlyNativePlatformCapabilities(native, { conditionalKv: { authority,
      onCall(stage) { if (stage === 'lookup') reads++; } } });
    if (loops === 16) assert.equal(execute().response.body, '1024');
    else assert.throws(execute, error => error.detail?.lastError === 1007 && error.detail?.errorStage === 170);
    assert.equal(reads, 1024, 'Fastly counts loop invocations, not static slots');
  }
  // The application-error driver must not recover from or reset a runtime cap.
  const router = compileCanonicalRouterSource(`import {Router} from '@pulse-compute/runtime';
    const app=new Router();app.get('/',async(ctx)=>{let count=0;${readLoop(64).repeat(17)}return ctx.text(''+count)});
    app.error(async(error,ctx,next)=>{const recovered=await ctx.config.get('RECOVER');return ctx.text(recovered)});export default app;`,
    { fileName: 'read-loop-errors.ts', rootDir: root });
  const compiled = compileCanonicalSource(router.sourceText, { fileName: 'read-loop-errors.ts', rootDir: root, strict: false,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata } });
  const capped = platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(compiled),
    { cwd: root, bindings: { kv: { pages: 'pages' }, configStore: 'config' } });
  let cappedReads = 0;
  assert.throws(() => platformHost.executeFastlyNativePlatformCapabilities(capped, { conditionalKv: { authority,
    onCall(stage) { if (stage === 'lookup') cappedReads++; } }, config: { RECOVER: 'unexpected' } }),
  error => error.detail?.errorStage === 170 && error.detail.lastError === 1007
    && !error.detail.trace.some(t => t.module === 'fastly_config_store'));
  assert.equal(cappedReads, 1024);
  const routedDeadline = platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(compiled),
    { cwd: root, bindings: { kv: { pages: 'pages' }, configStore: 'config' }, maxDurationMs: 10 });
  let routedReads = 0;
  const routedExpired = platformHost.executeFastlyNativePlatformCapabilities(routedDeadline, { conditionalKv: { authority,
    onCall(stage) { if (stage === 'lookup') { routedReads++; return { readyDelayMs: 4 }; } } } });
  assert.equal(routedExpired.response.status, 504); assert.equal(routedReads, 3);
  assert.equal(routedExpired.trace.some(t => t.module === 'fastly_config_store'), false);
  const budgeted = build(readLoop(4), { maxDurationMs: 10 }); let reads = 0;
  const expired = platformHost.executeFastlyNativePlatformCapabilities(budgeted, { conditionalKv: { authority,
    onCall(stage) { if (stage === 'lookup') { reads++; return { readyDelayMs: 4 }; } } } });
  assert.equal(expired.response.status, 504); assert.equal(reads, 3);
  const complete = platformHost.executeFastlyNativePlatformCapabilities(budgeted, { conditionalKv: { authority } });
  assert.equal(complete.response.body, '4');
  const traces = complete.trace.length;
  complete.instance.exports._start();
  assert.equal(complete.trace.length, traces, 'terminal reentry cannot dispatch hostcalls');
  assert.equal(complete.instance.exports.pulse_fastly_error_stage(), 171);
}

async function main() {
  const source = sourceFor(readLoop(4)), compiled = compile(source);
  const native = compileCanonicalNativePlan(buildCanonicalNativePlan(compiled), { cwd: root });
  nativeTickets(native); await managedHosts(compiled, native, source); fastlyTicketBoundary(); fastlyLoops();
  console.log('ok - PS2 invocation identity, terminal invalidation, cumulative effect counts and deadlines');
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
