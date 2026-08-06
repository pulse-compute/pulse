'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  PACKAGE_CONTRACT_CATALOG_VERSION,
  PACKAGE_CONTRACT_DISCOVERY_VERSION,
  PACKAGE_PRODUCT_METADATA_PACKAGE_POLICY,
  PACKAGE_NATIVE_LOWERING_TRUST_POLICY,
  normalizePackageContract,
  validatePackageContractCatalog
} = loadPackageContractAuthority();
const { discoverLowerableLibraryManifests } = require('./handler-library-contracts.js');


function loadPackageContractAuthority() {
  try {
    return require('@pulse-compute/wasm-contracts/package/package-contract');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/package/package-contract.js');
    }
    throw error;
  }
}

function readJson(file) {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findWorkspaceRoot(cwd) {
  let current = path.resolve(cwd || process.cwd());
  while (true) {
    const packageJson = readJson(path.join(current, 'package.json'));
    if ((packageJson && packageJson.workspaces) || fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd || process.cwd());
    current = parent;
  }
}

function workspacePatterns(root) {
  const packageJson = readJson(path.join(root, 'package.json')) || {};
  if (Array.isArray(packageJson.workspaces)) return packageJson.workspaces;
  if (packageJson.workspaces && Array.isArray(packageJson.workspaces.packages)) return packageJson.workspaces.packages;
  const pnpmWorkspace = path.join(root, 'pnpm-workspace.yaml');
  if (!fs.existsSync(pnpmWorkspace)) return ['packages/*'];
  return fs.readFileSync(pnpmWorkspace, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, ''))
    .filter((line) => line && !line.startsWith('#'));
}

function expandPattern(root, pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/');
  if (!normalized.endsWith('/*')) return [];
  const parent = path.resolve(root, normalized.slice(0, -2));
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name));
}

function nodeModulesPackageDirs(root, cwd) {
  const roots = new Set([path.join(root, 'node_modules')]);
  let current = path.resolve(cwd || root);
  while (true) {
    roots.add(path.join(current, 'node_modules'));
    if (current === path.resolve(root)) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const dirs = [];
  for (const nodeModulesRoot of roots) {
    if (!fs.existsSync(nodeModulesRoot)) continue;
    for (const entry of fs.readdirSync(nodeModulesRoot, { withFileTypes: true })) {
      if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith('.')) continue;
      const full = path.join(nodeModulesRoot, entry.name);
      if (!entry.name.startsWith('@')) {
        dirs.push(full);
        continue;
      }
      if (!fs.existsSync(full)) continue;
      for (const child of fs.readdirSync(full, { withFileTypes: true })) {
        if ((child.isDirectory() || child.isSymbolicLink()) && !child.name.startsWith('.')) dirs.push(path.join(full, child.name));
      }
    }
  }
  return dirs;
}

function packageContractPath(packageJson) {
  const pulse = packageJson && packageJson.pulse;
  return pulse && typeof pulse === 'object' && typeof pulse.contract === 'string' ? pulse.contract : undefined;
}

function resolveInsidePackage(packageDir, reference, field, expectedKind = 'file') {
  const root = path.resolve(packageDir);
  const resolved = path.resolve(packageDir, reference);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new TypeError(`${field} must remain inside ${root}.`);
  if (!fs.existsSync(resolved)) throw new TypeError(`${field} does not exist: ${reference}.`);
  const stat = fs.statSync(resolved);
  if (expectedKind === 'file' && !stat.isFile()) throw new TypeError(`${field} must identify a file: ${reference}.`);
  if (expectedKind === 'directory' && !stat.isDirectory()) throw new TypeError(`${field} must identify a directory: ${reference}.`);
  return resolved;
}

