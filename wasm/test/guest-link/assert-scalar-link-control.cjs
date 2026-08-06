#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TEST_VERSION = 'pulse.guest-link-poc.scalar-control.v1';
const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'scalar');
const rustRoot = path.join(fixtureRoot, 'rust');
const rustManifest = path.join(rustRoot, 'Cargo.toml');
const rustSource = path.join(rustRoot, 'src', 'lib.rs');
const assemblyScriptSource = path.join(fixtureRoot, 'as', 'index.ts');
const assemblyScriptRoot = fs.realpathSync(path.join(wasmRoot, 'node_modules', 'assemblyscript'));
const binaryenRoot = fs.realpathSync(path.resolve(assemblyScriptRoot, '..', 'binaryen'));
const asc = path.join(assemblyScriptRoot, 'bin', 'asc.js');
const wasmMerge = path.join(binaryenRoot, 'bin', 'wasm-merge');
const wasmOpt = path.join(binaryenRoot, 'bin', 'wasm-opt');
const wasmDis = path.join(binaryenRoot, 'bin', 'wasm-dis');
const cargo = process.env.PULSE_RUST_CARGO || 'cargo';
const rustc = process.env.PULSE_RUSTC || 'rustc';
const recordedCommands = [];

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'guest-link-a1');
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out requires a directory');
      outputDirectory = path.resolve(repoRoot, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown scalar-link control option: ${token}`);
  }
  return Object.freeze({ outputDirectory });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizePath(value, workDirectory) {
  const absolute = path.resolve(value);
  if (absolute === workDirectory) return '<work>';
  if (absolute.startsWith(`${workDirectory}${path.sep}`)) {
    return `<work>/${path.relative(workDirectory, absolute).split(path.sep).join('/')}`;
  }
  if (absolute === repoRoot) return '<repo>';
  if (absolute.startsWith(`${repoRoot}${path.sep}`)) {
    return `<repo>/${path.relative(repoRoot, absolute).split(path.sep).join('/')}`;
  }
  return value;
}

function normalizeArgument(value, workDirectory) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (!path.isAbsolute(value)) return value;
  return normalizePath(value, workDirectory);
}

function run(command, args, options = {}) {
  const cwd = options.cwd || repoRoot;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${options.label || path.basename(command)} failed with status ${result.status}${detail ? `\n${detail}` : ''}`);
  }
  if (options.record === true) {
    recordedCommands.push(Object.freeze({
      cwd: normalizePath(cwd, options.workDirectory),
      command: options.commandName || path.basename(command),
      args: args.map((argument) => normalizeArgument(argument, options.workDirectory))
    }));
  }
  return Object.freeze({
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  });
}

function version(command, args, label) {
  const result = run(command, args, { label });
  return result.stdout || result.stderr;
}

function readModule(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(WebAssembly.validate(bytes), true, `${path.basename(file)} must be valid WebAssembly`);
  const module = new WebAssembly.Module(bytes);
  return Object.freeze({
    bytes,
    module,
    imports: WebAssembly.Module.imports(module),
    exports: WebAssembly.Module.exports(module)
  });
}

function parseFeatures(output) {
  return Object.freeze(output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('--enable-'))
    .map((line) => line.slice('--enable-'.length))
    .sort());
}

function inspectModule(file, label, workDirectory, featureArgs = []) {
  const module = readModule(file);
  const featureOutput = path.join(workDirectory, `${label}-feature-inspection.wasm`);
  const metricsOutput = path.join(workDirectory, `${label}-metrics-inspection.wasm`);
  const features = run(wasmOpt, [
    file,
    ...featureArgs,
    '--print-features',
    '-o',
    featureOutput
  ], { label: `${label} feature inspection` }).stdout;
  const metrics = run(wasmOpt, [
    file,
    ...featureArgs,
    '--metrics',
    '-o',
    metricsOutput
  ], { label: `${label} metrics inspection` });
  const metricsText = [metrics.stdout, metrics.stderr].filter(Boolean).join('\n');
  const memoryMatch = metricsText.match(/\[memories\]\s*:\s*(\d+)/);
  const functionMatch = metricsText.match(/\[funcs\]\s*:\s*(\d+)/);
  assert.ok(memoryMatch, `${label} metrics must report a memory count`);
  assert.ok(functionMatch, `${label} metrics must report a function count`);
  return Object.freeze({
    bytes: module.bytes.length,
    sha256: sha256(module.bytes),
    imports: module.imports,
    exports: module.exports,
    functions: Number(functionMatch[1]),
    memories: Number(memoryMatch[1]),
    features: parseFeatures(features)
  });
}

