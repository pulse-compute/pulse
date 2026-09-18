#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const unitRoot = __dirname;
const sourceDirectory = path.join(unitRoot, 'source');
const prebuiltDirectory = path.join(unitRoot, 'prebuilt');
const manifestFile = path.join(unitRoot, 'pulse.guest-unit.json');
const repoRoot = path.resolve(unitRoot, '..', '..', '..', '..');
const {
  fileRecord,
  sha256,
  sourceTreeRecord,
  stableJson,
} = require(path.join(
  repoRoot,
  'wasm/packages/wasm-guest-link/src/files.js',
));
const {
  binaryenIdentity,
  runTool,
} = require(path.join(
  repoRoot,
  'wasm/packages/wasm-guest-link/src/toolchain.js',
));
const {
  optimizationPostures,
} = require(path.join(
  repoRoot,
  'wasm/packages/wasm-guest-link/src/constants.js',
));

const EXPECTED_RUSTC = '1.97.1 (8bab26f4f 2026-07-14)';
const EXPECTED_CARGO = '1.97.1 (c980f4866 2026-06-30)';
const TARGET = 'wasm32v1-none';
const CRATE_STEM = 'pulse_es256_rustcrypto_verifier.wasm';
const BUILD_IDENTITY = 'pulse.crypto.es256.rustcrypto-build.v2';

function usage() {
  process.stderr.write('Usage: node build.cjs (--write|--check)\n');
  process.exitCode = 2;
}

