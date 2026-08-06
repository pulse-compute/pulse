#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  RELEASE_MANIFEST,
  RELEASE_VERSION,
  LICENSE,
  LEGAL,
  PACKAGE_SET,
  DOCUMENTATION,
  PUBLICATION
} = require('./package-support.cjs');
const {
  PACK_SCHEMA,
  loadPublicationConfig,
  preparePublicationBundle,
  verifyPublicationBundle,
  publishOrder,
  auditPackageNames,
  publicationPlan,
  verifyRegistryRelease,
  verifyCatalogRelease,
  sha256,
  sha512,
  shasum,
  integrity
} = require('./release-publication.cjs');
const {
  normalizeBasePath,
  publicUrl,
  loadDeploymentConfig,
  sealDocumentationCandidate,
  verifyDocumentationCandidate,
  deployDocumentation,
  verifyStorage,
  verifyNpmPromotionEvidence,
  assertProductionDeploymentEnvironment,
  awsAdapter
} = require('./documentation-deployment.cjs');
const { validatePreflight } = require('./release-preflight.cjs');

const VALIDATION_SCHEMA = 'pulse.publication-control-plane-validation.v1';
const repoRoot = path.resolve(__dirname, '..');

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_PUBLICATION_CONTROL_PLANE_INVALID';
  throw error;
}

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function read(relativeFile) { return fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8'); }
function readJson(relativeFile) { return JSON.parse(read(relativeFile)); }
function exists(relativeFile) { return fs.existsSync(path.join(repoRoot, relativeFile)); }
function ensureDirectory(directory) { fs.mkdirSync(directory, { recursive: true }); }
function includes(source, needle, context) { if (!source.includes(needle)) fail(`${context} is missing ${needle}`); }
function excludes(source, needle, context) { if (source.includes(needle)) fail(`${context} must not contain ${needle}`); }

function expectFailure(callback, expectedCode, context) {
  try { callback(); }
  catch (error) {
    if (expectedCode && error.code !== expectedCode) fail(`${context} failed with ${error.code || error.name}, expected ${expectedCode}`);
    return error;
  }
  fail(`${context} unexpectedly succeeded`);
}

function validatePackageMetadata() {
  const licenseBytes = fs.readFileSync(path.join(repoRoot, 'LICENSE'));
  if (sha256(licenseBytes) !== 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30') {
    fail('LICENSE must contain the unmodified Apache License 2.0 text');
  }
  const noticeBytes = fs.readFileSync(path.join(repoRoot, LEGAL.noticeFile));
  if (sha256(noticeBytes) !== LEGAL.noticeSha256) fail('NOTICE must match the release legal contract');
  const rootManifest = readJson('package.json');
  if (rootManifest.license !== LICENSE) fail(`workspace package.json must declare license=${LICENSE}`);
  if (!rootManifest.engines || rootManifest.engines.node !== PUBLICATION.nodeEngines) {
    fail(`workspace package.json must declare engines.node=${PUBLICATION.nodeEngines}`);
  }
  if (rootManifest.engines.pnpm !== PUBLICATION.pnpmDevelopmentRange || Object.hasOwn(rootManifest, 'packageManager')) {
    fail(`workspace package.json must support pnpm ${PUBLICATION.pnpmDevelopmentRange} without a patch-level packageManager pin`);
  }
  for (const entry of PACKAGE_SET) {
    const manifest = readJson(`${entry.dir}/package.json`);
    if (manifest.license !== LICENSE) fail(`${entry.name} must declare license=${LICENSE}`);
    if (!manifest.engines || manifest.engines.node !== PUBLICATION.nodeEngines) {
      fail(`${entry.name} must declare engines.node=${PUBLICATION.nodeEngines}`);
    }
  }
  return Object.freeze({
    license: LICENSE,
    notice: LEGAL.noticeFile,
    noticeSha256: LEGAL.noticeSha256,
    legalFiles: Object.freeze([...LEGAL.packageFiles]),
    nodeEngines: PUBLICATION.nodeEngines,
    pnpmDevelopmentRange: PUBLICATION.pnpmDevelopmentRange,
    packages: PACKAGE_SET.length
  });
}

function validateDependencyBundlePolicy() {
  const bundle = read('scripts/bundle_deps.sh');
  const restore = read('scripts/restore_deps.sh');
  includes(bundle, `PULSE_DEPENDENCY_TARGET_NODE_VERSION:-${PUBLICATION.nodeVersion}`, 'dependency bundle script');
  includes(bundle, 'publication.nodeEngines', 'dependency bundle script');
  includes(bundle, 'publication.nodeMinimumVersion', 'dependency bundle script');
  includes(bundle, 'publication.nodeVersion', 'dependency bundle script');
  includes(bundle, 'publication.pnpmVersion', 'dependency bundle script');
  includes(bundle, 'publication.pnpmDevelopmentRange', 'dependency bundle script');
  includes(bundle, 'restore_pulsewasm_dependencies_portable.sh <bundle.tar.zst>', 'dependency bundle script');
  excludes(bundle, '22.16.0', 'dependency bundle script');
  includes(restore, 'publication.nodeEngines', 'dependency restore script');
  includes(restore, 'publication.nodeMinimumVersion', 'dependency restore script');
  includes(restore, 'publication.nodeVersion', 'dependency restore script');
  includes(restore, 'publication.pnpmVersion', 'dependency restore script');
  includes(restore, 'publication.pnpmDevelopmentRange', 'dependency restore script');
  includes(restore, 'restore requires release-owned Node', 'dependency restore script');
  return Object.freeze({ nodeVersion: PUBLICATION.nodeVersion, nodeEngines: PUBLICATION.nodeEngines, pnpmVersion: PUBLICATION.pnpmVersion, pnpmDevelopmentRange: PUBLICATION.pnpmDevelopmentRange, restoreInstructions: true });
}

function validateConfiguration() {
  const npm = loadPublicationConfig();
  const loaded = loadDeploymentConfig(repoRoot);
  const documentation = loaded.config;
  if (npm !== PUBLICATION) fail('npm publication must be owned by release/pulse-release-manifest.json');
  if (documentation.releaseVersion !== RELEASE_VERSION) fail('documentation deployment is not release-bound');
  if (npm.environment !== 'npm-publish' || documentation.environment !== 'documentation-production') fail('protected production environment names changed unexpectedly');
  if (npm.nodeEngines !== '^22.14.0 || ^24.0.0' || npm.nodeMinimumVersion !== '22.14.0' || npm.nodeReleaseRange !== '^24.0.0' || npm.nodeVersion !== '24.18.0' || npm.npmVersion !== '11.15.0' || npm.pnpmDevelopmentRange !== '>=10 <11' || npm.pnpmVersion !== '10.0.0') {
    fail('trusted publishing policy must retain the selected Node/npm toolchain, pnpm 10.x development range, and exact release pnpm for this release');
  }
  if (documentation.deployment.neverDelete !== true || documentation.deployment.requiresNpmVerificationBeforePromotion !== true) fail('documentation history or npm promotion gates are disabled');
  if (JSON.stringify(documentation.deployment.promotionCommitObjects) !== JSON.stringify(['latest/index.html', 'index.html'])) fail('documentation promotion commit order changed unexpectedly');
  if (documentation.publicRoute.disallowGithubPagesOrigin !== true) fail('production documentation deployment must reject the legacy GitHub Pages origin');
  if (documentation.storage.awsCliMajor !== 2) fail('documentation deployment must require AWS CLI v2');
  if (documentation.storage.requestChecksumCalculation !== 'when_required' || documentation.storage.responseChecksumValidation !== 'when_required') {
    fail('Fastly Object Storage documentation deployment must use required-only AWS request and response checksums');
  }
  if (documentation.publicVerification.attempts !== 8 || documentation.publicVerification.delayMs !== 10000 || documentation.publicVerification.requestTimeoutMs !== 20000) fail('documentation public verification convergence window changed unexpectedly');
  const siteManifestCheck = documentation.publicChecks.find((entry) => entry.path === '/site-manifest.json');
  if (!siteManifestCheck || siteManifestCheck.status !== 200 || !String(siteManifestCheck.bodyIncludes || '').includes(RELEASE_VERSION)) fail('documentation public verification must prove the promoted release version');
  if (!documentation.deployment.immutableRoots.includes(`deployments/v${RELEASE_VERSION}.json`)) fail('version-specific documentation receipt is not immutable');
  if (JSON.stringify(documentation.deployment.promotionCommitObjects) !== JSON.stringify(['latest/index.html', 'index.html'])) fail('documentation promotion commit objects must preserve latest then root as the final publication points');
  if (normalizeBasePath('/') !== '/' || normalizeBasePath('/pulse/') !== '/pulse') fail('documentation public base-path normalization is invalid');
  if (publicUrl('https://docs.example.test', '/', '/') !== 'https://docs.example.test/') fail('dedicated-host root URL construction is invalid');
  if (publicUrl('https://docs.example.test', '/', '/v1.0.0-beta.1/') !== 'https://docs.example.test/v1.0.0-beta.1/') fail('dedicated-host version URL construction is invalid');
  if (publicUrl('https://docs.example.test', '/pulse', '/v1.0.0-beta.1/') !== 'https://docs.example.test/pulse/v1.0.0-beta.1/') fail('path-based version URL construction is invalid');
  if (documentation.objectPrefix !== 'pulse') fail('documentation storage prefix changed unexpectedly');
  return Object.freeze({
    npmAuthentication: npm.authentication,
    npmVersion: npm.npmVersion,
    pnpmDevelopmentRange: npm.pnpmDevelopmentRange,
    pnpmVersion: npm.pnpmVersion,
    nodeEngines: npm.nodeEngines,
    nodeMinimumVersion: npm.nodeMinimumVersion,
    nodeReleaseRange: npm.nodeReleaseRange,
    nodeVersion: npm.nodeVersion,
    dependencyBundle: validateDependencyBundlePolicy(),
    packageMetadata: validatePackageMetadata(),
    documentationSchema: documentation.schemaVersion,
    releaseVersion: RELEASE_VERSION,
    packageCount: PACKAGE_SET.length,
    channel: RELEASE_MANIFEST.channel,
    objectPrefix: documentation.objectPrefix,
    environments: Object.freeze([npm.environment, documentation.environment])
  });
}

function productionWorkflowIsManual(source, context) {
  includes(source, 'workflow_dispatch:', context);
  if (/^\s{2}(?:push|pull_request|pull_request_target|schedule|repository_dispatch):\s*$/mu.test(source)) fail(`${context} must remain manually dispatched`);
}

function validateWorkflows() {
  const required = [
    '.github/workflows/documentation.yml',
    '.github/workflows/documentation-deploy.yml',
    '.github/workflows/npm-publish.yml',
    '.github/workflows/validate.yml'
  ];
  for (const file of required) if (!exists(file)) fail(`publication workflow is missing ${file}`);

  const docs = read(required[0]);
  includes(docs, 'name: Documentation', 'documentation validation workflow');
  includes(docs, 'pull_request:', 'documentation validation workflow');
  includes(docs, 'branches: [main]', 'documentation validation workflow');
  includes(docs, 'Upload generated preview', 'documentation validation workflow');
  includes(docs, 'documentation-deployment.cjs seal', 'documentation validation workflow');
  includes(docs, 'include-hidden-files: true', 'documentation validation workflow');
  includes(docs, 'package-manager-cache: false', 'documentation validation workflow');
  includes(docs, 'publication.pnpmVersion', 'documentation validation workflow');
  includes(docs, 'corepack prepare "pnpm@$pnpm_version" --activate', 'documentation validation workflow');
  includes(docs, 'pnpm run docs:check', 'documentation validation workflow');
  includes(docs, 'pnpm run docs:site --json', 'documentation validation workflow');
  excludes(docs, 'run: npm run docs:', 'documentation validation workflow');
  for (const forbidden of ['configure-pages', 'upload-pages-artifact', 'deploy-pages', 'pages: write', 'github-pages']) excludes(docs, forbidden, 'documentation validation workflow');

  const npm = read(required[2]);
  includes(npm, 'name: npm publication', 'npm publication workflow');
  includes(npm, "node-version: '24.18.0'", 'npm publication workflow');
  excludes(npm, "node-version: '24'", 'npm publication workflow');
  productionWorkflowIsManual(npm, 'npm publication workflow');
  includes(npm, 'environment: npm-publish', 'npm publication workflow');
  includes(npm, 'id-token: write', 'npm publication workflow');
  includes(npm, 'npm install --global npm@11.15.0', 'npm publication workflow');
  includes(npm, 'publication.pnpmVersion', 'npm publication workflow');
  includes(npm, 'corepack prepare "pnpm@$pnpm_version" --activate', 'npm publication workflow');
  includes(npm, 'pnpm install --frozen-lockfile --ignore-scripts', 'npm publication workflow');
  includes(npm, 'pnpm run release:seal --skip-install --no-report', 'npm publication workflow');
  includes(npm, 'pnpm run release:pack', 'npm publication workflow');
  includes(npm, 'release-candidate.cjs prepare', 'npm publication workflow');
  includes(npm, 'publish-release.cjs audit', 'npm publication workflow');
  includes(npm, 'publish-release.cjs publish', 'npm publication workflow');
  includes(npm, 'verify-npm-release.cjs', 'npm publication workflow');
  includes(npm, 'refs/tags/$expected', 'npm publication workflow');
  includes(npm, '[ "$GITHUB_REF" = "$expected_ref" ] || fail', 'npm publication workflow');
  includes(npm, '[ "$GITHUB_REF_TYPE" = "tag" ] || fail', 'npm publication workflow');
  includes(npm, 'git rev-parse "${expected_ref}^{commit}"', 'npm publication workflow');
  includes(npm, '[ "$GITHUB_SHA" = "$commit" ] || fail', 'npm publication workflow');
  includes(npm, 'Upload candidate failure evidence', 'npm publication workflow');
  includes(npm, 'wasm/.test-results', 'npm publication workflow');
  includes(npm, 'github.run_attempt', 'npm publication workflow');
  includes(npm, 'manifest.source.ref !== expectedRef', 'npm publication workflow');
  includes(npm, 'manifest.source.commit !== process.env.GITHUB_SHA', 'npm publication workflow');
  excludes(npm, 'PULSEWASM_RETAIN_FAILED_TASK_ROOT', 'npm publication workflow');
  excludes(npm, '/tmp/pulse-suite-task-', 'npm publication workflow');
  excludes(npm, '^refs\\/tags\\/v\\d+\\.\\d+\\.\\d+$', 'npm publication workflow');
  excludes(npm, 'github.ref_name == github.event.repository.default_branch', 'npm publication workflow');
  includes(npm, 'include-hidden-files: true', 'npm publication workflow');
  includes(npm, '--json-out npm-candidate-verification.json', 'npm publication workflow');
  excludes(npm, '.pulse-publication/candidate-verification.json', 'npm publication workflow');
  includes(npm, 'package-manager-cache: false', 'npm publication workflow');
  excludes(npm, 'NODE_AUTH_TOKEN', 'npm publication workflow');
  excludes(npm, 'NPM_TOKEN', 'npm publication workflow');
  excludes(npm, 'npm dist-tag', 'npm publication workflow');
  const publishStart = npm.indexOf('\n  publish:');
  const verifyStart = npm.indexOf('\n  verify:');
  if (publishStart < 0 || verifyStart < 0 || verifyStart <= publishStart) fail('npm publication workflow must separate publish and verification jobs');
  const publishJob = npm.slice(publishStart, verifyStart);
  if (!publishJob.includes('id-token: write')) fail('the protected npm publish job must request an OIDC token');
  const withoutPublish = npm.slice(0, publishStart) + npm.slice(verifyStart);
  if (withoutPublish.includes('id-token: write')) fail('candidate, audit, and verification jobs must not request OIDC tokens');

  const publicationScript = read('scripts/release-publication.cjs');
  const publicationCli = read('scripts/publish-release.cjs');
  excludes(publicationCli, '--allow-non-github', 'npm publication CLI');
  for (const marker of [
    "'--registry', config.registry",
    'assertTrustedPublishingEnvironment',
    'expectedGitHubRepository',
    'process.env.GITHUB_REPOSITORY',
    'process.env.GITHUB_REF_TYPE',
    'nativeIdentity',
    "'--provenance'",
    "'--ignore-scripts'",
    'NPM_CONFIG_USERCONFIG'
  ]) includes(publicationScript, marker, 'npm publication implementation');

  const deploy = read(required[1]);
  const deploymentCli = read('scripts/documentation-deployment.cjs');
  excludes(deploymentCli, '--allow-non-github', 'documentation deployment CLI');
  includes(deploy, 'name: Documentation deployment', 'documentation deployment workflow');
  includes(deploy, "node-version: '24.18.0'", 'documentation deployment workflow');
  excludes(deploy, "node-version: '24'", 'documentation deployment workflow');
  productionWorkflowIsManual(deploy, 'documentation deployment workflow');
  includes(deploy, 'environment: documentation-production', 'documentation deployment workflow');
  for (const variable of [
    'FASTLY_OBJECT_STORAGE_ACCESS_KEY_ID',
    'FASTLY_OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'FASTLY_OBJECT_STORAGE_ENDPOINT',
    'FASTLY_OBJECT_STORAGE_BUCKET',
    'FASTLY_OBJECT_STORAGE_REGION',
    'PULSE_DOCUMENTATION_ORIGIN',
    'PULSE_DOCUMENTATION_BASE_PATH'
  ]) includes(deploy, variable, 'documentation deployment workflow');
  includes(deploy, 'include-hidden-files: true', 'documentation deployment workflow');
  includes(deploy, '--phase immutable', 'documentation deployment workflow');
  includes(deploy, 'verify-npm-release.cjs', 'documentation deployment workflow');
  includes(deploy, '--phase promote', 'documentation deployment workflow');
  includes(deploy, '--npm-verification npm-release-availability.json', 'documentation deployment workflow');
  includes(deploy, 'documentation-deployment.cjs verify-public', 'documentation deployment workflow');
  const immutableAt = deploy.indexOf('--phase immutable');
  const npmAt = deploy.indexOf('verify-npm-release.cjs');
  const promotionAt = deploy.indexOf('--phase promote');
  const publicAt = deploy.indexOf('documentation-deployment.cjs verify-public');
  if (!(immutableAt >= 0 && npmAt > immutableAt && promotionAt > npmAt && publicAt > promotionAt)) fail('documentation deployment order must be immutable, npm verification, promotion, then public verification');
  includes(deploy, 'package-manager-cache: false', 'documentation deployment workflow');
  includes(deploy, 'publication.pnpmVersion', 'documentation deployment workflow');
  includes(deploy, 'corepack prepare "pnpm@$pnpm_version" --activate', 'documentation deployment workflow');
  includes(deploy, 'pnpm run docs:check', 'documentation deployment workflow');
  includes(deploy, 'pnpm run docs:site --json', 'documentation deployment workflow');
  excludes(deploy, '          npm run docs:', 'documentation deployment workflow');
  includes(deploy, '[ "$GITHUB_REF" = "$expected_ref" ] || fail', 'documentation deployment workflow');
  includes(deploy, '[ "$GITHUB_REF_TYPE" = "tag" ] || fail', 'documentation deployment workflow');
  includes(deploy, 'git rev-parse "${expected_ref}^{commit}"', 'documentation deployment workflow');
  includes(deploy, '[ "$GITHUB_SHA" = "$commit" ] || fail', 'documentation deployment workflow');
  excludes(deploy, 'github.ref_name == github.event.repository.default_branch', 'documentation deployment workflow');
  const deployJobStart = deploy.indexOf('\n  deploy:');
  const deployStepsStart = deploy.indexOf('\n    steps:', deployJobStart);
  if (deployJobStart < 0 || deployStepsStart < 0) fail('documentation deployment workflow must contain a protected deploy job');
  const deployJobHeader = deploy.slice(deployJobStart, deployStepsStart);
  excludes(deployJobHeader, 'secrets.FASTLY_OBJECT_STORAGE_ACCESS_KEY_ID', 'documentation deployment job-level environment');
  excludes(deployJobHeader, 'secrets.FASTLY_OBJECT_STORAGE_SECRET_ACCESS_KEY', 'documentation deployment job-level environment');
  includes(deployJobHeader, 'AWS_REQUEST_CHECKSUM_CALCULATION: when_required', 'documentation deployment job-level environment');
  includes(deployJobHeader, 'AWS_RESPONSE_CHECKSUM_VALIDATION: when_required', 'documentation deployment job-level environment');
  const protectedConfigurationStep = deploy.indexOf('- name: Verify protected deployment configuration', deployStepsStart);
  if (protectedConfigurationStep < 0) fail('documentation deployment workflow is missing protected configuration verification');
  const preCredentialSteps = deploy.slice(deployStepsStart, protectedConfigurationStep);
  excludes(preCredentialSteps, 'secrets.FASTLY_OBJECT_STORAGE_ACCESS_KEY_ID', 'documentation deployment bootstrap steps');
  excludes(preCredentialSteps, 'secrets.FASTLY_OBJECT_STORAGE_SECRET_ACCESS_KEY', 'documentation deployment bootstrap steps');
  for (const forbidden of ['s3 sync', '--delete', 'delete-object', 'pages: write', 'deploy-pages']) excludes(deploy, forbidden, 'documentation deployment workflow');

  const validation = read(required[3]);
  includes(validation, 'name: Repository validation', 'repository validation workflow');
  includes(validation, 'node-floor:', 'repository validation workflow');
  includes(validation, "node-version: '22.x'", 'repository validation workflow');
  includes(validation, "node-version: '24.x'", 'repository validation workflow');
  includes(validation, 'publication.pnpmVersion', 'repository validation workflow');
  includes(validation, 'corepack prepare "pnpm@$pnpm_version" --activate', 'repository validation workflow');
  includes(validation, 'pnpm install --frozen-lockfile --ignore-scripts', 'repository validation workflow');
  includes(validation, 'pnpm run build', 'repository validation workflow');
  includes(validation, '--task cli-init-workflow --report .test-results/node-floor.json', 'repository validation workflow');
  includes(validation, 'Upload Node 22 failure evidence', 'repository validation workflow');
  includes(validation, 'Upload portable failure evidence', 'repository validation workflow');
  includes(validation, 'path: wasm/.test-results', 'repository validation workflow');
  includes(validation, 'include-hidden-files: true', 'repository validation workflow');

  const runner = read('wasm/scripts/run-wasm-tests.cjs');
  includes(runner, "path.join(diagnosticsDir, 'task-root-logs')", 'PulseWasm suite runner');
  includes(runner, 'copyTaskFailureLogs(taskTempRoot, diagnosticsDir)', 'PulseWasm suite runner');
  excludes(runner, 'PULSEWASM_RETAIN_FAILED_TASK_ROOT', 'PulseWasm suite runner');

  const cleanAcceptance = read('wasm/test/release/assert-clean-machine-acceptance.cjs');
  includes(cleanAcceptance, '`@pulse-compute:registry=${registryUrl}`', 'clean-machine acceptance');
  includes(cleanAcceptance, '`registry=${PUBLICATION.registry}/`', 'clean-machine acceptance');
  includes(cleanAcceptance, 'installed.version, RELEASE_VERSION', 'clean-machine acceptance');
  excludes(cleanAcceptance, 'packThirdPartyCandidates', 'clean-machine acceptance');
  excludes(cleanAcceptance, "['typescript', 'assemblyscript'", 'clean-machine acceptance');
  return Object.freeze({ files: required.length, manualProductionWorkflows: 2, pagesDeploymentRemoved: true, immutableBeforeNpmBeforePromotion: true, oidcOnlyInPublishJob: true, deploymentSecretsStepScoped: true, nodeFloor: PUBLICATION.nodeMinimumVersion, releaseNodeRange: PUBLICATION.nodeReleaseRange, releaseNode: PUBLICATION.nodeVersion });
}

function pulseDependenciesFor(entry, packageNames) {
  const manifest = readJson(`${entry.dir}/package.json`);
  const dependencies = [];
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(manifest[section] || {}).sort()) {
      if (!packageNames.has(name)) continue;
      dependencies.push(Object.freeze({ name, section, version: RELEASE_VERSION }));
    }
  }
  return Object.freeze(dependencies);
}

