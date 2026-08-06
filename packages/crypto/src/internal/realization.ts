import type { CryptoVerificationResult } from '../contracts.js';
import {
  verificationResult,
  type NormalizedMacVerifyRequest,
  type NormalizedSignatureVerifyRequest,
} from './verification.js';

export type Hs256SubtleCrypto = Pick<SubtleCrypto, 'importKey' | 'verify'>;
export type Es256SubtleCrypto = Pick<SubtleCrypto, 'importKey' | 'verify'>;

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const P256_FIELD =
  0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const P256_B =
  0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;

function fixedWidthBase64url(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.byteLength; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += BASE64URL_ALPHABET[first >>> 2];
    output += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >>> 4)];
    if (index + 1 < bytes.byteLength) {
      output += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >>> 6)];
    }
    if (index + 2 < bytes.byteLength) {
      output += BASE64URL_ALPHABET[third & 0x3f];
    }
  }
  return output;
}

function bigEndianInteger(bytes: Uint8Array): bigint {
  let output = 0n;
  for (const byte of bytes) output = (output << 8n) | BigInt(byte);
  return output;
}

function validP256Point(bytes: Uint8Array): boolean {
  const x = bigEndianInteger(bytes.subarray(0, 32));
  const y = bigEndianInteger(bytes.subarray(32, 64));
  if (x >= P256_FIELD || y >= P256_FIELD) return false;
  const left = (y * y) % P256_FIELD;
  const right = (
    (((x * x) % P256_FIELD) * x)
    - (3n * x)
    + P256_B
  ) % P256_FIELD;
  return left === (right < 0n ? right + P256_FIELD : right);
}

function selectedRuntimeBuiltin(): Hs256SubtleCrypto | Es256SubtleCrypto | undefined {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (
      !subtle
      || typeof subtle.importKey !== 'function'
      || typeof subtle.verify !== 'function'
    ) {
      return undefined;
    }
    return subtle;
  } catch {
    return undefined;
  }
}

export async function verifyHs256WithSubtle(
  request: NormalizedMacVerifyRequest,
  subtle: Hs256SubtleCrypto | undefined,
): Promise<CryptoVerificationResult> {
  if (!subtle) {
    request.key.bytes.fill(0);
    return verificationResult('realization-failure');
  }

  let key: CryptoKey;
  try {
    key = await subtle.importKey(
      'raw',
      request.key.bytes.buffer,
      {
        name: 'HMAC',
        hash: { name: 'SHA-256' },
        length: request.key.bytes.byteLength * 8,
      },
      false,
      ['verify'],
    );
  } catch {
    request.key.bytes.fill(0);
    return verificationResult('invalid-key');
  }

  // Keep the normalized key storage live until the selected runtime has
  // completed its final use, then erase it on every verification outcome.
  try {
    const valid = await subtle.verify(
      { name: 'HMAC' },
      key,
      request.tag.buffer,
      request.data.buffer,
    );
    if (valid === true) return verificationResult('valid');
    if (valid === false) return verificationResult('invalid-authenticator');
    return verificationResult('realization-failure');
  } catch {
    return verificationResult('realization-failure');
  } finally {
    request.key.bytes.fill(0);
  }
}

/** Execute the already-selected JavaScript runtime-builtin realization. */
export async function verifyHs256(
  request: NormalizedMacVerifyRequest,
): Promise<CryptoVerificationResult> {
  return verifyHs256WithSubtle(request, selectedRuntimeBuiltin());
}

export async function verifyEs256WithSubtle(
  request: NormalizedSignatureVerifyRequest,
  subtle: Es256SubtleCrypto | undefined,
): Promise<CryptoVerificationResult> {
  if (!subtle) {
    request.key.bytes.fill(0);
    return verificationResult('realization-failure');
  }
  if (!validP256Point(request.key.bytes)) {
    request.key.bytes.fill(0);
    return verificationResult('invalid-key');
  }

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: fixedWidthBase64url(request.key.bytes.subarray(0, 32)),
    y: fixedWidthBase64url(request.key.bytes.subarray(32, 64)),
    ext: true,
    key_ops: ['verify'],
  } satisfies JsonWebKey;
  let key: CryptoKey;
  try {
    key = await subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      false,
      ['verify'],
    );
  } catch {
    return verificationResult('invalid-key');
  } finally {
    request.key.bytes.fill(0);
  }

  try {
    const valid = await subtle.verify(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      key,
      request.signature.buffer,
      request.data.buffer,
    );
    if (valid === true) return verificationResult('valid');
    if (valid === false) return verificationResult('invalid-authenticator');
    return verificationResult('realization-failure');
  } catch {
    return verificationResult('realization-failure');
  }
}

/** Execute the already-selected JavaScript runtime-builtin realization. */
export async function verifyEs256(
  request: NormalizedSignatureVerifyRequest,
): Promise<CryptoVerificationResult> {
  return verifyEs256WithSubtle(request, selectedRuntimeBuiltin());
}