function run(file, args, options = {}) {
  const result = childProcess.spawnSync(file, args, {
    cwd: options.cwd || sourceDirectory,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    timeout: options.timeoutMs || 300_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${path.basename(file)} failed (${result.status}): ` +
      `${String(result.stderr || result.error || '').trim()}`,
    );
  }
  return String(result.stdout || '').trim();
}

function version(executable, kind) {
  const prefix = `${kind} `;
  const output = run(executable, ['--version'], { timeoutMs: 30_000 });
  if (!output.startsWith(prefix)) {
    throw new Error(`Unexpected ${kind} version output.`);
  }
  return output.slice(prefix.length);
}

function buildOnce(cargo, sequence) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), `pulse-es256-g1-build-${sequence}-`),
  );
  const targetDirectory = path.join(directory, 'target');
  const rawFile = path.join(
    targetDirectory,
    TARGET,
    'release',
    CRATE_STEM,
  );
  const optimizedFile = path.join(directory, 'es256-verifier.wasm');
  const environment = {
    ...process.env,
    CARGO_TARGET_DIR: targetDirectory,
  };
  try {
    run(cargo, [
      'build',
      '--manifest-path',
      path.join(sourceDirectory, 'Cargo.toml'),
      '--locked',
      '--release',
      '--target',
      TARGET,
    ], {
      env: environment,
    });
    runTool('wasm-opt', [
      rawFile,
      ...optimizationPostures['native-size'],
      '-o',
      optimizedFile,
    ], {
      cwd: directory,
      timeoutMs: 120_000,
    });
    return Object.freeze({
      directory,
      raw: fs.readFileSync(rawFile),
      optimized: fs.readFileSync(optimizedFile),
    });
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function manifest(source, lock, artifact, rustc, cargo, binaryen) {
  const wasmOpt = binaryen.tools.find((entry) => entry.name === 'wasm-opt');
  assert.ok(wasmOpt);
  const buildScript = fs.readFileSync(__filename);
  // Historical source-selection attestation is pinned in the reviewed guest
  // catalog. Reconstruction must not depend on ignored local evidence files.
  const g0SourceDecisionSha256 = '58db9e3587ace112a8864c7916f603d8773dce653deafb7d743c0dc1f4d62d63';
  return Object.freeze({
    version: 'pulse.guest-unit.v2',
    id: 'pulse.crypto.es256.rustcrypto-p256.v1',
    module: 'pulse_crypto_es256',
    owner: '@pulse-compute/crypto',
    packageVersion: '1.0.0-beta.5',
    abi: 'pulse.crypto.es256.verify-and-sign.v2',
    origin: 'package-prebuilt',
    artifact: Object.freeze({
      file: 'prebuilt/es256-verifier.wasm',
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    }),
    source: Object.freeze({
      included: true,
      directory: 'source',
      treeSha256: source.sha256,
    }),
    toolchain: Object.freeze({
      kind: 'rust-cargo',
      target: TARGET,
      locked: true,
      versions: Object.freeze({
        rustc,
        cargo,
        binaryen: binaryen.version,
      }),
    }),
    imports: Object.freeze([Object.freeze({
      module: 'env',
      name: 'memory',
      kind: 'memory',
      type: Object.freeze({
        minimumPages: 32,
        maximumPages: 32,
        shared: false,
      }),
    })]),
    exports: Object.freeze(['pulse_crypto_es256_sign', 'pulse_crypto_es256_verify'].map(name => Object.freeze({
      name,
      kind: 'function',
      parameters: Object.freeze(['i32', 'i32']),
      results: Object.freeze(['i32']),
      role: 'abi',
    }))),
    memory: Object.freeze({
      identity: 'pulse.guest-memory.invocation-frame.v2',
      import: 'env.memory',
      owner: 'link-stage',
    }),
    start: Object.freeze({
      policy: 'forbidden',
    }),
    features: Object.freeze({
      baseline: 'mvp',
      allowed: Object.freeze([]),
      required: Object.freeze([]),
    }),
    provenance: Object.freeze({
      packageManifest: '../../package.json',
      lockfile: 'source/Cargo.lock',
      reproducibleSourceIncluded: true,
      cargoLockSha256: lock.sha256,
      sourceTreeSha256: source.sha256,
      reconstructionCommandIdentity: BUILD_IDENTITY,
      buildScript: 'build.cjs',
      buildScriptSha256: sha256(buildScript),
      optimizationPosture: 'native-size',
      binaryenWasmOptSha256: wasmOpt.sha256,
      g0SourceDecision:
        '../../../../wasm/.test-results/jwt-g0/es256-source-decision.json',
      g0SourceDecisionSha256,
    }),
  });
}

function compareBytes(label, actual, expectedFile) {
  assert.equal(fs.existsSync(expectedFile), true, `${label} is missing`);
  assert.deepEqual(actual, fs.readFileSync(expectedFile), `${label} differs`);
}

function main() {
  const mode = process.argv[2];
  if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
    usage();
    return;
  }
  const cargoExecutable = process.env.CARGO || 'cargo';
  const rustcExecutable = process.env.RUSTC || 'rustc';
  const rustcVersion = version(rustcExecutable, 'rustc');
  const cargoVersion = version(cargoExecutable, 'cargo');
  assert.equal(rustcVersion, EXPECTED_RUSTC);
  assert.equal(cargoVersion, EXPECTED_CARGO);

  let first;
  let second;
  try {
    first = buildOnce(cargoExecutable, 'a');
    second = buildOnce(cargoExecutable, 'b');
    assert.deepEqual(first.raw, second.raw, 'Cargo release bytes differ');
    assert.deepEqual(
      first.optimized,
      second.optimized,
      'Binaryen optimized bytes differ',
    );
    const source = sourceTreeRecord(sourceDirectory);
    const lock = fileRecord(path.join(sourceDirectory, 'Cargo.lock'));
    const artifact = Object.freeze({
      bytes: first.optimized.length,
      sha256: sha256(first.optimized),
    });
    const expectedManifest = stableJson(manifest(
      source,
      lock,
      artifact,
      rustcVersion,
      cargoVersion,
      binaryenIdentity(),
    ));
    const rawFile = path.join(
      prebuiltDirectory,
      'es256-verifier.unoptimized.wasm',
    );
    const optimizedFile = path.join(
      prebuiltDirectory,
      'es256-verifier.wasm',
    );

    if (mode === '--write') {
      fs.mkdirSync(prebuiltDirectory, { recursive: true });
      fs.writeFileSync(rawFile, first.raw);
      fs.writeFileSync(optimizedFile, first.optimized);
      fs.writeFileSync(manifestFile, expectedManifest);
    } else {
      compareBytes('unoptimized prebuilt', first.raw, rawFile);
      compareBytes('optimized prebuilt', first.optimized, optimizedFile);
      assert.equal(
        fs.readFileSync(manifestFile, 'utf8'),
        expectedManifest,
        'guest manifest differs',
      );
    }

    process.stdout.write(
      `ok - ${BUILD_IDENTITY} reproduced ${artifact.sha256}\n`,
    );
  } finally {
    if (first) {
      fs.rmSync(first.directory, { recursive: true, force: true });
    }
    if (second) {
      fs.rmSync(second.directory, { recursive: true, force: true });
    }
  }
}

main();
