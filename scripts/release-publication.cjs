#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  RELEASE_MANIFEST,
  RELEASE_VERSION,
  LEGAL,
  PUBLICATION,
  PACKAGE_SET,
  RELEASE_MANIFEST_FILE
} = require('./package-support.cjs');

const PACK_SCHEMA = 'pulse.release-packages.v3';
const BUNDLE_SCHEMA = 'pulse.npm-publication-bundle.v1';
const AUDIT_SCHEMA = 'pulse.npm-package-name-audit.v1';
const PLAN_SCHEMA = 'pulse.npm-publication-plan.v1';
const REPORT_SCHEMA = 'pulse.npm-publication-report.v1';
const VERIFICATION_SCHEMA = 'pulse.npm-publication-verification.v1';
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');
const TOKEN_ENVIRONMENT_VARIABLES = Object.freeze([
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'NPM_AUTH_TOKEN',
  'NPM_CONFIG__AUTH',
  'NPM_CONFIG__AUTHTOKEN',
  'npm_config__auth',
  'npm_config__authToken'
]);
const ROLE_ORDER = Object.freeze({
  implementation: 0,
  compatibility: 1,
  'public-extension': 2,
  'public-provider': 3,
  'public-api': 4,
  'public-cli': 5
});

function fail(message, code = 'PULSE_NPM_PUBLICATION_INVALID', details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function slash(value) { return String(value).replace(/\\/g, '/'); }
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`Unable to read JSON ${file}: ${error.message}`); }
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sha512(bytes) { return crypto.createHash('sha512').update(bytes).digest('hex'); }
function shasum(bytes) { return crypto.createHash('sha1').update(bytes).digest('hex'); }
function integrity(bytes) { return `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`; }
function ensureDirectory(directory) { fs.mkdirSync(directory, { recursive: true }); }
function copyFile(source, destination) { ensureDirectory(path.dirname(destination)); fs.copyFileSync(source, destination); }

function filesUnder(root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(file, out);
    else if (entry.isFile()) out.push(file);
    else fail(`npm publication input contains an unsupported filesystem entry: ${file}`);
  }
  return out;
}

