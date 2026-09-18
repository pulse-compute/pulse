'use strict';

const {
  CRYPTO_SEMANTIC_OWNER
} = require('../crypto/contracts.js');
const {
  PACKAGE_CRYPTO_REQUIREMENT_VERSION
} = require('../package/package-contract.js');

const JWT_CONTRACT_VERSION = 'pulse.jwt-contract.v1';
const JWT_CANONICAL_EFFECT_VERSION = 'pulse.canonical-package-effect.v1';
const JWT_LOWERING_PLAN_VERSION = 'pulse.jwt-lowering-plan.v1';
const JWT_LOWERING_PLAN_ARTIFACT = 'jwt-lowering-plan.json';
const JWT_SIDECAR_ABI_VERSION = 'pulse.jwt-sidecar-abi.v1';
const JWT_CRYPTO_COMPOSITION_VERSION = 'pulse.jwt-crypto-composition.v1';
const JWT_CONTRACT_ID = 'pulse.jwt';
const JWT_PACKAGE_NAME = '@pulse-compute/jwt';

const JWT_ALGORITHMS = Object.freeze(['HS256', 'RS256', 'ES256', 'EdDSA']);
const JWT_IMPLEMENTED_ALGORITHMS = Object.freeze(['HS256', 'ES256']);
const JWT_KEY_TYPES = Object.freeze(['secret', 'jwk', 'jwks']);
const JWT_IMPLEMENTED_KEY_TYPES = Object.freeze(['secret', 'jwk', 'jwks']);
const JWT_NATIVE_REALIZATION_KINDS = Object.freeze(['crypto-composed']);
const JWT_ALGORITHM_CAPABILITIES = Object.freeze({
  HS256: 'jwt.verify.hs256',
  RS256: 'jwt.verify.rs256',
  ES256: 'jwt.verify.es256',
  EdDSA: 'jwt.verify.eddsa'
});
const JWT_PACKAGE_INTRINSICS = Object.freeze({
  bearer: Object.freeze({
    name: 'jwt.bearer-request-header',
    nativeIntrinsic: 'request.header',
    compilerName: '__pulse_jwt_bearer_request_header',
    valueKind: 'string-or-undefined',
    argumentIndexes: Object.freeze([]),
    staticArguments: Object.freeze(['authorization'])
  })
});
const JWT_DIAGNOSTIC_CODES = Object.freeze({
  ARGUMENT_SHAPE_UNSUPPORTED: 'PULSE_JWT_ARGUMENT_SHAPE_UNSUPPORTED',
  CONTEXT_UNSUPPORTED: 'PULSE_JWT_CONTEXT_UNSUPPORTED',
  TOKEN_SOURCE_UNSUPPORTED: 'PULSE_JWT_TOKEN_SOURCE_UNSUPPORTED',
  BEARER_REQUEST_UNSUPPORTED: 'PULSE_JWT_BEARER_REQUEST_UNSUPPORTED',
  BEARER_PLACEMENT_UNSUPPORTED: 'PULSE_JWT_BEARER_PLACEMENT_UNSUPPORTED',
  PLACEMENT_UNSUPPORTED: 'PULSE_JWT_PLACEMENT_UNSUPPORTED',
  RESULT_ACCESS_UNSUPPORTED: 'PULSE_JWT_RESULT_ACCESS_UNSUPPORTED',
  OPTIONS_LITERAL_REQUIRED: 'PULSE_JWT_OPTIONS_LITERAL_REQUIRED',
  OPTIONS_PROPERTY_UNSUPPORTED: 'PULSE_JWT_OPTIONS_PROPERTY_UNSUPPORTED',
  ALGORITHMS_LITERAL_REQUIRED: 'PULSE_JWT_ALGORITHMS_LITERAL_REQUIRED',
  ALGORITHMS_EMPTY: 'PULSE_JWT_ALGORITHMS_EMPTY',
  ALGORITHM_UNSUPPORTED: 'PULSE_JWT_ALGORITHM_UNSUPPORTED',
  KEY_LITERAL_REQUIRED: 'PULSE_JWT_KEY_LITERAL_REQUIRED',
  KEY_TYPE_UNSUPPORTED: 'PULSE_JWT_KEY_TYPE_UNSUPPORTED',
  KEY_ALGORITHM_MISMATCH: 'PULSE_JWT_KEY_ALGORITHM_MISMATCH',
  JWK_INVALID: 'PULSE_JWT_JWK_INVALID',
  PRIVATE_JWK_UNSUPPORTED: 'PULSE_JWT_PRIVATE_JWK_UNSUPPORTED',
  JWKS_LIMIT_EXCEEDED: 'PULSE_JWT_JWKS_LIMIT_EXCEEDED',
  JWKS_AMBIGUOUS: 'PULSE_JWT_JWKS_AMBIGUOUS',
  POLICY_LITERAL_REQUIRED: 'PULSE_JWT_POLICY_LITERAL_REQUIRED',
  POLICY_LIMIT_EXCEEDED: 'PULSE_JWT_POLICY_LIMIT_EXCEEDED',
  SCHEMA_LITERAL_REQUIRED: 'PULSE_JWT_SCHEMA_LITERAL_REQUIRED',
  SCHEMA_UNKNOWN: 'PULSE_JWT_SCHEMA_UNKNOWN',
  SCHEMA_UNREALIZED: 'PULSE_JWT_SCHEMA_UNREALIZED',
  TARGET_ALGORITHM_UNSUPPORTED: 'PULSE_JWT_TARGET_ALGORITHM_UNSUPPORTED',
  TARGET_KEY_UNSUPPORTED: 'PULSE_JWT_TARGET_KEY_UNSUPPORTED',
  TARGET_CLOCK_UNAVAILABLE: 'PULSE_JWT_TARGET_CLOCK_UNAVAILABLE',
  REALIZATION_UNSUPPORTED: 'PULSE_JWT_REALIZATION_UNSUPPORTED',
  REALIZATION_AMBIGUOUS: 'PULSE_JWT_REALIZATION_AMBIGUOUS',
  FACADE_USE_UNSUPPORTED: 'PULSE_JWT_FACADE_USE_UNSUPPORTED'
});
const JWT_RESOURCE_LIMITS = Object.freeze({
  tokenBytes: 16 * 1024,
  protectedHeaderBytes: 4 * 1024,
  claimsBytes: 16 * 1024,
  jwksEntries: 16,
  requiredClaimNames: 32,
  algorithms: 4,
  clockToleranceSeconds: 300,
  jsonDepth: 32
});

