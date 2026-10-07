import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { qualifyAgent } from './context-agent-proof.cjs';

const [consumer, reportFile, executable] = process.argv.slice(2);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = { status: 'running', client: '@modelcontextprotocol/client@2.2.0', protocol: '2026-07-28',
  target: 'node-javascript', installedConsumer: true, deployed: false, checks: [], commands: [], wire: [] };
const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' };
let host, hostDone, client, held;
const record = name => report.checks.push(name);
function command(args, cwd = consumer) {
  const start = performance.now();
  const text = execFileSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const result = JSON.parse(text);
  report.commands.push({ command: args[0] === cli ? args.slice(1).join(' ') : path.basename(args[0]),
    status: result.status || result.event, elapsedMs: performance.now() - start });
  return result;
}
async function startHost() {
  const start = performance.now(); let stdout = '', stderr = '', buffer = '';
  host = spawn(process.execPath, [path.join(consumer, 'host/start.cjs'), '--port', '0', '--codex'],
    { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'] });
  hostDone = new Promise(resolve => host.once('close', (code, signal) => resolve({ code, signal })));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Production context host startup timed out: ' + stderr)), 10000);
    host.once('error', error => { clearTimeout(timer); reject(error); });
    hostDone.then(() => { clearTimeout(timer); reject(new Error('Host exited before readiness: ' + stderr)); });
    host.stdout.on('data', chunk => {
      stdout += chunk; buffer += chunk; if (stdout.length > 1048576) { clearTimeout(timer); reject(new Error('Host output exceeded limit')); }
      for (let n; (n = buffer.indexOf('\n')) !== -1;) {
        const line = buffer.slice(0, n); buffer = buffer.slice(n + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.event === 'ready') { clearTimeout(timer); resolve(event); }
      }
    });
    host.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-65536); });
  });
  report.startupMs = performance.now() - start;
  return ready;
}
try {
  assert.equal(command([cli, 'test', '--json']).status, 'passed');
  assert.equal(command([cli, 'build', '--json']).status, 'built');
  command([path.join(consumer, 'host/prepare.cjs')]); record('installed-app-ordinary-cli-test-and-build');
  const buildDir = path.join(consumer, 'dist-node-javascript');
  const manifest = JSON.parse(fs.readFileSync(path.join(buildDir, 'pulse-context-host.json')));
  const catalog = JSON.parse(fs.readFileSync(path.join(buildDir, 'entities-catalog.json')));
  const schemas = JSON.parse(fs.readFileSync(path.join(buildDir, 'schema-json-registry.json')));
  report.build = { buildId: manifest.buildId, identity: manifest.identity, manifestSha256: hash(fs.readFileSync(path.join(buildDir, 'pulse-context-host.json'))),
    catalogHash: catalog.catalogHash, registryHash: schemas.registryHash, corpus: manifest.corpus, files: manifest.files };
  // Runtime must start from the build; source and configuration are unnecessary.
  for (const file of ['src', '.pulse', 'tests', 'context-corpus.ts', 'corpus-version.ts']) fs.rmSync(path.join(consumer, file), { recursive: true, force: true });
  const ready = await startHost();
  assert.equal(ready.identity, manifest.identity); assert.equal(ready.buildId, manifest.buildId); assert.deepEqual(ready.corpus, manifest.corpus);
  const health = new URL('/_pulse/ready', ready.endpoint);
  assert.equal((await (await fetch(health)).json()).identity, manifest.identity);
  record('production-built-only-readiness');
  const version = ready.corpus.pulseVersion;
  client = new Client({ name: 'pulse-context-installed-acceptance', version: '0.0.0' },
    { capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(new StreamableHTTPClientTransport(new URL(ready.endpoint), {
    fetch: async (input, init) => {
      const request = new Request(input, init), body = await request.clone().json();
      if (held && body.method === 'tools/call' && body.params.name === 'pulse.search') {
        const control = held; held = undefined;
        const bytes = new TextEncoder().encode(JSON.stringify(body));
        const stream = new ReadableStream({ start(controller) {
          controller.enqueue(bytes.slice(0, 32));
          request.signal.addEventListener('abort', () => controller.error(request.signal.reason), { once: true });
        } });
        const response = fetch(request.url, { method: request.method, headers: request.headers, body: stream, duplex: 'half', signal: request.signal });
        // The first bytes cross HTTP admission while the finite body is incomplete.
        await delay(40); control();
        return response;
      }
      const response = await fetch(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]) });
      const bytes = Buffer.byteLength(await response.clone().text());
      assert.ok(bytes <= 131072); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('mcp-session-id'), null);
      report.wire.push({ method: body.method, tool: body.params?.name, status: response.status, bytes });
      return response;
    },
  }));
  await client.discover(); assert.equal(client.getProtocolEra(), 'modern');
  assert.deepEqual(client.getServerCapabilities(), { tools: { listChanged: false } });
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name), ['pulse.example', 'pulse.explain_diagnostic', 'pulse.read', 'pulse.search', 'pulse.start']);
  assert.equal(listed.tools.find(tool => tool.name === 'pulse.search').outputSchema.properties.results.type, 'array');
  record('official-discover-list-and-projected-schemas');
  async function call(name, args, status = 'ok') {
    const result = await client.callTool({ name, arguments: { version, ...args } });
    assert.equal(result.isError, false);
    const value = result.structuredContent;
    assert.equal(value.status, status); assert.equal(value.meta.pulseVersion, version); assert.equal(value.meta.corpusHash, ready.corpus.corpusHash);
    assert.equal(value.meta.snapshotStatus, ready.corpus.snapshotStatus); assert.equal(value.meta.corpusSchemaVersion, ready.corpus.schemaVersion);
    assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 24576);
    return value;
  }
  const started = await call('pulse.start', { goal: 'json-api', provider: 'node', target: 'javascript' });
  assert.equal(started.plan.exampleId, '01-hello-json'); assert.deepEqual(started.plan.configuration.changedFields, ['local.target: native -> javascript']);
  assert.ok(started.plan.dependencies.every(item => !item.name.startsWith('@pulse-compute/') || item.version === version));
  const citation = item => { assert.ok(item.source.url.startsWith('https://')); assert.match(item.source.sha256, /^[a-f0-9]{64}$/); };
  started.plan.contracts.forEach(citation);
  const search = await call('pulse.search', { query: 'schema', category: 'contract', limit: 2 });
  assert.equal(search.results.length, 2); assert.equal(search.truncated, true); search.results.forEach(citation);
  const next = await call('pulse.search', { query: 'schema', category: 'contract', limit: 2, offset: search.nextOffset });
  assert.ok(next.results.every(item => !search.results.some(prior => prior.id === item.id)));
  const read = await call('pulse.read', { id: search.results[0].id }); citation(read.record); assert.ok(read.record.content);
  const explained = await call('pulse.explain_diagnostic', { code: 'PULSE_SCHEMA_COMPILE_FAILED' });
  assert.ok(explained.explanation.contracts.some(item => item.id === 'schema/boundaries')); explained.explanation.contracts.forEach(citation);
  const records = []; let offset = 0, example;
  do {
    example = await call('pulse.example', { id: started.plan.exampleId, offset });
    assert.ok(example.records.length <= 5); example.records.forEach(citation); records.push(...example.records);
    if (example.truncated) { assert.ok(example.nextOffset > offset); offset = example.nextOffset; }
  } while (example.truncated);
  assert.deepEqual(records.map(item => item.id), example.availableIds);
  record('start-search-read-example-diagnostic-with-citations-and-pagination');
  for (const [name, args, status] of [
    ['pulse.start', { goal: 'json-api', provider: 'fastly', target: 'native' }, 'unsupported-selection'],
    ['pulse.search', { query: 'schema', limit: 6 }, 'invalid-input'],
    ['pulse.read', { id: '../AGENTS.md' }, 'unknown-id'],
    ['pulse.example', { id: 'missing' }, 'unknown-example'],
    ['pulse.example', { id: '01-hello-json', files: ['../AGENTS.md'] }, 'unknown-id'],
    ['pulse.explain_diagnostic', { code: 'PULSE_UNKNOWN' }, 'unknown-code'],
  ]) await call(name, args, status);
  for (const [name, args] of [
    ['pulse.start', { goal: 'json-api', provider: 'node', target: 'native' }], ['pulse.search', { query: 'schema' }],
    ['pulse.read', { id: 'schema/boundaries' }], ['pulse.example', { id: '01-hello-json' }], ['pulse.explain_diagnostic', { code: 'PULSE_SCHEMA_COMPILE_FAILED' }],
  ]) await call(name, { ...args, version: 'latest' }, 'version-mismatch');
  const invalid = await client.callTool({ name: 'pulse.read', arguments: { version, id: 42 } }); assert.equal(invalid.isError, true);
  await assert.rejects(client.callTool({ name: 'pulse.build', arguments: {} }));
  record('explicit-version-id-selection-and-schema-errors-no-execution-tools');
  const controller = new AbortController();
  held = () => controller.abort();
  await assert.rejects(client.callTool({ name: 'pulse.search', arguments: { version, query: 'schema' } }, undefined, { signal: controller.signal }));
  await call('pulse.search', { query: 'schema', limit: 1 }); record('official-client-partial-upload-cancellation-and-recovery');

  // Test-only client workspace: write returned bytes, apply the explicit plan and use installed CLI.
  const starter = path.join(path.dirname(consumer), 'starter'); fs.mkdirSync(starter);
  const prefix = `example/${started.plan.exampleId}/`;
  const supplied = [];
  for (const item of records) {
    assert.ok(item.id.startsWith(prefix)); assert.equal(item.truncated, false); assert.equal(hash(item.content), item.contentSha256);
    const relative = item.id.slice(prefix.length), target = path.resolve(starter, relative);
    assert.ok(target.startsWith(starter + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, item.content);
    supplied.push({ id: item.id, sha256: item.contentSha256 });
  }
  fs.writeFileSync(path.join(starter, started.plan.configuration.path), started.plan.configuration.content);
  fs.symlinkSync(path.join(consumer, 'node_modules'), path.join(starter, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const tested = command([cli, 'test', '--profile', 'local', '--json'], starter); assert.equal(tested.status, 'passed'); assert.ok(tested.summary.passed > 0);
  const built = command([cli, 'build', '--profile', 'local', '--json'], starter); assert.equal(built.status, 'built'); assert.equal(built.configuredTarget, 'javascript'); assert.equal(built.automaticFallback, false);
  report.starter = { exampleId: started.plan.exampleId, supplied, configurationSha256: hash(started.plan.configuration.content),
    target: 'javascript', test: tested.summary, buildStatus: built.status, clientSideOnly: true, reusedInstalledDependencyGraph: true };
  record('returned-starter-client-side-cli-test-and-build');
  report.agent = await qualifyAgent({ executable, endpoint: ready.endpoint, version, corpusHash: ready.corpus.corpusHash,
    directory: path.dirname(consumer), home: path.join(path.dirname(reportFile), 'codex-home') });
  assert.equal(report.agent.status, 'passed'); record('pinned-codex-complete-onboarding');
  await client.close();
  host.kill('SIGTERM');
  const stopped = await Promise.race([hostDone, delay(5000).then(() => null)]); assert.deepEqual(stopped, { code: 0, signal: null });
  await assert.rejects(fetch(health, { signal: AbortSignal.timeout(1000) }));
  record('production-host-graceful-shutdown');
  report.largestResponseBytes = Math.max(...report.wire.map(item => item.bytes));
  report.status = 'passed';
  console.log(`ok - installed context onboarding; startup ${report.startupMs.toFixed(1)}ms; largest reply ${report.largestResponseBytes} bytes`);
} catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
finally {
  await client?.close().catch(() => {});
  if (host && host.exitCode === null && host.signalCode === null) { host.kill('SIGKILL'); await hostDone; }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
}
