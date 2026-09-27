#!/usr/bin/env node
'use strict';
// Evidence only: observe copies in temporary generated source; never edit the provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const p02 = require('./p02-memory-trace.cjs');
const mem = require('./mem01-schema-materialization.cjs');
const platform = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const host = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { policy } = require('../../../../packages/provider-fastly/src/build/native-value-budget');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const owner = 'packages/provider-fastly/src/build/native-platform-capabilities.js';

function instrument(source) {
  const replace = (a, b) => { source = mem.replaceExact(source, a, b); };
  source += '\n@external("o04", "stage") declare function o04_stage(stage: i32): void\n';
  source += '@external("o04", "copy") declare function o04_copy(kind: i32, stage: i32, pointer: usize, bytes: i32): void\n';
  source += '@external("o04", "decode") declare function o04_decode(stage: i32): void\n';
  replace('  const parsed = __pulse_fastly_parse_json(input.text)',
    '  o04_decode(0)\n  const parsed = __pulse_fastly_parse_json(input.text)');
  replace('  __pulse_fastly_deep_freeze(decoded)', '  __pulse_fastly_deep_freeze(decoded)\n  o04_decode(1)');
  replace('    const output = new Uint16Array(end - start); let count = 0; this.index = start;',
    '    o04_copy(0, 0, 0, (end - start) * 2)\n    const output = new Uint16Array(end - start); let count = 0; this.index = start;\n    o04_copy(0, 1, changetype<usize>(output.buffer), output.byteLength)');
  replace('    return String.UTF16.decodeUnsafe(output.dataStart, count * 2);',
    '    o04_copy(0, 2, 0, count * 2)\n    const o04_text = String.UTF16.decodeUnsafe(output.dataStart, count * 2);\n    o04_copy(0, 3, changetype<usize>(o04_text), count * 2)\n    return o04_text');
  replace('  const out = new Uint16Array(size); let cursor = 0; out[cursor++] = 34;',
    '  o04_copy(1, 0, 0, size * 2)\n  const out = new Uint16Array(size); let cursor = 0; out[cursor++] = 34;\n  o04_copy(1, 1, changetype<usize>(out.buffer), out.byteLength)');
  replace('  return String.UTF16.decodeUnsafe(out.dataStart, out.byteLength);',
    '  o04_copy(1, 2, 0, out.byteLength)\n  const o04_text = String.UTF16.decodeUnsafe(out.dataStart, out.byteLength);\n  o04_copy(1, 3, changetype<usize>(o04_text), out.byteLength)\n  return o04_text');
  const projection = source.match(/^    const projected = __pulse_fastly_schema_\w+\(valueHandle, !encode\)$/m);
  assert.ok(projection);
  replace(projection[0], '    o04_stage(0)\n' + projection[0] + '\n    o04_stage(1)');
  replace('    const input = __pulse_fastly_json(projected, 0)',
    '    const input = __pulse_fastly_json(projected, 0)\n    o04_stage(2)');
  const codec = '    const normalized = encode ? __pulse_schema_encode_0(input) : __pulse_schema_decode_0(input)';
  replace(codec, codec + '\n    o04_stage(3)');
  replace('    return __pulse_fastly_parse_json(normalized)',
    '    const o04_result = __pulse_fastly_parse_json(normalized)\n    o04_stage(4)\n    return o04_result');
  return source;
}

