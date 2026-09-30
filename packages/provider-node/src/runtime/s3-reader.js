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
  const operation = effect.operation, put = operation === 'putText', bodyRead = operation === 'getBody';
  const payload = effect.payload || {};
  if (!['head', 'getText', 'putText', 'getBody'].includes(operation) || effect.kind !== `s3.${operation}` || effect.capability !== effect.kind
    || effect.package !== '@pulse-compute/s3' || effect.contractId !== 'pulse.s3' || effect.providerKind !== 's3') throw new TypeError('Invalid S3 package effect authority.');
  let dispatched = false, status;
  const failure = (reason) => bodyRead ? new Response(null, { status: reason === 'timeout' ? 504 : 502, headers: { 'x-pulse-s3-error': reason } }) : put ? protocol.putFailure(reason, dispatched, status) : protocol.failure(reason, status);
  if (options.signal && options.signal.aborted) throw options.signal.reason || new Error('Request cancelled.');
  const configured = typeof payload.binding === 'string' && options.s3 && Object.hasOwn(options.s3, payload.binding) && options.s3[payload.binding];
  let binding;
  try { binding = protocol.normalizeBinding(configured); } catch { return failure('configuration'); }
  const timeoutMs = Math.min(binding.timeoutMs, options.requestBudget?.remainingMs() ?? Infinity);
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal.reason);
  if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
  const bodyAbort = () => controller.abort(options.responseSignal.reason);
  if (options.responseSignal) {
    options.responseSignal.addEventListener('abort', bodyAbort, { once: true });
    if (options.responseSignal.aborted) bodyAbort();
  }
  let timedOut = false;
  const deadline = performance.now() + timeoutMs;
  const check = () => {
    if (!transferred) options.requestBudget?.check();
    if (performance.now() >= deadline) { timedOut = true; controller.abort(); }
    if (controller.signal.aborted) throw controller.signal.reason || new Error('S3 deadline expired.');
  };
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const wait = async (value) => { const result = await abortable(Promise.resolve(value), controller.signal); check(); return result; };
  let response, transferred = false, cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
    options.responseSignal?.removeEventListener('abort', bodyAbort);
    controller.abort();
    if (response) { try { response.close(); } catch {} }
  };
  try {
    const key = protocol.encodeKey(payload.key);
    if (key === null) return failure('invalid-key');
    let readOptions;
    if (bodyRead) {
      try { readOptions = protocol.normalizeBodyOptions({ method: payload.method, ...(payload.range === undefined ? {} : { range: payload.range }), ...(payload.ifNoneMatch === undefined ? {} : { ifNoneMatch: payload.ifNoneMatch }) }); }
      catch { return failure('configuration'); }
    }
    let body, contentType;
    if (put) {
      if (typeof payload.text !== 'string') return failure('invalid-text');
      if (payload.text.length > binding.maxTextBytes) return failure('too-large');
      if (!payload.text.isWellFormed()) return failure('invalid-text');
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
      request = await wait(protocol.signRequest({ binding, method: bodyRead ? readOptions.method : put ? 'PUT' : operation === 'head' ? 'HEAD' : 'GET', encodedKey: key, accessId, secret, token, now: Date.now(), body, contentType, readOptions }, crypto));
    } catch (error) { check(); return failure('configuration'); }
    check();
    // The send primitive may have side effects even if it throws synchronously.
    dispatched = true;
    response = options.fetchImplementation
      ? await fetchFixture(options.fetchImplementation, request, controller.signal)
      : await originRequest(request, controller.signal);
    status = response.status;
    check();
    if (bodyRead) {
      let metadata;
      try { metadata = protocol.bodyResponseMetadata(status, response.headers, readOptions, binding.maxTextBytes); }
      catch (error) { return failure(error.message === 'too-large' ? 'too-large' : 'protocol'); }
      if (!metadata.body) return new Response(null, { status, headers: metadata.headers });
      const stream = boundedBody(response, metadata.byteLength, binding.maxTextBytes, controller.signal, check, cleanup);
      transferred = true;
      return new Response(stream, { status, headers: metadata.headers });
    }
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
    if (!transferred) cleanup();
  }
}
function boundedBody(response, expected, maximum, signal, check, cleanup) {
  const iterator = response.body?.[Symbol.asyncIterator]();
  let total = 0, ended = false, abort;
  const finish = () => { ended = true; signal.removeEventListener('abort', abort); cleanup(); };
  return new ReadableStream({
    start(controller) {
      abort = () => {
        if (ended) return;
        controller.error(new Error('S3 body transfer aborted.'));
        finish();
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller) {
      try {
        check();
        const item = iterator ? await iterator.next() : { done: true };
        if (ended) return;
        check();
        if (item.done) {
          if (total !== expected) throw new Error('S3 body length mismatch.');
          controller.close(); finish(); return;
        }
        if (!(item.value instanceof Uint8Array)) throw new Error('Invalid S3 body bytes.');
        total += item.value.byteLength;
        if (total > maximum || total > expected) throw new Error('S3 body exceeds its bound.');
        controller.enqueue(item.value);
      } catch {
        if (!ended) { controller.error(new Error('S3 body transfer failed.')); finish(); }
      }
    },
    cancel() { finish(); }
  }, { highWaterMark: 0 });
}
module.exports = { readS3, originRequest };
