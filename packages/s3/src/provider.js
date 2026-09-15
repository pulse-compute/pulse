'use strict';

// Trusted provider surface; never an application lowering escape. Protocol
// composition is S3-owned, while crypto, secrets and I/O are supplied by hosts.
const { S3_LIMITS } = require('@pulse-compute/wasm-contracts/s3/contracts');
const encoder = new TextEncoder();
const namePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const bytes = (text) => encoder.encode(text);
const hex = (value) => Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('');
function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('S3 expects an ordinary record.');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!fields.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('S3 record contains an unsupported field.');
  }
  return value;
}
function normalizeBinding(value) {
  const input = record(value, ['endpoint', 'bucket', 'region', 'accessKeyIdSecret', 'secretAccessKeySecret', 'sessionTokenSecret', 'maxTextBytes', 'timeoutMs']);
  if (typeof input.endpoint !== 'string' || !/^https:\/\/[a-z0-9.-]+\/?$/.test(input.endpoint)) throw new TypeError('S3 endpoint must be a fixed HTTPS origin.');
  const url = new URL(input.endpoint);
  if (url.hostname.length > 253 || !url.hostname.includes('.') || url.hostname.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part))) throw new TypeError('S3 endpoint hostname is invalid.');
  if (typeof input.bucket !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket) || input.bucket.includes('--')) throw new TypeError('S3 bucket is outside the portable naming subset.');
  if (typeof input.region !== 'string' || !/^[a-z0-9-]{1,64}$/.test(input.region)) throw new TypeError('S3 signing region must be explicit.');
  for (const field of ['accessKeyIdSecret', 'secretAccessKeySecret', 'sessionTokenSecret']) {
    if (field === 'sessionTokenSecret' && input[field] === undefined) continue;
    if (typeof input[field] !== 'string' || !namePattern.test(input[field])) throw new TypeError('S3 credentials must be valid named secret references.');
  }
  const maxTextBytes = input.maxTextBytes === undefined ? S3_LIMITS.defaultTextBytes : input.maxTextBytes;
  const timeoutMs = input.timeoutMs === undefined ? 10000 : input.timeoutMs;
  if (!Number.isInteger(maxTextBytes) || maxTextBytes < 1 || maxTextBytes > S3_LIMITS.textBytes || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('S3 limits are outside the bounded subset.');
  return Object.freeze({ ...input, endpoint: url.origin, maxTextBytes, timeoutMs });
}
function encodeKey(key) {
  if (typeof key !== 'string' || !key.isWellFormed() || !key.length || bytes(key).length > S3_LIMITS.keyBytes
    || /[\u0000-\u001f\u007f-\u009f]/u.test(key) || key.split('/').some((p) => p === '.' || p === '..')) return null;
  // One-time adaptation of Assets' RFC3986 segment encoder. Deliberately no
  // AssetBucket normalization, path joining, middleware or cache policy.
  return key.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}
