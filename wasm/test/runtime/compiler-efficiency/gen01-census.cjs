#!/usr/bin/env node
'use strict';

// Opt-in evidence only. Compile samples run in fresh processes; diagnostic
// attribution is deliberately outside the measured compile path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync, execFileSync } = require('node:child_process');
const { gzipSync } = require('node:zlib');
const { root, hash } = require('./schema-cost-profile.cjs');
const { extractSchemaRegistry } = require('../../../packages/schema-json/src/compiler/schema-registry');
const { buildCanonicalSchemaBundle } = require('../../../packages/schema-json/src/compiler/canonical-schema-codecs');
const { compileCanonicalRouterSource } = require('../../../packages/compiler/src/canonical-router-compiler');
const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const provider = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const portable = require('../../../packages/runtime-core-as/src/compiler/canonical-native');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const size = text => Buffer.byteLength(text);
const ownerFiles = [
  'wasm/packages/runtime-core-as/src/compiler/canonical-native.js',
  'packages/provider-fastly/src/build/native-platform-capabilities.js',
  'packages/provider-fastly/src/build/s3-native.js',
  'packages/provider-fastly/src/build/time-native.js',
  'packages/provider-fastly/src/build/digest-native.js',
  'packages/provider-fastly/src/build/kv-native.js',
  'packages/provider-fastly/src/build/effect-invocations.js'
];

function fixture(cell) {
  const types = [
    'interface R0 { id: string; tag: string }',
    ...Array.from({ length: cell.schemas - 1 }, (_, index) => cell.diverse
      ? `interface R${index + 1} { id: string; tag: string; variant${index}: ${index % 3 === 0 ? 'number' : index % 3 === 1 ? 'boolean' : 'string[]'}; nested: { key${index}: string } }`
      : `interface R${index + 1} { id: string; tag: string }`)
  ];
  const schema = `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';\n${types.join('\n')}\nexport default defineSchemaRegistry({schemas:{${types.map((_, index) => `'gen.R${index}':schema<R${index}>()`).join(',')}}});\n`;
  const effects = Array.from({ length: cell.effects }, (_, index) => `const e${index}=await ctx.config.get('GEN${index}');`).join('');
  const response = `const v=ctx.decodeJson('{"id":"one","tag":"ok"}','gen.R0');return ctx.text(ctx.encodeJson(v,'gen.R0')${Array.from({ length: cell.effects }, (_, index) => `+(e${index}||'')`).join('')})`;
  const routes = Array.from({ length: cell.routes }, (_, index) => `app.get('/r${index}',async(ctx)=>{${effects}${response}})`);
  return { schema, router: `import {Router} from '@pulse-compute/runtime';\nconst app=new Router();\n${routes.join(';\n')};\nexport default app;\n` };
}

function planFor(job) {
  const start = performance.now();
  const registry = extractSchemaRegistry(job.schemaFile, { projectRoot: job.project }).registry;
  const extractionMs = performance.now() - start;
  const bundle = buildCanonicalSchemaBundle(registry);
  const routerText = fs.readFileSync(job.routerFile, 'utf8');
  const router = compileCanonicalRouterSource(routerText, { fileName: 'src/index.ts', rootDir: job.project });
  const compiled = compileCanonicalSource(router.sourceText, { fileName: 'src/index.ts', rootDir: job.project, strict: false,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata }, schemaBundle: bundle });
  assert.equal(compiled.ok, true);
  const plan = buildCanonicalNativePlan(compiled);
  assert.equal(plan.routing.entries.length, job.cell.routes);
  assert.equal(plan.effects.length, job.cell.routes * job.cell.effects);
  assert.equal(plan.schemas.registry.schemas.length, job.cell.schemas);
  return { plan, extractionMs, planningMs: performance.now() - start };
}

