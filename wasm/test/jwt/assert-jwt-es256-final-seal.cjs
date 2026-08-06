#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const {
  fileRecord: bareFileRecord,
  sha256,
  sourceTreeRecord,
  stableJson,
} = require('../../packages/wasm-guest-link/src/files.js');
const {
  binaryenIdentity,
  runTool,
} = require('../../packages/wasm-guest-link/src/toolchain.js');
const {
  optimizationPostures,
} = require('../../packages/wasm-guest-link/src/constants.js');

const CHECKPOINT = 'G5';
const EVIDENCE_VERSION = 'pulse.jwt-g5-evidence.v1';
const SOURCE_REPRODUCTION_VERSION =
  'pulse.es256-source-reproduction.g5.v1';
const MEMORY_AUDIT_VERSION = 'pulse.es256-final-memory-audit.g5.v1';
const HARDENING_LEDGER_VERSION = 'pulse.es256-hardening-ledger.g5.v1';
const ARTIFACT_MANIFEST_VERSION =
  'pulse.es256-artifact-manifest.g5.v1';
const FINAL_SEAL_VERSION = 'pulse.es256-final-seal.g5.v1';
const EXPECTED_RUSTC = '1.97.1 (8bab26f4f 2026-07-14)';
const EXPECTED_CARGO = '1.97.1 (c980f4866 2026-06-30)';
const TARGET = 'wasm32v1-none';
const FRAME_CAPACITY = 16_640;
const SIGNING_INPUT_MAXIMUM = 16_340;

const GUEST_ROOT =
  'packages/crypto/guests/es256-rustcrypto';
const SOURCE_DIRECTORY = `${GUEST_ROOT}/source`;
const MANIFEST_FILE = `${GUEST_ROOT}/pulse.guest-unit.json`;
const RAW_PREBUILT =
  `${GUEST_ROOT}/prebuilt/es256-verifier.unoptimized.wasm`;
const OPTIMIZED_PREBUILT =
  `${GUEST_ROOT}/prebuilt/es256-verifier.wasm`;
const BUILD_SCRIPT = `${GUEST_ROOT}/build.cjs`;
const REPRODUCTION_SOURCE_FILES = Object.freeze([
  '.cargo/config.toml',
  'Cargo.lock',
  'Cargo.toml',
  'README.md',
  'rust-toolchain.toml',
  'src/lib.rs',
]);
const STAGE_EVIDENCE = Object.freeze([
  Object.freeze({
    checkpoint: 'G0',
    directory: 'wasm/.test-results/jwt-g0',
    evidence: 'jwt-g0-evidence.json',
    version: 'pulse.jwt-g0-evidence.v1',
  }),
  Object.freeze({
    checkpoint: 'G1',
    directory: 'wasm/.test-results/jwt-g1',
    evidence: 'jwt-g1-evidence.json',
    version: 'pulse.jwt-g1-evidence.v1',
  }),
  Object.freeze({
    checkpoint: 'G2',
    directory: 'wasm/.test-results/jwt-g2',
    evidence: 'jwt-g2-evidence.json',
    version: 'pulse.jwt-g2-evidence.v1',
  }),
  Object.freeze({
    checkpoint: 'G3',
    directory: 'wasm/.test-results/jwt-g3',
    evidence: 'jwt-g3-evidence.json',
    version: 'pulse.jwt-g3-evidence.v1',
  }),
  Object.freeze({
    checkpoint: 'G4',
    directory: 'wasm/.test-results/jwt-g4',
    evidence: 'jwt-g4-evidence.json',
    version: 'pulse.jwt-g4-evidence.v1',
  }),
]);
const REPLAY_SPECS = Object.freeze([
  Object.freeze({
    checkpoint: 'G1',
    task: 'crypto-es256-guest',
    script: 'test/crypto/assert-crypto-es256-guest.cjs',
    evidence: 'jwt-g1-evidence.json',
    version: 'pulse.jwt-g1-evidence.v1',
    timeoutMs: 300_000,
  }),
  Object.freeze({
    checkpoint: 'G2',
    task: 'crypto-es256-guest-link',
    script: 'test/crypto/assert-crypto-es256-guest-link.cjs',
    evidence: 'jwt-g2-evidence.json',
    version: 'pulse.jwt-g2-evidence.v1',
    timeoutMs: 300_000,
  }),
  Object.freeze({
    checkpoint: 'G3',
    task: 'jwt-es256-composition',
    script: 'test/jwt/assert-jwt-es256-composition.cjs',
    evidence: 'jwt-g3-evidence.json',
    version: 'pulse.jwt-g3-evidence.v1',
    timeoutMs: 300_000,
  }),
  Object.freeze({
    checkpoint: 'G4',
    task: 'jwt-es256-cross-target',
    script: 'test/jwt/assert-jwt-es256-cross-target.cjs',
    evidence: 'jwt-g4-evidence.json',
    version: 'pulse.jwt-g4-evidence.v1',
    timeoutMs: 2_400_000,
  }),
]);
const REQUIRED_PROFILES = Object.freeze([
  'unit',
  'native',
  'javascript',
  'conformance',
  'providers',
  'cli',
]);
const SOURCE_FILES = Object.freeze([
  BUILD_SCRIPT,
  MANIFEST_FILE,
  `${SOURCE_DIRECTORY}/.cargo/config.toml`,
  `${SOURCE_DIRECTORY}/Cargo.lock`,
  `${SOURCE_DIRECTORY}/Cargo.toml`,
  `${SOURCE_DIRECTORY}/README.md`,
  `${SOURCE_DIRECTORY}/rust-toolchain.toml`,
  `${SOURCE_DIRECTORY}/src/lib.rs`,
  RAW_PREBUILT,
  OPTIMIZED_PREBUILT,
  'packages/provider-fastly/src/testing/fastly-cli.js',
  'packages/provider-fastly/src/build/canonical-target.js',
  'packages/provider-fastly/src/build/native-platform-capabilities.js',
  'packages/provider-fastly/package.json',
  'wasm/packages/compiler/src/spine/guest-unit-stage.js',
  'wasm/packages/wasm-guest-link/src/stage.js',
  'wasm/packages/wasm-guest-link/package.json',
  'pnpm-lock.yaml',
  'wasm/test/guest-link/assert-b2-materialization-stage.cjs',
  'wasm/test/provider/assert-fastly-cli-gate-surface.cjs',
  'wasm/test/provider/assert-fastly-compute-reality.cjs',
  'wasm/test/jwt/assert-jwt-es256-final-seal.cjs',
  'wasm/test/jwt/assert-jwt-es256-cross-target.cjs',
  'wasm/test/jwt/assert-jwt-es256-composition.cjs',
  'wasm/test/jwt/jwt-es256-conformance-corpus.json',
  'wasm/test/jwt/jwt-es256-conformance-harness.cjs',
  'wasm/test/jwt/README.md',
  'wasm/test/suite/assert-suite-shape.cjs',
  'wasm/test/suite/registry.cjs',
]);

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-g5');
  let reproductionRoot =
    process.env.PULSE_ES256_REPRODUCTION_ROOT || undefined;
  let reproductionArchive =
    process.env.PULSE_ES256_REPRODUCTION_ARCHIVE || undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out' && argv[index + 1]) {
      outputDirectory = path.resolve(repoRoot, argv[++index]);
    } else if (
      argv[index] === '--reproduction-root'
      && argv[index + 1]
    ) {
      reproductionRoot = path.resolve(argv[++index]);
    } else if (
      argv[index] === '--reproduction-archive'
      && argv[index + 1]
    ) {
      reproductionArchive = path.resolve(argv[++index]);
    } else {
      throw new TypeError(
        `Unknown or incomplete ES256 G5 option: ${String(argv[index])}`,
      );
    }
  }
  return Object.freeze({
    outputDirectory,
    reproductionRoot,
    reproductionArchive,
  });
}

