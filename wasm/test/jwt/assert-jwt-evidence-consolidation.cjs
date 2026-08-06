#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const REPORT_VERSION = 'pulse.jwt-evidence-consolidation.f0.v1';
const CANDIDATE_VERSION = 'pulse.jwt-crypto-working-candidate.v1';
const CANDIDATE_FILE =
  'wasm/test/jwt/contracts/jwt-crypto-working-candidate.json';

const JSON_EVIDENCE = Object.freeze([
  Object.freeze({
    checkpoint: 'A1',
    file: 'wasm/.test-results/guest-link-a1/guest-link-poc-report.json',
    version: 'pulse.guest-link-poc.scalar-control.v1',
  }),
  Object.freeze({
    checkpoint: 'A2',
    file: 'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
    version: 'pulse.guest-link-poc.memory.v1',
  }),
  Object.freeze({
    checkpoint: 'A3',
    file: 'wasm/.test-results/guest-link-a3/guest-link-poc-final-audit.json',
    version: 'pulse.guest-link-poc.final-audit.v1',
  }),
  Object.freeze({
    checkpoint: 'B0',
    file: 'wasm/.test-results/guest-link-b0/guest-link-contract-design.json',
    version: 'pulse.guest-link-contract-design-evidence.v1',
  }),
  Object.freeze({
    checkpoint: 'B1',
    file: 'wasm/.test-results/guest-link-b1/guest-link-package-report.json',
    version: 'pulse.guest-link-package-evidence.v1',
  }),
  Object.freeze({
    checkpoint: 'B1-audit',
    file: 'wasm/.test-results/guest-link-b1/final-wasm-audit.json',
    version: 'pulse.final-wasm-audit.v1',
  }),
  Object.freeze({
    checkpoint: 'B2',
    file: 'wasm/.test-results/guest-link-b2/guest-unit-materialization-proof.json',
    version: 'pulse.guest-unit-materialization-proof.v1',
  }),
  Object.freeze({
    checkpoint: 'B3',
    file: 'wasm/.test-results/guest-link-b3/guest-link-audit-diagnostics-proof.json',
    version: 'pulse.guest-link-audit-diagnostics-proof.v1',
  }),
  Object.freeze({
    checkpoint: 'B4',
    file: 'wasm/.test-results/guest-link-b4/phase-b-seal.json',
    version: 'pulse.guest-link.phase-b-seal.v1',
  }),
  Object.freeze({
    checkpoint: 'C4',
    file: 'wasm/.test-results/crypto-c4/phase-c-seal.json',
    version: 'pulse.crypto.phase-c-seal.v1',
  }),
  Object.freeze({
    checkpoint: 'D4',
    file: 'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json',
    version: 'pulse.jwt-phase-d-seal.v1',
  }),
  Object.freeze({
    checkpoint: 'E4',
    file: 'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
    version: 'pulse.jwt-phase-e-seal.v1',
  }),
]);

const PRESERVED_ARTIFACTS = Object.freeze([
  Object.freeze({
    file: 'wasm/.test-results/guest-link-a2/candidate-memory-owner.wasm',
    bytes: 26,
    sha256: '26af409614f556104522d4d6859237908703bf044fb3e230dc53426d6736ccc0',
  }),
  Object.freeze({
    file: 'wasm/.test-results/guest-link-a2/candidate-guest.wasm',
    bytes: 344,
    sha256: 'd92d3b3496debbfd13ec1657efe9eac62ce44580cb1e4f439fc80232d346da2c',
  }),
  Object.freeze({
    file: 'wasm/.test-results/guest-link-a3/guest-link-poc-final.wasm',
    bytes: 1461,
    sha256: 'c9f3fbcdb0cd2ffe3a6d9cc7446802ab2a99cd3b65120c4fcf8482f15544dc1d',
  }),
  Object.freeze({
    file: 'wasm/.test-results/guest-link-b1/canonical-native.wasm',
    bytes: 1461,
    sha256: 'c9f3fbcdb0cd2ffe3a6d9cc7446802ab2a99cd3b65120c4fcf8482f15544dc1d',
  }),
]);

