#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { run, parseJson } = require('../cli/helpers.cjs');
const { createConditionalKvAuthority } = require('../../../packages/provider-fastly/src/testing/conditional-kv-host.js');
const { executeFastlyNativePlatformCapabilities: executeWasm } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const { inspectFastlyComputeLauncher, renderFastlyLocalConfig, requestFastlyCompute, startFastlyComputeServe } = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const root = path.resolve(__dirname, '../../..');
const temporaryRoot = path.join(root, 'wasm/.test-results');
fs.mkdirSync(temporaryRoot, { recursive: true });
const project = fs.mkdtempSync(path.join(temporaryRoot, 'entities-fastly-native-'));
const example = path.join(root, 'examples/10-entities-tools');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const request = body => ({ method: 'POST', path: '/', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
const lookup = { jsonrpc: '2.0', method: 'customer.lookup', params: { email: 'ada@example.test' }, id: 'native-lookup' };
const fixtures = { 'https://directory.example.test/customers/ada@example.test': { text: 'Ada Lovelace' } };
const out = path.join(project, 'dist-fastly-native');
const readArtifact = () => ({ wasm: fs.readFileSync(path.join(out, 'bin/main.wasm')), plan: JSON.parse(fs.readFileSync(path.join(out, 'fastly-native-plan.json'), 'utf8')) });

async function liveDev() {
  const child = spawn(process.execPath, [path.join(root, 'wasm/scripts/pulse.cjs'), 'dev', '--profile', 'fastly-native', '--port', '0', '--once', '--json'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', sent = false, response;
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Entities dev timed out: ${stderr}`)); }, 45000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve(code); });
  });
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => {
    stdout += data;
    for (const line of stdout.split('\n')) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (sent || event.event !== 'ready') continue;
      sent = true;
      response = fetch(event.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'system.status', id: 'dev-native' }), signal: AbortSignal.timeout(5000) })
        .then(async result => ({ status: result.status, body: await result.json() }))
        .catch(error => ({ error }));
    }
  });
  try {
    assert.equal(await exited, 0, stderr);
    assert.ok(sent, stdout);
    assert.deepEqual(await response, { status: 200, body: { jsonrpc: '2.0', result: null, id: 'dev-native' } });
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
}

async function replay(artifact) {
  if (!process.env.PULSE_VICEROY_BIN) {
    console.log('skip - exact-artifact Viceroy replay requires PULSE_VICEROY_BIN; fixture ABI is not provider reality');
    return;
  }
  const launcher = inspectFastlyComputeLauncher({ viceroyBinary: process.env.PULSE_VICEROY_BIN, required: true });
  const origin = http.createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ email: 'ada@example.test', displayName: 'Ada' })); });
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
  let server;
  const wasmFile = path.join(out, 'bin/main.wasm');
  const manifestFile = path.join(out, 'fastly.toml');
  fs.writeFileSync(manifestFile, renderFastlyLocalConfig({ name: 'entities-ordinary-native',
    backends: { directory_backend: { url: `http://127.0.0.1:${origin.address().port}`, useSni: false } },
    configStores: { pulse_config: { MODE: 'group' } }, secretStores: { pulse_secrets: { TOKEN: 'en03-private-token' } }
  }));
  try {
    server = await startFastlyComputeServe({ launcher, packageRoot: out, wasmFile, manifestFile, startTimeoutMs: 60000, stopTimeoutMs: 5000 });
    for (const [body, expected] of [[lookup, { jsonrpc: '2.0', result: { email: 'ada@example.test', displayName: 'group:Ada' }, id: 'native-lookup' }], ['{', { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }]]) {
      const response = await requestFastlyCompute(server, { ...request(body), timeoutMs: 30000 });
      assert.equal(response.status, 200); assert.deepEqual(JSON.parse(response.body), expected);
    }
    const notification = await requestFastlyCompute(server, { ...request({ ...lookup, id: undefined }), timeoutMs: 30000 });
    assert.equal(notification.status, 204); assert.equal(notification.body.length, 0);
    assert.equal(digest(fs.readFileSync(wasmFile)), digest(artifact.wasm));
    assert.ok(!JSON.stringify(server.logs).includes('en03-private-token'));
    console.log(`ok - local ${launcher.kind} ${launcher.inspection.version} replays ordinary bin/main.wasm ${digest(artifact.wasm)}; no live deployment claimed`);
  } finally { if (server) await server.stop(); await new Promise(resolve => origin.close(resolve)); }
}

async function main() {
  try {
    fs.cpSync(example, project, { recursive: true, filter: file => !path.relative(example, file).split(path.sep).some(part => part === 'node_modules' || part.startsWith('dist') || part.startsWith('.pulse-')) });
    const configPath = path.join(project, '.pulse/config.ts');
    fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace(/  'fastly-native': \{[\s\S]*?\n  \},/, `  'fastly-native': {
    host: 'fastly', target: 'native', outDir: 'dist-fastly-native', dev: { networkFetch: false },
    fastly: { maxDurationMs: 10000, bindings: { configStore: 'pulse_config', secretStore: 'pulse_secrets', kv: { catalog: 'pulse_catalog' }, backends: { 'https://directory.example.test': 'directory_backend' }, dynamicBackends: false } },
  },
`));
    const doctor = parseJson(run(['doctor', '--profile', 'fastly-native', '--json'], project));
    assert.equal(doctor.status, 'passed');
    const inspection = parseJson(run(['inspect', '--profile', 'fastly-native', '--json'], project));
    assert.equal(inspection.status, 'ok');
    assert.equal(parseJson(run(['build', '--profile', 'fastly-native', '--json'], project)).status, 'built');
    const native = readArtifact();
    const wasmHash = digest(native.wasm);
    const module = new WebAssembly.Module(native.wasm);
    assert.ok(WebAssembly.Module.imports(module).every(entry => !/^(env|pulse_host|pulse_entities_host)$|javascript|js-compute/.test(entry.module)));
    for (const name of ['_start', 'pulse_package_set_effect_failure', 'pulse_plan_hash_ptr']) assert.ok(WebAssembly.Module.exports(module).some(entry => entry.name === name));
    assert.equal(native.plan.packages.application.contractId, 'pulse.entities');
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'fastly-native-manifest.json')));
    assert.equal(manifest.wasm.sha256, wasmHash);
    assert.equal(manifest.planHash, native.plan.planHash);
    for (const file of ['entities-catalog.json', 'entities-inspection.json', 'src/main.as.ts']) assert.ok(fs.existsSync(path.join(out, file)));
    const tests = parseJson(run(['test', '--profile', 'fastly-native', '--json'], project));
    assert.deepEqual(tests.summary, { total: 2, passed: 2, failed: 0 });
    for (const entry of tests.cases) {
      assert.equal(entry.executionEvidence.kind, 'fastly-native-fixture-abi');
      assert.equal(entry.executionEvidence.wasmSha256, wasmHash);
      assert.equal(entry.executionEvidence.providerRealityValidated, false);
    }
    const execute = (body, options = {}) => executeWasm(native, { request: request(body), fixtures, ...options });
    const success = execute(lookup);
    assert.deepEqual(JSON.parse(success.response.body), { jsonrpc: '2.0', result: { email: 'ada@example.test', displayName: 'Ada Lovelace' }, id: 'native-lookup' });
    assert.equal(success.outboundRequests.length, 1);
    for (const [body, code] of [['{', -32700], [{ ...lookup, method: 'unknown', params: {} }, -32601], [{ ...lookup, params: {} }, -32602]]) {
      const result = execute(body);
      assert.equal(JSON.parse(result.response.body).error.code, code); assert.equal(result.outboundRequests.length, 0);
    }
    const notification = execute({ ...lookup, id: undefined });
    assert.equal(notification.response.status, 204); assert.equal(notification.response.body, ''); assert.equal(notification.outboundRequests.length, 1);
    for (const fixture of [undefined, { sendStatus: 1 }, { transportStatus: 1 }, { text: 'x'.repeat(1024 * 1024) }]) {
      const result = execute(lookup, { fixtures: fixture ? { [Object.keys(fixtures)[0]]: fixture } : {} });
      assert.deepEqual(JSON.parse(result.response.body), { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: 'native-lookup' });
    }
    assert.equal(execute(lookup, { hostcallDelayMs: { 'fastly_http_req.send_async': 10000 } }).response.status, 504);
    assert.equal(execute(Buffer.from([0xff])).response.status, 400);
    assert.equal(execute('x'.repeat(1024 * 1024)).response.status, 413);
    success.instance.exports._start();
    assert.equal(success.instance.exports.pulse_fastly_last_error(), 1007);
    await liveDev();

    fs.writeFileSync(path.join(project, 'src/handlers.ts'), `
export async function systemStatus(_ctx: unknown, _input: undefined) { return undefined }
export async function lookupCustomer(ctx: any, input: Readonly<{ email: string }>) {
  const values = await ctx.parallel({ mode: ctx.config.get('MODE'), token: ctx.secret.get('TOKEN') })
  const customer = await ctx.fetch('https://directory.example.test/json').json('tools.CustomerLookupOutput')
  ctx.log.info(values.token)
  return { email: input.email, displayName: values.mode + ':' + customer.displayName }
}
`);
    assert.equal(parseJson(run(['build', '--profile', 'fastly-native', '--json'], project)).status, 'built');
    const grouped = readArtifact();
    const options = { request: request(lookup), configStore: 'pulse_config', config: { MODE: 'group' }, secretStore: 'pulse_secrets', secrets: { TOKEN: 'en03-private-token' },
      fixtures: { 'https://directory.example.test/json': { body: JSON.stringify({ email: 'ada@example.test', displayName: 'Ada' }) } } };
    const result = executeWasm(grouped, options);
    assert.deepEqual(JSON.parse(result.response.body), { jsonrpc: '2.0', result: { email: 'ada@example.test', displayName: 'group:Ada' }, id: 'native-lookup' });
    assert.ok(result.logs.length > 0);
    assert.ok(!JSON.stringify(result).includes('en03-private-token'));
    assert.ok(!grouped.wasm.includes(Buffer.from('en03-private-token')));
    const malformed = executeWasm(grouped, { ...options, fixtures: { 'https://directory.example.test/json': { body: '{' } } });
    assert.equal(JSON.parse(malformed.response.body).error.code, -32603);
    await replay(grouped);
    fs.writeFileSync(path.join(project, 'src/handlers.ts'), `
export async function systemStatus(_ctx: unknown, _input: undefined) { return undefined }
export async function lookupCustomer(ctx: any, input: Readonly<{ email: string }>) {
  const names = await ctx.parallel({ first: ctx.fetch('https://directory.example.test/first').text(), second: ctx.fetch('https://directory.example.test/second').text() })
  return { email: input.email, displayName: names.first + names.second }
}
`);
    assert.equal(parseJson(run(['build', '--profile', 'fastly-native', '--json'], project)).status, 'built');
    const parallel = readArtifact();
    for (const failAtBegin of [true, false]) {
      const drained = executeWasm(parallel, { request: request(lookup), fixtures: {
        ...(failAtBegin ? {} : { 'https://directory.example.test/first': { transportStatus: 1 } }),
        'https://directory.example.test/second': { text: 'second' }
      } });
      assert.equal(JSON.parse(drained.response.body).error.code, -32603);
      const calls = drained.trace.filter(event => event.module === 'fastly_http_req');
      assert.equal(calls.filter(event => event.name === 'send_async').length, 2);
      assert.equal(calls.filter(event => event.name === 'pending_req_wait').length, failAtBegin ? 1 : 2);
      assert.equal(drained.instance.exports.pulse_entities_pending_count(), 0);
      assert.equal(drained.instance.exports.pulse_fastly_last_error(), 0);
    }
    fs.writeFileSync(path.join(project, 'src/handlers.ts'), `
export async function systemStatus(_ctx: unknown, _input: undefined) { return undefined }
export async function lookupCustomer(ctx: any, input: Readonly<{ email: string }>) {
  await ctx.kv('catalog').put('name', 'Stored Ada')
  const name = await ctx.kv('catalog').get('name')
  const now = await ctx.time.now()
  return { email: input.email, displayName: name }
}
`);
    assert.equal(parseJson(run(['build', '--profile', 'fastly-native', '--json'], project)).status, 'built');
    const stores = readArtifact();
    assert.deepEqual(stores.plan.effects.map(effect => effect.kind), ['kv.put', 'kv.get', 'time.now']);
    const authority = createConditionalKvAuthority();
    authority.stores.set('pulse_catalog', new Map());
    const stored = executeWasm(stores, { request: request(lookup), conditionalKv: { authority } });
    assert.deepEqual(JSON.parse(stored.response.body).result, { email: 'ada@example.test', displayName: 'Stored Ada' });
    // Restore the fetch source before testing its required backend binding.
    fs.copyFileSync(path.join(example, 'src/handlers.ts'), path.join(project, 'src/handlers.ts'));
    const brokenConfig = fs.readFileSync(configPath, 'utf8').replaceAll("'https://directory.example.test': 'directory_backend'", '');
    fs.writeFileSync(configPath, brokenConfig);
    const missingBinding = run(['build', '--profile', 'fastly-native', '--json'], project);
    assert.notEqual(missingBinding.status, 0);
    assert.match(missingBinding.stderr + missingBinding.stdout, /backend/i);
    console.log(`ok - ordinary Fastly Native Entities doctor/inspect/build/test/dev, exact guest ${wasmHash}, admission, framing, deadlines and redaction`);
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
