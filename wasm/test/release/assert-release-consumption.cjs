'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const owner = require('../../../scripts/release-qualification.cjs');
const producer = require('../../../scripts/release-pr-qualification.cjs');
const release = require('../../../release/pulse-release-manifest.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const tag = `v${release.releaseVersion}`, repository = 'pulse-compute/pulse';
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-consumption-'));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const json = file => JSON.parse(fs.readFileSync(file));
async function main() {
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  write(path.join(repo, 'pnpm-lock.yaml'), 'fixture lock'); write(path.join(repo, 'source'), 'base'); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  write(path.join(repo, 'source'), 'qualified'); git('add', '.'); git('commit', '-qm', 'head'); const head = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const qualified = git('commit-tree', tree, '-p', base, '-p', head, '-m', 'qualified');
  const merged = git('commit-tree', tree, '-p', base, '-m', 'squashed'); git('checkout', '-q', '--detach', merged); git('tag', tag);
  const context = { repo: { owner: 'pulse-compute', repo: 'pulse' }, ref: `refs/tags/${tag}`, sha: merged };
  function fixture() {
    const pr = { number: 17, merged: true, merged_at: '2026-10-09T04:00:00Z', merge_commit_sha: merged,
      base: { ref: 'main', repo: { full_name: repository } }, head: { sha: head, repo: { full_name: repository } } };
    const run = { id: 123, run_number: 9, run_attempt: 2, path: producer.WORKFLOW, event: 'pull_request', head_sha: head,
      repository: { full_name: repository }, head_repository: { full_name: repository }, status: 'completed', conclusion: 'success', created_at: '2026-10-09T01:00:00Z' };
    const data = { pr, runs: [run], run, jobs: ['candidate', 'qualification'].map((name, i) => ({ id: i + 10, name, status: 'completed', conclusion: 'success' })),
      artifacts: [{ id: 456, name: `${producer.ARTIFACT}-123-2`, expired: false, digest: `sha256:${'a'.repeat(64)}`, workflow_run: { id: 123, head_sha: head } }] };
    data.associated = [pr];
    data.github = { rest: { repos: { listPullRequestsAssociatedWithCommit: 'prs' }, pulls: { get: async () => ({ data: data.pr }) },
      actions: { listWorkflowRuns: 'runs', getWorkflowRun: async () => ({ data: data.run }), listJobsForWorkflowRunAttempt: 'jobs', listWorkflowRunArtifacts: 'artifacts' } },
      paginate: async (method, args) => {
        if (method === 'runs') { assert.equal(args.head_sha, head); assert.equal(args.event, 'pull_request'); assert.equal(args.workflow_id, 'release-qualify.yml'); }
        if (method === 'jobs') assert.equal(args.attempt_number, data.run.run_attempt);
        return data[method === 'prs' ? 'associated' : method];
      } };
    return data;
  }
  const resolve = d => owner.resolveQualification({ github: d.github, context, releaseTag: tag });
  const good = fixture(); const selection = await resolve(good);
  assert.equal(selection.artifactId, 456); assert.equal(selection.attempt, 2); assert.equal(selection.jobIds.qualification, 11);
  // Historical successes do not win over the latest run, including failed reruns.
  const old = fixture(); old.runs.push({ ...old.run, id: 100, run_number: 8 }); assert.deepEqual(await resolve(old), selection);
  const mutations = {
    'missing PR': d => { d.associated = []; }, 'ambiguous PR': d => { d.associated.push({ ...d.pr }); },
    'unmerged PR': d => { d.pr.merged = false; }, 'foreign head': d => { d.pr.head.repo.full_name = 'fork/pulse'; },
    'missing run': d => { d.runs = []; }, 'ambiguous run': d => { d.runs.push({ ...d.run }); },
    'foreign repo': d => { d.run.repository.full_name = 'foreign/pulse'; },
    'foreign workflow': d => { d.run.path = '.github/workflows/npm-publish.yml'; },
    'foreign event': d => { d.run.event = 'workflow_dispatch'; }, 'wrong source': d => { d.run.head_sha = base; },
    'failed latest': d => { d.run.conclusion = 'failure'; }, 'pending latest': d => { d.run.status = 'in_progress'; },
    'invalid attempt': d => { d.run.run_attempt = 0; }, 'after merge': d => { d.run.created_at = '2026-10-09T05:00:00Z'; },
    'missing candidate': d => { d.jobs.shift(); }, 'duplicate candidate': d => { d.jobs.push({ ...d.jobs[0] }); },
    'skipped gate': d => { d.jobs[1].conclusion = 'skipped'; }, 'old attempt': d => { d.artifacts[0].name = `${producer.ARTIFACT}-123-1`; },
    'missing artifact': d => { d.artifacts = []; }, 'ambiguous artifact': d => { d.artifacts.push({ ...d.artifacts[0] }); },
    'expired artifact': d => { d.artifacts[0].expired = true; }, 'foreign artifact': d => { d.artifacts[0].workflow_run.id = 999; },
    'foreign artifact source': d => { d.artifacts[0].workflow_run.head_sha = base; }, 'missing digest': d => { delete d.artifacts[0].digest; }
  };
  for (const [name, change] of Object.entries(mutations)) { const d = fixture(); change(d); await assert.rejects(() => resolve(d), undefined, name); }
  await assert.rejects(() => owner.resolveQualification({ github: good.github, context: { ...context, ref: 'refs/heads/main' }, releaseTag: tag }));
  await assert.rejects(() => owner.resolveQualification({ github: good.github, context, releaseTag: 'v0.0.0' }));

  const directory = path.join(repo, 'accepted'), bindingFile = path.join(repo, 'binding.json');
  const source = { commit: qualified, ref: 'refs/pull/17/merge' };
  const candidate = { sourceRevision: qualified, sourceTree: tree, workingTree: '' };
  const seal = { schemaVersion: 'pulse.release-seal.v1', status: 'passed', completedAt: '2026-10-09T02:00:00Z',
    sourceRevision: qualified, candidate, recovery: { context: { options: { requireFastly: true }, candidate: { ...candidate, repoRoot: repo }, lockfileSha256: hash(fs.readFileSync(path.join(repo, 'pnpm-lock.yaml'))) } },
    externalFastly: { status: 'passed' }, cleanup: { status: 'passed' }, featureAcceptance: { separateGates: [] } };
  seal.recovery.contextSha256 = require('../../../scripts/release-checkpoints.cjs').fingerprint(seal.recovery.context);
  const files = { seal: path.join(directory, 'release-seal.json'), pub: path.join(directory, 'publication/pulse-publication-manifest.json'),
    docs: path.join(directory, 'documentation/documentation-deployment-manifest.json'), receipt: path.join(directory, 'qualification.json') };
  write(files.seal, seal); write(files.pub, { source }); write(files.docs, { source });
  const receipt = { schemaVersion: producer.SCHEMA, status: 'passed', required: true, repository, workflow: producer.WORKFLOW,
    releaseTag: tag, runId: 123, attempt: 2, artifact: selection.artifactName, pullRequest: 17, base, head, sourceRef: source.ref, candidate,
    completedAt: '2026-10-09T03:00:00Z', sealSha256: hash(fs.readFileSync(files.seal)), bundleManifestSha256: hash(fs.readFileSync(files.pub)),
    documentationManifestSha256: hash(fs.readFileSync(files.docs)), qualificationContextSha256: seal.recovery.contextSha256, separateGates: [] };
  write(files.receipt, receipt);
  // Inventory verification is tested with real package/site fixtures by the
  // publication control plane. Isolate those owners here to test provenance.
  const Module = require('node:module'), load = Module._load;
  Module._load = function(request, parent, ...rest) {
    if (parent?.filename.endsWith('/scripts/release-qualification.cjs')) {
      if (request === './release-publication.cjs') return { verifyPublicationBundle() { return json(files.pub); } };
      if (request === './documentation-deployment.cjs') return { verifyDocumentationCandidate() { return json(files.docs); } };
    }
    return load.call(this, request, parent, ...rest);
  };
  try {
    const consume = () => owner.consume({ github: good.github, context, releaseTag: tag, selection, directory, root: repo, bindingFile });
    const binding = await consume(); assert.equal(binding.merge.strategy, 'squash'); assert.equal(binding.merge.qualifiedSource, qualified);
    const env = { GITHUB_REPOSITORY: repository, GITHUB_REF: context.ref, GITHUB_SHA: merged };
    const bound = () => owner.validateBoundSource({ root: repo, bindingFile, manifestFile: files.pub, source, kind: 'publication', env });
    bound();
    env.GITHUB_SHA = head; assert.throws(bound); env.GITHUB_SHA = merged;
    env.GITHUB_REF = 'refs/heads/main'; assert.throws(bound); env.GITHUB_REF = context.ref;
    for (const change of [r => { r.attempt = 1; }, r => { r.runId = 999; }, r => { r.base = head; }, r => { r.head = base; },
      r => { r.candidate.sourceTree = head; }, r => { r.repository = 'foreign/pulse'; }, r => { r.workflow = 'wrong'; },
      r => { r.completedAt = '2026-10-09T05:00:00Z'; }, r => { r.qualificationContextSha256 = 'f'.repeat(64); }]) {
      const r = structuredClone(receipt); change(r); write(files.receipt, r);
      assert.throws(() => owner.verifyConsumption({ root: repo, directory, selection }));
    }
    write(files.receipt, receipt);
    for (const file of [files.pub, files.docs, files.seal]) {
      const bytes = fs.readFileSync(file); fs.appendFileSync(file, ' ');
      assert.throws(() => owner.verifyConsumption({ root: repo, directory, selection })); fs.writeFileSync(file, bytes);
    }
    fs.unlinkSync(bindingFile); good.run.run_attempt = 3;
    await assert.rejects(consume); assert(!fs.existsSync(bindingFile)); good.run.run_attempt = 2;
    good.artifacts[0].id = 457; await assert.rejects(consume, /superseded/); good.artifacts[0].id = 456;
    git('tag', '-f', tag, head); assert.throws(() => owner.verifyConsumption({ root: repo, directory, selection })); git('tag', '-f', tag, merged);
    git('checkout', '-q', '--detach', head); assert.throws(() => owner.verifyConsumption({ root: repo, directory, selection }));
  } finally { Module._load = load; }
  console.log('ok - automatic selection, supersession, authenticated source/digest rejection and immutable merge binding');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(repo, { recursive: true, force: true }));
