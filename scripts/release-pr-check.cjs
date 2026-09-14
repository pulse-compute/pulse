#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');

function fail(message) { throw new Error(`Release preparation: ${message}`); }

function versionParts(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match || (match[4] || '').split('.').some((part) => /^0\d+$/.test(part))) fail(`invalid release version ${JSON.stringify(value)}`);
  return { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') || [] };
}

function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function requiresVersionChange(file) {
  if (['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(file)) return true;
  if (!/^(?:wasm\/)?packages\//.test(file)) return false;
  // Documentation/governance changes do not turn every main PR into a release.
  if (/\/(?:docs|test|tests|examples)\//.test(file) || /\.(?:md|mdx)$/.test(file)) return false;
  return true;
}

function checkReleasePr({ baseManifest, headManifest, changedFiles, readHead }) {
  const previous = baseManifest.releaseVersion, next = headManifest.releaseVersion;
  const order = compareVersions(next, previous);
  const productChanged = changedFiles.some(requiresVersionChange);
  if (order < 0) fail(`version ${next} goes backwards from ${previous}`);
  if (productChanged && order === 0) fail(`publishable code changed but the version remains ${previous}. Run Release preparation, or release:prepare, before merging into main.`);
  if (headManifest.documentation?.version !== `v${next}`) fail('documentation version does not match the release version');
  const versions = JSON.parse(readHead('release/documentation-versions.json'));
  const current = versions.versions.filter((entry) => entry.status === 'current');
  if (versions.latest !== next || current.length !== 1 || current[0].version !== next || current[0].segment !== `v${next}`) fail('current documentation identity is stale');
  if (!headManifest.packages?.length) fail('release package catalog is empty');
  for (const entry of headManifest.packages) {
    if (!/^(?:wasm\/)?packages\/[a-z0-9-]+$/.test(entry.dir)) fail('invalid release package directory');
    const pkg = JSON.parse(readHead(`${entry.dir}/package.json`));
    if (entry.version !== next || pkg.version !== next || pkg.name !== entry.name) fail(`${entry.name} is not synchronized to ${next}`);
  }
  if (order > 0) {
    const archive = versions.versions.find((entry) => entry.version === previous && entry.status === 'archived');
    if (!archive || archive.sourceManifest !== `release/documentation-site-archives/v${previous}/release-manifest.json`) fail(`previous release ${previous} must remain archived`);
    const archived = JSON.parse(readHead(archive.sourceManifest));
    if (archived.releaseVersion !== previous) fail('archived release identity is stale');
    if (!readHead('CHANGELOG.md').includes(`\n## ${next} — `)) fail(`CHANGELOG.md needs a release section for ${next}`);
  }
  return { status: 'passed', previousVersion: previous, version: next, productChanged, preparedRelease: order > 0, sealed: false };
}

function git(args, cwd = process.cwd()) { return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); }

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 4 || argv[0] !== '--base' || argv[2] !== '--head') fail('usage: node scripts/release-pr-check.cjs --base <ref> --head <ref>');
  const resolve = (ref) => git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  const base = resolve(argv[1]), head = resolve(argv[3]);
  const read = (sha, file) => git(['show', `${sha}:${file}`]);
  const report = checkReleasePr({
    baseManifest: JSON.parse(read(base, 'release/pulse-release-manifest.json')),
    headManifest: JSON.parse(read(head, 'release/pulse-release-manifest.json')),
    changedFiles: git(['diff', '--name-only', '-z', base, head]).split('\0').filter(Boolean),
    readHead: (file) => read(head, file)
  });
  process.stdout.write(`${JSON.stringify({ ...report, base, head }, null, 2)}\n`);
}

module.exports = { versionParts, compareVersions, requiresVersionChange, checkReleasePr, main };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
