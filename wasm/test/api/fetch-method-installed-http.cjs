'use strict';

// Copied into an isolated npm consumer by fetch-method-types.cjs. All Pulse
// modules loaded by this process must come from that consumer's packed runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { executeApplication } = require('@pulse-compute/runtime/host');

async function main() {
  const received = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(req.headers['x-body-kind'] === 'none' ? 204 : 200);
    res.end(req.headers['x-body-kind'] === 'none' ? undefined : 'accepted');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/object`;
  let dispatches = 0;
  const run = init => executeApplication(async ctx => ctx.text(await ctx.fetch(url, init).text()),
    new Request('https://app.test/'), { strict: false, capabilities: {
      fetch(input, options) { dispatches++; return fetch(input, options); },
    } });
  try {
    for (const method of ['DELETE', 'OPTIONS']) for (const kind of ['none', 'text', 'json']) {
      const value = kind === 'json' ? JSON.stringify({ label: 'payload é' }) : kind === 'text' ? 'payload é' : '';
      const init = { method, timeoutMs: 2000,
        headers: [['x-body-kind', kind], ['x-repeat', 'first'], ['X-Repeat', 'second']],
        ...(kind === 'text' ? { body: value } : kind === 'json' ? { json: { label: 'payload é' } } : {}) };
      const response = await run(init);
      assert.equal(await response.text(), kind === 'none' ? '' : 'accepted');
      const observed = received.at(-1);
      assert.equal(observed.method, method);
      assert.deepEqual(observed.body, Buffer.from(value));
      assert.equal(observed.headers['x-repeat'], 'first, second');
      if (kind !== 'none') assert.equal(Number(observed.headers['content-length']), Buffer.byteLength(value));
      if (kind === 'json') assert.match(observed.headers['content-type'], /application\/json/);
    }
    assert.equal(dispatches, 6);
    assert.equal(received.length, 6, 'one wire request per admitted operation');
    for (const init of [{ method: 'GET', body: 'denied' }, { method: 'TRACE' },
      { method: 'DELETE', headers: [['x', 'a\r\nb']] }]) {
      const response = await run(init);
      assert.equal(response.status, 500, 'unhandled admission failure becomes the managed error response');
      assert.equal(await response.text(), 'Internal Server Error');
      assert.equal(dispatches, 6, 'invalid input rejected before the transport capability');
    }
    const installed = fs.realpathSync(path.join(process.cwd(), 'node_modules/@pulse-compute/runtime')) + path.sep;
    const loaded = Object.keys(require.cache).filter(file => file.includes(`${path.sep}@pulse-compute${path.sep}`));
    assert(loaded.length > 0);
    assert(loaded.every(file => fs.realpathSync(file).startsWith(installed)), 'no workspace product modules');
    console.log(JSON.stringify({ status: 'passed', transport: 'real-local-http', cells: 6,
      deniedBeforeDispatch: 3, requests: received.length, loadedRuntimeModules: loaded.length }));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
