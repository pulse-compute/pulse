#!/usr/bin/env node
'use strict';

// Runs the pinned Fastly JavaScript engine against a local raw HTTP origin.
// A successful exit establishes the information-loss blocker, not S3 support.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { metadataFromHeaders } = require('../../../packages/s3/src/provider.js');
const {
  FASTLY_JS_COMPUTE_VERSION
} = require('../../../packages/provider-fastly/src/javascript/source-package.js');
const {
  inspectFastlyComputeLauncher, renderFastlyLocalConfig,
  startFastlyComputeServe, requestFastlyCompute
} = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');

const repo = path.resolve(__dirname, '../../..');
const single = [['content-length', '0'], ['etag', 'one, two'], ['content-type', 'one, two']];
const duplicate = [['content-length', '0'], ['etag', 'one'], ['etag', 'two'], ['content-type', 'one'], ['content-type', 'two']];
const excessive = [['content-length', '0'], ['etag', 'one'], ...Array.from({ length: 80 }, () => ['x-' + 'a'.repeat(220), 'b'])];
const fixtures = Object.fromEntries(Object.entries({ '/single': single, '/duplicate': duplicate, '/header-limit': excessive })
  .map(([target, headers]) => [target, [...headers, ['connection', 'close']]]));
const headerBytes = (headers) => headers.reduce((total, [name, value]) => total + Buffer.byteLength(name) + Buffer.byteLength(value) + 4, 0);

async function main() {
  const launcher = inspectFastlyComputeLauncher(); // Missing runtime is a failure.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-o3-header-probe-'));
  const sockets = new Set();
  const requests = [];
  const origin = net.createServer((socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    let request = '';
    socket.on('data', (chunk) => {
      request += chunk.toString('ascii');
      if (!request.includes('\r\n\r\n')) return;
      socket.removeAllListeners('data');
      const target = request.split(' ')[1];
      const headers = fixtures[target];
      if (!headers) { socket.destroy(); return; }
      requests.push(target);
      socket.end('HTTP/1.1 200 OK\r\n' + headers.map(([name, value]) => `${name}: ${value}\r\n`).join('') + '\r\n');
    });
  });
  let server;
  try {
    await new Promise((resolve, reject) => { origin.once('error', reject); origin.listen(0, '127.0.0.1', resolve); });
    const packageRoot = path.join(repo, 'packages/provider-fastly');
    const sdkPackage = JSON.parse(fs.readFileSync(path.join(packageRoot, 'node_modules/@fastly/js-compute/package.json'), 'utf8'));
    assert.equal(sdkPackage.version, FASTLY_JS_COMPUTE_VERSION);
    fs.writeFileSync(path.join(root, 'fastly.toml'), renderFastlyLocalConfig({
      name: 'pulse-o3-header-boundary', backends: { origin: `http://127.0.0.1:${origin.address().port}` }
    }));
    const wasmFile = path.join(root, 'main.wasm');
    const cache = path.join(root, 'cache'); fs.mkdirSync(cache);
    const compiled = spawnSync(path.join(packageRoot, 'node_modules/.bin/js-compute-runtime'), [
      '--env', `XDG_CACHE_HOME=${cache}`, path.join(__dirname, 'fastly-javascript-header-probe.mjs'), wasmFile
    ], { cwd: root, encoding: 'utf8', timeout: 300000 });
    assert.equal(compiled.status, 0, `${compiled.error || ''}\n${compiled.stdout}\n${compiled.stderr}`);
    server = await startFastlyComputeServe({ launcher, packageRoot: root, wasmFile, startTimeoutMs: 60000 });
    const observed = {};
    for (const target of Object.keys(fixtures)) {
      const response = await requestFastlyCompute(server, { path: target });
      assert.equal(response.status, 200, `${target}: ${response.body.toString()}\n${JSON.stringify(server.logs)}`);
      observed[target] = JSON.parse(response.body.toString('utf8'));
    }
    assert.deepEqual(requests, Object.keys(fixtures), 'Every probe must reach the raw origin exactly once.');
    assert.deepEqual(observed['/single'], observed['/duplicate'], 'Revisit O3: the pinned engine no longer erases multiplicity.');
    assert.ok(metadataFromHeaders(single, true));
    assert.equal(metadataFromHeaders(duplicate, true), null);
    assert.ok(metadataFromHeaders(observed['/duplicate'].headers, true), 'The public Headers projection hides the duplicate violation.');
    assert.ok(headerBytes(excessive) > 16384);
    assert.equal(metadataFromHeaders(excessive, true), null);
    assert.ok(headerBytes(observed['/header-limit'].headers) < 16384);
    assert.ok(metadataFromHeaders(observed['/header-limit'].headers, true), 'The projection also hides the raw header budget violation.');
    console.log(JSON.stringify({
      status: 'blocker-confirmed', s3Acceptance: false,
      sdk: sdkPackage.version, launcher: launcher.kind, runtime: launcher.inspection.version,
      indistinguishable: observed['/single'],
      headerLimit: { rawBytes: headerBytes(fixtures['/header-limit']), projectedBytes: headerBytes(observed['/header-limit'].headers) },
      originRequests: requests
    }, null, 2));
  } finally {
    if (server) await server.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => origin.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
