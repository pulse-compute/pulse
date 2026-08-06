'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { diagnosticCodes } = require('./constants.js');
const { fail } = require('./errors.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function assertRelativePath(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(diagnosticCodes.invalid, `${field} must be a non-empty package-relative path.`);
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\')) {
    fail(diagnosticCodes.invalid, `${field} must use portable package-relative syntax.`);
  }
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    fail(diagnosticCodes.invalid, `${field} must not contain empty, current, or parent path segments.`);
  }
  return value;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveExistingContained(root, relative, field, expectedKind = 'file') {
  const normalized = assertRelativePath(relative, field);
  const realRoot = fs.realpathSync(root);
  const candidate = path.resolve(realRoot, normalized);
  if (!inside(realRoot, candidate) || !fs.existsSync(candidate)) {
    fail(diagnosticCodes.invalid, `${field} does not resolve to an existing contained ${expectedKind}.`);
  }
  const real = fs.realpathSync(candidate);
  if (!inside(realRoot, real)) {
    fail(diagnosticCodes.invalid, `${field} escapes its package root.`);
  }
  const stat = fs.statSync(real);
  if ((expectedKind === 'file' && !stat.isFile()) || (expectedKind === 'directory' && !stat.isDirectory())) {
    fail(diagnosticCodes.invalid, `${field} must resolve to a ${expectedKind}.`);
  }
  return real;
}

function fileRecord(file) {
  const bytes = fs.readFileSync(file);
  return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) });
}

function sourceEntries(directory, root = directory, entries = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  ))) {
    const file = path.join(directory, entry.name);
    const relative = slash(path.relative(root, file));
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      fail(diagnosticCodes.invalid, `Guest source provenance rejects symbolic link ${relative}.`);
    }
    if (stat.isDirectory()) {
      sourceEntries(file, root, entries);
      continue;
    }
    if (!stat.isFile()) {
      fail(diagnosticCodes.invalid, `Guest source provenance rejects non-file ${relative}.`);
    }
    entries.push(Object.freeze({ relative, file, bytes: stat.size }));
  }
  return entries;
}

function sourceTreeRecord(directory) {
  const entries = sourceEntries(directory);
  if (entries.length === 0) fail(diagnosticCodes.invalid, 'Guest source provenance directory must not be empty.');
  const hash = crypto.createHash('sha256');
  const files = [];
  for (const entry of entries) {
    const bytes = fs.readFileSync(entry.file);
    hash.update(entry.relative, 'utf8');
    hash.update('\0');
    hash.update(String(bytes.length), 'utf8');
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
    files.push(Object.freeze({
      file: entry.relative,
      bytes: bytes.length,
      sha256: sha256(bytes)
    }));
  }
  return Object.freeze({
    algorithm: 'path-size-bytes-sha256-v1',
    files: Object.freeze(files),
    bytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
    sha256: hash.digest('hex')
  });
}

function ensureContainedDirectory(projectRoot, relative) {
  const realProject = fs.realpathSync(projectRoot);
  const target = path.resolve(realProject, relative);
  if (!inside(realProject, target)) {
    fail(diagnosticCodes.materializationFailed, 'Guest workspace escapes the project root.');
  }
  fs.mkdirSync(target, { recursive: true });
  const realTarget = fs.realpathSync(target);
  if (!inside(realProject, realTarget)) {
    fail(diagnosticCodes.materializationFailed, 'Guest workspace resolves outside the project root.');
  }
  return realTarget;
}

function writeAtomic(file, bytes) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

module.exports = Object.freeze({
  sha256,
  stableJson,
  slash,
  assertRelativePath,
  inside,
  resolveExistingContained,
  fileRecord,
  sourceTreeRecord,
  ensureContainedDirectory,
  writeAtomic
});