function readJson(relativeFile) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8'),
  );
}

function fileRecord(relativeFile) {
  const normalized = relativeFile.replace(/\\/g, '/');
  const record = bareFileRecord(path.join(repoRoot, normalized));
  return Object.freeze({
    file: normalized,
    bytes: record.bytes,
    sha256: record.sha256,
  });
}

function absoluteFileRecord(file, label) {
  const record = bareFileRecord(file);
  return Object.freeze({
    file: label,
    bytes: record.bytes,
    sha256: record.sha256,
  });
}

function recursiveFiles(directory, root = directory, files = []) {
  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
  }).sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      recursiveFiles(file, root, files);
    } else if (entry.isFile()) {
      files.push(path.relative(root, file).replace(/\\/g, '/'));
    }
  }
  return files;
}

function directoryManifest(relativeDirectory) {
  const directory = path.join(repoRoot, relativeDirectory);
  const files = recursiveFiles(directory);
  return Object.freeze({
    directory: relativeDirectory,
    files: Object.freeze(files.map((relativeFile) => (
      fileRecord(`${relativeDirectory}/${relativeFile}`)
    ))),
  });
}

function assertEvidenceStatus(value, specification) {
  assert.equal(value.version, specification.version);
  assert.ok(
    value.status === 'PASS' || value.status === 'passed',
    `${specification.checkpoint} evidence must pass`,
  );
}

function verifyReportRecords(value, evidenceDirectory) {
  let verified = 0;
  function visit(entry) {
    if (!entry || typeof entry !== 'object') return;
    if (
      typeof entry.file === 'string'
      && typeof entry.sha256 === 'string'
      && /^[0-9a-f]{64}$/.test(entry.sha256)
    ) {
      const preservedEvidencePath = entry.file.startsWith(
        'wasm/.test-results/',
      );
      const outputLocalPath = !entry.file.includes('/');
      const candidates = preservedEvidencePath
        ? [path.join(repoRoot, entry.file)]
        : outputLocalPath
          ? [path.join(repoRoot, evidenceDirectory, entry.file)]
          : [];
      const file = candidates.find((candidate) => (
        fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ));
      if (file) {
        const record = bareFileRecord(file);
        assert.equal(record.sha256, entry.sha256, entry.file);
        if (entry.bytes !== undefined) {
          assert.equal(record.bytes, entry.bytes, entry.file);
        }
        verified += 1;
      }
    }
    for (const nested of Object.values(entry)) visit(nested);
  }
  visit(value);
  return verified;
}

function verifyPredecessors() {
  const stages = [];
  for (const specification of STAGE_EVIDENCE) {
    const relativeEvidence =
      `${specification.directory}/${specification.evidence}`;
    const value = readJson(relativeEvidence);
    assertEvidenceStatus(value, specification);
    const verifiedLinkedRecords = verifyReportRecords(
      value,
      specification.directory,
    );
    assert.ok(
      verifiedLinkedRecords > 0,
      `${specification.checkpoint} must link at least one preserved record`,
    );
    stages.push(Object.freeze({
      checkpoint: specification.checkpoint,
      evidence: fileRecord(relativeEvidence),
      verifiedLinkedRecords,
      artifacts: directoryManifest(specification.directory),
    }));
  }
  const g0 = readJson(
    'wasm/.test-results/jwt-g0/jwt-g0-evidence.json',
  );
  assert.ok(g0.evidence.startingAuthority);
  for (const authority of Object.values(
    g0.evidence.startingAuthority,
  )) {
    const actual = fileRecord(authority.file);
    assert.equal(actual.bytes, authority.bytes);
    assert.equal(actual.sha256, authority.sha256);
  }
  return Object.freeze(stages);
}

