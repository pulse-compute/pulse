'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WORKSPACE_DISCOVERY_VERSION = 'pulse.workspace-discovery.v1';
const PROJECT_WORKSPACE_VERSION = 'pulse.project-workspace.v1';
const CONVENTIONAL_CONFIG = path.join('.pulse', 'config.ts');

class PulseWorkspaceError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PulseWorkspaceError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}
function fileExists(file) { try { return fs.statSync(file).isFile(); } catch (_) { return false; } }
function directoryExists(dir) { try { return fs.statSync(dir).isDirectory(); } catch (_) { return false; } }
function canonicalDirectory(dir) { return fs.realpathSync(path.resolve(dir)); }
function canonicalExistingFile(file) { return fs.realpathSync(path.resolve(file)); }
function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function findWorktreeBoundary(start) {
  let current = canonicalDirectory(start);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}
function discoverConventionalWorkspace(start) {
  const origin = canonicalDirectory(start);
  const boundary = findWorktreeBoundary(origin);
  let current = origin;
  for (;;) {
    const configFile = path.join(current, CONVENTIONAL_CONFIG);
    if (fileExists(configFile)) {
      return Object.freeze({
        version: PROJECT_WORKSPACE_VERSION,
        kind: 'conventional',
        root: current,
        configFile: canonicalExistingFile(configFile),
        discoveryStart: origin,
        boundary,
        source: current === origin ? 'current' : 'ancestor',
        configInsideWorkspace: true
      });
    }
    if (current === boundary) break;
    const parent = path.dirname(current);
    if (parent === current || !isInside(boundary, parent)) break;
    current = parent;
  }
  return undefined;
}
function resolveWorkspace(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const startCandidate = options.directory ? path.resolve(cwd, options.directory) : cwd;
  if (!directoryExists(startCandidate)) {
    throw new PulseWorkspaceError('PULSE_PROJECT_ROOT_MISSING', `Pulse project directory does not exist: ${startCandidate}`, { projectRoot: startCandidate });
  }
  const start = canonicalDirectory(startCandidate);
  return discoverConventionalWorkspace(start);
}

module.exports = Object.freeze({
  WORKSPACE_DISCOVERY_VERSION,
  PROJECT_WORKSPACE_VERSION,
  CONVENTIONAL_CONFIG,
  PulseWorkspaceError,
  fileExists,
  directoryExists,
  isInside,
  findWorktreeBoundary,
  discoverConventionalWorkspace,
  resolveWorkspace,
  resolveProjectWorkspace: resolveWorkspace
});
