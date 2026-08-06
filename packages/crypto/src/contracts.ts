export const CRYPTO_CONTRACT_VERSION = 'pulse.crypto.verification.v1' as const;
export const CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION =
  'webcrypto.subtle.hmac-sha-256.v1' as const;
export const CRYPTO_GUEST_SOURCE_IMPLEMENTATION =
  'pulse-hmac-as.v1' as const;
export const CRYPTO_ES256_CONTRACT_VERSION =
  'pulse.crypto.es256-verification.v1' as const;
export const CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION =
  'webcrypto.subtle.ecdsa-p256-sha-256.v1' as const;
export const CRYPTO_ES256_GUEST_LINKED_REALIZATION =
  'guest-linked:pulse-es256-rustcrypto-p256' as const;
export const CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION =
  'rustcrypto.p256-0.13.2.ecdsa-0.16.9.sha2-0.10.9.v1' as const;

/**
 * Executable algorithms remain intentionally narrower than frozen future
 * contracts. G3, not G0, owns activation of ES256.
 */
export const CRYPTO_ALGORITHMS = Object.freeze([
  'HS256',
  'ES256',
] as const);

export type CryptoAlgorithm = typeof CRYPTO_ALGORITHMS[number];
export type MacAlgorithm = 'HS256';
export type SignatureAlgorithm = 'ES256';

export const CRYPTO_VERIFICATION_STATUSES = Object.freeze([
  'valid',
  'invalid-authenticator',
  'invalid-key',
  'invalid-input',
  'realization-failure',
] as const);

export type CryptoVerificationStatus =
  typeof CRYPTO_VERIFICATION_STATUSES[number];

export type CryptoVerificationResult =
  | { readonly status: 'valid' }
  | { readonly status: 'invalid-authenticator' }
  | { readonly status: 'invalid-key' }
  | { readonly status: 'invalid-input' }
  | { readonly status: 'realization-failure' };

/**
 * Raw HMAC key material. The algorithm-specific discriminant prevents this
 * descriptor from being accepted as a future asymmetric verification key.
 */
export interface HmacKeyBytes {
  readonly type: 'hmac-key-bytes';
  readonly bytes: Uint8Array;
}

export type HmacVerificationKey = HmacKeyBytes;

export interface MacVerifyRequest {
  readonly algorithm: MacAlgorithm;
  readonly key: HmacVerificationKey;
  readonly data: Uint8Array;
  readonly tag: Uint8Array;
}

/**
 * Package-private normalized P-256 public point. JWK, SEC1, SPKI, PEM, and
 * certificate representations never cross the crypto realization boundary.
 */
export interface P256PublicKeyBytes {
  readonly type: 'p256-public-key-bytes';
  /** Exactly 64 bytes: 32-byte big-endian x followed by 32-byte big-endian y. */
  readonly bytes: Uint8Array;
}

export interface SignatureVerifyRequest {
  readonly algorithm: SignatureAlgorithm;
  readonly key: P256PublicKeyBytes;
  /** Exact original signing bytes; never a reserialized JWT representation. */
  readonly data: Uint8Array;
  /** Exactly 64 bytes: 32-byte big-endian r followed by 32-byte big-endian s. */
  readonly signature: Uint8Array;
}

/**
 * Crypto-owned adapter input for the one JOSE representation accepted by the
 * JWT composition. JWT has already validated the public JWK policy; crypto
 * owns canonical coordinate/signature decoding into its fixed-width request.
 */
export interface Es256JoseVerifyInput {
  readonly key: Readonly<{
    readonly x: string;
    readonly y: string;
  }>;
  readonly data: Uint8Array;
  readonly signature: string;
}

export interface P256PublicKeyCoordinates {
  readonly x: string;
  readonly y: string;
}

export const CRYPTO_RESOURCE_LIMITS = Object.freeze({
  hmacKeyBytesMinimum: 32,
  hmacKeyBytesMaximum: 4 * 1024,
  macDataBytesMaximum: 1024 * 1024,
  hs256TagBytes: 32,
  es256PublicKeyBytes: 64,
  es256SignatureBytes: 64,
  es256SigningInputBytesMaximum: 16_340,
} as const);

