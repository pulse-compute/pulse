#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { fixtures } = require('./fixtures.cjs');
const { prepareProject, dependencies, environment } = require('./baseline.cjs');
const { prepareRust, rustIdentity } = require('./rust-baseline.cjs');
const { scenarios } = require('./memory-worker.cjs');
const { hash } = require('./report.cjs');
const { runCommand } = require('../../../scripts/release-process.cjs');
const { atomicJson } = require('../../../scripts/release-recovery.cjs');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const reference = require('./memory-baseline.cjs');
const implementations = ['unpatched', 'patched', 'rust'];
const protocol = { ...reference.protocol, version: 'pulse.cache-arena-protocol.v1',
  order: 'serial; rotate unpatched/patched/Rust across three repetitions',
  counterfactual: 'test-owned build worker injects only the pinned arena transform; production remains unpatched' };
const selected = fixtures.filter(f => ['minimal-request', 'schema-effect'].includes(f.id));
const ordered = repetition => [...implementations.slice(repetition), ...implementations.slice(0, repetition)];
function project(report, variant) {
  const convert = row => ({ ...row, implementation: row.implementation === variant ? 'pulse' : row.implementation });
  const filtered = key => report[key].filter(row => [variant, 'rust'].includes(row.implementation)).map(convert);
  const rows = filtered('rows');
  return { ...report, schemaVersion: 'pulse.memory-attribution.v1', protocol: reference.protocol,
    artifacts: filtered('artifacts'), controls: filtered('controls'), rows,
    behavior: report.behavior.filter(row => row.variant === variant), summaries: reference.summaries(rows) };
}
function summaries(report) {
  return ['unpatched', 'patched'].flatMap(variant => reference.summaries(project(report, variant).rows)
    .filter(row => variant === 'unpatched' || row.implementation !== 'rust')
    .map(row => ({ ...row, implementation: row.implementation === 'pulse' ? variant : row.implementation })));
}
function validate(report) {
  assert.equal(report.schemaVersion, 'pulse.cache-arena.v1'); assert.deepEqual(report.protocol, protocol);
  assert.equal(report.artifacts.length, 6); assert.equal(report.behavior.length, 4);
  assert.equal(report.controls.length, 18); assert.equal(report.rows.length, 180);
  for (const variant of ['unpatched', 'patched']) reference.validate(project(report, variant));
  const artifact = (fixture, implementation) => report.artifacts.find(a => a.fixture === fixture && a.implementation === implementation);
  assert.equal(artifact('minimal-request', 'unpatched').sha256, artifact('minimal-request', 'patched').sha256);
  // Causal control must reproduce PERF8-04's actual unmodified schema artifact.
  assert.equal(artifact('schema-effect', 'unpatched').sha256, 'b12dc0793501ca703a64d790291ebaef6652cdca3ba577cab6dc60f9d3ce1a13');
  assert.notEqual(artifact('schema-effect', 'patched').sha256, artifact('schema-effect', 'unpatched').sha256);
  for (const a of report.artifacts.filter(a => a.implementation !== 'rust')) {
    assert.equal(a.arenaControl.variant, a.implementation); assert.equal(a.arenaControl.cache, null);
    assert.equal(a.arenaControl.transformsAdded, a.implementation === 'patched' && a.fixture === 'schema-effect' ? 1 : 0);
    const flags = a.settings.compiler.flags;
    assert.equal(flags.some(flag => flag.endsWith('/schema-cache-arena-transform.cjs')), a.implementation === 'patched' && a.fixture === 'schema-effect');
  }
  for (const implementation of ['unpatched', 'patched']) {
    const expected = implementation === 'patched' ? 65536 : 1245184;
    for (const row of report.rows.filter(r => r.scenario === 'instantiate' && r.implementation === implementation)) {
      assert(row.checkpoints.every(c => c.beforeGc.guests.perInstanceInitialBytes.every(bytes => bytes === expected)));
    }
  }
  assert.deepEqual(report.summaries, summaries(report)); return report;
}
async function campaign(output) {
  assert(!fs.existsSync(output) && !fs.existsSync(output + '.log'), 'Choose a new output path');
  assert(!process.env.NODE_OPTIONS && process.execArgv.length === 0, 'Unset Node options for comparable workers');
  assert(!process.env.JSON_CACHE, 'Unset JSON_CACHE for the default-path experiment');
  const source = candidateIdentity(root); assert.equal(source.workingTree, '', 'Commit source before measuring');
  const deps = dependencies(), rust = rustIdentity();
  const report = { schemaVersion: 'pulse.cache-arena.v1', status: 'running', source, dependencies: deps, rust,
    environment: environment(), protocol, artifacts: [], behavior: [], controls: [], rows: [], createdAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.closeSync(fs.openSync(output + '.log', 'wx'));
  fs.mkdirSync(path.join(root, 'wasm/.test-results'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'wasm/.test-results/perf805-'));
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
      prepared[f.id] = {};
      for (const variant of ['unpatched', 'patched']) {
        const variantProject = project + '-' + variant;
        prepareProject(variantProject, f, 'native');
        prepared[f.id][variant] = await worker([path.join(__dirname, 'arena-build-worker.cjs'), variant, variantProject, variantProject + '.json'], variantProject + '.json');
      }
      const pulse = prepared[f.id].unpatched;
      const manifest = read(path.join(pulse.outDir, 'pulse-build.json')), planFile = path.join(pulse.outDir, manifest.portable.plan);
      prepareRust(rustProject, f, read(planFile)); fs.copyFileSync(planFile, path.join(rustProject, 'plan.json'));
      const rustBuild = await worker([path.join(__dirname, 'rust-baseline.cjs'), '--rust-build', rustProject, f.id, 'artifact', rustProject + '.json'], rustProject + '.json');
      prepared[f.id].rust = rustBuild;
      for (const implementation of implementations) {
        const b = prepared[f.id][implementation], m = read(path.join(b.outDir, 'pulse-build.json')), wasm = fs.readFileSync(path.join(b.outDir, m.portable.wasm.file)), mod = new WebAssembly.Module(wasm);
        report.artifacts.push({ fixture: f.id, implementation, sha256: hash(wasm), bytes: wasm.length,
          planSha256: hash(fs.readFileSync(path.join(b.outDir, m.portable.plan))), settings: b.settings, buildMs: b.buildMs, compilerPeakRssBytes: b.compilerPeakRssBytes, ...(b.arenaControl ? { arenaControl: b.arenaControl } : {}),
          abi: { imports: WebAssembly.Module.imports(mod), exports: WebAssembly.Module.exports(mod), planHash: read(planFile).planHash } });
      }
      const receipt = project + '-behavior.json';
      for (const variant of ['unpatched', 'patched']) report.behavior.push({ variant, ...await worker([path.join(__dirname, 'rust-baseline.cjs'), '--behavior', prepared[f.id][variant].outDir, rustBuild.outDir, f.id, receipt], receipt) });
      persist(); console.log('Behavior passed: ' + f.id);
    }
    // Unchanged reference workers first; diagnostic wrappers cannot affect them.
    for (const f of selected) for (let repetition = 0; repetition < 3; repetition++) for (const implementation of ordered(repetition)) {
      const receipt = path.join(directory, 'control.json');
      const row = await worker([path.join(__dirname, 'baseline.cjs'), '--worker', 'runtime', prepared[f.id][implementation].outDir, f.id, 'native', 'measure', receipt, 'beta8'], receipt);
      report.controls.push({ fixture: f.id, implementation, repetition, ...row }); persist();
    }
    for (const scenario of scenarios) for (const gcMode of protocol.gcModes) {
      console.log('Memory sweep: ' + scenario.id + '/' + gcMode);
      for (let repetition = 0; repetition < 3; repetition++) for (const implementation of ordered(repetition)) {
        const receipt = path.join(directory, 'memory.json'), b = prepared[scenario.fixture][implementation];
        const row = await worker([...(gcMode === 'forced' ? ['--expose-gc'] : []), path.join(__dirname, 'memory-worker.cjs'), b.outDir, scenario.id, gcMode, receipt], receipt);
        report.rows.push({ implementation, repetition, artifactSha256: b.artifactSha256, ...row }); persist();
      }
    }
    assert.deepEqual(candidateIdentity(root), source); assert.deepEqual(dependencies(), deps); assert.deepEqual(rustIdentity(), rust);
    report.summaries = summaries(report); report.status = 'passed'; validate(report);
  } catch (error) { report.status = abort.signal.aborted ? 'interrupted' : 'failed'; report.error = error.message; throw error; }
  finally {
    fs.rmSync(directory, { recursive: true, force: true }); report.elapsedMs = performance.now() - started;
    report.completedAt = new Date().toISOString(); persist(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
  console.log('Saved ' + output + ' (180 sweep workers, 18 unchanged controls)');
}
if (require.main === module) {
  const [mode, file, ...rest] = process.argv.slice(2);
  assert(file && !rest.length && ['--out', '--check'].includes(mode), 'Use --out <new.json> or --check <report.json>');
  (mode === '--check' ? Promise.resolve().then(() => { validate(read(file)); console.log('ok - cache arena report'); }) : campaign(path.resolve(file))).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { protocol, validate, summaries };