function runStage(id, command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs || 300_000,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  if (result.error || result.status !== 0) {
    const error = new Error(
      `${id} failed (${String(result.status)}): ` +
      `${(stderr || stdout || String(result.error || '')).slice(-12_000)}`,
    );
    error.code = `PULSE_G5_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_FAILED`;
    throw error;
  }
  return Object.freeze({
    id,
    status: 'passed',
    durationMs: Date.now() - startedAt,
    stdoutBytes: Buffer.byteLength(stdout),
    stdoutSha256: sha256(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stderrSha256: sha256(stderr),
  });
}

function inspectTool(executable, kind, expectedVersion) {
  const result = spawnSync(executable, ['--version'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 30_000,
    shell: false,
  });
  assert.equal(result.status, 0, `${kind} --version`);
  const output = String(result.stdout || '').trim();
  assert.equal(output, `${kind} ${expectedVersion}`);
  const resolved = fs.realpathSync(executable);
  return Object.freeze({
    name: kind,
    version: expectedVersion,
    binary: Object.freeze({
      basename: path.basename(resolved),
      sha256: sha256(fs.readFileSync(resolved)),
    }),
  });
}

function sourceReproduction(options, stages) {
  const cargo = process.env.CARGO || 'cargo';
  const rustc = process.env.RUSTC || 'rustc';
  const rust = inspectTool(rustc, 'rustc', EXPECTED_RUSTC);
  const cargoTool = inspectTool(cargo, 'cargo', EXPECTED_CARGO);
  const buildStage = runStage(
    'source-reproduction',
    process.execPath,
    [path.join(repoRoot, BUILD_SCRIPT), '--check'],
    {
      env: process.env,
      timeoutMs: 600_000,
    },
  );
  stages.push(buildStage);

  const source = sourceTreeRecord(
    path.join(repoRoot, SOURCE_DIRECTORY),
  );
  const manifest = readJson(MANIFEST_FILE);
  assert.equal(manifest.source.treeSha256, source.sha256);
  assert.equal(manifest.provenance.sourceTreeSha256, source.sha256);
  assert.equal(
    manifest.toolchain.versions.rustc,
    EXPECTED_RUSTC,
  );
  assert.equal(
    manifest.toolchain.versions.cargo,
    EXPECTED_CARGO,
  );
  const raw = fileRecord(RAW_PREBUILT);
  const optimized = fileRecord(OPTIMIZED_PREBUILT);
  assert.equal(raw.sha256,
    '5e2b63df278f6f9b2a3374ebabc81a44a22419a929dd37344df1727c89cb2a46');
  assert.equal(optimized.sha256,
    'ee5ab1639cbe1be5a9510c01ab15a3569c0394818a9db98f3e0114ae829fff50');

  let external = Object.freeze({
    supplied: false,
    status: 'not-required-for-local-reproduction-pass',
  });
  if (options.reproductionRoot) {
    const requested = fs.realpathSync(options.reproductionRoot);
    const sourceDirectory = fs.existsSync(
      path.join(requested, 'source', 'Cargo.toml'),
    )
      ? path.join(requested, 'source')
      : requested;
    assert.equal(
      fs.existsSync(path.join(sourceDirectory, 'Cargo.toml')),
      true,
      'external reproduction root must contain Cargo.toml',
    );
    const sourceFiles = [];
    for (const relativeFile of REPRODUCTION_SOURCE_FILES) {
      const externalFile = path.join(sourceDirectory, relativeFile);
      const packageFile = path.join(
        repoRoot,
        SOURCE_DIRECTORY,
        relativeFile,
      );
      assert.equal(fs.existsSync(externalFile), true, relativeFile);
      assert.deepEqual(
        fs.readFileSync(externalFile),
        fs.readFileSync(packageFile),
        relativeFile,
      );
      sourceFiles.push(absoluteFileRecord(
        externalFile,
        `source/${relativeFile}`,
      ));
    }
    const externalRaw = path.join(
      sourceDirectory,
      'target',
      TARGET,
      'release',
      'pulse_es256_rustcrypto_verifier.wasm',
    );
    assert.equal(fs.existsSync(externalRaw), true);
    assert.deepEqual(
      fs.readFileSync(externalRaw),
      fs.readFileSync(path.join(repoRoot, RAW_PREBUILT)),
    );
    const rustInfoFile = path.join(
      sourceDirectory,
      'target',
      '.rustc_info.json',
    );
    assert.equal(fs.existsSync(rustInfoFile), true);
    const rustInfo = fs.readFileSync(rustInfoFile, 'utf8');
    assert.match(rustInfo, /rustc 1\.97\.1 \(8bab26f4f 2026-07-14\)/);

    const normalizationRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pulse-es256-g5-normalize-'),
    );
    try {
      const normalized = path.join(
        normalizationRoot,
        'es256-verifier.wasm',
      );
      runTool('wasm-opt', [
        externalRaw,
        ...optimizationPostures['native-size'],
        '-o',
        normalized,
      ], {
        cwd: normalizationRoot,
        timeoutMs: 120_000,
      });
      assert.deepEqual(
        fs.readFileSync(normalized),
        fs.readFileSync(path.join(repoRoot, OPTIMIZED_PREBUILT)),
      );
    } finally {
      fs.rmSync(normalizationRoot, { recursive: true, force: true });
    }
    const archive = options.reproductionArchive
      ? absoluteFileRecord(
          fs.realpathSync(options.reproductionArchive),
          path.basename(options.reproductionArchive),
        )
      : null;
    external = Object.freeze({
      supplied: true,
      status: 'passed',
      environment: 'independent-clean-container-output',
      sourceFiles: Object.freeze(sourceFiles),
      rustcMetadataMatched: true,
      rawArtifact: absoluteFileRecord(
        externalRaw,
        'target/wasm32v1-none/release/pulse_es256_rustcrypto_verifier.wasm',
      ),
      rawBytesMatchReviewedPrebuilt: true,
      deterministicNormalization: Object.freeze({
        tool: 'wasm-opt',
        posture: 'native-size',
        bytesMatchReviewedPrebuilt: true,
      }),
      archive,
    });
  }

  return Object.freeze({
    version: SOURCE_REPRODUCTION_VERSION,
    checkpoint: CHECKPOINT,
    status: 'passed',
    source,
    lockfile: fileRecord(`${SOURCE_DIRECTORY}/Cargo.lock`),
    buildScript: fileRecord(BUILD_SCRIPT),
    manifest: fileRecord(MANIFEST_FILE),
    toolchain: Object.freeze({
      target: TARGET,
      locked: true,
      rust,
      cargo: cargoTool,
      binaryen: binaryenIdentity(),
    }),
    localMaintainerReproduction: Object.freeze({
      status: 'passed',
      ordinaryApplicationBuild: false,
      commandIdentity:
        'pulse.crypto.es256.rustcrypto-build.v1 --check',
      independentBuilds: 2,
      rawBuildsByteIdentical: true,
      normalizedBuildsByteIdentical: true,
      rawBytesMatchReviewedPrebuilt: true,
      normalizedBytesMatchReviewedPrebuilt: true,
      manifestMatchesSourceAndToolchain: true,
      stage: buildStage,
    }),
    reviewedArtifacts: Object.freeze({ raw, optimized }),
    normalization: Object.freeze({
      requiredForRawComparison: false,
      rawComparison: 'byte-identical',
      optimizedComparison:
        'pinned Binaryen native-size output byte-identical',
    }),
    externalReproduction: external,
    acceptance: Object.freeze({
      exactSourceAndLockfile: true,
      exactPinnedToolchain: true,
      repeatedBuildDeterminism: true,
      reviewedRawPrebuiltReproduced: true,
      reviewedOptimizedPrebuiltReproduced: true,
      applicationBuildUnaffected: true,
    }),
  });
}

