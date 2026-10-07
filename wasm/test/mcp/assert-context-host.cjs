#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { buildProject } = require('../../packages/cli/src/project-execution.js');
const root = path.resolve(__dirname, '../../..');
const fixture = path.join(root, 'packages/mcp/examples/pulse-context');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-context-host-'));
const runtime = path.join(temp, 'runtime'), source = path.join(temp, 'source');
const children = new Set(), hosts = new Set(), sockets = new Set();
let id = 0, largest = 0, startupMs;

function child(args = [], ready = true) {
  const start = performance.now();
  const process = spawn(global.process.execPath, [path.join(runtime, 'host/start.cjs'), '--port', '0', ...args],
    { cwd: runtime, env: { ...global.process.env, NODE_PATH: '', NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(process); let stdout = '', stderr = '', buffer = '';
  const exit = new Promise(resolve => process.once('exit', (code, signal) => { children.delete(process); resolve({ code, signal, stdout, stderr }); }));
  const started = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Context host startup timed out: ' + stderr)), 10000);
    process.stdout.on('data', bytes => {
      stdout += bytes; buffer += bytes;
      for (let line; (line = buffer.indexOf('\n')) !== -1;) {
        const text = buffer.slice(0, line); buffer = buffer.slice(line + 1);
        let event; try { event = JSON.parse(text); } catch { continue; }
        if (event.event === 'ready') { clearTimeout(timeout); resolve({ ...event, startupMs: performance.now() - start }); }
      }
    });
    process.stderr.on('data', bytes => { stderr += bytes; });
    process.once('error', error => { clearTimeout(timeout); reject(error); });
    exit.then(result => { clearTimeout(timeout); if (ready) reject(new Error('Context host exited before readiness: ' + result.stderr)); else resolve(result); });
  });
  return { process, started, exit };
}
async function rpc(endpoint, method, params, legacy = false, extraHeaders = {}) {
  const protocol = legacy ? '2025-06-18' : '2026-07-28';
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', 'mcp-protocol-version': protocol,
    ...(legacy ? {} : { 'mcp-method': method, ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}) }), ...extraHeaders },
  body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: { ...params, ...(legacy ? {} : { _meta: {
    'io.modelcontextprotocol/protocolVersion': protocol, 'io.modelcontextprotocol/clientCapabilities': {} } }) } }) });
  const text = await response.text(); largest = Math.max(largest, Buffer.byteLength(text));
  assert.ok(Buffer.byteLength(text) <= 131072); return { status: response.status, reply: text ? JSON.parse(text) : null };
}
async function pending(endpoint) {
  const url = new URL(endpoint), socket = net.connect(Number(url.port), url.hostname); sockets.add(socket);
  socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
  await once(socket, 'connect');
  socket.write('POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2026-07-28\r\nMCP-Method: tools/call\r\nMCP-Name: pulse.search\r\nContent-Length: 1000\r\n\r\n{');
  return socket;
}
async function main() {
  fs.mkdirSync(source); fs.mkdirSync(runtime);
  for (const file of ['package.json', 'tsconfig.json', 'context-corpus.ts', 'corpus-version.ts', 'src', '.pulse', 'tests']) {
    fs.cpSync(path.join(fixture, file), path.join(source, file), { recursive: true });
  }
  const modules = path.join(source, 'node_modules/@pulse-compute'); fs.mkdirSync(modules, { recursive: true });
  for (const name of ['pulse', 'entities', 'provider-node']) fs.symlinkSync(path.join(root, 'packages', name), path.join(modules, name), 'dir');
  fs.symlinkSync(path.join(root, 'wasm/packages/contracts'), path.join(modules, 'wasm-contracts'), 'dir');
  buildProject(resolveProject({ cwd: source }));
  const built = path.join(source, 'dist-node-javascript');
  const { prepareHostBuild } = require(path.join(fixture, 'host/prepare.cjs'));
  const manifest = prepareHostBuild(built);
  assert.deepEqual(prepareHostBuild(built), manifest);
  fs.cpSync(built, path.join(runtime, 'dist-node-javascript'), { recursive: true });
  fs.cpSync(path.join(fixture, 'host'), path.join(runtime, 'host'), { recursive: true });
  fs.copyFileSync(path.join(fixture, 'package.json'), path.join(runtime, 'package.json'));
  // Copy candidate package bytes, not source-checkout links. PMCP-07 owns tarball installation.
  const packageMap = new Map();
  for (const base of ['packages', 'wasm/packages']) for (const name of fs.readdirSync(path.join(root, base))) {
    const dir = path.join(root, base, name), file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) packageMap.set(JSON.parse(fs.readFileSync(file)).name, dir);
  }
  const copied = new Set();
  function copyPackage(name) {
    if (copied.has(name)) return; copied.add(name);
    const dir = packageMap.get(name); assert.ok(dir, name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))), dest = path.join(runtime, 'node_modules', name);
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(dir)) if (['src', 'dist'].includes(entry) || /\.(json|cjs|js)$/.test(entry)) {
      fs.cpSync(path.join(dir, entry), path.join(dest, entry), { recursive: true, dereference: true });
    }
    for (const dependency of Object.keys(pkg.dependencies || {})) if (dependency.startsWith('@pulse-compute/')) copyPackage(dependency);
  }
  for (const name of ['@pulse-compute/provider-node', '@pulse-compute/mcp', '@pulse-compute/entities', '@pulse-compute/pulse']) copyPackage(name);
  fs.rmSync(source, { recursive: true, force: true });
  assert.ok(!fs.existsSync(path.join(runtime, 'src')) && !fs.existsSync(path.join(runtime, '.pulse')));
  const run = child(), ready = await run.started; startupMs = ready.startupMs;
  assert.equal(new URL(ready.endpoint).hostname, '127.0.0.1'); assert.equal(ready.buildId, manifest.buildId);
  const health = new URL('/_pulse/ready', ready.endpoint);
  const check = await fetch(health); assert.equal(check.status, 200); assert.equal(check.headers.get('cache-control'), 'no-store');
  assert.equal((await check.json()).identity, manifest.identity);
  assert.equal((await fetch(health, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(health, { method: 'POST' })).status, 405);
  const discovery = await rpc(ready.endpoint, 'server/discover', {});
  assert.equal(discovery.status, 200);
  assert.equal(discovery.reply.result._meta['io.modelcontextprotocol/serverInfo'].name, 'pulse-context');
  const listed = await rpc(ready.endpoint, 'tools/list', {});
  assert.equal(listed.status, 200); assert.equal(listed.reply.result.tools.length, 5);
  const version = ready.corpus.pulseVersion;
  const cases = [['pulse.start', { goal: 'json-api', provider: 'node', target: 'javascript' }],
    ['pulse.search', { query: 'schema' }], ['pulse.read', { id: 'schema/registry' }],
    ['pulse.example', { id: '01-hello-json' }], ['pulse.explain_diagnostic', { code: 'PULSE_SCHEMA_COMPILE_FAILED' }]];
  for (const [name, args] of cases) {
    const result = await rpc(ready.endpoint, 'tools/call', { name, arguments: { version, ...args } });
    assert.equal(result.status, 200); assert.equal(result.reply.result.isError, false);
    assert.equal(result.reply.result.structuredContent.meta.corpusHash, ready.corpus.corpusHash);
    assert.equal(result.reply.result.structuredContent.status, 'ok');
  }
  assert.equal((await rpc(ready.endpoint, 'tools/list', {}, false, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await rpc(ready.endpoint, 'tools/call', { name: 'pulse.search', arguments: { version, query: 'x'.repeat(32768) } })).status, 413);
  assert.notEqual((await rpc(ready.endpoint, 'tools/list', {}, true)).status, 200);
  const interrupted = await pending(ready.endpoint); await delay(40); interrupted.destroy();
  assert.equal((await rpc(ready.endpoint, 'tools/list', {})).status, 200);
  run.process.kill('SIGTERM'); assert.equal((await run.exit).code, 0);
  await assert.rejects(fetch(health));
  const legacy = child(['--codex']), legacyReady = await legacy.started;
  assert.equal((await rpc(legacyReady.endpoint, 'tools/list', {}, true)).status, 200);
  assert.equal((await rpc(legacyReady.endpoint, 'tools/list', {})).status, 200);
  legacy.process.kill('SIGINT'); assert.equal((await legacy.exit).code, 0);

  const localRequire = createRequire(path.join(runtime, 'package.json'));
  const { createContextHost } = localRequire('./host/server.cjs');
  assert.throws(() => createContextHost({ buildDir: built, host: '0.0.0.0' }), /options/);
  const buildDir = path.join(runtime, 'dist-node-javascript');
  const host = createContextHost({ buildDir, port: 0, deadlineMs: 150, shutdownTimeoutMs: 50 }); hosts.add(host);
  const status = await host.start(); assert.equal(status.backend.address.host, '127.0.0.1');
  assert.ok(status.backend.address.port > 0 && status.backend.address.port !== Number(new URL(status.endpoint).port));
  const stalled = await pending(status.endpoint); let data = ''; stalled.on('data', bytes => { data += bytes; });
  await once(stalled, 'close'); assert.match(data, /^HTTP\/1\.1 408 /);
  assert.equal((await rpc(status.endpoint, 'tools/list', {})).status, 200);
  const inflight = await pending(status.endpoint); await delay(20);
  const stop = host.close(); assert.equal(host.status().state, 'draining');
  const result = await stop; assert.equal(result.forced, true); assert.equal(host.status().backend.state, 'stopped');
  inflight.destroy(); assert.deepEqual(await host.close(), result);
  await assert.rejects(host.start(), /stopped/);

  const blocker = http.createServer(); blocker.listen(0, '127.0.0.1'); await once(blocker, 'listening');
  try {
    const blocked = createContextHost({ buildDir, port: blocker.address().port }); hosts.add(blocked);
    await assert.rejects(blocked.start(), /could not bind/);
    assert.equal(blocked.status().state, 'stopped'); assert.equal(blocked.status().backend.state, 'stopped');
    assert.equal(blocked.status().endpoint, null);
  } finally { blocker.close(); }
  const interruptedStart = createContextHost({ buildDir, port: 0 }); hosts.add(interruptedStart);
  const starting = interruptedStart.start(), closing = interruptedStart.close();
  await assert.rejects(starting, /interrupted/); await closing; assert.equal(interruptedStart.status().state, 'stopped');
  for (const file of ['pulse-build.json', 'pulse-context-host.json', 'entities-catalog.json', 'schema-json-registry.json',
    'schema-json-codecs.cjs', 'index.cjs', 'pulse-javascript-source-package.json', 'application/context-corpus.js']) {
    const target = path.join(buildDir, file), bytes = fs.readFileSync(target);
    try {
      if (file === 'pulse-context-host.json') {
        const changed = JSON.parse(bytes); changed.corpus.corpusHash = '0'.repeat(64); fs.writeFileSync(target, JSON.stringify(changed));
      } else fs.appendFileSync(target, '\n ');
      assert.throws(() => createContextHost({ buildDir, port: 0 }), /artifacts/);
    } finally { fs.writeFileSync(target, bytes); }
  }
  const manifestFile = path.join(buildDir, 'pulse-context-host.json'), manifestBytes = fs.readFileSync(manifestFile);
  fs.rmSync(manifestFile);
  const missing = child([], false); const outcome = await missing.started;
  assert.equal(outcome.code, 1); assert.ok(!outcome.stdout.includes('"event":"ready"'));
  fs.writeFileSync(manifestFile, manifestBytes);
  // Even a self-consistent host identity must agree with the actual backend's data.
  const { digest, stable } = localRequire('./host/artifacts.cjs');
  const { identity, ...changed } = JSON.parse(manifestBytes);
  changed.corpus.corpusHash = '0'.repeat(64);
  fs.writeFileSync(manifestFile, JSON.stringify({ ...changed, identity: digest(stable(changed)) }));
  const mismatch = child([], false), mismatchResult = await mismatch.started;
  assert.equal(mismatchResult.code, 1); assert.ok(!mismatchResult.stdout.includes('"event":"ready"'));
  fs.writeFileSync(manifestFile, manifestBytes);
  console.log(`ok - built-only clean process; copied runtime closure; five MCP tools; identity/pre-readiness rejection, bind cleanup, request deadline/disconnect and shutdown; startup ${startupMs.toFixed(1)}ms; largest MCP reply ${largest} bytes`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const socket of sockets) socket.destroy();
  for (const process of children) process.kill('SIGKILL');
  await Promise.all([...hosts].map(host => host.close())); fs.rmSync(temp, { recursive: true, force: true });
});
