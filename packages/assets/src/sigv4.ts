import { encodeS3Key as encodeKey, signHttpRequest } from '@pulse-compute/s3/signing';
import { AssetBucketSignError } from './errors.js';

export type SecretValue = string | Promise<string> | (() => string | Promise<string>);

export type SigV4Credentials = {
  key: SecretValue;
  secret: SecretValue;
  token?: SecretValue | undefined;
};

export type SigV4SignOptions = {
  method: string;
  url: URL | string;
  region?: string | undefined;
  service?: string | undefined;
  credentials: SigV4Credentials;
  headers?: HeadersInit | undefined;
  now?: Date | undefined;
  payloadHash?: string | undefined;
};

async function resolveSecret(value: SecretValue | undefined): Promise<string | undefined> {
  if (value === undefined) return undefined;
  return await (typeof value === 'function' ? value() : value);
}

// Keep the direct JavaScript helper's Web Crypto realization and credential
// resolution policy. Canonical Pulse S3 effects select their own provider crypto.
const signingCrypto = {
  async sha256(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  },
  async hmacSha256(key: Uint8Array, bytes: Uint8Array): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new Uint8Array(bytes)));
  },
};

export async function signSigV4(options: SigV4SignOptions): Promise<Request> {
  try {
    // Snapshot URL/date before resolving asynchronous credentials, as before.
    const url = new URL(options.url.toString());
    const region = options.region ?? 'us-east-1';
    const service = options.service ?? 's3';
    const method = options.method.toUpperCase();
    const now = new Date((options.now ?? new Date()).toISOString());
    const accessId = await resolveSecret(options.credentials.key);
    const secret = await resolveSecret(options.credentials.secret);
    const token = await resolveSecret(options.credentials.token);
    if (!accessId) throw new Error('Missing access key');
    if (!secret) throw new Error('Missing secret key');
    return await signHttpRequest({ method, url, region, service, now, headers: options.headers, payloadHash: options.payloadHash, accessId, secret, token }, signingCrypto);
  } catch (cause) {
    throw new AssetBucketSignError('Failed to sign S3-compatible request', { cause });
  }
}

export function encodeS3Key(key: string): string { return encodeKey(key); }
