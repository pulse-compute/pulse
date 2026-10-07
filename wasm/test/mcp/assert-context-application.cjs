#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { buildProject } = require('../../packages/cli/src/project-execution.js');
const { createMcpHttpHandler, PROTOCOL_VERSION } = require('../../../packages/mcp/src/index.js');
const { run, parseJson } = require('../cli/helpers.cjs');
const root = path.resolve(__dirname, '../../..');
const fixture = path.join(root, 'packages/mcp/examples/pulse-context');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-context-app-'));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
let launcher;

async function main() {
  for (const file of ['package.json', 'tsconfig.json', 'context-corpus.ts', 'corpus-version.ts', 'src', '.pulse', 'tests']) {
    fs.cpSync(path.join(fixture, file), path.join(temp, file), { recursive: true, filter: source => !source.includes('/guests/') });
  }
  const modules = path.join(temp, 'node_modules/@pulse-compute'); fs.mkdirSync(modules, { recursive: true });
  for (const name of ['pulse', 'entities', 'provider-node']) fs.symlinkSync(path.join(root, 'packages', name), path.join(modules, name), 'dir');
  fs.symlinkSync(path.join(root, 'wasm/packages/contracts'), path.join(modules, 'wasm-contracts'), 'dir');
  try { execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--project', path.join(temp, 'tsconfig.json')], { encoding: 'utf8' }); }
  catch (error) { throw new Error(error.stdout || error.message); }
  const project = resolveProject({ cwd: temp });
  assert.equal(project.target, 'javascript'); assert.equal(project.provider, 'node');
  const build = buildProject(project);
  assert.equal(build.automaticFallback, false);
  const out = path.join(temp, 'dist-node-javascript');
  const catalog = JSON.parse(fs.readFileSync(path.join(out, 'entities-catalog.json')));
  const schemas = JSON.parse(fs.readFileSync(path.join(out, 'schema-json-registry.json')));
  const names = ['pulse.example', 'pulse.explain_diagnostic', 'pulse.read', 'pulse.search', 'pulse.start'];
  assert.deepEqual(catalog.routers[0].entities.map(entry => entry.name), names);
  const inspection = parseJson(run(['inspect', '--json'], temp));
  assert.equal(inspection.compiler.packageInspection.managedHandlers.summary.nativeEligible, 0);
  assert.ok(inspection.compiler.packageInspection.managedHandlers.handlers.every(handler => handler.eligibility.javascript.eligible && !handler.eligibility.native.eligible));
  // Selecting Native still fails; inspection never supplies an executable fallback.
  assert.throws(() => buildProject({ ...project, target: 'native' }), /Managed handler compilation failed/);
  const harness = parseJson(run(['test', '--json'], temp));
  assert.equal(harness.status, 'passed');
  const localRequire = createRequire(path.join(temp, 'package.json'));
  const { contextCorpus } = localRequire(path.join(out, 'application/context-corpus.js'));
  const handlers = localRequire(path.join(out, 'application/src/handlers.js'));
  const { clip, limits } = handlers;
  assert.deepEqual(clip('é😀z', 0, 6, 12), { content: 'é😀', truncated: true, nextOffset: 3 });
  assert.deepEqual(clip('é😀z', 3, 6, 12), { content: 'z', truncated: false });
  assert.deepEqual(clip('\u0000\u0000x', 0, 10, 6), { content: '\u0000', truncated: true, nextOffset: 1 });

  // The tested build has its own data/source closure; source project files are gone.
  for (const file of ['src', '.pulse', 'tests', 'context-corpus.ts', 'corpus-version.ts']) fs.rmSync(path.join(temp, file), { recursive: true, force: true });
  const { createNodeLauncher } = localRequire('@pulse-compute/provider-node/server');
  launcher = createNodeLauncher({ buildDir: out, target: 'javascript', host: '127.0.0.1', port: 0, networkFetch: false });
  const started = await launcher.start();
  const endpoint = `http://127.0.0.1:${started.address.port}/`;
  const version = contextCorpus.pulseVersion;
  let calls = 0, largest = 0;
  async function rpc(method, params) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++calls, method, params: { version, ...params } }) });
    assert.equal(response.status, 200);
    const text = await response.text(), reply = JSON.parse(text);
    assert.equal(reply.error, undefined, `${method} ${JSON.stringify(params)}: ${text}`);
    const result = reply.result;
    const size = Buffer.byteLength(JSON.stringify(result)); largest = Math.max(largest, size);
    assert.ok(size <= limits.maxReplyBytes);
    assert.equal(result.meta.corpusHash, contextCorpus.corpusHash);
    assert.equal(result.meta.pulseVersion, version);
    return result;
  }
  const start = await rpc('pulse.start', { goal: 'schema-api', provider: 'node', target: 'javascript' });
  assert.equal(start.status, 'ok'); assert.match(start.plan.configuration.content, /target: 'javascript'/);
  assert.deepEqual(start.plan.exampleApplicability, [{ provider: 'node', target: 'native' }]);
  assert.equal(start.plan.configuration.changedFields.length, 1);
  assert.ok(start.plan.imports.includes('@pulse-compute/pulse/schema'));
  assert.ok(start.plan.contracts.some(record => record.id === 'schema/boundaries'));
  assert.ok(start.plan.commands.some(step => step.command === 'pulse build --profile local'));
  assert.ok(start.plan.unresolvedChoices.length > 0);
  for (const goal of ['json-api', 'schema-api', 'fetch-api', 'router-api']) for (const target of ['native', 'javascript']) {
    const reply = await rpc('pulse.start', { goal, provider: 'node', target }); assert.equal(reply.status, 'ok');
    assert.match(reply.plan.configuration.content, new RegExp(`target: '${target}'`));
    assert.ok(reply.plan.dependencies.every(dependency => !dependency.name.startsWith('@pulse-compute/') || dependency.version === version));
    for (const contract of reply.plan.contracts) assert.ok(contextCorpus.records.some(record => record.id === contract.id));
  }
  assert.equal((await rpc('pulse.start', { goal: 'schema-api', provider: 'fastly', target: 'native' })).status, 'unsupported-selection');
  assert.equal((await rpc('pulse.start', { goal: 'execute', provider: 'node', target: 'native' })).status, 'unknown-goal');
  assert.equal((await rpc('pulse.start', { goal: 'constructor', provider: 'node', target: 'native' })).status, 'unknown-goal');
  const searched = await rpc('pulse.search', { query: 'schema', category: 'contract', limit: 2 });
  assert.equal(searched.results.length, 2); assert.equal(searched.truncated, true); assert.equal(searched.nextOffset, 2);
  assert.deepEqual(await rpc('pulse.search', { query: 'schema', category: 'contract', limit: 2 }), searched);
  const next = await rpc('pulse.search', { query: 'schema', category: 'contract', limit: 2, offset: searched.nextOffset });
  assert.ok(!next.results.some(hit => searched.results.some(prior => prior.id === hit.id)));
  for (const query of ['schema', 'managed async', 'target', 'parallel', 'schema.compile', '😀', 'zz-no-match-zz']) {
    const result = await rpc('pulse.search', { query });
    assert.ok(result.results.length <= 5);
    assert.ok(result.results.every(hit => Buffer.byteLength(hit.excerpt) <= 384));
    for (let n = 1; n < result.results.length; n++) assert.ok(result.results[n - 1].score >= result.results[n].score);
  }
  assert.equal((await rpc('pulse.search', { query: 'schema', limit: 6 })).status, 'invalid-input');
  assert.equal((await rpc('pulse.search', { query: 'é'.repeat(129) })).status, 'invalid-input');
  assert.equal((await rpc('pulse.search', { query: 'x', offset: -1 })).status, 'invalid-input');
  assert.equal((await rpc('pulse.search', { query: 'schema', provider: 'none', target: 'javascript' })).status, 'unsupported-selection');
  assert.equal((await rpc('pulse.search', { query: 'schema', provider: 'node' })).status, 'unsupported-selection');
  assert.equal((await rpc('pulse.search', { query: 'schema', category: 'private' })).status, 'invalid-input');
  const nodeJs = await rpc('pulse.search', { query: 'JavaScript', category: 'guide', provider: 'node', target: 'javascript' });
  assert.ok(nodeJs.results.length > 0); assert.ok(nodeJs.results.every(hit => hit.applicability.some(pair => pair.provider === 'node' && pair.target === 'javascript')));
  for (const record of contextCorpus.records) {
    let collected = '', offset = 0, reply;
    do {
      reply = await rpc('pulse.read', { id: record.id, offset }); assert.equal(reply.status, 'ok');
      collected += reply.record.content;
      if (reply.truncated) { assert.ok(reply.nextOffset > offset); offset = reply.nextOffset; }
    } while (reply.truncated);
    assert.equal(collected, record.content); assert.equal(sha(collected), reply.record.contentSha256);
    assert.deepEqual(reply.record.source, record.source);
  }
  for (const id of ['missing', '../AGENTS.md', 'https://example.test', '__proto__']) assert.equal((await rpc('pulse.read', { id })).status, 'unknown-id');
  assert.equal((await rpc('pulse.read', { id: 'node/javascript', provider: 'node', target: 'native' })).status, 'unsupported-selection');
  assert.equal((await rpc('pulse.read', { id: 'schema/registry', offset: -1 })).status, 'invalid-input');
  for (const id of ['01-hello-json', '02-request-schema', '03-fetch-composition', '09-router-lowering']) {
    let offset = 0, all = [], reply;
    do { reply = await rpc('pulse.example', { id, offset }); assert.equal(reply.status, 'ok');
      assert.ok(reply.records.length <= 5); all.push(...reply.records); offset = reply.nextOffset;
    } while (reply.truncated);
    assert.deepEqual(all.map(record => record.id), reply.availableIds);
    const configId = `example/${id}/.pulse/config.ts`;
    const single = await rpc('pulse.example', { id, files: [configId] }); assert.equal(single.records.length, 1); assert.equal(single.records[0].id, configId);
    assert.equal((await rpc('pulse.example', { id, files: ['../AGENTS.md'] })).status, 'unknown-id');
    assert.equal((await rpc('pulse.example', { id, provider: 'node', target: 'javascript' })).status, 'unsupported-selection');
  }
  assert.equal((await rpc('pulse.example', { id: 'constructor' })).status, 'unknown-example');
  for (const record of contextCorpus.records.filter(record => record.category === 'diagnostic')) {
    const reply = await rpc('pulse.explain_diagnostic', { code: record.id.slice('diagnostic/'.length) }); assert.equal(reply.status, 'ok');
    assert.ok(reply.explanation.summary); assert.ok(reply.explanation.remediation.length > 0);
    assert.equal(reply.explanation.summaryAvailable, typeof JSON.parse(record.content).summary === 'string');
    assert.ok(reply.explanation.nextLocalChecks.every(step => step.sourceId === 'command/doctor'));
  }
  assert.equal((await rpc('pulse.explain_diagnostic', { code: 'PULSE_UNKNOWN' })).status, 'unknown-code');
  for (const [method, params] of [['pulse.start', { goal: 'json-api', provider: 'node', target: 'native' }], ['pulse.search', { query: 'schema' }], ['pulse.read', { id: 'schema/registry' }], ['pulse.example', { id: '01-hello-json' }], ['pulse.explain_diagnostic', { code: 'PULSE_SCHEMA_COMPILE_FAILED' }]]) {
    assert.equal((await rpc(method, { ...params, version: 'latest' })).status, 'version-mismatch');
    assert.equal((await rpc(method, { ...params, version: 'x'.repeat(100) })).status, 'invalid-input');
  }
  const mcp = createMcpHttpHandler({ limits: { maxResponseBytes: 131072 }, tools: { catalog, schemas,
    routerId: catalog.routers[0].id, target: 'node-javascript', endpoint } });
  async function tool(method, params) {
    const response = await mcp.fetch(new Request('http://localhost/mcp', { method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL_VERSION,
      'mcp-method': method, ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'context-test', method, params: { ...params, _meta: {
      'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION, 'io.modelcontextprotocol/clientCapabilities': {},
    } } }) }));
    const text = await response.text(); assert.ok(Buffer.byteLength(text) < 131072); assert.equal(response.status, 200, text);
    const reply = JSON.parse(text); assert.equal(reply.error, undefined, text); return reply.result;
  }
  const listed = await tool('tools/list', {}); assert.deepEqual(listed.tools.map(tool => tool.name), names);
  assert.ok(listed.tools.every(tool => tool.annotations.readOnlyHint && tool.annotations.idempotentHint && !tool.annotations.openWorldHint));
  for (const [name, args] of [['pulse.start', { goal: 'schema-api', provider: 'node', target: 'javascript' }], ['pulse.search', { query: 'schema' }], ['pulse.read', { id: 'schema/registry' }], ['pulse.example', { id: '01-hello-json' }], ['pulse.explain_diagnostic', { code: 'PULSE_SCHEMA_COMPILE_FAILED' }]]) {
    const reply = await tool('tools/call', { name, arguments: { version, ...args } });
    assert.equal(reply.structuredContent.status, 'ok'); assert.deepEqual(JSON.parse(reply.content[0].text), reply.structuredContent);
  }
  const rejected = await tool('tools/call', { name: 'pulse.search', arguments: { version, query: 42 } }); assert.equal(rejected.isError, true);
  console.log(`ok - five schema-bound context operations; ${calls} real app calls; largest reply ${largest} bytes; emitted catalog/MCP projection, Native rejection and source-independent build execution`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (launcher) await launcher.close(); fs.rmSync(temp, { recursive: true, force: true });
});
