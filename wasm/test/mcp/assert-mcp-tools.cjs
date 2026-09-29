#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createMcpHttpHandler, PROTOCOL_VERSION } = require('../../../packages/mcp/src/index.js');
const { projectCatalog } = require('../../../packages/mcp/src/catalog.js');
const field = (name, kind, required = true) => ({ name, required, value: typeof kind === 'string' ? { kind } : kind });
const root = { kind: 'object', fields: [field('message', 'string'), field('count', 'i32', false),
  field('nested', { kind: 'array', element: { kind: 'nullable', value: { kind: 'string-enum', values: ['a', 'b'] } } }, false),
  field('data', 'json-value', false), field('record', 'json-object', false)] };
const schemas = { version: 'pulse.canonical-schema-registry.v4', registryIrVersion: 'pulse.schema-registry-ir.v5',
  registryHash: 'a'.repeat(64), schemas: [{ id: 'test.Value', root }] };
const entity = (name, inputSchema = 'test.Value', outputSchema = 'test.Value') => ({ name, inputSchema, outputSchema,
  eligibility: { 'node-javascript': true }, metadata: { title: name, description: 'test tool',
    secret: 'must-not-be-listed', mcp: { readOnlyHint: true, secret: 'must-not-be-listed' } } });
const catalog = { version: 'pulse.entities-catalog.v1', contractId: 'pulse.entities', catalogHash: 'b'.repeat(64),
  routers: [{ id: 'rpc', adapter: 'json-rpc', binding: 'request', entities: [entity('echo'), entity('status', null, null)] }] };
