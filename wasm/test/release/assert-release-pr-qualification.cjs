'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const owner = require('../../../scripts/release-pr-qualification.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-pr-qualification-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (file, data) => { const p = path.join(repo, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data)); };
const repository = 'fixture/pulse';
const manifest = version => ({ releaseVersion: version, documentation: { version: `v${version}` },
  packages: [{ name: '@pulse-compute/runtime', dir: 'packages/runtime', version }] });
const archive = 'release/documentation-site-archives/v1.0.0-beta.7/release-manifest.json';
function prepare(version, archived = false) {
  write('release/pulse-release-manifest.json', manifest(version));
  write('packages/runtime/package.json', { name: '@pulse-compute/runtime', version });
  write('release/documentation-versions.json', { latest: version, versions: [
    { version, segment: `v${version}`, status: 'current' },
    ...(archived ? [{ version: '1.0.0-beta.7', status: 'archived', sourceManifest: archive }] : [])] });
  write('CHANGELOG.md', `# Changelog\n\n## ${version} — today\n`);
  if (archived) write(archive, manifest('1.0.0-beta.7'));
}
function commit(message) { git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); }

async function main() {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/release-qualify.yml'), 'utf8');
  owner.validateWorkflow(workflow);
  assert.throws(() => owner.validateWorkflow(workflow.replace('contents: read', 'contents: write')));
  assert.throws(() => owner.validateWorkflow(workflow.replace('--require-fastly', '')));
  assert.throws(() => owner.validateWorkflow(workflow.replace('test \"$CANDIDATE_RESULT\" = success', 'true')));
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  prepare('1.0.0-beta.7'); write('.gitignore', 'node_modules/\nwasm/.test-results/\n.pulse-release/\n.pulse-qualification/\n');
  const base = commit('base');
  prepare('1.0.0-beta.8', true); const head = commit('prepared');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const merge = git('commit-tree', tree, '-p', base, '-p', head, '-m', 'test merge');
  git('checkout', '-q', '--detach', merge);
  const event = { repository: { full_name: repository }, pull_request: { number: 17, state: 'open', draft: false,
    base: { ref: 'main', sha: base, repo: { full_name: repository } },
    head: { sha: head, repo: { full_name: repository } } } };
  const env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/pull/17/merge',
    GITHUB_SHA: merge, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' };
  const identify = (e = event, v = env) => owner.identify({ root: repo, event: e, env: v });
  const identity = identify();
  assert.equal(identity.required, true); assert.equal(identity.candidate.sourceTree, tree);
  for (const change of [e => { e.pull_request.base.sha = head; }, e => { e.pull_request.head.sha = base; },
    e => { e.pull_request.base.ref = 'latest'; }, e => { e.pull_request.draft = true; },
    e => { e.pull_request.head.repo.full_name = 'foreign/pulse'; }]) {
    const e = structuredClone(event); change(e); assert.throws(() => identify(e));
  }
  for (const change of [{ GITHUB_SHA: head }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/main' }, { GITHUB_RUN_ID: 'bad' }])
    assert.throws(() => identify(event, { ...env, ...change }));
  write('dirty.txt', 'dirty'); assert.throws(() => identify(), /clean candidate/); fs.unlinkSync(path.join(repo, 'dirty.txt'));

  const current = structuredClone(event.pull_request);
  let mainSha = base; current.merge_commit_sha = merge;
  const github = { rest: { pulls: { get: async () => ({ data: current }) }, git: { getRef: async ({ ref }) => ({ data: { object: { sha: mainSha } } }) } } };
  const context = { repo: { owner: 'fixture', repo: 'pulse' } };
  const check = () => owner.assertCurrent({ github, context, identity });
  await check(); mainSha = head; await assert.rejects(check, /Main moved/); mainSha = base;
  current.merge_commit_sha = head; await assert.rejects(check, /merge candidate changed/); current.merge_commit_sha = merge;
  current.head.sha = base; await assert.rejects(check, /head changed/); current.head.sha = head;
  current.body = 'Release qualification: required'; await assert.rejects(check, /request changed/); delete current.body;
  current.state = 'closed'; await assert.rejects(check, /no longer open/); current.state = 'open';

  const seal = { schemaVersion: 'pulse.release-seal.v1', status: 'passed', completedAt: new Date().toISOString(),
    candidate: identity.candidate, sourceRevision: merge, recovery: { context: { options: { requireFastly: true } } },
    externalFastly: { status: 'passed' }, cleanup: { status: 'passed' } };
  owner.assertSeal(seal, identity);
  for (const mutate of [s => { s.status = 'failed'; }, s => { delete s.completedAt; },
    s => { s.candidate.sourceTree = 'f'.repeat(40); }, s => { s.recovery.context.options.requireFastly = false; },
    s => { s.externalFastly.status = 'unavailable'; }, s => { s.cleanup.status = 'failed'; }]) {
    const bad = structuredClone(seal); mutate(bad); assert.throws(() => owner.assertSeal(bad, identity));
  }

  // Exercise the capture orchestration with artifact owners isolated. Failed
  // complete-evidence validation must stop before any bytes are accepted.
  const loader = require('node:module'), load = loader._load;
  let rejectEvidence = true, copied = 0;
  const output = path.join(repo, '.pulse-qualification/accepted');
  const captureSeal = { ...seal, recovery: { ...seal.recovery, directory: path.join(root, 'attempt'), contextSha256: 'a'.repeat(64) },
    featureAcceptance: { separateGates: [{ task: 'kv-k4', status: 'not-run' }] } };
  const checksFile = path.join(root, 'attempt/source-checks.json');
  fs.mkdirSync(path.dirname(checksFile), { recursive: true });
  const sourceChecks = { contextFreshness: require('./context-freshness-fixture.cjs').freshness(identity.candidate), schemaVersion: require('../../../scripts/release-source-checks.cjs').SCHEMA, status: 'passed', candidate: identity.candidate,
    snippets: { status: 'ok' }, documentation: { status: 'ok', validationKind: 'package-source',
      maintenance: { status: 'ok', publication: { status: 'ok' } } } };
  fs.writeFileSync(checksFile, JSON.stringify(sourceChecks));
  captureSeal.sourceChecks = { file: checksFile, sha256: crypto.createHash('sha256').update(fs.readFileSync(checksFile)).digest('hex') };
  write('wasm/.test-results/release-seal.json', captureSeal);
  loader._load = function(request, parent, ...rest) {
    if (parent?.filename.endsWith('/scripts/release-pr-qualification.cjs')) {
      if (request === './release-evidence-bundle.cjs') return { validateRecoveryEvidence() { if (rejectEvidence) throw new Error('incomplete installed gate'); } };
      if (request === './release-shared-pack.cjs') return { sharedPackEnv() { return {}; }, copySharedPack() { copied++; } };
      if (request === './documentation-deployment.cjs') throw new Error('v2 capture must not load documentation deployment');
      if (request === './release-publication.cjs') return {
        preparePublicationBundle(options) { assert.equal(options.sourceCommit, merge); assert.equal(options.sourceRef, identity.sourceRef);
          fs.mkdirSync(options.outDir, { recursive: true }); fs.writeFileSync(path.join(options.outDir, 'pulse-publication-manifest.json'), '{"fixture":true}'); },
        verifyPublicationBundle() { return { source: { commit: merge, ref: identity.sourceRef } }; }
      };
    }
    return load.call(this, request, parent, ...rest);
  };
  try {
    assert.throws(() => owner.capture(repo, identity, output), /incomplete installed gate/); assert.equal(copied, 0);
    rejectEvidence = false;
    assert.throws(() => owner.capture(repo, { ...identity, schemaVersion: owner.LEGACY_SCHEMA }, output), /requires v2 identity/);
    const captured = owner.capture(repo, identity, output);
    assert.equal(captured.schemaVersion, owner.SCHEMA);
    assert.equal(captured.documentationMode, 'source-only');
    assert.equal(Object.hasOwn(captured, 'documentationManifestSha256'), false);
    assert.equal(fs.existsSync(path.join(output, 'documentation')), false);
    assert.equal(captured.sourceChecksSha256, captureSeal.sourceChecks.sha256);
    assert.deepEqual(fs.readFileSync(path.join(output, 'source-checks.json')), fs.readFileSync(checksFile));
    assert.equal(copied, 1); assert.equal(captured.artifact, 'pulse-pr-release-qualification-123-2');
    assert.match(captured.bundleManifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(captured.sealSha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(output, 'release-seal.json'))).digest('hex'));
    assert.deepEqual(captured.separateGates, captureSeal.featureAcceptance.separateGates);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'qualification.json'))), captured);
  } finally { loader._load = load; }

  const receipt = { ...identity, status: 'passed', documentationMode: 'source-only' };
  const mergedPr = { ...event.pull_request, merged: true, merge_commit_sha: merge };
  git('tag', identity.releaseTag, merge);
  const bind = (r = receipt, pr = mergedPr) => owner.verifyMergeBinding({ root: repo, receipt: r, pullRequest: pr, repository, tag: identity.releaseTag });
  assert.equal(bind().strategy, 'merge');
  const squash = git('commit-tree', tree, '-p', base, '-m', 'squash');
  git('tag', '-f', identity.releaseTag, squash); mergedPr.merge_commit_sha = squash;
  assert.equal(bind().strategy, 'squash');
  // Same-tree commits from another base are not eligible.
  const stale = git('commit-tree', tree, '-p', head, '-m', 'wrong base');
  git('tag', '-f', identity.releaseTag, stale); mergedPr.merge_commit_sha = stale;
  assert.throws(bind, /Rebase commit count differs/);
  git('tag', '-f', identity.releaseTag, squash); mergedPr.merge_commit_sha = squash;
  for (const mutate of [r => { r.candidate.sourceTree = 'f'.repeat(40); }, r => { r.head = base; },
    r => { r.repository = 'foreign/pulse'; }, r => { r.workflow = '.github/workflows/validate.yml'; }, r => { r.status = 'failed'; }]) {
    const bad = structuredClone(receipt); mutate(bad); assert.throws(() => bind(bad));
  }
  assert.throws(() => bind(receipt, { ...mergedPr, merge_commit_sha: merge }), /Tag differs/);
  assert.throws(() => bind(receipt, { ...mergedPr, merged: false }), /must be merged/);

  // Real Git objects: preserve every ordered tree, the exact base and both tips
  // across a metadata-only rewrite of a linear two-commit PR.
  git('checkout', '-q', '--detach', head); write('docs/rebase.md', 'second change');
  const linearHead = commit('second original'), linearTree = git('rev-parse', 'HEAD^{tree}');
  const linearMerge = git('commit-tree', linearTree, '-p', base, '-p', linearHead, '-m', 'linear PR candidate');
  const linearReceipt = { ...receipt, head: linearHead,
    candidate: { ...receipt.candidate, sourceRevision: linearMerge, sourceTree: linearTree } };
  const rebasedFirst = git('commit-tree', tree, '-p', base, '-m', 'rewritten first');
  const rebasedTip = git('commit-tree', linearTree, '-p', rebasedFirst, '-m', 'rewritten second');
  const bindRebase = (tip, r = linearReceipt) => {
    git('tag', '-f', identity.releaseTag, tip);
    return bind(r, { ...mergedPr, head: { ...mergedPr.head, sha: r.head }, merge_commit_sha: tip });
  };
  const rebased = bindRebase(rebasedTip);
  assert.equal(rebased.strategy, 'rebase'); assert.equal(rebased.qualifiedSource, linearMerge);
  assert.deepEqual(rebased.rebase, [{ original: head, rebased: rebasedFirst, tree },
    { original: linearHead, rebased: rebasedTip, tree: linearTree }]);
  const changedFirst = git('commit-tree', git('rev-parse', `${base}^{tree}`), '-p', base, '-m', 'changed intermediate');
  const sameFinalTree = git('commit-tree', linearTree, '-p', changedFirst, '-m', 'same final tree');
  assert.throws(() => bindRebase(sameFinalTree), /ordered trees differ/);
  const extraTip = git('commit-tree', linearTree, '-p', rebasedTip, '-m', 'extra main commit');
  assert.throws(() => bindRebase(extraTip), /commit count differs/);
  const mergedFirst = git('commit-tree', tree, '-p', base, '-p', head, '-m', 'nonlinear first');
  const nonlinearTip = git('commit-tree', linearTree, '-p', mergedFirst, '-m', 'nonlinear final');
  assert.throws(() => bindRebase(nonlinearTip), /must be linear/);
  assert.throws(() => bindRebase(rebasedTip, { ...linearReceipt, head: linearMerge }), /must be linear/);
  const wrongBase = git('commit-tree', tree, '-m', 'unrelated root');
  const wrongBaseTip = git('commit-tree', linearTree, '-p', wrongBase, '-m', 'unrelated final');
  assert.throws(() => bindRebase(wrongBaseTip), /must be linear/);
  const droppedReceipt = { ...linearReceipt, head: extraTip };
  assert.throws(() => bindRebase(rebasedTip, droppedReceipt), /commit count differs/);

  // Same-version docs-only changes produce an explicit non-release result.
  git('checkout', '-q', '--detach', base); write('docs/note.md', 'note'); const docs = commit('docs');
  const docsMerge = git('commit-tree', git('rev-parse', 'HEAD^{tree}'), '-p', base, '-p', docs, '-m', 'docs merge');
  git('checkout', '-q', '--detach', docsMerge);
  const docsEvent = structuredClone(event); docsEvent.pull_request.head.sha = docs;
  assert.equal(identify(docsEvent, { ...env, GITHUB_SHA: docsMerge }).required, false);
  docsEvent.pull_request.body = 'Release qualification: required';
  const requested = identify(docsEvent, { ...env, GITHUB_SHA: docsMerge });
  assert.equal(requested.required, true); assert.equal(requested.qualificationRequested, true);
  assert.equal(requested.preparation.preparedRelease, false);
  for (const body of ['Release qualification: skip', 'Release qualification: required\nRelease qualification: required']) {
    assert.throws(() => identify({ ...docsEvent, pull_request: { ...docsEvent.pull_request, body } }, { ...env, GITHUB_SHA: docsMerge }));
  }
  write('packages/runtime/index.js', 'changed product'); const unprepared = commit('unprepared');
  const badMerge = git('commit-tree', git('rev-parse', 'HEAD^{tree}'), '-p', base, '-p', unprepared, '-m', 'bad merge');
  git('checkout', '-q', '--detach', badMerge); docsEvent.pull_request.head.sha = unprepared;
  assert.throws(() => identify(docsEvent, { ...env, GITHUB_SHA: badMerge }), /version remains/);

  // Pinned source-check receipts cannot skip validation on another checkout,
  // dirty source, changed dependency bytes, or a modified/incomplete report.
  fs.mkdirSync(path.join(repo, 'wasm'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'node_modules')); write('node_modules/input.js', 'one');
  const Module = require('node:module'), original = Module._load;
  const source = require('../../../scripts/release-source-checks.cjs');
  const calls = [];
  Module._load = function(request, parent, ...rest) {
    if (parent?.filename.endsWith('/scripts/release-source-checks.cjs')) {
      if (request === './release-context-freshness.cjs') return { ...require('../../../scripts/release-context-freshness.cjs'), check(_root, candidate) { calls.push('context'); return require('./context-freshness-fixture.cjs').freshness(candidate); } };
      if (request === './documentation-deployment.cjs') throw new Error('v2 source checks must not seal documentation');
      if (request === './documentation-ownership.cjs') return { synchronizeDocumentationMetadata() { calls.push('metadata'); } };
      if (request.endsWith('/sync-doc-snippets.cjs')) return { synchronizeDocSnippets() { calls.push('snippets'); return { status: 'ok' }; } };
      if (request === './documentation-release.cjs') return { validatePackageDocumentation(options) { calls.push('documentation'); assert.equal(options.onValidatedSite, undefined); return { status: 'ok', validationKind: 'package-source', maintenance: { status: 'ok', publication: { status: 'ok' } } }; } };
    }
    return original.call(this, request, parent, ...rest);
  };
  try {
    const file = path.join(root, 'source-checks.json'); source.check(repo, file);
    const bytes = fs.readFileSync(file), digest = crypto.createHash('sha256').update(bytes).digest('hex');
    source.verify(repo, file, digest); assert.deepEqual(calls, ['context', 'metadata', 'snippets', 'documentation']);
    const report = JSON.parse(bytes);
    assert.equal(report.schemaVersion, source.SCHEMA);
    assert.equal(Object.hasOwn(report, 'documentationCandidate'), false);
    for (const mutate of [r => { r.schemaVersion = 'unknown'; }, r => { r.documentation.validationKind = 'site'; },
      r => { r.documentationCandidate = {}; }, r => { r.documentation.site = {}; }, r => { r.snippets.status = 'failed'; }]) {
      const bad = structuredClone(report); mutate(bad); fs.writeFileSync(file, JSON.stringify(bad));
      assert.throws(() => source.verify(repo, file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')));
    }
    // Supported v1 receipts still require their retained, hash-pinned site.
    const retainedDir = path.join(root, 'legacy-documentation'); fs.mkdirSync(retainedDir);
    const retained = path.join(retainedDir, 'site.json'); fs.writeFileSync(retained, '{}');
    const legacy = { ...report, schemaVersion: source.LEGACY_SCHEMA,
      documentation: { ...report.documentation, site: { generatedFiles: 1 } },
      documentationCandidate: { directory: retainedDir, ...require('../../../scripts/release-recovery.cjs').describeArtifact(retainedDir) } };
    delete legacy.documentation.validationKind;
    const legacyBytes = JSON.stringify(legacy), legacyDigest = crypto.createHash('sha256').update(legacyBytes).digest('hex');
    fs.writeFileSync(file, legacyBytes); source.verify(repo, file, legacyDigest);
    fs.writeFileSync(retained, 'tampered'); assert.throws(() => source.verify(repo, file, legacyDigest), /documentation changed/);
    fs.unlinkSync(retained); assert.throws(() => source.verify(repo, file, legacyDigest));
    fs.writeFileSync(file, bytes);
    fs.appendFileSync(file, ' '); assert.throws(() => source.verify(repo, file, digest), /receipt changed/); fs.writeFileSync(file, bytes);
    const oldEnvironment = process.env.SOURCE_CHECK_RECEIPT_TEST;
    process.env.SOURCE_CHECK_RECEIPT_TEST = 'changed';
    assert.throws(() => source.verify(repo, file, digest), /inputs changed/);
    if (oldEnvironment === undefined) delete process.env.SOURCE_CHECK_RECEIPT_TEST;
    else process.env.SOURCE_CHECK_RECEIPT_TEST = oldEnvironment;
    write('node_modules/input.js', 'two'); assert.throws(() => source.verify(repo, file, digest), /inputs changed/); write('node_modules/input.js', 'one');
    write('dirty.txt', 'dirty'); assert.throws(() => source.verify(repo, file, digest), /clean candidate/); fs.unlinkSync(path.join(repo, 'dirty.txt'));
    assert.throws(() => source.verify(root, file, digest), /another checkout/);
  } finally { Module._load = original; }
  console.log('ok - pre-main identity, explicit qualification, live-source invalidation, terminal seal, merge/squash/linear-rebase binding and pinned source checks');
}
main().finally(() => fs.rmSync(root, { recursive: true, force: true })).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