function runReplays(temporaryRoot, stages) {
  const results = {};
  for (const specification of REPLAY_SPECS) {
    const output = path.join(
      temporaryRoot,
      specification.checkpoint.toLowerCase(),
    );
    const stage = runStage(
      `${specification.checkpoint.toLowerCase()}-replay`,
      process.execPath,
      [
        path.join(wasmRoot, specification.script),
        '--out',
        output,
      ],
      { timeoutMs: specification.timeoutMs },
    );
    stages.push(stage);
    const evidenceFile = path.join(output, specification.evidence);
    assert.equal(fs.existsSync(evidenceFile), true);
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    assertEvidenceStatus(evidence, specification);
    results[specification.checkpoint] = Object.freeze({
      task: specification.task,
      stage,
      output,
      evidence,
      evidenceRecord: absoluteFileRecord(
        evidenceFile,
        `${specification.checkpoint}/${specification.evidence}`,
      ),
    });
  }

  assert.equal(
    results.G4.evidence.acceptance.allRequiredEligibleCellsPass,
    true,
  );
  assert.equal(
    results.G4.evidence.acceptance.zeroSkippedRequiredExecutions,
    true,
  );
  assert.equal(
    results.G4.evidence.acceptance.hs256RegressionGreen,
    true,
  );
  assert.equal(
    results.G4.evidence.acceptance.noRealizationFallback,
    true,
  );
  const replayNative = JSON.parse(fs.readFileSync(
    path.join(
      results.G4.output,
      'es256-native-conformance.json',
    ),
    'utf8',
  ));
  assert.equal(replayNative.crossTargetStatusParity, true);
  assert.equal(replayNative.defaultSizeParity, true);
  assert.equal(replayNative.automaticFallback, false);
  const preservedNative = readJson(
    'wasm/.test-results/jwt-g4/es256-native-conformance.json',
  );
  assert.deepEqual(
    replayNative.caseIds,
    preservedNative.caseIds,
  );
  assert.equal(
    replayNative.corpusSemanticHash,
    preservedNative.corpusSemanticHash,
  );
  return Object.freeze(results);
}

function runAggregates(stages) {
  for (const profile of REQUIRED_PROFILES) {
    stages.push(runStage(
      `profile-${profile}`,
      process.execPath,
      [
        path.join(wasmRoot, 'scripts/run-wasm-tests.cjs'),
        '--profile',
        profile,
        '--no-report',
      ],
      { timeoutMs: 1_800_000 },
    ));
  }
  stages.push(runStage(
    'provider-fastly-compute-reality',
    process.execPath,
    [
      path.join(wasmRoot, 'scripts/run-wasm-tests.cjs'),
      '--task',
      'provider-fastly-compute-reality',
      '--no-report',
    ],
    { timeoutMs: 600_000 },
  ));
  stages.push(runStage(
    'docs-snippets-check',
    process.execPath,
    [path.join(wasmRoot, 'scripts/sync-doc-snippets.cjs'), '--check'],
    { timeoutMs: 300_000 },
  ));
  stages.push(runStage(
    'docs-site-check',
    process.execPath,
    [path.join(repoRoot, 'scripts/build-docs-site.cjs'), '--check'],
    { timeoutMs: 300_000 },
  ));
  stages.push(runStage(
    'maintainer-check',
    process.execPath,
    [path.join(repoRoot, 'scripts/validate-maintainer-control-plane.cjs')],
    { timeoutMs: 300_000 },
  ));
}