const limits = { maxRequestBytes: 65536, maxResponseBytes: 1048576, maxDepth: 32, deadlineMs: 10000 };
const clone = value => JSON.parse(JSON.stringify(value));
let invocations = [], mode = 'ok', disconnected = 0;
const backend = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const message = JSON.parse(Buffer.concat(chunks));
  invocations.push({ message, headers: req.headers });
  res.on('close', () => { if (!res.writableEnded) disconnected++; });
  if (mode === 'stall') return;
  if (mode === 'redirect') { res.writeHead(307, { location: '/second' }).end(); return; }
  res.writeHead(mode === 'http' ? 503 : 200, { 'content-type': mode === 'media' ? 'text/plain' : 'application/json' });
  if (mode === 'oversize') { res.end('x'.repeat(1048577)); return; }
  if (mode === 'malformed') { res.end('{'); return; }
  const reply = { jsonrpc: '2.0', id: mode === 'id' ? 'wrong' : message.id };
  if (['input', 'execution', 'unknown'].includes(mode)) reply.error = {
    code: mode === 'input' ? -32602 : mode === 'execution' ? -32603 : -32601, message: 'secret-token', data: { secret: true } };
  else reply.result = mode === 'output' ? { message: false } : message.method === 'status' ? null : message.params;
  res.end(JSON.stringify(reply));
});
const prefix = 'io.modelcontextprotocol/';
function request(method, params = {}, id = 7, signal) {
  return new Request('http://localhost/mcp', { method: 'POST', signal,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION, 'mcp-method': method,
      ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}), authorization: 'Bearer secret-client', cookie: 'secret-client' },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method,
      params: { ...params, _meta: { [prefix + 'protocolVersion']: PROTOCOL_VERSION, [prefix + 'clientCapabilities']: {} } } }) });
}
async function main() {
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const options = { catalog: clone(catalog), schemas: clone(schemas), routerId: 'rpc', target: 'node-javascript',
    endpoint: `http://127.0.0.1:${backend.address().port}/rpc` };
  const handler = createMcpHttpHandler({ tools: options });
  const exchange = async (method, params, target = handler) => {
    const response = await target.fetch(request(method, params));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json(); assert.equal(body.id, 7);
    assert.ok(!JSON.stringify(body).includes('secret-'));
    return { status: response.status, ...body };
  };
  assert.deepEqual((await exchange('server/discover')).result.capabilities, { tools: { listChanged: false } });
  const list = (await exchange('tools/list')).result;
  assert.deepEqual(list.tools.map(tool => tool.name), ['echo', 'status']);
  assert.equal(list.ttlMs, 0); assert.equal(list.cacheScope, 'private');
  assert.equal(list.nextCursor, undefined);
  assert.deepEqual(list.tools[0].annotations, { readOnlyHint: true });
  assert.equal(JSON.stringify(list).includes('must-not-be-listed'), false);
  assert.equal(list.tools[0].inputSchema.additionalProperties, true);
  assert.equal(list.tools[0].outputSchema.additionalProperties, false);
  assert.deepEqual(list.tools[0].inputSchema.properties.nested.items.anyOf[0].enum, ['a', 'b']);
  for (const params of [{ cursor: '' }, { cursor: 'next' }, { task: {} }]) assert.equal((await exchange('tools/list', params)).error.code, -32602);
  assert.equal(invocations.length, 0);
  // Both artifacts and metadata are construction snapshots; new instances see revisions.
  options.catalog.routers[0].entities[0].metadata.title = 'updated';
  options.schemas.schemas[0].root.fields[0].value.kind = 'boolean';
  assert.deepEqual((await exchange('tools/list')).result, list);
  const revised = createMcpHttpHandler({ tools: options });
  const updated = (await exchange('tools/list', {}, revised)).result;
  assert.equal(updated.tools[0].title, 'updated');
  assert.equal(updated.tools[0].inputSchema.properties.message.type, 'boolean');
  const valid = { message: 'hello', count: 3, nested: ['a', null], data: { list: [1, true, null] }, record: { extra: 1 } };
  const result = await exchange('tools/call', { name: 'echo', arguments: valid });
  assert.deepEqual(result.result.structuredContent, valid);
  assert.equal(result.result.content[0].text, JSON.stringify(valid));
  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations[0].message.params, valid);
  assert.equal(invocations[0].headers.authorization, undefined); assert.equal(invocations[0].headers.cookie, undefined);
  assert.equal((await exchange('tools/call', { name: 'status' })).result.content[0].text, 'null');
  assert.equal(Object.hasOwn(invocations[1].message, 'params'), false);
  for (const name of ['missing', '__proto__', 'constructor']) assert.equal((await exchange('tools/call', { name })).error.code, -32602);
  for (const args of [[], null, 2]) assert.equal((await exchange('tools/call', { name: 'echo', arguments: args })).error.code, -32602);
  assert.equal((await exchange('tools/call', { name: 'echo', task: {} })).error.code, -32602);
  for (const args of [{}, { message: 1 }, { message: 'a', count: 2147483648 }, { message: 'a', nested: ['c'] }]) {
    const rejected = await exchange('tools/call', { name: 'echo', arguments: args });
    assert.equal(rejected.result.isError, true); assert.match(rejected.result.content[0].text, /input validation/);
  }
  assert.equal((await exchange('tools/call', { name: 'status', arguments: { extra: true } })).result.isError, true);
  const notification = request('tools/call', { name: 'echo' });
  const envelope = await notification.json(); delete envelope.id;
  const accepted = await handler.fetch(new Request(notification.url, { method: 'POST', headers: notification.headers, body: JSON.stringify(envelope) }));
  assert.equal(accepted.status, 202); assert.equal(invocations.length, 2);
  for (const failure of ['input', 'execution', 'output']) {
    mode = failure;
    const failed = await exchange('tools/call', { name: 'echo', arguments: { message: 'ok' } });
    assert.equal(failed.status, 200); assert.equal(failed.result.isError, true);
  }
  for (const failure of ['redirect', 'http', 'media', 'malformed', 'id', 'oversize', 'unknown']) {
    mode = failure; const before = invocations.length;
    const failed = await exchange('tools/call', { name: 'echo', arguments: { message: 'ok' } });
    assert.equal(failed.status, 502); assert.equal(failed.error.code, -32603);
    assert.equal(invocations.length, before + 1, 'never follow redirects or retry');
  }
  mode = 'stall';
  const timed = createMcpHttpHandler({ tools: { ...options, catalog, schemas }, limits: { deadlineMs: 50 } });
  const interrupted = await exchange('tools/call', { name: 'status' }, timed);
  assert.equal(interrupted.status, 408); assert.equal(interrupted.error.code, -32603);
  const cancel = new AbortController();
  const pending = handler.fetch(request('tools/call', { name: 'status' }, 7, cancel.signal));
  setTimeout(() => cancel.abort(), 20);
  assert.equal((await pending).status, 408);
  mode = 'ok';
  await Promise.all(Array.from({ length: 12 }, (_, index) => exchange('tools/call', { name: 'echo', arguments: { message: String(index) } })
    .then(reply => assert.equal(reply.result.structuredContent.message, String(index)))));
  assert.ok(disconnected >= 1, 'cancelled backend connection closes');
  const invalid = mutate => { const config = { ...options, catalog: clone(catalog), schemas: clone(schemas) }; mutate(config); assert.throws(() => createMcpHttpHandler({ tools: config })); };
  invalid(config => config.catalog.routers[0].entities.push(entity('echo')));
  invalid(config => config.catalog.routers[0].entities[0].name = 'bad name');
  invalid(config => config.catalog.routers[0].entities[0].inputSchema = 'unknown');
  invalid(config => config.catalog.routers[0].entities[0].eligibility['node-javascript'] = false);
  invalid(config => config.catalog.routers[0].entities = Array.from({ length: 129 }, (_, i) => entity('tool' + i)));
  invalid(config => config.schemas.schemas[0].root.fields[0].value.kind = 'scalar-record');
  invalid(config => config.schemas.schemas.push(clone(config.schemas.schemas[0])));
  invalid(config => config.routerId = 'missing');
  invalid(config => config.target = 'unknown');
  invalid(config => config.catalog.version = 'future');
  invalid(config => config.schemas.version = 'future');
  invalid(config => config.endpoint = 'http://remote.example/rpc');
  invalid(config => config.endpoint = 'https://user:secret@example.test/rpc');
  invalid(config => config.invoke = () => {});
  assert.throws(() => projectCatalog({ ...options, catalog, schemas }, { ...limits, maxResponseBytes: 66048 }));
  // No application/Entities/runtime/compiler imports or executable schema loading.
  for (const file of ['index.js', 'tools.js', 'catalog.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../../../packages/mcp/src', file), 'utf8');
    assert.doesNotMatch(source, /require\(['"](?:@pulse-compute|.*entities|.*schema-json-codecs)/);
  }
  console.log('ok - MCP-03 projection, errors, one selected HTTP call, isolation, deadlines and cancellation');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve));
});
