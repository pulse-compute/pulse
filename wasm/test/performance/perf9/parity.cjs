'use strict';
const assert = require('node:assert/strict');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const { binary, hash } = require('../../support/fastly-forwarding-qualification.cjs');
const contract = require('./contract.json');

// Compare observable behavior, not language-specific handles, pointers, runtime
// counters, or hostcall counts. ABI qualification separately checks ownership,
// scratch reuse, sink demand, faults and cooperative deadlines for each guest.
function observe(wasm, scenario) {
  const r = execute({ wasm }, {
    request: { method: 'POST', path: '/', ...scenario.request },
    fixtures: { [contract.url]: { echoBody: true, ...scenario.origin } },
    allowAbortedResponse: true, ...scenario.options
  });
  const body = bytes => ({ bytes: bytes.length, sha256: hash(bytes) });
  return {
    response: { status: r.response.status, headers: r.response.headers,
      ...body(r.response.bodyBytes), aborted: r.response.aborted, streaming: r.response.streaming },
    outbound: r.outboundRequests.map(x => ({ method: x.method, url: x.url, backend: x.backend,
      headers: x.headers, ...body(x.bodyBytes), aborted: x.aborted })),
    downstreamCommits: r.trace.filter(x => x.name === 'send_downstream').length,
    resources: { ...r.transportResources, ...r.forwardingResources }
  };
}
function scenarios(c) {
  const sizes = [...new Set([0, 1, ...c.payloadSweep, Math.min(c.requestMaxBytes, c.responseMaxBytes)].filter(n => n <= Math.min(c.requestMaxBytes, c.responseMaxBytes)))];
  return [
    ...sizes.flatMap(n => [false, true].map(declared => ({ name: `binary-${n}-${declared ? 'declared' : 'unknown'}`,
      request: { body: binary(n), headers: declared ? { 'content-length': String(n) } : {} }, options: { bodyWriteChunkBytes: 997 } }))),
    { name: 'request-declared-overflow', request: { body: binary(1), headers: { 'content-length': String(c.requestMaxBytes + 1) } } },
    { name: 'request-actual-overflow', request: { body: binary(c.requestMaxBytes + 1) } },
    { name: 'request-length-mismatch', request: { body: binary(3), headers: { 'content-length': '2' } } },
    { name: 'request-invalid-length', request: { headers: { 'content-length': '-1' } } },
    { name: 'response-declared-overflow', origin: { headers: { 'content-length': String(c.responseMaxBytes + 1) } } },
    { name: 'response-actual-overflow', origin: { echoBody: false, body: binary(c.responseMaxBytes + 1) } },
    { name: 'response-length-mismatch', origin: { echoBody: false, body: binary(3), headers: { 'content-length': '2' } } },
    { name: 'early-rejection', request: { body: binary(7), readyDelayMs: 4000 }, origin: { earlyResponse: true, status: 413, echoBody: false, body: 'denied' } },
    { name: 'upload-backpressure', request: { body: binary(7), chunkBytes: 2, chunkDelayMs: 1 }, options: { bodyWriteChunkBytes: 1, uploadWriteDelayMs: 1 } },
    { name: 'response-backpressure', request: { body: binary(7) }, options: { bodyWriteChunkBytes: 1, downstreamWriteDelayMs: 1 } },
    { name: 'upload-deadline', request: { body: binary(7), readyDelayMs: 4000 } },
    { name: 'header-deadline', origin: { neverHeaders: true } },
    { name: 'response-deadline', origin: { echoBody: false, body: binary(7), bodyDelayMs: 4000 } },
    { name: 'origin-error', origin: { transportStatus: 1 } },
    { name: 'upload-write-error', request: { body: binary(7) }, options: { outboundBodyWriteStatus: 1 } },
    { name: 'response-write-error', request: { body: binary(7) }, options: { downstreamBodyWriteStatus: 1 } },
    { name: 'request-header-privacy', request: { headers: { authorization: 'secret', cookie: 'private', host: 'private' } } },
    { name: 'response-raw-headers', origin: { echoBody: false, body: binary(7), headers: [
      ['connection', 'x-private'], ['x-private', 'hidden'], ['content-length', '7'], ['content-encoding', 'gzip'], ['set-cookie', 'a=1'], ['set-cookie', 'b=2'] ] } },
    ...[204, 205, 304, 302, 409, 503].map(status => ({ name: `origin-status-${status}`, origin: { status, echoBody: false, body: Buffer.alloc(0) } }))
  ];
}
function qualifyPair(pulse, rust, c = contract) {
  return scenarios(c).map(scenario => {
    const a = observe(pulse, scenario), b = observe(rust, scenario);
    assert.deepEqual(b, a, scenario.name + ': Rust/Pulse observable mismatch');
    assert.equal(a.downstreamCommits, 1, scenario.name);
    for (const outbound of a.outbound) {
      assert.equal(outbound.url, c.url); assert.equal(outbound.backend, c.backend);
      assert.equal(outbound.method, c.method); assert.deepEqual(outbound.headers, Object.entries(c.headers));
    }
    return { name: scenario.name, status: 'passed', pulse: a, rust: b };
  });
}
module.exports = { observe, scenarios, qualifyPair };
