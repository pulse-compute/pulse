import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { AssetBucket, AssetBucketSignError, encodeS3Key, signSigV4 } from '../src/index.js';
import { createAuthorization } from '@pulse-compute/s3/signing';
// Signatures captured from Assets at beta 6e8fc30 before delegation to S3.
import vectors from './fixtures/sigv4-compatibility.json';

const require = createRequire(import.meta.url);
const protocol = require('@pulse-compute/s3/provider');
const credentials = { key: 'AKIDEXAMPLE', secret: 'fixture-signing-secret' };
const now = () => new Date('2026-09-29T12:34:56.000Z');
const crypto = {
  async sha256(value: Uint8Array) { return createHash('sha256').update(value).digest(); },
  async hmacSha256(key: Uint8Array, value: Uint8Array) { return createHmac('sha256', key).update(value).digest(); },
};

describe('AST-01 Assets compatibility over S3-owned signing', () => {
  for (const vector of vectors) it(vector.name, async () => {
    const headers = new Headers(vector.headers as HeadersInit);
    const before = [...headers];
    const request = await signSigV4({ ...vector, headers, now: now(), credentials: { ...credentials, token: vector.token } });
    expect({ url: request.url, method: request.method, headers: [...request.headers] }).toEqual(vector.expected);
    expect([...headers]).toEqual(before);
    expect(request.body).toBeNull();
  });

  it('preserves secret forms, resolution order and early option snapshots', async () => {
    const calls: string[] = [];
    const date = now();
    const options = { method: 'GET', url: 'https://bucket.example.test/file', now: date, region: 'us-east-1', credentials: {
      key: async () => { calls.push('key'); date.setUTCFullYear(2000); options.method = 'HEAD'; options.region = 'elsewhere'; return credentials.key; },
      secret: () => { calls.push('secret'); return Promise.resolve(credentials.secret); },
      token: Promise.resolve('fixture-token'),
    } };
    const request = await signSigV4(options);
    const expected = await signSigV4({ method: 'GET', url: options.url, now: now(), credentials: { ...credentials, token: 'fixture-token' } });
    expect(calls).toEqual(['key', 'secret']);
    expect([...request.headers]).toEqual([...expected.headers]);
    expect(request.method).toBe('GET');
  });

  it('retains the public error type and original cause without transport', async () => {
    const cause = new Error('credential fixture failure');
    try {
      await signSigV4({ method: 'GET', url: 'https://example.test/', credentials: { ...credentials, secret: () => { throw cause; } } });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AssetBucketSignError);
      expect(error).toMatchObject({ message: 'Failed to sign S3-compatible request', cause });
    }
    await expect(signSigV4({ method: 'GET', url: 'https://example.test/', credentials: { key: '', secret: '' } })).rejects.toMatchObject({ name: 'AssetBucketSignError', cause: { message: 'Missing access key' } });
    await expect(signSigV4({ method: 'GET', url: 'https://example.test/', credentials, now: new Date(NaN) })).rejects.toBeInstanceOf(AssetBucketSignError);
  });

  it('shares encoding without weakening portable key admission', () => {
    expect(encodeS3Key('/é//%2F/!\'()*/')).toBe('/%C3%A9//%252F/%21%27%28%29%2A/');
    for (const key of ['', '.', 'a/../b']) { expect(encodeS3Key(key)).toBe(key); expect(protocol.encodeKey(key)).toBeNull(); }
    expect(protocol.encodeKey('/é//%2F/')).toBe(encodeS3Key('/é//%2F/'));
    expect(() => encodeS3Key('\ud800')).toThrow(URIError);
  });

  it('matches the provider signer with the same payload and headers', async () => {
    const binding = { endpoint: 'https://objects.example.test', bucket: 'fixture', region: 'us-east-1', maxTextBytes: 32768 };
    for (const method of ['GET', 'HEAD', 'PUT']) {
      const request = await protocol.signRequest({ binding, method, encodedKey: 'a%20b//%252F', accessId: credentials.key, secret: credentials.secret, token: 'token', now: now().getTime(), body: Buffer.from('fixture'), contentType: 'text/plain' }, crypto);
      const headers = { ...request.headers }; delete headers.authorization; delete headers['accept-encoding'];
      const compat = await signSigV4({ method, url: request.url, headers, now: now(), credentials: { ...credentials, token: 'token' }, payloadHash: request.headers['x-amz-content-sha256'] });
      expect(compat.headers.get('authorization')).toBe(request.headers.authorization);
      expect(request.headers['accept-encoding']).toBe('identity');
    }
  });

  it('wipes derived signing keys on success and crypto rejection', async () => {
    for (const rejectAt of [0, 3, 5]) {
      const keys: Uint8Array[] = [];
      const selected = { ...crypto, async hmacSha256(key: Uint8Array, value: Uint8Array) {
        keys.push(key);
        if (keys.length === rejectAt) throw new Error('crypto fixture failure');
        return crypto.hmacSha256(key, value);
      } };
      const signing = createAuthorization({ method: 'GET', uri: '/', query: '', headers: { host: 'example.test' }, date: '20260929T123456Z', region: 'us-east-1', service: 's3', accessId: credentials.key, secret: credentials.secret, payloadHash: 'UNSIGNED-PAYLOAD' }, selected);
      if (rejectAt) await expect(signing).rejects.toThrow('crypto fixture failure'); else await signing;
      expect(keys.every(key => key.every(byte => byte === 0))).toBe(true);
    }
  });

  for (const pathStyle of [true, false]) for (const method of ['GET', 'HEAD']) it(`retains ${pathStyle ? 'path' : 'virtual-host'} bucket ${method} streaming and conditionals`, async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
    const bucket = new AssetBucket({ endpoint: 'https://objects.example.test/base', bucket: 'fixture', credentials, pathStyle, ttl: false,
      fetch: (async (request: Request) => {
        expect(request.url).toBe(pathStyle ? 'https://objects.example.test/base/fixture/file.txt' : 'https://fixture.objects.example.test/base/file.txt');
        expect(request.headers.get('range')).toBe('bytes=0-9');
        expect(request.headers.get('if-none-match')).toBe('"fixture"');
        expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
        return new Response(body, { status: 206, headers: { 'content-range': 'bytes 0-9/20' } });
      }) as typeof fetch,
    });
    const response = await bucket.handle({ request: new Request('https://app.example.test/file.txt', { method, headers: { range: 'bytes=0-9', 'if-none-match': '"fixture"' } }) });
    expect(response?.status).toBe(206);
    expect(response?.headers.get('content-range')).toBe('bytes 0-9/20');
    expect(response?.body).toBe(method === 'HEAD' ? null : body);
    expect(cancelled).toBe(method === 'HEAD' ? 1 : 0);
    await response?.body?.cancel();
  });

  it('keeps the custom signer hook and credential ownership', async () => {
    let signed = false;
    const bucket = new AssetBucket({ endpoint: 'https://objects.example.test', bucket: 'fixture', credentials,
      signer: async input => { expect(input.credentials).toBe(credentials); signed = true; return new Request(input.url, { method: input.method, headers: { authorization: 'custom-fixture' } }); },
      fetch: (async (request: Request) => { expect(signed).toBe(true); expect(request.headers.get('authorization')).toBe('custom-fixture'); return new Response('ok'); }) as typeof fetch,
    });
    const result = await bucket.handle({ request: new Request('https://app.example.test/file') });
    expect(await result?.text()).toBe('ok');
  });
});
