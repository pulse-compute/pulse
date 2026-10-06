#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { expandProfile } = require('../suite/registry.cjs');
const {
  AGGREGATE_VERSION,
  SHARD_DEFINITIONS,
  validateShardCoverage,
  aggregateValidation,
  resolveEvidencePaths,
  validateRecoveryEvidence,
  treeSnapshot,
  targetIntegrityReport,
  verifyCandidateDirectory
} = require('../../../scripts/release-evidence-bundle.cjs');
const {
  ARCHIVE_IDENTITY_KIND,
  archiveTreeIdentity,
  resolveSourceIdentity,
  sourceIdentityEnv
} = require('../../../scripts/source-identity.cjs');

const identityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-source-identity-'));
try {
  fs.writeFileSync(path.join(identityRoot, 'source.js'), 'first\n');
  fs.mkdirSync(path.join(identityRoot, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(identityRoot, 'node_modules', 'ignored.js'), 'first\n');
  fs.writeFileSync(path.join(identityRoot, 'tsconfig.tsbuildinfo'), 'first\n');
  fs.mkdirSync(path.join(identityRoot, '.four-mode-generated'), { recursive: true });
  fs.writeFileSync(path.join(identityRoot, '.four-mode-generated', 'ignored.js'), 'first\n');
  fs.mkdirSync(path.join(identityRoot, 'project', '.pulse', 'guests'), { recursive: true });
  fs.writeFileSync(path.join(identityRoot, 'project', '.pulse', 'config.ts'), 'export default {};\n');
  fs.writeFileSync(path.join(identityRoot, 'project', '.pulse', 'guests', 'ignored.wasm'), 'first\n');
  const firstIdentity = archiveTreeIdentity(identityRoot);
  assert.equal(firstIdentity.sourceIdentityKind, ARCHIVE_IDENTITY_KIND);
  assert.match(firstIdentity.sourceRevision, /^[a-f0-9]{40}$/);
  assert.match(firstIdentity.sourceDigestSha256, /^[a-f0-9]{64}$/);
  assert.equal(firstIdentity.sourceFiles, 2);

  fs.writeFileSync(path.join(identityRoot, 'node_modules', 'ignored.js'), 'second\n');
  fs.writeFileSync(path.join(identityRoot, 'tsconfig.tsbuildinfo'), 'second\n');
  fs.writeFileSync(path.join(identityRoot, '.four-mode-generated', 'ignored.js'), 'second\n');
  fs.writeFileSync(path.join(identityRoot, 'project', '.pulse', 'guests', 'ignored.wasm'), 'second\n');
  assert.deepEqual(archiveTreeIdentity(identityRoot), firstIdentity);
  fs.writeFileSync(path.join(identityRoot, 'source.js'), 'second\n');
  assert.notEqual(archiveTreeIdentity(identityRoot).sourceRevision, firstIdentity.sourceRevision);

  const propagated = resolveSourceIdentity(identityRoot, sourceIdentityEnv(firstIdentity));
  assert.deepEqual(propagated, firstIdentity);
} finally {
  fs.rmSync(identityRoot, { recursive: true, force: true });
}

const sourceRevision = 'a'.repeat(40);
const expectedTasks = expandProfile('release');
const coverage = validateShardCoverage();
assert.equal(coverage.length, 16);
assert.throws(
  () => validateShardCoverage([...expectedTasks, 'new-unmapped-task']),
  (error) => error.code === 'PULSE_RELEASE_EVIDENCE_TASK_UNMAPPED' && /new-unmapped-task/.test(error.message)
);
assert.throws(
  () => validateShardCoverage(expectedTasks, [...SHARD_DEFINITIONS, { id: 'stale', tasks: ['removed-task'] }]),
  (error) => error.code === 'PULSE_RELEASE_EVIDENCE_TASK_UNKNOWN' && /stale.*removed-task/.test(error.message)
);
assert.throws(
  () => validateShardCoverage(expectedTasks, [...SHARD_DEFINITIONS, SHARD_DEFINITIONS[0]]),
  (error) => error.code === 'PULSE_RELEASE_EVIDENCE_SHARD_INVALID'
);
assert.throws(
  () => validateShardCoverage(expectedTasks, [...SHARD_DEFINITIONS, { id: 'empty', taskPrefix: ['missing-prefix-'] }]),
  (error) => error.code === 'PULSE_RELEASE_EVIDENCE_SHARD_INVALID'
);
assert.throws(
  () => validateShardCoverage(expectedTasks, SHARD_DEFINITIONS.filter((shard) => shard.id !== 'fastly-javascript-provider')),
  (error) => error.code === 'PULSE_RELEASE_EVIDENCE_TASK_UNMAPPED' || error.code === 'PULSE_RELEASE_EVIDENCE_SHARD_INVALID'
);
// Overlap between shards remains intentional; prefix expansion covers new matching tasks.
assert.ok(validateShardCoverage([...expectedTasks, 'docs-new-example'])
  .find((shard) => shard.id === 'cli-documentation').tasks.includes('docs-new-example'));
const taskReport = {
  schemaVersion: 2,
  sourceRevision,
  sourceIdentity: { sourceRevision },
  currentTask: null,
  startedAt: '2026-10-05T00:00:00.000Z',
  finishedAt: '2026-10-05T00:00:01.000Z',
  durationMs: 1000,
  status: 'passed',
  requestedTasks: expectedTasks,
  selectedTasks: expectedTasks,
  completedTasks: expectedTasks.length,
  results: expectedTasks.map((name) => ({
    name,
    status: 'passed',
    exitCode: 0,
    evidence: 'release',
    durationMs: 1
  }))
};
const { SCHEMA: FEATURE_SCHEMA, REQUIRED_TASKS } = require('../../../scripts/release-feature-acceptance.cjs');
const featureAcceptance = {
  schemaVersion: FEATURE_SCHEMA, sourceRevision, sourceTree: 'b'.repeat(40), workingTree: '', status: 'passed',
  gates: REQUIRED_TASKS.map(task => ({ task, status: 'passed', reportSha256: 'c'.repeat(64),
    packages: [{ name: '@pulse-compute/pulse', version: require('../../../scripts/package-support.cjs').RELEASE_VERSION, sha256: 'd'.repeat(64) }] }))
};
const releaseSeal = {
  sourceRevision,
  featureAcceptance,
  status: 'passed',
  steps: [
    'maintainer',
    'publication',
    'build',
    'workspace-unit',
    'documentation',
    'release',
    'installed-features'
  ].map((id) => ({ id, status: 'passed' })),
  externalFastly: {
    status: 'unavailable',
    code: 'PULSE_FASTLY_CLI_UNAVAILABLE'
  }
};
const fourMode = {
  sourceRevision,
  status: 'passed',
  proof: {
    proofSha256: 'b'.repeat(64),
    summary: {
      cases: 6,
      modes: 4,
      executions: 24,
      comparisons: 18,
      mismatches: 0,
      fastlyTargetExecutions: 6
    },
    targetIntegrity: {
      automaticFallback: false,
      configuredTargetMatchesArtifact: true,
      inspectMatchesExecution: true,
      javascriptContainsNativeArtifact: false,
      nativeMasqueradesAsJavascript: false,
      unavailableBehaviorFailsBeforeDeployment: true,
      supportedClaimsWithEvidence: 4,
      providerReality: false,
      providerRealityOwner: 'external-fastly-validation'
    }
  }
};
const candidates = {
  sourceRevision,
  status: 'passed',
  summary: {
    total: 2,
    deterministicInputClosures: 2,
    deterministicMetadata: 2,
    byteIdenticalRuntimeArtifacts: 1,
    providerRealityValidated: 0,
    deployed: 0,
    published: 0
  },
  policy: {
    localCompilationOnly: true,
    providerRealityInvoked: false,
    deploymentPerformed: false,
    publicationPerformed: false
  },
  candidates: ['native', 'javascript'].map((target) => ({
    provider: 'fastly',
    target,
    targetId: `fastly-${target}`,
    status: 'structurally-deployable',
    inputClosureSha256: 'c'.repeat(64),
    runtimeArtifact: {
      file: 'bin/main.wasm',
      bytes: 8,
      sha256: 'd'.repeat(64)
    }
  }))
};
const replay = {
  status: 'passed',
  files: 1,
  treeSha256: 'e'.repeat(64)
};

const aggregate = aggregateValidation({
  sourceRevision,
  releaseSeal,
  taskReport,
  fourMode,
  candidates,
  replay
});
assert.equal(aggregate.schemaVersion, AGGREGATE_VERSION);
assert.equal(aggregate.status, 'passed');
assert.equal(aggregate.shards.length, 16);
assert.equal(aggregate.shards.length, SHARD_DEFINITIONS.length);
assert.equal(aggregate.shards.every((entry) => entry.status === 'passed'), true);
for (const id of ['runtime', 'lowering', 'fastly-native-provider', 'package-effects']) {
  assert.ok(aggregate.shards.find(shard => shard.id === id).tasks.some(task => task.name === 'clean-machine-acceptance'),
    `${id} requires the installed corpus owner`);
}
for (const status of ['failed', 'missing']) {
  const incomplete = structuredClone(taskReport);
  incomplete.results = incomplete.results.flatMap(task => task.name !== 'clean-machine-acceptance'
    ? [task] : status === 'missing' ? [] : [{ ...task, status }]);
  assert.throws(() => aggregateValidation({ sourceRevision, releaseSeal, taskReport: incomplete, fourMode, candidates, replay }),
    /clean-machine-acceptance|release task|task count|task set/i, `A ${status} installed owner cannot qualify the release`);
}
assert.deepEqual(
  aggregate.shards
    .find((entry) => entry.id === 'maintainer-publication-controls')
    .tasks
    .map((entry) => entry.name),
  ['release-feature-acceptance', 'release-runtime-policy', 'release-seal-lifecycle', 'release-checkpoints', 'release-recovery-runner', 'release-recovery', 'release-tag']
);
assert.deepEqual(aggregate.summary, {
  shards: 16,
  passed: 16,
  failed: 0,
  releaseTasks: expectedTasks.length,
  releaseTasksPassed: expectedTasks.length,
  installedFeatureGates: REQUIRED_TASKS.length,
  providerReality: 'unavailable',
  deploymentPerformed: false,
  publicationPerformed: false
});

// The legacy fresh path still accepts complete terminal coverage, but cannot
// smuggle a reused result or a reordered/spliced task list into the aggregate.
for (const mutate of [
  report => { report.results[0].execution = 'reused'; },
  report => { [report.results[0], report.results[1]] = [report.results[1], report.results[0]]; },
  report => { report.results[1] = report.results[0]; },
  report => { report.currentTask = report.selectedTasks[0]; },
  report => { report.results[0].exitCode = 1; }
]) {
  const invalid = structuredClone(taskReport);
  mutate(invalid);
  assert.throws(() => aggregateValidation({ sourceRevision, releaseSeal, taskReport: invalid, fourMode, candidates, replay }));
}

const { createCheckpointStore, fingerprint } = require('../../../scripts/release-checkpoints.cjs');
const { artifactPaths, describeArtifact, recoveryTaskOptions, sharedPackDefinition } = require('../../../scripts/release-recovery.cjs');
const { checkpointDefinition } = require('../../scripts/run-wasm-tests.cjs');
const { tasks } = require('../suite/registry.cjs');
const checkout = fs.realpathSync(path.resolve(__dirname, '../../..'));
const recoveryParent = path.join(checkout, '.pulse-seal/attempts');
fs.mkdirSync(recoveryParent, { recursive: true });
const recoveryDirectory = fs.mkdtempSync(path.join(recoveryParent, 'authority-fixture-'));
const previousRecoveryDirectory = fs.mkdtempSync(path.join(recoveryParent, 'authority-prior-'));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
try {
  for (const workers of [1, 4]) {
    fs.rmSync(recoveryDirectory, { recursive: true, force: true });
    fs.rmSync(previousRecoveryDirectory, { recursive: true, force: true });
    fs.mkdirSync(recoveryDirectory); fs.mkdirSync(previousRecoveryDirectory);
    const artifacts = artifactPaths(recoveryDirectory);
    const context = { schemaVersion: 'pulse.release-recovery.v1',
      selections: { release: expectedTasks, features: REQUIRED_TASKS }, candidate: { sourceRevision, sourceTree: 'b'.repeat(40), workingTree: '', repoRoot: checkout },
      lockfileSha256: 'c'.repeat(64), environmentSha256: 'd'.repeat(64), toolchain: { node: process.version },
      inputs: { dependenciesSha256: 'e'.repeat(64) }, options: { install: true, workers, memoryBudgetMiB: 6144 } };
    if (workers > 1) {
      const { workspaceRoot, WORKER_MIB } = require('../../../scripts/release-parallel.cjs');
      const { repoRoot: _checkout, ...candidate } = context.candidate;
      context.scheduling = { schemaVersion: 'pulse.seal-workers.v1', root: checkout, candidate,
        workers, memoryBudgetMiB: 6144, estimatedWorkerMiB: WORKER_MIB, compilerWorkers: 2,
        workspaces: Array.from({ length: workers }, (_, index) => ({ id: `worker-${index + 1}`,
          directory: path.join(workspaceRoot(checkout, candidate.sourceTree, workers), `worker-${index + 1}`),
          inputs: { dependenciesSha256: 'e'.repeat(64), buildSha256: 'f'.repeat(64), dependencyFiles: 1, build: [] } })) };
    }
    const recovery = { schemaVersion: 'pulse.release-recovery.v1', directory: recoveryDirectory,
      previousDirectory: previousRecoveryDirectory, context, contextSha256: fingerprint(context), artifacts };
    const packFile = path.join(recoveryDirectory, 'packages/candidate.tgz');
    write(packFile, { package: 'fixture' });
    const packLog = path.join(recoveryDirectory, 'shared-pack.log');
    write(packLog, { package: 'built' });
    const packStore = createCheckpointStore({ directory: path.join(recoveryDirectory, 'checkpoints/pack'), context });
    const pack = packStore.record({ id: 'shared-pack', definition: sharedPackDefinition(), dependencies: {},
      artifacts: { pack: path.dirname(packFile), log: packLog }, result: { id: 'shared-pack', status: 'passed', exitCode: 0, cleanup: { status: 'passed' } } });
    recovery.sharedPack = { execution: 'executed', proofId: pack.proofId, receiptPath: pack.receiptPath, receiptSha256: pack.receiptSha256 };
    write(artifacts.fourMode, fourMode);
    write(artifacts.candidateReport, candidates);
    write(path.join(artifacts.candidates, 'candidate.json'), candidates);
    write(artifacts.cleanMachineCorpora, { status: 'passed' });
    function checkpointReport(names, kind) {
      const directory = path.join(recoveryDirectory, 'checkpoints', kind);
      const previousDirectory = path.join(previousRecoveryDirectory, 'checkpoints', kind);
      const store = createCheckpointStore({ directory, previousDirectory, context });
      const taskOptions = recoveryTaskOptions(artifacts, kind);
      const dependencies = { 'shared-pack': pack.proofId };
      const results = names.map(name => {
        const overrides = taskOptions[name] || {};
        if (kind === 'features') write(overrides.artifacts.installedReport, { task: name, status: 'passed' });
        const logPath = path.join(recoveryDirectory, 'logs', `${name}.log`);
        write(logPath, { task: name });
        const result = { name, status: 'passed', exitCode: 0, evidence: tasks[name].evidence, durationMs: 1,
          logPath, cleanup: { status: 'passed' }, retainedTaskRoot: null, remainingProcessTree: [],
          ...(workers > 1 ? { executionWorkspace: `worker-${names.indexOf(name) % workers + 1}` } : {}) };
        const spec = { id: `task:${name}`, definition: checkpointDefinition(name, tasks[name], overrides),
          dependencies, artifacts: { ...(overrides.artifacts || {}), 'task-log': logPath }, result };
        let proof;
        if (kind === 'release' && name === names[0]) {
          createCheckpointStore({ directory: previousDirectory, context }).record(spec);
          proof = store.tryReuse(spec);
          assert.equal(proof.reused, true);
        } else proof = store.record(spec);
        return { ...result, execution: proof.reused ? 'reused' : 'executed',
          ...(proof.reused ? { originalResult: result, durationMs: 0, reusedDurationMs: result.durationMs } : {}),
          recoveryReason: proof.reused ? 'verified-checkpoint' : 'missing-checkpoint', checkpoint: {
          proofId: proof.proofId, receiptPath: proof.receiptPath, receiptSha256: proof.receiptSha256, contextHash: fingerprint(context) } };
      });
      return { ...structuredClone(taskReport), requestedTasks: names, selectedTasks: names, completedTasks: names.length, results,
        recovery: { schemaVersion: 'pulse.seal-task-recovery.v1', directory, previousDirectory,
          contextHash: fingerprint(context), dependencies, taskOptions,
          reusedTasks: results.filter(result => result.execution === 'reused').map(result => result.name),
          executedTasks: results.filter(result => result.execution === 'executed').map(result => result.name) } };
    }
    const recoveredTasks = checkpointReport(expectedTasks, 'release');
    const featureTasks = checkpointReport(REQUIRED_TASKS, 'features');
    write(artifacts.taskReport, recoveredTasks);
    write(artifacts.featureTasks, featureTasks);
    const recoveredFeatures = { ...structuredClone(featureAcceptance),
      runnerReportSha256: crypto.createHash('sha256').update(fs.readFileSync(artifacts.featureTasks)).digest('hex') };
    write(artifacts.featureReport, recoveredFeatures);
    recovery.artifactsSha256 = Object.fromEntries(Object.entries(artifacts).filter(([key]) => key !== 'fastlyReality')
      .map(([key, file]) => [key, describeArtifact(file)]));
    const recoveredSeal = { ...structuredClone(releaseSeal), cleanup: { status: 'passed', retainedPath: null },
      featureAcceptance: recoveredFeatures, recovery, steps: [...releaseSeal.steps,
        ...(workers > 1 ? [{ id: 'workspaces', status: 'passed' }] : []),
        { id: 'dependencies', status: 'passed' }, { id: 'production-dependency-audit', status: 'passed' }, { id: 'shared-pack', status: 'passed' }].map(step => ({ ...step, exitCode: 0 })) };
    validateRecoveryEvidence(recoveredSeal, { taskReport: recoveredTasks, fourMode, candidates });
    assert.equal(aggregateValidation({ sourceRevision, releaseSeal: recoveredSeal, taskReport: recoveredTasks, fourMode, candidates, replay }).status, 'passed');
    assert.equal(resolveEvidencePaths({ explicitArtifacts: [] }, recoveredSeal).taskReport, artifacts.taskReport);
    const override = path.join(recoveryDirectory, 'copy-tasks.json');
    fs.copyFileSync(artifacts.taskReport, override);
    assert.equal(resolveEvidencePaths({ taskReport: override, explicitArtifacts: ['taskReport'] }, recoveredSeal).taskReport, override);
    fs.appendFileSync(override, ' ');
    assert.throws(() => resolveEvidencePaths({ taskReport: override, explicitArtifacts: ['taskReport'] }, recoveredSeal), /sealed artifact bytes/);
    for (const mutate of [
      seal => { seal.recovery.context.candidate.repoRoot += '-foreign'; seal.recovery.contextSha256 = fingerprint(seal.recovery.context); },
      seal => { seal.recovery.context.candidate.sourceRevision = 'f'.repeat(40); seal.recovery.contextSha256 = fingerprint(seal.recovery.context); },
      seal => { seal.cleanup.status = 'failed'; },
      seal => { delete seal.recovery.context.schemaVersion; seal.recovery.contextSha256 = fingerprint(seal.recovery.context); },
      seal => { seal.recovery.context.selections.release = ['suite-shape']; seal.recovery.contextSha256 = fingerprint(seal.recovery.context); },
      seal => { seal.recovery.context.selections.features = REQUIRED_TASKS.slice(1); seal.recovery.contextSha256 = fingerprint(seal.recovery.context); },
      seal => { seal.steps.find(step => step.id === 'build').exitCode = 1; },
      seal => { seal.steps.find(step => step.id === 'build').error = 'failed despite status'; },
      seal => { seal.steps.find(step => step.id === 'build').timedOut = true; },
      seal => { seal.steps.find(step => step.id === 'build').interruptedBy = 'SIGTERM'; },
      seal => { seal.steps.find(step => step.id === 'build').execution = 'reused'; },
      seal => { seal.steps = seal.steps.filter(step => step.id !== 'dependencies'); },
      seal => { seal.recovery.sharedPack.proofId = 'foreign-pack'; },
      seal => { delete seal.recovery.artifactsSha256.featureTasks; }
    ]) {
      const invalid = structuredClone(recoveredSeal);
      mutate(invalid);
      assert.throws(() => validateRecoveryEvidence(invalid));
    }
    function rejectTaskMutation(mutate, pattern) {
      const invalid = structuredClone(recoveredTasks);
      mutate(invalid);
      write(artifacts.taskReport, invalid);
      const invalidSeal = structuredClone(recoveredSeal);
      invalidSeal.recovery.artifactsSha256.taskReport = describeArtifact(artifacts.taskReport);
      assert.throws(() => validateRecoveryEvidence(invalidSeal), pattern);
      write(artifacts.taskReport, recoveredTasks);
    }
    rejectTaskMutation(report => { delete report.results[0].checkpoint; }, /checkpoint/);
    rejectTaskMutation(report => { report.results[1].execution = 'reused'; }, /disposition/);
    rejectTaskMutation(report => { report.results[0].checkpoint = report.results[1].checkpoint; }, /definition|another task/);
    rejectTaskMutation(report => { report.results[0].cleanup.status = 'failed'; }, /differs|altered/);
    rejectTaskMutation(report => { report.results[0].executionWorkspace = 'foreign-worker'; }, /worker workspace/);
    rejectTaskMutation(report => { report.recovery.taskOptions['suite-shape'] = { args: ['fake-success'] }; }, /overrides/);
    const originalReceipt = fs.readFileSync(recoveredTasks.results[0].checkpoint.receiptPath);
    const damaged = JSON.parse(originalReceipt);
    damaged.receipt.result.cleanup.status = 'failed';
    damaged.sha256 = fingerprint(damaged.receipt);
    write(recoveredTasks.results[0].checkpoint.receiptPath, damaged);
    assert.throws(() => validateRecoveryEvidence(recoveredSeal), /cleanup/);
    fs.writeFileSync(recoveredTasks.results[0].checkpoint.receiptPath, originalReceipt);
    fs.appendFileSync(artifacts.cleanMachineCorpora, ' ');
    assert.throws(() => validateRecoveryEvidence(recoveredSeal), /artifact changed/);
  }
} finally {
  fs.rmSync(recoveryDirectory, { recursive: true, force: true });
  fs.rmSync(previousRecoveryDirectory, { recursive: true, force: true });
}

const integrity = targetIntegrityReport(sourceRevision, fourMode, candidates);
assert.equal(integrity.status, 'passed');
assert.equal(integrity.availability.definition, 'full-target-support');
assert.equal(integrity.availability.fullTargetSupportReady, true);
assert.equal(integrity.availability.generalAvailable, true);
assert.deepEqual(integrity.boundary, {
  providerReality: 'not-performed',
  deployment: 'not-performed',
  publication: 'not-performed'
});

const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-evidence-authority-'));
try {
  fs.writeFileSync(path.join(snapshotRoot, 'plain.txt'), 'plain\n');
  fs.writeFileSync(path.join(snapshotRoot, 'executable'), '#!/bin/sh\n');
  fs.chmodSync(path.join(snapshotRoot, 'executable'), 0o755);
  const first = treeSnapshot(snapshotRoot);
  const second = treeSnapshot(snapshotRoot);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((entry) => [entry.file, entry.mode]), [
    ['executable', '100755'],
    ['plain.txt', '100644']
  ]);
} finally {
  fs.rmSync(snapshotRoot, { recursive: true, force: true });
}

