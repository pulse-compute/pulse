#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { classifyDocumentation } = require('./release-preflight.cjs');

const repoRoot = path.resolve(__dirname, '..');
const releaseManifestFile = path.join(repoRoot, 'release', 'pulse-release-manifest.json');
const documentationVersionsFile = path.join(repoRoot, 'release', 'documentation-versions.json');
const documentationInventoryFile = path.join(repoRoot, 'release', 'documentation-inventory.json');
const documentationArchiveRoot = path.join(repoRoot, 'release', 'documentation-site-archives');
const tokenReportFile = path.join(repoRoot, '.pulse-release-preparation', 'version-token-report.json');
const dependencySections = Object.freeze(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']);
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message, code = 'PULSE_RELEASE_PREPARATION_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function relative(file) {
  return slash(path.relative(repoRoot, file));
}

function assertContained(file) {
  const resolved = path.resolve(file);
  const name = path.relative(repoRoot, resolved);
  if (!name || name.startsWith('..') || path.isAbsolute(name)) fail(`release preparation path escapes the repository: ${file}`);
  return resolved;
}

function readJson(file) {
  const resolved = assertContained(file);
  if (!fs.existsSync(resolved)) fail(`required file is missing: ${relative(resolved)}`);
  try { return JSON.parse(fs.readFileSync(resolved, 'utf8')); }
  catch (error) { fail(`invalid JSON in ${relative(resolved)}: ${error.message}`); }
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: process.env
  });
  if (result.error) fail(`failed to run ${command}: ${result.error.message}`, 'PULSE_RELEASE_PREPARATION_COMMAND_FAILED');
  if (result.status !== 0 && !options.allowFailure) {
    const detail = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
    fail(`command failed (${result.status}): ${command} ${args.join(' ')}${detail}`, 'PULSE_RELEASE_PREPARATION_COMMAND_FAILED');
  }
  return result;
}

function parseArgs(argv) {
  const options = {
    version: null,
    channel: null,
    releasedAt: new Date().toISOString().slice(0, 10),
    historyMode: null,
    dryRun: false,
    noSync: false,
    allowDirty: false
  };
  const input = [...argv];
  while (input.length) {
    const token = input.shift();
    if (!token.startsWith('-') && !options.version) options.version = token;
    else if (token === '--channel') {
      if (!input.length) fail('--channel requires a value');
      options.channel = input.shift();
    } else if (token.startsWith('--channel=')) options.channel = token.slice('--channel='.length);
    else if (token === '--date') {
      if (!input.length) fail('--date requires YYYY-MM-DD');
      options.releasedAt = input.shift();
    } else if (token.startsWith('--date=')) options.releasedAt = token.slice('--date='.length);
    else if (token === '--replace-unpublished') {
      if (options.historyMode) fail('choose exactly one of --replace-unpublished or --archive-current');
      options.historyMode = 'replace-unpublished';
    } else if (token === '--archive-current') {
      if (options.historyMode) fail('choose exactly one of --replace-unpublished or --archive-current');
      options.historyMode = 'archive-current';
    } else if (token === '--dry-run') options.dryRun = true;
    else if (token === '--no-sync') options.noSync = true;
    else if (token === '--allow-dirty') options.allowDirty = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else fail(`unknown option ${token}`);
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  pnpm release:prepare -- <version> --channel <name> <--replace-unpublished|--archive-current> [options]',
    '',
    'History mode:',
    '  --replace-unpublished  Replace the current candidate without creating release history',
    '  --archive-current      Require a committed documentation snapshot and archive the current release',
    '',
    'Options:',
    '  --date <date>  Release date in YYYY-MM-DD (default: today in UTC)',
    '  --dry-run      Validate and print the allowlisted plan without writing',
    '  --no-sync      Skip the lockfile and named generators',
    '  --allow-dirty  Permit an already-dirty Git worktree; new changed paths are still checked',
    '',
    'This command never creates a Git tag and never contacts or mutates npm.'
  ].join('\n');
}

function assertVersion(value, name = 'version') {
  if (typeof value !== 'string' || !semverPattern.test(value)) fail(`${name} must be a valid semantic version; received ${JSON.stringify(value)}`);
  return value;
}