function credentialsValid(accessId, secret, token) {
  return typeof accessId === 'string' && /^[\x21-\x7e]{1,256}$/.test(accessId)
    && typeof secret === 'string' && secret.isWellFormed() && bytes(secret).length > 0 && bytes(secret).length <= 4096 && !/[\r\n]/.test(secret)
    && (token === undefined || typeof token === 'string' && /^[\x21-\x7e]{1,4096}$/.test(token));
}
function normalizePutOptions(options = {}) {
  record(options, ['contentType']);
  const contentType = options.contentType === undefined ? 'text/plain; charset=utf-8' : options.contentType;
  if (typeof contentType !== 'string' || !/^[\x20-\x7e]{1,128}$/.test(contentType) || contentType.trim() !== contentType) throw new TypeError('S3 content type is outside the bounded literal subset.');
  return Object.freeze({ contentType });
}
async function signRequest(input, crypto) {
  const { binding, method, encodedKey, accessId, secret, token, now } = input;
  const body = method === 'PUT' ? input.body : new Uint8Array();
  const contentType = method === 'PUT' ? normalizePutOptions({ contentType: input.contentType }).contentType : undefined;
  if (!['HEAD', 'GET', 'PUT'].includes(method) || !(body instanceof Uint8Array) || body.length > binding.maxTextBytes || !credentialsValid(accessId, secret, token) || !Number.isFinite(now) || now < 0) throw new TypeError('S3 signing input is invalid.');
  const date = new Date(now).toISOString().replace(/[:-]|\.\d{3}/g, '');
  if (!/^\d{8}T\d{6}Z$/.test(date)) throw new TypeError('S3 signing clock is invalid.');
  const digest = hex(await crypto.sha256(body));
  const host = new URL(binding.endpoint).host;
  const headers = { ...(contentType === undefined ? {} : { 'content-type': contentType }), host, 'x-amz-content-sha256': digest, 'x-amz-date': date, ...(token === undefined ? {} : { 'x-amz-security-token': token }) };
  const names = Object.keys(headers).sort();
  const uri = `/${binding.bucket}/${encodedKey}`;
  const canonical = `${method}\n${uri}\n\n${names.map((name) => `${name}:${headers[name].replace(/ +/g, ' ')}\n`).join('')}\n${names.join(';')}\n${digest}`;
  const scope = `${date.slice(0, 8)}/${binding.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hex(await crypto.sha256(bytes(canonical)))}`;
  let key = bytes(`AWS4${secret}`);
  try {
    for (const part of [date.slice(0, 8), binding.region, 's3', 'aws4_request']) {
      const next = await crypto.hmacSha256(key, bytes(part)); key.fill(0); key = next;
    }
    const signature = await crypto.hmacSha256(key, bytes(toSign));
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hex(signature)}`;
    signature.fill(0);
    headers['accept-encoding'] = 'identity';
    return { method, url: binding.endpoint + uri, headers, ...(method === 'PUT' ? { body } : {}) };
  } finally { key.fill(0); }
}
function failure(reason, httpStatus) { return Object.freeze({ status: 'failed', reason, ...(httpStatus === undefined ? {} : { httpStatus }) }); }
function putFailure(reason, dispatched, httpStatus) {
  return Object.freeze({ status: dispatched ? 'unknown' : 'not-stored', reason, ...(httpStatus === undefined ? {} : { httpStatus }) });
}
function putStatusResult(status) {
  if (status === 200) return null;
  if (status >= 400 && status <= 499 && status !== 408) return putFailure(status === 401 || status === 403 ? 'not-authorized' : status === 429 ? 'throttled' : 'rejected', false, status);
  return putFailure(status === 408 ? 'timeout' : status >= 500 && status <= 599 ? 'unavailable' : 'protocol', true, status);
}
function statusResult(status) {
  if (status === 200) return null;
  if (status === 404) return Object.freeze({ status: 'not-found' });
  return failure(status === 401 || status === 403 ? 'not-authorized' : status === 429 ? 'throttled' : status === 408 ? 'timeout' : status >= 500 && status <= 599 ? 'unavailable' : 'protocol', status);
}
function metadataFromHeaders(headers, head) {
  if (!Array.isArray(headers)) return null;
  const selected = new Map(); let total = 0;
  for (const [rawName, value] of headers) {
    total += bytes(rawName).length + bytes(value).length + 4;
    if (total > S3_LIMITS.headerBytes) return null;
    const name = rawName.toLowerCase();
    if (!['content-length', 'content-type', 'etag', 'content-encoding'].includes(name)) continue;
    if (selected.has(name) || !value.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || bytes(value).length > S3_LIMITS.metadataBytes) return null;
    selected.set(name, value);
  }
  if (selected.has('content-encoding') && selected.get('content-encoding').toLowerCase() !== 'identity') return null;
  const length = selected.get('content-length');
  if ((head && length === undefined) || (length !== undefined && (!/^(0|[1-9][0-9]*)$/.test(length) || !Number.isSafeInteger(Number(length))))) return null;
  if (selected.has('etag') && !selected.get('etag').length) return null;
  return { ...(length === undefined ? {} : { byteLength: Number(length) }),
    ...(selected.has('etag') ? { etag: selected.get('etag') } : {}),
    ...(selected.has('content-type') ? { contentType: selected.get('content-type') } : {}) };
}
function normalizeResult(operation, result) {
  if (!['head', 'getText', 'putText'].includes(operation)) throw new TypeError('Unknown S3 result operation.');
  const allowed = ['status', 'reason', 'httpStatus', 'byteLength', 'etag', 'contentType', 'text', 'sha256'];
  record(result, allowed);
  if (operation === 'putText') {
    const reasons = result.status === 'not-stored' ? ['invalid-key', 'invalid-text', 'too-large', 'configuration', 'credentials', 'not-authorized', 'rejected', 'throttled', 'transport', 'timeout'] : result.status === 'unknown' ? ['transport', 'timeout', 'unavailable', 'protocol'] : [];
    if (reasons.includes(result.reason) && Object.keys(result).every((key) => ['status', 'reason', 'httpStatus'].includes(key))
      && (result.httpStatus === undefined || Number.isInteger(result.httpStatus) && result.httpStatus >= 100 && result.httpStatus <= 599)) return Object.freeze({ ...result });
    if (result.status !== 'stored' || !Number.isInteger(result.byteLength) || result.byteLength < 0 || result.byteLength > S3_LIMITS.textBytes || typeof result.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.sha256)
      || Object.keys(result).some((key) => !['status', 'byteLength', 'sha256', 'etag'].includes(key))
      || result.etag !== undefined && (typeof result.etag !== 'string' || !result.etag.length || !result.etag.isWellFormed() || bytes(result.etag).length > S3_LIMITS.metadataBytes || /[\u0000-\u001f\u007f-\u009f]/u.test(result.etag))) throw new TypeError('PUT returned an invalid bounded result.');
    return Object.freeze({ ...result });
  }
  if (result.status === 'not-found' && Object.keys(result).length === 1) return Object.freeze({ ...result });
  if (result.status === 'failed' && ['invalid-key', 'configuration', 'credentials', 'not-authorized', 'throttled', 'unavailable', 'transport', 'timeout', 'protocol', 'too-large', 'invalid-utf8'].includes(result.reason)
    && Object.keys(result).every((name) => ['status', 'reason', 'httpStatus'].includes(name))
    && (result.httpStatus === undefined || Number.isInteger(result.httpStatus) && result.httpStatus >= 100 && result.httpStatus <= 599)) return Object.freeze({ ...result });
  if (result.status !== 'found' || !Number.isSafeInteger(result.byteLength) || result.byteLength < 0 || Object.hasOwn(result, 'reason') || Object.hasOwn(result, 'httpStatus')) throw new TypeError('S3 returned an invalid bounded result.');
  if (operation === 'head' && (Object.hasOwn(result, 'text') || Object.hasOwn(result, 'sha256'))) throw new TypeError('HEAD cannot return object bytes or a digest.');
  if (operation === 'getText' && (typeof result.text !== 'string' || !result.text.isWellFormed() || bytes(result.text).length !== result.byteLength || result.byteLength > S3_LIMITS.textBytes || typeof result.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.sha256))) throw new TypeError('GET returned an invalid exact-text result.');
  for (const field of ['etag', 'contentType']) if (result[field] !== undefined && (typeof result[field] !== 'string' || !result[field].isWellFormed() || bytes(result[field]).length > S3_LIMITS.metadataBytes || /[\u0000-\u001f\u007f-\u009f]/u.test(result[field]) || field === 'etag' && !result[field].length)) throw new TypeError('S3 metadata exceeds its result contract.');
  if (bytes(JSON.stringify(result)).length > S3_LIMITS.envelopeBytes) throw new TypeError('S3 result envelope exceeds its bound.');
  return Object.freeze({ ...result });
}
module.exports = Object.freeze({ normalizeBinding, namePattern, encodeKey, credentialsValid, normalizePutOptions, signRequest, signRead: signRequest, failure, putFailure, putStatusResult, statusResult, metadataFromHeaders, normalizeResult, hex, bytes });