const JWT_ES256_KEY_NORMALIZATION_CONTRACT = Object.freeze({
  version: 'pulse.jwt.es256-key-normalization.v1',
  status: 'executable-g3',
  algorithm: 'ES256',
  inlineJwk: Object.freeze({
    requiredMembers: Object.freeze(['kty', 'crv', 'x', 'y']),
    optionalMembers: Object.freeze(['alg', 'use', 'key_ops', 'kid']),
    exactValues: Object.freeze({
      kty: 'EC',
      crv: 'P-256',
      alg: 'absent-or-ES256',
      use: 'absent-or-sig',
      key_ops: 'absent-or-exactly-verify'
    }),
    coordinateEncoding: 'canonical-unpadded-base64url',
    coordinateBytes: 32,
    privateMembersRejected: true,
    unknownMembersRejected: true,
    certificateMembersRejected: true
  }),
  jwks: Object.freeze({
    kind: 'bounded-static-inline',
    entriesMaximum: JWT_RESOURCE_LIMITS.jwksEntries,
    remoteDiscovery: false,
    fetch: false,
    cache: false,
    refresh: false,
    duplicateKid: 'reject-entire-set',
    selection: 'kid-exact-or-single-eligible-key',
    selectedKeyFailure: 'terminal-no-retry'
  }),
  cryptoAdapter: Object.freeze({
    publicKeyType: 'p256-public-key-bytes',
    publicKeyEncoding: 'x-y-big-endian',
    publicKeyBytes: 64,
    signatureEncoding: 'jose-r-s-big-endian',
    signatureBytes: 64,
    derAccepted: false,
    highS: 'accepted-if-otherwise-valid'
  }),
  exactSigningInput: true,
  claimsBeforeAuthenticity: false,
  automaticFallback: false
});

const JWT_VERIFY_OPERATION = Object.freeze({
  version: JWT_CANONICAL_EFFECT_VERSION,
  contractId: JWT_CONTRACT_ID,
  package: JWT_PACKAGE_NAME,
  import: JWT_PACKAGE_NAME,
  kind: 'jwt.verify',
  providerKind: 'jwt',
  operation: 'verify',
  capability: 'jwt.verify',
  result: 'jwt-verification',
  placement: 'variable',
  clock: 'provider-wall-clock'
});

