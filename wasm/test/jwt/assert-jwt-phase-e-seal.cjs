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

const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');
const {
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR,
} = require('../../../packages/provider-node/src/javascript/target.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR,
} = require('../../../packages/provider-node/src/native/target.js');
const {
  FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR,
} = require('../../../packages/provider-fastly/src/javascript/target.js');
const fastlyToolchain = require('../../../packages/provider-fastly/src/toolchain/index.js');
const pulseJwtManifest = require('../../../packages/jwt/pulsewasm.manifest.cjs');
const {
  forbiddenSensitiveValues,
  loadJwtConformanceCorpus,
} = require('./jwt-conformance-harness.cjs');

const SEAL_VERSION = 'pulse.jwt-phase-e-seal.v1';
const EVIDENCE_VERSION = 'pulse.jwt-e4-evidence.v1';
const MATRIX_REPORT_VERSION = 'pulse.jwt-target-matrix-report.e4.v1';
const IMPACT_REPORT_VERSION = 'pulse.jwt-artifact-impact-report.e4.v1';
const EXPECTED_VERSION_SKEW =
  '@pulse-compute/provider-fastly@1.0.0-beta.1 Pulse dependency metadata differs ' +
  'from the synchronized release';
const REQUIRED_PROFILES = Object.freeze([
  'unit',
  'native',
  'javascript',
  'conformance',
  'providers',
]);
const FOCUSED_TASKS = Object.freeze([
  'suite-shape',
  'package-exports',
  'hidden-contracts',
  'api-surface',
  'crypto-config-planning',
  'jwt-package-owned-lowering',
  'canonical-native-plan',
  'crypto-runtime-builtin',
  'crypto-native-guest-source',
  'crypto-cross-target-conformance',
  'node-router-context-parity',
  'target-support',
  'provider-fastly-package',
  'provider-fastly-apps',
  'fastly-javascript-packaging',
  'fastly-javascript-runtime',
  'fastly-native-platform-capabilities',
]);
const OWNED_OUTPUTS = Object.freeze([
  'jwt-target-matrix-report.json',
  'jwt-artifact-impact-report.json',
  'jwt-phase-e-seal.json',
  'jwt-e4-evidence.json',
  'relevant-aggregate.json',
  'orchestration-report.json',
]);
const REPORT_SPECS = Object.freeze([
  Object.freeze({
    category: 'guest',
    file: 'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
    version: 'pulse.guest-link-poc.memory.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'guest',
    file: 'wasm/.test-results/guest-link-b4/phase-b-seal.json',
    version: 'pulse.guest-link.phase-b-seal.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'realization',
    file: 'wasm/.test-results/crypto-c4/crypto-cross-target-conformance.json',
    version: 'pulse.crypto.cross-target-conformance.v2',
    status: 'passed',
  }),
  Object.freeze({
    category: 'realization',
    file: 'wasm/.test-results/crypto-c4/fastly-reality.json',
    version: 'pulse.fastly-real-host-proof.v2',
    status: null,
  }),
  Object.freeze({
    category: 'realization',
    file: 'wasm/.test-results/crypto-c4/phase-c-seal.json',
    version: 'pulse.crypto.phase-c-seal.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'requirement',
    file: 'wasm/.test-results/jwt-d0/jwt-crypto-migration-map.json',
    version: 'pulse.jwt-crypto-migration-map.v1',
    status: 'accepted-for-d1',
  }),
  Object.freeze({
    category: 'requirement',
    file: 'wasm/.test-results/jwt-d0/jwt-crypto-requirements.json',
    version: 'pulse.jwt-crypto-requirements.v1',
    status: 'frozen-for-d1',
  }),
  Object.freeze({
    category: 'JWT',
    file: 'wasm/.test-results/jwt-d0/jwt-d0-evidence.json',
    version: 'pulse.jwt-crypto.d0-evidence.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'requirement',
    file: 'wasm/.test-results/jwt-d1/jwt-d1-evidence.json',
    version: 'pulse.jwt-crypto.d1-evidence.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'JWT',
    file: 'wasm/.test-results/jwt-d2/jwt-d2-evidence.json',
    version: 'pulse.jwt-crypto.d2-evidence.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'realization',
    file: 'wasm/.test-results/jwt-d3/jwt-d3-evidence.json',
    version: 'pulse.jwt-realization-integration.d3-evidence.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'audit',
    file: 'wasm/.test-results/jwt-d4/jwt-crypto-composition-report.json',
    version: 'pulse.jwt-crypto-composition-report.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'JWT',
    file: 'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json',
    version: 'pulse.jwt-phase-d-seal.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'requirement',
    file: 'wasm/.test-results/jwt-e0/jwt-e0-evidence.json',
    version: 'pulse.jwt-conformance.e0-evidence.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'JWT',
    file: 'wasm/.test-results/jwt-e1/jwt-javascript-conformance-report.json',
    version: 'pulse.jwt-javascript-conformance-report.e1.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'realization',
    file: 'wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json',
    version: 'pulse.jwt-javascript-target-reality-report.e1.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'redaction',
    file: 'wasm/.test-results/jwt-e1/jwt-javascript-redaction-report.json',
    version: 'pulse.jwt-javascript-redaction-report.e1.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'JWT',
    file: 'wasm/.test-results/jwt-e1/jwt-e1-evidence.json',
    version: 'pulse.jwt-e1-evidence.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'JWT',
    file: 'wasm/.test-results/jwt-e2/jwt-native-conformance-report.json',
    version: 'pulse.jwt-native-conformance-report.e2.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'realization',
    file: 'wasm/.test-results/jwt-e2/jwt-native-target-reality-report.json',
    version: 'pulse.jwt-native-target-reality-report.e2.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'audit',
    file: 'wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json',
    version: 'pulse.jwt-native-artifact-audit-report.e2.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'redaction',
    file: 'wasm/.test-results/jwt-e2/jwt-native-redaction-report.json',
    version: 'pulse.jwt-native-redaction-report.e2.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'JWT',
    file: 'wasm/.test-results/jwt-e2/jwt-e2-evidence.json',
    version: 'pulse.jwt-e2-evidence.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'audit',
    file: 'wasm/.test-results/jwt-e3/jwt-fail-closed-order-report.json',
    version: 'pulse.jwt-fail-closed-order-report.e3.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'audit',
    file: 'wasm/.test-results/jwt-e3/jwt-no-fallback-audit-report.json',
    version: 'pulse.jwt-no-fallback-audit-report.e3.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'redaction',
    file: 'wasm/.test-results/jwt-e3/jwt-redaction-audit-report.json',
    version: 'pulse.jwt-redaction-audit-report.e3.v1',
    status: 'passed',
  }),
  Object.freeze({
    category: 'JWT',
    file: 'wasm/.test-results/jwt-e3/jwt-e3-evidence.json',
    version: 'pulse.jwt-e3-evidence.v1',
    status: 'passed',
  }),
]);

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-e4');
  let resumeCorpus = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out' && argv[index + 1]) {
      outputDirectory = path.resolve(argv[++index]);
    } else if (argv[index] === '--resume-corpus') {
      resumeCorpus = true;
    } else {
      throw new TypeError(`Unknown or incomplete E4 option ${String(argv[index])}.`);
    }
  }
  return Object.freeze({ outputDirectory, resumeCorpus });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(file) {
  return sha256(fs.readFileSync(file));
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

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function runStage(id, command, args, options = {}) {
  process.stdout.write(`e4 - ${id}\n`);
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs || 300_000,
    shell: false,
  });
  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.error || result.status !== 0) {
    throw new Error(
      `${id} failed${result.status === null ? '' : ` with status ${result.status}`}` +
      `${output.trim() ? `\n${output.trim()}` : ''}`,
      { cause: result.error },
    );
  }
  const detail = options.assertOutput ? options.assertOutput(output) : {};
  return Object.freeze({
    id,
    status: 'passed',
    durationMs,
    ...detail,
  });
}

