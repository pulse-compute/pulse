'use strict';
// Experimental host-owned PUT transport. Uses the unchanged ownership state
// machine, Node bounded pump and S3 metadata/signature owners.
const http = require('node:http');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createIncomingBodyOwnership } = require('../../../../packages/runtime/src/internal/incoming-body.js');
const { boundedBody } = require('../../../../packages/provider-node/src/javascript/incoming-body.js');
const P = require('../../../../packages/s3/src/provider.js');
const { createAuthorization } = require('../../../../packages/s3/src/signing.js');
const MAX = 1048576;
const primitives = { sha256: async value => crypto.createHash('sha256').update(value).digest(),
  hmacSha256: async (key, value) => crypto.createHmac('sha256', key).update(value).digest() };
function error(code) { return Object.assign(new Error(code), { code }); }
function declaredLength(headers) {
  const lengths = headers.filter(([n]) => n.toLowerCase() === 'content-length');
  if (lengths.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(lengths[0][1])
    || headers.some(([n]) => ['transfer-encoding', 'content-encoding'].includes(n.toLowerCase()))) throw error('UPLOAD02_LENGTH');
  const size = Number(lengths[0][1]);
  if (!Number.isSafeInteger(size) || size > MAX) throw error('UPLOAD02_LIMIT');
  return size;
}
function createOwner(request, rawHeaders, options) {
  let length, input, wire, ended = false;
  const metrics = { reads: 0, writes: 0, bytes: 0, dispatches: 0, maxChunkBytes: 0, maxSourceChunkBytes: 0,
    uploadFinished: false, inputEOF: false, closed: false };
  const owner = createIncomingBodyOwnership({
    validate(metadata) {
      if (Object.keys(metadata).sort().join(',') !== 'binding,key' || metadata.binding !== 'objects'
        || P.encodeKey(metadata.key) === null) throw error('UPLOAD02_AUTHORITY');
      length = declaredLength(rawHeaders);
    },
    async forward(_ignored, payload, execution) {
      const controller = new AbortController(), deadline = performance.now() + options.timeoutMs;
      const signal = AbortSignal.any([controller.signal, execution.signal].filter(Boolean));
      const timer = setTimeout(() => controller.abort(error('UPLOAD02_DEADLINE')), options.timeoutMs);
      let response, dispatched = false;
      const check = () => { execution.requestBudget?.check(); signal.throwIfAborted(); if (performance.now() >= deadline) throw error('UPLOAD02_DEADLINE'); };
      const wait = promise => new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) abort();
      });
      try {
        check();
        const accessId = await wait(options.secret('S3_ID')), secret = await wait(options.secret('S3_SECRET')); check();
        if (!P.credentialsValid(accessId, secret)) return { status: 'not-stored', reason: 'credentials' };
        const target = options.binding, uri = '/' + target.bucket + '/' + P.encodeKey(payload.key);
        const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
        const headers = { host: new URL(target.endpoint).host, 'x-amz-date': date, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
          'content-type': 'application/octet-stream', 'content-length': String(length) };
        headers.authorization = await wait(createAuthorization({ method: 'PUT', uri, query: '', headers, date,
          region: target.region, service: 's3', accessId, secret, payloadHash: 'UNSIGNED-PAYLOAD' }, primitives)); check();
        // Fixed loopback wire oracle, never a caller-selected destination. The
        // signed Host/path remain the fixed HTTPS binding. TLS is not modeled.
        dispatched = true; metrics.dispatches++;
        wire = http.request({ hostname: '127.0.0.1', port: options.port, path: uri, method: 'PUT', headers,
          agent: false, signal, maxHeaderSize: 16384 });
        const responseReady = new Promise((resolve, reject) => {
          wire.once('response', value => { response = value; input?.stop(); resolve(value); });
          wire.once('error', reject);
        });
        responseReady.catch(() => {});
        wire.flushHeaders();
        input = boundedBody(request.body, MAX, signal, value => {
          metrics.maxChunkBytes = value.maxChunkBytes; metrics.maxSourceChunkBytes = value.maxSourceChunkBytes;
        });
        const reader = input.stream.getReader();
        try {
          while (!response) {
            check();
            const next = await wait(reader.read()); metrics.reads++; check();
            if (response) break;
            if (next.done) { metrics.inputEOF = true; break; }
            if (metrics.bytes + next.value.length > length) throw error('UPLOAD02_LENGTH');
            metrics.bytes += next.value.length;
            await wait(new Promise((resolve, reject) => wire.write(next.value, cause => cause ? reject(cause) : resolve())));
            metrics.writes++;
            if (options.afterWrite) await wait(options.afterWrite(metrics));
          }
          if (!response) {
            if (metrics.bytes !== length) throw error('UPLOAD02_LENGTH');
            await wait(new Promise((resolve, reject) => { wire.once('finish', resolve); wire.once('error', reject); wire.end(); }));
            metrics.uploadFinished = true;
          }
        } finally { reader.releaseLock(); }
        response = await wait(responseReady); check();
        const pairs = [];
        for (let i = 0; i < response.rawHeaders.length; i += 2) pairs.push([response.rawHeaders[i], response.rawHeaders[i + 1]]);
        const metadata = P.metadataFromHeaders(pairs, false);
        if (!metadata) throw error('UPLOAD02_ACK');
        let count = 0;
        for await (const chunk of response) { check(); count += chunk.length; if (count > 16384) throw error('UPLOAD02_ACK'); }
        if (!response.complete || (metadata.byteLength !== undefined && metadata.byteLength !== count)) throw error('UPLOAD02_ACK');
        check();
        if (response.statusCode >= 400 && response.statusCode <= 499 && response.statusCode !== 408) return { status: 'not-stored', reason: 'rejected', httpStatus: response.statusCode };
        if (response.statusCode !== 200 || count !== 0 || !metrics.inputEOF || !metrics.uploadFinished) throw error('UPLOAD02_ACK');
        return Object.freeze({ status: 'stored', byteLength: metrics.bytes, ...(metadata.etag ? { etag: metadata.etag } : {}) });
      } catch (cause) {
        if (execution.signal?.aborted) throw execution.signal.reason;
        return { status: dispatched ? 'unknown' : 'not-stored', reason: cause.code === 'UPLOAD02_DEADLINE' ? 'timeout' : 'transfer' };
      } finally {
        clearTimeout(timer); input?.stop(); response?.destroy(); wire?.destroy(); ended = true; metrics.closed = true;
      }
    },
    cancel(reason) {
      input?.stop(reason); wire?.destroy();
      if (!input && request.body && !request.body.locked) void request.body.cancel(reason).catch(() => {});
      metrics.closed = true;
    }
  });
  return { owner, metrics, get ended() { return ended; } };
}
module.exports = { createOwner, declaredLength, MAX };
