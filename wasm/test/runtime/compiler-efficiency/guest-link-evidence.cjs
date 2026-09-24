#!/usr/bin/env node
'use strict';

// Evidence only: measure copied final artifacts; never substitute stale receipts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const proof = require('./bounded-merging.cjs');
const { runTool, binaryenIdentity } = require('../../../packages/wasm-guest-link/src/toolchain');
const { assertFinal, assertFinalArtifactIdentity, memoryLayoutProof } = require('../../../packages/wasm-guest-link/src/pipeline');
const { inspectWasmFile, reportInspection } = require('../../../packages/wasm-guest-link/src/inspect');
const { resolveProject } = require('../../../packages/cli/src/project-config');
const host = require('../../../packages/host-runtime/src/runtime/canonical-native-host');
const fastly = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const driver = require('../../../../packages/provider-node/src/toolchain').createDriver();
const { optimizationPostures } = require('../../../packages/wasm-guest-link/src/constants');
const candidateFlags = [...proof.flags, '--skip-pass=memory-packing'];
const root = path.resolve(__dirname, '../../../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function build(job) {
  const artifact = proof.compile(job);
  assert.deepEqual(artifact.guestUnits.map(unit => unit.id), ['pulse.crypto.es256.rustcrypto-p256.v1']);
  const baseline = job.file + '-baseline', merged = job.file + '-merged';
  fs.writeFileSync(baseline + '.wasm', artifact.wasm);
  write(job.file + '.original-audit.json', artifact.guestLink.audit);
  assertFinalArtifactIdentity(baseline + '.wasm', artifact.guestLink.audit);
  runTool('wasm-opt', [baseline + '.wasm', ...proof.featureFlags(job), ...candidateFlags, '-o', merged + '.wasm']);
  assert.throws(() => assertFinalArtifactIdentity(merged + '.wasm', artifact.guestLink.audit),
    { code: 'PULSE_GUEST_FINAL_AUDIT_FAILED' }, 'changed bytes must not reuse the original receipt');
  for (const file of [baseline, merged]) {
    write(file + '.plan.json', artifact.plan);
    write(file + '.artifacts.json', artifact.realizationArtifacts);
  }
  const baselineShape = proof.shape(baseline + '.wasm', job), mergedShape = proof.shape(merged + '.wasm', job);
  assert.deepEqual(mergedShape.surface, baselineShape.surface);
  assert.equal(mergedShape.tables, baselineShape.tables);
  assert.equal(mergedShape.indirectCalls, baselineShape.indirectCalls);
  assert.ok(mergedShape.largestFunctionBytes <= Math.max(1024, baselineShape.largestFunctionBytes));
  assert.ok(mergedShape.maxParameters <= Math.max(64, baselineShape.maxParameters));
  const inspections = {};
  const inputs = artifact.guestLink.report.inspection.before;
  const before = { primary: inputs.primary, guest: inputs.guest, owner: inputs.memoryOwner };
  const layoutProofs = {};
  for (const [variant, file] of [['baseline', baseline], ['merged', merged]]) {
    const inspected = inspectWasmFile(file + '.wasm', { label: variant, workDirectory: job.inspectionDirectory });
    assertFinal(artifact.guestLink.plan, before, inspected);
    layoutProofs[variant] = memoryLayoutProof(artifact.guestLink.plan, before, inspected, variant);
    assert.equal(layoutProofs[variant].staticSegmentsMatchValidatedInputs, true);
    inspections[variant] = reportInspection(inspected);
    assert.deepEqual(inspections[variant].features, [], 'guest MVP policy');
  }
  assert.deepEqual(inspections.merged.dataSegments, inspections.baseline.dataSegments, 'static data layout and contents');
  const posture = job.profile === 'size' ? 'native-size' : 'native-default';
  const trace = runTool('wasm-opt', [baseline + '.wasm', ...optimizationPostures[posture], '--debug', '-o', job.file + '.control.wasm']);
  fs.writeFileSync(job.file + '.optimizer-trace.log', trace.stderr + '\n' + trace.stdout);
  const configuredPasses = [...trace.stderr.matchAll(/running pass: ([^ .]+)/g)].map(match => match[1]);
  assert.ok(configuredPasses.length, 'the pinned tool must expose the pass trace');
  write(job.file + '.build.json', { baseline: baselineShape, merged: mergedShape,
    inspections, layoutProofs, configuredPasses, configuredArguments: optimizationPostures[posture],
    structuralAuditPassed: true, originalAuditAccepted: true, staleCandidateAuditRejected: true,
    candidateProductionAudit: 'not-issued; requires integration before the owned final audit' });
}

