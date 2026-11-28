'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { linkedRuntime } = require('../../../packages/runtime-core-as/src/compiler/linked-runtime');
const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile');
const { inspectWasmFile } = require('../../../packages/wasm-guest-link/src/inspect');
const { runTool } = require('../../../packages/wasm-guest-link/src/toolchain');
const { createNativeInitializer } = require('../../../packages/host-runtime/src/runtime/native-initialization');
const { fastlyGuestLinkedStartWrapperWat } = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const nativeCrypto = require('../../../../packages/crypto/pulsewasm.native.cjs');
const root = path.resolve(__dirname, '../../../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt022-boundaries-'));
try {
  let calls = 0;
  const once = createNativeInitializer(() => calls++); once.run(); once.run(); assert.equal(calls, 1);
  const bad = createNativeInitializer(() => { calls++; throw new Error('injected'); });
  assert.throws(bad.run, /injected/); assert.throws(bad.run, /unavailable/); assert.equal(calls, 2);
  const reentrant = createNativeInitializer(() => { try { reentrant.run(); } catch {} });
  assert.throws(reentrant.run, /reentered/); assert.equal(reentrant.state, 'failed');
  const effect = createNativeInitializer(() => { try { effect.assertReady(); } catch {} });
  assert.throws(effect.run); assert.equal(effect.state, 'failed');

  // Exercise the exact provider-owned wrapper with injected initialization traps/reentry.
  const wat = path.join(directory, 'entry.wat'), wasm = path.join(directory, 'entry.wasm');
  fs.writeFileSync(wat, fastlyGuestLinkedStartWrapperWat());
  runTool('wasm-as', [wat, '--mvp-features', '-o', wasm], { cwd: directory });
  const wrapper = new WebAssembly.Module(fs.readFileSync(wasm));
  for (const mode of ['once', 'failed', 'reentrant', 'caught-reentry']) {
    let starts = 0, handles = 0, instance;
    instance = new WebAssembly.Instance(wrapper, { pulse_fastly_primary: {
      __pulse_initialize() { starts++; if (mode === 'failed') throw new Error('injected'); if (mode === 'reentrant') instance.exports._start(); if (mode === 'caught-reentry') { try { instance.exports._start(); } catch {} } },
      pulse_fastly_handle() { handles++; }
    } });
    if (mode === 'once') { instance.exports._start(); instance.exports._start(); assert.equal(handles, 2); }
    else { assert.throws(() => instance.exports._start()); assert.throws(() => instance.exports._start()); assert.equal(handles, 0); }
    assert.equal(starts, 1);
  }
  const source = nativeCrypto.pulseHmacAssemblyScriptSource().source + `
let last: Uint8Array | null = null;
const kept = new Array<Uint8Array>();
export function allocate(keep: bool): i32 {
  last = new Uint8Array(4096); last![0] = 91;
  if (keep) kept.push(last!);
  return <i32>last!.dataStart;
}
export function collect(): void { __collect(); }
export function sentinel(): i32 { return last![0]; }
export function reset(): void { __reset(); }
export function reallocProbe(): i32 {
  const p = heap.alloc(256); store<u8>(p, 91);
  const q = heap.realloc(p, 8192); const result = load<u8>(q); heap.free(q); return result;
}
`;
  fs.writeFileSync(path.join(directory, 'probe.ts'), source);
  const asc = resolveAsc(path.join(root, 'wasm/packages/compiler'));
  const compiled = spawnSync(asc.executable, [asc.script, 'probe.ts', '--outFile', 'probe.wasm',
    '--runtime', linkedRuntime().module, '--initialMemory', '32', '--maximumMemory', '32',
    '--memoryBase', '262144', '--stackSize', '32768', '--exportStart', '__pulse_initialize',
    '--disable', 'bulk-memory', '--disable', 'sign-extension', '--disable', 'nontrapping-f2i', '--optimize'],
  { cwd: directory, encoding: 'utf8', timeout: 120000 });
  assert.equal(compiled.status, 0, compiled.stderr);
  const inspected = inspectWasmFile(path.join(directory, 'probe.wasm'), { workDirectory: directory, label: 'bounded-runtime' });
  assert.equal(inspected.hasStart, false); assert.equal(inspected.instructions.memoryGrow, 0);
  const module = new WebAssembly.Module(fs.readFileSync(path.join(directory, 'probe.wasm')));
  function fresh() {
    const e = new WebAssembly.Instance(module, { env: { abort() { throw new Error('abort'); } } }).exports;
    const bytes = new Uint8Array(e.memory.buffer);
    bytes.fill(0xa5, 0, 262144); bytes.fill(0xa5, 524288, 540928);
    e.__pulse_initialize();
    const canary = () => {
      assert(bytes.subarray(0, 262144).every(b => b === 0xa5));
      assert(bytes.subarray(524288, 540928).every(b => b === 0xa5));
      assert.equal(e.memory.buffer.byteLength, 2097152);
    };
    canary(); return { e, canary };
  }
  const { e, canary } = fresh();
  const bridge = nativeCrypto.bindNativeDigestMac(e);
  for (const length of [0, 1, 55, 56, 63, 64, 65535, 65536, 65537, 2097152]) {
    const data = Buffer.alloc(length, 0x79);
    assert.deepEqual(Buffer.from(bridge.sha256(data)), crypto.createHash('sha256').update(data).digest());
    assert(new Uint8Array(e.memory.buffer, e.pulse_crypto_bytes_frame_v1(), 73760).every(b => b === 0));
    canary();
  }
  assert.throws(() => bridge.sha256(Buffer.alloc(2097153)));
  for (const keyLength of [0, 32, 8192]) {
    const key = Buffer.alloc(keyLength, 0x42), data = Buffer.alloc(65536, 0x71);
    assert.deepEqual(Buffer.from(bridge.hmacSha256(key, data)), crypto.createHmac('sha256', key).update(data).digest()); canary();
  }
  assert.throws(() => bridge.hmacSha256(Buffer.alloc(8193), Buffer.alloc(0)));
  assert.throws(() => bridge.hmacSha256(Buffer.alloc(32), Buffer.alloc(65537)));
  assert.equal(e.pulse_crypto_digest_update_v2(1), -2);
  assert.equal(e.pulse_crypto_digest_init_v2(), 1); assert.equal(e.pulse_crypto_digest_init_v2(), -2);
  assert.equal(e.pulse_crypto_digest_final_v2(), -2);
  assert.equal(e.pulse_crypto_digest_init_v2(), 1); assert.equal(e.pulse_crypto_digest_update_v2(65537), -2);
  assert.equal(e.pulse_crypto_digest_final_v2(), -2);
  assert.equal(e.pulse_crypto_digest_init_v2(), 1);
  for (let i = 0; i < 32; i++) assert.equal(e.pulse_crypto_digest_update_v2(65536), 1);
  assert.equal(e.pulse_crypto_digest_update_v2(1), -2); canary();
  const broken = nativeCrypto.bindNativeDigestMac({ ...e, pulse_crypto_digest_update_v2() { throw new WebAssembly.RuntimeError('injected crypto failure'); } });
  assert.throws(() => broken.sha256(Buffer.from('private fixture')), /injected crypto failure/);
  assert(new Uint8Array(e.memory.buffer, e.pulse_crypto_bytes_frame_v1(), 73760).every(b => b === 0));
  assert.equal(e.pulse_crypto_digest_final_v2(), -2);
  assert.throws(() => broken.sha256(Buffer.from('retry')), /unavailable/); canary();
  for (let i = 0; i < 512; i++) {
    assert(e.allocate(false) >= 540928); e.collect(); assert.equal(e.sentinel(), 91);
    assert.equal(e.reallocProbe(), 91); canary();
  }
  assert.throws(() => e.reset()); canary();
  const exhausted = fresh(); let count = 0;
  assert.throws(() => { for (; count < 512; count++) exhausted.e.allocate(true); }, WebAssembly.RuntimeError);
  assert(count > 100 && count < 512); exhausted.canary();
  console.log(JSON.stringify({ status: 'passed', fixedPages: 32, digestMaximum: 2097152, stagingBytes: 73760,
    allocatorCycles: 512, retainedBeforeExhaustion: count, initialization: ['once', 'failure', 'reentry', 'forbidden-effect'],
    signatureFrameAndRustCanaries: 'preserved', installedQualified: false, hostedQualified: false }));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
