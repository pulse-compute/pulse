import { jwtError } from '../errors.js';
import type {
  JwtClaims,
  NormalizedJwtVerifyOptions,
} from '../options.js';
import { jwtOwnDataProperty } from './data.js';

function requiredClaim(
  claims: JwtClaims,
  name: string,
): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(claims, name);
  return Boolean(
    descriptor
    && descriptor.enumerable
    && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    && descriptor.value !== undefined,
  );
}

function numericClaim(
  claims: JwtClaims,
  name: 'exp' | 'nbf' | 'iat',
): number | undefined {
  const property = jwtOwnDataProperty(claims, name);
  if (!property.valid) throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: name });
  const value = property.present ? property.value : undefined;
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: name });
  }
  return value;
}

function acceptedValues(value: string | readonly string[]): readonly string[] {
  return Array.isArray(value) ? value : [value as string];
}

function validateIssuer(
  claims: JwtClaims,
  configured: string | readonly string[] | undefined,
): void {
  if (configured === undefined) return;
  const property = jwtOwnDataProperty(claims, 'iss');
  const issuer = property.valid && property.present ? property.value : undefined;
  if (typeof issuer !== 'string' || !acceptedValues(configured).includes(issuer)) {
    throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'issuer' });
  }
}

function validateAudience(
  claims: JwtClaims,
  configured: string | readonly string[] | undefined,
): void {
  if (configured === undefined) return;
  const property = jwtOwnDataProperty(claims, 'aud');
  const audience = property.valid && property.present ? property.value : undefined;
  const tokenValues = typeof audience === 'string'
    ? [audience]
    : Array.isArray(audience) && audience.every((entry) => typeof entry === 'string')
      ? audience as readonly string[]
      : undefined;
  if (!tokenValues || !tokenValues.some((entry) => acceptedValues(configured).includes(entry))) {
    throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'audience' });
  }
}

export function validateRegisteredClaims(
  claims: JwtClaims,
  options: NormalizedJwtVerifyOptions,
  currentDate: Date,
): void {
  for (const name of options.requiredClaims ?? []) {
    if (!requiredClaim(claims, name)) {
      throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'required-claim', claim: name });
    }
  }

  validateIssuer(claims, options.issuer);
  validateAudience(claims, options.audience);
  const subject = jwtOwnDataProperty(claims, 'sub');
  if (
    options.subject !== undefined
    && (!subject.valid || !subject.present || subject.value !== options.subject)
  ) {
    throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'subject' });
  }

  const now = currentDate.getTime() / 1000;
  const tolerance = options.clockToleranceSeconds ?? 0;
  const expiresAt = numericClaim(claims, 'exp');
  const notBefore = numericClaim(claims, 'nbf');
  const issuedAt = numericClaim(claims, 'iat');
  if (expiresAt !== undefined && now - tolerance >= expiresAt) {
    throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'expiration' });
  }
  if (notBefore !== undefined && now + tolerance < notBefore) {
    throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'not-before' });
  }
  if (options.maxTokenAgeSeconds !== undefined) {
    if (issuedAt === undefined) {
      throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'issued-at' });
    }
    if (issuedAt > now + tolerance) {
      throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'issued-at' });
    }
    if (now - issuedAt - tolerance > options.maxTokenAgeSeconds) {
      throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'max-token-age' });
    }
  }
}
