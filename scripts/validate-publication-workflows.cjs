#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
  waitForRegistry,
  waitForRegistryPackages,
  publishPlannedPackages,
  verifyRegistryRelease,
  verifyCatalogRelease,
  sha256,
  sha512,
  shasum,
  integrity
} = require('./release-publication.cjs');
const { normalizeBasePath, publicUrl, loadDeploymentConfig, verifyDocumentationCandidate } = require('./documentation-deployment.cjs');
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
  includes(bundle, 'scripts/pnpm-toolchain.cjs --install', 'dependency bundle script');
  includes(bundle, 'ignoreScripts: true', 'dependency bundle script');
  includes(bundle, 'trustLockfile: false', 'dependency bundle script');
  includes(restore, '--config.trust-lockfile=true install --offline --frozen-lockfile --ignore-scripts', 'dependency restore script');
  for (const source of [bundle, restore]) includes(source, "lockfileVerification: 'verified-during-fetch-and-bound-by-sha256'", 'dependency bundle verification contract');
  includes(restore, 'bundled pnpm version mismatch', 'dependency restore script');
  return Object.freeze({ nodeVersion: PUBLICATION.nodeVersion, nodeEngines: PUBLICATION.nodeEngines, pnpmVersion: PUBLICATION.pnpmVersion, pnpmDevelopmentRange: PUBLICATION.pnpmDevelopmentRange, restoreInstructions: true });
}

