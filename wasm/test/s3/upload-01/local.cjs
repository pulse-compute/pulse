'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const T = require('./transport.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

// Independent verifier: deliberately does not call Pulse's signer.
function verify(method, uri, headers, target) {
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8}\/[^/]+\/s3\/aws4_request), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(headers.authorization || '');
  if (!match || match[1] !== target.accessId || match[2] !== `${headers['x-amz-date'].slice(0, 8)}/${target.region}/s3/aws4_request`) return false;
  const names = match[3].split(';');
  if (names.join(';') !== [...new Set(names)].sort().join(';') || !names.includes('host') || !names.includes('x-amz-date')) return false;
  if (method === 'PUT' && (!names.includes('content-length') || !names.includes('content-type'))) return false;
  if (names.some(name => typeof headers[name] !== 'string')) return false;
  const canonical = [method, uri, '', names.map(name => `${name}:${headers[name].trim().replace(/\s+/g, ' ')}\n`).join(''), names.join(';'), headers['x-amz-content-sha256']].join('\n');
  const scope = match[2].split('/');
  let key = Buffer.from(`AWS4${target.secret}`);
  for (const part of scope) { const next = hmac(key, part); key.fill(0); key = next; }
  const actual = hmac(key, `AWS4-HMAC-SHA256\n${headers['x-amz-date']}\n${match[2]}\n${hash(canonical)}`); key.fill(0);
  return crypto.timingSafeEqual(actual, Buffer.from(match[4], 'hex'));
}
async function run() {
  const cases = [], objects = new Map(), firstRead = new Map();
  const target = { endpoint: '', bucket: 'upload-fixture', region: 'us-east-1', accessId: 'fixture-id', secret: 'fixture-secret' };
  let requests = 0;
  const server = http.createServer();
  async function handle(req, res, expect) {
    requests++;
    if (!verify(req.method, req.url, req.headers, target)) { res.writeHead(403, { 'content-length': '0', connection: 'close' }); res.end(); return; }
    if (expect) res.writeContinue();
    if (req.url.endsWith('/stall')) return;
    if (req.url.endsWith('/bad-ack')) { res.writeHead(200, { etag: ['a', 'b'], 'content-length': '0' }); res.end(); return; }
    if (req.method === 'PUT') {
      const chunks = []; let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > T.MAX) { res.writeHead(413); res.end(); return; }
        firstRead.get(req.url)?.();
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks); // Bounded fixture storage, not the client transfer path.
      if (req.headers['x-amz-content-sha256'] !== 'UNSIGNED-PAYLOAD' && req.headers['x-amz-content-sha256'] !== hash(bytes)) {
        res.writeHead(400, { 'content-length': '0' }); res.end(); return;
      }
      objects.set(req.url, bytes);
      res.writeHead(200, { 'content-length': '0', etag: '"fixture-opaque"' }); res.end(); return;
    }
    if (req.method === 'DELETE') { objects.delete(req.url); res.writeHead(204); res.end(); return; }
    if (!objects.has(req.url)) { res.writeHead(404, { 'content-length': '0' }); res.end(); return; }
    const body = objects.get(req.url);
    res.writeHead(200, { 'content-length': body.length, 'content-type': 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  const dispatch = expect => (req, res) => { void handle(req, res, expect).catch(() => res.destroy()); };
  server.on('request', dispatch(false)); server.on('checkContinue', dispatch(true));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  target.endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    T.validateTarget(target, true);
    for (const endpoint of [target.endpoint, 'https://objects.example.invalid', 'https://user:pass@us-central-1.object.fastlystorage.app', 'https://us-central-1.object.fastlystorage.app/path']) {
      assert.throws(() => T.validateTarget({ ...target, endpoint }), { code: 'TARGET_INVALID' });
    }
    cases.push({ name: 'live-target-containment', status: 'passed' });
    // Existing independently published AWS vector anchors the production signer.
    const v = require('../o1/vectors.json').signing;
    const authorization = await require('../../../../packages/s3/src/signing.js').createAuthorization({ method: 'GET', uri: v.path, query: '',
      headers: { host: v.host, range: v.range, 'x-amz-content-sha256': hash(''), 'x-amz-date': v.date }, date: v.date,
      region: v.region, service: 's3', accessId: 'AKIAIOSFODNN7EXAMPLE', secret: v.secretAccessKey, payloadHash: hash('') }, T.primitives);
    assert(authorization.endsWith(`Signature=${v.signature}`));
    cases.push({ name: 'aws-known-answer', status: 'passed' });
    for (const size of [0, 1, T.CHUNK - 1, T.CHUNK, T.CHUNK + 1, T.MAX]) {
      const key = `probe/binary-${size}`;
      let observed = false, release;
      const prefix = new Promise(done => { release = done; });
      firstRead.set(`/${target.bucket}/${key}`, release);
      const put = await T.request(target, 'PUT', key, { size, afterFirstChunk: size > T.CHUNK ? async metrics => {
        assert(metrics.generatedBytes < size); assert.equal(metrics.uploadFinished, false);
        await prefix; observed = true;
      } : undefined });
      assert(T.acceptedPut(put, size));
      if (size > T.CHUNK) assert(observed);
      const get = await T.request(target, 'GET', key);
      assert.equal(get.status, 200); assert.deepEqual(get.readback, { bytes: size, sha256: T.digest(size), exact: true });
      assert.equal((await T.request(target, 'DELETE', key)).status, 204);
      assert.equal((await T.request(target, 'HEAD', key)).status, 404);
      cases.push({ name: `unsigned-${size}`, status: 'passed', put, readback: get.readback, prefixObservedBeforeProducerEOF: size > T.CHUNK ? observed : null });
    }
    for (const wrong of [false, true]) {
      const put = await T.request(target, 'PUT', `probe/hash-${wrong}`, { size: 1024, payloadHash: wrong ? '0'.repeat(64) : T.digest(1024) });
      assert.equal(put.status, wrong ? 400 : 200);
      if (!wrong) { assert(T.acceptedPut(put, 1024)); await T.request(target, 'DELETE', `probe/hash-${wrong}`); }
      cases.push({ name: wrong ? 'hashed-wrong-digest-rejected' : 'hashed-control', status: 'passed', httpStatus: put.status });
    }
    const denied = await T.request(target, 'PUT', 'probe/denied', { size: T.MAX, expectContinue: true, badSignature: true });
    assert.equal(denied.status, 403); assert.equal(denied.metrics.generatedBytes, 0);
    cases.push({ name: 'early-signature-rejection', status: 'passed', httpStatus: denied.status, generatedBytes: denied.metrics.generatedBytes });
    const before = requests;
    await assert.rejects(T.request(target, 'PUT', 'probe/oversize', { size: T.MAX + 1 }), { code: 'UPLOAD_LIMIT' });
    assert.equal(requests, before);
    cases.push({ name: 'cap-plus-one-no-dispatch', status: 'passed' });
    await assert.rejects(T.request(target, 'PUT', 'probe/bad-ack', { size: 0 }), { code: 'RESPONSE_METADATA' });
    cases.push({ name: 'malformed-ack-rejected', status: 'passed' });
    await assert.rejects(T.request(target, 'PUT', 'probe/stall', { size: 0, timeoutMs: 100 }), { code: 'DEADLINE' });
    cases.push({ name: 'transport-deadline', status: 'passed', timeoutMs: 100 });
    assert.equal(objects.size, 0);
    return { status: 'passed', kind: 'loopback-http-independent-sigv4-oracle', cases, requests,
      limitations: ['not Fastly Object Storage acceptance', 'not a Pulse provider', 'fixture storage buffers up to 1 MiB', 'no TLS/provider/host-memory claim'] };
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
}
module.exports = { run, verify };
