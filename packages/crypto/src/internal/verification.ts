import {
  CRYPTO_RESOURCE_LIMITS,
  CRYPTO_VERIFICATION_STATUSES,
  type CryptoVerificationResult,
  type CryptoVerificationStatus,
  type Es256JoseVerifyInput,
  type MacVerifyRequest,
  type P256PublicKeyCoordinates,
  type SignatureVerifyRequest,
} from '../contracts.js';
import {
  copyBytes,
  exactDataProperties,
  isOrdinaryObject,
  ownDataProperty,
} from './data.js';

const REQUEST_KEYS = new Set(['algorithm', 'key', 'data', 'tag']);
const KEY_KEYS = new Set(['type', 'bytes']);
const SIGNATURE_REQUEST_KEYS = new Set(['algorithm', 'key', 'data', 'signature']);
const P256_KEY_KEYS = new Set(['type', 'bytes']);
const JOSE_REQUEST_KEYS = new Set(['key', 'data', 'signature']);
const JOSE_KEY_KEYS = new Set(['x', 'y']);
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const P256_ORDER = Uint8Array.from([
  0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17, 0x9e, 0x84,
  0xf3, 0xb9, 0xca, 0xc2, 0xfc, 0x63, 0x25, 0x51,
]);

const RESULTS = Object.freeze(Object.fromEntries(
  CRYPTO_VERIFICATION_STATUSES.map((status) => [
    status,
    Object.freeze({ status }),
  ]),
)) as Readonly<Record<CryptoVerificationStatus, CryptoVerificationResult>>;

export interface NormalizedMacVerifyRequest {
  readonly algorithm: 'HS256';
  readonly key: {
    readonly type: 'hmac-key-bytes';
    readonly bytes: Uint8Array<ArrayBuffer>;
  };
  readonly data: Uint8Array<ArrayBuffer>;
  readonly tag: Uint8Array<ArrayBuffer>;
}

export type MacVerifyRequestNormalization =
  | {
      readonly ok: true;
      readonly request: NormalizedMacVerifyRequest;
    }
  | {
      readonly ok: false;
      readonly result: CryptoVerificationResult;
    };

export interface NormalizedSignatureVerifyRequest {
  readonly algorithm: 'ES256';
  readonly key: {
    readonly type: 'p256-public-key-bytes';
    readonly bytes: Uint8Array<ArrayBuffer>;
  };
  readonly data: Uint8Array<ArrayBuffer>;
  readonly signature: Uint8Array<ArrayBuffer>;
}

export type SignatureVerifyRequestNormalization =
  | {
      readonly ok: true;
      readonly request: NormalizedSignatureVerifyRequest;
    }
  | {
      readonly ok: false;
      readonly result: CryptoVerificationResult;
    };

export type P256PublicKeyNormalization =
  | {
      readonly ok: true;
      readonly key: NormalizedSignatureVerifyRequest['key'];
    }
  | {
      readonly ok: false;
      readonly result: CryptoVerificationResult;
    };

export function verificationResult(
  status: CryptoVerificationStatus,
): CryptoVerificationResult {
  return RESULTS[status];
}

function invalidInput(): MacVerifyRequestNormalization {
  return Object.freeze({
    ok: false,
    result: verificationResult('invalid-input'),
  });
}

function invalidKey(): MacVerifyRequestNormalization {
  return Object.freeze({
    ok: false,
    result: verificationResult('invalid-key'),
  });
}

function invalidSignatureInput(): SignatureVerifyRequestNormalization {
  return Object.freeze({
    ok: false,
    result: verificationResult('invalid-input'),
  });
}

function invalidSignatureKey(): SignatureVerifyRequestNormalization {
  return Object.freeze({
    ok: false,
    result: verificationResult('invalid-key'),
  });
}

function compareBigEndian(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function validP256Scalar(value: Uint8Array): boolean {
  let nonZero = false;
  for (const byte of value) nonZero ||= byte !== 0;
  return nonZero && compareBigEndian(value, P256_ORDER) < 0;
}

function validEs256Signature(signature: Uint8Array): boolean {
  return signature.byteLength === CRYPTO_RESOURCE_LIMITS.es256SignatureBytes
    && validP256Scalar(signature.subarray(0, 32))
    && validP256Scalar(signature.subarray(32, 64));
}

function decodeCanonicalBase64url(
  value: unknown,
  expectedBytes: number,
): Uint8Array<ArrayBuffer> | undefined {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('=')
    || !BASE64URL.test(value)
    || value.length % 4 === 1
  ) return undefined;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - value.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return undefined;
  }
  const bytes = Uint8Array.from(
    binary,
    (character) => character.charCodeAt(0),
  );
  if (bytes.byteLength !== expectedBytes) return undefined;
  let canonical = '';
  for (const byte of bytes) canonical += String.fromCharCode(byte);
  canonical = btoa(canonical)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
  return canonical === value ? bytes : undefined;
}

