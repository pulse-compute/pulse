'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkReleasePr } = require('./release-pr-check.cjs');
const { candidateIdentity } = require('./release-feature-acceptance.cjs');
const { atomicJson } = require('./release-recovery.cjs');
const SCHEMA = 'pulse.release-pr-qualification.v1';
const WORKFLOW = '.github/workflows/release-qualify.yml';
const ARTIFACT = 'pulse-pr-release-qualification';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
const sha = (value, label) => { assert.match(value || '', /^[a-f0-9]{40}$/, `Invalid ${label}`); return value; };
const positive = (value, label) => { const n = Number(value); assert(Number.isSafeInteger(n) && n > 0, `Invalid ${label}`); return n; };

function validateWorkflow(source) {
  for (const value of ['name: Release qualification', 'branches: [main]', 'ready_for_review',
    'contents: read', 'pull-requests: read', 'ref: ${{ github.sha }}', 'persist-credentials: false',
    'release-pr-qualification.cjs identify', 'release-pr-qualification.cjs capture',
    'release:seal --skip-install', '--require-fastly', "node-version: '24.18.0'",
    "SEAL_WORKERS: '2'", "SEAL_MEMORY_MIB: '6144'", "SEAL_COMPILER_WORKERS: '1'",
    'timeout-minutes: 100', 'retention-days: 30', 'if-no-files-found: error',
    'pulse-pr-release-qualification-${{ github.run_id }}-${{ github.run_attempt }}',
    'if: always()', 'needs: candidate', 'name: qualification', 'test "$CANDIDATE_RESULT" = success'])
    assert(source.includes(value), `Release qualification workflow missing ${value}`);
  assert(!/pull_request_target:|workflow_dispatch:|\bpush:|\bpaths:|secrets\.|id-token:|environment:|: write\b/.test(source),
    'PR qualification must be unprivileged, unfiltered and PR-only');
  assert(source.indexOf('release-pr-qualification.cjs identify') < source.indexOf('pnpm install'), 'Preparation must precede installation');
  assert.equal((source.match(/\.assertCurrent\(/g) || []).length, 2, 'Check live source before and after the seal');
  const seal = source.indexOf('release:seal --skip-install');
  assert(source.indexOf('.assertCurrent(') < seal && source.lastIndexOf('.assertCurrent(') > seal);
  const contract = require('../release/maintenance-policy.json');
  assert(contract.github.validationTiers.main.additionalRequiredStatusChecks.includes('Release qualification / qualification'));
  return { status: 'ok', workflow: WORKFLOW, check: 'Release qualification / qualification' };
}

function identify({ root, event, env = process.env }) {
  assert.equal(env.GITHUB_EVENT_NAME, 'pull_request', 'Qualification requires a pull_request event');
  const pr = event.pull_request;
  assert(pr && pr.state === 'open' && !pr.draft, 'Qualification requires an open, ready PR');
  const repository = env.GITHUB_REPOSITORY;
  assert.equal(repository, event.repository?.full_name, 'Event repository differs');
  assert.equal(pr.base.repo?.full_name, repository, 'Foreign base repository');
  assert.equal(pr.head.repo?.full_name, repository, 'Release qualification requires a same-repository PR');
  assert.equal(pr.base.ref, 'main', 'Release qualification requires main as its base');
  const number = positive(pr.number, 'PR number');
  const sourceRef = `refs/pull/${number}/merge`;
  assert.equal(env.GITHUB_REF, sourceRef, 'Qualification requires the PR merge ref');
  const candidate = candidateIdentity(root);
  assert.equal(candidate.sourceRevision, sha(env.GITHUB_SHA, 'workflow SHA'), 'Checkout differs from workflow source');
  const base = sha(pr.base.sha, 'base SHA'), head = sha(pr.head.sha, 'head SHA');
  const parents = git(root, ['show', '-s', '--format=%P', candidate.sourceRevision]).split(' ');
  assert.deepEqual(parents, [base, head], 'Merge candidate parents differ from the PR base/head');
  const read = (ref, file) => git(root, ['show', `${ref}:${file}`]);
  const preparation = checkReleasePr({
    baseManifest: JSON.parse(read(base, 'release/pulse-release-manifest.json')),
    headManifest: JSON.parse(read(candidate.sourceRevision, 'release/pulse-release-manifest.json')),
    changedFiles: execFileSync('git', ['diff', '--name-only', '-z', base, candidate.sourceRevision], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean),
    readHead: file => read(candidate.sourceRevision, file)
  });
  return { schemaVersion: SCHEMA, repository, workflow: WORKFLOW,
    runId: positive(env.GITHUB_RUN_ID, 'run ID'), attempt: positive(env.GITHUB_RUN_ATTEMPT, 'attempt'),
    pullRequest: number, base, head, sourceRef, candidate, preparation,
    releaseTag: `v${preparation.version}`, required: preparation.preparedRelease };
}

// Query at both ends of qualification. Branch protection must also require an
// up-to-date main base: a base push after this check cannot be prevented here.
async function assertCurrent({ github, context, identity }) {
  assert.equal(`${context.repo.owner}/${context.repo.repo}`, identity.repository, 'Current repository differs');
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: identity.pullRequest });
  assert.equal(pr.state, 'open', 'PR is no longer open');
  assert.equal(pr.draft, false, 'PR is no longer ready');
  assert.equal(pr.base.ref, 'main');
  assert.equal(pr.base.repo?.full_name, identity.repository);
  assert.equal(pr.head.repo?.full_name, identity.repository);
  assert.equal(pr.base.sha, identity.base, 'PR base changed; update the branch and requalify');
  assert.equal(pr.head.sha, identity.head, 'PR head changed; requalify');
  const { data: base } = await github.rest.git.getRef({ ...context.repo, ref: 'heads/main' });
  assert.equal(base.object.sha, identity.base, 'Main moved; update the branch and requalify');
  assert.equal(pr.merge_commit_sha, identity.candidate.sourceRevision, 'PR merge candidate changed or is not ready; requalify');
}

