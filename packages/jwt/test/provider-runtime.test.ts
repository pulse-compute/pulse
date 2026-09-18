import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { JwtError, jwt } from '../src/index.js';

const require = createRequire(import.meta.url);
const { Router } = require('../../runtime/src/index.js') as { Router: new () => any };
const {
  executeNodeJavascriptApplication,
} = require('../../provider-node/src/javascript/runtime-host.js') as {
  executeNodeJavascriptApplication(
    application: object,
    request: Request,
    options?: Record<string, unknown>,
  ): Promise<Response>;
};
const {
  NODE_JAVASCRIPT_JWT_REALIZATION,
  createNodeJavascriptJwtVerify,
} = require('../../provider-node/src/javascript/jwt-verifier.js') as {
  NODE_JAVASCRIPT_JWT_REALIZATION: Readonly<Record<string, unknown>>;
  createNodeJavascriptJwtVerify(options: Record<string, unknown>): (
    effect: object,
    execution: object,
  ) => Promise<unknown>;
};
const {
  executeFastlyJavascriptApplication,
} = require('../../provider-fastly/src/javascript/runtime-host.js') as {
  executeFastlyJavascriptApplication(
    application: object,
    request: Request,
    options?: Record<string, unknown>,
  ): Promise<Response>;
};
const {
  FASTLY_JAVASCRIPT_JWT_REALIZATION,
  FASTLY_JAVASCRIPT_JWT_REALIZATIONS,
} = require('../../provider-fastly/src/javascript/jwt-verifier.js') as {
  FASTLY_JAVASCRIPT_JWT_REALIZATION: Readonly<Record<string, unknown>>;
  FASTLY_JAVASCRIPT_JWT_REALIZATIONS: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};
const {
  classifyNodeJavascriptCapability,
} = require('../../provider-node/src/javascript/target-support-policy.js') as {
  classifyNodeJavascriptCapability(id: string): Readonly<Record<string, unknown>>;
};
const {
  classifyFastlyJavascriptCapability,
} = require('../../provider-fastly/src/javascript/target-support-policy.js') as {
  classifyFastlyJavascriptCapability(
    id: string,
    restrictions?: object,
  ): Readonly<Record<string, unknown>>;
};
const jwtContracts = require('@pulse-compute/wasm-contracts/jwt/contracts') as {
  JWT_TARGET_REALIZATIONS: Readonly<Record<string, any>>;
  JWT_VERIFY_OPERATION: Readonly<Record<string, unknown>>;
  jwtVerifyProviderRequirements(options: object): readonly string[];
  jwtVerifyRedactedProjection(options: object): Readonly<Record<string, unknown>>;
};

const NOW = 1_800_000_000;
const SECRET = 'd3-provider-owned-hs256-secret-material';
const SUBJECT = 'd3-provider-runtime-sensitive-subject';
const ISSUER = 'https://issuer.example';
const AUDIENCE = 'pulse-api';

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function compactToken(
  claims: Readonly<Record<string, unknown>> = {
    sub: SUBJECT,
    tenantId: 'tenant-a',
    iss: ISSUER,
    aud: AUDIENCE,
    iat: NOW - 5,
    exp: NOW + 60,
  },
): string {
  const signingInput = [
    base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64url(JSON.stringify(claims)),
  ].join('.');
  const tag = createHmac('sha256', SECRET)
    .update(signingInput, 'ascii')
    .digest();
  return `${signingInput}.${base64url(tag)}`;
}

function secureApplication(compact = compactToken()): object {
  const app = new Router();
  app.get('/secure', async (ctx: any) => {
    try {
      const verified = await jwt.verify<{ sub: string; tenantId: string }>(
        ctx,
        compact,
        {
          algorithms: ['HS256'],
          key: { type: 'secret', binding: 'AUTH_JWT' },
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: 'JWT',
          requiredClaims: ['exp', 'iat', 'sub'],
          claimsSchema: 'auth.AccessTokenClaims',
        },
      );
      return ctx.json({
        verified: true,
        subject: verified.claims.sub,
        tenant: verified.claims.tenantId,
        algorithm: verified.protectedHeader.alg,
      });
    } catch (error) {
      return ctx.json({
        verified: false,
        jwtError: error instanceof JwtError,
        code: (error as { code?: string }).code,
      });
    }
  });
  return app;
}