function syntheticPack(temp) {
  const packDir = path.join(temp, 'pack');
  ensureDirectory(packDir);
  const sourceCatalogFile = path.join(packDir, 'pulse-source-release-catalog.json');
  fs.copyFileSync(path.join(repoRoot, 'release', 'pulse-release-manifest.json'), sourceCatalogFile);
  const packageNames = new Set(PACKAGE_SET.map((entry) => entry.name));
  const packages = PACKAGE_SET.map((entry, index) => {
    const tarball = `${entry.name.replace(/^@/, '').replace(/[\/]/g, '-')}-${RELEASE_VERSION}.tgz`;
    const bytes = Buffer.from(`synthetic npm payload ${index + 1}: ${entry.name}@${RELEASE_VERSION}\n`);
    fs.writeFileSync(path.join(packDir, tarball), bytes);
    return Object.freeze({
      name: entry.name,
      version: RELEASE_VERSION,
      role: entry.role,
      supportTier: entry.tier,
      license: RELEASE_MANIFEST.license,
      legalFiles: LEGAL.packageFiles,
      nodeEngines: PUBLICATION.nodeEngines,
      documentation: entry.documentation,
      directInstall: entry.directInstall,
      entryPoints: entry.entryPoints,
      stability: entry.stability,
      tarball,
      bytes: bytes.length,
      sha256: sha256(bytes),
      sha512: sha512(bytes),
      integrity: integrity(bytes),
      shasum: shasum(bytes),
      files: 1,
      pulseDependencies: pulseDependenciesFor(entry, packageNames)
    });
  });
  const sourceBytes = fs.readFileSync(sourceCatalogFile);
  fs.writeFileSync(path.join(packDir, 'pulse-release-manifest.json'), stableJson({
    schemaVersion: PACK_SCHEMA,
    releaseVersion: RELEASE_VERSION,
    channel: RELEASE_MANIFEST.channel,
    releasedAt: RELEASE_MANIFEST.releasedAt,
    legal: LEGAL,
    sourceCatalog: {
      schemaVersion: RELEASE_MANIFEST.schemaVersion,
      path: 'release/pulse-release-manifest.json',
      sha256: sha256(sourceBytes)
    },
    documentation: DOCUMENTATION,
    packageCount: packages.length,
    packages
  }));
  return packDir;
}

