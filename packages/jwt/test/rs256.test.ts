import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeJwtVerifyOptions, selectSignatureVerificationJwk, type JwtPublicJwk } from '../src/options.js';

const publicKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' });
const key = { ...publicKey, kid: 'rsa-1', alg: 'RS256', use: 'sig', key_ops: ['verify'] } as JwtPublicJwk;
const policy = (value: unknown) => normalizeJwtVerifyOptions({ algorithms: ['RS256'], key: { type: 'jwk', key: value as JwtPublicJwk } });

describe('RS256 public key and algorithm policy', () => {
  it('accepts a detached public key and selects an exact static kid', () => {
    const options = policy(key);
    expect(Object.isFrozen(options.key)).toBe(true);
    expect(selectSignatureVerificationJwk(options.key, 'rsa-1', 'RS256')).toEqual(key);
    expect(() => selectSignatureVerificationJwk(options.key, 'unknown', 'RS256')).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));
    expect(() => selectSignatureVerificationJwk(options.key, 'rsa-1', 'ES256')).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));
  });

  it.each([
    { d: 'AQAB' }, { p: 'AQAB' }, { oth: [] }, { k: 'secret' }, { ext: true },
    { x5c: ['certificate'] }, { x5u: 'https://keys.invalid' }, { alg: 'HS256' },
    { alg: 'PS256' }, { use: 'enc' }, { key_ops: ['sign'] }, { key_ops: ['verify', 'verify'] },
    { kid: '' }, { kid: 'x'.repeat(257) }, { n: 'AQAB' }, { n: publicKey.n + '=' },
    { n: Buffer.concat([Buffer.from([0]), Buffer.from(publicKey.n!, 'base64url')]).toString('base64url') },
    { e: 'Ag' }, { e: 'AQ' }, { e: 'AQAAAAE' }, { e: 'AAEAAQ' },
  ])('rejects unsupported or malformed public key fields %#', mutation => {
    expect(() => policy({ ...key, ...mutation })).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));
  });

  it('rejects duplicate and ambiguous JWKS selection without retry', () => {
    expect(() => normalizeJwtVerifyOptions({ algorithms: ['RS256'], key: { type: 'jwks', keys: [key, key] } }))
      .toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));
    const normalized = normalizeJwtVerifyOptions({ algorithms: ['RS256'], key: { type: 'jwks', keys: [key, { ...key, kid: 'rsa-2' }] } });
    expect(() => selectSignatureVerificationJwk(normalized.key, undefined, 'RS256')).toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));
    expect(selectSignatureVerificationJwk(normalized.key, 'rsa-2', 'RS256').kid).toBe('rsa-2');
    expect(() => normalizeJwtVerifyOptions({ algorithms: ['RS256'], key: { type: 'jwks', keys: Array.from({ length: 17 }, (_, i) => ({ ...key, kid: String(i) })) } }))
      .toThrowError(expect.objectContaining({ code: 'PULSE_JWT_LIMIT_EXCEEDED' }));
  });

  it('never treats RSA verification material as an HMAC secret', () => {
    expect(() => normalizeJwtVerifyOptions({ algorithms: ['HS256'], key: { type: 'jwk', key } }))
      .toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));
    expect(() => normalizeJwtVerifyOptions({ algorithms: ['RS256'], key: { type: 'secret', binding: 'RSA_KEY' } }))
      .toThrowError(expect.objectContaining({ code: 'PULSE_JWT_KEY_INVALID' }));
  });
});
