#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { EXAMPLES, compileExample } = require('../support/canonical-projects.cjs');
const { compileCanonicalFile } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const shell = require('../../../packages/provider-fastly/src/build/native-http-shell.js');
const mock = require('../../../packages/provider-fastly/src/testing/native-http-shell-host.js');

function effectPlan() {
  return buildCanonicalNativePlan(
    compileExample(EXAMPLES.fetchComposition).compiled
  );
}

function headerValues(headers, name) {
  const target = String(name).toLowerCase();
  return headers.filter(([headerName]) => String(headerName).toLowerCase() === target).map(([, value]) => value);
}

function writeEchoFixture(root) {
  const file = path.join(root, 'app.ts');
  fs.writeFileSync(file, `import type { PulseContext, PulseResult } from '@pulse-compute/runtime'

export default function handler(ctx: PulseContext): PulseResult {
  if (ctx.req.header('x-mode') === 'echo') {
    return ctx.json({ method: ctx.req.method, url: ctx.req.url, path: ctx.req.path }, {
      status: 201,
      headers: [['x-pulse', 'one'], ['x-pulse', 'two']],
    })
  }
  return ctx.text('denied', { status: 403, headers: { 'x-pulse-mode': 'denied' } })
}
`, 'utf8');
  return file;
}

function writeHelloFixture(root) {
  const file = path.join(root, 'hello.ts');
  fs.writeFileSync(file, `import type { PulseContext, PulseResult } from '@pulse-compute/runtime'

export default function handler(ctx: PulseContext): PulseResult {
  if (ctx.req.path === '/health') return ctx.json({ ok: true })
  if (ctx.req.path === '/hello') return ctx.json({ message: 'hello from Pulse' })
  return ctx.text('not found', { status: 404 })
}
`, 'utf8');
  return file;
}

function assertDirectFastlyModule(name, compiled) {
  assert.equal(compiled.version, shell.FASTLY_NATIVE_HTTP_SHELL_VERSION, `${name} shell version`);
  assert.equal(compiled.manifest.planHash, compiled.plan.planHash, `${name} plan hash binding`);
  assert.equal(compiled.manifest.policy.nativeFastly, true, `${name} native Fastly policy`);
  assert.equal(compiled.manifest.policy.javascriptRuntime, false, `${name} must not embed JavaScript`);
  assert.equal(compiled.manifest.policy.jsComputeRuntime, false, `${name} must not invoke js-compute-runtime`);
  assert.equal(compiled.manifest.policy.effects, false, `${name} native Fastly HTTP effect boundary`);
  assert.equal(compiled.inspection.valid, true, `${name} valid Wasm`);
  assert.equal(compiled.inspection.magic, '0061736d01000000', `${name} Wasm magic`);
  assert.ok(compiled.wasm.length > 1024 && compiled.wasm.length < shell.FASTLY_NATIVE_HTTP_MAX_WASM_BYTES, `${name} compact native Fastly Wasm`);
  assert.equal(compiled.inspection.imports.some((entry) => entry.module === 'env' || /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)), false, `${name} must not import env.abort, the portable host, WASI, or JS runtime`);
  for (const moduleName of ['fastly_abi', 'fastly_http_req', 'fastly_http_resp', 'fastly_http_body']) {
    assert.ok(compiled.inspection.importModules.includes(moduleName), `${name} must import ${moduleName}`);
  }
  const exportNames = new Set(compiled.inspection.exports.map((entry) => entry.name));
  for (const exportName of ['_start', 'memory', 'pulse_fastly_plan_hash_ptr', 'pulse_fastly_plan_hash_length', 'pulse_fastly_last_error']) {
    assert.ok(exportNames.has(exportName), `${name} must export ${exportName}`);
  }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-http-'));
