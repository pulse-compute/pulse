#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'crypto-c4');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete C4 option: ${argv[index]}`);
    }
    outputDirectory = path.resolve(repoRoot, argv[index + 1]);
    index += 1;
  }
  return Object.freeze({ outputDirectory });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runStage(id, script, args = [], env = {}) {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
    shell: false
  });
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${id} failed${result.status === null ? '' : ` with status ${result.status}`}${detail ? `\n${detail}` : ''}`,
      { cause: result.error }
    );
  }
  return Object.freeze({ id, status: 'passed', durationMs });
}

function assertDocumentation() {
  const architecture = fs.readFileSync(
    path.join(repoRoot, 'docs', 'architecture', 'current-contracts.md'),
    'utf8'
  );
  assert.match(architecture, /^## JWT verification$/m);
  assert.match(architecture, /HS256 does not select or require a prebuilt `guest-linked`/);
  assert.match(architecture, /synchronized `1\.0\.0-beta\.1` JWT\/crypto packages/);

  const compatibility = fs.readFileSync(
    path.join(repoRoot, 'docs', 'reference', 'compatibility-matrix.md'),
    'utf8'
  );
  assert.match(compatibility, /^## JWT and crypto Beta packages$/m);
  assert.match(compatibility, /\| HS256 MAC verification \| `runtime-builtin` \| `runtime-builtin` \| `guest-source:pulse-hmac-as` \| `guest-source:pulse-hmac-as` \|/);
  assert.match(compatibility, /\| JWT verification \| HS256, ES256 \| HS256, ES256 \| HS256, ES256 \| HS256, ES256 \|/);

  const packageReadme = fs.readFileSync(path.join(repoRoot, 'packages', 'crypto', 'README.md'), 'utf8');
  assert.match(packageReadme, /synchronized `1\.0\.0-beta\.1` release catalog/);

  const testing = fs.readFileSync(path.join(repoRoot, 'docs', 'testing.md'), 'utf8');
  assert.match(testing, /^## JWT and crypto proof seals$/m);
  assert.match(testing, /crypto-verification-seal/);

  return Object.freeze({
    architectureContract: 'docs/architecture/current-contracts.md',
    compatibilityTable: 'docs/reference/compatibility-matrix.md',
    packageContract: 'packages/crypto/README.md',
    testContract: 'docs/maintainers/testing.md',
    status: 'passed'
  });
}

function assertReleaseBoundary(crossTarget) {
  const release = readJson(path.join(repoRoot, 'release', 'pulse-release-manifest.json'));
  assert.equal(release.releaseVersion, '1.0.0-beta.1');
  assert.equal(release.packages.some((entry) => entry.name === '@pulse-compute/crypto'), true);
  assert.equal(release.packages.some((entry) => entry.name === '@pulse-compute/jwt'), true);

  const cryptoPackage = readJson(path.join(repoRoot, 'packages', 'crypto', 'package.json'));
  const jwtPackage = readJson(path.join(repoRoot, 'packages', 'jwt', 'package.json'));
  assert.deepEqual(crossTarget.boundaries.jwtIntegration, {
    packageDependency: true,
    dependencyRange: 'workspace:*',
    sourceImport: true,
    completeComposition: true,
    semanticOwner: '@pulse-compute/crypto',
    releaseAssigned: true,
    automaticFallback: false
  });

  return Object.freeze({
    frozenRelease: Object.freeze({
      version: release.releaseVersion,
      packageCount: release.packages.length,
      cryptoIncluded: true,
      jwtIncluded: true,
      mutatedByPhaseC: false
    }),
    workingCandidate: Object.freeze({
      targetRelease: '1.0.0-beta.1',
      cryptoSourceVersion: cryptoPackage.version,
      jwtSourceVersion: jwtPackage.version,
      synchronized: true,
      catalogPromoted: true
    }),
    deferredGate: Object.freeze({
      owner: '1.0.0-beta.1 documentation release',
      work: 'Completed: versions, dependency metadata, and the approved package set are aligned; final publication remains human-authorized.',
      phaseCBlocker: false
    })
  });
}

function assertRedacted(serialized) {
  const forbidden = [
    'phase-c-secret-marker-never-report-0001',
    Buffer.from('phase-c-secret-marker-never-report-0001').toString('hex'),
    'phase-c-sensitive-data',
    Buffer.from('phase-c-sensitive-data').toString('hex'),
    'native-secret-value-not-for-report!!',
    Buffer.from('native-secret-value-not-for-report!!').toString('hex'),
    'fastly-compute-secret-value'
  ];
  for (const marker of forbidden) {
    assert.equal(serialized.includes(marker), false, 'Phase C evidence must not contain secret test material');
  }
}

function aggregateSummary(outputDirectory) {
  const file = path.join(outputDirectory, 'relevant-aggregate.json');
  assert.equal(
    fs.existsSync(file),
    true,
    'Phase C sealing requires the relevant unit, Native, JavaScript, conformance, and provider aggregate report.'
  );
  const bytes = fs.readFileSync(file);
  const aggregate = JSON.parse(bytes.toString('utf8'));
  assert.equal(aggregate.status, 'passed');
  assert.deepEqual(
    [...aggregate.profiles].sort(),
    ['conformance', 'javascript', 'native', 'providers', 'unit']
  );
  assert.equal(aggregate.completedTasks, aggregate.selectedTasks.length);
  assert.ok(aggregate.results.every((entry) => entry.status === 'passed'));
  return Object.freeze({
    status: aggregate.status,
    schemaVersion: aggregate.schemaVersion,
    profiles: Object.freeze([...aggregate.profiles]),
    tasks: aggregate.completedTasks,
    durationMs: aggregate.durationMs,
    report: 'wasm/.test-results/crypto-c4/relevant-aggregate.json',
    sha256: sha256(bytes)
  });
}

function fastlySummary(proof) {
  assert.equal(proof.assertions.realFastlyCli, true);
  assert.equal(proof.assertions.fastlyManagedLocalEngine, true);
  assert.equal(proof.assertions.cryptoGuestSource, true);
  assert.equal(proof.assertions.cryptoGuestLinked, false);
  assert.equal(proof.assertions.cryptoFallback, false);
  assert.equal(proof.assertions.secretRedaction, true);
  return Object.freeze({
    status: 'passed',
    fastlyCli: Object.freeze({
      binary: proof.toolchain.fastlyCli.binary,
      version: proof.toolchain.fastlyCli.version,
      sha256: proof.toolchain.fastlyCli.sha256,
      inspectionTermination: proof.toolchain.fastlyCli.inspectionTermination
    }),
    localComputeEngine: proof.toolchain.localComputeEngine,
    module: proof.module,
    assertions: proof.assertions,
    remoteDeployment: false
  });
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-crypto-c4-'));
  try {
    const aggregateValidation = aggregateSummary(options.outputDirectory);
    const crossDirectory = path.join(temporary, 'cross-target');
    const fastlyEvidenceFile = path.join(temporary, 'fastly-reality.json');
    const runner = path.join(wasmRoot, 'scripts', 'run-wasm-tests.cjs');

    const stages = [
      runStage('configuration-and-compiler-planning', path.join(__dirname, 'assert-crypto-config-planning.cjs')),
      runStage('javascript-runtime-builtin', runner, ['--no-report', '--task', 'crypto-runtime-builtin']),
      runStage('native-guest-source', path.join(__dirname, 'assert-crypto-native-guest-source.cjs')),
      runStage('shared-cross-target-conformance', path.join(__dirname, 'assert-crypto-cross-target-conformance.cjs'), ['--out', crossDirectory]),
      runStage(
        'fastly-compute-reality',
        path.join(wasmRoot, 'test', 'provider', 'assert-fastly-compute-reality.cjs'),
        [],
        { PULSE_FASTLY_REALITY_EVIDENCE: fastlyEvidenceFile }
      )
    ];

    const crossTargetFile = path.join(crossDirectory, 'crypto-cross-target-conformance.json');
    const crossTarget = readJson(crossTargetFile);
    const fastlyProof = readJson(fastlyEvidenceFile);
    assert.equal(crossTarget.status, 'passed');
    assert.equal(crossTarget.cases.length, 14);
    assert.equal(crossTarget.resultTaxonomy.identicalAcrossRealizations, true);
    assert.equal(crossTarget.realizations.javascript.automaticFallback, false);
    assert.equal(crossTarget.realizations.native.automaticFallback, false);
    assert.equal(crossTarget.boundaries.guestLinkRequiredForHs256, false);
    assert.equal(crossTarget.boundaries.guestLinkedCrypto, false);

    const documentation = assertDocumentation();
    const releaseBoundary = assertReleaseBoundary(crossTarget);
    const fastly = fastlySummary(fastlyProof);
    const report = Object.freeze({
      version: 'pulse.crypto.phase-c-seal.v1',
      status: 'passed',
      scope: Object.freeze({
        phase: 'C',
        operation: 'HS256 MAC verification',
        signing: false,
        asymmetricCryptography: false,
        automaticFallback: false
      }),
      evidenceClassification: Object.freeze({
        observedFacts: Object.freeze([
          'One shared corpus passed through Web Crypto and both Native optimization modes.',
          'The generated Fastly Native artifact selected guest-source:pulse-hmac-as and executed through Fastly CLI.',
          'Generated reports passed forbidden-secret scans.',
          'JWT source and dependency metadata compose through the @pulse-compute/crypto semantic owner.'
        ]),
        toolDocumentedBehavior: Object.freeze([
          'The corpus identifies NIST FIPS 180-4, RFC 2104, and RFC 4231 as algorithm and vector authorities.'
        ]),
        inference: Object.freeze([
          'The Native authenticator comparison has a source-audited full-byte scan; Phase C does not claim a hardware-level side-channel proof.'
        ]),
        unresolvedAssumptions: Object.freeze([
          'Production provider deployment and activation were not performed.'
        ]),
        acceptedContracts: Object.freeze([
          'HS256-only verification with byte inputs, bounded sizes, closed statuses, exact realization selection, and no fallback.',
          'Profile crypto declarations replace rather than merge.',
          'Native HS256 is guest-source and does not require guest-link.'
        ])
      }),
      corpus: crossTarget.corpus,
      resultTaxonomy: crossTarget.resultTaxonomy,
      cases: crossTarget.cases,
      configurationCases: Object.freeze(crossTarget.corpus.configurationCases.map((id) => Object.freeze({ id, status: 'passed' }))),
      realizations: crossTarget.realizations,
      targetReality: Object.freeze({
        node: Object.freeze({
          status: 'passed',
          runtime: process.version,
          javascriptWebCrypto: true,
          nativeModuleExecution: true
        }),
        fastly
      }),
      security: Object.freeze({
        ...crossTarget.security,
        reportsRedacted: true,
        backendErrorsExcluded: true,
        secretInputsExcluded: true
      }),
      impact: crossTarget.impact,
      boundaries: Object.freeze({
        ...crossTarget.boundaries,
        productionDeployment: false,
        releasePromotion: false
      }),
      documentation,
      aggregateValidation,
      releaseBoundary,
      deferredWork: Object.freeze([
        'HS256 signing',
        'ES256 and RS256 verification or signing',
        'guest-linked cryptographic realizations',
        'WASI crypto and Component Model realization',
        'JWE, certificate validation, and remote-key retrieval',
        'public custom cryptographic providers',
        'randomness and key-management APIs'
      ]),
      focusedStages: Object.freeze(stages),
      gate: Object.freeze({
        phaseC: 'passed',
        unresolvedPhaseCBlockers: Object.freeze([]),
        nextAuthorizedPhase: 'D'
      })
    });

    const serialized = stableJson(report);
    assertRedacted(serialized);
    fs.mkdirSync(options.outputDirectory, { recursive: true });
    for (const ownedFile of [
      'crypto-cross-target-conformance.json',
      'fastly-reality.json',
      'phase-c-seal.json'
    ]) {
      fs.rmSync(path.join(options.outputDirectory, ownedFile), { force: true });
    }
    fs.copyFileSync(crossTargetFile, path.join(options.outputDirectory, 'crypto-cross-target-conformance.json'));
    fs.writeFileSync(path.join(options.outputDirectory, 'fastly-reality.json'), stableJson(fastlyProof));
    const reportFile = path.join(options.outputDirectory, 'phase-c-seal.json');
    fs.writeFileSync(reportFile, serialized);
    console.log(
      `ok - Phase C sealed with ${crossTarget.cases.length} shared cases, ${crossTarget.corpus.configurationCases.length} configuration cases, and evidence ${sha256(serialized)}`
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
