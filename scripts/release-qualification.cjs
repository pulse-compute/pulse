'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const release = require('../release/pulse-release-manifest.json');
const producer = require('./release-pr-qualification.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
const positive = value => assert(Number.isSafeInteger(value) && value > 0, 'Invalid Actions identity');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const SCHEMA = 'pulse.release-consumption.v1';

// Discover by merged PR and exact head, never by a caller-supplied run ID or by
// "last successful". A newer unsuccessful run/attempt supersedes old evidence.
async function resolveQualification({ github, context, releaseTag }) {
  const tag = `v${release.releaseVersion}`;
  assert.equal(releaseTag, tag, 'Release tag differs from the release manifest');
  assert.equal(context.ref, `refs/tags/${tag}`, 'Dispatch from the exact release tag');
  assert.match(context.sha || '', /^[a-f0-9]{40}$/);
  const repository = `${context.repo.owner}/${context.repo.repo}`;
  assert.equal(`https://github.com/${repository}`, release.repository.web, 'Foreign release repository');
  const associated = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit,
    { ...context.repo, commit_sha: context.sha, per_page: 100 });
  const matches = associated.filter(pr => pr.merge_commit_sha === context.sha && pr.base?.ref === 'main');
  assert.equal(matches.length, 1, 'Tag must identify exactly one merged main PR');
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: matches[0].number });
  assert.equal(pr.number, matches[0].number);
  assert.equal(pr.merged, true, 'Release PR is not merged');
  assert.equal(pr.merge_commit_sha, context.sha, 'Tag moved from the merged PR');
  assert.equal(pr.base.ref, 'main');
  assert.equal(pr.base.repo?.full_name, repository, 'Foreign PR base');
  assert.equal(pr.head.repo?.full_name, repository, 'Foreign PR head');
  assert(Number.isFinite(Date.parse(pr.merged_at)), 'Missing PR merge time');
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...context.repo, workflow_id: path.basename(producer.WORKFLOW), event: 'pull_request', head_sha: pr.head.sha, per_page: 100
  });
  assert(runs.length > 0 && runs.length < 1000, 'Qualification missing or discovery limit reached; inspect PR qualification');
  for (const run of runs) positive(run.run_number);
  const latestNumber = Math.max(...runs.map(run => run.run_number));
  const latest = runs.filter(run => run.run_number === latestNumber);
  assert.equal(latest.length, 1, 'Ambiguous qualification runs');
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...context.repo, run_id: latest[0].id });
  positive(run.id); positive(run.run_attempt);
  assert.equal(run.id, latest[0].id);
  assert.equal(run.repository?.full_name, repository, 'Qualification belongs to another repository');
  assert.equal(run.head_repository?.full_name, repository, 'Qualification source belongs to another repository');
  assert.equal(run.path, producer.WORKFLOW, 'Qualification belongs to another workflow');
  assert.equal(run.event, 'pull_request', 'Qualification must run before merge on a PR');
  assert.equal(run.head_sha, pr.head.sha, 'Qualification belongs to another PR head');
  assert.equal(run.status, 'completed', 'Latest qualification is not complete');
  assert.equal(run.conclusion, 'success', 'Latest qualification did not succeed; older successes are ineligible');
  assert(Date.parse(run.created_at) <= Date.parse(pr.merged_at), 'Qualification was started after merge');
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt,
    { ...context.repo, run_id: run.id, attempt_number: run.run_attempt, per_page: 100 });
  const jobIds = {};
  for (const name of ['candidate', 'qualification']) {
    const found = jobs.filter(job => job.name === name);
    assert.equal(found.length, 1, `Qualification must contain one ${name} job`);
    assert.equal(found[0].status, 'completed'); assert.equal(found[0].conclusion, 'success', `${name} did not pass`);
    positive(found[0].id); jobIds[name] = found[0].id;
  }
  const artifactName = `${producer.ARTIFACT}-${run.id}-${run.run_attempt}`;
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, { ...context.repo, run_id: run.id, per_page: 100 });
  const accepted = artifacts.filter(artifact => artifact.name === artifactName);
  assert.equal(accepted.length, 1, 'Accepted qualification missing or ambiguous; requalify before merge');
  const artifact = accepted[0];
  positive(artifact.id);
  assert.equal(artifact.expired, false, 'Qualification expired; publication cannot rebuild it');
  assert.equal(artifact.workflow_run?.id, run.id, 'Artifact belongs to another run');
  assert.equal(artifact.workflow_run?.head_sha, run.head_sha, 'Artifact belongs to another source');
  assert.match(artifact.digest || '', /^sha256:[a-f0-9]{64}$/, 'Missing Actions artifact digest');
  return { schemaVersion: SCHEMA, repository, tag, commit: context.sha, runId: run.id, attempt: run.run_attempt,
    jobIds, artifactId: artifact.id, artifactName, artifactDigest: artifact.digest,
    pullRequest: { number: pr.number, merged: pr.merged, merged_at: pr.merged_at, merge_commit_sha: pr.merge_commit_sha,
      base: { ref: pr.base.ref, repo: { full_name: repository } }, head: { sha: pr.head.sha, repo: { full_name: repository } } } };
}

