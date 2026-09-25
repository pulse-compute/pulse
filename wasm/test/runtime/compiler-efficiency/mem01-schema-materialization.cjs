#!/usr/bin/env node
'use strict';
// Evidence only: temporary generated-source instrumentation; production is unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync, execFileSync } = require('node:child_process');
const { root, hash } = require('./schema-cost-profile.cjs');
const platform = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const hostPath = path.join(root, 'packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile');
const { appendAssemblyScriptOptimizationArgs } = require('../../../packages/build-support/src/native-optimization');
const { normalizeSchemaRegistry } = require('../../../packages/contracts/src/schema-json/registry');
const { buildCanonicalSchemaBundle } = require('../../../packages/schema-json/src/compiler/canonical-schema-codecs');
const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const stages = ['entry', 'projection', 'serialized', 'codec', 'reparsed', 'decode-frozen', 'encode-text'];

function replaceExact(source, before, after, count = 1) {
  assert.equal(source.split(before).length - 1, count, 'instrumentation anchor: ' + before.slice(0, 90));
  return source.split(before).join(after);
}

function instrument(source) {
  // Do not invoke lazy collection or rope getters while observing.
  source = replaceExact(source, '  immutable: bool = false', [
    '  immutable: bool = false',
    '  mem01_length(): i32 { return this.valuesStorage === null ? 0 : this.valuesStorage!.length }',
    '  mem01_child(index: i32): i32 { return unchecked(this.valuesStorage![index]) }',
    '  mem01_key(index: i32): usize { return changetype<usize>(unchecked(this.keysStorage![index])) }',
    '  mem01_key_count(): i32 { return this.keysStorage === null ? 0 : this.keysStorage!.length }'
  ].join('\n'));
  source += '\n' + [
    '@external("mem01", "checkpoint") declare function mem01_checkpoint(stage: i32, encode: bool, handle: i32, text: usize): void',
    'export function mem01_count(): i32 { return __pulse_fastly_values.length }',
    'export function mem01_ptr(h: i32): usize { return changetype<usize>(unchecked(__pulse_fastly_values[h - 1])) }',
    'export function mem01_kind(h: i32): i32 { return unchecked(__pulse_fastly_values[h - 1]).kind }',
    'export function mem01_text(h: i32): usize { return changetype<usize>(unchecked(__pulse_fastly_values[h - 1]).textLeaf) }',
    'export function mem01_frozen(h: i32): bool { return unchecked(__pulse_fastly_values[h - 1]).immutable }',
    'export function mem01_length(h: i32): i32 { return unchecked(__pulse_fastly_values[h - 1]).mem01_length() }',
    'export function mem01_child(h: i32, i: i32): i32 { return unchecked(__pulse_fastly_values[h - 1]).mem01_child(i) }',
    'export function mem01_key_count(h: i32): i32 { return unchecked(__pulse_fastly_values[h - 1]).mem01_key_count() }',
    'export function mem01_key(h: i32, i: i32): usize { return unchecked(__pulse_fastly_values[h - 1]).mem01_key(i) }'
  ].join('\n') + '\n';
  const entry = source.match(/function __pulse_fastly_schema_apply\(schemaId: string, valueHandle: i32, encode: bool(?:, textResult: bool = false)?\): i32 \{/)[0];
  source = replaceExact(source, entry, entry + '\n  mem01_checkpoint(0, encode, valueHandle, 0)');
  source = replaceExact(source, '    if (projected <= 0) return 0',
    '    if (projected <= 0) return 0\n    mem01_checkpoint(1, encode, projected, 0)');
  source = replaceExact(source, '    const input = __pulse_fastly_json(projected, 0)',
    '    const input = __pulse_fastly_json(projected, 0)\n    mem01_checkpoint(2, encode, projected, changetype<usize>(input))');
  const codec = '    const normalized = encode ? __pulse_schema_encode_0(input) : __pulse_schema_decode_0(input)';
  source = replaceExact(source, codec, codec + '\n    mem01_checkpoint(3, encode, projected, changetype<usize>(normalized))');
  if (source.includes('    return __pulse_fastly_parse_json(normalized)')) {
    source = replaceExact(source, '    return __pulse_fastly_parse_json(normalized)',
      '    const output = __pulse_fastly_parse_json(normalized)\n    mem01_checkpoint(4, encode, output, 0)\n    return output');
  } else {
    source = replaceExact(source, '    if (output > 0) __pulse_fastly_deep_freeze(output)',
      '    if (output > 0) __pulse_fastly_deep_freeze(output)\n    mem01_checkpoint(4, encode, output, 0)');
  }
  source = replaceExact(source, '  __pulse_fastly_deep_freeze(decoded)',
    '  __pulse_fastly_deep_freeze(decoded)\n  mem01_checkpoint(5, false, decoded, 0)');
  const encodedText = source.match(/^  const text = (?:textResult \? __pulse_fastly_string\(projected\) : )?__pulse_fastly_json\(projected, 0\)$/m)[0];
  source = replaceExact(source, encodedText,
    encodedText + '\n  mem01_checkpoint(6, true, projected, changetype<usize>(text))');
  return source;
}

function planFor(family, handlerOverride) {
  const source = { file: 'mem01.ts', line: 1, column: 1 };
  const field = (name, value, required = true) => ({ name, value, required });
  const object = fields => ({ kind: 'object', fields });
  const shape = object([
    field('text', { kind: 'string' }), field('active', { kind: 'boolean' }),
    ...(family === 'text-only' ? [] : [field('count', { kind: 'f64' })]),
    field('rows', { kind: 'array', element: object([field('name', { kind: 'string' })]) }),
    field('note', { kind: 'nullable', value: { kind: 'string' } }, false)
  ]);
  const bounded = family === 'bounded-open';
  if (bounded) shape.additionalProperties = { kind: 'json-value' };
  const registry = normalizeSchemaRegistry({ source, schemas: [{ id: 'proof.Value', typeName: 'Value', source, root: shape,
    ...(bounded ? { jsonLimits: { maxTextBytes: 65536, maxJsonBytes: 65536, maxStringLength: 60000 } } : {}) }] });
  const handler = handlerOverride || "export default async function handler(ctx) { const text = await ctx.req.text(); const value = ctx.decodeJson(text, 'proof.Value'); const encoded = ctx.encodeJson(value, 'proof.Value'); return ctx.text(encoded); }";
  return buildCanonicalNativePlan(compileCanonicalSource(handler, { fileName: source.file,
    schemaBundle: buildCanonicalSchemaBundle(registry, { maxBytes: 65536 }), strict: true, target: 'native', requireAsync: true }));
}

function diagnosticCompile(source, mode, directory) {
  const cwd = path.join(directory, mode); fs.mkdirSync(cwd, { recursive: true });
  const fallback = path.join(root, 'wasm/packages/compiler'), asc = resolveAsc(fallback);
  assert.equal(require(path.join(asc.packageRoot, 'package.json')).version, '0.28.18', 'review tracer layout when upgrading AssemblyScript');
  const transform = require.resolve('json-as', { paths: [fallback] }), jsonRoot = path.resolve(transform, '../../..');
  assert.equal(require(path.join(jsonRoot, 'package.json')).version, '1.5.0');
  const name = 'fastly-native-platform-capabilities.as.ts', output = path.join(cwd, 'proof.wasm');
  fs.writeFileSync(path.join(cwd, name), source);
  const args = [asc.script, name, '--outFile', output, '--runtime', 'incremental', '--noAssert', '--optimize'];
  appendAssemblyScriptOptimizationArgs(args, undefined, { guestLinked: false });
  args.push('--use', 'abort=fastly-native-platform-capabilities.as/__pulse_fastly_abort', '--exportRuntime',
    '--transform', transform, '--path', path.join(fallback, 'node_modules'), '--path', path.dirname(jsonRoot));
  if (mode !== 'control') args.push('--use', 'ASC_RTRACE=1', '--exportStart', '__mem01_initialize');
  const result = spawnSync(asc.executable, args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120000,
    env: { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0', JSON_MODE: 'NAIVE' } });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return fs.readFileSync(output);
}

function diagnosticHost() {
  const source = replaceExact(fs.readFileSync(hostPath, 'utf8'), '  instance = new WebAssembly.Instance(module, imports);',
    '  Object.assign(imports, options.mem01.imports);\n  instance = new WebAssembly.Instance(module, imports);\n  options.mem01.attach(instance);\n  instance.exports.__mem01_initialize();');
  const loaded = new Module(hostPath, module); loaded.filename = hostPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(hostPath)); loaded._compile(source, hostPath);
  return loaded.exports.executeFastlyNativePlatformCapabilities;
}

function observer(options = {}) {
  let instance, current = 0, peak = 0, allocated = 0, freed = 0, events = 0, collections = 0;
  const blocks = new Map(), snapshots = [], raw = [];
  const view = () => new DataView(instance.exports.memory.buffer);
  // Pinned tlsf/common: low 2 mmInfo bits are flags; include block/GC overhead.
  const size = p => (view().getUint32(p, true) & ~3) + 4;
  const text = p => p ? Buffer.from(instance.exports.memory.buffer, p, view().getUint32(p - 4, true)).toString('utf16le') : '';
  function add(p) {
    assert.ok(!blocks.has(p), 'double allocation ' + p);
    const n = size(p); blocks.set(p, n); current += n; allocated += n; peak = Math.max(peak, current); events++;
  }
  function free(p) {
    assert.ok(blocks.has(p), 'unknown free ' + p);
    const n = blocks.get(p); blocks.delete(p); current -= n; freed += n; events++;
  }
  function resize(p, old) {
    assert.equal(blocks.get(p), old); const n = size(p), delta = n - old; blocks.set(p, n); current += delta;
    if (delta > 0) allocated += delta; else freed -= delta; peak = Math.max(peak, current); events++;
  }
  function metrics() {
    assert.equal(current, allocated - freed);
    return { allocatedBytes: allocated, freedBytes: freed, outstandingBytes: current, peakOutstandingBytes: peak,
      outstandingBlocks: blocks.size, allocatorEvents: events, collections, memoryCapacityBytes: instance.exports.memory.buffer.byteLength };
  }
  function table() {
    const e = instance.exports, before = events, values = [];
    for (let h = 1; h <= e.mem01_count(); h++) {
      values.push({ handle: h, pointer: e.mem01_ptr(h), kind: e.mem01_kind(h), frozen: Boolean(e.mem01_frozen(h)), textPointer: e.mem01_text(h),
        children: Array.from({ length: e.mem01_length(h) }, (_, i) => e.mem01_child(h, i)),
        keys: Array.from({ length: e.mem01_key_count(h) }, (_, i) => e.mem01_key(h, i)) });
    }
    assert.equal(events, before, 'diagnostic readers must not allocate/free/resize guest memory');
    const strings = new Set(values.flatMap(v => [v.textPointer, ...v.keys])); strings.delete(0);
    const managed = [...strings].filter(p => blocks.has(p - 20));
    return { values, handles: values.length, uniqueTextBytes: [...strings].reduce((n, p) => n + view().getUint32(p - 4, true), 0),
      managedStringBlockBytes: managed.reduce((n, p) => n + blocks.get(p - 20), 0) };
  }
  function checkpoint(stage, encode, handle, p) {
    const beforeCollect = metrics();
    if (options.collectAtStages) instance.exports.__collect();
    const t = table(), string = p ? text(p) : null;
    const row = { stage: stages[stage], encode: Boolean(encode), handle, ...metrics(), handles: t.handles,
      tableUniqueTextBytes: t.uniqueTextBytes, tableManagedStringBlockBytes: t.managedStringBlockBytes,
      ...(options.collectAtStages ? { preCollectOutstandingBytes: beforeCollect.outstandingBytes } : {}),
      ...(p ? { textUtf16Bytes: view().getUint32(p - 4, true), textUtf8Bytes: Buffer.byteLength(string), textSha256: hash(string) } : {}) };
    snapshots.push(row); raw.push({ ...row, values: t.values, text: string });
  }
  return { imports: { rtrace: { oninit() {}, onalloc: add, onfree: free, onresize: resize, onmove() {},
    onstore(pointer) { return pointer; }, onload(pointer) { return pointer; },
    onvisit() { return 1; }, oncollect() { collections++; }, oninterrupt() {}, onyield() {} }, mem01: { checkpoint } },
    attach(value) { instance = value; }, metrics, table, snapshots, raw,
    collect() { instance.exports.__collect(); return metrics(); } };
}

function corpus(family) {
  const bounded = family === 'bounded-open';
  const base = { text: 'hello 雪😀', active: true, ...(family === 'text-only' ? {} : { count: 1.25 }),
    rows: [{ name: 'first' }, { name: 'second' }], note: null };
  const success = (name, value, expected = value) => ({ name, body: JSON.stringify(value), expected });
  const absent = { ...base }; delete absent.note;
  const cases = [success('small', base), success('optional-absent', absent), success('optional-present', { ...base, note: 'present' }),
    success('near-bound-ascii', { ...base, text: 'x'.repeat(59000) }),
    success('escaped-unicode', { ...base, text: '雪😀"\\\n\u0001'.repeat(2200) }),
    success('unknown-field', { ...base, extra: { keep: [null, true, 2] } }, bounded ? { ...base, extra: { keep: [null, true, 2] } } : base),
    ...(family === 'text-only' ? [] : [-0, 1e20, 1e-7, 9007199254740991].map(count =>
      success('number-' + (Object.is(count, -0) ? '-0' : count), { ...base, count }, { ...base, count: count === 0 ? 0 : count }))),
    { name: 'closed-duplicate-last-wins', body: JSON.stringify(base).replace('"active":true', '"active":false,"act\\u0069ve":true'), ...(bounded ? { error: true } : { expected: base }) },
    { name: 'invalid-type', body: JSON.stringify({ ...base, text: false }), error: true },
    { name: 'missing-required', body: JSON.stringify({ count: 1, rows: [] }), error: true },
    { name: 'malformed', body: '{"text":', error: true, errorCode: bounded ? 1005 : 1004 },
    { name: 'over-byte-bound', body: JSON.stringify({ ...base, text: 'x'.repeat(66000) }), error: true, status: 413 }
  ];
  if (bounded) cases.push({ name: 'over-string-bound', body: JSON.stringify({ ...base, text: 'x'.repeat(60001) }), error: true });
  return cases;
}

function outcome(execute, wasm, test, probe) {
  try {
    const result = execute(wasm, { request: { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body: test.body },
      ...(probe ? { mem01: probe } : {}) });
    return { result, summary: { status: result.response.status, bodySha256: hash(result.response.body), body: result.response.body } };
  } catch (error) {
    if (!error.code?.startsWith('PULSE_FASTLY_')) throw error;
    return { summary: { error: error.code, lastError: error.detail?.lastError, errorStage: error.detail?.errorStage, errorEffect: error.detail?.errorEffect } };
  }
}

function ownership(raw) {
  const graph = row => {
    const byHandle = new Map(row.values.map(v => [v.handle, v])), reached = new Set();
    function visit(h) { if (reached.has(h)) return; reached.add(h); for (const child of byHandle.get(h).children) visit(child); }
    visit(row.handle); return [...reached].map(h => byHandle.get(h));
  };
  const results = [];
  for (const encode of [false, true]) {
    const at = name => raw.find(row => row.encode === encode && row.stage === name);
    const entry = at('entry'), projected = at('projection'), parsed = at('reparsed');
    const a = graph(entry), b = graph(projected), c = parsed ? graph(parsed) : [];
    const containers = values => values.filter(v => v.kind === 5 || v.kind === 6).map(v => v.handle);
    const inputContainers = new Set(containers(a)), projectedContainers = new Set(containers(b));
    assert.ok(containers(b).every(h => !inputContainers.has(h)), 'projection owns fresh containers');
    assert.ok(containers(c).every(h => !projectedContainers.has(h) && !inputContainers.has(h)), 'reparse owns fresh containers');
    const scalarHandles = new Set(a.filter(v => v.kind < 5).map(v => v.handle));
    const sharedScalars = b.filter(v => scalarHandles.has(v.handle)).length;
    assert.ok(sharedScalars > 0, 'projection reuses scalar handles');
    assert.ok((encode ? graph(entry) : graph(at('decode-frozen'))).every(v => v.frozen), 'decode graph remains deeply frozen through encode');
    results.push({ encode, inputGraphHandles: a.length, projectedGraphHandles: b.length, reparsedGraphHandles: c.length,
      sharedInputProjectionScalars: sharedScalars, freshProjectionContainers: containers(b).length, freshReparseContainers: containers(c).length,
      handlesAddedByReparse: parsed ? parsed.handles - at('codec').handles : 0,
      tableTextBytesAddedByReparse: parsed ? parsed.tableUniqueTextBytes - at('codec').tableUniqueTextBytes : 0 });
  }
  const normalized = raw.find(row => row.encode && row.stage === 'codec').text, encoded = raw.find(row => row.stage === 'encode-text').text;
  return { graphs: results, encodeNormalizedTextEqualsFinalText: normalized === encoded,
    encodeNormalizedUtf8Bytes: Buffer.byteLength(normalized), finalEncodeUtf8Bytes: Buffer.byteLength(encoded),
    ...(normalized !== encoded ? { numericCounterexample: {
      codecToken: normalized.match(/"count":([^,}]+)/)?.[1], finalToken: encoded.match(/"count":([^,}]+)/)?.[1]
    } } : {}) };
}