async function probe(job) {
  const wasm = fs.readFileSync(job.file + '.wasm');
  const compiled = { wasm, plan: read(job.file + '.plan.json'), realizationArtifacts: read(job.file + '.artifacts.json') };
  const project = resolveProject({ cwd: job.cwd, profile: 'node-native' });
  const spec = project.tests.find(test => !test.expect.error);
  assert.ok(spec);
  const options = { ...driver.executionOptions(project.providerConfig, { request: spec.request }),
    captureJwtWallClock: () => ({ unixEpochSeconds: 2000000000, trusted: true }) };
  const execute = () => job.target === 'node' ? host.executeCanonicalNativeModule(compiled, options)
    : fastly.executeFastlyNativePlatformCapabilities(wasm, { request: spec.request, clockUnixSeconds: 2000000000 });
  const check = result => {
    assert.equal(result.response.status, spec.expect.status);
    assert.equal(result.response.body, spec.expect.text);
  };
  const start = performance.now(); new WebAssembly.Module(wasm);
  const firstModuleMs = performance.now() - start;
  const first = performance.now(), initial = await execute();
  const firstRequestMs = performance.now() - first; check(initial);
  const memoryObservation = job.target === 'node'
    ? { handles: initial.valueHandleCount, effects: initial.effectCount, budget: initial.memory || null }
    : { linearMemoryPages: initial.instance.exports.memory.buffer.byteLength / 65536 };
  for (let i = 0; i < 25; i++) check(await execute());
  const warm = performance.now();
  for (let i = 0; i < 100; i++) check(await execute());
  const warmBatchMs = performance.now() - warm;
  const semantics = await proof.semantics(job, job.file);
  write(job.result, { firstModuleMs, firstRequestMs, warmBatchMs, warmRequests: 100,
    memoryObservation, semantics, processPeakRssBytes: process.resourceUsage().maxRSS * 1024 });
}

function child(mode, job, jobFile) {
  write(jobFile, job);
  const result = spawnSync(process.execPath, [__filename, mode, jobFile], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
}

function main() {
  assert.equal(process.platform, 'linux', 'maxRSS byte conversion assumes Linux');
  const out = path.join(root, 'wasm/.test-results/compiler-efficiency/guest-link-evidence');
  fs.mkdirSync(out, { recursive: true });
  const work = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-guest-evidence-'));
  const report = { version: 'pulse.guest-link-evidence.v1', status: 'running',
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    harnessSha256: hash(fs.readFileSync(__filename)), sharedHarnessSha256: hash(fs.readFileSync(require.resolve('./bounded-merging.cjs'))),
    lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    node: process.version, binaryen: binaryenIdentity(), flags: candidateFlags, cells: [],
    limitations: ['Postpass copies, not integrated production artifacts.', 'Fresh Node/V8 processes; Fastly ABI harness, not Viceroy.',
      'First request follows module construction; no isolated JIT-tier measurement.',
      'RSS includes the whole harness and dependencies; not guest-only or JIT memory.',
      'One fresh build per cell; compilation performance comes from the prior bounded-merging proof.'] };
  const reportFile = path.join(out, 'measurements.json');
  try {
    proof.prepareProject(path.join(work, 'project'), 'examples/13-jwt-es256');
    const cwd = path.join(work, 'project'), jobFile = path.join(work, 'job.json');
    for (const target of ['node', 'fastly']) for (const profile of ['default', 'size']) {
      fs.rmSync(path.join(cwd, '.pulse/guests'), { recursive: true, force: true });
      const id = `${target}-${profile}`, file = path.join(out, id);
      const job = { fixture: 'jwt', target, profile, cwd, file, inspectionDirectory: work };
      child('--build', job, jobFile);
      const cell = { id, ...read(file + '.build.json'), samples: [] }; report.cells.push(cell);
      for (let round = 0; round < 3; round++) for (const variant of round % 2 ? ['merged', 'baseline'] : ['baseline', 'merged']) {
        const result = path.join(work, 'probe.json');
        child('--probe', { ...job, file: file + '-' + variant, result }, jobFile);
        const sample = { round, variant, ...read(result) };
        if (cell.samples.length) {
          assert.deepEqual(sample.semantics, cell.samples[0].semantics);
          assert.deepEqual(sample.memoryObservation, cell.samples[0].memoryObservation);
        }
        cell.samples.push(sample); write(reportFile, report);
      }
      console.log(JSON.stringify({ id, bytes: [cell.baseline.bytes, cell.merged.bytes], samples: cell.samples.length,
        staleAuditRejected: cell.staleCandidateAuditRejected }));
    }
    report.status = 'passed'; write(reportFile, report);
  } catch (error) { report.status = 'failed'; report.error = error.stack; write(reportFile, report); throw error; }
  finally { fs.rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[2] === '--build') build(read(process.argv[3]));
else if (process.argv[2] === '--probe') probe(read(process.argv[3])).catch(error => { console.error(error); process.exitCode = 1; });
else main();