function resolveInside(root, relativeFile, context) {
  const normalized = slash(relativeFile || '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.split('/').includes('..')) {
    fail(`${context} must be a safe relative path, found ${relativeFile}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalized);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) fail(`${context} escapes ${resolvedRoot}`);
  return resolved;
}

function pathContains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function canonicalPath(candidate) {
  const resolved = path.resolve(candidate);
  const suffix = [];
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const canonical = fs.existsSync(existing) ? fs.realpathSync.native(existing) : existing;
  return path.resolve(canonical, ...suffix);
}

function assertSafeRecreatedDirectory(directory, options = {}) {
  const context = options.context || 'npm publication output directory';
  const resolved = path.resolve(directory);
  const repository = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const canonicalRepository = canonicalPath(repository);
  const canonicalTarget = canonicalPath(resolved);
  if (canonicalTarget === path.parse(canonicalTarget).root) {
    fail(`${context} must not be a filesystem root`, 'PULSE_NPM_PUBLICATION_UNSAFE_OUTPUT');
  }
  if (pathContains(canonicalTarget, canonicalRepository)) {
    fail(`${context} must not be the repository root or one of its ancestors`, 'PULSE_NPM_PUBLICATION_UNSAFE_OUTPUT');
  }
  const lexicalInsideRepository = pathContains(repository, resolved);
  const canonicalInsideRepository = pathContains(canonicalRepository, canonicalTarget);
  if (lexicalInsideRepository !== canonicalInsideRepository) {
    fail(`${context} must not traverse a symlink across the repository boundary`, 'PULSE_NPM_PUBLICATION_UNSAFE_OUTPUT');
  }
  if (lexicalInsideRepository) {
    const namespace = path.relative(repository, resolved).split(path.sep)[0];
    if (!namespace.startsWith('.pulse-')) {
      fail(`${context} inside the repository must use a .pulse-* generated-output namespace`, 'PULSE_NPM_PUBLICATION_UNSAFE_OUTPUT');
    }
  }
  for (const sourceDirectory of options.sourceDirectories || []) {
    const canonicalSource = canonicalPath(sourceDirectory);
    if (pathContains(canonicalTarget, canonicalSource) || pathContains(canonicalSource, canonicalTarget)) {
      fail(`${context} must not overlap source directory ${path.resolve(sourceDirectory)}`, 'PULSE_NPM_PUBLICATION_UNSAFE_OUTPUT');
    }
  }
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory()) fail(`${context} must be a directory`, 'PULSE_NPM_PUBLICATION_UNSAFE_OUTPUT');
    const allowedEntries = new Set(options.allowedEntries || []);
    const unexpected = fs.readdirSync(resolved).filter((entry) => !allowedEntries.has(entry));
    if (unexpected.length) {
      fail(`${context} contains unrelated entries and will not be replaced: ${unexpected.join(', ')}`, 'PULSE_NPM_PUBLICATION_UNSAFE_OUTPUT');
    }
  }
  return resolved;
}

function parseVersion(value, context = 'version') {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value || ''));
  if (!match) fail(`${context} must be a semantic version, found ${value}`);
  return match.slice(1, 4).map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    input: options.input,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 300000
  });
  if (result.error || result.status !== 0) {
    if (options.allowFailure) return result;
    const detail = [result.stdout, result.stderr, result.error && result.error.message].filter(Boolean).join('\n').trim();
    fail(`Command failed: ${command} ${args.join(' ')}${detail ? `\n${detail}` : ''}`, 'PULSE_NPM_PUBLICATION_COMMAND_FAILED');
  }
  return result;
}

function sleep(milliseconds) {
  const wait = Math.max(0, Number(milliseconds) || 0);
  if (!wait) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
}

function waitForRegistry(adapter, entry, distTag, options = {}) {
  const attempts = Number(options.attempts || 10);
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const published = adapter.version(entry.name, entry.version);
    const tags = published ? adapter.tags(entry.name) : {};
    last = Object.freeze({
      published,
      distTagVersion: tags[distTag] || null,
      integrityMatches: Boolean(published && published.integrity === entry.integrity),
      distTagMatches: tags[distTag] === entry.version
    });
    if (last.integrityMatches && last.distTagMatches) return last;
    if (published && published.integrity && published.integrity !== entry.integrity) break;
    if (attempt < attempts) sleep(Math.min(30000, 1000 * (2 ** Math.min(attempt - 1, 5))));
  }
  fail(`${entry.name}@${entry.version} did not converge in the npm registry`, 'PULSE_NPM_REGISTRY_DID_NOT_CONVERGE', last);
}

function gitValue(repoRoot, args, fallback = '') {
  const result = run('git', args, { cwd: repoRoot, allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : fallback;
}

function loadPublicationConfig() {
  const config = PUBLICATION;
  if (!config || typeof config !== 'object') fail('release manifest publication policy is missing');
  if (config.registry !== 'https://registry.npmjs.org') fail('npm publication registry must be the canonical public registry');
  if (config.distTag !== RELEASE_MANIFEST.channel) fail('npm dist-tag must match the release channel');
  if (config.workflowFile !== 'npm-publish.yml') fail('trusted publishing must remain bound to npm-publish.yml');
  if (!/^[A-Za-z0-9_.-]+$/.test(config.candidateArtifact || '')) fail('npm publication candidateArtifact is invalid');
  if (config.authentication !== 'npm-trusted-publishing-oidc') fail('npm publication must use trusted publishing OIDC');
  if (config.provenance !== 'automatic') fail('npm provenance must remain automatic');
  if (config.access !== 'public') fail('Pulse packages must remain public');
  if (!config.requireExistingPackageNames) fail('trusted publishing requires an explicit package-name bootstrap gate');
  if (compareVersions(config.npmVersion, '11.5.1') < 0) fail('trusted publishing requires npm 11.5.1 or newer');
  return config;
}

function roleRank(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_ORDER, role) ? ROLE_ORDER[role] : 100;
}

function publishOrder(packages) {
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  if (byName.size !== packages.length) fail('publication set contains duplicate package names');
  const dependencies = new Map();
  const dependents = new Map(packages.map((entry) => [entry.name, new Set()]));
  for (const entry of packages) {
    const required = new Set();
    for (const dependency of entry.pulseDependencies || []) {
      if (!['dependencies', 'optionalDependencies'].includes(dependency.section)) continue;
      if (!byName.has(dependency.name)) fail(`${entry.name} depends on missing release package ${dependency.name}`);
      if (dependency.name === entry.name) fail(`${entry.name} cannot depend on itself`);
      required.add(dependency.name);
      dependents.get(dependency.name).add(entry.name);
    }
    dependencies.set(entry.name, required);
  }
  const sortNames = (names) => names.sort((left, right) => {
    const a = byName.get(left);
    const b = byName.get(right);
    return roleRank(a.role) - roleRank(b.role) || left.localeCompare(right);
  });
  const ready = sortNames([...dependencies].filter(([, values]) => values.size === 0).map(([name]) => name));
  const output = [];
  while (ready.length) {
    const name = ready.shift();
    output.push(name);
    for (const dependent of dependents.get(name)) {
      const values = dependencies.get(dependent);
      values.delete(name);
      if (values.size === 0) {
        ready.push(dependent);
        sortNames(ready);
      }
    }
  }
  if (output.length !== packages.length) {
    const cyclic = [...dependencies].filter(([, values]) => values.size > 0).map(([name, values]) => `${name} -> ${[...values].join(', ')}`);
    fail(`Pulse package dependency graph contains a cycle: ${cyclic.join('; ')}`);
  }
  return Object.freeze(output);
}

function normalizePulseDependencies(value = {}) {
  const dependencies = [];
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(value[section] || {})) {
      if (!name.startsWith('@pulse-compute/')) continue;
      dependencies.push(Object.freeze({ name, section, version }));
    }
  }
  dependencies.sort((left, right) => left.name.localeCompare(right.name) || left.section.localeCompare(right.section));
  return Object.freeze(dependencies);
}

function catalogPulseDependencies(repoRoot, catalogEntry) {
  const manifest = readJson(path.join(repoRoot, catalogEntry.dir, 'package.json'));
  const catalogNames = new Set(PACKAGE_SET.map((entry) => entry.name));
  return Object.freeze(normalizePulseDependencies(manifest)
    .filter((entry) => catalogNames.has(entry.name))
    .map((entry) => Object.freeze({
      name: entry.name,
      section: entry.section,
      version: RELEASE_VERSION
    })));
}

function verifyPulseDependencies(expectedDependencies, published, context) {
  const expected = [...(expectedDependencies || [])]
    .map((entry) => Object.freeze({ name: entry.name, section: entry.section, version: entry.version }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.section.localeCompare(right.section));
  const actual = normalizePulseDependencies(published || {});
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${context} Pulse dependency metadata differs from the synchronized release`, 'PULSE_NPM_DEPENDENCY_MISMATCH', { expected, actual });
  }
  for (const dependency of actual) {
    if (dependency.version !== RELEASE_VERSION) {
      fail(`${context} ${dependency.section}.${dependency.name} is ${dependency.version}, expected ${RELEASE_VERSION}`, 'PULSE_NPM_DEPENDENCY_MISMATCH');
    }
  }
  return actual;
}