const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-candidate-authority-'));
const candidateCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-candidate-copy-'));
try {
  const directoryCandidates = candidates.candidates.map((candidate) => {
    const directory = `fastly-${candidate.target}`;
    const root = path.join(candidateRoot, directory);
    const runtimeFile = path.join(root, 'bin', 'main.wasm');
    fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
    fs.writeFileSync(runtimeFile, Buffer.from(`wasm-${candidate.target}`));
    const runtimeArtifact = {
      file: 'bin/main.wasm',
      bytes: fs.statSync(runtimeFile).size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(runtimeFile)).digest('hex')
    };
    fs.writeFileSync(path.join(root, 'pulse-offline-candidate.json'), `${JSON.stringify({
      schemaVersion: 'pulse.offline-deployment-candidate.v1',
      sourceRevision,
      provider: candidate.provider,
      target: candidate.target,
      targetId: candidate.targetId,
      runtimeArtifact,
      providerRealityValidated: false,
      deploymentPerformed: false,
      publicationPerformed: false
    }, null, 2)}\n`);
    return {
      ...candidate,
      directory,
      runtimeArtifact,
      files: treeSnapshot(root).map((entry) => ({
        file: entry.file,
        bytes: entry.bytes,
        sha256: entry.sha256
      }))
    };
  });
  const directoryReport = { ...candidates, candidates: directoryCandidates };
  fs.writeFileSync(
    path.join(candidateRoot, 'candidate-report.json'),
    `${JSON.stringify(directoryReport, null, 2)}\n`
  );
  verifyCandidateDirectory(candidateRoot, directoryReport, sourceRevision);
  fs.cpSync(candidateRoot, candidateCopy, { recursive: true });
  verifyCandidateDirectory(candidateCopy, directoryReport, sourceRevision);
  fs.appendFileSync(path.join(candidateRoot, 'fastly-native', 'bin', 'main.wasm'), 'tamper');
  assert.throws(
    () => verifyCandidateDirectory(candidateRoot, directoryReport, sourceRevision),
    /candidate files do not match their report/
  );
} finally {
  fs.rmSync(candidateRoot, { recursive: true, force: true });
  fs.rmSync(candidateCopy, { recursive: true, force: true });
}

console.log('ok - release evidence authority aggregates sixteen shards and preserves the no-deploy/no-publish boundary');