function assertChannel(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) fail(`channel must use lowercase npm dist-tag syntax; received ${JSON.stringify(value)}`);
  if (value === 'latest') fail('release preparation never assigns latest implicitly');
  return value;
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`date must use YYYY-MM-DD; received ${JSON.stringify(value)}`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) fail(`date is not valid: ${value}`);
  return value;
}

function gitState(options) {
  const inside = run('git', ['rev-parse', '--is-inside-work-tree'], { capture: true, allowFailure: true });
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    if (options.dryRun) return Object.freeze({ available: false, changed: new Set() });
    fail('release preparation writes require a Git worktree; use --dry-run to inspect an exported source archive', 'PULSE_RELEASE_PREPARATION_GIT_REQUIRED');
  }
  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { capture: true });
  if (status.stdout.trim() && !options.allowDirty) {
    fail(`release preparation requires a clean worktree. Commit or stash these changes first:\n${status.stdout.trim()}`, 'PULSE_RELEASE_PREPARATION_DIRTY');
  }
  const changed = new Set(status.stdout.split(/\r?\n/).filter(Boolean).map((line) => slash(line.slice(3))));
  return Object.freeze({ available: true, changed });
}

function assertManifestConsistency(releaseManifest, documentationVersions) {
  const currentVersion = assertVersion(releaseManifest.releaseVersion, 'release manifest version');
  if (releaseManifest.documentation?.version !== `v${currentVersion}`) fail('release manifest documentation.version does not match releaseVersion');
  if (![releaseManifest.channel, 'latest'].includes(releaseManifest.publication?.distTag)) fail('release manifest publication.distTag must be the release channel or explicitly configured latest');
  if (!Array.isArray(releaseManifest.packages) || releaseManifest.packages.length === 0) fail('release manifest packages must be a non-empty array');
  for (const entry of releaseManifest.packages) if (entry.version !== currentVersion) fail(`${entry.name} release-catalog version does not match ${currentVersion}`);
  if (!Array.isArray(documentationVersions.versions)) fail('documentation versions manifest must contain versions[]');
  const current = documentationVersions.versions.filter((entry) => entry.status === 'current');
  if (current.length !== 1) fail(`documentation versions manifest must contain exactly one current entry; found ${current.length}`);
  if (current[0].version !== currentVersion || current[0].segment !== `v${currentVersion}` || documentationVersions.latest !== currentVersion) {
    fail('current documentation version does not match the release manifest');
  }
  const policy = releaseManifest.readiness?.versionPreparation;
  if (!policy || policy.schemaVersion !== 'pulse.release-version-preparation.v1') fail('release manifest version preparation policy is missing or unsupported');
  return Object.freeze({ currentVersion, currentEntry: current[0], policy });
}

function assertSnapshot(currentVersion, currentEntry, git) {
  if (!git.available) fail('--archive-current requires a Git worktree');
  const segment = `v${currentVersion}`;
  const root = path.join(documentationArchiveRoot, segment);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`missing immutable documentation snapshot: ${relative(root)}/`, 'PULSE_RELEASE_SNAPSHOT_REQUIRED');
  for (const entry of ['index.html', 'search-index.json', 'release-manifest.json', 'documentation-versions.json', 'site-version-manifest.json', 'assets/site.css', 'assets/site.js']) {
    const file = path.join(root, entry);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`documentation snapshot ${segment} is incomplete; missing ${entry}`, 'PULSE_RELEASE_SNAPSHOT_INVALID');
  }
  const site = readJson(path.join(root, 'site-version-manifest.json'));
  if (site.releaseVersion !== currentVersion || site.versionSegment !== segment || !Array.isArray(site.pages) || site.pages.length === 0) {
    fail(`documentation snapshot ${segment} has stale or incomplete metadata`, 'PULSE_RELEASE_SNAPSHOT_INVALID');
  }
  if (currentEntry.version !== currentVersion || currentEntry.segment !== segment) fail(`documentation snapshot ${segment} does not match the current versions entry`, 'PULSE_RELEASE_SNAPSHOT_INVALID');
  const status = run('git', ['status', '--porcelain=v1', '--', relative(root)], { capture: true });
  if (status.stdout.trim()) fail(`documentation snapshot ${segment} must be committed before the version changes`, 'PULSE_RELEASE_SNAPSHOT_UNCOMMITTED');
  const tracked = run('git', ['ls-files', '--', relative(root)], { capture: true });
  if (!tracked.stdout.trim()) fail(`documentation snapshot ${segment} is not tracked by Git`, 'PULSE_RELEASE_SNAPSHOT_UNCOMMITTED');
  return Object.freeze({ root, pages: site.pages.length });
}

