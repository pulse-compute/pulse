import { describe, expect, it } from 'vitest';
import {
  normalizeJwtVerification,
  normalizeJwtVerifyOptions,
} from '../src/provider.js';
import {
  JWT_ES256_KEY_NORMALIZATION_CONTRACT,
} from '../src/options.js';

const rsa = Object.freeze({
  kty: 'RSA',
  kid: 'rsa-1',
  alg: 'RS256',
  use: 'sig',
  n: 'AQAB',
  e: 'AQAB',
});

describe('JWT option normalization', () => {
  it('activates the bounded ES256 JWK/JWKS rules', () => {
    expect(JWT_ES256_KEY_NORMALIZATION_CONTRACT).toMatchObject({
      status: 'executable-g3',
      algorithm: 'ES256',
      inlineJwk: {
        requiredMembers: ['kty', 'crv', 'x', 'y'],
        optionalMembers: ['alg', 'use', 'key_ops', 'kid'],
        coordinateEncoding: 'canonical-unpadded-base64url',
        coordinateBytes: 32,
        privateMembersRejected: true,
        unknownMembersRejected: true,
        certificateMembersRejected: true,
      },
      jwks: {
        entriesMaximum: 16,
        remoteDiscovery: false,
        duplicateKid: 'reject-entire-set',
        selection: 'kid-exact-or-single-eligible-key',
        selectedKeyFailure: 'terminal-no-retry',
      },
      cryptoAdapter: {
        publicKeyBytes: 64,
        signatureBytes: 64,
        derAccepted: false,
        highS: 'accepted-if-otherwise-valid',
      },
      exactSigningInput: true,
      claimsBeforeAuthenticity: false,
      automaticFallback: false,
    });
    expect(Object.isFrozen(JWT_ES256_KEY_NORMALIZATION_CONTRACT)).toBe(true);
    expect(Object.isFrozen(JWT_ES256_KEY_NORMALIZATION_CONTRACT.inlineJwk))
      .toBe(true);
    expect(Object.isFrozen(JWT_ES256_KEY_NORMALIZATION_CONTRACT.jwks))
      .toBe(true);
  });

  it('detaches and recursively freezes the bounded HS256 secret policy', () => {
    const source = {
      algorithms: ['HS256'] as const,
      key: {
        type: 'secret' as const,
        binding: 'AUTH_JWT',
      },
      issuer: ['https://issuer.example'],
      audience: 'pulse-api',
      requiredClaims: ['exp', 'sub'],
      clockToleranceSeconds: 30,
      claimsSchema: 'auth.AccessTokenClaims',
    };
    const normalized = normalizeJwtVerifyOptions(source);
    expect(normalized).toEqual(source);
    expect(normalized).not.toBe(source);
    expect(normalized.key).not.toBe(source.key);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.algorithms)).toBe(true);
    expect(Object.isFrozen(normalized.key)).toBe(true);
  });

  it('rejects private key members, duplicate kids, and key/algorithm mismatch', () => {
    expect(() => normalizeJwtVerifyOptions({
      algorithms: ['RS256'],
      key: { type: 'jwk', key: { ...rsa, d: 'private' } as never },
    })).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));

    expect(() => normalizeJwtVerifyOptions({
      algorithms: ['RS256'],
      key: { type: 'jwks', keys: [rsa, { ...rsa }] },
    })).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));

    expect(() => normalizeJwtVerifyOptions({
      algorithms: ['ES256'],
      key: { type: 'jwk', key: rsa },
    })).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));
  });

  it('enforces bounded policy collections', () => {
    expect(() => normalizeJwtVerifyOptions({
      algorithms: ['HS256'],
      key: { type: 'secret', binding: 'AUTH_JWT' },
      requiredClaims: Array.from({ length: 33 }, (_, index) => `claim-${index}`),
    })).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_LIMIT_EXCEEDED' }));

    expect(() => normalizeJwtVerifyOptions({
      algorithms: ['HS256'],
      key: { type: 'secret', binding: 'AUTH_JWT' },
      clockToleranceSeconds: 301,
    })).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_LIMIT_EXCEEDED' }));
  });

  it('rejects accessors without invoking policy or result values', () => {
    let policyAccessorCalled = false;
    const algorithms: unknown[] = [];
    Object.defineProperty(algorithms, '0', {
      enumerable: true,
      get() {
        policyAccessorCalled = true;
        return 'HS256';
      },
    });
    algorithms.length = 1;
    expect(() => normalizeJwtVerifyOptions({
      algorithms: algorithms as never,
      key: { type: 'secret', binding: 'AUTH_JWT' },
    })).toThrow();
    expect(policyAccessorCalled).toBe(false);

    let resultAccessorCalled = false;
    const claims: Record<string, unknown> = {};
    Object.defineProperty(claims, 'sub', {
      enumerable: true,
      get() {
        resultAccessorCalled = true;
        return 'must-not-run';
      },
    });
    expect(() => normalizeJwtVerification({
      claims,
      protectedHeader: { alg: 'HS256' },
    })).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_OPERATION_FAILED' }));
    expect(resultAccessorCalled).toBe(false);

    let optionAccessorCalled = false;
    const hostileOptions: Record<string, unknown> = {
      key: { type: 'secret', binding: 'AUTH_JWT' },
    };
    Object.defineProperty(hostileOptions, 'algorithms', {
      enumerable: true,
      get() {
        optionAccessorCalled = true;
        return ['HS256'];
      },
    });
    expect(() => normalizeJwtVerifyOptions(hostileOptions as never))
      .toThrowError(expect.objectContaining({ code: 'PULSE_JWT_OPERATION_FAILED' }));
    expect(optionAccessorCalled).toBe(false);

    let keyAccessorCalled = false;
    const hostileKey: Record<string, unknown> = { ...rsa };
    Object.defineProperty(hostileKey, 'kty', {
      enumerable: true,
      get() {
        keyAccessorCalled = true;
        return 'RSA';
      },
    });
    expect(() => normalizeJwtVerifyOptions({
      algorithms: ['RS256'],
      key: { type: 'jwk', key: hostileKey as never },
    })).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));
    expect(keyAccessorCalled).toBe(false);
  });

  it('copies reserved JSON property names without mutating result prototypes', () => {
    const claims = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"claim-value","sub":"account-1"}',
    ) as Record<string, unknown>;
    const result = normalizeJwtVerification({
      claims,
      protectedHeader: { alg: 'HS256' },
    });
    expect(Object.getPrototypeOf(result.claims)).toBe(Object.prototype);
    expect(Object.hasOwn(result.claims, '__proto__')).toBe(true);
    expect((result.claims as any).__proto__).toEqual({ polluted: true });
    expect(({} as any).polluted).toBeUndefined();
  });
});