function validateConfiguration() {
  const npm = loadPublicationConfig();
  const loaded = loadDeploymentConfig(repoRoot);
  const documentation = loaded.config;
  if (npm !== PUBLICATION) fail('npm publication must be owned by release/pulse-release-manifest.json');
  if (documentation.releaseVersion !== RELEASE_VERSION) fail('documentation deployment is not release-bound');
  if (npm.environment !== 'npm-publish' || documentation.environment !== 'documentation-production') fail('protected production environment names changed unexpectedly');
  if (npm.nodeEngines !== '^22.14.0 || ^24.0.0' || npm.nodeMinimumVersion !== '22.14.0' || npm.nodeReleaseRange !== '^24.0.0' || npm.nodeVersion !== '24.18.0' || npm.npmVersion !== '11.15.0') {
    fail('trusted publishing policy must retain the selected Node/npm toolchain for this release; pnpm follows the validated release manifest');
  }
  if (documentation.deployment.neverDelete !== true || documentation.deployment.requiresNpmVerificationBeforePromotion !== true) fail('documentation history or npm promotion gates are disabled');
  if (JSON.stringify(documentation.deployment.promotionCommitObjects) !== JSON.stringify(['latest/index.html', 'index.html'])) fail('documentation promotion commit order changed unexpectedly');
  if (documentation.publicRoute.disallowGithubPagesOrigin !== true) fail('production documentation deployment must reject the legacy GitHub Pages origin');
  if (documentation.storage.awsCliMajor !== 2) fail('documentation deployment must require AWS CLI v2');
  if (documentation.storage.requestChecksumCalculation !== 'when_required' || documentation.storage.responseChecksumValidation !== 'when_required') {
    fail('Fastly Object Storage documentation deployment must use required-only AWS request and response checksums');
  }
  const purge = documentation.cdnPurge;
  if (!purge || purge.method !== 'purge-all' || purge.requiredAfterPromotion !== true || purge.tokenScope !== 'purge_all') fail('documentation promotion must require a hard CDN purge');
  const environment = readJson('release/maintenance-policy.json').github.protectedEnvironments[documentation.environment];
  if (!environment.variables.includes(purge.serviceIdVariable) || !environment.secrets.includes(purge.tokenSecret)) fail('documentation CDN purge configuration must belong to the protected deployment environment');
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

function workflowJob(source, name) {
  const match = source.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][a-z0-9_-]*:|$(?![\\s\\S]))`, 'm'));
  if (!match) fail(`npm publication workflow is missing job ${name}`);
  return match[0];
}

function workflowStepScript(job, name) {
  const start = job.indexOf(`      - name: ${name}\n`);
  if (start < 0) fail(`npm publication workflow is missing step ${name}`);
  const next = job.indexOf('\n      - ', start + 1);
  const step = job.slice(start, next < 0 ? job.length : next);
  const runAt = step.indexOf('        run: |\n');
  if (runAt < 0) fail(`npm step ${name} must have a shell body`);
  return step.slice(runAt + '        run: |\n'.length).split('\n').map(line => line.replace(/^          /, '')).join('\n');
}

function validateNpmCandidateFlow(source) {
  const audit = workflowJob(source, 'audit');
  const publish = workflowJob(source, 'publish');
  const verify = workflowJob(source, 'verify');
  includes(audit, "    if: inputs.operation == 'audit' || inputs.operation == 'publish'\n", 'pre-approval audit condition');
  excludes(audit, '\n    needs:', 'audit must consume an existing qualification');
  includes(publish, '    needs: audit\n', 'protected publication dependencies');
  includes(publish, "    if: inputs.operation == 'publish'\n", 'protected publication condition');
  includes(verify, '    needs: [audit, publish]\n', 'registry verification dependencies');
  for (const job of [audit, publish]) {
    excludes(job, 'continue-on-error:', 'blocking candidate flow');
    excludes(job, '\n    if: always()', 'blocking job condition');
  }
  for (const job of [audit, verify]) {
    excludes(job, 'environment:', 'read-only release stage');
    excludes(job, 'id-token: write', 'read-only release stage');
    excludes(job, 'contents: write', 'read-only release stage');
    excludes(job, 'publish-release.cjs publish', 'read-only release stage');
  }
  for (const forbidden of ['  candidate:', '          - qualify', 'inputs.qualification_run_id']) excludes(source, forbidden, 'automatic PR consumption');
  includes(audit, 'manifest_sha256:', 'audited manifest output');
  includes(audit, 'name: Upload audit reports\n        if: always()', 'failed audit evidence');
  includes(audit, 'pulse-npm-audit-${{ github.run_id }}-${{ github.run_attempt }}', 'attempt-specific audit evidence');
  includes(publish, '${{ needs.audit.outputs.artifact_name }}', 'review packet transfer');
  includes(publish, 'AUDITED_MANIFEST_SHA256: ${{ needs.audit.outputs.manifest_sha256 }}', 'approved artifact binding');
  for (const job of [audit, publish, verify]) {
    for (const forbidden of ['release:seal', 'release:pack', 'release-candidate.cjs prepare', 'pnpm install', 'pnpm build']) excludes(job, forbidden, 'publication must reuse accepted bytes');
    includes(job, 'actions: read', 'cross-run artifact permission');
    includes(job, 'pull-requests: read', 'merged PR lookup permission');
    includes(job, 'merge-multiple: true', 'single artifact root layout');
    includes(job, 'github-token: ${{ github.token }}', 'cross-run artifact access');
  }
  includes(audit, "require('./scripts/release-qualification.cjs').resolveQualification(", 'qualification source verification');
  includes(audit, 'selection: ${{ steps.qualification.outputs.selection }}', 'pinned qualification selection');
  includes(audit, 'REQUESTED_TAG: ${{ inputs.release_tag }}', 'qualification tag selection');
  includes(audit, 'artifact-ids: ${{ steps.qualification.outputs.artifact_id }}', 'resolved artifact download');
  includes(audit, 'run-id: ${{ steps.qualification.outputs.run_id }}', 'resolved run download');
  for (const job of [publish, verify]) {
    includes(job, 'artifact-ids: ${{ needs.audit.outputs.candidate_artifact_id }}', 'audited artifact reuse');
    includes(job, 'run-id: ${{ needs.audit.outputs.qualification_run_id }}', 'audited run reuse');
  }
  for (const job of [audit, publish, verify]) {
    includes(job, "require('./scripts/release-qualification.cjs').consume({", 'authenticated artifact consumption');
    includes(job, '--qualification-binding qualification-binding.json', 'separate merge binding');
  }
  for (const job of [publish, verify]) includes(job, 'QUALIFICATION_SELECTION: ${{ needs.audit.outputs.selection }}', 'pinned selection after approval');
  includes(publish, 'name: pulse-npm-publish-${{ inputs.release_tag }}-${{ github.run_attempt }}', 'retry-safe publish report');
  includes(verify, 'name: pulse-npm-verification-${{ inputs.release_tag }}-${{ github.run_attempt }}', 'retry-safe verification report');
  return { audit, publish };
}

function validateNpmCandidateFlowProbes(source) {
  const { audit, publish } = validateNpmCandidateFlow(source);
  for (const [from, to] of [
    ['needs: audit', 'needs: candidate'],
    ['selection: ${{ steps.qualification.outputs.selection }}', 'selection: arbitrary'],
    ["if: inputs.operation == 'audit' || inputs.operation == 'publish'", "if: inputs.operation == 'audit'"],
    ['    name: audit\n', '    name: audit\n    needs: candidate\n'],
    ['artifact-ids: ${{ needs.audit.outputs.candidate_artifact_id }}', 'name: arbitrary-bundle'],
    ['  audit:\n', '  audit:\n    continue-on-error: true\n'],
    ['  audit:\n', '  audit:\n    permissions:\n      id-token: write\n'],
    ["if: inputs.operation == 'publish'", "if: always() && inputs.operation == 'publish'"]
  ]) expectFailure(() => validateNpmCandidateFlow(source.replace(from, to)), undefined, 'audit/approval dependency bypass');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-npm-flow-check-'));
  try {
    const bin = path.join(directory, 'bin');
    ensureDirectory(bin);
    fs.writeFileSync(path.join(bin, 'node'), `#!/bin/bash
