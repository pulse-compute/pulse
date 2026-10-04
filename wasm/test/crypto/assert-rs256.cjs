#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');

async function main() {
  const api = await import('../../../packages/crypto/dist/index.js');
  const { rsaKeyBytes, rsaWireJwk } = await import('../../../packages/crypto/dist/internal/rsa.js');
  const provider = require('../../../packages/crypto/src/provider.cjs');
  const nativeProvider = require('../../../packages/crypto/pulsewasm.native.cjs');
  const artifact = fs.readFileSync(path.join(root, 'packages/crypto/guests/es256-rustcrypto/prebuilt/es256-verifier.wasm'));
  const memory = new WebAssembly.Memory({ initial: 32, maximum: 32 });
  const { instance } = await WebAssembly.instantiate(artifact, { env: { memory } });
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(artifact)), [{ module: 'env', name: 'memory', kind: 'memory' }]);
  const data = Buffer.from('RS256: independently generated signing bytes\0\xff');
  let observedStackBytes = 0, assertions = 0;
  const exports = { ...instance.exports, memory, pulse_crypto_rs256_sign(pointer, capacity) {
    new Uint8Array(memory.buffer, 0, 65536).fill(0xa5);
    const status = instance.exports.pulse_crypto_rs256_sign(pointer, capacity);
    const first = new Uint8Array(memory.buffer, 0, 65536).findIndex(byte => byte !== 0xa5);
    if (first >= 0) observedStackBytes = Math.max(observedStackBytes, 65536 - first);
    assert.ok(first >= 0 && first > 0, 'private stack stays above the lower bound');
    return status;
  } };
  const native = nativeProvider.bindNativeRs256(exports), js = provider.bindJavascriptRs256Signer();
  const timings = [];
  const wiped = () => {
    assert.equal(new Uint8Array(memory.buffer, 0, 65536).some(Boolean), false);
    assert.equal(new Uint8Array(memory.buffer, 524288, 16640).some(Boolean), false);
    assert.equal(memory.buffer.byteLength, 2097152);
  };
  for (const bits of [2048, 3072, 4096]) {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: bits });
    const jwk = pair.privateKey.export({ format: 'jwk' }), key = rsaKeyBytes(jwk, true), publicKey = rsaKeyBytes(jwk);
    const expected = crypto.sign('sha256', data, pair.privateKey);
    const sig = native.sign(key, data); wiped();
    assert.deepEqual(Buffer.from(sig), expected);
    assert.deepEqual(Buffer.from(await js.bytes.rs256Sign(key, data)), expected);
    assert.equal(crypto.verify('sha256', data, pair.publicKey, sig), true);
    const request = { algorithm: 'RS256', key: { type: 'rsa-public-key-bytes', bytes: publicKey }, data, signature: expected };
    assert.deepEqual(await api.crypto.signature.verify(request), { status: 'valid' });
    assert.deepEqual(native.verify(publicKey, data, expected), { status: 'valid' }); wiped();
    const jose = api.normalizeRs256JoseVerifyRequest({ key: { n: jwk.n, e: jwk.e }, data, signature: expected.toString('base64url') });
    assert.equal(jose.ok, true);
    const alteredSignature = Buffer.from(expected); alteredSignature[0] ^= 1;
    const badSignatures = [Buffer.alloc(bits/8), alteredSignature,
      crypto.sign('sha256', data, { key: pair.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 })];
    // Independent RSA_NO_PADDING operation creates invalid EMSA encodings;
    // changes exercise the delimiter, FF padding and DigestInfo hash OID.
    const block = crypto.publicDecrypt({ key: pair.publicKey, padding: crypto.constants.RSA_NO_PADDING }, expected);
    for (const index of [0, 1, 2, block.length-52, block.length-40, block.length-1]) {
      const malformed = Buffer.from(block); malformed[index] ^= 1;
      badSignatures.push(crypto.privateEncrypt({ key: pair.privateKey, padding: crypto.constants.RSA_NO_PADDING }, malformed));
    }
    for (const signature of badSignatures) {
      assert.deepEqual(native.verify(publicKey, data, signature), { status: 'invalid-authenticator' }); wiped();
      assert.deepEqual(await api.crypto.signature.verify({ ...request, signature }), { status: 'invalid-authenticator' }); assertions += 2;
    }
    for (const name of ['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi']) {
      const broken = { ...jwk }, value = Buffer.from(jwk[name], 'base64url'); value[value.length-1] ^= 2;
      broken[name] = value.toString('base64url');
      const bytes = rsaKeyBytes(broken, true);
      assert.throws(() => native.sign(bytes, data), { code: 'PULSE_CRYPTO_KEY_INVALID' }); wiped();
      await assert.rejects(js.bytes.rs256Sign(bytes, data), { code: 'PULSE_CRYPTO_KEY_INVALID' });
      bytes.fill(0); assertions += 2;
    }
    for (const invalid of [{ ...jwk, e: 'Ag' }, { ...jwk, e: 'AQAAAAE' }, { ...jwk, n: 'AA' + jwk.n }, { ...jwk, d: jwk.d + '=' }]) {
      assert.throws(() => rsaKeyBytes(invalid, true)); assertions++;
    }
    assert.deepEqual(await api.crypto.signature.verify({ ...request, key: { type: 'p256-public-key-bytes', bytes: publicKey } }), { status: 'invalid-key' });
    assert.deepEqual(await api.crypto.signature.verify({ ...request, signature: expected.subarray(1) }), { status: 'invalid-input' });
    assert.deepEqual(await api.crypto.signature.verify({ ...request, data: new Uint8Array(12289) }), { status: 'invalid-input' });
    assert.deepEqual(await api.crypto.signature.verify({ ...request, data: Buffer.from('wrong') }), { status: 'invalid-authenticator' });
    const maximumData = new Uint8Array(12288);
    assert.deepEqual(native.verify(publicKey, maximumData, native.sign(key, maximumData)), { status: 'valid' }); wiped();
    const signMs = [], verifyMs = [];
    for (let i = 0; i < 8; i++) {
      let start = performance.now(); native.sign(key, data); signMs.push(performance.now()-start);
      start = performance.now(); native.verify(publicKey, data, expected); verifyMs.push(performance.now()-start);
    }
    timings.push({ bits, signMedianMs: signMs.sort((a,b)=>a-b)[4], verifyMedianMs: verifyMs.sort((a,b)=>a-b)[4] });
    // A valid frame is captured before the wrapper clears it. Mutations must
    // fail before reading a private key or writing a signature.
    let frame;
    const capture = nativeProvider.bindNativeRs256({ ...instance.exports, memory,
      pulse_crypto_rs256_sign(p, c) { frame = new Uint8Array(memory.buffer, p, c).slice(); return instance.exports.pulse_crypto_rs256_sign(p, c); } });
    capture.sign(key, data);
    for (const [offset, value] of [[0,0], [4,3], [8,32], [12,16641], [16,1], [20,1], [24,64], [28,12289], [32,0], [36,96], [40,64], [44,64], [48,1], [52,1], [56,1], [60,1]]) {
      new Uint8Array(memory.buffer, 524288, 16640).set(frame);
      new DataView(memory.buffer, 524288, 16640).setUint32(offset, value, true);
      assert.equal(instance.exports.pulse_crypto_rs256_sign(524288,16640), -2); assertions++;
    }
    for (const [pointer, capacity] of [[0,16640],[524289,16640],[524288,16639],[0xfffffff0,16640]]) {
      assert.equal(instance.exports.pulse_crypto_rs256_sign(pointer,capacity), -2); assertions++;
    }
    // Verify that foreign key sizes are never normalized.
    assert.equal(rsaWireJwk(key, true).n, jwk.n);
    const trapping = nativeProvider.bindNativeRs256({ ...instance.exports, memory,
      pulse_crypto_rs256_sign() { throw new WebAssembly.RuntimeError('injected trap'); } });
    assert.throws(() => trapping.sign(key, data), WebAssembly.RuntimeError); wiped(); assertions++;
    frame.fill(0); key.fill(0); publicKey.fill(0);
    new Uint8Array(memory.buffer,524288,16640).fill(0);
  }
  for (const bits of [1024, 2056]) {
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: bits });
    assert.throws(() => rsaKeyBytes(publicKey.export({format:'jwk'})));
  }
  console.log(JSON.stringify({ status:'passed', assertions, artifactBytes:artifact.length, fixedMemoryBytes:memory.buffer.byteLength,
    observedStackBytes, reservedStackBytes:65536, timings, timingEnvironment:'local Node Wasm; development evidence, not Fastly measurements', providerReality:false }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