function buildRun(label, workDirectory, cargoEnvironment) {
  const runRoot = path.join(workDirectory, label);
  const rustTarget = path.join(runRoot, 'rust-target');
  const primaryWasm = path.join(runRoot, 'primary.wasm');
  const guestWasm = path.join(
    rustTarget,
    'wasm32v1-none',
    'release',
    'pulse_guest_link_scalar.wasm'
  );
  const mergedWasm = path.join(runRoot, 'merged.wasm');
  const finalWasm = path.join(runRoot, 'final.wasm');
  const finalWat = path.join(runRoot, 'final.wat');
  fs.mkdirSync(runRoot, { recursive: true });

  run(cargo, [
    'rustc',
    '--manifest-path',
    rustManifest,
    '--frozen',
    '--release',
    '--target',
    'wasm32v1-none',
    '--target-dir',
    rustTarget
  ], {
    env: cargoEnvironment,
    label: `${label} Rust guest build`,
    record: true,
    commandName: 'cargo',
    workDirectory
  });
  assert.equal(fs.existsSync(guestWasm), true, `${label} Rust guest artifact must exist`);

  run(process.execPath, [
    asc,
    assemblyScriptSource,
    '--outFile',
    primaryWasm,
    '--runtime',
    'stub',
    '--optimizeLevel',
    '0',
    '--shrinkLevel',
    '0'
  ], {
    label: `${label} AssemblyScript primary build`,
    record: true,
    commandName: 'node',
    workDirectory
  });

  run(wasmMerge, [
    primaryWasm,
    'pulse_primary',
    guestWasm,
    'pulse_guest_scalar',
    '--enable-multimemory',
    '--rename-export-conflicts',
    '-o',
    mergedWasm
  ], {
    label: `${label} Binaryen merge`,
    record: true,
    commandName: 'wasm-merge',
    workDirectory
  });

  const validation = run(wasmOpt, [
    mergedWasm,
    '--enable-multimemory',
    '--print-features',
    '-o',
    finalWasm
  ], {
    label: `${label} Binaryen validation`,
    record: true,
    commandName: 'wasm-opt',
    workDirectory
  });

  run(wasmDis, [
    finalWasm,
    '--enable-multimemory',
    '-o',
    finalWat
  ], {
    label: `${label} Binaryen disassembly`,
    record: true,
    commandName: 'wasm-dis',
    workDirectory
  });

  return Object.freeze({
    primaryWasm,
    guestWasm,
    mergedWasm,
    finalWasm,
    finalWat,
    validationFeatures: parseFeatures(validation.stdout)
  });
}

function scalarMix(left, right) {
  const leftValue = left >>> 0;
  const rightValue = right >>> 0;
  const rotated = ((leftValue << 5) | (leftValue >>> 27)) >>> 0;
  return (rotated ^ Math.imul(rightValue, 0x9e3779b9) ^ 0x50554c53) >>> 0;
}

