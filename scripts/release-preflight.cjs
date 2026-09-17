#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  RELEASE_MANIFEST,
  RELEASE_VERSION,
  LICENSE,
  DISPLAY,
  LEGAL,
  PACKAGE_SET,
  PUBLICATION
} = require('./package-support.cjs');

const { validateShardCoverage } = require('./release-evidence-bundle.cjs');

const PREFLIGHT_SCHEMA = 'pulse.release-preflight.v1';
const CONFORMANCE_LEDGER_SCHEMA = 'pulse.release-conformance-ledger.v1';
const INVENTORY_SCHEMA = 'pulse.documentation-inventory.v2';
const AUDIT_SCHEMA = 'pulse.npm-catalog-audit.v2';
const AUDIT_POLICY_SCHEMA = 'pulse.npm-catalog-audit-policy.v2';
const PREFLIGHT_FILE = 'release/release-preflight.json';
const INVENTORY_FILE = 'release/documentation-inventory.json';
const repoRoot = path.resolve(__dirname, '..');
const STAGE_ORDER = Object.freeze([
  'documentation-release',
  'release-seal',
  'publication',
  'documentation-deployment'
]);
const DYNAMIC_STAGE_GATES = Object.freeze({
  'release-seal': Object.freeze([
    'dependency-closure',
    'fastly-cli',
    'vulnerability-evidence',
    'dependency-license-evidence'
  ])
});

function fail(message, code = 'PULSE_RELEASE_PREFLIGHT_INVALID', details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(relativeFile, root = repoRoot) {
  const file = path.resolve(root, relativeFile);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`release preflight path escapes the repository: ${relativeFile}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${relativeFile} is not valid JSON: ${error.message}`);
  }
}

function nonEmpty(value, context) {
  if (typeof value !== 'string' || !value.trim()) fail(`${context} must be a non-empty string`);
  return value;
}

function stringArray(value, context, options = {}) {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) fail(`${context} must be a${options.allowEmpty ? '' : ' non-empty'} string array`);
  if (value.some((entry) => typeof entry !== 'string' || !entry.trim())) fail(`${context} contains an invalid string`);
  if (new Set(value).size !== value.length) fail(`${context} contains duplicates`);
  return value;
}

function documentedReleaseVersions(root) {
  return new Set(readJson('release/documentation-versions.json', root).versions.map((entry) => entry.version));
}

function bootstrapEntryCompliant(entry, releaseVersions) {
  const latestAllowed = entry.latestTagTarget === null || entry.latestTagTarget === '0.0.0'
    || (entry.latestTagVersionPresent && releaseVersions.has(entry.latestTagTarget));
  return entry.state === 'exists'
    && entry.bootstrap.versionPresent
    && entry.bootstrap.tagTarget === '0.0.0'
    && latestAllowed;
}

function filesUnder(root, options, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (options.excludedDirectories.has(entry.name)) continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(file, options, out);
    else if (entry.isFile() && options.accept(file)) out.push(file);
  }
  return out;
}