function replaceReleaseIdentity(value, oldVersion, nextVersion) {
  if (Array.isArray(value)) return value.map((entry) => replaceReleaseIdentity(entry, oldVersion, nextVersion));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceReleaseIdentity(entry, oldVersion, nextVersion)]));
  if (typeof value !== 'string') return value;
  return value.split(`v${oldVersion}`).join(`v${nextVersion}`).split(oldVersion).join(nextVersion);
}

function replaceText(source, oldVersion, nextVersion) {
  return source.split(`v${oldVersion}`).join(`v${nextVersion}`).split(oldVersion).join(nextVersion);
}

function replaceCandidateText(source, releaseManifest, nextVersion, releasedAt) {
  const replaced = replaceText(source, releaseManifest.releaseVersion, nextVersion);
  const oldHeading = `## ${nextVersion} — ${releaseManifest.display.candidateLabel} (${releaseManifest.releasedAt})`;
  const nextHeading = `## ${nextVersion} — ${releaseManifest.display.candidateLabel} (${releasedAt})`;
  return replaced.split(oldHeading).join(nextHeading);
}

function prepareChangelog(source, nextVersion, label, releasedAt) {
  if (source.includes(`\n## ${nextVersion} — `)) fail(`changelog already contains ${nextVersion}`);
  const marker = '\n## Unreleased\n';
  const start = source.indexOf(marker);
  if (start < 0) fail('changelog requires an Unreleased section before release preparation');
  const end = source.indexOf('\n## ', start + marker.length);
  const notes = source.slice(start + marker.length, end < 0 ? source.length : end).trim();
  return `${source.slice(0, start)}${marker}\n## ${nextVersion} — ${label} (${releasedAt})\n\n${notes}\n${end < 0 ? '' : source.slice(end)}`;
}

function filesUnder(root, predicate, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.corepack', '.validation-tools', '.pnpm-store', '.cache', '.pulse-docs-site', '.pulse-docs-preview', '.pulse-release', '.pulse-publication', '.pulse-documentation-deployment', '.pulse-release-preflight', '.pulse-release-preparation', 'documentation-site-archives'].includes(entry.name)) continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(file, predicate, out);
    else if (entry.isFile() && predicate(file)) out.push(file);
  }
  return out;
}

function documentationOwners(policy) {
  const inventory = readJson(documentationInventoryFile);
  const accepted = new Set(policy.replaceUnpublishedDocumentationClasses);
  return classifyDocumentation(inventory, repoRoot).entries
    .filter((entry) => accepted.has(entry.classification))
    .map((entry) => path.join(repoRoot, entry.path));
}

function packageManifestFiles(releaseManifest, policy) {
  const files = new Set(releaseManifest.packages.map((entry) => path.join(repoRoot, entry.dir, 'package.json')));
  for (const file of [path.join(repoRoot, 'package.json'), path.join(repoRoot, 'wasm', 'package.json')]) files.add(file);
  for (const root of policy.dependencyManifestRoots) {
    for (const file of filesUnder(path.join(repoRoot, root), (entry) => path.basename(entry) === 'package.json')) files.add(file);
  }
  return [...files].sort();
}

function updatePulseDependencies(manifest, oldVersion, nextVersion) {
  let changes = 0;
  for (const section of dependencySections) {
    if (!manifest[section] || typeof manifest[section] !== 'object') continue;
    for (const [name, value] of Object.entries(manifest[section])) {
      if (name.startsWith('@pulse-compute/') && value === oldVersion) {
        manifest[section][name] = nextVersion;
        changes += 1;
      }
    }
  }
  return changes;
}

