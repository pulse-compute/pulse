#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { build, root, hash, profile } = require('./build.cjs');
const { instantiate } = require('./host.cjs');
const { checkPair } = require('./check.cjs');
const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile.js');
const WIDTHS = [1, 8, 16, 32], PAYLOADS = [1024, 16384, 65536], SAMPLES = 11, BATCH = 5, WARMUP = 5;
const clock = () => process.hrtime.bigint();
const micros = start => Number(clock() - start) / 1000;
function sourceIdentity() {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
  git(['diff', '--exit-code']); // Dirty development is allowed only if fully staged.
  assert.equal(git(['ls-files', '--others', '--exclude-standard']), '', 'Stage fixture/docs before measuring; keep outputs outside checkout');
  return { base: git(['rev-parse', 'HEAD']), tree: git(['write-tree']), staged: git(['diff', '--cached', '--name-only']) !== '' };
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b), at = p => sorted[Math.floor((sorted.length - 1) * p)];
  return { unit: 'microseconds-per-invocation', median: at(.5), p25: at(.25), p75: at(.75), min: sorted[0], max: sorted.at(-1), samples: values };
}
function trial(artifact, payload) {
  const start = clock();
  const host = instantiate(artifact.module, { width: artifact.identity.width, trace: false, verify: false });
  const initialize = micros(start), executeStart = clock();
  const deliveries = host.x.run(payload), execute = micros(executeStart);
  // Verification and inspection never enter the execution timer. The guest
  // checksum consumes every payload byte, keeping payload work observable.
  assert.equal(deliveries, artifact.identity.width);
  assert.equal(host.x.checksum(), deliveries * payload * 127);
  const state = host.snapshot();
  assert.equal(state.disposals, deliveries); assert.equal(state.live.length, 0); assert.equal(state.error, 0);
  assert.deepEqual(state.backing, Array(deliveries).fill(payload + 1));
  assert.equal(state.notes, artifact.identity.observed ? 3 * deliveries : 0);
  return { initialize, execute, memoryCapacityBytes: host.x.memory.buffer.byteLength };
}
function validate(report) {
  assert.equal(report.schemaVersion, 'pulse.resource-cost-baseline.v1'); assert.equal(report.status, 'completed');
  assert.match(report.source.base, /^[0-9a-f]{40}$/); assert.match(report.source.tree, /^[0-9a-f]{40}$/);
  assert.equal(report.qualification, false); assert.equal(report.accountingOverhead, null);
  assert.equal(report.semanticCases, 72); assert.equal(report.artifacts.length, 8); assert.equal(report.cells.length, 12);
  const identities = new Set();
  for (const artifact of report.artifacts) {
    assert.ok(WIDTHS.includes(artifact.width)); assert.equal(typeof artifact.observed, 'boolean'); assert.equal(artifact.mutation, null);
    assert.match(artifact.wasmSha256, /^[0-9a-f]{64}$/); assert.match(artifact.sourceSha256, /^[0-9a-f]{64}$/);
    const id = artifact.width + ':' + artifact.observed; assert.ok(!identities.has(id)); identities.add(id);
  }
  const cells = new Set();
  for (const cell of report.cells) {
    const id = cell.width + ':' + cell.payloadBytes; assert.ok(!cells.has(id)); cells.add(id);
    assert.ok(WIDTHS.includes(cell.width) && PAYLOADS.includes(cell.payloadBytes));
    assert.deepEqual(cell.planned, profile(cell.width, cell.payloadBytes).required);
    assert.equal(cell.payloadBackingBytes, cell.width * (cell.payloadBytes + 1));
    assert.equal(cell.observerDeltaUs, cell.observed.execute.median - cell.control.execute.median);
    for (const variant of ['control', 'observed']) {
      const artifact = report.artifacts.find(item => item.width === cell.width && item.observed === (variant === 'observed'));
      assert.equal(cell[variant].wasmSha256, artifact.wasmSha256);
      for (const phase of ['initialize', 'execute']) {
        const series = cell[variant][phase]; assert.equal(series.samples.length, SAMPLES);
        assert.ok(series.samples.every(value => Number.isFinite(value) && value > 0));
        assert.deepEqual(series, stats(series.samples));
      }
      assert.ok(cell[variant].memoryCapacityBytes >= cell.width * (cell.payloadBytes + 1));
    }
  }
  return report;
}
function campaign(directory) {
  assert.ok(path.isAbsolute(directory), 'Pass an absolute output directory');
  const relative = path.relative(root, directory);
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep), 'Measurement outputs belong outside checkout');
  assert.equal(fs.existsSync(directory), false, 'Use a new output directory');
  assert.equal(process.execArgv.length, 0); assert.ok(!process.env.NODE_OPTIONS, 'Use the default Node engine recipe');
  const source = sourceIdentity(); fs.mkdirSync(directory, { recursive: true });
  const asc = resolveAsc(path.join(root, 'wasm/packages/compiler'));
  const report = { schemaVersion: 'pulse.resource-cost-baseline.v1', status: 'running', qualification: false,
    source, environment: { node: process.version, v8: process.versions.v8, assemblyscript: require(path.join(asc.packageRoot, 'package.json')).version,
      platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
      lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), compilerSha256: hash(fs.readFileSync(path.join(asc.packageRoot, 'dist/asc.js'))) },
    recipe: { samples: SAMPLES, invocationsPerSample: BATCH, warmupInvocations: WARMUP,
      instance: 'fresh-per-invocation', host: 'injected-synchronous-binary-reader', allocator: 'stub',
      observer: 'host-counter-only-no-trace-arrays', timing: 'host-plus-instance-init-and-guest-run-separate',
      exclusions: ['network', 'hosted-latency', 'admission-calculation', 'accounting-kernel', 'observer-event-serialization', 'process-rss', 'gc-reclamation'] },
    accountingOverhead: null, accountingReason: 'No production P04 accounting candidate exists.',
    artifacts: [], cells: [], semanticCases: 0 };
  const file = path.join(directory, 'report.json');
  const persist = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  try {
    persist();
    for (const width of WIDTHS) {
      const variants = { control: build(directory, width), observed: build(directory, width, true) };
      report.semanticCases += checkPair(variants.control, variants.observed, width);
      report.artifacts.push(variants.control.identity, variants.observed.identity);
      for (const payloadBytes of PAYLOADS) {
        const cell = { width, payloadBytes, payloadBackingBytes: width * (payloadBytes + 1), planned: profile(width, payloadBytes).required };
        for (const [name, artifact] of Object.entries(variants)) {
          for (let i = 0; i < WARMUP; i++) trial(artifact, payloadBytes);
          cell[name] = { wasmSha256: artifact.identity.wasmSha256, initialize: [], execute: [], memoryCapacityBytes: 0 };
        }
        for (let sample = 0; sample < SAMPLES; sample++) {
          for (const name of (sample % 2 ? ['observed', 'control'] : ['control', 'observed'])) {
            let initialize = 0, execute = 0;
            for (let i = 0; i < BATCH; i++) {
              const measured = trial(variants[name], payloadBytes);
              initialize += measured.initialize; execute += measured.execute;
              cell[name].memoryCapacityBytes = Math.max(cell[name].memoryCapacityBytes, measured.memoryCapacityBytes);
            }
            cell[name].initialize.push(initialize / BATCH); cell[name].execute.push(execute / BATCH);
          }
        }
        for (const name of ['control', 'observed']) for (const phase of ['initialize', 'execute']) cell[name][phase] = stats(cell[name][phase]);
        // Signed observed deltas are retained; a negative noisy result is not zero overhead.
        cell.observerDeltaUs = cell.observed.execute.median - cell.control.execute.median;
        report.cells.push(cell); persist();
        console.log(`measured width=${width} payload=${payloadBytes}; accounting remains unmeasured`);
      }
    }
    assert.deepEqual(sourceIdentity(), source, 'Source changed during measurement');
    report.status = 'completed'; validate(report);
    const serializeStart = clock(); JSON.stringify(report); report.reportSerializationUs = micros(serializeStart);
  } catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
  finally { persist(); }
  console.log('Saved ' + file);
}
if (require.main === module) {
  if (process.argv[2] === '--validate') {
    const file = path.resolve(process.argv[3]); const report = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
    for (const artifact of report.artifacts) {
      const name = `ownership-${artifact.width}-${artifact.observed ? 'observed' : 'control'}`;
      assert.equal(hash(fs.readFileSync(path.join(path.dirname(file), name + '.wasm'))), artifact.wasmSha256);
      assert.equal(hash(fs.readFileSync(path.join(path.dirname(file), name + '.ts'))), artifact.sourceSha256);
    }
    console.log('ok - complete P11A report and artifact identities');
  } else { assert.equal(process.argv.length, 3, 'Pass a fresh absolute output directory'); campaign(process.argv[2]); }
}
module.exports = { validate, stats };
