#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { fixtures } = require('./fixtures.cjs');
const { prepareProject, dependencies, environment } = require('./baseline.cjs');
const { prepareRust, rustIdentity } = require('./rust-baseline.cjs');
const { cases, assertParity } = require('./rust-behavior.cjs');
const { scenarios, checkpoints, shapes } = require('./memory-worker.cjs');
const { hash, statistics } = require('./report.cjs');
const { runCommand } = require('../../../scripts/release-process.cjs');
const { atomicJson } = require('../../../scripts/release-recovery.cjs');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const protocol = { version: 'pulse.memory-attribution-protocol.v1', repetitions: 3, checkpoints, scenarios,
  gcModes: ['natural', 'forced'], forcedGcPasses: 3, workerTimeoutMs: 180000,
  order: 'serial; alternate Pulse/Rust and reverse each repetition',
  lifecycle: 'fresh module/instance and provider per invocation, unchanged host cleanup; close is not physical deallocation',
  control: 'unchanged PERF8 Native runtimeWorker: 1 first + 10 warmup + 30 measured; no observer or forced GC',
  scheduling: 'observed workers yield after every invocation to release WeakRef current-job liveness; unobserved microtask and yielding controls isolate this change',
  diagnostic: 'test-only WebAssembly.Instance/export wrapper; weak memory census; first-invocation phase snapshots; no timing claims',
  memory: 'RSS is process-wide; external/arrayBuffers overlap; linear capacity is not resident or allocated-object bytes; never sum these columns',
  gc: 'natural GC never forced; separate --expose-gc worker collects three times with macrotask yields at each checkpoint',
  isolation: 'codec bypasses dispatch/effects but retains production codec wrappers; instantiate closes without running the guest',
  limits: 'bounded synthetic serial workload; no leak, production RSS, performance threshold or statistical significance claim' };
