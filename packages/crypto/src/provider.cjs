'use strict';

// Trusted provider byte-output seam. JWT verification keeps its own key limits.
const IMPLEMENTATIONS = Object.freeze({
  'SHA-256': 'webcrypto.subtle.sha-256-bytes.v1',
  'HMAC-SHA256': 'webcrypto.subtle.hmac-sha-256-bytes.v1'
});
function snapshot(value, maximum) {
  if (!(value instanceof Uint8Array) || value.byteLength > maximum) throw new TypeError('Crypto byte input is outside its bound.');
  return new Uint8Array(value);
}
function result(value) {
  if (!(value instanceof ArrayBuffer) || value.byteLength !== 32) throw new TypeError('Crypto byte output is invalid.');
  return new Uint8Array(value);
}
function bindJavascriptDigestMac(algorithms, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  if (!Array.isArray(algorithms) || new Set(algorithms).size !== algorithms.length || algorithms.some((name) => !Object.hasOwn(IMPLEMENTATIONS, name))) throw new TypeError('Crypto requires explicit supported byte algorithms.');
  if (!subtle || algorithms.includes('SHA-256') && typeof subtle.digest !== 'function'
    || algorithms.includes('HMAC-SHA256') && (typeof subtle.sign !== 'function' || typeof subtle.importKey !== 'function')) throw new TypeError('Selected Web Crypto byte realization is unavailable.');
  const bytes = {};
  if (algorithms.includes('SHA-256')) bytes.sha256 = async (input) => {
    const data = snapshot(input, 2097152);
    try { return result(await subtle.digest({ name: 'SHA-256' }, data)); }
    finally { data.fill(0); }
  };
  if (algorithms.includes('HMAC-SHA256')) bytes.hmacSha256 = async (keyInput, input) => {
    let key = snapshot(keyInput, 8192);
    let data;
    try {
      data = snapshot(input, 65536);
      // HMAC pads an empty key to a zero block (RFC 2104). Web Crypto rejects
      // a zero-length import; the equivalent padded block retains Native parity.
      if (key.length === 0) key = new Uint8Array(64);
      const imported = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256', length: key.length * 8 }, false, ['sign']);
      return result(await subtle.sign({ name: 'HMAC' }, imported, data));
    } finally { key.fill(0); if (data) data.fill(0); }
  };
  return Object.freeze({ bytes: Object.freeze(bytes), realization: Object.freeze({
    target: 'javascript', automaticFallback: false,
    algorithms: Object.freeze(algorithms.map((algorithm) => Object.freeze({ algorithm, realization: 'runtime-builtin', implementation: IMPLEMENTATIONS[algorithm], available: true, automaticFallback: false })))
  }) });
}
const DIGEST_TEXT_MAX_BYTES = 2097152;
const digestFailures = Object.freeze(Object.fromEntries(
  ['invalid-text', 'too-large', 'unavailable', 'realization-failure'].map(reason => [reason, Object.freeze({ status: 'failed', reason })])
));
// Count scalar UTF-8 bytes before allocating staging; do not replace surrogates.
function textDigestByteLength(text, maximum = DIGEST_TEXT_MAX_BYTES) {
  if (typeof text !== 'string') return -1;
  if (text.length > maximum) return -2;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = text.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return -1;
      bytes += 4;
    } else if (c >= 0xdc00 && c <= 0xdfff) return -1;
    else bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return bytes > maximum ? -2 : bytes;
}
function normalizeTextDigestResult(value) {
  const failed = digestFailures['realization-failure'];
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return failed;
  const properties = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(properties);
  if (keys.some(key => typeof key !== 'string' || !properties[key].enumerable || !Object.hasOwn(properties[key], 'value'))) return failed;
  const status = properties.status?.value, reason = properties.reason?.value;
  if (status === 'failed' && keys.length === 2 && typeof reason === 'string' && Object.hasOwn(digestFailures, reason)) return digestFailures[reason];
  const sha256 = properties.sha256?.value, byteLength = properties.byteLength?.value;
  if (status !== 'ok' || keys.length !== 3 || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)
    || !Number.isInteger(byteLength) || byteLength < 0 || byteLength > DIGEST_TEXT_MAX_BYTES) return failed;
  return Object.freeze({ status: 'ok', sha256, byteLength });
}
function checkDigestCancellation(signal) {
  if (signal?.aborted) throw signal.reason || new Error('Pulse digest invocation cancelled.');
}
async function executeTextDigest(effect, options = {}) {
  if (!effect || effect.package !== '@pulse-compute/crypto' || effect.contractId !== 'pulse.crypto'
    || effect.providerKind !== 'crypto' || effect.operation !== 'digestText'
    || effect.kind !== 'crypto.digestText' || effect.capability !== 'crypto.digestText') throw new TypeError('Invalid Crypto digest effect authority.');
  checkDigestCancellation(options.signal);
  const text = effect.payload?.text, byteLength = textDigestByteLength(text);
  if (byteLength < 0) return digestFailures[byteLength === -1 ? 'invalid-text' : 'too-large'];
  const realization = options.cryptoTarget === 'javascript' ? 'runtime-builtin' : 'guest-source:pulse-hmac-as';
  const bytes = options.cryptoVerifier?.bytes, algorithms = options.cryptoRealization?.algorithms;
  if (typeof bytes?.sha256 !== 'function' || !Array.isArray(algorithms)
    || !algorithms.some(entry => entry.algorithm === 'SHA-256' && entry.available === true && entry.realization === realization)) return digestFailures.unavailable;
  const data = new TextEncoder().encode(text);
  let digest;
  try {
    digest = await bytes.sha256(data);
    checkDigestCancellation(options.signal);
    if (!(digest instanceof Uint8Array) || digest.length !== 32) return digestFailures['realization-failure'];
    const sha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    return Object.freeze({ status: 'ok', sha256, byteLength });
  } catch (error) {
    checkDigestCancellation(options.signal);
    return digestFailures['realization-failure'];
  } finally { data.fill(0); if (digest instanceof Uint8Array) digest.fill(0); }
}
function createJavascriptTextDigest(options = {}) {
  return (effect, execution = {}) => {
    let selected;
    try { selected = bindJavascriptDigestMac(['SHA-256'], options.digestSubtle === undefined ? globalThis.crypto?.subtle : options.digestSubtle); }
    catch { selected = undefined; }
    return executeTextDigest(effect, { signal: execution.signal, cryptoTarget: 'javascript',
      cryptoVerifier: selected, cryptoRealization: selected?.realization });
  };
}

