import { createHmac, createPrivateKey, sign } from 'node:crypto';
import {
  crypto as pulseCrypto,
  type CryptoVerificationResult,
  type MacVerifyRequest,
} from '@pulse-compute/crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyJwtWithCrypto,
  type JwtCryptoVerifier,
  type JwtCryptoVerifierHost,
  type JwtVerifyOptions,
} from '../src/provider.js';

const NOW = 1_800_000_000;
const ISSUER = 'https://issuer.example';
const AUDIENCE = 'pulse-api';
const SUBJECT = 'D2_CLAIMS_MUST_REMAIN_UNAVAILABLE';
const SECRET_BINDING = 'JWT_D2_SECRET';
const SECRET_TEXT = 'd2-secret-material-is-at-least-thirty-two-bytes';
const SECRET_BYTES = new TextEncoder().encode(SECRET_TEXT);
const ES256_X = 'YP7UuiVanTHJYet0xjVtaMBJuJI7Yfps5mliLmDyn7Y';
const ES256_Y = 'eQP-EAi4vJmkGunpVii8ZPLxsgwtfp9Rd6PClNRGIpk';
const ES256_D = 'ya-p2EW6dRZrXCFXZ7HWk05Qw9s26JsSe4piKxIPZyE';
const ES256_JWK = Object.freeze({
  kty: 'EC',
  crv: 'P-256',
  x: ES256_X,
  y: ES256_Y,
  alg: 'ES256',
  use: 'sig',
  key_ops: Object.freeze(['verify']),
  kid: 'g3-key',
});
const ES256_PRIVATE_KEY = createPrivateKey({
  key: {
    ...ES256_JWK,
    d: ES256_D,
    key_ops: undefined,
  },
  format: 'jwk',
});

interface CompactFixture {
  readonly token: string;
  readonly signingInput: string;
  readonly tag: Uint8Array;
}

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function compact(
  protectedHeaderText: string,
  claimsText: string,
  secret: Uint8Array = SECRET_BYTES,
): CompactFixture {
  const signingInput = `${base64url(protectedHeaderText)}.${base64url(claimsText)}`;
  const tag = new Uint8Array(
    createHmac('sha256', secret).update(signingInput, 'ascii').digest(),
  );
  return Object.freeze({
    token: `${signingInput}.${base64url(tag)}`,
    signingInput,
    tag,
  });
}

function compactEs256(
  protectedHeaderText: string,
  claims: string,
): CompactFixture {
  const signingInput = `${base64url(protectedHeaderText)}.${base64url(claims)}`;
  const tag = new Uint8Array(sign('sha256', Buffer.from(signingInput, 'ascii'), {
    key: ES256_PRIVATE_KEY,
    dsaEncoding: 'ieee-p1363',
  }));
  return Object.freeze({
    token: `${signingInput}.${base64url(tag)}`,
    signingInput,
    tag,
  });
}

function claimsText(overrides: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    sub: SUBJECT,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: NOW - 10,
    exp: NOW + 60,
    roles: ['member'],
    ...overrides,
  });
}

function options(
  overrides: Partial<JwtVerifyOptions> = {},
): JwtVerifyOptions {
  return {
    algorithms: ['HS256'],
    key: { type: 'secret', binding: SECRET_BINDING },
    issuer: ISSUER,
    audience: AUDIENCE,
    typ: 'JWT',
    requiredClaims: ['sub', 'iat', 'exp'],
    ...overrides,
  };
}

function host(
  overrides: Partial<JwtCryptoVerifierHost> = {},
): JwtCryptoVerifierHost {
  return {
    resolveSecret: (binding) => binding === SECRET_BINDING ? SECRET_TEXT : undefined,
    captureWallClock: () => ({ unixEpochSeconds: NOW, trusted: true }),
    ...overrides,
  };
}

function cryptoVerifier(
  verify: (
    request: MacVerifyRequest,
  ) => CryptoVerificationResult | PromiseLike<CryptoVerificationResult>,
): JwtCryptoVerifier {
  return Object.freeze({
    mac: Object.freeze({ verify }),
  });
}

