#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fastly = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');

const REPORT_VERSION = 'pulse.guest-link-poc.final-audit.v1';
const PAGE_BYTES = 65536;
const MEMORY_PAGES = 32;
const MEMORY_BYTES = MEMORY_PAGES * PAGE_BYTES;
const MAX_GUEST_LENGTH = 4096;
const INVALID_RANGE = 0x8000_0000;
const PRIMARY_LAYOUT_MARKER = Buffer.from('AS-A2-MARKER-01!', 'ascii');
const GUEST_LAYOUT_MARKER = Buffer.from('PLS2RU-A2-MARKER', 'ascii');
const OPTIMIZATION_ARGS = Object.freeze([
  '--mvp-features',
  '--optimize-level',
  '3',
  '--shrink-level',
  '2',
  '--converge',
  '--strip-debug'
]);
const EXPECTED_FASTLY_IMPORTS = Object.freeze([
  Object.freeze({ module: 'fastly_http_body', name: 'new', kind: 'function' }),
  Object.freeze({ module: 'fastly_http_body', name: 'write', kind: 'function' }),
  Object.freeze({ module: 'fastly_http_resp', name: 'new', kind: 'function' }),
  Object.freeze({ module: 'fastly_http_resp', name: 'status_set', kind: 'function' }),
  Object.freeze({ module: 'fastly_http_resp', name: 'header_insert', kind: 'function' }),
  Object.freeze({ module: 'fastly_http_resp', name: 'send_downstream', kind: 'function' })
]);

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const a2Harness = path.join(__dirname, 'assert-memory-matrix.cjs');
const fixtureRoot = path.join(__dirname, 'fixtures', 'final');
const fastlyShellSource = path.join(fixtureRoot, 'fastly-shell.wat');
const fastlyManifestSource = path.join(fixtureRoot, 'fastly.toml');
const assemblyScriptRoot = fs.realpathSync(path.join(wasmRoot, 'node_modules', 'assemblyscript'));
const binaryenRoot = fs.realpathSync(path.resolve(assemblyScriptRoot, '..', 'binaryen'));
const wasmAs = path.join(binaryenRoot, 'bin', 'wasm-as');
const wasmMerge = path.join(binaryenRoot, 'bin', 'wasm-merge');
const wasmOpt = path.join(binaryenRoot, 'bin', 'wasm-opt');
const wasmDis = path.join(binaryenRoot, 'bin', 'wasm-dis');
const recordedCommands = [];

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'guest-link-a3');
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out requires a directory');
      outputDirectory = path.resolve(repoRoot, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown final-reality option: ${token}`);
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
    timeout: options.timeoutMs,
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

function version(command, args, label, env) {
  const result = run(command, args, { label, env });
  return result.stdout || result.stderr;
}

function sourceRecord(file) {
  const bytes = fs.readFileSync(file);
  return Object.freeze({
    file: path.relative(repoRoot, file).split(path.sep).join('/'),
    bytes: bytes.length,
    sha256: sha256(bytes)
  });
}

function fileRecord(file) {
  const bytes = fs.readFileSync(file);
  return Object.freeze({
    bytes: bytes.length,
    sha256: sha256(bytes)
  });
}

function readUleb(bytes, start, label) {
  let value = 0;
  let shift = 0;
  let cursor = start;
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    cursor += 1;
    value += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) return Object.freeze({ value, next: cursor });
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
  if (shift < 32 && (byte & 0x40) !== 0) value |= (~0 << shift);
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
      const offset = readLiteralI32Expression(bytes, cursor, `${label} data segment ${index}`);
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

function metric(metrics, name, label) {
  const match = metrics.match(new RegExp(`\\[${name}\\]\\s*:\\s*(\\d+)`));
  assert.ok(match, `${label} metrics must report ${name}`);
  return Number(match[1]);
}

function parseFeatures(output) {
  return Object.freeze(output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('--enable-'))
    .map((line) => line.slice('--enable-'.length))
    .sort());
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

function inspectModule(file, label, workDirectory) {
  const bytes = fs.readFileSync(file);
  assert.equal(WebAssembly.validate(bytes), true, `${label} must be valid WebAssembly`);
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);
  const featureOutput = path.join(workDirectory, `${label}-feature-inspection.wasm`);
  const metricsOutput = path.join(workDirectory, `${label}-metrics-inspection.wasm`);
  const watOutput = path.join(workDirectory, `${label}.wat`);
  const features = run(wasmOpt, [
    file,
    '--mvp-features',
    '--print-features',
    '-o',
    featureOutput
  ], { label: `${label} feature validation` }).stdout;
  const metricResult = run(wasmOpt, [
    file,
    '--mvp-features',
    '--metrics',
    '-o',
    metricsOutput
  ], { label: `${label} metrics` });
  run(wasmDis, [
    file,
    '--mvp-features',
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
    `${label} segment bytes must match Binaryen metrics`
  );
  const definedMemories = metric(metrics, 'memories', label);
  const importedMemories = imports.filter((entry) => entry.kind === 'memory').length;
  const definedTables = metric(metrics, 'tables', label);
  const importedTables = imports.filter((entry) => entry.kind === 'table').length;
  return Object.freeze({
    report: Object.freeze({
      bytes: bytes.length,
      sha256: sha256(bytes),
      valid: true,
      imports,
      exports,
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
        explicitlyEnabled: Object.freeze([]),
        binaryenReported: parseFeatures(features)
      }),
      hasStart: /\n\s*\(start\s/.test(wat),
      memoryGrowInstructions: countMatches(wat, /\(memory\.grow\b/g),
      memoryCopyInstructions: countMatches(wat, /\(memory\.copy\b/g),
      memoryFillInstructions: countMatches(wat, /\(memory\.fill\b/g),
      memoryInitInstructions: countMatches(wat, /\(memory\.init\b/g),
      globalSetInstructions: countMatches(wat, /\(global\.set\b/g),
      callIndirectInstructions: countMatches(wat, /\(call_indirect\b/g)
    }),
    wat
  });
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

function range(start, endExclusive, label) {
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

function pattern(length, seed) {
  return Uint8Array.from({ length }, (_, index) => (
    seed + index * 29 + (index << 1)
  ) & 0xff);
}

function callWithoutTrap(fn, pointer, length, label) {
  try {
    return fn(pointer, length) >>> 0;
  } catch (error) {
    assert.fail(`${label} trapped: ${error && error.message ? error.message : error}`);
  }
}

function normalizedResult(a2Execution) {
  return Object.freeze({
    status: 'passed',
    cases: a2Execution.cases.length,
    invalid: a2Execution.invalidRanges.length,
    empty: a2Execution.validEmptyRanges.length,
    boundary: a2Execution.validBoundaryRanges.length,
    bytes: MEMORY_BYTES,
    max: MAX_GUEST_LENGTH,
    sentinel: true,
    everyByte: a2Execution.everyByteProbe.alteredPositionsChecked
  });
}

function executeNodeSuite(file, a2Report) {
  const bytes = fs.readFileSync(file);
  const module = new WebAssembly.Module(bytes);
  const first = new WebAssembly.Instance(module, {});
  const second = new WebAssembly.Instance(module, {});
  const a2Execution = a2Report.candidate.execution;
  assert.ok(first.exports.memory instanceof WebAssembly.Memory);
  assert.equal(first.exports.memory.buffer.byteLength, MEMORY_BYTES);
  assert.equal(first.exports.pulseMemoryBytes() >>> 0, MEMORY_BYTES);
  assert.equal(first.exports.pulseMaxGuestLength() >>> 0, MAX_GUEST_LENGTH);
  assert.equal(first.exports.pulseInvalidRangeStatus() >>> 0, INVALID_RANGE);
  assert.equal(first.exports.pulsePrimaryLayoutMarkerPointer() >>> 0, 4 * PAGE_BYTES);
  assert.equal(first.exports.pulse_guest_layout_marker_pointer() >>> 0, 2 * PAGE_BYTES);
  const initialView = new Uint8Array(first.exports.memory.buffer);
  assert.deepEqual(
    initialView.slice(4 * PAGE_BYTES, 4 * PAGE_BYTES + PRIMARY_LAYOUT_MARKER.length),
    new Uint8Array(PRIMARY_LAYOUT_MARKER)
  );
  assert.deepEqual(
    initialView.slice(2 * PAGE_BYTES, 2 * PAGE_BYTES + GUEST_LAYOUT_MARKER.length),
    new Uint8Array(GUEST_LAYOUT_MARKER)
  );

  const cases = [];
  for (const entry of a2Execution.cases) {
    assert.equal(first.exports.pulseRunMemoryCase(entry.id) >>> 0, 0, `${entry.class} optimized case`);
    assert.equal(first.exports.pulseRunMemoryCase(entry.id) >>> 0, 0, `${entry.class} optimized repeat`);
    assert.equal(second.exports.pulseRunMemoryCase(entry.id) >>> 0, 0, `${entry.class} second instance`);
    const view = new Uint8Array(first.exports.memory.buffer);
    const expected = pattern(entry.length, entry.seed);
    assert.deepEqual(
      view.slice(entry.pointer, entry.pointer + entry.length),
      expected,
      `${entry.class} optimized input bytes`
    );
    assert.equal(view[entry.pointer - 1], 0xa5, `${entry.class} leading sentinel`);
    assert.equal(view[entry.pointer + entry.length], 0x5a, `${entry.class} trailing sentinel`);
    const checksum = first.exports.pulse_guest_span_checksum(entry.pointer, entry.length) >>> 0;
    assert.equal(checksum, entry.checksum, `${entry.class} optimized checksum`);
    const leadingSentinel = view[entry.pointer - 1];
    view[entry.pointer - 1] ^= 0xff;
    assert.equal(
      first.exports.pulse_guest_span_checksum(entry.pointer, entry.length) >>> 0,
      checksum,
      `${entry.class} optimized leading sentinel must not influence the guest result`
    );
    view[entry.pointer - 1] = leadingSentinel;
    const trailingSentinel = view[entry.pointer + entry.length];
    view[entry.pointer + entry.length] ^= 0xff;
    assert.equal(
      first.exports.pulse_guest_span_checksum(entry.pointer, entry.length) >>> 0,
      checksum,
      `${entry.class} optimized trailing sentinel must not influence the guest result`
    );
    view[entry.pointer + entry.length] = trailingSentinel;
    cases.push(Object.freeze({
      id: entry.id,
      class: entry.class,
      checksum,
      inputUnchanged: true,
      sentinelsUnchanged: true,
      outOfRangeSentinelsDoNotInfluenceResult: true
    }));
  }

  assert.equal(first.exports.pulseRunEveryByteProbe() >>> 0, 0);
  assert.equal(first.exports.pulseRunEveryByteProbe() >>> 0, 0);
  assert.equal(second.exports.pulseRunEveryByteProbe() >>> 0, 0);

  const invalidRanges = a2Execution.invalidRanges.map((entry) => {
    const before = sha256(Buffer.from(new Uint8Array(first.exports.memory.buffer)));
    const result = callWithoutTrap(
      first.exports.pulseGuestInvalidStatus,
      entry.pointer,
      entry.length,
      entry.class
    );
    assert.equal(result, entry.result, `${entry.class} optimized invalid status`);
    const after = sha256(Buffer.from(new Uint8Array(first.exports.memory.buffer)));
    assert.equal(after, before, `${entry.class} optimized memory must remain unchanged`);
    return Object.freeze({
      class: entry.class,
      result,
      trapped: false,
      memoryUnchanged: true
    });
  });

  const validEmptyRanges = a2Execution.validEmptyRanges.map((entry) => {
    const result = callWithoutTrap(
      first.exports.pulseGuestInvalidStatus,
      entry.pointer,
      entry.length,
      entry.class
    );
    assert.equal(result, entry.result, `${entry.class} optimized result`);
    return Object.freeze({ class: entry.class, result, trapped: false });
  });

  const validBoundaryRanges = a2Execution.validBoundaryRanges.map((entry) => {
    const result = callWithoutTrap(
      first.exports.pulseGuestInvalidStatus,
      entry.pointer,
      entry.length,
      entry.class
    );
    assert.equal(result, entry.result, `${entry.class} optimized result`);
    return Object.freeze({ class: entry.class, result, trapped: false });
  });

  return Object.freeze({
    normalized: normalizedResult(a2Execution),
    cases: Object.freeze(cases),
    everyByteProbe: Object.freeze({
      positions: a2Execution.everyByteProbe.alteredPositionsChecked,
      passed: true
    }),
    invalidRanges: Object.freeze(invalidRanges),
    validEmptyRanges: Object.freeze(validEmptyRanges),
    validBoundaryRanges: Object.freeze(validBoundaryRanges),
    repeatedAcrossInstances: true
  });
}

function optimize(input, output, workDirectory, label) {
  run(wasmOpt, [
    input,
    ...OPTIMIZATION_ARGS,
    '-o',
    output
  ], {
    label,
    record: true,
    commandName: 'wasm-opt',
    workDirectory
  });
}

function buildFastlyFixture(optimizedCore, runRoot, workDirectory, label) {
  fs.mkdirSync(runRoot, { recursive: true });
  const shell = path.join(runRoot, 'fastly-shell.wasm');
  const merged = path.join(runRoot, 'guest-link-fastly.wasm');
  run(wasmAs, [
    fastlyShellSource,
    '--mvp-features',
    '-o',
    shell
  ], {
    label: `${label} Fastly shell`,
    record: true,
    commandName: 'wasm-as',
    workDirectory
  });
  run(wasmMerge, [
    optimizedCore,
    'env',
    shell,
    'pulse_fastly',
    '--mvp-features',
    '--rename-export-conflicts',
    '-o',
    merged
  ], {
    label: `${label} Fastly merge`,
    record: true,
    commandName: 'wasm-merge',
    workDirectory
  });
  return Object.freeze({ shell, merged });
}

function assertSameFile(first, second, label) {
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second), `${label} bytes must be deterministic`);
}

function validateOptimizedCore(audit, a2Report) {
  const report = audit.report;
  const unoptimized = a2Report.candidate.modules.final;
  assert.deepEqual(report.imports, []);
  assert.deepEqual(report.exports, unoptimized.exports);
  assert.equal(report.memories, 1);
  assert.equal(report.definedMemories, 1);
  assert.equal(report.importedMemories, 0);
  assert.deepEqual(report.memoryTypes, [{
    minimumPages: MEMORY_PAGES,
    maximumPages: MEMORY_PAGES
  }]);
  assert.equal(report.hasStart, false);
  assert.equal(report.tables, 0);
  assert.equal(report.mutableGlobals.length, 0);
  assert.deepEqual(report.featureValidation.binaryenReported, []);
  assert.deepEqual(segmentFacts(report.dataSegments), segmentFacts(unoptimized.dataSegments));
  assert.equal(report.memoryGrowInstructions, 0);
  assert.equal(report.memoryCopyInstructions, 0);
  assert.equal(report.memoryFillInstructions, 0);
  assert.equal(report.memoryInitInstructions, 0);
  assert.equal(report.globalSetInstructions, 0);
  assert.equal(report.callIndirectInstructions, 0);
  assert.ok(report.bytes <= unoptimized.bytes, 'post-link optimization must not increase the core artifact');
}

function validateFastlyFixture(audit, optimizedAudit) {
  const report = audit.report;
  assert.deepEqual(report.imports, EXPECTED_FASTLY_IMPORTS);
  assert.equal(report.importedMemories, 0);
  assert.equal(report.definedMemories, 1);
  assert.equal(report.memories, 1);
  assert.deepEqual(report.memoryTypes, [{
    minimumPages: MEMORY_PAGES,
    maximumPages: MEMORY_PAGES
  }]);
  assert.equal(report.hasStart, false, 'Fastly command shape uses an _start export, not a start section');
  assert.ok(report.exports.some((entry) => entry.name === '_start' && entry.kind === 'function'));
  assert.equal(report.exports.filter((entry) => entry.name === '_start').length, 1);
  for (const coreExport of optimizedAudit.report.exports) {
    assert.ok(
      report.exports.some((entry) => entry.name === coreExport.name && entry.kind === coreExport.kind),
      `Fastly fixture must preserve optimized core export ${coreExport.name}`
    );
  }
  assert.equal(report.tables, 0);
  assert.equal(report.mutableGlobals.length, 0);
  assert.deepEqual(report.featureValidation.binaryenReported, []);
  assert.equal(report.memoryGrowInstructions, 0);
  assert.equal(report.memoryCopyInstructions, 0);
  assert.equal(report.memoryFillInstructions, 0);
  assert.equal(report.memoryInitInstructions, 0);
  assert.equal(report.globalSetInstructions, 0);
  assert.equal(report.callIndirectInstructions, 0);
  const coreSegments = segmentFacts(optimizedAudit.report.dataSegments);
  const finalSegments = segmentFacts(report.dataSegments);
  for (const segment of coreSegments) {
    assert.ok(
      finalSegments.some((entry) => (
        entry.memoryIndex === segment.memoryIndex
        && entry.offset === segment.offset
        && entry.endExclusive === segment.endExclusive
        && entry.bytes === segment.bytes
        && entry.sha256 === segment.sha256
      )),
      `Fastly fixture must preserve core data segment ${segment.sha256}`
    );
  }
  const occupied = [
    range(0, PAGE_BYTES, 'rust-stack-reservation'),
    range(196608, 196620, 'fastly-handle-scratch'),
    ...report.dataSegments.map((segment, index) => (
      range(segment.offset, segment.endExclusive, `data-segment-${index}`)
    )),
    range(524288, MEMORY_BYTES, 'candidate-input-reservation')
  ];
  assertPairwiseDisjoint(occupied, 'Fastly fixture layout');
  return Object.freeze({
    occupiedRanges: Object.freeze(occupied),
    pairwiseNonOverlapping: true,
    optimizedCoreSegmentsPreserved: true
  });
}

function headerValues(response, name) {
  const lower = name.toLowerCase();
  return response.headers
    .filter(([key]) => key.toLowerCase() === lower)
    .map(([, value]) => value);
}

function responseEvidence(response) {
  const text = response.body.toString('utf8');
  return Object.freeze({
    status: response.status,
    contentType: Object.freeze(headerValues(response, 'content-type')),
    bytes: response.body.length,
    sha256: sha256(response.body),
    json: JSON.parse(text)
  });
}

function toolEvidence(inspection) {
  return Object.freeze({
    binary: path.basename(inspection.binary),
    version: inspection.version,
    output: inspection.output,
    sha256: sha256(fs.readFileSync(inspection.binary))
  });
}

async function executeFastlyReality(fastlyArtifact, workDirectory, expected) {
  const packageRoot = path.join(workDirectory, 'fastly-package');
  const wasmFile = path.join(packageRoot, 'guest-link-poc-fastly.wasm');
  const manifestFile = path.join(packageRoot, 'fastly.toml');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.copyFileSync(fastlyArtifact, wasmFile);
  fs.copyFileSync(fastlyManifestSource, manifestFile);
  const cliInspection = fastly.inspectFastlyCli({ env: process.env });
  const viceroyInspection = fastly.inspectViceroy({ env: process.env });
  let server;
  try {
    server = await fastly.startFastlyComputeServe({
      binary: cliInspection.binary,
      viceroyBinary: viceroyInspection.binary,
      packageRoot,
      wasmFile,
      manifestFile,
      env: process.env,
      startTimeoutMs: 120000,
      stopTimeoutMs: 5000
    });
    assert.equal(server.child.spawnfile, cliInspection.binary);
    assert.ok(server.args.includes('--viceroy-path'));
    assert.ok(server.args.includes(viceroyInspection.binary));
    const first = await fastly.requestFastlyCompute(server, {
      path: '/',
      timeoutMs: 45000
    });
    const second = await fastly.requestFastlyCompute(server, {
      path: '/',
      timeoutMs: 45000
    });
    const firstEvidence = responseEvidence(first);
    const secondEvidence = responseEvidence(second);
    assert.equal(firstEvidence.status, 200);
    assert.ok(firstEvidence.contentType.some((value) => value.startsWith('application/json')));
    assert.deepEqual(firstEvidence.json, expected);
    assert.deepEqual(secondEvidence, firstEvidence);
    return Object.freeze({
      toolchain: Object.freeze({
        fastlyCli: toolEvidence(cliInspection),
        viceroy: toolEvidence(viceroyInspection)
      }),
      invocation: Object.freeze({
        command: 'fastly',
        args: Object.freeze([
          'compute',
          'serve',
          '--dir',
          '<package>',
          '--file',
          path.basename(wasmFile),
          '--addr',
          '<loopback>',
          '--viceroy-path',
          path.basename(viceroyInspection.binary)
        ]),
        remoteDeployment: false
      }),
      first: firstEvidence,
      second: secondEvidence,
      repeatedObservationIdentical: true
    });
  } finally {
    if (server) await server.stop();
  }
}

function copyArtifact(source, outputDirectory, name) {
  const destination = path.join(outputDirectory, name);
  fs.copyFileSync(source, destination);
  return destination;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-guest-link-a3-'));
  const a2Output = path.join(workDirectory, 'a2');
  const optimizedA = path.join(workDirectory, 'optimized-a.wasm');
  const optimizedB = path.join(workDirectory, 'optimized-b.wasm');
  const fastlyA = path.join(workDirectory, 'fastly-a');
  const fastlyB = path.join(workDirectory, 'fastly-b');
  const cargoEnvironment = {
    ...process.env,
    CARGO_INCREMENTAL: '0',
    CARGO_NET_OFFLINE: 'true'
  };
  try {
    run(process.execPath, [
      a2Harness,
      '--out',
      a2Output
    ], {
      label: 'A2 memory proof prerequisite',
      env: cargoEnvironment,
      timeoutMs: 180000,
      record: true,
      commandName: 'node',
      workDirectory
    });
    const unoptimizedCore = path.join(a2Output, 'guest-link-poc-memory.wasm');
    const a2ReportFile = path.join(a2Output, 'guest-link-poc-memory-report.json');
    const a2Report = JSON.parse(fs.readFileSync(a2ReportFile, 'utf8'));
    assert.equal(a2Report.gate.status, 'passed');
    assert.equal(a2Report.gate.allowsNextUnit, 'A3');

    optimize(unoptimizedCore, optimizedA, workDirectory, 'optimized core run A');
    optimize(unoptimizedCore, optimizedB, workDirectory, 'optimized core run B');
    assertSameFile(optimizedA, optimizedB, 'optimized core');

    const optimizedAudit = inspectModule(
      optimizedA,
      'guest-link-poc-final',
      workDirectory
    );
    validateOptimizedCore(optimizedAudit, a2Report);
    const unoptimizedNode = executeNodeSuite(unoptimizedCore, a2Report);
    const optimizedNode = executeNodeSuite(optimizedA, a2Report);
    assert.deepEqual(
      optimizedNode,
      unoptimizedNode,
      'optimized and unoptimized Node behavior must be identical'
    );

    const fastlyRunA = buildFastlyFixture(
      optimizedA,
      fastlyA,
      workDirectory,
      'run A'
    );
    const fastlyRunB = buildFastlyFixture(
      optimizedB,
      fastlyB,
      workDirectory,
      'run B'
    );
    assertSameFile(fastlyRunA.shell, fastlyRunB.shell, 'Fastly shell');
    assertSameFile(fastlyRunA.merged, fastlyRunB.merged, 'Fastly fixture');
    const fastlyAudit = inspectModule(
      fastlyRunA.merged,
      'guest-link-poc-fastly',
      workDirectory
    );
    const fastlyLayout = validateFastlyFixture(fastlyAudit, optimizedAudit);
    const fastlyReality = await executeFastlyReality(
      fastlyRunA.merged,
      workDirectory,
      optimizedNode.normalized
    );
    assert.deepEqual(fastlyReality.first.json, optimizedNode.normalized);

    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const optimizedOutput = copyArtifact(
      optimizedA,
      options.outputDirectory,
      'guest-link-poc-final.wasm'
    );
    const optimizedWatOutput = path.join(
      options.outputDirectory,
      'guest-link-poc-final.wat'
    );
    fs.writeFileSync(optimizedWatOutput, optimizedAudit.wat);
    const fastlyOutput = copyArtifact(
      fastlyRunA.merged,
      options.outputDirectory,
      'guest-link-poc-fastly.wasm'
    );
    const fastlyWatOutput = path.join(
      options.outputDirectory,
      'guest-link-poc-fastly.wat'
    );
    fs.writeFileSync(fastlyWatOutput, fastlyAudit.wat);
    const manifestOutput = copyArtifact(
      fastlyManifestSource,
      options.outputDirectory,
      'fastly.toml'
    );

    const toolchain = Object.freeze({
      node: process.version,
      rustc: version(process.env.PULSE_RUSTC || 'rustc', ['--version'], 'rustc version'),
      cargo: version(process.env.PULSE_RUST_CARGO || 'cargo', ['--version'], 'cargo version'),
      binaryen: Object.freeze({
        wasmAs: version(wasmAs, ['--version'], 'wasm-as version'),
        wasmMerge: version(wasmMerge, ['--version'], 'wasm-merge version'),
        wasmOpt: version(wasmOpt, ['--version'], 'wasm-opt version'),
        wasmDis: version(wasmDis, ['--version'], 'wasm-dis version')
      }),
      fastlyCli: fastlyReality.toolchain.fastlyCli,
      viceroy: fastlyReality.toolchain.viceroy
    });
    const report = Object.freeze({
      version: REPORT_VERSION,
      status: 'passed',
      scope: Object.freeze({
        unit: 'A3',
        purpose: 'optimized-final-artifact-and-target-reality',
        phaseADecision: 'not-evaluated',
        productionPipelineClaim: false,
        acceptedV1AbiClaim: false,
        remoteDeploymentClaim: false
      }),
      toolchain,
      sources: Object.freeze([
        sourceRecord(__filename),
        sourceRecord(a2Harness),
        sourceRecord(fastlyShellSource),
        sourceRecord(fastlyManifestSource)
      ]),
      prerequisite: Object.freeze({
        a2Report: Object.freeze({
          file: 'guest-link-poc-memory-report.json',
          ...fileRecord(a2ReportFile),
          status: a2Report.gate.status
        }),
        unoptimizedCore: Object.freeze({
          file: 'guest-link-poc-memory.wasm',
          ...fileRecord(unoptimizedCore)
        })
      }),
      commands: Object.freeze(recordedCommands),
      optimization: Object.freeze({
        tool: 'wasm-opt',
        sequence: OPTIMIZATION_ARGS,
        runCount: 2,
        deterministicBytes: true,
        input: fileRecord(unoptimizedCore),
        output: fileRecord(optimizedA),
        sizeDeltaBytes: fs.statSync(optimizedA).size - fs.statSync(unoptimizedCore).size,
        behaviorChanged: false
      }),
      finalArtifact: Object.freeze({
        file: path.basename(optimizedOutput),
        watFile: path.basename(optimizedWatOutput),
        ...optimizedAudit.report
      }),
      nodeReality: Object.freeze({
        exactArtifact: path.basename(optimizedOutput),
        unoptimized: unoptimizedNode,
        optimized: optimizedNode,
        observationsIdentical: true
      }),
      fastlyFixture: Object.freeze({
        role: 'proof-only command shell around the exact optimized core input',
        productionPipeline: false,
        coreInput: fileRecord(optimizedA),
        file: path.basename(fastlyOutput),
        watFile: path.basename(fastlyWatOutput),
        manifestFile: path.basename(manifestOutput),
        ...fastlyAudit.report,
        layout: fastlyLayout,
        reality: fastlyReality
      }),
      comparison: Object.freeze({
        normalizedNode: optimizedNode.normalized,
        normalizedFastly: fastlyReality.first.json,
        equal: true
      }),
      gate: Object.freeze({
        unit: 'A3',
        status: 'passed',
        allowsNextUnit: 'A4',
        phaseAPassed: false,
        unresolvedWithinA3: Object.freeze([]),
        remainingPhaseAGates: Object.freeze([
          'A4 evidence-bound Phase A decision'
        ])
      }),
      checks: Object.freeze([
        'intended-post-link-optimization-ran-twice',
        'optimized-final-bytes-are-deterministic',
        'optimized-final-module-is-valid-mvp-core-wasm',
        'optimized-final-module-has-one-fixed-memory-and-no-imports',
        'optimized-final-module-preserves-exports-data-segments-and-layout',
        'complete-byte-span-sentinel-and-invalid-range-suite-replayed',
        'unoptimized-and-optimized-node-observations-match',
        'exact-optimized-final-artifact-ran-under-node',
        'optimized-core-linked-into-proof-only-fastly-command-shell',
        'fastly-fixture-has-one-memory-and-only-declared-fastly-imports',
        'fastly-compute-serve-ran-through-fastly-cli-with-viceroy',
        'node-and-fastly-normalized-observations-match',
        'no-remote-deployment'
      ])
    });
    const reportOutput = path.join(
      options.outputDirectory,
      'guest-link-poc-final-audit.json'
    );
    fs.writeFileSync(reportOutput, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`ok - A3 optimized and replayed the guest-link proof under Node and Fastly (${optimizedAudit.report.bytes} bytes, ${optimizedAudit.report.sha256})`);
    console.log(`report - ${path.relative(repoRoot, reportOutput).split(path.sep).join('/')}`);
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  if (
    error
    && (
      error.code === 'PULSE_FASTLY_CLI_UNAVAILABLE'
      || error.code === 'PULSE_VICEROY_UNAVAILABLE'
    )
  ) {
    console.error(JSON.stringify({
      status: 'blocked',
      gate: 'guest-link-final-reality',
      code: error.code,
      message: error.message,
      detail: error.detail
    }, null, 2));
  } else {
    console.error(error && error.stack ? error.stack : error);
  }
  process.exit(1);
});
