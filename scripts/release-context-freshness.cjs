'use strict';

// A proof owned by source checks, packing and the existing release controller.
// Generation is deliberately absent: the builder only reconstructs in scratch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SCHEMA = 'pulse.release-context-freshness.v1';
const QUALIFICATION = 'pulse.release-context-qualification.v1';
const PROJECT = 'examples/12-pulse-context-mcp';
const PREFIX = `package/${PROJECT}/`;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint = value => hash(JSON.stringify(value));
function selections() {
  return { release: require('../wasm/test/suite/registry.cjs').expandProfile('release'),
    features: [...require('./release-feature-acceptance.cjs').REQUIRED_TASKS] };
}
function inventory(root) {
  const builder = require('./pulse-context-build.cjs');
  const files = [];
  function walk(relative) {
    const file = builder.safePath(root, `wasm/packages/cli/${PROJECT}/${relative}`);
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) walk(relative ? `${relative}/${name}` : name);
    } else {
      assert(stat.isFile(), 'Context package input must be a regular file');
      const bytes = fs.readFileSync(file);
      files.push({ path: relative, byteLength: bytes.length, sha256: hash(bytes) });
    }
  }
  for (const name of fs.readdirSync(path.join(root, `wasm/packages/cli/${PROJECT}`)).sort()) walk(name);
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
function check(root, candidate) {
  const builder = require('./pulse-context-build.cjs');
  const reconstruction = builder.run({ root, write: false });
  const manifestText = fs.readFileSync(builder.safePath(root, builder.MANIFEST), 'utf8');
  const receipt = { schemaVersion: SCHEMA, candidate, reconstruction, manifestText,
    selections: selections(), files: inventory(root) };
  validate(receipt, candidate);
  return receipt;
}
function validate(receipt, candidate) {
  assert.equal(receipt?.schemaVersion, SCHEMA, 'Missing context freshness receipt');
  assert.deepEqual(receipt.candidate, candidate, 'Context freshness candidate differs');
  assert.match(candidate?.sourceRevision || '', /^[a-f0-9]{40}$/);
  assert.match(candidate?.sourceTree || '', /^[a-f0-9]{40}$/);
  assert.equal(candidate.workingTree, '', 'Context freshness requires clean source');
  const proof = receipt.reconstruction;
  assert.equal(proof?.schemaVersion, 'pulse.context-build-receipt.v1');
  assert.equal(proof.status, 'ok');
  assert.equal(proof.mode, 'check', 'Context freshness must be read-only reconstruction');
  assert.equal(proof.changedFiles, 0, 'Context freshness cannot repair the candidate');
  assert.equal(hash(receipt.manifestText), proof.manifestSha256, 'Context manifest digest differs');
  const manifest = JSON.parse(receipt.manifestText);
  assert.equal(manifest.schemaVersion, 'pulse.context-build-manifest.v1');
  assert.equal(manifest.source.corpusHash, proof.corpusHash, 'Context corpus identity differs');
  assert.equal(manifest.producer.node, proof.pinnedProducerNode, 'Context producer differs');
  assert.deepEqual(manifest.dimensions, proof.dimensions, 'Context dimensions differ');
  for (const item of [...manifest.producer.sources, manifest.producer.config, manifest.producer.allowlist,
    manifest.producer.lockfile, ...manifest.outputs]) {
    assert.match(item.sha256 || '', /^[a-f0-9]{64}$/, 'Missing context input/output identity');
    assert(Number.isSafeInteger(item.byteLength) && item.byteLength >= 0);
  }
  assert.deepEqual(receipt.selections, selections(), 'Context freshness task selection differs');
  const files = receipt.files;
  assert(Array.isArray(files) && files.length > 0, 'Missing context packed inventory');
  assert.equal(new Set(files.map(file => file.path)).size, files.length, 'Duplicate context packed path');
  for (const file of files) {
    assert(typeof file.path === 'string' && !file.path.includes('\\') && !file.path.startsWith('/')
      && file.path.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid context packed path');
    assert.match(file.sha256 || '', /^[a-f0-9]{64}$/);
    assert(Number.isSafeInteger(file.byteLength) && file.byteLength >= 0);
  }
  for (const output of [...manifest.outputs, { path: 'context-data/context-manifest.json',
    byteLength: Buffer.byteLength(receipt.manifestText), sha256: proof.manifestSha256 }]) {
    assert.deepEqual(files.find(file => file.path === output.path), output, `Context output inventory differs: ${output.path}`);
  }
  assert.equal(proof.comparedFiles, (manifest.outputs.length + 1) * 2, 'Incomplete context reconstruction');
  return receipt;
}
function verifyPacked(receipt, entries) {
  validate(receipt, receipt.candidate);
  const names = [...entries.keys()].filter(name => name.startsWith(PREFIX) && !name.endsWith('/')).sort();
  assert.deepEqual(names, receipt.files.map(file => PREFIX + file.path).sort(), 'Packed context inventory differs');
  for (const file of receipt.files) {
    const bytes = entries.get(PREFIX + file.path);
    assert.equal(bytes.length, file.byteLength, `Packed context length differs: ${file.path}`);
    assert.equal(hash(bytes), file.sha256, `Packed context digest differs: ${file.path}`);
  }
  return { schemaVersion: 'pulse.release-context-pack.v1', freshnessSha256: fingerprint(receipt),
    files: receipt.files };
}
function validatePack(receipt, manifest) {
  validate(receipt, receipt.candidate);
  assert.equal(manifest?.context?.schemaVersion, 'pulse.release-context-pack.v1', 'Missing packed context proof');
  assert.equal(manifest.context.freshnessSha256, fingerprint(receipt), 'Packed context freshness differs');
  assert.deepEqual(manifest.context.files, receipt.files, 'Packed context files differ');
  const { PACKAGE_SET, RELEASE_VERSION } = require('./package-support.cjs');
  assert.deepEqual(manifest.packages.map(p => p.name).sort(), PACKAGE_SET.map(p => p.name).sort(), 'Packed closure differs');
  for (const item of manifest.packages) {
    assert.equal(item.version, RELEASE_VERSION);
    assert.match(item.sha256 || '', /^[a-f0-9]{64}$/, 'Missing packed tarball hash');
  }
}
function qualify(sourceChecks, manifest, featureTasks, featureAcceptance) {
  require('./release-source-checks.cjs').assertPackageSourceChecks(sourceChecks);
  const freshness = sourceChecks.contextFreshness;
  validatePack(freshness, manifest);
  require('./maintainer-portable-validation.cjs').validateReport(featureTasks, freshness.selections.features,
    freshness.candidate.sourceRevision);
  require('./release-feature-acceptance.cjs').validateSummary(featureAcceptance, freshness.candidate.sourceRevision);
  assert.equal(featureAcceptance.sourceTree, freshness.candidate.sourceTree, 'Installed context tree differs');
  const packages = new Map(manifest.packages.map(item => [item.name, item]));
  for (const gate of featureAcceptance.gates) for (const installed of gate.packages) {
    assert.equal(installed.sha256, packages.get(installed.name)?.sha256, `Installed tarball differs from pre-pack proof: ${installed.name}`);
  }
  const mcp = featureAcceptance.gates.find(gate => gate.task === 'mcp-installed');
  for (const name of ['@pulse-compute/cli', '@pulse-compute/mcp']) {
    assert(mcp.packages.some(item => item.name === name), `Missing MCP installed package: ${name}`);
  }
  return { schemaVersion: QUALIFICATION, candidate: freshness.candidate,
    freshnessSha256: fingerprint(freshness), packManifestSha256: fingerprint(manifest),
    selectedTasks: featureTasks.selectedTasks, installedReportSha256: mcp.reportSha256,
    featureTasksSha256: fingerprint(featureTasks), featureAcceptanceSha256: fingerprint(featureAcceptance) };
}
function assertQualification(seal, sourceChecks, manifest, featureTasks) {
  const expected = qualify(sourceChecks, manifest, featureTasks, seal.featureAcceptance);
  assert.deepEqual(seal.contextQualification, expected, 'Missing or mismatched context qualification');
  assert.equal(seal.sourceRevision, expected.candidate.sourceRevision, 'Context qualification source differs');
  return expected;
}
// Read retained evidence only. Never reconstruct or regenerate after sealing.
function verifySeal(seal) {
  assert(seal.contextQualification && seal.contextEvidence && seal.sourceChecks, 'Missing context qualification evidence');
  const bytes = fs.readFileSync(seal.sourceChecks.file);
  assert.equal(hash(bytes), seal.sourceChecks.sha256, 'Sealed source-check receipt changed');
  const sourceChecks = JSON.parse(bytes);
  const manifest = JSON.parse(fs.readFileSync(seal.contextEvidence.packManifest, 'utf8'));
  const featureBytes = fs.readFileSync(seal.contextEvidence.featureTasks);
  assert.equal(hash(featureBytes), seal.featureAcceptance.runnerReportSha256, 'Installed runner bytes changed');
  const qualification = assertQualification(seal, sourceChecks, manifest, JSON.parse(featureBytes));
  const directory = path.dirname(seal.contextEvidence.packManifest);
  const pack = require('./pack-release.cjs');
  for (const item of manifest.packages) {
    assert(typeof item.tarball === 'string' && path.basename(item.tarball) === item.tarball, 'Invalid sealed tarball path');
    assert.equal(hash(fs.readFileSync(path.join(directory, item.tarball))), item.sha256, 'Sealed tarball changed');
  }
  const cli = manifest.packages.find(item => item.name === '@pulse-compute/cli');
  verifyPacked(sourceChecks.contextFreshness, pack.readTarEntries(path.join(directory, cli.tarball)));
  return qualification;
}
module.exports = { SCHEMA, QUALIFICATION, hash, fingerprint, selections, check, validate, verifyPacked, validatePack, qualify, assertQualification, verifySeal };
