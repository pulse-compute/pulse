#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const RELEASE_SCHEMA = 'pulse.release-packages.v3';
const {
  RELEASE_MANIFEST,
  RELEASE_MANIFEST_FILE,
  RELEASE_VERSION,
  LICENSE,
  LEGAL,
  PACKAGE_SET,
  DOCUMENTATION,
  PUBLICATION
} = require('./package-support.cjs');
const {
  validateDocumentationSource,
  validatePackedDocumentationSet
} = require('./documentation-release.cjs');

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_RELEASE_PACKAGE_INVALID';
  throw error;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha512(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('hex');
}

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function integrity(buffer) {
  return `sha512-${crypto.createHash('sha512').update(buffer).digest('base64')}`;
}

function recursiveValues(value, visit) {
  if (Array.isArray(value)) {
    for (const entry of value) recursiveValues(entry, visit);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) recursiveValues(entry, visit);
    return;
  }
  visit(value);
}

function readTarEntries(tarball) {
  const archive = zlib.gunzipSync(fs.readFileSync(tarball));
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '');
    const name = text(0, 100);
    const prefix = text(345, 500);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = text(124, 136).trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (!Number.isFinite(size) || bodyEnd > archive.length) fail(`Invalid tar entry in ${tarball}: ${fullName}`);
    entries.set(fullName, archive.subarray(bodyStart, bodyEnd));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function pnpmInvocation(repoRoot) {
  const bundled = path.join(repoRoot, '.validation-tools', 'pnpm', 'bin', 'pnpm.cjs');
  if (fs.existsSync(bundled)) return { command: process.execPath, prefix: [bundled] };
  return { command: 'corepack', prefix: [`pnpm@${PUBLICATION.pnpmVersion}`] };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 300000,
  });
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr, result.error && result.error.message].filter(Boolean).join('\n').trim();
    fail(`Command failed: ${command} ${args.join(' ')}${detail ? `\n${detail}` : ''}`);
  }
  return result;
}

function validateSourcePackage(repoRoot, entry) {
  const manifestFile = path.join(repoRoot, entry.dir, 'package.json');
  if (!fs.existsSync(manifestFile)) fail(`Release package manifest is missing: ${entry.dir}`);
  const manifest = readJson(manifestFile);
  if (!manifest.name || !manifest.version) fail(`Release package identity is incomplete: ${entry.dir}`);
  if (manifest.name !== entry.name) fail(`${entry.dir} package name ${manifest.name} does not match release catalog ${entry.name}`);
  if (entry.version !== RELEASE_VERSION) fail(`${entry.name} catalog version must be ${RELEASE_VERSION}, found ${entry.version}`);
  if (manifest.version !== RELEASE_VERSION) fail(`${manifest.name} must use release version ${RELEASE_VERSION}, found ${manifest.version}`);
  if (manifest.private === true) fail(`${manifest.name} is still private`);
  if (!manifest.publishConfig || manifest.publishConfig.access !== 'public') fail(`${manifest.name} must declare publishConfig.access=public`);
  if (manifest.license !== LICENSE) fail(`${manifest.name} must declare license=${LICENSE}`);
  if (!manifest.engines || manifest.engines.node !== PUBLICATION.nodeEngines) {
    fail(`${manifest.name} must declare engines.node=${PUBLICATION.nodeEngines}`);
  }
  return manifest;
}

function sortedRecord(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)));
}

function releasePackManifest(sourceManifest) {
  const manifest = JSON.parse(JSON.stringify(sourceManifest));
  delete manifest.devDependencies;
  manifest.files = [...new Set([...(manifest.files || []), ...LEGAL.packageFiles])];
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!manifest[section]) continue;
    for (const [name, version] of Object.entries(manifest[section])) {
      if (typeof version !== 'string' || !version.startsWith('workspace:')) continue;
      if (!name.startsWith('@pulse-compute/')) fail(`${manifest.name} ${section}.${name} uses workspace protocol outside the Pulse release set`);
      manifest[section][name] = RELEASE_VERSION;
    }
    manifest[section] = sortedRecord(manifest[section]);
  }
  return manifest;
}

function stagePackageForPack(repoRoot, entry, sourceManifest, stagingRoot) {
  const source = path.join(repoRoot, entry.dir);
  const target = path.join(stagingRoot, entry.name.replace(/[^a-zA-Z0-9._-]/g, '-'));
  fs.cpSync(source, target, {
    recursive: true,
    filter(file) {
      const relative = path.relative(source, file).replace(/\\/g, '/');
      return relative === '' || !/(?:^|\/)(?:node_modules|\.test-results|artifacts-test-[^/]+)(?:\/|$)/.test(relative);
    }
  });
  fs.writeFileSync(path.join(target, 'package.json'), stableJson(releasePackManifest(sourceManifest)));
  for (const legalFile of LEGAL.packageFiles) fs.copyFileSync(path.join(repoRoot, legalFile), path.join(target, legalFile));
  return target;
}

