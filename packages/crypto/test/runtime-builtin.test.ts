import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CRYPTO_RESOURCE_LIMITS,
  crypto,
  type MacVerifyRequest,
  type SignatureVerifyRequest,
} from '../src/index.js';
import {
  type Es256SubtleCrypto,
  type Hs256SubtleCrypto,
  verifyEs256WithSubtle,
  verifyHs256WithSubtle,
} from '../src/internal/realization.js';
import {
  normalizeMacVerifyRequest,
  normalizeSignatureVerifyRequest,
  verificationResult,
  type NormalizedMacVerifyRequest,
  type NormalizedSignatureVerifyRequest,
} from '../src/internal/verification.js';

interface Hs256Vector {
  readonly id: string;
  readonly keyByte: number;
  readonly keyLength: number;
  readonly dataHex: string;
  readonly tagHex: string;
}

const vectors = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL('../conformance/hs256.json', import.meta.url)),
  'utf8',
)) as Readonly<{
  version: string;
  sources: Readonly<{ vectors: string }>;
  publishedVectors: readonly Hs256Vector[];
}>;

function bytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new TypeError('invalid test hex');
  return Uint8Array.from(hex.match(/[0-9a-f]{2}/gi) ?? [], (value) => (
    Number.parseInt(value, 16)
  ));
}

function vectorRequest(vector: Hs256Vector): MacVerifyRequest {
  return {
    algorithm: 'HS256',
    key: {
      type: 'hmac-key-bytes',
      bytes: new Uint8Array(vector.keyLength).fill(vector.keyByte),
    },
    data: bytes(vector.dataHex),
    tag: bytes(vector.tagHex),
  };
}

function normalized(
  request: MacVerifyRequest = vectorRequest(vectors.publishedVectors[0]),
): NormalizedMacVerifyRequest {
  const result = normalizeMacVerifyRequest(request);
  if (!result.ok) throw new TypeError(`test request failed normalization: ${result.result.status}`);
  return result.request;
}

function viewBytes(value: BufferSource): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

const RFC_P256_PUBLIC = bytes(
  '60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6'
  + '7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299',
);
const RFC_P256_SIGNATURE = bytes(
  'efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716'
  + 'f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8',
);

function es256Request(
  overrides: Partial<SignatureVerifyRequest> = {},
): SignatureVerifyRequest {
  return {
    algorithm: 'ES256',
    key: {
      type: 'p256-public-key-bytes',
      bytes: RFC_P256_PUBLIC,
    },
    data: new TextEncoder().encode('sample'),
    signature: RFC_P256_SIGNATURE,
    ...overrides,
  };
}

function normalizedEs256(
  request: SignatureVerifyRequest = es256Request(),
): NormalizedSignatureVerifyRequest {
  const result = normalizeSignatureVerifyRequest(request);
  if (!result.ok) throw new TypeError(`test request failed normalization: ${result.result.status}`);
  return result.request;
}