const JWT_SIGN_OPERATION = Object.freeze({
  version: JWT_CANONICAL_EFFECT_VERSION, contractId: JWT_CONTRACT_ID,
  package: JWT_PACKAGE_NAME, import: JWT_PACKAGE_NAME,
  kind: 'jwt.sign', providerKind: 'jwt', operation: 'sign', capability: 'jwt.sign',
  result: 'string', placement: 'variable', clock: 'provider-wall-clock'
});
const JWT_SIGN_CONTRACT = Object.freeze({
  version: 'pulse.jwt-sign.v1', algorithm: 'HS256', keyType: 'secret',
  header: Object.freeze({ alg: 'HS256', typ: 'JWT' }),
  claimsBytes: 8192, claimsEntries: 1024, claimsDepth: 32,
  keyBytesMinimum: 32, keyBytesMaximum: 4096,
  expiresInSecondsMinimum: 1, expiresInSecondsMaximum: Number.MAX_SAFE_INTEGER,
  expirationSecondsMaximum: 8_640_000_000_000, lifetimePolicy: 'application-owned',
  reservedClaims: Object.freeze(['iat', 'exp', 'nbf']),
  providerRequirements: Object.freeze(['jwt.sign', 'secret.get', 'time.wall-clock']),
  cryptoAlgorithm: 'HMAC-SHA256', automaticFallback: false
});

function normalizeJwtSignEffect(effect) {
  if (!ordinaryObject(effect) || ['contractId', 'package', 'kind', 'providerKind', 'operation', 'capability', 'result']
    .some(name => dataProperty(effect, name) !== JWT_SIGN_OPERATION[name])) {
    throw new PulseJwtContractError('Pulse JWT provider received an invalid signing operation.', { field: 'identity' });
  }
  const payload = dataProperty(effect, 'payload');
  if (!ordinaryObject(payload) || Reflect.ownKeys(payload).length !== 2
    || !ordinaryObject(dataProperty(payload, 'claims')) || !ordinaryObject(dataProperty(payload, 'options'))) {
    throw new PulseJwtContractError('Pulse JWT signing requires claims and options.', { field: 'payload' });
  }
  return Object.freeze({ claims: dataProperty(payload, 'claims'), options: dataProperty(payload, 'options') });
}

const JWT_EXECUTION_REQUIREMENTS = Object.freeze({
  containment: 'request-owned-effect',
  cancellation: 'request-lifecycle-signal',
  secretResolution: 'provider-owned-named-secret-authority',
  clock: 'one-trusted-provider-wall-clock-capture',
  schemaValidation: 'project-codecs-decode-in-memory',
  resultProjection: 'detached-immutable-jwt-verification',
  redaction: Object.freeze([
    'token',
    'signature',
    'key-material',
    'complete-claims',
    'secret-value'
  ])
});

const JWT_NATIVE_LOWERING_CONTRACT = Object.freeze({
  planVersion: JWT_LOWERING_PLAN_VERSION,
  sidecarAbiVersion: JWT_SIDECAR_ABI_VERSION,
  cryptoCompositionVersion: JWT_CRYPTO_COMPOSITION_VERSION,
  operation: 'jwt.verify',
  tokenSource: 'bearer-request-header',
  result: 'jwt-verification',
  targetCapabilities: Object.freeze([
    'jwt.verify',
    'jwt.verify.hs256',
    'secret.get',
    'time.wall-clock'
  ]),
  realizationKinds: JWT_NATIVE_REALIZATION_KINDS,
  realizationBinding: 'crypto-owned-before-artifact-generation',
  implementationStatus: 'crypto-composed-hs256-es256',
  implementedCapabilities: Object.freeze([
    'jwt.verify',
    'jwt.verify.hs256',
    'jwt.verify.es256',
    'secret.get',
    'time.wall-clock'
  ]),
  implementedAlgorithms: JWT_IMPLEMENTED_ALGORITHMS,
  implementedKeyTypes: JWT_IMPLEMENTED_KEY_TYPES,
  realization: 'guest-source:pulse-hmac-as',
  implementation: 'pulse-hmac-as.v1',
  realizations: Object.freeze({
    HS256: Object.freeze({
      realization: 'guest-source:pulse-hmac-as',
      implementation: 'pulse-hmac-as.v1',
      guestUnitRequired: false
    }),
    ES256: Object.freeze({
      realization: 'guest-linked:pulse-es256-rustcrypto-p256',
      implementation: 'rustcrypto.p256-0.13.2.ecdsa-0.16.9.sha2-0.10.9.v1',
      guestUnitRequired: true
    })
  }),
  cryptoSemanticOwner: CRYPTO_SEMANTIC_OWNER,
  portableVerifierImplemented: false,
  hostVerifyImplemented: false,
  guestUnitRequiredForHs256: false,
  guestUnitRequiredForEs256: true,
  automaticFallback: false
});

