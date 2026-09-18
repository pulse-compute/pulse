'use strict';

const {
  CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
  CRYPTO_ES256_GUEST_LINKED_REALIZATION,
  CRYPTO_GUEST_SOURCE_IMPLEMENTATION
} = require('@pulse-compute/wasm-contracts/crypto/contracts');

const NODE_NATIVE_JWT_VERIFIER_VERSION = 'pulse.node-native-jwt-verifier.v1';
const NODE_NATIVE_JWT_REALIZATIONS = Object.freeze({
  'HMAC-SHA256': Object.freeze({ algorithm: 'HMAC-SHA256', realization: 'guest-source:pulse-hmac-as',
    implementation: CRYPTO_GUEST_SOURCE_IMPLEMENTATION, guestUnitRequired: false }),
  HS256: Object.freeze({
    algorithm: 'HS256',
    realization: 'guest-source:pulse-hmac-as',
    implementation: CRYPTO_GUEST_SOURCE_IMPLEMENTATION,
    guestUnitRequired: false
  }),
  ES256: Object.freeze({
    algorithm: 'ES256',
    realization: CRYPTO_ES256_GUEST_LINKED_REALIZATION,
    implementation: CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
    guestUnitRequired: true
  })
});
const NODE_NATIVE_JWT_REALIZATION = Object.freeze({
  ...NODE_NATIVE_JWT_REALIZATIONS.HS256,
  semanticOwner: '@pulse-compute/crypto',
  automaticFallback: false
});

let providerModule;

function dataRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  let prototype;
  try { prototype = Object.getPrototypeOf(value); }
  catch { return undefined; }
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const output = new Map();
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !descriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) return undefined;
      output.set(key, descriptor.value);
    }
  } catch {
    return undefined;
  }
  return output;
}

async function loadJwtProvider() {
  if (!providerModule) providerModule = import('@pulse-compute/jwt/provider');
  return providerModule;
}

function requestActive(executionOptions, jwtProvider) {
  const execution = dataRecord(executionOptions);
  const signal = execution && execution.get('signal');
  if (signal && signal.aborted) {
    throw jwtProvider.jwtError('PULSE_JWT_OPERATION_FAILED', {
      category: 'request-cancelled',
      automaticFallback: false
    });
  }
}

function requireCryptoVerifier(executionOptions, jwtProvider, algorithm) {
  const execution = dataRecord(executionOptions);
  const realization = dataRecord(execution && execution.get('cryptoRealization'));
  const verifier = execution && execution.get('cryptoVerifier');
  const expected = NODE_NATIVE_JWT_REALIZATIONS[algorithm];
  const algorithms = realization && realization.get('algorithms');
  const selected = Array.isArray(algorithms)
    ? algorithms.map(dataRecord).find((entry) => (
        entry
        && expected
        && entry.get('algorithm') === expected.algorithm
        && entry.get('realization') === expected.realization
        && entry.get('implementation') === expected.implementation
        && entry.get('guestUnitRequired') === expected.guestUnitRequired
        && entry.get('available') === true
      ))
    : undefined;
  if (
    !expected
    || !realization
    || realization.get('semanticOwner') !== '@pulse-compute/crypto'
    || realization.get('automaticFallback') !== false
    || !selected
    || !dataRecord(verifier)
  ) {
    throw jwtProvider.jwtError('PULSE_JWT_TARGET_UNSUPPORTED', {
      category: 'crypto-realization',
      realization: expected && expected.realization,
      implementation: expected && expected.implementation,
      automaticFallback: false
    });
  }
  return verifier;
}

function keyArtifact(executionOptions, artifactId, jwtProvider) {
  const execution = dataRecord(executionOptions);
  const artifacts = execution && execution.get('packageArtifacts');
  const matches = Array.isArray(artifacts)
    ? artifacts.filter((artifact) => {
        const record = dataRecord(artifact);
        return record && record.get('id') === artifactId;
      })
    : [];
  if (matches.length !== 1) {
    throw jwtProvider.jwtError('PULSE_JWT_KEY_INVALID', {
      category: 'key-artifact',
    });
  }
  const artifact = dataRecord(matches[0]);
  const data = artifact && dataRecord(artifact.get('data'));
  if (
    !artifact
    || artifact.get('version') !== 'pulse.jwt-es256-key-artifact.v1'
    || artifact.get('contractId') !== 'pulse.jwt'
    || artifact.get('package') !== '@pulse-compute/jwt'
    || artifact.get('kind') !== 'jwt-es256-static-public-key'
    || !data
  ) {
    throw jwtProvider.jwtError('PULSE_JWT_KEY_INVALID', {
      category: 'key-artifact',
    });
  }
  return Object.freeze(Object.fromEntries(data));
}

