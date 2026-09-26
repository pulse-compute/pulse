#!/usr/bin/env node
'use strict';
// Opt-in paired evidence. MEM11 remains a historical replay; --quote-reuse
// compares current MEM12 production with the exact MEM11 production baseline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const platformPath = path.join(root, 'packages/provider-fastly/src/build/native-platform-capabilities.js');
const kvPath = path.join(root, 'packages/provider-fastly/src/build/kv-native.as.ts');
const kv = require('../../../packages/provider-fastly/src/build/kv-native');
const platform = require(platformPath);
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { resolveAsc } = require('../../packages/build-support/src/assemblyscript-compile');
const { replaceExact, planFor } = require('../runtime/compiler-efficiency/mem01-schema-materialization.cjs');
const loop = require('../runtime/compiler-efficiency/mem08-payload-retention.cjs');
const { cases, injected, local, stats, hostOptions } = require('./assert-fastly-allocator-mem10.cjs');
const mem10 = require('./mem10-allocator-evidence.json');
const mem11 = require('./mem11-read-temporaries-evidence.json');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const options = { cwd: root, bindings: { configStore: 'app_config', kv: { pages: 'pages' } }, canonicalBuild: true, requirePlatformCapability: false, emitWat: false };
const plan = source => buildCanonicalNativePlan(compileCanonicalSource(source, { fileName: 'mem10.ts', strict: false, requireAsync: true }));
const scratchDeclaration = `// Each read is synchronous through owned-string decoding and parsing. Parallel
// effects enter their waits serially; no result or pending hostcall owns this
// scratch buffer. Only the written prefix is inspected, including after errors.
@lazy let __kv_read_buffer: Uint8Array | null = null;
`;
const quoteComment = `// Return the same quoted form registered for redaction so validation and writes
// do not allocate and scan a second representation of each string or key.
`;
function restoreQuoteBaseline(source) {
  if (!source.includes('function __kv_private(text: string): string {')) return source;
  source = replaceExact(source, quoteComment, '');
  source = replaceExact(source, 'function __kv_private(text: string): string {', 'function __kv_private(text: string): void {');
  source = replaceExact(source, '  return encoded;\n}', '}');
  source = replaceExact(source, 'else if (value.kind == PULSE_VALUE_STRING) this.add(__kv_private(value.text));',
    'else if (value.kind == PULSE_VALUE_STRING) { __kv_private(value.text); this.add(__pulse_fastly_quote(value.text)); }');
  return replaceExact(source, "if (object) this.add(__kv_private(value.keys[i]) + ':');",
    "if (object) { __kv_private(value.keys[i]); this.add(__pulse_fastly_quote(value.keys[i]) + ':'); }");
}
function variantSource(mode, quoteReuse = false) {
  let source = fs.readFileSync(kvPath, 'utf8');
  if (quoteReuse) {
    assert.ok(['baseline', 'values-only', 'keys-only', 'candidate'].includes(mode));
    assert.ok(source.includes('function __kv_private(text: string): string {'), 'MEM12 implementation required');
    if (mode === 'baseline') return restoreQuoteBaseline(source);
    if (mode === 'values-only') return replaceExact(source, "if (object) this.add(__kv_private(value.keys[i]) + ':');",
      "if (object) { __kv_private(value.keys[i]); this.add(__pulse_fastly_quote(value.keys[i]) + ':'); }");
    if (mode === 'keys-only') return replaceExact(source, 'else if (value.kind == PULSE_VALUE_STRING) this.add(__kv_private(value.text));',
      'else if (value.kind == PULSE_VALUE_STRING) { __kv_private(value.text); this.add(__pulse_fastly_quote(value.text)); }');
    return source;
  }
  // Preserve the historical MEM11 ablations after MEM12 changes production.
  source = restoreQuoteBaseline(source);
  if (mode === 'baseline' || mode === 'validation-only') {
    source = replaceExact(source, scratchDeclaration, '');
    source = replaceExact(source, '  if (__kv_read_buffer === null) __kv_read_buffer = new Uint8Array(__KV_wireBytes + 1);\n', '');
    source = replaceExact(source, 'const buffer = __kv_read_buffer!, written', 'const buffer = new Uint8Array(__KV_wireBytes + 1), written');
  }
  if (mode === 'baseline' || mode === 'buffer-only') {
    source = replaceExact(source, `seen: Set<i32> = new Set<i32>(); parts: Array<string> | null;
  // Reads need the same validation and redaction walk, but no serialized output.
  constructor(materialize: bool = true) { this.parts = materialize ? new Array<string>() : null; }`,
    'seen: Set<i32> = new Set<i32>(); parts: Array<string> = new Array<string>();');
    source = replaceExact(source, 'else if (this.parts !== null) this.parts!.push(text);', 'else this.parts.push(text);');
    source = replaceExact(source, "this.parts!.join('')", "this.parts.join('')");
    source = replaceExact(source, 'encoder = new __KvEncoder(false); encoder.visit(value);', 'encoder = new __KvEncoder(); encoder.encode(value);');
  }
  return source;
}
function instrument(source) {
  source = replaceExact(source, 'function __kv_read(index: i32, body: i32, generation: u64): i32 {',
    'function __kv_read(index: i32, body: i32, generation: u64): i32 {\n  const beforeBuffer = __mem11_stub_used();');
  const buffer = source.match(/^  const buffer = .*, written = new StaticArray<i32>\(1\); let count = 0;$/m)[0];
  source = replaceExact(source, buffer, buffer + '\n  __mem11_buffer += __mem11_stub_used() - beforeBuffer;');
  const parser = '  const parser = new __PulseJsonParser(String.UTF8.decodeUnsafe(buffer.dataStart, count, false), true), parsed = parser.parse();';
  source = replaceExact(source, parser, '  const beforeParse = __mem11_stub_used();\n' + parser + '\n  __mem11_parse += __mem11_stub_used() - beforeParse;');
  const encoder = source.match(/^  const value = __pulse_fastly_payload_field\(outer, 'value'\), encoder = .*$/m)[0];
  source = replaceExact(source, encoder, '  const beforeValidation = __mem11_stub_used();\n' + encoder + '\n  __mem11_validation += __mem11_stub_used() - beforeValidation;');
  return source + `
let __mem11_buffer: u64 = 0; let __mem11_parse: u64 = 0; let __mem11_validation: u64 = 0;
export function mem11_buffer(): u64 { return __mem11_buffer }
export function mem11_parse(): u64 { return __mem11_parse }
export function mem11_validation(): u64 { return __mem11_validation }
export function mem11_arena(): usize { return __mem11_stub_used() }
`;
}
function compiler(mode, runtime, quoteReuse = false) {
  const loaded = new Module(platformPath, module); loaded.filename = platformPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(platformPath));
  const original = loaded.require.bind(loaded), current = fs.readFileSync(kvPath, 'utf8');
  const replacement = runtime ? instrument(variantSource(mode, quoteReuse)) : variantSource(mode, quoteReuse);
  loaded.require = id => id === './kv-native.js' ? { ...kv, kvNativeSource(nativePlan) {
    const source = kv.kvNativeSource(nativePlan);
    return source ? replaceExact(source, current, replacement) : source;
  } } : original(id);
  let source = fs.readFileSync(platformPath, 'utf8');
  if (runtime) source = replaceExact(source, "(schemaCodecsActive ? 'incremental' : 'stub')", JSON.stringify(runtime));
  loaded._compile(source, platformPath); return loaded.exports;
}
async function run({ quoteReuse = false } = {}) {
  const ticket = quoteReuse ? 'MEM12' : 'MEM11';
  const out = path.resolve(process.env[ticket + '_OUT'] || path.join(root, 'wasm/.test-results/' + ticket.toLowerCase() + '-evidence'));
  fs.mkdirSync(out, { recursive: true });
  const launcher = cli.inspectFastlyComputeLauncher({ launcherKind: 'viceroy-direct' });
  const samples = 20, localRounds = 2, buildRounds = 3, names = ['baseline', 'candidate'];
  const order = round => round % 2 ? [...names].reverse() : names;
  const report = { version: quoteReuse ? 'pulse.mem12.quote-reuse.v1' : 'pulse.mem11.read-temporaries.v1', recordedAt: new Date().toISOString(),
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceIdentity: { kvSourceSha256: hash(fs.readFileSync(kvPath)), baselineKvSourceSha256: hash(variantSource('baseline', quoteReuse)),
      workingDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })), harnessSha256: hash(fs.readFileSync(__filename)) },
    environment: { node: process.version, platform: process.platform, arch: process.arch, kernel: os.release(), cpu: os.cpus()[0]?.model,
      viceroy: { version: launcher.inspection.version, binarySha256: hash(fs.readFileSync(launcher.inspection.binary)) } },
    method: { samples, localRounds, buildRounds, warmups: 3, order: 'baseline first round 0; candidate first round 1',
      production: (quoteReuse ? 'current MEM12' : 'historical MEM11') + ' source; unchanged allocator/optimizer; no guest instrumentation or forced collection',
      diagnostic: 'separate stub arena accessors and integer counters; same allocation implementation; never used for timing',
      scope: 'injected host and direct Viceroy; capacity is not live bytes or RSS; no deployed or CAS acceptance claim' },
    builds: [], attribution: [], cases: [] };
  const plans = { small: plan("export default async function handler(ctx) { const value = await ctx.config.get('BARRIER'); return ctx.text(value); }"),
    loop: plan(loop.source), schema: planFor('bounded-open') }, artifacts = {};
  const baseline = compiler('baseline', undefined, quoteReuse), candidate = compiler('candidate', undefined, quoteReuse);
  for (const [family, nativePlan] of Object.entries(plans)) {
    const times = { baseline: [], candidate: [] };
    for (let round = 0; round < buildRounds; round++) for (const name of order(round)) {
      console.log(`${ticket} build ${family}/${name} ${round + 1}/${buildRounds}`);
      const compiled = (name === 'baseline' ? baseline : candidate).compileFastlyNativePlatformCapabilitiesPlan(nativePlan, options);
      const key = family + '/' + name;
      if (artifacts[key]) assert.deepEqual(compiled.wasm, artifacts[key].wasm, 'deterministic artifact');
      else artifacts[key] = compiled;
      times[name].push(compiled.durationMs);
    }
    const previous = quoteReuse ? mem11.builds.find(x => x.family === family && x.name === 'candidate')
      : mem10.builds.find(x => x.family === family && x.runtime === x.defaultRuntime);
    assert.equal(hash(artifacts[family + '/baseline'].wasm), previous.wasmSha256, 'exact preceding production baseline');
    if (quoteReuse) {
      const control = platform.compileFastlyNativePlatformCapabilitiesPlan(nativePlan, options);
      assert.deepEqual(artifacts[family + '/candidate'].wasm, control.wasm, 'exact current production artifact');
    } else {
      const historical = mem11.builds.find(x => x.family === family && x.name === 'candidate');
      assert.equal(hash(artifacts[family + '/candidate'].wasm), historical.wasmSha256, 'exact historical MEM11 candidate');
    }
    if (family !== 'loop') assert.deepEqual(artifacts[family + '/candidate'].wasm, artifacts[family + '/baseline'].wasm, 'non-KV byte identity');
    for (const name of names) {
      const compiled = artifacts[family + '/' + name];
      const dir = path.join(out, 'artifacts', family); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name + '.wasm'), compiled.wasm);
      report.builds.push({ family, name, buildMs: stats(times[name]), wasmBytes: compiled.wasm.length,
        wasmSha256: hash(compiled.wasm), sourceSha256: hash(compiled.source), assemblyScript: compiled.manifest.assemblyScript });
    }
  }
  write(path.join(out, 'evidence.json'), report);
  const quoted = { name: 'quoted-64', family: 'loop', shape: 'text', size: 8192, count: 64 };
  quoted.expected = loop.expected(quoted);
  quoted.payload = index => {
    const row = loop.payload(index, quoted);
    row.text = ('MEM12-' + index + '-雪😀\"\\\n\u0001').repeat(400);
    row['key-\"\\\n-' + index] = row.text;
    return row;
  };
  const corpus = [...cases(), { name: 'missing-first-row', family: 'loop', count: 0, expected: 'unavailable' }, ...(quoteReuse ? [quoted] : [])];
  for (const test of corpus) {
    const row = { name: test.name, family: test.family, recipes: {} };
    for (const name of names) row.recipes[name] = { injected: injected(artifacts[test.family + '/' + name].wasm, test, samples), local: [] };
    const a = row.recipes.baseline.injected, b = row.recipes.candidate.injected;
    for (const key of ['status', 'bodySha256', 'traceSha256', 'traceEntries', 'accounted', 'pendingLookups', 'acquiredReadBodies']) assert.deepEqual(a[key], b[key], test.name + '/' + key);
    assert.ok(b.memoryCapacityBytes <= a.memoryCapacityBytes, 'capacity must not regress');
    for (let round = 0; round < localRounds; round++) for (const name of order(round)) {
      console.log(`${ticket} Viceroy ${test.name}/${name} ${round + 1}/${localRounds}`);
      const result = await local(artifacts[test.family + '/' + name].wasm, test, launcher, path.join(out, test.name, name), samples);
      assert.equal(result.bodySha256, row.recipes[name].injected.bodySha256);
      row.recipes[name].local.push(result);
    }
    report.cases.push(row); write(path.join(out, 'evidence.json'), report);
  }
  // Attribution uses a separate diagnostic artifact and pinned stub source.
  const asc = resolveAsc(path.join(root, 'wasm/packages/compiler'));
  assert.equal(require(path.join(asc.packageRoot, 'package.json')).version, '0.28.18');
  let stub = fs.readFileSync(path.join(asc.packageRoot, 'std/assembly/rt/stub.ts'), 'utf8');
  report.stubSourceSha256 = hash(stub);
  stub = stub.replace('from "./common"', 'from "~lib/rt/common"').replace('from "../util/error"', 'from "~lib/util/error"');
  stub += '\n@global export function __mem11_stub_used(): usize { return offset - startOffset }\n';
  const runtime = path.join(out, ticket.toLowerCase() + '-stub'); fs.writeFileSync(runtime + '.ts', stub);
  for (const name of quoteReuse ? ['baseline', 'values-only', 'keys-only', 'candidate'] : ['baseline', 'buffer-only', 'validation-only', 'candidate']) {
    console.log(`${ticket} allocation attribution ${name}`);
    const production = name === 'baseline' || name === 'candidate' ? artifacts['loop/' + name]
      : compiler(name, undefined, quoteReuse).compileFastlyNativePlatformCapabilitiesPlan(plans.loop, options);
    const diagnostic = compiler(name, runtime, quoteReuse).compileFastlyNativePlatformCapabilitiesPlan(plans.loop, options);
    const rows = [];
    for (const test of [...loop.cases, ...(quoteReuse ? [quoted] : [])]) {
      const plain = injected(production.wasm, { ...test, family: 'loop', expected: loop.expected(test) }, 1);
      const result = execute(diagnostic, hostOptions({ ...test, family: 'loop' })), e = result.instance.exports;
      assert.equal(hash(result.response.body), plain.bodySha256);
      assert.equal(hash(JSON.stringify(result.trace)), plain.traceSha256);
      assert.equal(Number(e.pulse_fastly_memory_bytes()), plain.accounted.bytes);
      assert.equal(Number(e.pulse_fastly_memory_values()), plain.accounted.values);
      assert.equal(result.kvEvidence.pending.size, 0); assert.equal(result.kvEvidence.bodyFixtures.size, 0);
      rows.push({ name: test.name, productionCapacityBytes: plain.memoryCapacityBytes,
        arenaBytes: Number(e.mem11_arena()), readBufferAndOutputBytes: Number(e.mem11_buffer()),
        parseBytes: Number(e.mem11_parse()), validationBytes: Number(e.mem11_validation()) });
    }
    report.attribution.push({ name, productionWasmSha256: hash(production.wasm), diagnosticWasmSha256: hash(diagnostic.wasm), cases: rows });
    write(path.join(out, 'evidence.json'), report);
  }
  report.complete = true; write(path.join(out, 'evidence.json'), report);
  console.log(`${ticket} passed: ${report.cases.length} cases, ${report.attribution.length} allocation variants; ${out}/evidence.json`);
}
if (require.main === module) run({ quoteReuse: process.argv.includes('--quote-reuse') }).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run, variantSource, compiler };