function inventorySources(inventory, root = repoRoot) {
  const scope = inventory.scope;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) fail('documentation inventory scope is required');
  const rootFiles = stringArray(scope.rootFiles, 'documentation inventory scope.rootFiles');
  const markdownRoots = stringArray(scope.markdownRoots, 'documentation inventory scope.markdownRoots');
  const jsonRoots = stringArray(scope.jsonRoots, 'documentation inventory scope.jsonRoots');
  const additionalJsonFiles = stringArray(scope.additionalJsonFiles, 'documentation inventory scope.additionalJsonFiles');
  const excludedBasenames = new Set(stringArray(scope.excludedBasenames, 'documentation inventory scope.excludedBasenames'));
  const excludedDirectories = new Set(stringArray(scope.excludedDirectories, 'documentation inventory scope.excludedDirectories'));
  const excludedPrefixes = stringArray(scope.excludedPrefixes, 'documentation inventory scope.excludedPrefixes', { allowEmpty: true });
  const sources = new Set();

  function add(relativeFile) {
    const normalized = slash(relativeFile);
    const file = path.resolve(root, normalized);
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail(`documentation source escapes the repository: ${relativeFile}`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`documentation source is missing: ${normalized}`);
    if (!excludedBasenames.has(path.basename(file)) && !excludedPrefixes.some((prefix) => normalized.startsWith(prefix))) sources.add(normalized);
  }

  for (const relativeFile of rootFiles) add(relativeFile);
  for (const relativeRoot of markdownRoots) {
    const directory = path.resolve(root, relativeRoot);
    const relative = path.relative(root, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail(`documentation markdown root escapes the repository: ${relativeRoot}`);
    for (const file of filesUnder(directory, {
      excludedDirectories,
      accept: (candidate) => candidate.endsWith('.md') && !excludedBasenames.has(path.basename(candidate))
    })) add(path.relative(root, file));
  }
  for (const relativeRoot of jsonRoots) {
    const directory = path.resolve(root, relativeRoot);
    const relative = path.relative(root, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail(`documentation JSON root escapes the repository: ${relativeRoot}`);
    for (const file of filesUnder(directory, {
      excludedDirectories,
      accept: (candidate) => candidate.endsWith('.json')
    })) add(path.relative(root, file));
  }
  for (const relativeFile of additionalJsonFiles) add(relativeFile);
  return Object.freeze([...sources].sort());
}

function ruleMatches(rule, relativeFile) {
  if ((rule.excludePaths || []).includes(relativeFile)) return false;
  return (rule.paths || []).includes(relativeFile)
    || (rule.prefixes || []).some((prefix) => relativeFile.startsWith(prefix));
}

function classifyDocumentation(inventory, root = repoRoot) {
  if (inventory.schemaVersion !== INVENTORY_SCHEMA) fail(`unsupported documentation inventory schema ${inventory.schemaVersion}`);
  if (inventory.precedence !== 'first-match-wins') fail('documentation inventory precedence must be first-match-wins');
  const classifications = stringArray(inventory.classifications, 'documentation inventory classifications');
  const requiredClassifications = ['current-public', 'current-contributor', 'generated'];
  if (JSON.stringify(classifications) !== JSON.stringify(requiredClassifications)) {
    fail(`documentation inventory classifications must be ${requiredClassifications.join(', ')}`);
  }
  if (!Array.isArray(inventory.rules) || inventory.rules.length === 0) fail('documentation inventory rules are required');

  const ruleIds = new Set();
  for (const [index, rule] of inventory.rules.entries()) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) fail(`documentation inventory rule ${index} must be an object`);
    nonEmpty(rule.id, `documentation inventory rule ${index}.id`);
    if (ruleIds.has(rule.id)) fail(`documentation inventory contains duplicate rule ${rule.id}`);
    ruleIds.add(rule.id);
    if (!classifications.includes(rule.classification)) fail(`documentation inventory rule ${rule.id} uses unknown classification ${rule.classification}`);
    nonEmpty(rule.owner, `documentation inventory rule ${rule.id}.owner`);
    nonEmpty(rule.disposition, `documentation inventory rule ${rule.id}.disposition`);
    const paths = stringArray(rule.paths || [], `documentation inventory rule ${rule.id}.paths`, { allowEmpty: true });
    const prefixes = stringArray(rule.prefixes || [], `documentation inventory rule ${rule.id}.prefixes`, { allowEmpty: true });
    stringArray(rule.excludePaths || [], `documentation inventory rule ${rule.id}.excludePaths`, { allowEmpty: true });
    if (paths.length === 0 && prefixes.length === 0) fail(`documentation inventory rule ${rule.id} must name paths or prefixes`);
  }

  const sources = inventorySources(inventory, root);
  const usage = new Map(inventory.rules.map((rule) => [rule.id, 0]));
  const entries = [];
  for (const relativeFile of sources) {
    const rule = inventory.rules.find((candidate) => ruleMatches(candidate, relativeFile));
    if (!rule) fail(`documentation source is unclassified: ${relativeFile}`);
    usage.set(rule.id, usage.get(rule.id) + 1);
    entries.push(Object.freeze({
      path: relativeFile,
      classification: rule.classification,
      owner: rule.owner,
      rule: rule.id,
      disposition: rule.disposition
    }));
  }
  for (const [rule, count] of usage) if (count === 0) fail(`documentation inventory rule ${rule} matches no source`);

  const counts = Object.fromEntries(classifications.map((classification) => [
    classification,
    entries.filter((entry) => entry.classification === classification).length
  ]));
  for (const classification of classifications) {
    if (counts[classification] === 0) fail(`documentation inventory classification ${classification} is empty`);
  }

  return Object.freeze({
    schemaVersion: inventory.schemaVersion,
    status: 'ok',
    sources: entries.length,
    counts: Object.freeze(counts),
    rules: inventory.rules.length,
    entries: Object.freeze(entries)
  });
}

function validateBootstrap(preflight) {
  const bootstrap = preflight.npmBootstrap;
  if (!bootstrap || typeof bootstrap !== 'object' || Array.isArray(bootstrap)) fail('release preflight npmBootstrap is required');
  if (bootstrap.required !== true || Object.hasOwn(bootstrap, 'packageCount')) fail('npm bootstrap package coverage must derive from the release manifest');
  if (bootstrap.bootstrapVersion !== '0.0.0' || bootstrap.bootstrapTag !== 'bootstrap' || bootstrap.releaseTag !== PUBLICATION.distTag) {
    fail('npm bootstrap must reserve 0.0.0 under bootstrap before the manifest-owned release channel');
  }
  if (JSON.stringify(bootstrap.allowedLatestTargets) !== JSON.stringify([null, bootstrap.bootstrapVersion])) {
    fail('npm bootstrap latest may only be absent or point to the inert bootstrap version');
  }
  if (bootstrap.releasedLatestPolicy !== 'documented-published-version') fail('npm bootstrap must retain documented published latest versions');
  if (bootstrap.authority !== 'human-release' || bootstrap.authentication !== 'temporary-human-2fa') fail('npm bootstrap must remain human and 2FA protected');
  const shape = bootstrap.packageShape;
  if (!shape || shape.license !== LICENSE || shape.scriptsAllowed !== false || shape.dependenciesAllowed !== false || shape.exportsAllowed !== false || shape.executablesAllowed !== false) {
    fail('npm bootstrap package shape must remain inert and Apache-2.0 licensed');
  }
  if (JSON.stringify(shape.files) !== JSON.stringify(['package.json', 'README.md', ...LEGAL.packageFiles])) fail('npm bootstrap package files changed unexpectedly');
  const auditEvidence = bootstrap.auditEvidence;
  if (!auditEvidence || typeof auditEvidence !== 'object' || Array.isArray(auditEvidence)) fail('npm bootstrap auditEvidence policy is required');
  if (
    auditEvidence.schemaVersion !== AUDIT_POLICY_SCHEMA
    || auditEvidence.output !== '.pulse-release-preflight/npm-catalog-audit.json'
    || !Number.isInteger(auditEvidence.maxAgeHours)
    || auditEvidence.maxAgeHours < 1
    || auditEvidence.maxAgeHours > 168
    || auditEvidence.manifestBinding !== 'sha256'
    || auditEvidence.requiredBy !== 'publication'
  ) fail('npm catalog audit evidence policy is invalid');
  if (!Array.isArray(bootstrap.procedure) || bootstrap.procedure.length < 6) fail('npm bootstrap procedure is incomplete');
  return Object.freeze({
    packageCount: PACKAGE_SET.length,
    version: bootstrap.bootstrapVersion,
    tag: bootstrap.bootstrapTag,
    releaseTag: bootstrap.releaseTag,
    authority: bootstrap.authority,
    auditEvidence: Object.freeze({ ...auditEvidence })
  });
}