function validatePackManifest(packDir) {
  const config = loadPublicationConfig();
  const manifestFile = path.join(packDir, 'pulse-release-manifest.json');
  const sourceCatalogFile = path.join(packDir, 'pulse-source-release-catalog.json');
  if (!fs.existsSync(manifestFile) || !fs.existsSync(sourceCatalogFile)) fail(`${packDir} is not a complete release:pack output`);
  const manifest = readJson(manifestFile);
  const sourceCatalog = readJson(sourceCatalogFile);
  if (manifest.schemaVersion !== PACK_SCHEMA) fail(`unsupported packed release schema ${manifest.schemaVersion}`);
  if (manifest.releaseVersion !== RELEASE_VERSION || sourceCatalog.releaseVersion !== RELEASE_VERSION) fail('packed release version does not match the release manifest');
  if (manifest.channel !== RELEASE_MANIFEST.channel || sourceCatalog.channel !== RELEASE_MANIFEST.channel) fail('packed release channel does not match the release manifest');
  if (JSON.stringify(manifest.legal) !== JSON.stringify(LEGAL)) fail('packed release legal contract does not match the release manifest');
  const sourceBytes = fs.readFileSync(sourceCatalogFile);
  if (!manifest.sourceCatalog || manifest.sourceCatalog.sha256 !== sha256(sourceBytes)) fail('packed source catalog checksum is invalid');
  const canonicalSourceBytes = fs.readFileSync(RELEASE_MANIFEST_FILE);
  if (!sourceBytes.equals(canonicalSourceBytes)) fail('packed source catalog differs from release/pulse-release-manifest.json');
  const expected = new Map(PACKAGE_SET.map((entry) => [entry.name, entry]));
  if (manifest.packageCount !== expected.size || !Array.isArray(manifest.packages) || manifest.packages.length !== expected.size) fail(`packed release must contain exactly ${expected.size} packages`);
  const packages = [];
  for (const entry of manifest.packages) {
    const source = expected.get(entry.name);
    if (!source) fail(`packed release contains unexpected package ${entry.name}`);
    if (
      entry.version !== RELEASE_VERSION
      || entry.role !== source.role
      || entry.supportTier !== source.tier
      || entry.license !== RELEASE_MANIFEST.license
      || JSON.stringify(entry.legalFiles) !== JSON.stringify(LEGAL.packageFiles)
      || entry.nodeEngines !== config.nodeEngines
    ) fail(`packed metadata for ${entry.name} differs from the release catalog`);
    const tarball = resolveInside(packDir, entry.tarball, `${entry.name} tarball`);
    if (!fs.existsSync(tarball) || !fs.statSync(tarball).isFile()) fail(`${entry.name} tarball is missing: ${entry.tarball}`);
    const bytes = fs.readFileSync(tarball);
    const actual = Object.freeze({ sha256: sha256(bytes), sha512: sha512(bytes), integrity: integrity(bytes), shasum: shasum(bytes) });
    for (const field of Object.keys(actual)) if (entry[field] !== actual[field]) fail(`${entry.name} packed ${field} is invalid`);
    packages.push(Object.freeze({ ...entry, sourceTarball: tarball }));
    expected.delete(entry.name);
  }
  if (expected.size) fail(`packed release is missing ${[...expected.keys()].join(', ')}`);
  if (config.distTag !== manifest.channel) fail('publication dist-tag differs from the packed release channel');
  return Object.freeze({ manifest, sourceCatalog, manifestFile, sourceCatalogFile, packages: Object.freeze(packages) });
}

function sourceIdentity(repoRoot, options = {}) {
  const commit = String(options.sourceCommit || gitValue(repoRoot, ['rev-parse', 'HEAD'], 'unavailable')).trim();
  const exactTag = gitValue(repoRoot, ['describe', '--tags', '--exact-match'], '');
  const symbolicRef = gitValue(repoRoot, ['symbolic-ref', '-q', 'HEAD'], '');
  const rawRef = String(options.sourceRef || process.env.GITHUB_REF || exactTag || symbolicRef || 'detached').trim();
  const ref = /^v\d+\.\d+\.\d+$/.test(rawRef) ? `refs/tags/${rawRef}` : rawRef;
  return Object.freeze({ commit, ref });
}

function validateSourceIdentity(identity) {
  if (!identity || !/^[0-9a-f]{40}$/.test(identity.commit || '')) {
    fail(`publication source commit must be a full lowercase SHA, found ${identity && identity.commit}`);
  }
  if (!identity.ref || typeof identity.ref !== 'string' || /[\r\n\0]/.test(identity.ref)) {
    fail(`publication source ref is invalid: ${identity && identity.ref}`);
  }
}

function validateReleaseIdentity(identity) {
  validateSourceIdentity(identity);
  const expectedRef = `refs/tags/v${RELEASE_VERSION}`;
  const normalizedRef = identity.ref === `v${RELEASE_VERSION}` ? expectedRef : identity.ref;
  if (normalizedRef !== expectedRef) fail(`publication must run from ${expectedRef}; found ${identity.ref || '(no ref)'}`, 'PULSE_NPM_PUBLICATION_WRONG_REF');
}

function preparePublicationBundle(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const config = loadPublicationConfig();
  const packDir = path.resolve(options.packDir || path.join(repoRoot, '.pulse-release'));
  const outDir = assertSafeRecreatedDirectory(
    options.outDir || path.join(repoRoot, '.pulse-publication'),
    {
      repoRoot,
      sourceDirectories: [packDir],
      allowedEntries: [
        'packages',
        'pulse-publication-manifest.json',
        'pulse-release-manifest.json',
        'pulse-source-release-catalog.json',
        'sha256sums.txt'
      ]
    }
  );
  const packed = validatePackManifest(packDir);
  const order = publishOrder(packed.packages);
  const identity = sourceIdentity(repoRoot, options);
  validateSourceIdentity(identity);
  if (options.requireReleaseRef) validateReleaseIdentity(identity);

  fs.rmSync(outDir, { recursive: true, force: true });
  ensureDirectory(path.join(outDir, 'packages'));
  copyFile(packed.manifestFile, path.join(outDir, 'pulse-release-manifest.json'));
  copyFile(packed.sourceCatalogFile, path.join(outDir, 'pulse-source-release-catalog.json'));

  const byName = new Map(packed.packages.map((entry) => [entry.name, entry]));
  const packageRecords = order.map((name, index) => {
    const entry = byName.get(name);
    const relativeTarball = `packages/${path.basename(entry.sourceTarball)}`;
    copyFile(entry.sourceTarball, path.join(outDir, relativeTarball));
    return Object.freeze({
      order: index + 1,
      name: entry.name,
      version: entry.version,
      role: entry.role,
      supportTier: entry.supportTier,
      license: entry.license,
      legalFiles: entry.legalFiles,
      nodeEngines: entry.nodeEngines,
      tarball: relativeTarball,
      bytes: entry.bytes,
      sha256: entry.sha256,
      sha512: entry.sha512,
      integrity: entry.integrity,
      shasum: entry.shasum,
      pulseDependencies: entry.pulseDependencies || []
    });
  });
  const bundleManifest = Object.freeze({
    schemaVersion: BUNDLE_SCHEMA,
    releaseVersion: RELEASE_VERSION,
    releaseTag: `v${RELEASE_VERSION}`,
    channel: RELEASE_MANIFEST.channel,
    distTag: config.distTag,
    legal: LEGAL,
    registry: config.registry,
    access: config.access,
    authentication: config.authentication,
    provenance: config.provenance,
    workflowFile: config.workflowFile,
    environment: config.environment,
    candidateArtifact: config.candidateArtifact,
    source: identity,
    sourceCatalogSha256: sha256(fs.readFileSync(path.join(outDir, 'pulse-source-release-catalog.json'))),
    packManifestSha256: sha256(fs.readFileSync(path.join(outDir, 'pulse-release-manifest.json'))),
    packageCount: packageRecords.length,
    packages: Object.freeze(packageRecords)
  });
  fs.writeFileSync(path.join(outDir, 'pulse-publication-manifest.json'), stableJson(bundleManifest));
  const checksumFiles = [
    'pulse-publication-manifest.json',
    'pulse-release-manifest.json',
    'pulse-source-release-catalog.json',
    ...packageRecords.map((entry) => entry.tarball)
  ].sort();
  const checksumLines = checksumFiles.map((relativeFile) => `${sha256(fs.readFileSync(path.join(outDir, relativeFile)))}  ${relativeFile}`);
  fs.writeFileSync(path.join(outDir, 'sha256sums.txt'), `${checksumLines.join('\n')}\n`);
  return verifyPublicationBundle({ repoRoot, bundleDir: outDir });
}