function bodies(wasm) {
  let at = 8;
  function uint() { let n = 0, shift = 0, byte; do { byte = wasm[at++]; assert.ok(at <= wasm.length && shift <= 28); n += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return n; }
  while (at < wasm.length) {
    const section = wasm[at++], length = uint(), end = at + length;
    assert.ok(end <= wasm.length);
    if (section === 10) {
      const list = []; for (let count = uint(); count; count--) { const bytes = uint(); list.push(bytes); at += bytes; }
      assert.equal(at, end);
      return { functionCount: list.length, codeBodyBytes: list.reduce((sum, value) => sum + value, 0),
        largestBodies: list.map((bytes, ordinal) => ({ ordinal, bytes })).sort((a, b) => b.bytes - a.bytes).slice(0, 5) };
    }
    at = end;
  }
  throw Error('missing optimized Wasm code section');
}

const declaration = /^(?:@[^\n]+\n)*(?:export )?(?:function|class|const|let) (\w+)/gm;
const declarations = source => [...source.matchAll(declaration)];
function diagnosticStage(file, name) {
  const filename = path.join(root, file), source = fs.readFileSync(filename, 'utf8');
  assert.match(source, new RegExp(`^function ${name}\\(`, 'm'));
  const diagnostic = new Module(filename, module);
  diagnostic.filename = filename;
  diagnostic.paths = Module._nodeModulePaths(path.dirname(filename));
  diagnostic._compile(source + `\nmodule.exports = ${name};\n`, filename);
  return diagnostic.exports;
}

function attribution(source, plan, generated) {
  const providerFile = ownerFiles[1], portableFile = ownerFiles[0];
  const codecStage = diagnosticStage(portableFile, 'nativeSchemaCodecSource')(plan);
  const projectorStage = diagnosticStage(providerFile, 'generateSchemaRuntime')(plan);
  const effectResult = diagnosticStage(providerFile, 'effectResultSource')(plan, generated.bindings);
  const effectDispatch = diagnosticStage(providerFile, 'effectDispatchSource')(plan);
  const portableSource = generated.portable.source;
  const codecsText = codecStage.declarations.join('\n');
  assert.ok(portableSource.includes(codecsText), 'portable codec stage is byte-exact');
  assert.ok(source.includes(codecsText) && source.includes(projectorStage), 'provider projection stage is byte-exact in final source');
  const named = new Map();
  function add(text, category) {
    for (const match of declarations(text)) {
      const prior = named.get(match[1]);
      assert.ok(!prior || prior === category || (prior === 'dispatcher/handlers' && category === 'portable codecs'),
        `ambiguous source declaration ${match[1]}: ${prior} / ${category}`);
      named.set(match[1], category);
    }
  }
  add(portableSource, 'dispatcher/handlers');
  add([...codecStage.declarations, ...codecStage.exports].join('\n'), 'portable codecs');
  add(projectorStage, 'provider projections');
  add(effectResult, 'package/effect adapters');
  add(effectDispatch, 'package/effect adapters');
  const modules = [
    ['s3-native.js', 's3NativeSource', [plan, generated.bindings]],
    ['time-native.js', 'timeNativeSource', [plan]],
    ['digest-native.js', 'digestNativeSource', [plan]],
    ['kv-native.js', 'kvNativeSource', [plan]],
    ['effect-invocations.js', 'runtimeSource', []]
  ];
  for (const [file, method, args] of modules) {
    const lib = require(path.join(root, 'packages/provider-fastly/src/build', file));
    add(lib[method](...args), 'package/effect adapters');
  }
  const rows = Object.fromEntries(['portable codecs', 'provider projections', 'runtime support', 'dispatcher/handlers', 'package/effect adapters']
    .map(category => [category, { bytes: 0, declarations: 0, largest: [] }]));
  const all = declarations(source);
  rows['runtime support'].bytes += size(source.slice(0, all[0]?.index ?? source.length));
  const duplicates = new Map();
  for (let index = 0; index < all.length; index++) {
    const name = all[index][1], text = source.slice(all[index].index, all[index + 1]?.index ?? source.length);
    const category = named.get(name) || 'runtime support';
    const row = rows[category], bytes = size(text);
    row.bytes += bytes; row.declarations++;
    row.largest.push({ name, bytes });
    // Compare function bodies exactly; symbols and prelude are excluded. No
    // normalized clone is counted as semantic or post-optimization sharing.
    if (/^(?:export )?function /.test(text.trimStart())) {
      const body = text.slice(text.indexOf('{')).trim();
      const fingerprint = hash(body), group = duplicates.get(fingerprint) || { names: [], bytes: size(body) };
      assert.equal(group.bytes, size(body));
      group.names.push(name); duplicates.set(fingerprint, group);
    }
  }
  for (const row of Object.values(rows)) row.largest.sort((a, b) => b.bytes - a.bytes).splice(5);
  assert.equal(Object.values(rows).reduce((sum, row) => sum + row.bytes, 0), size(source), 'full final source byte reconciliation');
  const repeated = [...duplicates.values()].filter(item => item.names.length > 1).sort((a, b) => b.bytes * (b.names.length - 1) - a.bytes * (a.names.length - 1));
  return { bytes: size(source), categories: rows, exactRepeatedFunctionBodies: {
    groups: repeated.length, redundantBytes: repeated.reduce((sum, item) => sum + (item.names.length - 1) * item.bytes, 0),
    largest: repeated.slice(0, 8).map(item => ({ names: item.names, bodyBytes: item.bytes }))
  }, stageFragmentsByteExact: true, namedDeclarationCoverage: all.filter(item => named.has(item[1])).length,
  totalDeclarations: all.length };
}

function worker(mode, job) {
  const start = performance.now();
  const { plan, extractionMs, planningMs } = planFor(job);
  const options = { cwd: root, canonicalBuild: true, requirePlatformCapability: false, emitWat: false,
    bindings: { configStore: 'gen01' } };
  if (mode === '--analyze') {
    const generated = provider.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options);
    const partition = attribution(generated.source, plan, generated);
    return { partition, plan: { effects: plan.effects.length, routes: plan.routing.entries.length,
      schemaIds: plan.schemas.registry.schemas.length, locals: plan.locals.length },
      sourceSha256: hash(generated.source), sourceOwnerSha256: Object.fromEntries(ownerFiles.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])) };
  }
  assert.equal(mode, '--compile');
  const artifact = provider.compileFastlyNativePlatformCapabilitiesPlan(plan, options);
  const result = { extractionMs, planningMs, assemblyScriptMs: artifact.durationMs, buildMs: performance.now() - start,
    compilerWorkerPeakRssBytes: process.resourceUsage().maxRSS * 1024, sourceBytes: size(artifact.source),
    sourceSha256: hash(artifact.source), wasmBytes: artifact.wasm.length, wasmGzipBytes: gzipSync(artifact.wasm, { level: 9 }).length,
    wasmSha256: hash(artifact.wasm), ...bodies(artifact.wasm) };
  assert.ok(WebAssembly.validate(artifact.wasm));
  return result;
}

