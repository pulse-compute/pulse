import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const [consumer, reportFile] = process.argv.slice(2);
const require = createRequire(path.join(consumer, 'package.json'));
const { createDirectoryHandler } = require('./mcp-server.cjs');
const { createDirectoryService } = require('./directory-service.cjs');
const { fixture } = require('./authorization-fixture.cjs');
const report = { status: 'running', client: '@modelcontextprotocol/client@2.2.0', protocol: '2026-07-28',
  target: 'node-javascript', installedConsumer: true, controlledIssuer: true, deployed: false, checks: [], commands: [], httpStatuses: [] };
const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
const service = createDirectoryService();
let originMode = 'normal';
const origin = http.createServer((req, res) => {
  if (originMode === 'failure') { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"private":"origin-secret"}'); return; }
  void service.handler(req, res);
});
const clients = []; let dev, devDone, f;
const record = name => report.checks.push(name);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { const end = Date.now() + 3000; while (!check()) { assert.ok(Date.now() < end, 'condition deadline'); await pause(10); } }
function client() { const c = new Client({ name: 'pulse-directory-acceptance', version: '0.0.0' }, {
  capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } }); clients.push(c); return c; }
function transport(options = {}) { return new StreamableHTTPClientTransport(new URL(f.resource), {
  onInsufficientScope: 'throw', ...options, fetch: async (input, init) => {
    const response = await fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(5000)]) });
    if (response.url === f.resource) {
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('mcp-session-id'), null);
      report.httpStatuses.push(response.status);
    }
    return response;
  } }); }
