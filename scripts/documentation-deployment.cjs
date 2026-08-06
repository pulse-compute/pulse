#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { RELEASE_MANIFEST, RELEASE_VERSION, DOCUMENTATION, PUBLICATION, PACKAGE_SET } = require('./package-support.cjs');

const CONFIG_SCHEMA = 'pulse.documentation-deployment.v1';
const CANDIDATE_SCHEMA = 'pulse.documentation-deployment-candidate.v1';
const REPORT_SCHEMA = 'pulse.documentation-deployment-report.v1';
const RECEIPT_SCHEMA = 'pulse.documentation-deployment-receipt.v1';
const NPM_VERIFICATION_SCHEMA = 'pulse.npm-publication-verification.v1';
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

function fail(message, code = 'PULSE_DOCUMENTATION_DEPLOYMENT_INVALID', details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function slash(value) { return String(value).replace(/\\/g, '/'); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function ensureDirectory(directory) { fs.mkdirSync(directory, { recursive: true }); }
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`Unable to read JSON ${file}: ${error.message}`); }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 300000
  });
  if (result.error || result.status !== 0) {
    if (options.allowFailure) return result;
    const detail = [result.stdout, result.stderr, result.error && result.error.message].filter(Boolean).join('\n').trim();
    fail(`Command failed: ${command} ${args.join(' ')}${detail ? `\n${detail}` : ''}`, 'PULSE_DOCUMENTATION_DEPLOYMENT_COMMAND_FAILED');
  }
  return result;
}

function resolveInside(root, relativeFile, context) {
  const normalized = slash(relativeFile || '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.split('/').includes('..')) fail(`${context} must be a safe relative path, found ${relativeFile}`);
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
  const context = options.context || 'documentation deployment output directory';
  const resolved = path.resolve(directory);
  const repository = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const canonicalRepository = canonicalPath(repository);
  const canonicalTarget = canonicalPath(resolved);
  if (canonicalTarget === path.parse(canonicalTarget).root) {
    fail(`${context} must not be a filesystem root`, 'PULSE_DOCUMENTATION_UNSAFE_OUTPUT');
  }
  if (pathContains(canonicalTarget, canonicalRepository)) {
    fail(`${context} must not be the repository root or one of its ancestors`, 'PULSE_DOCUMENTATION_UNSAFE_OUTPUT');
  }
  const lexicalInsideRepository = pathContains(repository, resolved);
  const canonicalInsideRepository = pathContains(canonicalRepository, canonicalTarget);
  if (lexicalInsideRepository !== canonicalInsideRepository) {
    fail(`${context} must not traverse a symlink across the repository boundary`, 'PULSE_DOCUMENTATION_UNSAFE_OUTPUT');
  }
  if (lexicalInsideRepository) {
    const namespace = path.relative(repository, resolved).split(path.sep)[0];
    if (!namespace.startsWith('.pulse-')) {
      fail(`${context} inside the repository must use a .pulse-* generated-output namespace`, 'PULSE_DOCUMENTATION_UNSAFE_OUTPUT');
    }
  }
  for (const sourceDirectory of options.sourceDirectories || []) {
    const canonicalSource = canonicalPath(sourceDirectory);
    if (pathContains(canonicalTarget, canonicalSource) || pathContains(canonicalSource, canonicalTarget)) {
      fail(`${context} must not overlap source directory ${path.resolve(sourceDirectory)}`, 'PULSE_DOCUMENTATION_UNSAFE_OUTPUT');
    }
  }
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory()) fail(`${context} must be a directory`, 'PULSE_DOCUMENTATION_UNSAFE_OUTPUT');
    const allowedEntries = new Set(options.allowedEntries || []);
    const unexpected = fs.readdirSync(resolved).filter((entry) => !allowedEntries.has(entry));
    if (unexpected.length) {
      fail(`${context} contains unrelated entries and will not be replaced: ${unexpected.join(', ')}`, 'PULSE_DOCUMENTATION_UNSAFE_OUTPUT');
    }
  }
  return resolved;
}

function filesUnder(root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(file, out);
    else if (entry.isFile()) out.push(file);
    else fail(`documentation deployment input contains an unsupported filesystem entry: ${file}`);
  }
  return out;
}

function copyDirectory(source, destination) {
  for (const file of filesUnder(source)) {
    const relative = path.relative(source, file);
    const target = path.join(destination, relative);
    ensureDirectory(path.dirname(target));
    fs.copyFileSync(file, target);
  }
}

function contentType(relativeFile) {
  const extension = path.extname(relativeFile).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
  };
  return types[extension] || 'application/octet-stream';
}

function gitValue(repoRoot, args, fallback = '') {
  const result = run('git', args, { cwd: repoRoot, allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : fallback;
}


function normalizeOrigin(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); }
  catch (error) { fail(`documentation public origin is invalid: ${error.message}`); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    fail('documentation public origin must be an HTTP(S) origin without path, credentials, query, or fragment');
  }
  return parsed.origin;
}

function normalizeBasePath(value) {
  const raw = String(value || '/').trim();
  if (!raw.startsWith('/') || raw.includes('\\') || raw.includes('?') || raw.includes('#') || raw.split('/').includes('..')) {
    fail(`documentation base path is invalid: ${value}`);
  }
  if (raw === '/') return '/';
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}

