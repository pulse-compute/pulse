#!/usr/bin/env node
'use strict';

// Opt-in evidence only: optimize copies of final artifacts, never production
// manifests or defaults. All timings and artifacts belong to the ignored report.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const { runTool, binaryenIdentity } = require('../../../packages/wasm-guest-link/src/toolchain');
const { resolveProject } = require('../../../packages/cli/src/project-config');
const { compileProject, compileNativeProjectInMemory } = require('../../../packages/cli/src/project-execution');
const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const { packageLoweringForCanonicalNativePlan } = require('../../../packages/compiler/src/spine/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-compiler');
const platform = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const fastlyHost = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const nativeHost = require('../../../packages/host-runtime/src/runtime/canonical-native-host');
const nodeDriver = require('../../../../packages/provider-node/src/toolchain').createDriver();
const oracle = require('./p03-parity-stress.cjs');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const flags = Object.freeze(['--merge-similar-functions',
  '--one-caller-inline-max-function-size=64', '--flexible-inline-max-function-size=0',
  '--inline-max-combined-binary-size=1024', '-Oz']);
// Match the existing asc defaults; guest-linked artifacts have an explicit MVP policy.
const featureFlags = job => job.fixture === 'jwt' ? ['--mvp-features']
  : ['--mvp-features', '--enable-mutable-globals', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '--enable-bulk-memory'];
const source = `export default async function handler(ctx){let value=0;${'value=value+1;'.repeat(2000)}return ctx.text(''+value)}`;

function prepareProject(destination, relative) {
  fs.mkdirSync(destination, { recursive: true });
  const original = path.join(root, relative);
  for (const name of ['src', '.pulse', 'tests']) if (fs.existsSync(path.join(original, name))) {
    fs.cpSync(path.join(original, name), path.join(destination, name), { recursive: true,
      filter: file => !file.includes(`${path.sep}guests${path.sep}`) && path.basename(file) !== 'guests' });
  }
  const packages = path.join(destination, 'node_modules/@pulse-compute');
  fs.mkdirSync(packages, { recursive: true });
  for (const name of ['pulse', 's3', 'crypto', 'jwt']) fs.symlinkSync(path.join(root, 'packages', name), path.join(packages, name), 'dir');
}

function compile(job) {
  const options = { cwd: job.cwd, nativeOptimization: job.profile === 'size' ? 'experimental-native-size' : undefined };
  let artifact, plan;
  if (job.fixture === 'repeat') {
    plan = buildCanonicalNativePlan(compileCanonicalSource(source, { fileName: 'bounded-merge-repeat.ts', strict: false, requireAsync: true }));
  } else {
    const profile = job.fixture === 'oracle' ? job.target : 'node-native';
    const project = resolveProject({ cwd: job.cwd, profile });
    if (job.target === 'node') artifact = compileNativeProjectInMemory(project, options).native;
    else {
      plan = buildCanonicalNativePlan(compileProject(project));
      options.bindings = project.providerConfig.bindings;
      const lowering = packageLoweringForCanonicalNativePlan(plan);
      options.realizationArtifacts = lowering?.realizationArtifacts || [];
      options.guestUnits = lowering?.guestUnits || [];
      options.targetDescriptor = require('../../../../packages/provider-fastly/src/toolchain/index.js').createDriver().targets.native;
      options.synchronizedPackages = require('../../../packages/cli/release-manifest.json').packages.map(({ name, version }) => ({ name, version }));
    }
  }
  if (!artifact) artifact = job.target === 'node'
    ? compileCanonicalNativePlan(plan, options)
    : platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { ...options, canonicalBuild: true, requirePlatformCapability: false });
  return artifact;
}

