#!/usr/bin/env node
'use strict';

// Explicit, no-inference compatibility probe; not part of a seal or fast profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const readline = require('node:readline');
const { createRequire } = require('node:module');
const { spawn, execFileSync } = require('node:child_process');
const { fixture } = require('./authorization-fixture.cjs');
const codex = process.argv[2];
const qualify = process.argv[3] === '--qualify';
if (!codex || (process.argv[3] && !qualify)) throw new Error('Usage: node wasm/test/mcp/probe-mcp-codex.cjs <codex-executable> [--qualify]');
const root = path.resolve(__dirname, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mcp-codex-'));
const parent = path.join(root, 'wasm/.test-results'); fs.mkdirSync(parent, { recursive: true });
const evidence = fs.mkdtempSync(path.join(parent, 'mcp-codex-'));
const report = { status: 'running', date: new Date().toISOString(), node: process.version, inferenceRequested: false, wire: [] };
let server, child, lines, f;
const pending = new Map();
function stopChild(signal) {
  if (!child?.pid) return;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function rpc(id, method, params) {
  report.phase = method;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function main() {
  const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_ignore_scripts: 'true' };
  report.codex = execFileSync(codex, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  if (qualify) assert.equal(report.codex, 'codex-cli 0.160.1', 'qualification uses the measured pinned host');
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp],
    { cwd: path.join(root, 'packages/mcp'), env, encoding: 'utf8', timeout: 30000 }));
  report.tarball = { integrity: pack.integrity, bytes: pack.size };
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, pack.filename)],
    { cwd: temp, env, encoding: 'utf8', timeout: 30000 });
  const { createMcpHttpHandler } = createRequire(path.join(temp, 'package.json'))('@pulse-compute/mcp');
  const handler = createMcpHttpHandler();
  report.inferenceRequests = 0;
  server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/v1')) report.inferenceRequests++;
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const response = await handler.fetch(new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
        method: req.method, headers: req.headers, ...(body.length ? { body } : {})
      }));
      const text = await response.text();
      const message = body.length ? JSON.parse(body) : null;
      report.wire.push({ httpMethod: req.method, path: req.url, protocolHeader: req.headers['mcp-protocol-version'] || null,
        rpcMethod: message?.method || null, requestedProtocol: message?.params?.protocolVersion || null,
        status: response.status, error: text ? JSON.parse(text).error || null : null });
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(text);
    } catch { res.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  if (qualify) {
    const { createMcpNodeHandler } = createRequire(path.join(temp, 'package.json'))('@pulse-compute/mcp/node');
    f = await fixture({ adapter: options => {
      const listener = createMcpNodeHandler({ ...options, legacyProtocol: '2025-06-18' });
      return (req, res) => {
        const chunks = []; let bytes = 0;
        req.on('data', chunk => { bytes += chunk.length; if (bytes <= 65536) chunks.push(chunk); });
        res.once('finish', () => {
          let message; try { message = JSON.parse(Buffer.concat(chunks)); } catch { /* GET or unread rejection */ }
          report.wire.push({ httpMethod: req.method, path: req.url, protocolHeader: req.headers['mcp-protocol-version'] || null,
            rpcMethod: message?.method || null, requestedProtocol: message?.params?.protocolVersion || null,
            tool: message?.params?.name || null, status: res.statusCode, sessionAssigned: res.hasHeader('mcp-session-id') });
        });
        return listener(req, res);
      };
    } });
  }
  // Codex refuses to create its filesystem/sandbox helper aliases under /tmp.
  const codexHome = path.join(evidence, 'codex-home'); fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome, 'config.toml'),
    // No inference or workspace behavior is needed for this explicit MCP call.
    `project_doc_max_bytes = 0\n[features]\nshell_snapshot = false\n`
    + `[mcp_servers.pulse_pmcp01]\nurl = "${f?.resource || `http://127.0.0.1:${server.address().port}/mcp`}"\nstartup_timeout_sec = 5\n`
    + (qualify ? 'required = true\nbearer_token_env_var = "PULSE_MCP_TEST_TOKEN"\n' : '')
    + `[analytics]\nenabled = false\n`
    + (qualify ? `[model_providers.pmcp01_fixture]\nname = "No-inference proof"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n` : ''));
  // A separate child configuration prevents reading the operator's accounts or MCP servers.
  const clientBearer = qualify ? f.issue() : null;
  child = spawn(codex, ['app-server'], { cwd: temp, detached: process.platform !== 'win32',
    env: { PATH: process.env.PATH, HOME: temp, CODEX_HOME: codexHome,
      ...(qualify ? { PULSE_MCP_TEST_TOKEN: clientBearer } : {}) }, stdio: ['pipe', 'pipe', 'ignore'] });
  child.on('error', error => { for (const item of pending.values()) item.reject(error); });
  child.on('exit', () => { for (const item of pending.values()) item.reject(new Error('Codex exited before replying')); });
  lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.method) (report.receivedMethods ??= []).push(message.method);
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
  });
  const timeout = setTimeout(() => {
    for (const item of pending.values()) item.reject(new Error('Codex compatibility probe exceeded 30 seconds'));
    stopChild('SIGKILL');
  }, 30000);
  try {
    await rpc(1, 'initialize', { clientInfo: { name: 'pulse_pmcp01_probe', title: 'Pulse PMCP-01', version: '0.0.0' },
      capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const thread = qualify ? await rpc(2, 'thread/start', { cwd: temp, ephemeral: true,
      model: 'pulse-mcp-proof', modelProvider: 'pmcp01_fixture', sandbox: 'read-only', approvalPolicy: 'on-request' }) : null;
    const inventory = await rpc(3, 'mcpServerStatus/list', { detail: 'toolsAndAuthOnly', ...(thread ? { threadId: thread.thread.id } : {}) });
    const result = inventory.data.find(item => item.name === 'pulse_pmcp01');
    assert.ok(result, 'Codex must actually attempt this configured MCP server');
    assert.ok(report.wire.length, 'The probe must reach the packed adapter');
    report.toolsError = result.toolsError;
    report.serverCapabilities = result.serverCapabilities;
    report.status = result.toolsError ? 'incompatible' : 'discovery-connected';
    report.toolInvocationQualified = false;
    if (qualify) {
      assert.equal(result.toolsError, null);
      assert.deepEqual(result.serverCapabilities, { tools: { listChanged: false } });
      assert.equal(Object.keys(result.tools).length, 1, 'only the scoped status tool is discovered');
      const called = await rpc(4, 'mcpServer/tool/call', { threadId: thread.thread.id, server: 'pulse_pmcp01', tool: 'status', arguments: {} });
      report.toolResult = called;
      assert.equal(called.isError, false);
      assert.deepEqual(called.content, [{ type: 'text', text: 'null' }]);
      assert.equal(f.counts.backendAttempts, 1); assert.equal(f.counts.effects, 1);
      assert.deepEqual(f.observed.backendAuthorization, ['Bearer ' + f.options.tools.backendBearerToken]);
      assert.ok(report.wire.some(item => item.rpcMethod === 'initialize' && item.requestedProtocol === '2025-06-18' && item.status === 200));
      assert.ok(report.wire.some(item => item.rpcMethod === 'tools/call' && item.tool === 'status' && item.status === 200));
      assert.equal(report.wire.some(item => item.sessionAssigned), false);
      assert.equal(report.inferenceRequests, 0);
      report.backend = { attempts: f.counts.backendAttempts, effects: f.counts.effects, separateCredentialVerified: true };
      report.toolInvocationQualified = true; report.status = 'passed';
    }
    if (result.toolsError) process.exitCode = 2;
  } finally { clearTimeout(timeout); }
}
main().catch(error => { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }).finally(async () => {
  lines?.close();
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => stopChild('SIGKILL'), 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); }); stopChild('SIGTERM');
    });
  }
  stopChild('SIGKILL');
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (f) await f.close();
  fs.writeFileSync(path.join(evidence, 'proof.json'), JSON.stringify(report, null, 2) + '\n');
  fs.rmSync(path.join(evidence, 'codex-home'), { recursive: true, force: true });
  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`${report.codex}: ${report.status}; evidence ${evidence}`);
});
