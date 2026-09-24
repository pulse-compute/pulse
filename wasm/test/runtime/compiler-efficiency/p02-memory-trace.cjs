#!/usr/bin/env node
'use strict';

// S01 evidence only. Output is task-owned and ignored; no product hooks change.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const fixture = path.join(root, 'wasm/test/fixtures/projects/compiler-efficiency-memory');
const sha256 = input => crypto.createHash('sha256').update(input).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const secrets = { S3_ID: 'fixture-id', S3_KEY: 'fixture-secret-012345678901234567890123456789' };
const PAGE_SEED = 's01-page-body-v1';
const PAGE_BYTES = 4096;
const COUNTS = [0, 1, 16, 64];

function attribution(source) {
  const matches = [...source.matchAll(/^function __pulse_expr_\d+\([^\n]*\n[\s\S]*?^\}/gm)];
  const seen = new Set();
  let repeated = 0, repeatedBytes = 0;
  for (const match of matches) {
    const declaration = match[0], key = declaration.replace(/__pulse_expr_\d+/, '__pulse_expr_');
    if (seen.has(key)) { repeated++; repeatedBytes += Buffer.byteLength(declaration); }
    else seen.add(key);
  }
  return {
    sourceBytes: Buffer.byteLength(source), sourceSha256: sha256(source),
    expressionDeclarations: matches.length, exactRepeatedDeclarations: repeated,
    exactRepeatedSourceBytes: repeatedBytes,
    // Exact lexical candidates; never assume they survive optimization or can be shared.
    attribution: 'full declaration after normalizing only the declared expression number'
  };
}

function compiledSummary(compiled) {
  return {
    source: attribution(compiled.source),
    finalWasmBytes: compiled.wasm.length,
    finalWasmSha256: sha256(compiled.wasm),
    assemblyScriptDurationMs: compiled.assemblyScriptDurationMs ?? compiled.durationMs,
    optimization: compiled.manifest.optimization,
    assemblyScriptVersion: compiled.manifest.assemblyScript.version
  };
}

function compileWorker(kind, cwd, output) {
  const { resolveProject } = require('../../../packages/cli/src/project-config');
  if (kind === 'node') {
    const execution = require('../../../packages/cli/src/project-execution');
    const project = resolveProject({ cwd, profile: 'node' });
    const prepared = execution.compileNativeProjectInMemory(project);
    fs.writeFileSync(path.join(output, 'node.wasm'), prepared.native.wasm);
    writeJson(path.join(output, 'plan.json'), prepared.plan);
    writeJson(path.join(output, 'node-summary.json'), compiledSummary(prepared.native));
    return;
  }
  if (kind === 'fastly') {
    const platform = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
    const project = resolveProject({ cwd, profile: 'fastly' });
    const compiled = platform.compileFastlyNativePlatformCapabilitiesPlan(readJson(path.join(output, 'plan.json')), {
      cwd, bindings: project.providerConfig.bindings, canonicalBuild: true
    });
    fs.writeFileSync(path.join(output, 'fastly.wasm'), compiled.wasm);
    writeJson(path.join(output, 'fastly-summary.json'), compiledSummary(compiled));
    return;
  }
  if (kind === 'control') {
    const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
    const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
    const { compileCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-compiler');
    const rows = [];
    for (const complexity of ['leaf', 'nested']) for (const calls of [1, 8, 32]) {
      const rhs = complexity === 'leaf' ? '1' : '(1+2)*(3+4)';
      const source = `export default async function handler(ctx){let value=0;${`value=value+${rhs};`.repeat(calls)}return ctx.text(''+value)}`;
      const analyzed = compileCanonicalSource(source, { fileName: `s01-${complexity}-${calls}.ts`, strict: false, requireAsync: true });
      const compiled = compileCanonicalNativePlan(buildCanonicalNativePlan(analyzed), { cwd: root });
      rows.push({ calls, complexity, fixtureSourceSha256: sha256(source), ...compiledSummary(compiled) });
    }
    writeJson(path.join(output, 'controls.json'), rows);
    return;
  }
  throw new Error('Unknown compiler worker kind');
}

function processRss(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = /^VmRSS:\s+(\d+) kB/m.exec(status);
    return rss ? Number(rss[1]) * 1024 : null;
  } catch (_) { return null; }
}

