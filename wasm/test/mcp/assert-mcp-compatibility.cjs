#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createMcpHttpHandler, PROTOCOL_VERSION } = require('../../../packages/mcp/src/index.js');
const { fixture } = require('./authorization-fixture.cjs');
const version = '2025-06-18';
const initialize = { protocolVersion: version, capabilities: {}, clientInfo: { name: 'legacy-proof', version: '1' } };
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
function request(method, params, extra = {}, id = 1) {
  return new Request('http://127.0.0.1/mcp', { method: 'POST', headers: { ...headers,
    ...(method === 'initialize' ? {} : { 'mcp-protocol-version': version }), ...extra },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method,
      ...(params === undefined ? {} : { params }) }) });
}
async function exchange(handler, method, params, extra, id) {
  const response = await handler.fetch(request(method, params, extra, id));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.has('mcp-session-id'), false);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function main() {
  assert.throws(() => createMcpHttpHandler({ legacyProtocol: true }), /Invalid MCP legacy protocol/);
  assert.throws(() => createMcpHttpHandler({ legacyProtocol: '2025-11-25' }), /Invalid MCP legacy protocol/);
  const strict = createMcpHttpHandler();
  assert.equal((await exchange(strict, 'initialize', initialize)).status, 400, 'default stays modern-only');
  const legacy = createMcpHttpHandler({ legacyProtocol: version, serverInfo: { name: 'host', version: '1' } });
  const initialized = await exchange(legacy, 'initialize', initialize, {}, 'exact-id');
  assert.deepEqual(initialized, { status: 200, body: { jsonrpc: '2.0', id: 'exact-id', result: {
    protocolVersion: version, capabilities: {}, serverInfo: { name: 'host', version: '1' } } } });
  assert.deepEqual((await exchange(legacy, 'ping')).body.result, {});
  assert.equal((await exchange(legacy, 'ping', { unexpected: true })).status, 400);
  for (const params of [{}, { ...initialize, capabilities: [] }, { ...initialize, clientInfo: { name: '', version: '1' } },
    { ...initialize, clientInfo: { name: 'x'.repeat(129), version: '1' } }, { ...initialize, extra: true },
    { ...initialize, _meta: [] }]) assert.equal((await exchange(legacy, 'initialize', params)).body.error.code, -32602);
  assert.equal((await exchange(legacy, 'initialize', { ...initialize, protocolVersion: '2025-11-25' })).body.error.code, -32022);
  assert.equal((await exchange(legacy, 'initialize', initialize, { 'mcp-protocol-version': PROTOCOL_VERSION })).status, 400);
  assert.equal((await exchange(legacy, 'initialize', initialize, { 'mcp-method': 'initialize' })).status, 400);
  assert.equal((await exchange(legacy, 'initialize', { ...initialize, _meta: { 'io.modelcontextprotocol/protocolVersion': version } })).status, 400);
  for (const method of ['server/discover', 'tools/list', 'resources/list', 'prompts/list', 'logging/setLevel', 'notifications/initialized']) {
    assert.equal((await exchange(legacy, method)).body.error.code, -32601);
  }
  const notification = request('tools/call', { name: 'status' });
  const envelope = await notification.json(); delete envelope.id;
  assert.equal((await legacy.fetch(new Request(notification.url, { method: 'POST', headers: notification.headers,
    body: JSON.stringify(envelope) }))).status, 202);
  assert.equal((await legacy.fetch(new Request('http://127.0.0.1/mcp'))).status, 405);
  const discovery = await exchange(legacy, 'server/discover', { _meta: {
    'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } },
    { 'mcp-protocol-version': PROTOCOL_VERSION, 'mcp-method': 'server/discover' });
  assert.equal(discovery.status, 200); assert.deepEqual(discovery.body.result.supportedVersions, [PROTOCOL_VERSION]);
  assert.equal(discovery.body.result.resultType, 'complete');
  const small = createMcpHttpHandler({ legacyProtocol: version, limits: { maxRequestBytes: 128, maxResponseBytes: 640 } });
  assert.equal((await exchange(small, 'initialize', { ...initialize, padding: 'x'.repeat(128) })).status, 413);
  const shallow = createMcpHttpHandler({ legacyProtocol: version, limits: { maxDepth: 2 } });
  assert.equal((await exchange(shallow, 'initialize', initialize)).status, 400);

  const f = await fixture();
  try {
    const authenticated = createMcpHttpHandler({ ...f.options, legacyProtocol: version });
    const reader = f.issue(), writer = f.issue({ scope: 'mcp:access status:write' });
    const readerHeader = { authorization: 'Bearer ' + reader };
    assert.equal((await exchange(authenticated, 'initialize', initialize)).status, 401);
    assert.equal((await exchange(authenticated, 'tools/list', {}, { authorization: 'Bearer invalid' })).status, 401);
    const admission = await exchange(authenticated, 'initialize', initialize, readerHeader);
    assert.equal(admission.status, 200); assert.deepEqual(admission.body.result.capabilities, { tools: { listChanged: false } });
    const listing = await exchange(authenticated, 'tools/list', undefined, readerHeader);
    assert.deepEqual(Object.keys(listing.body.result), ['tools']);
    assert.deepEqual(listing.body.result.tools.map(tool => tool.name), ['status']);
    assert.deepEqual((await exchange(authenticated, 'tools/list', {}, { authorization: 'Bearer ' + writer })).body.result.tools.map(tool => tool.name), ['write']);
    assert.equal((await exchange(authenticated, 'tools/list', { cursor: 'next' }, readerHeader)).status, 400);
    assert.equal((await exchange(authenticated, 'tools/call', {}, readerHeader)).status, 400);
    assert.equal((await exchange(authenticated, 'tools/call', { name: 'write' }, readerHeader)).status, 403);
    assert.equal((await exchange(authenticated, 'tools/call', { name: 'unmapped' }, readerHeader)).status, 403);
    assert.equal((await exchange(authenticated, 'tools/call', { name: 'status', arguments: [] }, readerHeader)).status, 400);
    assert.equal((await exchange(authenticated, 'tools/call', { name: 'status' }, { ...readerHeader, 'mcp-protocol-version': '' })).status, 400);
    assert.equal((await exchange(authenticated, 'tools/call', { name: 'status', _meta: { 'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION } }, readerHeader)).status, 400);
    assert.equal(f.counts.backendAttempts, 0, 'rejections must precede effects');
    const called = await exchange(authenticated, 'tools/call', { name: 'status', arguments: {} }, readerHeader);
    assert.deepEqual(called.body.result, { isError: false, content: [{ type: 'text', text: 'null' }] });
    assert.equal(f.counts.effects, 1);
    assert.deepEqual(f.observed.backendAuthorization, ['Bearer ' + f.options.tools.backendBearerToken]);
    assert.ok(!JSON.stringify(called).includes(reader));
    f.tokens.get(reader).active = false;
    assert.equal((await exchange(authenticated, 'tools/call', { name: 'status' }, readerHeader)).status, 401);
    assert.equal(f.counts.effects, 1, 'initialization grants no cached authority');
    f.backendMode('failure');
    assert.equal((await exchange(authenticated, 'tools/call', { name: 'status' }, { authorization: 'Bearer ' + f.issue() })).status, 502);
    f.backendMode('stall');
    const timed = createMcpHttpHandler({ ...f.options, legacyProtocol: version, limits: { deadlineMs: 40 } });
    assert.equal((await exchange(timed, 'tools/call', { name: 'status' }, { authorization: 'Bearer ' + f.issue() })).status, 408);
  } finally { await f.close(); }
  console.log('ok - opt-in legacy initialization/tools, modern isolation, bounded admission and per-request authorization');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