function bindJavascriptEs256Signer(subtle = globalThis.crypto?.subtle) {
  if (!subtle || typeof subtle.importKey !== 'function' || typeof subtle.sign !== 'function'
    || typeof subtle.verify !== 'function') throw new TypeError('Selected ES256 signing realization is unavailable.');
  const encode = bytes => {
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const invalidKey = () => Object.assign(new TypeError('Invalid P-256 signing key.'), { code: 'PULSE_CRYPTO_KEY_INVALID' });
  return Object.freeze({ bytes: Object.freeze({ async es256Sign(key, data) {
    if (!(key instanceof Uint8Array) || key.length !== 96) throw invalidKey();
    if (!(data instanceof Uint8Array) || data.length > 16340) throw new TypeError('ES256 input exceeds its byte contract.');
    const jwk = { kty: 'EC', crv: 'P-256', x: encode(key.subarray(0, 32)), y: encode(key.subarray(32, 64)), d: encode(key.subarray(64)) };
    let signingKey, verifyingKey;
    try {
      signingKey = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      verifyingKey = await subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    } catch { throw invalidKey(); }
    const signature = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, data));
    try {
      if (signature.length !== 64 || !await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyingKey, signature, data)) {
        throw invalidKey();
      }
      return signature.slice();
    } finally { signature.fill(0); }
  } }) });
}