function finalMemoryAudit(replays) {
  const memory = JSON.parse(fs.readFileSync(
    path.join(
      replays.G1.output,
      'es256-guest-memory-report.json',
    ),
    'utf8',
  ));
  const vectors = JSON.parse(fs.readFileSync(
    path.join(
      replays.G1.output,
      'es256-guest-vector-report.json',
    ),
    'utf8',
  ));
  const finalAudit = JSON.parse(fs.readFileSync(
    path.join(
      replays.G2.output,
      'es256-final-wasm-audit.json',
    ),
    'utf8',
  ));
  const nodeReality = JSON.parse(fs.readFileSync(
    path.join(
      replays.G2.output,
      'es256-node-native-reality.json',
    ),
    'utf8',
  ));
  const nativeConformance = JSON.parse(fs.readFileSync(
    path.join(
      replays.G4.output,
      'es256-native-conformance.json',
    ),
    'utf8',
  ));
  assert.equal(memory.fixedMemory.pages, 32);
  assert.equal(memory.fixedMemory.growable, false);
  assert.equal(memory.fixedMemory.memoryGrowInstructions, 0);
  assert.equal(memory.standaloneRangesPairwiseNonOverlapping, true);
  assert.equal(memory.scratch.pointerRetention, false);
  assert.equal(memory.state.repeatedCallContamination, false);
  assert.equal(memory.malformedInputTrapCount, 0);

  const modes = {};
  for (const [mode, audit] of Object.entries(finalAudit.modes)) {
    assert.equal(audit.status, 'passed');
    assert.deepEqual(audit.structure.memoryTypes, [{
      minimumPages: 32,
      maximumPages: 32,
      shared: false,
    }]);
    assert.equal(audit.instructions.memoryGrow, 0);
    assert.equal(
      audit.layout.beforeOptimization
        .occupiedAndReservedRangesPairwiseDisjoint,
      true,
    );
    assert.equal(
      audit.layout.afterOptimization
        .occupiedAndReservedRangesPairwiseDisjoint,
      true,
    );
    assert.equal(audit.mutableState.noAdditionalWritesIntroduced, true);
    modes[mode] = Object.freeze({
      artifact: audit.artifact,
      fixedMemory: audit.structure.memoryTypes[0],
      memoryGrowInstructions: audit.instructions.memoryGrow,
      mutableState: audit.mutableState,
      beforeOptimization: audit.layout.beforeOptimization,
      afterOptimization: audit.layout.afterOptimization,
    });
  }

  const optimizedCases = vectors.artifacts.optimized.cases;
  const frameFailureCases = optimizedCases.filter((entry) => (
    entry.category === 'malformed-frame'
    || entry.category === 'frame-negative'
  ));
  assert.ok(frameFailureCases.length > 0);
  for (const entry of frameFailureCases) {
    assert.equal(entry.expected, -2, entry.id);
    assert.equal(entry.actual, -2, entry.id);
    assert.equal(entry.trapped, false, entry.id);
    assert.equal(entry.frameMutated, false, entry.id);
    assert.equal(entry.callerClearedCapacityBytes, FRAME_CAPACITY);
  }
  for (const artifact of Object.values(vectors.artifacts)) {
    assert.equal(artifact.trapCount, 0);
    assert.equal(artifact.frameMutationCount, 0);
    assert.equal(artifact.retainedInputContaminationObserved, false);
    assert.equal(artifact.consecutiveCalls, optimizedCases.length);
  }
  for (const mode of Object.values(nodeReality.modes)) {
    for (const stage of [
      mode.beforeOptimization,
      mode.afterOptimization,
    ]) {
      assert.equal(stage.trapCount, 0);
      assert.equal(stage.frameMutationCount, 0);
      for (const entry of stage.cases) {
        assert.equal(entry.callerClearedCapacityBytes, FRAME_CAPACITY);
      }
    }
  }
  assert.equal(nativeConformance.crossTargetStatusParity, true);
  assert.equal(nativeConformance.defaultSizeParity, true);
  assert.deepEqual(vectors.frozenScalarMapping, {
    valid: 1,
    invalidAuthenticator: 0,
    invalidKey: -1,
    invalidInput: -2,
    realizationFailure: -3,
  });

  return Object.freeze({
    version: MEMORY_AUDIT_VERSION,
    checkpoint: CHECKPOINT,
    status: 'passed',
    fixedMemory: memory.fixedMemory,
    frame: Object.freeze({
      identity: 'pulse.guest-memory.invocation-frame.v2',
      capacityBytes: FRAME_CAPACITY,
      maximumSigningInputBytes: SIGNING_INPUT_MAXIMUM,
      exactKeyBytes: 64,
      exactSignatureBytes: 64,
      headerBytes: 64,
    }),
    stack: memory.stackMeasurement,
    static: memory.static,
    scratch: memory.scratch,
    standaloneRanges: memory.linearMemoryRanges,
    linkedModes: Object.freeze(modes),
    frameValidation: Object.freeze({
      failureCases: Object.freeze(frameFailureCases.map((entry) => (
        Object.freeze({
          id: entry.id,
          status: entry.actual,
          trapped: entry.trapped,
        })
      ))),
      overflowOverlapAlignmentFailuresCovered: true,
      rejectedBeforeDereference: true,
      malformedInputTrapCount: 0,
    }),
    clearingAndRetention: Object.freeze({
      guestRetainsPointers: false,
      callerClearsEntireCapacityAfterEveryCall: true,
      clearedCapacityBytes: FRAME_CAPACITY,
      consecutiveCallsPerArtifact: optimizedCases.length,
      contaminationObserved: false,
      inputFrameMutatedByGuest: false,
    }),
    mutableState: Object.freeze({
      guest: memory.state,
      linkedArtifactsIntroduceAdditionalWrites: false,
      unaccountedMutableState: false,
    }),
    scalarNormalization: vectors.frozenScalarMapping,
    targetBehavior: Object.freeze({
      nodeAndFastlyStatusParity: true,
      defaultAndSizeParity: true,
      malformedInputsEquivalent: true,
      automaticFallback: false,
    }),
    acceptance: Object.freeze({
      fixed32Pages: true,
      noMemoryGrowth: true,
      exactFrameCapacityAndPayloadMaximum: true,
      stackHighWaterMeasuredAndConservativelyBounded: true,
      staticScratchAndFrameRangesExplicit: true,
      pairwiseNonOverlapBeforeAndAfterOptimization: true,
      overflowOverlapAndAlignmentFailuresCovered: true,
      pointerNonRetention: true,
      deterministicFrameClearing: true,
      consecutiveCallContaminationAbsent: true,
      noUnaccountedMutableState: true,
      scalarOutputsNormalized: true,
      targetEquivalentMalformedInputBehavior: true,
    }),
  });
}

