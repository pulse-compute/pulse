#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { run, parseJson, repoRoot } = require('../cli/helpers.cjs');
const fastly = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');

const fixture = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects', 'fastly-compute-reality');
const taskRoot = process.env.PULSEWASM_TEST_TMP_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-compute-reality-'));
const projectRoot = path.join(taskRoot, 'project');

function copyProject() {
  fs.cpSync(fixture, projectRoot, { recursive: true });
  const scope = path.join(projectRoot, 'node_modules', '@pulse-compute');
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(path.join(repoRoot, 'packages', 'grip'), path.join(scope, 'grip'), 'dir');
}

function materializeOrigin(originUrl) {
  for (const relativeFile of ['.pulse/config.ts', 'tests/pulse.harness.ts']) {
    const file = path.join(projectRoot, relativeFile);
    const source = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, source.replaceAll('__PULSE_REALITY_ORIGIN__', originUrl), 'utf8');
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

function headerValues(response, name) {
  const lower = String(name).toLowerCase();
  return response.headers
    .filter(([key]) => String(key).toLowerCase() === lower)
    .flatMap(([, value]) => String(value).split(',').map((entry) => entry.trim()).filter(Boolean));
}

function jsonBody(response) {
  return JSON.parse(response.body.toString('utf8'));
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function toolEvidence(inspection) {
  return Object.freeze({
    binary: path.basename(inspection.binary),
    version: inspection.version,
    output: inspection.output,
    inspectionTermination: inspection.termination,
    sha256: sha256File(inspection.binary)
  });
}

function responseEvidence(response, options = {}) {
  return Object.freeze({
    status: response.status,
    headers: Object.freeze(response.headers.map((entry) => Object.freeze([...entry]))),
    bytes: response.body.length,
    sha256: sha256Bytes(response.body),
    json: options.json ? jsonBody(response) : undefined
  });
}

function writeEvidence(file, value) {
  if (!file) return;
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}
`, 'utf8');
}

async function main() {
  const launcher = fastly.inspectFastlyComputeLauncher({
    binary: process.env.PULSE_FASTLY_BIN,
    viceroyBinary: process.env.PULSE_VICEROY_BIN,
    env: process.env,
    timeoutMs: 5000
  });
  const inspection = launcher.inspection;

  copyProject();
  const captured = { originRequests: [], publications: [] };
  const secret = 'fastly-compute-secret-value';
  const binary = Buffer.from([0, 255, 1, 2, 3]);
  const origin = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    captured.originRequests.push({ method: request.method, url: request.url, headers: { ...request.headers }, body: Buffer.from(body) });

    if (request.url === '/origin/user') {
      assert.equal(request.headers.authorization, `Bearer ${secret}`);
      assert.equal(request.headers['x-pulse-request'], 'Ada');
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ id: 7, authSeen: true }));
      return;
    }
    if (request.url === '/binary') {
      response.statusCode = 200;
      response.setHeader('content-type', 'application/octet-stream');
      response.setHeader('x-binary-repeat', ['one', 'two']);
      response.end(binary);
      return;
    }
    if (request.url === '/grip/publish') {
      const publication = JSON.parse(body.toString('utf8'));
      captured.publications.push(publication);
      response.statusCode = 202;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ accepted: true, channel: publication.channel }));
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });

  let server;
  try {
    const address = await listen(origin);
    const originUrl = `http://127.0.0.1:${address.port}`;
    materializeOrigin(originUrl);
    const built = parseJson(run(['build', '--json'], projectRoot, { timeout: 180000 }));
    assert.equal(built.status, 'built');
    const dist = path.join(projectRoot, 'dist');
    const wasmFile = path.join(dist, 'bin', 'main.wasm');
    const wasmBytes = fs.readFileSync(wasmFile);
    assert.equal(wasmBytes.subarray(0, 8).toString('hex'), '0061736d01000000');
    assert.equal(WebAssembly.validate(wasmBytes), true);
    const wasmModule = new WebAssembly.Module(wasmBytes);
    const wasmImports = WebAssembly.Module.imports(wasmModule);
    const wasmExports = WebAssembly.Module.exports(wasmModule);
    assert.equal(wasmImports.some((entry) => entry.module === 'env' || /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)), false, 'real Fastly module must not import env.abort, pulse_host, WASI, or a JavaScript runtime');
    assert.ok(wasmExports.some((entry) => entry.name === '_start' && entry.kind === 'function'));
    assert.ok(wasmExports.some((entry) => entry.name === 'pulse_crypto_hs256_verify' && entry.kind === 'function'));
    assert.ok(wasmExports.some((entry) => entry.name === 'pulse_crypto_sha256_digest' && entry.kind === 'function'));

    const pulseBuild = JSON.parse(fs.readFileSync(path.join(dist, 'pulse-build.json'), 'utf8'));
    const fastlyBuild = JSON.parse(fs.readFileSync(path.join(dist, 'fastly-build.json'), 'utf8'));
    const fastlyNativeManifest = JSON.parse(fs.readFileSync(path.join(dist, 'fastly-native-manifest.json'), 'utf8'));
    assert.equal(pulseBuild.cryptoRealizationPlan.algorithms[0].realization, 'guest-source:pulse-hmac-as');
    assert.equal(pulseBuild.cryptoRealizationPlan.algorithms[0].targetImplemented, true);
    assert.equal(pulseBuild.cryptoRealizationPlan.automaticFallback, false);
    assert.equal(fastlyBuild.crypto.active, true);
    assert.equal(fastlyBuild.crypto.algorithms[0].realization, 'guest-source:pulse-hmac-as');
    assert.equal(fastlyBuild.crypto.algorithms[0].imports.length, 0);
    assert.equal(fastlyBuild.crypto.automaticFallback, false);
    assert.deepEqual(fastlyNativeManifest.crypto, fastlyBuild.crypto);
    assert.equal(fastlyBuild.guestLink, undefined, 'HS256 guest-source must not invoke Fastly guest linking');

    const manifestFile = path.join(dist, 'fastly.toml');
    fs.writeFileSync(manifestFile, fastly.renderFastlyLocalConfig({
      name: 'pulse-fastly-compute-reality',
      backends: {
        reality_origin: { url: originUrl, overrideHost: `127.0.0.1:${address.port}`, useSni: false }
      },
      configStores: { reality_config: { API_BASE: originUrl } },
      secretStores: { reality_secrets: { API_TOKEN: secret } },
      kvStores: { reality_state: {} }
    }));
    const localManifest = fs.readFileSync(manifestFile, 'utf8');
    assert.match(localManifest, /^language = "other"$/m, 'native Fastly local packages must be declared as language=other');

    server = await fastly.startFastlyComputeServe({
      launcher,
      packageRoot: dist,
      wasmFile,
      manifestFile,
      env: process.env,
      timeoutMs: 5000,
      startTimeoutMs: 120000,
      stopTimeoutMs: 5000
    });
    if (launcher.kind === 'fastly-cli') {
      assert.deepEqual(server.args.slice(0, 2), ['compute', 'serve']);
      assert.ok(server.args.includes('--dir'));
      assert.ok(server.args.includes('--file'));
      assert.ok(server.args.includes(wasmFile));
    } else {
      assert.equal(server.args[0], 'serve');
      assert.ok(server.args.includes('--config'));
      assert.equal(server.args.at(-1), wasmFile);
    }
    assert.equal(server.child.spawnfile, inspection.binary);

    const structured = await fastly.requestFastlyCompute(server, {
      method: 'POST',
      path: '/structured',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada', active: true }),
      timeoutMs: 45000
    });
    assert.equal(structured.status, 201);
    assert.deepEqual(jsonBody(structured), { id: 7, name: 'Ada', active: true, stored: 'Ada', authSeen: true });
    assert.deepEqual(headerValues(structured, 'x-pulse-repeat'), ['one', 'two']);

    const persisted = await fastly.requestFastlyCompute(server, { path: '/kv-read', timeoutMs: 45000 });
    assert.equal(persisted.status, 200);
    assert.deepEqual(jsonBody(persisted), { stored: 'Ada' });

    const opaque = await fastly.requestFastlyCompute(server, { path: '/opaque', timeoutMs: 45000 });
    assert.equal(opaque.status, 200);
    assert.deepEqual(opaque.body, binary);
    assert.deepEqual(headerValues(opaque, 'x-binary-repeat'), ['one', 'two']);

    const hold = await fastly.requestFastlyCompute(server, { path: '/grip/hold', timeoutMs: 45000 });
    assert.equal(hold.status, 200);
    assert.equal(headerValues(hold, 'grip-hold')[0], 'stream');
    assert.deepEqual(headerValues(hold, 'grip-channel'), ['events:fastly-compute', 'events:extra']);
    assert.equal(headerValues(hold, 'grip-timeout')[0], '30000');
    assert.equal(hold.body.length, 0);

    const published = await fastly.requestFastlyCompute(server, { method: 'POST', path: '/grip/publish', timeoutMs: 45000 });
    assert.equal(published.status, 202);
    assert.deepEqual(jsonBody(published), {
      published: true,
      channel: 'events:fastly-compute',
      message: 'hello from compiled Pulse',
      event: 'pulse.message',
      id: 'reality-1'
    });
    assert.deepEqual(captured.publications, [{
      channel: 'events:fastly-compute',
      message: 'hello from compiled Pulse',
      event: 'pulse.message',
      id: 'reality-1'
    }]);

    const serialized = JSON.stringify({
      logs: server.logs,
      structured: jsonBody(structured),
      publication: captured.publications,
      crypto: fastlyBuild.crypto
    });
    assert.equal(serialized.includes(secret), false, 'Fastly CLI output and observable Pulse results must not leak the raw secret');
    assert.ok(captured.originRequests.some((entry) => entry.url === '/origin/user' && entry.headers.authorization === `Bearer ${secret}`));

    const proof = Object.freeze({
      version: 'pulse.fastly-real-host-proof.v2',
      toolchain: Object.freeze({
        launcher: Object.freeze({
          kind: launcher.kind,
          owner: launcher.owner,
          ...toolEvidence(inspection)
        }),
        fastlyCli: launcher.fastlyCliInspection
          ? toolEvidence(launcher.fastlyCliInspection)
          : null,
        localComputeEngine: Object.freeze({
          owner: launcher.owner,
          selection: launcher.kind,
          version:
            launcher.viceroyInspection
            && launcher.viceroyInspection.version
            || null
        })
      }),
      module: Object.freeze({
        bytes: wasmBytes.length,
        sha256: sha256Bytes(wasmBytes),
        imports: Object.freeze(wasmImports.map((entry) => Object.freeze({ ...entry }))),
        exports: Object.freeze(wasmExports.map((entry) => Object.freeze({ ...entry }))),
        manifestSha256: sha256Bytes(Buffer.from(localManifest)),
        language: 'other'
      }),
      invocation: Object.freeze({
        owner: launcher.owner,
        command: launcher.kind === 'fastly-cli'
          ? Object.freeze([
              'compute',
              'serve',
              '--file',
              path.basename(wasmFile)
            ])
          : Object.freeze([
              'serve',
              '--config',
              path.basename(manifestFile),
              path.basename(wasmFile)
            ])
      }),
      scenarios: Object.freeze({
        structured: responseEvidence(structured, { json: true }),
        persistedKv: responseEvidence(persisted, { json: true }),
        opaque: responseEvidence(opaque),
        gripHold: responseEvidence(hold),
        gripPublish: responseEvidence(published, { json: true })
      }),
      observations: Object.freeze({
        originRequests: captured.originRequests.length,
        publications: Object.freeze(captured.publications.map((entry) => Object.freeze({ ...entry })))
      }),
      assertions: Object.freeze({
        realFastlyCli: launcher.kind === 'fastly-cli',
        directViceroy: launcher.kind === 'viceroy-direct',
        realLocalComputeEngine: true,
        directFastlyImports: true,
        envAbortAbsent: true,
        zeroValuedOpaqueHandlesAccepted: true,
        schemas: true,
        configStore: true,
        secretStore: true,
        secretRedaction: true,
        kvPersistence: true,
        namedBackendFetch: true,
        opaqueBytes: true,
        repeatedHeaders: true,
        gripHoldPublish: true,
        cryptoGuestSource: true,
        cryptoGuestLinked: false,
        cryptoFallback: false,
        javascriptRuntime: false
      })
    });
    assert.equal(JSON.stringify(proof).includes(secret), false, 'Fastly reality evidence must never contain secret plaintext');
    writeEvidence(process.env.PULSE_FASTLY_REALITY_EVIDENCE, proof);

    console.log(`ok - the native Pulse Fastly module executed through ${launcher.kind} ${inspection.version || 'unknown'} with config, secret, KV persistence, named backend fetch, schemas, opaque bytes, repeated headers, and GRIP hold/publish`);
  } finally {
    if (server) await server.stop();
    await close(origin);
  }
}

main().catch((error) => {
  if (
    error
    && (
      error.code === 'PULSE_FASTLY_CLI_UNAVAILABLE'
      || error.code === 'PULSE_VICEROY_UNAVAILABLE'
      || error.code === 'PULSE_FASTLY_REALITY_ENGINE_UNAVAILABLE'
    )
  ) {
    console.error(JSON.stringify({
      status: 'blocked',
      gate: 'provider-fastly-compute-reality',
      code: error.code,
      message: error.message,
      detail: error.detail
    }, null, 2));
  } else {
    console.error(error && error.stack ? error.stack : error);
  }
  process.exit(1);
});