function publicUrl(origin, basePath, routePath) {
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedBase = normalizeBasePath(basePath);
  const rawRoute = String(routePath || '/');
  if (!rawRoute.startsWith('/') || rawRoute.includes('\\') || rawRoute.split('/').includes('..')) fail(`documentation public check path is invalid: ${routePath}`);
  const route = rawRoute === '/' ? '' : rawRoute.replace(/^\/+/, '');
  const prefix = normalizedBase === '/' ? '/' : `${normalizedBase}/`;
  return new URL(route, `${normalizedOrigin}${prefix}`).toString();
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

function loadDeploymentConfig(repoRoot = DEFAULT_REPO_ROOT) {
  const file = path.join(repoRoot, 'release', 'documentation-deployment.json');
  if (!fs.existsSync(file)) fail('release/documentation-deployment.json is missing');
  const config = readJson(file);
  if (config.schemaVersion !== CONFIG_SCHEMA) fail(`unsupported documentation deployment schema ${config.schemaVersion}`);
  if (config.releaseVersion !== RELEASE_VERSION) fail(`documentation deployment release ${config.releaseVersion} does not match ${RELEASE_VERSION}`);
  if (config.provider !== 'fastly-object-storage') fail('documentation deployment provider must be fastly-object-storage');
  if (config.workflowFile !== 'documentation-deploy.yml') fail('documentation deployment workflow must remain documentation-deploy.yml');
  if (!/^[A-Za-z0-9_.-]+$/.test(config.environment || '')) fail('documentation deployment environment is invalid');
  if (!config.sourceDirectory || !config.candidateArtifact) fail('documentation deployment source and artifact names are required');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(config.objectPrefix || '') || config.objectPrefix.startsWith('/') || config.objectPrefix.endsWith('/')) fail('documentation objectPrefix must be a safe prefix without leading or trailing slash');
  if (config.publicRoute.originSource !== 'release/pulse-release-manifest.json#documentation.origin') fail('documentation public origin must remain release-owned');
  if (config.publicRoute.basePathSource !== 'release/pulse-release-manifest.json#documentation.basePath') fail('documentation base path must remain release-owned');
  if (config.publicRoute.requireExactManifestMatch !== true || config.publicRoute.requireFastlyVerification !== true) fail('documentation public route must require exact release matching and Fastly verification');
  if (config.publicRoute.disallowGithubPagesOrigin !== true) fail('production documentation deployment must reject a GitHub Pages origin');
  if (config.deployment.currentVersionDirectory !== DOCUMENTATION.version) fail('documentation deployment currentVersionDirectory must match the release documentation version');
  const immutablePattern = new RegExp(config.deployment.immutableVersionPattern);
  if (!immutablePattern.test(`${DOCUMENTATION.version}/index.html`)) fail('documentation immutableVersionPattern does not match the current exact version');
  if (!Array.isArray(config.deployment.immutableRoots) || config.deployment.immutableRoots.length === 0) fail('documentation deployment immutableRoots must be non-empty');
  for (const root of config.deployment.immutableRoots) {
    if (!root || root.startsWith('/') || root.includes('..') || root.includes('\\')) fail(`invalid immutable documentation root ${root}`);
  }
  if (config.deployment.requiresNpmVerificationBeforePromotion !== true) fail('documentation promotion must require matching npm verification');
  if (config.deployment.neverDelete !== true) fail('documentation deployments must never delete bucket history');
  const expectedReceipt = `deployments/${DOCUMENTATION.version}.json`;
  if (config.deployment.receiptPath !== expectedReceipt) fail(`documentation deployment receiptPath must be ${expectedReceipt}`);
  if (!config.deployment.immutableRoots.includes(expectedReceipt)) fail('documentation deployment receipt must be an immutable object');
  if (!/^[a-z0-9-]+$/.test(config.deployment.metadataHashKey || '')) fail('documentation metadata hash key is invalid');
  const storage = config.storage;
  for (const field of ['bucketVariable', 'regionVariable', 'endpointVariable', 'accessKeySecret', 'secretKeySecret']) {
    if (!/^[A-Z][A-Z0-9_]+$/.test(storage[field] || '')) fail(`documentation deployment storage.${field} must be an uppercase environment variable name`);
  }
  if (!Number.isInteger(storage.awsCliMajor) || storage.awsCliMajor !== 2) fail('documentation deployment storage.awsCliMajor must be 2');
  if (storage.requestChecksumCalculation !== 'when_required') {
    fail('Fastly Object Storage requires documentation deployment storage.requestChecksumCalculation=when_required');
  }
  if (storage.responseChecksumValidation !== 'when_required') {
    fail('Fastly Object Storage requires documentation deployment storage.responseChecksumValidation=when_required');
  }
  for (const field of ['originVariable', 'basePathVariable']) {
    if (!/^[A-Z][A-Z0-9_]+$/.test(config.publicRoute[field] || '')) fail(`documentation deployment publicRoute.${field} must be an uppercase environment variable name`);
  }
  if (!Array.isArray(config.deployment.mutableRoots) || config.deployment.mutableRoots.length === 0) fail('documentation deployment mutableRoots must be non-empty');
  if (!Array.isArray(config.deployment.promotionCommitObjects) || config.deployment.promotionCommitObjects.length === 0) fail('documentation deployment promotionCommitObjects must be non-empty');
  const promotionCommitObjects = new Set();
  for (const relative of config.deployment.promotionCommitObjects) {
    if (!relative || relative.startsWith('/') || relative.includes('..') || relative.includes('\\')) fail(`invalid documentation promotion commit object ${relative}`);
    if (promotionCommitObjects.has(relative)) fail(`duplicate documentation promotion commit object ${relative}`);
    if (immutablePattern.test(relative) || config.deployment.immutableRoots.some((root) => matchesRoot(relative, root))) fail(`documentation promotion commit object ${relative} must be mutable`);
    if (!config.deployment.mutableRoots.some((root) => relative === root || relative.startsWith(`${root}/`))) fail(`documentation promotion commit object ${relative} is not mutable`);
    promotionCommitObjects.add(relative);
  }
  const publicVerification = config.publicVerification || {};
  if (!Number.isInteger(publicVerification.attempts) || publicVerification.attempts < 1 || publicVerification.attempts > 20) fail('documentation publicVerification.attempts must be between 1 and 20');
  if (!Number.isInteger(publicVerification.delayMs) || publicVerification.delayMs < 0 || publicVerification.delayMs > 60000) fail('documentation publicVerification.delayMs must be between 0 and 60000');
  if (!Number.isInteger(publicVerification.requestTimeoutMs) || publicVerification.requestTimeoutMs < 1000 || publicVerification.requestTimeoutMs > 120000) fail('documentation publicVerification.requestTimeoutMs must be between 1000 and 120000');
  if (!Array.isArray(config.publicChecks) || config.publicChecks.length === 0) fail('documentation deployment publicChecks must be non-empty');
  return Object.freeze({ config, immutablePattern });
}

function matchesRoot(relative, root) {
  return relative === root || (root.endsWith('/') && relative.startsWith(root));
}

function classifyRelative(relativeFile, loaded = loadDeploymentConfig()) {
  const relative = slash(relativeFile);
  if (relative === loaded.config.deployment.receiptPath) return 'immutable';
  if (loaded.immutablePattern.test(relative)) return 'immutable';
  for (const root of loaded.config.deployment.immutableRoots) if (matchesRoot(relative, root)) return 'immutable';
  for (const root of loaded.config.deployment.mutableRoots) {
    if (relative === root || relative.startsWith(`${root}/`)) return 'mutable';
  }
  fail(`generated documentation object ${relative} is neither an exact-version object nor an approved mutable root`);
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
    fail(`documentation deployment source commit must be a full lowercase SHA, found ${identity && identity.commit}`);
  }
  if (!identity.ref || typeof identity.ref !== 'string' || /[\r\n\0]/.test(identity.ref)) {
    fail(`documentation deployment source ref is invalid: ${identity && identity.ref}`);
  }
}

function validateReleaseIdentity(identity) {
  validateSourceIdentity(identity);
  const expectedRef = `refs/tags/v${RELEASE_VERSION}`;
  const normalized = identity.ref === `v${RELEASE_VERSION}` ? expectedRef : identity.ref;
  if (normalized !== expectedRef) fail(`documentation deployment must be sealed from ${expectedRef}; found ${identity.ref || '(no ref)'}`, 'PULSE_DOCUMENTATION_DEPLOYMENT_WRONG_REF');
}


