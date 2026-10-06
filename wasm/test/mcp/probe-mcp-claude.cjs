#!/usr/bin/env node
'use strict';

// Explicit packed Claude Code qualification, with no model turn or operator account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');
const { createRequire } = require('node:module');
const { spawn, execFileSync } = require('node:child_process');
const { fixture } = require('./authorization-fixture.cjs');
const executable = process.argv[2];
if (!executable || process.argv.length !== 3) throw new Error('Usage: node wasm/test/mcp/probe-mcp-claude.cjs <claude-executable-or-cli-wrapper.cjs>');
// The official wrapper resolves its frozen native optional dependency without postinstall.
const command = executable.endsWith('.cjs') ? process.execPath : executable;
const prefix = executable.endsWith('.cjs') ? [executable] : [];
const root = path.resolve(__dirname, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mcp-claude-'));
const parent = path.join(root, 'wasm/.test-results'); fs.mkdirSync(parent, { recursive: true });
const evidence = fs.mkdtempSync(path.join(parent, 'mcp-claude-'));
const report = { status: 'running', date: new Date().toISOString(), node: process.version,
  platform: process.platform, arch: process.arch,
  profile: '2026-07-28', inferenceRequests: 0, toolInvocationQualified: false, wire: [] };
let child, lines, f, provider;
const pending = new Map();
class ControlError extends Error {}
function stopChild(signal) {
  if (!child?.pid) return;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function rpc(id, request) {
  report.phase = request.subtype;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request }) + '\n');
  });
}
async function main() {
  // No inherited Node preload, provider credentials, user settings, hooks or project files.
  const clientEnv = { PATH: process.env.PATH, HOME: temp, CLAUDE_CONFIG_DIR: path.join(temp, 'home'),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', MCP_DISCOVERY_CACHE: '0' };
  report.claude = execFileSync(command, [...prefix, '--version'], { cwd: temp, env: clientEnv, encoding: 'utf8', timeout: 5000 }).trim();
  assert.equal(report.claude, '2.1.292 (Claude Code)', 'qualification uses the measured pinned host');
  const packEnv = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_ignore_scripts: 'true' };
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp],
    { cwd: path.join(root, 'packages/mcp'), env: packEnv, encoding: 'utf8', timeout: 30000 }));
  report.tarball = { integrity: pack.integrity, bytes: pack.size };
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, pack.filename)],
    { cwd: temp, env: packEnv, encoding: 'utf8', timeout: 30000 });
  const { createMcpNodeHandler } = createRequire(path.join(temp, 'package.json'))('@pulse-compute/mcp/node');
  f = await fixture({ adapter: options => {
    // Default modern profile: no legacy option or reference server SDK.
    const listener = createMcpNodeHandler(options);
    return (req, res) => {
      const chunks = []; let bytes = 0;
      req.on('data', chunk => { bytes += chunk.length; if (bytes <= 65536) chunks.push(chunk); });
      res.once('finish', () => {
        let message; try { message = JSON.parse(Buffer.concat(chunks)); } catch { /* non-POST or unread rejection */ }
        const meta = message?.params?._meta;
        report.wire.push({ httpMethod: req.method, path: req.url, rpcMethod: message?.method || null,
          protocolHeader: req.headers['mcp-protocol-version'] || null,
          methodHeader: req.headers['mcp-method'] || null, nameHeader: req.headers['mcp-name'] || null,
          metadataProtocol: meta?.['io.modelcontextprotocol/protocolVersion'] || null,
          clientCapabilitiesPresent: !!meta?.['io.modelcontextprotocol/clientCapabilities'],
          tool: message?.params?.name || null, status: res.statusCode,
          sessionAssigned: res.hasHeader('mcp-session-id') });
      });
      return listener(req, res);
    };
  } });
  // Any accidental API request fails locally and invalidates the proof.
  provider = http.createServer((req, res) => { report.inferenceRequests++; req.resume(); res.writeHead(503).end(); });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const token = f.issue();
  const config = path.join(temp, 'mcp.json');
  fs.writeFileSync(config, JSON.stringify({ mcpServers: { pulse_pmcp01b: {
    type: 'http', url: f.resource, headers: { Authorization: 'Bearer ${PULSE_MCP_ACCESS_TOKEN}' }
  } } }), { mode: 0o600 });
  child = spawn(command, [...prefix, '--print', '--bare', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--no-session-persistence', '--strict-mcp-config', '--mcp-config', config, '--setting-sources', '', '--tools', '', '--permission-mode', 'manual'],
  { cwd: temp, detached: process.platform !== 'win32', env: { ...clientEnv,
    PULSE_MCP_ACCESS_TOKEN: token,
    ANTHROPIC_API_KEY: 'pulse-fixture-not-a-real-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${provider.address().port}` },
  stdio: ['pipe', 'pipe', 'ignore'] });
  child.on('error', () => { for (const item of pending.values()) item.reject(new Error('Claude process failed')); });
  child.on('exit', () => { for (const item of pending.values()) item.reject(new Error('Claude exited before replying')); });
  lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.type !== 'control_response') return;
    const item = pending.get(message.response.request_id); if (!item) return;
    pending.delete(message.response.request_id);
    // Raw status includes credential-bearing configuration. Never retain it or errors/logs.
    if (message.response.subtype === 'error') item.reject(new ControlError('Claude control request rejected'));
    else item.resolve(message.response.response);
  });
  const timer = setTimeout(() => {
    for (const item of pending.values()) item.reject(new Error('Claude qualification exceeded 30 seconds'));
    stopChild('SIGKILL');
  }, 30000);
  try {
    await rpc('1', { subtype: 'initialize', hooks: {}, sdkMcpServers: [] });
    await rpc('2', { subtype: 'mcp_reconnect', serverName: 'pulse_pmcp01b' });
    const inventory = await rpc('3', { subtype: 'mcp_status' });
    const server = inventory.mcpServers.find(item => item.name === 'pulse_pmcp01b');
    assert.equal(server?.status, 'connected');
    assert.deepEqual(server.tools.map(tool => tool.name), ['status'], 'discovery filters writer and unmapped tools');
    report.discovery = { status: server.status, serverInfo: server.serverInfo, tools: server.tools.map(tool => tool.name) };
    const called = await rpc('4', { subtype: 'mcp_call', tool: 'mcp__pulse_pmcp01b__status', arguments: {} });
    assert.notEqual(called.isError, true);
    assert.deepEqual(called.content, [{ type: 'text', text: 'null' }]);
    assert.equal(f.counts.backendAttempts, 1); assert.equal(f.counts.effects, 1);
    assert.deepEqual(f.observed.backendAuthorization, ['Bearer ' + f.options.tools.backendBearerToken]);
    // These are explicit trusted-control calls, not model-selected or built-in tools.
    await assert.rejects(rpc('5', { subtype: 'mcp_call', tool: 'mcp__pulse_pmcp01b__write', arguments: {} }), ControlError);
    assert.ok(report.wire.some(item => item.rpcMethod === 'tools/call' && item.tool === 'write' && item.status === 403));
    assert.equal(f.counts.backendAttempts, 1, 'hidden writer cannot reach backend');
    f.tokens.get(token).active = false;
    let revoked;
    try { revoked = await rpc('6', { subtype: 'mcp_call', tool: 'mcp__pulse_pmcp01b__status', arguments: {} }); }
    catch (error) { if (!(error instanceof ControlError)) throw error; }
    assert.ok(revoked === undefined || revoked.isError === true, 'revocation must fail');
    assert.ok(report.wire.some(item => item.rpcMethod === 'tools/call' && item.tool === 'status' && item.status === 401));
    assert.equal(f.counts.backendAttempts, 1); assert.equal(f.counts.effects, 1);
    for (const method of ['server/discover', 'tools/list', 'tools/call']) {
      const request = report.wire.find(item => item.rpcMethod === method && item.status === 200);
      assert.ok(request, 'real client must reach the packed adapter for ' + method);
      assert.equal(request.protocolHeader, report.profile); assert.equal(request.methodHeader, method);
      assert.equal(request.metadataProtocol, report.profile); assert.equal(request.clientCapabilitiesPresent, true);
      if (method === 'tools/call') assert.equal(request.nameHeader, 'status');
    }
    assert.equal(report.wire.some(item => item.rpcMethod === 'initialize'), false);
    assert.equal(report.wire.some(item => item.sessionAssigned), false);
    assert.equal(report.inferenceRequests, 0);
    report.backend = { attempts: f.counts.backendAttempts, effects: f.counts.effects, separateCredentialVerified: true };
    report.authorization = { hiddenWriterRejected: true, revokedTokenRejected: true };
    for (const credential of [token, f.options.tools.backendBearerToken, f.options.authorization.clientSecret]) {
      assert.equal(JSON.stringify(report).includes(credential), false, 'retained evidence must omit credentials');
    }
    report.toolInvocationQualified = true; report.status = 'passed';
  } finally { clearTimeout(timer); }
}
main().catch(error => { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }).finally(async () => {
  lines?.close();
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => stopChild('SIGKILL'), 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); }); stopChild('SIGTERM');
    });
  }
  stopChild('SIGKILL');
  if (provider) { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
  if (f) await f.close();
  fs.rmSync(temp, { recursive: true, force: true });
  fs.writeFileSync(path.join(evidence, 'proof.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.claude}: ${report.status}; evidence ${evidence}`);
});
