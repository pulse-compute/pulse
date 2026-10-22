#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { compileProject, prepareJavascriptApplication } = require('../../packages/cli/src/project-execution.js');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const { executeNodeJavascriptApplication } = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const { createCanonicalSchemaCodecs } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const root = path.resolve(__dirname, '../../..');
const fixture = path.join(root, 'wasm/test/fixtures/projects/mcp-native');
const prefix = 'io.modelcontextprotocol/';
const meta = () => ({ [prefix + 'protocolVersion']: '2026-07-28', [prefix + 'clientCapabilities']: {} });
const rpc = (method = 'server/discover', id = 1, params = {}) => ({ jsonrpc: '2.0', method, id, params: { _meta: meta(), ...params } });
const headers = method => ({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': method });
async function main() {
  for (const profile of ['node-native','fastly-native']) {
    const result = spawnSync(process.execPath, [path.join(root, 'wasm/scripts/pulse.cjs'), 'build', '--profile', profile, '--json'], { cwd: fixture, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  const dir = path.join(fixture, 'dist-node-native');
  const native = { wasm: fs.readFileSync(path.join(dir, 'canonical-native.wasm')), plan: JSON.parse(fs.readFileSync(path.join(dir, 'canonical-native-plan.json'))) };
  const fastlyFile = path.join(fixture, 'dist-fastly-native/bin/main.wasm');
  const fastly = fs.readFileSync(fastlyFile);
  const project = resolveProject({ cwd: fixture, env: { PULSE_PROFILE: 'node-javascript' } });
  const compiled = compileProject(project);
  const loaded = prepareJavascriptApplication(project, { schemaBundle: compiled.schema.bundle, allowedPackages: { '@pulse-compute/mcp/pulse': require('../../../packages/mcp/src/pulse.js') } });
  assert.ok(loaded.loaded, 'original JavaScript application loads');
  assert.equal(native.plan.packages.application.contractId, 'pulse.mcp');
  assert.equal(native.plan.packages.application.automaticFallback, false);
  assert.equal(native.plan.packages.application.version, 'pulse.package-native-application.v2');
  assert.ok(WebAssembly.Module.imports(new WebAssembly.Module(native.wasm)).some(i => i.module === 'pulse_host' && i.name === 'package_http_version'));
  assert.ok(!native.plan.packages.application.source.includes('not-selected'));
  const builder = require('../../../packages/mcp/pulsewasm.compiler.cjs').createMcpPackageCompilerBuilder;
  const sourcePath = path.join(fixture, 'src/index.ts'), sourceText = fs.readFileSync(sourcePath, 'utf8');
  const build = text => builder({ sourceText: text, sourcePath, cwd: fixture, schemaBundle: compiled.schema.bundle });
  const facade = require('../../../packages/mcp/src/pulse.js');
  const sealed = new facade.EntityRouter({ adapter: facade.jsonRpc() });
  facade.mcp({ router: sealed });
  assert.throws(() => sealed.on('late', { input: null, output: null }, async () => {}), { code: 'PULSE_ENTITIES_REGISTRY_SEALED' });
  assert.throws(() => facade.mcp({ router: sealed }), { code: 'PULSE_ENTITIES_REGISTRY_SEALED' });
  const facts = build(sourceText);
  assert.deepEqual(build(sourceText), facts, 'package recognition is deterministic');
  assert.equal(facts.managedHandlers.length, 5);
  assert.ok(!JSON.stringify(facts.managedHandlers).includes('unreachable'));
  for (const changed of [
    sourceText.replace('router: rpc,', 'router: rpc, backendUrl: "https://private.test",'),
    sourceText.replace('router: rpc,', 'router: rpc, allowedOrigins: ["https://browser.test"],'),
    sourceText.replace('router: rpc,', 'router: rpc, limits: { deadlineMs: 5001 },'),
    sourceText.replace('router: rpc,', 'router: rpc, authorization: {},'),
    sourceText.replace('router: rpc,', 'router: unknownRouter,'),
    sourceText.replace('return server.handle(ctx as never)', 'const response = server.handle(ctx as never); return response'),
    sourceText.replace('return server.handle(ctx as never)', 'return server["handle"](ctx as never)'),
    sourceText.replace('const server = mcp({', 'const options = {}; const server = mcp(options, {'),
    sourceText.replace('return server.handle(ctx as never)', 'console.log(1); return server.handle(ctx as never)'),
    sourceText.replace('export default async function handler', 'async function hidden') + '\nexport default async function handler(ctx) { return ctx.text(\'other\') }'
  ]) {
    let rejected = false;
    try { rejected = build(changed).hasErrors; } catch (error) { assert.equal(error.code, 'PULSE_MCP_STATIC_BINDING_REQUIRED'); rejected = true; }
    assert.ok(rejected, 'invalid binding fails closed');
  }
  const schemas = createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
  const fetches = { 'https://directory.example.test/customers/ada@example.test': { text: 'Ada Lovelace' } };
  let cases = 0;
  const observations = [];
  async function exchange(message, change = {}) {
    const body = typeof message === 'string' ? message : JSON.stringify(message);
    const h = { ...headers(message?.method || 'server/discover'), ...change.headers };
    for (const key of Object.keys(h)) if (h[key] === undefined) delete h[key];
    const request = { method: 'POST', path: '/mcp', body, ...change, headers: h };
    const nr = await executeCanonicalNativeModule(native, { request, fetches, maxDurationMs: 5000, providerAdapter: createNodeProviderAdapter({ fetches }) });
    const jr = await executeNodeJavascriptApplication(loaded.loaded.application,
      new Request('https://mcp.test' + request.path, { method: request.method, headers: h, ...(['GET','HEAD'].includes(request.method) ? {} : { body }) }),
      { schemaCodecs: schemas, strict: true, maxDurationMs: 5000, fetchImplementation: async url => { assert.ok(fetches[String(url)]); return new Response(fetches[String(url)].text); } });
    const normalize = response => {
      const headers = new Headers(response.headers);
      assert.equal(headers.get('cache-control'), 'no-store');
      assert.equal(headers.has('access-control-allow-origin'), false);
      assert.equal(headers.has('mcp-session-id'), false);
      return { status: response.status, body: response.body ? JSON.parse(response.body) : null,
        contentType: headers.get('content-type'), allow: headers.get('allow') };
    };
    const expected = normalize({ status: jr.status, body: await jr.text(), headers: jr.headers });
    assert.equal(nr.effectCount, expected.status === 200 && message?.method === 'tools/call' && message?.params?.name === 'customer.lookup' && expected.body.result?.isError === false ? 1 : 0, 'admission and local tools do not create backend dispatch');
    assert.deepEqual(normalize(nr.response), expected, 'Node Native: ' + JSON.stringify({ message, change }).slice(0, 400));
    if (fastly) {
      const fr = executeFastlyNativePlatformCapabilities(fastly, { request,
        fixtures: { 'directory_backend GET https://directory.example.test/customers/ada@example.test': { status: 200, body: 'Ada Lovelace' } } });
      assert.deepEqual(normalize(fr.response), expected, 'Fastly Native: ' + JSON.stringify({ message, change }).slice(0, 400));
      if (expected.status !== 200 || message?.method !== 'tools/call' || message?.params?.name !== 'customer.lookup') assert.equal(fr.trace.filter(e => e.name === 'send_async').length, 0);
    }
    observations.push({ status: expected.status, code: expected.body?.error?.code }); cases++;
    return expected;
  }
  assert.equal((await exchange(rpc())).status, 200);
  const list = await exchange(rpc('tools/list'));
  assert.deepEqual(list.body.result.tools.map(t => t.name), ['customer.lookup','echo','invalid.output','local.result','system.status']);
  for (const name of ['system.status', 'customer.lookup']) {
    const r = await exchange(rpc('tools/call', 'call', { name, arguments: name === 'customer.lookup' ? { email: 'ada@example.test' } : {} }), { headers: { 'mcp-name': name } });
    assert.equal(r.body.result.isError, false);
    if (r.body.result.structuredContent) assert.deepEqual(JSON.parse(r.body.result.content[0].text), r.body.result.structuredContent);
  }
  await exchange(rpc('tools/call', 0, { name: 'customer.lookup', arguments: {} }), { headers: { 'mcp-name': 'customer.lookup' } });
  for (const email of ['雪', 'quote"\\\n', '\u0000', '\ud800', 'x'.repeat(13000)]) {
    await exchange(rpc('tools/call', 'echo', { name: 'echo', arguments: { email } }), { headers: { 'mcp-name': 'echo' } });
  }
  assert.equal((await exchange(rpc('tools/call', 'invalid', { name: 'invalid.output' }), { headers: { 'mcp-name': 'invalid.output' } })).body.result.isError, true);
  await exchange(rpc('tools/call', 'local', { name: 'local.result' }), { headers: { 'mcp-name': 'local.result' } });
  for (const id of ['',  '雪', 'quote"\\\n', -1, 9007199254740991, null, true, {}, [], 1.5, 9007199254740992]) await exchange(rpc('server/discover', id));
  await exchange(rpc('server/discover', 'x'.repeat(32000)));
  await exchange(rpc('unknown', 'x'.repeat(32000)));
  for (const method of ['unknown','ping','initialize','resources/list','prompts/list','__proto__']) await exchange(rpc(method));
  for (const message of [null, [], [rpc()], 1, '"text"', '{', '{"a":1,}', { ...rpc(), jsonrpc: '1.0' }, { ...rpc(), result: {} }, { ...rpc(), params: [] }, { ...rpc(), method: 1 }]) await exchange(message);
  for (const method of ['tools/call','unknown','notifications/initialized']) await exchange({ jsonrpc: '2.0', method });
  for (const h of [{origin:'null'}, {origin:'https://example.test'}, {accept:'*/*'}, {accept:'application/json'}, {accept:'application/json;q=0,text/event-stream'}, {'content-type':'text/plain'}, {'content-type':'application/json, application/json'}, {'content-encoding':'gzip'}, {'content-length':'x'}, {'content-length':'32769'}, {'mcp-method':'other'}, {'mcp-protocol-version':'bad'}]) await exchange(rpc(), { headers: h });
  for (const headers of [{ 'Content-Type': 'application/json' }, { 'Mcp-Method': 'server/discover' }, { 'Mcp-Protocol-Version': '2026-07-28' }, { 'content-length': '1', 'Content-Length': '1' }, { origin: 'null', Origin: 'null' }]) await exchange(rpc(), { headers });
  for (const method of ['GET','DELETE','OPTIONS']) await exchange(rpc(), { method });
  await exchange(rpc(), { path: '/mcp/' });
  await exchange(' '.repeat(32769));
  await exchange('{"a":'.repeat(33) + '0' + '}'.repeat(33));
  for (const params of [{}, { _meta: {} }, { _meta: { ...meta(), [prefix + 'clientCapabilities']: [] } }, { _meta: { ...meta(), [prefix + 'clientInfo']: { name: 'x' } } }, { _meta: meta(), extra: 1 }]) await exchange({ ...rpc(), params });
  for (const name of ['unknown','雪',' padded ']) await exchange(rpc('tools/call', 1, { name }), { headers: { 'mcp-name':'=?base64?' + Buffer.from(name).toString('base64') + '?=' } });
  for (const nameHeader of ['wrong','=?base64?Zh==?=','=?base64?/w==?=']) await exchange(rpc('tools/call', 1, { name:'system.status' }), { headers:{'mcp-name':nameHeader} });
  const legacyHeaders = { 'mcp-method': undefined, 'mcp-protocol-version': '2025-06-18' };
  for (const method of ['ping','tools/list']) await exchange({ jsonrpc:'2.0', id:1, method }, { headers:legacyHeaders });
  await exchange({ jsonrpc:'2.0', id:'init', method:'initialize', params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}} }, { headers:{...legacyHeaders,'mcp-protocol-version':undefined} });
  await exchange(rpc('tools/list'), { headers:legacyHeaders });
  const longId = 'deadline-' + 'x'.repeat(30000);
  const delayedMessage = rpc('tools/call', longId, { name: 'customer.lookup', arguments: { email: 'ada@example.test' } });
  const delayedRequest = { method: 'POST', path: '/mcp', headers: { ...headers('tools/call'), 'mcp-name': 'customer.lookup' }, body: JSON.stringify(delayedMessage) };
  const delayedFetches = { 'https://directory.example.test/customers/ada@example.test': { text: 'late', delayMs: 300 } };
  const nodeTimeout = await executeCanonicalNativeModule(native, { request: delayedRequest, maxDurationMs: 100, providerAdapter: createNodeProviderAdapter({ fetches: delayedFetches }) });
  assert.equal(nodeTimeout.response.status, 408);
  assert.equal(nodeTimeout.status, 'completed');
  assert.equal(nodeTimeout.version, require('../../packages/contracts/src/handler/canonical-native-runtime.js').CANONICAL_NATIVE_HOST_VERSION);
  assert.equal(nodeTimeout.providerVersion, createNodeProviderAdapter({}).version);
  assert.ok(nodeTimeout.providerMetadata);
  assert.ok(Object.isFrozen(nodeTimeout.continuations));
  assert.ok(nodeTimeout.continuations.every(entry => Object.isFrozen(entry) && Object.isFrozen(entry.states)));
  assert.equal(JSON.parse(nodeTimeout.response.body).id, longId);
  const jsTimeout = await executeNodeJavascriptApplication(loaded.loaded.application, new Request('https://mcp.test/mcp', { method: 'POST', headers: delayedRequest.headers, body: delayedRequest.body }), {
    schemaCodecs: schemas, strict: true, maxDurationMs: 100,
    fetchImplementation: async () => { await new Promise(resolve => setTimeout(resolve, 300)); return new Response('late'); }
  });
  assert.equal(jsTimeout.status, 408);
  assert.equal((await jsTimeout.json()).id, longId);
  if (fastly) {
    const effectTimeout = executeFastlyNativePlatformCapabilities(fastly, { request: delayedRequest, fixtures: {
      'directory_backend GET https://directory.example.test/customers/ada@example.test': { status: 200, body: 'late', delayMs: 6000 }
    } });
    assert.equal(effectTimeout.response.status, 408);
    assert.equal(JSON.parse(effectTimeout.response.body).id, longId);
    const interrupted = executeFastlyNativePlatformCapabilities(fastly, { request: { method: 'POST', path: '/mcp', headers: headers('server/discover'), body: JSON.stringify(rpc()), readyDelayMs: 6000 } });
    assert.equal(interrupted.response.status, 408);
    assert.equal(JSON.parse(interrupted.response.body).error.message, 'Request interrupted');
    const invalidUtf8 = executeFastlyNativePlatformCapabilities(fastly, { request: { method: 'POST', path: '/mcp', headers: headers('server/discover'), body: Buffer.from([0xff]) } });
    assert.equal(invalidUtf8.response.status, 400);
    assert.equal(JSON.parse(invalidUtf8.response.body).error.code, -32700);
    for (const duplicate of ['content-type','mcp-method','mcp-protocol-version','content-length','origin']) {
      const pairs = Object.entries(headers('server/discover')).filter(([key]) => key !== duplicate);
      pairs.push([duplicate, duplicate === 'content-length' ? '1' : (headers('server/discover')[duplicate] || 'null')]);
      pairs.push([duplicate.toUpperCase(), pairs.at(-1)[1]]);
      const result = executeFastlyNativePlatformCapabilities(fastly, { request: { method: 'POST', path: '/mcp', headers: pairs, body: JSON.stringify(rpc()) } });
      assert.equal(result.response.status, duplicate === 'origin' ? 403 : duplicate === 'content-type' ? 415 : 400, duplicate);
    }
  }
  console.log(JSON.stringify({ status:'passed', cases, targets: fastly ? ['node-javascript','node-native','fastly-native-injected-abi'] : ['node-javascript','node-native'], observations, node: process.version, planHash: native.plan.planHash, nodeWasmSha256: require('node:crypto').createHash('sha256').update(native.wasm).digest('hex'), fastlyWasmSha256: require('node:crypto').createHash('sha256').update(fastly).digest('hex'), staticNegativeCases: 10, terminalAndHeaderCases: 10 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
