#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { run, parseJson } = require('../cli/helpers.cjs');
const { executeCanonicalNativeModule, instantiateCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const { validateCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { CANONICAL_NATIVE_VALUE_TRANSFER_MAX_BYTES } = require('../../packages/contracts/src/handler/canonical-native-runtime.js');
const { validateLowerableLibraryManifest } = require('../../packages/contracts/src/library/manifest.js');
const { stableStringify } = require('../../packages/contracts/src/stable-id.js');

const root = path.resolve(__dirname, '../../..');
const temporaryRoot = path.join(root, 'wasm/.test-results');
fs.mkdirSync(temporaryRoot, { recursive: true });
const project = fs.mkdtempSync(path.join(temporaryRoot, 'entities-node-native-'));
const example = path.join(root, 'examples/10-entities-tools');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const request = body => ({ method: 'POST', path: '/', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const lookup = { jsonrpc: '2.0', method: 'customer.lookup', params: { email: 'ada@example.test' }, id: 'native-lookup' };
const fixtures = { 'https://directory.example.test/customers/ada@example.test': { text: 'Ada Lovelace' } };

async function liveDev() {
  const child = spawn(process.execPath, [path.join(root, 'wasm/scripts/pulse.cjs'), 'dev', '--profile', 'node-native', '--port', '0', '--once', '--json'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function main() {
  try {
    fs.cpSync(example, project, { recursive: true, filter: file => !path.relative(example, file).split(path.sep).some(part => part === 'node_modules' || part.startsWith('dist') || part.startsWith('.pulse-')) });
    const doctor = parseJson(run(['doctor', '--profile', 'node-native', '--json'], project));
    assert.equal(doctor.status, 'passed');
    assert.equal(doctor.summary.failed, 0);
    const build = parseJson(run(['build', '--profile', 'node-native', '--json'], project));
    assert.equal(build.status, 'built');
    const out = path.join(project, 'dist-node-native');
    const native = { wasm: fs.readFileSync(path.join(out, 'canonical-native.wasm')), plan: JSON.parse(fs.readFileSync(path.join(out, 'canonical-native-plan.json'), 'utf8')) };
    const wasmHash = digest(native.wasm);
    const module = new WebAssembly.Module(native.wasm);
    assert.ok(WebAssembly.Module.imports(module).every(entry => ['pulse_host', 'env'].includes(entry.module)));
    assert.ok(WebAssembly.Module.exports(module).some(entry => entry.name === 'pulse_package_set_effect_failure'));
    assert.equal(native.plan.packages.application.contractId, 'pulse.entities');
    assert.equal(native.plan.effects.length, 1);
    for (const file of ['entities-catalog.json', 'entities-inspection.json']) assert.ok(fs.existsSync(path.join(out, file)));

    const tests = parseJson(run(['test', '--profile', 'node-native', '--json'], project));
    assert.deepEqual(tests.summary, { total: 2, passed: 2, failed: 0 });
    for (const entry of tests.cases) assert.deepEqual(entry.executionEvidence, { mode: 'native-wasm', planHash: native.plan.planHash, wasmSha256: wasmHash, automaticFallback: false });

    async function execute(body, options = {}) {
      const values = { request: request(body), fetches: fixtures, ...options };
      const result = await executeCanonicalNativeModule(native, { ...values, providerAdapter: createNodeProviderAdapter(values) });
      assert.equal(result.wasmSha256, wasmHash);
      return result;
    }
    const success = await execute(lookup);
    assert.deepEqual(JSON.parse(success.response.body), { jsonrpc: '2.0', result: { email: 'ada@example.test', displayName: 'Ada Lovelace' }, id: 'native-lookup' });
    assert.equal(success.effectCount, 1);
    assert.equal(success.continuations[0].state, 'completed');
    for (const [body, code] of [
      ['{', -32700],
      [{ ...lookup, method: 'unknown', params: {} }, -32601],
      [{ ...lookup, params: {} }, -32602]
    ]) {
      const rejected = await execute(body);
      assert.equal(JSON.parse(rejected.response.body).error.code, code);
      assert.equal(rejected.effectCount, 0);
    }
    const notification = await execute({ ...lookup, id: undefined });
    assert.equal(notification.response.status, 204);
    assert.equal(notification.response.body, '');
    assert.equal(notification.effectCount, 1);
    await assert.rejects(execute(lookup, { signal: AbortSignal.abort() }), { name: 'AbortError' });
    const oversized = await execute(lookup, { fetches: { [Object.keys(fixtures)[0]]: { text: 'x'.repeat(CANONICAL_NATIVE_VALUE_TRANSFER_MAX_BYTES) } } });
    assert.equal(JSON.parse(oversized.response.body).error.code, -32603);
    const missingBackend = await execute(lookup, { fetches: {} });
    assert.deepEqual(JSON.parse(missingBackend.response.body), { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: 'native-lookup' });

    const controller = instantiateCanonicalNativeModule(native, { request: request(lookup), providerAdapter: createNodeProviderAdapter({ fetches: fixtures }) });
    try {
      assert.equal(controller.start(), 1);
      const pc = controller.programCounter();
      assert.equal(controller.resume(), -2);
      assert.equal(controller.programCounter(), pc);
      const pending = controller.pendingEffects();
      assert.equal(pending.length, 1);
      controller.setEffectResult(pending[0].ticket, 'Ada Lovelace');
      assert.equal(controller.resume(), 0);
      assert.throws(() => controller.setEffectResult(pending[0].ticket, 'second result'));
    } finally { controller.close(); }

    const bounded = instantiateCanonicalNativeModule(native, { request: request(lookup) });
    try {
      assert.equal(bounded.start(), 1);
      assert.throws(() => bounded.setEffectResult(bounded.pendingEffects()[0].ticket, 'x'.repeat(CANONICAL_NATIVE_VALUE_TRANSFER_MAX_BYTES)), { code: 'PULSE_CANONICAL_NATIVE_VALUE_TYPE' });
    } finally { bounded.close(); }

    function tamper(update) {
      const plan = JSON.parse(JSON.stringify(native.plan));
      update(plan);
      delete plan.planHash;
      plan.planHash = digest(stableStringify(plan));
      return plan;
    }
    assert.throws(() => validateCanonicalNativePlan(tamper(plan => { plan.packages.application.source += '\n// changed'; })), /validation failed/);
    assert.throws(() => validateCanonicalNativePlan(tamper(plan => { delete plan.packages.application; })), /validation failed/);
    const missingFailureExport = Buffer.from(native.wasm);
    const failureName = missingFailureExport.indexOf(Buffer.from('pulse_package_set_effect_failure'));
    assert.ok(failureName > 0);
    missingFailureExport[failureName] = 'x'.charCodeAt(0);
    assert.throws(() => instantiateCanonicalNativeModule({ ...native, wasm: missingFailureExport }), { code: 'PULSE_CANONICAL_NATIVE_ABI_EXPORT_MISMATCH' });
    const manifest = require('../../../packages/entities/pulsewasm.manifest.cjs');
    assert.equal(validateLowerableLibraryManifest(manifest).manifest.compiler.nativeApplicationExport, 'buildEntitiesCanonicalNativeApplication');
    assert.equal(validateLowerableLibraryManifest({ ...manifest, compiler: { ...manifest.compiler, nativeApplicationExport: '../invalid' } }).status, 'error');
    await liveDev();
    // Exercise canonical schema decoding, grouped results, and secret redaction
    // through an ordinary build of a second application source graph.
    fs.writeFileSync(path.join(project, 'src/handlers.ts'), `
export async function systemStatus(_ctx: unknown, _input: undefined) { return undefined }
export async function lookupCustomer(ctx: any, input: Readonly<{ email: string }>) {
  const values = await ctx.parallel({ mode: ctx.config.get('MODE'), token: ctx.secret.get('TOKEN') })
  const customer = await ctx.fetch('https://directory.example.test/json').json('tools.CustomerLookupOutput')
  ctx.log.info(values.token)
  return { email: input.email, displayName: values.mode + ':' + customer.displayName }
}
`);
    assert.equal(parseJson(run(['build', '--profile', 'node-native', '--json'], project)).status, 'built');
    const grouped = { wasm: fs.readFileSync(path.join(out, 'canonical-native.wasm')), plan: JSON.parse(fs.readFileSync(path.join(out, 'canonical-native-plan.json'), 'utf8')) };
    const options = { request: request(lookup), config: { MODE: 'group' }, secrets: { TOKEN: 'en02-private-token' }, reporting: 'debug',
      fetches: { 'https://directory.example.test/json': { value: { email: 'ada@example.test', displayName: 'Ada' } } } };
    const codecCheck = instantiateCanonicalNativeModule(grouped, options);
    try {
      const fetched = codecCheck.prepareEffectResult(grouped.plan.effects.findIndex(effect => effect.kind === 'fetch'), { status: 200, headers: [['content-type', 'application/json']], body: JSON.stringify({ email: 'ada@example.test', displayName: 'Ada' }) });
      assert.deepEqual(fetched, { email: 'ada@example.test', displayName: 'Ada' });
    } finally { codecCheck.close(); }
    const groupedResult = await executeCanonicalNativeModule(grouped, { ...options, providerAdapter: createNodeProviderAdapter(options) });
    assert.deepEqual(JSON.parse(groupedResult.response.body), { jsonrpc: '2.0', result: { email: 'ada@example.test', displayName: 'group:Ada' }, id: 'native-lookup' }, JSON.stringify(groupedResult.trace));
    assert.equal(groupedResult.effectCount, 3);
    assert.equal(groupedResult.continuations.length, 2);
    assert.ok(groupedResult.trace.some(event => event.type === 'log' && event.name === 'info'));
    assert.ok(!JSON.stringify(groupedResult).includes('en02-private-token'));
    await assert.rejects(executeCanonicalNativeModule(grouped, { ...options, maxEffects: 1, providerAdapter: createNodeProviderAdapter(options) }), { code: 'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED' });
    console.log(`ok - ordinary Node Native Entities doctor/build/test/dev executes emitted guest ${wasmHash}; schema selection, fetch suspension, notifications, failure framing, and source identity verified`);
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
