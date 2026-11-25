'use strict';
const { install } = require('./runtime-overlay.cjs');
const overlay = install();
const assert = require('node:assert/strict');
const http = require('node:http');
const { executeNodeJavascriptApplication: execute } = require('../../../../packages/provider-node/src/javascript/runtime-host.js');
const { createOwner, MAX } = require('./node-transport.cjs');
const { verify } = require('../upload-01/local.cjs');
const { bytesAt, digest } = require('../upload-01/transport.cjs');
const target = { endpoint: 'https://objects.example.invalid', bucket: 'upload-fixture', region: 'us-east-1', accessId: 'fixture-id', secret: 'fixture-secret' };
async function run() {
  const cases = [], received = new Map(); let fixture;
  const server = http.createServer((req, res) => { void (async () => {
    fixture.requests++;
    assert(verify(req.method, req.url, req.headers, target));
    assert.equal(req.method, 'PUT'); assert.equal(req.headers.host, 'objects.example.invalid');
    for (const name of ['cookie', 'x-private', 'content-encoding']) assert.equal(req.headers[name], undefined);
    const chunks = [];
    for await (const chunk of req) { chunks.push(chunk); fixture.prefix(); }
    const body = Buffer.concat(chunks); // Bounded origin oracle only.
    assert(body.length <= MAX); received.set(req.url, body);
    if (fixture.beforeAck) await fixture.beforeAck();
    res.writeHead(200, { 'content-length': '0', etag: '"opaque"' }); res.end();
  })().catch(error => { fixture.error = error; res.destroy(); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  async function trial({ size = 16385, auth = true, key = 'café %/雪.bin', rawHeaders, behavior = 'normal', secretDelay = false } = {}) {
    let sourceReads = 0, cancelled = 0, authorized = false, continued = false, offset = 0, prefixSeen = false, releasePrefix;
    const prefix = new Promise(resolve => { releasePrefix = resolve; });
    const source = new ReadableStream({ pull(controller) {
      assert(authorized || behavior === 'structured-first', 'source must remain unread until authorization');
      sourceReads++;
      if (offset === size) { controller.close(); return; }
      const count = Math.min(65536, size - offset); controller.enqueue(bytesAt(offset, count)); offset += count;
    }, cancel() { cancelled++; } }, { highWaterMark: 0 });
    const request = new Request('https://app.example/upload', { method: 'POST', body: source, duplex: 'half',
      headers: { 'content-length': String(size), authorization: 'caller-auth', cookie: 'private', 'x-private': 'private' } });
    fixture = { requests: 0, prefix() { prefixSeen = true; releasePrefix(); }, beforeAck: async () => {
      assert.equal(continued, false, 'handler cannot continue before complete acknowledgement');
    } };
    const selected = createOwner(request, rawHeaders || [['content-length', String(size)]], {
      binding: target, port: server.address().port, timeoutMs: secretDelay ? 30 : 2000,
      secret(name) { if (secretDelay) return new Promise(() => {}); return name === 'S3_ID' ? target.accessId : target.secret; },
      afterWrite: async metrics => { if (metrics.writes === 1 && size > 65536) { assert(offset < size); await prefix; } }
    });
    const effects = [], observations = []; let marker, staleContext, applicationFailure;
    const app = async ctx => { try {
      staleContext = ctx;
      if (behavior === 'structured-first') { await ctx.req.text(); }
      const allowed = await ctx.secret.get('AUTHORIZE');
      assert.equal(sourceReads, behavior === 'structured-first' ? sourceReads : 0);
      if (allowed !== 'allowed') return ctx.text('denied', { status: 403 });
      authorized = true; marker = ctx.req.body();
      if (behavior === 'foreign') marker = createOwner(new Request('https://app.example/'), [], {}).owner.marker();
      const first = overlay.upload(ctx, { binding: 'objects', key }, marker);
      if (behavior === 'duplicate') overlay.upload(ctx, { binding: 'objects', key }, marker);
      if (behavior === 'structured-after') await ctx.req.text();
      if (behavior === 'parallel') return ctx.parallel({ first });
      if (behavior === 'collection') { const group = ctx.effects({ max: 1 }); group.add(first); return ctx.parallel(group); }
      const result = await first;
      continued = true;
      return ctx.text(JSON.stringify(result));
    } catch(error) {applicationFailure=error.code || error.name;throw error;} };
    let response, failure;
    try {
      response = await execute(app, request, { incomingBody: selected.owner, maxDurationMs: 3000,
        onEffectObservation(event) { observations.push(event); },
        effectAdapter: { dispatch(effect, execution) {
          effects.push(effect.kind);
          if (effect.kind === 'secret.get') { assert.equal(selected.metrics.dispatches, 0); return auth ? 'allowed' : 'denied'; }
          assert.equal(effect.kind, 's3.upload02');
          assert.equal(JSON.stringify(effect.payload), JSON.stringify({ binding: 'objects', key }));
          assert.equal(Object.keys(effect.payload).length, 2);
          return selected.owner.forward(target.endpoint, effect.payload, execution);
        } }
      });
    } catch (error) { failure = error.code || error.name; }
    finally { await selected.owner.close(); }
    if (fixture.error) throw fixture.error;
    const text = response && await response.text();
    const result = text?.startsWith('{') ? JSON.parse(text) : undefined;
    assert.throws(() => overlay.upload(staleContext, { binding: 'objects', key }, marker));
    return { applicationFailure, responseStatus: response?.status, result, failure, sourceReads, cancelled, continued,
      prefixSeen, effects, metrics: selected.metrics, requests: fixture.requests,
      parallelRejected: observations.some(x => x.type === 'parallel-dispatched') === false };
  }
  try {
    for (const size of [0, 1, 16385, MAX]) {
      const row = await trial({ size }); assert.equal(row.result?.status, 'stored', JSON.stringify(row));
      assert.equal(row.result.byteLength, size); assert.equal(row.result.sha256, undefined);
      const body = [...received.values()].at(-1);
      assert.equal(require('node:crypto').createHash('sha256').update(body).digest('hex'), digest(size));
      assert.deepEqual(body, bytesAt(0, size));
      assert.equal(row.metrics.dispatches, 1); assert(row.metrics.inputEOF && row.metrics.uploadFinished && row.continued);
      assert(row.metrics.maxChunkBytes <= 16384 && row.metrics.maxSourceChunkBytes <= 65536);
      cases.push({ name: `binary-${size}`, status: 'passed', ...row });
    }
    for (const scenario of [
      { name: 'authorization-denied', auth: false },
      ...['duplicate', 'foreign', 'structured-first', 'structured-after', 'parallel', 'collection'].map(behavior => ({ name: behavior, behavior, size: behavior === 'structured-first' ? 1 : 16385 })),
      { name: 'invalid-key', key: '../escape' },
      { name: 'missing-length', rawHeaders: [] },
      { name: 'duplicate-length', rawHeaders: [['content-length','1'],['content-length','1']] },
      { name: 'conflicting-framing', rawHeaders: [['content-length','1'],['transfer-encoding','chunked']] },
      { name: 'cap-plus-one', rawHeaders: [['content-length', String(MAX + 1)]] },
      { name: 'credential-deadline', secretDelay: true }
    ]) {
      const row = await trial(scenario);
      assert.equal(row.metrics.dispatches, 0, JSON.stringify({ scenario, row }));
      assert.equal(row.requests, 0); if (scenario.behavior !== 'structured-first') assert.equal(row.sourceReads, 0);
      assert.notEqual(row.result?.status, 'stored');
      if (['duplicate','foreign','structured-first','structured-after'].includes(scenario.behavior)) assert.equal(row.applicationFailure,'PULSE_REQUEST_BODY_OWNERSHIP');
      if (scenario.behavior==='parallel') assert.equal(row.applicationFailure,'PULSE_RUNTIME_PARALLEL_EFFECT_REQUIRED');
      if (scenario.behavior==='collection') assert.match(row.applicationFailure,/^PULSE_EFFECT_COLLECTION_/);
      if (scenario.secretDelay) assert.equal(row.result?.status, 'not-stored');
      cases.push({ name: scenario.name, status: 'passed', ...row });
    }
    return { status: 'passed', cases, runtimeOverlaySha256: require('node:crypto').createHash('sha256').update(overlay.source).digest('hex'),
      limitations: ['research-only package bridge extension', 'loopback HTTP origin; no TLS or live provider claim', 'origin oracle buffers at most 1 MiB', 'no total RSS claim'] };
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
module.exports = { run };
if (require.main === module) run().then(r => require('node:fs').writeFileSync(process.argv[2], JSON.stringify(r, null, 2)+'\n')).catch(e => { console.error(e); process.exitCode = 1; });