const call = (c, name, args, options) => c.callTool({ name: 'directory.' + name, arguments: args }, undefined, options);
try {
  assert.ok(fs.realpathSync(require.resolve('@pulse-compute/mcp/node')).startsWith(consumer + path.sep));
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
  const configFile = path.join(consumer, '.pulse/config.ts');
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace('http://127.0.0.1:8790', `http://127.0.0.1:${origin.address().port}`));
  execFileSync(process.execPath, [path.join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', consumer], { cwd: consumer, timeout: 30000, encoding: 'utf8' });
  record('installed-application-typecheck');
  for (const command of ['doctor', 'inspect', 'test', 'build']) {
    const result = JSON.parse(execFileSync(process.execPath, [cli, command, '--json'], { cwd: consumer, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 }));
    assert.equal(result.status, { doctor: 'passed', inspect: 'ok', test: 'passed', build: 'built' }[command]);
    report.commands.push({ command, status: result.status, ...(command === 'test' ? { summary: result.summary } : {}) });
  }
  record('installed-ordinary-cli-workflow');
  const artifact = path.join(consumer, 'dist-node-javascript');
  const catalog = JSON.parse(fs.readFileSync(path.join(artifact, 'entities-catalog.json')));
  report.catalogHash = catalog.catalogHash;
  report.registryHash = JSON.parse(fs.readFileSync(path.join(artifact, 'schema-json-registry.json'))).registryHash;
  let stdout = '', stderr = '', ready;
  const started = new Promise(resolve => { ready = resolve; });
  dev = spawn(process.execPath, [cli, 'dev', '--port', '0', '--no-watch', '--json'], { cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'] });
  dev.stdout.on('data', chunk => { stdout += chunk; assert.ok(stdout.length < 1024 * 1024); for (const line of stdout.split('\n')) {
    let event; try { event = JSON.parse(line); } catch { continue; } if (event.event === 'ready') ready(event.url);
  } });
  dev.stderr.on('data', chunk => { stderr += chunk; });
  devDone = new Promise(resolve => { dev.once('error', error => resolve({ error: error.message })); dev.once('close', (code, signal) => resolve({ code, signal })); });
  const devTimeout = setTimeout(() => ready(null), 15000);
  const backend = await Promise.race([started, devDone.then(() => null)]); clearTimeout(devTimeout);
  assert.ok(backend, 'installed dev did not start: ' + stderr);
  f = await fixture({ backendEndpoint: backend, adapter: options => createDirectoryHandler({
    endpoint: options.tools.endpoint, backendBearerToken: options.tools.backendBearerToken,
    authorization: { ...options.authorization, scopes: ['mcp:access', 'directory:read'] },
    limits: { deadlineMs: 800 },
  }, artifact) });
  let tokens, verifier, discovery, authorizationUrl;
  const provider = {
    redirectUrl: 'http://127.0.0.1/callback',
    clientMetadata: { redirect_uris: ['http://127.0.0.1/callback'], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' },
    clientInformation: () => ({ client_id: 'preregistered-client' }), tokens: () => tokens, saveTokens: value => { tokens = value; },
    saveCodeVerifier: value => { verifier = value; }, codeVerifier: () => verifier,
    saveDiscoveryState: value => { discovery = value; }, discoveryState: () => discovery,
    state: () => 'directory-acceptance-state', redirectToAuthorization: url => { authorizationUrl = url; },
  };
  const initial = transport({ authProvider: provider });
  await assert.rejects(client().connect(initial)); assert.ok(authorizationUrl);
  const grant = await fetch(authorizationUrl, { redirect: 'manual' }); assert.equal(grant.status, 302);
  const callback = new URL(grant.headers.get('location')).searchParams;
  assert.equal(callback.get('state'), 'directory-acceptance-state');
  await initial.finishAuth(callback);
  const reader = client(); await reader.connect(transport({ authProvider: provider }));
  assert.deepEqual(reader.getServerCapabilities(), { tools: { listChanged: false } });
  const listed = await reader.listTools();
  assert.deepEqual(listed.tools.map(t => t.name), ['directory.retrieve', 'directory.search']);
  assert.equal(listed.tools[1].outputSchema.properties.resources.type, 'array');
  record('oauth-pkce-discovery-and-filtered-catalog');
  let before = f.counts.backendAttempts;
  await assert.rejects(call(reader, 'propose-update', { id: 'pulse', title: 'Changed', reason: 'Review' }));
  const invalid = await call(reader, 'retrieve', { id: 1 }); assert.equal(invalid.isError, true);
  assert.equal(f.counts.backendAttempts, before); assert.equal(service.counts.proposals, 0);
  record('denied-operation-and-invalid-input-before-dispatch');
  const search = await call(reader, 'search', { query: 'pulse' });
  assert.equal(search.isError, false); assert.deepEqual(search.structuredContent.resources, [{ id: 'pulse', title: 'Pulse', url: 'https://pulsecompute.io' }]);
  const retrieved = await call(reader, 'retrieve', { id: 'pulse' }); assert.equal(retrieved.structuredContent.resource.title, 'Pulse');
  const missing = await call(reader, 'retrieve', { id: 'missing' }); assert.equal(missing.structuredContent.found, false);
  const writer = client(); const writerToken = f.issue({ scope: 'mcp:access directory:read directory:propose' });
  await writer.connect(transport({ requestInit: { headers: { authorization: 'Bearer ' + writerToken } } }));
  assert.equal((await writer.listTools()).tools.length, 3);
  const proposed = await call(writer, 'propose-update', { id: 'pulse', title: 'Pulse reviewed', reason: 'Clarify title' });
  assert.deepEqual(proposed.structuredContent, { accepted: true, proposalId: 'proposal-1' });
  assert.equal(service.counts.proposals, 1); assert.equal(service.proposals[0].title, 'Pulse reviewed');
  assert.equal((await call(reader, 'retrieve', { id: 'pulse' })).structuredContent.resource.title, 'Pulse');
  assert.equal(f.counts.backendAttempts - before, 5); // search, retrieve, missing, proposal, retrieve
  record('three-tools-through-governed-http-exactly-once'); record('proposal-does-not-edit-resource');
  const direct = await fetch(f.backendUrl, { method: 'POST', headers: { authorization: 'Bearer ' + writerToken }, body: '{}' });
  assert.equal(direct.status, 401); assert.equal(service.counts.proposals, 1);
  record('client-token-cannot-bypass-backend-protection');
  originMode = 'failure';
  const failed = await call(reader, 'search', { query: 'pulse' }); assert.equal(failed.isError, true);
  assert.ok(!JSON.stringify(failed).includes('origin-secret')); originMode = 'normal';
  record('governed-effect-failure-is-safe-tool-error');
  f.backendMode('failure');
  await assert.rejects(call(reader, 'retrieve', { id: 'pulse' }), error => !String(error).includes('private-backend-detail'));
  record('backend-unavailable-is-safe-protocol-error');
  f.backendMode('stall'); before = f.counts.backendAttempts;
  const start = Date.now(); await assert.rejects(call(reader, 'retrieve', { id: 'pulse' }));
  assert.ok(Date.now() - start < 3000); await until(() => f.counts.cancelled === 1);
  assert.equal(f.counts.backendAttempts, before + 1); record('deadline-aborts-backend-without-retry');
  const controller = new AbortController(); before = f.counts.backendAttempts;
  const cancelled = call(reader, 'retrieve', { id: 'pulse' }, { signal: controller.signal }).then(() => ({ passed: true }), () => ({ cancelled: true }));
  await until(() => f.counts.backendAttempts === before + 1); controller.abort();
  assert.deepEqual(await cancelled, { cancelled: true }); await until(() => f.counts.cancelled === 2);
  record('client-cancellation-closes-backend');
  f.backendMode('normal');
  assert.equal((await call(reader, 'retrieve', { id: 'pulse' })).isError, false);
  record('healthy-request-after-failures');
  for (const value of f.observed.backendAuthorization.slice(0, 5)) assert.ok(value === 'Bearer ' + f.options.tools.backendBearerToken, 'backend credential isolation');
  for (const status of [200, 401, 403, 502, 408]) assert.ok(report.httpStatuses.includes(status), `missing HTTP outcome ${status}`);
  record('http-status-and-no-store-contract');
  report.directoryEffects = { ...service.counts }; report.backendAttempts = f.counts.backendAttempts;
  report.cancelledBackends = f.counts.cancelled;
  await Promise.all(clients.map(c => c.close()));
  dev.kill('SIGINT'); const stopped = await Promise.race([devDone, pause(5000).then(() => null)]);
  assert.ok(stopped && (stopped.code === 0 || stopped.signal === 'SIGINT'), JSON.stringify(stopped));
  record('installed-dev-shutdown'); report.status = 'passed';
  console.log('ok - installed resource-directory OAuth client, governed effects, denials, errors, deadlines and cancellation');
} catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
finally {
  for (const c of clients) await c.close().catch(() => {});
  if (f) await f.close(); origin.closeAllConnections(); await new Promise(resolve => origin.close(resolve));
  if (dev && dev.exitCode === null && dev.signalCode === null) { dev.kill('SIGKILL'); await devDone; }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
}