// Metadata parsing remains JWT-owned. This adapter normalizes only RSA integers.
async function rsaPrivateKeyBytes(components) {
  return (await import('../dist/internal/rsa.js')).rsaKeyBytes(components, true);
}
function bindJavascriptRs256Signer(subtle = globalThis.crypto?.subtle) {
  if (!subtle || typeof subtle.importKey !== 'function' || typeof subtle.sign !== 'function'
    || typeof subtle.verify !== 'function') throw new TypeError('Selected RS256 signing realization is unavailable.');
  const invalidKey = () => Object.assign(new TypeError('Invalid RSA signing key.'), { code: 'PULSE_CRYPTO_KEY_INVALID' });
  return Object.freeze({ bytes: Object.freeze({ async rs256Sign(key, data) {
    const { rsaWireJwk, RSA_DATA_BYTES_MAXIMUM } = await import('../dist/internal/rsa.js');
    if (!(data instanceof Uint8Array) || data.length > RSA_DATA_BYTES_MAXIMUM) throw new TypeError('RS256 input exceeds its byte contract.');
    let jwk, signingKey, verifyingKey;
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    try {
      jwk = rsaWireJwk(key, true);
      // Web Crypto implementations need not check every redundant CRT field.
      // Check consistency explicitly at import. JavaScript BigInt has no
      // constant-time guarantee; private exponentiation remains Web Crypto.
      const integer = text => {
        const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
        let value = 0n; for (const byte of binary) value = value * 256n + BigInt(byte.charCodeAt(0));
        return value;
      };
      const { n, e, d, p, q, dp, dq, qi } = Object.fromEntries(['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'].map(name => [name, integer(jwk[name])]));
      const k = key.length > 8 ? new DataView(key.buffer, key.byteOffset, 4).getUint32(0, true) : 0;
      const halfMinimum = 1n << BigInt(k * 4 - 1);
      if (p < halfMinimum || q < halfMinimum || !(p & q & 1n) || p === q || p*q !== n
        || d <= 0n || d >= n || d % (p-1n) !== dp || d % (q-1n) !== dq
        || e*dp % (p-1n) !== 1n || e*dq % (q-1n) !== 1n || qi <= 0n || qi >= p || q*qi % p !== 1n) throw invalidKey();
      signingKey = await subtle.importKey('jwk', jwk, algorithm, false, ['sign']);
      verifyingKey = await subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e }, algorithm, false, ['verify']);
    } catch { throw invalidKey(); }
    const signature = new Uint8Array(await subtle.sign(algorithm, signingKey, data));
    try {
      if (signature.length !== new DataView(key.buffer, key.byteOffset, 4).getUint32(0, true)
        || !await subtle.verify(algorithm, verifyingKey, signature, data)) throw invalidKey();
      return signature.slice();
    } finally { signature.fill(0); }
  } }) });
}

// MAC-01 owns descriptor admission and projection; provider execution follows in MAC-02.
function macTextRecord(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) return null;
  const result = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result[name] = descriptor.value;
  }
  return result;
}
function normalizeMacTextOptions(value) {
  try {
    const options = macTextRecord(value, ['algorithm', 'key']);
    const key = options && macTextRecord(options.key, ['type', 'binding']);
    if (!options || options.algorithm !== 'HS256' || !key || key.type !== 'secret'
      || typeof key.binding !== 'string' || !key.binding.length || key.binding.length > 256
      || key.binding.includes('\0') || !key.binding.isWellFormed()
      || new TextEncoder().encode(key.binding).length > 256) return null;
    return Object.freeze({ algorithm: 'HS256', key: Object.freeze({ type: 'secret', binding: key.binding }) });
  } catch { return null; }
}
function normalizeMacTextResult(value) {
  try {
    const record = macTextRecord(value, ['status']);
    if (record && ['valid', 'invalid-authenticator', 'invalid-input', 'too-large', 'unavailable', 'invalid-key', 'realization-failure'].includes(record.status)) {
      return Object.freeze({ status: record.status });
    }
  } catch { /* Provider details never cross the result boundary. */ }
  return Object.freeze({ status: 'realization-failure' });
}