function summarize(report) {
  return { ...report, cells: report.cells.map(cell => ({ ...cell, cases: cell.cases.map(row => ({ ...row,
    variants: Object.fromEntries(Object.entries(row.variants).map(([name, value]) => [name, { ...value,
      snapshots: row.name === 'near-bound-ascii' ? value.snapshots : undefined
    }]))
  })) })) };
}

function run(output) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  fs.mkdirSync(output, { recursive: true });
  const reportFile = path.join(output, 'measurements.json');
  const runtimeRoot = resolveAsc(path.join(root, 'wasm/packages/compiler')).packageRoot;
  const report = { version: 'pulse.fastly-schema-materialization.mem01.v1', status: 'running', sourceRevision: git(['rev-parse', 'HEAD']),
    workingTree: git(['status', '--porcelain']), node: process.version, harnessSha256: hash(fs.readFileSync(__filename)),
    lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), sourceOwners: Object.fromEntries([
      'packages/provider-fastly/src/build/native-platform-capabilities.js', 'packages/provider-fastly/src/testing/native-platform-capabilities-host.js',
      'wasm/packages/runtime-core-as/src/compiler/canonical-native.js'
    ].map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
    assemblyScriptRuntimeSources: Object.fromEntries(['common.ts', 'tlsf.ts', 'itcms.ts', 'rtrace.ts'].map(file =>
      [file, hash(fs.readFileSync(path.join(runtimeRoot, 'std/assembly/rt', file)))])), cells: [],
    limits: ['Injected Fastly ABI host; no Viceroy, deployed, linked-guest, PS3 budget or whole-application acceptance.',
      'TLSF outstanding allocation includes not-yet-collected garbage; terminal forced collection is a diagnostic retained-set observation.',
      'Allocator blocks exclude static data, shadow stack, allocator metadata and reserved/free pages. Failed invocations may retain conservative stack roots.',
      'Stage checkpoints and allocator tracing perturb optimization/GC. Compare trace-only, staged and uninstrumented controls.',
      'Value-table text counts deduplicate pointers, exclude collection backing storage, and are not total heap bytes.',
      'No measured candidate implementation or runtime-memory saving is claimed.'] };
  const execute = diagnosticHost();
  try {
    for (const name of ['closed-optional', 'bounded-open', 'text-only']) {
      const directory = path.join(output, name); fs.mkdirSync(directory);
      const plan = planFor(name), compiled = platform.compileFastlyNativePlatformCapabilitiesPlan(plan,
        { cwd: root, canonicalBuild: true, requirePlatformCapability: false, emitWat: false });
      const noOp = diagnosticCompile(compiled.source, 'control', directory);
      assert.deepEqual(noOp, compiled.wasm, 'diagnostic compiler recipe matches production byte-for-byte without instrumentation');
      const traced = diagnosticCompile(compiled.source, 'traced', directory);
      const staged = diagnosticCompile(instrument(compiled.source), 'staged', directory);
      const cell = { name, schemaRegistryHash: plan.schemas.registry.registryHash, sourceSha256: hash(compiled.source),
        assemblyScript: compiled.manifest.assemblyScript, jsonAs: compiled.manifest.jsonAs,
        wasm: { production: hash(compiled.wasm), traceOnly: hash(traced), staged: hash(staged) }, controlByteIdentical: true, cases: [] };
      report.cells.push(cell); write(reportFile, report);
      for (const test of corpus(name)) {
        const baseline = outcome(require(hostPath).executeFastlyNativePlatformCapabilities, compiled.wasm, test);
        if (test.status) { assert.equal(baseline.summary.status, test.status); assert.equal(baseline.summary.body, 'Payload Too Large'); }
        else if (test.error) {
          assert.ok(baseline.summary.error, name + '/' + test.name + ' must reject');
          assert.equal(baseline.summary.lastError, test.errorCode || 1005, name + '/' + test.name + ' error category');
        } else { assert.equal(baseline.summary.status, 200); assert.deepEqual(JSON.parse(baseline.summary.body), test.expected); }
        const row = { name: test.name, inputUtf8Bytes: Buffer.byteLength(test.body), inputSha256: hash(test.body),
          ...(baseline.result ? { productionMemoryCapacityBytes: baseline.result.instance.exports.memory.buffer.byteLength } : {}),
          outcome: { ...baseline.summary }, variants: {} }; delete row.outcome.body;
        for (const [variant, wasm] of [['traced', traced], ['staged', staged], ['stagedCollected', staged]]) {
          const probe = observer({ collectAtStages: variant === 'stagedCollected' }), observed = outcome(execute, wasm, test, probe);
          assert.deepEqual(observed.summary, baseline.summary, name + '/' + test.name + '/' + variant + ' semantic parity');
          if (observed.result) assert.deepEqual(observed.result.trace, baseline.result.trace, 'hostcall trace parity');
          const terminal = probe.metrics(), before = variant !== 'traced' && !test.error ? probe.table() : undefined;
          row.variants[variant] = { terminal, postCollect: probe.collect(), snapshots: probe.snapshots };
          if (before) {
            const facts = ownership(probe.raw);
            if (name === 'text-only') assert.equal(facts.encodeNormalizedTextEqualsFinalText, true, 'closed text-only candidate byte oracle');
            if (test.name === 'number-100000000000000000000') assert.equal(facts.encodeNormalizedTextEqualsFinalText, false, 'numeric counterexample blocks generic text forwarding');
            if (variant === 'staged') row.ownership = facts;
            else assert.deepEqual(facts, row.ownership, 'forced stage collection preserves ownership observations');
            const afterCollect = probe.collect(), after = probe.table();
            assert.deepEqual(after.values, before.values, 'collection cannot reclaim value-table roots');
            row.variants[variant].postCollectTable = { handles: after.handles, uniqueTextBytes: after.uniqueTextBytes, managedStringBlockBytes: after.managedStringBlockBytes };
            assert.equal(afterCollect.outstandingBytes, row.variants[variant].postCollect.outstandingBytes, 'terminal collection reaches a fixed point');
          }
        }
        assert.deepEqual(row.variants.staged.terminal, row.variants.traced.terminal, 'stage readers preserve trace-only allocation totals and peak');
        assert.deepEqual(row.variants.staged.postCollect, row.variants.traced.postCollect, 'stage readers preserve terminal retained allocation');
        cell.cases.push(row); write(reportFile, report);
        console.log(JSON.stringify({ fixture: name, case: test.name, status: 'passed' }));
      }
    }
    report.status = 'passed'; write(reportFile, report); write(path.join(output, 'evidence.json'), summarize(report));
    console.log(JSON.stringify({ status: report.status, report: reportFile })); return report;
  } catch (error) { report.status = 'failed'; report.error = error.stack; write(reportFile, report); throw error; }
}
if (require.main === module) run(process.argv[2] ? path.resolve(process.argv[2]) :
  path.join(root, 'wasm/.test-results/compiler-efficiency/mem01', new Date().toISOString().replace(/[:.]/g, '-')));
module.exports = { instrument, replaceExact, observer, planFor, corpus, run, diagnosticCompile, diagnosticHost, outcome, ownership };