function exactVersionInventory(siteDir, loaded) {
  const currentRoot = loaded.config.deployment.currentVersionDirectory;
  return filesUnder(siteDir).map((file) => {
    const relativePath = slash(path.relative(siteDir, file));
    if (relativePath !== currentRoot && !relativePath.startsWith(`${currentRoot}/`)) return undefined;
    const bytes = fs.readFileSync(file);
    return Object.freeze({ relativePath, bytes: bytes.length, sha256: sha256(bytes) });
  }).filter(Boolean).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function siteInventory(siteDir, loaded) {
  const receiptPath = loaded.config.deployment.receiptPath;
  return filesUnder(siteDir).map((file) => {
    const relativePath = slash(path.relative(siteDir, file));
    if (relativePath === receiptPath) return undefined;
    const bytes = fs.readFileSync(file);
    return Object.freeze({ relativePath, bytes: bytes.length, sha256: sha256(bytes) });
  }).filter(Boolean).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function inventoryDigest(entries) {
  const lines = entries.map((entry) => `${entry.sha256}  ${entry.relativePath}`);
  return sha256(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
}

function writeDeploymentReceipt(siteDir, loaded, identity) {
  const receiptRelative = loaded.config.deployment.receiptPath;
  const exactEntries = exactVersionInventory(siteDir, loaded);
  const siteEntries = siteInventory(siteDir, loaded);
  if (!exactEntries.length) fail('documentation site has no exact-version objects from which to build a receipt');
  if (!siteEntries.length) fail('documentation site has no objects from which to build a receipt');
  const receipt = Object.freeze({
    schemaVersion: RECEIPT_SCHEMA,
    releaseVersion: RELEASE_VERSION,
    releaseTag: `v${RELEASE_VERSION}`,
    source: identity,
    documentation: Object.freeze({
      origin: DOCUMENTATION.origin,
      basePath: DOCUMENTATION.basePath,
      version: DOCUMENTATION.version,
      latestAlias: DOCUMENTATION.latestAlias
    }),
    objectPrefix: loaded.config.objectPrefix,
    exactVersionRoot: DOCUMENTATION.version,
    siteObjectCount: siteEntries.length,
    siteContentSha256: inventoryDigest(siteEntries),
    exactVersionObjectCount: exactEntries.length,
    exactVersionTreeSha256: inventoryDigest(exactEntries),
    objects: Object.freeze(exactEntries)
  });
  const target = resolveInside(siteDir, receiptRelative, 'documentation deployment receipt');
  ensureDirectory(path.dirname(target));
  fs.writeFileSync(target, stableJson(receipt));
  return Object.freeze({ relativePath: receiptRelative, receipt });
}

function verifyDeploymentReceipt(candidateSite, loaded, manifest) {
  const receiptRelative = loaded.config.deployment.receiptPath;
  const receiptFile = resolveInside(candidateSite, receiptRelative, 'documentation deployment receipt');
  if (!fs.existsSync(receiptFile)) fail(`documentation candidate is missing ${receiptRelative}`);
  const receipt = readJson(receiptFile);
  if (receipt.schemaVersion !== RECEIPT_SCHEMA || receipt.releaseVersion !== RELEASE_VERSION || receipt.releaseTag !== `v${RELEASE_VERSION}`) fail('documentation deployment receipt release identity is invalid');
  if (receipt.objectPrefix !== loaded.config.objectPrefix || receipt.exactVersionRoot !== DOCUMENTATION.version) fail('documentation deployment receipt route is invalid');
  if (JSON.stringify(receipt.source) !== JSON.stringify(manifest.source)) fail('documentation deployment receipt source differs from the candidate source');
  const siteEntries = siteInventory(candidateSite, loaded);
  const exactEntries = exactVersionInventory(candidateSite, loaded);
  if (receipt.siteObjectCount !== siteEntries.length || receipt.siteContentSha256 !== inventoryDigest(siteEntries)) fail('documentation deployment receipt site inventory is invalid');
  if (receipt.exactVersionObjectCount !== exactEntries.length || receipt.exactVersionTreeSha256 !== inventoryDigest(exactEntries)) fail('documentation deployment receipt exact-version inventory is invalid');
  if (JSON.stringify(receipt.objects) !== JSON.stringify(exactEntries)) fail('documentation deployment receipt object list is invalid');
  if (manifest.siteContentSha256 !== receipt.siteContentSha256) fail('documentation deployment candidate and receipt site digests differ');
  return Object.freeze({
    relativePath: receiptRelative,
    siteObjectCount: siteEntries.length,
    siteContentSha256: receipt.siteContentSha256,
    exactVersionObjectCount: exactEntries.length,
    exactVersionTreeSha256: receipt.exactVersionTreeSha256
  });
}

function sealDocumentationCandidate(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const loaded = loadDeploymentConfig(repoRoot);
  const config = loaded.config;
  const siteDir = path.resolve(options.siteDir || path.join(repoRoot, config.sourceDirectory));
  const outDir = assertSafeRecreatedDirectory(
    options.outDir || path.join(repoRoot, '.pulse-documentation-deployment'),
    {
      repoRoot,
      sourceDirectories: [siteDir],
      allowedEntries: ['site', 'documentation-deployment-manifest.json', 'sha256sums.txt']
    }
  );
  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) fail(`documentation site directory is missing: ${siteDir}`);
  const identity = sourceIdentity(repoRoot, options);
  validateSourceIdentity(identity);
  if (options.requireReleaseRef) validateReleaseIdentity(identity);

  fs.rmSync(outDir, { recursive: true, force: true });
  const candidateSite = path.join(outDir, 'site');
  ensureDirectory(candidateSite);
  copyDirectory(siteDir, candidateSite);
  const receipt = writeDeploymentReceipt(candidateSite, loaded, identity);
  const objects = filesUnder(candidateSite).map((file) => {
    const relative = slash(path.relative(candidateSite, file));
    const bytes = fs.readFileSync(file);
    const phase = classifyRelative(relative, loaded);
    const cacheClass = relative === '404.html' ? 'notFound' : phase;
    return Object.freeze({
      relativePath: relative,
      objectKey: `${config.objectPrefix}/${relative}`,
      phase,
      cacheClass,
      contentType: contentType(relative),
      cacheControl: config.cacheClasses[cacheClass],
      bytes: bytes.length,
      sha256: sha256(bytes)
    });
  }).sort((left, right) => left.objectKey.localeCompare(right.objectKey));
  if (!objects.length) fail('documentation candidate contains no objects');
  if (!objects.some((entry) => entry.phase === 'immutable')) fail('documentation candidate contains no exact-version objects');
  if (!objects.some((entry) => entry.phase === 'mutable')) fail('documentation candidate contains no mutable routing objects');

  const manifest = Object.freeze({
    schemaVersion: CANDIDATE_SCHEMA,
    releaseVersion: RELEASE_VERSION,
    releaseTag: `v${RELEASE_VERSION}`,
    documentation: Object.freeze({
      origin: DOCUMENTATION.origin,
      basePath: DOCUMENTATION.basePath,
      version: DOCUMENTATION.version,
      latestAlias: DOCUMENTATION.latestAlias
    }),
    provider: config.provider,
    objectPrefix: config.objectPrefix,
    workflowFile: config.workflowFile,
    environment: config.environment,
    source: identity,
    siteContentSha256: receipt.receipt.siteContentSha256,
    receipt: Object.freeze({
      relativePath: receipt.relativePath,
      sha256: sha256(fs.readFileSync(path.join(candidateSite, receipt.relativePath)))
    }),
    objectCount: objects.length,
    immutableCount: objects.filter((entry) => entry.phase === 'immutable').length,
    mutableCount: objects.filter((entry) => entry.phase === 'mutable').length,
    objects: Object.freeze(objects)
  });
  fs.writeFileSync(path.join(outDir, 'documentation-deployment-manifest.json'), stableJson(manifest));
  const checksumFiles = ['documentation-deployment-manifest.json', ...objects.map((entry) => `site/${entry.relativePath}`)].sort();
  fs.writeFileSync(path.join(outDir, 'sha256sums.txt'), `${checksumFiles.map((relative) => `${sha256(fs.readFileSync(path.join(outDir, relative)))}  ${relative}`).join('\n')}\n`);
  return verifyDocumentationCandidate({ repoRoot, candidateDir: outDir });
}

function verifyDocumentationCandidate(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const loaded = loadDeploymentConfig(repoRoot);
  const config = loaded.config;
  const candidateDir = path.resolve(options.candidateDir || path.join(repoRoot, '.pulse-documentation-deployment'));
  const manifestFile = path.join(candidateDir, 'documentation-deployment-manifest.json');
  if (!fs.existsSync(manifestFile)) fail(`${candidateDir} is missing documentation-deployment-manifest.json`);
  const manifest = readJson(manifestFile);
  if (manifest.schemaVersion !== CANDIDATE_SCHEMA || manifest.releaseVersion !== RELEASE_VERSION || manifest.releaseTag !== `v${RELEASE_VERSION}`) fail('documentation candidate schema or release identity is invalid');
  validateSourceIdentity(manifest.source || {});
  if (options.requireReleaseRef) validateReleaseIdentity(manifest.source || {});
  if (manifest.provider !== config.provider || manifest.objectPrefix !== config.objectPrefix || manifest.workflowFile !== config.workflowFile || manifest.environment !== config.environment) fail('documentation candidate authority differs from release/documentation-deployment.json');
  if (manifest.documentation.origin !== DOCUMENTATION.origin || manifest.documentation.basePath !== DOCUMENTATION.basePath || manifest.documentation.version !== DOCUMENTATION.version) fail('documentation candidate route differs from the release manifest');
  if (!Array.isArray(manifest.objects) || manifest.objectCount !== manifest.objects.length) fail('documentation candidate object count is invalid');
  const keys = new Set();
  let immutable = 0;
  let mutable = 0;
  for (const entry of manifest.objects) {
    if (keys.has(entry.objectKey)) fail(`documentation candidate contains duplicate object key ${entry.objectKey}`);
    keys.add(entry.objectKey);
    if (entry.objectKey !== `${config.objectPrefix}/${entry.relativePath}`) fail(`${entry.relativePath} object key is invalid`);
    const expectedPhase = classifyRelative(entry.relativePath, loaded);
    if (entry.phase !== expectedPhase) fail(`${entry.relativePath} deployment phase is invalid`);
    if (entry.phase === 'immutable') immutable += 1; else mutable += 1;
    const expectedCacheClass = entry.relativePath === '404.html' ? 'notFound' : entry.phase;
    if (entry.cacheClass !== expectedCacheClass || entry.cacheControl !== config.cacheClasses[expectedCacheClass]) fail(`${entry.relativePath} cache policy is invalid`);
    if (entry.contentType !== contentType(entry.relativePath)) fail(`${entry.relativePath} content type is invalid`);
    const file = resolveInside(path.join(candidateDir, 'site'), entry.relativePath, 'candidate site object');
    if (!fs.existsSync(file)) fail(`${entry.relativePath} candidate file is missing`);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) fail(`${entry.relativePath} candidate bytes differ from the manifest`);
  }
  if (manifest.immutableCount !== immutable || manifest.mutableCount !== mutable || immutable + mutable !== manifest.objectCount) fail('documentation candidate phase counts are invalid');
  const relativePaths = new Set(manifest.objects.map((entry) => entry.relativePath));
  for (const relative of config.deployment.promotionCommitObjects) {
    if (!relativePaths.has(relative)) fail(`documentation candidate is missing promotion commit object ${relative}`);
  }
  const receipt = verifyDeploymentReceipt(path.join(candidateDir, 'site'), loaded, manifest);
  if (!manifest.receipt || manifest.receipt.relativePath !== receipt.relativePath) fail('documentation candidate receipt metadata is invalid');
  const receiptBytes = fs.readFileSync(resolveInside(path.join(candidateDir, 'site'), receipt.relativePath, 'candidate receipt'));
  if (manifest.receipt.sha256 !== sha256(receiptBytes)) fail('documentation candidate receipt checksum is invalid');
  const candidateFiles = filesUnder(path.join(candidateDir, 'site')).map((file) => slash(path.relative(path.join(candidateDir, 'site'), file))).sort();
  const manifestFiles = manifest.objects.map((entry) => entry.relativePath).sort();
  if (JSON.stringify(candidateFiles) !== JSON.stringify(manifestFiles)) fail('documentation candidate contains files not represented by its manifest');
  const checksums = path.join(candidateDir, 'sha256sums.txt');
  if (!fs.existsSync(checksums)) fail('documentation candidate is missing sha256sums.txt');
  const checksumLines = fs.readFileSync(checksums, 'utf8').trim().split(/\r?\n/);
  const checksumPaths = new Set();
  for (const line of checksumLines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) fail(`invalid documentation checksum line: ${line}`);
    if (checksumPaths.has(match[2])) fail(`duplicate documentation checksum path: ${match[2]}`);
    checksumPaths.add(match[2]);
    const file = resolveInside(candidateDir, match[2], 'documentation checksum path');
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== match[1]) fail(`documentation checksum failed for ${match[2]}`);
  }
  const expectedChecksumPaths = ['documentation-deployment-manifest.json', ...manifest.objects.map((entry) => `site/${entry.relativePath}`)].sort();
  if (JSON.stringify([...checksumPaths].sort()) !== JSON.stringify(expectedChecksumPaths)) fail('documentation checksum inventory is incomplete');
  const sealedCandidateFiles = filesUnder(candidateDir).map((file) => slash(path.relative(candidateDir, file))).sort();
  const expectedCandidateFiles = ['documentation-deployment-manifest.json', 'sha256sums.txt', ...manifest.objects.map((entry) => `site/${entry.relativePath}`)].sort();
  if (JSON.stringify(sealedCandidateFiles) !== JSON.stringify(expectedCandidateFiles)) fail('documentation candidate contains unsealed files outside the exact candidate inventory');
  return Object.freeze({
    schemaVersion: CANDIDATE_SCHEMA,
    status: 'ok',
    releaseVersion: RELEASE_VERSION,
    source: manifest.source,
    objectCount: manifest.objectCount,
    immutableCount: immutable,
    mutableCount: mutable,
    receipt,
    candidateDir,
    manifest
  });
}

