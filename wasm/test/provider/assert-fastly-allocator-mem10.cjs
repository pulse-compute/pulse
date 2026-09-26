#!/usr/bin/env node
'use strict';

// Opt-in evidence: change only the allocator argument in an in-memory compiler
// copy. No guest instrumentation, forced collection, or production edits.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const compilerPath = path.join(root, 'packages/provider-fastly/src/build/native-platform-capabilities.js');
const platform = require(compilerPath);
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { createConditionalKvAuthority } = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
const { encodeConditionalKvValue } = require('../../../packages/runtime/src/host');
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { replaceExact, planFor, corpus } = require('../runtime/compiler-efficiency/mem01-schema-materialization.cjs');
const loop = require('../runtime/compiler-efficiency/mem08-payload-retention.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const recipes = ['stub', 'incremental'];
const bindings = { configStore: 'app_config', kv: { pages: 'pages' } };
const configStores = { app_config: { BARRIER: 'ready' } };
const plan = source => buildCanonicalNativePlan(compileCanonicalSource(source, { fileName: 'mem10.ts', strict: false, requireAsync: true }));
const order = round => round % 2 ? [...recipes].reverse() : recipes;
function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], min: sorted[0], max: sorted.at(-1) };
}
function compilerFor(runtime) {
  assert.ok(recipes.includes(runtime));
  const source = replaceExact(fs.readFileSync(compilerPath, 'utf8'), "(schemaCodecsActive ? 'incremental' : 'stub')", JSON.stringify(runtime));
  const loaded = new Module(compilerPath, module); loaded.filename = compilerPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(compilerPath)); loaded._compile(source, compilerPath);
  return loaded.exports;
}
function cases() {
  const schemaCases = corpus('bounded-open').filter(test => ['small', 'near-bound-ascii', 'escaped-unicode'].includes(test.name));
  const nested = { text: 'nested', active: true, count: 42, rows: Array.from({ length: 128 }, (_, i) => ({ name: 'row-' + i })), note: null };
  return [
    { name: 'small-config', family: 'small', expected: 'ready' },
    ...loop.cases.filter(test => ['text-1-small', 'text-1', 'text-8', 'text-64', 'objects-64'].includes(test.name))
      .map(test => ({ ...test, family: 'loop', expected: loop.expected(test) })),
    ...schemaCases.map(test => ({ ...test, name: 'schema-' + test.name, family: 'schema' })),
    { name: 'schema-nested-128', family: 'schema', body: JSON.stringify(nested), expected: nested }
  ];
}
function hostOptions(test) {
  const options = { clockUnixSeconds: 1790294400, configStores };
  if (test.body) options.request = { method: 'POST', body: test.body };
  if (test.family === 'loop') {
    const authority = createConditionalKvAuthority(); authority.stores.set('pages', new Map());
    for (let i = 0; i < test.count; i++) authority.seed('pages', 'p' + i, encodeConditionalKvValue(loop.payload(i, test)), BigInt(i + 1));
    options.conditionalKv = { authority };
  }
  return options;
}
function checkResponse(response, test) {
  assert.equal(response.status, 200, test.name);
  const body = response.body.toString();
  if (test.family === 'schema') assert.deepEqual(JSON.parse(body), test.expected, test.name);
  else assert.equal(body, test.expected, test.name);
  return { status: response.status, bodySha256: sha(body) };
}
function injected(wasm, test, samples) {
  // Fixture construction is outside the timer; host setup/validation/compilation,
  // instantiation and _start are inside. Every invocation gets a fresh instance.
  const times = []; let evidence;
  for (let i = -3; i < samples; i++) {
    const options = hostOptions(test), start = performance.now();
    const result = execute(wasm, options), elapsed = performance.now() - start;
    const response = checkResponse(result.response, test);
    if (result.kvEvidence) {
      assert.equal(result.kvEvidence.pending.size, 0);
      assert.equal(result.kvEvidence.bodyFixtures.size, 0);
    }
    const current = { ...response, traceSha256: sha(JSON.stringify(result.trace)), traceEntries: result.trace.length,
      memoryCapacityBytes: result.instance.exports.memory.buffer.byteLength,
      accounted: typeof result.instance.exports.pulse_fastly_memory_bytes === 'function'
        ? { bytes: Number(result.instance.exports.pulse_fastly_memory_bytes()), values: Number(result.instance.exports.pulse_fastly_memory_values()) } : null,
      ...(result.kvEvidence ? { pendingLookups: 0, acquiredReadBodies: 0 } : {}) };
    if (evidence) assert.deepEqual(current, evidence, 'fresh invocation determinism');
    else evidence = current;
    if (i >= 0) times.push(elapsed);
  }
  return { ...evidence, totalHostExecutionMs: stats(times) };
}
async function local(wasm, test, launcher, directory, samples) {
  fs.mkdirSync(directory, { recursive: true });
  const wasmFile = path.join(directory, 'main.wasm'); fs.writeFileSync(wasmFile, wasm);
  const pages = {};
  if (test.family === 'loop') for (let i = 0; i < test.count; i++) pages['p' + i] = loop.payload(i, test);
  fs.writeFileSync(path.join(directory, 'fastly.toml'), cli.renderFastlyLocalConfig({ name: 'mem10', configStores,
    ...(test.family === 'loop' ? { kvStores: { pages } } : {}) }));
  const started = performance.now();
  const server = await cli.startFastlyComputeServe({ launcher, packageRoot: directory, wasmFile, startTimeoutMs: 45000 });
  const startupMs = performance.now() - started;
  try {
    const times = []; let response, firstRequestMs;
    for (let i = -3; i < samples; i++) {
      const start = performance.now();
      const result = await cli.requestFastlyCompute(server, { method: test.body ? 'POST' : 'GET', body: test.body, timeoutMs: 10000 });
      const elapsed = performance.now() - start;
      const current = checkResponse(result, test);
      if (response) assert.deepEqual(current, response, 'local response determinism');
      else { response = current; firstRequestMs = elapsed; }
      if (i >= 0) times.push(elapsed);
    }
    return { ...response, startupMs, firstRequestMs, warmedHttpMs: stats(times),
      stderr: server.logs.stderr, stdout: server.logs.stdout };
  } finally { await server.stop(); }
}
async function run() {
  const directory = path.resolve(process.env.MEM10_OUT || path.join(root, 'wasm/.test-results/mem10'));
  fs.mkdirSync(directory, { recursive: true });
  // Require direct Viceroy. Never silently substitute the injected host.
  const launcher = cli.inspectFastlyComputeLauncher({ launcherKind: 'viceroy-direct' });
  const buildRounds = 3, localRounds = 2, samples = 20;
  const report = { version: 'pulse.mem10.allocator-evidence.v1', recordedAt: new Date().toISOString(),
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, kernel: os.release(), cpu: os.cpus()[0]?.model,
      viceroy: { version: launcher.inspection.version, output: launcher.inspection.output,
        binarySha256: sha(fs.readFileSync(launcher.inspection.binary)) } },
    method: { buildRounds, localRounds, samples, discardedWarmups: 3, recipeOrder: 'stub first in even rounds; incremental first in odd rounds',
      guest: 'production generated source and compile pipeline; allocator argument only; no RTrace or forced collection',
      memory: 'post-request exported linear-memory capacity, injected host; not live bytes or Viceroy RSS',
      timing: 'milliseconds; local HTTP includes host and transport; startup is spawn-to-listen with 75ms readiness polling',
      scope: 'unlinked HTTP only; read-only seeded KV; no deployed acceptance or conditional-write/CAS claims' },
    builds: [], cases: [] };
  const plans = { small: plan("export default async function handler(ctx) { const value = await ctx.config.get('BARRIER'); return ctx.text(value); }"),
    loop: plan(loop.source), schema: planFor('bounded-open') };
  const compilers = Object.fromEntries(recipes.map(runtime => [runtime, compilerFor(runtime)])), artifacts = {};
  const options = { cwd: root, bindings, canonicalBuild: true, requirePlatformCapability: false, emitWat: false };
  for (const [family, nativePlan] of Object.entries(plans)) {
    const defaultRuntime = family === 'schema' ? 'incremental' : 'stub';
    const control = platform.compileFastlyNativePlatformCapabilitiesPlan(nativePlan, options);
    const cells = Object.fromEntries(recipes.map(runtime => [runtime, { family, runtime, defaultRuntime, buildMs: [], assemblyScriptMs: [] }]));
    for (let round = 0; round < buildRounds; round++) for (const runtime of order(round)) {
      console.log(`MEM10 build ${family}/${runtime} round ${round + 1}/${buildRounds}`);
      const compiled = compilers[runtime].compileFastlyNativePlatformCapabilitiesPlan(nativePlan, options);
      assert.equal(compiled.source, control.source, 'allocator must not change generated source');
      if (runtime === defaultRuntime) assert.deepEqual(compiled.wasm, control.wasm, 'must reproduce exact production artifact');
      const key = family + '/' + runtime, previous = artifacts[key];
      if (previous) assert.deepEqual(compiled.wasm, previous.wasm, 'deterministic artifact');
      else {
        artifacts[key] = compiled;
        const artifactDir = path.join(directory, 'artifacts', family); fs.mkdirSync(artifactDir, { recursive: true });
        fs.writeFileSync(path.join(artifactDir, runtime + '.wasm'), compiled.wasm);
      }
      cells[runtime].buildMs.push(compiled.durationMs); cells[runtime].assemblyScriptMs.push(compiled.assemblyScriptDurationMs);
    }
    for (const runtime of recipes) {
      const compiled = artifacts[family + '/' + runtime], cell = cells[runtime];
      report.builds.push({ ...cell, buildMs: stats(cell.buildMs), assemblyScriptMs: stats(cell.assemblyScriptMs),
        wasmBytes: compiled.wasm.length, wasmSha256: sha(compiled.wasm), sourceSha256: sha(compiled.source),
        productionArtifactReproduced: runtime === defaultRuntime, assemblyScript: compiled.manifest.assemblyScript, jsonAs: compiled.manifest.jsonAs || null });
    }
    write(path.join(directory, 'evidence.json'), report);
  }
  for (const test of cases()) {
    const cell = { name: test.name, family: test.family, inputBytes: test.body ? Buffer.byteLength(test.body) : 0, recipes: {} };
    for (const runtime of recipes) cell.recipes[runtime] = { injected: injected(artifacts[test.family + '/' + runtime].wasm, test, samples), local: [] };
    const left = cell.recipes.stub.injected, right = cell.recipes.incremental.injected;
    assert.deepEqual(left.accounted, right.accounted, 'allocator preserves cumulative accounting');
    for (const key of ['status', 'bodySha256', 'traceSha256', 'traceEntries', 'pendingLookups', 'acquiredReadBodies']) assert.equal(left[key], right[key], test.name + '/' + key);
    for (let round = 0; round < localRounds; round++) for (const runtime of order(round)) {
      console.log(`MEM10 Viceroy ${test.name}/${runtime} round ${round + 1}/${localRounds}`);
      const evidence = await local(artifacts[test.family + '/' + runtime].wasm, test, launcher, path.join(directory, test.name, runtime), samples);
      assert.equal(evidence.bodySha256, cell.recipes[runtime].injected.bodySha256, 'injected/Viceroy response parity');
      cell.recipes[runtime].local.push(evidence);
    }
    report.cases.push(cell); write(path.join(directory, 'evidence.json'), report);
  }
  report.complete = true; write(path.join(directory, 'evidence.json'), report);
  console.log(`MEM10 passed: ${report.builds.length} build cells, ${report.cases.length} request cases; ${path.join(directory, 'evidence.json')}`);
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
