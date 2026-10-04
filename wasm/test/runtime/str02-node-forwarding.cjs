'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { createNodeJavascriptServer } = require('../../../packages/provider-node/src/javascript/lifecycle.js');
const { writeWebResponseToNode } = require('../../../packages/provider-node/src/javascript/node-adapter.js');
const { boundedBody, createIncomingBody } = require('../../../packages/provider-node/src/javascript/incoming-body.js');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
function client(url, path, headers = {}, onChunk) {
  const result = deferred();
  const request = http.request(url + path, { method: 'POST', headers }, response => {
    assert.equal(response.headers.connection, 'close', 'abandoned input must not keep the connection alive');
    const chunks = [];
    response.on('data', chunk => { chunks.push(chunk); onChunk?.(chunk); });
    response.on('end', () => result.resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString() }));
    response.on('error', error => result.resolve({ error }));
  });
  request.on('error', error => result.resolve({ error }));
  request.setTimeout(5000, () => request.destroy(new Error('STR-02 fixture timed out')));
  return { request, result: result.promise };
}

async function main() {
  let first = deferred(), originCalls = 0, lateResponse;
  const origin = http.createServer((request, response) => {
    originCalls++;
    if (request.url === '/early') { response.end('early'); return; }
    if (request.url === '/redirect') { response.writeHead(307, { location: '/collect' }); response.end(); return; }
    if (request.url === '/late-error') { lateResponse = response; response.writeHead(200); response.write('prefix'); return; }
    let bytes = 0; const digest = createHash('sha256');
    request.on('data', chunk => { bytes += chunk.length; digest.update(chunk); first.resolve(); });
    request.on('end', () => response.end(JSON.stringify({ bytes, hash: digest.digest('hex') })));
  });
  const originUrl = await listen(origin);
  const observations = [];
  const errors = [];
  const app = async ctx => {
    if (ctx.req.path === '/deny') return ctx.text('denied', { status: 403 });
    if (ctx.req.path === '/duplicate') return ctx.parallel({
      one: ctx.fetch(originUrl + '/collect', { method: 'POST', body: ctx.req.body() }),
      two: ctx.fetch(originUrl + '/collect', { method: 'POST', body: ctx.req.body() })
    });
    if (ctx.req.path === '/invalid-group') return ctx.parallel({
      one: ctx.fetch(originUrl + '/collect', { method: 'POST', body: ctx.req.body() }),
      two: ctx.fetch('invalid URL', { method: 'POST', body: ctx.req.body() })
    });
    if (ctx.req.path === '/read-first') await ctx.req.text();
    if (ctx.req.path === '/headers') return ctx.fetch(originUrl, { method: 'POST', headers: { 'content-length': '99' }, body: ctx.req.body() });
    if (ctx.req.path === '/short-timeout') return ctx.fetch(originUrl + '/late-error', { method:'POST',body:ctx.req.body(),timeoutMs:50 });
    return ctx.fetch(originUrl + ctx.req.path, { method: 'POST', body: ctx.req.body() });
  };
  const server = createNodeJavascriptServer(app, {
    bodyForwarding: { maxBytes: 64 * 1024 * 1024 }, maxDurationMs: 30000,
    fetchImplementation: globalThis.fetch,
    onBodyForwardingObservation(value) { observations.push(value); },
    onError(value) { errors.push(value.code); }
  });
  const url = await listen(server);
  let deniedReads = 0;
  server.prependListener('request', request => {
    if(request.url !== '/deny') return;
    const read = request.read;
    request.read = function(size) { if(size > 0) deniedReads++; return read.call(this,size); };
  });
  try {
    const live = client(url, '/collect');
    live.request.write(Buffer.from([0, 255, 7]));
    await Promise.race([first.promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('origin did not receive bytes before EOF')), 2000); timer.unref(); })]);
    live.request.end(Buffer.from([2, 3]));
    const result = await live.result;
    assert.equal(result.status, 200, result.text);
    assert.equal(JSON.parse(result.text).bytes, 5);

    const sizes = [];
    for (const mib of [1, 16, 64]) {
      const body = Buffer.alloc(16 * 1024, 173), expected = createHash('sha256');
      const active = client(url, '/collect');
      observations.length = 0;
      for (let n = 0; n < mib * 64; n++) {
        expected.update(body);
        if (!active.request.write(body)) await once(active.request, 'drain');
      }
      active.request.end();
      const actual = await active.result;
      assert.equal(actual.status, 200, actual.text);
      assert.deepEqual(JSON.parse(actual.text), { bytes: mib * 1024 * 1024, hash: expected.digest('hex') });
      assert.ok(observations.length);
      const highWater = Math.max(...observations.map(o => o.maxQueuedBytes));
      assert.ok(highWater <= 65536);
      assert.ok(observations.every(o => o.maxChunkBytes <= 16384));
      sizes.push({ mib, maxManagedQueueBytes: highWater });
    }

    for (const route of ['/deny', '/duplicate', '/invalid-group', '/headers', '/read-first']) {
      const before = originCalls, active = client(url, route);
      if (route === '/read-first') active.request.end('bounded');
      else active.request.write('partial');
      const result = await active.result;
      assert.equal(result.status, route === '/deny' ? 403 : 500, route + ': ' + JSON.stringify(result));
      assert.equal(originCalls, before, 'rejected claims must not dispatch');
      active.request.destroy();
    }
    assert.equal(deniedReads,0,'authorization denial must not read incoming bytes');
    const early = client(url, '/early'); early.request.write('partial');
    assert.deepEqual(await early.result, { status: 200, text: 'early' }); early.request.destroy();
    const before = originCalls, redirect = client(url, '/redirect'); redirect.request.end('one');
    assert.equal((await redirect.result).status, 500); assert.equal(originCalls, before + 1);
    const empty = client(url, '/collect'); empty.request.end();
    assert.equal(JSON.parse((await empty.result).text).bytes, 0);

    const prefix = deferred();
    const late = client(url, '/late-error', {}, () => prefix.resolve()); late.request.end('one');
    await prefix.promise; lateResponse.destroy();
    assert.ok((await late.result).error, 'post-header failure must abort, not end cleanly');
    const timed = client(url, '/short-timeout'); timed.request.end('one');
    assert.ok((await timed.result).error, 'the shorter fetch timeout must remain active after headers');

    for (const [maxBytes, duration, declared] of [[5, 1000, false], [5, 1000, true], [1024, 50, false]]) {
      const bounded = createNodeJavascriptServer(app, {bodyForwarding:{maxBytes},maxDurationMs:duration,fetchImplementation:globalThis.fetch});
      const boundedUrl = await listen(bounded);
      try {
        const active = client(boundedUrl, '/collect', declared ? {'content-length':'6'} : {});
        active.request.write(maxBytes === 5 ? '123456' : 'pending');
        assert.equal((await active.result).status, maxBytes === 5 ? 413 : 504);
        active.request.destroy();
      } finally { await close(bounded); }
    }

    const disconnected = client(url, '/collect'); disconnected.request.write('pending');
    await new Promise(resolve => setImmediate(resolve)); disconnected.request.destroy();
    await disconnected.result;
    const healthy = client(url, '/collect'); healthy.request.end('healthy');
    assert.equal(JSON.parse((await healthy.result).text).bytes, 7, 'disconnect must not poison the next request');

    let cancelled = 0;
    const oversized = boundedBody(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(65537)); }, cancel() { cancelled++; } }), 100000, undefined);
    await assert.rejects(new Response(oversized.stream).arrayBuffer(), { code: 'PULSE_REQUEST_FORWARDING_CHUNK_INVALID' });
    assert.equal(cancelled, 1);
    // Slow producer and consumer: no read before demand, one read in flight,
    // and consume the retained chunk fully before pulling the source again.
    let reads = 0, releaseChunk;
    const slow = boundedBody(new ReadableStream({
      async pull(controller) { reads++; await new Promise(resolve => { releaseChunk = resolve; }); controller.enqueue(new Uint8Array(65536)); },
      cancel() { cancelled++; }
    }, {highWaterMark:0}), 131072);
    const reader = slow.stream.getReader();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(reads,0);
    const pending = reader.read();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(reads,1);
    releaseChunk(); assert.equal((await pending).value.length,16384);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(reads,1);
    for(let i=0;i<3;i++) assert.equal((await reader.read()).value.length,16384);
    assert.equal(reads,1); await reader.cancel(); assert.equal(cancelled,2);
    let lateCancelled = 0;
    const abort = new AbortController(), returned = deferred();
    const owner = createIncomingBody(new Request('http://localhost',{method:'POST',body:'x'}), {
      bodyForwarding:{maxBytes:1024},maxDurationMs:1000,
      fetchImplementation:()=>returned.promise
    });
    owner.claim(owner.marker(),{method:'POST',headers:[]});
    const lateFetch = owner.forward('http://localhost',{headers:[]},{signal:abort.signal});
    abort.abort(new Error('fixture deadline'));
    returned.resolve(new Response(new ReadableStream({cancel(){lateCancelled++;}})));
    await assert.rejects(lateFetch,/fixture deadline/);await owner.close();
    assert.equal(lateCancelled,1,'a transport response after cancellation must be disposed');
    // EOF is not writer completion: retain the shorter operation deadline
    // while the downstream write callback is still pending.
    const writerOwner = createIncomingBody(new Request('http://localhost',{method:'POST',body:'x'}), {
      bodyForwarding:{maxBytes:1024},maxDurationMs:1000,responseWriterOwnsCompletion:true,
      fetchImplementation:async()=>new Response('complete source')
    });
    writerOwner.claim(writerOwner.marker(),{method:'POST',headers:[],timeoutMs:50});
    const writerResponse = await writerOwner.forward('http://localhost',{headers:[]},{});
    const sink = new (require('node:stream').Writable)({write(_chunk,_encoding,_callback) { /* held until deadline */ }});
    sink.setHeader = () => {};
    try {
      await assert.rejects(writeWebResponseToNode(writerResponse,sink,{signal:writerOwner.responseSignal}),{code:'PULSE_FETCH_TIMEOUT'});
    } finally { await writerOwner.close(); }
    console.log(JSON.stringify({ status: 'passed', sizes, firstByteBeforeEof: true, noDispatchDenials: 5, noReadDenial: true, earlyResponse: true, redirectNotReplayed: true, emptyBody: true, oversizedHostChunkRejected: true, slowDemand: true, lateResponseCancelled: true, postHeaderFailure: true, measuredAndDeclaredLimits: true, deadline: true, disconnectRecovery: true }));
  } finally { await close(server); await close(origin); }
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