function assertProductionDeploymentEnvironment(manifest, options = {}) {
  if (options.allowNonGithub) return;
  const config = loadDeploymentConfig(options.repoRoot || DEFAULT_REPO_ROOT).config;
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    fail('Fastly Object Storage deployment may run only on a GitHub-hosted runner through the protected documentation-deploy.yml workflow');
  }
  const expectedRepository = expectedGitHubRepository();
  if (process.env.GITHUB_REPOSITORY !== expectedRepository) fail(`documentation deployment must run in ${expectedRepository}`);
  const workflowRef = process.env.GITHUB_WORKFLOW_REF || '';
  const expectedWorkflowRef = `${expectedRepository}/.github/workflows/${config.workflowFile}@${process.env.GITHUB_REF || ''}`;
  if (workflowRef !== expectedWorkflowRef) fail(`documentation deployment must run from ${expectedWorkflowRef}`);
  const nativeIdentity = Object.freeze({ commit: process.env.GITHUB_SHA || '', ref: process.env.GITHUB_REF || '' });
  validateReleaseIdentity(nativeIdentity);
  if (process.env.GITHUB_REF_TYPE && process.env.GITHUB_REF_TYPE !== 'tag') fail('documentation deployment must be dispatched from the release tag');
  if (!manifest || manifest.source.commit !== nativeIdentity.commit || manifest.source.ref !== nativeIdentity.ref) fail('documentation candidate source does not match the GitHub release-tag run');

  const configuredOrigin = process.env[config.publicRoute.originVariable] || '';
  const configuredBasePath = process.env[config.publicRoute.basePathVariable] || '';
  if (configuredOrigin !== DOCUMENTATION.origin || configuredBasePath !== DOCUMENTATION.basePath) {
    fail('protected documentation route variables must exactly match release/pulse-release-manifest.json');
  }
  const publicHost = new URL(DOCUMENTATION.origin).hostname.toLowerCase();
  if (!options.allowPendingOrigin && config.publicRoute.disallowGithubPagesOrigin === true && publicHost.endsWith('.github.io')) {
    fail('the release documentation origin still names GitHub Pages; set the final Fastly-served origin before production deployment', 'PULSE_DOCUMENTATION_PRODUCTION_ORIGIN_PENDING');
  }
}

