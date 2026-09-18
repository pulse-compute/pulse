'use strict';

const {
  normalizeJwtSignEffect,
  normalizeJwtVerifyEffect
} = require('@pulse-compute/wasm-contracts/jwt/contracts');
const {
  CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION,
  CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION
} = require('@pulse-compute/wasm-contracts/crypto/contracts');

const NODE_JAVASCRIPT_JWT_VERIFIER_VERSION = 'pulse.node-javascript-jwt-verifier.v2';
const NODE_JAVASCRIPT_JWT_REALIZATIONS = Object.freeze({
  HS256: Object.freeze({
    algorithm: 'HS256',
    realization: 'runtime-builtin',
    implementation: CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION,
    automaticFallback: false
  }),
  ES256: Object.freeze({
    algorithm: 'ES256',
    realization: 'runtime-builtin',
    implementation: CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION,
    automaticFallback: false
  })
});
const NODE_JAVASCRIPT_JWT_REALIZATION =
  NODE_JAVASCRIPT_JWT_REALIZATIONS.HS256;

let runtimeModules;

function loadRuntimeModules() {
  if (!runtimeModules) {
    runtimeModules = Promise.all([
      import('@pulse-compute/jwt/provider'),
      import('@pulse-compute/crypto')
    ]).then(([jwtProvider, cryptoProvider]) => Object.freeze({
      jwtProvider,
      cryptoProvider
    }));
  }
  return runtimeModules;
}

function nodeWallClock() {
  return Object.freeze({
    unixEpochSeconds: Date.now() / 1000,
    trusted: true
  });
}

function assertRequestActive(execution, jwtProvider) {
  if (execution && execution.signal && execution.signal.aborted) {
    throw jwtProvider.jwtError('PULSE_JWT_OPERATION_FAILED', {
      category: 'request-cancelled',
      automaticFallback: false
    });
  }
}

function assertRuntimeBuiltin(cryptoProvider, jwtProvider) {
  if (
    !cryptoProvider
    || cryptoProvider.CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION !== CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION
    || !cryptoProvider.crypto
    || !cryptoProvider.crypto.mac
    || typeof cryptoProvider.crypto.mac.verify !== 'function'
    || !cryptoProvider.crypto.signature
    || typeof cryptoProvider.crypto.signature.verify !== 'function'
  ) {
    throw jwtProvider.jwtError('PULSE_JWT_TARGET_UNSUPPORTED', {
      category: 'crypto-realization',
      realization: NODE_JAVASCRIPT_JWT_REALIZATION.realization,
      implementation: NODE_JAVASCRIPT_JWT_REALIZATION.implementation,
      automaticFallback: false
    });
  }
  return cryptoProvider.crypto;
}

function createNodeJavascriptJwtVerify(options = {}) {
  const captureWallClock = options.captureWallClock || nodeWallClock;
  const secretLookup = options.secretLookup;
  return async function verifyNodeJavascriptJwt(effect, execution) {
    const { jwtProvider, cryptoProvider } = await loadRuntimeModules();
    assertRequestActive(execution, jwtProvider);
    const signing = effect.operation === 'sign';
    const input = signing ? normalizeJwtSignEffect(effect) : normalizeJwtVerifyEffect(effect);
    if (!signing && execution && typeof execution.registerRedactionValue === 'function') {
      execution.registerRedactionValue(input.token);
    }
    assertRequestActive(execution, jwtProvider);
    const selectedCrypto = signing
      ? require('@pulse-compute/crypto/provider').bindJavascriptDigestMac(['HMAC-SHA256'])
      : assertRuntimeBuiltin(cryptoProvider, jwtProvider);
    const host = {
      async captureWallClock() {
        assertRequestActive(execution, jwtProvider);
        const captured = await captureWallClock();
        assertRequestActive(execution, jwtProvider);
        return captured;
      },
      resolveSecret: typeof secretLookup === 'function'
        ? async (binding) => {
            assertRequestActive(execution, jwtProvider);
            const secret = await secretLookup(binding, execution);
            assertRequestActive(execution, jwtProvider);
            return secret;
          }
        : undefined,
      registerSensitiveValue(value) {
        if (execution && typeof execution.registerRedactionValue === 'function') {
          execution.registerRedactionValue(value);
        }
      }
    };
    if (execution && typeof execution.validateSchemaValue === 'function') {
      host.validateClaims = async (schemaId, claims, context) => {
        assertRequestActive(execution, jwtProvider);
        const result = await execution.validateSchemaValue(schemaId, claims, context);
        assertRequestActive(execution, jwtProvider);
        return result;
      };
    }
    const result = await (signing ? jwtProvider.signJwtWithCrypto : jwtProvider.verifyJwtWithCrypto)(
      input,
      Object.freeze(host),
      selectedCrypto
    );
    assertRequestActive(execution, jwtProvider);
    return result;
  };
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_JWT_VERIFIER_VERSION,
  NODE_JAVASCRIPT_JWT_REALIZATION,
  NODE_JAVASCRIPT_JWT_REALIZATIONS,
  createNodeJavascriptJwtVerify,
  nodeWallClock
});
