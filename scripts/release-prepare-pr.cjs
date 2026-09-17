#!/usr/bin/env node
'use strict';

// Local preparation only. The workflow's separate writer job publishes the
// bundle to a new branch and opens a draft PR; this process has no write token.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { compareVersions, versionParts } = require('./release-pr-check.cjs');

function run(command, args, cwd, capture = false) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', timeout: 10 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 });
}
function git(args, root, capture = true) { return run('git', args, root, capture)?.trim(); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function snapshotPreviousRelease(root, manifest) {
  const version = manifest.releaseVersion;
  versionParts(version);
  const segment = `v${version}`;
  const archive = `release/documentation-site-archives/${segment}`;
  const tag = git(['rev-parse', '--verify', `refs/tags/${segment}^{commit}`], root);
  const tagged = JSON.parse(git(['show', `${tag}:release/pulse-release-manifest.json`], root));
  if (tagged.releaseVersion !== version) throw new Error(`${segment} points to metadata for ${tagged.releaseVersion}; correct the previous release identity before archiving it.`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-previous-release-'));
  const checkout = path.join(temporary, 'source');
  try {
    git(['worktree', 'add', '--detach', checkout, tag], root, false);
    const pnpm = require('./pnpm-toolchain.cjs').pnpmInvocation(checkout, tagged.publication.pnpmVersion);
    run(pnpm.command, [...pnpm.prefix, 'install', '--frozen-lockfile', '--ignore-scripts'], checkout);
    run(process.execPath, ['scripts/build-docs-site.cjs', '--snapshot'], checkout);
    const destination = path.join(root, archive);
    if (fs.existsSync(destination)) {
      // Never silently overwrite an archive. Git compares both contents and
      // file sets against a rebuild from the exact previous release tag.
      run('git', ['diff', '--no-index', '--exit-code', destination, path.join(checkout, archive)], root);
    } else {
      fs.cpSync(path.join(checkout, archive), destination, { recursive: true });
      git(['add', '--', archive], root, false);
      git(['commit', '-m', `docs: archive ${segment} from its release tag`], root, false);
    }
    return { version, tag, archive };
  } finally {
    if (fs.existsSync(checkout)) git(['worktree', 'remove', '--force', checkout], root, false);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function main(argv = process.argv.slice(2)) {
  const [version] = argv;
  if (argv.length !== 1) throw new Error('usage: node scripts/release-prepare-pr.cjs <version>');
  versionParts(version);
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
  const previous = snapshotPreviousRelease(root, manifest);
  run(process.execPath, ['scripts/release-prepare.cjs', version, '--channel', manifest.channel, '--archive-current'], root);
  run(process.execPath, ['scripts/validate-maintainer-control-plane.cjs'], root);
  run(process.execPath, ['scripts/documentation-release.cjs'], root);
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
  const body = `Prepare Pulse ${version} from latest for main.\n\nThe release owner requested this version through the manual Release preparation workflow. The previous documentation snapshot comes from ${previous.tag}. Source ${source}; base ${base}; prepared head ${head}.\n\nPreparation and documentation checks passed. This is not a final release seal. Mark this draft ready for review to trigger PR checks. After review and merge, tag the final main commit and run npm publication from that tag; publication seals its exact artifacts before approval. Reconcile main into latest after release.\n\n<!-- pulse-maintainer-declaration:start -->\nChange class: release\nScope: release-change\nProtected boundaries: ${boundaries.join(', ') || 'none'}\nHuman decision: required\n<!-- pulse-maintainer-declaration:end -->\n`;
  fs.writeFileSync(path.join(output, 'pr-body.md'), body);
  fs.writeFileSync(path.join(output, 'prepared.json'), `${JSON.stringify({ version, branch, base, source, head, previous }, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nbranch=${branch}\nbase=${base}\nhead=${head}\n`);
}

module.exports = { snapshotPreviousRelease, main };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
