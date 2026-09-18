import { isJwtError, jwtError } from './errors.js';
import type { JwtClaims, JwtJsonValue } from './options.js';
import { jwtDataRecord, jwtDenseArrayValues } from './internal/data.js';
import { captureJwtCurrentDate, type JwtWallClockCapture } from './internal/clock.js';
import { registerClaimStrings, registerSensitive, verifierHostFunction, type JwtVerifierHost } from './internal/verifier-authority.js';

/** Short-lived HS256 issuance using provider-owned secret and clock authority. */
export interface JwtSignOptions {
  readonly algorithm: 'HS256';
  readonly key: { readonly type: 'secret'; readonly binding: string };
  readonly expiresInSeconds: number;
}

export interface JwtSignerCrypto {
  readonly bytes: { readonly hmacSha256: (key: Uint8Array, data: Uint8Array) => Uint8Array | PromiseLike<Uint8Array> };
}

export function normalizeJwtSignOptions(value: JwtSignOptions): Readonly<JwtSignOptions> {
  const record = jwtDataRecord(value);
  if (!record || record.size !== 3 || [...record.keys()].some(name => !['algorithm', 'key', 'expiresInSeconds'].includes(name))) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'sign-options' });
  }
  if (record.get('algorithm') !== 'HS256') throw jwtError('PULSE_JWT_ALGORITHM_NOT_ALLOWED');
  const key = jwtDataRecord(record.get('key'));
  const binding = key?.get('binding');
  if (!key || key.size !== 2 || key.get('type') !== 'secret' || typeof binding !== 'string'
    || !binding.trim() || binding.includes('\0') || binding.length > 256) {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'sign-key' });
  }
  const expiresInSeconds = record.get('expiresInSeconds');
  if (typeof expiresInSeconds !== 'number' || !Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 300) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'sign-lifetime' });
  }
  return Object.freeze({ algorithm: 'HS256', key: Object.freeze({ type: 'secret', binding }), expiresInSeconds });
}

// Bound traversal before serialization, detach data, and never invoke getters or
// toJSON. The same limits are enforced in the package-owned Native signer.
export function normalizeJwtSignClaims(value: JwtClaims): JwtClaims {
  let entries = 0;
  const copy = (input: unknown, depth: number): JwtJsonValue => {
    if (++entries > 1024 || depth > 32) throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', { category: 'sign-claims' });
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'string') {
      if (input.length > 8192) throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', { category: 'sign-claims' });
      return input;
    }
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (Array.isArray(input)) {
      if (input.length > 1024) throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', { category: 'sign-claims' });
      const values = jwtDenseArrayValues(input);
      if (values) return Object.freeze(values.map(child => copy(child, depth + 1)));
    } else {
      const record = jwtDataRecord(input);
      if (record) return Object.freeze(Object.fromEntries([...record].map(([name, child]) => {
        if (name.length > 8192) throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', { category: 'sign-claims' });
        return [name, copy(child, depth + 1)];
      })));
    }
    throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'sign-claims' });
  };
  if (!jwtDataRecord(value)) throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'sign-claims' });
  const claims = copy(value, 0) as JwtClaims;
  if (['iat', 'exp', 'nbf'].some(name => Object.hasOwn(claims, name))) {
    throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'sign-reserved-time' });
  }
  boundedClaimsText(claims);
  return claims;
}

function boundedClaimsText(claims: JwtClaims): string {
  const text = JSON.stringify(claims);
  if (new TextEncoder().encode(text).length > 8192) throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', { category: 'sign-claims' });
  return text;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function normalizeJwtSignature(value: unknown): string {
  if (typeof value !== 'string' || value.length > 16384 || !/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'sign-result' });
  }
  return value;
}

export async function signJwtWithCrypto(
  input: Readonly<{ claims: JwtClaims; options: JwtSignOptions }>,
  host: JwtVerifierHost,
  crypto: JwtSignerCrypto,
): Promise<string> {
  let key: Uint8Array | undefined;
  let data: Uint8Array | undefined;
  let tag: Uint8Array | undefined;
  try {
    const record = jwtDataRecord(input);
    if (!record || record.size !== 2) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'sign-input' });
    const options = normalizeJwtSignOptions(record.get('options') as JwtSignOptions);
    const claims = normalizeJwtSignClaims(record.get('claims') as JwtClaims);
    registerClaimStrings(host, claims);
    const resolveSecret = verifierHostFunction(host, 'resolveSecret');
    if (!resolveSecret) throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'secret-authority' });
    let secret: unknown;
    try { secret = await resolveSecret(options.key.binding); }
    catch { throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'secret-binding' }); }
    if (typeof secret === 'string' && secret.length <= 4096) key = new TextEncoder().encode(secret);
    else if (secret instanceof Uint8Array && secret.length <= 4096) key = new Uint8Array(secret);
    if (!key || key.length < 32 || key.length > 4096) throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'sign-key' });
    registerSensitive(host, secret as string | Uint8Array);
    const now = Math.floor((await captureJwtCurrentDate(verifierHostFunction(host, 'captureWallClock') as JwtWallClockCapture | undefined)).getTime() / 1000);
    if (now > 8_640_000_000_000 - options.expiresInSeconds) throw jwtError('PULSE_JWT_CLOCK_INVALID');
    const text = boundedClaimsText({ ...claims, iat: now, exp: now + options.expiresInSeconds });
    registerSensitive(host, text);
    const signingInput = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + base64url(new TextEncoder().encode(text));
    data = new TextEncoder().encode(signingInput);
    const bytes = jwtDataRecord(jwtDataRecord(crypto)?.get('bytes'));
    const hmac = bytes?.get('hmacSha256');
    if (typeof hmac !== 'function') throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'crypto-realization' });
    tag = await hmac(key, data);
    if (!(tag instanceof Uint8Array) || tag.length !== 32) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'crypto-signing' });
    const signature = base64url(tag);
    const token = normalizeJwtSignature(signingInput + '.' + signature);
    registerSensitive(host, signature);
    registerSensitive(host, token);
    return token;
  } catch (error) {
    if (isJwtError(error)) throw error;
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'signing', automaticFallback: false });
  } finally {
    key?.fill(0);
    data?.fill(0);
    if (tag instanceof Uint8Array) tag.fill(0);
  }
}