function fixtureFromBundle(manifest, mode = 'unpublished') {
  const packages = {};
  for (const entry of manifest.packages) {
    const value = { versions: {}, distTags: {} };
    if (mode !== 'unpublished') {
      const published = {
        integrity: entry.integrity,
        shasum: entry.shasum,
        tarball: `https://registry.example/${encodeURIComponent(entry.name)}/-/${path.basename(entry.tarball)}`,
        dependencies: {},
        optionalDependencies: {},
        peerDependencies: {}
      };
      for (const dependency of entry.pulseDependencies || []) published[dependency.section][dependency.name] = dependency.version;
      value.versions[entry.version] = published;
      value.distTags[PUBLICATION.distTag] = entry.version;
    }
    packages[entry.name] = value;
  }
  return { packages };
}

function writeFixture(file, value) { fs.writeFileSync(file, stableJson(value)); return file; }

function validatePublicationBundle() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-publication-validation-'));
  try {
    const packDir = syntheticPack(temp);
    const bundleDir = path.join(temp, 'bundle');
    const source = { sourceCommit: 'a'.repeat(40), sourceRef: `refs/tags/v${RELEASE_VERSION}`, requireReleaseRef: true };
    expectFailure(
      () => preparePublicationBundle({ repoRoot, packDir, outDir: packDir, ...source }),
      'PULSE_NPM_PUBLICATION_UNSAFE_OUTPUT',
      'npm publication source/output overlap'
    );
    const unsafeRepository = path.join(temp, 'unsafe-repository');
    const unsafeRepositoryOutput = path.join(unsafeRepository, 'scripts');
    ensureDirectory(unsafeRepositoryOutput);
    const repositorySentinel = path.join(unsafeRepositoryOutput, 'retain-me.txt');
    fs.writeFileSync(repositorySentinel, 'retain me\n');
    expectFailure(
      () => preparePublicationBundle({ repoRoot: unsafeRepository, packDir, outDir: unsafeRepositoryOutput, ...source }),
      'PULSE_NPM_PUBLICATION_UNSAFE_OUTPUT',
      'npm publication repository output namespace'
    );
    if (!fs.existsSync(repositorySentinel)) fail('unsafe npm publication output removed repository content');
    const unrelatedOutput = path.join(temp, 'unrelated-publication-output');
    ensureDirectory(unrelatedOutput);
    const unrelatedSentinel = path.join(unrelatedOutput, 'retain-me.txt');
    fs.writeFileSync(unrelatedSentinel, 'retain me\n');
    expectFailure(
      () => preparePublicationBundle({ repoRoot, packDir, outDir: unrelatedOutput, ...source }),
      'PULSE_NPM_PUBLICATION_UNSAFE_OUTPUT',
      'npm publication unrelated output replacement'
    );
    if (!fs.existsSync(unrelatedSentinel)) fail('unsafe npm publication output removed unrelated content');
    const prepared = preparePublicationBundle({ repoRoot, packDir, outDir: bundleDir, ...source });
    const verified = verifyPublicationBundle({ repoRoot, bundleDir });
    if (prepared.packageCount !== PACKAGE_SET.length || verified.packageCount !== PACKAGE_SET.length) fail('synthetic publication bundle package count is invalid');
    if (JSON.stringify(publishOrder(verified.manifest.packages)) !== JSON.stringify(verified.publishOrder)) fail('synthetic publication order is unstable');

    const unpublished = writeFixture(path.join(temp, 'unpublished.json'), fixtureFromBundle(verified.manifest));
    const audit = auditPackageNames({ repoRoot, bundleDir, fixtureFile: unpublished });
    const plan = publicationPlan({ repoRoot, bundleDir, fixtureFile: unpublished });
    if (audit.status !== 'ok' || plan.status !== 'ready' || plan.packages.some((entry) => entry.action !== 'publish')) fail('unpublished registry fixture did not produce a publishable plan');

    const matchingFixture = fixtureFromBundle(verified.manifest, 'published');
    const matching = writeFixture(path.join(temp, 'matching.json'), matchingFixture);
    const resumed = publicationPlan({ repoRoot, bundleDir, fixtureFile: matching });
    if (resumed.status !== 'ready' || resumed.packages.some((entry) => entry.action !== 'already-published')) fail('matching registry fixture is not resumable');
    const registryVerification = verifyRegistryRelease({ repoRoot, bundleDir, fixtureFile: matching });
    const catalogVerification = verifyCatalogRelease({ repoRoot, fixtureFile: matching });
    if (registryVerification.failures !== 0 || catalogVerification.failures !== 0) fail('matching registry fixture did not verify');

    const injectedConfig = path.join(bundleDir, '.npmrc');
    fs.writeFileSync(injectedConfig, '//registry.npmjs.org/:_authToken=forbidden\n');
    expectFailure(() => verifyPublicationBundle({ repoRoot, bundleDir }), undefined, 'unsealed npm publication bundle file');
    fs.rmSync(injectedConfig, { force: true });

    const missingFixture = fixtureFromBundle(verified.manifest);
    delete missingFixture.packages[verified.manifest.packages[0].name];
    const missing = writeFixture(path.join(temp, 'missing.json'), missingFixture);
    const missingAudit = auditPackageNames({ repoRoot, bundleDir, fixtureFile: missing, allowMissing: true });
    const missingPlan = publicationPlan({ repoRoot, bundleDir, fixtureFile: missing, check: false });
    if (missingAudit.status !== 'bootstrap-required' || missingPlan.status !== 'bootstrap-required') fail('missing package name did not require bootstrap');

    const integrityFixture = fixtureFromBundle(verified.manifest, 'published');
    integrityFixture.packages[verified.manifest.packages[0].name].versions[RELEASE_VERSION].integrity = 'sha512-invalid';
    const integrityFile = writeFixture(path.join(temp, 'integrity.json'), integrityFixture);
    const integrityPlan = publicationPlan({ repoRoot, bundleDir, fixtureFile: integrityFile, check: false });
    if (integrityPlan.status !== 'conflict' || integrityPlan.packages[0].action !== 'integrity-conflict') fail('same-version integrity conflict was not rejected');

    const tagFixture = fixtureFromBundle(verified.manifest, 'published');
    tagFixture.packages[verified.manifest.packages[0].name].distTags[PUBLICATION.distTag] = '0.0.0';
    const tagFile = writeFixture(path.join(temp, 'tag.json'), tagFixture);
    const tagPlan = publicationPlan({ repoRoot, bundleDir, fixtureFile: tagFile, check: false });
    if (tagPlan.status !== 'conflict' || tagPlan.packages[0].action !== 'dist-tag-conflict') fail('matching artifact with a conflicting dist-tag was not rejected');

    const dependent = verified.manifest.packages.find((entry) => (entry.pulseDependencies || []).length > 0);
    if (!dependent) fail('synthetic publication set has no internal dependency to validate');
    const dependencyFixture = fixtureFromBundle(verified.manifest, 'published');
    const dependency = dependent.pulseDependencies[0];
    dependencyFixture.packages[dependent.name].versions[RELEASE_VERSION][dependency.section][dependency.name] = '0.0.0';
    const dependencyFile = writeFixture(path.join(temp, 'dependency.json'), dependencyFixture);
    expectFailure(
      () => verifyRegistryRelease({ repoRoot, bundleDir, fixtureFile: dependencyFile }),
      'PULSE_NPM_DEPENDENCY_MISMATCH',
      'published Pulse dependency mismatch'
    );

    const sealedManifestFile = path.join(bundleDir, 'pulse-publication-manifest.json');
    const checksumInventoryFile = path.join(bundleDir, 'sha256sums.txt');
    const originalManifestBytes = fs.readFileSync(sealedManifestFile);
    const originalChecksumInventory = fs.readFileSync(checksumInventoryFile, 'utf8');
    const metadataTamper = JSON.parse(originalManifestBytes.toString('utf8'));
    metadataTamper.packages[0].role = `${metadataTamper.packages[0].role}-tampered`;
    const metadataTamperBytes = Buffer.from(stableJson(metadataTamper));
    fs.writeFileSync(sealedManifestFile, metadataTamperBytes);
    fs.writeFileSync(
      checksumInventoryFile,
      originalChecksumInventory.replace(
        /^[0-9a-f]{64}  pulse-publication-manifest\.json$/mu,
        `${sha256(metadataTamperBytes)}  pulse-publication-manifest.json`
      )
    );
    expectFailure(
      () => verifyPublicationBundle({ repoRoot, bundleDir }),
      undefined,
      'internally checksummed publication metadata tamper'
    );
    fs.writeFileSync(sealedManifestFile, originalManifestBytes);
    fs.writeFileSync(checksumInventoryFile, originalChecksumInventory);
    verifyPublicationBundle({ repoRoot, bundleDir });

    const first = verified.manifest.packages[0];
    fs.appendFileSync(path.join(bundleDir, first.tarball), 'tamper');
    expectFailure(() => verifyPublicationBundle({ repoRoot, bundleDir }), undefined, 'tampered npm publication bundle');
    return Object.freeze({
      packageCount: verified.packageCount,
      publishOrder: verified.publishOrder,
      integrityAlgorithms: Object.freeze(['sha256', 'sha512', 'sha1']),
      tarballTamperRejected: true,
      sealedMetadataTamperRejected: true,
      unsealedFileRejected: true,
      packageBootstrapGate: true,
      resumeVerified: true,
      integrityConflictRejected: true,
      distTagConflictRejected: true,
      dependencyMismatchRejected: true,
      unsafeOutputRejected: true,
      sourceOutputOverlapRejected: true,
      unrelatedOutputRetained: true,
      catalogVerification: catalogVerification.verificationMode
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function writeSyntheticSite(siteDir) {
  const files = {
    '.nojekyll': '',
    'index.html': '<!doctype html><title>Pulse</title><h1>Pulse</h1>\n',
    '404.html': '<!doctype html><title>Not found</title><h1>Not found</h1>\n',
    'latest/index.html': `<!doctype html><meta http-equiv="refresh" content="0; url=../${DOCUMENTATION.version}/">\n`,
    'versions.json': stableJson({ latest: DOCUMENTATION.version, versions: [DOCUMENTATION.version] }),
    'site-manifest.json': stableJson({ releaseVersion: RELEASE_VERSION }),
    'public-site-manifest.json': stableJson({ releaseVersion: RELEASE_VERSION }),
    [`${DOCUMENTATION.version}/index.html`]: `<!doctype html><title>Pulse ${RELEASE_VERSION}</title><h1>Pulse ${RELEASE_VERSION}</h1>\n`,
    [`${DOCUMENTATION.version}/getting-started/index.html`]: '<!doctype html><title>Getting started</title><h1>Getting started</h1>\n',
    [`${DOCUMENTATION.version}/assets/site.css`]: 'body { font-family: system-ui; }\n'
  };
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(siteDir, relative);
    ensureDirectory(path.dirname(file));
    fs.writeFileSync(file, source);
  }
}

function npmVerificationReport() {
  return {
    schemaVersion: 'pulse.npm-publication-verification.v1',
    status: 'ok',
    releaseVersion: RELEASE_VERSION,
    releaseTag: `v${RELEASE_VERSION}`,
    channel: RELEASE_MANIFEST.channel,
    distTag: PUBLICATION.distTag,
    registry: PUBLICATION.registry,
    source: { mode: 'release-catalog', file: 'release/pulse-release-manifest.json' },
    packageCount: PACKAGE_SET.length,
    packages: PACKAGE_SET.map((entry) => ({
      name: entry.name,
      version: RELEASE_VERSION,
      distTag: PUBLICATION.distTag,
      integrity: `sha512-${Buffer.from(entry.name).toString('base64')}`,
      shasum: 'a'.repeat(40),
      pulseDependencies: []
    })),
    failures: 0,
    verificationMode: 'registry-catalog'
  };
}

function validateAwsChecksumEnvironment(temp, loaded, sourceFile) {
  const bin = path.join(temp, 'mock-aws-bin');
  const logFile = path.join(temp, 'mock-aws-calls.jsonl');
  ensureDirectory(bin);
  const aws = path.join(bin, 'aws');
  fs.writeFileSync(aws, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
const record = {
  args,
  requestChecksumCalculation: process.env.AWS_REQUEST_CHECKSUM_CALCULATION,
  responseChecksumValidation: process.env.AWS_RESPONSE_CHECKSUM_VALIDATION
};
fs.appendFileSync(process.env.AWS_CHECKSUM_PROBE_LOG, JSON.stringify(record) + '\\n');
if (record.requestChecksumCalculation !== 'when_required' || record.responseChecksumValidation !== 'when_required') process.exit(91);
if (args[0] === '--version') {
  process.stderr.write('aws-cli/2.31.0 Python/3.13.0 Linux/6 botocore/2.0.0\\n');
  process.exit(0);
}
if (args[0] === 's3api' && args[1] === 'head-object') {
  process.stderr.write('Not Found\\n');
  process.exit(254);
}
if (args[0] === 's3api' && args[1] === 'put-object') process.exit(0);
process.exit(92);
`);
  fs.chmodSync(aws, 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    AWS_CHECKSUM_PROBE_LOG: logFile,
    [loaded.config.storage.bucketVariable]: 'pulse-docs-checksum-test',
    [loaded.config.storage.regionVariable]: 'us-east',
    [loaded.config.storage.endpointVariable]: 'https://us-east.object.fastlystorage.app',
    [loaded.config.storage.accessKeySecret]: 'test-access-key',
    [loaded.config.storage.secretKeySecret]: 'test-secret-key',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'when_supported',
    AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_supported'
  };
  const adapter = awsAdapter({ repoRoot, env });
  const key = `${loaded.config.objectPrefix}/${DOCUMENTATION.version}/checksum-probe.txt`;
  if (adapter.head(key) !== undefined) fail('mock Fastly Object Storage checksum probe unexpectedly found an object');
  adapter.put(key, sourceFile, {
    contentType: 'text/plain; charset=utf-8',
    cacheControl: loaded.config.cacheClasses.immutable,
    sha256: sha256(fs.readFileSync(sourceFile))
  });
  const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  if (calls.length !== 3 || calls[0].args[0] !== '--version' || calls[1].args[1] !== 'head-object' || calls[2].args[1] !== 'put-object') {
    fail('mock Fastly Object Storage checksum probe did not exercise AWS CLI version, head, and put operations');
  }
  if (calls.some((call) => call.requestChecksumCalculation !== 'when_required' || call.responseChecksumValidation !== 'when_required')) {
    fail('Fastly Object Storage AWS operations did not receive required-only checksum settings');
  }
  return calls.length;
}

function validateDocumentationBundle() {
  const loaded = loadDeploymentConfig(repoRoot);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-documentation-deployment-validation-'));
  try {
    const siteDir = path.join(temp, 'site');
    writeSyntheticSite(siteDir);
    const candidateDir = path.join(temp, 'candidate');
    const source = { sourceCommit: 'b'.repeat(40), sourceRef: `refs/tags/v${RELEASE_VERSION}`, requireReleaseRef: true };
    expectFailure(
      () => sealDocumentationCandidate({ repoRoot, siteDir, outDir: siteDir, ...source }),
      'PULSE_DOCUMENTATION_UNSAFE_OUTPUT',
      'documentation source/output overlap'
    );
    const unsafeRepository = path.join(temp, 'unsafe-repository');
    ensureDirectory(path.join(unsafeRepository, 'release'));
    fs.copyFileSync(
      path.join(repoRoot, 'release', 'documentation-deployment.json'),
      path.join(unsafeRepository, 'release', 'documentation-deployment.json')
    );
    const unsafeRepositoryOutput = path.join(unsafeRepository, 'docs');
    ensureDirectory(unsafeRepositoryOutput);
    const repositorySentinel = path.join(unsafeRepositoryOutput, 'retain-me.txt');
    fs.writeFileSync(repositorySentinel, 'retain me\n');
    expectFailure(
      () => sealDocumentationCandidate({ repoRoot: unsafeRepository, siteDir, outDir: unsafeRepositoryOutput, ...source }),
      'PULSE_DOCUMENTATION_UNSAFE_OUTPUT',
      'documentation repository output namespace'
    );
    if (!fs.existsSync(repositorySentinel)) fail('unsafe documentation output removed repository content');
    const unrelatedOutput = path.join(temp, 'unrelated-documentation-output');
    ensureDirectory(unrelatedOutput);
    const unrelatedSentinel = path.join(unrelatedOutput, 'retain-me.txt');
    fs.writeFileSync(unrelatedSentinel, 'retain me\n');
    expectFailure(
      () => sealDocumentationCandidate({ repoRoot, siteDir, outDir: unrelatedOutput, ...source }),
      'PULSE_DOCUMENTATION_UNSAFE_OUTPUT',
      'documentation unrelated output replacement'
    );
    if (!fs.existsSync(unrelatedSentinel)) fail('unsafe documentation output removed unrelated content');
    const prepared = sealDocumentationCandidate({ repoRoot, siteDir, outDir: candidateDir, ...source });
    const verified = verifyDocumentationCandidate({ repoRoot, candidateDir, requireReleaseRef: true });
    if (!verified.immutableCount || !verified.mutableCount || verified.receipt.exactVersionObjectCount < 1) fail('documentation candidate does not contain all deployment classes and its receipt');
    const unsealedCandidateFile = path.join(candidateDir, 'unsealed.txt');
    fs.writeFileSync(unsealedCandidateFile, 'must be rejected\n');
    expectFailure(() => verifyDocumentationCandidate({ repoRoot, candidateDir, requireReleaseRef: true }), undefined, 'unsealed documentation candidate file');
    fs.rmSync(unsealedCandidateFile, { force: true });
    verifyDocumentationCandidate({ repoRoot, candidateDir, requireReleaseRef: true });
    const awsChecksumCalls = validateAwsChecksumEnvironment(temp, loaded, path.join(siteDir, 'index.html'));

    const guardedVariables = [
      'GITHUB_ACTIONS',
      'RUNNER_ENVIRONMENT',
      'GITHUB_REPOSITORY',
      'GITHUB_WORKFLOW_REF',
      'GITHUB_REF',
      'GITHUB_REF_TYPE',
      'GITHUB_SHA',
      loaded.config.publicRoute.originVariable,
      loaded.config.publicRoute.basePathVariable
    ];
    const priorEnvironment = Object.fromEntries(guardedVariables.map((name) => [name, process.env[name]]));
    try {
      delete process.env.GITHUB_ACTIONS;
      expectFailure(() => assertProductionDeploymentEnvironment(verified.manifest, { repoRoot }), undefined, 'local production documentation deployment');
      process.env.GITHUB_ACTIONS = 'true';
      process.env.RUNNER_ENVIRONMENT = 'github-hosted';
      process.env.GITHUB_REPOSITORY = 'pulse-compute/pulse';
      process.env.GITHUB_WORKFLOW_REF = `pulse-compute/pulse/.github/workflows/documentation-deploy.yml@refs/tags/v${RELEASE_VERSION}`;
      process.env.GITHUB_REF = `refs/tags/v${RELEASE_VERSION}`;
      process.env.GITHUB_REF_TYPE = 'tag';
      process.env.GITHUB_SHA = verified.manifest.source.commit;
      process.env[loaded.config.publicRoute.originVariable] = DOCUMENTATION.origin;
      process.env[loaded.config.publicRoute.basePathVariable] = DOCUMENTATION.basePath;
      if (DOCUMENTATION.origin === 'https://pulse-compute.github.io') {
        expectFailure(
          () => assertProductionDeploymentEnvironment(verified.manifest, { repoRoot }),
          'PULSE_DOCUMENTATION_PRODUCTION_ORIGIN_PENDING',
          'legacy Pages production origin'
        );
        assertProductionDeploymentEnvironment(verified.manifest, { repoRoot, allowPendingOrigin: true });
      } else {
        assertProductionDeploymentEnvironment(verified.manifest, { repoRoot });
      }
    } finally {
      for (const [name, value] of Object.entries(priorEnvironment)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }

    const npmFile = path.join(temp, 'npm-verification.json');
    writeFixture(npmFile, npmVerificationReport());
    verifyNpmPromotionEvidence(npmFile);
    const incompleteNpmReport = npmVerificationReport();
    delete incompleteNpmReport.packages[0].integrity;
    const incompleteNpmFile = path.join(temp, 'npm-verification-incomplete.json');
    writeFixture(incompleteNpmFile, incompleteNpmReport);
    expectFailure(
      () => verifyNpmPromotionEvidence(incompleteNpmFile),
      'PULSE_DOCUMENTATION_NPM_VERIFICATION_INVALID',
      'documentation promotion with incomplete npm identity evidence'
    );

    const bucketA = path.join(temp, 'bucket-a');
    ensureDirectory(bucketA);
    const first = deployDocumentation({ repoRoot, candidateDir, requireReleaseRef: true, driver: 'filesystem', bucketDir: bucketA, phase: 'immutable' });
    const retry = deployDocumentation({ repoRoot, candidateDir, requireReleaseRef: true, driver: 'filesystem', bucketDir: bucketA, phase: 'immutable' });
    verifyStorage({ repoRoot, candidateDir, requireReleaseRef: true, driver: 'filesystem', bucketDir: bucketA, phase: 'immutable' });
    if (first.uploaded !== verified.immutableCount || retry.alreadyPresent !== verified.immutableCount) fail('immutable documentation deployment is not idempotent');
    const exact = verified.manifest.objects.find((entry) => entry.phase === 'immutable' && entry.relativePath.startsWith(`${DOCUMENTATION.version}/`));
    fs.appendFileSync(path.join(bucketA, ...exact.objectKey.split('/')), 'tamper');
    expectFailure(
      () => deployDocumentation({ repoRoot, candidateDir, requireReleaseRef: true, driver: 'filesystem', bucketDir: bucketA, phase: 'immutable' }),
      'PULSE_DOCUMENTATION_IMMUTABLE_CONFLICT',
      'immutable documentation overwrite'
    );

    const bucketB = path.join(temp, 'bucket-b');
    ensureDirectory(bucketB);
    fs.writeFileSync(path.join(bucketB, 'unrelated-object.txt'), 'retain me\n');
    deployDocumentation({ repoRoot, candidateDir, requireReleaseRef: true, driver: 'filesystem', bucketDir: bucketB, phase: 'immutable' });
    expectFailure(
      () => deployDocumentation({ repoRoot, candidateDir, requireReleaseRef: true, driver: 'filesystem', bucketDir: bucketB, phase: 'mutable' }),
      'PULSE_DOCUMENTATION_NPM_VERIFICATION_REQUIRED',
      'ungated documentation promotion'
    );
    const promotion = deployDocumentation({ repoRoot, candidateDir, requireReleaseRef: true, driver: 'filesystem', bucketDir: bucketB, phase: 'mutable', npmVerification: npmFile });
    const repeatPromotion = deployDocumentation({ repoRoot, candidateDir, requireReleaseRef: true, driver: 'filesystem', bucketDir: bucketB, phase: 'mutable', npmVerification: npmFile });
    const storage = verifyStorage({ repoRoot, candidateDir, requireReleaseRef: true, driver: 'filesystem', bucketDir: bucketB, phase: 'all' });
    if (promotion.uploaded !== verified.mutableCount || repeatPromotion.alreadyPresent !== verified.mutableCount || !fs.existsSync(path.join(bucketB, 'unrelated-object.txt'))) fail('mutable documentation promotion is not idempotent or retained unrelated data');
    const promotionTail = promotion.objects.slice(-loaded.config.deployment.promotionCommitObjects.length).map((entry) => entry.key.replace(`${loaded.config.objectPrefix}/`, ''));
    if (JSON.stringify(promotionTail) !== JSON.stringify(loaded.config.deployment.promotionCommitObjects)) fail('documentation promotion commit objects were not uploaded last in release-owned order');
    return Object.freeze({
      objectCount: verified.objectCount,
      immutableObjects: verified.immutableCount,
      mutableObjects: verified.mutableCount,
      exactVersionReceiptObjects: verified.receipt.exactVersionObjectCount,
      verifiedStorageObjects: storage.objectCount,
      immutableRetryObjects: retry.alreadyPresent,
      mutableRetryObjects: repeatPromotion.alreadyPresent,
      immutabilityConflictRejected: true,
      unsealedCandidateFileRejected: true,
      npmPromotionGate: true,
      incompleteNpmEvidenceRejected: true,
      legacyPagesOriginRejected: true,
      unrelatedObjectRetained: true,
      unsafeOutputRejected: true,
      sourceOutputOverlapRejected: true,
      unrelatedOutputDirectoryRetained: true,
      promotionCommitObjectsLast: true,
      promotionCommitOrder: Object.freeze([...loaded.config.deployment.promotionCommitObjects]),
      awsChecksumCalculation: loaded.config.storage.requestChecksumCalculation,
      awsChecksumValidation: loaded.config.storage.responseChecksumValidation,
      awsChecksumCalls,
      deleteOperations: 0,
      candidateSource: prepared.source
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function validateFastlyVcl() {
  const required = [
    'infra/fastly/documentation/README.md',
    'infra/fastly/documentation/routing.vcl',
    'infra/fastly/documentation/origin-signing.vcl',
    'infra/fastly/documentation/response-policy.vcl',
    'infra/fastly/documentation/examples/host-routing.vcl',
    'infra/fastly/documentation/examples/path-routing.vcl'
  ];
  for (const file of required) if (!exists(file)) fail(`Fastly documentation infrastructure is missing ${file}`);
  const routing = read('infra/fastly/documentation/routing.vcl');
  for (const marker of ['req.method != "GET"', 'req.method != "HEAD"', 'index.html', 'return(lookup)', 'unset req.http.Cookie', 'querystring.remove(req.url)']) includes(routing, marker, 'Fastly routing VCL');
  const signing = read('infra/fastly/documentation/origin-signing.vcl');
  for (const marker of ['digest.awsv4_hmac', 'digest.hash_sha256', 'x-amz-content-sha256', 'x-amz-date', 'Authorization', 'FOS_READ_ONLY_ACCESS_KEY', 'FOS_READ_ONLY_SECRET_KEY', 'bereq.method', 'urlencode("+")']) includes(signing, marker, 'Fastly origin-signing VCL');
  const response = read('infra/fastly/documentation/response-policy.vcl');
  for (const marker of ['max-age=31536000, immutable', 'deployments/v[0-9]+', 'stale-while-revalidate=300', 'Content-Security-Policy', 'Strict-Transport-Security', 'resp.status = 404', 'obj.status == 751']) includes(response, marker, 'Fastly response-policy VCL');
  const hostRouting = read('infra/fastly/documentation/examples/host-routing.vcl');
  for (const marker of ['unset req.http.Cookie', 'querystring.remove(req.url)', '"/pulse" req.url', 'Pulse-Documentation-404 != "1"']) includes(hostRouting, marker, 'Fastly host-routing VCL');
  const expectedPrefix = `/${loadDeploymentConfig(repoRoot).config.objectPrefix}`;
  for (const [source, context] of [[routing, 'routing'], [response, 'response policy'], [hostRouting, 'host routing']]) {
    includes(source, expectedPrefix, `Fastly ${context} VCL`);
  }
  const guide = read('infra/fastly/documentation/README.md');
  for (const marker of ['read/write', 'read-only', 'never issues delete', 'not activated automatically', 'human release/infrastructure owner']) includes(guide, marker, 'Fastly infrastructure guide');
  for (const source of [routing, signing, response]) {
    if (/AKIA[0-9A-Z]{16}/.test(source)) fail('Fastly VCL appears to contain a credential rather than a placeholder');
  }
  const deploymentScript = read('scripts/documentation-deployment.cjs');
  for (const marker of [
    'assertProductionDeploymentEnvironment',
    'expectedGitHubRepository',
    'process.env.GITHUB_REPOSITORY',
    'Fastly Object Storage deployment requires AWS CLI v${config.storage.awsCliMajor}',
    "'AWS_WEB_IDENTITY_TOKEN_FILE'",
    'AWS_CONFIG_FILE: os.devNull',
    'AWS_SHARED_CREDENTIALS_FILE: os.devNull',
    'AWS_REQUEST_CHECKSUM_CALCULATION: config.storage.requestChecksumCalculation',
    'AWS_RESPONSE_CHECKSUM_VALIDATION: config.storage.responseChecksumValidation',
    "AWS_PAGER: ''",
    "AWS_CLI_AUTO_PROMPT: 'off'"
  ]) includes(deploymentScript, marker, 'documentation deployment script');
  return Object.freeze({ files: required.length, methods: Object.freeze(['GET', 'HEAD']), privateOriginSigning: 'AWS SigV4', automaticActivation: false });
}

function validatePackageScripts() {
  const manifest = readJson('package.json');
  const expected = {
    'publication:check': 'node scripts/validate-publication-workflows.cjs',
    'release:preflight': 'node scripts/release-preflight.cjs --check',
    'release:candidate': 'node scripts/release-candidate.cjs prepare --pack-dir .pulse-release --out .pulse-publication',
    'release:verify-bundle': 'node scripts/release-candidate.cjs verify --bundle-dir .pulse-publication',
    'docs:deployment:prepare': 'node scripts/documentation-deployment.cjs seal --site-dir .pulse-docs-site --out .pulse-documentation-deployment',
    'docs:deployment:verify': 'node scripts/documentation-deployment.cjs verify-candidate --candidate-dir .pulse-documentation-deployment'
  };
  for (const [name, command] of Object.entries(expected)) if (!manifest.scripts || manifest.scripts[name] !== command) fail(`package.json script ${name} must be ${command}`);
  return Object.freeze({ scripts: Object.keys(expected).length });
}

function validateDocumentation() {
  const required = [
    'docs/maintainers/npm-publishing.md',
    'docs/maintainers/documentation-deployment.md',
    'docs/architecture/current-contracts.md'
  ];
  for (const file of required) if (!exists(file)) fail(`publication documentation is missing ${file}`);
  const combined = required.map(read).join('\n');
  for (const marker of [
    'trusted publishing',
    'npm-publish',
    'documentation-production',
    'Fastly Object Storage',
    'immutable',
    'human release authority',
    'never delete'
  ]) if (!combined.toLowerCase().includes(marker.toLowerCase())) fail(`publication documentation does not explain ${marker}`);
  for (const stale of ['release/npm-publication.json', 'npm 11.6.2', 'documentation-deployment.cjs prepare', 'documentation-deployment.cjs verify-bundle']) {
    if (combined.includes(stale)) fail(`publication documentation contains stale contract ${stale}`);
  }
  return Object.freeze({ pages: required.length });
}

function validatePublicationControlPlane(options = {}) {
  const started = Date.now();
  const result = Object.freeze({
    schemaVersion: VALIDATION_SCHEMA,
    status: 'ok',
    releaseVersion: RELEASE_VERSION,
    preflight: validatePreflight(),
    configuration: validateConfiguration(),
    workflows: validateWorkflows(),
    npmPublication: validatePublicationBundle(),
    documentationDeployment: validateDocumentationBundle(),
    fastlyVcl: validateFastlyVcl(),
    packageScripts: validatePackageScripts(),
    documentation: validateDocumentation(),
    elapsedMs: Date.now() - started
  });
  if (options.jsonFile) {
    const target = path.resolve(options.jsonFile);
    ensureDirectory(path.dirname(target));
    fs.writeFileSync(target, stableJson(result));
  }
  return result;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') { options.json = true; continue; }
    if (token === '--json-out') { options.jsonFile = argv[++index]; if (!options.jsonFile) fail('--json-out requires a file'); continue; }
    if (token.startsWith('--json-out=')) { options.jsonFile = token.slice(11); continue; }
    fail(`unknown option ${token}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = validatePublicationControlPlane(options);
  if (options.json) process.stdout.write(stableJson(result));
  else process.stdout.write(`ok - ${result.configuration.packageCount} npm packages, ${result.preflight.documentation.sources} documentation sources, ${result.documentationDeployment.objectCount} documentation objects, ${result.workflows.files} publication workflows, and ${result.fastlyVcl.files} Fastly infrastructure files validated\n`);
}

module.exports = Object.freeze({
  VALIDATION_SCHEMA,
  validatePublicationControlPlane,
  validatePreflight,
  validateConfiguration,
  validateWorkflows,
  validatePublicationBundle,
  validateDocumentationBundle,
  validateFastlyVcl
});

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    if (error && error.details) process.stderr.write(stableJson(error.details));
    process.exitCode = 1;
  }
}
