'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const packageManifest = require('./package.json');

const CRYPTO_GUEST_SOURCE_CONTRACT_VERSION = 'pulse.crypto-guest-source.v2';
const GUEST_UNIT_CONTRIBUTION_VERSION = 'pulse.guest-unit-contribution.v1';
const sourceRelativeFile = 'as/pulse-hmac-as.ts';
const sourceFile = path.join(__dirname, sourceRelativeFile);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function pulseHmacAssemblyScriptSource(algorithm = 'HS256') {
  if (!['HS256', 'SHA-256', 'HMAC-SHA256'].includes(algorithm)) throw new TypeError('Unsupported Crypto guest-source algorithm.');
  const source = fs.readFileSync(sourceFile, 'utf8');
  return Object.freeze({
    version: CRYPTO_GUEST_SOURCE_CONTRACT_VERSION,
    id: 'pulse-hmac-as',
    owner: '@pulse-compute/crypto',
    packageVersion: packageManifest.version,
    realization: 'guest-source:pulse-hmac-as',
    kind: 'guest-source',
    backend: 'pulse-hmac-as',
    backendVersion: 'pulse-hmac-as.v1',
    algorithm,
    language: 'assemblyscript',
    license: 'Apache-2.0',
    origin: 'package-source',
    sourceIncluded: true,
    provenance: Object.freeze([
      'NIST FIPS 180-4',
      'RFC 2104',
      'RFC 4231'
    ]),
    sourceFile: sourceRelativeFile,
    source,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: sha256(source),
    imports: Object.freeze([]),
    exports: Object.freeze([
      'pulse_crypto_hs256_verify',
      'pulse_crypto_sha256_digest',
      'pulse_crypto_bytes_frame_v1',
      'pulse_crypto_digest_init_v2',
      'pulse_crypto_digest_update_v2',
      'pulse_crypto_digest_final_v2',
      'pulse_crypto_digest_clear_v2',
      'pulse_crypto_sha256_bytes_v1',
      'pulse_crypto_hmac_sha256_bytes_v1'
    ]),
    resourceLimits: Object.freeze({
      hmacKeyBytesMinimum: 32,
      hmacKeyBytesMaximum: 4 * 1024,
      macDataBytesMaximum: 1024 * 1024,
      hs256TagBytes: 32,
      byteOperationKeyBytesMaximum: 8192,
      byteOperationDataBytesMaximum: 65536,
      digestDataBytesMaximum: 2097152,
      byteOperationOutputBytes: 32,
      byteOperationFrameBytes: 73760,
      digestFrameBytes: 73760
    }),
    resultCodes: Object.freeze({
      valid: 1,
      invalidAuthenticator: 0,
      invalidKey: -1,
      invalidInput: -2,
      realizationFailure: -3
    }),
    comparison: Object.freeze({
      mode: 'constant-time-full-tag-scan',
      bytes: 32,
      earlyMismatchReturn: false
    }),
    automaticFallback: false
  });
}

