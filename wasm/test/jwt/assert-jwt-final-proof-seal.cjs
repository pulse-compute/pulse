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

const SEAL_VERSION = 'pulse.jwt-final-proof-seal.f4.v1';
const MANIFEST_VERSION = 'pulse.jwt-proof-artifact-manifest.f4.v1';
const EVIDENCE_VERSION = 'pulse.jwt-f4-evidence.v1';

const ARTIFACT_DIRECTORIES = Object.freeze([
  'wasm/.test-results/guest-link-a1',
  'wasm/.test-results/guest-link-a2',
  'wasm/.test-results/guest-link-a3',
  'wasm/.test-results/guest-link-a4',
  'wasm/.test-results/guest-link-b0',
  'wasm/.test-results/guest-link-b1',
  'wasm/.test-results/guest-link-b2',
  'wasm/.test-results/guest-link-b3',
  'wasm/.test-results/guest-link-b4',
  'wasm/.test-results/crypto-c4',
  'wasm/.test-results/jwt-d0',
  'wasm/.test-results/jwt-d1',
  'wasm/.test-results/jwt-d2',
  'wasm/.test-results/jwt-d3',
  'wasm/.test-results/jwt-d4',
  'wasm/.test-results/jwt-e0',
  'wasm/.test-results/jwt-e1',
  'wasm/.test-results/jwt-e2',
  'wasm/.test-results/jwt-e3',
  'wasm/.test-results/jwt-e4',
  'wasm/.test-results/jwt-f0',
  'wasm/.test-results/jwt-f1',
  'wasm/.test-results/jwt-f2',
  'wasm/.test-results/jwt-f3',
]);

const CHECKPOINT_REPORTS = Object.freeze([
  Object.freeze({
    checkpoint: 'A1',
    file: 'wasm/.test-results/guest-link-a1/guest-link-poc-report.json',
  }),
  Object.freeze({
    checkpoint: 'A2',
    file: 'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
  }),
  Object.freeze({
    checkpoint: 'A3',
    file: 'wasm/.test-results/guest-link-a3/guest-link-poc-final-audit.json',
  }),
  Object.freeze({
    checkpoint: 'A4',
    file: 'wasm/.test-results/guest-link-a4/guest-link-poc-decision.md',
    kind: 'markdown-decision',
  }),
  Object.freeze({
    checkpoint: 'B0',
    file: 'wasm/.test-results/guest-link-b0/guest-link-contract-design.json',
  }),
  Object.freeze({
    checkpoint: 'B1',
    file: 'wasm/.test-results/guest-link-b1/guest-link-package-report.json',
  }),
  Object.freeze({
    checkpoint: 'B2',
    file: 'wasm/.test-results/guest-link-b2/guest-unit-materialization-proof.json',
  }),
  Object.freeze({
    checkpoint: 'B3',
    file: 'wasm/.test-results/guest-link-b3/guest-link-audit-diagnostics-proof.json',
  }),
  Object.freeze({
    checkpoint: 'B4',
    file: 'wasm/.test-results/guest-link-b4/phase-b-seal.json',
  }),
  Object.freeze({
    checkpoint: 'C4',
    file: 'wasm/.test-results/crypto-c4/phase-c-seal.json',
  }),
  Object.freeze({
    checkpoint: 'D0',
    file: 'wasm/.test-results/jwt-d0/jwt-d0-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'D1',
    file: 'wasm/.test-results/jwt-d1/jwt-d1-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'D2',
    file: 'wasm/.test-results/jwt-d2/jwt-d2-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'D3',
    file: 'wasm/.test-results/jwt-d3/jwt-d3-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'D4',
    file: 'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json',
  }),
  Object.freeze({
    checkpoint: 'E0',
    file: 'wasm/.test-results/jwt-e0/jwt-e0-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'E1',
    file: 'wasm/.test-results/jwt-e1/jwt-e1-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'E2',
    file: 'wasm/.test-results/jwt-e2/jwt-e2-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'E3',
    file: 'wasm/.test-results/jwt-e3/jwt-e3-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'E4',
    file: 'wasm/.test-results/jwt-e4/jwt-e4-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'F0',
    file: 'wasm/.test-results/jwt-f0/jwt-f0-evidence-consolidation.json',
  }),
  Object.freeze({
    checkpoint: 'F1',
    file: 'wasm/.test-results/jwt-f1/jwt-f1-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'F2',
    file: 'wasm/.test-results/jwt-f2/jwt-f2-evidence.json',
  }),
  Object.freeze({
    checkpoint: 'F3',
    file: 'wasm/.test-results/jwt-f3/jwt-f3-evidence.json',
  }),
]);

