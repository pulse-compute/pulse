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
    const data = snapshot(input, 32768);
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
module.exports = Object.freeze({ IMPLEMENTATIONS, bindJavascriptDigestMac });