const CURRENT_DOCUMENTS = Object.freeze([
  Object.freeze({
    file: 'docs/README.md',
    required: Object.freeze([
      'frozen `1.0.0-beta.1` release catalog',
      'unpublished `1.0.0-beta.1` JWT/crypto working candidate',
    ]),
    forbidden: Object.freeze([]),
  }),
  Object.freeze({
    file: 'docs/architecture/current-contracts.md',
    required: Object.freeze([
      '## JWT verification working candidate',
      'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
      'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json',
    ]),
    forbidden: Object.freeze([
      '`@pulse-compute/jwt` has not been integrated',
      'JWT composition and synchronized `1.0.0-beta.1` release promotion remain Phase D work',
    ]),
  }),
  Object.freeze({
    file: 'docs/reference/compatibility-matrix.md',
    required: Object.freeze([
      '## Unpublished 0.2 JWT and crypto candidate',
      '| JWT verification | HS256 | HS256 | HS256 | HS256 |',
      'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
    ]),
    forbidden: Object.freeze([
      '| JWT composition | Deferred | Deferred | Deferred | Deferred |',
    ]),
  }),
  Object.freeze({
    file: 'packages/jwt/README.md',
    required: Object.freeze([
      'HS256',
      '@pulse-compute/crypto',
      'four required target cells',
      'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
    ]),
    forbidden: Object.freeze([
      'package-owned `jose` verifier',
      "algorithms: ['RS256']",
      'Fastly remains explicit and fail-closed',
    ]),
  }),
  Object.freeze({
    file: 'packages/crypto/README.md',
    required: Object.freeze([
      '## JWT composition',
      '@pulse-compute/jwt',
      'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json',
    ]),
    forbidden: Object.freeze([
      'JWT is deliberately not integrated in Phase C',
    ]),
  }),
  Object.freeze({
    file: 'docs/concepts/package-owned-lowering.md',
    required: Object.freeze([
      'unpublished JWT/crypto `1.0.0-beta.1` working candidate',
      'jwt.verify',
    ]),
    forbidden: Object.freeze([]),
  }),
  Object.freeze({
    file: 'docs/contributing/package-lowerer-contract.md',
    required: Object.freeze([
      'frozen `1.0.0-beta.1` release',
      'unpublished JWT/crypto',
      'packages/jwt/pulsewasm.manifest.cjs',
    ]),
    forbidden: Object.freeze([]),
  }),
  Object.freeze({
    file: 'wasm/packages/wasm-guest-link/README.md',
    required: Object.freeze([
      '## JWT/crypto proof relationship',
      'not load-bearing',
      'HS256',
      'wasm/.test-results/guest-link-b4/phase-b-seal.json',
    ]),
    forbidden: Object.freeze([]),
  }),
  Object.freeze({
    file: 'wasm/test/jwt/README.md',
    required: Object.freeze([
      '## F0 Evidence consolidation',
      'wasm/test/jwt/contracts/jwt-crypto-working-candidate.json',
      'wasm/.test-results/jwt-f0/jwt-f0-evidence-consolidation.json',
    ]),
    forbidden: Object.freeze([]),
  }),
]);

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-f0');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT F0 option: ${argv[index]}`);
    }
    outputDirectory = path.resolve(repoRoot, argv[++index]);
  }
  return Object.freeze({ outputDirectory });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(relativeFile) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8'));
}

function fileRecord(relativeFile) {
  const bytes = fs.readFileSync(path.join(repoRoot, relativeFile));
  return Object.freeze({
    file: relativeFile.replace(/\\/g, '/'),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}

function runStage(id, command, args, timeoutMs = 600_000) {
  process.stdout.write(`f0 - ${id}\n`);
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    shell: false,
  });
  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  if (result.error || result.status !== 0) {
    throw new Error(
      `${id} failed${result.status === null ? '' : ` with status ${result.status}`}` +
      `\n${String(result.stdout || '')}${String(result.stderr || '')}`,
      { cause: result.error },
    );
  }
  return Object.freeze({ id, status: 'passed', durationMs });
}

function assertEvidence() {
  const records = JSON_EVIDENCE.map((spec) => {
    const report = readJson(spec.file);
    assert.equal(report.version, spec.version, spec.file);
    assert.equal(report.status, 'passed', spec.file);
    return Object.freeze({ checkpoint: spec.checkpoint, ...fileRecord(spec.file) });
  });

  const decisionFile =
    'wasm/.test-results/guest-link-a4/guest-link-poc-decision.md';
  const decision = fs.readFileSync(path.join(repoRoot, decisionFile), 'utf8');
  assert.match(decision, /\*\*Decision:\*\* \*\*PASS\*\*/);
  for (const record of records.slice(0, 3)) {
    assert.ok(decision.includes(record.sha256), `${record.checkpoint} decision hash`);
  }

  const e4Evidence = readJson(
    'wasm/.test-results/jwt-e4/jwt-e4-evidence.json',
  );
  for (const reference of Object.values(e4Evidence.reports)) {
    const actual = fileRecord(reference.file);
    assert.equal(actual.sha256, reference.sha256, reference.file);
    if (reference.bytes !== undefined) {
      assert.equal(actual.bytes, reference.bytes, reference.file);
    }
  }

  return Object.freeze({
    status: 'passed',
    checkpoints: Object.freeze(records),
    phaseADecision: fileRecord(decisionFile),
    e4ReportReferences: Object.freeze(
      Object.keys(e4Evidence.reports).sort(),
    ),
  });
}

function assertArtifacts() {
  const records = PRESERVED_ARTIFACTS.map((expected) => {
    const actual = fileRecord(expected.file);
    assert.equal(actual.bytes, expected.bytes, expected.file);
    assert.equal(actual.sha256, expected.sha256, expected.file);
    return actual;
  });
  assert.equal(records[2].sha256, records[3].sha256);
  return Object.freeze({
    status: 'passed',
    records: Object.freeze(records),
    sealedFinalCoreReproduced: true,
  });
}