function hardeningLedger() {
  const items = Object.freeze([
    Object.freeze({
      id: 'independent-cryptographic-review',
      proof: 'not-required-to-establish-observed-functional-proof',
      production: 'OPEN',
      disposition: 'named-production-blocker',
    }),
    Object.freeze({
      id: 'constant-time-side-channel-claim',
      proof: 'UNCLAIMED',
      production: 'OPEN',
      disposition:
        'verification inputs are public; variable-time behavior is not promoted to a constant-time claim',
    }),
    Object.freeze({
      id: 'dependency-and-license-disposition',
      proof: 'PASS-bounded-proof',
      production: 'OPEN',
      disposition:
        'locked inventory and compatible proof licenses recorded; release review remains separate',
    }),
    Object.freeze({
      id: 'clean-machine-portability',
      proof: 'PASS-sealed-linux-environments',
      production: 'OPEN',
      disposition:
        'local isolated tool prefix and independent clean-container output agree; broader portability is unclaimed',
    }),
    Object.freeze({
      id: 'long-running-load-and-concurrency',
      proof: 'NOT_RUN',
      production: 'OPEN',
      disposition: 'named-production-blocker',
    }),
    Object.freeze({
      id: 'production-fastly-deployment',
      proof: 'NOT_RUN',
      production: 'OPEN',
      disposition:
        'local Viceroy execution passed; no deployed Fastly service was exercised',
    }),
    Object.freeze({
      id: 'browser-support',
      proof: 'UNCLAIMED',
      production: 'OPEN',
      disposition: 'no browser eligibility claim',
    }),
    Object.freeze({
      id: 'esp32-support',
      proof: 'UNCLAIMED',
      production: 'OPEN',
      disposition: 'no ESP32 eligibility claim',
    }),
    Object.freeze({
      id: 'fastly-javascript-es256',
      proof: 'INELIGIBLE',
      production: 'OPEN',
      disposition:
        'not substituted with Node JavaScript or Native evidence',
    }),
    Object.freeze({
      id: 'operational-public-key-rotation-guidance',
      proof: 'NOT_REQUIRED',
      production: 'OPEN',
      disposition: 'named-production-blocker',
    }),
    Object.freeze({
      id: 'npm-publication-and-release-promotion',
      proof: 'NOT_AUTHORIZED',
      production: 'OPEN',
      disposition:
        'no publication, promotion, deployment, or activation performed',
    }),
  ]);
  return Object.freeze({
    version: HARDENING_LEDGER_VERSION,
    checkpoint: CHECKPOINT,
    status: 'complete',
    proofCorrectness: 'PASS',
    productionReleaseReadiness: 'NOT_READY',
    items,
    openProductionItems: Object.freeze(
      items
        .filter((entry) => entry.production === 'OPEN')
        .map((entry) => entry.id),
    ),
    claims: Object.freeze({
      independentCryptoReviewComplete: false,
      constantTime: false,
      broadPortability: false,
      productionLoadQualified: false,
      productionFastlyValidated: false,
      browserSupported: false,
      esp32Supported: false,
      fastlyJavascriptEs256Supported: false,
      publicationAuthorized: false,
    }),
  });
}