function bindNativeDigestMac(moduleExports) {
  const memory = moduleExports && moduleExports.memory;
  const names = ['pulse_crypto_bytes_frame_v1', 'pulse_crypto_digest_init_v2', 'pulse_crypto_digest_update_v2',
    'pulse_crypto_digest_final_v2', 'pulse_crypto_digest_clear_v2', 'pulse_crypto_hmac_sha256_bytes_v1'];
  if (!(memory instanceof WebAssembly.Memory) || names.some(name => typeof moduleExports[name] !== 'function')) {
    throw new TypeError('Native Crypto v2 digest/MAC exports are unavailable.');
  }
  let busy = false, failed = false;
  function run(data, key) {
    if (!(data instanceof Uint8Array) || data.length > (key === undefined ? 2097152 : 65536)
      || (key !== undefined && (!(key instanceof Uint8Array) || key.length > 8192))) {
      throw new TypeError('Native Crypto digest/MAC input exceeds its byte contract.');
    }
    if (busy || failed) throw new TypeError('Native Crypto invocation is unavailable.');
    busy = true;
    let pointer;
    const check = code => { if (code !== 1) throw new TypeError('Native Crypto digest/MAC realization failed.'); };
    try {
      pointer = moduleExports.pulse_crypto_bytes_frame_v1() >>> 0;
      if (pointer + 73760 > memory.buffer.byteLength) throw new TypeError('Native Crypto frame is outside memory.');
      const input = pointer + 8192, output = pointer + 73728;
      new Uint8Array(memory.buffer, pointer, 73760).fill(0);
      if (key === undefined) {
        check(moduleExports.pulse_crypto_digest_init_v2());
        for (let offset = 0; offset < data.length; offset += 65536) {
          const chunk = data.subarray(offset, Math.min(offset + 65536, data.length));
          new Uint8Array(memory.buffer).set(chunk, input);
          check(moduleExports.pulse_crypto_digest_update_v2(chunk.length));
        }
        check(moduleExports.pulse_crypto_digest_final_v2());
      } else {
        new Uint8Array(memory.buffer).set(data, input);
        new Uint8Array(memory.buffer).set(key, pointer);
        check(moduleExports.pulse_crypto_hmac_sha256_bytes_v1(pointer, key.length, input, data.length, output, 32));
      }
      return new Uint8Array(memory.buffer, output, 32).slice();
    } catch (error) { failed = true; throw error; }
    finally {
      try { moduleExports.pulse_crypto_digest_clear_v2(); }
      finally {
        if (pointer !== undefined && pointer + 73760 <= memory.buffer.byteLength) new Uint8Array(memory.buffer, pointer, 73760).fill(0);
        busy = false;
      }
    }
  }
  return Object.freeze({ sha256: data => run(data), hmacSha256: (key, data) => run(data, key) });
}

// A synchronous borrow of the existing bounded byte frame. No per-call
// memory.grow staging and no change to the ordinary/JWT verification limits.
function bindNativeMacTextVerifier(exports) {
  const memory = exports?.memory;
  if (!(memory instanceof WebAssembly.Memory) || typeof exports.pulse_crypto_hs256_verify !== 'function'
    || typeof exports.pulse_crypto_bytes_frame_v1 !== 'function') throw new TypeError('Native MAC exports unavailable.');
  return Object.freeze({ verify({ key, data, tag }) {
    const bytes = key?.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length < 32 || bytes.length > 4096
      || !(data instanceof Uint8Array) || data.length > 65536
      || !(tag instanceof Uint8Array) || tag.length !== 32) throw new TypeError('Invalid bounded MAC bytes.');
    const pointer = exports.pulse_crypto_bytes_frame_v1(), capacity = 8192 + 65536 + 32;
    if (!Number.isInteger(pointer) || pointer < 0 || pointer + capacity > memory.buffer.byteLength) throw new TypeError('Invalid MAC frame.');
    try {
      const frame = new Uint8Array(memory.buffer, pointer, capacity);
      frame.fill(0); frame.set(bytes); frame.set(data, 8192); frame.set(tag, 8192 + 65536);
      const code = exports.pulse_crypto_hs256_verify(pointer, bytes.length, pointer + 8192, data.length, pointer + 8192 + 65536, 32);
      return Object.freeze({ status: code === 1 ? 'valid' : code === 0 ? 'invalid-authenticator' : 'realization-failure' });
    } finally { new Uint8Array(memory.buffer, pointer, capacity).fill(0); }
  } });
}

function pulseEs256GuestUnit() {
  return Object.freeze({
    version: GUEST_UNIT_CONTRIBUTION_VERSION,
    id: 'pulse.crypto.es256.rustcrypto-p256.v1',
    manifest: './guests/es256-rustcrypto/pulse.guest-unit.json',
    owner: packageManifest.name,
    packageVersion: packageManifest.version,
    origin: 'package-prebuilt'
  });
}