export function normalizeMacVerifyRequest(
  value: unknown,
): MacVerifyRequestNormalization {
  if (!isOrdinaryObject(value) || !exactDataProperties(value, REQUEST_KEYS)) {
    return invalidInput();
  }

  const algorithm = ownDataProperty(value, 'algorithm').value;
  if (algorithm !== 'HS256') return invalidInput();

  const keyValue = ownDataProperty(value, 'key').value;
  if (!isOrdinaryObject(keyValue) || !exactDataProperties(keyValue, KEY_KEYS)) {
    return invalidKey();
  }
  if (ownDataProperty(keyValue, 'type').value !== 'hmac-key-bytes') {
    return invalidKey();
  }

  const keyBytes = copyBytes(ownDataProperty(keyValue, 'bytes').value);
  if (
    !keyBytes
    || keyBytes.byteLength < CRYPTO_RESOURCE_LIMITS.hmacKeyBytesMinimum
    || keyBytes.byteLength > CRYPTO_RESOURCE_LIMITS.hmacKeyBytesMaximum
  ) {
    return invalidKey();
  }

  const data = copyBytes(ownDataProperty(value, 'data').value);
  const tag = copyBytes(ownDataProperty(value, 'tag').value);
  if (
    !data
    || data.byteLength > CRYPTO_RESOURCE_LIMITS.macDataBytesMaximum
    || !tag
    || tag.byteLength !== CRYPTO_RESOURCE_LIMITS.hs256TagBytes
  ) {
    return invalidInput();
  }

  return Object.freeze({
    ok: true,
    request: Object.freeze({
      algorithm,
      key: Object.freeze({
        type: 'hmac-key-bytes',
        bytes: keyBytes,
      }),
      data,
      tag,
    }),
  });
}

export function normalizeSignatureVerifyRequest(
  value: unknown,
): SignatureVerifyRequestNormalization {
  if (
    !isOrdinaryObject(value)
    || !exactDataProperties(value, SIGNATURE_REQUEST_KEYS)
  ) return invalidSignatureInput();
  if (ownDataProperty(value, 'algorithm').value !== 'ES256') {
    return invalidSignatureInput();
  }

  const keyValue = ownDataProperty(value, 'key').value;
  if (
    !isOrdinaryObject(keyValue)
    || !exactDataProperties(keyValue, P256_KEY_KEYS)
    || ownDataProperty(keyValue, 'type').value !== 'p256-public-key-bytes'
  ) return invalidSignatureKey();
  const keyBytes = copyBytes(ownDataProperty(keyValue, 'bytes').value);
  if (
    !keyBytes
    || keyBytes.byteLength !== CRYPTO_RESOURCE_LIMITS.es256PublicKeyBytes
  ) return invalidSignatureKey();

  const data = copyBytes(ownDataProperty(value, 'data').value);
  const signature = copyBytes(ownDataProperty(value, 'signature').value);
  if (
    !data
    || data.byteLength > CRYPTO_RESOURCE_LIMITS.es256SigningInputBytesMaximum
    || !signature
    || !validEs256Signature(signature)
  ) {
    keyBytes.fill(0);
    return invalidSignatureInput();
  }

  return Object.freeze({
    ok: true,
    request: Object.freeze({
      algorithm: 'ES256',
      key: Object.freeze({
        type: 'p256-public-key-bytes',
        bytes: keyBytes,
      }),
      data,
      signature,
    }),
  });
}