function runVersionSkewAwareStage(id, command, args, options = {}) {
  process.stdout.write(`e4 - ${id}\n`);
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs || 600_000,
    shell: false,
  });
  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`);
  if (!result.error && result.status === 0) {
    return Object.freeze({ id, status: 'passed', durationMs, knownVersionSkew: false });
  }
  if (!result.error && output.includes(EXPECTED_VERSION_SKEW)) {
    assert.equal(
      output.split(EXPECTED_VERSION_SKEW).length - 1,
      1,
      `${id} must report the accepted version skew exactly once`,
    );
    return Object.freeze({
      id,
      status: 'accepted-known-version-skew',
      durationMs,
      knownVersionSkew: true,
      observed: EXPECTED_VERSION_SKEW,
      blocksPhaseE: false,
      blocksPublication: true,
    });
  }
  throw new Error(
    `${id} failed outside the accepted version skew` +
    `${output.trim() ? `\n${output.trim()}` : ''}`,
    { cause: result.error },
  );
}

function verifyReportReferences(evidence) {
  const references = Array.isArray(evidence.reports)
    ? evidence.reports
    : Object.values(evidence.reports || {});
  return Object.freeze(references.map((reference) => {
    assert.equal(typeof reference.file, 'string');
    assert.equal(typeof reference.sha256, 'string');
    const record = fileRecord(reference.file);
    assert.equal(record.sha256, reference.sha256, reference.file);
    return record;
  }));
}

function inspectReports() {
  const records = REPORT_SPECS.map((spec) => {
    const report = readJson(spec.file);
    assert.equal(report.version, spec.version, spec.file);
    if (spec.status !== null) assert.equal(report.status, spec.status, spec.file);
    return Object.freeze({
      category: spec.category,
      ...fileRecord(spec.file),
      version: report.version,
      status: report.status || 'sealed-by-owning-checkpoint',
    });
  });
  const categories = Object.freeze(Object.fromEntries(
    [...new Set(records.map((record) => record.category))].sort().map((category) => [
      category,
      records.filter((record) => record.category === category).length,
    ]),
  ));
  return Object.freeze({
    status: 'passed',
    reports: Object.freeze(records),
    categories,
  });
}

function assertPredecessorReferences() {
  const e1 = readJson('wasm/.test-results/jwt-e1/jwt-e1-evidence.json');
  const e2 = readJson('wasm/.test-results/jwt-e2/jwt-e2-evidence.json');
  const e3 = readJson('wasm/.test-results/jwt-e3/jwt-e3-evidence.json');
  const d4 = readJson('wasm/.test-results/jwt-d4/jwt-phase-d-seal.json');
  const d4Report = d4.composition.report;
  assert.equal(fileRecord(d4Report.file).sha256, d4Report.sha256);
  return Object.freeze({
    status: 'passed',
    d4: Object.freeze([fileRecord(d4Report.file)]),
    e1: verifyReportReferences(e1),
    e2: verifyReportReferences(e2),
    e3: verifyReportReferences(e3),
  });
}

function assertTargetMatrix(corpus) {
  const javascript = readJson(
    'wasm/.test-results/jwt-e1/jwt-javascript-conformance-report.json',
  );
  const native = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-conformance-report.json',
  );
  assert.equal(javascript.status, 'passed');
  assert.equal(javascript.classification, 'PASS');
  assert.equal(javascript.corpusHash, corpus.corpusHash);
  assert.equal(javascript.requiredExecutions, 70);
  assert.equal(javascript.completedExecutions, 70);
  assert.equal(javascript.skippedExecutions, 0);
  assert.equal(native.status, 'passed');
  assert.equal(native.classification, 'PASS');
  assert.equal(native.corpusHash, corpus.corpusHash);
  assert.equal(native.requiredExecutions, 140);
  assert.equal(native.completedExecutions, 140);
  assert.equal(native.skippedExecutions, 0);

  const actualTargets = new Map([
    ...javascript.targets.map((target) => [target.targetId, {
      report: 'E1',
      target,
      executions: target.caseIds.length,
      modes: Object.freeze(['default']),
    }]),
    ...native.targets.map((target) => [target.targetId, {
      report: 'E2',
      target,
      executions: target.caseIds.length * target.modes.length,
      modes: Object.freeze(target.modes.map((mode) => mode.mode)),
    }]),
  ]);
  const requiredCells = corpus.targetMatrix.required.map((expected) => {
    const actual = actualTargets.get(expected.id);
    assert.ok(actual, expected.id);
    assert.equal(actual.target.status, 'passed');
    assert.equal(actual.target.realization, expected.realization);
    assert.equal(actual.target.implementation, expected.implementation);
    assert.deepEqual(actual.target.caseIds, corpus.cases.map((entry) => entry.id));
    assert.deepEqual(actual.target.skippedCaseIds, []);
    assert.equal(actual.target.automaticFallback, false);
    if (actual.target.modes) {
      assert.equal(actual.target.defaultOptimizedParity, true);
      for (const mode of actual.target.modes) {
        assert.equal(mode.cases.length, corpus.cases.length);
        assert.equal(mode.artifact.status, 'passed');
        assert.equal(mode.artifact.automaticFallback, false);
      }
    }
    return Object.freeze({
      id: expected.id,
      provider: expected.provider,
      mode: expected.mode,
      requirement: 'required',
      status: 'passed',
      classification: 'PASS',
      realization: actual.target.realization,
      implementation: actual.target.implementation,
      corpusCases: actual.target.caseIds.length,
      executions: actual.executions,
      skippedExecutions: 0,
      executionModes: actual.modes,
      evidenceCheckpoint: actual.report,
      exactRealization: true,
      automaticFallback: false,
    });
  });
  assert.equal(requiredCells.length, 4);
  assert.ok(requiredCells.every((entry) => entry.status === 'passed'));
  assert.deepEqual(corpus.targetMatrix.additional, []);
  return Object.freeze({
    version: MATRIX_REPORT_VERSION,
    checkpoint: 'E4',
    phase: 'E',
    status: 'passed',
    classification: 'PASS',
    corpus: Object.freeze({
      version: corpus.version,
      semanticHash: corpus.corpusHash,
      cases: corpus.cases.length,
      completeCorpusRuns: 1,
      completedExecutions:
        javascript.completedExecutions + native.completedExecutions,
      skippedExecutions: 0,
    }),
    requiredCells: Object.freeze(requiredCells),
    requiredCellSummary: Object.freeze({
      declared: 4,
      passed: 4,
      blocked: 0,
    }),
    additionalCells: Object.freeze({
      declared: 0,
      classifications: Object.freeze([]),
      disposition: 'no-additional-cells-declared',
    }),
    historicalFastlyNativeBlocker: Object.freeze({
      e0Status: 'planning-blocked',
      e4Status: 'passed',
      resolution: 'implemented-e2-and-executed-in-e4',
    }),
    automaticFallback: false,
  });
}

function assertArtifactImpact() {
  const javascriptReality = readJson(
    'wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json',
  );
  const nativeReality = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-target-reality-report.json',
  );
  const nativeAudit = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json',
  );
  assert.equal(javascriptReality.status, 'passed');
  assert.equal(javascriptReality.exactSelection, true);
  assert.equal(javascriptReality.node.runtimeBuiltinObserved, true);
  assert.equal(javascriptReality.fastly.runtimeBuiltinObserved, true);
  assert.equal(nativeReality.status, 'passed');
  assert.equal(nativeAudit.status, 'passed');
  assert.equal(nativeAudit.exactFinalArtifactsAuditedAndExecuted, true);

  const nodeNativeAudit = new Map(
    nativeAudit.local.map((entry) => [entry.mode, entry]),
  );
  const fastlyNativeAudit = new Map(
    nativeAudit.fastly.map((entry) => [entry.mode, entry]),
  );
  const nodeNative = nativeReality.localModes.map((mode) => {
    const audit = nodeNativeAudit.get(mode.mode);
    assert.ok(audit);
    assert.equal(mode.bytes, audit.bytes);
    assert.equal(mode.sha256, audit.sha256);
    assert.ok(Number.isInteger(mode.timing.buildDurationMs));
    assert.ok(mode.timing.buildDurationMs >= 0);
    return Object.freeze({
      targetId: 'node-native',
      mode: mode.mode,
      status: 'passed',
      realization: 'guest-source:pulse-hmac-as',
      artifactBytes: mode.bytes,
      artifactSha256: mode.sha256,
      controlArtifactBytes: null,
      realizationImpactBytes: null,
      buildDurationMs: mode.timing.buildDurationMs,
      measurement:
        'canonical-native-compiler-duration; observational, not a benchmark',
    });
  });
  const fastlyNative = nativeReality.fastlyModes.map((mode) => {
    const audit = fastlyNativeAudit.get(mode.mode);
    const impact = nativeAudit.realizationContributionAndImpact[mode.mode];
    assert.ok(audit);
    assert.ok(impact);
    assert.equal(mode.bytes, audit.bytes);
    assert.equal(mode.sha256, audit.sha256);
    assert.equal(mode.exactExecutedArtifactSha256, audit.sha256);
    assert.equal(impact.finalWasmBytes, audit.bytes);
    assert.ok(Number.isInteger(mode.timing.buildDurationMs));
    return Object.freeze({
      targetId: 'fastly-native',
      mode: mode.mode,
      status: 'passed',
      realization: 'guest-source:pulse-hmac-as',
      artifactBytes: mode.bytes,
      artifactSha256: mode.sha256,
      controlArtifactBytes: impact.controlWasmBytes,
      realizationImpactBytes: impact.totalArtifactImpactBytes,
      jwtSourceContributionBytes: impact.jwtSourceContributionBytes,
      cryptoSourceContributionBytes: impact.cryptoSourceContributionBytes,
      buildDurationMs: mode.timing.buildDurationMs,
      engineBootDurationMs: mode.timing.engineBootDurationMs,
      corpusDurationMs: mode.timing.corpusDurationMs,
      teardownDurationMs: mode.timing.teardownDurationMs,
      measurement:
        'canonical Fastly build and local serve durations; observational, not a benchmark',
    });
  });
  return Object.freeze({
    version: IMPACT_REPORT_VERSION,
    checkpoint: 'E4',
    phase: 'E',
    status: 'passed',
    measurementPolicy: Object.freeze({
      valuesAreObservedDurations: true,
      benchmarkClaimed: false,
      unavailableValuesUseNull: true,
      applicationExecutionExcludesCliInspection: true,
    }),
    targets: Object.freeze([
      Object.freeze({
        targetId: 'node-javascript',
        mode: 'javascript',
        status: 'passed',
        realization: 'runtime-builtin',
        artifactBytes: null,
        artifactSha256: null,
        buildDurationMs: null,
        measurement:
          'no target artifact emitted; package/runtime-builtin execution only',
      }),
      Object.freeze({
        targetId: 'fastly-javascript',
        mode: 'javascript',
        status: 'passed',
        realization: 'runtime-builtin',
        artifactBytes: javascriptReality.fastly.wasm.bytes,
        artifactSha256: javascriptReality.fastly.wasm.sha256,
        sourceBundleBytes: javascriptReality.fastly.bundle.bytes,
        sourceBundleSha256: javascriptReality.fastly.bundle.sha256,
        sourceBundleBuildDurationMs: javascriptReality.fastly.buildDurationMs,
        jsComputeBuildDurationMs: javascriptReality.fastly.jsComputeDurationMs,
        computeServeDurationMs: javascriptReality.fastly.computeDurationMs,
        measurement:
          'bundle, js-compute build, and local serve durations; observational, not a benchmark',
      }),
      ...nodeNative,
      ...fastlyNative,
    ]),
  });
}

function assertRustGuestProof() {
  const memoryReport = readJson(
    'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
  );
  const phaseB = readJson('wasm/.test-results/guest-link-b4/phase-b-seal.json');
  assert.equal(memoryReport.version, 'pulse.guest-link-poc.memory.v1');
  assert.equal(memoryReport.status, 'passed');
  assert.equal(phaseB.version, 'pulse.guest-link.phase-b-seal.v1');
  assert.equal(phaseB.status, 'passed');
  const sources = memoryReport.sources.map((expected) => {
    const actual = fileRecord(expected.file);
    assert.equal(actual.bytes, expected.bytes, expected.file);
    assert.equal(actual.sha256, expected.sha256, expected.file);
    return actual;
  });
  const artifacts = Object.freeze({
    rustGuest: fileRecord(
      'wasm/.test-results/guest-link-a2/candidate-guest.wasm',
    ),
    independentFinal: fileRecord(
      'wasm/.test-results/guest-link-a3/guest-link-poc-final.wasm',
    ),
    sealedCanonical: fileRecord(
      'wasm/.test-results/guest-link-b1/canonical-native.wasm',
    ),
  });
  assert.equal(artifacts.rustGuest.sha256, phaseB.artifact.guest.sha256);
  assert.equal(artifacts.rustGuest.bytes, phaseB.artifact.guest.bytes);
  assert.equal(artifacts.independentFinal.sha256, phaseB.artifact.final.sha256);
  assert.equal(artifacts.independentFinal.bytes, phaseB.artifact.final.bytes);
  assert.equal(artifacts.sealedCanonical.sha256, phaseB.artifact.final.sha256);
  assert.equal(artifacts.sealedCanonical.bytes, phaseB.artifact.final.bytes);
  return Object.freeze({
    status: 'passed',
    disposition: 'byte-identical-to-sealed-evidence',
    rerunRequired: false,
    sourceInputsUnchanged: true,
    sources: Object.freeze(sources),
    artifacts,
  });
}

function fastlyNativeDescriptor() {
  return fastlyToolchain.createDriver({
    buildJavascriptTargetSupportEvidence() {
      throw new Error('E4 must not infer Native support from JavaScript support.');
    },
  }).targets.native;
}

function assertImplementationBoundaries() {
  const cryptoSeal = readJson('wasm/.test-results/crypto-c4/phase-c-seal.json');
  const nativeAudit = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json',
  );
  const targetDescriptors = Object.freeze([
    Object.freeze({ id: 'node-javascript', value: NODE_JAVASCRIPT_TARGET_DESCRIPTOR }),
    Object.freeze({ id: 'fastly-javascript', value: FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR }),
    Object.freeze({ id: 'node-native', value: NODE_NATIVE_TARGET_DESCRIPTOR }),
    Object.freeze({ id: 'fastly-native', value: fastlyNativeDescriptor() }),
  ]);
  assert.equal(cryptoSeal.boundaries.guestLinkRequiredForHs256, false);
  assert.equal(cryptoSeal.boundaries.guestLinkedCrypto, false);
  assert.equal(nativeAudit.rustGuestUnitRequired, false);
  assert.equal(nativeAudit.guestSourceImplementationPresent, true);
  assert.ok(nativeAudit.local.every((entry) => entry.guestUnits === 0));
  assert.ok(nativeAudit.fastly.every(
    (entry) => entry.guestLinkedUnitRequired === false,
  ));
  assert.equal(
    pulseJwtManifest.modes.wasm.realization.guestUnitRequired,
    false,
  );
  assert.deepEqual(jwtContracts.JWT_IMPLEMENTED_ALGORITHMS, ['HS256']);
  assert.deepEqual(cryptoContracts.CRYPTO_ALGORITHMS, ['HS256']);
  assert.deepEqual(
    pulseJwtManifest.modes.wasm.realization.algorithms,
    ['HS256'],
  );
  for (const descriptor of targetDescriptors) {
    assert.deepEqual(
      descriptor.value.crypto.algorithms.map((entry) => entry.algorithm),
      ['HS256'],
      descriptor.id,
    );
    assert.equal(descriptor.value.automaticFallback, false, descriptor.id);
    if (descriptor.value.realizations) {
      assert.deepEqual(
        descriptor.value.realizations.flatMap((entry) => entry.algorithms),
        ['HS256'],
        descriptor.id,
      );
      assert.ok(descriptor.value.realizations.every(
        (entry) => entry.guestUnitRequired === false,
      ));
    }
  }
  return Object.freeze({
    status: 'passed',
    hs256GuestLinkOptional: true,
    guestLinkRequiredForHs256: false,
    nativeRealization: 'guest-source:pulse-hmac-as',
    nativeGuestUnits: 0,
    publicJwtAlgorithmVocabulary: Object.freeze([...jwtContracts.JWT_ALGORITHMS]),
    executableJwtAlgorithms: Object.freeze([
      ...jwtContracts.JWT_IMPLEMENTED_ALGORITHMS,
    ]),
    executableCryptoAlgorithms: Object.freeze([...cryptoContracts.CRYPTO_ALGORITHMS]),
    asymmetricImplementationPresent: false,
    automaticFallback: false,
    targetDescriptors: Object.freeze(targetDescriptors.map((entry) => Object.freeze({
      id: entry.id,
      algorithms: Object.freeze(
        entry.value.crypto.algorithms.map((algorithm) => algorithm.algorithm),
      ),
      automaticFallback: entry.value.automaticFallback,
    }))),
  });
}

function assertSecurityAudits() {
  const e1Redaction = readJson(
    'wasm/.test-results/jwt-e1/jwt-javascript-redaction-report.json',
  );
  const e2Redaction = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-redaction-report.json',
  );
  const order = readJson(
    'wasm/.test-results/jwt-e3/jwt-fail-closed-order-report.json',
  );
  const noFallback = readJson(
    'wasm/.test-results/jwt-e3/jwt-no-fallback-audit-report.json',
  );
  const redaction = readJson(
    'wasm/.test-results/jwt-e3/jwt-redaction-audit-report.json',
  );
  for (const report of [e1Redaction, e2Redaction, order, noFallback, redaction]) {
    assert.equal(report.status, 'passed');
  }
  assert.equal(e1Redaction.forbiddenValuesPresent, 0);
  assert.equal(e2Redaction.forbiddenValuesPresent, 0);
  assert.equal(redaction.forbiddenValuesPresent, 0);
  assert.ok(Object.values(order.acceptance).every(Boolean));
  assert.ok(Object.entries(noFallback.acceptance).every(
    ([key, value]) => key === 'automaticFallback' ? value === false : value === true,
  ));
  assert.equal(
    order.acceptance.invalidAuthenticityPreventsClaimExposure,
    true,
  );
  assert.equal(noFallback.acceptance.automaticFallback, false);
  return Object.freeze({
    status: 'passed',
    claimsUnavailableBeforeAuthenticity: true,
    registeredClaimsBeforeSchema: true,
    invalidSignatureDistinctFromRealizationFailure: true,
    redactedReports: Object.freeze({
      javascript: e1Redaction.status,
      native: e2Redaction.status,
      aggregateAudit: redaction.status,
      forbiddenValuesPresent: 0,
    }),
    automaticFallback: false,
  });
}

function assertProductionBoundary() {
  const javascriptReality = readJson(
    'wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json',
  );
  const nativeReality = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-target-reality-report.json',
  );
  const releaseManifest = readJson('release/pulse-release-manifest.json');
  const commands = [
    javascriptReality.fastly.command,
    ...nativeReality.fastlyModes.map((mode) => mode.runtime.command),
  ];
  for (const command of commands) {
    const joined = command.join(' ');
    assert.match(joined, /\bfastly compute serve\b/);
    assert.doesNotMatch(joined, /\b(?:publish|deploy|activate)\b/);
  }
  assert.equal(releaseManifest.releaseVersion, '1.0.0-beta.1');
  assert.equal(
    releaseManifest.packages.some((entry) => entry.name === '@pulse-compute/jwt'),
    false,
  );
  assert.equal(
    releaseManifest.packages.some((entry) => entry.name === '@pulse-compute/crypto'),
    false,
  );
  const jwtPackage = readJson('packages/jwt/package.json');
  const cryptoPackage = readJson('packages/crypto/package.json');
  assert.equal(jwtPackage.version, '1.0.0-beta.1');
  assert.equal(cryptoPackage.version, '1.0.0-beta.1');
  return Object.freeze({
    status: 'passed',
    productionPublication: false,
    productionDeployment: false,
    productionActivation: false,
    observedRealityCommand: 'fastly compute serve',
    releaseCatalogMutation: false,
    workingCandidateVersion: '1.0.0-beta.1',
    frozenReleaseCatalogVersion: releaseManifest.releaseVersion,
    releaseCatalogContainsJwtOrCryptoCandidate: false,
  });
}

function assertAggregateReport(relativeFile) {
  const report = readJson(relativeFile);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.profiles, REQUIRED_PROFILES);
  assert.equal(report.currentTask, null);
  assert.equal(report.completedTasks, report.selectedTasks.length);
  assert.equal(report.results.length, report.selectedTasks.length);
  assert.ok(report.results.every((entry) => entry.status === 'passed'));
  assert.ok(report.results.every((entry) => entry.remainingProcessTree.length === 0));
  return Object.freeze({
    status: 'passed',
    profiles: Object.freeze([...report.profiles]),
    selectedTasks: report.selectedTasks.length,
    completedTasks: report.completedTasks,
    durationMs: report.durationMs,
    report: fileRecord(relativeFile),
  });
}

function assertNoSensitiveValues(corpus, namedValues) {
  const forbidden = forbiddenSensitiveValues(corpus);
  for (const [name, value] of Object.entries(namedValues)) {
    const serialized = typeof value === 'string' ? value : stableJson(value);
    assert.equal(serialized.includes(repoRoot), false, `${name}:repo-root`);
    for (const entry of forbidden) {
      assert.equal(serialized.includes(entry.value), false, `${name}:${entry.id}`);
    }
  }
}

function reusableCorpusStages() {
  const specs = Object.freeze([
    Object.freeze({
      id: 'complete-javascript-corpus',
      evidence: 'wasm/.test-results/jwt-e1/jwt-e1-evidence.json',
      report: 'wasm/.test-results/jwt-e1/jwt-javascript-conformance-report.json',
      version: 'pulse.jwt-e1-evidence.v1',
      executions: 70,
    }),
    Object.freeze({
      id: 'complete-native-corpus',
      evidence: 'wasm/.test-results/jwt-e2/jwt-e2-evidence.json',
      report: 'wasm/.test-results/jwt-e2/jwt-native-conformance-report.json',
      version: 'pulse.jwt-e2-evidence.v1',
      executions: 140,
    }),
    Object.freeze({
      id: 'fail-closed-audit',
      evidence: 'wasm/.test-results/jwt-e3/jwt-e3-evidence.json',
      report: null,
      version: 'pulse.jwt-e3-evidence.v1',
      executions: null,
    }),
  ]);
  let previousMtime = 0;
  return Object.freeze(specs.map((spec) => {
    const evidence = readJson(spec.evidence);
    const mtimeMs = fs.statSync(path.join(repoRoot, spec.evidence)).mtimeMs;
    assert.equal(evidence.version, spec.version);
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.classification, 'PASS');
    assert.ok(mtimeMs >= previousMtime, `${spec.id} evidence must be ordered`);
    assert.ok(
      Date.now() - mtimeMs < 4 * 60 * 60 * 1000,
      `${spec.id} evidence is not fresh enough to resume`,
    );
    previousMtime = mtimeMs;
    if (spec.report) {
      const report = readJson(spec.report);
      assert.equal(report.status, 'passed');
      assert.equal(report.classification, 'PASS');
      assert.equal(report.completedExecutions, spec.executions);
      assert.equal(report.skippedExecutions, 0);
    }
    verifyReportReferences(evidence);
    return Object.freeze({
      id: spec.id,
      status: 'passed',
      durationMs: null,
      completedExecutions: spec.executions,
      skippedExecutions: spec.executions === null ? null : 0,
      disposition: 'fresh-hash-checked-output-from-interrupted-e4-run',
    });
  }));
}

function runCorpusAndValidation(outputDirectory, resumeCorpus) {
  const runner = path.join(wasmRoot, 'scripts', 'run-wasm-tests.cjs');
  const typescript = require.resolve('typescript/bin/tsc');
  const vitest = path.join(path.dirname(require.resolve('vitest')), 'vitest.mjs');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const aggregateFile = path.join(
    outputDirectory,
    'aggregate',
    'relevant-aggregate.json',
  );

  const corpusStages = resumeCorpus ? reusableCorpusStages() : Object.freeze([
    runStage(
      'complete-javascript-corpus',
      process.execPath,
      ['wasm/test/jwt/assert-jwt-javascript-reality.cjs'],
      {
        timeoutMs: 1_200_000,
        assertOutput(output) {
          assert.match(output, /(?:JWT E1 passed|pulse\.jwt-e1-evidence\.v1 PASS) 70\/70/);
          return Object.freeze({ completedExecutions: 70, skippedExecutions: 0 });
        },
      },
    ),
    runStage(
      'complete-native-corpus',
      process.execPath,
      ['wasm/test/jwt/assert-jwt-native-reality.cjs'],
      {
        timeoutMs: 1_200_000,
        assertOutput(output) {
          assert.match(output, /JWT E2 passed 140\/140/);
          return Object.freeze({ completedExecutions: 140, skippedExecutions: 0 });
        },
      },
    ),
    runStage(
      'fail-closed-audit',
      process.execPath,
      ['wasm/test/jwt/assert-jwt-fail-closed-audit.cjs'],
      { timeoutMs: 300_000 },
    ),
  ]);

  const focusedStages = Object.freeze([
    runStage(
      'jwt-crypto-package-build',
      process.execPath,
      [
        typescript,
        '-b',
        'packages/crypto/tsconfig.json',
        'packages/jwt/tsconfig.json',
      ],
    ),
    runStage(
      'jwt-public-type-contract',
      process.execPath,
      [typescript, '-p', 'packages/jwt/tsconfig.types.json', '--noEmit'],
    ),
    runStage(
      'jwt-crypto-focused-tests',
      process.execPath,
      [
        vitest,
        'run',
        '--root',
        repoRoot,
        'packages/crypto/test',
        'packages/jwt/test',
      ],
      {
        timeoutMs: 300_000,
        assertOutput(output) {
          const files = /Test Files\s+(\d+) passed/.exec(output);
          const tests = /Tests\s+(\d+) passed/.exec(output);
          assert.ok(files);
          assert.ok(tests);
          return Object.freeze({
            testFiles: Number(files[1]),
            tests: Number(tests[1]),
          });
        },
      },
    ),
    runStage(
      'focused-jwt-crypto-compiler-target-suites',
      process.execPath,
      [
        runner,
        ...FOCUSED_TASKS.flatMap((task) => ['--task', task]),
        '--no-report',
      ],
      {
        timeoutMs: 1_200_000,
        assertOutput(output) {
          for (const task of FOCUSED_TASKS) {
            assert.match(output, new RegExp(`${task}: passed`));
          }
          return Object.freeze({
            tasks: FOCUSED_TASKS.length,
            taskIds: FOCUSED_TASKS,
          });
        },
      },
    ),
  ]);

  const aggregateStage = runStage(
    'relevant-aggregate-once',
    process.execPath,
    [
      runner,
      ...REQUIRED_PROFILES.flatMap((profile) => ['--profile', profile]),
      '--report',
      aggregateFile,
    ],
    {
      timeoutMs: 1_800_000,
      assertOutput(output) {
        assert.match(output, /passed/);
        return Object.freeze({ profiles: REQUIRED_PROFILES.length });
      },
    },
  );

  const documentationStages = Object.freeze([
    runStage(
      'documentation-sync-and-site-check',
      npm,
      ['run', 'docs:check'],
      { timeoutMs: 600_000 },
    ),
    runVersionSkewAwareStage(
      'documentation-release-validation',
      process.execPath,
      ['scripts/documentation-release.cjs'],
      { timeoutMs: 1_200_000 },
    ),
  ]);
  const maintainerStage = runVersionSkewAwareStage(
    'maintainer-control-plane',
    npm,
    ['run', 'maintainer:check'],
    { timeoutMs: 600_000 },
  );

  return Object.freeze({
    corpusStages,
    focusedStages,
    aggregateStage,
    documentationStages,
    maintainerStage,
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  for (const file of OWNED_OUTPUTS) {
    fs.rmSync(path.join(options.outputDirectory, file), { force: true });
  }
  fs.rmSync(path.join(options.outputDirectory, 'aggregate'), {
    recursive: true,
    force: true,
  });

  const validation = runCorpusAndValidation(
    options.outputDirectory,
    options.resumeCorpus,
  );
  const corpus = loadJwtConformanceCorpus();
  const matrix = assertTargetMatrix(corpus);
  const impact = assertArtifactImpact();
  const inspectedReports = inspectReports();
  const reportReferences = assertPredecessorReferences();
  const rustGuestProof = assertRustGuestProof();
  const implementationBoundaries = assertImplementationBoundaries();
  const securityAudits = assertSecurityAudits();
  const productionBoundary = assertProductionBoundary();

  const matrixSerialized = stableJson(matrix);
  const impactSerialized = stableJson(impact);
  assertNoSensitiveValues(corpus, {
    matrix: matrixSerialized,
    impact: impactSerialized,
  });
  const matrixFile = path.join(
    options.outputDirectory,
    'jwt-target-matrix-report.json',
  );
  const impactFile = path.join(
    options.outputDirectory,
    'jwt-artifact-impact-report.json',
  );
  fs.writeFileSync(matrixFile, matrixSerialized);
  fs.writeFileSync(impactFile, impactSerialized);

  const aggregateSource = path.join(
    options.outputDirectory,
    'aggregate',
    'relevant-aggregate.json',
  );
  const aggregateTarget = path.join(
    options.outputDirectory,
    'relevant-aggregate.json',
  );
  fs.copyFileSync(aggregateSource, aggregateTarget);
  const aggregateRelative = path.relative(
    repoRoot,
    aggregateTarget,
  ).replace(/\\/g, '/');
  const aggregate = assertAggregateReport(aggregateRelative);
  fs.rmSync(path.join(options.outputDirectory, 'aggregate'), {
    recursive: true,
    force: true,
  });

  const documentationKnownSkew = validation.documentationStages
    .some((stage) => stage.knownVersionSkew);
  const maintainerKnownSkew = validation.maintainerStage.knownVersionSkew;
  assert.equal(
    documentationKnownSkew || maintainerKnownSkew,
    true,
    'The current 1.0.0-beta.1/1.0.0-beta.1 skew must remain explicit until F0.',
  );

  const seal = Object.freeze({
    version: SEAL_VERSION,
    checkpoint: 'E4',
    phase: 'E',
    status: 'passed',
    classification: 'PASS',
    scope: Object.freeze({
      operation: 'cross-target JWT-to-crypto Phase E seal',
      changeClass: 'evidence-and-hardening',
      productionSemanticsChanged: false,
      publicContractsChanged: false,
      publication: false,
      deployment: false,
      activation: false,
    }),
    gates: Object.freeze([
      Object.freeze({ id: 'complete-shared-corpus', status: 'passed' }),
      Object.freeze({ id: 'four-required-proof-cells', status: 'passed' }),
      Object.freeze({ id: 'focused-suites', status: 'passed' }),
      Object.freeze({ id: 'relevant-aggregate', status: 'passed' }),
      Object.freeze({ id: 'report-inventory-and-hashes', status: 'passed' }),
      Object.freeze({ id: 'artifact-size-and-build-time', status: 'passed' }),
      Object.freeze({ id: 'independent-rust-guest-proof', status: 'passed' }),
      Object.freeze({ id: 'guest-link-optional-for-hs256', status: 'passed' }),
      Object.freeze({ id: 'no-asymmetric-implementation', status: 'passed' }),
      Object.freeze({ id: 'no-fallback', status: 'passed' }),
      Object.freeze({ id: 'claims-unavailable-before-authenticity', status: 'passed' }),
      Object.freeze({ id: 'redaction', status: 'passed' }),
      Object.freeze({ id: 'no-production-action', status: 'passed' }),
      Object.freeze({ id: 'documentation-sync', status: 'passed' }),
    ]),
    matrix: Object.freeze({
      report: Object.freeze({
        file: 'wasm/.test-results/jwt-e4/jwt-target-matrix-report.json',
        bytes: Buffer.byteLength(matrixSerialized),
        sha256: sha256(matrixSerialized),
      }),
      requiredCells: 4,
      passedCells: 4,
      blockedCells: 0,
      additionalCellsDeclared: 0,
      additionalCellDisposition: 'no-additional-cells-declared',
      completedExecutions: matrix.corpus.completedExecutions,
      skippedExecutions: 0,
    }),
    artifactImpact: Object.freeze({
      report: Object.freeze({
        file: 'wasm/.test-results/jwt-e4/jwt-artifact-impact-report.json',
        bytes: Buffer.byteLength(impactSerialized),
        sha256: sha256(impactSerialized),
      }),
      targetModeRows: impact.targets.length,
      benchmarkClaimed: false,
    }),
    validation: Object.freeze({
      corpusStages: validation.corpusStages,
      focusedStages: validation.focusedStages,
      aggregateStage: validation.aggregateStage,
      aggregate,
      documentation: Object.freeze({
        publicContractsChanged: false,
        stages: validation.documentationStages,
      }),
      maintainer: validation.maintainerStage,
    }),
    inspectedEvidence: inspectedReports,
    reportReferences,
    rustGuestProof,
    implementationBoundaries,
    securityAudits,
    productionBoundary,
    finalArtifactRealization: Object.freeze({
      status: 'passed',
      javascriptExactSelection: true,
      javascriptRuntimeBuiltinObserved: true,
      nativeExactFinalArtifactsAuditedAndExecuted: true,
      nativeGuestSourceImplementationPresent: true,
      automaticFallback: false,
    }),
    phaseEPassCriteria: Object.freeze({
      fourRequiredCellsPass: true,
      additionalCellsHonestlyClassified: true,
      noFallback: true,
      claimsUnavailableBeforeAuthenticity: true,
      reportsRedacted: true,
      finalArtifactsMatchRealization: true,
    }),
    versionDecision: Object.freeze({
      workingCandidate: '1.0.0-beta.1',
      frozenReleaseCatalog: '1.0.0-beta.1',
      resolution: 'retain-source-candidate-and-do-not-mutate-frozen-catalog',
      phaseEImpact: 'non-blocking',
      publicationImpact: 'blocking-until-f0-alignment',
    }),
    knownExceptions: Object.freeze([
      Object.freeze({
        id: 'frozen-release-catalog-source-candidate-skew',
        observed: EXPECTED_VERSION_SKEW,
        resolution: 'accepted-for-phase-e-with-frozen-release-catalog-unchanged',
        blocksPhaseE: false,
        blocksPublication: true,
      }),
    ]),
    nextAuthorizedPhase: 'F',
    nextAuthorizedCheckpoint: 'F0',
  });
  const sealSerialized = stableJson(seal);
  assertNoSensitiveValues(corpus, {
    aggregate: fs.readFileSync(
      path.join(options.outputDirectory, 'relevant-aggregate.json'),
      'utf8',
    ),
    seal: sealSerialized,
  });
  const sealFile = path.join(options.outputDirectory, 'jwt-phase-e-seal.json');
  fs.writeFileSync(sealFile, sealSerialized);

  const changedFiles = Object.freeze([
    'wasm/test/crypto/assert-crypto-cross-target-conformance.cjs',
    'wasm/test/jwt/assert-jwt-native-reality.cjs',
    'wasm/test/jwt/assert-jwt-phase-e-seal.cjs',
    'wasm/test/jwt/README.md',
    'wasm/test/suite/registry.cjs',
    'wasm/test/suite/assert-suite-shape.cjs',
  ].map(fileRecord));
  const evidence = Object.freeze({
    version: EVIDENCE_VERSION,
    checkpoint: 'E4',
    phase: 'E',
    status: 'passed',
    classification: 'PASS',
    scope: seal.scope,
    corpus: Object.freeze({
      version: corpus.version,
      sha256: fileSha256(
        path.join(__dirname, 'jwt-conformance-corpus.json'),
      ),
      semanticHash: corpus.corpusHash,
      cases: corpus.cases.length,
      executions: matrix.corpus.completedExecutions,
      skipped: 0,
    }),
    acceptance: seal.phaseEPassCriteria,
    reports: Object.freeze({
      matrix: seal.matrix.report,
      artifactImpact: seal.artifactImpact.report,
      aggregate: aggregate.report,
      phaseSeal: Object.freeze({
        file: 'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
        sha256: fileSha256(sealFile),
      }),
    }),
    sources: changedFiles,
    versionDecision: seal.versionDecision,
    nextAuthorizedPhase: 'F',
    nextAuthorizedCheckpoint: 'F0',
  });
  const evidenceSerialized = stableJson(evidence);
  assertNoSensitiveValues(corpus, { evidence: evidenceSerialized });
  fs.writeFileSync(
    path.join(options.outputDirectory, 'jwt-e4-evidence.json'),
    evidenceSerialized,
  );
  process.stdout.write(
    'ok - Phase E PASS: four required JWT target cells passed 210/210 ' +
    'shared-corpus executions with zero skips, exact realizations, redacted ' +
    'fail-closed evidence, and no fallback; Phase F is authorized\n',
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
}
