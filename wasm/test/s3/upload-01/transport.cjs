'use strict';
// Research transport, not a Pulse provider or public upload API.
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { createAuthorization, encodeS3Key } = require('../../../../packages/s3/src/signing.js');
const { metadataFromHeaders } = require('../../../../packages/s3/src/provider.js');
const CHUNK = 16384, MAX = 1048576;
const primitives = {
  sha256: async data => crypto.createHash('sha256').update(data).digest(),
  hmacSha256: async (key, data) => crypto.createHmac('sha256', key).update(data).digest(),
};
function fail(code) { return Object.assign(new Error(code), { code }); }
function bytesAt(offset, length) {
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = ((offset + i) * 31 + Math.floor((offset + i) / 251)) & 255;
  return out;
}
function digest(size) {
  const hash = crypto.createHash('sha256');
  for (let i = 0; i < size; i += CHUNK) hash.update(bytesAt(i, Math.min(CHUNK, size - i)));
  return hash.digest('hex');
}
function validateTarget(target, local = false) {
  const url = new URL(target.endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw fail('TARGET_INVALID');
  if (local ? url.protocol !== 'http:' || url.hostname !== '127.0.0.1' :
    url.protocol !== 'https:' || url.port || !/^[a-z0-9-]+\.object\.fastlystorage\.app$/.test(url.hostname)) throw fail('TARGET_INVALID');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(target.bucket) || !/^[a-z0-9-]{1,64}$/.test(target.region)) throw fail('TARGET_INVALID');
  for (const value of [target.accessId, target.secret]) if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) throw fail('CREDENTIALS_INVALID');
  return url;
}
async function signed(target, method, key, options = {}) {
  const url = new URL(target.endpoint);
  url.pathname = `/${target.bucket}/${encodeS3Key(key)}`;
  const date = new Date(options.now ?? Date.now()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const payloadHash = options.payloadHash ?? (method === 'PUT' ? 'UNSIGNED-PAYLOAD' : digest(0));
  const headers = { host: url.host, 'x-amz-date': date, 'x-amz-content-sha256': payloadHash };
  if (target.token) headers['x-amz-security-token'] = target.token;
  if (method === 'PUT') Object.assign(headers, { 'content-type': 'application/octet-stream', 'content-length': String(options.size) });
  if (options.expectContinue) headers.expect = '100-continue';
  headers.authorization = await createAuthorization({ method, uri: url.pathname, query: '', headers, date,
    region: target.region, service: 's3', accessId: target.accessId, secret: target.secret, payloadHash }, primitives);
  if (options.badSignature) headers.authorization = headers.authorization.replace(/.$/, ch => ch === '0' ? '1' : '0');
  headers['accept-encoding'] = 'identity';
  headers.connection = 'close';
  return { url, headers };
}
async function request(target, method, key, options = {}) {
  const size = options.size ?? 0;
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX) throw fail('UPLOAD_LIMIT');
  const metrics = { generatedBytes: 0, writes: 0, maxChunkBytes: 0, uploadFinished: false, responseBeforeUploadFinished: false };
  const { url, headers } = await signed(target, method, key, { ...options, size });
  return new Promise((resolve, reject) => {
    let stopped = false, settled = false, response, releaseResponse, releaseContinue;
    const responseArrived = new Promise(done => { releaseResponse = done; });
    const continued = new Promise(done => { releaseContinue = done; });
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, { method, headers, agent: false, maxHeaderSize: 16384 });
    const timer = setTimeout(() => finish(fail('DEADLINE')), options.timeoutMs ?? 5000);
    function finish(error, value) {
      if (settled) return;
      settled = true; stopped = true; clearTimeout(timer); releaseResponse(); releaseContinue();
      response?.destroy(); req.destroy();
      error ? reject(error) : resolve(value);
    }
    req.on('error', () => finish(fail('TRANSPORT')));
    req.on('continue', releaseContinue);
    req.on('response', incoming => {
      response = incoming; stopped = true; releaseResponse(); releaseContinue();
      metrics.responseBeforeUploadFinished = method === 'PUT' && !metrics.uploadFinished;
      (async () => {
        const pairs = [];
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) pairs.push([incoming.rawHeaders[i], incoming.rawHeaders[i + 1]]);
        const metadata = metadataFromHeaders(pairs, method === 'HEAD' && incoming.statusCode === 200);
        if (!metadata) throw fail('RESPONSE_METADATA');
        const hash = crypto.createHash('sha256'); let count = 0, exact = true;
        const readback = method === 'GET' && incoming.statusCode === 200;
        for await (const chunk of incoming) {
          if (count + chunk.length > (readback ? MAX : 16384)) throw fail('RESPONSE_LIMIT');
          if (readback && !chunk.equals(bytesAt(count, chunk.length))) exact = false;
          count += chunk.length; hash.update(chunk);
        }
        if (!incoming.complete) throw fail('RESPONSE_INCOMPLETE');
        if (method !== 'HEAD' && metadata.byteLength !== undefined && metadata.byteLength !== count) throw fail('RESPONSE_LENGTH');
        finish(null, { status: incoming.statusCode, responseBytes: count, metadata,
          ...(readback ? { readback: { bytes: count, sha256: hash.digest('hex'), exact } } : {}), metrics });
      })().catch(error => finish(error));
    });
    (async () => {
      req.flushHeaders();
      if (options.expectContinue) await Promise.race([continued, responseArrived]);
      if (stopped) return;
      if (method === 'PUT') {
        for (let offset = 0; offset < size && !stopped; offset += CHUNK) {
          const chunk = bytesAt(offset, Math.min(CHUNK, size - offset));
          metrics.generatedBytes += chunk.length;
          metrics.maxChunkBytes = Math.max(metrics.maxChunkBytes, chunk.length);
          await new Promise((done, bad) => req.write(chunk, error => error ? bad(fail('WRITE')) : done()));
          metrics.writes++;
          if (offset === 0 && options.afterFirstChunk) await Promise.race([options.afterFirstChunk(metrics), responseArrived]);
        }
      }
      if (stopped) return;
      await new Promise((done, bad) => { req.once('finish', done); req.once('error', () => bad(fail('WRITE'))); req.end(); });
      metrics.uploadFinished = true;
    })().catch(error => finish(error));
  });
}
function acceptedPut(result, size) {
  return result.status === 200 && result.responseBytes === 0 && result.metrics.uploadFinished && result.metrics.generatedBytes === size;
}
module.exports = { CHUNK, MAX, primitives, fail, bytesAt, digest, validateTarget, signed, request, acceptedPut };
