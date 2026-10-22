#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { RELEASE_VERSION, DOCUMENTATION } = require('./package-support.cjs');

const CONFIG_SCHEMA = 'pulse.documentation-deployment.v1';
const CANDIDATE_SCHEMA = 'pulse.documentation-deployment-candidate.v1';
const RECEIPT_SCHEMA = 'pulse.documentation-deployment-receipt.v1';
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

// Historical v1 candidate reader only. Source retirement does not disable historical refs.

function fail(message, code = 'PULSE_DOCUMENTATION_DEPLOYMENT_INVALID', details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function slash(value) { return String(value).replace(/\\/g, '/'); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`Unable to read JSON ${file}: ${error.message}`); }
}

function resolveInside(root, relativeFile, context) {
  const normalized = slash(relativeFile || '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.split('/').includes('..')) fail(`${context} must be a safe relative path, found ${relativeFile}`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalized);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) fail(`${context} escapes ${resolvedRoot}`);
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
  if (options.bindingFile) require('./release-qualification.cjs').validateBoundSource({ root: repoRoot,
    bindingFile: options.bindingFile, manifestFile: path.join(candidateDir, 'documentation-deployment-manifest.json'), source: manifest.source, kind: 'documentation' });
  else if (options.requireReleaseRef) validateReleaseIdentity(manifest.source || {});
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

module.exports = Object.freeze({ CONFIG_SCHEMA, CANDIDATE_SCHEMA, RECEIPT_SCHEMA, normalizeOrigin, normalizeBasePath, publicUrl, loadDeploymentConfig, classifyRelative, contentType, verifyDocumentationCandidate, validateSourceIdentity, validateReleaseIdentity, sha256 });

if (require.main === module) {
  try {
    const [command, flag, candidateDir] = process.argv.slice(2);
    if (command !== 'verify-candidate' || flag !== '--candidate-dir' || !candidateDir || process.argv.length !== 5) {
      fail('Writer retired: only verify-candidate --candidate-dir <directory> is supported');
    }
    process.stdout.write(stableJson(verifyDocumentationCandidate({ candidateDir })));
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
