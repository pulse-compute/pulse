#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  FOUR_MODE_PROOF_VERSION,
  INTENTIONAL_DIFFERENCES,
  buildFourModeProof
} = require('../support/four-mode-conformance.cjs');
const {
  cleanupWorkspacePackageBuilds
} = require('../support/workspace-package-build.cjs');
const { resolveSourceIdentity } = require('../../../scripts/source-identity.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function writeEvidence(proof) {
  const sourceIdentity = resolveSourceIdentity(repoRoot);
  const target = path.resolve(
    process.env.PULSE_FOUR_MODE_EVIDENCE ||
    path.join(repoRoot, 'wasm', '.test-results', 'four-mode-conformance.json')
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify({
    schemaVersion: 'pulse.four-mode-conformance-report.v1',
    sourceRevision: sourceIdentity.sourceRevision,
    sourceIdentity,
    status: 'passed',
    proof
  }, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

(async () => {
  const proof = await buildFourModeProof();
  assert.equal(proof.version, FOUR_MODE_PROOF_VERSION);
  assert.deepEqual(proof.summary, {
    cases: 6,
    modes: 4,
    executions: 24,
    comparisons: 18,
    mismatches: 0,
    fastlyTargetExecutions: 6
  });
  assert.deepEqual(proof.intentionalDifferences, INTENTIONAL_DIFFERENCES);
  assert.deepEqual(proof.negativeControls, { total: 5, rejected: 5 });
  assert.equal(proof.targetIntegrity.automaticFallback, false);
  assert.equal(proof.targetIntegrity.configuredTargetMatchesArtifact, true);
  assert.equal(proof.targetIntegrity.inspectMatchesExecution, true);
  assert.equal(proof.targetIntegrity.javascriptContainsNativeArtifact, false);
  assert.equal(proof.targetIntegrity.nativeMasqueradesAsJavascript, false);
  assert.equal(proof.targetIntegrity.unavailableBehaviorFailsBeforeDeployment, true);
  assert.equal(proof.targetIntegrity.supportedClaimsWithEvidence, 4);
  assert.equal(proof.targetIntegrity.providerReality, false);
  assert.equal(proof.targetIntegrity.providerRealityOwner, 'external-fastly-validation');
  assert.equal(proof.builds.length, 4);
  assert.equal(proof.cases.every((entry) => entry.matched), true);
  assert.match(proof.proofSha256, /^[a-f0-9]{64}$/);
  writeEvidence(proof);
  console.log('ok - four-mode semantic traces and target artifacts satisfy the Sprint 6D conformance gate');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(cleanupWorkspacePackageBuilds);