export const CRYPTO_ES256_CONTRACT = Object.freeze({
  version: CRYPTO_ES256_CONTRACT_VERSION,
  status: 'executable-g3',
  semanticOwner: '@pulse-compute/crypto',
  algorithm: 'ES256',
  primitive: Object.freeze({
    kind: 'ecdsa',
    curve: 'P-256',
    hash: 'SHA-256',
  }),
  operation: 'verify',
  request: Object.freeze({
    function: 'crypto.signature.verify',
    keyType: 'p256-public-key-bytes',
    publicKeyEncoding: 'raw-x-y-big-endian',
    publicKeyBytes: CRYPTO_RESOURCE_LIMITS.es256PublicKeyBytes,
    dataBytesMaximum: CRYPTO_RESOURCE_LIMITS.es256SigningInputBytesMaximum,
    signatureEncoding: 'jose-r-s-big-endian',
    signatureBytes: CRYPTO_RESOURCE_LIMITS.es256SignatureBytes,
    derAccepted: false,
  }),
  runtimeBuiltin: Object.freeze({
    realization: 'runtime-builtin',
    implementation: CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION,
    eligibleTargets: Object.freeze([
      'node-javascript',
      'fastly-javascript',
    ] as const),
  }),
  native: Object.freeze({
    realization: CRYPTO_ES256_GUEST_LINKED_REALIZATION,
    implementation: CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
    eligibleTargets: Object.freeze([
      'node-native',
      'fastly-native',
    ] as const),
  }),
  guest: Object.freeze({
    unitVersion: 'pulse.guest-unit.v2',
    unitId: 'pulse.crypto.es256.rustcrypto-p256.v1',
    module: 'pulse_crypto_es256',
    owner: '@pulse-compute/crypto',
    abi: 'pulse.crypto.es256.verify.v1',
    export: Object.freeze({
      name: 'pulse_crypto_es256_verify',
      parameters: Object.freeze(['i32', 'i32'] as const),
      results: Object.freeze(['i32'] as const),
    }),
    origin: 'package-prebuilt',
    sourceBuildDuringApplicationBuild: false,
    memory: Object.freeze({
      identity: 'pulse.guest-memory.invocation-frame.v2',
      import: 'env.memory',
      minimumPages: 32,
      maximumPages: 32,
      growable: false,
    }),
    start: 'forbidden',
    hostCallbacks: false,
    allocator: false,
  }),
  frame: Object.freeze({
    identity: 'pulse.crypto.es256.invocation-frame.v2',
    byteOrder: 'little-endian',
    pointerWidthBits: 32,
    magic: 0x32534550,
    version: 2,
    headerBytes: 64,
    capacityBytes: 16_640,
    alignmentBytes: 16,
    signingInputBytesMaximum: 16_340,
    publicKeyBytes: 64,
    signatureBytes: 64,
    rawPayloadBytesMaximum: 16_468,
    reservedHeaderAndAlignmentBytes: 172,
    canonicalOffsets: Object.freeze({
      publicKey: 64,
      signature: 128,
      signingInput: 192,
    }),
    header: Object.freeze({
      magic: 0,
      version: 4,
      headerLength: 8,
      totalLength: 12,
      algorithm: 16,
      flags: 20,
      signingInputOffset: 24,
      signingInputLength: 28,
      publicKeyOffset: 32,
      publicKeyLength: 36,
      signatureOffset: 40,
      signatureLength: 44,
      reserved0: 48,
      reserved1: 52,
      reserved2: 56,
      reserved3: 60,
    }),
    algorithmCode: 1,
    flags: 0,
    reservedWordCount: 4,
    reservedWordValue: 0,
    callerOwned: true,
    synchronous: true,
    retainable: false,
    clearCapacityAfterReturnOrTrap: true,
  }),
  resultStatuses: CRYPTO_VERIFICATION_STATUSES,
  resultCodes: Object.freeze({
    valid: 1,
    invalidAuthenticator: 0,
    invalidKey: -1,
    invalidInput: -2,
    realizationFailure: -3,
  }),
  automaticFallback: false,
} as const);
