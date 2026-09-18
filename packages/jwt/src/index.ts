import type {
  PulseContext,
  PulseParallelEffect,
} from '@pulse-compute/runtime';
import { bearer } from './bearer.js';
import { JwtError, JWT_ERROR_CODES } from './errors.js';
import {
  normalizeJwtVerifyOptions,
  type JwtClaims,
  type JwtVerifyOptions,
} from './options.js';
import {
  normalizeJwtVerification,
  type JwtVerification,
} from './result.js';
import { preflightCompactJwt } from './token.js';
import { pulseJwtRuntime } from './internal/package-runtime.js';
import { normalizeJwtSignClaims, normalizeJwtSignOptions, normalizeJwtSignature, type JwtSignOptions } from './sign.js';
export type { JwtSignOptions } from './sign.js';

export { bearer, JwtError, JWT_ERROR_CODES };
export type {
  JwtErrorCode,
  JwtErrorDetailValue,
} from './errors.js';
export type {
  JwtAlgorithm,
  JwtClaims,
  JwtJsonPrimitive,
  JwtJsonValue,
  JwtPublicJwk,
  JwtVerificationKey,
  JwtVerifyOptions,
} from './options.js';
export type {
  DeepReadonly,
  JwtProtectedHeader,
  JwtVerification,
} from './result.js';

export function verify<Claims>(
  ctx: PulseContext,
  token: string | undefined,
  options: JwtVerifyOptions & { readonly claimsSchema: string },
): PulseParallelEffect<JwtVerification<Claims>>;
export function verify(
  ctx: PulseContext,
  token: string | undefined,
  options: JwtVerifyOptions,
): PulseParallelEffect<JwtVerification<JwtClaims>>;
export function verify(
  ctx: PulseContext,
  token: string | undefined,
  options: JwtVerifyOptions,
): PulseParallelEffect<JwtVerification<JwtClaims>> {
  preflightCompactJwt(token);
  const normalized = normalizeJwtVerifyOptions(options);
  return pulseJwtRuntime.effect(
    ctx,
    'verify',
    {
      token: token as string,
      options: normalized,
    },
    (value) => normalizeJwtVerification(value),
  );
}

export function sign(ctx: PulseContext, claims: JwtClaims, options: JwtSignOptions): PulseParallelEffect<string> {
  return pulseJwtRuntime.effect(ctx, 'sign', {
    claims: normalizeJwtSignClaims(claims),
    options: normalizeJwtSignOptions(options),
  }, normalizeJwtSignature);
}

export const jwt = Object.freeze({
  bearer,
  verify,
  sign,
});

export default jwt;
