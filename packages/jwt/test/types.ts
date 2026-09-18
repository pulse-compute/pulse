import type {
  PulseContext,
  PulseParallelEffect,
} from '@pulse-compute/runtime';
import { crypto } from '@pulse-compute/crypto';
import {
  verify,
  sign,
  type JwtClaims,
  type JwtVerification,
} from '../src/index.js';
import {
  verifyJwtWithCrypto,
  type JwtCryptoVerifierHost,
} from '../src/provider.js';

declare const ctx: PulseContext;
declare const token: string | undefined;

const baseOptions = {
  algorithms: ['HS256'] as const,
  key: {
    type: 'secret' as const,
    binding: 'AUTH_JWT',
  },
};

const conservative: PulseParallelEffect<JwtVerification<JwtClaims>> = verify(
  ctx,
  token,
  baseOptions,
);

interface AccessClaims {
  sub: string;
  roles: readonly string[];
}

const typed: PulseParallelEffect<JwtVerification<AccessClaims>> = verify<AccessClaims>(
  ctx,
  token,
  {
    ...baseOptions,
    claimsSchema: 'auth.AccessClaims',
  },
);

// @ts-expect-error A caller-selected claims generic requires runtime schema validation.
verify<AccessClaims>(ctx, token, baseOptions);

void conservative;
void typed;

declare const verifierHost: JwtCryptoVerifierHost;
const semanticVerification: Promise<JwtVerification<JwtClaims>> = verifyJwtWithCrypto(
  {
    token,
    options: {
      algorithms: ['HS256'],
      key: { type: 'secret', binding: 'jwt-key' },
    },
  },
  verifierHost,
  crypto,
);

void semanticVerification;

const issued: PulseParallelEffect<string> = sign(ctx, { sub: 'worker' }, {
  algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 45,
});
void issued;
// @ts-expect-error Signing only accepts HS256.
sign(ctx, {}, { algorithm: 'ES256', key: { type: 'secret', binding: 'KEY' }, expiresInSeconds: 45 });
// @ts-expect-error Signing keys are named bindings, never inline key material.
sign(ctx, {}, { algorithm: 'HS256', key: { type: 'secret', value: 'private' }, expiresInSeconds: 45 });
