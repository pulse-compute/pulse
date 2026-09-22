'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CANONICAL_NATIVE_READ_LOOP_MEMORY: policy } = require('../../packages/contracts/src/handler/canonical-native-runtime');
const { NativeValueBudget } = require('../../packages/host-runtime/src/runtime/native-value-budget');
const host = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const { resolveProject } = require('../../packages/cli/src/project-config');
const execution = require('../../packages/cli/src/project-execution');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const platformHost = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const fastlyBudget = require('../../../packages/provider-fastly/src/build/native-value-budget');
const { createConditionalKvAuthority } = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
const driver = require('../../../packages/provider-node/src/toolchain').createDriver();
const { resolveAsc } = require('../../packages/build-support/src/assemblyscript-compile');
const root = path.resolve(__dirname, '../../..');
const fixture = path.join(root, 'wasm/test/fixtures/projects/bounded-read-loops');
const limited = { code: 'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED' };

function budgetBoundaries() {
  for (const bound of ['bytes', 'values']) {
    let closed = 0;
    const b = new NativeValueBudget({ ...policy, maxBytes: 64, maxValues: 2 }, () => closed++);
    b.charge(2, 64);
    assert.throws(() => b.charge(bound === 'values' ? 1 : 0, bound === 'bytes' ? 1 : 0), limited);
    assert.equal(closed, 1); assert.deepEqual([b.bytes, b.values], [64, 2]);
    assert.throws(() => b.charge(0, 0), limited);
  }
  const b = new NativeValueBudget(policy), heap = new host.ValueHeap(b);
  const carried = { text: 'first', values: [1, 2] }; carried.self = carried;
  const first = heap.put(carried), alias = heap.put(carried);
  assert.equal(first, alias, 'the same object reuses its handle');
  assert.notEqual(heap.put({ text: 'same' }), heap.put({ text: 'same' }), 'distinct objects are never coalesced');
  b.write(carried.values, '2', 3); carried.values.push(3);
  for (let i = 0; i < 64; i++) heap.put({ text: 'temporary' });
  assert.equal(heap.get(first), heap.get(alias)); assert.deepEqual(heap.get(first).values, [1, 2, 3]);
  const scalarBudget = new NativeValueBudget(policy), scalars = new host.ValueHeap(scalarBudget);
  for (const value of [undefined, null, true, false, 0, -0, NaN, Infinity, '0', '\ud800', 'literal']) {
    const handle = scalars.put(value), before = scalarBudget.snapshot();
    for (let i = 0; i < 10000; i++) assert.equal(scalars.put(value), handle);
    assert.deepEqual(scalarBudget.snapshot(), before);
    assert.ok(Object.is(scalars.get(handle), value));
  }
  assert.notEqual(scalars.put(0), scalars.put(-0));
  assert.notEqual(scalars.put(0), scalars.put('0'));
  for (let i = 0; i < 10000; i++) scalars.put(i);
  assert.equal(scalars.scalars.size, 8192, 'scalar index is bounded');
  const carriedScalar = scalars.put('carried-after-cache-capacity');
  const beforeRotation = scalarBudget.snapshot();
  for (let i = 20000; i < 28192; i++) scalars.put(i);
  assert.equal(scalars.scalars.size, 8192);
  assert.equal(scalars.get(carriedScalar), 'carried-after-cache-capacity', 'index eviction preserves old handles');
  assert.equal(scalarBudget.values - beforeRotation.values, 8192, 'all replacement values stay charged; index capacity is reused');
  assert.equal(scalarBudget.bytes - beforeRotation.bytes, 8192 * policy.valueBytes);
  const recached = scalars.put('carried-after-cache-capacity');
  assert.notEqual(recached, carriedScalar);
  assert.equal(scalars.put('carried-after-cache-capacity'), recached);
  assert.throws(() => scalarBudget.charge(policy.maxValues, 0), limited);
  assert.throws(() => scalars.put('carried-after-cache-capacity'), limited, 'cached handles preserve terminal failure');
  const objectBudget = new NativeValueBudget(policy), objects = new host.ValueHeap(objectBudget);
  const rootObject = { items: [] }, rootHandle = objects.put(rootObject), beforeObjects = objectBudget.snapshot();
  for (let i = 0; i < 10000; i++) assert.equal(objects.put(rootObject), rootHandle);
  assert.deepEqual(objectBudget.snapshot(), beforeObjects);
  for (let i = 0; i < 10000; i++) objects.put({});
  assert.equal(objects.identityCount, 8192, 'identity index is bounded');
  const uncachedObject = {};
  assert.notEqual(objects.put(uncachedObject), objects.put(uncachedObject));
  objectBudget.write(rootObject.items, '0', 42); rootObject.items.push(42);
  assert.equal(objects.put(rootObject), rootHandle);
  assert.deepEqual(objects.get(rootHandle).items, [42], 'cached aliases observe charged mutations');
  assert.throws(() => objectBudget.charge(policy.maxValues, 0), limited);
  assert.throws(() => objects.put(rootObject), limited, 'cached object handles preserve terminal failure');
  const small = new NativeValueBudget({ ...policy, maxBytes: 128 });
  const target = [];
  assert.throws(() => small.write(target, '1000000000', 1), limited);
  assert.equal(target.length, 0, 'sparse growth rejected before mutation');

  // Compile the production Fastly counter with small limits for exact edges.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-memory-budget-'));
  try {
    const source = `let closed:i32=0;let stage:i32=0;
      class __PulseFastlyHeader { constructor(public name:string,public value:string){} }
      function __pulse_fastly_fail(code:i32,s:i32,index:i32):void{stage=s;}
      function __pulse_invocation_close():void{closed++;}
      ${fastlyBudget.runtimeSource({ ...policy, maxBytes: 64, maxValues: 2 })}
      export function charge(values:i64,bytes:i64):void{__pulse_memory_charge(values,bytes);}
      export function status():i32{return closed*1000+stage;}`;
    const entry = path.join(cwd, 'test.ts'), wasm = path.join(cwd, 'test.wasm'); fs.writeFileSync(entry, source);
    const asc = resolveAsc(path.join(root, 'wasm/packages/compiler'));
    const built = spawnSync(asc.executable, [asc.script, entry, '--outFile', wasm, '--runtime', 'stub'], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    for (const [values, bytes, stage] of [[1n, 0n, 173], [0n, 1n, 172]]) {
      const e = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(wasm)), { env: { abort() { throw Error('abort'); } } }).exports;
      e.charge(2n, 64n); assert.throws(() => e.charge(values, bytes), WebAssembly.RuntimeError);
      assert.equal(e.pulse_fastly_memory_bytes(), 64n); assert.equal(e.pulse_fastly_memory_values(), 2n);
      assert.equal(e.status(), 1000 + stage);
      assert.throws(() => e.charge(0n, 0n), WebAssembly.RuntimeError);
    }
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

async function terminalLimits() {
  const source = `import {Router} from '@pulse-compute/runtime';const app=new Router();app.get('/',async(ctx)=>{let text='x';
    for(let i=0;i<64;i++){const row=await ctx.kv('pages').getVersioned('p');text=text+text;}
    return ctx.text(text)});app.error(async(error,ctx,next)=>{const recovered=await ctx.config.get('RECOVER');return ctx.text(recovered)});export default app;`;
  const router = compileCanonicalRouterSource(source, { fileName: 'memory.ts', rootDir: root });
  const plan = buildCanonicalNativePlan(compileCanonicalSource(router.sourceText, { fileName: 'memory.ts', rootDir: root, strict: false,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata } }));
  const native = compileCanonicalNativePlan(plan, { cwd: root });
  assert.deepEqual(native.manifest.policy.readLoopMemory, policy);
  let calls = 0;
  await assert.rejects(host.executeCanonicalNativeModule(native, { strict: false, providerAdapter: { id: 'memory',
    dispatchEffect(effect) { assert.equal(effect.kind, 'kv.getVersioned'); calls++; return { status: 'not-found' }; } } }), limited);
  assert.ok(calls > 1 && calls < 64);
  const controller = host.instantiateCanonicalNativeModule(native, { strict: false });
  controller.start(); const ticket = controller.pendingEffects()[0].ticket;
  const size = controller.heap.size();
  assert.throws(() => controller.setEffectResult(ticket, 'x'.repeat(policy.maxBytes / 2)), limited);
  assert.equal(controller.heap.size(), size); assert.deepEqual(controller.pendingEffects(), []);
  assert.throws(() => controller.resume(), { code: 'PULSE_EFFECT_INVOCATION_INVALID' });
  // KV-only artifacts also need an encoded linear-memory ceiling.
  assert.throws(() => controller.exports.memory.grow(policy.maximumMemoryPages + 1), RangeError);
  const fastly = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: root, bindings: { kv: { pages: 'pages' }, configStore: 'config' } });
  assert.deepEqual(fastly.manifest.policy.readLoopMemory, policy);
  const authority = createConditionalKvAuthority(); authority.stores.set('pages', new Map()); calls = 0;
  assert.throws(() => platformHost.executeFastlyNativePlatformCapabilities(fastly, { conditionalKv: { authority,
    onCall(stage) { if (stage === 'lookup') calls++; } }, config: { RECOVER: 'unexpected' } }), error => error.code === limited.code
      && error.detail.errorStage === 172 && !error.detail.trace.some(entry => entry.module === 'fastly_config_store'));
  assert.ok(calls > 1 && calls < 64);
}

