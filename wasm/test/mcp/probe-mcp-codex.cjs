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
const codex = process.argv[2];
if (!codex) throw new Error('Usage: node wasm/test/mcp/probe-mcp-codex.cjs <codex-executable>');
const root = path.resolve(__dirname, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mcp-codex-'));
const parent = path.join(root, 'wasm/.test-results'); fs.mkdirSync(parent, { recursive: true });
const evidence = fs.mkdtempSync(path.join(parent, 'mcp-codex-'));
const report = { status: 'running', date: new Date().toISOString(), node: process.version, inferenceRequested: false, wire: [] };
let server, child, lines;
const pending = new Map();
function rpc(id, method, params) {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function main() {
  const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_ignore_scripts: 'true' };
  report.codex = execFileSync(codex, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp],
    { cwd: path.join(root, 'packages/mcp'), env, encoding: 'utf8', timeout: 30000 }));
  report.tarball = { integrity: pack.integrity, bytes: pack.size };
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, pack.filename)],
    { cwd: temp, env, encoding: 'utf8', timeout: 30000 });
  const { createMcpHttpHandler } = createRequire(path.join(temp, 'package.json'))('@pulse-compute/mcp');
  const handler = createMcpHttpHandler();
  server = http.createServer(async (req, res) => {
    try {
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
  const codexHome = path.join(temp, 'codex-home'); fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome, 'config.toml'),
    `[mcp_servers.pulse_pmcp01]\nurl = "http://127.0.0.1:${server.address().port}/mcp"\nstartup_timeout_sec = 5\n[analytics]\nenabled = false\n`);
  // A separate child configuration prevents reading the operator's accounts or MCP servers.
  child = spawn(codex, ['app-server'], { cwd: temp,
    env: { PATH: process.env.PATH, HOME: temp, CODEX_HOME: codexHome }, stdio: ['pipe', 'pipe', 'ignore'] });
  child.on('error', error => { for (const item of pending.values()) item.reject(error); });
  child.on('exit', () => { for (const item of pending.values()) item.reject(new Error('Codex exited before replying')); });
  lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
  });
  const timeout = setTimeout(() => {
    for (const item of pending.values()) item.reject(new Error('Codex compatibility probe exceeded 15 seconds'));
    child.kill('SIGKILL');
  }, 15000);
  try {
    await rpc(1, 'initialize', { clientInfo: { name: 'pulse_pmcp01_probe', title: 'Pulse PMCP-01', version: '0.0.0' } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const inventory = await rpc(2, 'mcpServerStatus/list', { detail: 'toolsAndAuthOnly' });
    const result = inventory.data.find(item => item.name === 'pulse_pmcp01');
    assert.ok(result, 'Codex must actually attempt this configured MCP server');
    assert.ok(report.wire.length, 'The probe must reach the packed adapter');
    report.toolsError = result.toolsError;
    report.serverCapabilities = result.serverCapabilities;
    report.status = result.toolsError ? 'incompatible' : 'discovery-connected';
    report.toolInvocationQualified = false;
    if (result.toolsError) process.exitCode = 2;
  } finally { clearTimeout(timeout); }
}
main().catch(error => { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }).finally(async () => {
  lines?.close();
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
    });
  }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.writeFileSync(path.join(evidence, 'proof.json'), JSON.stringify(report, null, 2) + '\n');
  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`${report.codex}: ${report.status}; evidence ${evidence}`);
});
