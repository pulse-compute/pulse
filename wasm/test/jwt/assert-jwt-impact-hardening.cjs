#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const IMPACT_VERSION = 'pulse.jwt-impact-assessment.f1.v1';
const HARDENING_VERSION = 'pulse.jwt-production-hardening.f1.v1';
const EVIDENCE_VERSION = 'pulse.jwt-f1-evidence.v1';

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-f1');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT F1 option: ${argv[index]}`);
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

function measurement(value, source, measurementClass = 'observed-sealed-evidence') {
  return Object.freeze({ value, unit: 'bytes', measurementClass, source });
}

function duration(value, source, measurementClass = 'observed-sealed-evidence') {
  return Object.freeze({ value, unit: 'milliseconds', measurementClass, source });
}

function percentDifference(baseline, candidate) {
  return Number((((candidate - baseline) / baseline) * 100).toFixed(2));
}

function sizeReduction(baseline, optimized) {
  assert.ok(baseline > optimized);
  return Object.freeze({
    bytes: baseline - optimized,
    percent: Number((((baseline - optimized) / baseline) * 100).toFixed(2)),
  });
}

function executableJavaScriptClosure(javascriptReality) {
  const packagePrefixes = Object.freeze([
    'packages/crypto/dist/',
    'packages/jwt/dist/',
  ]);
  const files = javascriptReality.fastly.bundle.inputs
    .filter((file) => packagePrefixes.some((prefix) => file.startsWith(prefix)))
    .filter((file) => file.endsWith('.js'))
    .sort();
  assert.equal(new Set(files).size, files.length);
  const records = files.map((file) => {
    const record = fileRecord(file);
    const bytes = fs.readFileSync(path.join(repoRoot, file));
    return Object.freeze({
      ...record,
      gzipBytes: zlib.gzipSync(bytes, { level: 9, mtime: 0 }).byteLength,
      package: file.startsWith('packages/crypto/')
        ? '@pulse-compute/crypto'
        : '@pulse-compute/jwt',
    });
  });
  const summarize = (packageName) => {
    const selected = records.filter((record) => record.package === packageName);
    return Object.freeze({
      package: packageName,
      modules: selected.length,
      bytes: selected.reduce((total, record) => total + record.bytes, 0),
      sumOfPerModuleGzipBytes: selected.reduce(
        (total, record) => total + record.gzipBytes,
        0,
      ),
      records: Object.freeze(selected),
    });
  };
  const packages = Object.freeze([
    summarize('@pulse-compute/crypto'),
    summarize('@pulse-compute/jwt'),
  ]);
  assert.equal(packages[0].modules, 5);
  assert.equal(packages[1].modules, 11);
  return Object.freeze({
    measurementClass: 'fresh-file-measurement',
    scope:
      'JavaScript modules from the sealed E1 Fastly bundle input closure; source maps, declarations, and host Web Crypto bytes excluded',
    packages,
    totals: Object.freeze({
      modules: records.length,
      bytes: records.reduce((total, record) => total + record.bytes, 0),
      sumOfPerModuleGzipBytes: records.reduce(
        (total, record) => total + record.gzipBytes,
        0,
      ),
    }),
  });
}

