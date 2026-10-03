'use strict';

// STR-01 characterizes existing host seams. This does not implement or certify
// incoming forwarding, Native streaming, or a portable queue bound.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { nodeRequestToWebRequest, writeWebResponseToNode } = require('../../../packages/provider-node/src/javascript/node-adapter.js');
const { normalizedInit } = require('../../../wasm/packages/host-runtime/src/runtime/canonical-api-runtime.js');
const { writeNodeHttpResponse } = require('../../../wasm/packages/cli/src/internal/node-http.js');

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function destination(write) {
  const output = new Writable({ highWaterMark: 1, write });
  output.setHeader = () => {};
  return output;
}

async function main() {
  const request = new PassThrough();
  Object.assign(request, { method: 'POST', url: '/', headers: { host: 'fixture.test' } });
  let adapted = false;
  const reading = nodeRequestToWebRequest(request).then(value => { adapted = true; return value; });
  request.write(Buffer.from([0, 255]));
  await turn();
  assert.equal(adapted, false, 'current Node HTTP adaptation waits for the complete request');
  request.end(Buffer.from([1, 2]));
  const input = await reading;
  assert.deepEqual(Buffer.from(await input.request.arrayBuffer()), Buffer.from([0, 255, 1, 2]));
  assert.equal(request.listenerCount('data'), 0);

  assert.throws(() => normalizedInit({ method: 'POST', body: { incoming: true } }),
    { code: 'PULSE_FETCH_BODY_INVALID' }, 'a handle is not an admitted canonical fetch body');

  // With a blocked destination, prefetch settles without draining the source.
  // The generous count is a fixture bound, not a public Node/Pulse guarantee.
  const started = deferred();
  const controller = new AbortController();
  let pulls = 0, cancellations = 0, written = 0;
  const stream = new ReadableStream({
    pull(owner) { pulls++; owner.enqueue(new Uint8Array(256 * 1024)); },
    cancel() { cancellations++; }
  }, { highWaterMark: 0 });
  const blocked = destination((_chunk, _encoding, _done) => { written++; started.resolve(); });
  const writing = writeWebResponseToNode(new Response(stream), blocked, { signal: controller.signal });
  const rejected = assert.rejects(writing, { name: 'AbortError' });
  await started.promise;
  await turn();
  const paused = pulls;
  await turn();
  assert.equal(pulls, paused, 'blocked writer must stop pulling after bounded prefetch');
  assert.ok(pulls > 0 && pulls <= 4, `unexpected fixture prefetch: ${pulls}`);
  assert.equal(written, 1, 'first write occurs while source is still open');
  controller.abort();
  await rejected;
  assert.equal(blocked.destroyed, true);
  assert.equal(cancellations, 1);

  // A failed source after the first write terminates that response. It cannot
  // become a second HTTP status or a successful, clean end of the same body.
  const firstWrite = deferred();
  let owner, finals = 0;
  const prefix = [];
  const failedSource = new ReadableStream({ start(value) { owner = value; } });
  const failedOutput = destination((chunk, _encoding, done) => {
    prefix.push(Buffer.from(chunk)); firstWrite.resolve(); done();
  });
  failedOutput._final = done => { finals++; done(); };
  const failedWriting = writeWebResponseToNode(new Response(failedSource, { status: 206 }), failedOutput);
  const sourceFailure = new Error('fixture source failed after headers');
  const failed = assert.rejects(failedWriting, error => error === sourceFailure);
  owner.enqueue(new Uint8Array([0, 255, 1]));
  await firstWrite.promise;
  owner.error(sourceFailure);
  await failed;
  assert.equal(failedOutput.statusCode, 206);
  assert.equal(failedOutput.destroyed, true);
  assert.equal(finals, 0);
  assert.deepEqual(Buffer.concat(prefix), Buffer.from([0, 255, 1]));

  // Existing Native CLI emission starts pipe() and returns a snapshot. A
  // synchronous handoff result is not evidence of transfer completion.
  const nativeSource = new PassThrough();
  const nativeOutput = destination((_chunk, _encoding, done) => done());
  const finished = once(nativeOutput, 'finish');
  const snapshot = { status: 200, kind: 'stream', bodyStream: nativeSource };
  assert.equal(writeNodeHttpResponse(nativeOutput, snapshot), snapshot);
  assert.equal(nativeOutput.writableFinished, false);
  nativeSource.end('complete');
  await finished;

  console.log(`ok - STR-01 host feasibility: buffered admission, body rejection, demand (${paused} fixture chunks), cancellation, post-header failure, Native handoff distinction`);
}

module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
