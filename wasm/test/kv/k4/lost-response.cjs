'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');

// Test-only proxy: allow Compute to finish and drop the downstream response.
// This is client transport uncertainty, distinct from a typed KV unknown result.
async function lostResponse(server, tools, invoke) {
  let requests = 0;
  let upstreamStatus;
  let upstreamError;
  const proxy = http.createServer(async (request, response) => {
    requests++;
    const chunks = [];
    try {
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await tools.requestFastlyCompute(server, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks) });
      upstreamStatus = upstream.status;
    } catch (error) { upstreamError = error; }
    finally { response.destroy(); }
  });
  try {
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
    await assert.rejects(tools.requestFastlyCompute({ host: '127.0.0.1', port: proxy.address().port }, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'create', key: 'k4-lost-response', value: { receipt: 'accepted-once' } }),
    }), (error) => error.code === 'ECONNRESET');
    assert.equal(upstreamError, undefined); assert.equal(requests, 1); assert.equal(upstreamStatus, 200);
    const read = await invoke({ operation: 'get', key: 'k4-lost-response' });
    assert.equal(read.status, 'found'); assert.deepEqual(read.value, { receipt: 'accepted-once' });
    assert.deepEqual(await invoke({ operation: 'create', key: 'k4-lost-response', value: { receipt: 'second' } }), { status: 'conflict' });
    return { status: 'passed', dispatchedRequests: requests, clientTransport: 'connection-reset', committedReceiptObserved: true, typedKvUnknown: false };
  } finally {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
}
module.exports = { lostResponse };