export function normalizeEs256JoseVerifyRequest(
  value: Es256JoseVerifyInput,
): SignatureVerifyRequestNormalization {
  if (!isOrdinaryObject(value) || !exactDataProperties(value, JOSE_REQUEST_KEYS)) {
    return invalidSignatureInput();
  }
  const keyValue = ownDataProperty(value, 'key').value;
  if (!isOrdinaryObject(keyValue) || !exactDataProperties(keyValue, JOSE_KEY_KEYS)) {
    return invalidSignatureKey();
  }
  const normalizedKey = normalizeP256PublicKeyCoordinates(
    keyValue as unknown as P256PublicKeyCoordinates,
  );
  if (!normalizedKey.ok) return normalizedKey;
  const signature = decodeCanonicalBase64url(
    ownDataProperty(value, 'signature').value,
    CRYPTO_RESOURCE_LIMITS.es256SignatureBytes,
  );
  if (!signature || !validEs256Signature(signature)) {
    normalizedKey.key.bytes.fill(0);
    return invalidSignatureInput();
  }
  const data = copyBytes(ownDataProperty(value, 'data').value);
  if (
    !data
    || data.byteLength > CRYPTO_RESOURCE_LIMITS.es256SigningInputBytesMaximum
  ) {
    normalizedKey.key.bytes.fill(0);
    return invalidSignatureInput();
  }
  return Object.freeze({
    ok: true,
    request: Object.freeze({
      algorithm: 'ES256',
      key: normalizedKey.key,
      data,
      signature,
    }),
  });
}

export function normalizeP256PublicKeyCoordinates(
  value: P256PublicKeyCoordinates,
): P256PublicKeyNormalization {
  if (!isOrdinaryObject(value) || !exactDataProperties(value, JOSE_KEY_KEYS)) {
    return Object.freeze({
      ok: false,
      result: verificationResult('invalid-key'),
    });
  }
  const x = decodeCanonicalBase64url(
    ownDataProperty(value, 'x').value,
    32,
  );
  const y = decodeCanonicalBase64url(
    ownDataProperty(value, 'y').value,
    32,
  );
  if (!x || !y) {
    if (x) x.fill(0);
    if (y) y.fill(0);
    return Object.freeze({
      ok: false,
      result: verificationResult('invalid-key'),
    });
  }
  const keyBytes = new Uint8Array(CRYPTO_RESOURCE_LIMITS.es256PublicKeyBytes);
  keyBytes.set(x, 0);
  keyBytes.set(y, 32);
  x.fill(0);
  y.fill(0);
  return Object.freeze({
    ok: true,
    key: Object.freeze({
      type: 'p256-public-key-bytes',
      bytes: keyBytes,
    }),
  });
}

export function normalizeVerificationResult(
  value: unknown,
): CryptoVerificationResult {
  if (!isOrdinaryObject(value) || !exactDataProperties(value, new Set(['status']))) {
    return verificationResult('realization-failure');
  }
  const status = ownDataProperty(value, 'status').value;
  if (
    typeof status !== 'string'
    || !(CRYPTO_VERIFICATION_STATUSES as readonly string[]).includes(status)
  ) {
    return verificationResult('realization-failure');
  }
  return verificationResult(status as CryptoVerificationStatus);
}

export function redactMacVerifyRequest(
  request: MacVerifyRequest | NormalizedMacVerifyRequest,
): Readonly<{
  algorithm: 'HS256';
  key: Readonly<{
    type: 'hmac-key-bytes';
    compatibleAlgorithms: readonly ['HS256'];
    identity: '[redacted]';
  }>;
  data: '[redacted]';
  tag: '[redacted]';
}> {
  return Object.freeze({
    algorithm: request.algorithm,
    key: Object.freeze({
      type: 'hmac-key-bytes',
      compatibleAlgorithms: Object.freeze(['HS256'] as const),
      identity: '[redacted]',
    }),
    data: '[redacted]',
    tag: '[redacted]',
  });
}

export function redactSignatureVerifyRequest(
  request: SignatureVerifyRequest | NormalizedSignatureVerifyRequest,
): Readonly<{
  algorithm: 'ES256';
  key: Readonly<{
    type: 'p256-public-key-bytes';
    compatibleAlgorithms: readonly ['ES256'];
    identity: '[redacted]';
  }>;
  data: '[redacted]';
  signature: '[redacted]';
}> {
  return Object.freeze({
    algorithm: request.algorithm,
    key: Object.freeze({
      type: 'p256-public-key-bytes',
      compatibleAlgorithms: Object.freeze(['ES256'] as const),
      identity: '[redacted]',
    }),
    data: '[redacted]',
    signature: '[redacted]',
  });
}