function verifyPublicationBundle(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const config = loadPublicationConfig();
  const bundleDir = path.resolve(options.bundleDir || path.join(repoRoot, '.pulse-publication'));
  const manifestFile = path.join(bundleDir, 'pulse-publication-manifest.json');
  if (!fs.existsSync(manifestFile)) fail(`${bundleDir} is missing pulse-publication-manifest.json`);
  const manifest = readJson(manifestFile);
  if (manifest.schemaVersion !== BUNDLE_SCHEMA || manifest.releaseVersion !== RELEASE_VERSION) fail('publication bundle schema or version is invalid');
  const bundledPackManifestFile = path.join(bundleDir, 'pulse-release-manifest.json');
  const bundledSourceCatalogFile = path.join(bundleDir, 'pulse-source-release-catalog.json');
  if (!fs.existsSync(bundledPackManifestFile) || !fs.existsSync(bundledSourceCatalogFile)) fail('publication bundle is missing its packed release manifests');
  const bundledPackManifest = readJson(bundledPackManifestFile);
  const bundledSourceCatalog = readJson(bundledSourceCatalogFile);
  if (bundledPackManifest.schemaVersion !== PACK_SCHEMA || bundledPackManifest.releaseVersion !== RELEASE_VERSION || bundledPackManifest.channel !== RELEASE_MANIFEST.channel) fail('publication bundle packed release manifest is invalid');
  if (JSON.stringify(manifest.legal) !== JSON.stringify(LEGAL) || JSON.stringify(bundledPackManifest.legal) !== JSON.stringify(LEGAL)) fail('publication bundle legal contract is invalid');
  if (bundledSourceCatalog.releaseVersion !== RELEASE_VERSION || bundledSourceCatalog.channel !== RELEASE_MANIFEST.channel) fail('publication bundle source catalog release identity is invalid');
  if (!fs.readFileSync(bundledSourceCatalogFile).equals(fs.readFileSync(RELEASE_MANIFEST_FILE))) fail('publication bundle source catalog differs from the checked-out release catalog');
  if (!bundledPackManifest.sourceCatalog || bundledPackManifest.sourceCatalog.sha256 !== sha256(fs.readFileSync(bundledSourceCatalogFile))) fail('publication bundle packed source-catalog checksum is invalid');
  for (const [field, expected] of Object.entries({
    registry: config.registry,
    distTag: config.distTag,
    access: config.access,
    authentication: config.authentication,
    provenance: config.provenance,
    workflowFile: config.workflowFile,
    environment: config.environment,
    candidateArtifact: config.candidateArtifact
  })) if (manifest[field] !== expected) fail(`publication bundle ${field} differs from the release manifest`);
  if (manifest.channel !== RELEASE_MANIFEST.channel || manifest.releaseTag !== `v${RELEASE_VERSION}`) fail('publication bundle release identity is invalid');
  validateSourceIdentity(manifest.source || {});
  if (options.requireReleaseRef) validateReleaseIdentity(manifest.source || {});
  if (!Array.isArray(manifest.packages) || manifest.packageCount !== PACKAGE_SET.length || manifest.packages.length !== PACKAGE_SET.length) fail(`publication bundle must contain ${PACKAGE_SET.length} packages`);
  if (!Array.isArray(bundledPackManifest.packages) || bundledPackManifest.packageCount !== PACKAGE_SET.length || bundledPackManifest.packages.length !== PACKAGE_SET.length) fail(`bundled packed release must contain ${PACKAGE_SET.length} packages`);
  const expectedNames = new Set(PACKAGE_SET.map((entry) => entry.name));
  const packedByName = new Map(bundledPackManifest.packages.map((entry) => [entry.name, entry]));
  if (packedByName.size !== bundledPackManifest.packages.length) fail('bundled packed release contains duplicate package names');
  const orders = [];
  for (const entry of manifest.packages) {
    if (!expectedNames.delete(entry.name)) fail(`publication bundle contains duplicate or unexpected ${entry.name}`);
    if (entry.version !== RELEASE_VERSION) fail(`${entry.name} publication version is invalid`);
    const packed = packedByName.get(entry.name);
    if (!packed) fail(`${entry.name} is missing from the bundled packed release manifest`);
    const expectedRecord = {
      name: packed.name,
      version: packed.version,
      role: packed.role,
      supportTier: packed.supportTier,
      license: packed.license,
      legalFiles: packed.legalFiles,
      nodeEngines: packed.nodeEngines,
      bytes: packed.bytes,
      sha256: packed.sha256,
      sha512: packed.sha512,
      integrity: packed.integrity,
      shasum: packed.shasum,
      pulseDependencies: packed.pulseDependencies || []
    };
    for (const [field, expected] of Object.entries(expectedRecord)) {
      if (JSON.stringify(entry[field]) !== JSON.stringify(expected)) fail(`${entry.name} publication ${field} differs from the packed release manifest`);
    }
    if (path.basename(entry.tarball) !== packed.tarball || path.dirname(slash(entry.tarball)) !== 'packages') fail(`${entry.name} publication tarball path differs from the packed release manifest`);
    const tarball = resolveInside(bundleDir, entry.tarball, `${entry.name} publication tarball`);
    if (!fs.existsSync(tarball)) fail(`${entry.name} publication tarball is missing`);
    const bytes = fs.readFileSync(tarball);
    const actual = { bytes: bytes.length, sha256: sha256(bytes), sha512: sha512(bytes), integrity: integrity(bytes), shasum: shasum(bytes) };
    for (const field of Object.keys(actual)) if (entry[field] !== actual[field]) fail(`${entry.name} publication ${field} is invalid`);
    verifyPulseDependencies(entry.pulseDependencies, Object.fromEntries(['dependencies', 'optionalDependencies', 'peerDependencies'].map((section) => [section, Object.fromEntries((entry.pulseDependencies || []).filter((dependency) => dependency.section === section).map((dependency) => [dependency.name, dependency.version]))])), `${entry.name} sealed publication`);
    orders.push(entry.order);
  }
  if (expectedNames.size) fail(`publication bundle is missing ${[...expectedNames].join(', ')}`);
  if (JSON.stringify(orders) !== JSON.stringify(Array.from({ length: manifest.packages.length }, (_, index) => index + 1))) fail('publication order is not contiguous');
  const computedOrder = publishOrder(manifest.packages);
  if (JSON.stringify(computedOrder) !== JSON.stringify(manifest.packages.map((entry) => entry.name))) fail('publication bundle order does not match its dependency graph');
  for (const [relativeFile, expected] of [
    ['pulse-source-release-catalog.json', manifest.sourceCatalogSha256],
    ['pulse-release-manifest.json', manifest.packManifestSha256]
  ]) {
    const file = path.join(bundleDir, relativeFile);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== expected) fail(`${relativeFile} checksum is invalid`);
  }
  const checksumFile = path.join(bundleDir, 'sha256sums.txt');
  if (!fs.existsSync(checksumFile)) fail('publication bundle is missing sha256sums.txt');
  const checksumPaths = new Set();
  for (const line of fs.readFileSync(checksumFile, 'utf8').trim().split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) fail(`invalid checksum line: ${line}`);
    if (checksumPaths.has(match[2])) fail(`duplicate publication checksum path: ${match[2]}`);
    checksumPaths.add(match[2]);
    const file = resolveInside(bundleDir, match[2], 'checksum path');
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== match[1]) fail(`checksum verification failed for ${match[2]}`);
  }
  const expectedChecksumPaths = [
    'pulse-publication-manifest.json',
    'pulse-release-manifest.json',
    'pulse-source-release-catalog.json',
    ...manifest.packages.map((entry) => entry.tarball)
  ].sort();
  if (JSON.stringify([...checksumPaths].sort()) !== JSON.stringify(expectedChecksumPaths)) fail('publication checksum inventory is incomplete');
  const actualFiles = filesUnder(bundleDir).map((file) => slash(path.relative(bundleDir, file))).sort();
  const expectedFiles = [...expectedChecksumPaths, 'sha256sums.txt'].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) fail('publication bundle contains files not represented by its checksum inventory');
  return Object.freeze({
    schemaVersion: BUNDLE_SCHEMA,
    status: 'ok',
    releaseVersion: manifest.releaseVersion,
    channel: manifest.channel,
    source: manifest.source,
    packageCount: manifest.packageCount,
    publishOrder: Object.freeze(manifest.packages.map((entry) => entry.name)),
    bundleDir,
    manifest
  });
}