function assertSeal(seal, identity) {
  assert.equal(identity.required, true, 'A non-release PR cannot produce a qualification');
  assert.equal(seal.schemaVersion, 'pulse.release-seal.v1');
  assert.equal(seal.status, 'passed', 'Seal did not pass');
  assert(seal.completedAt, 'Seal is not terminal');
  assert.deepEqual(seal.candidate, identity.candidate, 'Seal candidate differs');
  assert.equal(seal.sourceRevision, identity.candidate.sourceRevision, 'Seal revision differs');
  assert.equal(seal.recovery?.context.options.requireFastly, true, 'Fastly must be required');
  assert.equal(seal.externalFastly?.status, 'passed', 'Fastly reality did not pass');
  assert.equal(seal.cleanup?.status, 'passed', 'Seal cleanup did not pass');
}

function capture(root, identity, output) {
  assert.deepEqual(candidateIdentity(root), identity.candidate, 'Source changed after qualification');
  const sealFile = path.join(root, 'wasm/.test-results/release-seal.json');
  const sealBytes = fs.readFileSync(sealFile), seal = JSON.parse(sealBytes);
  assertSeal(seal, identity);
  require('./release-evidence-bundle.cjs').validateRecoveryEvidence(seal);
  assert.equal(hash(fs.readFileSync(seal.sourceChecks.file)), seal.sourceChecks.sha256, 'Source-check receipt changed');
  const checked = JSON.parse(fs.readFileSync(seal.sourceChecks.file));
  assert.deepEqual(checked.candidate, identity.candidate, 'Docs source checks differ');
  const docs = checked.documentationCandidate;
  assert(docs, 'Qualification has no prebuilt documentation candidate');
  assert.deepEqual(require('./release-recovery.cjs').describeArtifact(docs.directory),
    { kind: docs.kind, sha256: docs.sha256 }, 'Validated documentation changed');
  const documentationDir = path.join(output, 'documentation');
  assert(!fs.existsSync(documentationDir), 'Capture output already contains documentation');
  fs.cpSync(docs.directory, documentationDir, { recursive: true, errorOnExist: true });
  const documentation = require('./documentation-deployment.cjs').verifyDocumentationCandidate({ repoRoot: root, candidateDir: documentationDir });
  assert.deepEqual(documentation.source, { commit: identity.candidate.sourceRevision, ref: identity.sourceRef });
  // Never rebuild or relabel accepted bytes. The publication consumer
  // must verify the merge binding separately and retain this original source.
  const pack = path.join(root, '.pulse-release');
  const shared = require('./release-shared-pack.cjs');
  shared.copySharedPack({ repoRoot: root, outDir: pack }, shared.sharedPackEnv(path.join(seal.recovery.directory, 'packages')));
  const publication = require('./release-publication.cjs');
  const bundleDir = path.join(output, 'publication');
  publication.preparePublicationBundle({ repoRoot: root, packDir: pack, outDir: bundleDir,
    sourceCommit: identity.candidate.sourceRevision, sourceRef: identity.sourceRef });
  const verified = publication.verifyPublicationBundle({ repoRoot: root, bundleDir });
  assert.deepEqual(verified.source, { commit: identity.candidate.sourceRevision, ref: identity.sourceRef });
  fs.writeFileSync(path.join(output, 'release-seal.json'), sealBytes);
  const receipt = { ...identity, status: 'passed', completedAt: new Date().toISOString(),
    artifact: `${ARTIFACT}-${identity.runId}-${identity.attempt}`,
    documentationManifestSha256: hash(fs.readFileSync(path.join(documentationDir, 'documentation-deployment-manifest.json'))),
    sealSha256: hash(sealBytes), bundleManifestSha256: hash(fs.readFileSync(path.join(bundleDir, 'pulse-publication-manifest.json'))),
    // Contains only hashes/tool identities/options; environment values stay private.
    qualificationContextSha256: seal.recovery.contextSha256,
    separateGates: seal.featureAcceptance.separateGates };
  atomicJson(path.join(output, 'qualification.json'), receipt);
  assert.deepEqual(candidateIdentity(root), identity.candidate, 'Source changed while capturing qualification');
  return receipt;
}