function observer() {
  const probe = mem.observer(), originalAttach = probe.attach;
  let instance, phase = 'outside-schema', schemaStart, decodeStart;
  const copies = [], stages = [], decodes = [], active = new Map();
  probe.attach = value => { instance = value; originalAttach(value); };
  probe.imports.o04 = {
    decode(stage) {
      if (stage === 0) { decodeStart = probe.metrics().allocatedBytes; phase = 'decode-input'; }
      else { decodes.push(probe.metrics().allocatedBytes - decodeStart); phase = 'outside-schema'; }
    },
    stage(stage) {
      const metrics = probe.metrics();
      if (stage === 0) schemaStart = metrics;
      stages.push({ stage: ['entry', 'projection', 'serialized', 'codec', 'reparsed'][stage], ...metrics });
      if (stage === 4) assert.ok(metrics.allocatedBytes >= schemaStart.allocatedBytes);
      phase = ['projection', 'serialization', 'codec', 'reparse', 'outside-schema'][stage];
    },
    copy(kind, stage, pointer, bytes) {
      const allocated = probe.metrics().allocatedBytes;
      if (stage === 0) { active.set(kind, { kind: ['parser-string', 'quote-string'][kind], phase, start: allocated, scratchCapacityBytes: bytes }); return; }
      const row = active.get(kind); assert.ok(row);
      if (stage === 1) {
        row.scratchPointer = pointer;
        row.scratchAllocationBytes = allocated - row.start;
        // Pinned AS 0.28.18: object payload starts 20 bytes after the TLSF block.
        const view = new DataView(instance.exports.memory.buffer);
        row.scratchBackingBlockBytes = (view.getUint32(pointer - 20, true) & ~3) + 4;
      } else if (stage === 2) row.beforeString = allocated;
      else {
        assert.equal(stage, 3);
        row.outputUtf16Bytes = bytes;
        row.outputAllocationBytes = allocated - row.beforeString;
        row.distinctOutputStorage = pointer !== row.scratchPointer;
        assert.ok(row.distinctOutputStorage, 'decoder produces owned storage');
        assert.ok(row.scratchAllocationBytes >= row.scratchBackingBlockBytes);
        delete row.scratchPointer; delete row.start; delete row.beforeString;
        copies.push(row); active.delete(kind);
      }
    }
  };
  return { probe, copies, stages, decodes };
}

function summarize(copies) {
  const groups = new Map();
  for (const row of copies) {
    const key = row.phase + '/' + row.kind;
    if (!groups.has(key)) groups.set(key, { phase: row.phase, kind: row.kind, calls: 0,
      scratchCapacityBytes: 0, scratchAllocationBytes: 0, scratchBackingBlockBytes: 0, outputUtf16Bytes: 0, outputAllocationBytes: 0 });
    const group = groups.get(key); group.calls++;
    for (const metric of ['scratchCapacityBytes', 'scratchAllocationBytes', 'scratchBackingBlockBytes', 'outputUtf16Bytes', 'outputAllocationBytes']) group[metric] += row[metric];
  }
  return [...groups.values()];
}

function fixtureOptions(count) {
  return { clockUnixSeconds: 1790294400, request: { method: 'GET', path: '/pages', url: 'https://app.example.invalid/pages',
    headers: [['x-start', count ? 'p1' : '']], body: '' }, secrets: p02.secrets, secretStore: 'app_secrets',
    fixtures: Object.fromEntries(Object.entries(p02.pageBodies(count)).map(([url, body]) => ['GET ' + url,
      { status: 200, headers: [['content-type', 'application/json'], ['content-length', String(Buffer.byteLength(body))]], body }])) };
}

