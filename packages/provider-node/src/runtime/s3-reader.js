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
    req.end(request.body);
  });
}
async function fetchFixture(fetch, request, signal) {
  const pending = Promise.resolve().then(() => fetch(request.url, { method: request.method, headers: request.headers, ...(request.body === undefined ? {} : { body: request.body }), redirect: 'manual', cache: 'no-store', signal }));
  pending.then((response) => { if (signal.aborted && response.body) void response.body.cancel().catch(() => {}); }, () => {});
  const response = await abortable(pending, signal);
  const body = response.body ? Readable.fromWeb(response.body, { signal }) : null;
  // A deadline can fire before iteration begins; always observe the stream error.
  if (body) body.on('error', () => {});
  return { status: response.status, headers: [...response.headers], body, close: () => { if (body) body.destroy(); } };
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
async function readS3(effect, options, lookup) {
  const operation = effect.operation, put = operation === 'putText';
  const payload = effect.payload || {};
  if (!['head', 'getText', 'putText'].includes(operation) || effect.kind !== `s3.${operation}` || effect.capability !== effect.kind
    || effect.package !== '@pulse-compute/s3' || effect.contractId !== 'pulse.s3' || effect.providerKind !== 's3') throw new TypeError('Invalid S3 package effect authority.');
  let dispatched = false, status;
  const failure = (reason) => put ? protocol.putFailure(reason, dispatched, status) : protocol.failure(reason, status);
  if (options.signal && options.signal.aborted) throw options.signal.reason || new Error('Request cancelled.');
  const configured = typeof payload.binding === 'string' && options.s3 && Object.hasOwn(options.s3, payload.binding) && options.s3[payload.binding];
  let binding;
  try { binding = protocol.normalizeBinding(configured); } catch { return failure('configuration'); }
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal.reason);
  if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const deadline = performance.now() + binding.timeoutMs;
  const check = () => {
    if (performance.now() >= deadline) { timedOut = true; controller.abort(); }
    if (controller.signal.aborted) throw controller.signal.reason || new Error('S3 deadline expired.');
  };
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, binding.timeoutMs);
  const wait = async (value) => { const result = await abortable(Promise.resolve(value), controller.signal); check(); return result; };
  let response;
  try {
    const key = protocol.encodeKey(payload.key);
    if (key === null) return failure('invalid-key');
    let body, contentType;
    if (put) {
      if (typeof payload.text !== 'string' || !payload.text.isWellFormed()) return failure('invalid-text');
      body = protocol.bytes(payload.text);
      if (body.length > binding.maxTextBytes) return failure('too-large');
      try { contentType = protocol.normalizePutOptions({ contentType: payload.contentType }).contentType; }
      catch { return failure('configuration'); }
    }
    let accessId, secret, token;
    try {
      accessId = await wait(lookup(binding.accessKeyIdSecret));
      secret = await wait(lookup(binding.secretAccessKeySecret));
      token = binding.sessionTokenSecret === undefined ? undefined : await wait(lookup(binding.sessionTokenSecret));
    } catch (error) { check(); return failure('credentials'); }
    if (!protocol.credentialsValid(accessId, secret, token)) return failure('credentials');
    for (const value of [accessId, secret, token]) if (typeof options.registerRedactionValue === 'function' && typeof value === 'string') options.registerRedactionValue(value);
    const crypto = options.cryptoVerifier && options.cryptoVerifier.bytes;
    const algorithms = options.cryptoRealization && options.cryptoRealization.algorithms;
    const realization = options.cryptoTarget === 'javascript' ? 'runtime-builtin' : 'guest-source:pulse-hmac-as';
    if (!crypto || !Array.isArray(algorithms) || ['SHA-256', 'HMAC-SHA256'].some((algorithm) => !algorithms.some((entry) => entry.algorithm === algorithm && entry.available && entry.realization === realization))) return failure('configuration');
    let request;
    try {
      request = await wait(protocol.signRequest({ binding, method: put ? 'PUT' : operation === 'head' ? 'HEAD' : 'GET', encodedKey: key, accessId, secret, token, now: Date.now(), body, contentType }, crypto));
    } catch (error) { check(); return failure('configuration'); }
    check();
    // The send primitive may have side effects even if it throws synchronously.
    dispatched = true;
    response = options.fetchImplementation
      ? await fetchFixture(options.fetchImplementation, request, controller.signal)
      : await originRequest(request, controller.signal);
    status = response.status;
    check();
    const rejected = put ? protocol.putStatusResult(status) : protocol.statusResult(status);
    if (rejected && (!put || rejected.status === 'unknown')) return rejected;
    const metadata = protocol.metadataFromHeaders(response.headers, operation === 'head');
    if (!metadata) return failure('protocol');
    if (operation === 'head') return protocol.normalizeResult(operation, { status: 'found', ...metadata });
    const maximum = put ? rejected ? binding.maxTextBytes : 0 : binding.maxTextBytes;
    if (metadata.byteLength > maximum) return failure(put ? 'protocol' : 'too-large');
    const chunks = []; let total = 0;
    if (response.body) for await (const chunk of response.body) {
      check(); total += chunk.length;
      if (total > maximum) return failure(put ? 'protocol' : 'too-large');
      if (!put) chunks.push(Buffer.from(chunk));
    }
    check();
    if (metadata.byteLength !== undefined && metadata.byteLength !== total) return failure('protocol');
    if (put) return rejected || protocol.normalizeResult(operation, { status: 'stored', byteLength: body.length, sha256: request.headers['x-amz-content-sha256'], ...(metadata.etag === undefined ? {} : { etag: metadata.etag }) });
    const raw = Buffer.concat(chunks, total);
    const digest = protocol.hex(await wait(crypto.sha256(raw)));
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
    catch { return failure('invalid-utf8'); }
    check();
    return protocol.normalizeResult(operation, { status: 'found', ...metadata, byteLength: total, text, sha256: digest });
  } catch (error) {
    if (options.signal && options.signal.aborted) throw options.signal.reason || error;
    return failure(timedOut ? 'timeout' : status === undefined ? 'transport' : 'protocol');
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
    controller.abort();
    if (response) { try { await response.close(); } catch {} }
  }
}
module.exports = { readS3, originRequest };