const JWT_TARGET_REALIZATIONS = Object.freeze({
  node: Object.freeze({
    javascript: Object.freeze({
      status: 'eligible',
      algorithm: 'HS256',
      realization: 'runtime-builtin',
      implementation: 'webcrypto.subtle.hmac-sha-256.v1',
      algorithms: JWT_IMPLEMENTED_ALGORITHMS,
      keyTypes: JWT_IMPLEMENTED_KEY_TYPES,
      clock: 'node-provider-wall-clock',
      automaticFallback: false
    }),
    native: Object.freeze({
      status: 'eligible',
      algorithm: 'HS256',
      realization: 'guest-source:pulse-hmac-as',
      implementation: 'pulse-hmac-as.v1',
      algorithms: JWT_IMPLEMENTED_ALGORITHMS,
      keyTypes: JWT_IMPLEMENTED_KEY_TYPES,
      clock: 'node-provider-wall-clock',
      guestUnitRequired: false,
      automaticFallback: false
    })
  }),
  fastly: Object.freeze({
    javascript: Object.freeze({
      status: 'eligible',
      algorithm: 'HS256',
      realization: 'runtime-builtin',
      implementation: 'webcrypto.subtle.hmac-sha-256.v1',
      algorithms: JWT_IMPLEMENTED_ALGORITHMS,
      keyTypes: JWT_IMPLEMENTED_KEY_TYPES,
      clock: 'fastly-provider-wall-clock',
      automaticFallback: false
    }),
    native: Object.freeze({
      status: 'eligible',
      algorithms: JWT_IMPLEMENTED_ALGORITHMS,
      keyTypes: JWT_IMPLEMENTED_KEY_TYPES,
      realizations: JWT_NATIVE_LOWERING_CONTRACT.realizations,
      guestUnitRequiredForEs256: true,
      automaticFallback: false
    })
  })
});

class PulseJwtContractError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'PulseJwtContractError';
    this.code = 'PULSE_JWT_OPERATION_FAILED';
    this.detail = Object.freeze({ category: 'canonical-operation', ...detail });
  }
}

function ordinaryObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataProperty(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && descriptor.enumerable
    && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function assertOperationIdentity(effect) {
  if (!ordinaryObject(effect)
    || effect.contractId !== JWT_VERIFY_OPERATION.contractId
    || effect.package !== JWT_VERIFY_OPERATION.package
    || effect.kind !== JWT_VERIFY_OPERATION.kind
    || effect.providerKind !== JWT_VERIFY_OPERATION.providerKind
    || effect.operation !== JWT_VERIFY_OPERATION.operation
    || effect.capability !== JWT_VERIFY_OPERATION.capability
    || effect.result !== JWT_VERIFY_OPERATION.result) {
    throw new PulseJwtContractError(
      'Pulse JWT provider received an invalid canonical verification operation.',
      { field: 'identity' }
    );
  }
}

function normalizeJwtVerifyEffect(effect) {
  assertOperationIdentity(effect);
  const payload = dataProperty(effect, 'payload');
  if (!ordinaryObject(payload)) {
    throw new PulseJwtContractError(
      'Pulse JWT verification requires an ordinary operation payload.',
      { field: 'payload' }
    );
  }
  const payloadKeys = Reflect.ownKeys(payload);
  if (payloadKeys.length !== 2 || !payloadKeys.includes('token') || !payloadKeys.includes('options')) {
    throw new PulseJwtContractError(
      'Pulse JWT verification received an invalid operation payload.',
      { field: 'payload' }
    );
  }
  const token = dataProperty(payload, 'token');
  const options = dataProperty(payload, 'options');
  if (typeof token !== 'string' || !ordinaryObject(options)) {
    throw new PulseJwtContractError(
      'Pulse JWT verification received an invalid token or options payload.',
      { field: typeof token !== 'string' ? 'token' : 'options' }
    );
  }
  return Object.freeze({ token, options });
}

function jwtVerifyProviderRequirements(options = {}) {
  const requirements = ['jwt.verify', 'time.wall-clock'];
  const algorithms = Array.isArray(options.algorithms) ? options.algorithms : [];
  for (const algorithm of algorithms) {
    const suffix = String(algorithm).toLowerCase();
    if (JWT_ALGORITHMS.includes(String(algorithm)) && !requirements.includes(`jwt.verify.${suffix}`)) {
      requirements.push(`jwt.verify.${suffix}`);
    }
  }
  const key = ordinaryObject(options.key) ? options.key : {};
  if (key.type === 'secret') requirements.push('secret.get');
  if (typeof options.claimsSchema === 'string') requirements.push('schema.decode');
  return Object.freeze(requirements);
}

function jwtAlgorithmCapability(algorithm) {
  return JWT_ALGORITHM_CAPABILITIES[String(algorithm)];
}

function jwtVerifyNativeRequirements(options = {}) {
  const requirements = ['jwt.verify', 'time.wall-clock'];
  const algorithms = Array.isArray(options.algorithms) ? options.algorithms : [];
  for (const algorithm of algorithms) {
    const capability = jwtAlgorithmCapability(algorithm);
    if (capability && !requirements.includes(capability)) requirements.push(capability);
  }
  const key = ordinaryObject(options.key) ? options.key : {};
  if (key.type === 'secret') requirements.push('secret.get');
  if (typeof options.claimsSchema === 'string') requirements.push('schema.decode');
  return Object.freeze(requirements);
}

function jwtCryptoRequirements(algorithms = []) {
  if (!Array.isArray(algorithms)) {
    throw new PulseJwtContractError(
      'JWT crypto demand requires a static algorithm array.',
      { field: 'algorithms' }
    );
  }
  const normalized = [...new Set(algorithms.map(String))].sort();
  if (normalized.some((algorithm) => !JWT_ALGORITHMS.includes(algorithm))) {
    throw new PulseJwtContractError(
      'JWT crypto demand contains an unsupported JWT algorithm.',
      { field: 'algorithms' }
    );
  }
  if (normalized.length === 0) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({
      version: PACKAGE_CRYPTO_REQUIREMENT_VERSION,
      requestedBy: JWT_PACKAGE_NAME,
      semanticOwner: CRYPTO_SEMANTIC_OWNER,
      reachable: true,
      algorithms: Object.freeze(normalized)
    })
  ]);
}