function validatePackedPackage(tarball, sourceManifest, entry, legalBytes) {
  const entries = readTarEntries(tarball);
  const packageJson = entries.get('package/package.json');
  if (!packageJson) fail(`Packed package.json is missing from ${path.basename(tarball)}`);
  const manifest = JSON.parse(packageJson.toString('utf8'));
  if (manifest.name !== sourceManifest.name || manifest.version !== sourceManifest.version) {
    fail(`Packed identity mismatch for ${sourceManifest.name}`);
  }
  if (manifest.private === true) fail(`Packed ${manifest.name} is private`);
  if (manifest.license !== LICENSE) fail(`Packed ${manifest.name} must declare license=${LICENSE}`);
  if (!manifest.engines || manifest.engines.node !== PUBLICATION.nodeEngines) {
    fail(`Packed ${manifest.name} must declare engines.node=${PUBLICATION.nodeEngines}`);
  }
  recursiveValues(manifest, (value) => {
    if (typeof value === 'string' && value.startsWith('workspace:')) fail(`Packed ${manifest.name} retains workspace protocol ${value}`);
  });
  const names = [...entries.keys()].sort();
  for (const name of names) {
    if (/^package\/(?:node_modules|\.pnpm|test|tests)(?:\/|$)/.test(name)) fail(`${manifest.name} tarball contains repository-only path ${name}`);
    if (/^package\/(?:docs\/internal|\.test-results|artifacts-test-)/.test(name)) fail(`${manifest.name} tarball contains internal scratch path ${name}`);
  }
  if (!names.some((name) => name === 'package/README.md')) fail(`${manifest.name} tarball must contain README.md`);
  for (const legalFile of LEGAL.packageFiles) {
    const packedLegal = entries.get(`package/${legalFile}`);
    if (!packedLegal) fail(`${manifest.name} tarball must contain ${legalFile}`);
    if (!packedLegal.equals(legalBytes.get(legalFile))) fail(`${manifest.name} tarball ${legalFile} differs from the repository ${legalFile}`);
    if (!manifest.files.includes(legalFile)) fail(`Packed ${manifest.name} files must explicitly include ${legalFile}`);
  }
  if (entry.role === 'public-cli' && !names.includes('package/bin/pulse.js')) fail('CLI tarball is missing bin/pulse.js');
  if (entry.role === 'public-runtime' && !names.includes('package/src/index.d.ts')) fail('Runtime contract tarball is missing TypeScript declarations');
  if (manifest.name === '@pulse-compute/grip' && !names.includes('package/dist/pulsewasm.js')) fail('GRIP tarball is missing the canonical pulsewasm facade');
  if (manifest.name === '@pulse-compute/assets' && !names.includes('package/dist/pulsewasm.js')) fail('Assets tarball is missing the canonical pulsewasm facade');

  const pulseDependencies = [];
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[section] || {})) {
      if (!name.startsWith('@pulse-compute/')) continue;
      if (version !== RELEASE_VERSION) fail(`Packed ${manifest.name} ${section}.${name} must resolve to ${RELEASE_VERSION}, found ${version}`);
      pulseDependencies.push(Object.freeze({ name, section, version }));
    }
  }
  pulseDependencies.sort((a, b) => a.name.localeCompare(b.name) || a.section.localeCompare(b.section));

  const bytes = fs.readFileSync(tarball);
  return Object.freeze({
    name: manifest.name,
    version: manifest.version,
    role: entry.role,
    license: manifest.license,
    legalFiles: Object.freeze([...LEGAL.packageFiles]),
    nodeEngines: manifest.engines.node,
    supportTier: entry.tier,
    documentation: entry.documentation,
    directInstall: entry.directInstall,
    entryPoints: Object.freeze([...entry.entryPoints]),
    stability: entry.stability,
    tarball: path.basename(tarball),
    bytes: bytes.length,
    sha256: sha256(bytes),
    sha512: sha512(bytes),
    integrity: integrity(bytes),
    shasum: sha1(bytes),
    files: names.length,
    pulseDependencies: Object.freeze(pulseDependencies),
  });
}

