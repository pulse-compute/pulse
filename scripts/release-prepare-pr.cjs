#!/usr/bin/env node
'use strict';

// Local preparation only. The workflow's separate writer job publishes the
// bundle to a new branch and opens a draft PR; this process has no write token.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { compareVersions, versionParts, unpublishedDocumentationReleases } = require('./release-pr-check.cjs');

function run(command, args, cwd, capture = false) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', timeout: 10 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 });
}
function git(args, root, capture = true) { return run('git', args, root, capture)?.trim(); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// Resolve source metadata only. Website receipts own historical HTML and recovery.
function previousReleaseSource(root, manifest) {
  const version = manifest.releaseVersion;
  versionParts(version);
  const sourceTag = `v${version}`;
  const tag = git(['rev-parse', '--verify', `refs/tags/${sourceTag}^{commit}`], root);
  const bytes = git(['show', `${tag}:release/pulse-release-manifest.json`], root);
  const tagged = JSON.parse(bytes);
  if (tagged.releaseVersion !== version || tagged.documentation?.version !== sourceTag) {
    throw new Error(`${sourceTag} points to inconsistent previous release identity`);
  }
  return { version, tag, sourceTag, archive: null, manifest: tagged };
}

function parseArgs(argv) {
  const [version] = argv;
  const mode = argv.length === 1 ? 'website-managed' : argv[2];
  if (!(argv.length === 1 || (argv.length === 3 && argv[1] === '--documentation-history'))
    || !['website-managed', 'replace-unpublished-docs'].includes(mode)) {
    throw new Error('usage: node scripts/release-prepare-pr.cjs <version> [--documentation-history website-managed|replace-unpublished-docs]');
  }
  versionParts(version);
  return { version, mode };
}

function preparePreviousDocumentation(root, manifest, mode) {
  if (mode === 'website-managed') return { mode, ...previousReleaseSource(root, manifest) };
  if (mode !== 'replace-unpublished-docs') throw new Error('invalid documentation history mode');
  const decision = unpublishedDocumentationReleases(manifest).find((entry) => entry.version === manifest.releaseVersion);
  if (!decision) throw new Error(`no reviewed unpublished-docs decision for ${manifest.releaseVersion}`);
  const tag = git(['rev-parse', '--verify', `refs/tags/${decision.sourceTag}^{commit}`], root);
  if (tag !== decision.sourceCommit) throw new Error(`preserved ${decision.sourceTag} source identity differs from the reviewed decision`);
  return { mode, version: decision.version, tag, archive: null, exactLinkPolicy: decision.exactLinkPolicy, evidence: decision.evidence };
}

function main(argv = process.argv.slice(2)) {
  const { version, mode } = parseArgs(argv);
  const root = git(['rev-parse', '--show-toplevel'], process.cwd());
  if (git(['status', '--porcelain', '--untracked-files=all'], root)) throw new Error('release PR preparation requires a clean worktree');
  const base = git(['rev-parse', 'origin/main^{commit}'], root);
  const source = git(['rev-parse', 'HEAD^{commit}'], root);
  const suffix = process.env.GITHUB_RUN_ID || String(Date.now());
  if (!/^\d+$/.test(suffix)) throw new Error('invalid workflow run identity');
  const branch = `release/prepare-${version}-${suffix}`;
  git(['switch', '-c', branch], root, false);
  git(['merge', '--no-edit', base], root, false);
  const manifest = readJson(path.join(root, 'release/pulse-release-manifest.json'));
  if (compareVersions(version, manifest.releaseVersion) <= 0) throw new Error(`requested version must be newer than ${manifest.releaseVersion}`);
  const previous = preparePreviousDocumentation(root, manifest, mode);
  run(process.execPath, ['scripts/release-prepare.cjs', version, '--channel', manifest.channel, `--${mode}`], root);
  run(process.execPath, ['scripts/validate-maintainer-control-plane.cjs'], root);
  run(process.execPath, ['-e', "require('./scripts/documentation-release.cjs').validatePackageDocumentation({ repoRoot: process.cwd() })"], root);
  git(['add', '--all'], root, false);
  git(['commit', '-m', `release: prepare ${version}`], root, false);
  run(process.execPath, ['scripts/release-pr-check.cjs', '--base', base, '--head', 'HEAD'], root);
  const head = git(['rev-parse', 'HEAD'], root);
  const output = path.join(root, '.pulse-release-preparation');
  fs.mkdirSync(output, { recursive: true });
  git(['bundle', 'create', path.join(output, 'release.bundle'), `${base}..refs/heads/${branch}`], root, false);
  const { MAINTENANCE_POLICY, matchesPattern } = require('./maintenance-policy.cjs');
  const changed = git(['diff', '--name-only', base, head], root).split('\n').filter(Boolean);
  const boundaries = [...new Set(MAINTENANCE_POLICY.pathRules.filter(rule => changed.some(file => rule.patterns.some(pattern => matchesPattern(file, pattern)))).flatMap(rule => rule.boundaries))].sort();
  const documentationHistory = mode === 'website-managed'
    ? `Previous release metadata is bound to ${previous.sourceTag} at ${previous.tag}. No historical HTML was built or copied; website delivery and existing recovery ownership remain separate.`
    : `Hosted documentation for ${previous.version} is deliberately omitted under the reviewed decision in ${previous.evidence}; no archive is created. Its Git tag remains at ${previous.tag}, npm artifacts and published changelog history remain intact, and exact links are not redirected. Use its installed CLI docs or tagged source when hosted links are unavailable.`;
  const body = `Prepare Pulse ${version} from latest for main.\n\nThe release owner requested this version through the manual Release preparation workflow. ${documentationHistory} Source ${source}; base ${base}; prepared head ${head}.\n\nPreparation and documentation checks passed. This is not a final release seal. Mark this draft ready for review to trigger PR checks. After review and merge, tag the final main commit and run npm publication from that tag; publication seals its exact artifacts before approval. Reconcile main into latest after release.\n\n<!-- pulse-maintainer-declaration:start -->\nChange class: release\nScope: release-change\nProtected boundaries: ${boundaries.join(', ') || 'none'}\nHuman decision: required\n<!-- pulse-maintainer-declaration:end -->\n`;
  fs.writeFileSync(path.join(output, 'pr-body.md'), body);
  fs.writeFileSync(path.join(output, 'prepared.json'), `${JSON.stringify({ version, branch, base, source, head, previous }, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nbranch=${branch}\nbase=${base}\nhead=${head}\n`);
}

module.exports = { parseArgs, preparePreviousDocumentation, previousReleaseSource, main };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