function planRelease(releaseManifest, documentationVersions, options, state) {
  const { currentVersion, currentEntry, policy } = state;
  const nextVersion = options.version;
  const channel = options.channel || releaseManifest.channel;
  if (channel !== releaseManifest.channel) fail(`channel transition ${releaseManifest.channel} -> ${channel} requires an explicit release-policy update before release preparation`);
  if (documentationVersions.versions.some((entry) => entry.version === nextVersion && entry.version !== currentVersion)) fail(`documentation versions already contains ${nextVersion}`);
  const writes = new Map();
  const putJson = (file, value) => writes.set(assertContained(file), stableJson(value));
  const putText = (file, value) => writes.set(assertContained(file), value);

  const nextRelease = structuredClone(releaseManifest);
  nextRelease.releaseVersion = nextVersion;
  nextRelease.channel = channel;
  nextRelease.releasedAt = options.releasedAt;
  nextRelease.display.candidateName = `${nextRelease.display.productName} ${nextVersion} — ${nextRelease.display.candidateLabel}`;
  nextRelease.documentation.version = `v${nextVersion}`;
  nextRelease.publication.distTag = releaseManifest.publication.distTag;
  for (const entry of nextRelease.packages) entry.version = nextVersion;
  putJson(releaseManifestFile, nextRelease);

  let nextDocumentationVersions;
  if (options.historyMode === 'replace-unpublished') {
    nextDocumentationVersions = {
      ...documentationVersions,
      latest: nextVersion,
      versions: documentationVersions.versions.map((entry) => entry.status === 'current' ? {
        ...entry,
        version: nextVersion,
        segment: `v${nextVersion}`,
        channel,
        releasedAt: options.releasedAt,
        sourceManifest: 'release/pulse-release-manifest.json'
      } : entry)
    };
  } else {
    nextDocumentationVersions = {
      ...documentationVersions,
      latest: nextVersion,
      versions: [{
        version: nextVersion,
        segment: `v${nextVersion}`,
        channel,
        releasedAt: options.releasedAt,
        status: 'current',
        sourceManifest: 'release/pulse-release-manifest.json'
      }, ...documentationVersions.versions.map((entry) => entry.status === 'current' ? {
        ...entry,
        status: 'archived',
        sourceManifest: `release/documentation-site-archives/${entry.segment}/release-manifest.json`
      } : entry)]
    };
  }
  putJson(documentationVersionsFile, nextDocumentationVersions);

  for (const name of policy.metadataOwners) {
    const file = path.join(repoRoot, name);
    const value = replaceReleaseIdentity(readJson(file), currentVersion, nextVersion);
    if (Object.hasOwn(value, 'releaseVersion')) value.releaseVersion = nextVersion;
    if (name === 'release/release-preflight.json') {
      value.reviewedAt = options.releasedAt;
      value.releaseCandidate.version = nextVersion;
      value.releaseCandidate.publicationTag = nextRelease.publication.distTag;
      value.releaseCandidate.latestTagAllowed = nextRelease.publication.distTag === 'latest';
      value.releaseCandidate.currentSnapshotChannel = channel;
      value.releaseCandidate.snapshotAppliedAt = options.releasedAt;
      value.releaseVocabulary.displayName = nextRelease.display.candidateName;
      value.releaseVocabulary.npmDistTag = nextRelease.publication.distTag;
      value.npmBootstrap.releaseTag = nextRelease.publication.distTag;
      value.sourceAuthority.expectedReleaseTag = `v${nextVersion}`;
    }
    putJson(file, value);
  }

  const releasePackages = new Map(nextRelease.packages.map((entry) => [path.join(repoRoot, entry.dir, 'package.json'), entry]));
  let dependencyUpdates = 0;
  for (const file of packageManifestFiles(nextRelease, policy)) {
    const manifest = readJson(file);
    const catalog = releasePackages.get(file);
    if (catalog) {
      if (manifest.name !== catalog.name) fail(`release catalog ${catalog.name} does not match ${relative(file)}`);
      manifest.version = nextVersion;
    }
    dependencyUpdates += updatePulseDependencies(manifest, currentVersion, nextVersion);
    const replaced = replaceReleaseIdentity(manifest, currentVersion, nextVersion);
    if (stableJson(replaced) !== fs.readFileSync(file, 'utf8')) putJson(file, replaced);
  }

  for (const name of policy.literalOwners) {
    const file = path.join(repoRoot, name);
    if (!fs.existsSync(file)) fail(`release literal owner is missing: ${name}`);
    const source = writes.get(file) || fs.readFileSync(file, 'utf8');
    const replaced = replaceText(source, currentVersion, nextVersion);
    if (replaced !== source) putText(file, replaced);
  }

  // Version literals in a guest's reconstruction script are part of its
  // provenance. Bind the planned manifest to the planned script bytes, while
  // refusing to bless a mismatch that already existed before preparation.
  for (const name of policy.literalOwners.filter((entry) => entry.endsWith('/pulse.guest-unit.json'))) {
    const file = path.join(repoRoot, name);
    const original = readJson(file);
    const script = assertContained(path.resolve(path.dirname(file), original.provenance.buildScript));
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    if (hash(fs.readFileSync(script)) !== original.provenance.buildScriptSha256) {
      fail(`guest build script provenance is stale: ${name}`);
    }
    const next = JSON.parse(writes.get(file) || fs.readFileSync(file, 'utf8'));
    next.provenance.buildScriptSha256 = hash(writes.get(script) || fs.readFileSync(script));
    putJson(file, next);
    if (original.id === 'pulse.crypto.es256.rustcrypto-p256.v1') {
      const contractName = 'wasm/packages/wasm-guest-link/src/constants.js';
      if (!policy.literalOwners.includes(contractName)) fail(`guest contract is not a release literal owner: ${contractName}`);
      const contractFile = path.join(repoRoot, contractName);
      const source = writes.get(contractFile) || fs.readFileSync(contractFile, 'utf8');
      const pins = [...source.matchAll(/buildScriptSha256: '([a-f0-9]{64})'/g)];
      if (pins.length !== 1 || pins[0][1] !== original.provenance.buildScriptSha256) {
        fail(`guest build script contract is stale: ${contractName}`);
      }
      putText(contractFile, source.replace(pins[0][0], `buildScriptSha256: '${next.provenance.buildScriptSha256}'`));
    }
  }

  for (const file of documentationOwners(policy)) {
    const source = writes.get(file) || fs.readFileSync(file, 'utf8');
    const replaced = options.historyMode === 'archive-current' && relative(file) === 'CHANGELOG.md'
      ? prepareChangelog(source, nextVersion, releaseManifest.display.candidateLabel, options.releasedAt)
      : replaceCandidateText(source, releaseManifest, nextVersion, options.releasedAt);
    if (replaced !== source) putText(file, replaced);
  }

  return Object.freeze({ writes, nextRelease, nextDocumentationVersions, dependencyUpdates, currentEntry });
}