function effectInput(effect, executionOptions, jwtProvider) {
  const record = dataRecord(effect);
  const payload = dataRecord(record && record.get('payload'));
  const resource = dataRecord(record && record.get('resource'));
  if (
    !record
    || record.get('kind') !== 'jwt.verify'
    || record.get('contractId') !== 'pulse.jwt'
    || record.get('operation') !== 'verify'
    || !payload
    || !resource
  ) {
    throw jwtProvider.jwtError('PULSE_JWT_OPERATION_FAILED', {
      category: 'verifier-input'
    });
  }
  const authorization = payload.get('token');
  if (authorization !== undefined && typeof authorization !== 'string') {
    throw jwtProvider.jwtError('PULSE_JWT_BEARER_INVALID', {
      category: 'authorization'
    });
  }
  const keyType = resource.get('keyType');
  const binding = resource.get('secretBinding');
  const artifactId = resource.get('keyArtifactId');
  let key;
  if (keyType === 'secret') {
    if (
      artifactId !== null
      || typeof binding !== 'string'
      || binding.length === 0
    ) throw jwtProvider.jwtError('PULSE_JWT_KEY_INVALID', {
      category: 'secret-binding'
    });
    key = Object.freeze({ type: 'secret', binding });
  } else if (keyType === 'jwk' || keyType === 'jwks') {
    if (binding !== null || typeof artifactId !== 'string' || artifactId.length === 0) {
      throw jwtProvider.jwtError('PULSE_JWT_KEY_INVALID', {
        category: 'key-artifact'
      });
    }
    key = keyArtifact(executionOptions, artifactId, jwtProvider);
    if (key.type !== keyType) throw jwtProvider.jwtError('PULSE_JWT_KEY_INVALID', {
      category: 'key-artifact'
    });
  } else {
    throw jwtProvider.jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
  }
  const policy = Object.fromEntries(
    [...payload.entries()].filter(([name]) => name !== 'token')
  );
  return Object.freeze({
    token: jwtProvider.bearerFromAuthorizationValue(authorization),
    options: Object.freeze({
      ...policy,
      key
    })
  });
}

function createNodeNativeJwtVerify(baseOptions = {}) {
  const secretLookup = baseOptions.secretLookup;
  const captureWallClock = baseOptions.captureWallClock
    || (() => Object.freeze({
      unixEpochSeconds: Date.now() / 1000,
      trusted: true
    }));
  return async function verifyNodeNativeJwt(effect, executionOptions = {}) {
    const jwtProvider = await loadJwtProvider();
    requestActive(executionOptions, jwtProvider);
    const signing = effect.kind === 'jwt.sign';
    let input;
    if (signing) {
      const resource = dataRecord(effect.resource), payload = dataRecord(effect.payload);
      if (effect.contractId !== 'pulse.jwt' || effect.package !== '@pulse-compute/jwt'
        || effect.operation !== 'sign' || effect.capability !== 'jwt.sign'
        || !resource || resource.size !== 3 || resource.get('keyType') !== 'secret'
        || resource.get('keyArtifactId') !== null || !payload || ![3, 4].includes(payload.size) || [...payload.keys()].some(name => !['claims', 'algorithm', 'expiresInSeconds', 'kid'].includes(name))) {
        throw jwtProvider.jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'sign-input' });
      }
      input = { claims: payload.get('claims'), options: { algorithm: payload.get('algorithm'),
        expiresInSeconds: payload.get('expiresInSeconds'), key: { type: 'secret', binding: resource.get('secretBinding') }, ...(payload.has('kid') ? { kid: payload.get('kid') } : {}) } };
    } else input = effectInput(effect, executionOptions, jwtProvider);
    const selectedCrypto = requireCryptoVerifier(
      executionOptions,
      jwtProvider,
      signing ? (input.options.algorithm === 'ES256' ? 'ES256' : 'HMAC-SHA256') : input.options.algorithms[0]
    );
    const execution = dataRecord(executionOptions);
    const executionClock = execution && execution.get('captureJwtWallClock');
    const host = {
      async captureWallClock() {
        requestActive(executionOptions, jwtProvider);
        const captured = await (
          typeof executionClock === 'function'
            ? executionClock()
            : captureWallClock()
        );
        requestActive(executionOptions, jwtProvider);
        return captured;
      },
      resolveSecret: typeof secretLookup === 'function'
        ? async (binding) => {
            requestActive(executionOptions, jwtProvider);
            const secret = await secretLookup(binding, executionOptions);
            requestActive(executionOptions, jwtProvider);
            return secret;
          }
        : undefined,
      registerSensitiveValue(value) {
        const register = execution && execution.get('registerRedactionValue');
        if (typeof register === 'function') register(value);
      }
    };
    const validateSchemaValue = execution && execution.get('validateSchemaValue');
    if (typeof validateSchemaValue === 'function') {
      host.validateClaims = async (schemaId, claims, context) => {
        requestActive(executionOptions, jwtProvider);
        const result = await validateSchemaValue(schemaId, claims, context);
        requestActive(executionOptions, jwtProvider);
        return result;
      };
    }
    const result = await (signing ? jwtProvider.signJwtWithCrypto : jwtProvider.verifyJwtWithCrypto)(
      input,
      Object.freeze(host),
      selectedCrypto
    );
    requestActive(executionOptions, jwtProvider);
    return result;
  };
}

module.exports = Object.freeze({
  NODE_NATIVE_JWT_VERIFIER_VERSION,
  NODE_NATIVE_JWT_REALIZATION,
  NODE_NATIVE_JWT_REALIZATIONS,
  createNodeNativeJwtVerify
});
