import { createHmac, generateKeyPairSync, verify as verifySignature } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { normalizeJwtSignClaims, normalizeJwtSignOptions, signJwtWithCrypto, type JwtSignOptions } from '../src/sign.js';
import { verifyJwtWithCrypto } from '../src/crypto-verifier.js';
import { crypto } from '../../crypto/src/index.js';
import { sign } from '../src/index.js';

const require = createRequire(import.meta.url);
const { bindJavascriptDigestMac, bindJavascriptEs256Signer } = require('../../crypto/src/provider.cjs');
const options: JwtSignOptions = { algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 45 };
const secret = 'fixture-only-signing-key-32-bytes-long';
const selected = () => bindJavascriptDigestMac(['HMAC-SHA256']);
const host = () => ({ resolveSecret: () => secret, captureWallClock: () => ({ trusted: true, unixEpochSeconds: 1800000000.75 }) });

describe('bounded JWT signing', () => {
  it('issues an independently authenticated token and round-trips the existing verifier', async () => {
    let clocks = 0;
    const redactions: unknown[] = [];
    const claims = { iss: 'issuer', aud: 'worker', sub: 'scheduler', scope: 'reconcile', method: 'POST', path: '/step', bodySha256: 'a'.repeat(64), epoch: 7 };
    const token = await signJwtWithCrypto({ claims, options }, { ...host(),
      captureWallClock: () => { clocks++; return { trusted: true, unixEpochSeconds: 1800000000.75 }; },
      registerSensitiveValue: value => { redactions.push(value); },
    }, selected());
    const [header, payload, signature] = token.split('.');
    expect(signature).toBe(createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url'));
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    const verified = await verifyJwtWithCrypto({ token, options: { algorithms: ['HS256'], key: options.key, issuer: 'issuer', audience: 'worker', maxTokenAgeSeconds: 60 } }, host(), crypto);
    expect(verified.claims).toEqual({ ...claims, iat: 1800000000, exp: 1800000045 });
    expect(clocks).toBe(1);
    expect(claims).not.toHaveProperty('iat');
    expect(redactions).toContain(secret);
    expect(redactions).toContain(token);
    expect(redactions).toContain(signature);
  });

  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects lifetime %s', expiresInSeconds => {
    expect(() => normalizeJwtSignOptions({ ...options, expiresInSeconds })).toThrowError(/JWT/);
  });
  it.each([301, 3600, 86400, 8_640_000_000_000 - 1800000000])('accepts application lifetime %s', async expiresInSeconds => {
    const token = await signJwtWithCrypto({ claims: {}, options: { ...options, expiresInSeconds } }, host(), selected());
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(claims.exp).toBe(1800000000 + expiresInSeconds);
  });
  it.each([8_640_000_000_000 - 1800000000 + 1, Number.MAX_SAFE_INTEGER])('rejects unrepresentable expiration %s', async expiresInSeconds => {
    await expect(signJwtWithCrypto({ claims: {}, options: { ...options, expiresInSeconds } }, host(), selected()))
      .rejects.toMatchObject({ code: 'PULSE_JWT_OPERATION_FAILED', detail: { category: 'sign-expiration' } });
  });
  it.each(['none', 'RS256', 'HS384'])('rejects signing algorithm %s', algorithm => {
    expect(() => normalizeJwtSignOptions({ ...options, algorithm } as any)).toThrowError();
  });
  it.each([undefined, '', 'x'.repeat(31), 'x'.repeat(4097)])('fails closed on missing/invalid key', async key => {
    await expect(signJwtWithCrypto({ claims: {}, options }, { ...host(), resolveSecret: () => key }, selected())).rejects.toMatchObject({ code: 'PULSE_JWT_KEY_INVALID' });
  });
  it.each(['iat', 'exp', 'nbf'])('rejects caller-owned %s', name => {
    expect(() => normalizeJwtSignClaims({ [name]: 1 })).toThrowError();
  });
  it.each([null, [], { x: undefined }, { x: NaN }, { x: Infinity }, { x: new Date() }, { x: 1n }, { x: [, 1] }])('rejects non-JSON claims', claims => {
    expect(() => normalizeJwtSignClaims(claims as any)).toThrowError();
  });
  it('rejects accessors without running them, cycles, depth, entry and byte excess', () => {
    let calls = 0;
    expect(() => normalizeJwtSignClaims({ get x() { calls++; return 'secret'; } })).toThrowError();
    expect(calls).toBe(0);
    const cycle: any = {}; cycle.x = cycle;
    expect(() => normalizeJwtSignClaims(cycle)).toThrowError();
    expect(() => normalizeJwtSignClaims({ x: Array(1024).fill(0) })).toThrowError();
    expect(() => normalizeJwtSignClaims({ x: 'é'.repeat(4096) })).toThrowError();
    expect(() => normalizeJwtSignClaims({ x: 'x'.repeat(8192) })).toThrowError();
    let deep: any = 1; for (let i = 0; i < 33; i++) deep = { x: deep };
    expect(() => normalizeJwtSignClaims(deep)).toThrowError();
  });
  it('rejects unavailable, untrusted and invalid clocks', async () => {
    for (const captureWallClock of [undefined, () => ({ trusted: false, unixEpochSeconds: 1 }), () => ({ trusted: true, unixEpochSeconds: NaN })]) {
      await expect(signJwtWithCrypto({ claims: {}, options }, { ...host(), captureWallClock }, selected())).rejects.toHaveProperty('code');
    }
  });
  it('wipes owned key, message and tag buffers without modifying host storage', async () => {
    const source = new Uint8Array(32).fill(9);
    let seen: Uint8Array[] = [];
    await signJwtWithCrypto({ claims: { sub: 'test' }, options }, { ...host(), resolveSecret: () => source }, {
      bytes: { hmacSha256(key, data) { const tag = new Uint8Array(32).fill(4); seen = [key, data, tag]; return tag; } },
    });
    expect(seen.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
    expect(source.every(byte => byte === 9)).toBe(true);
  });
  it('sanitizes crypto failures and never retries', async () => {
    let calls = 0; let captured: Uint8Array | undefined;
    await expect(signJwtWithCrypto({ claims: {}, options }, host(), { bytes: { hmacSha256(key) {
      calls++; captured = key; throw new Error(secret);
    } } })).rejects.toMatchObject({ code: 'PULSE_JWT_OPERATION_FAILED' });
    expect(calls).toBe(1);
    expect(captured?.every(byte => byte === 0)).toBe(true);
  });

  it('requires a live managed request context', () => {
    expect(() => sign({} as any, {}, options)).toThrowError();
  });


});


