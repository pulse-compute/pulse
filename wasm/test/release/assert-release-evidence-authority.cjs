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
  aggregateValidation,
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
const taskReport = {
  sourceRevision,
  status: 'passed',
  requestedTasks: expectedTasks,
  selectedTasks: expectedTasks,
  completedTasks: expectedTasks.length,
  results: expectedTasks.map((name) => ({
    name,
    status: 'passed',
    evidence: 'release',
    durationMs: 1
  }))
};
const releaseSeal = {
  sourceRevision,
  status: 'passed',
  steps: [
    'maintainer',
    'publication',
    'build',
    'workspace-unit',
    'documentation',
    'release'
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
assert.deepEqual(
  aggregate.shards
    .find((entry) => entry.id === 'maintainer-publication-controls')
    .tasks
    .map((entry) => entry.name),
  ['release-runtime-policy']
);
assert.deepEqual(aggregate.summary, {
  shards: 16,
  passed: 16,
  failed: 0,
  releaseTasks: expectedTasks.length,
  releaseTasksPassed: expectedTasks.length,
  providerReality: 'unavailable',
  deploymentPerformed: false,
  publicationPerformed: false
});

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
  fs.appendFileSync(path.join(candidateRoot, 'fastly-native', 'bin', 'main.wasm'), 'tamper');
  assert.throws(
    () => verifyCandidateDirectory(candidateRoot, directoryReport, sourceRevision),
    /candidate files do not match their report/
  );
} finally {
  fs.rmSync(candidateRoot, { recursive: true, force: true });
}

console.log('ok - release evidence authority aggregates sixteen shards and preserves the no-deploy/no-publish boundary');