function assertCandidate() {
  const candidate = readJson(CANDIDATE_FILE);
  assert.equal(candidate.schemaVersion, CANDIDATE_VERSION);
  assert.equal(candidate.candidateVersion, '1.0.0-beta.1');
  assert.equal(candidate.status, 'unpublished');
  assert.deepEqual(
    candidate.packages.map((entry) => entry.name),
    ['@pulse-compute/crypto', '@pulse-compute/jwt'],
  );
  for (const entry of candidate.packages) {
    const manifest = readJson(`${entry.dir}/package.json`);
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, entry.manifestVersion);
    assert.equal(entry.manifestVersion, candidate.candidateVersion);
    for (const dependency of entry.pulseDependencies) {
      assert.equal(
        manifest[dependency.section][dependency.name],
        dependency.range,
        `${entry.name} -> ${dependency.name}`,
      );
    }
  }
  for (const entry of candidate.integrationInputs) {
    const manifest = readJson(`${entry.dir}/package.json`);
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, entry.manifestVersion);
  }
  const releaseRecord = fileRecord(candidate.frozenRelease.manifest);
  const release = readJson(candidate.frozenRelease.manifest);
  assert.equal(releaseRecord.sha256, candidate.frozenRelease.sha256);
  assert.equal(release.releaseVersion, candidate.frozenRelease.releaseVersion);
  assert.equal(release.releaseVersion, '1.0.0-beta.1');
  assert.equal(
    release.packages.some((entry) =>
      candidate.packages.some((candidateEntry) => candidateEntry.name === entry.name)),
    false,
  );
  assert.ok(Object.values(candidate.boundaries).every((value) =>
    typeof value === 'boolean'));
  assert.equal(candidate.boundaries.candidatePackagesSynchronized, true);
  for (const boundary of [
    'providerVersionsPromoted',
    'releaseCatalogPromoted',
    'npmPublication',
    'documentationPromotion',
    'remoteDeployment',
    'providerActivation',
    'guestLinkRequiredForHs256',
    'asymmetricImplementation',
    'automaticFallback',
  ]) {
    assert.equal(candidate.boundaries[boundary], false, boundary);
  }
  return Object.freeze({
    status: 'passed',
    contract: fileRecord(CANDIDATE_FILE),
    candidateVersion: candidate.candidateVersion,
    candidatePackages: Object.freeze(candidate.packages.map((entry) => entry.name)),
    integrationInputs: Object.freeze(
      candidate.integrationInputs.map((entry) =>
        Object.freeze({ name: entry.name, relationship: entry.relationship })),
    ),
    frozenRelease: releaseRecord,
  });
}

function assertCurrentDocuments() {
  return Object.freeze({
    status: 'passed',
    documents: Object.freeze(CURRENT_DOCUMENTS.map((contract) => {
      const source = fs.readFileSync(path.join(repoRoot, contract.file), 'utf8');
      for (const marker of contract.required) {
        assert.ok(source.includes(marker), `${contract.file} is missing ${marker}`);
      }
      for (const marker of contract.forbidden) {
        assert.equal(
          source.includes(marker),
          false,
          `${contract.file} retains ${marker}`,
        );
      }
      return fileRecord(contract.file);
    })),
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = assertEvidence();
  const artifacts = assertArtifacts();
  const candidate = assertCandidate();
  const documentation = assertCurrentDocuments();
  const validations = Object.freeze([
    runStage('suite-shape', process.execPath, [
      'wasm/test/suite/assert-suite-shape.cjs',
    ]),
    runStage('maintainer-control-plane', 'npm', ['run', 'maintainer:check']),
    runStage('documentation-snippets-and-site', 'npm', ['run', 'docs:check']),
    runStage('documentation-contracts', process.execPath, [
      'scripts/documentation-release.cjs',
    ]),
  ]);
  const report = Object.freeze({
    version: REPORT_VERSION,
    checkpoint: 'F0',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    scope: 'evidence-and-current-contract-consolidation',
    evidence,
    preservedArtifacts: artifacts,
    workingCandidate: candidate,
    documentation,
    validations,
    boundaries: Object.freeze({
      historicalReleasePreserved: true,
      workingCandidatePublished: false,
      npmPublication: false,
      documentationPromotion: false,
      remoteDeployment: false,
      providerActivation: false,
      asymmetricImplementation: false,
    }),
    nextAuthorizedCheckpoint: 'F1',
  });
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const outputFile = path.join(
    options.outputDirectory,
    'jwt-f0-evidence-consolidation.json',
  );
  fs.writeFileSync(outputFile, stableJson(report));
  process.stdout.write(
    `ok - F0 consolidated ${evidence.checkpoints.length + 1} A-E records, ` +
    `${artifacts.records.length} preserved artifacts, and ` +
    `${documentation.documents.length} current contracts\n`,
  );
}

main();