const SNAPSHOT_CONTRACTS = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'release/pulse-release-manifest.json',
  'packages/crypto/package.json',
  'packages/jwt/package.json',
  'wasm/package.json',
  'wasm/test/jwt/contracts/jwt-crypto-working-candidate.json',
  'wasm/test/jwt/fixtures/contracts/jwt-asymmetric-candidate-evidence.json',
  'wasm/test/jwt/assert-jwt-final-proof-seal.cjs',
  'wasm/test/suite/registry.cjs',
  'wasm/test/suite/assert-suite-shape.cjs',
  'wasm/test/jwt/README.md',
]);

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-f4');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT F4 option: ${argv[index]}`);
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
  const normalized = relativeFile.replace(/\\/g, '/');
  const bytes = fs.readFileSync(path.join(repoRoot, normalized));
  return Object.freeze({
    file: normalized,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}

function verifyRecord(expected) {
  const actual = fileRecord(expected.file);
  if (expected.bytes !== undefined) {
    assert.equal(actual.bytes, expected.bytes, expected.file);
  }
  assert.equal(actual.sha256, expected.sha256, expected.file);
  return actual;
}

function verifyEmbeddedRecords(values) {
  const verifiedByFile = new Map();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (
      typeof value.file === 'string' &&
      typeof value.sha256 === 'string' &&
      value.file.startsWith('wasm/.test-results/')
    ) {
      const actual = verifyRecord(value);
      const previous = verifiedByFile.get(actual.file);
      if (previous) {
        assert.equal(previous.sha256, actual.sha256, actual.file);
        assert.equal(previous.bytes, actual.bytes, actual.file);
      } else {
        verifiedByFile.set(actual.file, actual);
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  for (const value of values) visit(value);
  return Object.freeze(
    [...verifiedByFile.values()].sort((left, right) =>
      left.file.localeCompare(right.file)),
  );
}

function walkFiles(relativeDirectory) {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  assert.equal(fs.statSync(absoluteDirectory).isDirectory(), true);
  const results = [];
  const visit = (absolutePath) => {
    for (const entry of fs.readdirSync(absolutePath, {
      withFileTypes: true,
    })) {
      const child = path.join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        visit(child);
      } else if (entry.isFile()) {
        results.push(
          path.relative(repoRoot, child).replace(/\\/g, '/'),
        );
      } else {
        throw new Error(`Unexpected artifact type: ${child}`);
      }
    }
  };
  visit(absoluteDirectory);
  return results;
}

function verifyReferencedReports(report, label) {
  assert.ok(report.reports && typeof report.reports === 'object', label);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(report.reports).map(([name, record]) => [
        name,
        verifyRecord(record),
      ]),
    ),
  );
}

