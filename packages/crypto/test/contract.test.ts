import { describe, expect, it } from 'vitest';
import {
  CRYPTO_ALGORITHMS,
  CRYPTO_CONTRACT_VERSION,
  CRYPTO_ES256_CONTRACT,
  CRYPTO_ES256_CONTRACT_VERSION,
  CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
  CRYPTO_ES256_GUEST_LINKED_REALIZATION,
  CRYPTO_RESOURCE_LIMITS,
  CRYPTO_VERIFICATION_STATUSES,
  crypto,
  mac,
  signature,
  verifyMac,
  verifySignature,
} from '../src/index.js';
import {
  normalizeEs256JoseVerifyRequest,
  normalizeMacVerifyRequest,
  normalizeSignatureVerifyRequest,
  normalizeVerificationResult,
  redactSignatureVerifyRequest,
  redactMacVerifyRequest,
  verificationResult,
} from '../src/internal/verification.js';

function request(overrides: Readonly<Record<string, unknown>> = {}): any {
  return {
    algorithm: 'HS256',
    key: {
      type: 'hmac-key-bytes',
      bytes: new Uint8Array(CRYPTO_RESOURCE_LIMITS.hmacKeyBytesMinimum).fill(0x41),
    },
    data: new Uint8Array([1, 2, 3]),
    tag: new Uint8Array(CRYPTO_RESOURCE_LIMITS.hs256TagBytes).fill(0x42),
    ...overrides,
  };
}

