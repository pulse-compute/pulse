#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PACKAGE_SET, RELEASE_SCHEMA, RELEASE_VERSION, packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const { DOCUMENTATION, LEGAL, RELEASE_MANIFEST, RELEASE_MANIFEST_FILE } = require('../../../scripts/package-support.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const ownsTempRoot = !process.env.PULSEWASM_TEST_TMP_ROOT;
const tempRoot = process.env.PULSEWASM_TEST_TMP_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-test-'));
if (ownsTempRoot) {
  process.once('exit', () => fs.rmSync(tempRoot, { recursive: true, force: true }));
}
const outDir = path.join(tempRoot, 'packages');
const result = packRelease({ repoRoot, outDir, build: true });

assert.equal(RELEASE_SCHEMA, 'pulse.release-packages.v3');
assert.equal(result.manifest.schemaVersion, RELEASE_SCHEMA);
assert.equal(result.manifest.releaseVersion, RELEASE_VERSION);
assert.equal(result.manifest.channel, RELEASE_MANIFEST.channel);
assert.equal(result.manifest.releasedAt, RELEASE_MANIFEST.releasedAt);
assert.deepEqual(result.manifest.legal, LEGAL);
assert.deepEqual(result.manifest.documentation, DOCUMENTATION);
assert.equal(result.manifest.packageCount, PACKAGE_SET.length);
assert.equal(new Set(result.manifest.packages.map((entry) => entry.name)).size, PACKAGE_SET.length);

const sourceCatalogBytes = fs.readFileSync(RELEASE_MANIFEST_FILE);
const licenseBytes = fs.readFileSync(path.join(repoRoot, 'LICENSE'));
const noticeBytes = fs.readFileSync(path.join(repoRoot, 'NOTICE'));
assert.deepEqual(result.manifest.sourceCatalog, {
  schemaVersion: RELEASE_MANIFEST.schemaVersion,
  path: 'release/pulse-release-manifest.json',
  sha256: crypto.createHash('sha256').update(sourceCatalogBytes).digest('hex')
});
assert.deepEqual(
  fs.readFileSync(path.join(outDir, 'pulse-source-release-catalog.json')),
  sourceCatalogBytes,
  'release output must preserve the exact source catalog used to build the package manifest'
);

const required = [
  '@pulse-compute/pulse',
  '@pulse-compute/runtime',
  '@pulse-compute/cli',
  '@pulse-compute/provider-node',
  '@pulse-compute/provider-fastly',
  '@pulse-compute/grip',
  '@pulse-compute/assets',
  '@pulse-compute/s3'
];
for (const name of required) assert.ok(result.manifest.packages.some((entry) => entry.name === name), `release is missing ${name}`);
for (const name of ['@pulse-compute/api']) assert.equal(result.manifest.packages.some((entry) => entry.name === name), false, `pre-public package ${name} must not be published`);

