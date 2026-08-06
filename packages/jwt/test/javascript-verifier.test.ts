import { createHmac } from 'node:crypto';
import {
  CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION,
  crypto as selectedCrypto,
} from '@pulse-compute/crypto';
import { describe, expect, it } from 'vitest';
import * as jwtProvider from '../src/provider.js';

const NOW = 1_800_000_000;
const SECRET = 'd3-runtime-builtin-secret-material-32-bytes';

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function token(
  claims: Readonly<Record<string, unknown>> = {
    sub: 'd3-account',
    iat: NOW,
    exp: NOW + 60,
  },
): string {
  const signingInput = [
    base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64url(JSON.stringify(claims)),
  ].join('.');
  const signature = createHmac('sha256', SECRET)
    .update(signingInput, 'ascii')
    .digest();
  return `${signingInput}.${base64url(signature)}`;
}

function input(compact = token()) {
  return {
    token: compact,
    options: {
      algorithms: ['HS256'] as const,
      key: { type: 'secret' as const, binding: 'AUTH_JWT' },
      typ: 'JWT',
    },
  };
}

describe('D3 JWT provider surface', () => {
  it('exports only the crypto-owned authenticity seam', () => {
    expect(jwtProvider.verifyJwtWithCrypto).toBeTypeOf('function');
    expect(jwtProvider).not.toHaveProperty('verifyJwtWithJose');
    expect(jwtProvider).not.toHaveProperty('verifyJwtWithHostCrypto');
    expect(CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION)
      .toBe('webcrypto.subtle.hmac-sha-256.v1');
  });

  it('executes HS256 through the selected runtime-builtin crypto operation', async () => {
    let clocks = 0;
    const result = await jwtProvider.verifyJwtWithCrypto(
      input(),
      {
        resolveSecret: (binding) => binding === 'AUTH_JWT' ? SECRET : undefined,
        captureWallClock: () => {
          clocks += 1;
          return { unixEpochSeconds: NOW, trusted: true };
        },
      },
      selectedCrypto,
    );
    expect(result).toEqual({
      claims: { sub: 'd3-account', iat: NOW, exp: NOW + 60 },
      protectedHeader: { alg: 'HS256', typ: 'JWT' },
    });
    expect(clocks).toBe(1);
  });

  it('does not expose claims or capture time after an invalid authenticator', async () => {
    const parts = token().split('.');
    const invalid = `${parts[0]}.${parts[1]}.${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    let clocks = 0;
    let claimsObserved = false;
    await expect(jwtProvider.verifyJwtWithCrypto(
      input(invalid),
      {
        resolveSecret: () => SECRET,
        captureWallClock: () => {
          clocks += 1;
          return { unixEpochSeconds: NOW, trusted: true };
        },
        validateClaims: () => {
          claimsObserved = true;
          return {};
        },
      },
      selectedCrypto,
    )).rejects.toMatchObject({ code: 'PULSE_JWT_SIGNATURE_INVALID' });
    expect(clocks).toBe(0);
    expect(claimsObserved).toBe(false);
  });
});