function bindNativeEs256Signer(moduleExports) {
  const memory = moduleExports && moduleExports.memory;
  const sign = moduleExports && moduleExports.pulse_crypto_es256_sign;
  if (!(memory instanceof WebAssembly.Memory) || memory.buffer.byteLength !== 2097152 || typeof sign !== 'function') {
    throw new TypeError('Native ES256 signing exports are unavailable.');
  }
  return (key, data) => {
    if (!(key instanceof Uint8Array) || key.length !== 96 || !(data instanceof Uint8Array) || data.length > 16340) {
      throw new TypeError('Invalid ES256 signing byte request.');
    }
    const pointer = 524288, capacity = 16640;
    const frame = new Uint8Array(memory.buffer, pointer, capacity);
    frame.fill(0);
    try {
      const header = new DataView(memory.buffer, pointer, 64);
      for (const [offset, value] of [[0, 0x32534550], [4, 2], [8, 64], [12, (224 + data.length + 15) & ~15],
        [16, 1], [24, 224], [28, data.length], [32, 64], [36, 96], [40, 160], [44, 64]]) header.setUint32(offset, value, true);
      frame.set(key, 64); frame.set(data, 224);
      const status = sign(pointer, capacity);
      if (status === -1) throw Object.assign(new TypeError('Invalid P-256 signing key.'), { code: 'PULSE_CRYPTO_KEY_INVALID' });
      if (status !== 1) throw new TypeError('Native ES256 signing failed.');
      return frame.slice(160, 224);
    } finally {
      frame.fill(0);
      // The synchronous guest has returned: clear its borrowed stack as well.
      new Uint8Array(memory.buffer, 0, 65536).fill(0);
    }
  };
}

function bindNativeRs256(moduleExports) {
  const memory = moduleExports && moduleExports.memory;
  if (!(memory instanceof WebAssembly.Memory) || memory.buffer.byteLength !== 2097152
    || typeof moduleExports.pulse_crypto_rs256_sign !== 'function' || typeof moduleExports.pulse_crypto_rs256_verify !== 'function') {
    throw new TypeError('Native RS256 exports are unavailable.');
  }
  const invalidKey = () => Object.assign(new TypeError('Invalid RSA signing key.'), { code: 'PULSE_CRYPTO_KEY_INVALID' });
  function run(key, data, signature) {
    const signing = signature === undefined;
    if (!(key instanceof Uint8Array) || key.length < 8) throw invalidKey();
    const k = new DataView(key.buffer, key.byteOffset, 4).getUint32(0, true);
    if (![256, 384, 512].includes(k) || key.length !== (signing ? 8 + k * 9 / 2 : 8 + k)) throw invalidKey();
    if (!(data instanceof Uint8Array) || data.length > 12288
      || !signing && (!(signature instanceof Uint8Array) || signature.length !== k)) throw new TypeError('Invalid RS256 byte request.');
    const pointer = 524288, capacity = 16640, output = (64 + key.length + 15) & ~15, input = output + k;
    const frame = new Uint8Array(memory.buffer, pointer, capacity);
    frame.fill(0);
    try {
      const header = new DataView(memory.buffer, pointer, 64);
      for (const [offset, value] of [[0, 0x32534550], [4, 2], [8, 64], [12, (input + data.length + 15) & ~15],
        [16, 2], [24, input], [28, data.length], [32, 64], [36, key.length], [40, output], [44, k]]) header.setUint32(offset, value, true);
      frame.set(key, 64); frame.set(data, input);
      if (!signing) frame.set(signature, output);
      const status = moduleExports[signing ? 'pulse_crypto_rs256_sign' : 'pulse_crypto_rs256_verify'](pointer, capacity);
      if (!signing) return Object.freeze({ status: ({ 1: 'valid', 0: 'invalid-authenticator', '-1': 'invalid-key', '-2': 'invalid-input' })[status] || 'realization-failure' });
      if (status === -1) throw invalidKey();
      if (status !== 1) throw new TypeError('Native RS256 signing failed.');
      return frame.slice(output, output + k);
    } finally { frame.fill(0); new Uint8Array(memory.buffer, 0, 65536).fill(0); }
  }
  return Object.freeze({ sign: (key, data) => run(key, data), verify: (key, data, signature) => run(key, data, signature) });
}

module.exports = Object.freeze({
  bindNativeMacTextVerifier,
  bindNativeEs256Signer,
  bindNativeRs256,
  CRYPTO_GUEST_SOURCE_CONTRACT_VERSION,
  GUEST_UNIT_CONTRIBUTION_VERSION,
  pulseHmacAssemblyScriptSource,
  bindNativeDigestMac,
  pulseEs256GuestUnit
});