describe('@pulse-compute/crypto C2 JavaScript runtime-builtin', () => {
  it('verifies the shared RFC 4231 HS256 vectors through Web Crypto', async () => {
    expect(vectors.version).toBe('pulse.crypto.hs256-conformance.v2');
    expect(vectors.sources.vectors).toBe('RFC 4231 test cases 6 and 7');
    expect(vectors.publishedVectors).toHaveLength(2);

    for (const vector of vectors.publishedVectors) {
      const request = vectorRequest(vector);
      const keyBefore = new Uint8Array(request.key.bytes);
      const dataBefore = new Uint8Array(request.data);
      const tagBefore = new Uint8Array(request.tag);

      await expect(crypto.mac.verify(request))
        .resolves.toBe(verificationResult('valid'));
      expect(request.key.bytes).toEqual(keyBefore);
      expect(request.data).toEqual(dataBefore);
      expect(request.tag).toEqual(tagBefore);

      const invalidTag = new Uint8Array(request.tag);
      invalidTag[0] ^= 0x80;
      await expect(crypto.mac.verify({ ...request, tag: invalidTag }))
        .resolves.toBe(verificationResult('invalid-authenticator'));
    }
  });

  it('uses exact HMAC buffers and retains key bytes through verification', async () => {
    const request = normalized();
    const importedKey = Object.freeze({ test: 'opaque-key' }) as unknown as CryptoKey;
    const calls: unknown[] = [];
    let importedBytes: Uint8Array | undefined;
    let importedView: Uint8Array | undefined;
    let importedBytesAtVerify: Uint8Array | undefined;
    let importedAsExactArrayBuffer = false;
    let signatureAsExactArrayBuffer = false;
    let dataAsExactArrayBuffer = false;
    const subtle = {
      async importKey(
        format: KeyFormat,
        keyData: BufferSource,
        algorithm: AlgorithmIdentifier | HmacImportParams,
        extractable: boolean,
        keyUsages: KeyUsage[],
      ) {
        importedAsExactArrayBuffer = keyData instanceof ArrayBuffer;
        importedView = viewBytes(keyData);
        importedBytes = new Uint8Array(viewBytes(keyData));
        calls.push({ format, algorithm, extractable, keyUsages: [...keyUsages] });
        return importedKey;
      },
      async verify(
        algorithm: AlgorithmIdentifier,
        key: CryptoKey,
        signature: BufferSource,
        data: BufferSource,
      ) {
        importedBytesAtVerify = importedView
          ? new Uint8Array(importedView)
          : undefined;
        signatureAsExactArrayBuffer = signature instanceof ArrayBuffer;
        dataAsExactArrayBuffer = data instanceof ArrayBuffer;
        calls.push({
          algorithm,
          key,
          signature: new Uint8Array(viewBytes(signature)),
          data: new Uint8Array(viewBytes(data)),
        });
        return true;
      },
    } as Hs256SubtleCrypto;

    const expectedKey = new Uint8Array(request.key.bytes);
    const expectedData = new Uint8Array(request.data);
    const expectedTag = new Uint8Array(request.tag);
    await expect(verifyHs256WithSubtle(request, subtle))
      .resolves.toBe(verificationResult('valid'));

    expect(importedBytes).toEqual(expectedKey);
    expect(importedBytesAtVerify).toEqual(expectedKey);
    expect(importedAsExactArrayBuffer).toBe(true);
    expect(signatureAsExactArrayBuffer).toBe(true);
    expect(dataAsExactArrayBuffer).toBe(true);
    expect(calls).toEqual([
      {
        format: 'raw',
        algorithm: {
          name: 'HMAC',
          hash: { name: 'SHA-256' },
          length: expectedKey.byteLength * 8,
        },
        extractable: false,
        keyUsages: ['verify'],
      },
      {
        algorithm: { name: 'HMAC' },
        key: importedKey,
        signature: expectedTag,
        data: expectedData,
      },
    ]);
    expect(request.key.bytes).toEqual(new Uint8Array(expectedKey.byteLength));
  });

  it('normalizes unavailable runtimes, key imports, invalid tags, and operation failures', async () => {
    await expect(verifyHs256WithSubtle(normalized(), undefined))
      .resolves.toBe(verificationResult('realization-failure'));

    let verifyCalls = 0;
    const importFailure = {
      async importKey() {
        throw new Error('key material must never escape');
      },
      async verify() {
        verifyCalls += 1;
        return true;
      },
    } as unknown as Hs256SubtleCrypto;
    await expect(verifyHs256WithSubtle(normalized(), importFailure))
      .resolves.toBe(verificationResult('invalid-key'));
    expect(verifyCalls).toBe(0);

    const falseVerifier = {
      async importKey() {
        return Object.freeze({}) as CryptoKey;
      },
      async verify() {
        return false;
      },
    } as unknown as Hs256SubtleCrypto;
    await expect(verifyHs256WithSubtle(normalized(), falseVerifier))
      .resolves.toBe(verificationResult('invalid-authenticator'));

    const malformedVerifier = {
      async importKey() {
        return Object.freeze({}) as CryptoKey;
      },
      async verify() {
        return 'true';
      },
    } as unknown as Hs256SubtleCrypto;
    await expect(verifyHs256WithSubtle(normalized(), malformedVerifier))
      .resolves.toBe(verificationResult('realization-failure'));

    const secretMarker = 'c2-secret-must-not-escape';
    const operationFailure = {
      async importKey() {
        return Object.freeze({}) as CryptoKey;
      },
      async verify() {
        throw new Error(secretMarker);
      },
    } as unknown as Hs256SubtleCrypto;
    const failed = await verifyHs256WithSubtle(normalized(), operationFailure);
    expect(failed).toBe(verificationResult('realization-failure'));
    expect(Object.keys(failed)).toEqual(['status']);
    expect(JSON.stringify(failed)).not.toContain(secretMarker);
  });

  it('retains the bounded minimum-key and byte-only public boundary', async () => {
    const vector = vectors.publishedVectors[0];
    const request = vectorRequest(vector);
    await expect(crypto.mac.verify({
      ...request,
      key: {
        type: 'hmac-key-bytes',
        bytes: new Uint8Array(CRYPTO_RESOURCE_LIMITS.hmacKeyBytesMinimum - 1),
      },
    })).resolves.toBe(verificationResult('invalid-key'));
    await expect(crypto.mac.verify({
      ...request,
      data: 'not ambient text' as unknown as Uint8Array,
    })).resolves.toBe(verificationResult('invalid-input'));
  });
});