function executeControl(finalWasm) {
  const bytes = fs.readFileSync(finalWasm);
  const first = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
  const second = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
  const cases = Object.freeze([
    [0, 0],
    [1, 2],
    [7, 11],
    [0xffff_ffff, 0],
    [0, 0xffff_ffff],
    [0x0123_4567, 0x89ab_cdef]
  ]);
  const results = [];
  for (const [left, right] of cases) {
    const expected = scalarMix(left, right);
    const firstValue = first.exports.pulseScalarLinkControl(left, right) >>> 0;
    const repeatedValue = first.exports.pulseScalarLinkControl(left, right) >>> 0;
    const secondValue = second.exports.pulseScalarLinkControl(left, right) >>> 0;
    assert.equal(firstValue, expected, `scalar control result for ${left}, ${right}`);
    assert.equal(repeatedValue, expected, `repeated scalar control result for ${left}, ${right}`);
    assert.equal(secondValue, expected, `second-instance scalar control result for ${left}, ${right}`);
    results.push(Object.freeze({ left: left >>> 0, right: right >>> 0, result: expected }));
  }
  return Object.freeze(results);
}

function sourceRecord(file) {
  const bytes = fs.readFileSync(file);
  return Object.freeze({
    file: path.relative(repoRoot, file).split(path.sep).join('/'),
    bytes: bytes.length,
    sha256: sha256(bytes)
  });
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-guest-link-a1-'));
  const cargoEnvironment = {
    ...process.env,
    CARGO_INCREMENTAL: '0',
    CARGO_NET_OFFLINE: 'true'
  };
  try {
    const toolchain = Object.freeze({
      node: process.version,
      rustc: version(rustc, ['--version'], 'rustc version'),
      cargo: version(cargo, ['--version'], 'cargo version'),
      assemblyscript: version(process.execPath, [asc, '--version'], 'AssemblyScript version'),
      binaryen: Object.freeze({
        wasmMerge: version(wasmMerge, ['--version'], 'wasm-merge version'),
        wasmOpt: version(wasmOpt, ['--version'], 'wasm-opt version'),
        wasmDis: version(wasmDis, ['--version'], 'wasm-dis version')
      })
    });

    const first = buildRun('run-a', workDirectory, cargoEnvironment);
    const second = buildRun('run-b', workDirectory, cargoEnvironment);
    const firstPrimary = fs.readFileSync(first.primaryWasm);
    const secondPrimary = fs.readFileSync(second.primaryWasm);
    const firstGuest = fs.readFileSync(first.guestWasm);
    const secondGuest = fs.readFileSync(second.guestWasm);
    const firstFinal = fs.readFileSync(first.finalWasm);
    const secondFinal = fs.readFileSync(second.finalWasm);
    assert.deepEqual(firstPrimary, secondPrimary, 'AssemblyScript primary bytes must be deterministic');
    assert.deepEqual(firstGuest, secondGuest, 'Rust guest bytes must be deterministic');
    assert.deepEqual(firstFinal, secondFinal, 'linked final bytes must be deterministic');

    const primary = inspectModule(first.primaryWasm, 'primary', workDirectory);
    const guest = inspectModule(first.guestWasm, 'guest', workDirectory);
    const final = inspectModule(
      first.finalWasm,
      'final',
      workDirectory,
      ['--enable-multimemory']
    );
    assert.deepEqual(primary.imports, [{
      module: 'pulse_guest_scalar',
      name: 'pulse_guest_scalar_mix',
      kind: 'function'
    }]);
    assert.deepEqual(guest.imports, [], 'Rust guest must not import host or WASI functions');
    assert.deepEqual(final.imports, [], 'the final module must have no unresolved imports');
    assert.equal(guest.functions, 1, 'the allocator-free Rust guest must contain only its scalar function');
    assert.equal(final.functions, 2, 'the final module must contain only the caller and guest scalar functions');
    assert.equal(primary.memories, 1, 'the AssemblyScript primary must retain its normal memory');
    assert.equal(guest.memories, 1, 'the Rust guest must retain its independently owned memory');
    assert.equal(final.memories, 2, 'the scalar control must report both independent memories');
    assert.ok(final.features.includes('multimemory'), 'the merged scalar control must report multimemory');
    assert.deepEqual(first.validationFeatures, second.validationFeatures);

    const finalWat = fs.readFileSync(first.finalWat, 'utf8');
    assert.match(finalWat, /\(call\s+\$\d+/, 'the final caller must contain an internal direct call');
    assert.doesNotMatch(finalWat, /\(import\s/, 'the final module must not contain imports');
    assert.doesNotMatch(finalWat, /\(start\s/, 'the final module must not contain start behavior');
    const execution = executeControl(first.finalWasm);

    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const primaryOutput = path.join(options.outputDirectory, 'guest-link-poc-primary.wasm');
    const guestOutput = path.join(options.outputDirectory, 'guest-link-poc-guest.wasm');
    const finalOutput = path.join(options.outputDirectory, 'guest-link-poc.wasm');
    const watOutput = path.join(options.outputDirectory, 'guest-link-poc.wat');
    const reportOutput = path.join(options.outputDirectory, 'guest-link-poc-report.json');
    fs.copyFileSync(first.primaryWasm, primaryOutput);
    fs.copyFileSync(first.guestWasm, guestOutput);
    fs.copyFileSync(first.finalWasm, finalOutput);
    fs.copyFileSync(first.finalWat, watOutput);

    const report = Object.freeze({
      version: TEST_VERSION,
      status: 'passed',
      scope: Object.freeze({
        unit: 'A1',
        purpose: 'scalar-link-control',
        phaseADecision: 'not-evaluated',
        byteMemoryInteroperabilityClaim: false,
        productionPipelineClaim: false
      }),
      toolchain,
      environment: Object.freeze({
        rustTarget: 'wasm32v1-none',
        cargoFrozen: true,
        cargoOffline: true,
        binaryenOwnership: 'assemblyscript-transitive-spike-only'
      }),
      sources: Object.freeze([
        sourceRecord(path.join(rustRoot, 'Cargo.toml')),
        sourceRecord(path.join(rustRoot, 'Cargo.lock')),
        sourceRecord(rustSource),
        sourceRecord(assemblyScriptSource)
      ]),
      commands: Object.freeze(recordedCommands),
      modules: Object.freeze({
        primary: Object.freeze({
          file: path.basename(primaryOutput),
          ...primary
        }),
        guest: Object.freeze({
          file: path.basename(guestOutput),
          language: 'Rust',
          noStd: true,
          allocator: false,
          hostImports: false,
          wasiImports: false,
          ...guest
        }),
        final: Object.freeze({
          file: path.basename(finalOutput),
          watFile: path.basename(watOutput),
          ...final
        })
      }),
      link: Object.freeze({
        primaryModuleName: 'pulse_primary',
        guestModuleName: 'pulse_guest_scalar',
        requestedImport: 'pulse_guest_scalar.pulse_guest_scalar_mix',
        resolvedToInternalCall: true,
        unresolvedImports: 0
      }),
      memory: Object.freeze({
        topology: 'two-independent-memories',
        primaryMemories: primary.memories,
        guestMemories: guest.memories,
        finalMemories: final.memories,
        pointerEquivalenceClaim: false,
        acceptedV1Candidate: false,
        nextRequiredGate: 'A2 memory experiment matrix'
      }),
      execution,
      checks: Object.freeze([
        'rust-no-std-guest-built',
        'guest-has-no-host-or-wasi-imports',
        'assemblyscript-import-resolved',
        'binaryen-merge-validated',
        'final-module-has-no-imports',
        'final-call-is-internal',
        'node-execution-passed',
        'behavior-is-deterministic',
        'input-and-final-bytes-are-deterministic',
        'no-byte-memory-claim-made'
      ])
    });
    fs.writeFileSync(reportOutput, `${JSON.stringify(report, null, 2)}\n`);

    console.log(`ok - scalar Rust guest linked into one deterministic module and executed in Node (${final.bytes} bytes, ${final.sha256})`);
    console.log(`report - ${path.relative(repoRoot, reportOutput).split(path.sep).join('/')}`);
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

main();