function parseJsonOutput(result, context) {
  const source = String(result.stdout || '').trim();
  if (!source) fail(`${context} returned no JSON`);
  try { return JSON.parse(source); }
  catch { fail(`${context} returned invalid JSON: ${source.slice(0, 500)}`); }
}

function fixtureRegistry(file) {
  if (!file) return undefined;
  const fixture = readJson(path.resolve(file));
  if (!fixture || typeof fixture !== 'object' || !fixture.packages || typeof fixture.packages !== 'object') fail('registry fixture must contain a packages object');
  return fixture;
}

function npmRegistryAdapter(options = {}) {
  const registry = options.registry || loadPublicationConfig().registry;
  const fixture = fixtureRegistry(options.fixtureFile);
  if (fixture) {
    return Object.freeze({
      packageExists(name) { return Boolean(fixture.packages[name]); },
      version(name, version) {
        const value = fixture.packages[name]?.versions?.[version];
        return value ? Object.freeze({
          integrity: value.integrity,
          tarball: value.tarball || `fixture://${encodeURIComponent(name)}/${version}.tgz`,
          shasum: value.shasum,
          dependencies: Object.freeze({ ...(value.dependencies || {}) }),
          optionalDependencies: Object.freeze({ ...(value.optionalDependencies || {}) }),
          peerDependencies: Object.freeze({ ...(value.peerDependencies || {}) })
        }) : undefined;
      },
      tags(name) { return Object.freeze({ ...(fixture.packages[name]?.distTags || {}) }); }
    });
  }
  return Object.freeze({
    packageExists(name) {
      const result = run('npm', ['view', name, 'name', '--json', '--registry', registry], { allowFailure: true, timeout: 120000 });
      if (result.status === 0) return true;
      const detail = `${result.stdout || ''}\n${result.stderr || ''}`;
      if (/E404|404 Not Found|is not in this registry/i.test(detail)) return false;
      fail(`npm registry package lookup failed for ${name}: ${detail.trim()}`);
    },
    version(name, version) {
      const result = run('npm', ['view', `${name}@${version}`, 'dist', 'dependencies', 'optionalDependencies', 'peerDependencies', '--json', '--registry', registry], { allowFailure: true, timeout: 120000 });
      if (result.status !== 0) {
        const detail = `${result.stdout || ''}\n${result.stderr || ''}`;
        if (/E404|404 Not Found|is not in this registry/i.test(detail)) return undefined;
        fail(`npm registry lookup failed for ${name}@${version}: ${detail.trim()}`);
      }
      let value = parseJsonOutput(result, `npm view ${name}@${version}`);
      if (Array.isArray(value) && value.length === 1) value = value[0];
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`npm view ${name}@${version} returned an unexpected payload`);
      const dist = value.dist && typeof value.dist === 'object' ? value.dist : value;
      return Object.freeze({
        integrity: dist.integrity || value['dist.integrity'] || value.integrity,
        tarball: dist.tarball || value['dist.tarball'] || value.tarball,
        shasum: dist.shasum || value['dist.shasum'] || value.shasum,
        dependencies: Object.freeze({ ...(value.dependencies || {}) }),
        optionalDependencies: Object.freeze({ ...(value.optionalDependencies || {}) }),
        peerDependencies: Object.freeze({ ...(value.peerDependencies || {}) })
      });
    },
    tags(name) {
      const result = run('npm', ['view', name, 'dist-tags', '--json', '--registry', registry], { timeout: 120000 });
      return Object.freeze(parseJsonOutput(result, `npm view ${name} dist-tags`) || {});
    }
  });
}

