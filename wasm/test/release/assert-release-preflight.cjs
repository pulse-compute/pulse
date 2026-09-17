'use strict';

require('./assert-release-pr-check.cjs');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');
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
  planRelease,
  assertManifestConsistency,
  isAllowedChangedPath
} = require('../../../scripts/release-prepare.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
// Loading the shard/profile plan must not resolve installed test executables.
const registryFile = path.join(repoRoot, 'wasm/test/suite/registry.cjs');
let executableResolutions = 0;
const withoutDependencies = (id) => require(id);
withoutDependencies.resolve = (id) => {
  executableResolutions += 1;
  throw Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' });
};
const registryModule = { exports: {} };
runInNewContext(fs.readFileSync(registryFile, 'utf8'), {
  require: withoutDependencies, module: registryModule, process, __dirname: path.dirname(registryFile)
}, { filename: registryFile });
assert.ok(registryModule.exports.expandProfile('release').includes('crypto-runtime-builtin'));
assert.equal(executableResolutions, 0, 'profile discovery must work before dependency installation');
assert.throws(() => registryModule.exports.tasks['crypto-runtime-builtin'].args,
  (error) => error.code === 'MODULE_NOT_FOUND' && /vitest/.test(error.message));
assert.equal(executableResolutions, 1, 'executing a Vitest task must still require Vitest');
const dependencyFreePreflight = spawnSync(process.execPath, ['-e', `
  const Module = require('node:module');
  const path = require('node:path');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...args) {
    if (!request.startsWith('.') && !path.isAbsolute(request) && !Module.isBuiltin(request)) {
      throw new Error('Preflight attempted an installed dependency: ' + request);
    }
    return resolve.call(this, request, ...args);
  };
  require('./scripts/release-preflight.cjs').validatePreflight();
`], { cwd: repoRoot, encoding: 'utf8', timeout: 30000 });
assert.equal(dependencyFreePreflight.status, 0, dependencyFreePreflight.stderr);


const preflight = JSON.parse(fs.readFileSync(path.join(repoRoot, PREFLIGHT_FILE), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(repoRoot, INVENTORY_FILE), 'utf8'));
const releaseManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release', 'pulse-release-manifest.json'), 'utf8'));
const rootManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const documentationVersions = require('../../../release/documentation-versions.json');
const archivePlan = planRelease(
  releaseManifest,
  documentationVersions,
  parsePreparationArgs(['9.9.9-beta.1', '--archive-current', '--date', '2026-09-14']),
  assertManifestConsistency(releaseManifest, documentationVersions)
);
const previewManifest = structuredClone(releaseManifest);
previewManifest.publication.distTag = 'beta';
assert.equal(planRelease(previewManifest, documentationVersions,
  parsePreparationArgs(['9.9.9-beta.1', '--archive-current', '--date', '2026-09-14']),
  assertManifestConsistency(previewManifest, documentationVersions)).nextRelease.publication.distTag, 'beta');
previewManifest.publication.distTag = 'unreviewed-tag';
assert.throws(() => assertManifestConsistency(previewManifest, documentationVersions), /explicitly configured latest/);
const archivedCurrent = archivePlan.nextDocumentationVersions.versions.find((entry) => entry.version === releaseManifest.releaseVersion);
assert.equal(archivedCurrent.status, 'archived');
assert.equal(archivedCurrent.sourceManifest, `release/documentation-site-archives/v${releaseManifest.releaseVersion}/release-manifest.json`);
assert.equal(archivePlan.nextDocumentationVersions.versions[0].sourceManifest, 'release/pulse-release-manifest.json');
assert.equal(archivePlan.nextRelease.channel, 'beta');
assert.equal(archivePlan.nextRelease.publication.distTag, 'latest');
const nextPreflight = JSON.parse(archivePlan.writes.get(path.join(repoRoot, PREFLIGHT_FILE)));
assert.equal(nextPreflight.releaseCandidate.publicationTag, 'latest');
assert.equal(nextPreflight.releaseCandidate.latestTagAllowed, true);
assert.equal(nextPreflight.releaseVocabulary.npmDistTag, 'latest');
assert.equal(nextPreflight.npmBootstrap.releaseTag, 'latest');
for (const entry of documentationVersions.versions.filter((entry) => entry.status === 'archived')) {
  assert.deepEqual(archivePlan.nextDocumentationVersions.versions.find((candidate) => candidate.version === entry.version), entry);
}
const guestFile = path.join(repoRoot, 'packages/crypto/guests/es256-rustcrypto/pulse.guest-unit.json');
const currentGuest = JSON.parse(fs.readFileSync(guestFile, 'utf8'));
const nextGuest = JSON.parse(archivePlan.writes.get(guestFile));
const guestBuildFile = path.resolve(path.dirname(guestFile), currentGuest.provenance.buildScript);
assert.equal(nextGuest.packageVersion, '9.9.9-beta.1');
assert.equal(nextGuest.provenance.buildScriptSha256,
  createHash('sha256').update(archivePlan.writes.get(guestBuildFile)).digest('hex'));
assert.notEqual(nextGuest.provenance.buildScriptSha256, currentGuest.provenance.buildScriptSha256);
assert.deepEqual(nextGuest.artifact, currentGuest.artifact);
assert.deepEqual(nextGuest.source, currentGuest.source);
const guestContractFile = path.join(repoRoot, 'wasm/packages/wasm-guest-link/src/constants.js');
const plannedContract = { exports: {} };
runInNewContext(archivePlan.writes.get(guestContractFile), { module: plannedContract });
assert.equal(plannedContract.exports.es256GuestUnit.provenance.buildScriptSha256, nextGuest.provenance.buildScriptSha256);
assert.equal(plannedContract.exports.es256GuestUnit.packageVersion, nextGuest.packageVersion);
assert.equal(plannedContract.exports.es256GuestUnit.artifact.sha256, currentGuest.artifact.sha256);
assert.equal(plannedContract.exports.es256GuestUnit.source.treeSha256, currentGuest.source.treeSha256);

assert.equal(rootManifest.engines.pnpm, releaseManifest.publication.pnpmDevelopmentRange);
assert.equal(Object.hasOwn(rootManifest, 'packageManager'), false);
assert.equal(releaseManifest.publication.pnpmVersion, '10.0.0');
assert.equal(releaseManifest.readiness.versionPreparation.gitTagging, 'separate-human-action-before-publication-seal');
assert.equal(parsePreparationArgs(['9.9.9-beta.1', '--replace-unpublished']).historyMode, 'replace-unpublished');
assert.throws(() => parsePreparationArgs(['9.9.9-beta.1', '--replace-unpublished', '--archive-current']), /choose exactly one/);
assert.equal(isAllowedChangedPath('docs/reference/release-manifest.json', new Set(), releaseManifest.readiness.versionPreparation), true);
assert.equal(isAllowedChangedPath('packages/runtime/src/internal/body.js', new Set(), releaseManifest.readiness.versionPreparation), false);
const preparation = spawnSync(process.execPath, [
  'scripts/release-prepare.cjs',
  '9.9.9-beta.1',
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
  displayName: `Pulse ${releaseManifest.releaseVersion} — Beta`,
  npmDistTag: 'latest',
  activationStage: 'documentation-release'
});
assert.equal(result.bootstrap.packageCount, releaseManifest.packages.length);
assert.equal(result.bootstrap.version, '0.0.0');
assert.equal(result.bootstrap.tag, 'bootstrap');
assert.equal(result.bootstrap.releaseTag, 'latest');
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
  version: releaseManifest.releaseVersion,
  channel: 'beta',
  releasedAt: releaseManifest.releasedAt,
  packages: releaseManifest.packages.length,
  dependencyRanges: 58
});
assert.deepEqual(result.audits.noticeDisposition, {
  schemaVersion: 'pulse.release-notice-disposition.v1',
  status: 'notice-required-and-shipped',
  noticeFile: 'NOTICE',
  noticeSha256: '8af1d352fb8a9d3ba372767b310fa53e28f2424ee052ead7cabbce547186bb6f',
  packageFiles: ['LICENSE', 'NOTICE'],
  components: 3
});
assert.equal(result.documentation.sources, 249);
assert.deepEqual(result.documentation.counts, {
  'current-public': 62,
  'current-contributor': 75,
  generated: 112
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
    release: { version: releaseManifest.releaseVersion, versionPresent: false, distTag: releaseManifest.publication.distTag, tagTarget: '0.0.0' },
    latestTagTarget: '0.0.0',
    latestTagVersionPresent: true
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
for (const entry of absentLatestAudit.packages) {
  entry.latestTagTarget = null;
  entry.latestTagVersionPresent = false;
  entry.release.tagTarget = null;
}
assert.equal(
  validateNpmAuditEvidence(absentLatestAudit, { repoRoot, now: '2026-08-01T12:00:00.000Z', maxAgeHours: 24 }).status,
  'ready'
);
const unsafeLatestAudit = structuredClone(auditEvidence);
unsafeLatestAudit.status = 'remediation-required';
unsafeLatestAudit.packages[0].latestTagTarget = releaseManifest.releaseVersion;
unsafeLatestAudit.packages[0].latestTagVersionPresent = false;
unsafeLatestAudit.packages[0].release.tagTarget = releaseManifest.releaseVersion;
unsafeLatestAudit.summary.bootstrapCompliant -= 1;
unsafeLatestAudit.summary.tagRemediation += 1;
assert.equal(
  validateNpmAuditEvidence(unsafeLatestAudit, { repoRoot, now: '2026-08-01T12:00:00.000Z', maxAgeHours: 24 }).status,
  'remediation-required'
);
const releasedLatestAudit = structuredClone(auditEvidence);
releasedLatestAudit.packages[0].latestTagTarget = documentationVersions.versions.find((entry) => entry.status === 'archived').version;
releasedLatestAudit.packages[0].release.tagTarget = releasedLatestAudit.packages[0].latestTagTarget;
assert.equal(validateNpmAuditEvidence(releasedLatestAudit, { repoRoot, now: '2026-08-01T12:00:00.000Z' }).status, 'ready');
releasedLatestAudit.packages[0].latestTagTarget = releaseManifest.releaseVersion;
releasedLatestAudit.packages[0].release.versionPresent = true;
releasedLatestAudit.packages[0].release.tagTarget = releaseManifest.releaseVersion;
assert.equal(validateNpmAuditEvidence(releasedLatestAudit, { repoRoot, now: '2026-08-01T12:00:00.000Z' }).status, 'ready');
const unknownLatestAudit = structuredClone(unsafeLatestAudit);
unknownLatestAudit.packages[0].latestTagTarget = '999.0.0';
unknownLatestAudit.packages[0].latestTagVersionPresent = true;
unknownLatestAudit.packages[0].release.tagTarget = '999.0.0';
assert.equal(validateNpmAuditEvidence(unknownLatestAudit, { repoRoot, now: '2026-08-01T12:00:00.000Z' }).status, 'remediation-required');
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
