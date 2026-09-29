#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const { createMcpHttpHandler, PROTOCOL_VERSION, DEFAULT_LIMITS } = require('../../../packages/mcp/src/index.js');
const { createMcpNodeHandler } = require('../../../packages/mcp/src/node.js');
const prefix = 'io.modelcontextprotocol/';
const meta = () => ({ [prefix + 'protocolVersion']: PROTOCOL_VERSION, [prefix + 'clientCapabilities']: {} });
const rpc = (method = 'server/discover', id = 1) => ({ jsonrpc: '2.0', id, method, params: { _meta: meta() } });
const headers = (method = 'server/discover') => ({ 'content-type': 'application/json', accept: 'application/json, text/event-stream',
  'mcp-protocol-version': PROTOCOL_VERSION, 'mcp-method': method });
const handler = createMcpHttpHandler();
let cases = 0;
async function exchange(message = rpc(), changes = {}, target = handler) {
  const response = await target.fetch(new Request('http://localhost/mcp', {
    method: 'POST', headers: { ...headers(message?.method), ...changes }, body: JSON.stringify(message)
  }));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.has('mcp-session-id'), false);
  const text = await response.text();
  cases++;
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}
async function failure(message, status, code, changes = {}) {
  const result = await exchange(message, changes);
  assert.equal(result.status, status);
  assert.equal(result.body.error.code, code);
  assert.equal(Object.hasOwn(result.body, 'result'), false);
  if (typeof message?.id === 'string' || Number.isSafeInteger(message?.id)) assert.equal(result.body.id, message.id);
  else assert.equal(Object.hasOwn(result.body, 'id'), false);
  return result;
}
async function streamed(stream, options = {}, signal) {
  return createMcpHttpHandler(options).fetch(new Request('http://localhost/mcp', {
    method: 'POST', headers: headers(), body: stream, duplex: 'half', signal
  }));
}

