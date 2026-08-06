'use strict';
const { defineFinalWasmPolicy, FINAL_WASM_POLICY_VERSION } = require('@pulse-compute/wasm-contracts/provider/final-wasm-policy');
const { defineCryptoTargetCapabilities } = require('@pulse-compute/wasm-contracts/crypto/contracts');
const nativeRuntime = require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime');
const packageManifest = require('../../package.json');
const { NODE_NATIVE_TARGET_CAPABILITIES } = require('../capabilities.js');

const nodeFinalWasmPolicy = defineFinalWasmPolicy({
  version: FINAL_WASM_POLICY_VERSION,
  descriptorOwner: packageManifest.name,
  toolchainVersion: 'pulse.provider-toolchain.v1',
  descriptorIdentity: 'node-native-host',
  permittedImports: [
    ...nativeRuntime.CANONICAL_NATIVE_IMPORT_NAMES.map((name) => ({ module: 'pulse_host', name, kind: 'function' })),
    ...nativeRuntime.CANONICAL_NATIVE_ALLOWED_ENV_IMPORTS.map((name) => ({ module: 'env', name, kind: 'function' }))
  ],
  requiredExports: nativeRuntime.CANONICAL_NATIVE_EXPORTS.map(([name, second]) => ({
    name,
    kind: second === 'memory' ? 'memory' : 'function'
  }))
});

const NODE_NATIVE_TARGET_DESCRIPTOR = Object.freeze({
  version: 'pulse.provider-target-descriptor.v1',
  id: 'node-native-host',
  provider: 'node',
  mode: 'native',
  runtimeClass: 'native',
  status: 'supported',
  capabilities: NODE_NATIVE_TARGET_CAPABILITIES,
  keyTypes: Object.freeze(['secret', 'jwk', 'jwks']),
  realizations: Object.freeze([
    Object.freeze({
      kind: 'crypto-composed',
      realization: 'guest-source:pulse-hmac-as',
      implementation: 'pulse-hmac-as.v1',
      algorithms: Object.freeze(['HS256']),
      keyTypes: Object.freeze(['secret']),
      implemented: true,
      status: 'implemented-d3',
      semanticOwner: '@pulse-compute/crypto',
      guestUnitRequired: false,
      portable: true,
      automaticFallback: false
    }),
    Object.freeze({
      kind: 'crypto-composed',
      realization: 'guest-linked:pulse-es256-rustcrypto-p256',
      implementation: 'rustcrypto.p256-0.13.2.ecdsa-0.16.9.sha2-0.10.9.v1',
      algorithms: Object.freeze(['ES256']),
      keyTypes: Object.freeze(['jwk', 'jwks']),
      implemented: true,
      status: 'implemented-g3',
      semanticOwner: '@pulse-compute/crypto',
      guestUnitRequired: true,
      portable: true,
      automaticFallback: false
    })
  ]),
  automaticFallback: false,
  crypto: defineCryptoTargetCapabilities({
    target: 'native',
    algorithms: [{
      algorithm: 'HS256',
      realization: 'guest-source:pulse-hmac-as',
      implemented: true,
      status: 'implemented-c3'
    }, {
      algorithm: 'ES256',
      realization: 'guest-linked:pulse-es256-rustcrypto-p256',
      implemented: true,
      status: 'implemented-g3'
    }]
  }),
  finalWasmPolicy: nodeFinalWasmPolicy
});

module.exports = Object.freeze({ NODE_NATIVE_TARGET_DESCRIPTOR });