function runValidation(id, command, args, timeoutMs) {
  process.stdout.write(`f4 - ${id}\n`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${id} failed${result.status === null ? '' : ` with status ${result.status}`}` +
      `\n${String(result.stdout || '')}${String(result.stderr || '')}`,
      { cause: result.error },
    );
  }
  return Object.freeze({
    id,
    status: 'passed',
    command: Object.freeze([
      command === process.execPath ? 'node' : command,
      ...args,
    ]),
  });
}

function loadInputs() {
  const f0 = readJson(
    'wasm/.test-results/jwt-f0/jwt-f0-evidence-consolidation.json',
  );
  const f1 = readJson('wasm/.test-results/jwt-f1/jwt-f1-evidence.json');
  const f1Impact = readJson(
    'wasm/.test-results/jwt-f1/jwt-f1-impact-report.json',
  );
  const f1Hardening = readJson(
    'wasm/.test-results/jwt-f1/jwt-f1-production-hardening.json',
  );
  const f2 = readJson('wasm/.test-results/jwt-f2/jwt-f2-evidence.json');
  const f2Assessment = readJson(
    'wasm/.test-results/jwt-f2/jwt-f2-guest-link-suitability.json',
  );
  const f2Assumptions = readJson(
    'wasm/.test-results/jwt-f2/jwt-f2-memory-assumption-ledger.json',
  );
  const f3 = readJson('wasm/.test-results/jwt-f3/jwt-f3-evidence.json');
  const f3Comparison = readJson(
    'wasm/.test-results/jwt-f3/jwt-f3-asymmetric-candidate-comparison.json',
  );
  const f3Matrix = readJson(
    'wasm/.test-results/jwt-f3/jwt-f3-five-target-matrix.json',
  );
  const a2 = readJson(
    'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
  );
  const a3 = readJson(
    'wasm/.test-results/guest-link-a3/guest-link-poc-final-audit.json',
  );
  const b1 = readJson(
    'wasm/.test-results/guest-link-b1/guest-link-package-report.json',
  );
  const b4 = readJson(
    'wasm/.test-results/guest-link-b4/phase-b-seal.json',
  );
  const c4 = readJson('wasm/.test-results/crypto-c4/phase-c-seal.json');
  const d4 = readJson('wasm/.test-results/jwt-d4/jwt-phase-d-seal.json');
  const e3Redaction = readJson(
    'wasm/.test-results/jwt-e3/jwt-redaction-audit-report.json',
  );
  const e4 = readJson('wasm/.test-results/jwt-e4/jwt-phase-e-seal.json');
  const e4Matrix = readJson(
    'wasm/.test-results/jwt-e4/jwt-target-matrix-report.json',
  );
  const rootPackage = readJson('package.json');
  const releaseManifest = readJson('release/pulse-release-manifest.json');
  const wasmPackage = readJson('wasm/package.json');

  for (const report of [
    f0,
    f1,
    f1Impact,
    f1Hardening,
    f2,
    f2Assessment,
    f2Assumptions,
    f3,
    f3Comparison,
    f3Matrix,
    a2,
    a3,
    b1,
    b4,
    c4,
    d4,
    e3Redaction,
    e4,
    e4Matrix,
  ]) {
    assert.equal(report.status, 'passed');
  }
  for (const report of [
    f0,
    f1,
    f1Impact,
    f1Hardening,
    f2,
    f2Assessment,
    f2Assumptions,
    f3,
    f3Comparison,
    f3Matrix,
    d4,
    e4,
    e4Matrix,
  ]) {
    assert.equal(report.classification, 'PASS');
  }

  assert.equal(f0.nextAuthorizedCheckpoint, 'F1');
  assert.equal(f1.nextAuthorizedCheckpoint, 'F2');
  assert.equal(f2.nextAuthorizedCheckpoint, 'F3');
  assert.equal(f3.nextAuthorizedCheckpoint, 'F4');
  assert.equal(f1Impact.proofStatus.jwtCryptoLoop, 'PASS');
  assert.equal(
    f1Hardening.productionReleaseReadiness.classification,
    'NOT_READY',
  );
  assert.equal(
    f2Assessment.headlineDecision.guestLinkedProductionCrypto,
    'CONDITIONAL',
  );
  assert.equal(f3.recommendation.algorithm, 'ES256');
  assert.equal(f3.recommendation.guestLinkedReadiness, 'CONDITIONAL');
  assert.equal(f3.privateFrame.supersedesF2CapacityInterpretation, true);
  assert.equal(f3.privateFrame.selectedCapacityBytes, 16640);
  assert.equal(f3.privateFrame.selectedRawPayloadBytes, 16468);
  assert.equal(f3Matrix.targetCount, 5);
  assert.equal(
    f3Matrix.conclusions.firstGuestLinkedExperiment,
    'ES256',
  );
  assert.equal(
    e4.implementationBoundaries.asymmetricImplementationPresent,
    false,
  );
  assert.equal(e4.implementationBoundaries.automaticFallback, false);
  assert.equal(e4.finalArtifactRealization.automaticFallback, false);
  assert.equal(e4Matrix.automaticFallback, false);
  assert.equal(e4Matrix.requiredCellSummary.passed, 4);
  assert.equal(e4Matrix.requiredCellSummary.blocked, 0);
  assert.equal(
    e4Matrix.requiredCells.every(
      (entry) =>
        entry.status === 'passed' &&
        entry.exactRealization === true &&
        entry.automaticFallback === false,
    ),
    true,
  );
  assert.equal(e3Redaction.forbiddenValuesPresent, 0);
  assert.equal(
    e4.securityAudits.redactedReports.forbiddenValuesPresent,
    0,
  );
  assert.equal(f0.workingCandidate.candidateVersion, '1.0.0-beta.1');
  assert.equal(e4.productionBoundary.frozenReleaseCatalogVersion, '1.0.0-beta.1');
  assert.equal(e4.productionBoundary.releaseCatalogMutation, false);
  assert.equal(rootPackage.engines.pnpm, releaseManifest.publication.pnpmDevelopmentRange);
  assert.equal(Object.hasOwn(rootPackage, 'packageManager'), false);
  assert.match(releaseManifest.publication.pnpmVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(wasmPackage.devDependencies.assemblyscript, '0.28.18');

  const inputRegion = a2.candidate.layout.inputRegion;
  assert.equal(
    inputRegion.upperBoundaryExclusive - inputRegion.base,
    1572864,
  );

  verifyReferencedReports(f1, 'F1 reports');
  verifyReferencedReports(f2, 'F2 reports');
  verifyReferencedReports(f3, 'F3 reports');
  const transitivelyVerifiedRecords = verifyEmbeddedRecords([
    f0,
    f1,
    f1Impact,
    f1Hardening,
    f2,
    f2Assessment,
    f2Assumptions,
    f3,
    f3Comparison,
    f3Matrix,
    d4,
    e4,
    e4Matrix,
  ]);
  assert.ok(transitivelyVerifiedRecords.length > 30);

  return Object.freeze({
    f0,
    f1,
    f1Impact,
    f1Hardening,
    f2,
    f2Assessment,
    f2Assumptions,
    f3,
    f3Comparison,
    f3Matrix,
    a2,
    a3,
    b1,
    b4,
    c4,
    d4,
    e3Redaction,
    e4,
    e4Matrix,
    rootPackage,
    releaseManifest,
    wasmPackage,
    transitivelyVerifiedRecords,
  });
}

function buildCheckpointStatuses() {
  return Object.freeze(
    CHECKPOINT_REPORTS.map((spec) => {
      const record = fileRecord(spec.file);
      if (spec.kind === 'markdown-decision') {
        const text = fs.readFileSync(
          path.join(repoRoot, spec.file),
          'utf8',
        );
        assert.match(text, /\*\*Decision:\*\* \*\*PASS\*\*/);
      } else {
        const report = readJson(spec.file);
        assert.equal(report.status, 'passed', spec.file);
      }
      return Object.freeze({
        checkpoint: spec.checkpoint,
        status: 'PASS',
        evidence: record,
      });
    }),
  );
}

function buildArtifactManifest() {
  const files = ARTIFACT_DIRECTORIES.flatMap(walkFiles).sort();
  assert.equal(new Set(files).size, files.length);
  assert.equal(files.some((file) => file.includes('/jwt-f4/')), false);
  const records = Object.freeze(files.map(fileRecord));
  const totalBytes = records.reduce(
    (sum, record) => sum + record.bytes,
    0,
  );
  const recordsSha256 = sha256(Buffer.from(stableJson(records)));
  return Object.freeze({
    version: MANIFEST_VERSION,
    checkpoint: 'F4',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    scope: 'all-preserved-a-through-f3-proof-artifacts',
    directories: ARTIFACT_DIRECTORIES,
    artifactCount: records.length,
    totalBytes,
    recordsSha256,
    records,
  });
}

function buildSnapshotIdentity(inputs, artifactManifest) {
  const snapshotFiles = [
    ...new Set([
      ...SNAPSHOT_CONTRACTS,
      ...inputs.f0.documentation.documents.map((record) => record.file),
    ]),
  ];
  const contractRecords = Object.freeze(
    snapshotFiles.map(fileRecord),
  );
  const contractRecordsSha256 = sha256(
    Buffer.from(stableJson(contractRecords)),
  );
  return Object.freeze({
    kind: 'evidence-bound-working-candidate-snapshot',
    sourceControlCommit: null,
    sourceControlDisposition:
      'The supplied workspace has no usable VCS commit identity; exact evidence and contract records are used instead.',
    workingCandidate: Object.freeze({
      version: inputs.f0.workingCandidate.candidateVersion,
      status: 'unpublished',
      packages: inputs.f0.workingCandidate.candidatePackages,
      contract: inputs.f0.workingCandidate.contract,
    }),
    frozenRelease: Object.freeze({
      version: '1.0.0-beta.1',
      manifest: inputs.f0.workingCandidate.frozenRelease,
      changedByF4: false,
    }),
    proofArtifacts: Object.freeze({
      count: artifactManifest.artifactCount,
      bytes: artifactManifest.totalBytes,
      recordsSha256: artifactManifest.recordsSha256,
    }),
    contracts: Object.freeze({
      count: contractRecords.length,
      recordsSha256: contractRecordsSha256,
      records: contractRecords,
    }),
    identitySha256: sha256(
      Buffer.from(
        stableJson({
          workingCandidate: inputs.f0.workingCandidate.contract,
          frozenRelease: inputs.f0.workingCandidate.frozenRelease,
          proofArtifactRecordsSha256: artifactManifest.recordsSha256,
          contractRecordsSha256,
        }),
      ),
    ),
  });
}

function buildToolchainIdentities(inputs) {
  return Object.freeze({
    f4Runner: Object.freeze({
      node: process.version,
      packageManager: `pnpm@${inputs.releaseManifest.publication.pnpmVersion} (release); ${inputs.rootPackage.engines.pnpm} (development)`,
    }),
    sealedGuestLinkReality: inputs.a3.toolchain,
    packagedGuestLinkToolchain: inputs.b1.toolchain,
    nativeHs256SourceCompiler: Object.freeze({
      name: 'assemblyscript',
      version: inputs.wasmPackage.devDependencies.assemblyscript,
      source: 'wasm/package.json',
    }),
    identityPolicy:
      'F4 reuses hash-bound observed toolchain identities and does not reinterpret missing or tool-documented behavior as execution proof.',
    fastlyInspectionException:
      'The previously recorded timeout after complete Fastly version output remains tool inspection and is excluded from application execution timing.',
  });
}

function buildPhaseStatuses(checkpoints) {
  const phase = (id, status, outcome, checkpointIds) =>
    Object.freeze({
      phase: id,
      status,
      outcome,
      checkpoints: Object.freeze(
        checkpoints.filter((entry) =>
          checkpointIds.includes(entry.checkpoint)),
      ),
    });
  return Object.freeze([
    phase(
      'A',
      'PASS',
      'The bounded one-memory borrowed-span guest-link proof passed.',
      ['A1', 'A2', 'A3', 'A4'],
    ),
    phase(
      'B',
      'PASS',
      'The private package-prebuilt guest-link pipeline and exact artifact seal passed.',
      ['B0', 'B1', 'B2', 'B3', 'B4'],
    ),
    phase(
      'C',
      'PASS',
      'The crypto substrate sealed HS256 with explicit realization and no fallback.',
      ['C4'],
    ),
    phase(
      'D',
      'PASS',
      'JWT verification was refactored through crypto-owned HS256 semantics.',
      ['D0', 'D1', 'D2', 'D3', 'D4'],
    ),
    phase(
      'E',
      'PASS',
      'The shared corpus passed all four required Node/Fastly JavaScript/Native cells.',
      ['E0', 'E1', 'E2', 'E3', 'E4'],
    ),
    phase(
      'F',
      'PASS',
      'The proof, impact, guest-link suitability, and three-candidate algorithm decision are sealed; asymmetric readiness remains a separate conditional outcome.',
      ['F0', 'F1', 'F2', 'F3'],
    ),
  ]);
}

function buildTargetMatrix(inputs) {
  return Object.freeze({
    currentClosedLoop: Object.freeze({
      algorithm: 'HS256',
      requiredCells: inputs.e4Matrix.requiredCells,
      summary: inputs.e4Matrix.requiredCellSummary,
      corpus: inputs.e4Matrix.corpus,
      automaticFallback: inputs.e4Matrix.automaticFallback,
    }),
    selectedHs256Realizations: Object.freeze({
      'node-javascript': Object.freeze({
        realization: 'runtime-builtin',
        implementation: 'webcrypto.subtle.hmac-sha-256.v1',
      }),
      'fastly-javascript': Object.freeze({
        realization: 'runtime-builtin',
        implementation: 'webcrypto.subtle.hmac-sha-256.v1',
      }),
      'node-native': Object.freeze({
        realization: 'guest-source:pulse-hmac-as',
        implementation: 'pulse-hmac-as.v1',
      }),
      'fastly-native': Object.freeze({
        realization: 'guest-source:pulse-hmac-as',
        implementation: 'pulse-hmac-as.v1',
      }),
    }),
    asymmetricDirection: Object.freeze({
      candidates: inputs.f3Matrix.candidates,
      targets: inputs.f3Matrix.targets,
      conclusions: inputs.f3Matrix.conclusions,
      nativeWasmExecutionCells:
        inputs.f3Matrix.nativeWasmExecutionCells,
      universalFiveTargetSupportClaimAuthorized: false,
    }),
  });
}

function buildMeasuredImpact(inputs) {
  return Object.freeze({
    measurementPolicy: inputs.f1Impact.measurementPolicy,
    javascript: Object.freeze({
      executableModuleClosureTotals:
        inputs.f1Impact.javascript.executableModuleClosure.totals,
      fastlySourceBundle: inputs.f1Impact.javascript.fastlySourceBundle,
      fastlyRuntimeArtifact:
        inputs.f1Impact.javascript.fastlyRuntimeArtifact,
      nodeArtifactBytes: inputs.f1Impact.javascript.nodeArtifactBytes,
      nodeArtifactDisposition:
        inputs.f1Impact.javascript.nodeArtifactDisposition,
    }),
    native: Object.freeze({
      guestSource: inputs.f1Impact.native.guestSource,
      artifacts: inputs.f1Impact.native.artifacts,
      optimizationComparison:
        inputs.f1Impact.native.optimizationComparison,
    }),
    guestLinkProof: inputs.f1Impact.guestLinkProof,
    timing: inputs.f1Impact.timing,
    unknownOrUnavailableMeasurements:
      inputs.f1Impact.unknownOrUnavailableMeasurements,
    source: fileRecord(
      'wasm/.test-results/jwt-f1/jwt-f1-impact-report.json',
    ),
    productionBenchmarkClaimed: false,
  });
}

function buildUnresolvedAssumptions(inputs) {
  const f2Items = inputs.f2Assumptions.items.map((entry) => {
    if (entry.id === 'signing-input-capacity') {
      return Object.freeze({
        ...entry,
        f4Disposition:
          'DESIGN-RESOLVED-BY-F3-IMPLEMENTATION-UNPROVEN',
        resolution:
          'The existing 1,572,864-byte physical region can contain the proposed 16,640-byte private frame; frame v2 is not implemented.',
      });
    }
    if (entry.id === 'asymmetric-key-and-signature-encoding') {
      return Object.freeze({
        ...entry,
        f4Disposition:
          'DESIGN-RESOLVED-FOR-ES256-IMPLEMENTATION-UNPROVEN',
        resolution:
          'F3 selected a 64-byte x || y public key and 64-byte JOSE r || s signature; parsing, point validation, and malformed vectors remain implementation work.',
      });
    }
    return Object.freeze({
      ...entry,
      f4Disposition: 'OPEN',
      resolution: null,
    });
  });
  return Object.freeze({
    f2GuestLinkAssumptions: Object.freeze(f2Items),
    selectedEs256Preconditions:
      inputs.f3Comparison.requiredPreconditions,
    remainingConditionality:
      inputs.f3.privateFrame.remainingConditionality,
    productionReleaseReadiness:
      inputs.f1Hardening.productionReleaseReadiness,
  });
}

function buildDeferredProductionWork(inputs) {
  return Object.freeze({
    readiness: inputs.f1Hardening.productionReleaseReadiness,
    items: inputs.f1Hardening.items,
    additionalBoundaries: Object.freeze([
      'No npm publication or release-catalog promotion is authorized.',
      'No documentation promotion, remote Fastly deployment, or provider activation is authorized.',
      'Browser and ESP32 remain forward targets without current Pulse execution proof.',
      'Fastly JavaScript ES256 remains ineligible until ECDSA verification is demonstrated without fallback.',
      'Ed25519 remains a strategic candidate and requires an explicit versioned EdDSA-to-Ed25519 vocabulary migration before implementation.',
    ]),
  });
}

function buildSeal(inputs, artifactManifest, validations) {
  const checkpoints = buildCheckpointStatuses();
  const snapshotIdentity = buildSnapshotIdentity(
    inputs,
    artifactManifest,
  );
  const targetMatrix = buildTargetMatrix(inputs);
  const phaseStatuses = buildPhaseStatuses(checkpoints);
  assert.equal(phaseStatuses.every((entry) => entry.status === 'PASS'), true);

  const noFallbackEvidence = Object.freeze({
    status: 'PASS',
    currentCells: Object.freeze(
      inputs.e4Matrix.requiredCells.map((entry) =>
        Object.freeze({
          id: entry.id,
          exactRealization: entry.exactRealization,
          automaticFallback: entry.automaticFallback,
          evidenceCheckpoint: entry.evidenceCheckpoint,
        })),
    ),
    finalArtifactAutomaticFallback:
      inputs.e4.finalArtifactRealization.automaticFallback,
    asymmetricFallbackAddedByF3: false,
    source: fileRecord(
      'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
    ),
  });
  assert.equal(
    noFallbackEvidence.currentCells.every(
      (entry) =>
        entry.exactRealization && entry.automaticFallback === false,
    ),
    true,
  );

  const redactionEvidence = Object.freeze({
    status: 'PASS',
    claimsUnavailableBeforeAuthenticity:
      inputs.e4.securityAudits.claimsUnavailableBeforeAuthenticity,
    registeredClaimsBeforeSchema:
      inputs.e4.securityAudits.registeredClaimsBeforeSchema,
    reports: inputs.e4.securityAudits.redactedReports,
    forbiddenValuesPresent:
      inputs.e3Redaction.forbiddenValuesPresent,
    scannedSurfaceKinds: inputs.e3Redaction.scannedSurfaceKinds,
    source: fileRecord(
      'wasm/.test-results/jwt-e3/jwt-redaction-audit-report.json',
    ),
  });

  const memoryConclusion = Object.freeze({
    status: 'CONDITIONAL',
    physicalBorrowableRegionBytes:
      inputs.f3.privateFrame.physicalBorrowableRegionBytes,
    borrowedSpanV1ProofMaximumBytes:
      inputs.f3.privateFrame.priorProofMaximumBytes,
    proposedPrivateFrameCapacityBytes:
      inputs.f3.privateFrame.selectedCapacityBytes,
    selectedEs256RawPayloadMaximumBytes:
      inputs.f3.privateFrame.selectedRawPayloadBytes,
    capacityBlocksExperiment: false,
    interpretation:
      'The 4,096-byte value is an exercised v1 proof bound, not the physical limit. The proposed ES256 frame fits the existing region without an allocator or memory growth.',
    implementationProofComplete: false,
    condition:
      'A real ES256 guest must prove frame validation, stack, static data, scratch, non-overlap, pointer non-retention, optimized layout, reproducible bytes, and security properties.',
    publicAbiChanged: false,
    allocatorAdded: false,
  });
  assert.ok(
    memoryConclusion.proposedPrivateFrameCapacityBytes <=
      memoryConclusion.physicalBorrowableRegionBytes,
  );
  assert.ok(
    memoryConclusion.selectedEs256RawPayloadMaximumBytes <=
      memoryConclusion.proposedPrivateFrameCapacityBytes,
  );

  return Object.freeze({
    version: SEAL_VERSION,
    checkpoint: 'F4',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    scope: 'final-proof-decision-and-handoff',
    outcomeIndependence:
      'The closed-loop proof result and asymmetric guest-link readiness are separate conclusions.',
    outcomes: Object.freeze({
      jwtCryptoClosedLoop: Object.freeze({
        decision: 'PASS',
        reason:
          'HS256 verification passed one shared corpus through all four required Node/Fastly JavaScript/Native cells with exact realization selection, no skipped executions, no fallback, fail-closed semantics, and redaction.',
        productionReleaseReadiness: 'NOT_READY',
      }),
      guestLinkedAsymmetricDirection: Object.freeze({
        decision: 'CONDITIONAL',
        recommendedFirstAlgorithm: 'ES256',
        namedPrerequisite:
          'Prove the real verify-only ES256 guest and private frame v2 under the selected source, fixed memory layout, exact post-optimization artifacts, reproducible prebuilt generation, malformed-input corpus, Node Native/Fastly Native execution, and independent security review.',
        physicalFrameCapacityIsPrerequisite: false,
        productionClaimAuthorized: false,
      }),
    }),
    snapshotIdentity,
    toolchainIdentities: buildToolchainIdentities(inputs),
    phaseStatuses,
    inputIntegrity: Object.freeze({
      status: 'PASS',
      transitivelyVerifiedRecordCount:
        inputs.transitivelyVerifiedRecords.length,
      recordsSha256: sha256(
        Buffer.from(stableJson(inputs.transitivelyVerifiedRecords)),
      ),
      records: inputs.transitivelyVerifiedRecords,
    }),
    artifactManifest: Object.freeze({
      version: artifactManifest.version,
      artifactCount: artifactManifest.artifactCount,
      totalBytes: artifactManifest.totalBytes,
      recordsSha256: artifactManifest.recordsSha256,
    }),
    targetMatrix,
    noFallbackEvidence,
    redactionEvidence,
    guestLinkMemoryConclusion: memoryConclusion,
    measuredSizeAndBuildImpact: buildMeasuredImpact(inputs),
    workingCandidateVersionStatus: Object.freeze({
      workingCandidate: '1.0.0-beta.1',
      status: 'unpublished',
      frozenReleaseCatalog: '1.0.0-beta.1',
      frozenCatalogChanged: false,
      discrepancyResolution:
        'The complete proof applies to the unpublished 1.0.0-beta.1 JWT/crypto working candidate; the frozen 1.0.0-beta.1 release remains historical and unchanged.',
      publicationAuthorized: false,
    }),
    unresolvedAssumptions: buildUnresolvedAssumptions(inputs),
    deferredProductionWork: buildDeferredProductionWork(inputs),
    identifierDisposition: inputs.f3.identifierDisposition,
    validations,
    exactNextAuthorizationRequested: Object.freeze({
      id: 'CREATE-BOUNDED-ES256-IMPLEMENTATION-PLAN',
      request:
        'Create a separate bounded verify-only ES256 implementation plan from the sealed F4 snapshot.',
      planScope: Object.freeze([
        'Select and freeze a minimal host-neutral P-256 verifier source and dependency closure.',
        'Define private invocation frame v2 at 16,640 bytes with exact field and validation rules.',
        'Implement no-allocator guest verification before adding JWT or target support.',
        'Integrate through crypto-owned exact realization selection with no fallback.',
        'Prove Node Native and Fastly Native exact artifacts, then add only explicitly eligible runtime adapters.',
        'Seal reproducibility, memory, malformed-input, and security-review evidence before any production claim.',
      ]),
      es256ImplementationAuthorizedByF4: false,
      publicSupportAuthorizedByF4: false,
      releaseAuthorizedByF4: false,
    }),
    boundaries: Object.freeze({
      evidenceOnly: true,
      jwtCryptoImplementationChanged: false,
      asymmetricImplementationAdded: false,
      signingAdded: false,
      privateFrameImplemented: false,
      memoryAbiChanged: false,
      allocatorAdded: false,
      publicAbiAdded: false,
      publicTrustModelWidened: false,
      thirdPartyGuestUnitsAdded: false,
      sourceBuildLaneAdded: false,
      automaticFallbackAdded: false,
      targetSupportAdvertised: false,
      npmPublication: false,
      documentationPromotion: false,
      remoteFastlyDeployment: false,
      providerActivation: false,
      releaseCatalogChanged: false,
    }),
    phaseFComplete: true,
    nextCheckpoint: null,
  });
}

function renderHandoff(seal) {
  const lines = [
    '# F4 final proof decision and handoff',
    '',
    '**JWT/crypto loop:** PASS',
    '**Guest-linked asymmetric readiness:** CONDITIONAL',
    '**Recommended first algorithm:** ES256',
    '**Production-release readiness:** NOT_READY',
    '**Phase F:** COMPLETE',
    '',
    'The two outcomes are independent. The implemented HS256 JWT/crypto loop',
    'passes all four required Node/Fastly JavaScript/Native cells with exact',
    'realizations, no skipped corpus executions, no fallback, fail-closed',
    'semantics, and redaction. That proof does not implement or advertise an',
    'asymmetric algorithm.',
    '',
    'The first guest-linked asymmetric direction is conditionally ES256. The',
    'condition is implementation evidence: prove the real verifier, private',
    'frame validation, memory layout, reproducible bytes, exact final-artifact',
    'execution, malformed-input behavior, and security review.',
    '',
    '## Guest span conclusion',
    '',
    `- Existing physical input region: ${seal.guestLinkMemoryConclusion.physicalBorrowableRegionBytes.toLocaleString('en-US')} bytes.`,
    `- Borrowed-span v1 exercised maximum: ${seal.guestLinkMemoryConclusion.borrowedSpanV1ProofMaximumBytes.toLocaleString('en-US')} bytes.`,
    `- Proposed private ES256 frame: ${seal.guestLinkMemoryConclusion.proposedPrivateFrameCapacityBytes.toLocaleString('en-US')} bytes.`,
    `- Maximum normalized ES256 payload: ${seal.guestLinkMemoryConclusion.selectedEs256RawPayloadMaximumBytes.toLocaleString('en-US')} bytes.`,
    '- Physical capacity does not block the experiment.',
    '- Frame v2 and a real asymmetric guest remain unimplemented.',
    '',
    '## Current closed-loop target matrix',
    '',
    '| Cell | Realization | Implementation | Result | Fallback |',
    '|---|---|---|---|---|',
    ...seal.targetMatrix.currentClosedLoop.requiredCells.map(
      (entry) =>
        `| ${entry.id} | ${entry.realization} | ${entry.implementation} | PASS | disabled |`,
    ),
    '',
    'Browser and ESP32 remain forward targets without current Pulse execution',
    'proof. Fastly JavaScript ES256 remains explicitly ineligible until ECDSA',
    'verification is demonstrated. No target inherits support from another.',
    '',
    '## Version and release boundary',
    '',
    'The proof applies to the unpublished `1.0.0-beta.1` JWT/crypto working candidate.',
    'The frozen `1.0.0-beta.1` release catalog remains unchanged. Proof PASS is not',
    'publication, deployment, activation, documentation promotion, or',
    'production-release readiness.',
    '',
    '## Exact next authorization requested',
    '',
    seal.exactNextAuthorizationRequested.request,
    '',
    'That plan should remain verify-only, use the private 16,640-byte frame,',
    'prohibit allocation and memory growth, preserve crypto-owned exact',
    'realization selection, and prove Node Native/Fastly Native artifacts',
    'before any broader target claim.',
    '',
    'F4 does not itself authorize ES256 implementation.',
    '',
    '## Snapshot identity',
    '',
    `- Identity SHA-256: \`${seal.snapshotIdentity.identitySha256}\``,
    `- Preserved proof artifacts: ${seal.artifactManifest.artifactCount}`,
    `- Preserved artifact bytes: ${seal.artifactManifest.totalBytes}`,
    `- Artifact-record digest: \`${seal.artifactManifest.recordsSha256}\``,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function writeOutput(outputDirectory, name, contents) {
  const file = path.join(outputDirectory, name);
  fs.writeFileSync(file, contents);
  return fileRecord(path.relative(repoRoot, file).replace(/\\/g, '/'));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputs = loadInputs();
  const artifactManifest = buildArtifactManifest();
  const validations = Object.freeze([
    runValidation(
      'maintainer-control-plane',
      process.execPath,
      ['scripts/validate-maintainer-control-plane.cjs'],
      120000,
    ),
    runValidation(
      'current-unit-profile',
      process.execPath,
      [
        'wasm/scripts/run-wasm-tests.cjs',
        '--profile',
        'unit',
        '--no-report',
      ],
      300000,
    ),
    runValidation(
      'current-documentation',
      'npm',
      ['run', 'docs:check'],
      300000,
    ),
  ]);
  const seal = buildSeal(inputs, artifactManifest, validations);
  assert.equal(seal.outcomes.jwtCryptoClosedLoop.decision, 'PASS');
  assert.equal(
    seal.outcomes.guestLinkedAsymmetricDirection.decision,
    'CONDITIONAL',
  );
  assert.equal(
    seal.outcomes.guestLinkedAsymmetricDirection
      .recommendedFirstAlgorithm,
    'ES256',
  );
  assert.equal(
    seal.exactNextAuthorizationRequested.es256ImplementationAuthorizedByF4,
    false,
  );
  assert.equal(
    Object.values(seal.boundaries).every(
      (value) => typeof value === 'boolean',
    ),
    true,
  );

  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const manifestRecord = writeOutput(
    options.outputDirectory,
    'jwt-f4-artifact-manifest.json',
    stableJson(artifactManifest),
  );
  const sealRecord = writeOutput(
    options.outputDirectory,
    'jwt-f4-final-proof-seal.json',
    stableJson(seal),
  );
  const handoffRecord = writeOutput(
    options.outputDirectory,
    'jwt-f4-final-handoff.md',
    renderHandoff(seal),
  );
  const evidence = Object.freeze({
    version: EVIDENCE_VERSION,
    checkpoint: 'F4',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    scope: 'final-proof-decision-and-handoff',
    outcomes: seal.outcomes,
    reports: Object.freeze({
      artifactManifest: manifestRecord,
      finalSeal: sealRecord,
      handoff: handoffRecord,
    }),
    acceptance: Object.freeze({
      independentOutcomesRecorded: true,
      snapshotIdentityRecorded: true,
      toolchainIdentitiesRecorded: true,
      allPhaseStatusesRecorded: true,
      allPriorArtifactPathsAndHashesRecorded: true,
      targetMatrixRecorded: true,
      selectedHs256RealizationsRecorded: true,
      noFallbackEvidenceRecorded: true,
      redactionEvidenceRecorded: true,
      guestLinkMemoryConclusionRecorded: true,
      measuredSizeAndBuildImpactRecorded: true,
      workingCandidateVersionStatusRecorded: true,
      unresolvedAssumptionsRecorded: true,
      deferredProductionWorkRecorded: true,
      exactNextAuthorizationRequested: true,
      physicalFrameCapacityMisclassifiedAsBlocker: false,
      asymmetricImplementationAuthorized: false,
      publicationOrDeploymentAuthorized: false,
    }),
    phaseFComplete: true,
    nextCheckpoint: null,
    boundaries: seal.boundaries,
  });
  writeOutput(
    options.outputDirectory,
    'jwt-f4-evidence.json',
    stableJson(evidence),
  );

  process.stdout.write(
    `ok - F4 sealed JWT/crypto loop PASS and guest-linked asymmetric ` +
      `readiness CONDITIONAL with ES256 selected; ` +
      `${artifactManifest.artifactCount} prior artifacts are hash-bound and ` +
      `Phase F is complete without authorizing implementation\n`,
  );
}

main();
