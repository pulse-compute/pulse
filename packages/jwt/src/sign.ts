import { parsePrivateKeyObject } from './token.js';
import { isJwtError, jwtError } from './errors.js';
import type { JwtClaims, JwtJsonValue } from './options.js';
import { jwtDataRecord, jwtDenseArrayValues } from './internal/data.js';
import { captureJwtCurrentDate, type JwtWallClockCapture } from './internal/clock.js';
import { registerClaimStrings, registerSensitive, verifierHostFunction, type JwtVerifierHost } from './internal/verifier-authority.js';

/** HS256/ES256 issuance using provider-owned secret and clock authority. */
export interface JwtSignOptions {
  readonly algorithm: 'HS256' | 'ES256';
  readonly kid?: string;
  readonly key: { readonly type: 'secret'; readonly binding: string };
  readonly expiresInSeconds: number;
}

export interface JwtSignerCrypto {
  readonly bytes: {
    readonly hmacSha256?: (key: Uint8Array, data: Uint8Array) => Uint8Array | PromiseLike<Uint8Array>;
    readonly es256Sign?: (key: Uint8Array, data: Uint8Array) => Uint8Array | PromiseLike<Uint8Array>;
  };
}

export function normalizeJwtSignOptions(value: JwtSignOptions): Readonly<JwtSignOptions> {
  const record = jwtDataRecord(value);
  if (!record || ![3, 4].includes(record.size) || [...record.keys()].some(name => !['algorithm', 'key', 'expiresInSeconds', 'kid'].includes(name))) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'sign-options' });
  }
  const algorithm = record.get('algorithm');
  if (algorithm !== 'HS256' && algorithm !== 'ES256') throw jwtError('PULSE_JWT_ALGORITHM_NOT_ALLOWED');
  const key = jwtDataRecord(record.get('key'));
  const binding = key?.get('binding');
  if (!key || key.size !== 2 || key.get('type') !== 'secret' || typeof binding !== 'string'
    || !binding.trim() || binding.includes('\0') || binding.length > 256) {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'sign-key' });
  }
  const expiresInSeconds = record.get('expiresInSeconds');
  if (typeof expiresInSeconds !== 'number' || !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 1) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'sign-lifetime' });
  }
  const kid = record.get('kid');
  if (record.has('kid') && (typeof kid !== 'string' || !kid.length || kid.includes('\0') || new TextEncoder().encode(kid).length > 256)) {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'sign-kid' });
  }
  return Object.freeze({ algorithm, key: Object.freeze({ type: 'secret', binding }), expiresInSeconds,
    ...(typeof kid === 'string' ? { kid } : {}) });
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

function protectedSegment(options: JwtSignOptions): string {
  return base64url(new TextEncoder().encode(JSON.stringify({ alg: options.algorithm, typ: 'JWT',
    ...(options.kid === undefined ? {} : { kid: options.kid }) })));
}

export function normalizeJwtSignature(value: unknown, options: JwtSignOptions): string {
  const segments = typeof value === 'string' ? value.split('.') : [];
  const size = options.algorithm === 'ES256' ? 86 : 43;
  if (typeof value !== 'string' || value.length > 16384 || segments.length !== 3
    || segments[0] !== protectedSegment(options) || !/^[A-Za-z0-9_-]+$/.test(segments[1])
    || segments[2].length !== size || !/^[A-Za-z0-9_-]+$/.test(segments[2])) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'sign-result' });
  }
  return value;
}

function privateKeyBytes(secret: Uint8Array, options: JwtSignOptions, host: JwtVerifierHost): Uint8Array {
  let output: Uint8Array | undefined;
  try {
    const jwk = parsePrivateKeyObject(new TextDecoder('utf-8', { fatal: true }).decode(secret));
    registerClaimStrings(host, jwk);
    if (Object.keys(jwk).some(name => !['kty', 'crv', 'x', 'y', 'd', 'alg', 'use', 'key_ops', 'kid', 'ext'].includes(name))
      || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || (jwk.alg !== undefined && jwk.alg !== 'ES256')
      || (jwk.use !== undefined && jwk.use !== 'sig') || (jwk.ext !== undefined && typeof jwk.ext !== 'boolean')
      || (jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || jwk.key_ops.length !== 1 || jwk.key_ops[0] !== 'sign'))
      || (jwk.kid !== undefined && (typeof jwk.kid !== 'string' || !jwk.kid.length || jwk.kid.includes('\0')
        || new TextEncoder().encode(jwk.kid).length > 256 || options.kid !== undefined && jwk.kid !== options.kid))) throw new Error();
    output = new Uint8Array(96);
    for (const [index, name] of ['x', 'y', 'd'].entries()) {
      const value = jwk[name];
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error();
      const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '=');
      const decoded = Uint8Array.from(binary, char => char.charCodeAt(0));
      try {
        if (decoded.length !== 32 || base64url(decoded) !== value) throw new Error();
        output.set(decoded, index * 32);
      } finally { decoded.fill(0); }
    }
    return output;
  } catch {
    output?.fill(0);
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'sign-private-jwk' });
  }
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
    if (!key || key.length < (options.algorithm === 'HS256' ? 32 : 1) || key.length > 4096) throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'sign-key' });
    registerSensitive(host, secret as string | Uint8Array);
    if (options.algorithm === 'ES256') {
      const encoded = key;
      try { key = privateKeyBytes(encoded, options, host); } finally { encoded.fill(0); }
    }
    const now = Math.floor((await captureJwtCurrentDate(verifierHostFunction(host, 'captureWallClock') as JwtWallClockCapture | undefined)).getTime() / 1000);
    if (now > 8_640_000_000_000 - options.expiresInSeconds) {
      throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'sign-expiration' });
    }
    const text = boundedClaimsText({ ...claims, iat: now, exp: now + options.expiresInSeconds });
    registerSensitive(host, text);
    const signingInput = protectedSegment(options) + '.' + base64url(new TextEncoder().encode(text));
    data = new TextEncoder().encode(signingInput);
    const bytes = jwtDataRecord(jwtDataRecord(crypto)?.get('bytes'));
    const hmac = bytes?.get(options.algorithm === 'HS256' ? 'hmacSha256' : 'es256Sign');
    if (typeof hmac !== 'function') throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'crypto-realization' });
    tag = await hmac(key, data);
    if (!(tag instanceof Uint8Array) || tag.length !== (options.algorithm === 'HS256' ? 32 : 64)) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'crypto-signing' });
    const signature = base64url(tag);
    const token = normalizeJwtSignature(signingInput + '.' + signature, options);
    registerSensitive(host, signature);
    registerSensitive(host, token);
    return token;
  } catch (error) {
    if (isJwtError(error)) throw error;
    if (error && typeof error === 'object' && 'code' in error && error.code === 'PULSE_CRYPTO_KEY_INVALID') {
      throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'sign-private-key' });
    }
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'signing', automaticFallback: false });
  } finally {
    key?.fill(0);
    data?.fill(0);
    if (tag instanceof Uint8Array) tag.fill(0);
  }
}