async function main() {
  const discovery = await exchange(rpc('server/discover', 'discover'));
  assert.deepEqual(discovery.body.result, { resultType: 'complete', _meta: { [prefix + 'serverInfo']: { name: 'pulse-mcp', version: '0.0.0' } },
    supportedVersions: [PROTOCOL_VERSION], capabilities: {}, ttlMs: 0, cacheScope: 'private' });
  // No discovery dependency and no connection/session state.
  for (const id of [0, -1, '', '雪', Number.MAX_SAFE_INTEGER]) {
    const result = await exchange(rpc('server/discover', id), { 'Mcp-Session-Id': 'ignored-secret', 'Last-Event-ID': 'ignored' });
    assert.equal(result.status, 200); assert.equal(result.body.id, id);
    assert.equal(result.body.result.resultType, 'complete');
    assert.ok(!JSON.stringify(result.body).includes('ignored-secret'));
  }
  for (const id of [null, 1.5, true, {}, [], Number.MAX_SAFE_INTEGER + 1]) await failure(rpc('server/discover', id), 400, -32600);
  for (const message of [[], [rpc()], null, 1, 'body', { ...rpc(), jsonrpc: '1.0' }, { ...rpc(), method: 3 },
    { ...rpc(), result: {} }, { ...rpc(), error: {} }, { ...rpc(), params: [] }]) await failure(message, 400, -32600);
  for (const params of [undefined, {}, { _meta: {} }, { _meta: { [prefix + 'protocolVersion']: PROTOCOL_VERSION } },
    { _meta: { ...meta(), [prefix + 'clientCapabilities']: [] } },
    { _meta: { ...meta(), [prefix + 'clientInfo']: { name: 'missing-version' } } }]) await failure({ ...rpc(), params }, 400, -32602);
  for (const changes of [{ 'mcp-method': '' }, { 'mcp-method': 'Ping' }, { 'mcp-protocol-version': '' },
    { 'mcp-protocol-version': '2025-11-25' }]) await failure(rpc(), 400, -32020, changes);
  const unsupported = rpc(); unsupported.params._meta[prefix + 'protocolVersion'] = '2025-11-25';
  assert.deepEqual((await failure(unsupported, 400, -32022, { 'mcp-protocol-version': '2025-11-25' })).body.error.data,
    { supported: [PROTOCOL_VERSION], requested: '2025-11-25' });
  await failure(rpc('initialize'), 404, -32601);
  await failure({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-11-25' } },
    400, -32020, { 'mcp-method': '', 'mcp-protocol-version': '' });
  for (const method of ['ping', 'tools/list', 'resources/list', 'prompts/list', 'subscriptions/listen', 'tasks/get',
    'sampling/createMessage', 'elicitation/create', 'logging/setLevel', 'notifications/cancelled', '__proto__', 'constructor', 'toString']) await failure(rpc(method), 404, -32601);
  for (const method of ['server/discover']) await failure({ ...rpc(method), params: { _meta: meta(), inputResponses: [] } }, 400, -32602);
  for (const method of ['tools/call', 'resources/read', 'prompts/get']) {
    const field = method === 'resources/read' ? 'uri' : 'name';
    const message = rpc(method); message.params[field] = 'status';
    await failure(message, 400, -32020);
    await failure(message, 400, -32020, { 'mcp-name': 'other-secret' });
    await failure(message, 404, -32601, { 'mcp-name': 'status' });
  }
  for (const name of ['雪', ' padded ', 'line\nbreak', '=?base64?literal?=']) {
    const message = rpc('tools/call'); message.params.name = name;
    await failure(message, 404, -32601, { 'mcp-name': '=?base64?' + Buffer.from(name).toString('base64') + '?=' });
  }
  const named = rpc('tools/call'); named.params.name = 'f';
  for (const value of ['=?base64?Zh==?=', '=?base64?_w==?=', '=?base64?/w==?=', '=?base64?!!!?=', '=?BASE64?Zg==?=']) await failure(named, 400, -32020, { 'mcp-name': value });
  // Notifications require no revision headers in this HTTP revision. All valid
  // envelopes are discarded, including requests accidentally sent without IDs.
  for (const method of ['anything', 'tools/call', 'notifications/cancelled', 'notifications/initialized']) {
    const result = await exchange({ jsonrpc: '2.0', method }, { 'mcp-method': '', 'mcp-protocol-version': '' });
    assert.equal(result.status, 202); assert.equal(result.body, null); assert.equal(result.headers.has('content-type'), false);
  }
  await failure({ jsonrpc: '2.0', method: 'notice', params: [] }, 400, -32600);
  for (const changes of [{ accept: 'application/json' }, { accept: '*/*' }, { accept: 'application/json;q=0,text/event-stream' },
    { accept: 'application/json,text/event-stream;q=0' }]) assert.equal((await exchange(rpc(), changes)).status, 406);
  for (const changes of [{ 'content-type': '' }, { 'content-type': 'text/plain' }, { 'content-type': 'application/json;charset=latin1' },
    { 'content-encoding': 'gzip' }]) assert.equal((await exchange(rpc(), changes)).status, 415);
  assert.equal((await exchange(rpc(), { 'content-type': 'Application/JSON; charset="UTF-8"', accept: 'APPLICATION/JSON;q=1, text/event-stream;q=0.5' })).status, 200);
  assert.equal((await exchange(rpc(), { origin: 'https://untrusted.example' })).status, 403);
  const origins = ['https://trusted.example'];
  const allowed = createMcpHttpHandler({ allowedOrigins: origins }); origins.push('https://untrusted.example');
  assert.equal((await exchange(rpc(), { origin: 'https://trusted.example' }, allowed)).status, 200);
  assert.equal((await exchange(rpc(), { origin: 'https://untrusted.example' }, allowed)).status, 403);
  for (const method of ['GET', 'HEAD', 'DELETE', 'OPTIONS', 'PUT']) {
    const result = await handler.fetch(new Request('http://localhost/mcp', { method }));
    assert.equal(result.status, 405); assert.equal(result.headers.get('allow'), 'POST'); cases++;
  }
  assert.equal((await handler.fetch(new Request('http://localhost/other'))).status, 404);
  for (const raw of ['{broken', '', '{"jsonrpc":"2.0","id":1,', Buffer.from([0xff])]) {
    const result = await handler.fetch(new Request('http://localhost/mcp', { method: 'POST', headers: headers(), body: raw }));
    assert.equal(result.status, 400); assert.equal((await result.json()).error.code, -32700); cases++;
  }
  assert.equal((await exchange(rpc(), { 'content-length': '999999' })).status, 413);
  assert.equal((await exchange(rpc(), { 'content-length': 'wrong' })).status, 400);
  const deep = rpc(); deep.params.extra = JSON.parse('['.repeat(40) + '0' + ']'.repeat(40));
  const depthError = await exchange(deep);
  assert.equal(depthError.status, 400); assert.equal(depthError.body.error.code, -32600);
  assert.equal(Object.hasOwn(depthError.body, 'id'), false); // ID unavailable before bounded parsing.
}

async function boundsAndHttp() {
  let canceled = 0;
  const oversized = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024)); }, cancel() { canceled++; } });
  assert.equal((await streamed(oversized, { limits: { maxRequestBytes: 512 } })).status, 413);
  assert.equal(canceled, 1);
  const stalled = new ReadableStream({ pull() {}, cancel() { canceled++; return new Promise(() => {}); } });
  assert.equal((await streamed(stalled, { limits: { deadlineMs: 15 } })).status, 408);
  assert.equal(canceled, 2);
  const controller = new AbortController();
  const aborted = streamed(new ReadableStream({ cancel() { canceled++; } }), {}, controller.signal);
  controller.abort(); assert.equal((await aborted).status, 408); assert.equal(canceled, 3);
  const preAborted = new AbortController(); preAborted.abort();
  assert.equal((await streamed(new ReadableStream({ cancel() { canceled++; } }), {}, preAborted.signal)).status, 408);
  assert.equal(canceled, 4);
  let pulled = 0;
  const rejectedBody = new ReadableStream({ pull() { pulled++; }, cancel() { canceled++; } }, { highWaterMark: 0 });
  const rejected = await handler.fetch(new Request('http://localhost/mcp', { method: 'POST',
    headers: { ...headers(), origin: 'https://denied.example' }, body: rejectedBody, duplex: 'half' }));
  assert.equal(rejected.status, 403); assert.equal(pulled, 0); assert.equal(canceled, 5);
  for (const limits of [{ maxRequestBytes: 0 }, { maxDepth: 100 }, { deadlineMs: Infinity }, { maxResponseBytes: 500 }, { maxRequestBytes: 65537 }]) assert.throws(() => createMcpHttpHandler({ limits }));
  assert.throws(() => createMcpHttpHandler({ allowedOrigins: ['*'] }));
  assert.throws(() => createMcpHttpHandler({ path: '/mcp?query' }));
  const restricted = createMcpHttpHandler({ limits: { maxRequestBytes: 256, maxResponseBytes: 768 },
    serverInfo: { name: '\u0001'.repeat(128), version: '\u0001'.repeat(128) } });
  const tooLarge = await exchange(rpc(), {}, restricted);
  assert.equal(tooLarge.status, 500); assert.equal(tooLarge.body.error.code, -32603);
  assert.equal(tooLarge.body.id, 1); assert.ok(JSON.stringify(tooLarge.body).length < 768);
  const snapshot = { name: 'original', version: '1' }; const isolated = createMcpHttpHandler({ serverInfo: snapshot }); snapshot.name = 'mutated';
  assert.equal((await exchange(rpc(), {}, isolated)).body.result._meta[prefix + 'serverInfo'].name, 'original');
  const parallel = await Promise.all(Array.from({ length: 16 }, (_, id) => exchange(rpc('server/discover', id))));
  assert.deepEqual(parallel.map(result => result.body.id), Array.from({ length: 16 }, (_, id) => id));
  const server = http.createServer(createMcpNodeHandler({ limits: { deadlineMs: 100, maxRequestBytes: 512 } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  try {
    const response = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(rpc()), signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200); assert.equal((await response.json()).result.resultType, 'complete');
    // Real chunked upload overflow and a slow unfinished upload must produce an
    // HTTP response, not a socket reset or a read that waits forever.
    async function upload(bytes) {
      return new Promise((resolve, reject) => {
        const request = http.request(url, { method: 'POST', headers: headers(), timeout: 2000 }, response => {
          response.resume(); response.once('end', () => { request.destroy(); resolve(response.statusCode); });
        });
        request.once('error', reject); request.once('timeout', () => request.destroy(new Error('upload test timeout')));
        request.write(bytes);
      });
    }
    assert.equal(await upload('x'.repeat(513)), 413);
    assert.equal(await upload('{'), 408);
    assert.equal(await new Promise((resolve, reject) => {
      const request = http.request(url, { method: 'TRACE' }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
      request.once('error', reject); request.end();
    }), 405);
    for (let index = 0; index < 3; index++) {
      await new Promise(resolve => {
        const request = http.request(url, { method: 'POST', headers: headers() });
        // Wait until the server is reading this body, not merely connected.
        server.once('request', incoming => incoming.once('data', () => { request.destroy(); resolve(); }));
        request.on('error', () => {}); request.write('{');
      });
    }
    assert.equal((await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(rpc()), signal: AbortSignal.timeout(2000) })).status, 200);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  // This component has no dependency on Entities, application handlers, SDKs,
  // compiler internals or a dynamic method registry.
  const manifest = require('../../../packages/mcp/package.json');
  assert.equal(manifest.private, true); assert.equal(manifest.dependencies, undefined);
  for (const file of ['index.js', 'node.js']) assert.doesNotMatch(fs.readFileSync(require.resolve('../../../packages/mcp/src/' + file), 'utf8'), /@pulse-compute\/entities|@modelcontextprotocol|registerTool|import\(/);
  console.log(`ok - MCP-02 ${cases} protocol exchanges plus bounded streams, deadlines, disconnects and real Node HTTP`);
}
main().then(boundsAndHttp).catch(error => { console.error(error); process.exitCode = 1; });
