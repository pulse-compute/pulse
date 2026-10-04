#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { validateReport } = require('./maintainer-portable-validation.cjs');
const { RELEASE_VERSION, PACKAGE_SET } = require('./package-support.cjs');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA = 'pulse.release-feature-acceptance.v1';
const GATES = Object.freeze([
  // Check the combined Native rejection seam before the long JWT workflows.
  { task: 'str02b-installed', feature: 'Node Native request-body forwarding' },
  { task: 'node01-installed', feature: 'Finite production Node HTTP launcher' },
  { task: 'arc01-installed', feature: 'Package-owned execution and provider loading' },
  { task: 'jwt-installed-workflow', feature: 'JWT signing, verification, cleanup and eligibility' },
  { task: 'str02-installed', feature: 'Node JavaScript request-body forwarding' },
  { task: 'str03b-installed', feature: 'Experimental Node generated output; no support promotion' },
  { task: 'ast01-installed', feature: 'Assets signing facade' },
  { task: 'ast02b-installed', feature: 'JavaScript embedded Assets bytes' },
  { task: 'ast02d-installed', feature: 'Native embedded Assets bytes' },
  { task: 's3-body-installed', feature: 'S3 opaque binary bodies on advertised target cells' }
].map(Object.freeze));
const REQUIRED_TASKS = Object.freeze(GATES.map(gate => gate.task));
const SEPARATE_GATES = Object.freeze([
  { task: 'str03c-bounded-transforms', classification: 'experimental', disposition: 'Workspace evidence only; installed transform qualification pending' },
  { task: 'mcp-installed', classification: 'private', disposition: 'Explicit private adapter coverage; outside npm publication' },
  { task: 'kv-conditional-acceptance', classification: 'external-required', disposition: 'Separate mandatory local K4 gate plus deployed Pulse cross-location evidence; B6-05' }
].map(Object.freeze));

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const EMPTY_DIFF = digest(Buffer.alloc(0));
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
}
function candidateIdentity(root = ROOT) {
  const workingTree = git(root, ['status', '--porcelain', '--untracked-files=all']);
  assert.equal(workingTree, '', 'Feature acceptance requires a clean candidate checkout');
  return { sourceRevision: git(root, ['rev-parse', 'HEAD']), sourceTree: git(root, ['rev-parse', 'HEAD^{tree}']), workingTree };
}

function validateCoverage(tasks, expandProfile) {
  const release = expandProfile('release');
  for (const task of REQUIRED_TASKS) {
    assert(tasks[task], `Missing installed feature gate: ${task}`);
    assert(!release.includes(task), `Installed gate must remain separate from aggregate profile: ${task}`);
  }
  for (const gate of SEPARATE_GATES) assert(tasks[gate.task], `Missing separate gate: ${gate.task}`);
  for (const task of ['shared-stage-o19', 'str02b-node-native', 'str03a-generated-output', 'str03c-bounded-transforms']) {
    assert(release.includes(task), `Combined profile lost cross-lane task: ${task}`);
  }
}

function installedPackages(report) {
  return report.packages || report.installed?.packages || Object.values(report.cells || {}).flatMap(cell => cell.installed?.packages || []);
}

function validateAcceptance(runner, reports, identity) {
  validateReport(runner, REQUIRED_TASKS, identity.sourceRevision);
  assert.match(identity.sourceTree, /^[a-f0-9]{40}$/, 'Missing candidate tree');
  assert.equal(identity.workingTree, '', 'Candidate must be clean');
  assert.deepEqual(Object.keys(reports).sort(), [...REQUIRED_TASKS].sort(), 'Installed reports differ from gate set');
  const known = new Map(PACKAGE_SET.map(entry => [entry.name, entry]));
  const packageHashes = new Map();
  const gates = GATES.map(gate => {
    const report = reports[gate.task];
    assert.equal(report.status, 'passed', `Installed proof not passing: ${gate.task}`);
    assert.equal(report.source, identity.sourceRevision, `Installed proof from another candidate: ${gate.task}`);
    if (report.sourceTree !== undefined) assert.equal(report.sourceTree, identity.sourceTree, `Installed proof tree differs: ${gate.task}`);
    assert.equal(report.workingTree, '', `Installed proof has dirty source: ${gate.task}`);
    assert.equal(report.workingDiffSha256 || report.diffSha256, EMPTY_DIFF, `Installed proof diff differs: ${gate.task}`);
    assert.match(report.acceptanceScriptSha256 || report.scriptSha256 || '', /^[a-f0-9]{64}$/, `Missing oracle identity: ${gate.task}`);
    const packages = installedPackages(report);
    assert(packages.length > 0, `Missing installed tarball identities: ${gate.task}`);
    for (const item of packages) {
      assert(known.has(item.name), `Non-published package in public feature acceptance: ${item.name}`);
      assert.equal(item.version, RELEASE_VERSION, `Mixed installed version: ${item.name}`);
      assert.match(item.sha256 || '', /^[a-f0-9]{64}$/, `Missing tarball hash: ${item.name}`);
      if (packageHashes.has(item.name)) assert.equal(item.sha256, packageHashes.get(item.name), `Mixed candidate tarball: ${item.name}`);
      packageHashes.set(item.name, item.sha256);
    }
    return { ...gate, classification: 'required-feature', status: 'passed', reportSha256: digest(JSON.stringify(report)), packages };
  });
  return { schemaVersion: SCHEMA, ...identity, status: 'passed', gates, separateGates: SEPARATE_GATES,
    providerRealityValidated: false, deploymentPerformed: false, publicationPerformed: false };
}