function validateReleaseVocabulary(preflight) {
  const vocabulary = preflight.releaseVocabulary;
  if (!vocabulary || typeof vocabulary !== 'object' || Array.isArray(vocabulary)) fail('release preflight releaseVocabulary is required');
  if (vocabulary.schemaVersion !== 'pulse.release-vocabulary.v1') fail(`unsupported release vocabulary schema ${vocabulary.schemaVersion}`);
  if (
    vocabulary.productName !== DISPLAY.productName
    || vocabulary.displayLabel !== DISPLAY.candidateLabel
    || vocabulary.displayName !== DISPLAY.candidateName
    || vocabulary.npmDistTag !== PUBLICATION.distTag
    || vocabulary.activationStage !== DISPLAY.activationStage
  ) fail('release vocabulary differs from the candidate display contract');
  if (JSON.stringify(vocabulary.disallowedCurrentLabels) !== JSON.stringify(['alpha', 'preview'])) {
    fail('release vocabulary must disallow alpha and preview on current public surfaces');
  }
  if (vocabulary.historicalLabelPolicy !== 'preserve-when-contextualized') fail('release vocabulary must preserve accurate historical labels');
  const expectedPromises = [
    'Documented behavior is intentional and evidence-backed.',
    'Unsupported behavior fails explicitly.',
    'No execution target silently falls back.',
    'Public surfaces may still change deliberately during beta before the stable 1.0.0 release.',
    'Implementation and historical subpaths do not gain accidental compatibility guarantees.',
    'Package names, release artifacts, and published versions remain immutable once released.'
  ];
  if (JSON.stringify(vocabulary.compatibilityPromise) !== JSON.stringify(expectedPromises)) {
    fail('release vocabulary compatibility promise changed unexpectedly');
  }
  return Object.freeze({
    schemaVersion: vocabulary.schemaVersion,
    displayLabel: vocabulary.displayLabel,
    displayName: vocabulary.displayName,
    npmDistTag: vocabulary.npmDistTag,
    activationStage: vocabulary.activationStage
  });
}

function validateNoticeDisposition(licenses, root = repoRoot) {
  const disposition = licenses.noticeDisposition;
  if (!disposition || typeof disposition !== 'object' || Array.isArray(disposition)) fail('dependency license noticeDisposition is required');
  if (disposition.schemaVersion !== 'pulse.release-notice-disposition.v1') fail(`unsupported release notice disposition schema ${disposition.schemaVersion}`);
  if (disposition.status !== 'notice-required-and-shipped') fail('release NOTICE disposition must remain required and shipped');
  nonEmpty(disposition.basis, 'dependency license noticeDisposition.basis');
  if (
    disposition.noticeFile !== LEGAL.noticeFile
    || disposition.noticeSha256 !== LEGAL.noticeSha256
    || disposition.packagePolicy !== LEGAL.packagePolicy
    || JSON.stringify(disposition.packageFiles) !== JSON.stringify(LEGAL.packageFiles)
  ) fail('release NOTICE disposition differs from the release legal contract');

  const licenseFile = path.join(root, LEGAL.licenseFile);
  const noticeFile = path.join(root, LEGAL.noticeFile);
  if (!fs.existsSync(licenseFile)) fail(`release legal file is missing: ${LEGAL.licenseFile}`);
  if (!fs.existsSync(noticeFile)) fail(`release legal file is missing: ${LEGAL.noticeFile}`);
  const noticeBytes = fs.readFileSync(noticeFile);
  const noticeSha256 = crypto.createHash('sha256').update(noticeBytes).digest('hex');
  if (noticeSha256 !== LEGAL.noticeSha256) fail('NOTICE does not match the release legal contract');

  const components = disposition.components;
  if (!Array.isArray(components)) fail('dependency license noticeDisposition.components must be an array');
  const expectedComponents = [
    ['assemblyscript', '0.28.18', 'Apache-2.0'],
    ['json-as', '1.5.0', 'MIT'],
    ['xjb-as', '0.1.0', '(MIT AND Apache-2.0)']
  ];
  if (JSON.stringify(components.map((entry) => [entry.name, entry.version, entry.license])) !== JSON.stringify(expectedComponents)) {
    fail('release NOTICE component set or order changed unexpectedly');
  }
  for (const [index, component] of components.entries()) {
    nonEmpty(component.relationship, `dependency license noticeDisposition.components[${index}].relationship`);
    nonEmpty(component.attributionSource, `dependency license noticeDisposition.components[${index}].attributionSource`);
  }

  const compilerManifest = readJson('wasm/packages/compiler/package.json', root);
  if (compilerManifest.dependencies?.assemblyscript !== '0.28.18' || compilerManifest.dependencies?.['json-as'] !== '1.5.0') {
    fail('release NOTICE direct dependency versions differ from the compiler package');
  }
  const lockfile = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  if (!/\n  xjb-as@0\.1\.0:\n/.test(lockfile) || !/\n  json-as@1\.5\.0:\n\s+dependencies:\n\s+xjb-as: 0\.1\.0\n/.test(lockfile)) {
    fail('release NOTICE transitive xjb-as version differs from the lockfile');
  }
  const noticeText = noticeBytes.toString('utf8');
  for (const marker of ['AssemblyScript 0.28.18', 'json-as 1.5.0', 'xjb-as 0.1.0', 'xjb714 and contributors']) {
    if (!noticeText.includes(marker)) fail(`NOTICE is missing required attribution marker ${marker}`);
  }
  return Object.freeze({
    schemaVersion: disposition.schemaVersion,
    status: disposition.status,
    noticeFile: disposition.noticeFile,
    noticeSha256,
    packageFiles: Object.freeze([...disposition.packageFiles]),
    components: components.length
  });
}

