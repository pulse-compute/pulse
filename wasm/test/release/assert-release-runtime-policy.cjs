#!/usr/bin/env node
'use strict';

require('./assert-pnpm-toolchain.cjs');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PUBLICATION, versionSatisfiesCaretRange } = require('../../../scripts/package-support.cjs');
const { assertReleaseNode, fastlyAvailability } = require('../../../scripts/validate-release.cjs');

assert.equal(PUBLICATION.nodeEngines, '^22.14.0 || ^24.0.0');
assert.equal(PUBLICATION.nodeMinimumVersion, '22.14.0');
assert.equal(PUBLICATION.nodeReleaseRange, '^24.0.0');
assert.equal(PUBLICATION.nodeVersion, '24.18.0');

assert.equal(versionSatisfiesCaretRange('24.0.0', PUBLICATION.nodeReleaseRange), true);
assert.equal(versionSatisfiesCaretRange('24.14.0', PUBLICATION.nodeReleaseRange), true);
assert.equal(versionSatisfiesCaretRange('24.18.0', PUBLICATION.nodeReleaseRange), true);
assert.equal(versionSatisfiesCaretRange('22.14.0', PUBLICATION.nodeReleaseRange), false);
assert.equal(versionSatisfiesCaretRange('25.0.0', PUBLICATION.nodeReleaseRange), false);

assert.deepEqual(assertReleaseNode('24.14.0'), {
  nodeVersion: '24.14.0',
  acceptedRange: '^24.0.0',
  reproducibleToolchainVersion: '24.18.0'
});
assert.throws(
  () => assertReleaseNode('22.14.0'),
  (error) => error.code === 'PULSE_RELEASE_NODE_RANGE_MISMATCH' && /requires Node \^24\.0\.0/.test(error.message)
);

const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-runtime-policy-'));
const fastlyBinary = path.join(taskRoot, process.platform === 'win32' ? 'fastly.exe' : 'fastly');
fs.writeFileSync(fastlyBinary, `#!${process.execPath}
'use strict';
if (process.argv.includes('version') || process.argv.includes('--version')) {
  process.stdout.write('Fastly CLI version v99.7.3\\n');
  process.exit(0);
}
process.exit(64);
`);
fs.chmodSync(fastlyBinary, 0o755);

const delimiter = process.platform === 'win32' ? ';' : ':';
const availability = fastlyAvailability({
  PATH: `${taskRoot}${delimiter}${path.dirname(process.execPath)}`,
  PULSE_FASTLY_BIN: fastlyBinary
});
assert.deepEqual(availability, {
  status: 'available',
  fastlyCli: {
    binary: fastlyBinary,
    version: '99.7.3'
  },
  localComputeEngine: {
    owner: 'fastly-cli',
    selection: 'managed'
  }
});
assert.equal(Object.hasOwn(availability, 'viceroy'), false);

// Real Wasm bytes exercise the same default-size assertions used by both lanes.
const { verifyDefaultNativeSizes } = require('../docs/assert-executable-documentation.cjs');
const sizeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-doc-size-policy-'));
try {
  // Valid empty module with a 1024-byte custom section (empty name plus padding).
  const wasm = Buffer.concat([Buffer.from('0061736d0100000000800800', 'hex'), Buffer.alloc(1023)]);
  assert.equal(wasm.length, 1035);
  assert.equal(WebAssembly.validate(wasm), true);
  const file = path.join(sizeRoot, 'canonical-native.wasm');
  const example = { id: 'size-regression', provider: 'node', guestWasmBytes: 1035 };
  fs.writeFileSync(file, wasm);
  assert.deepEqual(verifyDefaultNativeSizes(example, sizeRoot), { guestWasmBytes: 1035, wasmBytes: 0 });
  assert.throws(() => verifyDefaultNativeSizes({ ...example, guestWasmBytes: 1034 }, sizeRoot), /documented application guest Wasm size changed/);
  fs.writeFileSync(file, Buffer.alloc(1024 * 1024));
  assert.throws(() => verifyDefaultNativeSizes(example, sizeRoot), /unexpected size/);
  fs.rmSync(file);
  assert.throws(() => verifyDefaultNativeSizes(example, sizeRoot), /did not produce canonical-native.wasm/);
} finally {
  fs.rmSync(sizeRoot, { recursive: true, force: true });
}

// Exercise the real seal orchestration with child execution isolated. A failing
// size preflight must stop before audits, unit tests and the long release replay.
const childProcess = require('node:child_process');
const sealModule = require.resolve('../../../scripts/validate-release.cjs');
const originalSpawn = childProcess.spawnSync;
const originalWrite = process.stdout.write;
const commands = [];
let output = '';
let failSizes = true;
try {
  childProcess.spawnSync = (command, args) => {
    // Preserve source identity inspection without spawning test/build processes.
    if (command === 'git') return originalSpawn(command, args, { encoding: 'utf8' });
    commands.push([command, ...args]);
    if (command !== process.execPath && (args.includes('version') || args.includes('--version'))) return { status: 1, stdout: '', stderr: '' };
    const fail = failSizes ? args.includes('sizes') : args.includes('--profile');
    return { status: fail ? 1 : 0, signal: null };
  };
  process.stdout.write = (chunk) => { output += chunk; return true; };
  delete require.cache[sealModule];
  const seal = require(sealModule);
  assert.throws(() => seal.main(['--skip-install', '--no-report']),
    (error) => error.code === 'PULSE_RELEASE_SEAL_STEP_FAILED' && error.step.id === 'documentation-sizes');
  assert.ok(commands.some((args) => args.includes('build')));
  assert.ok(commands.some((args) => args.includes('sizes')));
  assert.ok(!commands.some((args) => args.includes('test') || args.includes('--profile') || args.includes('scripts/audit-production-dependencies.cjs')));
  assert.match(output, /Step 4 failed: documentation-sizes/);
  commands.length = 0;
  failSizes = false;
  assert.throws(() => seal.main(['--skip-install', '--no-report']),
    (error) => error.code === 'PULSE_RELEASE_SEAL_STEP_FAILED' && error.step.id === 'release');
  const replay = commands.find((args) => args.includes('--profile'));
  assert.deepEqual(replay.slice(1), ['wasm/scripts/run-wasm-tests.cjs', '--profile', 'release', '--report', '.test-results/release-tasks.json']);
  assert.ok(commands.findIndex((args) => args.includes('sizes')) < commands.findIndex((args) => args.includes('--profile')));
} finally {
  childProcess.spawnSync = originalSpawn;
  process.stdout.write = originalWrite;
  delete require.cache[sealModule];
}

console.log('ok - release seals accept the Node 24 line while preserving the exact reproducible toolchain pin and require only Fastly CLI-owned local execution');
