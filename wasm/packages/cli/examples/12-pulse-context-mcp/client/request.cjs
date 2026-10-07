#!/usr/bin/env node
'use strict';

// Minimal modern HTTP client. Run from the copied example; no SDK or checkout needed.
const PROTOCOL_VERSION = '2026-07-28';

async function request(endpoint, operation, arguments_ = {}) {
  const discovery = operation === 'server/discover' || operation === 'tools/list';
  const method = discovery ? operation : 'tools/call';
  const params = discovery ? {} : { name: operation, arguments: arguments_ };
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
      'mcp-method': method,
      ...(discovery ? {} : { 'mcp-name': operation }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
  const reply = await response.json();
  if (reply.error) throw new Error(`MCP ${reply.error.code}: ${reply.error.message}`);
  if (reply.result.isError) throw new Error('MCP tool failed.');
  return reply.result;
}

module.exports = { request };
if (require.main === module) {
  const args = process.argv.slice(2);
  const endpoint = args[0] === '--url'
    ? args.splice(0, 2)[1]
    : 'http://127.0.0.1:8788/mcp';
  const [operation, json = '{}', ...extra] = args;
  Promise.resolve().then(() => {
    if (!endpoint || !operation || extra.length) {
      throw new Error('Usage: node client/request.cjs [--url URL] OPERATION [JSON_ARGUMENTS]');
    }
    return request(
      endpoint,
      operation,
      JSON.parse(json),
    );
  }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