// Consumption calls this only after authenticating the Actions run/attempt/artifact
// and verifying the bundle and receipt hashes. It creates a separate binding,
// never mutates the qualified source identity or any published bytes.
function verifyMergeBinding({ root, receipt, pullRequest, repository, tag }) {
  assert.equal(receipt.schemaVersion, SCHEMA);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.required, true);
  assert.equal(receipt.repository, repository);
  assert.equal(receipt.workflow, WORKFLOW);
  sha(receipt.candidate?.sourceRevision, 'qualified source');
  sha(receipt.candidate?.sourceTree, 'qualified tree');
  sha(receipt.base, 'qualified base');
  sha(receipt.head, 'qualified head');
  assert.equal(receipt.sourceRef, `refs/pull/${receipt.pullRequest}/merge`);
  assert.equal(tag, receipt.releaseTag);
  assert.match(tag, /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(pullRequest.number, receipt.pullRequest);
  assert.equal(pullRequest.merged, true, 'PR must be merged');
  assert.equal(pullRequest.base.ref, 'main');
  assert.equal(pullRequest.base.repo?.full_name, repository);
  assert.equal(pullRequest.head.repo?.full_name, repository);
  assert.equal(pullRequest.head.sha, receipt.head, 'Merged PR head differs');
  const commit = sha(pullRequest.merge_commit_sha, 'merged commit');
  assert.equal(git(root, ['rev-parse', `refs/tags/${tag}^{commit}`]), commit, 'Tag differs from merged PR');
  assert.equal(git(root, ['rev-parse', `${commit}^{tree}`]), receipt.candidate.sourceTree, 'Merged tree differs');
  const parents = git(root, ['show', '-s', '--format=%P', commit]).split(' ');
  assert(parents.length === 1 || parents.length === 2, 'Unsupported merge strategy');
  assert.equal(parents[0], receipt.base, 'Main base changed after qualification');
  if (parents.length === 2) assert.equal(parents[1], receipt.head, 'Merge parent differs');
  return { schemaVersion: 'pulse.release-merge-binding.v1', qualifiedSource: receipt.candidate.sourceRevision,
    sourceTree: receipt.candidate.sourceTree, commit, tag, pullRequest: receipt.pullRequest,
    strategy: parents.length === 2 ? 'merge' : 'squash' };
}

module.exports = { SCHEMA, WORKFLOW, ARTIFACT, validateWorkflow, identify, assertCurrent, assertSeal, capture, verifyMergeBinding };
if (require.main === module) {
  try {
    const [command, file, output] = process.argv.slice(2);
    const root = path.resolve(__dirname, '..');
    if (command === 'identify' && file && !output) {
      const identity = identify({ root, event: JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) });
      atomicJson(file, identity);
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `required=${identity.required}\n`);
      console.log(JSON.stringify(identity, null, 2));
    } else if (command === 'capture' && file && output) {
      console.log(JSON.stringify(capture(root, JSON.parse(fs.readFileSync(file, 'utf8')), path.resolve(output)), null, 2));
    } else throw new Error('Usage: release-pr-qualification.cjs identify <identity.json> | capture <identity.json> <output-dir>');
  } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