for (const packed of result.manifest.packages) {
  const catalog = PACKAGE_SET.find((entry) => entry.name === packed.name);
  assert.ok(catalog, `packed package ${packed.name} is missing from the source release catalog`);
  assert.equal(packed.version, RELEASE_VERSION, `${packed.name} version mismatch`);
  assert.equal(packed.license, RELEASE_MANIFEST.license, `${packed.name} license mismatch`);
  assert.deepEqual(packed.legalFiles, LEGAL.packageFiles, `${packed.name} legal-file contract mismatch`);
  assert.equal(packed.nodeEngines, RELEASE_MANIFEST.publication.nodeEngines, `${packed.name} Node engines mismatch`);
  assert.equal(packed.supportTier, catalog.tier, `${packed.name} support tier mismatch`);
  assert.equal(packed.documentation, catalog.documentation, `${packed.name} documentation ownership mismatch`);
  assert.equal(packed.directInstall, catalog.directInstall, `${packed.name} direct-install policy mismatch`);
  assert.deepEqual(packed.entryPoints, catalog.entryPoints, `${packed.name} entry-point policy mismatch`);
  assert.equal(packed.stability, catalog.stability, `${packed.name} stability policy mismatch`);
  assert.match(packed.sha256, /^[a-f0-9]{64}$/);
  assert.match(packed.sha512, /^[a-f0-9]{128}$/);
  assert.match(packed.shasum, /^[a-f0-9]{40}$/);
  assert.equal(packed.integrity, `sha512-${crypto.createHash('sha512').update(fs.readFileSync(path.join(outDir, packed.tarball))).digest('base64')}`);
  assert.ok(packed.bytes > 100, `${packed.name} tarball is unexpectedly small`);
  const tarball = path.join(outDir, packed.tarball);
  const entries = readTarEntries(tarball);
  const manifest = JSON.parse(entries.get('package/package.json').toString('utf8'));
  assert.notEqual(manifest.private, true, `${packed.name} is private`);
  assert.equal(manifest.license, RELEASE_MANIFEST.license, `${packed.name} packed license metadata mismatch`);
  assert.equal(manifest.engines.node, RELEASE_MANIFEST.publication.nodeEngines, `${packed.name} packed Node engines mismatch`);
  assert.deepEqual(entries.get('package/LICENSE'), licenseBytes, `${packed.name} must carry the exact repository LICENSE`);
  assert.deepEqual(entries.get('package/NOTICE'), noticeBytes, `${packed.name} must carry the exact repository NOTICE`);
  assert.deepEqual(LEGAL.packageFiles.every((file) => manifest.files.includes(file)), true, `${packed.name} packed files must declare every legal file`);
  assert.equal(manifest.publishConfig.access, 'public');
  assert.ok(manifest.repository && manifest.repository.url, `${packed.name} must publish repository metadata`);
  assert.ok(manifest.homepage, `${packed.name} must publish homepage metadata`);
  assert.ok(manifest.bugs && manifest.bugs.url, `${packed.name} must publish issue-tracker metadata`);
  assert.equal(JSON.stringify(manifest).includes('workspace:'), false, `${packed.name} retains workspace dependencies`);
  assert.equal([...entries.keys()].some((name) => /^package\/(?:test|tests|docs\/internal)(?:\/|$)/.test(name)), false, `${packed.name} contains repository-only tests/internal docs`);
  for (const dependency of packed.pulseDependencies) {
    assert.equal(dependency.version, RELEASE_VERSION, `${packed.name} dependency ${dependency.name} version mismatch`);
    assert.ok(result.manifest.packages.some((entry) => entry.name === dependency.name), `${packed.name} depends on unpublished ${dependency.name}`);
  }
}

const s3 = result.manifest.packages.find((entry) => entry.name === '@pulse-compute/s3');
assert.equal(s3.supportTier, 'supported-extension');
assert.deepEqual(s3.entryPoints, ['@pulse-compute/s3']);
const s3Entries = readTarEntries(path.join(outDir, s3.tarball));
for (const file of ['src/index.js', 'src/index.d.ts', 'src/provider.js', 'pulse.package.json',
  'pulsewasm.manifest.cjs', 'pulsewasm.compiler.cjs', 'pulsewasm.native.cjs', 'as/read.as.ts', 'conformance/read.json']) {
  assert.ok(s3Entries.has(`package/${file}`), `S3 packed lowering/runtime closure is missing ${file}`);
}
for (const provider of ['@pulse-compute/provider-node', '@pulse-compute/provider-fastly']) {
  assert.ok(result.manifest.packages.find(({ name }) => name === provider).pulseDependencies.some(({ name }) => name === s3.name));
}
const cryptoPackage = result.manifest.packages.find(({ name }) => name === '@pulse-compute/crypto');
assert.ok(readTarEntries(path.join(outDir, cryptoPackage.tarball)).has('package/src/provider.cjs'), 'Crypto byte realization must be packed');

const compiler = result.manifest.packages.find((entry) => entry.name === '@pulse-compute/wasm-compiler');
const compilerEntries = readTarEntries(path.join(outDir, compiler.tarball));
assert.equal([...compilerEntries.keys()].some((name) => /^package\/(?:examples|docs|test|scripts)(?:\/|$)/.test(name)), false, 'compiler package must not ship repository proof material');