// Request-owned framing. Secret lookup and realization are explicit provider
// authority; no ambient secret access or algorithm fallback lives here.
async function executeMacText(effect, options = {}) {
  if (!effect || effect.package !== '@pulse-compute/crypto' || effect.contractId !== 'pulse.crypto'
    || effect.providerKind !== 'crypto' || effect.operation !== 'verifyMacText'
    || effect.kind !== 'crypto.verifyMacText' || effect.capability !== effect.kind) throw new TypeError('Invalid Crypto MAC effect authority.');
  const active = () => options.signal?.throwIfAborted();
  const result = status => normalizeMacTextResult({ status });
  active();
  const payload = effect.payload;
  const descriptor = normalizeMacTextOptions({ algorithm: payload?.algorithm, key: payload?.key });
  if (!descriptor) return result('invalid-input');
  const length = textDigestByteLength(payload.message, 65536);
  if (length < 0) return result(length === -2 ? 'too-large' : 'invalid-input');
  if (typeof payload.tag !== 'string' || payload.tag.length !== 64 || !/^[0-9a-f]{64}$/.test(payload.tag)) return result('invalid-input');
  const realization = options.cryptoTarget === 'javascript' ? 'runtime-builtin' : 'guest-source:pulse-hmac-as';
  const implementation = realization === 'runtime-builtin' ? 'webcrypto.subtle.hmac-sha-256.v1' : 'pulse-hmac-as.v1';
  const verify = options.cryptoVerifier?.macText?.verify;
  if (typeof options.secretLookup !== 'function' || typeof verify !== 'function'
    || options.cryptoRealization?.automaticFallback !== false
    || !Array.isArray(options.cryptoRealization?.algorithms)
    || !options.cryptoRealization.algorithms.some(entry => entry?.algorithm === 'HS256'
      && entry.realization === realization && entry.implementation === implementation && entry.available === true)) return result('unavailable');
  let key, data, tag;
  try {
    const value = await options.secretLookup(descriptor.key.binding);
    active();
    if (typeof value === 'string') {
      const keyLength = textDigestByteLength(value, 4096);
      if (keyLength < 32) return result('invalid-key');
      key = new TextEncoder().encode(value);
    } else if (value instanceof Uint8Array && value.byteLength >= 32 && value.byteLength <= 4096) {
      key = new Uint8Array(value);
    } else return result('invalid-key');
    data = new TextEncoder().encode(payload.message);
    tag = new Uint8Array(32);
    for (let i = 0; i < 32; i++) tag[i] = parseInt(payload.tag.slice(i * 2, i * 2 + 2), 16);
    const verified = normalizeMacTextResult(await verify({ algorithm: 'HS256', key: { type: 'hmac-key-bytes', bytes: key }, data, tag }));
    active();
    return ['valid', 'invalid-authenticator', 'realization-failure'].includes(verified.status) ? verified : result('realization-failure');
  } catch {
    active();
    return result('realization-failure');
  } finally { key?.fill(0); data?.fill(0); tag?.fill(0); }
}
function createJavascriptMacText(options = {}) {
  return async (effect, execution = {}) => {
    let selected;
    let subtle;
    try { subtle = options.macSubtle === undefined ? globalThis.crypto?.subtle : options.macSubtle; } catch {}
    if (typeof subtle?.importKey === 'function' && typeof subtle?.verify === 'function') {
      selected = { macText: { async verify(request) {
        const { verifyHs256WithSubtle } = await import('../dist/internal/realization.js');
        return verifyHs256WithSubtle(request, subtle, 'realization-failure');
      } } };
    }
    return executeMacText(effect, { signal: execution.signal, secretLookup: options.secretLookup,
      cryptoTarget: 'javascript', cryptoVerifier: selected,
      cryptoRealization: { automaticFallback: false, algorithms: [{ algorithm: 'HS256', realization: 'runtime-builtin',
        implementation: 'webcrypto.subtle.hmac-sha-256.v1', available: !!selected }] } });
  };
}

module.exports = Object.freeze({ executeMacText, createJavascriptMacText, normalizeMacTextOptions, normalizeMacTextResult, rsaPrivateKeyBytes, bindJavascriptRs256Signer, bindJavascriptEs256Signer, IMPLEMENTATIONS, bindJavascriptDigestMac, DIGEST_TEXT_MAX_BYTES,
  textDigestByteLength, normalizeTextDigestResult, executeTextDigest, createJavascriptTextDigest });