function packRelease(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const outDir = path.resolve(options.outDir || path.join(repoRoot, '.pulse-release'));
  const packageManagerCache = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-package-manager-'));
  const packageManagerEnv = {
    ...process.env,
    COREPACK_HOME: path.join(packageManagerCache, 'corepack'),
    npm_config_cache: path.join(packageManagerCache, 'npm')
  };
  try {
    validateDocumentationSource({ repoRoot });
    const legalBytes = new Map();
    for (const legalFile of LEGAL.packageFiles) {
      const source = path.join(repoRoot, legalFile);
      if (!fs.existsSync(source)) fail(`Repository ${legalFile} is missing`);
      legalBytes.set(legalFile, fs.readFileSync(source));
    }
    const pnpm = pnpmInvocation(repoRoot);
    if (options.build !== false) run(pnpm.command, [...pnpm.prefix, 'run', '-s', 'build'], { cwd: repoRoot, env: packageManagerEnv, inherit: options.inheritBuild === true, timeout: 300000 });
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const packages = [];
    const documentationArchives = [];
    const stagingRoot = path.join(packageManagerCache, 'staging');
    fs.mkdirSync(stagingRoot, { recursive: true });
    for (const entry of PACKAGE_SET) {
      const sourceManifest = validateSourcePackage(repoRoot, entry);
      const stagedPackage = stagePackageForPack(repoRoot, entry, sourceManifest, stagingRoot);
      const before = new Set(fs.readdirSync(outDir));
      run(pnpm.command, [...pnpm.prefix, '--dir', stagedPackage, 'pack', '--pack-destination', outDir], { cwd: repoRoot, env: packageManagerEnv, timeout: 180000 });
      const created = fs.readdirSync(outDir).filter((name) => name.endsWith('.tgz') && !before.has(name));
      if (created.length !== 1) fail(`Expected one tarball for ${sourceManifest.name}, created ${created.length}`);
      const tarball = path.join(outDir, created[0]);
      const packed = validatePackedPackage(tarball, sourceManifest, entry, legalBytes);
      packages.push(packed);
      documentationArchives.push(Object.freeze({ name: packed.name, tarball, entries: readTarEntries(tarball) }));
    }
    validatePackedDocumentationSet(documentationArchives);

    const names = packages.map((entry) => entry.name);
    if (new Set(names).size !== names.length) fail('Release package names are not unique');
    const packageNames = new Set(names);
    for (const entry of packages) {
      for (const dependency of entry.pulseDependencies) {
        if (!packageNames.has(dependency.name)) fail(`Packed ${entry.name} depends on missing release package ${dependency.name}`);
      }
    }
    const sourceCatalogBytes = fs.readFileSync(RELEASE_MANIFEST_FILE);
    const manifest = Object.freeze({
      schemaVersion: RELEASE_SCHEMA,
      releaseVersion: RELEASE_VERSION,
      channel: RELEASE_MANIFEST.channel,
      releasedAt: RELEASE_MANIFEST.releasedAt,
      legal: LEGAL,
      sourceCatalog: Object.freeze({
        schemaVersion: RELEASE_MANIFEST.schemaVersion,
        path: 'release/pulse-release-manifest.json',
        sha256: sha256(sourceCatalogBytes)
      }),
      documentation: DOCUMENTATION,
      packageCount: packages.length,
      packages: Object.freeze(packages),
    });
    fs.writeFileSync(path.join(outDir, 'pulse-release-manifest.json'), stableJson(manifest));
    fs.writeFileSync(path.join(outDir, 'pulse-source-release-catalog.json'), sourceCatalogBytes);
    return Object.freeze({ repoRoot, outDir, manifest });
  } finally {
    fs.rmSync(packageManagerCache, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const out = { build: true, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--out') { out.outDir = argv[++i]; continue; }
    if (token.startsWith('--out=')) { out.outDir = token.slice(6); continue; }
    if (token === '--skip-build') { out.build = false; continue; }
    if (token === '--json') { out.json = true; continue; }
    if (token === '--help' || token === '-h') { out.help = true; continue; }
    fail(`Unknown pack-release argument: ${token}`);
  }
  return out;
}

function usage() {
  return 'Usage: node scripts/pack-release.cjs [--out <dir>] [--skip-build] [--json]\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage()); return; }
  const result = packRelease(args);
  if (args.json) process.stdout.write(stableJson(result.manifest));
  else {
    process.stdout.write(`Packed ${result.manifest.packageCount} Pulse ${result.manifest.releaseVersion} packages to ${result.outDir}\n`);
    for (const entry of result.manifest.packages) process.stdout.write(`  ${entry.name}@${entry.version} ${entry.tarball} ${entry.sha256} ${entry.integrity}\n`);
  }
}

module.exports = {
  RELEASE_SCHEMA,
  RELEASE_VERSION,
  PACKAGE_SET,
  readTarEntries,
  packRelease,
  validateSourcePackage,
  sha256,
  sha512,
  sha1,
  integrity,
};

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`); process.exitCode = 1; }
}