const cli = result.manifest.packages.find((entry) => entry.name === '@pulse-compute/cli');
const cliEntries = readTarEntries(path.join(outDir, cli.tarball));
for (const requiredDoc of [
  'package/API.md',
  'package/CHANGELOG.md',
  'package/docs/README.md',
  'package/docs/packages/README.md',
  'package/docs/reference/cli.md',
  'package/docs/reference/project-config.md',
  'package/docs/reference/diagnostics.md',
  'package/docs/reference/shell-completion.md',
  'package/docs/maintainers/release-manifest.md',
  'package/docs/architecture/current-contracts.md',
  'package/docs/maintainers/plugin-readiness.json',
  'package/examples/README.md',
  'package/completions/pulse.bash',
  'package/completions/_pulse',
  'package/completions/pulse.fish',
  'package/cli-spec.json',
  'package/project-config.schema.json',
  'package/release-manifest.json',
  'package/documentation-versions.json',
  'package/src/project-config-schema.js',
  'package/src/project-config-schema.d.ts'
]) assert.ok(cliEntries.has(requiredDoc), `CLI tarball must ship ${requiredDoc.replace(/^package\//, '')}`);
assert.equal(
  [...cliEntries.keys()].some((name) => name.startsWith('package/docs/architecture/decisions/')),
  false,
  'CLI tarball must not ship obsolete numbered decision chronology'
);

const packedReleaseCatalog = JSON.parse(cliEntries.get('package/release-manifest.json').toString('utf8'));
assert.deepEqual(packedReleaseCatalog, RELEASE_MANIFEST, 'CLI package must carry the exact canonical source release catalog');


const fastly = result.manifest.packages.find((entry) => entry.name === '@pulse-compute/provider-fastly');
const fastlyEntries = readTarEntries(path.join(outDir, fastly.tarball));
for (const requiredFile of [
  'package/src/config-schema.js',
  'package/src/config-schema.d.ts',
  'package/src/config-schema.json',
  'package/dist/config-schema.json'
]) assert.ok(fastlyEntries.has(requiredFile), `Fastly tarball must ship ${requiredFile.replace(/^package\//, '')}`);

const runtime = result.manifest.packages.find((entry) => entry.name === '@pulse-compute/runtime');
const runtimeEntries = readTarEntries(path.join(outDir, runtime.tarball));
for (const requiredDoc of ['package/docs/API.md', 'package/docs/preview-scope.md']) {
  assert.ok(runtimeEntries.has(requiredDoc), `runtime tarball must ship ${requiredDoc.replace(/^package\//, '')}`);
}
const packedRuntime = runtimeEntries.get('package/src/index.js').toString('utf8');
const packedRuntimeTypes = runtimeEntries.get('package/src/index.d.ts').toString('utf8');
assert.match(packedRuntime, /class Router/);
assert.match(packedRuntime, /RUNTIME_API_VERSION/);
assert.match(packedRuntime, /ROUTER_API_VERSION/);
assert.doesNotMatch(packedRuntime, /defineHandler/);
assert.match(packedRuntimeTypes, /export declare class Router/);
assert.match(packedRuntimeTypes, /RUNTIME_API_VERSION/);
assert.match(packedRuntimeTypes, /param\(name: string\)/);
assert.doesNotMatch(packedRuntimeTypes, /defineHandler/);

const pulse = result.manifest.packages.find((entry) => entry.name === '@pulse-compute/pulse');
const pulseEntries = readTarEntries(path.join(outDir, pulse.tarball));
for (const requiredFile of [
  'package/src/index.js',
  'package/src/index.d.ts',
  'package/src/schema.js',
  'package/src/schema.d.ts'
]) assert.ok(pulseEntries.has(requiredFile), `Pulse tarball must ship ${requiredFile.replace(/^package\//, '')}`);
assert.equal(pulseEntries.has('package/src/fastly.js'), false, 'Pulse tarball must not contain a provider-specific Fastly bootstrap');
const pulseManifest = JSON.parse(pulseEntries.get('package/package.json').toString('utf8'));
assert.deepEqual(Object.keys(pulseManifest.exports).sort(), ['.', './schema']);
assert.equal(Object.prototype.hasOwnProperty.call(pulseManifest.exports['.'], 'fastly'), false, 'Pulse package root must remain provider-neutral');

assert.equal(fs.existsSync(path.join(repoRoot, 'TREE.txt')), false, 'stale generated TREE.txt must remain deleted');
console.log(`ok - packed ${PACKAGE_SET.length} publishable Pulse ${RELEASE_VERSION} packages from the canonical release catalog with Apache-2.0 licensing, exact NOTICE attribution, Node support metadata, rewritten dependencies, self-contained versioned documentation, and no repository-only payload`);