function auditPackageNames(options = {}) {
  const verification = verifyPublicationBundle(options);
  const config = loadPublicationConfig();
  const adapter = options.adapter || npmRegistryAdapter(options);
  const packages = verification.manifest.packages.map((entry) => Object.freeze({ name: entry.name, exists: adapter.packageExists(entry.name) }));
  const missing = packages.filter((entry) => !entry.exists).map((entry) => entry.name);
  const result = Object.freeze({
    schemaVersion: AUDIT_SCHEMA,
    status: missing.length ? 'bootstrap-required' : 'ok',
    releaseVersion: RELEASE_VERSION,
    registry: config.registry,
    packages: Object.freeze(packages),
    missing: Object.freeze(missing)
  });
  if (options.jsonFile) { ensureDirectory(path.dirname(path.resolve(options.jsonFile))); fs.writeFileSync(path.resolve(options.jsonFile), stableJson(result)); }
  if (missing.length && !options.allowMissing) fail(`npm package bootstrap is required for: ${missing.join(', ')}`, 'PULSE_NPM_BOOTSTRAP_REQUIRED', result);
  return result;
}

function publicationPlan(options = {}) {
  const verification = verifyPublicationBundle(options);
  const config = loadPublicationConfig();
  const adapter = options.adapter || npmRegistryAdapter(options);
  const rows = [];
  let conflict = false;
  let missingNames = false;
  for (const entry of verification.manifest.packages) {
    const exists = adapter.packageExists(entry.name);
    if (!exists) {
      missingNames = true;
      rows.push(Object.freeze({ name: entry.name, version: entry.version, action: 'bootstrap-required', expectedIntegrity: entry.integrity }));
      continue;
    }
    const current = adapter.version(entry.name, entry.version);
    if (!current) {
      rows.push(Object.freeze({ name: entry.name, version: entry.version, action: 'publish', expectedIntegrity: entry.integrity }));
      continue;
    }
    if (current.integrity !== entry.integrity) {
      conflict = true;
      rows.push(Object.freeze({ name: entry.name, version: entry.version, action: 'integrity-conflict', expectedIntegrity: entry.integrity, registryIntegrity: current.integrity || null }));
      continue;
    }
    const tags = adapter.tags(entry.name);
    if (tags[config.distTag] !== entry.version) {
      conflict = true;
      rows.push(Object.freeze({
        name: entry.name,
        version: entry.version,
        action: 'dist-tag-conflict',
        expectedIntegrity: entry.integrity,
        registryIntegrity: current.integrity,
        expectedDistTag: entry.version,
        registryDistTag: tags[config.distTag] || null
      }));
      continue;
    }
    rows.push(Object.freeze({ name: entry.name, version: entry.version, action: 'already-published', expectedIntegrity: entry.integrity, registryIntegrity: current.integrity }));
  }
  const status = conflict ? 'conflict' : missingNames ? 'bootstrap-required' : 'ready';
  const result = Object.freeze({
    schemaVersion: PLAN_SCHEMA,
    status,
    releaseVersion: RELEASE_VERSION,
    releaseTag: `v${RELEASE_VERSION}`,
    channel: RELEASE_MANIFEST.channel,
    distTag: config.distTag,
    registry: config.registry,
    source: verification.manifest.source,
    packageCount: rows.length,
    packages: Object.freeze(rows)
  });
  if (options.jsonFile) { ensureDirectory(path.dirname(path.resolve(options.jsonFile))); fs.writeFileSync(path.resolve(options.jsonFile), stableJson(result)); }
  if (options.check !== false && status !== 'ready') {
    const code = status === 'conflict' ? 'PULSE_NPM_PUBLICATION_CONFLICT' : 'PULSE_NPM_BOOTSTRAP_REQUIRED';
    fail(`npm publication plan is ${status}`, code, result);
  }
  return result;
}

function expectedGitHubRepository() {
  const web = RELEASE_MANIFEST.repository && RELEASE_MANIFEST.repository.web;
  let parsed;
  try { parsed = new URL(String(web || '')); }
  catch (error) { fail(`release repository URL is invalid: ${error.message}`); }
  const match = /^\/([^/]+)\/([^/]+?)\/?$/.exec(parsed.pathname);
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || !match) {
    fail(`release repository must be a canonical GitHub web URL, found ${web}`);
  }
  return `${match[1]}/${match[2]}`;
}

