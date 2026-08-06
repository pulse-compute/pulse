import type {
  PulseContext,
  PulseParallelEffect,
} from '@pulse-compute/runtime';
import { crypto } from '@pulse-compute/crypto';
import {
  verify,
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
