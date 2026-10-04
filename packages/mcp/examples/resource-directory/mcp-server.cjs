'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createMcpNodeHandler } = require('@pulse-compute/mcp/node');

// Host composition only. Never imports the application's handlers or a private Pulse runtime.
function createDirectoryHandler(config, artifactDirectory = path.join(__dirname, 'dist-node-javascript')) {
  if (!config.authorization || !config.backendBearerToken) throw new TypeError('Authorization and a separate backend credential are required');
  return createMcpNodeHandler({
    limits: config.limits,
    tools: { endpoint: config.endpoint, backendBearerToken: config.backendBearerToken, routerId: 'rpc', target: 'node-javascript',
      catalog: JSON.parse(fs.readFileSync(path.join(artifactDirectory, 'entities-catalog.json'))),
      schemas: JSON.parse(fs.readFileSync(path.join(artifactDirectory, 'schema-json-registry.json'))) },
    authorization: { ...config.authorization, operations: {
      'directory.search': ['directory:read'], 'directory.retrieve': ['directory:read'],
      'directory.propose-update': ['directory:propose'],
    } },
  });
}
if (require.main === module) {
  const config = JSON.parse(fs.readFileSync(process.argv[2]));
  const server = http.createServer({ maxHeaderSize: 16384 }, createDirectoryHandler(config));
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.listen(config.port ?? 8791, '127.0.0.1', () => console.log('MCP listener ready on loopback'));
  const close = () => { server.closeAllConnections(); server.close(() => process.exit(0)); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}
module.exports = { createDirectoryHandler };
