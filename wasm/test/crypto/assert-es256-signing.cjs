#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPublicKey, verify } = require('node:crypto');
const { bindNativeEs256Signer } = require('../../../packages/crypto/pulsewasm.native.cjs');
// Published test material: RFC6979 appendix A.2.5, SHA-256 / "sample".
// https://www.rfc-editor.org/rfc/rfc6979#appendix-A.2.5
const x = Buffer.from('60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6', 'hex');
const y = Buffer.from('7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299', 'hex');
const d = Buffer.from('C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721', 'hex');
const key = Buffer.concat([x,y,d]);
const input = Buffer.from('sample');
const expected = Buffer.from('EFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716F7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8', 'hex');
const bytes = fs.readFileSync(path.resolve(__dirname, '../../../packages/crypto/guests/es256-rustcrypto/prebuilt/es256-verifier.wasm'));
const memory = new WebAssembly.Memory({initial:32, maximum:32});
const guest = new WebAssembly.Instance(new WebAssembly.Module(bytes), {env:{memory}}).exports;
const sign = bindNativeEs256Signer({...guest,memory});
const publicKey = createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:x.toString('base64url'),y:y.toString('base64url')}});
for (let n=0;n<3;n++) {
  const signature = sign(key,input);
  assert.deepEqual(Buffer.from(signature),expected);
  assert.equal(verify('sha256',input,{key:publicKey,dsaEncoding:'ieee-p1363'},signature),true);
  assert.equal(new Uint8Array(memory.buffer,524288,16640).some(Boolean),false);
  assert.equal(new Uint8Array(memory.buffer,0,65536).some(Boolean),false);
}
for (const invalid of [Buffer.alloc(96),Buffer.concat([Buffer.alloc(64),d])]) {
  assert.throws(()=>sign(invalid,input),{code:'PULSE_CRYPTO_KEY_INVALID'});
  assert.equal(new Uint8Array(memory.buffer,524288,16640).some(Boolean),false);
  assert.equal(new Uint8Array(memory.buffer,0,65536).some(Boolean),false);
}
assert.throws(()=>sign(key,Buffer.alloc(16341)),TypeError);
assert.throws(()=>sign(key.subarray(0,64),input),TypeError);
const pointer=524288, capacity=16640;
function frame() {
  const bytes=new Uint8Array(memory.buffer,pointer,capacity);bytes.fill(0);
  const header=new DataView(memory.buffer,pointer,64);
  for (const [at,value] of [[0,0x32534550],[4,2],[8,64],[12,240],[16,1],[24,224],[28,input.length],[32,64],[36,96],[40,160],[44,64]]) header.setUint32(at,value,true);
  bytes.set(key,64);bytes.set(input,224);return {bytes,header};
}
for (const [ptr,cap] of [[0,capacity],[pointer+1,capacity],[0xfffffff0,capacity],[2097152,capacity],[pointer,capacity-1]]) {
  frame();assert.equal(guest.pulse_crypto_es256_sign(ptr,cap),-2);
}
for (const [at,value] of [[0,0],[4,1],[8,63],[12,224],[16,2],[20,1],[24,160],[28,16341],[32,65],[36,64],[40,64],[44,63],[48,1],[52,1],[56,1],[60,1]]) {
  const {bytes,header}=frame();header.setUint32(at,value,true);const before=bytes.slice();
  assert.equal(guest.pulse_crypto_es256_sign(pointer,capacity),-2,`field ${at}`);
  assert.deepEqual(bytes,before,'invalid frames must not write');
}
{
  const {bytes}=frame();const before=bytes.slice();
  assert.equal(guest.pulse_crypto_es256_sign(pointer,capacity),1);
  assert.deepEqual(Buffer.from(bytes.subarray(160,224)),expected);
  assert.deepEqual(bytes.subarray(0,160),before.subarray(0,160));
  assert.deepEqual(bytes.subarray(224),before.subarray(224));
  bytes.fill(0,128,160);bytes.fill(0xff,160,224);
  assert.equal(guest.pulse_crypto_es256_sign(pointer,capacity),-1);
  assert.equal(bytes.subarray(160,224).some(Boolean),false);
}
// Existing verification export still accepts its original 64-byte-key frame.
{
  const {bytes,header}=frame();bytes.fill(0,64);bytes.set(key.subarray(0,64),64);bytes.set(expected,128);bytes.set(input,192);
  header.setUint32(24,192,true);header.setUint32(36,64,true);header.setUint32(40,128,true);
  assert.equal(guest.pulse_crypto_es256_verify(pointer,capacity),1);
  bytes[128]^=1;assert.equal(guest.pulse_crypto_es256_verify(pointer,capacity),0);
}
console.log('ok - RFC6979 ES256 signing, independent verification, strict frames, key consistency and cleanup');