const receiptTypes = `export interface Receipt {actorId:string;commandId:string;fingerprint:string;revision:number;result:string}
export interface Page {schemaVersion:number;throughRevision:number;previousSha256:string;receipts:Receipt[]}`;
// A complete request artifact with the Catalog receipt-page shape, two awaits,
// nested pure iteration, carried aliases, a schema root, and an early return.
const receiptHandler = `import {Pulse} from '@pulse-compute/pulse'
import {s3} from '@pulse-compute/s3'
import {crypto} from '@pulse-compute/crypto'
import type {Page,Receipt} from './types'
const app=new Pulse({auto:true})
app.get('/pages',async(ctx)=>{
 let archive=ctx.req.header('x-start')||'';let through=4096;let first:Receipt|null=null;
 const actorId=ctx.req.header('x-actor')||'';
 const state={visits:0};const alias=state;
 for(let pageIndex=0;pageIndex<64&&archive!=='';pageIndex++){
  const stored=await s3.getText(ctx,'objects',archive);
  if(stored.status!=='found')return ctx.text('unavailable',{status:503});
  const digest=await crypto.digestText(ctx,stored.text);
  if(digest.status!=='ok'||digest.sha256!==stored.sha256||digest.byteLength>57344)return ctx.text('invalid',{status:503});
  const page=ctx.decodeJson<Page>(stored.text,'memory.Page');
  if(page.throughRevision!==through||page.receipts.length!==64)return ctx.text('invalid',{status:503});
  let invalid=false;
  for(let i=0;i<64;i++){
   const entry=page.receipts[i];
   if(entry.revision!==through-63+i||entry.actorId===''||entry.commandId===''||entry.fingerprint.length!==64||entry.result.length!==64)invalid=true;
   if(entry.actorId===actorId&&entry.commandId==='search')first=entry;
   if(pageIndex===0&&i===0)first=entry;
  }
  if(invalid)return ctx.text('invalid',{status:503});
  alias.visits+=1;through-=64;archive=page.previousSha256;
 }
 if(archive!=='')return ctx.text('incomplete',{status:409});
 return ctx.text(state.visits+':'+(first===null?'':first.commandId));
})
export default app`;