function validateSummary(report, sourceRevision) {
  assert.equal(report?.schemaVersion, SCHEMA, 'Missing installed feature acceptance');
  assert.equal(report.status, 'passed', 'Installed feature acceptance did not pass');
  assert.equal(report.sourceRevision, sourceRevision, 'Installed features belong to another source');
  assert.match(report.sourceTree || '', /^[a-f0-9]{40}$/, 'Missing installed feature tree');
  assert.equal(report.workingTree, '', 'Installed features require clean source');
  assert.deepEqual(report.gates.map(gate => gate.task), REQUIRED_TASKS, 'Incomplete installed feature gates');
  const known = new Set(PACKAGE_SET.map(item => item.name));
  const packageHashes = new Map();
  for (const gate of report.gates) {
    assert.equal(gate.status, 'passed', `Installed feature did not pass: ${gate.task}`);
    assert.match(gate.reportSha256 || '', /^[a-f0-9]{64}$/, 'Missing installed report digest');
    assert(gate.packages.length > 0, 'Missing installed package identities');
    for (const item of gate.packages) {
      assert(known.has(item.name), `Non-published installed package: ${item.name}`);
      assert.equal(item.version, RELEASE_VERSION, `Mixed installed version: ${item.name}`);
      assert.match(item.sha256 || '', /^[a-f0-9]{64}$/, `Missing installed tarball digest: ${item.name}`);
      if (packageHashes.has(item.name)) assert.equal(item.sha256, packageHashes.get(item.name), `Mixed installed tarball: ${item.name}`);
      packageHashes.set(item.name, item.sha256);
    }
  }
  return report;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

function main(argv = process.argv.slice(2)) {
  assert.equal(argv.length, 0, 'Usage: node scripts/release-feature-acceptance.cjs');
  const { tasks, expandProfile } = require('../wasm/test/suite/registry.cjs');
  validateCoverage(tasks, expandProfile);
  const identity = candidateIdentity();
  const parent = path.join(ROOT, 'wasm/.test-results');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'release-features-'));
  const installedDir = path.join(directory, 'installed');
  const runnerFile = path.join(directory, 'tasks.json');
  const reportFile = path.join(parent, 'release-feature-acceptance.json');
  const startedAt = new Date().toISOString();
  writeJson(reportFile, { schemaVersion: SCHEMA, ...identity, status: 'running', startedAt, directory });
  try {
    const result = spawnSync(process.execPath, ['wasm/scripts/run-wasm-tests.cjs', ...REQUIRED_TASKS.flatMap(task => ['--task', task]), '--report', runnerFile], {
      cwd: ROOT, stdio: 'inherit', timeout: 60 * 60 * 1000,
      env: { ...process.env, PULSE_SOURCE_REVISION: identity.sourceRevision, PULSE_SOURCE_IDENTITY_KIND: 'git-commit',
        PULSE_SOURCE_DIGEST_SHA256: '', PULSE_SOURCE_FILE_COUNT: '', PULSE_RELEASE_FEATURE_REPORT_DIR: installedDir }
    });
    assert(!result.error && result.status === 0, `Installed feature replay failed: ${result.error?.message || result.status}`);
    assert.deepEqual(candidateIdentity(), identity, 'Source changed during installed acceptance');
    const reports = Object.fromEntries(REQUIRED_TASKS.map(task => [task, JSON.parse(fs.readFileSync(path.join(installedDir, `${task}.json`), 'utf8'))]));
    const accepted = validateAcceptance(JSON.parse(fs.readFileSync(runnerFile, 'utf8')), reports, identity);
    const report = { ...accepted, startedAt, completedAt: new Date().toISOString(), directory,
      runnerReportSha256: digest(fs.readFileSync(runnerFile)) };
    writeJson(reportFile, report);
    console.log(`Installed feature acceptance passed: ${GATES.length} gates; report ${reportFile}`);
    return report;
  } catch (error) {
    writeJson(reportFile, { schemaVersion: SCHEMA, ...identity, status: 'failed', startedAt,
      completedAt: new Date().toISOString(), directory, error: error.message });
    throw error;
  }
}

module.exports = { SCHEMA, GATES, REQUIRED_TASKS, SEPARATE_GATES, candidateIdentity, validateCoverage, validateAcceptance, validateSummary, main };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
