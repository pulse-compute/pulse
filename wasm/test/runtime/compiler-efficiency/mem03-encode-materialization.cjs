#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { root, hash } = require('./schema-cost-profile.cjs');
const proof = require('./mem01-schema-materialization.cjs');
const semantics = require('../../provider/assert-fastly-schema-encode-text.cjs');
const platform = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const owner = 'packages/provider-fastly/src/build/native-platform-capabilities.js';
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function loadBaseline(ref) {
  const filename = path.join(root, owner), source = execFileSync('git', ['show', `${ref}:${owner}`], { cwd: root, encoding: 'utf8' });
  const loaded = new Module(filename, module); loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename)); loaded._compile(source, filename);
  return { compiler: loaded.exports, sourceSha256: hash(source) };
}

function run() {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const baselineRevision = git(['rev-parse', process.env.PULSEWASM_MEM03_BASE || '8a6f2ff^{commit}']);
  const base = loadBaseline(baselineRevision);
  const output = path.join(root, 'wasm/.test-results/compiler-efficiency/mem03', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const file = path.join(output, 'measurements.json');
  const report = { version: 'pulse.mem03.encode-materialization.v1', status: 'running', baselineRevision,
    sourceRevision: git(['rev-parse', 'HEAD']), workingTree: git(['status', '--porcelain']), node: process.version,
    harnessSha256: hash(fs.readFileSync(__filename)), observerSha256: hash(fs.readFileSync(require.resolve('./mem01-schema-materialization.cjs'))),
    semanticHarnessSha256: hash(fs.readFileSync(require.resolve('../../provider/assert-fastly-schema-encode-text.cjs'))),
    baselineOwnerSha256: base.sourceSha256, candidateOwnerSha256: hash(fs.readFileSync(path.join(root, owner))),
    lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), semanticCases: [], memory: [],
    limitations: ['Injected Fastly ABI execution; no deployed or Viceroy claim.',
      'TLSF outstanding blocks exclude static data, shadow stack, allocator metadata and spare pages; post-collection blocks are retained allocation, not RSS.',
      'No new lifetime or cumulative budget policy; bounded-read-loop plans retain the original path.',
      'Baseline owner is loaded unmodified from git; all other production dependencies are identical to the candidate checkout.'] };
  const execute = proof.diagnosticHost();
  try {
    const loop = semantics.eligibilityChecks();
    const loopArtifacts = [base.compiler, platform].map(compiler => compiler.compileFastlyNativePlatformCapabilitiesPlan(loop, semantics.options));
    assert.equal(loopArtifacts[0].source, loopArtifacts[1].source, 'PS3 generated source stays byte-identical');
    assert.deepEqual(loopArtifacts[0].wasm, loopArtifacts[1].wasm, 'PS3 optimized Wasm stays byte-identical');
    const loopCase = semantics.textCases()[0];
    const loopResults = loopArtifacts.map(artifact => semantics.outcome(artifact.wasm, loopCase));
    for (const result of loopResults) semantics.checkOutcome(loopCase, result.summary);
    assert.deepEqual(loopResults[0].summary, loopResults[1].summary);
    report.ps3 = { sourceByteIdentical: true, wasmByteIdentical: true, sourceSha256: hash(loopArtifacts[0].source),
      wasmSha256: hash(loopArtifacts[0].wasm), accounting: loopResults.map(r => ({
        bytes: Number(r.result.instance.exports.pulse_fastly_memory_bytes()), values: Number(r.result.instance.exports.pulse_fastly_memory_values())
      })) };
    assert.deepEqual(report.ps3.accounting[0], report.ps3.accounting[1]);
    for (const fixture of semantics.fixtures()) {
      const a = base.compiler.compileFastlyNativePlatformCapabilitiesPlan(fixture.plan, semantics.options);
      const b = platform.compileFastlyNativePlatformCapabilitiesPlan(fixture.plan, semantics.options);
      for (const test of fixture.cases) {
        const before = semantics.outcome(a.wasm, test).summary, after = semantics.outcome(b.wasm, test).summary;
        semantics.checkOutcome(test, before); semantics.checkOutcome(test, after);
        assert.deepEqual(after, before, `${fixture.name}/${test.name} exact baseline outcome and host trace`);
        report.semanticCases.push({ fixture: fixture.name, case: test.name, inputSha256: hash(test.body),
          bytes: Buffer.byteLength(test.body), outcomeSha256: hash(JSON.stringify(before)), status: 'passed' });
      }
      write(file, report);
    }
    for (const family of ['text-only', 'closed-optional', 'bounded-open']) {
      const plan = proof.planFor(family), directory = path.join(output, family); fs.mkdirSync(directory);
      const artifacts = [base.compiler, platform].map(compiler => compiler.compileFastlyNativePlatformCapabilitiesPlan(plan, semantics.options));
      const cell = { family, artifacts: artifacts.map(a => ({ sourceSha256: hash(a.source), wasmSha256: hash(a.wasm),
        sourceBytes: Buffer.byteLength(a.source), wasmBytes: a.wasm.length, assemblyScript: a.manifest.assemblyScript, jsonAs: a.manifest.jsonAs })), cases: [] };
      report.memory.push(cell);
      if (family !== 'text-only') { assert.equal(artifacts[0].source, artifacts[1].source); assert.deepEqual(artifacts[0].wasm, artifacts[1].wasm); }
      const variants = artifacts.map((artifact, i) => {
        const dir = path.join(directory, i ? 'candidate' : 'baseline'); fs.mkdirSync(dir);
        assert.deepEqual(proof.diagnosticCompile(artifact.source, 'control', dir), artifact.wasm, 'diagnostic control matches optimized production bytes');
        return { traced: proof.diagnosticCompile(artifact.source, 'traced', dir), staged: proof.diagnosticCompile(proof.instrument(artifact.source), 'staged', dir) };
      });
      // Repeat the fixed near-bound trace in independent instances. Allocation
      // and collection metrics must be deterministic across all three samples.
      cell.nearBoundSamples = variants.map(variant => Array.from({ length: 3 }, () => {
        const probe = proof.observer(), test = proof.corpus(family).find(t => t.name === 'near-bound-ascii');
        const observed = semantics.outcome(variant.traced, test, execute, probe);
        assert.equal(observed.summary.status, 200);
        return { terminal: probe.metrics(), postCollect: probe.collect() };
      }));
      for (const samples of cell.nearBoundSamples) for (const sample of samples) assert.deepEqual(sample, samples[0]);
      for (const test of proof.corpus(family)) {
        const expected = semantics.outcome(artifacts[0].wasm, test).summary;
        assert.deepEqual(semantics.outcome(artifacts[1].wasm, test).summary, expected);
        const row = { name: test.name, inputUtf8Bytes: Buffer.byteLength(test.body), variants: [] };
        for (const [index, variant] of variants.entries()) {
          const measured = {};
          for (const mode of ['traced', 'staged', 'collected']) {
            const observer = proof.observer({ collectAtStages: mode === 'collected' });
            const result = semantics.outcome(variant[mode === 'traced' ? 'traced' : 'staged'], test, execute, observer);
            assert.deepEqual(result.summary, expected, `${family}/${test.name}/${index}/${mode}`);
            measured[mode] = { terminal: observer.metrics(), postCollect: observer.collect(),
              ...(test.name === 'near-bound-ascii' ? { stages: observer.snapshots } : {}) };
            if (!test.error && mode !== 'traced') {
              const ownership = proof.ownership(observer.raw);
              if (family === 'text-only' && index === 1) assert.equal(ownership.graphs[1].handlesAddedByReparse, 0);
              else assert.ok(ownership.graphs[1].handlesAddedByReparse > 0);
              measured[mode].ownership = ownership;
            }
          }
          assert.deepEqual(measured.traced.terminal, measured.staged.terminal, 'stage observers preserve allocator totals/peak');
          assert.deepEqual(measured.traced.postCollect, measured.staged.postCollect, 'stage observers preserve terminal retained allocation');
          row.variants.push(measured);
        }
        if (family === 'text-only' && test.name === 'near-bound-ascii') {
          const [a, b] = row.variants.map(v => v.traced);
          assert.ok(b.terminal.allocatedBytes < a.terminal.allocatedBytes, 'less allocation');
          assert.ok(b.terminal.peakOutstandingBytes < a.terminal.peakOutstandingBytes, 'lower allocator peak');
          assert.ok(b.postCollect.outstandingBytes < a.postCollect.outstandingBytes, 'less retained allocation after collection');
        }
        cell.cases.push(row); write(file, report);
      }
      console.log(JSON.stringify({ family, status: 'passed', cases: cell.cases.length }));
    }
    report.status = 'passed'; write(file, report);
    console.log(JSON.stringify({ status: report.status, semanticCases: report.semanticCases.length, report: file }));
  } catch (error) { report.status = 'failed'; report.error = error.stack; write(file, report); throw error; }
}
if (require.main === module) run();
module.exports = { loadBaseline, run };