function validateAuditPolicy(preflight, root = repoRoot) {
  const policy = preflight.auditPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) fail('release preflight auditPolicy is required');
  const vulnerabilities = policy.vulnerabilities;
  const licenses = policy.dependencyLicenses;
  if (!vulnerabilities || vulnerabilities.command !== 'node scripts/pnpm-toolchain.cjs -- audit --prod --json' || vulnerabilities.refreshAt !== 'release-seal') {
    fail('production vulnerability audit method is not fixed to the frozen release closure');
  }
  if (JSON.stringify(vulnerabilities.stopShipSeverities) !== JSON.stringify(['critical', 'high'])) fail('critical and high production vulnerabilities must remain stop-ship');
  nonEmpty(vulnerabilities.acceptance, 'vulnerability audit acceptance');
  if (!licenses || licenses.command !== 'node scripts/audit-production-dependencies.cjs' || licenses.refreshAt !== 'release-seal') {
    fail('production dependency-license audit method is not fixed to the frozen release closure');
  }
  const accepted = stringArray(licenses.automaticallyAcceptedSpdx, 'dependency license automaticallyAcceptedSpdx');
  for (const required of ['Apache-2.0', 'MIT']) if (!accepted.includes(required)) fail(`dependency license allowlist is missing ${required}`);
  nonEmpty(licenses.reviewRequired, 'dependency license reviewRequired');
  nonEmpty(licenses.noticeRule, 'dependency license noticeRule');
  const noticeDisposition = validateNoticeDisposition(licenses, root);
  return Object.freeze({
    vulnerabilityCommand: vulnerabilities.command,
    stopShipSeverities: Object.freeze([...vulnerabilities.stopShipSeverities]),
    licenseCommand: licenses.command,
    automaticallyAcceptedSpdx: accepted.length,
    noticeDisposition,
    refreshAt: 'release-seal'
  });
}

function validateConformanceLedger(preflight) {
  const ledger = preflight.conformanceLedger;
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) fail('release preflight conformanceLedger is required');
  if (ledger.schemaVersion !== CONFORMANCE_LEDGER_SCHEMA) fail(`unsupported release conformance ledger schema ${ledger.schemaVersion}`);
  if (ledger.checkpoint !== 'sprint-7d-release-blocking-conformance') fail('release conformance ledger checkpoint identity is invalid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ledger.reviewedAt)) fail('release conformance ledger reviewedAt must use YYYY-MM-DD');
  const vocabulary = ['closed', 'explicitly-deferred', 'release-blocking'];
  if (JSON.stringify(ledger.statusVocabulary) !== JSON.stringify(vocabulary)) fail('release conformance ledger status vocabulary changed unexpectedly');
  if (!Array.isArray(ledger.items) || ledger.items.length === 0) fail('release conformance ledger items are required');

  const requiredItemIds = [
    'handler-cross-target-semantics',
    'request-body-policy',
    'schema-codec-parity',
    'binding-and-redaction',
    'node-fastly-four-mode',
    'grip-package-root',
    'target-eligibility-artifact-truth',
    'cli-workflow-diagnostics',
    'source-package-build-order',
    'automatic-fallback-policy',
    'arbitrary-javascript-native-lowering',
    'third-party-lowerer-loading',
    'standalone-node-native-launcher',
    'remote-deployment-and-activation'
  ];
  const ids = new Set();
  const counts = { closed: 0, explicitlyDeferred: 0, releaseBlocking: 0, unclassified: 0 };
  for (const [index, item] of ledger.items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`release conformance ledger item ${index} must be an object`);
    nonEmpty(item.id, `release conformance ledger item ${index}.id`);
    if (ids.has(item.id)) fail(`release conformance ledger contains duplicate item ${item.id}`);
    ids.add(item.id);
    nonEmpty(item.category, `release conformance ledger item ${item.id}.category`);
    nonEmpty(item.entryPoint, `release conformance ledger item ${item.id}.entryPoint`);
    nonEmpty(item.owner, `release conformance ledger item ${item.id}.owner`);
    nonEmpty(item.summary, `release conformance ledger item ${item.id}.summary`);
    if (!vocabulary.includes(item.status)) fail(`release conformance ledger item ${item.id} uses unknown status ${item.status}`);
    if (item.status === 'closed') {
      counts.closed += 1;
      stringArray(item.evidence, `release conformance ledger item ${item.id}.evidence`);
      nonEmpty(item.verification, `release conformance ledger item ${item.id}.verification`);
    } else if (item.status === 'explicitly-deferred') {
      counts.explicitlyDeferred += 1;
      nonEmpty(item.deferredTo, `release conformance ledger item ${item.id}.deferredTo`);
      nonEmpty(item.reason, `release conformance ledger item ${item.id}.reason`);
    } else {
      counts.releaseBlocking += 1;
      nonEmpty(item.nextAction, `release conformance ledger item ${item.id}.nextAction`);
    }
  }
  if (JSON.stringify([...ids]) !== JSON.stringify(requiredItemIds)) fail('release conformance ledger item set or order changed unexpectedly');
  if (!ledger.summary || typeof ledger.summary !== 'object' || Array.isArray(ledger.summary)) fail('release conformance ledger summary is required');
  if (JSON.stringify(ledger.summary) !== JSON.stringify(counts)) fail('release conformance ledger summary does not match its classified items');
  return Object.freeze({
    schemaVersion: ledger.schemaVersion,
    checkpoint: ledger.checkpoint,
    items: ledger.items.length,
    statuses: Object.freeze(counts)
  });
}

