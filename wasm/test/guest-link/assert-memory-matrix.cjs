#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPORT_VERSION = 'pulse.guest-link-poc.memory.v1';
const PAGE_BYTES = 65536;
const MEMORY_PAGES = 32;
const MEMORY_BYTES = MEMORY_PAGES * PAGE_BYTES;
const RUST_STACK_BYTES = PAGE_BYTES;
const RUST_GLOBAL_BASE = 2 * PAGE_BYTES;
const AS_MEMORY_BASE = 4 * PAGE_BYTES;
const VALID_BASE = 8 * PAGE_BYTES;
const MAX_LENGTH_POINTER = VALID_BASE + 2048;
const MAX_GUEST_LENGTH = 4096;
const INVALID_RANGE = 0x8000_0000;
const VALID_RESULT_MASK = 0x7fff_ffff;
const FNV_OFFSET_BASIS = 0x811c_9dc5;
const FNV_PRIME = 0x0100_0193;
const GUEST_DOMAIN = Object.freeze([0x50, 0x4c, 0x53, 0x32]);
const PRIMARY_LAYOUT_MARKER = Buffer.from('AS-A2-MARKER-01!', 'ascii');
const GUEST_LAYOUT_MARKER = Buffer.from('PLS2RU-A2-MARKER', 'ascii');

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'memory');
const rustRoot = path.join(fixtureRoot, 'rust');
const rustManifest = path.join(rustRoot, 'Cargo.toml');
const rustSource = path.join(rustRoot, 'src', 'lib.rs');
const negativeSource = path.join(fixtureRoot, 'as', 'negative.ts');
const candidateSource = path.join(fixtureRoot, 'as', 'candidate.ts');
const ownerSource = path.join(fixtureRoot, 'owner.wat');
const assemblyScriptRoot = fs.realpathSync(path.join(wasmRoot, 'node_modules', 'assemblyscript'));
const binaryenRoot = fs.realpathSync(path.resolve(assemblyScriptRoot, '..', 'binaryen'));
const asc = path.join(assemblyScriptRoot, 'bin', 'asc.js');
const wasmAs = path.join(binaryenRoot, 'bin', 'wasm-as');
const wasmMerge = path.join(binaryenRoot, 'bin', 'wasm-merge');
const wasmOpt = path.join(binaryenRoot, 'bin', 'wasm-opt');
const wasmDis = path.join(binaryenRoot, 'bin', 'wasm-dis');
const cargo = process.env.PULSE_RUST_CARGO || 'cargo';
const rustc = process.env.PULSE_RUSTC || 'rustc';
const recordedCommands = [];

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'guest-link-a2');
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out requires a directory');
      outputDirectory = path.resolve(repoRoot, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown memory-matrix option: ${token}`);
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
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
    return value;
  }
  return normalizePath(value, workDirectory);
}

function run(command, args, options = {}) {
  const cwd = options.cwd || repoRoot;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 32 * 1024 * 1024
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

function runExpectedFailure(command, args, options = {}) {
  const cwd = options.cwd || repoRoot;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0, `${options.label || path.basename(command)} must fail`);
  const rawDiagnostic = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const diagnostic = rawDiagnostic
    .split(options.workDirectory || '\0')
    .join('<work>');
  recordedCommands.push(Object.freeze({
    cwd: normalizePath(cwd, options.workDirectory),
    command: options.commandName || path.basename(command),
    args: args.map((argument) => normalizeArgument(argument, options.workDirectory)),
    expectedFailure: true,
    exitStatus: result.status
  }));
  return Object.freeze({ exitStatus: result.status, diagnostic });
}

function probeNegativeMultiMemoryLowering(artifact, workDirectory) {
  const output = path.join(workDirectory, 'negative-lowering-probe.wasm');
  const result = runExpectedFailure(wasmOpt, [
    artifact,
    '--mvp-features',
    '--enable-multimemory',
    '--enable-bulk-memory-opt',
    '--multi-memory-lowering',
    '-o',
    output
  ], {
    label: 'negative multi-memory lowering probe',
    commandName: 'wasm-opt',
    workDirectory
  });
  assert.match(
    result.diagnostic,
    /MultiMemoryLowering: only the first memory can be exported/i,
    'negative lowering rejection must identify the two exported memories'
  );
  assert.equal(fs.existsSync(output), false, 'rejected lowering must not produce output');
  return Object.freeze({
    attempted: true,
    transformationApplied: false,
    result: 'rejected',
    reason: 'Both independently owned memories remain exported, and Binaryen only permits the first memory export during lowering.',
    diagnostic: result.diagnostic
  });
}

function version(command, args, label) {
  const result = run(command, args, { label });
  return result.stdout || result.stderr;
}

function parseFeatures(output) {
  return Object.freeze(output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('--enable-'))
    .map((line) => line.slice('--enable-'.length))
    .sort());
}

function metric(metrics, name, label) {
  const match = metrics.match(new RegExp(`\\[${name}\\]\\s*:\\s*(\\d+)`));
  assert.ok(match, `${label} metrics must report ${name}`);
  return Number(match[1]);
}

function readUleb(bytes, start, label) {
  let value = 0;
  let shift = 0;
  let cursor = start;
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    cursor += 1;
    value += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) {
      return Object.freeze({ value, next: cursor });
    }
    shift += 7;
    assert.ok(shift <= 35, `${label} ULEB must fit in 32 bits`);
  }
  assert.fail(`${label} has a truncated ULEB`);
}

function readSleb32(bytes, start, label) {
  let value = 0;
  let shift = 0;
  let cursor = start;
  let byte = 0;
  do {
    assert.ok(cursor < bytes.length, `${label} has a truncated SLEB`);
    byte = bytes[cursor];
    cursor += 1;
    value |= (byte & 0x7f) << shift;
    shift += 7;
    assert.ok(shift <= 35, `${label} SLEB must fit in 32 bits`);
  } while ((byte & 0x80) !== 0);
  if (shift < 32 && (byte & 0x40) !== 0) {
    value |= (~0 << shift);
  }
  return Object.freeze({ value: value | 0, next: cursor });
}

function readLiteralI32Expression(bytes, start, label) {
  assert.equal(bytes[start], 0x41, `${label} offset must be a literal i32.const`);
  const literal = readSleb32(bytes, start + 1, label);
  assert.equal(bytes[literal.next], 0x0b, `${label} offset expression must end immediately`);
  assert.ok(literal.value >= 0, `${label} offset must be non-negative`);
  return Object.freeze({ value: literal.value, next: literal.next + 1 });
}

function parseDataSegments(bytes, label) {
  assert.equal(bytes.subarray(0, 4).toString('hex'), '0061736d', `${label} magic`);
  assert.equal(bytes.subarray(4, 8).toString('hex'), '01000000', `${label} version`);
  let cursor = 8;
  while (cursor < bytes.length) {
    const sectionId = bytes[cursor];
    cursor += 1;
    const size = readUleb(bytes, cursor, `${label} section size`);
    cursor = size.next;
    const sectionEnd = cursor + size.value;
    assert.ok(sectionEnd <= bytes.length, `${label} section must fit`);
    if (sectionId !== 11) {
      cursor = sectionEnd;
      continue;
    }
    const count = readUleb(bytes, cursor, `${label} data segment count`);
    cursor = count.next;
    const segments = [];
    for (let index = 0; index < count.value; index += 1) {
      const flags = readUleb(bytes, cursor, `${label} data segment ${index} flags`);
      cursor = flags.next;
      assert.notEqual(flags.value, 1, `${label} passive data segment ${index} is unresolved`);
      assert.ok(
        flags.value === 0 || flags.value === 2,
        `${label} data segment ${index} flags ${flags.value} are unsupported`
      );
      let memoryIndex = 0;
      if (flags.value === 2) {
        const memory = readUleb(bytes, cursor, `${label} data segment ${index} memory`);
        cursor = memory.next;
        memoryIndex = memory.value;
      }
      const offset = readLiteralI32Expression(
        bytes,
        cursor,
        `${label} data segment ${index}`
      );
      cursor = offset.next;
      const byteLength = readUleb(bytes, cursor, `${label} data segment ${index} length`);
      cursor = byteLength.next;
      const dataEnd = cursor + byteLength.value;
      assert.ok(dataEnd <= sectionEnd, `${label} data segment ${index} bytes must fit`);
      const payload = bytes.subarray(cursor, dataEnd);
      segments.push(Object.freeze({
        index,
        mode: 'active',
        memoryIndex,
        offset: offset.value,
        endExclusive: offset.value + payload.length,
        bytes: payload.length,
        sha256: sha256(payload),
        payloadHex: payload.toString('hex')
      }));
      cursor = dataEnd;
    }
    assert.equal(cursor, sectionEnd, `${label} data section must be fully decoded`);
    return Object.freeze(segments);
  }
  return Object.freeze([]);
}

function memoryTypes(wat) {
  const values = [];
  const pattern = /\(memory\s+\$[^\s)]+\s+(\d+)(?:\s+(\d+))?\)/g;
  for (const match of wat.matchAll(pattern)) {
    values.push(Object.freeze({
      minimumPages: Number(match[1]),
      maximumPages: match[2] === undefined ? null : Number(match[2])
    }));
  }
  return Object.freeze(values);
}

function mutableGlobals(wat) {
  const values = [];
  const pattern = /\(global\s+\$([^\s)]+)\s+\(mut\s+([^)]+)\)\s+\(([a-z0-9_.]+)\s+(-?\d+)\)\)/g;
  for (const match of wat.matchAll(pattern)) {
    values.push(Object.freeze({
      name: match[1],
      type: match[2],
      initializer: Object.freeze({
        instruction: match[3],
        value: Number(match[4])
      })
    }));
  }
  return Object.freeze(values);
}

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

function inspectModule(file, label, workDirectory, featureArgs = []) {
  const bytes = fs.readFileSync(file);
  assert.equal(WebAssembly.validate(bytes), true, `${label} must be valid WebAssembly`);
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  const explicitFeatureArgs = ['--mvp-features', ...featureArgs];
  const featureOutput = path.join(workDirectory, `${label}-feature-inspection.wasm`);
  const metricsOutput = path.join(workDirectory, `${label}-metrics-inspection.wasm`);
  const watOutput = path.join(workDirectory, `${label}.wat`);
  const features = run(wasmOpt, [
    file,
    ...explicitFeatureArgs,
    '--print-features',
    '-o',
    featureOutput
  ], { label: `${label} feature inspection` }).stdout;
  const metricResult = run(wasmOpt, [
    file,
    ...explicitFeatureArgs,
    '--metrics',
    '-o',
    metricsOutput
  ], { label: `${label} metrics inspection` });
  run(wasmDis, [
    file,
    ...explicitFeatureArgs,
    '-o',
    watOutput
  ], { label: `${label} disassembly` });
  const metrics = [metricResult.stdout, metricResult.stderr].filter(Boolean).join('\n');
  const wat = fs.readFileSync(watOutput, 'utf8');
  const dataSegments = parseDataSegments(bytes, label);
  const dataBytes = metric(metrics, 'memory-data', label);
  assert.equal(
    dataSegments.reduce((sum, segment) => sum + segment.bytes, 0),
    dataBytes,
    `${label} binary data segment bytes must match Binaryen metrics`
  );
  const definedMemories = metric(metrics, 'memories', label);
  const importedMemories = imports.filter((entry) => entry.kind === 'memory').length;
  const definedTables = metric(metrics, 'tables', label);
  const importedTables = imports.filter((entry) => entry.kind === 'table').length;
  return Object.freeze({
    report: Object.freeze({
      bytes: bytes.length,
      sha256: sha256(bytes),
      imports,
      exports: WebAssembly.Module.exports(module),
      functions: metric(metrics, 'funcs', label),
      globals: metric(metrics, 'globals', label),
      mutableGlobals: mutableGlobals(wat),
      definedMemories,
      importedMemories,
      memories: definedMemories + importedMemories,
      memoryTypes: memoryTypes(wat),
      dataSegmentCount: dataSegments.length,
      dataBytes,
      dataSegments,
      definedTables,
      importedTables,
      tables: definedTables + importedTables,
      featureValidation: Object.freeze({
        baseline: 'mvp',
        explicitlyEnabled: Object.freeze(featureArgs
          .filter((entry) => entry.startsWith('--enable-'))
          .map((entry) => entry.slice('--enable-'.length))),
        binaryenReported: parseFeatures(features)
      }),
      hasStart: /\n\s*\(start\s/.test(wat),
      memoryGrowInstructions: countMatches(wat, /\(memory\.grow\b/g),
      memoryCopyInstructions: countMatches(wat, /\(memory\.copy\b/g),
      memoryFillInstructions: countMatches(wat, /\(memory\.fill\b/g),
      memoryInitInstructions: countMatches(wat, /\(memory\.init\b/g),
      globalGetInstructions: countMatches(wat, /\(global\.get\b/g),
      globalSetInstructions: countMatches(wat, /\(global\.set\b/g),
      loadInstructions: countMatches(
        wat,
        /\((?:i32|i64|f32|f64|v128)\.load(?:8_[su]|16_[su]|32_[su])?\b/g
      ),
      storeInstructions: countMatches(
        wat,
        /\((?:i32|i64|f32|f64|v128)\.store(?:8|16|32)?\b/g
      ),
      callIndirectInstructions: countMatches(wat, /\(call_indirect\b/g),
      byteLoads: countMatches(wat, /\(i32\.load8_u\b/g),
      byteStores: countMatches(wat, /\(i32\.store8\b/g)
    }),
    wat
  });
}

function buildRun(label, workDirectory, cargoEnvironment) {
  const runRoot = path.join(workDirectory, label);
  const negativeRustTarget = path.join(runRoot, 'rust-negative');
  const candidateRustTarget = path.join(runRoot, 'rust-candidate');
  const negativePrimary = path.join(runRoot, 'negative-primary.wasm');
  const candidatePrimary = path.join(runRoot, 'candidate-primary.wasm');
  const owner = path.join(runRoot, 'memory-owner.wasm');
  const negativeGuest = path.join(
    negativeRustTarget,
    'wasm32v1-none',
    'release',
    'pulse_guest_link_memory.wasm'
  );
  const candidateGuest = path.join(
    candidateRustTarget,
    'wasm32v1-none',
    'release',
    'pulse_guest_link_memory.wasm'
  );
  const negativeMerged = path.join(runRoot, 'negative-merged.wasm');
  const negativeFinal = path.join(runRoot, 'negative-final.wasm');
  const candidateMerged = path.join(runRoot, 'candidate-merged.wasm');
  const candidateFinal = path.join(runRoot, 'candidate-final.wasm');
  fs.mkdirSync(runRoot, { recursive: true });

  const record = {
    env: cargoEnvironment,
    record: true,
    commandName: 'cargo',
    workDirectory
  };
  run(cargo, [
    'rustc',
    '--manifest-path',
    rustManifest,
    '--frozen',
    '--release',
    '--target',
    'wasm32v1-none',
    '--target-dir',
    negativeRustTarget
  ], { ...record, label: `${label} owned-memory Rust guest` });
  run(cargo, [
    'rustc',
    '--manifest-path',
    rustManifest,
    '--frozen',
    '--release',
    '--target',
    'wasm32v1-none',
    '--target-dir',
    candidateRustTarget,
    '--',
    '-C',
    'link-arg=--import-memory=env,memory',
    '-C',
    'link-arg=-z',
    '-C',
    `link-arg=stack-size=${RUST_STACK_BYTES}`,
    '-C',
    'link-arg=--stack-first',
    '-C',
    `link-arg=--global-base=${RUST_GLOBAL_BASE}`,
    '-C',
    `link-arg=--initial-memory=${MEMORY_BYTES}`,
    '-C',
    `link-arg=--max-memory=${MEMORY_BYTES}`
  ], { ...record, label: `${label} imported-memory Rust guest` });
  assert.equal(fs.existsSync(negativeGuest), true, `${label} owned-memory guest must exist`);
  assert.equal(fs.existsSync(candidateGuest), true, `${label} imported-memory guest must exist`);

  run(process.execPath, [
    asc,
    negativeSource,
    '--outFile',
    negativePrimary,
    '--runtime',
    'stub',
    '--initialMemory',
    '16',
    '--maximumMemory',
    '16',
    '--optimizeLevel',
    '0',
    '--shrinkLevel',
    '0'
  ], {
    label: `${label} negative AssemblyScript primary`,
    record: true,
    commandName: 'node',
    workDirectory
  });
  run(process.execPath, [
    asc,
    candidateSource,
    '--outFile',
    candidatePrimary,
    '--runtime',
    'stub',
    '--importMemory',
    '--noExportMemory',
    '--initialMemory',
    String(MEMORY_PAGES),
    '--maximumMemory',
    String(MEMORY_PAGES),
    '--memoryBase',
    String(AS_MEMORY_BASE),
    '--optimizeLevel',
    '0',
    '--shrinkLevel',
    '0'
  ], {
    label: `${label} candidate AssemblyScript primary`,
    record: true,
    commandName: 'node',
    workDirectory
  });
  run(wasmAs, [
    ownerSource,
    '--mvp-features',
    '-o',
    owner
  ], {
    label: `${label} memory owner`,
    record: true,
    commandName: 'wasm-as',
    workDirectory
  });

  run(wasmMerge, [
    negativePrimary,
    'pulse_primary',
    negativeGuest,
    'pulse_guest_memory',
    '--mvp-features',
    '--enable-multimemory',
    '--rename-export-conflicts',
    '-o',
    negativeMerged
  ], {
    label: `${label} negative merge`,
    record: true,
    commandName: 'wasm-merge',
    workDirectory
  });
  run(wasmOpt, [
    negativeMerged,
    '--mvp-features',
    '--enable-multimemory',
    '--print-features',
    '-o',
    negativeFinal
  ], {
    label: `${label} negative validation`,
    record: true,
    commandName: 'wasm-opt',
    workDirectory
  });

  run(wasmMerge, [
    owner,
    'env',
    candidatePrimary,
    'pulse_primary',
    candidateGuest,
    'pulse_guest_memory',
    '--mvp-features',
    '--rename-export-conflicts',
    '-o',
    candidateMerged
  ], {
    label: `${label} candidate merge`,
    record: true,
    commandName: 'wasm-merge',
    workDirectory
  });
  run(wasmOpt, [
    candidateMerged,
    '--mvp-features',
    '--print-features',
    '-o',
    candidateFinal
  ], {
    label: `${label} candidate validation`,
    record: true,
    commandName: 'wasm-opt',
    workDirectory
  });

  return Object.freeze({
    negativePrimary,
    negativeGuest,
    negativeFinal,
    candidateOwner: owner,
    candidatePrimary,
    candidateGuest,
    candidateFinal
  });
}

function assertSameFile(first, second, label) {
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second), `${label} bytes must be deterministic`);
}

function segmentFacts(segments) {
  return Object.freeze(segments
    .map((segment) => Object.freeze({
      memoryIndex: segment.memoryIndex,
      offset: segment.offset,
      endExclusive: segment.endExclusive,
      bytes: segment.bytes,
      sha256: segment.sha256
    }))
    .sort((first, second) => (
      first.memoryIndex - second.memoryIndex
      || first.offset - second.offset
      || first.sha256.localeCompare(second.sha256)
    )));
}

function markerEvidence(moduleReport, marker, label) {
  const matches = [];
  for (const segment of moduleReport.dataSegments) {
    const payload = Buffer.from(segment.payloadHex, 'hex');
    const relativeOffset = payload.indexOf(marker);
    if (relativeOffset >= 0) {
      matches.push(Object.freeze({
        segment: Object.freeze({
          memoryIndex: segment.memoryIndex,
          start: segment.offset,
          endExclusive: segment.endExclusive,
          bytes: segment.bytes,
          sha256: segment.sha256
        }),
        marker: Object.freeze({
          start: segment.offset + relativeOffset,
          endExclusive: segment.offset + relativeOffset + marker.length,
          bytes: marker.length,
          sha256: sha256(marker)
        })
      }));
    }
  }
  assert.equal(matches.length, 1, `${label} must contain exactly one layout marker`);
  return matches[0];
}

function range(start, endExclusive, label) {
  assert.ok(Number.isInteger(start) && Number.isInteger(endExclusive), `${label} bounds`);
  assert.ok(start >= 0 && endExclusive >= start, `${label} must be a valid half-open range`);
  return Object.freeze({ label, start, endExclusive });
}

function rangesOverlap(first, second) {
  return first.start < second.endExclusive && second.start < first.endExclusive;
}

function assertPairwiseDisjoint(ranges, label) {
  for (let first = 0; first < ranges.length; first += 1) {
    for (let second = first + 1; second < ranges.length; second += 1) {
      assert.equal(
        rangesOverlap(ranges[first], ranges[second]),
        false,
        `${label}: ${ranges[first].label} overlaps ${ranges[second].label}`
      );
    }
  }
}

function fnv(bytes) {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of [...GUEST_DOMAIN, ...bytes]) {
    hash = Math.imul((hash ^ byte) >>> 0, FNV_PRIME) >>> 0;
  }
  return (hash & VALID_RESULT_MASK) >>> 0;
}

function pattern(length, seed) {
  return Uint8Array.from({ length }, (_, index) => (
    seed + index * 29 + (index << 1)
  ) & 0xff);
}

function validateNegativeControl(artifact, audits) {
  const { primary, guest, final } = audits;
  assert.deepEqual(primary.report.imports, [{
    module: 'pulse_guest_memory',
    name: 'pulse_guest_span_checksum',
    kind: 'function'
  }]);
  assert.deepEqual(guest.report.imports, []);
  assert.deepEqual(final.report.imports, []);
  assert.equal(primary.report.memories, 1);
  assert.equal(guest.report.memories, 1);
  assert.equal(final.report.memories, 2);
  assert.ok(final.report.featureValidation.binaryenReported.includes('multimemory'));
  assert.equal(primary.report.dataSegmentCount, 0);
  assert.ok(guest.report.dataSegmentCount > 0);
  assert.equal(final.report.dataSegmentCount, guest.report.dataSegmentCount);
  assert.deepEqual(
    segmentFacts(final.report.dataSegments).map((segment) => ({
      ...segment,
      memoryIndex: 0
    })),
    segmentFacts(guest.report.dataSegments),
    'negative guest data must move from input memory 0 to final memory 1'
  );
  assert.ok(final.report.dataSegments.every((segment) => segment.memoryIndex === 1));
  assert.equal(final.report.hasStart, false);
  assert.equal(guest.report.storeInstructions, 0);
  assert.match(final.wat, /\(i32\.store8 \$0\b/, 'negative primary must store into memory 0');
  assert.match(final.wat, /\(i32\.load8_u \$1\b/, 'negative guest must load from memory 1');
  assert.match(final.wat, /\(memory\.size \$1\b/, 'negative guest must query memory 1');

  const bytes = fs.readFileSync(artifact);
  const module = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(module, {});
  const memoryNames = final.report.exports
    .filter((entry) => entry.kind === 'memory')
    .map((entry) => entry.name);
  assert.equal(memoryNames.length, 2);
  const primaryMemory = instance.exports[memoryNames[0]];
  const guestMemory = instance.exports[memoryNames[1]];
  assert.ok(primaryMemory instanceof WebAssembly.Memory);
  assert.ok(guestMemory instanceof WebAssembly.Memory);

  const observed = instance.exports.pulseNegativeControl() >>> 0;
  const pointer = instance.exports.pulseNegativePointer() >>> 0;
  const length = instance.exports.pulseNegativeLength() >>> 0;
  const expectedPrimaryBytes = Uint8Array.from(
    { length },
    (_, index) => instance.exports.pulseNegativeByte(index) & 0xff
  );
  const primaryBytes = new Uint8Array(primaryMemory.buffer, pointer, length);
  const guestBytes = new Uint8Array(guestMemory.buffer, pointer, length);
  assert.deepEqual(primaryBytes, expectedPrimaryBytes);
  assert.deepEqual(guestBytes, new Uint8Array(length));
  const primaryChecksum = fnv(primaryBytes);
  const guestChecksum = fnv(guestBytes);
  assert.equal(observed, guestChecksum);
  assert.notEqual(observed, primaryChecksum);
  assert.equal(instance.exports.pulseNegativeControl() >>> 0, observed);
  const guestMarkerPointer = instance.exports.pulse_guest_layout_marker_pointer() >>> 0;
  assert.deepEqual(
    new Uint8Array(guestMemory.buffer, guestMarkerPointer, GUEST_LAYOUT_MARKER.length),
    new Uint8Array(GUEST_LAYOUT_MARKER),
    'negative guest marker must reside in the separately owned guest memory'
  );

  return Object.freeze({
    sameNumericPointer: pointer,
    length,
    primaryMemoryExport: memoryNames[0],
    guestMemoryExport: memoryNames[1],
    primaryBytes: Object.freeze([...primaryBytes]),
    guestBytes: Object.freeze([...guestBytes]),
    primaryChecksum,
    guestChecksum,
    observedGuestResult: observed,
    guestLayoutMarkerPointer: guestMarkerPointer,
    rawPointerEquivalenceRejected: true,
    reason: 'The AssemblyScript store targets memory 0 while the Rust load at the same numeric pointer targets memory 1.'
  });
}

function caseDefinitions() {
  return Object.freeze([
    Object.freeze({ id: 0, class: 'zero-length', pointer: VALID_BASE + 1, length: 0, seed: 0x11 }),
    Object.freeze({ id: 1, class: 'small', pointer: VALID_BASE + 17, length: 1, seed: 0x22 }),
    Object.freeze({ id: 2, class: 'unaligned', pointer: VALID_BASE + 35, length: 7, seed: 0x33 }),
    Object.freeze({ id: 3, class: 'aligned', pointer: VALID_BASE + 64, length: 32, seed: 0x44 }),
    Object.freeze({ id: 4, class: 'boundary-adjacent', pointer: MEMORY_BYTES - 65, length: 64, seed: 0x55 })
  ]);
}

function callWithoutTrap(fn, pointer, length, label) {
  try {
    return fn(pointer, length) >>> 0;
  } catch (error) {
    assert.fail(`${label} trapped: ${error && error.message ? error.message : error}`);
  }
}

function validateCandidate(artifact, audits) {
  const { owner, primary, guest, final } = audits;
  assert.deepEqual(owner.report.imports, []);
  assert.deepEqual(owner.report.exports, [{ name: 'memory', kind: 'memory' }]);
  assert.deepEqual(primary.report.imports, [
    {
      module: 'pulse_guest_memory',
      name: 'pulse_guest_span_checksum',
      kind: 'function'
    },
    { module: 'env', name: 'memory', kind: 'memory' }
  ]);
  assert.deepEqual(guest.report.imports, [{ module: 'env', name: 'memory', kind: 'memory' }]);
  assert.deepEqual(guest.report.exports, [
    { name: 'pulse_guest_layout_marker_pointer', kind: 'function' },
    { name: 'pulse_guest_span_checksum', kind: 'function' }
  ]);
  assert.deepEqual(final.report.imports, []);
  for (const [label, value] of Object.entries({ owner, primary, guest, final })) {
    assert.equal(value.report.memories, 1, `${label} must report one memory`);
    assert.deepEqual(value.report.memoryTypes, [{
      minimumPages: MEMORY_PAGES,
      maximumPages: MEMORY_PAGES
    }], `${label} memory type`);
    assert.equal(value.report.hasStart, false, `${label} must have no start function`);
    assert.equal(value.report.memoryGrowInstructions, 0, `${label} must not grow memory`);
    assert.equal(value.report.memoryCopyInstructions, 0, `${label} must not copy memory`);
    assert.equal(value.report.memoryFillInstructions, 0, `${label} must not fill memory`);
    assert.equal(value.report.memoryInitInstructions, 0, `${label} must not initialize memory at runtime`);
    assert.equal(value.report.importedTables, 0, `${label} must not import a table`);
    assert.equal(value.report.callIndirectInstructions, 0, `${label} must not dispatch indirectly`);
  }
  assert.equal(owner.report.tables, 0);
  assert.equal(guest.report.tables, 0);
  assert.equal(primary.report.tables, 1);
  assert.equal(final.report.tables, 0);
  assert.equal(
    final.report.exports.some((entry) => entry.kind === 'table'),
    false,
    'the inert AssemblyScript table must not be exported'
  );
  assert.equal(owner.report.definedMemories, 1);
  assert.equal(owner.report.importedMemories, 0);
  assert.equal(primary.report.definedMemories, 0);
  assert.equal(primary.report.importedMemories, 1);
  assert.equal(guest.report.definedMemories, 0);
  assert.equal(guest.report.importedMemories, 1);
  assert.equal(final.report.definedMemories, 1);
  assert.equal(final.report.importedMemories, 0);
  assert.equal(owner.report.dataSegmentCount, 0);
  assert.ok(primary.report.dataSegmentCount > 0);
  assert.ok(guest.report.dataSegmentCount > 0);
  assert.equal(
    final.report.dataSegmentCount,
    primary.report.dataSegmentCount + guest.report.dataSegmentCount
  );
  assert.deepEqual(
    segmentFacts(final.report.dataSegments),
    segmentFacts([...primary.report.dataSegments, ...guest.report.dataSegments]),
    'candidate merge must preserve every input data segment without relocation'
  );
  const primaryMarker = markerEvidence(
    primary.report,
    PRIMARY_LAYOUT_MARKER,
    'candidate primary'
  );
  const guestMarker = markerEvidence(
    guest.report,
    GUEST_LAYOUT_MARKER,
    'candidate guest'
  );
  const finalPrimaryMarker = markerEvidence(
    final.report,
    PRIMARY_LAYOUT_MARKER,
    'candidate final primary origin'
  );
  const finalGuestMarker = markerEvidence(
    final.report,
    GUEST_LAYOUT_MARKER,
    'candidate final guest origin'
  );
  assert.equal(primaryMarker.marker.start, AS_MEMORY_BASE);
  assert.equal(guestMarker.marker.start, RUST_GLOBAL_BASE);
  assert.deepEqual(finalPrimaryMarker.marker, primaryMarker.marker);
  assert.deepEqual(finalGuestMarker.marker, guestMarker.marker);
  assert.ok(
    primary.report.dataSegments.every((segment) => (
      segment.offset >= AS_MEMORY_BASE && segment.endExclusive <= VALID_BASE
    )),
    'AssemblyScript static data must remain in its configured region'
  );
  assert.ok(
    guest.report.dataSegments.every((segment) => (
      segment.offset >= RUST_GLOBAL_BASE && segment.endExclusive <= AS_MEMORY_BASE
    )),
    'Rust static data must remain in its configured region'
  );
  assert.equal(guest.report.functions, 2);
  assert.equal(primary.report.functions, 11);
  assert.equal(final.report.functions, primary.report.functions + guest.report.functions);
  assert.equal(guest.report.globals, 1);
  assert.equal(guest.report.mutableGlobals.length, 1);
  assert.equal(guest.report.mutableGlobals[0].initializer.value, RUST_STACK_BYTES);
  assert.equal(guest.report.globalGetInstructions, 0);
  assert.equal(guest.report.globalSetInstructions, 0);
  assert.equal(guest.report.storeInstructions, 0);
  assert.equal(primary.report.mutableGlobals.length, 0);
  assert.ok(primary.report.globals > 0);
  assert.equal(primary.report.globalSetInstructions, 0);
  assert.ok(final.report.globals < primary.report.globals + guest.report.globals);
  assert.equal(final.report.mutableGlobals.length, 0);
  assert.equal(final.report.globalSetInstructions, 0);
  assert.equal(
    final.report.featureValidation.binaryenReported.includes('multimemory'),
    false
  );
  assert.ok(primary.report.byteStores > 0);
  assert.ok(guest.report.byteLoads > 0);
  assert.ok(final.report.byteStores > 0);
  assert.ok(final.report.byteLoads > 0);
  assert.match(primary.wat, /\(import "env" "memory" \(memory\b/);
  assert.match(guest.wat, /\(import "env" "memory" \(memory\b/);
  assert.doesNotMatch(final.wat, /\(import\s/);
  assert.doesNotMatch(final.wat, /\(memory\.[a-z_]+ \$1\b/);

  const bytes = fs.readFileSync(artifact);
  const module = new WebAssembly.Module(bytes);
  const first = new WebAssembly.Instance(module, {});
  const second = new WebAssembly.Instance(module, {});
  assert.ok(first.exports.memory instanceof WebAssembly.Memory);
  assert.equal(first.exports.memory.buffer.byteLength, MEMORY_BYTES);
  assert.equal(first.exports.pulseMemoryBytes() >>> 0, MEMORY_BYTES);
  assert.equal(first.exports.pulseMaxGuestLength() >>> 0, MAX_GUEST_LENGTH);
  assert.equal(first.exports.pulseInvalidRangeStatus() >>> 0, INVALID_RANGE);
  assert.equal(first.exports.pulsePrimaryLayoutMarkerPointer() >>> 0, AS_MEMORY_BASE);
  assert.equal(first.exports.pulse_guest_layout_marker_pointer() >>> 0, RUST_GLOBAL_BASE);
  const initialView = new Uint8Array(first.exports.memory.buffer);
  assert.deepEqual(
    initialView.slice(AS_MEMORY_BASE, AS_MEMORY_BASE + PRIMARY_LAYOUT_MARKER.length),
    new Uint8Array(PRIMARY_LAYOUT_MARKER),
    'final memory must contain the AssemblyScript marker at its configured base'
  );
  assert.deepEqual(
    initialView.slice(RUST_GLOBAL_BASE, RUST_GLOBAL_BASE + GUEST_LAYOUT_MARKER.length),
    new Uint8Array(GUEST_LAYOUT_MARKER),
    'final memory must contain the Rust marker at its configured base'
  );

  const cases = [];
  for (const definition of caseDefinitions()) {
    assert.equal(first.exports.pulseRunMemoryCase(definition.id) >>> 0, 0, `${definition.class} case`);
    assert.equal(first.exports.pulseRunMemoryCase(definition.id) >>> 0, 0, `${definition.class} repeated case`);
    assert.equal(second.exports.pulseRunMemoryCase(definition.id) >>> 0, 0, `${definition.class} second instance`);
    const view = new Uint8Array(first.exports.memory.buffer);
    const expected = pattern(definition.length, definition.seed);
    assert.deepEqual(
      view.slice(definition.pointer, definition.pointer + definition.length),
      expected,
      `${definition.class} input bytes`
    );
    assert.equal(view[definition.pointer - 1], 0xa5, `${definition.class} leading sentinel`);
    assert.equal(view[definition.pointer + definition.length], 0x5a, `${definition.class} trailing sentinel`);
    const checksum = first.exports.pulse_guest_span_checksum(
      definition.pointer,
      definition.length
    ) >>> 0;
    assert.equal(checksum, fnv(expected), `${definition.class} direct shared-memory checksum`);
    const leadingSentinel = view[definition.pointer - 1];
    view[definition.pointer - 1] ^= 0xff;
    assert.equal(
      first.exports.pulse_guest_span_checksum(definition.pointer, definition.length) >>> 0,
      checksum,
      `${definition.class} leading sentinel must not influence the guest result`
    );
    view[definition.pointer - 1] = leadingSentinel;
    const trailingSentinel = view[definition.pointer + definition.length];
    view[definition.pointer + definition.length] ^= 0xff;
    assert.equal(
      first.exports.pulse_guest_span_checksum(definition.pointer, definition.length) >>> 0,
      checksum,
      `${definition.class} trailing sentinel must not influence the guest result`
    );
    view[definition.pointer + definition.length] = trailingSentinel;
    cases.push(Object.freeze({
      ...definition,
      range: Object.freeze({
        beforeSentinel: definition.pointer - 1,
        inputStart: definition.pointer,
        inputEndExclusive: definition.pointer + definition.length,
        afterSentinel: definition.pointer + definition.length
      }),
      checksum,
      sentinelsUnchanged: true,
      outOfRangeSentinelsDoNotInfluenceResult: true,
      inputUnchanged: true
    }));
  }

  assert.equal(first.exports.pulseRunEveryByteProbe() >>> 0, 0);
  assert.equal(first.exports.pulseRunEveryByteProbe() >>> 0, 0);
  assert.equal(second.exports.pulseRunEveryByteProbe() >>> 0, 0);
  const everyBytePointer = first.exports.pulseEveryBytePointer() >>> 0;
  const everyByteLength = first.exports.pulseEveryByteLength() >>> 0;
  assert.equal(everyBytePointer, VALID_BASE + 1024);
  assert.equal(everyByteLength, 64);

  const invalidCases = Object.freeze([
    Object.freeze({ class: 'pointer-beyond-memory', pointer: MEMORY_BYTES + 1, length: 0 }),
    Object.freeze({ class: 'exact-end-nonzero', pointer: MEMORY_BYTES, length: 1 }),
    Object.freeze({ class: 'final-byte-plus-two', pointer: MEMORY_BYTES - 1, length: 2 }),
    Object.freeze({ class: 'u32-max-empty', pointer: 0xffff_ffff, length: 0 }),
    Object.freeze({ class: 'u32-max-nonzero', pointer: 0xffff_ffff, length: 1 }),
    Object.freeze({ class: 'pointer-length-overflow', pointer: 0xffff_fff0, length: 32 }),
    Object.freeze({ class: 'end-beyond-memory', pointer: MEMORY_BYTES - 4, length: 8 }),
    Object.freeze({ class: 'length-over-limit', pointer: VALID_BASE, length: MAX_GUEST_LENGTH + 1 }),
    Object.freeze({ class: 'length-larger-than-memory', pointer: 0, length: MEMORY_BYTES + 1 })
  ]);
  const invalidResults = invalidCases.map((entry) => {
    const beforeHash = sha256(Buffer.from(new Uint8Array(first.exports.memory.buffer)));
    const result = callWithoutTrap(
      first.exports.pulseGuestInvalidStatus,
      entry.pointer,
      entry.length,
      entry.class
    );
    assert.equal(result, INVALID_RANGE, `${entry.class} must return invalid status`);
    const afterHash = sha256(Buffer.from(new Uint8Array(first.exports.memory.buffer)));
    assert.equal(afterHash, beforeHash, `${entry.class} must not mutate memory`);
    return Object.freeze({
      ...entry,
      result,
      trapped: false,
      memoryUnchanged: true
    });
  });
  const validEmptyRanges = Object.freeze([
    Object.freeze({ class: 'empty-at-memory-end', pointer: MEMORY_BYTES, length: 0 }),
    Object.freeze({ class: 'empty-at-zero', pointer: 0, length: 0 })
  ]);
  const validEmptyResults = validEmptyRanges.map((entry) => {
    const result = callWithoutTrap(
      first.exports.pulseGuestInvalidStatus,
      entry.pointer,
      entry.length,
      entry.class
    );
    assert.equal(result, fnv(new Uint8Array()), `${entry.class} must remain valid`);
    assert.equal((result & INVALID_RANGE) >>> 0, 0, `${entry.class} cannot collide with invalid status`);
    return Object.freeze({ ...entry, result, trapped: false });
  });
  const boundaryView = new Uint8Array(first.exports.memory.buffer);
  const validBoundaryRanges = Object.freeze([
    Object.freeze({
      class: 'final-byte',
      pointer: MEMORY_BYTES - 1,
      length: 1,
      bytes: Uint8Array.of(boundaryView[MEMORY_BYTES - 1])
    }),
    Object.freeze({
      class: 'maximum-accepted-length',
      pointer: MAX_LENGTH_POINTER,
      length: MAX_GUEST_LENGTH,
      bytes: boundaryView.slice(
        MAX_LENGTH_POINTER,
        MAX_LENGTH_POINTER + MAX_GUEST_LENGTH
      )
    })
  ]);
  const validBoundaryResults = validBoundaryRanges.map((entry) => {
    const result = callWithoutTrap(
      first.exports.pulseGuestInvalidStatus,
      entry.pointer,
      entry.length,
      entry.class
    );
    assert.equal(result, fnv(entry.bytes), `${entry.class} must remain valid`);
    assert.equal((result & INVALID_RANGE) >>> 0, 0, `${entry.class} cannot collide with invalid status`);
    return Object.freeze({
      class: entry.class,
      pointer: entry.pointer,
      length: entry.length,
      result,
      trapped: false
    });
  });

  const persistentRanges = [
    range(0, RUST_STACK_BYTES, 'rust-stack'),
    ...guest.report.dataSegments.map((segment, index) => (
      range(segment.offset, segment.endExclusive, `rust-static-${index}`)
    )),
    ...primary.report.dataSegments.map((segment, index) => (
      range(segment.offset, segment.endExclusive, `assemblyscript-static-${index}`)
    ))
  ];
  assertPairwiseDisjoint(persistentRanges, 'persistent candidate layout');
  const fixtureRanges = [
    ...caseDefinitions().map((definition) => (
      range(
        definition.pointer - 1,
        definition.pointer + definition.length + 1,
        `case-${definition.id}-${definition.class}`
      )
    )),
    range(
      everyBytePointer - 1,
      everyBytePointer + everyByteLength + 1,
      'every-byte-probe'
    ),
    range(
      MAX_LENGTH_POINTER,
      MAX_LENGTH_POINTER + MAX_GUEST_LENGTH,
      'maximum-accepted-length'
    )
  ];
  assertPairwiseDisjoint(fixtureRanges, 'fixture input layout');
  for (const fixtureRange of fixtureRanges) {
    for (const persistentRange of persistentRanges) {
      assert.equal(
        rangesOverlap(fixtureRange, persistentRange),
        false,
        `${fixtureRange.label} must not overlap ${persistentRange.label}`
      );
    }
  }

  return Object.freeze({
    cases: Object.freeze(cases),
    everyByteProbe: Object.freeze({
      pointer: everyBytePointer,
      length: everyByteLength,
      alteredPositionsChecked: everyByteLength,
      everyPositionInfluencedResult: true,
      sentinelsUnchanged: true,
      inputRestored: true
    }),
    invalidRanges: Object.freeze(invalidResults),
    validEmptyRanges: Object.freeze(validEmptyResults),
    validBoundaryRanges: Object.freeze(validBoundaryResults),
    resultEncoding: Object.freeze({
      invalidStatus: INVALID_RANGE,
      validResultMask: VALID_RESULT_MASK,
      collisionPossible: false
    }),
    layoutEvidence: Object.freeze({
      primaryMarker,
      guestMarker,
      finalPrimaryMarker,
      finalGuestMarker,
      persistentRanges: Object.freeze(persistentRanges),
      fixtureRanges: Object.freeze(fixtureRanges),
      pairwiseNonOverlapping: true
    }),
    deterministicAcrossBuildsAndInstances: true
  });
}

function sourceRecord(file) {
  const bytes = fs.readFileSync(file);
  return Object.freeze({
    file: path.relative(repoRoot, file).split(path.sep).join('/'),
    bytes: bytes.length,
    sha256: sha256(bytes)
  });
}

function copyArtifact(source, outputDirectory, name) {
  const destination = path.join(outputDirectory, name);
  fs.copyFileSync(source, destination);
  return destination;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-guest-link-a2-'));
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
        wasmAs: version(wasmAs, ['--version'], 'wasm-as version'),
        wasmMerge: version(wasmMerge, ['--version'], 'wasm-merge version'),
        wasmOpt: version(wasmOpt, ['--version'], 'wasm-opt version'),
        wasmDis: version(wasmDis, ['--version'], 'wasm-dis version')
      })
    });
    const first = buildRun('run-a', workDirectory, cargoEnvironment);
    const second = buildRun('run-b', workDirectory, cargoEnvironment);
    for (const key of Object.keys(first)) {
      assertSameFile(first[key], second[key], key);
    }
    const negativeLoweringProbe = probeNegativeMultiMemoryLowering(
      first.negativeFinal,
      workDirectory
    );
    const loweringCommands = recordedCommands.filter(
      (command) => command.args.includes('--multi-memory-lowering')
    );
    assert.equal(loweringCommands.length, 1);
    assert.equal(loweringCommands[0].expectedFailure, true);

    const negativeAudits = Object.freeze({
      primary: inspectModule(first.negativePrimary, 'negative-primary', workDirectory),
      guest: inspectModule(first.negativeGuest, 'negative-guest', workDirectory),
      final: inspectModule(
        first.negativeFinal,
        'negative-final',
        workDirectory,
        ['--enable-multimemory']
      )
    });
    const candidateAudits = Object.freeze({
      owner: inspectModule(first.candidateOwner, 'candidate-owner', workDirectory),
      primary: inspectModule(first.candidatePrimary, 'candidate-primary', workDirectory),
      guest: inspectModule(first.candidateGuest, 'candidate-guest', workDirectory),
      final: inspectModule(first.candidateFinal, 'candidate-final', workDirectory)
    });
    const negativeObservation = validateNegativeControl(
      first.negativeFinal,
      negativeAudits
    );
    const candidateExecution = validateCandidate(
      first.candidateFinal,
      candidateAudits
    );

    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const outputFiles = Object.freeze({
      negativePrimary: copyArtifact(
        first.negativePrimary,
        options.outputDirectory,
        'negative-control-primary.wasm'
      ),
      negativeGuest: copyArtifact(
        first.negativeGuest,
        options.outputDirectory,
        'negative-control-guest.wasm'
      ),
      negativeFinal: copyArtifact(
        first.negativeFinal,
        options.outputDirectory,
        'negative-control-final.wasm'
      ),
      candidateOwner: copyArtifact(
        first.candidateOwner,
        options.outputDirectory,
        'candidate-memory-owner.wasm'
      ),
      candidatePrimary: copyArtifact(
        first.candidatePrimary,
        options.outputDirectory,
        'candidate-primary.wasm'
      ),
      candidateGuest: copyArtifact(
        first.candidateGuest,
        options.outputDirectory,
        'candidate-guest.wasm'
      ),
      candidateFinal: copyArtifact(
        first.candidateFinal,
        options.outputDirectory,
        'guest-link-poc-memory.wasm'
      )
    });
    const negativeWat = path.join(options.outputDirectory, 'negative-control-final.wat');
    const candidateWat = path.join(options.outputDirectory, 'guest-link-poc-memory.wat');
    fs.writeFileSync(negativeWat, negativeAudits.final.wat);
    fs.writeFileSync(candidateWat, candidateAudits.final.wat);

    const negativeModules = Object.freeze({
      primary: Object.freeze({
        file: path.basename(outputFiles.negativePrimary),
        ...negativeAudits.primary.report
      }),
      guest: Object.freeze({
        file: path.basename(outputFiles.negativeGuest),
        ...negativeAudits.guest.report
      }),
      final: Object.freeze({
        file: path.basename(outputFiles.negativeFinal),
        watFile: path.basename(negativeWat),
        ...negativeAudits.final.report
      })
    });
    const candidateModules = Object.freeze({
      owner: Object.freeze({
        file: path.basename(outputFiles.candidateOwner),
        ...candidateAudits.owner.report
      }),
      primary: Object.freeze({
        file: path.basename(outputFiles.candidatePrimary),
        ...candidateAudits.primary.report
      }),
      guest: Object.freeze({
        file: path.basename(outputFiles.candidateGuest),
        ...candidateAudits.guest.report
      }),
      final: Object.freeze({
        file: path.basename(outputFiles.candidateFinal),
        watFile: path.basename(candidateWat),
        ...candidateAudits.final.report
      })
    });

    const report = Object.freeze({
      version: REPORT_VERSION,
      status: 'passed',
      scope: Object.freeze({
        unit: 'A2',
        purpose: 'guest-byte-memory-experiment-matrix',
        phaseADecision: 'not-evaluated',
        productionPipelineClaim: false,
        acceptedV1AbiClaim: false,
        optimizationClaim: false,
        fastlyRealityClaim: false
      }),
      toolchain,
      environment: Object.freeze({
        rustTarget: 'wasm32v1-none',
        cargoFrozen: true,
        cargoOffline: true,
        binaryenOwnership: 'assemblyscript-transitive-spike-only'
      }),
      sources: Object.freeze([
        sourceRecord(__filename),
        sourceRecord(path.join(rustRoot, 'Cargo.toml')),
        sourceRecord(path.join(rustRoot, 'Cargo.lock')),
        sourceRecord(rustSource),
        sourceRecord(negativeSource),
        sourceRecord(candidateSource),
        sourceRecord(ownerSource)
      ]),
      commands: Object.freeze(recordedCommands),
      negativeControl: Object.freeze({
        status: 'passed',
        purpose: 'reject raw pointer equivalence across independently owned memories',
        modules: negativeModules,
        binaryenMultiMemoryBehavior: negativeLoweringProbe,
        observation: negativeObservation,
        conclusion: 'Equal i32 pointer values do not identify equal bytes when AssemblyScript and Rust own different memories.'
      }),
      candidate: Object.freeze({
        status: 'passed',
        topology: 'one-deliberate-memory-owner',
        modules: candidateModules,
        connection: Object.freeze({
          memoryOwner: 'candidate-memory-owner.wasm',
          ownerModuleName: 'env',
          exportName: 'memory',
          primaryImport: 'env.memory',
          guestImport: 'env.memory',
          finalMemoryImports: 0,
          finalMemories: 1,
          multiMemoryLoweringUsed: false,
          hiddenCopyUsed: false,
          emittedBulkMemoryInstructions: Object.freeze({
            copy: candidateAudits.final.report.memoryCopyInstructions,
            fill: candidateAudits.final.report.memoryFillInstructions,
            init: candidateAudits.final.report.memoryInitInstructions
          }),
          proofOnlyExports: Object.freeze([
            'pulsePrimaryLayoutMarkerPointer',
            'pulse_guest_layout_marker_pointer'
          ])
        }),
        layout: Object.freeze({
          pointerWidthBits: 32,
          pageBytes: PAGE_BYTES,
          memory: Object.freeze({
            owner: 'candidate-memory-owner.wasm',
            minimumPages: MEMORY_PAGES,
            maximumPages: MEMORY_PAGES,
            bytes: MEMORY_BYTES,
            growable: false
          }),
          rustStack: Object.freeze({
            configuredRange: Object.freeze({ start: 0, endExclusive: RUST_STACK_BYTES }),
            configuredGrowth: 'downward',
            inputModuleStackPointerInitialValue: RUST_STACK_BYTES,
            inputModuleStackPointerWrites: 0,
            finalMutableGlobals: 0,
            emittedLinearStackUse: false
          }),
          rustStaticData: Object.freeze({
            configuredBase: RUST_GLOBAL_BASE,
            segments: candidateAudits.guest.report.dataSegments,
            occupiedRanges: Object.freeze(
              candidateAudits.guest.report.dataSegments.map((segment) => Object.freeze({
                start: segment.offset,
                endExclusive: segment.endExclusive
              }))
            ),
            marker: candidateExecution.layoutEvidence.guestMarker,
            proofReservedRegion: Object.freeze({
              start: RUST_GLOBAL_BASE,
              endExclusive: AS_MEMORY_BASE,
              enforcement: 'The compiler controls the base; decoded segments and fixture assertions enforce the proof-only upper bound.'
            })
          }),
          assemblyScriptStaticData: Object.freeze({
            configuredBase: AS_MEMORY_BASE,
            segments: candidateAudits.primary.report.dataSegments,
            occupiedRanges: Object.freeze(
              candidateAudits.primary.report.dataSegments.map((segment) => Object.freeze({
                start: segment.offset,
                endExclusive: segment.endExclusive
              }))
            ),
            marker: candidateExecution.layoutEvidence.primaryMarker,
            proofReservedRegion: Object.freeze({
              start: AS_MEMORY_BASE,
              endExclusive: VALID_BASE,
              enforcement: 'The compiler controls the base; decoded segments and fixture assertions enforce the proof-only upper bound.'
            })
          }),
          assemblyScriptStack: Object.freeze({
            linearStackPresent: false,
            evidence: 'The input module has no mutable global, global.set, or emitted stack access.'
          }),
          heap: Object.freeze({
            guestAllocator: false,
            primaryAllocatorUsed: false,
            memoryGrowInstructions: candidateAudits.final.report.memoryGrowInstructions,
            emittedHeapOrAllocatorPath: false,
            claimScope: 'the decoded A2 input and final proof artifacts'
          }),
          inputRegion: Object.freeze({
            base: VALID_BASE,
            upperBoundaryExclusive: MEMORY_BYTES,
            lifetime: 'AssemblyScript writes, synchronously lends, verifies, and then returns.',
            retention: 'forbidden and absent; the guest has no stores or mutable-global writes and the final module has no mutable globals',
            fixtureRanges: candidateExecution.layoutEvidence.fixtureRanges
          }),
          cases: candidateExecution.cases.map((entry) => entry.range),
          dataSegments: Object.freeze({
            owner: candidateAudits.owner.report.dataSegments,
            primary: candidateAudits.primary.report.dataSegments,
            guest: candidateAudits.guest.report.dataSegments,
            final: candidateAudits.final.report.dataSegments
          }),
          mutableGlobalsByModule: Object.freeze({
            owner: candidateAudits.owner.report.mutableGlobals,
            primary: candidateAudits.primary.report.mutableGlobals,
            guest: candidateAudits.guest.report.mutableGlobals,
            final: candidateAudits.final.report.mutableGlobals
          }),
          startBehavior: Object.freeze({
            owner: candidateAudits.owner.report.hasStart,
            primary: candidateAudits.primary.report.hasStart,
            guest: candidateAudits.guest.report.hasStart,
            final: candidateAudits.final.report.hasStart
          }),
          postLinkTransformations: Object.freeze([
            'resolve both env.memory imports to the experimental owner memory',
            'resolve the primary guest function import to a direct internal call',
            'elide unused input globals, including the Rust stack pointer, and remove the AssemblyScript module’s unused, unexported table',
            'validate and reserialize without optimization or multi-memory lowering'
          ]),
          entityChanges: Object.freeze({
            globals: Object.freeze({
              ownerInput: candidateAudits.owner.report.globals,
              primaryInput: candidateAudits.primary.report.globals,
              guestInput: candidateAudits.guest.report.globals,
              final: candidateAudits.final.report.globals
            }),
            tables: Object.freeze({
              ownerInput: candidateAudits.owner.report.tables,
              primaryInput: candidateAudits.primary.report.tables,
              guestInput: candidateAudits.guest.report.tables,
              final: candidateAudits.final.report.tables,
              indirectCallsInFinal: candidateAudits.final.report.callIndirectInstructions
            }),
            memories: Object.freeze({
              ownerInput: candidateAudits.owner.report.memories,
              primaryInput: candidateAudits.primary.report.memories,
              guestInput: candidateAudits.guest.report.memories,
              final: candidateAudits.final.report.memories
            })
          }),
          staticSegmentPreservation: Object.freeze({
            relocated: false,
            inputSegments: Object.freeze(segmentFacts([
              ...candidateAudits.primary.report.dataSegments,
              ...candidateAudits.guest.report.dataSegments
            ])),
            finalSegments: Object.freeze(
              segmentFacts(candidateAudits.final.report.dataSegments)
            ),
            markersVerifiedInInstantiatedFinalMemoryBeforeCalls: true
          }),
          overlapPrevention: Object.freeze([
            'the fixed owner bounds memory at 32 pages',
            'the Rust stack, Rust static data, AssemblyScript static data, and every fixture range are binary-inspected half-open ranges proven pairwise disjoint',
            'the guest emits no linear stack access, stores, or mutable-global writes and the final module has no mutable globals',
            'the guest and primary emit no allocator or memory.grow path',
            'fixture input and sentinel ranges begin at or above byte 524288'
          ]),
          pairwiseRangeCheckPassed: candidateExecution.layoutEvidence.pairwiseNonOverlapping
        }),
        execution: candidateExecution
      }),
      gate: Object.freeze({
        unit: 'A2',
        status: 'passed',
        allowsNextUnit: 'A3',
        phaseAPassed: false,
        unresolvedWithinA2: Object.freeze([]),
        remainingPhaseAGates: Object.freeze([
          'A3 post-link optimization and behavior replay',
          'A3 final artifact audit',
          'A3 Fastly compute serve reality',
          'A4 evidence-bound Phase A decision'
        ])
      }),
      checks: Object.freeze([
        'negative-control-uses-byte-reading-guest',
        'negative-control-rejects-raw-pointer-equivalence',
        'one-memory-owner-defined',
        'primary-and-guest-import-identical-memory',
        'final-module-has-one-fixed-memory-and-no-imports',
        'no-multi-memory-lowering-or-hidden-copy',
        'toolchain-static-segments-preserved-by-range-and-hash',
        'zero-small-aligned-unaligned-boundary-cases-pass',
        'sentinels-and-input-remain-unchanged',
        'out-of-range-sentinels-do-not-influence-result',
        'every-byte-influences-the-guest-result',
        'invalid-ranges-return-status-without-trapping',
        'valid-results-cannot-collide-with-invalid-status',
        'guest-has-no-stores-global-writes-or-host-calls',
        'no-data-stack-heap-overlap',
        'no-pointer-retention',
        'input-and-final-artifacts-are-deterministic'
      ])
    });
    const reportOutput = path.join(
      options.outputDirectory,
      'guest-link-poc-memory-report.json'
    );
    fs.writeFileSync(reportOutput, `${JSON.stringify(report, null, 2)}\n`);

    console.log(`ok - A2 rejects two-memory pointer equivalence and passes the one-memory byte-span matrix (${candidateModules.final.bytes} bytes, ${candidateModules.final.sha256})`);
    console.log(`report - ${path.relative(repoRoot, reportOutput).split(path.sep).join('/')}`);
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

main();
