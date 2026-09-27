#!/usr/bin/env node
'use strict';

// Opt-in evidence: production compilation, a names-only companion, and binary census.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync, execFileSync } = require('node:child_process');
const { root, hash } = require('./schema-cost-profile.cjs');
const { fixture } = require('./gen01-census.cjs');
const o07 = require('./o07-evidence.json');
const { runTool, binaryenIdentity } = require('../../../packages/wasm-guest-link/src/toolchain');
const providerFile = path.join(root, 'packages/provider-fastly/src/build/native-platform-capabilities.js');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const features = ['--mvp-features', '--enable-mutable-globals', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '--enable-bulk-memory'];
const symbol = name => name.replace(/\\([a-f0-9]{2})/gi, (_, byte) => String.fromCharCode(parseInt(byte, 16)));

function reader(bytes) {
  return { at: 0, byte() { assert.ok(this.at < bytes.length); return bytes[this.at++]; },
    uint() { let n = 0, shift = 0, b; do { assert.ok(shift <= 28); b = this.byte(); n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; },
    text() { const n = this.uint(), end = this.at + n; assert.ok(end <= bytes.length); const s = bytes.subarray(this.at, end).toString('utf8'); this.at = end; return s; } };
}

function binary(bytes) {
  assert.ok(WebAssembly.validate(bytes), 'valid Wasm required before inspection');
  const r = reader(bytes); r.at = 8;
  const sections = [], bodies = []; let dataSegments = 0, dataPayloadBytes = 0;
  while (r.at < bytes.length) {
    const start = r.at, id = r.byte(), size = r.uint(), payload = r.at, end = payload + size;
    assert.ok(end <= bytes.length);
    if (id === 10) {
      for (let count = r.uint(); count; count--) {
        const n = r.uint(); assert.ok(r.at + n <= end); bodies.push(n); r.at += n;
      }
      assert.equal(r.at, end);
    }
    if (id === 11) {
      dataSegments = r.uint();
      for (let index = 0; index < dataSegments; index++) {
        const mode = r.uint(); assert.ok([0, 1, 2].includes(mode), 'supported data segment mode');
        if (mode === 2) r.uint();
        if (mode !== 1) {
          assert.equal(r.byte(), 0x41, 'fixture data offsets use i32.const');
          while (r.byte() & 128) { /* skip signed LEB offset */ }
          assert.equal(r.byte(), 0x0b);
        }
        const n = r.uint(); dataPayloadBytes += n; r.at += n; assert.ok(r.at <= end);
      }
      assert.equal(r.at, end);
    }
    sections.push({ id, offset: start, bytes: end - start, payloadBytes: size,
      sha256: hash(bytes.subarray(start, end)), raw: bytes.subarray(start, end) });
    r.at = end;
  }
  assert.equal(8 + sections.reduce((sum, s) => sum + s.bytes, 0), bytes.length);
  return { sections, bodies, dataSegments, dataPayloadBytes };
}

function assertCompanion(production, named) {
  const a = binary(production), b = binary(named);
  // Include section order, identifiers and length encodings, not only payloads.
  assert.deepEqual(a.sections.filter(s => s.id).map(s => s.raw), b.sections.filter(s => s.id).map(s => s.raw),
    'names companion must match every non-custom production section byte-for-byte');
  return a;
}

function functionNames(bytes) {
  const r = reader(bytes), names = new Map();
  while (r.at < bytes.length) {
    const id = r.byte(), size = r.uint(), end = r.at + size; assert.ok(end <= bytes.length);
    if (id === 1) {
      for (let count = r.uint(); count; count--) { const index = r.uint(); assert.ok(!names.has(index)); names.set(index, r.text()); }
      assert.equal(r.at, end);
    }
    r.at = end;
  }
  return names;
}

function family(name) {
  if (name.startsWith('byn$mgfn-shared$') || /^\d+$/.test(name)) return 'optimizer-created or unnamed';
  if (/\/__pulse_fastly_run_invocation$/.test(name)) return 'Fastly invocation driver';
  if (/\/__pulse_expr_\d+$/.test(name)) return 'expression helpers';
  if (/\/__pulse_chunk_\d+$/.test(name)) return 'handler chunks';
  if (/\/__pulse_fastly_schema_/.test(name)) return 'provider schema projectors';
  if (/__Pulse_gen_|\/__pulse_schema_|\/pulse_schema_|~lib\/json-as\//.test(name)) return 'schema codecs and json-as';
  if (/\/__pulse_invocation_|\/__pulse_fastly_resolve_/.test(name)) return 'effect settlement and resolution';
  if (/\/__pulse_application_|\/host_router_error_take$/.test(name)) return 'application error support';
  if (/\/(?:__pulse_step|__pulse_run|pulse_start|pulse_resume|pulse_set_effect_result)$/.test(name)) return 'portable dispatcher';
  if (name.startsWith('~lib/')) return 'AssemblyScript runtime and standard library';
  if (name.startsWith('fastly-native-platform-capabilities.as/')) return 'other generated Fastly and portable support';
  return 'other named functions';
}

function inspect(production, named, directory) {
  const parsed = assertCompanion(production, named); // No names may be read before this gate.
  const module = new WebAssembly.Module(named), custom = WebAssembly.Module.customSections(module, 'name');
  assert.equal(custom.length, 1);
  const names = functionNames(Buffer.from(custom[0]));
  const imported = WebAssembly.Module.imports(module).filter(item => item.kind === 'function').length;
  const namedFile = path.join(directory, 'named.wasm'), watFile = path.join(directory, 'named.wat');
  fs.writeFileSync(namedFile, named);
  runTool('wasm-dis', [namedFile, ...features, '-o', watFile]);
  const wat = fs.readFileSync(watFile, 'utf8');
  assert.ok(!/\b(?:call_indirect|call_ref|return_call)\b/.test(wat), 'direct-call fixture required');
  assert.ok(!/\(table\b/.test(wat), 'table-free fixture required');
  const functions = [...wat.matchAll(/^ \(func \$([^\s(]+)([\s\S]*?)^ \)/gm)].map((match, ordinal) => {
    const name = symbol(match[1]), index = imported + ordinal, calls = new Map();
    assert.equal(name, names.get(index) ?? String(ordinal), 'binary function index agrees with disassembly name');
    for (const call of match[2].matchAll(/\bcall \$([^\s()]+)/g)) {
      const callee = symbol(call[1]); calls.set(callee, (calls.get(callee) || 0) + 1);
    }
    return { index, name, family: family(name), bytes: parsed.bodies[ordinal],
      calls: [...calls].map(([callee, sites]) => ({ callee, sites })) };
  });
  assert.equal(functions.length, parsed.bodies.length);
  const byName = new Map(functions.map(f => [f.name, f])); assert.equal(byName.size, functions.length);
  const imports = new Set([...wat.matchAll(/\(import [^\n]*\(func \$([^\s()]+)/g)].map(m => symbol(m[1])));
  assert.equal(imports.size, imported);
  const edges = functions.flatMap(f => f.calls.map(edge => ({ caller: f.name, ...edge })));
  for (const e of edges) assert.ok(byName.has(e.callee) || imports.has(e.callee), 'resolved direct-call target: ' + e.callee);
  const roots = [...wat.matchAll(/\(export "[^"]+" \(func \$([^\s()]+)/g), ...wat.matchAll(/\(start \$([^\s()]+)/g)]
    .map(m => symbol(m[1]));
  const reachable = new Set(), queue = [...roots];
  for (let i = 0; i < queue.length; i++) {
    const name = queue[i]; if (reachable.has(name)) continue; reachable.add(name);
    queue.push(...(byName.get(name)?.calls || []).map(e => e.callee));
  }
  const families = {};
  for (const f of functions) {
    const row = families[f.family] ||= { functions: 0, bytes: 0, exportOrStartReachableFunctions: 0 };
    row.functions++; row.bytes += f.bytes; row.exportOrStartReachableFunctions += Number(reachable.has(f.name));
  }
  const codeBodyBytes = parsed.bodies.reduce((sum, n) => sum + n, 0);
  assert.equal(Object.values(families).reduce((sum, f) => sum + f.bytes, 0), codeBodyBytes);
  const rank = [...functions].sort((a, b) => b.bytes - a.bytes || a.index - b.index);
  const incoming = name => edges.filter(e => e.callee === name).reduce((sum, e) => sum + e.sites, 0);
  const row = f => ({ index: f.index, name: f.name, bytes: f.bytes, family: f.family,
    directCallSites: f.calls.reduce((sum, e) => sum + e.sites, 0), uniqueCallees: f.calls.length,
    incomingCallSites: incoming(f.name), exportOrStartReachable: reachable.has(f.name) });
  const driver = functions.find(f => f.family === 'Fastly invocation driver');
  assert.ok(driver && reachable.has(driver.name), 'retained driver reachable from exports/start');
  const graph = { functions, imports: [...imports], roots: [...new Set(roots)] };
  write(path.join(directory, 'graph.json'), graph);
  return { namedCompanionSectionsByteExact: true,
    sections: parsed.sections.map(({ raw, offset, ...s }) => s),
    codeSectionBytes: parsed.sections.find(s => s.id === 10)?.bytes || 0, codeBodyBytes,
    dataSectionBytes: parsed.sections.find(s => s.id === 11)?.bytes || 0,
    dataSegments: parsed.dataSegments, dataPayloadBytes: parsed.dataPayloadBytes,
    functions: functions.length, importedFunctions: imported,
    exportOrStartReachableFunctions: functions.filter(f => reachable.has(f.name)).length,
    directCallSites: edges.reduce((sum, e) => sum + e.sites, 0), uniqueCallEdges: edges.length,
    indirectCallSites: 0, tables: 0, families,
    largestFunctions: rank.slice(0, 15).map(row),
    mostRepeatedCallEdges: [...edges].sort((a, b) => b.sites - a.sites || a.caller.localeCompare(b.caller) || a.callee.localeCompare(b.callee)).slice(0, 15),
    driver: { ...row(driver), bodyRank: rank.indexOf(driver) + 1, calls: driver.calls },
    fullGraphSha256: hash(fs.readFileSync(path.join(directory, 'graph.json'))) };
}

function prepare(cell, directory) {
  const source = fixture(cell);
  if (cell.errorRoute) source.router = source.router.replace('export default app;', "app.error((error,ctx,next)=>ctx.text(error.code,{status:400}));\nexport default app;");
  const project = path.join(directory, 'project'); fs.mkdirSync(project, { recursive: true });
  const schemaFile = path.join(project, 'schemas.ts'); fs.writeFileSync(schemaFile, source.schema);
  const { extractSchemaRegistry } = require('../../../packages/schema-json/src/compiler/schema-registry');
  const { buildCanonicalSchemaBundle } = require('../../../packages/schema-json/src/compiler/canonical-schema-codecs');
  const { compileCanonicalRouterSource } = require('../../../packages/compiler/src/canonical-router-compiler');
  const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
  const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
  const schemaBundle = buildCanonicalSchemaBundle(extractSchemaRegistry(schemaFile, { projectRoot: project }).registry);
  const router = compileCanonicalRouterSource(source.router, { fileName: 'src/index.ts', rootDir: project });
  const compiled = compileCanonicalSource(router.sourceText, { fileName: 'src/index.ts', rootDir: project, strict: false,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata }, schemaBundle });
  assert.equal(compiled.ok, true);
  const plan = buildCanonicalNativePlan(compiled);
  assert.equal(plan.effects.length, cell.routes * cell.effects);
  assert.equal(plan.routing.entries.length, cell.routes + Number(!!cell.errorRoute));
  assert.equal(plan.schemas.registry.schemas.length, cell.schemas);
  return { plan, fixtureSha256: { router: hash(source.router), schema: hash(source.schema) } };
}

function compile(job) {
  const { plan, fixtureSha256 } = prepare(job.cell, job.directory);
  let ascCalls = 0, recipe;
  // Load the unchanged provider owner with a local child_process dependency.
  // The companion adds only --debug to the actual production invocation, so
  // schema transforms, runtime, retention and merging flags cannot drift.
  const owner = new Module(providerFile, module); owner.filename = providerFile;
  owner.paths = Module._nodeModulePaths(path.dirname(providerFile));
  const requireOwner = owner.require.bind(owner);
  owner.require = id => id !== 'node:child_process' ? requireOwner(id) : {
    ...requireOwner(id), spawnSync(executable, args, options) {
      assert.match(args[0], /asc\.js$/); assert.ok(!args.includes('--debug'));
      ascCalls++;
      recipe = args.slice(1).map(arg => path.isAbsolute(arg) ? (arg.startsWith(root + path.sep) ? path.relative(root, arg) : '<temporary>/' + path.basename(arg)) : arg);
      return spawnSync(executable, job.named ? [...args, '--debug'] : args, options);
    }
  };
  owner._compile(fs.readFileSync(providerFile, 'utf8'), providerFile);
  const artifact = owner.exports.compileFastlyNativePlatformCapabilitiesPlan(plan, {
    cwd: root, canonicalBuild: true, requirePlatformCapability: false, emitWat: false, bindings: { configStore: 'o07' }
  });
  assert.equal(ascCalls, 1); assert.equal(artifact.guestUnits?.length || 0, 0, 'this census is scoped to unlinked schema fixtures');
  fs.writeFileSync(path.join(job.directory, job.named ? 'named.wasm' : 'production.wasm'), artifact.wasm);
  return { fixtureSha256, sourceSha256: hash(artifact.source), sourceBytes: Buffer.byteLength(artifact.source),
    wasmSha256: hash(artifact.wasm), rawBytes: artifact.wasm.length, recipe,
    assemblyScript: artifact.manifest.assemblyScript, jsonAs: artifact.manifest.jsonAs };
}

function main() {
  if (process.argv[2] === '--compile') return console.log(JSON.stringify(compile(JSON.parse(process.argv[3]))));
  const out = path.join(root, 'wasm/.test-results/compiler-efficiency/o08', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(out, { recursive: true });
  const reportFile = path.join(out, 'measurements.json');
  const cells = [...o07.cells.map(row => row.cell), ...[1, 8, 32].map(effects => ({ id: `sites-${effects}-error-route`, schemas: 1, diverse: false, routes: 1, effects, errorRoute: true }))];
  const files = [__filename, require.resolve('./gen01-census.cjs'), require.resolve('./o07-evidence.json'), providerFile,
    path.join(root, 'packages/provider-fastly/src/build/native-application-errors.js'),
    path.join(root, 'wasm/packages/runtime-core-as/src/compiler/canonical-native.js'),
    path.join(root, 'wasm/packages/build-support/src/native-optimization.js'),
    path.join(root, 'wasm/packages/build-support/src/native-retention-transform.cjs')];
  const report = { version: 'pulse.o08.optimized-wasm-census.v1', status: 'running', sourceRevision: git(['rev-parse', 'HEAD']),
    workingTree: git(['status', '--porcelain']), node: process.version,
    lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    sourceSha256: Object.fromEntries(files.map(file => [path.relative(root, file), hash(fs.readFileSync(file))])),
    binaryen: binaryenIdentity(), gzip: execFileSync('gzip', ['--version'], { encoding: 'utf8' }).split('\n')[0],
    profile: 'default', cells: [], limitations: [
      'Synthetic Fastly Native config.get fixtures; seven O-07 cells and three matched application-error-handler controls.',
      'One production and one names-only compile per cell; no timing, memory or performance improvement inferred.',
      'Family attribution follows surviving function names; inlined code is charged to its surviving caller and shared optimizer helpers have no inferred source owner.',
      'Call sites are static direct instructions, not execution counts; reachability starts at every function export and the start function.',
      'Code body bytes include local declarations; section bytes include headers; data payload bytes exclude segment and section framing.',
      'No linked guests, indirect calls, tables, deployed execution, optimizer-profile comparison or O-09 behavioral qualification.'
    ] };
  try {
    for (const cell of cells) {
      const directory = path.join(out, cell.id); fs.mkdirSync(directory);
      const builds = [false, true].map(named => {
        const result = spawnSync(process.execPath, [__filename, '--compile', JSON.stringify({ cell, directory, named })], {
          encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024
        });
        assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
        return JSON.parse(result.stdout);
      });
      assert.equal(builds[0].sourceSha256, builds[1].sourceSha256);
      assert.deepEqual(builds[0].recipe, builds[1].recipe);
      const production = fs.readFileSync(path.join(directory, 'production.wasm')), named = fs.readFileSync(path.join(directory, 'named.wasm'));
      const analysis = inspect(production, named, directory);
      // A valid Wasm with changed data must fail the identity gate even when
      // every code body is unchanged. Additional custom metadata is permitted.
      if (report.cells.length === 0) {
        const corrupted = Buffer.from(named), data = binary(corrupted).sections.find(s => s.id === 11);
        assert.ok(data); corrupted[data.offset + data.bytes - 1] ^= 1;
        assert.ok(WebAssembly.validate(corrupted));
        assert.throws(() => assertCompanion(production, corrupted), /every non-custom/);
        assertCompanion(production, Buffer.concat([named, Buffer.from([0, 2, 1, 120])]));
        report.identityGateControls = { changedDataRejected: true, extraCustomSectionAccepted: true };
      }
      const prior = o07.cells.find(row => row.cell.id === cell.id);
      if (prior) assert.deepEqual(builds[0].fixtureSha256, prior.fixtureSha256);
      const gzip = spawnSync('gzip', ['-n', '-9', '-c'], { input: production, maxBuffer: 16 * 1024 * 1024 });
      assert.equal(gzip.status, 0);
      const entry = { cell, ...builds[0], gzipBytes: gzip.stdout.length, gzipSha256: hash(gzip.stdout),
        o07SourceMatches: prior ? prior.sourceSha256 === builds[0].sourceSha256 : null,
        namedWasmSha256: builds[1].wasmSha256, ...analysis };
      report.cells.push(entry); write(reportFile, report);
      console.log(JSON.stringify({ cell: cell.id, rawBytes: entry.rawBytes, functions: entry.functions, driverBytes: entry.driver.bytes, driverRank: entry.driver.bodyRank }));
    }
    report.status = 'passed'; write(reportFile, report);
    console.log(JSON.stringify({ status: report.status, cells: report.cells.length, compiles: report.cells.length * 2, report: path.relative(root, reportFile) }));
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); write(reportFile, report); throw error; }
}

if (require.main === module) { try { main(); } catch (error) { console.error(error); process.exitCode = 1; } }
module.exports = { binary, assertCompanion, functionNames, family };