function isAllowedChangedPath(name, planned, policy) {
  const normalized = slash(name);
  if (planned.has(normalized)) return true;
  if (policy.generatedExactPaths.includes(normalized)) return true;
  return policy.generatedPathPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function synchronize(plan, options) {
  if (options.noSync || options.dryRun) return [];
  const pnpm = require('./pnpm-toolchain.cjs').pnpmInvocation(repoRoot, plan.nextRelease.publication.pnpmVersion);
  const commands = [
    ['install', '--lockfile-only', '--ignore-scripts'],
    ['run', '-s', 'maintainer:sync'],
    ['run', '-s', 'docs:sync']
  ].map((args) => [pnpm.command, [...pnpm.prefix, ...args]]);
  for (const [command, args] of commands) run(command, args);
  return commands.map(([command, args]) => `${command} ${args.join(' ')}`);
}

function changedPaths() {
  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { capture: true });
  return new Set(status.stdout.split(/\r?\n/).filter(Boolean).map((line) => slash(line.slice(3))));
}

function writeTokenReport(oldVersion, nextVersion) {
  const matches = [];
  for (const file of filesUnder(repoRoot, (entry) => !entry.startsWith(path.join(repoRoot, '.pulse-release-preparation')))) {
    const name = relative(file);
    if (name.startsWith('release/documentation-site-archives/') || name.startsWith('.pulse-docs-site/')) continue;
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const count = source.split(oldVersion).length - 1;
    if (count) matches.push(Object.freeze({ path: name, occurrences: count }));
  }
  const report = Object.freeze({
    schemaVersion: 'pulse.release-version-token-report.v1',
    previousVersion: oldVersion,
    nextVersion,
    generatedAt: new Date().toISOString(),
    files: matches.length,
    occurrences: matches.reduce((sum, entry) => sum + entry.occurrences, 0),
    matches: Object.freeze(matches)
  });
  fs.mkdirSync(path.dirname(tokenReportFile), { recursive: true });
  fs.writeFileSync(tokenReportFile, stableJson(report));
  return report;
}

