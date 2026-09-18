import { CRYPTO_RESOURCE_LIMITS } from '../contracts.js';
import type { CryptoVerificationResult, RsaPublicKeyBytes, Rs256JoseVerifyInput } from '../contracts.js';
import { exactDataProperties, isOrdinaryObject, ownDataProperty, copyBytes } from './data.js';

export const RSA_MODULUS_BYTES = CRYPTO_RESOURCE_LIMITS.rs256ModulusBytes as readonly number[];
export const RSA_DATA_BYTES_MAXIMUM = CRYPTO_RESOURCE_LIMITS.rs256SigningInputBytesMaximum;
const fail = (status: 'invalid-key' | 'invalid-input') => ({ ok: false as const, result: { status } as CryptoVerificationResult });

export function encodeRsaInteger(bytes: Uint8Array): string {
  let start = 0;
  while (start + 1 < bytes.length && bytes[start] === 0) start++;
  let binary = '';
  for (const byte of bytes.subarray(start)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeRsaInteger(value: unknown, maximum: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum * 4 / 3)
    || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new TypeError('Invalid RSA integer.');
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));
  if (!bytes.length || bytes.length > maximum || bytes[0] === 0 || encodeRsaInteger(bytes) !== value) {
    bytes.fill(0); throw new TypeError('Invalid RSA integer.');
  }
  return bytes;
}

/** Normalized wire, independent of JWK policy: LE32(k), n[k], e[4], then
 * d[k], p/q/dp/dq/qi[k/2] when private. Metadata is owned by JWT. */
export function rsaKeyBytes(components: Readonly<Record<string, unknown>>, privateKey = false): Uint8Array<ArrayBuffer> {
  const decoded: Uint8Array[] = [];
  let output: Uint8Array<ArrayBuffer> | undefined;
  try {
    const n = decodeRsaInteger(components.n, 512); decoded.push(n);
    const k = n.length;
    if (!RSA_MODULUS_BYTES.includes(k) || n[0] < 128 || !(n[k - 1] & 1)) throw new TypeError();
    const e = decodeRsaInteger(components.e, 4); decoded.push(e);
    let exponent = 0; for (const byte of e) exponent = exponent * 256 + byte;
    if (exponent < 3 || exponent % 2 !== 1) throw new TypeError();
    output = new Uint8Array(privateKey ? 8 + k * 9 / 2 : 8 + k);
    new DataView(output.buffer).setUint32(0, k, true);
    output.set(n, 4); output.set(e, 8 + k - e.length);
    let offset = 8 + k;
    if (privateKey) for (const name of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      const width = name === 'd' ? k : k / 2;
      const bytes = decodeRsaInteger(components[name], width); decoded.push(bytes);
      if ((name === 'p' || name === 'q') && (bytes.length !== width || bytes[0] < 128 || !(bytes[width - 1] & 1))) throw new TypeError();
      output.set(bytes, offset + width - bytes.length); offset += width;
    }
    return output;
  } catch {
    output?.fill(0); throw new TypeError('Invalid RSA key components.');
  } finally { for (const bytes of decoded) bytes.fill(0); }
}

export function rsaWireJwk(bytes: Uint8Array, privateKey = false): Record<string, string> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) throw new TypeError('Invalid RSA key.');
  const k = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (!RSA_MODULUS_BYTES.includes(k) || bytes.length !== (privateKey ? 8 + k * 9 / 2 : 8 + k)
    || bytes[4] < 128 || !(bytes[k + 3] & 1)) throw new TypeError('Invalid RSA key.');
  const exponent = new DataView(bytes.buffer, bytes.byteOffset + 4 + k, 4).getUint32(0);
  if (exponent < 3 || exponent % 2 !== 1) throw new TypeError('Invalid RSA exponent.');
  const jwk: Record<string, string> = { kty: 'RSA', n: encodeRsaInteger(bytes.subarray(4, 4 + k)), e: encodeRsaInteger(bytes.subarray(4 + k, 8 + k)) };
  let offset = 8 + k;
  if (privateKey) for (const name of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
    const width = name === 'd' ? k : k / 2;
    jwk[name] = encodeRsaInteger(bytes.subarray(offset, offset + width)); offset += width;
  }
  return jwk;
}