describe('ES256 signing', () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateJwk = pair.privateKey.export({ format: 'jwk' });
  const publicJwk = pair.publicKey.export({ format: 'jwk' });
  const policy: JwtSignOptions = { ...options, algorithm: 'ES256', kid: 'rotation-1', expiresInSeconds: 3600 };
  const esHost = (key: unknown = privateJwk) => ({ ...host(), resolveSecret: () => typeof key === 'string' ? key : JSON.stringify(key) });

  it('independently verifies ES256 and round-trips public JWK verification', async () => {
    const token = await signJwtWithCrypto({ claims: { sub: 'signer' }, options: policy }, esHost(), bindJavascriptEs256Signer());
    const [header, payload, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'rotation-1' });
    expect(verifySignature('sha256', Buffer.from(header + '.' + payload), { key: pair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true);
    const verified = await verifyJwtWithCrypto({ token, options: { algorithms: ['ES256'], key: { type: 'jwk', key: { ...publicJwk, kid: 'rotation-1' } as any } } }, host(), crypto);
    expect(verified.claims.exp).toBe(1800003600);
    expect(verified.claims.sub).toBe('signer');
  });

  it.each([
    ['public only', publicJwk], ['invalid scalar', { ...privateJwk, d: Buffer.alloc(32).toString('base64url') }],
    ['mismatched point', { ...privateJwk, ...generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' }) }],
    ['wrong curve', { ...privateJwk, crv: 'P-384' }], ['wrong algorithm', { ...privateJwk, alg: 'HS256' }],
    ['wrong use', { ...privateJwk, use: 'enc' }], ['verify-only', { ...privateJwk, key_ops: ['verify'] }],
    ['mismatched kid', { ...privateJwk, kid: 'rotation-2' }], ['unknown field', { ...privateJwk, private: true }],
    ['padded scalar', { ...privateJwk, d: privateJwk.d + '=' }], ['malformed JSON', '{'],
    ['duplicate field', JSON.stringify(privateJwk).replace('{', '{"kty":"EC",')],
  ])('rejects %s', async (_name, key) => {
    await expect(signJwtWithCrypto({ claims: {}, options: policy }, esHost(key), bindJavascriptEs256Signer()))
      .rejects.toMatchObject({ code: 'PULSE_JWT_KEY_INVALID' });
  });
  it('rejects invalid kid values before dispatch', () => {
    for (const kid of ['', '\0', 'é'.repeat(129), undefined]) {
      expect(() => normalizeJwtSignOptions({ ...policy, kid })).toThrowError();
    }
  });
  it('rejects absent ES256 realization and redacts the private scalar', async () => {
    const redactions: unknown[] = [];
    await expect(signJwtWithCrypto({ claims: {}, options: policy }, { ...esHost(), registerSensitiveValue: value => { redactions.push(value); } }, selected()))
      .rejects.toMatchObject({ code: 'PULSE_JWT_TARGET_UNSUPPORTED' });
    expect(redactions).toContain(privateJwk.d);
  });
});