function dependencyImpact(composition, candidate) {
  const jwt = readJson('packages/jwt/package.json');
  const cryptoPackage = readJson('packages/crypto/package.json');
  const providerNode = readJson('packages/provider-node/package.json');
  const providerFastly = readJson('packages/provider-fastly/package.json');
  assert.equal(jwt.dependencies['@pulse-compute/crypto'], 'workspace:*');
  assert.equal(Object.hasOwn(jwt.dependencies, 'jose'), false);
  assert.deepEqual(cryptoPackage.dependencies, undefined);
  for (const provider of [providerNode, providerFastly]) {
    assert.equal(provider.dependencies['@pulse-compute/jwt'], 'workspace:*');
    assert.equal(provider.dependencies['@pulse-compute/crypto'], 'workspace:*');
  }
  assert.equal(composition.dependencyGraph.joseDependencyPresent, false);
  return Object.freeze({
    measurementClass: 'observed-current-manifests-and-sealed-d4-evidence',
    workingCandidateVersion: candidate.candidateVersion,
    candidatePackages: Object.freeze(candidate.packages.map((entry) => Object.freeze({
      name: entry.name,
      version: entry.manifestVersion,
      license: readJson(`${entry.dir}/package.json`).license,
    }))),
    changes: Object.freeze([
      Object.freeze({
        action: 'added-pulse-edge',
        from: '@pulse-compute/jwt',
        to: '@pulse-compute/crypto',
        range: 'workspace:*',
      }),
      Object.freeze({
        action: 'added-worktree-integration-edges',
        from: '@pulse-compute/provider-node',
        to: Object.freeze(['@pulse-compute/jwt', '@pulse-compute/crypto']),
        range: 'workspace:*',
      }),
      Object.freeze({
        action: 'added-worktree-integration-edges',
        from: '@pulse-compute/provider-fastly',
        to: Object.freeze(['@pulse-compute/jwt', '@pulse-compute/crypto']),
        range: 'workspace:*',
      }),
      Object.freeze({
        action: 'removed-external-direct-dependency',
        from: '@pulse-compute/jwt',
        dependency: 'jose',
      }),
    ]),
    newExternalDirectRuntimeDependencies: Object.freeze([]),
    frozenReleaseCatalogChanged: false,
    source: 'wasm/.test-results/jwt-d4/jwt-crypto-composition-report.json',
  });
}

function guestLinkArtifacts(phaseB) {
  const paths = Object.freeze({
    primary: 'wasm/.test-results/guest-link-a2/candidate-primary.wasm',
    memoryOwner: 'wasm/.test-results/guest-link-a2/candidate-memory-owner.wasm',
    guest: 'wasm/.test-results/guest-link-a2/candidate-guest.wasm',
    final: 'wasm/.test-results/guest-link-b1/canonical-native.wasm',
  });
  return Object.freeze(Object.fromEntries(Object.entries(paths).map(([name, file]) => {
    const record = fileRecord(file);
    assert.equal(record.bytes, phaseB.artifact[name].bytes, name);
    assert.equal(record.sha256, phaseB.artifact[name].sha256, name);
    return [name, record];
  })));
}