describe('@pulse-compute/crypto verification contract', () => {
  it('publishes the executable verification algorithms and closed result taxonomy', () => {
    expect(CRYPTO_CONTRACT_VERSION).toBe('pulse.crypto.verification.v1');
    expect(CRYPTO_ALGORITHMS).toEqual(['HS256', 'ES256', 'RS256']);
    expect(CRYPTO_VERIFICATION_STATUSES).toEqual([
      'valid',
      'invalid-authenticator',
      'invalid-key',
      'invalid-input',
      'realization-failure',
    ]);
    expect(Object.isFrozen(CRYPTO_ALGORITHMS)).toBe(true);
    expect(Object.isFrozen(CRYPTO_VERIFICATION_STATUSES)).toBe(true);
    expect(crypto.mac).toBe(mac);
    expect(crypto.signature).toBe(signature);
    expect(mac.verify).toBe(verifyMac);
    expect(signature.verify).toBe(verifySignature);
    expect(Object.isFrozen(crypto)).toBe(true);
    expect(Object.isFrozen(mac)).toBe(true);
    expect(Object.isFrozen(signature)).toBe(true);
  });

  it('activates only the frozen ES256 verifier contract', () => {
    expect(CRYPTO_ES256_CONTRACT_VERSION)
      .toBe('pulse.crypto.es256-verification.v1');
    expect(CRYPTO_ES256_GUEST_LINKED_REALIZATION)
      .toBe('guest-linked:pulse-es256-rustcrypto-p256');
    expect(CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION)
      .toBe('rustcrypto.p256-0.13.2.ecdsa-0.16.9.sha2-0.10.9.v1');
    expect(CRYPTO_ALGORITHMS).toEqual(['HS256', 'ES256', 'RS256']);
    expect(Object.keys(crypto)).toEqual(['digestText', 'mac', 'signature']);
    expect(CRYPTO_ES256_CONTRACT).toMatchObject({
      status: 'executable-g3',
      algorithm: 'ES256',
      operation: 'verify',
      guest: {
        unitVersion: 'pulse.guest-unit.v2',
        origin: 'package-prebuilt',
        sourceBuildDuringApplicationBuild: false,
        allocator: false,
        hostCallbacks: false,
      },
      frame: {
        identity: 'pulse.crypto.es256.invocation-frame.v2',
        capacityBytes: 16_640,
        signingInputBytesMaximum: 16_340,
        publicKeyBytes: 64,
        signatureBytes: 64,
        rawPayloadBytesMaximum: 16_468,
        reservedHeaderAndAlignmentBytes: 172,
        retainable: false,
        clearCapacityAfterReturnOrTrap: true,
      },
      automaticFallback: false,
    });
    expect(Object.isFrozen(CRYPTO_ES256_CONTRACT)).toBe(true);
    expect(Object.isFrozen(CRYPTO_ES256_CONTRACT.frame)).toBe(true);
    expect(Object.isFrozen(CRYPTO_ES256_CONTRACT.frame.header)).toBe(true);
  });

  it('normalizes fixed-width ES256 bytes and canonical JOSE fields', async () => {
    const x = Buffer.alloc(32, 1).toString('base64url');
    const y = Buffer.alloc(32, 2).toString('base64url');
    const signatureBytes = new Uint8Array(64);
    signatureBytes[31] = 1;
    signatureBytes[63] = 2;
    const normalized = normalizeEs256JoseVerifyRequest({
      key: { x, y },
      data: new Uint8Array([1, 2, 3]),
      signature: Buffer.from(signatureBytes).toString('base64url'),
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.request.key.bytes).toEqual(
      new Uint8Array([...Buffer.alloc(32, 1), ...Buffer.alloc(32, 2)]),
    );
    expect(normalized.request.signature).toEqual(signatureBytes);
    expect(normalizeSignatureVerifyRequest({
      ...normalized.request,
      signature: new Uint8Array(63),
    })).toMatchObject({ ok: false, result: { status: 'invalid-input' } });
    expect(normalizeEs256JoseVerifyRequest({
      key: { x: `${x}=`, y },
      data: new Uint8Array(),
      signature: Buffer.from(signatureBytes).toString('base64url'),
    })).toMatchObject({ ok: false, result: { status: 'invalid-key' } });
    expect(normalizeEs256JoseVerifyRequest({
      key: { x, y },
      data: new Uint8Array(),
      signature: Buffer.alloc(64).toString('base64url'),
    })).toMatchObject({ ok: false, result: { status: 'invalid-input' } });
    expect(redactSignatureVerifyRequest(normalized.request)).toEqual({
      algorithm: 'ES256',
      key: {
        type: 'p256-public-key-bytes',
        compatibleAlgorithms: ['ES256'],
        identity: '[redacted]',
      },
      data: '[redacted]',
      signature: '[redacted]',
    });
    normalized.request.key.bytes.fill(0);
  });

  it('normalizes every result to a frozen status-only object', () => {
    for (const status of CRYPTO_VERIFICATION_STATUSES) {
      const result = normalizeVerificationResult({ status });
      expect(result).toEqual({ status });
      expect(Object.keys(result)).toEqual(['status']);
      expect(Object.isFrozen(result)).toBe(true);
      expect(result).toBe(verificationResult(status));
    }

    expect(normalizeVerificationResult(true)).toBe(
      verificationResult('realization-failure'),
    );
    expect(normalizeVerificationResult({
      status: 'valid',
      backend: { key: 'must-not-escape' },
    })).toBe(verificationResult('realization-failure'));
    expect(normalizeVerificationResult({
      status: 'backend-specific',
    })).toBe(verificationResult('realization-failure'));
  });

  it('detaches byte inputs and applies bounded key, data, and tag contracts', () => {
    const source = request();
    const normalized = normalizeMacVerifyRequest(source);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    expect(normalized.request.key.bytes).not.toBe(source.key.bytes);
    expect(normalized.request.data).not.toBe(source.data);
    expect(normalized.request.tag).not.toBe(source.tag);
    expect(normalized.request.key.bytes).toEqual(source.key.bytes);
    expect(normalized.request.data).toEqual(source.data);
    expect(normalized.request.tag).toEqual(source.tag);
    expect(Object.isFrozen(normalized.request)).toBe(true);
    expect(Object.isFrozen(normalized.request.key)).toBe(true);

    expect(normalizeMacVerifyRequest(request({
      key: { type: 'hmac-key-bytes', bytes: new Uint8Array(31) },
    }))).toMatchObject({ ok: false, result: { status: 'invalid-key' } });
    expect(normalizeMacVerifyRequest(request({
      key: { type: 'asymmetric-public', bytes: new Uint8Array(32) },
    }))).toMatchObject({ ok: false, result: { status: 'invalid-key' } });
    expect(normalizeMacVerifyRequest(request({
      data: new Uint8Array(CRYPTO_RESOURCE_LIMITS.macDataBytesMaximum + 1),
    }))).toMatchObject({ ok: false, result: { status: 'invalid-input' } });
    expect(normalizeMacVerifyRequest(request({
      tag: new Uint8Array(CRYPTO_RESOURCE_LIMITS.hs256TagBytes - 1),
    }))).toMatchObject({ ok: false, result: { status: 'invalid-input' } });
  });

  it('rejects strings, aliases, extra fields, and accessors without invoking them', async () => {
    await expect(verifyMac(request({ algorithm: 'hs256' })))
      .resolves.toBe(verificationResult('invalid-input'));
    await expect(verifyMac(request({ data: 'ambient text' })))
      .resolves.toBe(verificationResult('invalid-input'));
    await expect(verifyMac(request({ tag: 'ambient tag' })))
      .resolves.toBe(verificationResult('invalid-input'));
    await expect(verifyMac({ ...request(), extra: true }))
      .resolves.toBe(verificationResult('invalid-input'));

    let accessorCalled = false;
    const hostile = request();
    Object.defineProperty(hostile, 'data', {
      enumerable: true,
      get() {
        accessorCalled = true;
        return new Uint8Array();
      },
    });
    await expect(verifyMac(hostile))
      .resolves.toBe(verificationResult('invalid-input'));
    expect(accessorCalled).toBe(false);

    const hostileProxy = new Proxy({}, {
      getPrototypeOf() {
        throw new Error('must not escape the crypto boundary');
      },
    });
    await expect(verifyMac(hostileProxy as never))
      .resolves.toBe(verificationResult('invalid-input'));
  });

  it('returns only normalized, redacted realization evidence', async () => {
    const input = request();
    const keyHex = Buffer.from(input.key.bytes).toString('hex');
    const dataHex = Buffer.from(input.data).toString('hex');
    const tagHex = Buffer.from(input.tag).toString('hex');

    await expect(crypto.mac.verify(input))
      .resolves.toBe(verificationResult('invalid-authenticator'));

    const projection = redactMacVerifyRequest(input);
    expect(projection).toEqual({
      algorithm: 'HS256',
      key: {
        type: 'hmac-key-bytes',
        compatibleAlgorithms: ['HS256'],
        identity: '[redacted]',
      },
      data: '[redacted]',
      tag: '[redacted]',
    });
    const evidence = JSON.stringify({
      projection,
      result: await crypto.mac.verify(input),
    });
    expect(evidence).not.toContain(keyHex);
    expect(evidence).not.toContain(dataHex);
    expect(evidence).not.toContain(tagHex);
  });
});
