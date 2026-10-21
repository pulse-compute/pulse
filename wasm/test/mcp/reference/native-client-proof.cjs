'use strict';
// Explicit pinned client controls. No model turns, operator accounts or workspace tools.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');
const { createRequire } = require('node:module');
const { spawn, execFileSync } = require('node:child_process');
const settings = JSON.parse(fs.readFileSync(process.argv[2]));
const { kind, endpoint, profile, directory, home, cases, reportFile } = settings;
const report = { status: 'running', kind, profile, inferenceRequests: 0, calls: [] };
const names = cases.map(c => c.tool).sort();
let child, lines, timer, done, sdk, inference;
const pending = new Map();
const stop = signal => { if (child?.pid) { try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } } };
const rejectPending = error => { for (const p of pending.values()) p.reject(error); pending.clear(); };
let id = 0;
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const key = String(++id); pending.set(key, { resolve, reject });
    child.stdin.write(JSON.stringify(kind === 'claude' ? { type: 'control_request', request_id: key, request: method }
      : { id: key, method, params }) + '\n');
  });
}
function check(c, result) {
  // Claude control flattens text content; the relay separately validates the full MCP envelope.
  if (kind === 'claude') assert.notEqual(result.isError, true, c.tool);
  else assert.equal(result.isError, false, c.tool);
  assert.deepEqual(result.structuredContent, c.expected, c.tool);
  assert.deepEqual(JSON.parse(kind === 'claude' ? result.content : result.content.find(x => x.type === 'text').text), c.expected, c.tool);
  report.calls.push({ tool: c.tool, status: c.expected.status, bytes: Buffer.byteLength(JSON.stringify(result)) });
}
async function main() {
  if (kind === 'sdk') {
    const { Client, StreamableHTTPClientTransport } = createRequire(path.join(directory, 'package.json'))('@modelcontextprotocol/client');
    sdk = new Client({ name: 'pulse-native-qualification', version: '1' }, { capabilities: {}, supportedProtocolVersions: [profile],
      versionNegotiation: { mode: profile === '2026-07-28' ? { pin: profile } : 'legacy' } });
    await sdk.connect(new StreamableHTTPClientTransport(new URL(endpoint), { fetch: (input, init) => {
      const request = new Request(input, init);
      return fetch(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]) });
    } }));
    assert.equal(sdk.getProtocolEra(), profile === '2026-07-28' ? 'modern' : 'legacy');
    assert.deepEqual(sdk.getServerCapabilities(), { tools: { listChanged: false } });
    if (profile === '2026-07-28') await sdk.discover(); else await sdk.ping();
    assert.deepEqual((await sdk.listTools()).tools.map(t => t.name).sort(), names);
    for (const c of cases) check(c, await sdk.callTool({ name: c.tool, arguments: c.input }));
    report.status = 'passed'; return;
  }
  inference = http.createServer((req, res) => { report.inferenceRequests++; req.resume(); res.writeHead(503).end(); });
  await new Promise((resolve, reject) => { inference.once('error', reject); inference.listen(0, '127.0.0.1', resolve); });
  fs.mkdirSync(home, { recursive: true });
  const executable = settings.executable;
  const command = kind === 'claude' ? process.execPath : executable;
  const prefix = kind === 'claude' ? [executable] : [];
  const clientEnv = { PATH: process.env.PATH, HOME: directory,
    ...(kind === 'claude' ? { CLAUDE_CONFIG_DIR: home, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', MCP_DISCOVERY_CACHE: '0',
      ANTHROPIC_API_KEY: 'pulse-fixture-not-a-real-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${inference.address().port}` } : { CODEX_HOME: home }) };
  report.client = execFileSync(command, [...prefix, '--version'], { cwd: directory, env: clientEnv, encoding: 'utf8', timeout: 5000 }).trim();
  assert.equal(report.client, kind === 'claude' ? '2.1.292 (Claude Code)' : 'codex-cli 0.160.1');
  let args;
  if (kind === 'codex') {
    fs.writeFileSync(path.join(home, 'config.toml'),
      `project_doc_max_bytes = 0\n[features]\nshell_snapshot = false\n[mcp_servers.pulse_context]\nurl = "${endpoint}"\nrequired = true\nstartup_timeout_sec = 5\n[analytics]\nenabled = false\n[model_providers.context_fixture]\nname = "No-inference proof"\nbase_url = "http://127.0.0.1:${inference.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n`);
    args = ['app-server'];
  } else {
    const config = path.join(home, 'mcp.json');
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { pulse_context: { type: 'http', url: endpoint } } }));
    args = [...prefix, '--print', '--bare', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--no-session-persistence', '--strict-mcp-config', '--mcp-config', config, '--setting-sources', '', '--tools', '', '--permission-mode', 'manual'];
  }
  child = spawn(command, args, { cwd: directory, detached: process.platform !== 'win32', env: clientEnv, stdio: ['pipe', 'pipe', 'ignore'] });
  child.once('error', rejectPending);
  done = new Promise(resolve => child.once('close', (code, signal) => { rejectPending(Error('Client exited before replying')); resolve({ code, signal }); }));
  lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (kind === 'claude' && m.type !== 'control_response') return;
    const key = kind === 'claude' ? m.response.request_id : String(m.id), p = pending.get(key);
    if (!p) return; pending.delete(key);
    const error = kind === 'claude' ? m.response.subtype === 'error' : m.error;
    // Raw host status/configuration and host errors are deliberately not retained.
    error ? p.reject(Error('Client control request rejected')) : p.resolve(kind === 'claude' ? m.response.response : m.result);
  });
  timer = setTimeout(() => { rejectPending(Error('Client qualification exceeded 30 seconds')); stop('SIGKILL'); }, 30000);
  let call;
  if (kind === 'codex') {
    await rpc('initialize', { clientInfo: { name: 'pulse_native', title: 'Pulse Native', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const thread = await rpc('thread/start', { cwd: directory, ephemeral: true, model: 'pulse-context-proof', modelProvider: 'context_fixture', sandbox: 'read-only', approvalPolicy: 'on-request' });
    const inventory = await rpc('mcpServerStatus/list', { detail: 'toolsAndAuthOnly', threadId: thread.thread.id });
    const server = inventory.data.find(x => x.name === 'pulse_context');
    assert(server); assert.equal(server.toolsError, null);
    assert.deepEqual(server.serverCapabilities, { tools: { listChanged: false } });
    assert.deepEqual(Object.values(server.tools).map(t => t.name).sort(), names);
    call = c => rpc('mcpServer/tool/call', { threadId: thread.thread.id, server: 'pulse_context', tool: c.tool, arguments: c.input });
  } else {
    await rpc({ subtype: 'initialize', hooks: {}, sdkMcpServers: [] });
    await rpc({ subtype: 'mcp_reconnect', serverName: 'pulse_context' });
    const inventory = await rpc({ subtype: 'mcp_status' });
    const server = inventory.mcpServers.find(x => x.name === 'pulse_context');
    assert.equal(server?.status, 'connected');
    assert.deepEqual(server.tools.map(t => t.name).sort(), names);
    call = c => rpc({ subtype: 'mcp_call', tool: 'mcp__pulse_context__' + c.tool, arguments: c.input });
  }
  for (const c of cases) check(c, await call(c));
  assert.equal(report.inferenceRequests, 0);
  report.status = 'passed';
}
main().catch(error => { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }).finally(async () => {
  clearTimeout(timer); lines?.close();
  if (sdk) await sdk.close();
  if (child) {
    if (child.exitCode === null && child.signalCode === null) { const kill = setTimeout(() => stop('SIGKILL'), 1000); stop('SIGTERM'); report.process = await done; clearTimeout(kill); }
    stop('SIGKILL');
  }
  if (inference) { inference.closeAllConnections(); await new Promise(resolve => inference.close(resolve)); }
  fs.rmSync(home, { recursive: true, force: true });
  report.cleanup = 'passed';
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`${kind}/${profile}: ${report.status}`);
});