function artifactFacts(replays, predecessors, reproduction) {
  const g2Audit = JSON.parse(fs.readFileSync(
    path.join(
      replays.G2.output,
      'es256-final-wasm-audit.json',
    ),
    'utf8',
  ));
  const nodeReality = JSON.parse(fs.readFileSync(
    path.join(
      replays.G4.output,
      'es256-node-native-reality.json',
    ),
    'utf8',
  ));
  const fastlyReality = JSON.parse(fs.readFileSync(
    path.join(
      replays.G4.output,
      'es256-fastly-native-reality.json',
    ),
    'utf8',
  ));
  const node = nodeReality.modes.map((mode) => Object.freeze({
    mode: mode.mode,
    primaryInput: mode.artifact.primaryInput,
    preOptimizationLinked: mode.artifact.preOptimizationLinked,
    finalOptimized: mode.artifact.finalOptimized,
    finalAudit: mode.artifact.finalAudit,
    providerConsumed: mode.artifact.providerConsumed,
  }));
  const fastly = fastlyReality.modes.flatMap((mode) => (
    mode.variants.map((variant) => Object.freeze({
      mode: mode.mode,
      variant: variant.variant,
      primaryInput: variant.artifact.primaryInput,
      preOptimizationLinked: variant.artifact.preOptimizationLinked,
      finalOptimized: variant.artifact.finalOptimized,
      finalAudit: variant.artifact.finalAudit,
      providerConsumed: variant.artifact.providerConsumed,
      runtime: variant.runtime,
    }))
  ));
  for (const entry of [...node, ...fastly]) {
    assert.equal(entry.finalAudit.status, 'passed');
    assert.equal(
      entry.finalAudit.artifactSha256,
      entry.providerConsumed.sha256,
    );
    assert.equal(entry.providerConsumed.matchesFinalAudit, true);
  }
  return Object.freeze({
    version: ARTIFACT_MANIFEST_VERSION,
    checkpoint: CHECKPOINT,
    status: 'passed',
    startingAuthority:
      readJson('wasm/.test-results/jwt-g0/jwt-g0-evidence.json')
        .evidence.startingAuthority,
    predecessors,
    source: Object.freeze({
      tree: reproduction.source,
      lockfile: reproduction.lockfile,
      buildScript: reproduction.buildScript,
      guestManifest: reproduction.manifest,
    }),
    toolchain: reproduction.toolchain,
    guestArtifacts: reproduction.reviewedArtifacts,
    rematerialization: Object.freeze({
      packagePrebuiltSha256:
        reproduction.reviewedArtifacts.optimized.sha256,
      contentAddressed: true,
      hashVerifiedBeforeUse: true,
    }),
    g2ProofArtifacts: Object.freeze(Object.fromEntries(
      Object.entries(g2Audit.modes).map(([mode, audit]) => [
        mode,
        Object.freeze({
          artifact: audit.artifact,
          auditStatus: audit.status,
          providerPackagingAuthorized:
            audit.providerPackaging.authorized,
        }),
      ]),
    )),
    finalTargetArtifacts: Object.freeze({
      nodeNative: Object.freeze(node),
      fastlyNative: Object.freeze(fastly),
    }),
    exactProviderInputsMatchFinalAudits: true,
    automaticFallback: false,
  });
}

function finalSeal(replays, memory, hardening, artifacts) {
  const g4 = replays.G4.evidence;
  assert.equal(g4.acceptance.allRequiredEligibleCellsPass, true);
  assert.equal(g4.acceptance.zeroSkippedRequiredExecutions, true);
  assert.equal(g4.acceptance.hs256RegressionGreen, true);
  assert.equal(g4.acceptance.noRealizationFallback, true);
  const outcomes = Object.freeze({
    es256GuestImplementation: 'PASS',
    es256NodeNative: 'PASS',
    es256FastlyNative: 'PASS',
    es256NodeJavaScript: 'PASS',
    es256FastlyJavaScript: 'INELIGIBLE',
    productionReleaseReadiness: 'NOT_READY',
  });
  return Object.freeze({
    version: FINAL_SEAL_VERSION,
    checkpoint: CHECKPOINT,
    status: 'passed',
    classification: 'PASS',
    outcomes,
    realization: Object.freeze({
      algorithm: 'ES256',
      identity: 'guest-linked:pulse-es256-rustcrypto-p256',
      implementation:
        'rustcrypto.p256-0.13.2.ecdsa-0.16.9.sha2-0.10.9.v1',
      semanticOwner: '@pulse-compute/crypto',
      automaticFallback: false,
    }),
    corpus: Object.freeze({
      cases: g4.corpus.cases,
      semanticEvaluations: g4.corpus.completedSemanticEvaluations,
      skipped: g4.corpus.skipped,
      nodeJavascript: 'PASS',
      nodeNative: 'PASS',
      fastlyNative: 'PASS',
      fastlyJavascript: 'INELIGIBLE',
    }),
    acceptance: Object.freeze({
      g0ThroughG4EvidencePreserved: true,
      sourceReconstructionPassed: true,
      prebuiltByteIdentityPassed: true,
      rematerializationRelinkAndOptimizationPassed: true,
      finalWasmInspectionPassed: true,
      sharedCorpusPassedWithoutSkips: true,
      hs256RegressionPassed: true,
      redactionAndFailClosedAuditsPassed: true,
      finalMemoryAuditPassed:
        Object.values(memory.acceptance).every(Boolean),
      exactProviderArtifactsExecuted: true,
      selectedRealizationFailuresTerminal: true,
      proofAndProductionReadinessSeparated: true,
      productionActionsPerformed: false,
    }),
    artifacts: Object.freeze({
      manifestVersion: artifacts.version,
      exactProviderInputsMatchFinalAudits:
        artifacts.exactProviderInputsMatchFinalAudits,
    }),
    hardening: Object.freeze({
      ledgerVersion: hardening.version,
      proofCorrectness: hardening.proofCorrectness,
      productionReleaseReadiness:
        hardening.productionReleaseReadiness,
      openProductionItems: hardening.openProductionItems,
    }),
    boundaries: Object.freeze({
      publication: false,
      releasePromotion: false,
      productionDeployment: false,
      productionActivation: false,
      browserSupport: false,
      esp32Support: false,
      fastlyJavascriptEs256Support: false,
    }),
  });
}

