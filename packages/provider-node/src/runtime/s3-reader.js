'use strict';
const https = require('node:https');
const { Readable } = require('node:stream');
const { performance } = require('node:perf_hooks');
const protocol = require('@pulse-compute/s3/provider');

function originRequest(request, signal) {
  return new Promise((resolve, reject) => {
    const req = https.request(request.url, { method: request.method, headers: request.headers, signal, maxHeaderSize: 16384 }, (response) => {
      let headers = [];
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        // Node exposes HTTP header octets as Latin-1 strings. Interpret the
        // bounded protocol metadata as UTF-8, matching the Native host ABI.
        for (let i = 0; i < response.rawHeaders.length; i += 2) headers.push([response.rawHeaders[i], decoder.decode(Buffer.from(response.rawHeaders[i + 1], 'latin1'))]);
      } catch { headers = null; }
      resolve({ status: response.statusCode, headers, body: response, close: () => response.destroy() });
    });
    req.once('error', reject);
    req.end();
  });
}
async function fetchFixture(fetch, request, signal) {
  const pending = Promise.resolve().then(() => fetch(request.url, { method: request.method, headers: request.headers, redirect: 'manual', cache: 'no-store', signal }));
  pending.then((response) => { if (signal.aborted && response.body) void response.body.cancel().catch(() => {}); }, () => {});
  const response = await abortable(pending, signal);
  const body = response.body ? Readable.fromWeb(response.body, { signal }) : null;
  // A deadline can fire before iteration begins; always observe the stream error.
  if (body) body.on('error', () => {});
  return { status: response.status, headers: [...response.headers], body, close: () => { if (body) body.destroy(); } };
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function readS3(effect, options, lookup) {
  const operation = effect.operation;
  const payload = effect.payload || {};
  if (!['head', 'getText'].includes(operation) || effect.kind !== `s3.${operation}` || effect.capability !== effect.kind
    || effect.package !== '@pulse-compute/s3' || effect.contractId !== 'pulse.s3' || effect.providerKind !== 's3') throw new TypeError('Invalid S3 package effect authority.');
  const binding = typeof payload.binding === 'string' && options.s3 && Object.hasOwn(options.s3, payload.binding) && options.s3[payload.binding];
  if (!binding) return protocol.failure('configuration');
  const key = protocol.encodeKey(payload.key);
  if (key === null) return protocol.failure('invalid-key');
  if (options.signal && options.signal.aborted) throw options.signal.reason || new Error('Request cancelled.');
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal.reason);
  if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const deadline = performance.now() + binding.timeoutMs;
  const expired = () => {
    if (performance.now() >= deadline) { timedOut = true; controller.abort(); }
    return controller.signal.aborted;
  };
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, binding.timeoutMs);
  let response;
  let status;
  try {
    let accessId, secret, token;
    try {
      accessId = lookup(binding.accessKeyIdSecret); secret = lookup(binding.secretAccessKeySecret);
      token = binding.sessionTokenSecret === undefined ? undefined : lookup(binding.sessionTokenSecret);
    } catch { return protocol.failure('credentials'); }
    if (expired()) throw new Error('Request deadline expired.');
    if (!protocol.credentialsValid(accessId, secret, token)) return protocol.failure('credentials');
    for (const value of [accessId, secret, token]) if (typeof options.registerRedactionValue === 'function' && typeof value === 'string') options.registerRedactionValue(value);
    const crypto = options.cryptoVerifier && options.cryptoVerifier.bytes;
    const algorithms = options.cryptoRealization && options.cryptoRealization.algorithms;
    if (!crypto || !Array.isArray(algorithms) || ['SHA-256', 'HMAC-SHA256'].some((algorithm) => !algorithms.some((entry) => entry.algorithm === algorithm && entry.available && entry.realization === 'guest-source:pulse-hmac-as'))) return protocol.failure('configuration');
    const request = await protocol.signRead({ binding, method: operation === 'head' ? 'HEAD' : 'GET', encodedKey: key, accessId, secret, token, now: Date.now() }, crypto);
    if (expired()) throw new Error('Request deadline expired.');
    response = options.fetchImplementation
      ? await fetchFixture(options.fetchImplementation, request, controller.signal)
      : await originRequest(request, controller.signal);
    status = response.status;
    if (expired()) throw new Error('Request deadline expired.');
    const rejected = protocol.statusResult(status);
    if (rejected) return rejected;
    const metadata = protocol.metadataFromHeaders(response.headers, operation === 'head');
    if (!metadata) return protocol.failure('protocol', status);
    if (operation === 'head') return protocol.normalizeResult(operation, { status: 'found', ...metadata });
    if (metadata.byteLength > binding.maxTextBytes) return protocol.failure('too-large', status);
    const chunks = []; let total = 0;
    if (response.body) for await (const chunk of response.body) {
      if (expired()) throw new Error('Request deadline expired.');
      total += chunk.length;
      if (total > binding.maxTextBytes) return protocol.failure('too-large', status);
      chunks.push(Buffer.from(chunk));
    }
    if (expired()) throw new Error('Request deadline expired.');
    if (metadata.byteLength !== undefined && metadata.byteLength !== total) return protocol.failure('protocol', status);
    const body = Buffer.concat(chunks, total);
    const digest = protocol.hex(crypto.sha256(body));
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body); }
    catch { return protocol.failure('invalid-utf8', status); }
    if (expired()) throw new Error('Request deadline expired.');
    return protocol.normalizeResult(operation, { status: 'found', ...metadata, byteLength: total, text, sha256: digest });
  } catch (error) {
    if (options.signal && options.signal.aborted) throw options.signal.reason || error;
    return protocol.failure(timedOut ? 'timeout' : status === 200 ? 'protocol' : 'transport', status);
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
    if (response) { try { await response.close(); } catch {} }
  }
}
module.exports = { readS3, originRequest };