function schemaCodecs(schemaCalls: string[]) {
  return {
    ids: ['auth.AccessTokenClaims'],
    has: (schemaId: string) => schemaId === 'auth.AccessTokenClaims',
    decode(schemaId: string, value: any, source: string) {
      schemaCalls.push(`${schemaId}:${source}`);
      return Object.freeze({
        sub: String(value.sub),
        tenantId: String(value.tenantId),
      });
    },
    decodeJsonText: () => {
      throw new Error('JWT claims must use in-memory schema decoding.');
    },
    encodeJsonText: () => {
      throw new Error('Not used by this focused proof.');
    },
  };
}

function fastlyApis(secret: string) {
  return {
    SecretStore: class {
      constructor(readonly name: string) {}
      async get(name: string) {
        if (this.name !== 'pulse_secrets' || name !== 'AUTH_JWT') return null;
        return { plaintext: () => secret };
      }
    },
  };
}

function canonicalEffect(compact = compactToken()) {
  return {
    ...jwtContracts.JWT_VERIFY_OPERATION,
    id: 'jwt-verify-d3',
    payload: {
      token: compact,
      options: {
        algorithms: ['HS256'],
        key: { type: 'secret', binding: 'AUTH_JWT' },
      },
    },
  };
}

describe('D3 JavaScript JWT realization integration', () => {
  it.each([
    ['node', executeNodeJavascriptApplication],
    ['fastly', executeFastlyJavascriptApplication],
  ] as const)('executes %s through runtime-builtin with provider secret, clock, and schema authority', async (
    provider,
    execute,
  ) => {
    const observations: unknown[] = [];
    const schemaCalls: string[] = [];
    let clockCaptures = 0;
    let summary: any;
    const response = await execute(
      secureApplication(),
      new Request('https://example.test/secure'),
      {
        ...(provider === 'node'
          ? { secrets: { AUTH_JWT: SECRET } }
          : {
              apis: fastlyApis(SECRET),
              bindings: { secretStore: 'pulse_secrets' },
            }),
        jwtCaptureWallClock: () => {
          clockCaptures += 1;
          return { unixEpochSeconds: NOW, trusted: true };
        },
        schemaCodecs: schemaCodecs(schemaCalls),
        onEffectObservation: (value: unknown) => observations.push(value),
        onEffectSummary: (value: unknown) => {
          summary = value;
        },
      },
    );

    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toEqual({
      verified: true,
      subject: SUBJECT,
      tenant: 'tenant-a',
      algorithm: 'HS256',
    });
    expect(clockCaptures).toBe(1);
    expect(schemaCalls).toEqual([
      'auth.AccessTokenClaims:jwt-claims',
    ]);
    expect(observations[0]).toMatchObject({
      type: 'effect-dispatched',
      effect: {
        kind: 'jwt.verify',
        contractId: 'pulse.jwt',
      },
    });
    expect(summary.redactedSecretCount).toBeGreaterThanOrEqual(2);
    const evidence = JSON.stringify({ observations, summary });
    expect(evidence).not.toContain(SECRET);
    expect(evidence).not.toContain(SUBJECT);
    expect(evidence).not.toContain(compactToken());
  });

  it.each([
    ['node', executeNodeJavascriptApplication],
    ['fastly', executeFastlyJavascriptApplication],
  ] as const)('keeps %s clock and schema unavailable after invalid authenticity', async (
    provider,
    execute,
  ) => {
    const parts = compactToken().split('.');
    const invalid = `${parts[0]}.${parts[1]}.${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    const schemaCalls: string[] = [];
    let clockCaptures = 0;
    const response = await execute(
      secureApplication(invalid),
      new Request('https://example.test/secure'),
      {
        ...(provider === 'node'
          ? { secrets: { AUTH_JWT: SECRET } }
          : {
              apis: fastlyApis(SECRET),
              bindings: { secretStore: 'pulse_secrets' },
            }),
        jwtCaptureWallClock: () => {
          clockCaptures += 1;
          return { unixEpochSeconds: NOW, trusted: true };
        },
        schemaCodecs: schemaCodecs(schemaCalls),
      },
    );
    expect(await response.json()).toEqual({
      verified: false,
      jwtError: true,
      code: 'PULSE_JWT_SIGNATURE_INVALID',
    });
    expect(clockCaptures).toBe(0);
    expect(schemaCalls).toEqual([]);
  });

  it('contains cancellation within the owning request before secret authority', async () => {
    let secretCalls = 0;
    const controller = new AbortController();
    controller.abort();
    const verify = createNodeJavascriptJwtVerify({
      secretLookup: () => {
        secretCalls += 1;
        return SECRET;
      },
      captureWallClock: () => ({ unixEpochSeconds: NOW, trusted: true }),
    });
    await expect(verify(canonicalEffect(), {
      signal: controller.signal,
      registerRedactionValue() {},
    })).rejects.toMatchObject({
      code: 'PULSE_JWT_OPERATION_FAILED',
      detail: {
        category: 'request-cancelled',
        automaticFallback: false,
      },
    });
    expect(secretCalls).toBe(0);
  });

  it('reports exact HS256/ES256 realizations and blocks unimplemented asymmetric paths', () => {
    const expected = {
      algorithm: 'HS256',
      realization: 'runtime-builtin',
      implementation: 'webcrypto.subtle.hmac-sha-256.v1',
      automaticFallback: false,
    };
    expect(NODE_JAVASCRIPT_JWT_REALIZATION).toEqual(expected);
    expect(FASTLY_JAVASCRIPT_JWT_REALIZATION).toEqual(expected);
    expect(FASTLY_JAVASCRIPT_JWT_REALIZATIONS).toEqual({
      HS256: expected,
      ES256: {
        algorithm: 'ES256',
        realization: 'runtime-builtin',
        implementation: 'webcrypto.subtle.ecdsa-p256-sha-256.v1',
        automaticFallback: false,
      },
    });
    expect(jwtContracts.JWT_TARGET_REALIZATIONS.node.javascript)
      .toMatchObject(expected);
    expect(jwtContracts.JWT_TARGET_REALIZATIONS.fastly.javascript)
      .toMatchObject(expected);
    expect(classifyNodeJavascriptCapability('jwt.verify.hs256')).toMatchObject({
      status: 'eligible',
      reasonId: 'node-javascript-jwt-crypto-runtime-builtin',
    });
    expect(classifyFastlyJavascriptCapability('jwt.verify.hs256')).toMatchObject({
      status: 'eligible',
      reasonId: 'fastly-javascript-jwt-crypto-runtime-builtin',
    });
    expect(classifyFastlyJavascriptCapability('jwt.verify.es256')).toMatchObject({
      status: 'eligible',
      reasonId: 'fastly-javascript-jwt-crypto-runtime-builtin',
    });
    expect(jwtContracts.JWT_TARGET_REALIZATIONS.fastly.javascript)
      .toMatchObject({
        algorithms: ['HS256', 'ES256'],
        keyTypes: ['secret', 'jwk', 'jwks'],
        automaticFallback: false,
      });
    expect(classifyNodeJavascriptCapability('jwt.verify.rs256')).toMatchObject({
      status: 'blocked',
      reasonId: 'jwt-crypto-realization-unavailable',
    });
    expect(classifyFastlyJavascriptCapability('jwt.verify.rs256')).toMatchObject({
      status: 'blocked',
      reasonId: 'jwt-crypto-realization-unavailable',
    });
  });

  it('projects only redacted HS256 requirements', () => {
    const options = {
      algorithms: ['HS256'],
      key: { type: 'secret', binding: 'AUTH_JWT' },
      issuer: ISSUER,
      audience: AUDIENCE,
      claimsSchema: 'auth.AccessTokenClaims',
    };
    expect(jwtContracts.jwtVerifyProviderRequirements(options)).toEqual([
      'jwt.verify',
      'time.wall-clock',
      'jwt.verify.hs256',
      'secret.get',
      'schema.decode',
    ]);
    const projection = jwtContracts.jwtVerifyRedactedProjection(options);
    expect(projection).toMatchObject({
      algorithms: ['HS256'],
      keyType: 'secret',
      keyCount: 1,
      hasClaimsSchema: true,
    });
    expect(JSON.stringify(projection)).not.toContain('AUTH_JWT');
    expect(JSON.stringify(projection)).not.toContain(SECRET);
  });
  it('cancels after secret resolution without reading the clock or releasing a token', async () => {
    const controller = new AbortController();
    let clocks = 0;
    const execute = createNodeJavascriptJwtVerify({
      secretLookup: async () => { controller.abort(); return SECRET; },
      captureWallClock: () => { clocks++; return { trusted: true, unixEpochSeconds: 1 }; },
    });
    const effect = { package: '@pulse-compute/jwt', contractId: 'pulse.jwt', providerKind: 'jwt',
      kind: 'jwt.sign', operation: 'sign', capability: 'jwt.sign', result: 'string', payload: { claims: {}, options: { algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 45 } } };
    await expect(execute(effect, { signal: controller.signal })).rejects.toHaveProperty('code');
    expect(clocks).toBe(0);
  });
});
