// Synthetic historical v1 evidence for reader regression tests only. No storage adapter.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { RELEASE_VERSION, DOCUMENTATION } = require('../../../scripts/package-support.cjs');
const { loadDeploymentConfig, classifyRelative, contentType, verifyDocumentationCandidate, sha256 } = require('../../../scripts/documentation-deployment.cjs');
const RECEIPT_SCHEMA = 'pulse.documentation-deployment-receipt.v1';
const CANDIDATE_SCHEMA = 'pulse.documentation-deployment-candidate.v1';
const stableJson = value => JSON.stringify(value, null, 2) + '\n';
const slash = value => value.split(path.sep).join('/');
const ensureDirectory = directory => fs.mkdirSync(directory, { recursive: true });
const fail = message => { throw new Error(message); };
const resolveInside = (root, relative) => path.join(root, relative);
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

function syntheticLegacyCandidate(options = {}) {
  const repoRoot = path.resolve(options.repoRoot);
  const loaded = loadDeploymentConfig(repoRoot);
  const config = loaded.config;
  const siteDir = path.resolve(options.siteDir || path.join(repoRoot, config.sourceDirectory));
  const outDir = options.outDir;
  if (fs.existsSync(outDir)) throw new Error('Synthetic fixture output must be new');
  const identity = { commit: 'a'.repeat(40), ref: `refs/tags/v${RELEASE_VERSION}` };
  const candidateSite = path.join(outDir, 'site');
  ensureDirectory(candidateSite);
  fs.cpSync(siteDir, candidateSite, { recursive: true });
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

module.exports = { syntheticLegacyCandidate };