describe('@pulse-compute/crypto G3 ES256 runtime-builtin', () => {
  it('verifies raw P-256 points and JOSE signatures through Web Crypto', async () => {
    const input = es256Request();
    const keyBefore = new Uint8Array(input.key.bytes);
    const dataBefore = new Uint8Array(input.data);
    const signatureBefore = new Uint8Array(input.signature);
    await expect(crypto.signature.verify(input))
      .resolves.toBe(verificationResult('valid'));
    expect(input.key.bytes).toEqual(keyBefore);
    expect(input.data).toEqual(dataBefore);
    expect(input.signature).toEqual(signatureBefore);

    const wrong = new Uint8Array(input.signature);
    wrong[63] ^= 1;
    await expect(crypto.signature.verify({ ...input, signature: wrong }))
      .resolves.toBe(verificationResult('invalid-authenticator'));
  });

  it('imports one internal public JWK and preserves normalized statuses', async () => {
    const request = normalizedEs256();
    const importedKey = Object.freeze({}) as CryptoKey;
    const calls: unknown[] = [];
    const subtle = {
      async importKey(
        format: KeyFormat,
        keyData: BufferSource | JsonWebKey,
        algorithm: AlgorithmIdentifier,
        extractable: boolean,
        keyUsages: KeyUsage[],
      ) {
        calls.push({
          format,
          keyData,
          algorithm,
          extractable,
          keyUsages,
        });
        return importedKey;
      },
      async verify(
        algorithm: AlgorithmIdentifier,
        key: CryptoKey,
        signature: BufferSource,
        data: BufferSource,
      ) {
        calls.push({
          algorithm,
          key,
          signature: new Uint8Array(viewBytes(signature)),
          data: new Uint8Array(viewBytes(data)),
        });
        return true;
      },
    } as Es256SubtleCrypto;
    await expect(verifyEs256WithSubtle(request, subtle))
      .resolves.toBe(verificationResult('valid'));
    expect(calls).toEqual([
      {
        format: 'jwk',
        keyData: {
          kty: 'EC',
          crv: 'P-256',
          x: 'YP7UuiVanTHJYet0xjVtaMBJuJI7Yfps5mliLmDyn7Y',
          y: 'eQP-EAi4vJmkGunpVii8ZPLxsgwtfp9Rd6PClNRGIpk',
          ext: true,
          key_ops: ['verify'],
        },
        algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
        extractable: false,
        keyUsages: ['verify'],
      },
      {
        algorithm: { name: 'ECDSA', hash: { name: 'SHA-256' } },
        key: importedKey,
        signature: RFC_P256_SIGNATURE,
        data: new TextEncoder().encode('sample'),
      },
    ]);
    expect(request.key.bytes).toEqual(new Uint8Array(64));

    await expect(verifyEs256WithSubtle(normalizedEs256(), undefined))
      .resolves.toBe(verificationResult('realization-failure'));
    const invalidKey = {
      async importKey() { throw new Error('redacted key'); },
      async verify() { return true; },
    } as unknown as Es256SubtleCrypto;
    await expect(verifyEs256WithSubtle(normalizedEs256(), invalidKey))
      .resolves.toBe(verificationResult('invalid-key'));

    let invalidPointImports = 0;
    const invalidPointRuntime = {
      async importKey() {
        invalidPointImports += 1;
        return Object.freeze({}) as CryptoKey;
      },
      async verify() { return true; },
    } as unknown as Es256SubtleCrypto;
    const invalidPoint = normalizedEs256({
      ...es256Request(),
      key: {
        type: 'p256-public-key-bytes',
        bytes: new Uint8Array(64),
      },
    });
    await expect(verifyEs256WithSubtle(invalidPoint, invalidPointRuntime))
      .resolves.toBe(verificationResult('invalid-key'));
    expect(invalidPointImports).toBe(0);
    expect(invalidPoint.key.bytes).toEqual(new Uint8Array(64));
  });
});