function pages(count, incomplete = false) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const page = { schemaVersion: 1, throughRevision: 4096 - index * 64,
      previousSha256: index + 1 < count || incomplete ? 'p' + (index + 2) : '',
      receipts: Array.from({ length: 64 }, (_, i) => ({ actorId: 'a'.repeat(600), commandId: 'cmd-' + i,
        fingerprint: 'f'.repeat(64), revision: 4096 - index * 64 - 63 + i, result: 'r'.repeat(64) })) };
    page.receipts[0].actorId += 'a'.repeat(57344 - Buffer.byteLength(JSON.stringify(page)));
    const body = JSON.stringify(page); assert.equal(Buffer.byteLength(body), 57344);
    return ['https://objects.example.invalid/pages/p' + (index + 1), body];
  }));
}

async function workload() {
  const cwd = fs.mkdtempSync(path.join(fixture, '.memory-'));
  try {
    fs.mkdirSync(path.join(cwd, 'src')); fs.cpSync(path.join(fixture, '.pulse'), path.join(cwd, '.pulse'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 's3', 'crypto']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), receiptHandler);
    fs.writeFileSync(path.join(cwd, 'src/types.ts'), receiptTypes);
    fs.writeFileSync(path.join(cwd, 'src/schemas.ts'), `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema'
      import type {Page} from './types';export default defineSchemaRegistry({schemas:{'memory.Page':schema<Page>()}})`);
    const project = resolveProject({ cwd, profile: 'node' }), prepared = execution.compileNativeProjectInMemory(project);
    const fp = resolveProject({ cwd, profile: 'fastly' });
    const fastly = platform.compileFastlyNativePlatformCapabilitiesPlan(prepared.plan, { cwd, bindings: fp.providerConfig.bindings, canonicalBuild: true });
    const secrets = { S3_ID: 'fixture-id', S3_KEY: 'fixture-secret-012345678901234567890123456789' };
    const measurements = [];
    for (const [count, incomplete] of [[0, false], [1, false], [16, false], [64, false], [64, true]]) {
      const responses = pages(count, incomplete);
      const request = { method: 'GET', path: '/pages', url: 'https://app.example.invalid/pages', headers: [['x-start', count ? 'p1' : ''], ['x-actor', 'a'.repeat(600)]], body: '' };
      const nr = await host.executeCanonicalNativeModule(prepared.native, driver.executionOptions(project.providerConfig, { request, strict: false, secrets,
        fetchImplementation: async input => new Response(responses[new Request(input).url], { status: 200 }) }));
      const fr = platformHost.executeFastlyNativePlatformCapabilities(fastly, { request, secrets, secretStore: 'app_secrets',
        fixtures: Object.fromEntries(Object.entries(responses).map(([url, body]) => ['GET ' + url, { status: 200, headers: [['content-length', String(body.length)]], body }])) });
      assert.equal(nr.response.body, incomplete ? 'incomplete' : count + ':' + (count ? 'cmd-0' : '')); assert.equal(fr.response.body, nr.response.body);
      assert.equal(fr.response.status, incomplete ? 409 : 200);
      assert.equal(nr.effectCount, count * 2);
      const memory = fr.instance.exports.memory;
      assert.throws(() => memory.grow(policy.maximumMemoryPages + 1), RangeError);
      measurements.push({ pages: count, incomplete, node: nr.memory, fastly: { bytes: Number(fr.instance.exports.pulse_fastly_memory_bytes()),
        values: Number(fr.instance.exports.pulse_fastly_memory_values()), linearMemoryBytes: memory.buffer.byteLength },
        wasmBytes: fastly.wasm.length, wasmSha256: fastly.manifest.wasm.sha256 });
    }
    console.log(JSON.stringify({ status: 'passed', memory: measurements, providerReality: false }));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

async function main() { budgetBoundaries(); await terminalLimits(); await workload(); }
module.exports = { main, receiptTypes, receiptHandler, pages };
if (require.main === module) main().catch(error => { console.error(error.stack); console.error(JSON.stringify(error.detail || error.diagnostics)); process.exitCode = 1; });
