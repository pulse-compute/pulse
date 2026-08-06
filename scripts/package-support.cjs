'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RELEASE_MANIFEST_FILE = path.resolve(__dirname, '..', 'release', 'pulse-release-manifest.json');

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_RELEASE_MANIFEST_INVALID';
  throw error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function nonEmpty(value, name) {
  if (typeof value !== 'string' || !value.trim()) fail(`release manifest ${name} must be a non-empty string`);
  return value;
}

function nonEmptyStringArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) fail(`release manifest ${name} must be a non-empty string array`);
  if (value.some((entry) => typeof entry !== 'string' || !entry.trim())) fail(`release manifest ${name} contains an invalid string`);
  if (new Set(value).size !== value.length) fail(`release manifest ${name} contains duplicates`);
  return value;
}

function parseExactVersion(value, name) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) fail(`release manifest ${name} must be an exact semantic version`);
  return value.split('.').map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function versionSatisfiesCaretRange(version, range) {
  if (typeof version !== 'string' || typeof range !== 'string') return false;
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const rangeMatch = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!versionMatch || !rangeMatch) return false;
  const actual = versionMatch.slice(1).map((part) => Number.parseInt(part, 10));
  const minimum = rangeMatch.slice(1).map((part) => Number.parseInt(part, 10));
  return actual[0] === minimum[0] && compareVersions(actual, minimum) >= 0;
}

