#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  RELEASE_VERSION,
  PUBLICATION
} = require('./package-support.cjs');

const repoRoot = path.resolve(__dirname, '..');
const preflightFile = path.join(repoRoot, 'release', 'release-preflight.json');

function fail(message, code = 'PULSE_PRODUCTION_DEPENDENCY_AUDIT_FAILED') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${path.relative(repoRoot, file)} is not valid JSON: ${error.message}`);
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function packageManagerInvocation() {
  const bundled = path.join(repoRoot, '.validation-tools', 'pnpm', 'bin', 'pnpm.cjs');
  if (fs.existsSync(bundled)) return Object.freeze({ command: process.execPath, prefix: Object.freeze([bundled]) });
  return Object.freeze({ command: 'corepack', prefix: Object.freeze([`pnpm@${PUBLICATION.pnpmVersion}`]) });
}

function runJson(args, options = {}) {
  const invocation = packageManagerInvocation();
  const result = spawnSync(invocation.command, [...invocation.prefix, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs || 5 * 60 * 1000
  });
  let document;
  try {
    document = JSON.parse(String(result.stdout || ''));
  } catch (error) {
    fail(`${args.join(' ')} did not return JSON: ${error.message}${result.stderr ? `; ${String(result.stderr).trim()}` : ''}`);
  }
  if (result.error) fail(`${args.join(' ')} failed: ${result.error.message}`);
  if (!options.allowNonZero && result.status !== 0) {
    fail(`${args.join(' ')} failed with exit ${result.status}: ${String(result.stderr || '').trim()}`);
  }
  return Object.freeze({ document, status: result.status, stderr: String(result.stderr || '') });
}

function normalizeLicense(manifest) {
  if (typeof manifest.license === 'string' && manifest.license.trim()) return manifest.license.trim();
  if (Array.isArray(manifest.licenses) && manifest.licenses.length) {
    const values = manifest.licenses.map((entry) => typeof entry === 'string' ? entry : entry && entry.type).filter(Boolean);
    if (values.length === manifest.licenses.length) return values.join(' AND ');
  }
  return null;
}

function summarizeVulnerabilities(document) {
  const values = document && document.metadata && document.metadata.vulnerabilities;
  if (!values || typeof values !== 'object') fail('pnpm audit output lacks metadata.vulnerabilities');
  const severities = {};
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    if (!Number.isInteger(values[severity]) || values[severity] < 0) fail(`pnpm audit ${severity} count is invalid`);
    severities[severity] = values[severity];
  }
  const dependencies = document.metadata.dependencies;
  if (!Number.isInteger(dependencies) || dependencies < 0) fail('pnpm audit dependency count is invalid');
  const advisories = document.advisories && typeof document.advisories === 'object' ? document.advisories : {};
  const total = Object.values(severities).reduce((sum, value) => sum + value, 0);
  return Object.freeze({ dependencies, severities: Object.freeze(severities), advisories: Object.keys(advisories).length, total });
}

function collectProductionPackages(projects, allowedLicenses) {
  if (!Array.isArray(projects)) fail('pnpm recursive production list must be an array');
  const packages = new Map();
  const uninstalledCandidates = new Set();

  function visit(entry) {
    if (!entry || typeof entry !== 'object') return;
    if (typeof entry.resolved === 'string' && typeof entry.path === 'string') {
      const name = String(entry.from || '');
      const version = String(entry.version || '');
      const key = `${name}@${version}`;
      const manifestFile = path.join(entry.path, 'package.json');
      if (!fs.existsSync(manifestFile)) {
        if (!name.startsWith('@esbuild/')) fail(`required production package is not installed: ${key}`);
        uninstalledCandidates.add(key);
      } else if (!packages.has(key)) {
        const manifest = readJson(manifestFile);
        const license = normalizeLicense(manifest);
        packages.set(key, Object.freeze({
          name,
          version,
          license,
          resolved: entry.resolved
        }));
      }
    }
    for (const dependency of Object.values(entry.dependencies || {})) visit(dependency);
    for (const dependency of Object.values(entry.optionalDependencies || {})) visit(dependency);
  }

  for (const project of projects) visit(project);
  const installed = [...packages.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
  const reviewRequired = installed.filter((entry) => !entry.license || !allowedLicenses.has(entry.license));
  const licenseCounts = Object.fromEntries([...new Set(installed.map((entry) => entry.license || 'UNDECLARED'))]
    .sort()
    .map((license) => [license, installed.filter((entry) => (entry.license || 'UNDECLARED') === license).length]));
  return Object.freeze({
    installed: Object.freeze(installed),
    uninstalledCandidates: Object.freeze([...uninstalledCandidates].sort()),
    reviewRequired: Object.freeze(reviewRequired),
    licenseCounts: Object.freeze(licenseCounts)
  });
}

function main() {
  const preflight = readJson(preflightFile);
  const policy = preflight.auditPolicy;
  const vulnerabilityPolicy = policy.vulnerabilities;
  const licensePolicy = policy.dependencyLicenses;
  const checkedAt = new Date().toISOString();
  const releaseManifestSha256 = sha256File(path.join(repoRoot, 'release', 'pulse-release-manifest.json'));

  const vulnerabilityResult = runJson(['audit', '--prod', '--json'], { allowNonZero: true });
  const vulnerabilitySummary = summarizeVulnerabilities(vulnerabilityResult.document);
  const stopShip = vulnerabilityPolicy.stopShipSeverities.some((severity) => vulnerabilitySummary.severities[severity] > 0);
  const dispositionRequired = vulnerabilityPolicy.dispositionRequiredSeverities.some((severity) => vulnerabilitySummary.severities[severity] > 0);
  const vulnerabilityReport = Object.freeze({
    schemaVersion: 'pulse.production-vulnerability-audit.v1',
    status: stopShip ? 'blocked' : dispositionRequired ? 'disposition-required' : 'passed',
    checkedAt,
    releaseVersion: RELEASE_VERSION,
    releaseManifestSha256,
    toolchain: Object.freeze({ pnpmVersion: PUBLICATION.pnpmVersion }),
    summary: vulnerabilitySummary,
    advisories: vulnerabilityResult.document.advisories || {}
  });
  atomicJson(path.join(repoRoot, vulnerabilityPolicy.evidencePath), vulnerabilityReport);
  if (vulnerabilityReport.status !== 'passed') fail(`production vulnerability audit is ${vulnerabilityReport.status}`);

  const listResult = runJson(['--recursive', 'list', '--prod', '--depth', 'Infinity', '--json']);
  const allowedLicenses = new Set(licensePolicy.automaticallyAcceptedSpdx);
  const licenseClosure = collectProductionPackages(listResult.document, allowedLicenses);
  const licenseReport = Object.freeze({
    schemaVersion: 'pulse.production-license-inventory.v1',
    status: licenseClosure.reviewRequired.length ? 'review-required' : 'passed',
    checkedAt,
    releaseVersion: RELEASE_VERSION,
    releaseManifestSha256,
    toolchain: Object.freeze({ pnpmVersion: PUBLICATION.pnpmVersion }),
    summary: Object.freeze({
      installedPackages: licenseClosure.installed.length,
      uninstalledPlatformCandidates: licenseClosure.uninstalledCandidates.length,
      reviewRequired: licenseClosure.reviewRequired.length,
      licenses: licenseClosure.licenseCounts
    }),
    packages: licenseClosure.installed,
    uninstalledPlatformCandidates: licenseClosure.uninstalledCandidates,
    reviewRequired: licenseClosure.reviewRequired,
    noticeDisposition: licensePolicy.noticeDisposition
  });
  atomicJson(path.join(repoRoot, licensePolicy.evidencePath), licenseReport);
  if (licenseReport.status !== 'passed') fail('production dependency license inventory requires human review');

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    vulnerabilityEvidence: vulnerabilityPolicy.evidencePath,
    vulnerabilities: vulnerabilitySummary,
    licenseEvidence: licensePolicy.evidencePath,
    licenses: licenseReport.summary
  }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  normalizeLicense,
  summarizeVulnerabilities,
  collectProductionPackages,
  main
});
