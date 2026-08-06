#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fastly = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');

async function main() {
  const taskRoot = process.env.PULSEWASM_TEST_TMP_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-cli-surface-'));
  const emptyRoot = path.join(taskRoot, 'empty');
  fs.mkdirSync(emptyRoot, { recursive: true });

  assert.throws(
    () => fastly.resolveFastlyCliBinary({ env: { PATH: '' } }),
    (error) => error.name === 'FastlyComputeRealityError' && error.code === 'PULSE_FASTLY_CLI_UNAVAILABLE' && /Homebrew|package manager|official Fastly CLI release/i.test(error.detail.hint)
  );

  assert.throws(
    () => fastly.resolveViceroyBinary({ env: { PATH: '', PULSE_VICEROY_BIN: '' } }),
    (error) => error.name === 'FastlyComputeRealityError' && error.code === 'PULSE_VICEROY_UNAVAILABLE' && /PULSE_VICEROY_BIN|executable Viceroy binary/i.test(error.detail.hint)
  );

  const fake = path.join(taskRoot, process.platform === 'win32' ? 'fastly.exe' : 'fastly');
  const capture = path.join(taskRoot, 'fastly-args.json');
  fs.writeFileSync(fake, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const args = process.argv.slice(2);
if ((args.length === 1 && args[0] === 'version') || (args.length === 1 && args[0] === '--version')) {
  process.stdout.write('Fastly CLI version v99.7.3\\n');
  process.exit(0);
}
if (args[0] !== 'compute' || args[1] !== 'serve') process.exit(64);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const dir = value('--dir');
const file = value('--file');
const address = value('--addr');
if (!dir || !file || !address || !fs.existsSync(path.join(dir, 'fastly.toml')) || !fs.existsSync(file)) process.exit(65);
if (process.env.PULSE_FAKE_FASTLY_CAPTURE) fs.writeFileSync(process.env.PULSE_FAKE_FASTLY_CAPTURE, JSON.stringify({ args, dir, file, address }));
const split = address.lastIndexOf(':');
const host = address.slice(0, split);
const port = Number(address.slice(split + 1));
const server = http.createServer((request, response) => {
  response.statusCode = 204;
  response.setHeader('x-pulse-fake-fastly', 'ready');
  response.end();
});
function stop() { server.close(() => process.exit(0)); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.listen(port, host);
`);
  fs.chmodSync(fake, 0o755);

  const fakeViceroy = path.join(taskRoot, process.platform === 'win32' ? 'viceroy.exe' : 'viceroy');
  const viceroyCapture = path.join(taskRoot, 'viceroy-args.json');
  fs.writeFileSync(fakeViceroy, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const http = require('node:http');
if (process.argv.includes('--version') || process.argv.includes('version')) {
  process.stdout.write('viceroy 88.6.4\\n');
  process.exit(0);
}
const args = process.argv.slice(2);
if (args[0] !== 'serve') process.exit(64);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const address = value('--addr');
const config = value('--config');
const input = args[args.length - 1];
if (!address || !config || !input || !fs.existsSync(config) || !fs.existsSync(input)) process.exit(65);
if (process.env.PULSE_FAKE_VICEROY_CAPTURE) {
  fs.writeFileSync(process.env.PULSE_FAKE_VICEROY_CAPTURE, JSON.stringify({ args, address, config, input }));
}
const split = address.lastIndexOf(':');
const host = address.slice(0, split);
const port = Number(address.slice(split + 1));
const server = http.createServer((request, response) => {
  response.statusCode = 204;
  response.setHeader('x-pulse-fake-viceroy', 'ready');
  response.end();
});
function stop() { server.close(() => process.exit(0)); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.listen(port, host);
`);
  fs.chmodSync(fakeViceroy, 0o755);

  const inspected = fastly.inspectFastlyCli({ binary: fake, env: { PATH: process.env.PATH || '' } });
  assert.equal(inspected.version, '99.7.3', 'Pulse records the installed Fastly CLI version without independently pinning it');
  assert.equal(inspected.binary, fake);

  const inspectedViceroy = fastly.inspectViceroy({ viceroyBinary: fakeViceroy, env: { PATH: process.env.PATH || '' } });
  assert.equal(inspectedViceroy.version, '88.6.4');
  assert.equal(inspectedViceroy.binary, fakeViceroy);
  assert.equal(inspectedViceroy.source, 'explicit');

  const config = fastly.renderFastlyLocalConfig({
    name: 'pulse-reality',
    backends: { reality_origin: { url: 'http://127.0.0.1:19090', overrideHost: '127.0.0.1', useSni: false } },
    configStores: { reality_config: { API_BASE: 'http://127.0.0.1:19090' } },
    secretStores: { reality_secrets: { API_TOKEN: 'local-secret' } },
    kvStores: { reality_state: { existing: 'value', object: { active: true } } }
  });
  assert.match(config, /manifest_version = 3/);
  assert.match(config, /language = "other"/);
  assert.match(config, /\[local_server\.backends\."reality_origin"\]/);
  assert.match(config, /\[local_server\.config_stores\."reality_config"\]/);
  assert.match(config, /format = "inline-toml"/);
  assert.match(config, /\[local_server\.secret_stores\]/);
  assert.match(config, /"reality_secrets" = \[\{ key = "API_TOKEN", data = "local-secret" \}\]/);
  assert.match(config, /\[local_server\.kv_stores\]/);
  assert.match(config, /"reality_state" = \[/);
  assert.match(config, /__pulseKv/);
  assert.equal(config.endsWith('\n'), true);

  const packageRoot = path.join(taskRoot, 'package');
  const wasmFile = path.join(packageRoot, 'bin', 'main.wasm');
  const manifestFile = path.join(packageRoot, 'fastly.toml');
  fs.mkdirSync(path.dirname(wasmFile), { recursive: true });
  fs.writeFileSync(wasmFile, Buffer.from('0061736d01000000', 'hex'));
  fs.writeFileSync(manifestFile, config);

  const server = await fastly.startFastlyComputeServe({
    binary: fake,
    packageRoot,
    wasmFile,
    manifestFile,
    env: { PATH: process.env.PATH || '', PULSE_FAKE_FASTLY_CAPTURE: capture },
    startTimeoutMs: 5000,
    stopTimeoutMs: 1000
  });
  try {
    assert.equal(server.inspection.version, '99.7.3');
    assert.equal(server.viceroyInspection, undefined);
    assert.deepEqual(server.args.slice(0, 2), ['compute', 'serve']);
    assert.ok(server.args.includes('--dir'));
    assert.ok(server.args.includes('--file'));
    assert.ok(server.args.includes('--addr'));
    assert.equal(server.args.includes('--viceroy-path'), false);
    const response = await fastly.requestFastlyCompute(server, { path: '/ready', timeoutMs: 5000 });
    assert.equal(response.status, 204);
    assert.ok(response.headers.some(([key, value]) => key.toLowerCase() === 'x-pulse-fake-fastly' && value === 'ready'));
    assert.equal(response.body.length, 0);
  } finally {
    await server.stop();
  }

  const captured = JSON.parse(fs.readFileSync(capture, 'utf8'));
  assert.deepEqual(captured.args.slice(0, 2), ['compute', 'serve']);
  assert.equal(captured.dir, packageRoot);
  assert.equal(captured.file, wasmFile);
  assert.match(captured.address, /^127\.0\.0\.1:\d+$/);
  assert.equal(captured.args.includes('--viceroy-path'), false);

  const explicitCapture = path.join(taskRoot, 'fastly-explicit-args.json');
  const explicitServer = await fastly.startFastlyComputeServe({
    binary: fake,
    viceroyBinary: fakeViceroy,
    packageRoot,
    wasmFile,
    manifestFile,
    env: { PATH: process.env.PATH || '', PULSE_FAKE_FASTLY_CAPTURE: explicitCapture },
    startTimeoutMs: 5000,
    stopTimeoutMs: 1000
  });
  try {
    assert.equal(explicitServer.viceroyInspection.version, '88.6.4');
    const viceroyPathIndex = explicitServer.args.indexOf('--viceroy-path');
    assert.ok(viceroyPathIndex >= 0);
    assert.equal(explicitServer.args[viceroyPathIndex + 1], fakeViceroy);
  } finally {
    await explicitServer.stop();
  }
  const explicitCaptured = JSON.parse(fs.readFileSync(explicitCapture, 'utf8'));
  assert.equal(explicitCaptured.args[explicitCaptured.args.indexOf('--viceroy-path') + 1], fakeViceroy);

  const directLauncher = fastly.inspectFastlyComputeLauncher({
    launcherKind: 'viceroy-direct',
    viceroyBinary: fakeViceroy,
    env: { PATH: process.env.PATH || '' }
  });
  assert.equal(directLauncher.kind, 'viceroy-direct');
  assert.equal(directLauncher.owner, 'pulse-test-harness');
  assert.equal(directLauncher.fastlyCliInspection, undefined);
  assert.equal(directLauncher.viceroyInspection.version, '88.6.4');

  const directServer = await fastly.startFastlyComputeServe({
    launcher: directLauncher,
    packageRoot,
    wasmFile,
    manifestFile,
    env: {
      PATH: process.env.PATH || '',
      PULSE_FAKE_VICEROY_CAPTURE: viceroyCapture
    },
    startTimeoutMs: 5000,
    stopTimeoutMs: 1000
  });
  try {
    assert.equal(directServer.launcher.kind, 'viceroy-direct');
    assert.equal(directServer.fastlyCliInspection, undefined);
    assert.equal(directServer.viceroyInspection.version, '88.6.4');
    assert.equal(directServer.args[0], 'serve');
    assert.ok(directServer.args.includes('--config'));
    assert.ok(directServer.args.includes('--addr'));
    assert.equal(directServer.args.at(-1), wasmFile);
    const response = await fastly.requestFastlyCompute(directServer, {
      path: '/ready',
      timeoutMs: 5000
    });
    assert.equal(response.status, 204);
    assert.ok(response.headers.some(([key, value]) => (
      key.toLowerCase() === 'x-pulse-fake-viceroy' && value === 'ready'
    )));
  } finally {
    await directServer.stop();
  }
  const directCaptured = JSON.parse(fs.readFileSync(viceroyCapture, 'utf8'));
  assert.equal(directCaptured.config, manifestFile);
  assert.equal(directCaptured.input, wasmFile);
  assert.match(directCaptured.address, /^127\.0\.0\.1:\d+$/);

  const providerPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'provider-fastly', 'package.json'), 'utf8'));
  assert.equal(providerPackage.exports['./testing/fastly-cli'], './src/testing/fastly-cli.js');
  assert.equal(providerPackage.exports['./testing/viceroy'], undefined, 'the provider must not expose a direct Viceroy orchestration surface');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'provider-fastly', 'src', 'testing', 'fastly-cli.js'), 'utf8');
  assert.match(source, /PULSE_FASTLY_CLI_UNAVAILABLE/);
  assert.match(source, /PULSE_VICEROY_UNAVAILABLE/);
  assert.match(source, /--viceroy-path/);
  assert.match(source, /'compute', 'serve'/);
  assert.match(source, /'viceroy-direct'/);
  assert.match(source, /'serve'/);
  assert.match(source, /--config/);
  assert.match(source, /--dir/);
  assert.match(source, /--file/);
  assert.doesNotMatch(source, /pinnedViceroyVersion/);
  assert.doesNotMatch(source, /install-tools|cargo\s+install|postinstall/);
  assert.doesNotMatch(source, /shell\s*:\s*true|exec\(/);

  console.log('ok - Fastly reality tooling records and safely owns either Fastly CLI-managed execution or an explicit direct Viceroy launcher');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
