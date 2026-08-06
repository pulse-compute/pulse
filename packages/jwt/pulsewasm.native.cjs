'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const packageManifest = require('./package.json');

const JWT_NATIVE_SOURCE_CONTRACT_VERSION = 'pulse.jwt-native-source.v1';
const sourceRelativeFile = 'as/index.as.ts';
const sourceFile = path.join(__dirname, sourceRelativeFile);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function pulseJwtAssemblyScriptSource() {
  const source = fs.readFileSync(sourceFile, 'utf8');
  return Object.freeze({
    version: JWT_NATIVE_SOURCE_CONTRACT_VERSION,
    id: 'pulse-jwt-as',
    owner: '@pulse-compute/jwt',
    packageVersion: packageManifest.version,
    kind: 'package-source',
    language: 'assemblyscript',
    license: 'Apache-2.0',
    origin: 'package-source',
    sourceIncluded: true,
    sourceFile: sourceRelativeFile,
    source,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: sha256(source),
    imports: Object.freeze([]),
    exports: Object.freeze([
      'pulse_jwt_verify',
      'pulse_jwt_fastly_verify'
    ]),
    semanticOwnership: Object.freeze([
      'compact-jws-parsing',
      'protected-header-policy',
      'exact-signing-input',
      'registered-claims',
      'result-shaping'
    ]),
    providerAuthorities: Object.freeze([
      'request',
      'secret',
      'wall-clock',
      'schema',
      'redaction',
      'error-transport'
    ]),
    cryptoRealization: 'guest-source:pulse-hmac-as',
    automaticFallback: false
  });
}

module.exports = Object.freeze({
  JWT_NATIVE_SOURCE_CONTRACT_VERSION,
  pulseJwtAssemblyScriptSource
});