function runCase(dir, mode, count) {
  const { probe, copies, stages, decodes } = observer();
  const result = (mode === 'production' ? host.executeFastlyNativePlatformCapabilities : mem.diagnosticHost())(
    fs.readFileSync(path.join(dir, mode + '.wasm')), { ...fixtureOptions(count), mem01: probe });
  assert.equal(result.response.body, `${count}:${count - 1}`); assert.equal(result.response.status, 200);
  assert.equal(result.outboundRequests.length, count);
  const summary = { response: result.response.body, status: result.response.status, traceSha256: sha(JSON.stringify(result.trace)),
    outboundRequests: result.outboundRequests.length, chargeBytes: Number(result.instance.exports.pulse_fastly_memory_bytes()),
    chargeValues: Number(result.instance.exports.pulse_fastly_memory_values()), capacityBytes: result.instance.exports.memory.buffer.byteLength };
  if (mode !== 'production') {
    summary.terminal = probe.metrics(); summary.postCollect = probe.collect();
    assert.equal(probe.collect().outstandingBytes, summary.postCollect.outstandingBytes);
    summary.copies = summarize(copies);
    summary.decode = { calls: decodes.length, allocatedBytes: decodes.reduce((a, b) => a + b, 0) };
    summary.schema = { calls: 0, projection: 0, serialization: 0, codec: 0, reparse: 0 };
    for (let i = 0; i < stages.length; i += 5) {
      assert.deepEqual(stages.slice(i, i + 5).map(r => r.stage), ['entry', 'projection', 'serialized', 'codec', 'reparsed']);
      summary.schema.calls++;
      for (const [j, name] of ['projection', 'serialization', 'codec', 'reparse'].entries())
        summary.schema[name] += stages[i + j + 1].allocatedBytes - stages[i + j].allocatedBytes;
    }
    if (mode === 'staged') { assert.equal(summary.schema.calls, count); assert.equal(summary.decode.calls, count); }
  }
  return summary;
}

// A minimal reproducer calls the unchanged provider parser on caller-supplied
// JSON string tokens. The surrounding schema/effect application is not executed.
const exportsSource = `
export function o04_parse(text: string): i32 { return __pulse_fastly_parse_json(text) }
export function o04_text(handle: i32): string { return __pulse_fastly_string(handle) }
export function o04_error(): i32 { return __pulse_fastly_last_error }
export function o04_error_stage(): i32 { return __pulse_fastly_error_stage }
`;
function tokens() {
  const valid = [
    ['empty', ''], ['ascii-small', 'sample'], ['ascii-4096', 'x'.repeat(4096)], ['ascii-59000', 'x'.repeat(59000)],
    ['escapes', '\"\\/\b\f\n\r\t\u0000\u001f'], ['unicode', '雪😀'], ['lone-high', '\ud800'], ['lone-low', '\udfff'],
    ['escape-dense', '\n'.repeat(4096)], ['unicode-large', '雪😀'.repeat(1000)]
  ].map(([name, value]) => ({ name, token: JSON.stringify(value), expected: value }));
  valid.push({ name: 'escaped-spelling', token: '"a\\u0062\\/\\uD83D\\uDE00"', expected: 'ab/😀' });
  const invalid = [['unterminated', '"abc'], ['trailing-backslash', '"abc\\'], ['invalid-escape', '"\\q"'],
    ['short-hex', '"\\u12"'], ['bad-hex', '"\\u0x00"'], ['raw-control', '"\n"'], ['trailing-token', '"a" true']];
  return [...valid, ...invalid.map(([name, token]) => ({ name, token, invalid: true }))];
}

