'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const packageManifest = require('./package.json');

const CRYPTO_GUEST_SOURCE_CONTRACT_VERSION = 'pulse.crypto-guest-source.v1';
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
      'pulse_crypto_digest_frame_v1',
      'pulse_crypto_sha256_bytes_v1',
      'pulse_crypto_hmac_sha256_bytes_v1'
    ]),
    resourceLimits: Object.freeze({
      hmacKeyBytesMinimum: 32,
      hmacKeyBytesMaximum: 4 * 1024,
      macDataBytesMaximum: 1024 * 1024,
      hs256TagBytes: 32,
      byteOperationKeyBytesMaximum: 8192,
      byteOperationDataBytesMaximum: 32768,
      digestDataBytesMaximum: 2097152,
      byteOperationOutputBytes: 32,
      byteOperationFrameBytes: 40992,
      digestFrameBytes: 2097184
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
  const names = ['pulse_crypto_bytes_frame_v1', 'pulse_crypto_digest_frame_v1', 'pulse_crypto_sha256_bytes_v1', 'pulse_crypto_hmac_sha256_bytes_v1'];
  if (!(memory instanceof WebAssembly.Memory) || names.some((name) => typeof moduleExports[name] !== 'function')) {
    throw new TypeError('Native Crypto digest/MAC exports are unavailable.');
  }
  function run(data, key) {
    if (!(data instanceof Uint8Array) || data.length > (key === undefined ? 2097152 : 32768)
      || (key !== undefined && (!(key instanceof Uint8Array) || key.length > 8192))) {
      throw new TypeError('Native Crypto digest/MAC input exceeds its byte contract.');
    }
    const largeDigest = key === undefined && data.length > 32768;
    const dataBytes = largeDigest ? 2097152 : 32768;
    const keyBytes = largeDigest ? 0 : 8192;
    const frameBytes = keyBytes + dataBytes + 32;
    const pointer = (largeDigest ? moduleExports.pulse_crypto_digest_frame_v1() : moduleExports.pulse_crypto_bytes_frame_v1()) >>> 0;
    if (pointer + frameBytes > memory.buffer.byteLength) throw new TypeError('Native Crypto frame is outside memory.');
    const dataPointer = pointer + keyBytes;
    const outputPointer = dataPointer + dataBytes;
    try {
      const view = new Uint8Array(memory.buffer);
      view.set(data, dataPointer);
      if (key !== undefined) view.set(key, pointer);
      const code = key === undefined
        ? moduleExports.pulse_crypto_sha256_bytes_v1(dataPointer, data.length, outputPointer, 32)
        : moduleExports.pulse_crypto_hmac_sha256_bytes_v1(pointer, key.length, dataPointer, data.length, outputPointer, 32);
      if (code !== 1) throw new TypeError('Native Crypto digest/MAC realization failed.');
      return new Uint8Array(memory.buffer, outputPointer, 32).slice();
    } finally {
      // The Wasm allocator can grow memory while hashing: acquire a fresh view.
      new Uint8Array(memory.buffer, pointer, frameBytes).fill(0);
    }
  }
  return Object.freeze({ sha256: (data) => run(data), hmacSha256: (key, data) => run(data, key) });
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

module.exports = Object.freeze({
  bindNativeEs256Signer,
  CRYPTO_GUEST_SOURCE_CONTRACT_VERSION,
  GUEST_UNIT_CONTRIBUTION_VERSION,
  pulseHmacAssemblyScriptSource,
  bindNativeDigestMac,
  pulseEs256GuestUnit
});