function loadReleaseManifest(file = RELEASE_MANIFEST_FILE) {
  if (!fs.existsSync(file)) fail(`release manifest is missing: ${file}`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`release manifest is not valid JSON: ${error.message}`); }

  if (raw.schemaVersion !== 'pulse.release-catalog.v1') fail(`unsupported release manifest schema ${raw.schemaVersion}`);
  nonEmpty(raw.releaseVersion, 'releaseVersion');
  nonEmpty(raw.channel, 'channel');
  nonEmpty(raw.releasedAt, 'releasedAt');
  nonEmpty(raw.license, 'license');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.releasedAt)) fail('release manifest releasedAt must use YYYY-MM-DD');
  if (raw.license !== 'Apache-2.0') fail('release manifest license must be Apache-2.0');

  const display = raw.display;
  if (!display || typeof display !== 'object' || Array.isArray(display)) fail('release manifest display is required');
  for (const field of ['productName', 'candidateLabel', 'candidateName', 'activationStage']) nonEmpty(display[field], `display.${field}`);
  if (display.productName !== 'Pulse' || display.candidateLabel !== 'Beta') {
    fail('release manifest display must identify the Pulse Beta candidate');
  }
  if (display.candidateName !== `${display.productName} ${raw.releaseVersion} — ${display.candidateLabel}`) {
    fail('release manifest display.candidateName must derive from productName, releaseVersion, and candidateLabel');
  }
  if (display.activationStage !== 'documentation-release') fail('release manifest display activation must remain atomic with documentation-release');

  const legal = raw.legal;
  if (!legal || typeof legal !== 'object' || Array.isArray(legal)) fail('release manifest legal contract is required');
  for (const field of ['licenseFile', 'noticeFile', 'noticeSha256', 'packagePolicy']) nonEmpty(legal[field], `legal.${field}`);
  if (legal.licenseFile !== 'LICENSE' || legal.noticeFile !== 'NOTICE') fail('release manifest legal files must be LICENSE and NOTICE');
  if (!/^[a-f0-9]{64}$/.test(legal.noticeSha256)) fail('release manifest legal.noticeSha256 must be a lowercase SHA-256');
  if (JSON.stringify(legal.packageFiles) !== JSON.stringify(['LICENSE', 'NOTICE'])) fail('release manifest legal.packageFiles must be LICENSE then NOTICE');
  if (legal.packagePolicy !== 'exact-root-files-in-every-publishable-tarball') fail('release manifest legal package policy changed unexpectedly');

  const repository = raw.repository;
  if (!repository || typeof repository !== 'object') fail('release manifest repository is required');
  for (const field of ['type', 'url', 'web', 'bugs']) nonEmpty(repository[field], `repository.${field}`);

  const documentation = raw.documentation;
  if (!documentation || typeof documentation !== 'object') fail('release manifest documentation is required');
  for (const field of ['origin', 'basePath', 'version', 'latestAlias', 'source']) nonEmpty(documentation[field], `documentation.${field}`);
  if (!documentation.origin.startsWith('https://')) fail('release manifest documentation.origin must be HTTPS');
  if (!documentation.basePath.startsWith('/')) fail('release manifest documentation.basePath must begin with /');
  if (documentation.version !== `v${raw.releaseVersion}`) fail('release manifest documentation.version must match releaseVersion');

  const readiness = raw.readiness;
  if (!readiness || typeof readiness !== 'object' || Array.isArray(readiness)) fail('release manifest readiness is required');
  for (const field of ['preflight', 'documentationInventory', 'vocabulary', 'legalDisposition', 'validationCommand']) nonEmpty(readiness[field], `readiness.${field}`);
  if (readiness.preflight !== 'release/release-preflight.json') fail('release manifest readiness.preflight must name the canonical release preflight register');
  if (readiness.documentationInventory !== 'release/documentation-inventory.json') fail('release manifest readiness.documentationInventory must name the canonical documentation inventory');
  if (readiness.vocabulary !== 'release/release-preflight.json#releaseVocabulary') fail('release manifest readiness.vocabulary must name the canonical release vocabulary');
  if (readiness.legalDisposition !== 'release/release-preflight.json#auditPolicy.dependencyLicenses.noticeDisposition') fail('release manifest readiness.legalDisposition must name the canonical legal disposition');
  if (readiness.validationCommand !== 'npm run release:preflight') fail('release manifest readiness.validationCommand must use the checked release preflight command');
  const versionPreparation = readiness.versionPreparation;
  if (!versionPreparation || typeof versionPreparation !== 'object' || Array.isArray(versionPreparation)) fail('release manifest readiness.versionPreparation is required');
  if (versionPreparation.schemaVersion !== 'pulse.release-version-preparation.v1') fail(`unsupported release version preparation schema ${versionPreparation.schemaVersion}`);
  for (const field of ['metadataOwners', 'literalOwners', 'dependencyManifestRoots', 'replaceUnpublishedDocumentationClasses', 'generatedPathPrefixes', 'generatedExactPaths']) {
    nonEmptyStringArray(versionPreparation[field], `readiness.versionPreparation.${field}`);
  }
  if (versionPreparation.gitTagging !== 'separate-human-action-after-release-seal') {
    fail('release manifest version preparation must keep Git tagging separate and human-controlled');
  }

  const publication = raw.publication;
  if (!publication || typeof publication !== 'object' || Array.isArray(publication)) fail('release manifest publication is required');
  for (const field of ['registry', 'distTag', 'access', 'authentication', 'provenance', 'workflowFile', 'environment', 'candidateArtifact', 'nodeEngines', 'nodeMinimumVersion', 'nodeReleaseRange', 'nodeVersion', 'npmVersion', 'pnpmDevelopmentRange', 'pnpmVersion', 'canonicalSmokePackage', 'canonicalSmokeBinary']) {
    nonEmpty(publication[field], `publication.${field}`);
  }
  let registry;
  try { registry = new URL(publication.registry); }
  catch (error) { fail(`release manifest publication.registry is invalid: ${error.message}`); }
  if (registry.protocol !== 'https:') fail('release manifest publication.registry must use HTTPS');
  if (publication.distTag !== raw.channel) fail('release manifest publication.distTag must match channel');
  if (publication.authentication !== 'npm-trusted-publishing-oidc') fail('release manifest publication.authentication must be npm-trusted-publishing-oidc');
  if (publication.provenance !== 'automatic') fail('release manifest publication.provenance must be automatic');
  if (!/^[A-Za-z0-9_.-]+\.ya?ml$/.test(publication.workflowFile)) fail('release manifest publication.workflowFile must be a workflow filename');
  if (!/^[A-Za-z0-9_.-]+$/.test(publication.environment)) fail('release manifest publication.environment must be a GitHub environment name');
  if (!/^[A-Za-z0-9_.-]+$/.test(publication.candidateArtifact)) fail('release manifest publication.candidateArtifact must be a safe Actions artifact prefix');
  if (publication.access !== 'public') fail('release manifest publication.access must be public');
  if (typeof publication.requireExistingPackageNames !== 'boolean') fail('release manifest publication.requireExistingPackageNames must be boolean');
  const minimumNode = parseExactVersion(publication.nodeMinimumVersion, 'publication.nodeMinimumVersion');
  const releaseNode = parseExactVersion(publication.nodeVersion, 'publication.nodeVersion');
  const releaseRangeMatch = /^\^(\d+)\.0\.0$/.exec(publication.nodeReleaseRange);
  const npmVersion = parseExactVersion(publication.npmVersion, 'publication.npmVersion');
  const pnpmVersion = parseExactVersion(publication.pnpmVersion, 'publication.pnpmVersion');
  if (minimumNode[0] < 22) fail('release manifest publication.nodeMinimumVersion must be Node 22 or newer');
  if (compareVersions(releaseNode, minimumNode) < 0) fail('release manifest publication.nodeVersion must not be older than nodeMinimumVersion');
  const enginesMatch = /^\^(\d+\.\d+\.\d+) \|\| \^(\d+)\.0\.0$/.exec(publication.nodeEngines);
  if (!enginesMatch) fail('release manifest publication.nodeEngines must declare exact minimum and release-major LTS ranges');
  if (enginesMatch[1] !== publication.nodeMinimumVersion) fail('release manifest publication.nodeEngines must begin at nodeMinimumVersion');
  if (Number.parseInt(enginesMatch[2], 10) !== releaseNode[0]) fail('release manifest publication.nodeEngines must include the release Node major');
  if (minimumNode[0] === releaseNode[0]) fail('release manifest publication.nodeEngines must cover distinct minimum and release LTS majors');
  if (!releaseRangeMatch || Number.parseInt(releaseRangeMatch[1], 10) !== releaseNode[0]) {
    fail('release manifest publication.nodeReleaseRange must cover the release toolchain Node major');
  }
  if (!versionSatisfiesCaretRange(publication.nodeVersion, publication.nodeReleaseRange)) {
    fail('release manifest publication.nodeVersion must satisfy nodeReleaseRange');
  }
  if (npmVersion[0] < 11) fail('release manifest publication.npmVersion must be npm 11 or newer');
  if (publication.pnpmDevelopmentRange !== '>=10 <11') fail('release manifest publication.pnpmDevelopmentRange must support pnpm 10.x development');
  if (pnpmVersion[0] !== 10) fail('release manifest publication.pnpmVersion must select an exact pnpm 10.x release toolchain');

  if (!Array.isArray(raw.runtimeTargets) || raw.runtimeTargets.length === 0) fail('release manifest runtimeTargets must be a non-empty array');
  const targetIds = new Set();
  for (const [index, target] of raw.runtimeTargets.entries()) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) fail(`release manifest runtime target ${index} must be an object`);
    for (const field of ['id', 'label', 'mode', 'summary']) nonEmpty(target[field], `runtimeTargets[${index}].${field}`);
    if (targetIds.has(target.id)) fail(`release manifest contains duplicate runtime target ${target.id}`);
    targetIds.add(target.id);
  }
  for (const required of ['node', 'fastly', 'none']) if (!targetIds.has(required)) fail(`release manifest is missing runtime target ${required}`);

  const supportTiers = raw.supportTiers;
  if (!supportTiers || typeof supportTiers !== 'object' || Array.isArray(supportTiers)) fail('release manifest supportTiers is required');
  for (const [id, tier] of Object.entries(supportTiers)) {
    nonEmpty(id, 'support tier id');
    if (!tier || typeof tier !== 'object') fail(`support tier ${id} must be an object`);
    nonEmpty(tier.label, `supportTiers.${id}.label`);
    nonEmpty(tier.promise, `supportTiers.${id}.promise`);
  }

  if (!Array.isArray(raw.packages) || raw.packages.length === 0) fail('release manifest packages must be a non-empty array');
  const names = new Set();
  const directories = new Set();
  for (const [index, entry] of raw.packages.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`release manifest package ${index} must be an object`);
    for (const field of ['dir', 'name', 'version', 'documentation', 'role', 'tier', 'audience', 'directInstall', 'stability']) {
      nonEmpty(entry[field], `packages[${index}].${field}`);
    }
    if (entry.version !== raw.releaseVersion) fail(`${entry.name} version ${entry.version} does not match release ${raw.releaseVersion}`);
    if (!supportTiers[entry.tier]) fail(`${entry.name} uses unknown support tier ${entry.tier}`);
    if (!Array.isArray(entry.entryPoints) || entry.entryPoints.length === 0 || entry.entryPoints.some((value) => typeof value !== 'string' || !value.trim())) {
      fail(`${entry.name} must declare at least one supported entry point or an explicit none marker`);
    }
    if (names.has(entry.name)) fail(`release manifest contains duplicate package ${entry.name}`);
    if (directories.has(entry.dir)) fail(`release manifest contains duplicate package directory ${entry.dir}`);
    names.add(entry.name);
    directories.add(entry.dir);
  }

  const smokePackage = raw.packages.find((entry) => entry.name === publication.canonicalSmokePackage);
  if (!smokePackage) fail(`publication canonicalSmokePackage ${publication.canonicalSmokePackage} is not in the release package set`);
  if (smokePackage.role !== 'public-cli') fail('publication canonicalSmokePackage must be the public CLI package');
  if (!smokePackage.entryPoints.includes(`${publication.canonicalSmokeBinary} binary`)) {
    fail(`publication canonicalSmokeBinary ${publication.canonicalSmokeBinary} is not declared by ${smokePackage.name}`);
  }

  return deepFreeze(raw);
}

