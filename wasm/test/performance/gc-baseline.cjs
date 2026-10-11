#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const { prepareProject, dependencies, environment } = require('./baseline.cjs');
const root = path.resolve(__dirname, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const variants = ['unpatched', 'patched'];
const controlHashes = {
  unpatched: 'd8e54f81059382b72553d240c8b9b0f8bfc9ae2d0b6ecfdb65439b5068d428de',
  patched: 'be859a73ee7675f89a4f780aa5d573eee5d393d0a6fd963fbe54048e64030982'
};
function validateGuest(report) {
  assert.equal(report.status, 'completed'); assert(variants.includes(report.variant));
  assert.equal(report.rows.length, 20);
  const row = (mode, shape) => {
    const matches = report.rows.filter(r => r.mode === mode && r.shape === shape); assert.equal(matches.length, 1); return matches[0];
  };
  for (const shape of ['escaped', 'unicode', 'small']) {
    const control = row('control', shape), trace = row('trace', shape);
    assert.equal(control.sha256, controlHashes[report.variant]);
    assert.equal(trace.capacityBytes, control.capacityBytes, 'Instrumentation must reproduce control capacity');
    assert.equal(trace.afterCollectBytes, trace.capacityBytes);
    assert(trace.valueCount > 524288);
    assert(trace.histogram[trace.valueType + ':81'] >= 524288);
    const before = trace.events.find(e => e.kind === 'cycle' && e.phase === 'post-response-GC');
    const released = trace.events.find(e => e.kind === 'cycle' && e.phase === 'released-table-GC');
    assert(before.managed > 60 * 1024 * 1024);
    assert(released.managed < before.managed / 4, 'Root-release intervention must reclaim the retained boxes');
    assert(row('exact-growth', shape).capacityBytes < 128 * 1024 * 1024);
    for (const mode of ['trace', 'periodic', 'exact-growth', 'large-gc']) {
      const r = row(mode, shape); assert.equal(r.valueCount, trace.valueCount);
      assert.deepEqual(r.histogram, trace.histogram, 'Diagnostic policies must preserve allocation sequence histogram');
      assert.equal(r.afterCollectBytes, r.capacityBytes);
      const growth = r.events.filter(e => e.kind === 'growth'); assert(growth.length > 0);
      for (const g of growth) {
        assert.equal(g.pagesWanted, mode === 'exact-growth' ? g.pagesNeeded : Math.max(g.pagesBefore, g.pagesNeeded));
        assert(g.free.largest <= g.free.total && g.free.largest < g.request);
      }
    }
  }
  assert.equal(row('control', 'escaped').capacityBytes, report.variant === 'patched' ? 155189248 : 115343360);
  assert(row('reduced', 'small-0').valueCount < 400);
  for (const iterations of [1, 64, 128, 256]) {
    const current = row('reduced', 'small-' + iterations);
    assert(current.valueCount >= iterations * 2048);
  }
  assert.equal(row('reduced', 'small-256').capacityBytes, row('trace', 'small').capacityBytes);
}
function validate(report) {
  assert.equal(report.schemaVersion, 'pulse.gc-explanation.v1'); assert.equal(report.status, 'completed');
  assert.equal(report.source.workingTree, ''); assert.equal(report.guests.length, 2);
  assert.deepEqual(report.guests.map(g => g.variant), variants);
  report.guests.forEach(validateGuest);
  assert.equal(report.hosts.length, 24); assert.equal(report.artifacts.length, 2);
  for (const variant of variants) {
    const artifact = report.artifacts.find(a => a.variant === variant); assert(artifact);
    assert.equal(artifact.sha256, variant === 'patched' ? 'd1e19b5900999d58e850c293bd7880b73332f3190ac9c28a28ae80f84ed94260' : 'b12dc0793501ca703a64d790291ebaef6652cdca3ba577cab6dc60f9d3ce1a13');
    for (const scenario of ['full-small', 'full-small-unobserved']) for (const gcMode of ['natural', 'forced']) for (let repetition = 0; repetition < 3; repetition++) {
      const matches = report.hosts.filter(r => r.variant === variant && r.scenario === scenario && r.gcMode === gcMode && r.repetition === repetition);
      assert.equal(matches.length, 1); const r = matches[0];
      assert.equal(r.artifactSha256, artifact.sha256); assert.equal(r.status, 'passed'); assert.equal(r.disposalCount, 256);
      assert.deepEqual(r.checkpoints.map(c => c.requests), [1, 11, 41, 128, 256]); assert(r.gcEvents.length > 0);
      for (const checkpoint of r.checkpoints) {
        assert.equal(checkpoint.afterGc !== null, gcMode === 'forced');
        const point = checkpoint.afterGc || checkpoint.beforeGc;
        assert(point.memory.rss > 0 && point.memory.heap.total_physical_size > 0);
        assert.equal(point.guests !== null, scenario === 'full-small');
        if (point.guests) assert.equal(point.guests.instancesCreated, checkpoint.requests);
      }
    }
  }
  return report;
}
function campaign(directory) {
  assert(!fs.existsSync(directory), 'Choose a new output directory');
  assert(!process.env.JSON_CACHE && !process.env.NODE_OPTIONS && process.execArgv.length === 0);
  const source = candidateIdentity(root); assert.equal(source.workingTree, '', 'Commit source before measuring');
  const deps = dependencies(); fs.mkdirSync(directory, { recursive: true });
  const report = { schemaVersion: 'pulse.gc-explanation.v1', status: 'running', source, dependencies: deps, environment: environment(), guests: [], artifacts: [], hosts: [] };
  const file = path.join(directory, 'report.json');
  const persist = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  function worker(args, label) {
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 720000, maxBuffer: 8 * 1024 * 1024 });
    fs.writeFileSync(path.join(directory, label + '.log'), (result.stdout || '') + (result.stderr || ''));
    assert.equal(result.status, 0, label + ': ' + (result.error?.message || result.stderr));
  }
  try {
    persist();
    for (const variant of variants) {
      const output = path.join(directory, 'guest-' + variant);
      worker([path.join(__dirname, 'gc-guest-worker.cjs'), variant, output], 'guest-' + variant);
      const guest = read(path.join(output, 'result.json')); validateGuest(guest); report.guests.push(guest); persist();
      console.log('Guest proof completed: ' + variant);
    }
    const prepared = {};
    for (const variant of variants) {
      const project = path.join(directory, 'host-' + variant), receipt = project + '.json';
      prepareProject(project, require('./fixtures.cjs').fixtures.find(f => f.id === 'schema-effect'), 'native');
      worker([path.join(__dirname, 'arena-build-worker.cjs'), variant, project, receipt], 'build-' + variant);
      prepared[variant] = read(receipt).outDir;
      const manifest = read(path.join(prepared[variant], 'pulse-build.json'));
      const bytes = fs.readFileSync(path.join(prepared[variant], manifest.portable.wasm.file));
      report.artifacts.push({ variant, sha256: hash(bytes), bytes: bytes.length });
    }
    for (const scenario of ['full-small', 'full-small-unobserved']) for (const gcMode of ['natural', 'forced']) {
      for (let repetition = 0; repetition < 3; repetition++) for (const variant of (repetition % 2 ? [...variants].reverse() : variants)) {
        const label = ['host', scenario, gcMode, repetition, variant].join('-'), receipt = path.join(directory, label + '.json');
        worker([...(gcMode === 'forced' ? ['--expose-gc'] : []), path.join(__dirname, 'gc-host-worker.cjs'), prepared[variant], scenario, gcMode, receipt], label);
        report.hosts.push({ variant, repetition, artifactSha256: report.artifacts.find(a => a.variant === variant).sha256, ...read(receipt) }); persist();
      }
      console.log('Host diagnostics completed: ' + scenario + '/' + gcMode);
    }
    assert.deepEqual(candidateIdentity(root), source); assert.deepEqual(dependencies(), deps);
    report.status = 'completed'; validate(report);
  } catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
  finally { persist(); }
  console.log('Saved ' + file);
}
if (require.main === module) {
  const [mode, file, ...extra] = process.argv.slice(2); assert(file && !extra.length);
  if (mode === '--out') campaign(path.resolve(file));
  else { assert.equal(mode, '--check'); validate(read(file)); console.log('ok - GC explanation report'); }
}
module.exports = { validate, validateGuest };
