import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const [backend, catalogFile, reportFile, adapterFile, schemasFile] = process.argv.slice(2);
const { createMcpNodeHandler } = createRequire(import.meta.url)(adapterFile);
const catalog = JSON.parse(fs.readFileSync(catalogFile));
const schemas = JSON.parse(fs.readFileSync(schemasFile));
const server = http.createServer(createMcpNodeHandler({ tools: {
  endpoint: backend, catalog, schemas, routerId: 'rpc', target: 'node-javascript'
} }));
const client = new Client({ name: 'pulse-mcp-03-independent-client', version: '0.0.0' }, {
  capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } }
});
const report = { status: 'running', client: '@modelcontextprotocol/client@2.2.0', productionAdapter: true,
  installedConsumer: false, authorizationValidated: false, catalogHash: catalog.catalogHash,
  registryHash: schemas.registryHash, wire: [] };
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`), {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = await request.clone().json();
      const response = await fetch(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]) });
      report.wire.push({ request: body, status: response.status,
        headers: Object.fromEntries(response.headers), response: await response.clone().json() });
      return response;
    }
  }));
  assert.equal(client.getProtocolEra(), 'modern');
  assert.deepEqual(client.getServerCapabilities(), { tools: { listChanged: false } });
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name), ['customer.lookup', 'system.status']);
  assert.equal(listed.tools[0].inputSchema.properties.email.type, 'string');
  assert.equal(listed.tools[0].outputSchema.properties.displayName.type, 'string');
  assert.deepEqual(listed.tools[0].annotations, { readOnlyHint: true });
  // These failures are local admission; neither starts a backend request.
  await assert.rejects(client.callTool({ name: 'unknown', arguments: {} }));
  const invalid = await client.callTool({ name: 'customer.lookup', arguments: { email: 1 } });
  assert.equal(invalid.isError, true);
  const called = await client.callTool({ name: 'customer.lookup', arguments: { email: 'alice@example.test' } });
  assert.equal(called.isError, false);
  assert.deepEqual(called.structuredContent, { email: 'alice@example.test', displayName: 'Governed Alice' });
  assert.deepEqual(called.content, [{ type: 'text', text: JSON.stringify(called.structuredContent) }]);
  for (const exchange of report.wire) {
    assert.equal(exchange.headers['cache-control'], 'no-store');
    assert.equal(exchange.headers['mcp-session-id'], undefined);
    assert.equal(exchange.response.id, exchange.request.id);
    if (exchange.response.result) assert.equal(exchange.response.result.resultType, 'complete');
  }
  report.status = 'passed';
  console.log('ok - official client: emitted schemas, tool errors and one governed Pulse HTTP invocation');
} catch (error) {
  report.status = 'failed'; report.error = error.stack || String(error); throw error;
} finally {
  await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
}
