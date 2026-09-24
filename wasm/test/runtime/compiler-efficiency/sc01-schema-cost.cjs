#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { gzipSync } = require('node:zlib');
const { root, hash, profileRegistry } = require('./schema-cost-profile.cjs');
const { extractSchemaRegistry } = require('../../../packages/schema-json/src/compiler/schema-registry');
const { buildCanonicalSchemaBundle, createCanonicalSchemaCodecs } = require('../../../packages/schema-json/src/compiler/canonical-schema-codecs');
const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const handler = "export default async function handler(ctx) { const value = await ctx.req.json('proof.Record0'); return ctx.json(value, { schema: 'proof.Record0' }); }";
const value = { id: 'r1', title: 'hello', count: 2, active: true, owner: { name: 'owner' }, tags: ['a'], note: null };

function fixture(count) {
  return `import {defineSchemaRegistry, schema} from '@pulse-compute/pulse/schema';
interface Record { id: string; title: string; count: number; active: boolean; owner: { name: string }; tags: string[]; note?: string | null }
export default defineSchemaRegistry({ schemas: {${Array.from({ length: count }, (_, index) => `'proof.Record${index}':schema<Record>()`).join(',')}} });\n`;
}

function finalBodies(wasm) {
  let at = 8;
  function uint() { let n = 0, shift = 0, byte; do { byte = wasm[at++]; assert.ok(at <= wasm.length && shift <= 28); n += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return n; }
  while (at < wasm.length) {
    const id = wasm[at++], size = uint(), end = at + size; assert.ok(end <= wasm.length);
    if (id === 10) { const bodies = []; for (let count = uint(); count; count--) { const size = uint(); bodies.push(size); at += size; } assert.equal(at, end);
      return { functions: bodies.length, codeBodyBytes: bodies.reduce((a, b) => a + b, 0), largestBodyBytes: Math.max(...bodies) }; }
    at = end;
  }
  throw Error('missing code section');
}

function prepare(job) {
  const start = performance.now();
  const extracted = extractSchemaRegistry(job.schemaFile, { projectRoot: job.project });
  const extractionMs = performance.now() - start;
  const bundle = buildCanonicalSchemaBundle(extracted.registry);
  const compiled = compileCanonicalSource(handler, { fileName: 'schema-cost.ts', schemaBundle: bundle, target: 'native', strict: true, requireAsync: true });
  return { extracted, extractionMs, bundle, compiled, plan: buildCanonicalNativePlan(compiled) };
}

async function worker(mode, job) {
  if (mode === '--audit') {
    const project = require('../../../packages/cli/src/project-config').resolveProject({ cwd: job.project, profile: job.profile });
    const begin = performance.now();
    const extracted = extractSchemaRegistry(project.schemaFile, { projectRoot: project.root });
    const extractionMs = performance.now() - begin;
    const compiled = require('../../../packages/cli/src/project-execution').compileProject(project, { target: 'native' });
    assert.equal(compiled.ok, true);
    return { extractionMs, selectedProfile: project.profile, configSha256: hash(fs.readFileSync(project.configFile)),
      schemaDependencies: extracted.dependencies.map(file => ({ file: path.relative(project.root, file), sha256: hash(fs.readFileSync(file)) })),
      projectSourceHash: compiled.metadata.projectSourceHash,
      ...profileRegistry(extracted.registry, compiled.metadata.schemaReferences, project.schemas) };
  }
  if (mode === '--profile') {
    const { extracted, extractionMs, compiled } = prepare(job);
    return { extractionMs, ...profileRegistry(extracted.registry, compiled.metadata.schemaReferences) };
  }
  if (mode === '--compile') {
    const begin = performance.now(), { plan, extractionMs } = prepare(job);
    const planningMs = performance.now() - begin;
    const compile = job.target === 'node' ? require('../../../packages/compiler/src/canonical-native-compiler').compileCanonicalNativePlan
      : require('../../../../packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan;
    const artifact = compile(plan, { cwd: root, canonicalBuild: true, requirePlatformCapability: false, emitWat: false });
    const buildMs = performance.now() - begin, compilerWorkerPeakRssBytes = process.resourceUsage().maxRSS * 1024;
    fs.writeFileSync(job.file + '.wasm', artifact.wasm); write(job.file + '.plan.json', plan);
    return { extractionMs, planningMs, buildMs, compilerWorkerPeakRssBytes,
      wasmBytes: artifact.wasm.length, gzipBytes: gzipSync(artifact.wasm, { level: 9 }).length, wasmSha256: hash(artifact.wasm),
      sourceBytes: Buffer.byteLength(artifact.source), sourceSha256: hash(artifact.source), ...finalBodies(artifact.wasm),
      assemblyScript: artifact.manifest.assemblyScript, jsonAs: artifact.manifest.jsonAs,
      optimization: artifact.optimization || artifact.manifest.optimization || 'default' };
  }
  if (mode === '--runtime') {
    const wasm = fs.readFileSync(job.file + '.wasm'), plan = read(job.file + '.plan.json');
    const request = { method: 'POST', path: '/', body: JSON.stringify({ ...value, dropped: 'unknown' }), headers: [['content-type', 'application/json']] };
    const start = performance.now(); let exports, response, coldRequestMs;
    if (job.target === 'node') {
      const host = require('../../../packages/host-runtime/src/runtime/canonical-native-host');
      response = (await host.executeCanonicalNativeModule({ wasm, plan }, { request })).response;
      coldRequestMs = performance.now() - start;
      exports = host.instantiateCanonicalNativeModule({ wasm, plan }).exports;
    } else {
      const result = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host').executeFastlyNativePlatformCapabilities(wasm, { request });
      response = result.response; exports = result.instance.exports;
      coldRequestMs = performance.now() - start;
    }
    assert.equal(response.status, 200); assert.deepEqual(JSON.parse(response.body), value);
    const codecs = createCanonicalSchemaCodecs(plan.schemas.registry);
    function guest(index, text, encode) {
      const pointer = exports.__pin(exports.__new(text.length * 2, exports.pulse_schema_string_id()));
      try {
        const input = new Uint16Array(exports.memory.buffer, pointer, text.length);
        for (let i = 0; i < text.length; i++) input[i] = text.charCodeAt(i);
        const output = (encode ? exports.pulse_schema_encode : exports.pulse_schema_decode)(index, pointer);
        const size = new DataView(exports.memory.buffer).getUint32(output - 4, true);
        return Buffer.from(exports.memory.buffer, output, size).toString('utf16le');
      } finally { exports.__unpin(pointer); }
    }
    // Every ID remains callable in optimized bytes, including compiler-unreferenced
    // entries. The independent oracle checks projection, optionality and rejection.
    for (let index = 0; index < job.count; index++) for (const encode of [false, true]) {
      const text = JSON.stringify({ ...value, dropped: 'unknown' });
      assert.deepEqual(JSON.parse(guest(index, text, encode)), value);
      assert.deepEqual(codecs.decodeJsonText(`proof.Record${index}`, text), value);
      const absent = { ...value }; delete absent.note;
      assert.deepEqual(JSON.parse(guest(index, JSON.stringify(absent), encode)), absent);
    }
    assert.throws(() => guest(job.count - 1, JSON.stringify({ ...value, count: 'wrong' }), false));
    assert.throws(() => guest(job.count, JSON.stringify(value), false));
    return { coldRequestMs, callableSchemaIds: job.count, compilerUnreferencedCallableIds: job.count - 1,
      modes: ['encode', 'decode'], unknownFieldsDropped: true, optionalAbsencePreserved: true,
      invalidValueRejected: true, invalidIndexRejected: true, codecProbeMemoryCapacityBytes: exports.memory.buffer.byteLength };
  }
  throw Error(`unknown mode ${mode}`);
}

function child(mode, job, env = {}) {
  const result = spawnSync(process.execPath, [__filename, mode, JSON.stringify(job)], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env }
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function main() {
  if (process.argv[2]) return console.log(JSON.stringify(await worker(process.argv[2], JSON.parse(process.argv[3]))));
  assert.equal(process.platform, 'linux', 'peak RSS uses Linux KiB');
  const output = path.join(root, 'wasm/.test-results/compiler-efficiency/sc01', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-sc01-'));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const report = { version: 'pulse.schema-cost-scope.v1', status: 'running', sourceRevision: git(['rev-parse', 'HEAD']),
    workingTree: git(['status', '--porcelain']), node: process.version,
    harnessSha256: hash(fs.readFileSync(__filename)), profilerSha256: hash(fs.readFileSync(require.resolve('./schema-cost-profile.cjs'))),
    lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    binaryen: require('../../../packages/wasm-guest-link/src/toolchain').binaryenIdentity(), samples: 3, cells: [], profiles: [],
    limits: ['Registry scaling, not a before/after optimization; all IDs and validation remain.',
      'Per-entry attribution is generated source, not additive compiler time, RSS or final Wasm bytes.',
      'Stage timings exclude diagnostic module loading, source attribution and verification.',
      'Worker and AssemblyScript peak RSS are separate process maxima, not guest live memory.',
      'Fastly uses the injected ABI host; no deployed cold-start or linked-guest claim.'] };
  const reportFile = path.join(output, 'measurements.json');
  try {
    for (const count of [1, 8, 32]) {
      const project = path.join(temporary, String(count)); fs.mkdirSync(project);
      const schemaFile = path.join(project, 'schemas.ts'); fs.writeFileSync(schemaFile, fixture(count));
      const profiles = [];
      for (let sample = 0; sample < 3; sample++) profiles.push(child('--profile', { project, schemaFile }));
      for (const profile of profiles) {
        assert.equal(profile.entries.filter(entry => entry.compilerReferences === 0).length, count - 1);
        assert.equal(new Set(profile.entries.map(entry => entry.rootShapeSha256)).size, 1);
        assert.equal(profile.portable.sha256, profiles[0].portable.sha256);
        assert.equal(profile.fastly.sha256, profiles[0].fastly.sha256);
      }
      report.profiles.push({ count, fixtureSha256: hash(fixture(count)), ...profiles[0],
        stageSamples: profiles.map(profile => ({ extractionMs: profile.extractionMs, ...profile.stages })) });
      const cells = {};
      for (const target of ['node', 'fastly']) { cells[target] = { count, target, samples: [] }; report.cells.push(cells[target]); }
      for (let sample = 0; sample < 3; sample++) for (const target of sample % 2 ? ['fastly', 'node'] : ['node', 'fastly']) {
        const file = path.join(output, `${target}-${count}`), job = { target, count, project, schemaFile, file };
        const usage = path.join(temporary, `usage-${count}-${sample}-${target}`); fs.mkdirSync(usage);
        const hook = path.join(usage, 'usage.cjs');
        fs.writeFileSync(hook, `if (/assemblyscript.*asc\\.js$/.test(process.argv[1] || '')) process.once('exit', () => require('node:fs').writeFileSync(${JSON.stringify(usage)} + '/' + process.pid + '.json', JSON.stringify(process.resourceUsage().maxRSS * 1024)));`);
        const compiled = child('--compile', job, { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(hook)}` });
        const rss = fs.readdirSync(usage).filter(name => name.endsWith('.json')).map(name => read(path.join(usage, name))); assert.ok(rss.length);
        compiled.assemblyScriptPeakRssBytes = Math.max(...rss);
        const runtime = child('--runtime', job);
        if (sample) assert.equal(compiled.wasmSha256, cells[target].samples[0].wasmSha256);
        cells[target].samples.push({ sample, ...compiled, runtime }); write(reportFile, report);
        console.log(JSON.stringify({ count, target, sample, wasmBytes: compiled.wasmBytes, buildMs: compiled.buildMs }));
      }
    }
    report.status = 'passed'; write(reportFile, report);
    console.log(JSON.stringify({ status: report.status, cells: report.cells.length, compileSamples: 18, report: path.relative(root, reportFile) }));
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); write(reportFile, report); throw error; }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture };
