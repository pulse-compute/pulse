'use strict';

// Bounded development demonstration with real tarballs and an installed gate.
// It cannot produce a release seal or replace complete qualification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { runCommand } = require('../../../scripts/release-process.cjs');
const { createCheckpointStore, fingerprint } = require('../../../scripts/release-checkpoints.cjs');
const { atomicJson, createContext, sharedPackDefinition, describeArtifact } = require('../../../scripts/release-recovery.cjs');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const { sharedPackEnv } = require('../../../scripts/release-shared-pack.cjs');
const { runSelectedTasks } = require('../../scripts/run-wasm-tests.cjs');
const ROOT = path.resolve(__dirname, '../../..');

async function main() {
  assert.equal(process.argv.length, 2, 'Usage: node wasm/test/release/ps06-recovery.cjs (build workspace first)');
  const candidate = candidateIdentity(ROOT);
  const parent = path.join(ROOT, '.pulse-seal/development');
  fs.mkdirSync(parent, {recursive: true});
  const directory = fs.mkdtempSync(path.join(parent, 'ps06-'));
  const context = {...createContext(ROOT, candidate, {install: false, requireFastly: false}, {status: 'unavailable'}),
    schemaVersion: 'pulse.ps06-development.v1'};
  const marker = path.join(directory, 'late-failure');
  fs.writeFileSync(marker, 'Deliberate development-only late failure');
  const selected = ['ast01-installed', 'ps06-late-failure'];
  const taskMap = {...require('../suite/registry.cjs').tasks, 'ps06-late-failure': {
    command: process.execPath, args: ['-e', "if(require('node:fs').existsSync(process.argv[1])) process.exit(9); console.log('late fixture passed')", marker],
    description: 'Deliberate late failure after installed proof', evidence: 'unit', timeoutMs: 5000
  }};
  async function attempt(label, previous) {
    const started = performance.now(), current = path.join(directory, label);
    const pack = path.join(current, 'packages'), log = path.join(current, 'pack.log');
    const store = createCheckpointStore({context, directory: path.join(current, 'pack-checkpoints'),
      previousDirectory: previous?.packCheckpoints});
    const spec = {id: 'shared-pack', definition: sharedPackDefinition(), dependencies: {}, artifacts: {pack, log}};
    const reused = store.tryReuse(spec);
    let packProof = reused;
    if (!reused.reused) {
      const fd = fs.openSync(log, 'w');
      let result;
      try {
        result = await runCommand(process.execPath, ['scripts/release-shared-pack.cjs', '--out', pack], {
          cwd: ROOT, timeoutMs: 600000, onOutput(name, chunk) {fs.writeSync(fd, chunk); process[name].write(chunk);}
        });
      } finally { fs.closeSync(fd); }
      assert.equal(result.status, 0, 'Real package construction failed');
      packProof = store.record({...spec, result: {status: 'passed', exitCode: 0, cleanup: {status: 'passed'}}});
    }
    const runDir = path.join(current, 'run');
    fs.mkdirSync(path.join(runDir, 'tasks'), {recursive: true});
    const installed = path.join(current, 'installed/ast01-installed.json');
    const state = {results: [], runDir, sourceEnv: {...sharedPackEnv(pack), PULSE_SOURCE_REVISION: candidate.sourceRevision,
      PULSE_SOURCE_IDENTITY_KIND: 'git-commit', PULSE_SOURCE_DIGEST_SHA256: '', PULSE_SOURCE_FILE_COUNT: ''}};
    const checkpoints = path.join(current, 'task-checkpoints');
    await runSelectedTasks({state, taskMap, selection: {requested: selected, selected}, recoveryConfig: {
      schemaVersion: 'pulse.seal-task-recovery.v1', kind: 'development', context, selectedTasks: selected,
      directory: checkpoints, previousDirectory: previous?.checkpoints,
      dependencies: {'shared-pack': packProof.proofId}, taskOptions: {'ast01-installed': {
        env: {PULSE_RELEASE_FEATURE_REPORT_DIR: path.dirname(installed)}, artifacts: {installed}
      }}
    }});
    const result = {label, wallMs: Math.round(performance.now() - started),
      status: state.results.every(task => task.status === 'passed') ? 'passed' : 'failed',
      pack: {execution: reused.reused ? 'reused' : 'executed', proofId: packProof.proofId,
        packages: JSON.parse(fs.readFileSync(path.join(pack, 'pulse-release-manifest.json'))).packageCount},
      results: state.results, installedArtifact: describeArtifact(installed), checkpoints,
      packCheckpoints: path.join(current, 'pack-checkpoints')};
    atomicJson(path.join(current, 'report.json'), result);
    return result;
  }
  const first = await attempt('late-failed');
  assert.deepEqual(first.results.map(task => task.status), ['passed', 'failed']);
  fs.rmSync(marker);
  const resumed = await attempt('resumed', first);
  assert.equal(resumed.status, 'passed');
  assert.deepEqual(resumed.results.map(task => task.execution), ['reused', 'executed']);
  assert.equal(first.results[0].checkpoint.proofId, resumed.results[0].checkpoint.proofId);
  assert.equal(first.pack.proofId, resumed.pack.proofId);
  assert.deepEqual(first.installedArtifact, resumed.installedArtifact);
  assert.deepEqual(candidateIdentity(ROOT), candidate);
  const report = {schemaVersion: 'pulse.ps06-development-recovery.v1', releaseSeal: false, candidate,
    contextSha256: fingerprint(context), dependencyProvenance: 'Existing installed graph; no fresh bundle restoration',
    selectedTasks: selected, first, resumed};
  atomicJson(path.join(directory, 'report.json'), report);
  console.log(`Development recovery: ${path.join(directory, 'report.json')}`);
}

if (require.main === module) main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