function filesystemAdapter(options = {}) {
  const bucketDir = path.resolve(options.bucketDir || '');
  if (!options.bucketDir) fail('filesystem deployment requires --bucket-dir');
  const metadataRoot = path.join(bucketDir, '.pulse-object-metadata');
  function objectFile(key) { return resolveInside(bucketDir, key, 'filesystem object key'); }
  function metadataFile(key) { return resolveInside(metadataRoot, `${key}.json`, 'filesystem metadata key'); }
  return Object.freeze({
    kind: 'filesystem',
    head(key) {
      const file = objectFile(key);
      if (!fs.existsSync(file)) return undefined;
      const bytes = fs.readFileSync(file);
      const metadataPath = metadataFile(key);
      const metadata = fs.existsSync(metadataPath) ? readJson(metadataPath) : {};
      return Object.freeze({ bytes: bytes.length, sha256: metadata.sha256 || sha256(bytes), contentType: metadata.contentType, cacheControl: metadata.cacheControl });
    },
    put(key, sourceFile, metadata) {
      const destination = objectFile(key);
      ensureDirectory(path.dirname(destination));
      fs.copyFileSync(sourceFile, destination);
      const metadataPath = metadataFile(key);
      ensureDirectory(path.dirname(metadataPath));
      fs.writeFileSync(metadataPath, stableJson({ ...metadata, sha256: sha256(fs.readFileSync(sourceFile)) }));
    },
    read(key) {
      const file = objectFile(key);
      return fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    }
  });
}