function jwtVerifyRedactedProjection(options = {}) {
  const key = ordinaryObject(options.key) ? options.key : {};
  const keyCount = key.type === 'jwks' && Array.isArray(key.keys)
    ? key.keys.length
    : (key.type === 'jwk' || key.type === 'secret' ? 1 : 0);
  return Object.freeze({
    version: JWT_CONTRACT_VERSION,
    contractId: JWT_CONTRACT_ID,
    operation: 'verify',
    algorithms: Object.freeze(Array.isArray(options.algorithms)
      ? options.algorithms.filter((entry) => JWT_ALGORITHMS.includes(String(entry))).map(String)
      : []),
    keyType: JWT_KEY_TYPES.includes(String(key.type)) ? String(key.type) : 'unknown',
    keyCount,
    hasIssuer: options.issuer !== undefined,
    hasAudience: options.audience !== undefined,
    hasSubject: options.subject !== undefined,
    hasClaimsSchema: typeof options.claimsSchema === 'string',
    providerRequirements: jwtVerifyProviderRequirements(options)
  });
}

module.exports = Object.freeze({
  JWT_CONTRACT_VERSION,
  JWT_CANONICAL_EFFECT_VERSION,
  JWT_LOWERING_PLAN_VERSION,
  JWT_LOWERING_PLAN_ARTIFACT,
  JWT_SIDECAR_ABI_VERSION,
  JWT_CRYPTO_COMPOSITION_VERSION,
  JWT_CONTRACT_ID,
  JWT_PACKAGE_NAME,
  JWT_ALGORITHMS,
  JWT_IMPLEMENTED_ALGORITHMS,
  JWT_KEY_TYPES,
  JWT_IMPLEMENTED_KEY_TYPES,
  JWT_NATIVE_REALIZATION_KINDS,
  JWT_ALGORITHM_CAPABILITIES,
  JWT_PACKAGE_INTRINSICS,
  JWT_DIAGNOSTIC_CODES,
  JWT_RESOURCE_LIMITS,
  JWT_ES256_KEY_NORMALIZATION_CONTRACT,
  JWT_VERIFY_OPERATION,
  JWT_SIGN_OPERATION,
  JWT_SIGN_CONTRACT,
  normalizeJwtSignEffect,
  JWT_EXECUTION_REQUIREMENTS,
  JWT_NATIVE_LOWERING_CONTRACT,
  JWT_TARGET_REALIZATIONS,
  PulseJwtContractError,
  normalizeJwtVerifyEffect,
  jwtVerifyProviderRequirements,
  jwtAlgorithmCapability,
  jwtVerifyNativeRequirements,
  jwtCryptoRequirements,
  jwtVerifyRedactedProjection
});
