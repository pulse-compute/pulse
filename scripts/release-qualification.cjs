'use strict';

const assert = require('node:assert/strict');
const release = require('../release/pulse-release-manifest.json');

// Resolve only a completed qualification from this workflow and exact source.
// Artifact IDs remain fixed through approval and publication retries.
async function resolveQualification({ github, context, runId, releaseTag }) {
  assert.match(String(runId || ''), /^[1-9][0-9]*$/, 'Provide a successful qualification_run_id; run operation=qualify first');
  const id = Number(runId);
  assert(Number.isSafeInteger(id), 'Invalid qualification_run_id');
  const tag = `v${release.releaseVersion}`;
  assert.equal(releaseTag, tag, 'Release tag differs from the release manifest');
  assert.equal(context.ref, `refs/tags/${tag}`, 'Dispatch audit/publish from the exact release tag');
  const repository = `${context.repo.owner}/${context.repo.repo}`;
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...context.repo, run_id: id });
  assert.equal(run.repository?.full_name, repository, 'Qualification belongs to another repository');
  assert.equal(run.head_repository?.full_name, repository, 'Qualification source belongs to another repository');
  assert.equal(run.path, `.github/workflows/${release.publication.workflowFile}`, 'Qualification belongs to another workflow');
  assert.equal(run.event, 'workflow_dispatch', 'Qualification must be manually dispatched');
  assert.equal(run.head_branch, tag, 'Qualification belongs to another tag');
  assert.equal(run.head_sha, context.sha, 'Qualification belongs to another commit');
  assert.equal(run.status, 'completed', 'Qualification is not complete');
  assert.equal(run.conclusion, 'success', 'Qualification did not succeed');
  assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, 'Invalid qualification attempt');
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
    ...context.repo, run_id: id, attempt_number: run.run_attempt, per_page: 100
  });
  const candidates = jobs.filter(job => job.name === 'candidate');
  assert.equal(candidates.length, 1, 'Qualification must contain one candidate job');
  assert.equal(candidates[0].status, 'completed', 'Candidate job is not complete');
  assert.equal(candidates[0].conclusion, 'success', 'Candidate qualification did not pass');
  const name = `${release.publication.candidateArtifact}-${tag}-${run.run_attempt}`;
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
    ...context.repo, run_id: id, per_page: 100
  });
  const matches = artifacts.filter(artifact => artifact.name === name);
  assert.equal(matches.length, 1, 'Accepted bundle is missing or ambiguous; retain the successful qualification artifact');
  const artifact = matches[0];
  assert.equal(artifact.expired, false, 'Qualification bundle has expired');
  assert.equal(artifact.workflow_run?.id, id, 'Artifact belongs to another run');
  assert.equal(artifact.workflow_run?.head_sha, context.sha, 'Artifact belongs to another commit');
  assert(Number.isSafeInteger(artifact.id) && artifact.id > 0, 'Invalid qualification artifact ID');
  return { runId: id, attempt: run.run_attempt, artifactId: artifact.id };
}

module.exports = { resolveQualification };
