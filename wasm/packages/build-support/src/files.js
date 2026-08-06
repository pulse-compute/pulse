'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizeSlash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function truncate(value, max = 20000) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... <truncated ${text.length - max} chars>`;
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

const TEXT_ARTIFACT_EXTENSIONS = new Set([
  '.cjs', '.js', '.json', '.md', '.mjs', '.toml', '.ts', '.txt', '.wat', '.yaml', '.yml'
]);

// AssemblyScript and several proof builders use mkdtemp staging directories.
// Those paths are operational details, not part of the generated program. Keep
// checked-in/compiler artifacts stable without weakening semantic hash checks.
function canonicalizeEphemeralPaths(value) {
  const stagingNames = String(value || '').replace(
    /pulsewasm-([A-Za-z0-9._-]+?)-[A-Za-z0-9]{6}(?=[^A-Za-z0-9]|$)/g,
    'pulsewasm-$1-STAGING'
  );
  // AssemblyScript writes source names relative to the output directory. That
  // relative prefix changes when the repository is unpacked at a different
  // filesystem depth even though the generated program is identical. Remove
  // only the path leading to a known Pulse staging directory; retain the
  // staging family and all source-relative suffixes for semantic hashing.
  return stagingNames
    .replace(/(?:\.\.\/)+tmp\/(pulsewasm-[A-Za-z0-9._-]+-STAGING)(?=\/)/g, 'tmp/$1')
    .replace(/\/tmp\/(pulsewasm-[A-Za-z0-9._-]+-STAGING)(?=\/)/g, 'tmp/$1');
}

function isTextArtifact(filePath) {
  return TEXT_ARTIFACT_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function canonicalizeArtifactBuffer(filePath, buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (!isTextArtifact(filePath)) return source;
  return Buffer.from(canonicalizeEphemeralPaths(source.toString('utf8')), 'utf8');
}

function normalizeArtifactFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const before = fs.readFileSync(filePath);
  const after = canonicalizeArtifactBuffer(filePath, before);
  if (before.equals(after)) return false;
  fs.writeFileSync(filePath, after);
  return true;
}

function fileRecord(filePath, cwd, kind) {
  const buffer = fs.readFileSync(filePath);
  return {
    file: normalizeSlash(path.relative(cwd, filePath)),
    kind,
    bytes: buffer.length,
    sha256: sha256Buffer(buffer)
  };
}

module.exports = {
  normalizeSlash,
  sha256Buffer,
  sha256Text,
  truncate,
  stripAnsi,
  fileRecord,
  canonicalizeEphemeralPaths,
  canonicalizeArtifactBuffer,
  normalizeArtifactFile,
  isTextArtifact
};