function awsAdapter(options = {}) {
  const config = loadDeploymentConfig(options.repoRoot || DEFAULT_REPO_ROOT).config;
  const env = options.env || process.env;
  const bucket = options.bucket || env[config.storage.bucketVariable];
  const region = options.region || env[config.storage.regionVariable];
  const endpoint = options.endpoint || env[config.storage.endpointVariable];
  if (!bucket || !region || !endpoint) fail(`AWS deployment requires ${config.storage.bucketVariable}, ${config.storage.regionVariable}, and ${config.storage.endpointVariable}`);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..') || bucket.startsWith('fst') || bucket.startsWith('fastly')) fail(`Fastly Object Storage bucket name is invalid: ${bucket}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(region)) fail(`Fastly Object Storage region is invalid: ${region}`);
  let parsedEndpoint;
  try { parsedEndpoint = new URL(endpoint); }
  catch (error) { fail(`Fastly Object Storage endpoint is invalid: ${error.message}`); }
  const expectedHost = `${region}.object.fastlystorage.app`;
  if (parsedEndpoint.protocol !== 'https:' || parsedEndpoint.hostname !== expectedHost || parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash || !['', '/'].includes(parsedEndpoint.pathname)) {
    fail(`Fastly Object Storage endpoint must be https://${expectedHost}`);
  }
  const endpointUrl = `https://${expectedHost}`;
  const awsEnv = { ...env };
  for (const name of [
    'AWS_SESSION_TOKEN',
    'AWS_SECURITY_TOKEN',
    'AWS_PROFILE',
    'AWS_DEFAULT_PROFILE',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_ROLE_ARN',
    'AWS_ROLE_SESSION_NAME',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
    'AWS_ENDPOINT_URL',
    'AWS_ENDPOINT_URL_S3',
    'AWS_SDK_LOAD_CONFIG'
  ]) delete awsEnv[name];
  Object.assign(awsEnv, {
    AWS_ACCESS_KEY_ID: env[config.storage.accessKeySecret],
    AWS_SECRET_ACCESS_KEY: env[config.storage.secretKeySecret],
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
    AWS_CONFIG_FILE: os.devNull,
    AWS_SHARED_CREDENTIALS_FILE: os.devNull,
    AWS_REQUEST_CHECKSUM_CALCULATION: config.storage.requestChecksumCalculation,
    AWS_RESPONSE_CHECKSUM_VALIDATION: config.storage.responseChecksumValidation,
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_PAGER: '',
    AWS_CLI_AUTO_PROMPT: 'off'
  });
  if (!awsEnv.AWS_ACCESS_KEY_ID || !awsEnv.AWS_SECRET_ACCESS_KEY) fail(`AWS deployment requires ${config.storage.accessKeySecret} and ${config.storage.secretKeySecret}`);
  const awsVersionResult = run('aws', ['--version'], { env: awsEnv, allowFailure: true, timeout: 30000 });
  const awsVersionText = `${awsVersionResult.stdout || ''} ${awsVersionResult.stderr || ''}`.trim();
  const awsVersionMatch = /aws-cli\/(\d+)\.([0-9.]+)/.exec(awsVersionText);
  if (awsVersionResult.status !== 0 || !awsVersionMatch || Number(awsVersionMatch[1]) !== config.storage.awsCliMajor) fail(`Fastly Object Storage deployment requires AWS CLI v${config.storage.awsCliMajor}; found ${awsVersionText || '(unavailable)'}`);
  const common = ['--bucket', bucket, '--endpoint-url', endpointUrl, '--region', region, '--no-cli-pager'];
  return Object.freeze({
    kind: 'aws',
    head(key) {
      const result = run('aws', ['s3api', 'head-object', ...common, '--key', key, '--output', 'json'], { env: awsEnv, allowFailure: true, timeout: 120000 });
      if (result.status !== 0) {
        const detail = `${result.stdout || ''}\n${result.stderr || ''}`;
        if (/Not Found|NoSuchKey|404/i.test(detail)) return undefined;
        fail(`Fastly Object Storage head-object failed for ${key}: ${detail.trim()}`);
      }
      const value = JSON.parse(result.stdout || '{}');
      const metadataKey = config.deployment.metadataHashKey.toLowerCase();
      return Object.freeze({
        bytes: Number(value.ContentLength),
        sha256: value.Metadata?.[metadataKey] || value.Metadata?.[config.deployment.metadataHashKey] || undefined,
        contentType: value.ContentType,
        cacheControl: value.CacheControl
      });
    },
    put(key, sourceFile, metadata) {
      run('aws', [
        's3api', 'put-object', ...common,
        '--key', key,
        '--body', sourceFile,
        '--content-type', metadata.contentType,
        '--cache-control', metadata.cacheControl,
        '--metadata', `${config.deployment.metadataHashKey}=${metadata.sha256}`
      ], { env: awsEnv, timeout: 300000 });
    },
    read(key) {
      const temp = path.join(os.tmpdir(), `pulse-object-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
      const result = run('aws', ['s3api', 'get-object', ...common, '--key', key, temp], { env: awsEnv, allowFailure: true, timeout: 300000 });
      if (result.status !== 0) {
        fs.rmSync(temp, { force: true });
        const detail = `${result.stdout || ''}\n${result.stderr || ''}`;
        if (/Not Found|NoSuchKey|404/i.test(detail)) return undefined;
        fail(`Fastly Object Storage get-object failed for ${key}: ${detail.trim()}`);
      }
      try { return fs.readFileSync(temp); }
      finally { fs.rmSync(temp, { force: true }); }
    }
  });
}

function normalizePhase(phase) {
  const value = phase || 'all';
  if (value === 'promote') return 'mutable';
  if (!['immutable', 'mutable', 'all'].includes(value)) fail(`deployment phase must be immutable, promote, mutable, or all; found ${value}`);
  return value;
}

function selectedObjects(manifest, phase, loaded = loadDeploymentConfig()) {
  const normalized = normalizePhase(phase);
  const commitOrder = new Map(loaded.config.deployment.promotionCommitObjects.map((relative, index) => [relative, index]));
  return manifest.objects
    .filter((entry) => normalized === 'all' || entry.phase === normalized)
    .sort((left, right) => {
      const leftPhase = left.phase === 'immutable' ? 0 : commitOrder.has(left.relativePath) ? 2 : 1;
      const rightPhase = right.phase === 'immutable' ? 0 : commitOrder.has(right.relativePath) ? 2 : 1;
      if (leftPhase !== rightPhase) return leftPhase - rightPhase;
      if (leftPhase === 2) return commitOrder.get(left.relativePath) - commitOrder.get(right.relativePath);
      return left.objectKey.localeCompare(right.objectKey);
    });
}

function adapterFor(options) {
  if (options.adapter) return options.adapter;
  if (options.driver === 'filesystem') return filesystemAdapter(options);
  if (options.driver === 'aws') return awsAdapter(options);
  fail(`deployment driver must be filesystem or aws; found ${options.driver || '(missing)'}`);
}


function validateNpmVerification(file) {
  if (!file) fail('mutable documentation promotion requires --npm-verification', 'PULSE_DOCUMENTATION_NPM_VERIFICATION_REQUIRED');
  const verificationFile = path.resolve(file);
  if (!fs.existsSync(verificationFile)) fail(`npm verification report is missing: ${verificationFile}`, 'PULSE_DOCUMENTATION_NPM_VERIFICATION_REQUIRED');
  const report = readJson(verificationFile);
  if (report.schemaVersion !== NPM_VERIFICATION_SCHEMA || report.status !== 'ok') fail('npm verification report schema or status is invalid', 'PULSE_DOCUMENTATION_NPM_VERIFICATION_INVALID');
  if (report.releaseVersion !== RELEASE_VERSION || report.releaseTag !== `v${RELEASE_VERSION}` || report.channel !== RELEASE_MANIFEST.channel || report.distTag !== PUBLICATION.distTag || report.registry !== PUBLICATION.registry) {
    fail('npm verification report does not match the documentation release', 'PULSE_DOCUMENTATION_NPM_VERIFICATION_INVALID');
  }
  if (report.failures !== 0 || report.packageCount !== PACKAGE_SET.length || !Array.isArray(report.packages) || report.packages.length !== PACKAGE_SET.length) {
    fail('npm verification report does not cover the complete package release', 'PULSE_DOCUMENTATION_NPM_VERIFICATION_INVALID');
  }
  if (!['sealed-bundle', 'registry-catalog'].includes(report.verificationMode)) {
    fail('npm verification report mode is invalid', 'PULSE_DOCUMENTATION_NPM_VERIFICATION_INVALID');
  }
  const expected = new Set(PACKAGE_SET.map((entry) => entry.name));
  for (const entry of report.packages) {
    if (!expected.delete(entry.name) || entry.version !== RELEASE_VERSION || entry.distTag !== PUBLICATION.distTag) {
      fail('npm verification report contains an invalid package record', 'PULSE_DOCUMENTATION_NPM_VERIFICATION_INVALID');
    }
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity || '') || !/^[0-9a-f]{40}$/.test(entry.shasum || '')) {
      fail(`npm verification report is missing immutable registry identity for ${entry.name}`, 'PULSE_DOCUMENTATION_NPM_VERIFICATION_INVALID');
    }
    if (!Array.isArray(entry.pulseDependencies)) {
      fail(`npm verification report is missing Pulse dependency evidence for ${entry.name}`, 'PULSE_DOCUMENTATION_NPM_VERIFICATION_INVALID');
    }
  }
  if (expected.size) fail(`npm verification report is missing ${[...expected].join(', ')}`, 'PULSE_DOCUMENTATION_NPM_VERIFICATION_INVALID');
  return Object.freeze({ file: verificationFile, schemaVersion: report.schemaVersion, packageCount: report.packageCount, verificationMode: report.verificationMode });
}

const verifyNpmPromotionEvidence = validateNpmVerification;

function deployDocumentation(options = {}) {
  const verified = verifyDocumentationCandidate(options);
  const loaded = loadDeploymentConfig(options.repoRoot || DEFAULT_REPO_ROOT);
  const phase = normalizePhase(options.phase || 'all');
  const objects = selectedObjects(verified.manifest, phase, loaded);
  const promotionEvidence = objects.some((entry) => entry.phase === 'mutable') && loaded.config.deployment.requiresNpmVerificationBeforePromotion
    ? validateNpmVerification(options.npmVerification)
    : undefined;
  const adapter = adapterFor(options);
  if (adapter.kind === 'aws') assertProductionDeploymentEnvironment(verified.manifest, options);
  const results = [];
  for (const entry of objects) {
    const current = adapter.head(entry.objectKey);
    if (current) {
      const currentBytes = adapter.read(entry.objectKey);
      const currentHash = currentBytes && sha256(currentBytes);
      const metadataMatches = current.contentType === entry.contentType && current.cacheControl === entry.cacheControl;
      if (currentHash === entry.sha256 && metadataMatches) {
        results.push(Object.freeze({ key: entry.objectKey, phase: entry.phase, action: 'already-present', sha256: entry.sha256 }));
        continue;
      }
      if (entry.phase === 'immutable') fail(`immutable documentation object ${entry.objectKey} already exists with different bytes or metadata`, 'PULSE_DOCUMENTATION_IMMUTABLE_CONFLICT');
    }
    const sourceFile = resolveInside(path.join(verified.candidateDir, 'site'), entry.relativePath, 'deployment source');
    adapter.put(entry.objectKey, sourceFile, entry);
    const after = adapter.head(entry.objectKey);
    const afterBytes = adapter.read(entry.objectKey);
    if (!after || !afterBytes) fail(`documentation object ${entry.objectKey} is not visible after upload`);
    if (sha256(afterBytes) !== entry.sha256) fail(`documentation object ${entry.objectKey} checksum differs after upload`);
    if (after.contentType !== entry.contentType) fail(`documentation object ${entry.objectKey} content type differs after upload`);
    if (after.cacheControl !== entry.cacheControl) fail(`documentation object ${entry.objectKey} cache control differs after upload`);
    results.push(Object.freeze({ key: entry.objectKey, phase: entry.phase, action: current ? 'replaced' : 'uploaded', sha256: entry.sha256 }));
  }
  const report = Object.freeze({
    schemaVersion: REPORT_SCHEMA,
    status: 'ok',
    operation: 'deploy',
    driver: adapter.kind,
    phase,
    releaseVersion: RELEASE_VERSION,
    source: verified.manifest.source,
    npmVerification: promotionEvidence,
    objectCount: results.length,
    uploaded: results.filter((entry) => entry.action === 'uploaded').length,
    replaced: results.filter((entry) => entry.action === 'replaced').length,
    alreadyPresent: results.filter((entry) => entry.action === 'already-present').length,
    deleted: 0,
    objects: Object.freeze(results)
  });
  if (options.jsonFile) { ensureDirectory(path.dirname(path.resolve(options.jsonFile))); fs.writeFileSync(path.resolve(options.jsonFile), stableJson(report)); }
  return report;
}

function verifyStorage(options = {}) {
  const verified = verifyDocumentationCandidate(options);
  const loaded = loadDeploymentConfig(options.repoRoot || DEFAULT_REPO_ROOT);
  const adapter = adapterFor(options);
  if (adapter.kind === 'aws') assertProductionDeploymentEnvironment(verified.manifest, options);
  const phase = normalizePhase(options.phase || 'all');
  const objects = selectedObjects(verified.manifest, phase, loaded);
  const results = [];
  for (const entry of objects) {
    const head = adapter.head(entry.objectKey);
    if (!head) fail(`documentation object ${entry.objectKey} is missing from storage`);
    const bytes = adapter.read(entry.objectKey);
    const actualHash = bytes && sha256(bytes);
    if (actualHash !== entry.sha256) fail(`documentation object ${entry.objectKey} differs from the sealed candidate`);
    if (head.contentType !== entry.contentType) fail(`documentation object ${entry.objectKey} has content type ${head.contentType || '(missing)'}, expected ${entry.contentType}`);
    if (head.cacheControl !== entry.cacheControl) fail(`documentation object ${entry.objectKey} has cache control ${head.cacheControl || '(missing)'}, expected ${entry.cacheControl}`);
    results.push(Object.freeze({ key: entry.objectKey, sha256: entry.sha256, status: 'ok' }));
  }
  const report = Object.freeze({
    schemaVersion: REPORT_SCHEMA,
    status: 'ok',
    operation: 'verify-storage',
    driver: adapter.kind,
    phase,
    releaseVersion: RELEASE_VERSION,
    objectCount: results.length,
    objects: Object.freeze(results)
  });
  if (options.jsonFile) { ensureDirectory(path.dirname(path.resolve(options.jsonFile))); fs.writeFileSync(path.resolve(options.jsonFile), stableJson(report)); }
  return report;
}

async function verifyPublicDocumentation(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const loaded = loadDeploymentConfig(repoRoot);
  const config = loaded.config;
  const origin = normalizeOrigin(options.origin || DOCUMENTATION.origin);
  const basePath = normalizeBasePath(options.basePath || DOCUMENTATION.basePath);
  const manifestOrigin = normalizeOrigin(DOCUMENTATION.origin);
  const manifestBasePath = normalizeBasePath(DOCUMENTATION.basePath);
  if (config.publicRoute.requireExactManifestMatch && !options.allowRouteOverride && (origin !== manifestOrigin || basePath !== manifestBasePath)) fail('public documentation verification route must match the release manifest');
  const attempts = Number(options.attempts || config.publicVerification.attempts);
  const delayMs = Number(options.delayMs ?? config.publicVerification.delayMs);
  const timeoutMs = Number(options.timeoutMs || config.publicVerification.requestTimeoutMs);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) fail('public verification attempts must be between 1 and 20');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60000) fail('public verification delay must be between 0 and 60000 milliseconds');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) fail('public verification timeout must be between 1000 and 120000 milliseconds');
  const checks = [];
  for (const contract of config.publicChecks) {
    const url = publicUrl(origin, basePath, contract.path);
    let lastFailure;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: contract.method || 'GET',
          redirect: 'follow',
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs)
        });
        const actualType = response.headers.get('content-type') || '';
        const body = contract.method === 'HEAD' ? '' : await response.text();
        const failures = [];
        if (response.status !== contract.status) failures.push(`status ${response.status}, expected ${contract.status}`);
        if (contract.contentType && !actualType.toLowerCase().startsWith(contract.contentType.toLowerCase())) failures.push(`content type ${actualType || '(missing)'}, expected ${contract.contentType}`);
        if (contract.bodyIncludes && !body.includes(contract.bodyIncludes)) failures.push(`body does not contain ${contract.bodyIncludes}`);
        if (!failures.length) {
          checks.push(Object.freeze({ url, status: response.status, contentType: actualType, bytes: Buffer.byteLength(body), attempts: attempt }));
          lastFailure = undefined;
          break;
        }
        lastFailure = failures.join('; ');
      } catch (error) {
        lastFailure = error && error.message ? error.message : String(error);
      }
      if (attempt < attempts && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (lastFailure) fail(`public documentation ${url} did not converge after ${attempts} attempt(s): ${lastFailure}`, 'PULSE_DOCUMENTATION_PUBLIC_VERIFICATION_FAILED');
  }
  const report = Object.freeze({
    schemaVersion: REPORT_SCHEMA,
    status: 'ok',
    operation: 'verify-public',
    releaseVersion: RELEASE_VERSION,
    origin,
    basePath,
    attempts,
    delayMs,
    requestTimeoutMs: timeoutMs,
    checks: Object.freeze(checks)
  });
  if (options.jsonFile) { ensureDirectory(path.dirname(path.resolve(options.jsonFile))); fs.writeFileSync(path.resolve(options.jsonFile), stableJson(report)); }
  return report;
}

function parseArgs(argv) {
  const out = { command: argv[0] };
  if (!['seal', 'verify-candidate', 'deploy', 'verify-storage', 'verify-public'].includes(out.command)) fail('Usage: documentation-deployment.cjs <seal|verify-candidate|deploy|verify-storage|verify-public> [options]');
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    const value = () => { const next = argv[++index]; if (!next) fail(`${token} requires a value`); return next; };
    if (token === '--repo-root') { out.repoRoot = value(); continue; }
    if (token.startsWith('--repo-root=')) { out.repoRoot = token.slice(12); continue; }
    if (token === '--site-dir') { out.siteDir = value(); continue; }
    if (token.startsWith('--site-dir=')) { out.siteDir = token.slice(11); continue; }
    if (token === '--out') { out.outDir = value(); continue; }
    if (token.startsWith('--out=')) { out.outDir = token.slice(6); continue; }
    if (token === '--candidate-dir') { out.candidateDir = value(); continue; }
    if (token.startsWith('--candidate-dir=')) { out.candidateDir = token.slice(16); continue; }
    if (token === '--source-commit') { out.sourceCommit = value(); continue; }
    if (token.startsWith('--source-commit=')) { out.sourceCommit = token.slice(16); continue; }
    if (token === '--source-ref') { out.sourceRef = value(); continue; }
    if (token.startsWith('--source-ref=')) { out.sourceRef = token.slice(13); continue; }
    if (token === '--require-release-ref') { out.requireReleaseRef = true; continue; }
    if (token === '--driver') { out.driver = value(); continue; }
    if (token.startsWith('--driver=')) { out.driver = token.slice(9); continue; }
    if (token === '--bucket-dir') { out.bucketDir = value(); continue; }
    if (token.startsWith('--bucket-dir=')) { out.bucketDir = token.slice(13); continue; }
    if (token === '--phase') { out.phase = value(); continue; }
    if (token.startsWith('--phase=')) { out.phase = token.slice(8); continue; }
    if (token === '--npm-verification') { out.npmVerification = value(); continue; }
    if (token.startsWith('--npm-verification=')) { out.npmVerification = token.slice(19); continue; }
    if (token === '--origin') { out.origin = value(); continue; }
    if (token.startsWith('--origin=')) { out.origin = token.slice(9); continue; }
    if (token === '--base-path') { out.basePath = value(); continue; }
    if (token.startsWith('--base-path=')) { out.basePath = token.slice(12); continue; }
    if (token === '--allow-route-override') { out.allowRouteOverride = true; continue; }
    if (token === '--attempts') { out.attempts = Number(value()); continue; }
    if (token.startsWith('--attempts=')) { out.attempts = Number(token.slice(11)); continue; }
    if (token === '--delay-ms') { out.delayMs = Number(value()); continue; }
    if (token.startsWith('--delay-ms=')) { out.delayMs = Number(token.slice(11)); continue; }
    if (token === '--timeout-ms') { out.timeoutMs = Number(value()); continue; }
    if (token.startsWith('--timeout-ms=')) { out.timeoutMs = Number(token.slice(13)); continue; }
    if (token === '--json-out') { out.jsonFile = value(); continue; }
    if (token.startsWith('--json-out=')) { out.jsonFile = token.slice(11); continue; }
    fail(`unknown option ${token}`);
  }
  return out;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let result;
  if (options.command === 'seal') result = sealDocumentationCandidate(options);
  else if (options.command === 'verify-candidate') result = verifyDocumentationCandidate(options);
  else if (options.command === 'deploy') result = deployDocumentation(options);
  else if (options.command === 'verify-storage') result = verifyStorage(options);
  else result = await verifyPublicDocumentation(options);
  if (options.jsonFile) {
    ensureDirectory(path.dirname(path.resolve(options.jsonFile)));
    fs.writeFileSync(path.resolve(options.jsonFile), stableJson(result));
  }
  process.stdout.write(stableJson(result));
}

module.exports = Object.freeze({
  CONFIG_SCHEMA,
  CANDIDATE_SCHEMA,
  REPORT_SCHEMA,
  RECEIPT_SCHEMA,
  NPM_VERIFICATION_SCHEMA,
  normalizeOrigin,
  normalizeBasePath,
  publicUrl,
  loadDeploymentConfig,
  classifyRelative,
  contentType,
  sealDocumentationCandidate,
  verifyDocumentationCandidate,
  validateNpmVerification,
  verifyNpmPromotionEvidence,
  normalizePhase,
  filesystemAdapter,
  awsAdapter,
  assertProductionDeploymentEnvironment,
  deployDocumentation,
  verifyStorage,
  verifyPublicDocumentation,
  validateSourceIdentity,
  validateReleaseIdentity,
  sha256
});

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    if (error && error.details) process.stderr.write(stableJson(error.details));
    process.exitCode = 1;
  });
}