export function normalizeRsaPublicKey(value: Readonly<{ n: string; e: string }>) {
  try {
    if (!isOrdinaryObject(value) || !exactDataProperties(value, new Set(['n', 'e']))) return fail('invalid-key');
    const bytes = rsaKeyBytes({ n: ownDataProperty(value, 'n').value, e: ownDataProperty(value, 'e').value });
    return { ok: true as const, key: { type: 'rsa-public-key-bytes' as const, bytes } };
  } catch { return fail('invalid-key'); }
}

export function normalizeRs256Request(value: unknown) {
  try {
    if (!isOrdinaryObject(value) || !exactDataProperties(value, new Set(['algorithm', 'key', 'data', 'signature']))
      || ownDataProperty(value, 'algorithm').value !== 'RS256') return fail('invalid-input');
    const key = ownDataProperty(value, 'key').value;
    if (!isOrdinaryObject(key) || !exactDataProperties(key, new Set(['type', 'bytes']))
      || ownDataProperty(key, 'type').value !== 'rsa-public-key-bytes') return fail('invalid-key');
    const inputKey = ownDataProperty(key, 'bytes').value;
    if (!(inputKey instanceof Uint8Array) || inputKey.length > 520) return fail('invalid-key');
    const bytes = copyBytes(inputKey);
    if (!bytes || bytes.length > 520) return fail('invalid-key');
    try { rsaWireJwk(bytes); } catch { return fail('invalid-key'); }
    const inputData = ownDataProperty(value, 'data').value, inputSignature = ownDataProperty(value, 'signature').value;
    if (!(inputData instanceof Uint8Array) || inputData.length > RSA_DATA_BYTES_MAXIMUM
      || !(inputSignature instanceof Uint8Array) || inputSignature.length !== bytes.length - 8) return fail('invalid-input');
    const data = copyBytes(inputData), signature = copyBytes(inputSignature);
    if (!data || data.length > RSA_DATA_BYTES_MAXIMUM || !signature || signature.length !== bytes.length - 8) return fail('invalid-input');
    return { ok: true as const, request: { algorithm: 'RS256' as const, key: { type: 'rsa-public-key-bytes' as const, bytes }, data, signature } };
  } catch { return fail('invalid-input'); }
}

export function normalizeRs256JoseVerifyRequest(value: Rs256JoseVerifyInput) {
  try {
    if (!isOrdinaryObject(value) || !exactDataProperties(value, new Set(['key', 'data', 'signature']))) return fail('invalid-input');
    const key = normalizeRsaPublicKey(ownDataProperty(value, 'key').value as { n: string; e: string });
    if (!key.ok) return key;
    const text = ownDataProperty(value, 'signature').value;
    if (typeof text !== 'string' || text.length > 683 || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return fail('invalid-input');
    // Signatures are fixed-width octet strings; leading zero bytes are valid.
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
    if (btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== text) return fail('invalid-input');
    return normalizeRs256Request({ algorithm: 'RS256', key: key.key, data: ownDataProperty(value, 'data').value,
      signature: Uint8Array.from(binary, char => char.charCodeAt(0)) });
  } catch { return fail('invalid-input'); }
}

export async function verifyRs256(request: { key: RsaPublicKeyBytes; data: Uint8Array<ArrayBuffer>; signature: Uint8Array<ArrayBuffer> }): Promise<CryptoVerificationResult> {
  let subtle: SubtleCrypto | undefined;
  try { subtle = globalThis.crypto?.subtle; } catch { return { status: 'realization-failure' }; }
  if (!subtle) return { status: 'realization-failure' };
  let key: CryptoKey;
  try { key = await subtle.importKey('jwk', rsaWireJwk(request.key.bytes), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']); }
  catch { return { status: 'invalid-key' }; }
  finally { request.key.bytes.fill(0); }
  try {
    const valid = await subtle.verify('RSASSA-PKCS1-v1_5', key, request.signature, request.data);
    return { status: valid === true ? 'valid' : valid === false ? 'invalid-authenticator' : 'realization-failure' };
  }
  catch { return { status: 'realization-failure' }; }
}