function compileWorker(job) {
  const begin = performance.now();
  const artifact = compile(job);
  const compileMs = performance.now() - begin;
  if (job.fixture === 'jwt') assert.ok(artifact.guestUnits.length > 0, 'exercise the linked guest, not a substitute verifier');
  fs.writeFileSync(job.file + '.input.wasm', artifact.wasm);
  const start = performance.now();
  if (job.variant === 'merged') runTool('wasm-opt', [job.file + '.input.wasm', ...featureFlags(job), ...flags, '-o', job.file + '.wasm']);
  else fs.writeFileSync(job.file + '.wasm', artifact.wasm);
  const postprocessMs = performance.now() - start;
  writeJson(job.file + '.plan.json', artifact.plan);
  writeJson(job.file + '.artifacts.json', artifact.realizationArtifacts || []);
  writeJson(job.file + '.json', { compileMs, postprocessMs, featureFlags: featureFlags(job), guestUnits: (artifact.guestUnits || []).map(unit => unit.id),
    generatedSourceBytes: Buffer.byteLength(artifact.source), inputSha256: sha256(artifact.wasm),
    outputSha256: sha256(fs.readFileSync(job.file + '.wasm')) });
}

async function measuredWorker(args) {
  const start = performance.now();
  const child = spawn(process.execPath, [__filename, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', workerPeakRssBytes = 0, descendantPeakRssBytes = 0, treePeakRssBytes = 0, samples = 0;
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  function sample() {
    const processes = new Map();
    for (const name of fs.readdirSync('/proc')) if (/^\d+$/.test(name)) {
      try {
        const status = fs.readFileSync(`/proc/${name}/status`, 'utf8');
        processes.set(Number(name), { parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]),
          rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] || 0) * 1024 });
      } catch (_) { /* A short-lived process can exit between reads. */ }
    }
    const descendants = new Set([child.pid]);
    let changed;
    do {
      changed = false;
      for (const [pid, item] of processes) if (!descendants.has(pid) && descendants.has(item.parent)) {
        descendants.add(pid); changed = true;
      }
    } while (changed);
    let total = 0;
    for (const pid of descendants) {
      const rss = processes.get(pid)?.rss || 0; total += rss;
      if (pid === child.pid) workerPeakRssBytes = Math.max(workerPeakRssBytes, rss);
      else descendantPeakRssBytes = Math.max(descendantPeakRssBytes, rss);
    }
    treePeakRssBytes = Math.max(treePeakRssBytes, total); samples++;
  }
  const timer = setInterval(sample, 10); sample();
  let exit;
  try { exit = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  }); } finally { clearInterval(timer); }
  assert.equal(exit.code, 0, `${args.join(' ')} failed (${exit.signal}): ${stderr.slice(-7000)} ${stdout.slice(-1000)}`);
  return { wallMs: performance.now() - start, workerPeakRssBytes, descendantPeakRssBytes, treePeakRssBytes, samples };
}