try {
  const helloPlan = buildCanonicalNativePlan(compileCanonicalFile(writeHelloFixture(tempRoot), { rootDir: tempRoot }));
  const helloFirst = shell.compileFastlyNativeHttpPlan(helloPlan, { cwd: repoRoot });
  const helloSecond = shell.compileFastlyNativeHttpPlan(helloPlan, { cwd: os.tmpdir() });
  assertDirectFastlyModule('hello', helloFirst);
  assert.deepEqual(helloFirst.wasm, helloSecond.wasm, 'hello native Fastly Wasm must be deterministic across cwd');
  assert.equal(helloFirst.source, helloSecond.source, 'hello generated AssemblyScript must be deterministic across cwd');
  assert.equal(helloFirst.wat, helloSecond.wat, 'hello WAT must be deterministic across cwd');
  assert.deepEqual(helloFirst.manifest, helloSecond.manifest, 'hello manifest must be deterministic across cwd');

  let result = mock.executeFastlyNativeHttpShell(helloFirst, { request: { method: 'GET', url: 'https://edge.test/health' } });
  assert.equal(result.response.status, 200);
  assert.deepEqual(JSON.parse(result.response.body), { ok: true });
  assert.deepEqual(headerValues(result.response.headers, 'content-type'), ['application/json; charset=utf-8']);

  result = mock.executeFastlyNativeHttpShell(helloFirst, { request: { method: 'GET', url: 'https://edge.test/hello?from=fastly' } });
  assert.equal(result.response.status, 200);
  assert.deepEqual(JSON.parse(result.response.body), { message: 'hello from Pulse' });

  result = mock.executeFastlyNativeHttpShell(helloFirst, { request: { method: 'GET', url: 'https://edge.test/missing' } });
  assert.equal(result.response.status, 404);
  assert.equal(result.response.body, 'not found');
  assert.deepEqual(headerValues(result.response.headers, 'content-type'), ['text/plain; charset=utf-8']);

  const echoFile = writeEchoFixture(tempRoot);
  const echoPlan = buildCanonicalNativePlan(compileCanonicalFile(echoFile, { rootDir: tempRoot }));
  const echoFirst = shell.compileFastlyNativeHttpPlan(echoPlan, { cwd: repoRoot });
  const echoSecond = shell.compileFastlyNativeHttpPlan(echoPlan, { cwd: path.join(repoRoot, 'wasm', 'packages', 'compiler') });
  assertDirectFastlyModule('request-echo', echoFirst);
  assert.deepEqual(echoFirst.wasm, echoSecond.wasm, 'request echo native Fastly Wasm must be deterministic');
  assert.ok(echoFirst.inspection.imports.some((entry) => entry.module === 'fastly_http_req' && entry.name === 'header_value_get'), 'request echo must read a named downstream header through the Fastly ABI');

  result = mock.executeFastlyNativeHttpShell(echoFirst, {
    request: {
      method: 'POST',
      url: 'https://edge.test/echo?source=native',
      headers: [['x-mode', 'echo'], ['x-request-id', 'req-96']]
    }
  });
  assert.equal(result.response.status, 201);
  assert.deepEqual(JSON.parse(result.response.body), {
    method: 'POST',
    url: 'https://edge.test/echo?source=native',
    path: '/echo'
  });
  assert.deepEqual(headerValues(result.response.headers, 'x-pulse'), ['one', 'two'], 'Fastly shell must preserve repeated response headers in order');
  assert.deepEqual(headerValues(result.response.headers, 'content-type'), ['application/json; charset=utf-8']);
  assert.ok(result.trace.some((entry) => entry.module === 'fastly_http_req' && entry.name === 'method_get'));
  assert.ok(result.trace.some((entry) => entry.module === 'fastly_http_req' && entry.name === 'uri_get'));
  assert.ok(result.trace.some((entry) => entry.module === 'fastly_http_req' && entry.name === 'header_value_get' && entry.header === 'x-mode'));
  assert.ok(result.trace.some((entry) => entry.module === 'fastly_http_resp' && entry.name === 'send_downstream'));

  result = mock.executeFastlyNativeHttpShell(echoFirst, { request: { method: 'GET', url: 'https://edge.test/echo' } });
  assert.equal(result.response.status, 403);
  assert.equal(result.response.body, 'denied');
  assert.deepEqual(headerValues(result.response.headers, 'x-pulse-mode'), ['denied']);

  const outputRoot = path.join(tempRoot, 'written');
  const written = shell.writeFastlyNativeHttpModule(echoFirst, outputRoot);
  for (const file of [written.sourceFile, written.wasmFile, written.watFile, written.planFile, written.manifestFile]) {
    assert.equal(fs.existsSync(file), true, `${path.basename(file)} must be written`);
  }
  assert.deepEqual(fs.readFileSync(written.wasmFile), echoFirst.wasm);
  assert.equal(JSON.parse(fs.readFileSync(written.manifestFile, 'utf8')).planHash, echoPlan.planHash);

  const deferredEffectPlan = effectPlan();
  assert.throws(
    () => shell.compileFastlyNativeHttpPlan(deferredEffectPlan, { cwd: repoRoot }),
    (error) => error && error.name === 'FastlyNativeHttpShellError' && error.code === 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_DEFERRED'
  );

  const tampered = { ...helloPlan, version: 'pulse.canonical-native-plan.v999' };
  assert.throws(
    () => shell.generateFastlyNativeHttpAssemblyScript(tampered),
    (error) => error && error.code === 'PULSE_FASTLY_NATIVE_HTTP_PLAN_VERSION_UNSUPPORTED'
  );

  const proof = {
    version: shell.FASTLY_NATIVE_HTTP_SHELL_VERSION,
    plans: [
      { name: 'hello', planHash: helloPlan.planHash, bytes: helloFirst.wasm.length, sha256: helloFirst.inspection.sha256 },
      { name: 'request-echo', planHash: echoPlan.planHash, bytes: echoFirst.wasm.length, sha256: echoFirst.inspection.sha256 }
    ],
    imports: echoFirst.inspection.imports,
    exports: echoFirst.inspection.exports,
    assertions: {
      directFastlyImports: true,
      startExport: true,
      methodUriHeaderReads: true,
      downstreamResponse: true,
      repeatedResponseHeaders: true,
      deterministic: true,
      effectsDeferred: true,
      javascriptRuntime: false
    }
  };
  const proofFlag = process.argv.indexOf('--proof-file');
  if (proofFlag >= 0) {
    const proofValue = process.argv[proofFlag + 1];
    assert.ok(proofValue && !proofValue.startsWith('--'), '--proof-file requires a path');
    const proofFile = path.resolve(proofValue);
    fs.mkdirSync(path.dirname(proofFile), { recursive: true });
    fs.writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(proof, null, 2));
  console.log('ok - native Fastly HTTP compiles effect-free native plans into deterministic direct Fastly HTTP Wasm and executes request/response behavior through the controlled ABI host');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
