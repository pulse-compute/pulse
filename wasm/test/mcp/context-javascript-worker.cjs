'use strict';
// Copied outside the checkout; every product import resolves from the exact install.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const settings = JSON.parse(fs.readFileSync(process.argv[2]));
const local = require('node:module').createRequire(path.join(settings.consumer, 'package.json'));
const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
function request(method, params, id) {
  return { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta } }) };
}
async function main() {
  const { createNodeLauncher } = local('@pulse-compute/provider-node/server');
  const launcher = createNodeLauncher({ buildDir: settings.buildDir, target: 'javascript', host: '127.0.0.1', port: 0, networkFetch: false, maxDurationMs: 5000 });
  let calls = 0;
  try {
    const started = await launcher.start();
    const endpoint = `http://127.0.0.1:${started.address.port}/mcp`;
    async function rpc(method, params) {
      const response = await fetch(endpoint, { ...request(method, params, ++calls), signal: AbortSignal.timeout(10000) });
      const text = await response.text(); assert.equal(response.status, 200, text);
      const reply = JSON.parse(text); assert(!reply.error, text); return reply.result;
    }
    const listed = await rpc('tools/list', {});
    assert.deepEqual(listed.tools.map(t => t.name), ['pulse.diagnostic', 'pulse.example', 'pulse.read', 'pulse.search', 'pulse.start']);
    for (const item of JSON.parse(fs.readFileSync(settings.expected))) {
      const result = await rpc('tools/call', { name: item.tool, arguments: item.input });
      assert.equal(result.isError, false);
      assert.deepEqual(result.structuredContent, item.expected, `${item.tool} ${JSON.stringify(item.input)}`);
      assert.deepEqual(JSON.parse(result.content[0].text), item.expected);
    }
  } finally { await launcher.close(); }

  // Separately identified host fixture: exercise the responsibilities declared
  // by MCP without adding effects to the read-only shipped context application.
  const { EntityRouter, jsonRpc, mcp } = local('@pulse-compute/mcp/pulse');
  const { executeNodeJavascriptApplication } = local('@pulse-compute/provider-node/javascript/runtime-host');
  const router = new EntityRouter({ adapter: jsonRpc() });
  async function probe(ctx) {
    ctx.log.debug('hidden'); ctx.log.info('probe secret-value');
    await ctx.fetch('https://fixture.invalid/probe').text();
    return undefined;
  }
  router.on('probe', { input: null, output: null }, probe);
  const server = mcp({ router });
  const app = async ctx => server.handle(ctx);
  const logs = [];
  let effects = 0;
  const exchange = options => executeNodeJavascriptApplication(app,
    new Request('https://fixture.invalid/mcp', request('tools/call', { name: 'probe' }, 'probe')),
    { maxDurationMs: 1000, reporting: 'info', secrets: { token: 'secret-value' },
      log(level, message) { logs.push([level, message]); throw new Error('sink failure'); },
      fetchImplementation: async () => { effects++; return new Response('ok'); }, ...options });
  const healthy = await exchange();
  assert.equal(healthy.status, 200); assert.equal((await healthy.json()).result.isError, false);
  assert.equal(effects, 1);
  assert.deepEqual(logs, [[3, 'probe <redacted>']]);
  const timeout = await exchange({ maxDurationMs: 50,
    fetchImplementation: async () => { await new Promise(resolve => setTimeout(resolve, 150)); return new Response('late'); } });
  assert.equal(timeout.status, 408); assert.equal((await timeout.json()).id, 'probe');
  const recovered = await exchange(); assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).result.isError, false);
  fs.writeFileSync(settings.result, JSON.stringify({ status: 'passed', calls, target: 'javascript',
    sourceInputsRemoved: true, effects: 'passed', logging: 'threshold-redaction-sink-failure',
    deadlineStatus: 408, recoveryStatus: 200 }, null, 2));
  console.log(`ok - ${calls} installed JavaScript context requests; MCP effects, logging and deadline recovery`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