function assertTrustedPublishingEnvironment(manifest, options = {}) {
  if (options.allowNonGithub) return;
  const config = loadPublicationConfig();
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') fail('npm publication may run only on a GitHub-hosted Actions runner');
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) fail('GitHub OIDC token variables are unavailable; the publish job needs id-token: write');
  const expectedRepository = expectedGitHubRepository();
  if (process.env.GITHUB_REPOSITORY !== expectedRepository) fail(`npm publication must run in ${expectedRepository}`);
  const workflowRef = process.env.GITHUB_WORKFLOW_REF || '';
  const expectedWorkflowRef = `${expectedRepository}/.github/workflows/${config.workflowFile}@${process.env.GITHUB_REF || ''}`;
  if (workflowRef !== expectedWorkflowRef) fail(`npm publication must run from ${expectedWorkflowRef}`);
  const nativeIdentity = Object.freeze({
    commit: process.env.GITHUB_SHA || '',
    ref: process.env.GITHUB_REF || ''
  });
  validateReleaseIdentity(nativeIdentity);
  if (process.env.GITHUB_REF_TYPE && process.env.GITHUB_REF_TYPE !== 'tag') fail('npm publication must be dispatched from the release tag');
  const authorizedIdentity = Object.freeze({
    commit: process.env.PULSE_RELEASE_SHA || nativeIdentity.commit,
    ref: process.env.PULSE_RELEASE_REF || nativeIdentity.ref
  });
  validateReleaseIdentity(authorizedIdentity);
  if (authorizedIdentity.commit !== nativeIdentity.commit || authorizedIdentity.ref !== nativeIdentity.ref) fail('explicit publication authority differs from the GitHub release-tag run');
  if (manifest.source.commit !== nativeIdentity.commit || manifest.source.ref !== nativeIdentity.ref) fail('publication bundle source does not match the GitHub release-tag run');
  const present = new Set(TOKEN_ENVIRONMENT_VARIABLES.filter((name) => process.env[name]));
  for (const [name, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (/^NPM_CONFIG_.*(?:AUTH|TOKEN)/i.test(name) || /^(?:NODE|NPM)_.*TOKEN$/i.test(name)) present.add(name);
  }
  if (present.size) fail(`long-lived npm credential variables are forbidden: ${[...present].sort().join(', ')}`);
  if (process.versions.node !== config.nodeVersion) fail(`Node ${process.versions.node} differs from release-owned Node ${config.nodeVersion}`);
  const actualNpm = run('npm', ['--version']).stdout.trim();
  if (actualNpm !== config.npmVersion) fail(`npm ${actualNpm} differs from release-owned npm ${config.npmVersion}`);
}

function securePublishEnvironment(userConfig, environment = process.env) {
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if (TOKEN_ENVIRONMENT_VARIABLES.includes(key) || /^NPM_CONFIG_.*(?:AUTH|TOKEN)/i.test(key) || /^(?:NODE|NPM)_.*TOKEN$/i.test(key)) delete env[key];
  }
  env.NPM_CONFIG_USERCONFIG = userConfig;
  env.NPM_CONFIG_PROVENANCE = 'true';
  env.NPM_CONFIG_AUDIT = 'false';
  env.NPM_CONFIG_FUND = 'false';
  return env;
}

function publishBundle(options = {}) {
  const verification = verifyPublicationBundle(options);
  const config = loadPublicationConfig();
  assertTrustedPublishingEnvironment(verification.manifest, options);
  const adapter = options.adapter || npmRegistryAdapter(options);
  const plan = publicationPlan({ ...options, adapter, check: true });
  const results = [];
  const authRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-npm-oidc-'));
  const userConfig = path.join(authRoot, 'npmrc');
  fs.writeFileSync(userConfig, `registry=${config.registry}\nprovenance=true\n`);
  try {
    for (let index = 0; index < verification.manifest.packages.length; index += 1) {
      const entry = verification.manifest.packages[index];
      const planned = plan.packages[index];
      if (planned.action === 'already-published') {
        results.push(Object.freeze({ name: entry.name, version: entry.version, action: 'already-published', integrity: entry.integrity }));
        continue;
      }
      if (planned.action !== 'publish') fail(`unexpected publication action ${planned.action} for ${entry.name}`);
      const tarball = path.join(verification.bundleDir, entry.tarball);
      run('npm', [
        'publish', tarball,
        '--access', config.access,
        '--tag', config.distTag,
        '--registry', config.registry,
        '--provenance',
        '--ignore-scripts'
      ], {
        cwd: verification.bundleDir,
        inherit: options.inherit !== false,
        timeout: 300000,
        env: securePublishEnvironment(userConfig)
      });
      const published = waitForRegistry(adapter, entry, config.distTag, { attempts: options.verifyAttempts });
      results.push(Object.freeze({
        name: entry.name,
        version: entry.version,
        action: 'published',
        integrity: entry.integrity,
        registryIntegrity: published.published.integrity,
        distTag: config.distTag
      }));
    }
  } finally {
    fs.rmSync(authRoot, { recursive: true, force: true });
  }
  const verificationReport = verifyRegistryRelease({ ...options, adapter, writeResult: false });
  const report = Object.freeze({
    schemaVersion: REPORT_SCHEMA,
    status: 'ok',
    releaseVersion: RELEASE_VERSION,
    releaseTag: `v${RELEASE_VERSION}`,
    channel: RELEASE_MANIFEST.channel,
    distTag: config.distTag,
    registry: config.registry,
    source: verification.manifest.source,
    packageCount: results.length,
    publication: Object.freeze(results),
    verification: verificationReport
  });
  if (options.jsonFile) { ensureDirectory(path.dirname(path.resolve(options.jsonFile))); fs.writeFileSync(path.resolve(options.jsonFile), stableJson(report)); }
  return report;
}

function verifyRegistryRelease(options = {}) {
  const verification = verifyPublicationBundle(options);
  const config = loadPublicationConfig();
  const adapter = options.adapter || npmRegistryAdapter(options);
  const packages = [];
  for (const entry of verification.manifest.packages) {
    const published = adapter.version(entry.name, entry.version);
    if (!published) fail(`${entry.name}@${entry.version} is not published`);
    if (published.integrity !== entry.integrity) fail(`${entry.name}@${entry.version} registry integrity differs from the sealed tarball`);
    if (published.shasum !== entry.shasum) fail(`${entry.name}@${entry.version} registry shasum differs from the sealed tarball`);
    const pulseDependencies = verifyPulseDependencies(entry.pulseDependencies, published, `${entry.name}@${entry.version}`);
    const tags = adapter.tags(entry.name);
    if (tags[config.distTag] !== entry.version) fail(`${entry.name} dist-tag ${config.distTag} points to ${tags[config.distTag] || '(missing)'}, expected ${entry.version}`);
    packages.push(Object.freeze({
      name: entry.name,
      version: entry.version,
      integrity: entry.integrity,
      shasum: published.shasum,
      distTag: config.distTag,
      tarball: published.tarball || null,
      pulseDependencies
    }));
  }
  const result = Object.freeze({
    schemaVersion: VERIFICATION_SCHEMA,
    status: 'ok',
    releaseVersion: RELEASE_VERSION,
    releaseTag: `v${RELEASE_VERSION}`,
    channel: RELEASE_MANIFEST.channel,
    distTag: config.distTag,
    registry: config.registry,
    source: verification.manifest.source,
    packageCount: packages.length,
    packages: Object.freeze(packages),
    failures: 0,
    verificationMode: 'sealed-bundle'
  });
  if (options.jsonFile || options.writeResult) {
    const file = path.resolve(options.jsonFile || path.join(verification.bundleDir, 'npm-verification.json'));
    ensureDirectory(path.dirname(file));
    fs.writeFileSync(file, stableJson(result));
  }
  return result;
}