set -euo pipefail
echo "$*" >> calls.log
command="$2"
shift 2
for arg in "$@"; do
  if [ "$arg" = '--json-out' ]; then write_report=true; continue; fi
  if [ "\${write_report:-false}" = true ]; then echo "$SCENARIO" > "$arg"; write_report=false; fi
done
case "$command:$SCENARIO" in
  audit:missing) [[ " $* " == *' --allow-missing '* ]] || exit 1 ;;
  plan:conflict) [[ " $* " == *' --report-only '* ]] || exit 1 ;;
esac
`, { mode: 0o755 });
    const script = workflowStepScript(audit, 'Audit package names and prepare the publication plan');
    for (const operation of ['audit', 'publish']) for (const scenario of ['ready', 'missing', 'conflict']) {
      fs.rmSync(path.join(directory, 'calls.log'), { force: true });
      for (const report of ['npm-package-name-audit.json', 'npm-publication-plan.json']) fs.rmSync(path.join(directory, report), { force: true });
      const result = spawnSync('bash', ['-c', script], { cwd: directory, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, OPERATION: operation, SCENARIO: scenario } });
      const blocked = operation === 'publish' && scenario !== 'ready';
      if (result.error || (result.status !== 0) !== blocked) fail(`pre-approval ${operation}/${scenario} probe failed`);
      const calls = fs.readFileSync(path.join(directory, 'calls.log'), 'utf8');
      if (blocked && scenario === 'missing' && calls.includes(' plan ')) fail('failed name audit reached the publication plan');
      if (operation === 'publish' && /--allow-missing|--report-only/.test(calls)) fail('publish audit used informational flags');
      if (!fs.existsSync(path.join(directory, 'npm-package-name-audit.json'))) fail('failed audit report was not retained');
      if (scenario !== 'missing' && !fs.existsSync(path.join(directory, 'npm-publication-plan.json'))) fail('publication plan report was not retained');
    }
    const binding = workflowStepScript(publish, 'Bind publication authority to the audited release tag').match(/node <<'NODE'\n([\s\S]*?)\nNODE/);
    if (!binding) fail('publication authority must bind the reviewed manifest');
    ensureDirectory(path.join(directory, 'release'));
    ensureDirectory(path.join(directory, '.pulse-qualified/publication'));
    ensureDirectory(path.join(directory, '.pulse-publication-audit'));
    fs.writeFileSync(path.join(directory, 'release/pulse-release-manifest.json'), stableJson({ releaseVersion: RELEASE_VERSION }));
    const manifest = { releaseVersion: RELEASE_VERSION, source: { commit: 'a'.repeat(40), ref: `refs/tags/v${RELEASE_VERSION}` } };
    const manifestBytes = stableJson(manifest);
    fs.writeFileSync(path.join(directory, '.pulse-qualified/publication/pulse-publication-manifest.json'), manifestBytes);
    for (const scenario of ['ready', 'changed-manifest', 'blocked-plan', 'foreign-plan']) {
      const plan = { status: scenario === 'blocked-plan' ? 'conflict' : 'ready', releaseVersion: RELEASE_VERSION,
        source: { ...manifest.source, ...(scenario === 'foreign-plan' ? { commit: 'b'.repeat(40) } : {}) } };
      fs.writeFileSync(path.join(directory, '.pulse-publication-audit/npm-publication-plan.json'), stableJson(plan));
      const result = spawnSync(process.execPath, ['-e', binding[1]], { cwd: directory, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, AUDITED_MANIFEST_SHA256: scenario === 'changed-manifest' ? '0'.repeat(64) : sha256(manifestBytes),
          GITHUB_REF: manifest.source.ref, GITHUB_SHA: scenario === 'foreign-source' ? 'b'.repeat(40) : manifest.source.commit,
          GITHUB_ENV: path.join(directory, 'github-env') } });
      if (result.error || (result.status === 0) !== (scenario === 'ready')) fail(`approved candidate ${scenario} probe failed`);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function validateQualificationSelection() {
  const result = spawnSync(process.execPath, ['wasm/test/release/assert-release-consumption.cjs'],
    { cwd: repoRoot, encoding: 'utf8', timeout: 20000 });
  if (result.error || result.status !== 0) fail(`qualification consumption probes failed: ${result.stderr || result.error}`);
}

function validatePublishedContextSmoke(source) {
  const verify = workflowJob(source, 'verify');
  const name = 'Smoke the published Pulse context app';
  const start = verify.indexOf(`      - name: ${name}\n`);
  const upload = verify.indexOf('      - name: Upload publication verification\n');
  if (start < verify.indexOf('node scripts/verify-npm-release.cjs') || upload <= start) fail('published context smoke must follow registry verification and precede evidence upload');
  const step = verify.slice(start, upload);
  excludes(step, '\n        if:', 'required published context smoke');
  excludes(verify, 'continue-on-error:', 'blocking publication verification');
  includes(step, 'timeout-minutes: 15', 'bounded context smoke');
  includes(step, "require('./release/pulse-release-manifest.json').releaseVersion", 'manifest-selected context version');
  includes(step, 'node wasm/test/mcp/smoke-context-registry.cjs "$version"', 'existing narrow registry smoke');
  includes(verify.slice(upload), 'if: always()', 'terminal verification evidence');
  includes(verify.slice(upload), 'wasm/.test-results/context-registry-smoke.json', 'context evidence upload');
  includes(verify.slice(upload), 'include-hidden-files: true', 'hidden context report directory');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-context-flow-check-'));
  try {
    const bin = path.join(directory, 'bin');
    ensureDirectory(bin);
    ensureDirectory(path.join(directory, 'release'));
    // A different fixture version rejects a hardcoded beta.7 invocation.
    const version = '9.8.7-beta.smoke';
    fs.writeFileSync(path.join(directory, 'release/pulse-release-manifest.json'), stableJson({ releaseVersion: version }));
    fs.writeFileSync(path.join(bin, 'node'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const args = process.argv.slice(2), scenario = process.env.SCENARIO;
if (args[0] === '-p' || args[0] === '-') process.exit(spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args[0] === 'scripts/verify-npm-release.cjs') {
  process.exit(scenario === 'registry-failure' || (scenario === 'cli-failure' && args.includes('--smoke')) ? 1 : 0);
}
if (args[0] !== 'wasm/test/mcp/smoke-context-registry.cjs' || args.length !== 2 || args[1] !== ${JSON.stringify(version)}) process.exit(90);
if (scenario !== 'missing-report') {
  fs.mkdirSync('wasm/.test-results', { recursive: true });
  fs.writeFileSync('wasm/.test-results/context-registry-smoke.json', JSON.stringify({ schemaVersion: 'pulse.context-registry-smoke.v1',
    status: scenario === 'context-failure' ? 'failed' : 'passed', version: scenario === 'wrong-version' ? '0.0.0' : args[1],
    cleanup: scenario === 'cleanup-failure' ? 'failed' : 'passed' }));
}
process.exit(scenario === 'context-failure' ? 1 : 0);
`, { mode: 0o755 });
    const scripts = workflowStepScript(verify, 'Verify registry integrity, dist-tags, and the published CLI') + '\n' + workflowStepScript(verify, name);
    for (const [runSmoke, scenario] of [['true', 'ready'], ['false', 'ready'], ...['registry-failure', 'cli-failure', 'context-failure', 'missing-report', 'wrong-version', 'cleanup-failure'].map(scenario => ['true', scenario])]) {
      fs.rmSync(path.join(directory, 'calls.jsonl'), { force: true });
      fs.rmSync(path.join(directory, 'wasm'), { recursive: true, force: true });
      const result = spawnSync('bash', ['-c', scripts], { cwd: directory, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, RUN_SMOKE: runSmoke, SCENARIO: scenario } });
      if (result.error || (result.status === 0) !== (scenario === 'ready')) fail(`published context ${runSmoke}/${scenario} probe failed`);
      const calls = fs.readFileSync(path.join(directory, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      if (calls[0].includes('--smoke') !== (runSmoke === 'true')) fail('existing CLI smoke selection changed');
      const upstreamFailure = ['registry-failure', 'cli-failure'].includes(scenario);
      if (calls.length !== (upstreamFailure ? 1 : 2)) fail('context smoke ran before registry/CLI success or was skipped');
      if (scenario === 'context-failure' && JSON.parse(fs.readFileSync(path.join(directory, 'wasm/.test-results/context-registry-smoke.json'), 'utf8')).status !== 'failed') fail('failed context evidence was lost');
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function validateWorkflows() {
  const required = [
    '.github/workflows/documentation.yml',
    '.github/workflows/npm-publish.yml',
    '.github/workflows/validate.yml'
  ];
  for (const file of required) if (!exists(file)) fail(`publication workflow is missing ${file}`);

  const docs = read(required[0]);
  includes(docs, 'name: Documentation', 'documentation validation workflow');
  includes(docs, 'pull_request:', 'documentation validation workflow');
  includes(docs, "branches: ['**']", 'documentation validation workflow');
  require('./documentation-check.cjs').validateSourceWorkflow(docs);
  includes(docs, 'package-manager-cache: false', 'documentation validation workflow');
  includes(docs, 'publication.pnpmVersion', 'documentation validation workflow');
  includes(docs, 'node scripts/pnpm-toolchain.cjs --install --version "$pnpm_version"', 'documentation validation workflow');
  excludes(docs, 'run: npm run docs:', 'documentation validation workflow');
  for (const forbidden of ['configure-pages', 'upload-pages-artifact', 'deploy-pages', 'pages: write', 'github-pages']) excludes(docs, forbidden, 'documentation validation workflow');

  const npm = read(required[1]);
  includes(npm, 'name: npm publication', 'npm publication workflow');
  includes(npm, "node-version: '24.18.0'", 'npm publication workflow');
  excludes(npm, "node-version: '24'", 'npm publication workflow');
  productionWorkflowIsManual(npm, 'npm publication workflow');
  includes(npm, 'environment: npm-publish', 'npm publication workflow');
  includes(npm, 'id-token: write', 'npm publication workflow');
  includes(npm, 'npm install --global npm@11.15.0', 'npm publication workflow');
  validateNpmCandidateFlowProbes(npm);
  validateQualificationSelection();
  validatePublishedContextSmoke(npm);
  const candidate = read('.github/workflows/release-qualify.yml');
  require('./release-pr-qualification.cjs').validateWorkflow(candidate);
  includes(candidate, 'timeout-minutes: 100\n', 'npm candidate job');
  includes(candidate, 'id: deadline', 'npm candidate deadline');
  includes(candidate, '$(date +%s) + 90 * 60', 'npm candidate deadline');
  includes(candidate, 'timeout-minutes: 10\n', 'npm toolchain step');
  includes(candidate, 'timeout-minutes: 92\n', 'npm seal step');
  includes(candidate, 'CANDIDATE_DEADLINE_SECONDS: ${{ steps.deadline.outputs.seconds }}', 'npm seal step');
  includes(candidate, 'remaining=$(( (CANDIDATE_DEADLINE_SECONDS - $(date +%s)) / 60 ))', 'npm seal step');
  includes(candidate, '[ "$remaining" -ge 1 ]', 'npm seal step');
  excludes(npm, 'release:seal --skip-install --no-report', 'npm publication workflow');
  includes(candidate, 'runs-on: ubuntu-24.04', 'npm candidate runner');
  includes(candidate, "SEAL_WORKERS: '2'", 'bounded candidate workers');
  includes(candidate, "SEAL_MEMORY_MIB: '6144'", 'bounded candidate memory');
  includes(candidate, "SEAL_COMPILER_WORKERS: '2'", 'bounded compiler admission');
  for (const flag of ['--workers "$SEAL_WORKERS"', '--memory-budget-mib "$SEAL_MEMORY_MIB"', '--compiler-workers "$SEAL_COMPILER_WORKERS"']) includes(candidate, flag, 'seal admission');
  for (const pin of ['v16.1.0/fastly_v16.1.0_linux-amd64.tar.gz', '48e8b1dcf9fbe44c21fac06e32c3f9f670c1e9c611776199bfe61990e6dbe7ad', 'sha256sum --check', 'PULSE_FASTLY_BIN=$PWD/.validation-tools/fastly/fastly']) includes(candidate, pin, 'release Fastly toolchain');
  includes(candidate, '            .pulse-seal\n', 'durable seal evidence upload');
  includes(npm, 'publish-release.cjs audit', 'npm publication workflow');
  includes(npm, 'publish-release.cjs publish', 'npm publication workflow');
  includes(npm, 'verify-npm-release.cjs', 'npm publication workflow');
  includes(npm, 'wasm/.test-results', 'npm publication workflow');
  includes(npm, 'github.run_attempt', 'npm publication workflow');
  excludes(npm, 'PULSEWASM_RETAIN_FAILED_TASK_ROOT', 'npm publication workflow');
  excludes(npm, '/tmp/pulse-suite-task-', 'npm publication workflow');
  excludes(npm, '^refs\\/tags\\/v\\d+\\.\\d+\\.\\d+$', 'npm publication workflow');
  excludes(npm, 'github.ref_name == github.event.repository.default_branch', 'npm publication workflow');
  includes(npm, 'include-hidden-files: true', 'npm publication workflow');
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

  require('./documentation-writer-retirement.cjs').validateWriterRetirement();

  const validation = read(required[2]);
  includes(validation, 'name: Repository validation', 'repository validation workflow');
  includes(validation, 'node-floor:', 'repository validation workflow');
  includes(validation, "node-version: '22.x'", 'repository validation workflow');
  includes(validation, "node-version: '24.x'", 'repository validation workflow');
  includes(validation, 'publication.pnpmVersion', 'repository validation workflow');
  includes(validation, 'node scripts/pnpm-toolchain.cjs --install --version "$pnpm_version"', 'repository validation workflow');
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
  return Object.freeze({ files: required.length, manualProductionWorkflows: 1, pagesDeploymentRemoved: true, oidcOnlyInPublishJob: true, nodeFloor: PUBLICATION.nodeMinimumVersion, releaseNodeRange: PUBLICATION.nodeReleaseRange, releaseNode: PUBLICATION.nodeVersion });
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

function validateRegistryConvergence() {
  const entry = { name: '@pulse-compute/wasm-host-runtime', version: RELEASE_VERSION, integrity: 'sha512-expected' };
  let clock = 0;
  const progress = [];
  const timing = { now: () => clock, sleep: (ms) => { clock += ms; }, onProgress: (event) => progress.push(event) };
  const delayed = {
    version() { return clock >= 240000 ? { integrity: entry.integrity } : undefined; },
    tags() { return { latest: clock >= 300000 ? entry.version : '0.0.0' }; }
  };
  const ready = waitForRegistry(delayed, entry, 'latest', timing);
  if (!ready.integrityMatches || !ready.distTagMatches || clock < 300000 || clock > 600000) fail('delayed npm processing did not converge within the expanded window');
  for (const state of ['waiting-for-version', 'waiting-for-tag', 'ready']) {
    if (!progress.some((event) => event.state === state)) fail(`registry progress omitted ${state}`);
  }
  if (progress.some((event) => event.retryInMs > 30000)) fail('registry polling interval exceeded 30 seconds');

  clock = 0;
  progress.length = 0;
  const timeout = expectFailure(() => waitForRegistry({
    version(name, version, lookup) {
      if (lookup.timeoutMs !== 600000 - clock) fail('registry lookup was not bounded by the remaining deadline');
      return undefined;
    },
    tags() { fail('tags were queried before the version existed'); }
  }, entry, 'latest', timing), 'PULSE_NPM_REGISTRY_DID_NOT_CONVERGE', 'registry processing deadline');
  if (clock !== 600000 || timeout.details.elapsedMs !== 600000 || progress.at(-1).state !== 'timeout') fail('registry wait did not stop at its deadline');
  if (!timeout.message.includes('same release tag and sealed candidate')) fail('registry timeout omitted the resume instructions');

  clock = 0;
  expectFailure(() => waitForRegistry({
    version() { return { integrity: 'sha512-conflict' }; },
    tags() { fail('integrity conflict queried tags instead of stopping'); }
  }, entry, 'latest', timing), 'PULSE_NPM_INTEGRITY_CONFLICT', 'immediate immutable integrity conflict');
  if (clock !== 0) fail('integrity conflict consumed a processing retry');
  expectFailure(() => waitForRegistry(delayed, entry, 'latest', { ...timing, timeoutMs: -1 }), undefined, 'invalid registry deadline');
  expectFailure(() => waitForRegistry(delayed, entry, 'latest', { ...timing, attempts: 0 }), undefined, 'invalid registry attempt limit');
  const second = { ...entry, name: '@pulse-compute/cli' };
  const skipped = { ...entry, name: '@pulse-compute/already-published' };
  clock = 0;
  const events = [];
  const uploadedAt = new Map();
  const batched = {
    version(name) {
      events.push(`read:${name}`);
      if (uploadedAt.size !== 2) fail('registry polling blocked a remaining upload');
      return clock >= uploadedAt.get(name) + 300000 ? { integrity: entry.integrity } : undefined;
    },
    tags() { return { latest: entry.version }; }
  };
  const results = publishPlannedPackages(batched, [entry, skipped, second],
    [{ action: 'publish' }, { action: 'already-published' }, { action: 'publish' }], 'latest',
    (item) => { events.push(`publish:${item.name}`); uploadedAt.set(item.name, clock); }, timing);
  if (events[0] !== `publish:${entry.name}` || events[1] !== `publish:${second.name}`) fail('ordered uploads did not precede the registry wait');
  if (clock < 300000 || clock > 330000) fail('registry processing delays were serialized across packages');
  if (results[1].action !== 'already-published' || results[0].registryIntegrity !== entry.integrity || results[2].registryIntegrity !== entry.integrity) fail('batch publication lost verified or resumed results');

  clock = 0;
  const reads = new Map();
  const partialTimeout = expectFailure(() => waitForRegistryPackages({
    version(name) { reads.set(name, (reads.get(name) || 0) + 1); return name === entry.name ? { integrity: entry.integrity } : undefined; },
    tags() { return { latest: entry.version }; }
  }, [entry, second], 'latest', timing), 'PULSE_NPM_REGISTRY_DID_NOT_CONVERGE', 'shared partial visibility deadline');
  if (clock !== 600000 || reads.get(entry.name) !== 1 || partialTimeout.details.pending.length !== 1
    || partialTimeout.details.pending[0].name !== second.name) fail('batch wait reset the deadline, repolled ready packages, or lost pending identity');

  clock = 0;
  expectFailure(() => waitForRegistryPackages({
    version(name) { return name === second.name ? { integrity: 'sha512-conflict' } : undefined; },
    tags() { fail('conflicting batch queried tags'); }
  }, [entry, second], 'latest', timing), 'PULSE_NPM_INTEGRITY_CONFLICT', 'batch integrity conflict');
  if (clock !== 0) fail('pending earlier package hid a later integrity conflict');

  let uploaded = 0;
  expectFailure(() => publishPlannedPackages({ version() { fail('failed upload started polling'); } },
    [entry, second], [{ action: 'publish' }, { action: 'publish' }], 'latest', () => {
      if (++uploaded === 2) throw Object.assign(new Error('fixture upload failure'), { code: 'FIXTURE_UPLOAD_FAILED' });
    }, timing), 'FIXTURE_UPLOAD_FAILED', 'partial upload failure');
  if (uploaded !== 2) fail('failed upload was retried');
  const resumed = publishPlannedPackages({ version() { fail('already published package was polled'); } },
    [entry], [{ action: 'already-published' }], 'latest', () => fail('already published package was uploaded'), timing);
  if (resumed[0].action !== 'already-published') fail('fully resumed release lost its result');
  return Object.freeze({ delayedVisibility: true, delayedTag: true, timeoutMs: 600000, immediateIntegrityConflict: true,
    progress: true, sharedBatchDeadline: true, orderedUploadsBeforeWait: true, pendingOnlyPolling: true, resumableUploads: true });
}

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
    const partialFixture = fixtureFromBundle(verified.manifest, 'published');
    for (const entry of verified.manifest.packages.slice(9)) partialFixture.packages[entry.name] = { versions: {}, distTags: {} };
    const partial = publicationPlan({ repoRoot, bundleDir, fixtureFile: writeFixture(path.join(temp, 'partial.json'), partialFixture) });
    if (partial.packages.filter((entry) => entry.action === 'already-published').length !== 9
      || partial.packages.filter((entry) => entry.action === 'publish').length !== PACKAGE_SET.length - 9) fail('partial release did not resume only the remaining packages');
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
    expectFailure(() => auditPackageNames({ repoRoot, bundleDir, fixtureFile: missing }), 'PULSE_NPM_BOOTSTRAP_REQUIRED', 'blocking name audit');
    expectFailure(() => publicationPlan({ repoRoot, bundleDir, fixtureFile: missing }), 'PULSE_NPM_BOOTSTRAP_REQUIRED', 'blocking bootstrap plan');

    const integrityFixture = fixtureFromBundle(verified.manifest, 'published');
    integrityFixture.packages[verified.manifest.packages[0].name].versions[RELEASE_VERSION].integrity = 'sha512-invalid';
    const integrityFile = writeFixture(path.join(temp, 'integrity.json'), integrityFixture);
    const integrityPlan = publicationPlan({ repoRoot, bundleDir, fixtureFile: integrityFile, check: false });
    if (integrityPlan.status !== 'conflict' || integrityPlan.packages[0].action !== 'integrity-conflict') fail('same-version integrity conflict was not rejected');
    const conflictReport = path.join(temp, 'blocked-plan.json');
    expectFailure(() => publicationPlan({ repoRoot, bundleDir, fixtureFile: integrityFile, jsonFile: conflictReport }), 'PULSE_NPM_PUBLICATION_CONFLICT', 'blocking immutable conflict plan');
    if (JSON.parse(fs.readFileSync(conflictReport, 'utf8')).status !== 'conflict') fail('blocking publication plan lost its failure report');

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
    'v0.0.0-history/index.html': 'historical preview bytes\n',
    'v0.0.0-history/assets/site.css': 'historical preview styles\n',
    [`${DOCUMENTATION.version}-preview/index.html`]: 'another version with the current version as a prefix\n',
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

function validateDocumentationBundle() {
  const { syntheticLegacyCandidate } = require('../wasm/test/support/legacy-documentation-candidate.cjs');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-legacy-reader-'));
  try {
    const siteDir = path.join(temp, 'source');
    writeSyntheticSite(siteDir);
    const candidateDir = path.join(temp, 'candidate');
    const result = syntheticLegacyCandidate({ repoRoot, siteDir, outDir: candidateDir });
    const failures = [
      () => fs.appendFileSync(path.join(candidateDir, 'site', DOCUMENTATION.version, 'index.html'), 'tamper'),
      () => fs.unlinkSync(path.join(candidateDir, 'site', DOCUMENTATION.version, 'index.html')),
      () => fs.writeFileSync(path.join(candidateDir, 'unsealed.json'), '{}'),
      () => fs.writeFileSync(path.join(candidateDir, 'site', 'extra.txt'), 'unexpected'),
      () => fs.writeFileSync(path.join(candidateDir, 'sha256sums.txt'), ''),
      () => { const file = path.join(candidateDir, 'documentation-deployment-manifest.json');
        const m = JSON.parse(fs.readFileSync(file)); m.source.commit = 'invalid'; fs.writeFileSync(file, stableJson(m)); },
      () => { const file = path.join(candidateDir, 'site', loadDeploymentConfig().config.deployment.receiptPath);
        const r = JSON.parse(fs.readFileSync(file)); r.exactVersionTreeSha256 = '0'.repeat(64); fs.writeFileSync(file, stableJson(r)); }
    ];
    for (const mutate of failures) {
      mutate(); let rejected = false;
      try { verifyDocumentationCandidate({ repoRoot, candidateDir }); } catch { rejected = true; }
      if (!rejected) fail('historical documentation reader accepted tampering');
      fs.rmSync(candidateDir, { recursive: true, force: true });
      syntheticLegacyCandidate({ repoRoot, siteDir, outDir: candidateDir });
    }
    return Object.freeze({ objectCount: result.objectCount, readerOnly: true, tamperingCases: failures.length });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
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
  return Object.freeze({ files: required.length, methods: Object.freeze(['GET', 'HEAD']), privateOriginSigning: 'AWS SigV4', automaticActivation: false });
}

function validatePackageScripts() {
  const manifest = readJson('package.json');
  const expected = {
    'publication:check': 'node scripts/validate-publication-workflows.cjs',
    'release:preflight': 'node scripts/release-preflight.cjs --check',
    'release:candidate': 'node scripts/release-candidate.cjs prepare --pack-dir .pulse-release --out .pulse-publication',
    'release:verify-bundle': 'node scripts/release-candidate.cjs verify --bundle-dir .pulse-publication',
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
    registryConvergence: validateRegistryConvergence(),
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