const RELEASE_MANIFEST = loadReleaseManifest();
const RELEASE_VERSION = RELEASE_MANIFEST.releaseVersion;
const LICENSE = RELEASE_MANIFEST.license;
const DISPLAY = RELEASE_MANIFEST.display;
const LEGAL = RELEASE_MANIFEST.legal;
const REPOSITORY = RELEASE_MANIFEST.repository;
const DOCUMENTATION = RELEASE_MANIFEST.documentation;
const READINESS = RELEASE_MANIFEST.readiness;
const PUBLICATION = RELEASE_MANIFEST.publication;
const RUNTIME_TARGETS = RELEASE_MANIFEST.runtimeTargets;
const SUPPORT_TIERS = RELEASE_MANIFEST.supportTiers;
const PACKAGE_SET = RELEASE_MANIFEST.packages;

module.exports = Object.freeze({
  RELEASE_MANIFEST_FILE,
  RELEASE_MANIFEST,
  RELEASE_VERSION,
  LICENSE,
  DISPLAY,
  LEGAL,
  REPOSITORY,
  DOCUMENTATION,
  READINESS,
  PUBLICATION,
  RUNTIME_TARGETS,
  SUPPORT_TIERS,
  PACKAGE_SET,
  loadReleaseManifest,
  versionSatisfiesCaretRange
});
