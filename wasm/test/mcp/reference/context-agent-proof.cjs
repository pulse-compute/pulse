'use strict';

// Actual pinned Codex app-server API; no inference, operator credentials or workspace tools.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');
const { spawn, execFileSync } = require('node:child_process');

async function qualifyAgent({ executable, endpoint, version, corpusHash, directory, home }) {
  const report = { status: 'running', inferenceRequests: 0, checks: [], calls: [] };
  const pending = new Map(); let child, lines, timer, done;
  const inference = http.createServer((_req, res) => { report.inferenceRequests++; res.writeHead(500).end(); });
  const stop = signal => {
    if (!child?.pid) return;
    try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  let id = 0;
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  try {
    report.client = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
    assert.equal(report.client, 'codex-cli 0.160.1');
    await new Promise((resolve, reject) => { inference.once('error', reject); inference.listen(0, '127.0.0.1', resolve); });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'config.toml'),
      `project_doc_max_bytes = 0\n[features]\nshell_snapshot = false\n` +
      `[mcp_servers.pulse_context]\nurl = "${endpoint}"\nrequired = true\nstartup_timeout_sec = 5\n` +
      `[analytics]\nenabled = false\n[model_providers.context_fixture]\nname = "No-inference proof"\n` +
      `base_url = "http://127.0.0.1:${inference.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n`);
    child = spawn(executable, ['app-server'], { cwd: directory, detached: process.platform !== 'win32',
      env: { PATH: process.env.PATH, HOME: directory, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-65536); });
    const rejectPending = error => { for (const item of pending.values()) item.reject(error); pending.clear(); };
    child.once('error', rejectPending);
    done = new Promise(resolve => child.once('close', (code, signal) => {
      rejectPending(new Error('Codex exited before replying: ' + stderr)); resolve({ code, signal });
    }));
    lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id);
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
    });
    timer = setTimeout(() => { rejectPending(new Error('Codex context journey exceeded 30 seconds')); stop('SIGKILL'); }, 30000);
    await rpc('initialize', { clientInfo: { name: 'pulse_context_acceptance', title: 'Pulse context acceptance', version: '0.0.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const thread = await rpc('thread/start', { cwd: directory, ephemeral: true, model: 'pulse-context-proof',
      modelProvider: 'context_fixture', sandbox: 'read-only', approvalPolicy: 'on-request' });
    const inventory = await rpc('mcpServerStatus/list', { detail: 'toolsAndAuthOnly', threadId: thread.thread.id });
    const server = inventory.data.find(item => item.name === 'pulse_context');
    assert.ok(server); assert.equal(server.toolsError, null);
    assert.deepEqual(server.serverCapabilities, { tools: { listChanged: false } });
    assert.deepEqual(Object.values(server.tools).map(tool => tool.name).sort(),
      ['pulse.example', 'pulse.explain_diagnostic', 'pulse.read', 'pulse.search', 'pulse.start']);
    report.checks.push('actual-agent-discovery-and-five-tools');
    for (const [tool, args] of [
      ['pulse.start', { goal: 'json-api', provider: 'node', target: 'javascript' }],
      ['pulse.search', { query: 'schema', limit: 2 }],
      ['pulse.read', { id: 'schema/boundaries' }],
      ['pulse.example', { id: '01-hello-json' }],
      ['pulse.explain_diagnostic', { code: 'PULSE_SCHEMA_COMPILE_FAILED' }],
    ]) {
      const result = await rpc('mcpServer/tool/call', { threadId: thread.thread.id, server: 'pulse_context', tool, arguments: { version, ...args } });
      assert.equal(result.isError, false);
      const value = result.structuredContent || JSON.parse(result.content.find(item => item.type === 'text').text);
      assert.equal(value.status, 'ok'); assert.equal(value.meta.pulseVersion, version); assert.equal(value.meta.corpusHash, corpusHash);
      report.calls.push({ tool, status: value.status, bytes: Buffer.byteLength(JSON.stringify(result)), corpusHash: value.meta.corpusHash });
    }
    assert.equal(report.inferenceRequests, 0); report.checks.push('actual-agent-onboarding-without-inference');
    report.status = 'passed';
    return report;
  } finally {
    clearTimeout(timer); lines?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const kill = setTimeout(() => stop('SIGKILL'), 1000); stop('SIGTERM');
      await done; clearTimeout(kill);
    }
    stop('SIGKILL');
    inference.closeAllConnections(); await new Promise(resolve => inference.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  }
}
module.exports = { qualifyAgent };
