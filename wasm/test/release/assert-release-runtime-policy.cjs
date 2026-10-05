#!/usr/bin/env node
'use strict';

require('./assert-pnpm-toolchain.cjs');
require('./assert-release-shared-pack.cjs');

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
// shared pack must stop before consumer replay; size assertions remain in the
// complete documentation tasks instead of running twice.
async function verifySealOrchestration() {
  const supervisor = require('../../../scripts/release-process.cjs');
  const sealModule = require.resolve('../../../scripts/validate-release.cjs');
  const originalRun = supervisor.runCommand;
  const originalWrite = process.stdout.write;
  const commands = [];
  let output = '';
  let failPack = true;
  try {
    supervisor.runCommand = async (command, args, options) => {
      if (args[0] === '-e') return originalRun(command, args, options); // real bounded cleanup
      commands.push([command, ...args]);
      if (command !== process.execPath && (args.includes('version') || args.includes('--version'))) return { status: 1, stdout: '', stderr: '' };
      if (!failPack && args.includes('scripts/release-shared-pack.cjs')) {
        const directory = args[args.indexOf('--out') + 1];
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'pulse-shared-pack.json'), '{}');
      }
      if (args.includes('--profile')) {
        assert(options.env.PULSE_RELEASE_SHARED_PACK);
        assert.match(options.env.PULSE_RELEASE_SHARED_PACK_SHA256, /^[a-f0-9]{64}$/);
      }
      const fail = failPack ? args.includes('scripts/release-shared-pack.cjs') : args.includes('--profile');
      return { status: fail ? 1 : 0, signal: null };
    };
    process.stdout.write = (chunk) => { output += chunk; return true; };
    delete require.cache[sealModule];
    const seal = require(sealModule);
    await assert.rejects(() => seal.main(['--skip-install', '--no-report']),
      (error) => error.code === 'PULSE_RELEASE_SEAL_STEP_FAILED' && error.step.id === 'shared-pack');
    assert.ok(commands.some((args) => args.includes('build')));
    assert.ok(!commands.some((args) => args.includes('sizes') || args.includes('--profile')));
    assert.match(output, /failed: shared-pack/);
    commands.length = 0;
    failPack = false;
    await assert.rejects(() => seal.main(['--skip-install', '--no-report']),
      (error) => error.code === 'PULSE_RELEASE_SEAL_STEP_FAILED' && error.step.id === 'release');
    const replay = commands.find((args) => args.includes('--profile'));
    assert.deepEqual(replay.slice(1), ['wasm/scripts/run-wasm-tests.cjs', '--profile', 'release', '--report', '.test-results/release-tasks.json']);
    assert.ok(commands.findIndex((args) => args.includes('scripts/release-shared-pack.cjs')) < commands.findIndex((args) => args.includes('--profile')));
  } finally {
    supervisor.runCommand = originalRun;
    process.stdout.write = originalWrite;
    delete require.cache[sealModule];
  }

  console.log('ok - release seals accept the Node 24 line while preserving the exact reproducible toolchain pin and require only Fastly CLI-owned local execution');

}
verifySealOrchestration().catch(error => { console.error(error); process.exitCode = 1; });
