#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const guestLink = require('../../packages/wasm-guest-link/src/index.js');
const { runTool } = require('../../packages/wasm-guest-link/src/toolchain.js');
const fastly = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const fastlyShellSource = path.join(__dirname, 'fixtures', 'final', 'fastly-shell.wat');
const fastlyManifestSource = path.join(__dirname, 'fixtures', 'final', 'fastly.toml');
const expectedFastlyImports = Object.freeze([
  Object.freeze({ module: 'fastly_http_body', name: 'new', kind: 'function' }),
  Object.freeze({ module: 'fastly_http_body', name: 'write', kind: 'function' }),
  Object.freeze({ module: 'fastly_http_resp', name: 'new', kind: 'function' }),
  Object.freeze({ module: 'fastly_http_resp', name: 'status_set', kind: 'function' }),
  Object.freeze({ module: 'fastly_http_resp', name: 'header_insert', kind: 'function' }),
  Object.freeze({ module: 'fastly_http_resp', name: 'send_downstream', kind: 'function' })
]);

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'guest-link-b4');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) throw new Error(`Unknown or incomplete B4 option: ${argv[index]}`);
    outputDirectory = path.resolve(repoRoot, argv[index + 1]);
    index += 1;
  }
  return Object.freeze({ outputDirectory });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function runStage(id, script, args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
    shell: false
  });
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${id} failed${result.status === null ? '' : ` with status ${result.status}`}${detail ? `\n${detail}` : ''}`, {
      cause: result.error
    });
  }
  return Object.freeze({ id, status: 'passed', durationMs });
}

function toolEvidence(inspection) {
  const bytes = fs.readFileSync(inspection.binary);
  return Object.freeze({
    binary: path.basename(inspection.binary),
    version: inspection.version,
    output: inspection.output,
    sha256: sha256(bytes)
  });
}

function responseEvidence(response) {
  const json = JSON.parse(response.body.toString('utf8'));
  return Object.freeze({
    status: response.status,
    contentType: Object.freeze(response.headers
      .filter(([name]) => String(name).toLowerCase() === 'content-type')
      .flatMap(([, value]) => String(value).split(',').map((entry) => entry.trim()).filter(Boolean))),
    bytes: response.body.length,
    sha256: sha256(response.body),
    json
  });
}

async function runExactFastlyReality(coreFile, expected, workDirectory) {
  const started = process.hrtime.bigint();
  const buildDirectory = path.join(workDirectory, 'fastly-exact-core');
  const inspectionDirectory = path.join(buildDirectory, 'inspection');
  const packageRoot = path.join(buildDirectory, 'package');
  const shellFile = path.join(buildDirectory, 'fastly-shell.wasm');
  const mergedFile = path.join(packageRoot, 'guest-link-phase-b-fastly.wasm');
  const manifestFile = path.join(packageRoot, 'fastly.toml');
  fs.mkdirSync(inspectionDirectory, { recursive: true });
  fs.mkdirSync(packageRoot, { recursive: true });
  runTool('wasm-as', [fastlyShellSource, '--mvp-features', '-o', shellFile], {
    cwd: buildDirectory,
    failureMessage: 'Phase B Fastly command shell assembly failed.'
  });
  runTool('wasm-merge', [
    coreFile,
    'env',
    shellFile,
    'pulse_fastly',
    '--mvp-features',
    '--rename-export-conflicts',
    '-o',
    mergedFile
  ], {
    cwd: buildDirectory,
    failureCode: guestLink.diagnosticCodes.linkFailed,
    failureMessage: 'Phase B exact production core could not be connected to the Fastly command shell.'
  });
  fs.copyFileSync(fastlyManifestSource, manifestFile);

  const core = guestLink.inspectWasmFile(coreFile, {
    label: 'phase-b-production-core',
    workDirectory: inspectionDirectory
  });
  const merged = guestLink.inspectWasmFile(mergedFile, {
    label: 'phase-b-fastly-fixture',
    workDirectory: inspectionDirectory
  });
  assert.deepEqual(
    merged.imports.map((entry) => ({ module: entry.module, name: entry.name, kind: entry.kind })),
    expectedFastlyImports
  );
  assert.equal(merged.memories, 1);
  assert.equal(merged.definedMemories, 1);
  assert.equal(merged.importedMemories, 0);
  assert.deepEqual(merged.memoryTypes, [{ minimumPages: 32, maximumPages: 32, shared: false }]);
  assert.equal(merged.hasStart, false);
  assert.deepEqual(merged.features, []);
  assert.ok(merged.exports.some((entry) => entry.name === '_start' && entry.kind === 'function'));
  for (const entry of core.exports) {
    assert.ok(
      merged.exports.some((candidate) => candidate.name === entry.name && candidate.kind === entry.kind),
      `Fastly fixture must preserve production core export ${entry.name}`
    );
  }
  for (const instruction of ['memoryGrow', 'memoryCopy', 'memoryFill', 'memoryInit', 'callIndirect']) {
    assert.equal(merged.instructions[instruction], 0, `Fastly fixture ${instruction}`);
  }

  const cliInspection = fastly.inspectFastlyCli({ env: process.env });
  const viceroyInspection = fastly.inspectViceroy({ env: process.env });
  let server;
  try {
    server = await fastly.startFastlyComputeServe({
      binary: cliInspection.binary,
      viceroyBinary: viceroyInspection.binary,
      packageRoot,
      wasmFile: mergedFile,
      manifestFile,
      env: process.env,
      startTimeoutMs: 120000,
      stopTimeoutMs: 5000
    });
    assert.equal(server.child.spawnfile, cliInspection.binary);
    assert.ok(server.args.includes('--viceroy-path'));
    assert.ok(server.args.includes(viceroyInspection.binary));
    const first = responseEvidence(await fastly.requestFastlyCompute(server, { path: '/', timeoutMs: 45000 }));
    const second = responseEvidence(await fastly.requestFastlyCompute(server, { path: '/', timeoutMs: 45000 }));
    assert.equal(first.status, 200);
    assert.ok(first.contentType.some((entry) => entry.startsWith('application/json')));
    assert.deepEqual(first.json, expected);
    assert.deepEqual(second, first);
    const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
    return Object.freeze({
      stage: Object.freeze({ id: 'exact-production-core-fastly-reality', status: 'passed', durationMs }),
      evidence: Object.freeze({
        coreInput: Object.freeze({ bytes: fs.statSync(coreFile).size, sha256: sha256(fs.readFileSync(coreFile)) }),
        fixture: Object.freeze({ bytes: fs.statSync(mergedFile).size, sha256: sha256(fs.readFileSync(mergedFile)) }),
        toolchain: Object.freeze({
          fastlyCli: toolEvidence(cliInspection),
          viceroy: toolEvidence(viceroyInspection)
        }),
        invocation: Object.freeze({
          command: 'fastly compute serve',
          explicitViceroyOverride: true,
          remoteDeployment: false
        }),
        first,
        second,
        repeatedObservationIdentical: true
      })
    });
  } finally {
    if (server) await server.stop();
  }
}

function assertReleaseBoundary() {
  const release = readJson(path.join(repoRoot, 'release', 'pulse-release-manifest.json'));
  const matches = release.packages.filter((entry) => entry.name === '@pulse-compute/wasm-guest-link');
  assert.equal(matches.length, 1);
  const entry = matches[0];
  assert.equal(entry.dir, 'wasm/packages/wasm-guest-link');
  assert.equal(entry.version, release.releaseVersion);
  assert.equal(entry.role, 'implementation');
  assert.equal(entry.tier, 'implementation');
  assert.match(entry.directInstall, /^No for application projects/);
  assert.deepEqual(entry.entryPoints, ['None for application authors.']);

  const compiler = readJson(path.join(repoRoot, 'wasm', 'packages', 'compiler', 'package.json'));
  assert.equal(compiler.dependencies['@pulse-compute/wasm-guest-link'], 'workspace:*');
  const readiness = readJson(path.join(repoRoot, 'release', 'plugin-readiness.json'));
  assert.equal(readiness.publicPluginApi, false);
  assert.equal(readiness.currentExtensionBoundary.lowerers, 'trusted first-party release packages only');
  const preflight = readJson(path.join(repoRoot, 'release', 'release-preflight.json'));
  const npmNames = preflight.gates.find((gate) => gate.id === 'npm-package-names');
  assert.equal(Object.hasOwn(preflight.npmBootstrap, 'packageCount'), false);
  assert.equal(npmNames.status, 'pending');
  assert.equal(npmNames.requiredBy, 'publication');
  assert.equal(Object.hasOwn(npmNames, 'observedMissing'), false);
  assert.equal(preflight.npmBootstrap.auditEvidence.output, '.pulse-release-preflight/npm-catalog-audit.json');

  const architecture = fs.readFileSync(path.join(repoRoot, 'docs', 'architecture', 'current-contracts.md'), 'utf8');
  assert.match(architecture, /^## Internal prebuilt guest units$/m);
  assert.match(architecture, /public third-party guest APIs\s+do not exist/);
  const packageReadme = fs.readFileSync(path.join(repoRoot, 'wasm', 'packages', 'wasm-guest-link', 'README.md'), 'utf8');
  assert.match(packageReadme, /not an application-author API/);
  assert.match(packageReadme, /does not expose[\s\S]*third-party guest API/);
  return Object.freeze({
    synchronizedPackage: entry.name,
    version: entry.version,
    tier: entry.tier,
    publicPluginApi: readiness.publicPluginApi,
    publicThirdPartyGuestApi: false,
    npmBootstrap: Object.freeze({
      status: 'human-action-required',
      catalogSource: 'release/pulse-release-manifest.json#packages',
      evidenceOutput: preflight.npmBootstrap.auditEvidence.output
    })
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-guest-link-b4-'));
  try {
    const evidenceRoot = path.join(temporary, 'evidence');
    const b1Directory = path.join(evidenceRoot, 'b1');
    const b2Directory = path.join(evidenceRoot, 'b2');
    const b3Directory = path.join(evidenceRoot, 'b3');
    fs.mkdirSync(evidenceRoot, { recursive: true });

    const stageResults = [
      runStage('b1-production-pipeline', path.join(__dirname, 'assert-guest-link-package.cjs'), ['--out', b1Directory]),
      runStage('b2-compiler-materialization', path.join(__dirname, 'assert-b2-materialization-stage.cjs'), [b2Directory]),
      runStage('b3-audit-diagnostics', path.join(__dirname, 'assert-b3-audit-diagnostics.cjs'), ['--out', b3Directory])
    ];

    const b1 = readJson(path.join(b1Directory, 'guest-link-package-report.json'));
    const b1Report = readJson(path.join(b1Directory, 'guest-link-report.json'));
    const b2 = readJson(path.join(b2Directory, 'guest-unit-materialization-proof.json'));
    const b3 = readJson(path.join(b3Directory, 'guest-link-audit-diagnostics-proof.json'));
    const a3 = readJson(path.join(wasmRoot, '.test-results', 'guest-link-a3', 'guest-link-poc-final-audit.json'));
    for (const evidence of [b1, b1Report, b2, b3, a3]) assert.equal(evidence.status, 'passed');

    const finalSha256 = b1.proof.final.sha256;
    assert.equal(finalSha256, b1Report.finalArtifact.sha256);
    assert.equal(finalSha256, b2.finalArtifact.sha256);
    assert.equal(finalSha256, b3.finalArtifact.sha256);
    assert.equal(finalSha256, a3.finalArtifact.sha256);
    assert.equal(a3.fastlyFixture.coreInput.sha256, finalSha256);
    assert.equal(a3.nodeReality.observationsIdentical, true);
    assert.equal(a3.fastlyFixture.reality.repeatedObservationIdentical, true);
    assert.equal(a3.comparison.equal, true);
    const fastlyReality = await runExactFastlyReality(
      path.join(b1Directory, 'canonical-native.wasm'),
      a3.comparison.normalizedNode,
      temporary
    );
    stageResults.push(fastlyReality.stage);
    assert.equal(fastlyReality.evidence.coreInput.sha256, finalSha256);
    const stages = Object.freeze(stageResults);

    const requiredDiagnostics = [
      'abi-mismatch',
      'artifact-hash-mismatch',
      'invalid-metadata',
      'link-failure',
      'memory-policy-mismatch',
      'missing-unit',
      'optimizer-failure',
      'owner-trust-mismatch',
      'post-link-final-audit',
      'start-policy-mismatch',
      'unexpected-export',
      'unexpected-feature',
      'unexpected-import'
    ];
    assert.deepEqual(b3.diagnostics.map((entry) => entry.id).sort(), requiredDiagnostics);
    assert.ok(b3.diagnostics.every((entry) => entry.detailSafe && entry.automaticFallback === false));
    assert.equal(b2.materialization.first, 'created');
    assert.equal(b2.materialization.second, 'reused');
    assert.equal(b2.materialization.afterDeletion, 'recreated');
    assert.equal(b2.materialization.recreatedMaterializationBytesIdentical, true);
    assert.equal(b2.materialization.recreatedFinalArtifactBytesIdentical, true);
    assert.equal(b1.boundary.fallback, false);
    assert.equal(b2.failurePolicy.automaticFallback, false);
    assert.equal(b3.reportCoverage.fallbackDisabled, true);

    const releaseBoundary = assertReleaseBoundary();
    const primaryBytes = b1.proof.inputs.primary.bytes;
    const finalBytes = b1.proof.final.bytes;
    const sizeDeltaBytes = finalBytes - primaryBytes;
    const totalDurationMs = stages.reduce((total, entry) => total + entry.durationMs, 0);
    const report = Object.freeze({
      version: 'pulse.guest-link.phase-b-seal.v1',
      status: 'passed',
      scope: Object.freeze({
        phase: 'B',
        guestUnits: 'synchronized-first-party-package-prebuilt-only',
        memoryContract: b1.contractVersions.memoryAbi,
        fallback: 'disabled'
      }),
      releaseBoundary,
      artifact: Object.freeze({
        primary: b1.proof.inputs.primary,
        memoryOwner: b1.proof.inputs.memoryOwner,
        guest: b1.proof.inputs.guest,
        final: b1.proof.final,
        exactA3ArtifactReproduced: true,
        exactCoreExecutedUnderNodeAndFastly: true
      }),
      fastlyReality: fastlyReality.evidence,
      impact: Object.freeze({
        size: Object.freeze({
          primaryBytes,
          finalBytes,
          deltaBytes: sizeDeltaBytes,
          deltaPercent: Number(((sizeDeltaBytes / primaryBytes) * 100).toFixed(2))
        }),
        selectedUnitBuildStages: Object.freeze([
          'one-static-core-wasm-merge',
          'one-post-link-whole-module-optimization',
          'one-final-independent-binary-audit'
        ]),
        focusedSealWallClock: Object.freeze({
          kind: 'local-observed-wall-clock-not-a-benchmark',
          stages,
          totalDurationMs
        })
      }),
      requiredTests: Object.freeze({
        validPrebuiltProofUnit: 'passed',
        diagnosticCases: Object.freeze(b3.diagnostics),
        deterministicMaterializationReuse: 'passed',
        deletionAndReproducibleRecreation: 'passed',
        nodeExecution: 'passed',
        fastlyComputeServe: 'passed',
        noFallbackAfterSelectedUnitFailure: 'passed'
      }),
      boundaries: Object.freeze({
        arbitrarySourceBuilds: false,
        localGuestOverrides: false,
        runtimeDynamicLoading: false,
        publicSelfRegistration: false,
        publicThirdPartyGuestApi: false,
        remoteDeployment: false
      }),
      gate: Object.freeze({
        phaseB: 'passed',
        unresolved: Object.freeze([]),
        nextAuthorizedPhase: 'C'
      })
    });

    fs.rmSync(options.outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const reportFile = path.join(options.outputDirectory, 'phase-b-seal.json');
    fs.writeFileSync(reportFile, stableJson(report));
    const reportSha256 = sha256(fs.readFileSync(reportFile));
    console.log(`ok - Phase B sealed; final ${finalSha256}, ${requiredDiagnostics.length} negative cases, evidence ${reportSha256}`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
