import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const [adapterFile, reportFile] = process.argv.slice(2);
const { createMcpNodeHandler } = createRequire(import.meta.url)(adapterFile);
const server = http.createServer(createMcpNodeHandler());
const client = new Client({ name: 'pulse-mcp-02-independent-client', version: '0.0.0' }, {
  capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } }
});
const report = { status: 'running', client: '@modelcontextprotocol/client@2.2.0', productionAdapter: true,
  publishedPackage: false, authorizationValidated: false, wire: [] };
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  await client.connect(new StreamableHTTPClientTransport(url, {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = await request.clone().json();
      const response = await fetch(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]) });
      report.wire.push({ request: body, requestHeaders: Object.fromEntries(request.headers),
        status: response.status, responseHeaders: Object.fromEntries(response.headers), response: await response.clone().json() });
      return response;
    }
  }));
  assert.equal(client.getProtocolEra(), 'modern');
  assert.deepEqual(client.getServerCapabilities(), {});
  await client.discover();
  await client.discover(); // No initialization state or one-shot connection coupling.
  assert.deepEqual(report.wire.map(item => item.request.method), ['server/discover', 'server/discover', 'server/discover']);
  for (const exchange of report.wire) {
    assert.equal(exchange.status, 200);
    assert.equal(exchange.response.id, exchange.request.id);
    assert.equal(exchange.response.result.resultType, 'complete');
    assert.equal(exchange.responseHeaders['content-type'], 'application/json');
    assert.equal(exchange.responseHeaders['cache-control'], 'no-store');
    assert.equal(exchange.responseHeaders['mcp-session-id'], undefined);
  }
  assert.deepEqual(report.wire[0].response.result.capabilities, {});
  report.status = 'passed';
  console.log('ok - official client 2.2.0 repeated discovery against Pulse MCP-02 adapter');
} catch (error) {
  report.status = 'failed'; report.error = error.stack || String(error); throw error;
} finally {
  await client.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
}
