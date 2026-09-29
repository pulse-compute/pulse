// Test-only reference facade. This is NOT the production Pulse MCP adapter.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';

const [backend, catalogFile, evidenceFile] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(new URL('./profile.json', import.meta.url)));
const catalog = JSON.parse(fs.readFileSync(catalogFile));
const entity = catalog.routers.flatMap(router => router.entities).find(item => item.name === profile.proof.entity);
assert.ok(entity, 'proof entity must come from emitted catalog');
assert.equal(entity.inputSchema, null);
assert.equal(entity.outputSchema, null);
assert.equal(entity.eligibility[profile.proof.target], true);
assert.equal(new URL(backend).hostname, '127.0.0.1');
const wire = [], invocations = [];
const report = { status: 'running', protocolVersion: profile.protocolVersion,
  referencePackages: profile.referencePackages, catalogHash: catalog.catalogHash,
  wire, invocations, checks: [] };
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'pulse-mcp-reference-proof', version: '0.0.0' },
    { capabilities: profile.capabilities });
  server.registerTool(entity.name, { title: entity.metadata.title, description: entity.metadata.description }, async () => {
    const request = { jsonrpc: '2.0', id: 'mcp01-entity', method: entity.name };
    const response = await fetch(backend, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(profile.transport.requestDeadlineMs) });
    const body = await response.json();
    invocations.push({ request, status: response.status, response: body });
    assert.equal(response.status, 200);
    assert.deepEqual(body, { jsonrpc: '2.0', result: null, id: request.id });
    return { content: [{ type: 'text', text: JSON.stringify(body.result) }] };
  });
  return server;
}, { legacy: profile.transport.legacy, responseMode: profile.transport.responseMode,
  maxRequestBodySize: profile.transport.maxRequestBodyBytes });
const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: profile.transport.maxRequestBodyBytes });
const listener = http.createServer((req, res) => {
  // The proof is loopback-only and has no browser caller or bearer credentials.
  if (req.url !== profile.transport.path) { res.writeHead(404).end(); return; }
  if (req.headers.origin) { res.writeHead(403).end(); return; }
  nodeHandler(req, res);
});
const client = new Client({ name: 'pulse-mcp-01-reference-client', version: '0.0.0' }, {
  capabilities: {}, versionNegotiation: { mode: { pin: profile.protocolVersion } }
});
try {
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const url = new URL(`http://127.0.0.1:${listener.address().port}${profile.transport.path}`);
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = await request.clone().text();
      const response = await fetch(request, { signal: AbortSignal.any([
        request.signal, AbortSignal.timeout(profile.transport.requestDeadlineMs)
      ]) });
      wire.push({ method: request.method, path: new URL(request.url).pathname,
        requestHeaders: Object.fromEntries(request.headers), request: body ? JSON.parse(body) : null,
        status: response.status, responseHeaders: Object.fromEntries(response.headers),
        response: await response.clone().json() });
      return response;
    }
  });
  await client.connect(transport);
  assert.equal(client.getProtocolEra(), 'modern');
  // The pinned client's connect performs server/discover itself (no initialize).
  const discovered = wire[0].response.result;
  assert.deepEqual(discovered.supportedVersions, [profile.protocolVersion]);
  assert.deepEqual(discovered.capabilities, profile.capabilities);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name), [entity.name]);
  assert.equal(listed.tools[0].inputSchema.type, 'object');
  assert.equal(listed.tools[0].title, entity.metadata.title);
  const called = await client.callTool({ name: entity.name, arguments: {} });
  assert.notEqual(called.isError, true);
  assert.deepEqual(called.content, [{ type: 'text', text: 'null' }]);
  assert.equal(invocations.length, 1);
  assert.deepEqual(wire.map(exchange => exchange.request.method), ['server/discover', 'tools/list', 'tools/call']);
  for (const exchange of wire) {
    assert.equal(exchange.method, 'POST');
    assert.equal(exchange.path, profile.transport.path);
    assert.equal(exchange.status, 200);
    assert.equal(exchange.request.jsonrpc, '2.0');
    assert.equal(exchange.response.jsonrpc, '2.0');
    assert.equal(exchange.requestHeaders['content-type'], 'application/json');
    assert.match(exchange.requestHeaders.accept, /application\/json/);
    assert.match(exchange.requestHeaders.accept, /text\/event-stream/);
    assert.match(exchange.responseHeaders['content-type'], /^application\/json/);
    assert.equal(exchange.requestHeaders['mcp-protocol-version'], profile.protocolVersion);
    assert.equal(exchange.requestHeaders['mcp-method'], exchange.request.method);
    assert.equal(exchange.requestHeaders['mcp-session-id'], undefined);
    assert.equal(exchange.responseHeaders['mcp-session-id'], undefined);
    assert.equal(exchange.request.params._meta['io.modelcontextprotocol/protocolVersion'], profile.protocolVersion);
    assert.equal(exchange.request.params._meta['io.modelcontextprotocol/clientInfo'].name, 'pulse-mcp-01-reference-client');
    assert.deepEqual(exchange.request.params._meta['io.modelcontextprotocol/clientCapabilities'], {});
    assert.equal(exchange.response.id, exchange.request.id);
    assert.equal(exchange.response.result.resultType, 'complete');
  }
  assert.equal(wire[2].requestHeaders['mcp-name'], entity.name);
  report.checks.push('modern-discovery', 'finite-json-envelope', 'catalog-no-input-tool', 'governed-http-call');
  report.status = 'passed';
  console.log('ok - pinned official client exchanged three stateless requests and one governed entity invocation');
} catch (error) {
  report.status = 'failed'; report.error = error.stack || String(error);
  throw error;
} finally {
  await client.close();
  await handler.close();
  listener.closeAllConnections();
  await new Promise(resolve => listener.close(resolve));
  fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2) + '\n');
}