function loadContract(file) {
  if (path.extname(file) !== '.json') throw new TypeError(`Pulse product metadata must be static JSON: ${file}.`);
  const value = readJson(file);
  if (!value) throw new TypeError(`Pulse product metadata is not valid JSON: ${file}.`);
  return normalizePackageContract(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sortedUnique(values) {
  return [...new Set(values || [])].sort();
}

function validateLowererAlignment(contract, lowerable, packageDir) {
  if (contract.targets.native.status !== 'supported') return null;
  if (!lowerable) throw new TypeError(`Native package contract ${contract.contractId} has no package-owned lowering manifest.`);
  const manifest = lowerable.manifest;
  if (manifest.contractId !== contract.contractId) throw new TypeError(`Package contract ${contract.contractId} does not match lowerer contract ${manifest.contractId}.`);
  if (manifest.npmPackage !== contract.npmPackage) throw new TypeError(`Package contract ${contract.contractId} lowerer package does not match ${contract.npmPackage}.`);
  if (manifest.lowerableSubpath !== contract.targets.native.lowerableSubpath) throw new TypeError(`Package contract ${contract.contractId} lowerable subpath does not match the trusted lowerer manifest.`);
  const expectedManifest = path.relative(packageDir, lowerable.manifestFile).replace(/\\/g, '/').replace(/^(?!\.)/, './');
  if (contract.lowering.manifest !== expectedManifest) throw new TypeError(`Package contract ${contract.contractId} lowering.manifest must identify ${expectedManifest}.`);
  const manifestRequirements = sortedUnique(manifest.modes && manifest.modes.wasm && manifest.modes.wasm.hostCapabilities || []);
  if (JSON.stringify(manifestRequirements) !== JSON.stringify([...contract.targets.native.providerRequirements])) {
    throw new TypeError(`Package contract ${contract.contractId} provider requirements do not match the trusted lowerer manifest.`);
  }
  const manifestSymbols = sortedUnique(manifest.facade && manifest.facade.symbols || []);
  if (manifest.lowerableSubpath !== contract.authoring.import || JSON.stringify(manifestSymbols) !== JSON.stringify([...contract.authoring.symbols])) {
    throw new TypeError(`Package contract ${contract.contractId} authoring facade does not match the trusted lowerer manifest.`);
  }
  const semanticCases = sortedUnique(manifest.modes && manifest.modes.wasm && manifest.modes.wasm.lowerings
    ? manifest.modes.wasm.lowerings.map((entry) => entry.tsSymbol)
    : []);
  if (JSON.stringify(semanticCases) !== JSON.stringify([...contract.conformance.semanticCases])) {
    throw new TypeError(`Package contract ${contract.contractId} semantic cases do not match the trusted lowerer operations.`);
  }
  return Object.freeze({ manifest, manifestFile: lowerable.manifestFile, manifestRequirements, semanticCases });
}

function validateOwnedPaths(contract, packageDir) {
  for (const root of contract.conformance.fixtureRoots) resolveInsidePackage(packageDir, root, `${contract.contractId} conformance.fixtureRoots`, 'directory');
  if (contract.docs.readme) resolveInsidePackage(packageDir, contract.docs.readme, `${contract.contractId} docs.readme`);
  if (contract.docs.contract) resolveInsidePackage(packageDir, contract.docs.contract, `${contract.contractId} docs.contract`);
}

function discoverPulsePackageContracts(inputs = {}) {
  const cwd = path.resolve(inputs.cwd || process.cwd());
  const workspaceRoot = path.resolve(inputs.workspaceRoot || findWorkspaceRoot(cwd));
  const workspaceDirs = workspacePatterns(workspaceRoot).flatMap((pattern) => expandPattern(workspaceRoot, pattern)).map((entry) => path.resolve(entry));
  const externalDirs = inputs.scanNodeModules === false ? [] : nodeModulesPackageDirs(workspaceRoot, cwd).map((entry) => path.resolve(entry));
  const packageDirs = [];
  const seenPackageDirs = new Set();
  for (const packageDir of [...workspaceDirs, ...externalDirs]) {
    const resolved = path.resolve(packageDir);
    const identity = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
    if (seenPackageDirs.has(identity)) continue;
    seenPackageDirs.add(identity);
    packageDirs.push(resolved);
  }
  const lowerableByPackage = new Map(discoverLowerableLibraryManifests({
    cwd,
    workspaceRoot,
    scanNodeModules: inputs.scanNodeModules !== false
  }).map((record) => [record.packageName, record]));
  const records = [];

  for (const packageDir of packageDirs) {
    const packageJsonFile = path.join(packageDir, 'package.json');
    const packageJson = readJson(packageJsonFile);
    const contractRef = packageContractPath(packageJson);
    if (!packageJson || !contractRef) continue;
    if (typeof packageJson.name !== 'string' || packageJson.name.trim().length === 0) {
      throw new TypeError('Pulse package contracts require package.json name.');
    }
    const contractFile = resolveInsidePackage(packageDir, contractRef, `${packageJson.name} package.json pulse.contract`);
    const contract = loadContract(contractFile);
    if (contract.npmPackage !== packageJson.name) throw new TypeError(`Pulse package contract ${contract.contractId} declares ${contract.npmPackage}, but package.json declares ${packageJson.name}.`);
    validateOwnedPaths(contract, packageDir);
    const lowerer = validateLowererAlignment(contract, lowerableByPackage.get(packageJson.name), packageDir);
    records.push(Object.freeze({
      version: PACKAGE_CONTRACT_DISCOVERY_VERSION,
      packageDir,
      packageJsonFile,
      packageName: packageJson.name,
      packageVersion: String(packageJson.version || '0.0.0'),
      contractFile,
      contract,
      contractHash: sha256(JSON.stringify(contract)),
      source: workspaceDirs.includes(packageDir) ? 'workspace' : 'node_modules',
      lowerableManifestFile: lowerer && lowerer.manifestFile || null
    }));
  }

  const catalog = validatePackageContractCatalog(records.map((entry) => entry.contract));
  const byContract = new Map(records.map((entry) => [entry.contract.contractId, entry]));
  const contracts = catalog.contracts.map((contract) => {
    const record = byContract.get(contract.contractId);
    return Object.freeze({
      ...contract,
      metadataHash: record.contractHash,
      packageVersion: record.packageVersion,
      source: record.source
    });
  });
  return Object.freeze({
    version: catalog.version,
    discoveryVersion: PACKAGE_CONTRACT_DISCOVERY_VERSION,
    contracts: Object.freeze(contracts),
    profileFragments: catalog.profileFragments,
    helperImports: catalog.helperImports,
    records: Object.freeze(records),
    policy: Object.freeze({
      ...catalog.policy,
      productMetadataPackages: PACKAGE_PRODUCT_METADATA_PACKAGE_POLICY,
      nativeLoweringTrust: PACKAGE_NATIVE_LOWERING_TRUST_POLICY,
      absolutePathsExcludedFromCatalog: true,
      applicationCodeHooks: false,
      dynamicRegistration: false
    })
  });
}

module.exports = Object.freeze({
  PACKAGE_CONTRACT_DISCOVERY_VERSION,
  PACKAGE_PRODUCT_METADATA_PACKAGE_POLICY,
  PACKAGE_NATIVE_LOWERING_TRUST_POLICY,
  discoverPulsePackageContracts,
  packageContractPath,
  loadContract
});