function validateSnapshotTransaction(preflight, root = repoRoot) {
  const candidate = preflight.releaseCandidate;
  if (
    candidate.currentSnapshotChannel !== RELEASE_MANIFEST.channel
    || candidate.applicationStage !== 'documentation-release'
    || candidate.snapshotStatus !== 'applied'
    || candidate.snapshotAppliedAt !== RELEASE_MANIFEST.releasedAt
  ) {
    fail('release candidate must record the applied Beta snapshot');
  }
  if (
    RELEASE_MANIFEST.channel !== candidate.currentSnapshotChannel
    || PUBLICATION.distTag !== candidate.publicationTag
    || RELEASE_MANIFEST.releasedAt !== candidate.snapshotAppliedAt
  ) {
    fail('release manifest does not match the applied Beta snapshot');
  }

  const versions = readJson('release/documentation-versions.json', root);
  const current = Array.isArray(versions.versions)
    ? versions.versions.filter((entry) => entry.status === 'current')
    : [];
  if (
    versions.latest !== candidate.version
    || current.length !== 1
    || current[0].version !== candidate.version
    || current[0].segment !== `v${candidate.version}`
    || current[0].channel !== RELEASE_MANIFEST.channel
    || current[0].releasedAt !== candidate.snapshotAppliedAt
    || current[0].sourceManifest !== 'release/pulse-release-manifest.json'
  ) {
    fail('documentation versions do not match the applied Beta snapshot');
  }

  const rootPackage = readJson('package.json', root);
  if (
    rootPackage.license !== LICENSE
    || rootPackage.engines?.node !== PUBLICATION.nodeEngines
    || rootPackage.engines?.pnpm !== PUBLICATION.pnpmDevelopmentRange
    || Object.hasOwn(rootPackage, 'packageManager')
  ) {
    fail('root package metadata does not match the Beta release contract');
  }

  let dependencyRanges = 0;
  for (const entry of PACKAGE_SET) {
    const manifest = readJson(`${entry.dir}/package.json`, root);
    if (manifest.name !== entry.name || manifest.version !== candidate.version || manifest.license !== LICENSE) {
      fail(`${entry.name} package metadata does not match the applied Beta snapshot`);
    }
    if (manifest.engines?.node !== PUBLICATION.nodeEngines) {
      fail(`${entry.name} Node engines do not match the Beta release contract`);
    }
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(manifest[section] || {})) {
        if (!name.startsWith('@pulse-compute/')) continue;
        dependencyRanges += 1;
        if (range !== 'workspace:*' && range !== candidate.version) {
          fail(`${entry.name} ${section} range for ${name} must resolve to the synchronized ${candidate.version} release`);
        }
      }
    }
  }

  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  if (!changelog.includes(`## ${candidate.version} — ${candidate.label} (${candidate.snapshotAppliedAt})`)) {
    fail('CHANGELOG does not identify the applied Beta snapshot');
  }
  if (/^## Current source candidate$/m.test(changelog)) fail('CHANGELOG still describes the release as an unsnapshotted source candidate');

  return Object.freeze({
    status: candidate.snapshotStatus,
    version: candidate.version,
    channel: candidate.currentSnapshotChannel,
    releasedAt: candidate.snapshotAppliedAt,
    packages: PACKAGE_SET.length,
    dependencyRanges
  });
}

