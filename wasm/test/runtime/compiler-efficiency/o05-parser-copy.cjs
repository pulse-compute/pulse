#!/usr/bin/env node
'use strict';
// A paired mechanism check, not O-06's repeated runtime qualification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const o04 = require('./o04-copy-chain.cjs');
const p02 = require('./p02-memory-trace.cjs');
const mem = require('./mem01-schema-materialization.cjs');
const parser = require('../../provider/assert-fastly-json-parser.cjs');
const semantics = require('../../provider/assert-fastly-schema-encode-text.cjs');
const platform = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { policy } = require('../../../../packages/provider-fastly/src/build/native-value-budget');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const semanticKeys = ['response', 'status', 'traceSha256', 'outboundRequests', 'chargeBytes', 'chargeValues'];
function sameOutcome(a, b) { for (const key of semanticKeys) assert.deepEqual(a[key], b[key], key); }
function accounting(result) {
  const e = result?.instance.exports;
  return e?.pulse_fastly_memory_bytes ? { bytes: Number(e.pulse_fastly_memory_bytes()), values: Number(e.pulse_fastly_memory_values()) } : null;
}
function main() {
  const dir = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-o05-'));
  const output = path.join(root, 'wasm/.test-results/compiler-efficiency/o05'); fs.mkdirSync(output, { recursive: true });
  const file = path.join(output, 'measurements.json'), base = o04.loadBaseline();
  const report = { schemaVersion: 'pulse.parser-copy-o05.v1', status: 'running',
    baselineRevision: base.revision, baselineOwnerSha256: base.sourceSha256,
    sourceRevision: git(['rev-parse', 'HEAD']), workingTree: git(['status', '--short']),
    sourceHashes: Object.fromEntries([
      'packages/provider-fastly/src/build/native-platform-capabilities.js', 'pnpm-lock.yaml',
      'wasm/test/provider/assert-fastly-json-parser.cjs', 'wasm/test/provider/assert-fastly-schema-encode-text.cjs',
      ...['o05-parser-copy', 'o04-copy-chain', 'mem01-schema-materialization', 'p02-memory-trace'].map(n => `wasm/test/runtime/compiler-efficiency/${n}.cjs`)
    ].map(p => [p, sha(fs.readFileSync(path.join(root, p)))])),
    toolchain: { node: process.version, allocator: 'incremental', maximumMemoryPages: policy.maximumMemoryPages },
    variants: [], schemaCases: [], ownership: [], limitations: [
      'Single build pair and one fresh request process per case/mode; O-06 repetition and runtime/noise gates remain outstanding.',
      'Injected Fastly ABI only; no Viceroy or deployed acceptance claim.',
      'Baseline loads the unmodified O-04 provider owner with the same checkout dependencies.',
      'Direct parser cases bypass public schema/body admission; allocation is TLSF block volume, not RSS or capacity.'
    ] };
  write(file, report);
  try {
    const project = path.join(dir, 'project'); fs.mkdirSync(project); p02.prepareFixture(project); p02.compileWorker('node', project, dir);
    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
    const { resolveProject } = require('../../../packages/cli/src/project-config');
    const options = { cwd: project, canonicalBuild: true, bindings: resolveProject({ cwd: project, profile: 'fastly' }).providerConfig.bindings };
    let parserBaseline;
    for (const [name, compiler] of [['baseline', base.compiler], ['candidate', platform]]) {
      const directory = path.join(dir, name); fs.mkdirSync(directory);
      const artifact = compiler.compileFastlyNativePlatformCapabilitiesPlan(plan, options);
      const compile = (source, mode) => mem.diagnosticCompile(source, mode, directory, { maximumMemoryPages: policy.maximumMemoryPages });
      assert.deepEqual(compile(artifact.source, 'control'), artifact.wasm, 'diagnostic compiler matches production bytes');
      const variant = { name, sourceSha256: sha(artifact.source), wasmSha256: sha(artifact.wasm), wasmBytes: artifact.wasm.length,
        assemblyScript: artifact.manifest.assemblyScript, jsonAs: artifact.manifest.jsonAs, cases: [] };
      report.variants.push(variant);
      for (const [mode, wasm] of Object.entries({ production: artifact.wasm, traced: compile(artifact.source, 'traced'), staged: compile(o04.instrument(artifact.source), 'staged') }))
        fs.writeFileSync(path.join(directory, mode + '.wasm'), wasm);
      for (const pages of [0, 1, 16, 64]) {
        const row = { pages };
        for (const mode of ['production', 'traced', 'staged']) {
          const child = spawnSync(process.execPath, [require.resolve('./o04-copy-chain.cjs'), '--case', directory, mode, String(pages)],
            { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
          assert.equal(child.status, 0, child.stderr); row[mode] = JSON.parse(child.stdout);
        }
        sameOutcome(row.production, row.traced); sameOutcome(row.production, row.staged);
        assert.deepEqual(row.staged.terminal, row.traced.terminal, 'observers preserve allocations and GC');
        assert.deepEqual(row.staged.postCollect, row.traced.postCollect);
        if (name === 'candidate') {
          const before = report.variants[0].cases.find(c => c.pages === pages);
          sameOutcome(before.production, row.production);
          assert.ok(!row.staged.copies.some(c => c.kind === 'parser-string'), 'unescaped page strings allocate no decoder scratch');
          assert.ok(row.staged.decode.allocatedBytes <= before.staged.decode.allocatedBytes);
          assert.equal(row.staged.postCollect.outstandingBytes, before.staged.postCollect.outstandingBytes, 'retained graph is unchanged');
        }
        variant.cases.push(row); write(file, report);
      }
      const rows = parser.reproduce(compile(parser.instrument(artifact.source), 'parser'), name === 'candidate');
      if (!parserBaseline) parserBaseline = rows;
      else for (const [i, row] of rows.entries()) {
        assert.deepEqual(row.summary, parserBaseline[i].summary, row.name + ' text/error/handle/charge parity');
        assert.ok(row.allocatedBytes <= parserBaseline[i].allocatedBytes, row.name + ' parser allocation');
      }
      variant.parser = rows.map(row => ({ ...row, summary: undefined, outcomeSha256: sha(JSON.stringify(row.summary)) }));
      console.log(`ok - O-05 ${name}: ${rows.length} parser cases and 4 bounded page traces`);
    }
    for (const fixture of [...semantics.fixtures(), ...['closed-optional', 'bounded-open'].map(family =>
      ({ name: family, plan: mem.planFor(family), cases: mem.corpus(family), numeric: true }))]) {
      const artifacts = [base.compiler, platform].map(compiler => compiler.compileFastlyNativePlatformCapabilitiesPlan(fixture.plan, semantics.options));
      for (const test of fixture.cases) {
        const results = artifacts.map(a => semantics.outcome(a.wasm, test));
        results.forEach(r => {
          // Numeric codecs have an existing spelling counterexample (1e20.0).
          // Check values independently; the paired assertion below checks exact bytes.
          if (fixture.numeric && !test.error && !test.status) {
            assert.equal(r.summary.status, 200, test.name);
            assert.deepEqual(JSON.parse(r.summary.body), test.expected, test.name);
          } else semantics.checkOutcome(test, r.summary);
        });
        assert.deepEqual(results[1].summary, results[0].summary, fixture.name + '/' + test.name);
        assert.deepEqual(accounting(results[1].result), accounting(results[0].result));
        report.schemaCases.push({ fixture: fixture.name, name: test.name, inputSha256: sha(test.body),
          outcomeSha256: sha(JSON.stringify(results[0].summary)), status: 'passed' });
      }
      write(file, report);
    }
    // Force collection across projection, codec and freeze boundaries on both owners.
    for (const family of ['text-only', 'closed-optional', 'bounded-open']) {
      const facts = [];
      for (const [i, compiler] of [base.compiler, platform].entries()) {
        const artifact = compiler.generateFastlyNativePlatformCapabilitiesAssemblyScript(mem.planFor(family), semantics.options);
        const wasm = mem.diagnosticCompile(mem.instrument(artifact.source), `${family}-${i}`, dir);
        const probe = mem.observer({ collectAtStages: true }), test = mem.corpus(family)[0];
        const result = semantics.outcome(wasm, test, mem.diagnosticHost(), probe);
        assert.equal(result.summary.status, 200, family);
        assert.deepEqual(JSON.parse(result.summary.body), test.expected, family);
        facts.push(mem.ownership(probe.raw));
      }
      assert.deepEqual(facts[0], facts[1], family + ' graph ownership and identity');
      report.ownership.push({ family, facts: facts[1] });
    }
    report.status = 'passed'; write(file, report);
    console.log(JSON.stringify({ status: report.status, report: path.relative(root, file), schemaCases: report.schemaCases.length }));
  } catch (error) { report.status = 'failed'; report.error = error.stack; write(file, report); throw error; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
if (require.main === module) main();