function validFixture(
  claims = claimsText(),
): CompactFixture {
  return compact(
    '{ "kid":"d2-key", "typ":"JWT", "alg":"HS256" }',
    claims,
  );
}

describe('strict JWT-over-crypto composition', () => {
  it('passes the exact original JWS bytes to crypto, then validates time and schema once', async () => {
    const fixture = validFixture();
    const order: string[] = [];
    const sensitive: (string | Uint8Array)[] = [];
    let requestKey: Uint8Array | undefined;
    const selectedCrypto = cryptoVerifier(async (request) => {
      order.push('crypto');
      requestKey = request.key.bytes;
      expect(Object.keys(request)).toEqual(['algorithm', 'key', 'data', 'tag']);
      expect(Object.keys(request.key)).toEqual(['type', 'bytes']);
      expect(request.algorithm).toBe('HS256');
      expect(request.key.type).toBe('hmac-key-bytes');
      expect(request.key.bytes).toEqual(SECRET_BYTES);
      expect(new TextDecoder().decode(request.data)).toBe(fixture.signingInput);
      expect(request.tag).toEqual(fixture.tag);
      expect(sensitive).not.toContain(SUBJECT);
      return pulseCrypto.mac.verify(request);
    });

    const result = await verifyJwtWithCrypto<{ sub: string; roles: readonly string[] }>(
      {
        token: fixture.token,
        options: options({ claimsSchema: 'auth.AccessClaims' }),
      },
      host({
        resolveSecret: (binding) => {
          order.push('secret');
          return binding === SECRET_BINDING ? SECRET_TEXT : undefined;
        },
        captureWallClock: () => {
          order.push('clock');
          return { unixEpochSeconds: NOW, trusted: true };
        },
        validateClaims: (schemaId, claims, context) => {
          order.push('schema');
          expect(schemaId).toBe('auth.AccessClaims');
          expect(context).toEqual({ source: 'jwt-claims' });
          return { sub: claims.sub, roles: claims.roles };
        },
        registerSensitiveValue: (value) => sensitive.push(value),
      }),
      selectedCrypto,
    );

    expect(order).toEqual(['secret', 'crypto', 'clock', 'schema']);
    expect(result).toEqual({
      claims: { sub: SUBJECT, roles: ['member'] },
      protectedHeader: { alg: 'HS256', kid: 'd2-key', typ: 'JWT' },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.claims)).toBe(true);
    expect(Object.isFrozen(result.claims.roles)).toBe(true);
    expect(Object.isFrozen(result.protectedHeader)).toBe(true);
    expect(sensitive).toContain(fixture.token);
    expect(sensitive).toContain(SECRET_TEXT);
    expect(sensitive).toContain(SUBJECT);
    expect(requestKey).toEqual(new Uint8Array(SECRET_BYTES.byteLength));
  });

  it('rejects altered protected header, payload, or authenticator before claims authority', async () => {
    const fixture = validFixture();
    const segments = fixture.token.split('.');
    const alteredTag = new Uint8Array(fixture.tag);
    alteredTag[0] ^= 0x80;
    const altered = [
      `${base64url('{"alg":"HS256","typ":"JWT","kid":"d2-key","altered":true}')}.${segments[1]}.${segments[2]}`,
      `${segments[0]}.${base64url(claimsText({ sub: 'altered-subject' }))}.${segments[2]}`,
      `${segments[0]}.${segments[1]}.${base64url(alteredTag)}`,
    ];

    for (const token of altered) {
      let cryptoCalls = 0;
      let clockCalls = 0;
      let schemaCalls = 0;
      const sensitive: (string | Uint8Array)[] = [];
      await expect(verifyJwtWithCrypto(
        {
          token,
          options: options({ claimsSchema: 'auth.AccessClaims' }),
        },
        host({
          captureWallClock: () => {
            clockCalls += 1;
            return { unixEpochSeconds: NOW, trusted: true };
          },
          validateClaims: () => {
            schemaCalls += 1;
            return {};
          },
          registerSensitiveValue: (value) => sensitive.push(value),
        }),
        cryptoVerifier((request) => {
          cryptoCalls += 1;
          return pulseCrypto.mac.verify(request);
        }),
      )).rejects.toMatchObject({ code: 'PULSE_JWT_SIGNATURE_INVALID' });
      expect(cryptoCalls).toBe(1);
      expect(clockCalls).toBe(0);
      expect(schemaCalls).toBe(0);
      expect(sensitive).not.toContain(SUBJECT);
      expect(sensitive).not.toContain('altered-subject');
    }
  });

  it('rejects malformed compact input, duplicate alg, none, and disallowed algorithms before authority', async () => {
    const emptyClaims = base64url('{}');
    const validHeader = base64url('{"alg":"HS256"}');
    const malformed = [
      `${base64url('{"alg":"HS256","alg":"HS256"}')}.${emptyClaims}.AA`,
      `${validHeader}=.${emptyClaims}.AA`,
      `${validHeader}.${emptyClaims}.AB`,
      `${base64url(new Uint8Array([0xff]))}.${emptyClaims}.AA`,
      `${base64url('{"alg":')}.${emptyClaims}.AA`,
      `${validHeader}.${emptyClaims}`,
      `${validHeader}.${'a'.repeat(17 * 1024)}.AA`,
    ];
    let secretCalls = 0;
    let cryptoCalls = 0;
    let clockCalls = 0;
    let schemaCalls = 0;
    const authority = host({
      resolveSecret: () => {
        secretCalls += 1;
        return SECRET_TEXT;
      },
      captureWallClock: () => {
        clockCalls += 1;
        return { unixEpochSeconds: NOW, trusted: true };
      },
      validateClaims: () => {
        schemaCalls += 1;
        return {};
      },
    });
    const selectedCrypto = cryptoVerifier(() => {
      cryptoCalls += 1;
      return { status: 'valid' };
    });

    for (const token of malformed) {
      await expect(verifyJwtWithCrypto(
        { token, options: options({ claimsSchema: 'auth.AccessClaims' }) },
        authority,
        selectedCrypto,
      )).rejects.toMatchObject({
        code: token.includes('a'.repeat(17 * 1024))
          ? 'PULSE_JWT_LIMIT_EXCEEDED'
          : 'PULSE_JWT_MALFORMED',
      });
    }

    for (const algorithm of ['none', 'RS256']) {
      const token = `${base64url(JSON.stringify({ alg: algorithm }))}.${emptyClaims}.AA`;
      await expect(verifyJwtWithCrypto(
        { token, options: options({ claimsSchema: 'auth.AccessClaims' }) },
        authority,
        selectedCrypto,
      )).rejects.toMatchObject({ code: 'PULSE_JWT_ALGORITHM_NOT_ALLOWED' });
    }
    expect(secretCalls).toBe(0);
    expect(cryptoCalls).toBe(0);
    expect(clockCalls).toBe(0);
    expect(schemaCalls).toBe(0);
  });

  it('parses claims only after valid authenticity and keeps malformed claims unavailable', async () => {
    const duplicateClaims = '{"sub":"first","sub":"second"}';
    const fixture = validFixture(duplicateClaims);
    let cryptoCalls = 0;
    let clockCalls = 0;
    let schemaCalls = 0;
    const selectedCrypto = cryptoVerifier((request) => {
      cryptoCalls += 1;
      return pulseCrypto.mac.verify(request);
    });
    const authority = host({
      captureWallClock: () => {
        clockCalls += 1;
        return { unixEpochSeconds: NOW, trusted: true };
      },
      validateClaims: () => {
        schemaCalls += 1;
        return {};
      },
    });

    await expect(verifyJwtWithCrypto(
      {
        token: fixture.token,
        options: options({ claimsSchema: 'auth.AccessClaims' }),
      },
      authority,
      selectedCrypto,
    )).rejects.toMatchObject({ code: 'PULSE_JWT_MALFORMED' });
    expect(cryptoCalls).toBe(1);
    expect(clockCalls).toBe(0);
    expect(schemaCalls).toBe(0);

    const alteredTag = new Uint8Array(fixture.tag);
    alteredTag[0] ^= 0x01;
    const segments = fixture.token.split('.');
    await expect(verifyJwtWithCrypto(
      {
        token: `${segments[0]}.${segments[1]}.${base64url(alteredTag)}`,
        options: options({ claimsSchema: 'auth.AccessClaims' }),
      },
      authority,
      selectedCrypto,
    )).rejects.toMatchObject({ code: 'PULSE_JWT_SIGNATURE_INVALID' });
    expect(cryptoCalls).toBe(2);
    expect(clockCalls).toBe(0);
    expect(schemaCalls).toBe(0);
  });

  it('maps the closed crypto result taxonomy without retrying another realization', async () => {
    const fixture = validFixture();
    const cases = [
      {
        status: 'invalid-authenticator',
        code: 'PULSE_JWT_SIGNATURE_INVALID',
      },
      {
        status: 'invalid-key',
        code: 'PULSE_JWT_KEY_INVALID',
      },
      {
        status: 'invalid-input',
        code: 'PULSE_JWT_MALFORMED',
      },
      {
        status: 'realization-failure',
        code: 'PULSE_JWT_OPERATION_FAILED',
      },
    ] as const;

    for (const entry of cases) {
      let calls = 0;
      let clockCalls = 0;
      let schemaCalls = 0;
      let caught: unknown;
      try {
        await verifyJwtWithCrypto(
          {
            token: fixture.token,
            options: options({ claimsSchema: 'auth.AccessClaims' }),
          },
          host({
            captureWallClock: () => {
              clockCalls += 1;
              return { unixEpochSeconds: NOW, trusted: true };
            },
            validateClaims: () => {
              schemaCalls += 1;
              return {};
            },
          }),
          cryptoVerifier(() => {
            calls += 1;
            return { status: entry.status };
          }),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: entry.code });
      if (entry.status === 'realization-failure') {
        expect(caught).toMatchObject({
          detail: {
            category: 'crypto-realization',
            automaticFallback: false,
          },
        });
      }
      expect(calls).toBe(1);
      expect(clockCalls).toBe(0);
      expect(schemaCalls).toBe(0);
    }
  });

  it('normalizes backend exceptions and malformed result objects without leaking data', async () => {
    const fixture = validFixture();
    const backendMarker = 'D2_BACKEND_EXCEPTION_MUST_NOT_ESCAPE';
    const failures: JwtCryptoVerifier[] = [
      cryptoVerifier(() => {
        throw new Error(backendMarker);
      }),
      cryptoVerifier(() => ({
        status: 'valid',
        backend: backendMarker,
      } as never)),
    ];

    for (const selectedCrypto of failures) {
      let caught: unknown;
      try {
        await verifyJwtWithCrypto(
          { token: fixture.token, options: options() },
          host(),
          selectedCrypto,
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: 'PULSE_JWT_OPERATION_FAILED' });
      const serialized = `${String(caught)}\n${JSON.stringify(caught)}\n${(caught as Error).stack ?? ''}`;
      expect(serialized).not.toContain(backendMarker);
      expect(serialized).not.toContain(fixture.token);
      expect(serialized).not.toContain(SUBJECT);
      expect(serialized).not.toContain(SECRET_TEXT);
    }

    let accessorCalls = 0;
    let secretCalls = 0;
    const hostileCrypto: Record<string, unknown> = {};
    Object.defineProperty(hostileCrypto, 'mac', {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return pulseCrypto.mac;
      },
    });
    await expect(verifyJwtWithCrypto(
      { token: fixture.token, options: options() },
      host({
        resolveSecret: () => {
          secretCalls += 1;
          return SECRET_TEXT;
        },
      }),
      hostileCrypto as unknown as JwtCryptoVerifier,
    )).rejects.toMatchObject({ code: 'PULSE_JWT_TARGET_UNSUPPORTED' });
    expect(accessorCalls).toBe(0);
    expect(secretCalls).toBe(0);
  });

  it('runs registered claims before schema and captures exactly one post-authenticity instant', async () => {
    const expired = compact(
      '{"alg":"HS256","typ":"JWT"}',
      claimsText({ exp: NOW }),
    );
    const order: string[] = [];
    await expect(verifyJwtWithCrypto(
      {
        token: expired.token,
        options: options({ claimsSchema: 'auth.AccessClaims' }),
      },
      host({
        captureWallClock: () => {
          order.push('clock');
          return { unixEpochSeconds: NOW, trusted: true };
        },
        validateClaims: () => {
          order.push('schema');
          return {};
        },
      }),
      cryptoVerifier(async (request) => {
        order.push('crypto');
        return pulseCrypto.mac.verify(request);
      }),
    )).rejects.toMatchObject({ code: 'PULSE_JWT_CLAIMS_INVALID' });
    expect(order).toEqual(['crypto', 'clock']);

    let clockAccessorCalls = 0;
    let schemaCalls = 0;
    const hostileClockHost: Record<string, unknown> = {
      resolveSecret: () => SECRET_TEXT,
      validateClaims: () => {
        schemaCalls += 1;
        return {};
      },
    };
    Object.defineProperty(hostileClockHost, 'captureWallClock', {
      enumerable: true,
      get() {
        clockAccessorCalls += 1;
        return () => ({ unixEpochSeconds: NOW, trusted: true });
      },
    });
    await expect(verifyJwtWithCrypto(
      {
        token: validFixture().token,
        options: options({ claimsSchema: 'auth.AccessClaims' }),
      },
      hostileClockHost as JwtCryptoVerifierHost,
      pulseCrypto,
    )).rejects.toMatchObject({ code: 'PULSE_JWT_CLOCK_INVALID' });
    expect(clockAccessorCalls).toBe(0);
    expect(schemaCalls).toBe(0);
  });

  it('maps an undersized HS256 secret to key-invalid before clock or schema work', async () => {
    const fixture = validFixture();
    let clockCalls = 0;
    let schemaCalls = 0;
    await expect(verifyJwtWithCrypto(
      {
        token: fixture.token,
        options: options({ claimsSchema: 'auth.AccessClaims' }),
      },
      host({
        resolveSecret: () => 'too-short',
        captureWallClock: () => {
          clockCalls += 1;
          return { unixEpochSeconds: NOW, trusted: true };
        },
        validateClaims: () => {
          schemaCalls += 1;
          return {};
        },
      }),
      pulseCrypto,
    )).rejects.toMatchObject({ code: 'PULSE_JWT_KEY_INVALID' });
    expect(clockCalls).toBe(0);
    expect(schemaCalls).toBe(0);
  });

  it('verifies ES256 through the crypto signature seam with inline JWK and bounded JWKS selection', async () => {
    const fixture = compactEs256(
      '{"typ":"JWT","kid":"g3-key","alg":"ES256"}',
      claimsText(),
    );
    for (const key of [
      { type: 'jwk' as const, key: ES256_JWK },
      {
        type: 'jwks' as const,
        keys: [
          {
            ...ES256_JWK,
            kid: 'other-key',
            x: 'axK0EP8Z3mS0U9G2cKvePr-KttmYZx6rYt7c9RD2Ozs',
            y: 'azRWSQGQmzCOTWxaWovfTLgA5fP7pmuFq3XPvt2u9xU',
          },
          ES256_JWK,
        ],
      },
    ]) {
      const result = await verifyJwtWithCrypto(
        {
          token: fixture.token,
          options: options({
            algorithms: ['ES256'],
            key,
          }),
        },
        host(),
        pulseCrypto,
      );
      expect(result.protectedHeader).toEqual({
        alg: 'ES256',
        kid: 'g3-key',
        typ: 'JWT',
      });
      expect(result.claims.sub).toBe(SUBJECT);
    }
  });

  it('rejects missing, unknown, duplicate, and selected-key mismatch without fallback', async () => {
    const withKid = compactEs256(
      '{"alg":"ES256","kid":"unknown","typ":"JWT"}',
      claimsText(),
    );
    const withoutKid = compactEs256('{"alg":"ES256","typ":"JWT"}', claimsText());
    const other = { ...ES256_JWK, kid: 'other' };
    const cases = [
      {
        token: withKid.token,
        key: { type: 'jwks' as const, keys: [ES256_JWK, other] },
        category: 'unknown-kid',
      },
      {
        token: withoutKid.token,
        key: { type: 'jwks' as const, keys: [ES256_JWK, other] },
        category: 'ambiguous-key',
      },
    ];
    for (const entry of cases) {
      await expect(verifyJwtWithCrypto(
        {
          token: entry.token,
          options: options({ algorithms: ['ES256'], key: entry.key }),
        },
        host(),
        pulseCrypto,
      )).rejects.toMatchObject({
        code: 'PULSE_JWT_KEY_INVALID',
        detail: { category: entry.category },
      });
    }
    expect(() => options({
      algorithms: ['ES256'],
      key: { type: 'jwks', keys: [ES256_JWK, { ...ES256_JWK }] },
    })).not.toThrow();
    await expect(verifyJwtWithCrypto(
      {
        token: compactEs256(
          '{"alg":"ES256","kid":"g3-key","typ":"JWT"}',
          claimsText(),
        ).token,
        options: options({
          algorithms: ['ES256'],
          key: { type: 'jwks', keys: [ES256_JWK, { ...ES256_JWK }] },
        }),
      },
      host(),
      pulseCrypto,
    )).rejects.toMatchObject({
      code: 'PULSE_JWT_KEY_INVALID',
      detail: { category: 'duplicate-kid' },
    });
  });

  it('keeps ES256 claims unavailable until authenticity and distinguishes realization failure', async () => {
    const fixture = compactEs256(
      '{"alg":"ES256","kid":"g3-key","typ":"JWT"}',
      claimsText(),
    );
    const segments = fixture.token.split('.');
    const wrongSignature = new Uint8Array(fixture.tag);
    wrongSignature[63] ^= 1;
    let clockCalls = 0;
    let schemaCalls = 0;
    await expect(verifyJwtWithCrypto(
      {
        token: `${segments[0]}.${segments[1]}.${base64url(wrongSignature)}`,
        options: options({
          algorithms: ['ES256'],
          key: { type: 'jwk', key: ES256_JWK },
          claimsSchema: 'auth.AccessClaims',
        }),
      },
      host({
        captureWallClock: () => {
          clockCalls += 1;
          return { unixEpochSeconds: NOW, trusted: true };
        },
        validateClaims: () => {
          schemaCalls += 1;
          return {};
        },
      }),
      pulseCrypto,
    )).rejects.toMatchObject({ code: 'PULSE_JWT_SIGNATURE_INVALID' });
    expect(clockCalls).toBe(0);
    expect(schemaCalls).toBe(0);

    let signatureCalls = 0;
    await expect(verifyJwtWithCrypto(
      {
        token: fixture.token,
        options: options({
          algorithms: ['ES256'],
          key: { type: 'jwk', key: ES256_JWK },
        }),
      },
      host(),
      {
        mac: pulseCrypto.mac,
        signature: {
          verify() {
            signatureCalls += 1;
            return { status: 'realization-failure' };
          },
        },
      },
    )).rejects.toMatchObject({
      code: 'PULSE_JWT_OPERATION_FAILED',
      detail: {
        category: 'crypto-realization',
        automaticFallback: false,
      },
    });
    expect(signatureCalls).toBe(1);
  });
});