function reproduce(wasm, staged) {
  const rows = [];
  for (const test of tokens()) {
    const { probe, copies } = observer();
    // Only the module initializer runs; no HTTP request or effect is dispatched.
    const imports = Object.fromEntries(WebAssembly.Module.imports(new WebAssembly.Module(wasm))
      .map(({ module }) => [module, {}]));
    Object.assign(imports, probe.imports);
    for (const entry of WebAssembly.Module.imports(new WebAssembly.Module(wasm)))
      if (!imports[entry.module][entry.name]) imports[entry.module][entry.name] = () => { throw new Error('Unexpected hostcall in parser reproducer: ' + entry.module + '.' + entry.name); };
    const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), imports);
    probe.attach(instance); instance.exports.__mem01_initialize();
    const e = instance.exports, bytes = Buffer.from(test.token, 'utf16le');
    const input = e.__pin(e.__new(bytes.length, 2));
    new Uint8Array(e.memory.buffer, input, bytes.length).set(bytes);
    const before = probe.metrics(), handle = e.o04_parse(input), after = probe.metrics();
    if (test.invalid) { assert.equal(handle, 0); assert.equal(e.o04_error(), 1004); assert.equal(e.o04_error_stage(), 3); }
    else {
      assert.equal(e.o04_error(), 0); assert.ok(handle > 0);
      const output = e.o04_text(handle), length = new DataView(e.memory.buffer).getUint32(output - 4, true);
      const decode = () => Buffer.from(e.memory.buffer, output, length).toString('utf16le');
      assert.equal(decode(), test.expected);
      // Mutate test-owned input after parse, then collect. Output must be owned.
      new Uint8Array(e.memory.buffer, input, bytes.length).fill(0x78); e.__unpin(input); e.__collect();
      assert.equal(decode(), test.expected);
      if (staged) { assert.equal(copies.length, 1); assert.equal(copies[0].kind, 'parser-string'); }
    }
    rows.push({ name: test.name, tokenSha256: sha(test.token), inputUtf16Bytes: bytes.length,
      expected: test.invalid ? { error: 1004, stage: 3 } : { textSha256: sha(Buffer.from(test.expected, 'utf16le')), detachedAfterInputMutationAndCollection: true },
      allocatedBytes: after.allocatedBytes - before.allocatedBytes, copies: summarize(copies) });
  }
  return rows;
}