function verifyCatalogRelease(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const config = loadPublicationConfig();
  const adapter = options.adapter || npmRegistryAdapter(options);
  const packages = [];
  for (const entry of PACKAGE_SET) {
    const published = adapter.version(entry.name, RELEASE_VERSION);
    if (!published) fail(`${entry.name}@${RELEASE_VERSION} is not published`, 'PULSE_NPM_RELEASE_INCOMPLETE');
    const pulseDependencies = verifyPulseDependencies(catalogPulseDependencies(repoRoot, entry), published, `${entry.name}@${RELEASE_VERSION}`);
    const tags = adapter.tags(entry.name);
    if (tags[config.distTag] !== RELEASE_VERSION) {
      fail(`${entry.name} dist-tag ${config.distTag} points to ${tags[config.distTag] || '(missing)'}, expected ${RELEASE_VERSION}`, 'PULSE_NPM_DIST_TAG_MISMATCH');
    }
    packages.push(Object.freeze({
      name: entry.name,
      version: RELEASE_VERSION,
      integrity: published.integrity || null,
      shasum: published.shasum || null,
      distTag: config.distTag,
      tarball: published.tarball || null,
      pulseDependencies
    }));
  }
  const result = Object.freeze({
    schemaVersion: VERIFICATION_SCHEMA,
    status: 'ok',
    releaseVersion: RELEASE_VERSION,
    releaseTag: `v${RELEASE_VERSION}`,
    channel: RELEASE_MANIFEST.channel,
    distTag: config.distTag,
    registry: config.registry,
    source: Object.freeze({ mode: 'release-catalog', file: 'release/pulse-release-manifest.json' }),
    packageCount: packages.length,
    packages: Object.freeze(packages),
    failures: 0,
    verificationMode: 'registry-catalog'
  });
  if (options.jsonFile) {
    ensureDirectory(path.dirname(path.resolve(options.jsonFile)));
    fs.writeFileSync(path.resolve(options.jsonFile), stableJson(result));
  }
  return result;
}

function smokePublishedCli(options = {}) {
  const config = loadPublicationConfig();
  const temp = path.resolve(options.tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-npm-smoke-')));
  const remove = !options.tempDir;
  ensureDirectory(temp);
  const toolRoot = path.join(temp, 'tool');
  const appRoot = path.join(temp, 'smoke');
  try {
    run('npm', [
      'install', '--prefix', toolRoot,
      '--ignore-scripts', '--no-audit', '--no-fund',
      '--registry', config.registry,
      `${config.canonicalSmokePackage}@${config.distTag}`
    ], { timeout: 300000, inherit: options.inherit === true });
    const binary = path.join(toolRoot, 'node_modules', '.bin', process.platform === 'win32' ? `${config.canonicalSmokeBinary}.cmd` : config.canonicalSmokeBinary);
    if (!fs.existsSync(binary)) fail(`published CLI did not install ${binary}`);
    const calls = [];
    const invoke = (args, cwd = temp, timeout = 300000) => {
      const result = run(binary, args, { cwd, timeout, inherit: options.inherit === true });
      calls.push(Object.freeze({
        command: `${config.canonicalSmokeBinary} ${args.join(' ')}`,
        cwd: slash(path.relative(temp, cwd) || '.'),
        status: result.status,
        stdout: options.inherit === true ? null : String(result.stdout || '').trim()
      }));
      return result;
    };
    const versionResult = invoke(['--version']);
    if (options.inherit !== true && String(versionResult.stdout || '').trim() !== RELEASE_VERSION) {
      fail(`published CLI reported ${String(versionResult.stdout || '').trim() || '(empty)'}, expected ${RELEASE_VERSION}`, 'PULSE_NPM_SMOKE_VERSION_MISMATCH');
    }
    invoke(['init', appRoot, '--json']);
    run('npm', ['install', '--prefix', appRoot, '--ignore-scripts', '--no-audit', '--no-fund', '--registry', config.registry], { timeout: 300000, inherit: options.inherit === true });
    invoke(['doctor', appRoot]);
    invoke(['test', appRoot]);
    invoke(['build', appRoot]);
    const result = Object.freeze({
      schemaVersion: 'pulse.npm-publication-smoke.v1',
      status: 'ok',
      releaseVersion: RELEASE_VERSION,
      package: config.canonicalSmokePackage,
      installedFrom: config.distTag,
      binary: config.canonicalSmokeBinary,
      commands: Object.freeze(calls)
    });
    if (options.jsonFile) { ensureDirectory(path.dirname(path.resolve(options.jsonFile))); fs.writeFileSync(path.resolve(options.jsonFile), stableJson(result)); }
    return result;
  } finally {
    if (remove) fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = Object.freeze({
  PACK_SCHEMA,
  BUNDLE_SCHEMA,
  AUDIT_SCHEMA,
  PLAN_SCHEMA,
  REPORT_SCHEMA,
  VERIFICATION_SCHEMA,
  TOKEN_ENVIRONMENT_VARIABLES,
  loadPublicationConfig,
  validatePackManifest,
  publishOrder,
  normalizePulseDependencies,
  verifyPulseDependencies,
  preparePublicationBundle,
  verifyPublicationBundle,
  auditPackageNames,
  publicationPlan,
  publishBundle,
  verifyRegistryRelease,
  verifyCatalogRelease,
  smokePublishedCli,
  validateSourceIdentity,
  validateReleaseIdentity,
  compareVersions,
  waitForRegistry,
  npmRegistryAdapter,
  sha256,
  sha512,
  shasum,
  integrity
});
