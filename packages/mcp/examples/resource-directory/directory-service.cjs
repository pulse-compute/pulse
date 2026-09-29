'use strict';
const http = require('node:http');
// Local demonstration store: bounded, ephemeral, and private. Proposals never edit resources.
function createDirectoryService() {
  const resources = [
    { id: 'pulse', title: 'Pulse', url: 'https://pulsecompute.io' },
    { id: 'mcp', title: 'Model Context Protocol', url: 'https://modelcontextprotocol.io' },
  ];
  const proposals = [];
  const counts = { search: 0, retrieve: 0, proposals: 0 };
  const handler = async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
      let bytes = 0; const chunks = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 65536) return reply(413, { error: 'too_large' }); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/search' && typeof input.query === 'string' && input.query.length <= 256) {
        counts.search++; return reply(200, { resources: resources.filter(item => item.title.toLowerCase().includes(input.query.toLowerCase())) });
      }
      if (req.url === '/retrieve' && typeof input.id === 'string' && input.id.length <= 128) {
        counts.retrieve++; const resource = resources.find(item => item.id === input.id);
        return reply(200, { found: !!resource, resource: resource ?? { id: '', title: '', url: '' } });
      }
      if (req.url === '/proposals' && typeof input.id === 'string' && resources.some(item => item.id === input.id)
        && typeof input.title === 'string' && input.title.length > 0 && input.title.length <= 256
        && typeof input.reason === 'string' && input.reason.length > 0 && input.reason.length <= 1024 && proposals.length < 100) {
        const proposalId = 'proposal-' + (proposals.length + 1);
        proposals.push({ proposalId, id: input.id, title: input.title, reason: input.reason }); counts.proposals++;
        return reply(200, { accepted: true, proposalId });
      }
      return reply(400, { error: 'invalid_request' });
    } catch { if (!res.destroyed) reply(400, { error: 'invalid_request' }); }
  };
  return { handler, counts, proposals };
}
if (require.main === module) {
  const server = http.createServer({ maxHeaderSize: 16384 }, createDirectoryService().handler);
  server.requestTimeout = 10000; server.headersTimeout = 5000;
  server.listen(8790, '127.0.0.1', () => console.log('Local directory ready on loopback'));
}
module.exports = { createDirectoryService };