function applyPlan(plan, state, options, git) {
  for (const [file, content] of plan.writes) fs.writeFileSync(file, content);
  const synchronized = synchronize(plan, options);
  let unexpected = [];
  if (git.available) {
    const planned = new Set([...plan.writes.keys()].map(relative));
    for (const entry of plan.nextRelease.packages) planned.add(`${entry.dir}/README.md`);
    const after = changedPaths();
    const introduced = [...after].filter((name) => !git.changed.has(name));
    unexpected = introduced.filter((name) => !isAllowedChangedPath(name, planned, state.policy));
    if (unexpected.length) fail(`release preparation changed path(s) outside the allowlist:\n${unexpected.map((name) => `  ${name}`).join('\n')}`, 'PULSE_RELEASE_PREPARATION_BOUNDARY');
  }
  const tokens = writeTokenReport(state.currentVersion, options.version);
  return Object.freeze({ synchronized, unexpected, tokens });
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.version || !options.historyMode) fail(`version and history mode are required\n\n${usage()}`);
  options.version = assertVersion(options.version, 'requested version');
  options.releasedAt = assertDate(options.releasedAt);
  const releaseManifest = readJson(releaseManifestFile);
  options.channel = assertChannel(options.channel || releaseManifest.channel);
  const documentationVersions = readJson(documentationVersionsFile);
  const state = assertManifestConsistency(releaseManifest, documentationVersions);
  if (options.version === state.currentVersion) fail(`requested version ${options.version} is already current`);
  const git = gitState(options);
  let snapshot = null;
  if (options.historyMode === 'archive-current') snapshot = assertSnapshot(state.currentVersion, state.currentEntry, git);
  const plan = planRelease(releaseManifest, documentationVersions, options, state);

  if (options.dryRun) {
    process.stdout.write(stableJson({
      schemaVersion: 'pulse.release-preparation-plan.v1',
      mode: options.historyMode,
      previousVersion: state.currentVersion,
      nextVersion: options.version,
      channel: options.channel,
      releasedAt: options.releasedAt,
      files: [...plan.writes.keys()].map(relative).sort(),
      packageCount: plan.nextRelease.packages.length,
      dependencyUpdates: plan.dependencyUpdates,
      synchronization: options.noSync ? [] : ['lockfile-only', 'maintainer:sync', 'docs:sync'],
      gitTagCreated: false
    }));
    return;
  }

  const applied = applyPlan(plan, state, options, git);
  process.stdout.write([
    'ok - prepared allowlisted Pulse release identity',
    `  mode:     ${options.historyMode}`,
    `  previous: ${state.currentVersion} (${releaseManifest.channel})`,
    `  next:     ${options.version} (${options.channel})`,
    `  date:     ${options.releasedAt}`,
    `  files:    ${plan.writes.size}`,
    `  packages: ${plan.nextRelease.packages.length}`,
    `  exact Pulse dependency updates: ${plan.dependencyUpdates}`,
    snapshot ? `  archived snapshot: ${relative(snapshot.root)} (${snapshot.pages} pages)` : '',
    applied.synchronized.length ? `  synchronized: ${applied.synchronized.join(', ')}` : '  synchronization: skipped',
    `  stale-token report: ${relative(tokenReportFile)} (${applied.tokens.files} files, ${applied.tokens.occurrences} occurrences)`,
    '  Git tag: not created; tag the final reviewed commit, then publication seals its exact artifacts.',
    ''
  ].filter(Boolean).join('\n'));
}

module.exports = Object.freeze({
  parseArgs,
  assertManifestConsistency,
  replaceReleaseIdentity,
  replaceCandidateText,
  prepareChangelog,
  updatePulseDependencies,
  planRelease,
  isAllowedChangedPath,
  writeTokenReport,
  main
});

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
    process.exitCode = 1;
  }
}