function child(mode, job, env = {}) {
  const result = spawnSync(process.execPath, [__filename, mode, JSON.stringify(job)], {
    encoding: 'utf8', timeout: 150000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env }
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function main() {
  if (process.argv[2]) return console.log(JSON.stringify(worker(process.argv[2], JSON.parse(process.argv[3]))));
  assert.equal(process.platform, 'linux', 'RSS accounting requires Linux KiB');
  const output = path.join(root, 'wasm/.test-results/compiler-efficiency/gen01', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-gen01-'));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const cells = [
    { id: 'schema-1', schemas: 1, diverse: false, routes: 1, effects: 1 },
    { id: 'schema-16-repeat', schemas: 16, diverse: false, routes: 1, effects: 1 },
    { id: 'schema-16-diverse', schemas: 16, diverse: true, routes: 1, effects: 1 },
    { id: 'schema-32-repeat', schemas: 32, diverse: false, routes: 1, effects: 1 },
    { id: 'routes-8', schemas: 1, diverse: false, routes: 8, effects: 1 },
    { id: 'effects-3', schemas: 1, diverse: false, routes: 1, effects: 3 },
    { id: 'routes-8-effects-3', schemas: 1, diverse: false, routes: 8, effects: 3 }
  ];
  const report = { version: 'pulse.gen01.generated-census.v1', status: 'running', sourceRevision: git(['rev-parse', 'HEAD']),
    workingTree: git(['status', '--porcelain']), harnessSha256: hash(fs.readFileSync(__filename)),
    lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), node: process.version,
    assemblyScript: require('assemblyscript/package.json').version, samples: 3, cells: [],
    limitations: ['Synthetic Fastly Native canonical Router fixtures; no deployed execution or app-wide proxy.',
      'Source categories partition final instrumented source by top-level declaration; unmatched declarations and text are runtime support.',
      'Wasm body ordinals are code-section ordinals; no names or source ownership inferred from an optimized body.',
      'Exact repeated source bodies exclude semantic clone detection and do not imply retained optimized Wasm duplication.',
      'Worker and AssemblyScript RSS are independent process peaks; timings are not additive across processes.'] };
  const reportFile = path.join(output, 'measurements.json');
  try {
    for (const cell of cells) {
      const project = path.join(temporary, cell.id), routerFile = path.join(project, 'src/index.ts'), schemaFile = path.join(project, 'schemas.ts');
      fs.mkdirSync(path.dirname(routerFile), { recursive: true });
      const source = fixture(cell); fs.writeFileSync(routerFile, source.router); fs.writeFileSync(schemaFile, source.schema);
      const job = { cell, project, routerFile, schemaFile };
      const entry = { cell, fixtureHashes: { router: hash(source.router), schema: hash(source.schema) }, samples: [] };
      report.cells.push(entry);
      entry.analysis = child('--analyze', job);
      for (let sample = 0; sample < report.samples; sample++) {
        const usage = path.join(temporary, `usage-${cell.id}-${sample}`); fs.mkdirSync(usage);
        const hook = path.join(usage, 'usage.cjs');
        fs.writeFileSync(hook, `if (/assemblyscript.*asc\\.js$/.test(process.argv[1] || '')) process.once('exit', () => require('node:fs').writeFileSync(${JSON.stringify(usage)} + '/' + process.pid + '.json', JSON.stringify(process.resourceUsage().maxRSS * 1024)));`);
        const compiled = child('--compile', job, { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(hook)}` });
        const usages = fs.readdirSync(usage).filter(name => name.endsWith('.json')).map(name => read(path.join(usage, name)));
        assert.ok(usages.length, 'AssemblyScript subprocess RSS hook ran');
        compiled.assemblyScriptPeakRssBytes = Math.max(...usages);
        assert.equal(compiled.sourceSha256, entry.analysis.sourceSha256);
        assert.equal(compiled.sourceBytes, entry.analysis.partition.bytes);
        if (sample) assert.equal(compiled.wasmSha256, entry.samples[0].wasmSha256);
        entry.samples.push(compiled); write(reportFile, report);
        console.log(JSON.stringify({ cell: cell.id, sample, wasmBytes: compiled.wasmBytes, buildMs: compiled.buildMs }));
      }
    }
    report.status = 'passed'; write(reportFile, report);
    console.log(JSON.stringify({ status: report.status, cells: cells.length, samples: cells.length * report.samples, report: path.relative(root, reportFile) }));
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); write(reportFile, report); throw error; }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (require.main === module) { try { main(); } catch (error) { console.error(error); process.exitCode = 1; } }
module.exports = { fixture, bodies, attribution };