const selected = fixtures.filter(f => ['minimal-request', 'schema-effect'].includes(f.id));
const memoryKeys = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'];
function summaries(rows) {
  return scenarios.flatMap(scenario => protocol.gcModes.flatMap(gcMode => ['pulse', 'rust'].map(implementation => {
    const samples = rows.filter(r => r.scenario === scenario.id && r.gcMode === gcMode && r.implementation === implementation);
    return { scenario: scenario.id, gcMode, implementation, checkpoints: checkpoints.map(requests => ({ requests,
      ...Object.fromEntries(['beforeGc', ...(gcMode === 'forced' ? ['afterGc'] : [])].map(phase => [phase,
        Object.fromEntries([...memoryKeys, ...(scenario.observe === false ? [] : ['liveMemories', 'liveLinearCapacityBytes'])].map(key => [key, statistics(samples.map(r => {
          const point = r.checkpoints.find(c => c.requests === requests)[phase];
          return memoryKeys.includes(key) ? point.memory[key] : point.guests[key];
        }))]))])) })) };
  })));
}
function validate(report) {
  assert.equal(report.schemaVersion, 'pulse.memory-attribution.v1'); assert.equal(report.status, 'passed');
  assert.deepEqual(report.protocol, protocol); assert.equal(report.source.workingTree, '');
  for (const key of ['sourceRevision', 'sourceTree']) assert.match(report.source[key], /^[a-f0-9]{40}$/);
  assert(report.environment.node && report.dependencies.lockfileSha256);
  for (const key of ['rustcSha256', 'cargoSha256', 'targetLibrariesSha256', 'manifestSha256', 'lockfileSha256']) assert.match(report.rust[key], /^[a-f0-9]{64}$/);
  function memory(value) { for (const key of memoryKeys) assert(Number.isSafeInteger(value[key]) && value[key] >= 0, 'Invalid memory ' + key); }
  assert.equal(report.artifacts.length, 4); assert.equal(report.behavior.length, 2);
  for (const f of selected) {
    const behavior = report.behavior.filter(b => b.fixture === f.id); assert.equal(behavior.length, 1);
    assert.equal(behavior[0].status, 'passed'); const tests = cases(f);
    assert.equal(behavior[0].cases, tests.length); assert.equal(behavior[0].results.length, tests.length);
    behavior[0].results.forEach((row, i) => { assert.equal(row.name, tests[i].name); assert.equal(row.status, 'passed'); assertParity(row.pulse, row.rust, tests[i], f); });
    for (const implementation of ['pulse', 'rust']) {
      const artifacts = report.artifacts.filter(a => a.fixture === f.id && a.implementation === implementation); assert.equal(artifacts.length, 1);
      const a = artifacts[0]; for (const key of ['sha256', 'planSha256']) assert.match(a[key], /^[a-f0-9]{64}$/); assert(a.bytes > 0);
    }
    assert.equal(report.artifacts.find(a => a.fixture === f.id && a.implementation === 'pulse').planSha256,
      report.artifacts.find(a => a.fixture === f.id && a.implementation === 'rust').planSha256);
  }
  assert.equal(report.controls.length, 12);
  for (const f of selected) for (const implementation of ['pulse', 'rust']) for (let repetition = 0; repetition < 3; repetition++) {
    const rows = report.controls.filter(r => r.fixture === f.id && r.implementation === implementation && r.repetition === repetition); assert.equal(rows.length, 1);
    for (const phase of ['beforeLoad', 'afterLoad', 'afterFirst', 'afterWarmup', 'afterWarm']) memory(rows[0].memory[phase]);
    assert.equal(rows[0].warmRequestMs.length, 30);
  }
  assert.equal(report.rows.length, scenarios.length * 2 * 2 * 3);
  for (const s of scenarios) for (const gcMode of protocol.gcModes) for (const implementation of ['pulse', 'rust']) for (let repetition = 0; repetition < 3; repetition++) {
    const matches = report.rows.filter(r => r.scenario === s.id && r.gcMode === gcMode && r.implementation === implementation && r.repetition === repetition); assert.equal(matches.length, 1);
    const row = matches[0], artifact = report.artifacts.find(a => a.fixture === s.fixture && a.implementation === implementation);
    assert.equal(row.status, 'passed'); assert.equal(row.artifactSha256, artifact.sha256);
    assert.deepEqual(row.execArgv, gcMode === 'forced' ? ['--expose-gc'] : []);
    assert.deepEqual(row.abi, artifact.abi);
    assert(row.abi.imports.some(i => i.module === 'pulse_host')); assert(row.abi.exports.some(e => e.name === 'pulse_abi_version'));
    assert.equal(row.payload.utf16Units, shapes[s.shape].length);
    assert.equal(row.disposalCount, s.mode === 'full' ? 256 : 0);
    memory(row.beforeLoad); memory(row.afterLoad);
    assert.deepEqual(row.checkpoints.map(c => c.requests), checkpoints);
    for (const c of row.checkpoints) {
      assert.equal(c.afterGc === null, gcMode === 'natural');
      for (const sample of [c.beforeGc, ...(c.afterGc ? [c.afterGc] : [])]) {
        memory(sample.memory); const g = sample.guests;
        if (s.observe === false) { assert.equal(g, null); continue; }
        assert.equal(g.instancesCreated, c.requests); assert(Number.isSafeInteger(g.liveMemories) && g.liveMemories >= 0 && g.liveMemories <= c.requests);
        assert(Number.isSafeInteger(g.liveLinearCapacityBytes) && g.liveLinearCapacityBytes >= 0);
        for (const key of ['perInstanceInitialBytes', 'perInstanceMaxObservedBytes']) { assert.equal(g[key].length, c.requests); assert(g[key].every(n => Number.isSafeInteger(n) && n > 0 && n % 65536 === 0)); }
        assert(g.perInstanceMaxObservedBytes.every((n, i) => n >= g.perInstanceInitialBytes[i]));
        assert(g.liveLinearCapacityBytes <= g.perInstanceMaxObservedBytes.reduce((a, b) => a + b, 0));
        assert.equal(g.liveLinearCapacityBytes === 0, g.liveMemories === 0);
      }
    }
    if (s.observe === false) { assert.deepEqual(row.phases, []); continue; }
    assert(row.phases.some(p => p.phase === 'afterInstantiate'));
    if (s.mode !== 'instantiate' && s.fixture === 'schema-effect') {
      assert.deepEqual(row.phases.filter(p => p.phase === 'afterExport:pulse_schema_decode').map(p => p.schemaIndex), [0, 1, 2]);
      assert.deepEqual(row.phases.filter(p => p.phase === 'afterExport:pulse_schema_encode').map(p => p.schemaIndex), [2]);
    }
    assert(row.phases.some(p => p.phase === (s.mode === 'full' ? 'afterProviderDisposal' : 'afterControllerClose')));
    for (const phase of row.phases) { memory(phase.memory); assert(phase.guestMemoryBytes > 0); }
  }
  assert.deepEqual(report.summaries, summaries(report.rows)); return report;
}
async function campaign(output) {
  assert(!fs.existsSync(output) && !fs.existsSync(output + '.log'), 'Choose a new output path');
  assert(!process.env.NODE_OPTIONS && process.execArgv.length === 0, 'Unset Node options for comparable workers');
  const source = candidateIdentity(root); assert.equal(source.workingTree, '', 'Commit source before measuring');
  const deps = dependencies(), rust = rustIdentity();
  const report = { schemaVersion: 'pulse.memory-attribution.v1', status: 'running', source, dependencies: deps, rust,
    environment: environment(), protocol, artifacts: [], behavior: [], controls: [], rows: [], createdAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.closeSync(fs.openSync(output + '.log', 'wx'));
  fs.mkdirSync(path.join(root, 'wasm/.test-results'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'wasm/.test-results/perf804-'));
  const abort = new AbortController(), stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const started = performance.now(), persist = () => atomicJson(output, report), prepared = {};
  async function worker(args, receipt) {
    const result = await runCommand(process.execPath, args, { cwd: root, signal: abort.signal, timeoutMs: protocol.workerTimeoutMs,
      termGraceMs: 1000, killGraceMs: 1000, onOutput(_stream, chunk) { fs.appendFileSync(output + '.log', chunk); } });
    assert(result.status === 0 && !result.error && !result.timedOut && !result.interruptedBy, 'Worker failed: ' + JSON.stringify(result) + '; see ' + output + '.log');
    return read(receipt);
  }
  try {
    persist();
    for (const f of selected) {
      const project = path.join(directory, f.id), rustProject = project + '-rust';
      prepareProject(project, f, 'native');
      const pulse = await worker([path.join(__dirname, 'baseline.cjs'), '--worker', 'build', project, 'artifact', project + '.json', 'beta8'], project + '.json');
      const manifest = read(path.join(pulse.outDir, 'pulse-build.json')), planFile = path.join(pulse.outDir, manifest.portable.plan);
      prepareRust(rustProject, f, read(planFile)); fs.copyFileSync(planFile, path.join(rustProject, 'plan.json'));
      const rustBuild = await worker([path.join(__dirname, 'rust-baseline.cjs'), '--rust-build', rustProject, f.id, 'artifact', rustProject + '.json'], rustProject + '.json');
      prepared[f.id] = { pulse, rust: rustBuild };
      for (const implementation of ['pulse', 'rust']) {
        const b = prepared[f.id][implementation], m = read(path.join(b.outDir, 'pulse-build.json')), wasm = fs.readFileSync(path.join(b.outDir, m.portable.wasm.file)), mod = new WebAssembly.Module(wasm);
        report.artifacts.push({ fixture: f.id, implementation, sha256: hash(wasm), bytes: wasm.length,
          planSha256: hash(fs.readFileSync(path.join(b.outDir, m.portable.plan))), settings: b.settings,
          abi: { imports: WebAssembly.Module.imports(mod), exports: WebAssembly.Module.exports(mod), planHash: read(planFile).planHash } });
      }
      const receipt = project + '-behavior.json';
      report.behavior.push(await worker([path.join(__dirname, 'rust-baseline.cjs'), '--behavior', pulse.outDir, rustBuild.outDir, f.id, receipt], receipt));
      persist(); console.log('Behavior passed: ' + f.id);
    }
    // Unchanged reference workers first; diagnostic wrappers cannot affect them.
    for (const f of selected) for (let repetition = 0; repetition < 3; repetition++) for (const implementation of repetition % 2 ? ['rust', 'pulse'] : ['pulse', 'rust']) {
      const receipt = path.join(directory, 'control.json');
      const row = await worker([path.join(__dirname, 'baseline.cjs'), '--worker', 'runtime', prepared[f.id][implementation].outDir, f.id, 'native', 'measure', receipt, 'beta8'], receipt);
      report.controls.push({ fixture: f.id, implementation, repetition, ...row }); persist();
    }
    for (const scenario of scenarios) for (const gcMode of protocol.gcModes) {
      console.log('Memory sweep: ' + scenario.id + '/' + gcMode);
      for (let repetition = 0; repetition < 3; repetition++) for (const implementation of repetition % 2 ? ['rust', 'pulse'] : ['pulse', 'rust']) {
        const receipt = path.join(directory, 'memory.json'), b = prepared[scenario.fixture][implementation];
        const row = await worker([...(gcMode === 'forced' ? ['--expose-gc'] : []), path.join(__dirname, 'memory-worker.cjs'), b.outDir, scenario.id, gcMode, receipt], receipt);
        report.rows.push({ implementation, repetition, artifactSha256: b.artifactSha256, ...row }); persist();
      }
    }
    assert.deepEqual(candidateIdentity(root), source); assert.deepEqual(dependencies(), deps); assert.deepEqual(rustIdentity(), rust);
    report.summaries = summaries(report.rows); report.status = 'passed'; validate(report);
  } catch (error) { report.status = abort.signal.aborted ? 'interrupted' : 'failed'; report.error = error.message; throw error; }
  finally {
    fs.rmSync(directory, { recursive: true, force: true }); report.elapsedMs = performance.now() - started;
    report.completedAt = new Date().toISOString(); persist(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
  console.log('Saved ' + output + ' (120 sweep workers, 12 unchanged controls)');
}
if (require.main === module) {
  const [mode, file, ...rest] = process.argv.slice(2);
  assert(file && !rest.length && ['--out', '--check'].includes(mode), 'Use --out <new.json> or --check <report.json>');
  (mode === '--check' ? Promise.resolve().then(() => { validate(read(file)); console.log('ok - memory attribution report'); }) : campaign(path.resolve(file))).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { protocol, validate, summaries };