function children(pid) {
  try {
    // The runner's procfs omits task/*/children; PPid in status remains visible.
    return fs.readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => {
      try {
        const status = fs.readFileSync(`/proc/${name}/status`, 'utf8');
        return Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]) === pid ? [Number(name)] : [];
      } catch (_) { return []; }
    });
  } catch (_) { return []; }
}

async function isolatedCompile(kind, cwd, output) {
  const started = process.hrtime.bigint();
  const worker = spawn(process.execPath, [__filename, '--compile', kind, cwd, output], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '', workerPeakRssBytes = 0, compilerDescendantPeakRssBytes = 0, sampledCompilerDescendants = 0;
  worker.stdout.on('data', b => { out += b; });
  worker.stderr.on('data', b => { err += b; });
  const sample = () => {
    workerPeakRssBytes = Math.max(workerPeakRssBytes, processRss(worker.pid) || 0);
    const queue = children(worker.pid);
    for (let i = 0; i < queue.length; i++) {
      const pid = queue[i];
      sampledCompilerDescendants++;
      compilerDescendantPeakRssBytes = Math.max(compilerDescendantPeakRssBytes, processRss(pid) || 0);
      queue.push(...children(pid));
    }
  };
  const interval = setInterval(sample, 10);
  sample();
  const exit = await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('close', (code, signal) => resolve({ code, signal })); });
  sample(); clearInterval(interval);
  assert.equal(exit.code, 0, `${kind} compiler failed: ${err.slice(-6000)} ${out.slice(-1000)}`);
  return { wallMs: Number(process.hrtime.bigint() - started) / 1e6,
    workerPeakRssBytes, compilerDescendantPeakRssBytes: compilerDescendantPeakRssBytes || null,
    sampledCompilerDescendants, rssMethod: '10ms /proc process samples; descendant maximum is a sampled peak, not a combined tree RSS' };
}

function prepareFixture(cwd) {
  fs.cpSync(path.join(fixture, 'src'), path.join(cwd, 'src'), { recursive: true });
  fs.cpSync(path.join(fixture, '.pulse'), path.join(cwd, '.pulse'), { recursive: true });
  const packages = path.join(cwd, 'node_modules/@pulse-compute');
  fs.mkdirSync(packages, { recursive: true });
  for (const name of ['pulse', 's3', 'crypto']) fs.symlinkSync(path.join(root, 'packages', name), path.join(packages, name), 'dir');
}

function pageBodies(count) {
  const entries = Array.from({ length: count }, (_, index) => {
    const page = { index, next: index + 1 < count ? `p${index + 2}` : '', payload: '' };
    const fixed = Buffer.byteLength(JSON.stringify(page));
    page.payload = (PAGE_SEED + 'x'.repeat(PAGE_BYTES - fixed)).slice(0, PAGE_BYTES - fixed);
    const body = JSON.stringify(page);
    assert.equal(Buffer.byteLength(body), PAGE_BYTES);
    return [`https://objects.example.invalid/pages/p${index + 1}`, body];
  });
  return Object.fromEntries(entries);
}

function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function estimatedHostValueMapBytes(heap) {
  // The handle map is an actual strong root. This weighted graph excludes the
  // guest linear memory, trace array, provider fixtures and JS object overhead.
  const policy = heap.budget.policy;
  const visited = new WeakSet();
  let bytes = heap.values.size * policy.valueBytes;
  function walk(value) {
    if (typeof value === 'string') { bytes += value.length * 2; return; }
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) bytes += value.length * policy.edgeBytes;
    for (const key of Object.keys(value)) {
      bytes += policy.edgeBytes + key.length * 2;
      walk(value[key]);
    }
  }
  for (const value of heap.values.values()) walk(value);
  return bytes;
}

