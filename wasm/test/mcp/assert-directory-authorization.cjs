'use strict';
// Small workspace-only negative fixture, called by mcp-authorization. No pack/install campaign.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { buildProject } = require('../../packages/cli/src/project-execution.js');
const { fixture } = require('./authorization-fixture.cjs');
const root = path.resolve(__dirname, '../../..');
async function directoryAuthorization() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-directory-negative-')); let f;
  try {
    const source = path.join(root, 'packages/mcp/examples/resource-directory');
    for (const file of ['src', '.pulse', 'package.json', 'tsconfig.json', 'tests', 'mcp-server.cjs']) fs.cpSync(path.join(source, file), path.join(temp, file), { recursive: true });
    const modules = path.join(temp, 'node_modules/@pulse-compute'); fs.mkdirSync(modules, { recursive: true });
    for (const name of ['pulse', 'entities', 'provider-node', 'mcp']) fs.symlinkSync(path.join(root, 'packages', name), path.join(modules, name), 'dir');
    fs.symlinkSync(path.join(root, 'wasm/packages/contracts'), path.join(modules, 'wasm-contracts'), 'dir');
    buildProject(resolveProject({ cwd: temp }));
    const { createDirectoryHandler } = require(path.join(temp, 'mcp-server.cjs'));
    f = await fixture({ adapter: options => createDirectoryHandler({ endpoint: options.tools.endpoint,
      backendBearerToken: options.tools.backendBearerToken,
      authorization: { ...options.authorization, scopes: ['mcp:access', 'directory:read'] },
    }, path.join(temp, 'dist-node-javascript')) });
    const token = f.issue({ scope: 'mcp:access directory:read' });
    async function rpc(method, params) {
      const response = await fetch(f.resource, { method: 'POST', headers: { authorization: 'Bearer ' + token,
        'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28',
        'mcp-method': method, ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } }) });
      return { status: response.status, value: await response.json() };
    }
    assert.deepEqual((await rpc('tools/list', {})).value.result.tools.map(tool => tool.name), ['directory.retrieve', 'directory.search']);
    assert.equal((await rpc('tools/call', { name: 'directory.propose-update', arguments: { id: 'pulse', title: 'Changed', reason: 'Review' } })).status, 403);
    assert.equal((await rpc('tools/call', { name: 'directory.retrieve', arguments: { id: 42 } })).value.result.isError, true);
    assert.equal(f.counts.backendAttempts, 0); assert.equal(f.counts.effects, 0);
    assert.equal((await fetch(f.backendUrl, { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: '{}' })).status, 401);
    assert.equal(f.counts.backendAttempts, 1); assert.equal(f.counts.effects, 0);
    console.log('ok - private directory catalog scope/write/schema negatives deny before dispatch');
  } finally { if (f) await f.close(); fs.rmSync(temp, { recursive: true, force: true }); }
}
module.exports = { directoryAuthorization };