function validatePreflight(options = {}) {
  const shards = validateShardCoverage();
  const root = path.resolve(options.repoRoot || repoRoot);
  const preflight = options.preflight || readJson(PREFLIGHT_FILE, root);
  const inventory = options.inventory || readJson(INVENTORY_FILE, root);
  if (preflight.schemaVersion !== PREFLIGHT_SCHEMA) fail(`unsupported release preflight schema ${preflight.schemaVersion}`);
  if (preflight.checkpoint !== 'sprint-7a-release-preflight' || preflight.baselineCheckpoint !== '2d8468f') fail('release preflight checkpoint identity is invalid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preflight.reviewedAt)) fail('release preflight reviewedAt must use YYYY-MM-DD');
  if (JSON.stringify(preflight.statusVocabulary) !== JSON.stringify(['proven', 'pending', 'blocked'])) fail('release preflight status vocabulary changed unexpectedly');

  const candidate = preflight.releaseCandidate;
  if (
    !candidate
    || candidate.version !== RELEASE_VERSION
    || candidate.label !== DISPLAY.candidateLabel
    || candidate.publicationTag !== PUBLICATION.distTag
    || candidate.latestTagAllowed !== (PUBLICATION.distTag === 'latest')
  ) {
    fail('release candidate framing must match the manifest-owned version, label, and publication tag');
  }
  if (RELEASE_VERSION !== candidate.version) {
    fail('current release manifest version no longer matches the Beta candidate');
  }
  if (
    LICENSE !== 'Apache-2.0'
    || PUBLICATION.nodeEngines !== '^22.14.0 || ^24.0.0'
    || PUBLICATION.nodeMinimumVersion !== '22.14.0'
    || PUBLICATION.nodeReleaseRange !== '^24.0.0'
    || PUBLICATION.nodeVersion !== '24.18.0'
    || PUBLICATION.npmVersion !== '11.15.0'
  ) {
    fail('release preflight Node, npm, pnpm, or license decision drifted');
  }
  const vocabulary = validateReleaseVocabulary(preflight);

  const inventoryResult = classifyDocumentation(inventory, root);
  if (!preflight.documentationInventory || preflight.documentationInventory.file !== INVENTORY_FILE) fail('release preflight documentation inventory owner is invalid');
  if (JSON.stringify(preflight.documentationInventory.requiredClassifications) !== JSON.stringify(inventory.classifications)) {
    fail('release preflight documentation classifications do not match the inventory');
  }
  const bootstrap = validateBootstrap(preflight);
  const auditPolicy = validateAuditPolicy(preflight, root);
  const conformance = validateConformanceLedger(preflight);
  const snapshot = validateSnapshotTransaction(preflight, root);

  if (!Array.isArray(preflight.gates) || preflight.gates.length === 0) fail('release preflight gates are required');
  const requiredGateIds = [
    'release-framing',
    'project-license',
    'node-support',
    'dependency-closure',
    'npm-bootstrap-design',
    'npm-package-names',
    'npm-organization',
    'npm-trusted-publishers',
    'npm-protected-environment',
    'public-repository',
    'documentation-origin',
    'fastly-reality-policy',
    'release-conformance',
    'release-snapshot',
    'fastly-cli',
    'vulnerability-audit-method',
    'vulnerability-evidence',
    'dependency-license-method',
    'dependency-license-evidence',
    'notice-disposition',
    'documentation-inventory'
  ];
  const gates = new Map();
  const statuses = { proven: 0, pending: 0, blocked: 0 };
  for (const [index, gate] of preflight.gates.entries()) {
    if (!gate || typeof gate !== 'object' || Array.isArray(gate)) fail(`release preflight gate ${index} must be an object`);
    nonEmpty(gate.id, `release preflight gate ${index}.id`);
    if (gates.has(gate.id)) fail(`release preflight contains duplicate gate ${gate.id}`);
    if (!preflight.statusVocabulary.includes(gate.status)) fail(`release preflight gate ${gate.id} uses unknown status ${gate.status}`);
    if (!STAGE_ORDER.includes(gate.requiredBy)) fail(`release preflight gate ${gate.id} has invalid requiredBy ${gate.requiredBy}`);
    nonEmpty(gate.category, `release preflight gate ${gate.id}.category`);
    nonEmpty(gate.owner, `release preflight gate ${gate.id}.owner`);
    nonEmpty(gate.summary, `release preflight gate ${gate.id}.summary`);
    nonEmpty(gate.verification, `release preflight gate ${gate.id}.verification`);
    if (gate.status === 'proven') stringArray(gate.evidence, `release preflight gate ${gate.id}.evidence`);
    else nonEmpty(gate.nextAction, `release preflight gate ${gate.id}.nextAction`);
    statuses[gate.status] += 1;
    gates.set(gate.id, gate);
  }
  if (JSON.stringify([...gates.keys()]) !== JSON.stringify(requiredGateIds)) fail('release preflight gate set or order changed unexpectedly');
  if (statuses.proven === 0 || statuses.pending === 0) fail('release preflight must contain proven and pending gates');
  if (gates.get('notice-disposition').status !== 'proven') fail('NOTICE disposition must be proven before documentation-release');
  const conformanceStatus = conformance.statuses.releaseBlocking === 0 && conformance.statuses.unclassified === 0 ? 'proven' : 'blocked';
  if (gates.get('release-conformance').status !== conformanceStatus) fail(`release-conformance gate must be ${conformanceStatus} for the classified 7D ledger`);
  if (gates.get('release-snapshot').status !== 'proven') fail('release-snapshot gate must be proven after the applied Sprint 7E transaction');

  const npmNames = gates.get('npm-package-names');
  if (npmNames.status !== 'pending' || npmNames.requiredBy !== 'publication') fail('npm package-name policy must require generated evidence at publication');
  if (Object.hasOwn(npmNames, 'observedAt') || Object.hasOwn(npmNames, 'observedMissing')) {
    fail('mutable npm registry observations must not be stored in the source preflight policy');
  }
  const source = preflight.sourceAuthority;
  if (!source || source.expectedRepository !== 'pulse-compute/pulse' || source.expectedReleaseTag !== `v${RELEASE_VERSION}` || source.externalVerification !== gates.get('public-repository').status) {
    fail('release preflight source authority does not match the public-repository gate');
  }
  const authorization = preflight.authorization;
  if (!authorization || Object.values(authorization).some((allowed) => allowed !== false)) fail('release preflight must authorize no external mutation');

  const result = {
    schemaVersion: preflight.schemaVersion,
    status: 'ok',
    checkpoint: preflight.checkpoint,
    releaseCandidate: Object.freeze({ ...candidate }),
    vocabulary,
    statuses: Object.freeze(statuses),
    shards: shards.length,
    gates: preflight.gates.length,
    bootstrap,
    audits: auditPolicy,
    conformance,
    snapshot,
    documentation: inventoryResult
  };
  if (options.stage) {
    const provenGates = new Set();
    const suppliedProofs = options.provenGates ? [...options.provenGates] : [];
    const allowedProofs = new Set(DYNAMIC_STAGE_GATES[options.stage] || []);
    for (const gateId of suppliedProofs) {
      if (!allowedProofs.has(gateId)) fail(`${gateId} is not a runtime-proven gate for ${options.stage}`);
      provenGates.add(gateId);
    }
    let npmCatalogAudit = null;
    if (STAGE_ORDER.indexOf(options.stage) >= STAGE_ORDER.indexOf('publication')) {
      const auditFile = path.resolve(root, options.npmAuditFile || bootstrap.auditEvidence.output);
      if (fs.existsSync(auditFile)) {
        npmCatalogAudit = validateNpmAuditEvidence(readJson(path.relative(root, auditFile), root), {
          repoRoot: root,
          maxAgeHours: bootstrap.auditEvidence.maxAgeHours,
          now: options.now
        });
        if (npmCatalogAudit.status === 'ready') provenGates.add('npm-package-names');
      }
    }
    result.npmCatalogAudit = npmCatalogAudit;
    result.stage = assertStageReady(preflight, options.stage, { provenGates });
  }
  return Object.freeze(result);
}

function assertStageReady(preflight, stage, options = {}) {
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0) fail(`unknown release preflight stage ${stage}`);
  const unresolved = preflight.gates
    .filter((gate) => STAGE_ORDER.indexOf(gate.requiredBy) <= index && gate.status !== 'proven' && !options.provenGates?.has(gate.id))
    .map((gate) => Object.freeze({ id: gate.id, status: gate.status, requiredBy: gate.requiredBy, nextAction: gate.nextAction }));
  if (unresolved.length) {
    fail(`${stage} is blocked by ${unresolved.map((entry) => `${entry.id}:${entry.status}`).join(', ')}`, 'PULSE_RELEASE_PREFLIGHT_BLOCKED', Object.freeze(unresolved));
  }
  return Object.freeze({ status: 'ready', stage, gates: preflight.gates.length });
}