// Read the numeric-function shapes emitted by these fixtures. Unexpected type
// proposals fail explicitly rather than silently producing misleading counts.
function shape(file, job) {
  const bytes = fs.readFileSync(file);
  assert.ok(WebAssembly.validate(bytes));
  let offset = 8;
  const uleb = () => { let n = 0, shift = 0, b; do { b = bytes[offset++]; n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; };
  const string = () => { const size = uleb(); const value = bytes.subarray(offset, offset + size).toString('utf8'); offset += size; return value; };
  const valueType = () => { const type = bytes[offset++]; assert.ok([0x7f, 0x7e, 0x7d, 0x7c, 0x70, 0x6f].includes(type)); return type; };
  const limits = () => { const flag = uleb(), min = uleb(), max = flag & 1 ? uleb() : null; assert.ok(flag <= 3); return { flag, min, max }; };
  const types = [], functionTypes = [], imports = [], exports = [], memories = [], bodies = [];
  let tables = 0, hasStart = false;
  while (offset < bytes.length) {
    const id = bytes[offset++], size = uleb(), end = offset + size;
    if (id === 1) for (let count = uleb(); count; count--) {
      assert.equal(bytes[offset++], 0x60);
      const parameters = Array.from({ length: uleb() }, valueType), results = Array.from({ length: uleb() }, valueType);
      types.push({ parameters, results });
    }
    if (id === 2) for (let count = uleb(); count; count--) {
      const module = string(), name = string(), kind = bytes[offset++]; let type;
      if (kind === 0) { const index = uleb(); functionTypes.push(index); type = types[index]; }
      else if (kind === 1) { type = { element: valueType(), limits: limits() }; tables++; }
      else if (kind === 2) { type = limits(); memories.push(type); }
      else if (kind === 3) type = { value: valueType(), mutable: bytes[offset++] };
      else throw Error('unexpected import kind');
      imports.push({ module, name, kind, type });
    }
    if (id === 3) for (let count = uleb(); count; count--) functionTypes.push(uleb());
    if (id === 4) { tables += uleb(); }
    if (id === 5) for (let count = uleb(); count; count--) memories.push(limits());
    if (id === 7) for (let count = uleb(); count; count--) {
      const name = string(), kind = bytes[offset++], index = uleb();
      exports.push({ name, kind, ...(kind === 0 ? { type: types[functionTypes[index]] } : {}) });
    }
    if (id === 8) hasStart = true;
    if (id === 10) for (let count = uleb(); count; count--) { const length = uleb(); bodies.push(length); offset += length; }
    assert.ok(offset <= end); offset = end;
  }
  const wat = file + '.wat'; runTool('wasm-dis', [file, ...featureFlags(job), '-o', wat]);
  const text = fs.readFileSync(wat, 'utf8');
  return { bytes: bytes.length, sha256: sha256(bytes), functions: bodies.length,
    largestFunctionBytes: Math.max(...bodies), maxParameters: Math.max(...types.map(type => type.parameters.length)),
    codeBodyBytes: bodies.reduce((a, b) => a + b, 0), tables, indirectCalls: (text.match(/\bcall_indirect\b/g) || []).length,
    surface: { imports, exports, memories, hasStart }, functionBodyBytes: bodies.sort((a, b) => b - a) };
}

async function semantics(job, file) {
  const wasm = fs.readFileSync(file + '.wasm'), plan = readJson(file + '.plan.json');
  const realizationArtifacts = readJson(file + '.artifacts.json');
  if (job.fixture === 'oracle') {
    const project = resolveProject({ cwd: job.cwd, profile: 'node' });
    const cases = [];
    for (const spec of oracle.corpus.cases) cases.push({ id: spec.id, result: job.target === 'node'
      ? await oracle.nodeCase({ wasm, plan }, project, spec, oracle.pages(spec))
      : oracle.fastlyCase(wasm, spec, oracle.pages(spec)) });
    return { cases, ...(job.target === 'node' ? { cancellation: await oracle.cancellation({ wasm, plan }, project) } : {}) };
  }
  if (job.fixture === 'repeat') {
    const result = job.target === 'node' ? await nativeHost.executeCanonicalNativeModule({ wasm, plan })
      : fastlyHost.executeFastlyNativePlatformCapabilities(wasm);
    assert.equal(result.response.body, '2000');
    if (job.target === 'node') assert.equal(result.valueHandleCount, 4005);
    return { status: result.response.status, body: result.response.body,
      ...(job.target === 'node' ? { handles: result.valueHandleCount, effects: result.effectCount } : {}) };
  }
  const project = resolveProject({ cwd: job.cwd, profile: 'node-native' });
  const cases = [];
  for (const test of project.tests) {
    let outcome;
    try {
      const result = job.target === 'node'
        ? await nativeHost.executeCanonicalNativeModule({ wasm, plan, realizationArtifacts }, {
          ...nodeDriver.executionOptions(project.providerConfig, { request: test.request }),
          captureJwtWallClock: () => ({ unixEpochSeconds: 2000000000, trusted: true }) })
        : fastlyHost.executeFastlyNativePlatformCapabilities(wasm, { request: test.request, clockUnixSeconds: 2000000000 });
      assert.ok(!test.expect.error, 'expected JWT rejection');
      assert.equal(result.response.status, test.expect.status);
      assert.equal(result.response.body, test.expect.text);
      outcome = { status: result.response.status, body: result.response.body };
    } catch (error) {
      if (!test.expect.error || error instanceof assert.AssertionError) throw error;
      if (job.target === 'node') assert.equal(error.code, test.expect.error.code);
      else {
        assert.equal(error.code, 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED');
        assert.equal(error.detail?.lastError, 1008, 'JWT failure, not an unrelated host rejection');
        // Package-owned stages in packages/jwt/as/index.as.ts.
        assert.equal(error.detail?.errorStage, { PULSE_JWT_SIGNATURE_INVALID: 217, PULSE_JWT_ALGORITHM_NOT_ALLOWED: 212 }[test.expect.error.code]);
      }
      outcome = { error: error.code, stage: error.detail?.errorStage, lastError: error.detail?.lastError };
    }
    cases.push({ name: test.name, ...outcome });
  }
  return { cases };
}

async function runtimeWorker(job) {
  const wasm = fs.readFileSync(job.file + '.wasm'), plan = readJson(job.file + '.plan.json');
  const start = performance.now(); new WebAssembly.Module(wasm);
  const firstModuleMs = performance.now() - start;
  const execute = () => job.target === 'node' ? nativeHost.executeCanonicalNativeModule({ wasm, plan })
    : fastlyHost.executeFastlyNativePlatformCapabilities(wasm);
  const first = performance.now(); const result = await execute(); const firstRequestMs = performance.now() - first;
  assert.equal(result.response.body, '2000');
  for (let i = 0; i < 50; i++) await execute();
  const warm = performance.now();
  for (let i = 0; i < 200; i++) { const value = await execute(); assert.equal(value.response.body, '2000'); }
  writeJson(job.result, { firstModuleMs, firstRequestMs, warmRequests: 200, warmBatchMs: performance.now() - warm,
    measurement: 'first module in a fresh Node process; request harness constructs fresh instances; not isolated JIT-tier timing' });
}

async function main() {
  assert.ok(fs.existsSync('/proc/self/status'), 'this RSS proof requires Linux procfs');
  const work = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-bounded-merge-'));
  const out = path.join(root, 'wasm/.test-results/compiler-efficiency/bounded-merging');
  fs.mkdirSync(out, { recursive: true });
  const report = { schemaVersion: 'pulse.bounded-merging-proof.v1', status: 'running',
    proofSha256: sha256(fs.readFileSync(__filename)),
    oracleHarnessSha256: sha256(fs.readFileSync(require.resolve('./p03-parity-stress.cjs'))),
    workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    lockfileSha256: sha256(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), nodeVersion: process.version,
    binaryen: binaryenIdentity(), flags, runsPerVariant: 3,
    memoryMethod: 'serial cold worker processes, 10ms procfs samples; descendant peak is one process; tree peak sums simultaneous RSS and double-counts shared pages',
    sourceSha256: sha256(source), corpusSha256: sha256(fs.readFileSync(path.join(root, 'wasm/test/fixtures/conformance/compiler-efficiency-parity.json'))),
    cells: [], runtime: [], limitations: ['Fastly ABI fixture, not Viceroy or deployed execution.',
      'Post-link artifact copies only; no production manifest, guest-link audit receipt or policy is rewritten.',
      'Performance samples are diagnostic evidence, not a timing assertion or a JIT memory measurement.'] };
  const reportFile = path.join(out, 'measurements.json');
  try {
    prepareProject(path.join(work, 'oracle'), 'wasm/test/fixtures/projects/compiler-efficiency-parity');
    prepareProject(path.join(work, 'jwt'), 'examples/13-jwt-es256');
    for (const fixture of ['repeat', 'oracle', 'jwt']) for (const target of ['node', 'fastly']) for (const profile of ['default', 'size']) {
      const id = `${fixture}-${target}-${profile}`, cwd = fixture === 'repeat' ? root : path.join(work, fixture);
      const cell = { id, fixture, target, profile, builds: [] };
      report.cells.push(cell);
      const job = { fixture, target, profile, cwd };
      for (let round = 0; round < 3; round++) for (const variant of round % 2 ? ['merged', 'baseline'] : ['baseline', 'merged']) {
        const file = path.join(work, `${id}-${variant}`), jobFile = path.join(work, 'job.json');
        // Each cold sample gets a fresh guest cache as well as a fresh process.
        if (fixture === 'jwt') fs.rmSync(path.join(cwd, '.pulse/guests'), { recursive: true, force: true });
        writeJson(jobFile, { ...job, variant, file });
        const measured = await measuredWorker(['--compile', jobFile]);
        const detail = readJson(file + '.json');
        for (const previous of cell.builds) assert.equal(previous.inputSha256, detail.inputSha256, 'identical compiler inputs produce identical baseline Wasm');
        for (const previous of cell.builds.filter(row => row.variant === variant)) assert.equal(previous.outputSha256, detail.outputSha256, 'candidate determinism');
        cell.builds.push({ round, variant, ...measured, ...detail });
      }
      // Preserve the current cell even when a semantic or shape assertion fails.
      for (const variant of ['baseline', 'merged']) {
        const file = path.join(work, `${id}-${variant}`);
        cell[variant] = shape(file + '.wasm', job);
        for (const extension of ['.wasm', '.wasm.wat', '.plan.json', '.artifacts.json']) {
          fs.copyFileSync(file + extension, path.join(out, `${id}-${variant}${extension}`));
        }
        // Fresh processes keep request/continuation sequence identifiers equal,
        // including their charged string lengths; do not normalize budgets away.
        const jobFile = path.join(work, 'job.json'), result = path.join(work, 'semantics.json');
        writeJson(jobFile, { ...job, file, result });
        await measuredWorker(['--semantics', jobFile]);
        cell[variant + 'Semantics'] = readJson(result);
        writeJson(reportFile, report);
      }
      if (fixture === 'repeat' && profile === 'default') {
        const file = path.join(out, `${id}-unbounded`);
        const controlFlags = ['--merge-similar-functions', '-Oz'];
        runTool('wasm-opt', [path.join(out, `${id}-baseline.wasm`), ...featureFlags(job), ...controlFlags, '-o', file + '.wasm']);
        for (const extension of ['.plan.json', '.artifacts.json']) fs.copyFileSync(path.join(out, `${id}-baseline${extension}`), file + extension);
        const jobFile = path.join(work, 'job.json'), result = path.join(work, 'semantics.json');
        writeJson(jobFile, { ...job, file, result });
        await measuredWorker(['--semantics', jobFile]);
        cell.unboundedControl = { flags: controlFlags, shape: shape(file + '.wasm', job), semantics: readJson(result) };
        assert.deepEqual(cell.unboundedControl.semantics, cell.baselineSemantics);
      }
      assert.deepEqual(cell.merged.surface, cell.baseline.surface, `${id}: ABI and memory limits`);
      assert.equal(cell.merged.tables, cell.baseline.tables, `${id}: no new tables`);
      assert.equal(cell.merged.indirectCalls, cell.baseline.indirectCalls, `${id}: no new indirect calls`);
      cell.shapeGate = cell.merged.largestFunctionBytes <= Math.max(1024, cell.baseline.largestFunctionBytes)
        && cell.merged.maxParameters <= Math.max(64, cell.baseline.maxParameters);
      assert.deepEqual(cell.mergedSemantics, cell.baselineSemantics, `${id}: exact semantic and budget parity`);
      writeJson(reportFile, report);
      console.log(JSON.stringify({ id, before: cell.baseline.bytes, after: cell.merged.bytes,
        largestBefore: cell.baseline.largestFunctionBytes, largestAfter: cell.merged.largestFunctionBytes, shapeGate: cell.shapeGate }));
    }
    for (const target of ['node', 'fastly']) for (let round = 0; round < 3; round++) for (const variant of round % 2 ? ['merged', 'baseline'] : ['baseline', 'merged']) {
      const result = path.join(work, 'runtime.json'), jobFile = path.join(work, 'job.json');
      writeJson(jobFile, { target, file: path.join(out, `repeat-${target}-default-${variant}`), result });
      const runtimeProcess = await measuredWorker(['--runtime', jobFile]);
      report.runtime.push({ target, round, variant, ...readJson(result), process: runtimeProcess });
    }
    report.status = 'passed'; report.shapeGatesPassed = report.cells.every(cell => cell.shapeGate);
    report.productionAdoption = 'requires-review-of-size-time-memory-and-shape-tradeoffs';
    writeJson(reportFile, report);
    console.log(JSON.stringify({ status: report.status, cells: report.cells.length, shapeGatesPassed: report.shapeGatesPassed, report: path.relative(root, reportFile) }));
  } catch (error) {
    report.status = 'failed'; report.error = error.stack || String(error); writeJson(reportFile, report); throw error;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[2] === '--compile') compileWorker(readJson(process.argv[3]));
else if (process.argv[2] === '--semantics') {
  const job = readJson(process.argv[3]);
  semantics(job, job.file).then(result => writeJson(job.result, result)).catch(error => { console.error(error); process.exitCode = 1; });
}
else if (process.argv[2] === '--runtime') runtimeWorker(readJson(process.argv[3])).catch(error => { console.error(error); process.exitCode = 1; });
else main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