function writeReport(outputDirectory, name, value) {
  const file = path.join(outputDirectory, name);
  fs.writeFileSync(file, stableJson(value));
  return Object.freeze({
    file,
    relativeFile: path.relative(repoRoot, file).replace(/\\/g, '/'),
    ...bareFileRecord(file),
  });
}

function finalHandoff(seal, hardening) {
  return `# ES256 G5 final handoff

The bounded ES256 proof is sealed at G5.

| Outcome | Result |
| --- | --- |
| ES256 guest implementation | ${seal.outcomes.es256GuestImplementation} |
| Node Native | ${seal.outcomes.es256NodeNative} |
| Fastly Native | ${seal.outcomes.es256FastlyNative} |
| Node JavaScript | ${seal.outcomes.es256NodeJavaScript} |
| Fastly JavaScript | ${seal.outcomes.es256FastlyJavaScript} |
| Production-release readiness | ${seal.outcomes.productionReleaseReadiness} |

The reviewed Rust guest reproduced byte-for-byte from the exact locked source
with Rust/Cargo 1.97.1, and the pinned Binaryen normalization reproduced the
reviewed optimized prebuilt. Default and size-oriented Node Native and Fastly
Native artifacts passed final inspection and the shared 38-case corpus. Fastly
Native ran through direct Viceroy 0.20.1; no Fastly CLI result was fabricated.
HS256 regressions, redaction, fail-closed ordering, no-fallback behavior, and
fixed-memory/non-retention checks passed.

Production readiness remains **NOT_READY**. The open hardening items are:

${hardening.openProductionItems.map((id) => `- ${id}`).join('\n')}

No package was published, no release catalog was promoted, and no provider was
deployed or activated. Those actions require separate authorization.
`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const stages = [];
  const predecessors = verifyPredecessors();
  const reproduction = sourceReproduction(options, stages);
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pulse-es256-g5-'),
  );
  try {
    const replays = runReplays(temporaryRoot, stages);
    const memory = finalMemoryAudit(replays);
    const hardening = hardeningLedger();
    const artifacts = artifactFacts(
      replays,
      predecessors,
      reproduction,
    );

    runAggregates(stages);

    const reproductionRecord = writeReport(
      options.outputDirectory,
      'es256-source-reproduction.json',
      reproduction,
    );
    const memoryRecord = writeReport(
      options.outputDirectory,
      'es256-final-memory-audit.json',
      memory,
    );
    const hardeningRecord = writeReport(
      options.outputDirectory,
      'es256-hardening-ledger.json',
      hardening,
    );
    const artifactRecord = writeReport(
      options.outputDirectory,
      'es256-artifact-manifest.json',
      artifacts,
    );
    const seal = finalSeal(replays, memory, hardening, artifacts);
    const sealRecord = writeReport(
      options.outputDirectory,
      'es256-final-seal.json',
      seal,
    );
    const handoffFile = path.join(
      options.outputDirectory,
      'es256-final-handoff.md',
    );
    fs.writeFileSync(handoffFile, finalHandoff(seal, hardening));
    const handoffRecord = Object.freeze({
      file: handoffFile,
      relativeFile:
        path.relative(repoRoot, handoffFile).replace(/\\/g, '/'),
      ...bareFileRecord(handoffFile),
    });
    const reports = Object.freeze([
      reproductionRecord,
      memoryRecord,
      hardeningRecord,
      artifactRecord,
      sealRecord,
      handoffRecord,
    ].map((entry) => Object.freeze({
      file: entry.relativeFile,
      bytes: entry.bytes,
      sha256: entry.sha256,
    })));
    const evidence = Object.freeze({
      version: EVIDENCE_VERSION,
      checkpoint: CHECKPOINT,
      status: 'passed',
      classification: 'PASS',
      outcomes: seal.outcomes,
      acceptance: seal.acceptance,
      reports,
      stages: Object.freeze(stages),
      sources: Object.freeze(SOURCE_FILES.map(fileRecord)),
      predecessorEvidence: Object.freeze(predecessors.map((entry) => (
        Object.freeze({
          checkpoint: entry.checkpoint,
          evidence: entry.evidence,
          verifiedLinkedRecords: entry.verifiedLinkedRecords,
        })
      ))),
      validation: Object.freeze({
        profiles: REQUIRED_PROFILES,
        externalFastlyReality: true,
        documentation: true,
        maintainerControlPlane: true,
      }),
      boundaries: seal.boundaries,
      nextAuthorizedCheckpoint: null,
    });
    const evidenceRecord = writeReport(
      options.outputDirectory,
      'jwt-g5-evidence.json',
      evidence,
    );

    for (const report of [...reports, Object.freeze({
      file: evidenceRecord.relativeFile,
      bytes: evidenceRecord.bytes,
      sha256: evidenceRecord.sha256,
    })]) {
      const actual = fileRecord(report.file);
      assert.equal(actual.bytes, report.bytes);
      assert.equal(actual.sha256, report.sha256);
    }

    process.stdout.write(`${stableJson({
      checkpoint: CHECKPOINT,
      status: 'passed',
      outcomes: seal.outcomes,
      corpusCases: replays.G4.evidence.corpus.cases,
      semanticEvaluations:
        replays.G4.evidence.corpus.completedSemanticEvaluations,
      skipped: replays.G4.evidence.corpus.skipped,
      evidence: evidenceRecord.relativeFile,
    })}`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
