export default { cases: [
  {
    name: 'local-tool',
    request: { method: 'POST', path: '/mcp', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'local.result'
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 'local', method: 'tools/call', params: {
      name: 'local.result', _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} }
    } }) },
    expect: { status: 200, json: { jsonrpc: '2.0', id: 'local', result: {
      resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'pulse-mcp-fixture', version: '1' } },
      isError: false, content: [{ type: 'text', text: '{"email":"ok","displayName":"local"}' }],
      structuredContent: { email: 'ok', displayName: 'local' }
    } } }
  },
  { name: 'origin-denied', request: { method: 'POST', path: '/mcp', headers: { origin: 'null' }, body: '{}' }, expect: { status: 403 } }
] }