function main() {
  const dir = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-o04-'));
  const output = path.join(root, 'wasm/.test-results/compiler-efficiency/o04');
  fs.mkdirSync(output, { recursive: true });
  const report = { schemaVersion: 'pulse.copy-chain-o04.v1', status: 'running',
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceHashes: Object.fromEntries([owner, path.relative(root, __filename),
      'wasm/test/runtime/compiler-efficiency/mem01-schema-materialization.cjs',
      'wasm/test/runtime/compiler-efficiency/p02-memory-trace.cjs',
      'packages/provider-fastly/src/testing/native-platform-capabilities-host.js',
      ...['src/index.ts', 'src/types.ts', 'src/schemas.ts', '.pulse/config.ts'].map(file => 'wasm/test/fixtures/projects/compiler-efficiency-memory/' + file),
      'pnpm-lock.yaml'].map(file => [file, sha(fs.readFileSync(path.join(root, file)))])),
    cases: [] };
  const reportFile = path.join(output, 'measurements.json'); write(reportFile, report);
  try {
    const project = path.join(dir, 'project'); fs.mkdirSync(project); p02.prepareFixture(project);
    p02.compileWorker('node', project, dir);
    const plan = json(path.join(dir, 'plan.json'));
    const { resolveProject } = require('../../../packages/cli/src/project-config');
    const compiled = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: project,
      bindings: resolveProject({ cwd: project, profile: 'fastly' }).providerConfig.bindings, canonicalBuild: true });
    assert.equal(compiled.guestUnits.length, 0); assert.equal(compiled.manifest.schemaCodecs.active, true);
    const compile = (source, mode) => mem.diagnosticCompile(source, mode, dir, { maximumMemoryPages: policy.maximumMemoryPages });
    assert.deepEqual(compile(compiled.source, 'control'), compiled.wasm);
    report.toolchain = { node: process.version, assemblyScript: compiled.manifest.assemblyScript.version, allocator: 'incremental', maximumMemoryPages: policy.maximumMemoryPages };
    report.artifacts = { generatedSourceSha256: sha(compiled.source), productionWasmSha256: sha(compiled.wasm), uninstrumentedControlByteIdentical: true };
    const builds = { production: compiled.wasm, traced: compile(compiled.source, 'traced'), staged: compile(instrument(compiled.source), 'staged') };
    for (const [name, wasm] of Object.entries(builds)) { fs.writeFileSync(path.join(dir, name + '.wasm'), wasm); report.artifacts[name] = { sha256: sha(wasm), bytes: wasm.length }; }
    for (const count of [0, 1, 16, 64]) {
      const modes = {};
      for (const mode of Object.keys(builds)) {
        const result = spawnSync(process.execPath, [__filename, '--case', dir, mode, String(count)], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
        assert.equal(result.status, 0, `${mode}/${count}: ${result.stderr}`); modes[mode] = JSON.parse(result.stdout);
      }
      for (const mode of ['traced', 'staged']) for (const key of ['response', 'status', 'traceSha256', 'outboundRequests', 'chargeBytes', 'chargeValues'])
        assert.deepEqual(modes[mode][key], modes.production[key], `${count}/${mode}/${key}`);
      assert.deepEqual(modes.staged.terminal, modes.traced.terminal, 'stage observers preserve allocation, peak and GC schedule');
      assert.deepEqual(modes.staged.postCollect, modes.traced.postCollect, 'stage observers preserve diagnostic retention');
      report.cases.push({ pages: count, fixtureSha256: sha(Object.values(p02.pageBodies(count)).join('')), ...modes });
      write(reportFile, report); console.log(JSON.stringify({ pages: count, status: 'passed' }));
    }
    const minimal = compile(instrument(compiled.source) + exportsSource, 'minimal');
    report.artifacts.minimal = { sha256: sha(minimal), bytes: minimal.length };
    const minimalTrace = compile(compiled.source + exportsSource, 'minimal-trace');
    report.artifacts.minimalTrace = { sha256: sha(minimalTrace), bytes: minimalTrace.length };
    report.reproducer = reproduce(minimal, true);
    const controls = reproduce(minimalTrace, false);
    for (const [i, row] of report.reproducer.entries()) {
      const { copies, ...observed } = row;
      const { copies: ignored, ...control } = controls[i];
      assert.deepEqual(observed, control, 'minimal parser parity without stage observers');
    }
    report.reproducerTraceParity = true;
    report.selection = {
      owner, function: '__PulseJsonParser.string', scope: 'unescaped string tokens only; preserve the existing escape decoder',
      chain: 'source span -> Uint16Array backing allocation -> String.UTF16.decodeUnsafe owned string',
      proposedChange: 'copy an already scanned unescaped span directly into an owned string, retaining all syntax/control validation and fresh handle behavior',
      primaryMetric: 'cumulative guest allocation inside host_schema_decode on the 64-page O-02 control',
      gate: 'at least 10% less primary allocation; exact semantic/charge/trace parity; at most 5% median runtime regression beyond noise',
      qualification: 'O-05 implements; O-06 uses at least 3 independent builds and 5 alternating fresh request processes per mode; this report is baseline attribution only'
    };
    report.limitations = [
      'Injected Fastly ABI host and a pinned incremental AS runtime only; no Node Native guest, Viceroy or deployed acceptance.',
      'Scratch block attribution includes allocator overhead. All copy groups are completed calls; malformed tokens can abandon scratch before conversion.',
      'Schema phase rows and primitive copy groups overlap; do not sum both as independent allocations.',
      'The direct parser reproducer bypasses schema/body byte admission and does not establish a new public limit.',
      'Post-collection memory is a diagnostic retained estimate; capacity and RSS are not allocation volume.',
      'The proposed copy removal has not been implemented or benchmarked; removable scratch is an upper bound, not an observed saving.',
      'O-02 does not attribute every temporary allocation. S3 header/body buffers, crypto and codec internals remain outside this bounded selection.'
    ];
    report.status = 'passed'; write(reportFile, report);
    console.log(JSON.stringify({ status: report.status, report: path.relative(root, reportFile), parserCases: report.reproducer.length }));
  } catch (error) { report.status = 'failed'; report.error = error.stack; write(reportFile, report); throw error; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
if (require.main === module) {
  try { if (process.argv[2] === '--case') console.log(JSON.stringify(runCase(process.argv[3], process.argv[4], Number(process.argv[5])))); else main(); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
module.exports = { instrument, observer, tokens, reproduce };