function buildImpact() {
  const f0 = readJson(
    'wasm/.test-results/jwt-f0/jwt-f0-evidence-consolidation.json',
  );
  const candidate = readJson(
    'wasm/test/jwt/contracts/jwt-crypto-working-candidate.json',
  );
  const composition = readJson(
    'wasm/.test-results/jwt-d4/jwt-crypto-composition-report.json',
  );
  const e4 = readJson('wasm/.test-results/jwt-e4/jwt-phase-e-seal.json');
  const e4Impact = readJson(
    'wasm/.test-results/jwt-e4/jwt-artifact-impact-report.json',
  );
  const javascriptReality = readJson(
    'wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json',
  );
  const nativeReality = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-target-reality-report.json',
  );
  const nativeAudit = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json',
  );
  const cryptoSeal = readJson(
    'wasm/.test-results/crypto-c4/phase-c-seal.json',
  );
  const phaseB = readJson(
    'wasm/.test-results/guest-link-b4/phase-b-seal.json',
  );

  assert.equal(f0.status, 'passed');
  assert.equal(f0.classification, 'PASS');
  assert.equal(f0.nextAuthorizedCheckpoint, 'F1');
  assert.equal(candidate.status, 'unpublished');
  assert.equal(composition.status, 'passed');
  assert.equal(e4.status, 'passed');
  assert.equal(e4.classification, 'PASS');
  assert.equal(e4Impact.status, 'passed');
  assert.equal(javascriptReality.status, 'passed');
  assert.equal(nativeReality.status, 'passed');
  assert.equal(nativeAudit.status, 'passed');
  assert.equal(cryptoSeal.status, 'passed');
  assert.equal(phaseB.status, 'passed');

  const targetRows = new Map(
    e4Impact.targets.map((entry) => [`${entry.targetId}:${entry.mode}`, entry]),
  );
  const nodeDefault = targetRows.get('node-native:default');
  const nodeSize = targetRows.get('node-native:experimental-native-size');
  const fastlyDefault = targetRows.get('fastly-native:default');
  const fastlySize = targetRows.get(
    'fastly-native:experimental-native-size',
  );
  const fastlyJavascript = targetRows.get('fastly-javascript:javascript');
  for (const row of [
    nodeDefault,
    nodeSize,
    fastlyDefault,
    fastlySize,
    fastlyJavascript,
  ]) assert.ok(row);

  assert.equal(
    nativeReality.fastlyCliInspection.timeoutAfterCompleteVersionOutput,
    true,
  );
  assert.equal(
    nativeReality.fastlyCliInspection.countedAsApplicationExecution,
    false,
  );
  assert.ok(nativeReality.fastlyModes.every(
    (entry) =>
      entry.timing.cliInspectionIncludedInApplicationExecution === false,
  ));

  const sourceContribution =
    nativeAudit.realizationContributionAndImpact.default;
  const optimizedSourceContribution =
    nativeAudit.realizationContributionAndImpact['experimental-native-size'];
  for (const field of [
    'jwtSourceContributionBytes',
    'jwtSourceContributionSha256',
    'cryptoSourceContributionBytes',
    'cryptoSourceContributionSha256',
  ]) {
    assert.equal(sourceContribution[field], optimizedSourceContribution[field]);
  }

  return Object.freeze({
    version: IMPACT_VERSION,
    checkpoint: 'F1',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    proofStatus: Object.freeze({
      jwtCryptoLoop: 'PASS',
      source: 'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
      productionReleaseReadiness: 'NOT_READY',
      productionReadinessClaimed: false,
    }),
    measurementPolicy: Object.freeze({
      measuredFactsSeparateFromEstimates: true,
      estimates: Object.freeze([]),
      unavailableValuesUseNull: true,
      derivedValuesNameTheirInputs: true,
      benchmarkClaimed: false,
      oneObservedRunGeneralized: false,
      fastlyInspectionExcludedFromExecutionTiming: true,
    }),
    javascript: Object.freeze({
      executableModuleClosure: executableJavaScriptClosure(javascriptReality),
      historicalCryptoOnlyRuntime: Object.freeze({
        modules: cryptoSeal.impact.javascript.moduleCount,
        bytes: measurement(
          cryptoSeal.impact.javascript.runtimeBytes,
          'wasm/.test-results/crypto-c4/phase-c-seal.json',
        ),
        gzipBytes: measurement(
          cryptoSeal.impact.javascript.gzipBytes,
          'wasm/.test-results/crypto-c4/phase-c-seal.json',
        ),
        note: 'Phase C observation before JWT composition; retained as historical evidence rather than used as a current delta.',
      }),
      fastlySourceBundle: Object.freeze({
        bytes: measurement(
          javascriptReality.fastly.bundle.bytes,
          'wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json',
        ),
        sha256: javascriptReality.fastly.bundle.sha256,
        incrementalJwtDeltaBytes: null,
        deltaDisposition:
          'unavailable: E1 did not preserve a comparable pre-JWT Fastly JavaScript control bundle',
      }),
      fastlyRuntimeArtifact: Object.freeze({
        bytes: measurement(
          fastlyJavascript.artifactBytes,
          'wasm/.test-results/jwt-e4/jwt-artifact-impact-report.json',
        ),
        sha256: fastlyJavascript.artifactSha256,
        incrementalJwtDeltaBytes: null,
        deltaDisposition:
          'unavailable: downstream js-compute runtime bytes include toolchain/runtime payload and no pre-JWT control artifact was sealed',
      }),
      nodeArtifactBytes: null,
      nodeArtifactDisposition:
        'no standalone target artifact is emitted for Node JavaScript',
    }),
    native: Object.freeze({
      guestSource: Object.freeze({
        jwt: measurement(
          sourceContribution.jwtSourceContributionBytes,
          'wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json',
        ),
        jwtSha256: sourceContribution.jwtSourceContributionSha256,
        crypto: measurement(
          sourceContribution.cryptoSourceContributionBytes,
          'wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json',
        ),
        cryptoSha256: sourceContribution.cryptoSourceContributionSha256,
        combined: measurement(
          sourceContribution.jwtSourceContributionBytes +
            sourceContribution.cryptoSourceContributionBytes,
          'derived from sealed JWT and crypto guest-source byte counts',
          'derived-from-observed-measurements',
        ),
        guestLinkedUnits: 0,
      }),
      artifacts: Object.freeze([
        Object.freeze({
          targetId: 'node-native',
          mode: 'default',
          bytes: nodeDefault.artifactBytes,
          sha256: nodeDefault.artifactSha256,
          buildDurationMs: nodeDefault.buildDurationMs,
        }),
        Object.freeze({
          targetId: 'node-native',
          mode: 'experimental-native-size',
          bytes: nodeSize.artifactBytes,
          sha256: nodeSize.artifactSha256,
          buildDurationMs: nodeSize.buildDurationMs,
        }),
        Object.freeze({
          targetId: 'fastly-native',
          mode: 'default',
          bytes: fastlyDefault.artifactBytes,
          sha256: fastlyDefault.artifactSha256,
          controlArtifactBytes: fastlyDefault.controlArtifactBytes,
          jwtCryptoImpactBytes: fastlyDefault.realizationImpactBytes,
          buildDurationMs: fastlyDefault.buildDurationMs,
        }),
        Object.freeze({
          targetId: 'fastly-native',
          mode: 'experimental-native-size',
          bytes: fastlySize.artifactBytes,
          sha256: fastlySize.artifactSha256,
          controlArtifactBytes: fastlySize.controlArtifactBytes,
          jwtCryptoImpactBytes: fastlySize.realizationImpactBytes,
          buildDurationMs: fastlySize.buildDurationMs,
        }),
      ]),
      optimizationComparison: Object.freeze({
        nodeNative: Object.freeze({
          defaultBytes: nodeDefault.artifactBytes,
          sizeOptimizedBytes: nodeSize.artifactBytes,
          reduction: sizeReduction(
            nodeDefault.artifactBytes,
            nodeSize.artifactBytes,
          ),
          sizeOptimizedBuildDurationChangePercent: percentDifference(
            nodeDefault.buildDurationMs,
            nodeSize.buildDurationMs,
          ),
        }),
        fastlyNative: Object.freeze({
          defaultBytes: fastlyDefault.artifactBytes,
          sizeOptimizedBytes: fastlySize.artifactBytes,
          reduction: sizeReduction(
            fastlyDefault.artifactBytes,
            fastlySize.artifactBytes,
          ),
          defaultJwtCryptoImpactBytes: fastlyDefault.realizationImpactBytes,
          sizeOptimizedJwtCryptoImpactBytes: fastlySize.realizationImpactBytes,
          jwtCryptoImpactReduction: sizeReduction(
            fastlyDefault.realizationImpactBytes,
            fastlySize.realizationImpactBytes,
          ),
          sizeOptimizedBuildDurationChangePercent: percentDifference(
            fastlyDefault.buildDurationMs,
            fastlySize.buildDurationMs,
          ),
        }),
        historicalCryptoOnlyDelta: Object.freeze(cryptoSeal.impact.native),
      }),
    }),
    guestLinkProof: Object.freeze({
      measurementClass: 'fresh-hash-verification-of-sealed-phase-b-artifacts',
      artifacts: guestLinkArtifacts(phaseB),
      requiredForHs256: false,
      runtimeImpactBytes: 0,
    }),
    timing: Object.freeze({
      policy: Object.freeze({
        observedSingleRunDurations: true,
        benchmarkClaimed: false,
        fastlyInspectionDurationMs: duration(
          nativeReality.fastlyCliInspection.durationMs,
          'wasm/.test-results/jwt-e2/jwt-native-target-reality-report.json',
        ),
        fastlyInspectionTermination:
          nativeReality.fastlyCliInspection.termination,
        fastlyInspectionCountedAsApplicationExecution: false,
      }),
      javascript: Object.freeze({
        sourceBundleBuildDurationMs: duration(
          javascriptReality.fastly.buildDurationMs,
          'wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json',
        ),
        jsComputeBuildDurationMs: duration(
          javascriptReality.fastly.jsComputeDurationMs,
          'wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json',
        ),
        localServeLifecycleDurationMs: duration(
          javascriptReality.fastly.computeDurationMs,
          'wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json',
        ),
        localServeLifecycleResolution:
          'combined boot, request execution, and teardown; E1 did not preserve separate stage durations',
        requestCount: javascriptReality.fastly.requestCount,
      }),
      native: Object.freeze(nativeReality.fastlyModes.map((entry) =>
        Object.freeze({
          mode: entry.mode,
          buildDurationMs: entry.timing.buildDurationMs,
          engineBootDurationMs: entry.timing.engineBootDurationMs,
          corpusDurationMs: entry.timing.corpusDurationMs,
          teardownDurationMs: entry.timing.teardownDurationMs,
          requestCount: entry.runtime.requestCount,
          cliInspectionIncludedInApplicationExecution: false,
        }))),
      validation: Object.freeze({
        focusedStages: Object.freeze(e4.validation.focusedStages),
        aggregate: Object.freeze({
          profiles: Object.freeze(e4.validation.aggregate.profiles),
          tasks: e4.validation.aggregate.selectedTasks,
          durationMs: e4.validation.aggregate.durationMs,
          report: e4.validation.aggregate.report,
        }),
        completeCorpusStageDurationsMs: null,
        corpusDurationDisposition:
          'unavailable: E4 resumed fresh hash-checked E1/E2 outputs after interruption and retained execution counts but not stage durations',
      }),
    }),
    deterministicArtifacts: Object.freeze({
      promisedAndVerified: Object.freeze([
        ...e4Impact.targets
          .filter((entry) => entry.artifactSha256)
          .map((entry) => Object.freeze({
            targetId: entry.targetId,
            mode: entry.mode,
            bytes: entry.artifactBytes,
            sha256: entry.artifactSha256,
          })),
        ...Object.entries(guestLinkArtifacts(phaseB)).map(([name, record]) =>
          Object.freeze({ targetId: `guest-link-${name}`, ...record })),
      ]),
      planHashes: Object.freeze(nativeReality.canonicalCompilation),
    }),
    packageDependencyGraph: dependencyImpact(composition, candidate),
    unknownOrUnavailableMeasurements: Object.freeze([
      'Incremental Fastly JavaScript bundle and js-compute artifact deltas: no comparable pre-JWT control artifact was sealed.',
      'Node JavaScript target artifact bytes: Node emits no standalone target artifact.',
      'Separate E1 Fastly JavaScript boot, request, and teardown durations: only the combined local-serve lifecycle duration was preserved.',
      'Fresh complete-corpus wall time at E4: resumed E1/E2 outputs retained counts and hashes but not stage durations.',
      'Production traffic latency, throughput, memory, and concurrency behavior: not exercised.',
    ]),
    sources: Object.freeze([
      fileRecord('wasm/.test-results/jwt-f0/jwt-f0-evidence-consolidation.json'),
      fileRecord('wasm/.test-results/jwt-e4/jwt-artifact-impact-report.json'),
      fileRecord('wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json'),
      fileRecord('wasm/.test-results/jwt-e2/jwt-native-target-reality-report.json'),
      fileRecord('wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json'),
      fileRecord('wasm/.test-results/crypto-c4/phase-c-seal.json'),
      fileRecord('wasm/.test-results/guest-link-b4/phase-b-seal.json'),
      fileRecord('wasm/.test-results/jwt-d4/jwt-crypto-composition-report.json'),
    ]),
  });
}