function releaseManifestSha256(root = repoRoot) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'release', 'pulse-release-manifest.json')))
    .digest('hex');
}

function validateNpmAuditEvidence(report, options = {}) {
  const root = path.resolve(options.repoRoot || repoRoot);
  const maxAgeHours = options.maxAgeHours || 24;
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail('npm catalog audit evidence must be an object');
  if (report.schemaVersion !== AUDIT_SCHEMA) fail(`unsupported npm catalog audit schema ${report.schemaVersion}`);
  const registry = String(PUBLICATION.registry).replace(/\/$/, '');
  if (report.releaseVersion !== RELEASE_VERSION || report.registry !== registry) fail('npm catalog audit release or registry identity does not match the release manifest');
  if (report.releaseManifestSha256 !== releaseManifestSha256(root)) fail('npm catalog audit is not bound to the current release manifest');
  const checkedAt = new Date(report.checkedAt);
  if (Number.isNaN(checkedAt.valueOf()) || checkedAt.toISOString() !== report.checkedAt) fail('npm catalog audit checkedAt must be an ISO timestamp');
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.valueOf())) fail('npm catalog audit validation time is invalid');
  const ageMs = now.valueOf() - checkedAt.valueOf();
  if (ageMs < -5 * 60 * 1000) fail('npm catalog audit checkedAt is in the future');
  if (ageMs > maxAgeHours * 60 * 60 * 1000) fail(`npm catalog audit is older than ${maxAgeHours} hour(s)`);
  if (!Array.isArray(report.packages) || report.packages.length !== PACKAGE_SET.length) fail('npm catalog audit package count does not match the release manifest');
  const expectedNames = PACKAGE_SET.map((entry) => entry.name);
  if (JSON.stringify(report.packages.map((entry) => entry.name)) !== JSON.stringify(expectedNames)) fail('npm catalog audit package order does not match the release manifest');

  const counts = { total: report.packages.length, existing: 0, missing: 0, indeterminate: 0, bootstrapCompliant: 0, tagRemediation: 0 };
  const releaseVersions = documentedReleaseVersions(root);
  for (const entry of report.packages) {
    if (!['exists', 'missing', 'indeterminate'].includes(entry.state)) fail(`npm catalog audit has invalid state for ${entry.name}`);
    counts[entry.state === 'exists' ? 'existing' : entry.state] += 1;
    if (entry.state === 'exists' && entry.statusCode !== 200) fail(`npm catalog audit existing state lacks HTTP 200 for ${entry.name}`);
    if (entry.state === 'missing' && entry.statusCode !== 404) fail(`npm catalog audit missing state lacks HTTP 404 for ${entry.name}`);
    if (!Number.isInteger(entry.versionCount) || entry.versionCount < 0) fail(`npm catalog audit version count is invalid for ${entry.name}`);
    if (!entry.bootstrap || entry.bootstrap.version !== '0.0.0' || typeof entry.bootstrap.versionPresent !== 'boolean') fail(`npm catalog audit bootstrap facts are invalid for ${entry.name}`);
    if (entry.bootstrap.tagTarget !== null && typeof entry.bootstrap.tagTarget !== 'string') fail(`npm catalog audit bootstrap tag is invalid for ${entry.name}`);
    if (!entry.release || entry.release.version !== RELEASE_VERSION || entry.release.distTag !== PUBLICATION.distTag || typeof entry.release.versionPresent !== 'boolean') {
      fail(`npm catalog audit release facts are invalid for ${entry.name}`);
    }
    if (entry.release.tagTarget !== null && typeof entry.release.tagTarget !== 'string') fail(`npm catalog audit release tag is invalid for ${entry.name}`);
    if (entry.latestTagTarget !== null && typeof entry.latestTagTarget !== 'string') fail(`npm catalog audit latest tag is invalid for ${entry.name}`);
    if (typeof entry.latestTagVersionPresent !== 'boolean'
      || (entry.latestTagTarget === null && entry.latestTagVersionPresent)) fail(`npm catalog audit latest version facts are invalid for ${entry.name}`);
    if (entry.latestTagTarget === entry.release.version && entry.latestTagVersionPresent !== entry.release.versionPresent) fail(`npm catalog audit latest and release version facts disagree for ${entry.name}`);
    if (PUBLICATION.distTag === 'latest' && entry.release.tagTarget !== entry.latestTagTarget) fail(`npm catalog audit latest and release tag facts disagree for ${entry.name}`);
    if (entry.state === 'exists') {
      if (bootstrapEntryCompliant(entry, releaseVersions)) counts.bootstrapCompliant += 1;
      else counts.tagRemediation += 1;
    }
    if (entry.state === 'indeterminate') nonEmpty(entry.error, `npm catalog audit error for ${entry.name}`);
  }
  if (JSON.stringify(report.summary) !== JSON.stringify(counts)) fail('npm catalog audit summary does not match its package observations');
  const expectedStatus = counts.indeterminate ? 'indeterminate' : counts.missing ? 'bootstrap-required' : counts.tagRemediation ? 'remediation-required' : 'ready';
  if (report.status !== expectedStatus) fail(`npm catalog audit status must be ${expectedStatus}`);
  return Object.freeze({
    schemaVersion: report.schemaVersion,
    status: report.status,
    checkedAt: report.checkedAt,
    ageHours: ageMs / (60 * 60 * 1000),
    maxAgeHours,
    releaseManifestSha256: report.releaseManifestSha256,
    summary: Object.freeze({ ...counts })
  });
}

