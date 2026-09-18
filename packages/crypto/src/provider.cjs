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
      data = snapshot(input, 32768);
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
function textDigestByteLength(text) {
  if (typeof text !== 'string') return -1;
  if (text.length > DIGEST_TEXT_MAX_BYTES) return -2;
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
  return bytes > DIGEST_TEXT_MAX_BYTES ? -2 : bytes;
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

module.exports = Object.freeze({ bindJavascriptEs256Signer, IMPLEMENTATIONS, bindJavascriptDigestMac, DIGEST_TEXT_MAX_BYTES,
  textDigestByteLength, normalizeTextDigestResult, executeTextDigest, createJavascriptTextDigest });
