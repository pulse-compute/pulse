'use strict';

const fs = require('node:fs');
const path = require('node:path');

function getBuildSupportPackageRoot() {
  return path.resolve(__dirname, '..');
}

function getWasmRoot() {
  const packageRoot = getBuildSupportPackageRoot();
  const candidate = path.resolve(packageRoot, '..', '..');
  const manifestPath = path.join(candidate, 'package.json');
  if (path.basename(path.dirname(packageRoot)) === 'packages' && fs.existsSync(manifestPath)) {
    return candidate;
  }
  return undefined;
}

function getDefaultArtifactsDir(cwd = process.cwd()) {
  if (process.env.PULSEWASM_ARTIFACTS_DIR) {
    return path.resolve(cwd, process.env.PULSEWASM_ARTIFACTS_DIR);
  }
  const wasmRoot = getWasmRoot();
  if (wasmRoot) {
    return path.join(wasmRoot, 'artifacts');
  }
  return path.join(cwd, 'artifacts');
}

function resolveArtifactsDir(value, cwd = process.cwd()) {
  if (!value) return getDefaultArtifactsDir(cwd);
  return path.resolve(cwd, value);
}

module.exports = {
  getBuildSupportPackageRoot,
  getWasmRoot,
  getDefaultArtifactsDir,
  resolveArtifactsDir
};
