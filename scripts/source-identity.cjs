#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ARCHIVE_IDENTITY_KIND = 'archive-tree-sha256-160';
const GIT_IDENTITY_KIND = 'git-commit';
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.corepack',
  '.git',
  '.test-results',
  '.validation-tools',
  'coverage',
  'dist',
  'node_modules'
]);
const EXCLUDED_ROOT_DIRECTORIES = new Set([
  '.pulse',
  '.pulse-documentation-deployment',
  '.pulse-docs-site',
  '.pulse-publication',
  '.pulse-release',
  '.pulse-release-preflight'
]);

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function assertRevision(value, label = 'source revision') {
  if (!/^[a-f0-9]{40}$/.test(String(value || ''))) {
    throw new Error(`${label} must be a 40-character lowercase hexadecimal identity`);
  }
}

function gitRevision(repoRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000
  });
  if (result.error || result.status !== 0) return null;
  const revision = String(result.stdout || '').trim();
  return /^[a-f0-9]{40}$/.test(revision) ? revision : null;
}

function excludedDirectory(relative, name) {
  if (EXCLUDED_DIRECTORY_NAMES.has(name)) return true;
  if (!relative.includes('/') && EXCLUDED_ROOT_DIRECTORIES.has(relative)) return true;
  if (name.startsWith('.pulse-') || name.startsWith('.release-candidate-')) return true;
  if (name.startsWith('.four-mode-')) return true;
  if (name === 'guests' && /(^|\/)\.pulse\/guests$/.test(relative)) return true;
  return false;
}

function archiveTreeInventory(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(directory, entry.name);
      const relative = slash(path.relative(root, file));
      if (entry.isDirectory()) {
        if (!excludedDirectory(relative, entry.name)) visit(file);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === '.DS_Store' || entry.name.endsWith('.log') || entry.name.endsWith('.tsbuildinfo')) continue;
      const bytes = fs.readFileSync(file);
      files.push(Object.freeze({
        file: relative,
        bytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex')
      }));
    }
  }
  visit(root);
  return Object.freeze(files);
}

function archiveTreeIdentity(repoRoot) {
  const files = archiveTreeInventory(repoRoot);
  const hash = crypto.createHash('sha256');
  hash.update('pulse.archive-tree.v1\n');
  for (const entry of files) {
    hash.update(entry.file);
    hash.update('\0');
    hash.update(String(entry.bytes));
    hash.update('\0');
    hash.update(entry.sha256);
    hash.update('\n');
  }
  const sourceDigestSha256 = hash.digest('hex');
  return Object.freeze({
    sourceRevision: sourceDigestSha256.slice(0, 40),
    sourceIdentityKind: ARCHIVE_IDENTITY_KIND,
    sourceDigestSha256,
    sourceFiles: files.length
  });
}

function resolveSourceIdentity(repoRoot, env = process.env) {
  const provided = String(env.PULSE_SOURCE_REVISION || '').trim();
  if (provided) {
    assertRevision(provided, 'PULSE_SOURCE_REVISION');
    const sourceIdentityKind = String(env.PULSE_SOURCE_IDENTITY_KIND || 'provided').trim();
    if (!sourceIdentityKind || /[\r\n\0]/.test(sourceIdentityKind)) {
      throw new Error('PULSE_SOURCE_IDENTITY_KIND is invalid');
    }
    const digest = String(env.PULSE_SOURCE_DIGEST_SHA256 || '').trim();
    if (digest && !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error('PULSE_SOURCE_DIGEST_SHA256 must be a 64-character lowercase SHA-256 digest');
    }
    const sourceFiles = Number.parseInt(env.PULSE_SOURCE_FILE_COUNT || '', 10);
    return Object.freeze({
      sourceRevision: provided,
      sourceIdentityKind,
      sourceDigestSha256: digest || null,
      sourceFiles: Number.isSafeInteger(sourceFiles) && sourceFiles >= 0 ? sourceFiles : null
    });
  }

  const revision = gitRevision(path.resolve(repoRoot));
  if (revision) {
    return Object.freeze({
      sourceRevision: revision,
      sourceIdentityKind: GIT_IDENTITY_KIND,
      sourceDigestSha256: null,
      sourceFiles: null
    });
  }
  return archiveTreeIdentity(repoRoot);
}

function sourceIdentityEnv(identity) {
  assertRevision(identity && identity.sourceRevision);
  return Object.freeze({
    PULSE_SOURCE_REVISION: identity.sourceRevision,
    PULSE_SOURCE_IDENTITY_KIND: identity.sourceIdentityKind,
    ...(identity.sourceDigestSha256 ? { PULSE_SOURCE_DIGEST_SHA256: identity.sourceDigestSha256 } : {}),
    ...(Number.isSafeInteger(identity.sourceFiles) ? { PULSE_SOURCE_FILE_COUNT: String(identity.sourceFiles) } : {})
  });
}

module.exports = Object.freeze({
  ARCHIVE_IDENTITY_KIND,
  GIT_IDENTITY_KIND,
  archiveTreeInventory,
  archiveTreeIdentity,
  resolveSourceIdentity,
  sourceIdentityEnv
});