async function traceNode(plan, wasm, cwd, count, responses) {
  const host = require('../../../packages/host-runtime/src/runtime/canonical-native-host');
  const driver = require('../../../../packages/provider-node/src/toolchain').createDriver();
  const { resolveProject } = require('../../../packages/cli/src/project-config');
  const project = resolveProject({ cwd, profile: 'node' });
  const request = { method: 'GET', path: '/pages', url: 'https://app.example.invalid/pages', headers: [['x-start', count ? 'p1' : '']], body: '' };
  const options = driver.executionOptions(project.providerConfig, { request, secrets, strict: false,
    fetchImplementation: async input => {
      const body = responses[new Request(input).url];
      assert.ok(body, 'Only fixture objects are requested');
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  const kinds = Object.fromEntries(['undefined', 'null', 'boolean', 'number', 'string', 'object', 'array', 'function'].map(x => [x, 0]));
  const checkpoints = [];
  const initial = host.instantiateCanonicalNativeModule({ plan, wasm }, options);
  const initialLinearMemoryBytes = initial.exports.memory.buffer.byteLength;
  initial.close();
  let activeHeap;
  const originalPut = host.ValueHeap.prototype.put;
  host.ValueHeap.prototype.put = function(value) {
    activeHeap = this;
    const before = this.next, handle = originalPut.call(this, value);
    if (this.next > before) kinds[kindOf(value)]++;
    return handle;
  };
  const providerAdapter = { ...options.providerAdapter, dispatchEffect(effect, context) {
    if (activeHeap) checkpoints.push({ effect: checkpoints.length + 1, kind: effect.kind,
      handles: activeHeap.size(), charged: activeHeap.budget.snapshot(),
      estimatedRootedHostValueBytes: estimatedHostValueMapBytes(activeHeap),
      scalarIndexEntries: activeHeap.scalars.size, objectIndexEntries: activeHeap.identityCount });
    return options.providerAdapter.dispatchEffect(effect, context);
  } };
  const beforeRssBytes = process.memoryUsage().rss;
  try {
    const result = await host.executeCanonicalNativeModule({ plan, wasm }, { ...options, providerAdapter });
    assert.equal(result.response.body, `${count}:${count - 1}`);
    assert.equal(result.effectCount, count * 2);
    const heap = activeHeap;
    return { response: result.response.body, effectCount: result.effectCount,
      charges: result.memory, allocatedHandles: result.valueHandleCount,
      allocatedHandlesByKind: kinds, scalarIndexEntries: heap.scalars.size, objectIndexEntries: heap.identityCount,
      estimatedRootedHostValueBytes: estimatedHostValueMapBytes(heap),
      initialLinearMemoryBytes, afterExecutionLinearMemoryBytes: null,
      processRssBeforeBytes: beforeRssBytes, processRssAfterBytes: process.memoryUsage().rss,
      checkpoints: checkpoints.filter((x, i) => i === 0 || i === checkpoints.length - 1 || (i + 1) % 32 === 0) };
  } finally { host.ValueHeap.prototype.put = originalPut; }
}

function traceFastly(wasm, cwd, count, responses) {
  const fastlyHost = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
  const request = { method: 'GET', path: '/pages', url: 'https://app.example.invalid/pages', headers: [['x-start', count ? 'p1' : '']], body: '' };
  let calls = 0;
  const beforeRssBytes = process.memoryUsage().rss;
  const result = fastlyHost.executeFastlyNativePlatformCapabilities(wasm, { request, secrets, secretStore: 'app_secrets',
    fixtures: Object.fromEntries(Object.entries(responses).map(([url, body]) => ['GET ' + url,
      { status: 200, headers: [['content-type', 'application/json'], ['content-length', String(Buffer.byteLength(body))]], body }])),
    onOutboundRequest() { calls++; } });
  assert.equal(result.response.body, `${count}:${count - 1}`);
  assert.equal(calls, count);
  const memory = result.instance.exports.memory;
  return { response: result.response.body, outboundRequests: calls,
    charges: { bytes: Number(result.instance.exports.pulse_fastly_memory_bytes()),
      values: Number(result.instance.exports.pulse_fastly_memory_values()) },
    finalLinearMemoryBytes: memory.buffer.byteLength, finalLinearMemoryPages: memory.buffer.byteLength / 65536,
    processRssBeforeBytes: beforeRssBytes, processRssAfterBytes: process.memoryUsage().rss };
}

async function main() {
  const base = process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir();
  const work = fs.mkdtempSync(path.join(base, 'pulse-compiler-efficiency-s01-'));
  try {
    const projectDir = path.join(work, 'project'), output = path.join(work, 'artifacts');
    fs.mkdirSync(projectDir); fs.mkdirSync(output); prepareFixture(projectDir);
    const nodeCompile = await isolatedCompile('node', projectDir, output);
    const fastlyCompile = await isolatedCompile('fastly', projectDir, output);
    const controlCompile = await isolatedCompile('control', projectDir, output);
    const plan = readJson(path.join(output, 'plan.json'));
    const nodeWasm = fs.readFileSync(path.join(output, 'node.wasm'));
    const fastlyWasm = fs.readFileSync(path.join(output, 'fastly.wasm'));
    const cases = [];
    for (const count of COUNTS) {
      const responses = pageBodies(count);
      const fixtureSha256 = sha256(Object.values(responses).join(''));
      const node = await traceNode(plan, nodeWasm, projectDir, count, responses);
      const fastly = traceFastly(fastlyWasm, projectDir, count, responses);
      assert.equal(node.response, fastly.response);
      cases.push({ pages: count, fixtureBytes: PAGE_BYTES * count, fixtureSha256, expected: `${count}:${count - 1}`, node, fastly });
    }
    const report = { schemaVersion: 'pulse.compiler-efficiency-s01.v1', status: 'passed',
      fixtureSeed: PAGE_SEED, pageBytes: PAGE_BYTES,
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      fixtureSourceSha256: sha256(['src/index.ts', 'src/schemas.ts', 'src/types.ts', '.pulse/config.ts']
        .map(file => fs.readFileSync(path.join(fixture, file))).join('')),
      lockfileSha256: sha256(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
      node: { ...readJson(path.join(output, 'node-summary.json')), isolatedCompile: nodeCompile },
      fastly: { ...readJson(path.join(output, 'fastly-summary.json')), isolatedCompile: fastlyCompile },
      controls: { cases: readJson(path.join(output, 'controls.json')), isolatedCompile: controlCompile },
      requestCases: cases,
      limitations: [
        'Node rooted bytes estimate covers the actual host ValueHeap handle-map graph with policy weights; excludes guest linear memory, provider fixtures, trace and JS object overhead. It is not an authoritative live-heap or RSS measurement.',
        'Node end-of-request linear capacity is not exposed by the execution result; only fresh-instance initial capacity is recorded.',
        'Fastly ABI fixture is not Viceroy or deployed Compute. Fastly does not expose Node handle kinds or request liveness.',
        'RSS is process-wide at named checkpoints; compiler child peak is sampled, not a sum; control variants are a source-shape screen, not a speedup benchmark.'
      ] };
    const reportPath = path.join(root, 'wasm/.test-results/compiler-efficiency/s01/measurements.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    writeJson(reportPath, report);
    console.log(JSON.stringify({ status: 'passed', report: path.relative(root, reportPath), cases: cases.length,
      nodeSourceBytes: report.node.source.sourceBytes, fastlySourceBytes: report.fastly.source.sourceBytes,
      nodeWasmBytes: nodeWasm.length, fastlyWasmBytes: fastlyWasm.length }));
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[2] === '--compile') {
  try { compileWorker(process.argv[3], process.argv[4], process.argv[5]); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
} else {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