async function auditNpmPackageNames(options = {}) {
  const root = path.resolve(options.repoRoot || repoRoot);
  const releaseVersions = documentedReleaseVersions(root);
  const registry = String(PUBLICATION.registry).replace(/\/$/, '');
  const auditNonce = Date.now().toString(36);
  const packages = [];
  for (const entry of PACKAGE_SET) {
    let response;
    let document;
    let errorMessage = null;
    try {
      response = await fetch(`${registry}/${encodeURIComponent(entry.name)}?pulse_audit=${auditNonce}`, {
        cache: 'no-store',
        headers: {
          accept: 'application/vnd.npm.install-v1+json',
          'cache-control': 'no-cache'
        }
      });
      try { document = await response.json(); } catch { document = undefined; }
    } catch (error) {
      errorMessage = error.message;
    }
    const versions = document && document.versions && typeof document.versions === 'object' ? document.versions : {};
    const distTags = document && document['dist-tags'] && typeof document['dist-tags'] === 'object' ? document['dist-tags'] : {};
    const state = response?.status === 200 ? 'exists' : response?.status === 404 ? 'missing' : 'indeterminate';
    const observation = {
      name: entry.name,
      state,
      statusCode: response?.status || null,
      versionCount: Object.keys(versions).length,
      bootstrap: Object.freeze({
        version: '0.0.0',
        versionPresent: Object.hasOwn(versions, '0.0.0'),
        tagTarget: typeof distTags.bootstrap === 'string' ? distTags.bootstrap : null
      }),
      release: Object.freeze({
        version: RELEASE_VERSION,
        versionPresent: Object.hasOwn(versions, RELEASE_VERSION),
        distTag: PUBLICATION.distTag,
        tagTarget: typeof distTags[PUBLICATION.distTag] === 'string' ? distTags[PUBLICATION.distTag] : null
      }),
      latestTagTarget: typeof distTags.latest === 'string' ? distTags.latest : null,
      latestTagVersionPresent: typeof distTags.latest === 'string' && Object.hasOwn(versions, distTags.latest)
    };
    if (state === 'indeterminate') observation.error = errorMessage || `registry returned HTTP ${response?.status || 'unknown'}`;
    packages.push(Object.freeze(observation));
  }
  const summary = Object.freeze({
    total: packages.length,
    existing: packages.filter((entry) => entry.state === 'exists').length,
    missing: packages.filter((entry) => entry.state === 'missing').length,
    indeterminate: packages.filter((entry) => entry.state === 'indeterminate').length,
    bootstrapCompliant: packages.filter((entry) => bootstrapEntryCompliant(entry, releaseVersions)).length,
    tagRemediation: packages.filter((entry) => entry.state === 'exists' && !bootstrapEntryCompliant(entry, releaseVersions)).length
  });
  return Object.freeze({
    schemaVersion: AUDIT_SCHEMA,
    status: summary.indeterminate ? 'indeterminate' : summary.missing ? 'bootstrap-required' : summary.tagRemediation ? 'remediation-required' : 'ready',
    checkedAt: new Date().toISOString(),
    releaseVersion: RELEASE_VERSION,
    releaseManifestSha256: releaseManifestSha256(root),
    registry,
    packages: Object.freeze(packages),
    summary
  });
}

function parseArgs(argv) {
  const options = { check: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check') continue;
    if (token === '--json') { options.json = true; continue; }
    if (token === '--audit-npm') { options.auditNpm = true; continue; }
    if (token === '--npm-audit-report') {
      options.npmAuditFile = argv[++index];
      if (!options.npmAuditFile) fail('--npm-audit-report requires a file');
      continue;
    }
    if (token.startsWith('--npm-audit-report=')) { options.npmAuditFile = token.slice('--npm-audit-report='.length); continue; }
    if (token === '--stage') {
      options.stage = argv[++index];
      if (!options.stage) fail(`--stage requires ${STAGE_ORDER.join(', ')}`);
      continue;
    }
    if (token.startsWith('--stage=')) { options.stage = token.slice('--stage='.length); continue; }
    if (token === '--json-out') {
      options.jsonFile = argv[++index];
      if (!options.jsonFile) fail('--json-out requires a file');
      continue;
    }
    if (token.startsWith('--json-out=')) { options.jsonFile = token.slice('--json-out='.length); continue; }
    fail(`unknown release preflight option ${token}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.auditNpm && options.stage) fail('--audit-npm and --stage cannot be combined');
  const validation = validatePreflight({ stage: options.stage, npmAuditFile: options.npmAuditFile });
  const result = options.auditNpm ? await auditNpmPackageNames() : validation;
  if (options.jsonFile) {
    const target = path.resolve(options.jsonFile);
    const relative = path.relative(repoRoot, target);
    if (!relative.startsWith('.pulse-release-preflight/') || relative.startsWith('..') || path.isAbsolute(relative)) {
      fail('--json-out must be inside .pulse-release-preflight');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, stableJson(result));
  }
  if (options.json || options.auditNpm) process.stdout.write(stableJson(result));
  else {
    process.stdout.write(
      `ok - release preflight classified ${validation.gates} gate(s) `
      + `(${validation.statuses.proven} proven, ${validation.statuses.pending} pending, ${validation.statuses.blocked} blocked) `
      + `and ${validation.documentation.sources} documentation source(s); ${validation.shards} release shards mapped\n`
    );
  }
}

module.exports = Object.freeze({
  PREFLIGHT_SCHEMA,
  CONFORMANCE_LEDGER_SCHEMA,
  INVENTORY_SCHEMA,
  AUDIT_SCHEMA,
  AUDIT_POLICY_SCHEMA,
  PREFLIGHT_FILE,
  INVENTORY_FILE,
  inventorySources,
  classifyDocumentation,
  validateBootstrap,
  validateReleaseVocabulary,
  validateNoticeDisposition,
  validateAuditPolicy,
  validateConformanceLedger,
  validateSnapshotTransaction,
  validatePreflight,
  assertStageReady,
  releaseManifestSha256,
  validateNpmAuditEvidence,
  auditNpmPackageNames,
  stableJson,
  sha256: (value) => crypto.createHash('sha256').update(value).digest('hex')
});

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    if (error && error.details) process.stderr.write(stableJson(error.details));
    process.exitCode = 1;
  });
}