// Run after download, and again after protected approval. The pinned selection
// must still be the current eligible run/attempt/artifact before any side effect.
async function consume({ github, context, releaseTag, selection, directory, root = process.cwd(), bindingFile }) {
  const current = await resolveQualification({ github, context, releaseTag });
  assert.deepEqual(current, selection, 'Qualification was superseded or changed after selection');
  const binding = verifyConsumption({ root, directory, selection });
  fs.writeFileSync(bindingFile, `${JSON.stringify(binding, null, 2)}\n`, { flag: 'wx' });
  return binding;
}

function verifyConsumption({ root, directory, selection }) {
  assert.equal(selection.schemaVersion, SCHEMA);
  const receipt = read(path.join(directory, 'qualification.json'));
  assert.equal(receipt.runId, selection.runId, 'Receipt run differs');
  assert.equal(receipt.attempt, selection.attempt, 'Receipt attempt differs');
  assert.equal(receipt.artifact, selection.artifactName, 'Receipt artifact differs');
  assert(Date.parse(receipt.completedAt) <= Date.parse(selection.pullRequest.merged_at), 'Qualification finished after merge');
  const sealBytes = fs.readFileSync(path.join(directory, 'release-seal.json'));
  assert.equal(hash(sealBytes), receipt.sealSha256, 'Seal digest differs');
  const seal = JSON.parse(sealBytes);
  producer.assertSeal(seal, receipt);
  assert.equal(seal.recovery.contextSha256, receipt.qualificationContextSha256, 'Qualification inputs differ');
  assert.equal(require('./release-checkpoints.cjs').fingerprint(seal.recovery.context), receipt.qualificationContextSha256, 'Qualification context digest differs');
  const { repoRoot: qualifiedRoot, ...qualifiedCandidate } = seal.recovery.context.candidate;
  assert(qualifiedRoot, 'Missing qualification checkout identity');
  assert.deepEqual(qualifiedCandidate, receipt.candidate, 'Qualification context source differs');
  assert.equal(receipt.candidate.workingTree, '', 'Qualified source was dirty');
  assert.equal(hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), seal.recovery.context.lockfileSha256, 'Qualified dependency lock differs');
  assert.deepEqual(seal.featureAcceptance.separateGates, receipt.separateGates, 'Separate feature dispositions differ');
  assert.equal(hash(fs.readFileSync(path.join(directory, 'publication/pulse-publication-manifest.json'))), receipt.bundleManifestSha256, 'Package manifest digest differs');
  assert.equal(hash(fs.readFileSync(path.join(directory, 'documentation/documentation-deployment-manifest.json'))), receipt.documentationManifestSha256, 'Docs manifest digest differs');
  const publication = require('./release-publication.cjs').verifyPublicationBundle({ repoRoot: root, bundleDir: path.join(directory, 'publication') });
  const documentation = require('./documentation-deployment.cjs').verifyDocumentationCandidate({ repoRoot: root, candidateDir: path.join(directory, 'documentation') });
  const source = { commit: receipt.candidate.sourceRevision, ref: receipt.sourceRef };
  assert.deepEqual(publication.source, source, 'Package source differs');
  assert.deepEqual(documentation.source, source, 'Docs source differs');
  const merge = producer.verifyMergeBinding({ root, receipt, pullRequest: selection.pullRequest, repository: selection.repository, tag: selection.tag });
  assert.equal(merge.commit, selection.commit);
  assert.equal(git(root, ['rev-parse', 'HEAD']), selection.commit, 'Checkout differs from dispatch');
  return { schemaVersion: SCHEMA, selection, receipt, merge };
}

// Separate release authority from immutable artifact provenance. Only the
// workflow's freshly authenticated binding can admit a PR-source artifact.
function validateBoundSource({ root, bindingFile, manifestFile, source, kind, env = process.env }) {
  assert(['publication', 'documentation'].includes(kind), 'Invalid bound artifact kind');
  assert(bindingFile, 'PR-source artifacts require an authenticated qualification binding');
  const binding = read(bindingFile);
  assert.equal(binding.schemaVersion, SCHEMA);
  const { selection, receipt, merge } = binding;
  assert.equal(selection.schemaVersion, SCHEMA);
  assert.equal(selection.repository, env.GITHUB_REPOSITORY);
  assert.equal(selection.tag, `v${release.releaseVersion}`);
  assert.equal(env.GITHUB_REF, `refs/tags/${selection.tag}`);
  assert.equal(env.GITHUB_SHA, selection.commit);
  assert.equal(git(root, ['rev-parse', 'HEAD']), selection.commit, 'Checkout differs from release authority');
  assert.deepEqual(producer.verifyMergeBinding({ root, receipt, pullRequest: selection.pullRequest, repository: selection.repository, tag: selection.tag }), merge);
  assert.equal(merge.commit, selection.commit);
  assert.deepEqual(source, { commit: merge.qualifiedSource, ref: receipt.sourceRef });
  const expected = kind === 'publication' ? receipt.bundleManifestSha256 : receipt.documentationManifestSha256;
  assert.equal(hash(fs.readFileSync(manifestFile)), expected, 'Bound manifest changed');
  return binding;
}

module.exports = { SCHEMA, resolveQualification, consume, verifyConsumption, validateBoundSource };
