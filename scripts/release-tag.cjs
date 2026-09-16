#!/usr/bin/env node
'use strict';

// Release-owner tool. Checking is the default; --write creates only a local tag.
const { execFileSync } = require('node:child_process');
const { versionParts, checkReleasePr } = require('./release-pr-check.cjs');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 16 * 1024 * 1024 }).trim();
}
function prepareTag({ root = process.cwd(), version, write = false }) {
  versionParts(version);
  root = git(root, ['rev-parse', '--show-toplevel']);
  if (git(root, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Release tagging requires a clean checkout.');
  const commit = git(root, ['rev-parse', 'HEAD^{commit}']);
  const readHead = file => git(root, ['show', `${commit}:${file}`]);
  const manifest = JSON.parse(readHead('release/pulse-release-manifest.json'));
  if (manifest.releaseVersion !== version) throw new Error(`Requested ${version} does not match release manifest ${manifest.releaseVersion}.`);
  const versions = JSON.parse(readHead('release/documentation-versions.json'));
  const previous = versions.versions.find(entry => entry.status === 'archived');
  if (!previous) throw new Error('A previous archived release is required.');
  checkReleasePr({ baseManifest: { releaseVersion: previous.version }, headManifest: manifest,
    changedFiles: ['package.json'], readHead });
  const main = git(root, ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']).split(/\s+/)[0];
  if (main !== commit) throw new Error('HEAD must equal remote origin/main. Merge the reviewed preparation into main and check out that commit first.');
  const tag = `v${version}`, ref = `refs/tags/${tag}`;
  const remote = new Map(git(root, ['ls-remote', '--tags', 'origin', ref, `${ref}^{}`])
    .split('\n').filter(Boolean).map(line => line.split(/\s+/).reverse()));
  if (remote.size && (remote.get(`${ref}^{}`) !== commit || !remote.has(ref))) {
    throw new Error(`${tag} already exists remotely with a different commit or is not annotated; never replace a release tag.`);
  }
  const local = git(root, ['tag', '--list', tag]);
  if (local && (git(root, ['cat-file', '-t', ref]) !== 'tag' || git(root, ['rev-parse', `${ref}^{commit}`]) !== commit)) {
    throw new Error(`${tag} already exists locally with a different commit or is not annotated; never replace a release tag.`);
  }
  if (remote.size && local && git(root, ['rev-parse', ref]) !== remote.get(ref)) {
    throw new Error(`${tag} has different local and remote tag objects; fetch the published tag without replacing it.`);
  }
  if (write && !local && !remote.size) git(root, ['tag', '-a', tag, commit, '-m', `Pulse ${version}`]);
  return { status: 'passed', version, tag, commit, mode: write ? 'write' : 'dry-run',
    localTagCreated: write && !local && !remote.size, remoteTagExists: remote.size > 0,
    sealed: false, published: false,
    next: remote.size ? [`gh workflow run npm-publish.yml --ref ${tag} -f release_tag=${tag} -f operation=publish -f run_smoke=true`]
      : [...(write || local ? [] : [`npm run release:tag -- ${version} --write`]), `git push origin ${ref}`,
        `gh workflow run npm-publish.yml --ref ${tag} -f release_tag=${tag} -f operation=publish -f run_smoke=true`] };
}
function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    console.log('Usage: npm run release:tag -- <version> [--write]\nChecks the clean release checkout against remote main. Default: dry run.\n--write creates an annotated local tag only; never pushes, replaces a tag, seals, or publishes.');
    return;
  }
  if (argv.length < 1 || argv.length > 2 || (argv[1] !== undefined && argv[1] !== '--write')) throw new Error('Usage: npm run release:tag -- <version> [--write]');
  console.log(JSON.stringify(prepareTag({ version: argv[0], write: argv[1] === '--write' }), null, 2));
}
module.exports = { prepareTag, main };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