function hardeningItem(value) {
  assert.ok(value.id);
  assert.ok(value.owner);
  assert.ok(value.reason);
  assert.ok(value.nextAction);
  assert.ok(Array.isArray(value.evidence) && value.evidence.length > 0);
  return Object.freeze({
    proofCorrectnessImpact: false,
    productionReleaseReadinessImpact: true,
    ...value,
    evidence: Object.freeze(value.evidence),
  });
}

function buildHardening() {
  const items = Object.freeze([
    hardeningItem({
      id: 'independent-cryptographic-review',
      category: 'cryptographic-implementation-review-depth',
      status: 'required',
      owner: '@pulse-compute/crypto maintainers plus an independent cryptography reviewer',
      reason:
        'The first-party AssemblyScript SHA-256/HMAC implementation has source, vector, bounds, and final-artifact audits, but no independent cryptographic implementation review is recorded.',
      nextAction:
        'Review algorithm implementation, bounds, malformed inputs, compiler output assumptions, and conformance coverage; record findings and dispositions.',
      evidence: [
        'wasm/.test-results/crypto-c4/phase-c-seal.json',
        'wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json',
      ],
    }),
    hardeningItem({
      id: 'side-channel-characterization',
      category: 'side-channel-claims',
      status: 'required',
      owner: '@pulse-compute/crypto maintainers plus target security reviewers',
      reason:
        'The Native authenticator comparison scans every byte, but source inspection and functional timing do not establish hardware-, compiler-, engine-, or target-level constant-time behavior.',
      nextAction:
        'Define the supported side-channel claim, inspect emitted code for each target/toolchain, and run an appropriate differential timing methodology before making a constant-time claim.',
      evidence: [
        'wasm/.test-results/crypto-c4/phase-c-seal.json',
        'wasm/.test-results/jwt-e3/jwt-redaction-audit-report.json',
      ],
    }),
    hardeningItem({
      id: 'bounded-provider-runtime-coverage',
      category: 'provider-runtime-coverage',
      status: 'intentionally-bounded',
      owner: 'provider maintainers',
      reason:
        'The proof covers Node and Fastly in Native and JavaScript modes only. Browser, ESP32, other providers, and production Fastly services are not advertised by this evidence.',
      nextAction:
        'Keep unsupported cells absent from claims; add each new target only through its own explicit capability, conformance, and reality evidence.',
      evidence: [
        'wasm/.test-results/jwt-e4/jwt-target-matrix-report.json',
        'wasm/test/jwt/contracts/jwt-crypto-working-candidate.json',
      ],
      productionReleaseReadinessImpact: false,
    }),
    hardeningItem({
      id: 'production-provider-deployment',
      category: 'production-deployment',
      status: 'not-exercised',
      owner: 'Fastly service owner and human release authority',
      reason:
        'All Fastly observations use local fastly compute serve. No remote service was deployed, activated, observed under production configuration, or rolled back.',
      nextAction:
        'Run a separately authorized deployment canary with reviewed bindings, activation, health, rollback, and retained evidence.',
      evidence: [
        'wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json',
        'wasm/.test-results/jwt-e2/jwt-native-target-reality-report.json',
      ],
    }),
    hardeningItem({
      id: 'external-publication',
      category: 'publication-state',
      status: 'unpublished',
      owner: 'human release authority',
      reason:
        'JWT and crypto are a source working candidate and remain outside the frozen 1.0.0-beta.1 release catalog. F1 has no publication authority.',
      nextAction:
        'Complete separately authorized readiness, snapshot, packed acceptance, publication, and verification workflows before claiming package availability.',
      evidence: [
        'wasm/test/jwt/contracts/jwt-crypto-working-candidate.json',
        'release/pulse-release-manifest.json',
      ],
    }),
    hardeningItem({
      id: 'dependency-license-review',
      category: 'dependency-and-license-review',
      status: 'pending-final-candidate',
      owner: 'release engineering and legal/security reviewers',
      reason:
        'The current graph adds no external direct JWT/crypto runtime dependency and removes jose, but a frozen packed candidate dependency/license inventory and formal dispositions have not been recorded.',
      nextAction:
        'Generate the production dependency and license inventories from the frozen candidate, verify provenance and NOTICE obligations, and record dispositions.',
      evidence: [
        'wasm/.test-results/jwt-d4/jwt-crypto-composition-report.json',
        'wasm/test/jwt/contracts/jwt-crypto-working-candidate.json',
      ],
    }),
    hardeningItem({
      id: 'clean-machine-reproducibility',
      category: 'clean-machine-and-reproducibility',
      status: 'pending',
      owner: 'release engineering',
      reason:
        'Focused and aggregate workspace validation passed, but F1 does not prove packed clean-machine installation, source reconstruction, or byte reproducibility from a frozen checkout.',
      nextAction:
        'Run clean-machine packed-consumer acceptance and deterministic artifact replay from the exact frozen candidate with pinned toolchains.',
      evidence: [
        'wasm/.test-results/jwt-e4/relevant-aggregate.json',
        'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
      ],
    }),
    hardeningItem({
      id: 'load-and-concurrency',
      category: 'long-running-load-and-concurrency',
      status: 'untested',
      owner: 'runtime, provider, and performance maintainers',
      reason:
        'The bounded corpus proves semantic behavior but not sustained throughput, memory stability, concurrent request isolation, engine churn, or rotation under load.',
      nextAction:
        'Define target-specific soak and concurrency scenarios with bounded memory, secret isolation, error-rate, latency, and lifecycle observations.',
      evidence: [
        'wasm/.test-results/jwt-e1/jwt-javascript-conformance-report.json',
        'wasm/.test-results/jwt-e2/jwt-native-conformance-report.json',
      ],
    }),
    hardeningItem({
      id: 'shared-secret-operations',
      category: 'incident-and-rotation-guidance',
      status: 'guidance-missing',
      owner: 'security documentation and provider maintainers',
      reason:
        'The implementation safely resolves request-owned bindings, but operational guidance for key generation, dual-key rotation, revocation, incident response, audit signals, and compromised shared secrets is not yet a current contract.',
      nextAction:
        'Publish provider-specific HS256 secret lifecycle and incident guidance without exposing secret values or implying JWT authorization semantics.',
      evidence: [
        'wasm/.test-results/jwt-e3/jwt-redaction-audit-report.json',
        'packages/jwt/README.md',
      ],
    }),
  ]);
  assert.equal(items.length, 9);
  assert.ok(items.every((entry) => entry.status !== 'complete'));
  return Object.freeze({
    version: HARDENING_VERSION,
    checkpoint: 'F1',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    assessmentMeaning:
      'The required production-hardening inventory is complete; production hardening itself is not complete.',
    proofCorrectness: Object.freeze({
      jwtCryptoLoop: 'PASS',
      changedByAssessment: false,
    }),
    productionReleaseReadiness: Object.freeze({
      classification: 'NOT_READY',
      proofPassIsReleaseReadiness: false,
      inventoryItems: items.length,
      releaseReadinessBlockingItems: items.filter(
        (item) => item.productionReleaseReadinessImpact,
      ).length,
    }),
    items,
    nextAuthorizedCheckpoint: 'F2',
  });
}

