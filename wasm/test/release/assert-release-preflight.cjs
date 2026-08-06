'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  AUDIT_SCHEMA,
  PREFLIGHT_FILE,
  INVENTORY_FILE,
  validatePreflight,
  validateConformanceLedger,
  classifyDocumentation,
  assertStageReady,
  releaseManifestSha256,
  validateNpmAuditEvidence
} = require('../../../scripts/release-preflight.cjs');
const {
  parseArgs: parsePreparationArgs,
  isAllowedChangedPath
} = require('../../../scripts/release-prepare.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const preflight = JSON.parse(fs.readFileSync(path.join(repoRoot, PREFLIGHT_FILE), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(repoRoot, INVENTORY_FILE), 'utf8'));
const releaseManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release', 'pulse-release-manifest.json'), 'utf8'));
const rootManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

assert.equal(rootManifest.engines.pnpm, releaseManifest.publication.pnpmDevelopmentRange);
assert.equal(Object.hasOwn(rootManifest, 'packageManager'), false);
assert.equal(releaseManifest.publication.pnpmVersion, '10.0.0');
assert.equal(releaseManifest.readiness.versionPreparation.gitTagging, 'separate-human-action-after-release-seal');
assert.equal(parsePreparationArgs(['1.0.0-beta.2', '--replace-unpublished']).historyMode, 'replace-unpublished');
assert.throws(() => parsePreparationArgs(['1.0.0-beta.2', '--replace-unpublished', '--archive-current']), /choose exactly one/);
assert.equal(isAllowedChangedPath('docs/reference/release-manifest.json', new Set(), releaseManifest.readiness.versionPreparation), true);
assert.equal(isAllowedChangedPath('packages/runtime/src/internal/body.js', new Set(), releaseManifest.readiness.versionPreparation), false);
const preparation = spawnSync(process.execPath, [
  'scripts/release-prepare.cjs',
  '1.0.0-beta.2',
  '--channel', 'beta',
  '--date', '2026-08-02',
  '--replace-unpublished',
  '--dry-run',
  '--no-sync'
], { cwd: repoRoot, encoding: 'utf8' });
assert.equal(preparation.status, 0, preparation.stderr);
const preparationPlan = JSON.parse(preparation.stdout);
assert.equal(preparationPlan.mode, 'replace-unpublished');
assert.equal(preparationPlan.gitTagCreated, false);
assert.equal(preparationPlan.packageCount, releaseManifest.packages.length);
for (const entry of releaseManifest.packages) assert.ok(preparationPlan.files.includes(`${entry.dir}/package.json`));
for (const owner of releaseManifest.readiness.versionPreparation.literalOwners) assert.ok(preparationPlan.files.includes(owner));
assert.equal(preparationPlan.files.some((entry) => entry.startsWith('release/documentation-site-archives/')), false);

const result = validatePreflight({ repoRoot, preflight, inventory });
assert.equal(result.status, 'ok');
assert.deepEqual(result.statuses, { proven: 11, pending: 10, blocked: 0 });
assert.deepEqual(result.vocabulary, {
  schemaVersion: 'pulse.release-vocabulary.v1',
  displayLabel: 'Beta',
  displayName: 'Pulse 1.0.0-beta.1 — Beta',
  npmDistTag: 'beta',
  activationStage: 'documentation-release'
});
assert.equal(result.bootstrap.packageCount, releaseManifest.packages.length);
assert.equal(result.bootstrap.version, '0.0.0');
assert.equal(result.bootstrap.tag, 'bootstrap');
assert.equal(result.bootstrap.releaseTag, 'beta');
assert.equal(result.bootstrap.auditEvidence.output, '.pulse-release-preflight/npm-catalog-audit.json');
assert.equal(result.bootstrap.auditEvidence.requiredBy, 'publication');
assert.deepEqual(result.conformance, {
  schemaVersion: 'pulse.release-conformance-ledger.v1',
  checkpoint: 'sprint-7d-release-blocking-conformance',
  items: 14,
  statuses: {
    closed: 10,
    explicitlyDeferred: 4,
    releaseBlocking: 0,
    unclassified: 0
  }
});
assert.deepEqual(result.snapshot, {
  status: 'applied',
  version: '1.0.0-beta.1',
  channel: 'beta',
  releasedAt: '2026-08-01',
  packages: releaseManifest.packages.length,
  dependencyRanges: 52
});
assert.deepEqual(result.audits.noticeDisposition, {
  schemaVersion: 'pulse.release-notice-disposition.v1',
  status: 'notice-required-and-shipped',
  noticeFile: 'NOTICE',
  noticeSha256: '8af1d352fb8a9d3ba372767b310fa53e28f2424ee052ead7cabbce547186bb6f',
  packageFiles: ['LICENSE', 'NOTICE'],
  components: 3
});
assert.equal(result.documentation.sources, 241);
assert.deepEqual(result.documentation.counts, {
  'current-public': 61,
  'current-contributor': 69,
  generated: 111
});

const sourcePaths = result.documentation.entries.map((entry) => entry.path);
assert.equal(new Set(sourcePaths).size, sourcePaths.length);
assert.equal(sourcePaths.some((source) => source.includes('architecture/decisions/')), false);
assert.equal(sourcePaths.includes('docs/architecture/current-contracts.md'), true);
assert.equal(sourcePaths.includes('wasm/packages/cli/docs/architecture/current-contracts.md'), true);

assert.equal(assertStageReady(preflight, 'documentation-release').status, 'ready');
assert.throws(
  () => assertStageReady(preflight, 'release-seal'),
  (error) => error.code === 'PULSE_RELEASE_PREFLIGHT_BLOCKED'
    && error.details.some((entry) => entry.id === 'dependency-closure')
    && error.details.some((entry) => entry.id === 'fastly-cli')
    && error.details.some((entry) => entry.id === 'vulnerability-evidence')
    && error.details.some((entry) => entry.id === 'dependency-license-evidence')
    && !error.details.some((entry) => entry.id === 'npm-trusted-publishers')
);

const npmNameGate = preflight.gates.find((gate) => gate.id === 'npm-package-names');
assert.equal(npmNameGate.status, 'pending');
assert.equal(npmNameGate.requiredBy, 'publication');
assert.equal(Object.hasOwn(npmNameGate, 'observedAt'), false);
assert.equal(Object.hasOwn(npmNameGate, 'observedMissing'), false);
const auditEvidence = {
  schemaVersion: AUDIT_SCHEMA,
  status: 'ready',
  checkedAt: '2026-08-01T11:00:00.000Z',
  releaseVersion: releaseManifest.releaseVersion,
  releaseManifestSha256: releaseManifestSha256(repoRoot),
  registry: releaseManifest.publication.registry,
  packages: releaseManifest.packages.map((entry) => ({
    name: entry.name,
    state: 'exists',
    statusCode: 200,
    versionCount: 1,
    bootstrap: { version: '0.0.0', versionPresent: true, tagTarget: '0.0.0' },
    release: { version: releaseManifest.releaseVersion, versionPresent: false, distTag: releaseManifest.publication.distTag, tagTarget: null },
    latestTagTarget: '0.0.0'
  })),
  summary: {
    total: releaseManifest.packages.length,
    existing: releaseManifest.packages.length,
    missing: 0,
    indeterminate: 0,
    bootstrapCompliant: releaseManifest.packages.length,
    tagRemediation: 0
  }
};
const validatedAudit = validateNpmAuditEvidence(auditEvidence, { repoRoot, now: '2026-08-01T12:00:00.000Z', maxAgeHours: 24 });
assert.equal(validatedAudit.status, 'ready');
assert.equal(validatedAudit.summary.existing, releaseManifest.packages.length);
const absentLatestAudit = structuredClone(auditEvidence);
for (const entry of absentLatestAudit.packages) entry.latestTagTarget = null;
assert.equal(
  validateNpmAuditEvidence(absentLatestAudit, { repoRoot, now: '2026-08-01T12:00:00.000Z', maxAgeHours: 24 }).status,
  'ready'
);
const unsafeLatestAudit = structuredClone(auditEvidence);
unsafeLatestAudit.status = 'remediation-required';
unsafeLatestAudit.packages[0].latestTagTarget = releaseManifest.releaseVersion;
unsafeLatestAudit.summary.bootstrapCompliant -= 1;
unsafeLatestAudit.summary.tagRemediation += 1;
assert.equal(
  validateNpmAuditEvidence(unsafeLatestAudit, { repoRoot, now: '2026-08-01T12:00:00.000Z', maxAgeHours: 24 }).status,
  'remediation-required'
);
assert.throws(
  () => validateNpmAuditEvidence({ ...auditEvidence, releaseManifestSha256: '0'.repeat(64) }, { repoRoot, now: '2026-08-01T12:00:00.000Z' }),
  /not bound to the current release manifest/
);
const sealProofGates = new Set([
  'dependency-closure',
  'fastly-cli',
  'vulnerability-evidence',
  'dependency-license-evidence'
]);
assert.equal(assertStageReady(preflight, 'release-seal', { provenGates: sealProofGates }).status, 'ready');
assert.equal(validatePreflight({ repoRoot, preflight, inventory, stage: 'release-seal', provenGates: sealProofGates }).stage.status, 'ready');
assert.throws(
  () => assertStageReady(preflight, 'publication', { provenGates: sealProofGates }),
  (error) => error.code === 'PULSE_RELEASE_PREFLIGHT_BLOCKED'
    && error.details.some((entry) => entry.id === 'npm-trusted-publishers')
    && error.details.some((entry) => entry.id === 'public-repository')
    && !error.details.some((entry) => entry.id === 'documentation-origin')
);

const unauthorized = structuredClone(preflight);
unauthorized.authorization.npmPublication = true;
assert.throws(
  () => validatePreflight({ repoRoot, preflight: unauthorized, inventory }),
  /authorize no external mutation/
);

const vocabularyDrift = structuredClone(preflight);
vocabularyDrift.releaseVocabulary.displayLabel = 'Preview';
assert.throws(
  () => validatePreflight({ repoRoot, preflight: vocabularyDrift, inventory }),
  /candidate display contract/
);

const noticeDrift = structuredClone(preflight);
noticeDrift.auditPolicy.dependencyLicenses.noticeDisposition.noticeSha256 = '0'.repeat(64);
assert.throws(
  () => validatePreflight({ repoRoot, preflight: noticeDrift, inventory }),
  /release legal contract/
);

const chronologyInventory = structuredClone(inventory);
chronologyInventory.classifications.push('historical');
assert.throws(
  () => classifyDocumentation(chronologyInventory, repoRoot),
  /documentation inventory classifications must be current-public, current-contributor, generated/
);

const unclassifiedInventory = structuredClone(inventory);
unclassifiedInventory.rules = unclassifiedInventory.rules.filter((rule) => rule.id !== 'current-contributor-wasm');
assert.throws(
  () => classifyDocumentation(unclassifiedInventory, repoRoot),
  /documentation source is unclassified/
);

const reopenedConformance = structuredClone(preflight);
const reopenedItem = reopenedConformance.conformanceLedger.items[0];
reopenedItem.status = 'release-blocking';
delete reopenedItem.evidence;
delete reopenedItem.verification;
reopenedItem.nextAction = 'Repair the supported handler cross-target semantics before the snapshot transaction.';
reopenedConformance.conformanceLedger.summary.closed -= 1;
reopenedConformance.conformanceLedger.summary.releaseBlocking += 1;
const conformanceGate = reopenedConformance.gates.find((gate) => gate.id === 'release-conformance');
conformanceGate.status = 'blocked';
delete conformanceGate.evidence;
conformanceGate.nextAction = 'Close every release-blocking Sprint 7D conformance item.';
const reopenedResult = validatePreflight({ repoRoot, preflight: reopenedConformance, inventory });
assert.equal(reopenedResult.conformance.statuses.releaseBlocking, 1);
assert.throws(
  () => assertStageReady(reopenedConformance, 'documentation-release'),
  (error) => error.code === 'PULSE_RELEASE_PREFLIGHT_BLOCKED'
    && error.details.some((entry) => entry.id === 'release-conformance' && entry.status === 'blocked')
);

const unclassifiedConformance = structuredClone(preflight);
unclassifiedConformance.conformanceLedger.items.pop();
assert.throws(
  () => validateConformanceLedger(unclassifiedConformance),
  /item set or order changed unexpectedly/
);

const unsnapshotted = structuredClone(preflight);
unsnapshotted.releaseCandidate.currentSnapshotChannel = 'alpha';
unsnapshotted.releaseCandidate.snapshotStatus = 'pending';
assert.throws(
  () => validatePreflight({ repoRoot, preflight: unsnapshotted, inventory }),
  /applied Beta snapshot/
);

const reopenedSnapshot = structuredClone(preflight);
const snapshotGate = reopenedSnapshot.gates.find((gate) => gate.id === 'release-snapshot');
snapshotGate.status = 'pending';
delete snapshotGate.evidence;
snapshotGate.nextAction = 'Reapply and validate the atomic Beta snapshot transaction.';
assert.throws(
  () => validatePreflight({ repoRoot, preflight: reopenedSnapshot, inventory }),
  /release-snapshot gate must be proven/
);

console.log('ok - release vocabulary, Apache-2.0 and NOTICE disposition, 7D conformance closure, applied 7E snapshot, stage blockers, npm bootstrap, current-only documentation inventory, and external-mutation hold are enforced');
