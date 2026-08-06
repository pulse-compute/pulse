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

function pulseHmacAssemblyScriptSource() {
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
    algorithm: 'HS256',
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
      'pulse_crypto_sha256_digest'
    ]),
    resourceLimits: Object.freeze({
      hmacKeyBytesMinimum: 32,
      hmacKeyBytesMaximum: 4 * 1024,
      macDataBytesMaximum: 1024 * 1024,
      hs256TagBytes: 32
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

module.exports = Object.freeze({
  CRYPTO_GUEST_SOURCE_CONTRACT_VERSION,
  GUEST_UNIT_CONTRIBUTION_VERSION,
  pulseHmacAssemblyScriptSource,
  pulseEs256GuestUnit
});