function renderDeferredWork(hardening) {
  const lines = [
    '# Phase F deferred production work',
    '',
    'F1 records production hardening separately from proof correctness. The',
    'JWT/crypto closed-loop proof remains PASS; production-release readiness is',
    '**NOT READY**. This document does not authorize publication, deployment,',
    'activation, asymmetric cryptography, or a wider provider claim.',
    '',
    '| Work | Status | Owner | Reason | Next action |',
    '|---|---|---|---|---|',
    ...hardening.items.map((item) => [
      item.category,
      item.status,
      item.owner,
      item.reason,
      item.nextAction,
    ].map((value) => String(value).replaceAll('|', '\\|')).join(' | '))
      .map((row) => `| ${row} |`),
    '',
    '## Evidence boundary',
    '',
    '- Impact measurements: `wasm/.test-results/jwt-f1/jwt-f1-impact-report.json`',
    '- Hardening inventory: `wasm/.test-results/jwt-f1/jwt-f1-production-hardening.json`',
    '- F1 acceptance: `wasm/.test-results/jwt-f1/jwt-f1-evidence.json`',
    '- Cross-target proof: `wasm/.test-results/jwt-e4/jwt-phase-e-seal.json`',
    '- Working candidate: `wasm/test/jwt/contracts/jwt-crypto-working-candidate.json`',
    '',
    'Observed measurements are not benchmarks. Unknown deltas remain unknown;',
    'the Fastly CLI inspection timeout after complete version output is recorded',
    'as tool inspection and excluded from application execution timing.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function writeOutput(outputDirectory, name, contents) {
  const file = path.join(outputDirectory, name);
  fs.writeFileSync(file, contents);
  return fileRecord(
    path.relative(repoRoot, file).replace(/\\/g, '/'),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const impact = buildImpact();
  const hardening = buildHardening();
  const impactRecord = writeOutput(
    options.outputDirectory,
    'jwt-f1-impact-report.json',
    stableJson(impact),
  );
  const hardeningRecord = writeOutput(
    options.outputDirectory,
    'jwt-f1-production-hardening.json',
    stableJson(hardening),
  );
  const deferredRecord = writeOutput(
    options.outputDirectory,
    'phase-f-deferred-work.md',
    renderDeferredWork(hardening),
  );
  const evidence = Object.freeze({
    version: EVIDENCE_VERSION,
    checkpoint: 'F1',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    scope: 'measured-impact-and-production-hardening-assessment',
    reports: Object.freeze({
      impact: impactRecord,
      productionHardening: hardeningRecord,
      deferredWork: deferredRecord,
    }),
    acceptance: Object.freeze({
      measuredFactsSeparatedFromEstimates:
        impact.measurementPolicy.measuredFactsSeparateFromEstimates,
      estimatesRecorded: impact.measurementPolicy.estimates.length,
      fastlyInspectionExcludedFromExecutionTiming:
        impact.measurementPolicy.fastlyInspectionExcludedFromExecutionTiming,
      proofPassMislabeledAsProductionReadiness: false,
      remainingWorkHasOwnerAndReason: hardening.items.every(
        (item) => item.owner && item.reason,
      ),
      productionReleaseReadiness:
        hardening.productionReleaseReadiness.classification,
    }),
    boundaries: Object.freeze({
      implementationChanged: false,
      asymmetricImplementation: false,
      publication: false,
      documentationPromotion: false,
      remoteDeployment: false,
      providerActivation: false,
    }),
    nextAuthorizedCheckpoint: 'F2',
  });
  writeOutput(
    options.outputDirectory,
    'jwt-f1-evidence.json',
    stableJson(evidence),
  );
  process.stdout.write(
    `ok - F1 measured ${impact.native.artifacts.length} Native target/mode artifacts, ` +
    `${impact.javascript.executableModuleClosure.totals.modules} JavaScript modules, ` +
    `${Object.keys(impact.guestLinkProof.artifacts).length} guest-link artifacts, and ` +
    `${hardening.items.length} owned hardening items; production readiness remains NOT_READY\n`,
  );
}

main();
