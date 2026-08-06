#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const ASSESSMENT_VERSION =
  'pulse.jwt-guest-link-production-suitability.f2.v1';
const ASSUMPTION_VERSION =
  'pulse.jwt-guest-link-memory-assumptions.f2.v1';
const EVIDENCE_VERSION = 'pulse.jwt-f2-evidence.v1';

const PHASES = Object.freeze(['A', 'B', 'C', 'D', 'E']);
const ALLOWED_AXIS_DECISIONS = Object.freeze({
  'guest-linked-production-crypto': Object.freeze([
    'GO',
    'CONDITIONAL',
    'STOP',
  ]),
  'invocation-arena': Object.freeze([
    'REQUIRED',
    'NOT REQUIRED',
    'UNRESOLVED',
  ]),
  'guest-allocator': Object.freeze([
    'PROHIBITED',
    'REQUIRED',
    'UNRESOLVED',
  ]),
  'prebuilt-reproducibility': Object.freeze([
    'SUFFICIENT',
    'CONDITIONAL',
    'INSUFFICIENT',
  ]),
  'source-built-units': Object.freeze([
    'MAINTAINER-ONLY',
    'DEFER',
    'REJECT',
  ]),
  'non-crypto-generalization': Object.freeze([
    'READY',
    'NOT READY',
    'OUT OF SCOPE',
  ]),
  'public-abi-exposure': Object.freeze([
    'KEEP PRIVATE',
    'PROPOSE REVIEW',
  ]),
});

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-f2');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT F2 option: ${argv[index]}`);
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
  assert.equal(actual.bytes, expected.bytes, expected.file);
  assert.equal(actual.sha256, expected.sha256, expected.file);
  return actual;
}

function citation(phase, file, claim) {
  assert.ok(PHASES.includes(phase));
  assert.ok(file);
  assert.ok(claim);
  return Object.freeze({ phase, file, claim });
}

function completeLoopCitations(overrides = {}) {
  return Object.freeze([
    citation(
      'A',
      'wasm/.test-results/guest-link-a4/guest-link-poc-decision.md',
      overrides.A ||
        'The accepted proof is one fixed memory, one synchronous borrowed span, no allocation or retention, bounded malformed-range normalization, and matching optimized Node/Fastly behavior.',
    ),
    citation(
      'B',
      'wasm/.test-results/guest-link-b4/phase-b-seal.json',
      overrides.B ||
        'The closed first-party prebuilt pipeline validates, materializes, composes, optimizes, audits, packages exact final bytes, and fails without fallback.',
    ),
    citation(
      'C',
      'wasm/.test-results/crypto-c4/phase-c-seal.json',
      overrides.C ||
        'The only implemented Native crypto is allocator-independent guest-source HS256; guest-linked cryptography and asymmetric algorithms remain unimplemented.',
    ),
    citation(
      'D',
      'wasm/.test-results/jwt-d0/jwt-crypto-requirements.json',
      overrides.D ||
        'JWT preserves exact signing-input bytes under limits that are wider than the accepted guest borrowed-span maximum.',
    ),
    citation(
      'E',
      'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
      overrides.E ||
        'The four-target loop passes without fallback, while HS256 emits zero linked guest units and does not exercise production guest-linked cryptography.',
    ),
  ]);
}

function assertCompleteLoopEvidence(decision) {
  const phases = new Set(decision.evidence.map((entry) => entry.phase));
  assert.deepEqual([...phases].sort(), PHASES);
}

function axisDecision(value) {
  assert.ok(Object.hasOwn(ALLOWED_AXIS_DECISIONS, value.axis), value.axis);
  assert.ok(
    ALLOWED_AXIS_DECISIONS[value.axis].includes(value.decision),
    `${value.axis}:${value.decision}`,
  );
  assert.ok(value.rationale);
  assert.ok(Array.isArray(value.conditions));
  assert.ok(Array.isArray(value.evidence));
  const result = Object.freeze({
    ...value,
    conditions: Object.freeze(value.conditions),
    evidence: Object.freeze(value.evidence),
  });
  assertCompleteLoopEvidence(result);
  return result;
}

function assumption(value) {
  assert.ok(value.id);
  assert.ok(value.status);
  assert.ok(value.owner);
  assert.ok(value.reason);
  assert.ok(value.nextAction);
  assert.ok(Array.isArray(value.evidence) && value.evidence.length > 0);
  return Object.freeze({
    ...value,
    evidence: Object.freeze(value.evidence),
  });
}

function loadAndVerifyInputs() {
  const f0 = readJson(
    'wasm/.test-results/jwt-f0/jwt-f0-evidence-consolidation.json',
  );
  const f1 = readJson('wasm/.test-results/jwt-f1/jwt-f1-evidence.json');
  const f1Hardening = readJson(
    'wasm/.test-results/jwt-f1/jwt-f1-production-hardening.json',
  );
  assert.equal(f0.status, 'passed');
  assert.equal(f0.classification, 'PASS');
  assert.equal(f1.status, 'passed');
  assert.equal(f1.classification, 'PASS');
  assert.equal(f1.nextAuthorizedCheckpoint, 'F2');
  assert.equal(
    f1Hardening.productionReleaseReadiness.classification,
    'NOT_READY',
  );

  const verifiedCheckpoints = Object.freeze(
    f0.evidence.checkpoints.map(verifyRecord),
  );
  const phaseADecision = verifyRecord(f0.evidence.phaseADecision);
  const frozenReleaseRecord = verifyRecord(
    f0.workingCandidate.frozenRelease,
  );
  const workingCandidateRecord = verifyRecord(
    f0.workingCandidate.contract,
  );
  const frozenRelease = readJson('release/pulse-release-manifest.json');
  assert.equal(frozenRelease.releaseVersion, '1.0.0-beta.1');
  assert.equal(f0.workingCandidate.candidateVersion, '1.0.0-beta.1');

  const d4 = readJson('wasm/.test-results/jwt-d4/jwt-phase-d-seal.json');
  assert.equal(d4.status, 'passed');
  assert.equal(d4.classification, 'PASS');
  const d0RequirementsRecord = verifyRecord(
    d4.requiredOutputs.find(
      (entry) =>
        entry.file ===
        'wasm/.test-results/jwt-d0/jwt-crypto-requirements.json',
    ),
  );

  const a2 = readJson(
    'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
  );
  const a3 = readJson(
    'wasm/.test-results/guest-link-a3/guest-link-poc-final-audit.json',
  );
  const b0 = readJson(
    'wasm/.test-results/guest-link-b0/guest-link-contract-design.json',
  );
  const b4 = readJson(
    'wasm/.test-results/guest-link-b4/phase-b-seal.json',
  );
  const c4 = readJson('wasm/.test-results/crypto-c4/phase-c-seal.json');
  const d0Requirements = readJson(
    'wasm/.test-results/jwt-d0/jwt-crypto-requirements.json',
  );
  const e4 = readJson('wasm/.test-results/jwt-e4/jwt-phase-e-seal.json');

  for (const report of [a2, a3, b0, b4, c4, d0Requirements, d4, e4]) {
    assert.ok(
      report.status === 'passed' || report.status === 'frozen-for-d1',
    );
  }

  const layout = a2.candidate.layout;
  assert.equal(layout.memory.bytes, 2 * 1024 * 1024);
  assert.equal(layout.memory.minimumPages, 32);
  assert.equal(layout.memory.maximumPages, 32);
  assert.equal(layout.memory.growable, false);
  assert.equal(layout.heap.guestAllocator, false);
  assert.equal(layout.heap.primaryAllocatorUsed, false);
  assert.equal(layout.heap.memoryGrowInstructions, 0);
  assert.equal(layout.inputRegion.base, 524288);
  assert.equal(layout.inputRegion.upperBoundaryExclusive, 2 * 1024 * 1024);
  assert.equal(layout.pairwiseRangeCheckPassed, true);
  assert.equal(a2.candidate.connection.finalMemories, 1);
  assert.equal(a2.candidate.connection.finalMemoryImports, 0);

  const maximumAccepted = a2.candidate.execution.validBoundaryRanges.find(
    (entry) => entry.class === 'maximum-accepted-length',
  );
  assert.equal(maximumAccepted.length, 4096);
  assert.equal(maximumAccepted.trapped, false);
  assert.equal(a2.candidate.execution.invalidRanges.length, 9);
  assert.ok(
    a2.candidate.execution.invalidRanges.every(
      (entry) =>
        entry.result === 0x80000000 &&
        entry.trapped === false &&
        entry.memoryUnchanged === true,
    ),
  );

  assert.equal(a3.finalArtifact.sha256, b4.artifact.final.sha256);
  assert.equal(a3.finalArtifact.memories, 1);
  assert.equal(a3.finalArtifact.hasStart, false);
  assert.equal(a3.optimization.deterministicBytes, true);
  assert.equal(a3.optimization.behaviorChanged, false);
  assert.equal(a3.nodeReality.observationsIdentical, true);
  assert.equal(a3.comparison.equal, true);

  assert.equal(
    b0.design.boundaries.visibility,
    'internal-synchronized-first-party',
  );
  assert.equal(b0.design.boundaries.origin, 'package-prebuilt');
  assert.equal(b0.design.boundaries.sourceBuildContractSealed, false);
  assert.equal(b0.design.boundaries.thirdPartyRegistration, false);
  assert.equal(
    b0.design.componentModelReplacementSeam.currentMechanism,
    'core-wasm-static-link',
  );
  assert.equal(
    b0.design.componentModelReplacementSeam.futureMechanism,
    'component-model',
  );
  assert.equal(b4.boundaries.arbitrarySourceBuilds, false);
  assert.equal(b4.boundaries.publicThirdPartyGuestApi, false);
  assert.equal(b4.requiredTests.deterministicMaterializationReuse, 'passed');
  assert.equal(
    b4.requiredTests.deletionAndReproducibleRecreation,
    'passed',
  );

  assert.equal(c4.boundaries.guestLinkedCrypto, false);
  assert.equal(c4.boundaries.asymmetricCrypto, false);
  assert.equal(c4.realizations.native.guestLinked, false);
  assert.equal(d4.versionDecision.workingCandidate, '1.0.0-beta.1');
  assert.equal(d4.versionDecision.frozenReleaseCatalog, '1.0.0-beta.1');
  assert.equal(d4.versionDecision.publicationAuthorized, false);
  assert.equal(
    d0Requirements.resourceLimits.effectiveJwtSigningInputBytesMaximum,
    16340,
  );
  assert.equal(
    e4.implementationBoundaries.nativeGuestUnits,
    0,
  );
  assert.equal(e4.implementationBoundaries.guestLinkRequiredForHs256, false);
  assert.equal(
    e4.implementationBoundaries.asymmetricImplementationPresent,
    false,
  );
  assert.equal(e4.finalArtifactRealization.automaticFallback, false);

  return Object.freeze({
    f0,
    f1,
    f1Hardening,
    frozenRelease,
    a2,
    a3,
    b0,
    b4,
    c4,
    d0Requirements,
    d4,
    e4,
    verified: Object.freeze({
      checkpoints: verifiedCheckpoints,
      phaseADecision,
      d0Requirements: d0RequirementsRecord,
      frozenRelease: frozenReleaseRecord,
      workingCandidate: workingCandidateRecord,
      f1: fileRecord(
        'wasm/.test-results/jwt-f1/jwt-f1-evidence.json',
      ),
      f1Hardening: fileRecord(
        'wasm/.test-results/jwt-f1/jwt-f1-production-hardening.json',
      ),
    }),
  });
}

function buildAssessment(inputs) {
  const borrowedMaximum =
    inputs.a2.candidate.execution.validBoundaryRanges.find(
      (entry) => entry.class === 'maximum-accepted-length',
    ).length;
  const signingInputMaximum =
    inputs.d0Requirements.resourceLimits
      .effectiveJwtSigningInputBytesMaximum;
  const signingInputShortfall = signingInputMaximum - borrowedMaximum;

  const axes = Object.freeze([
    axisDecision({
      axis: 'guest-linked-production-crypto',
      decision: 'CONDITIONAL',
      rationale:
        'The one-memory synchronous borrowed-span shape is viable for bounded verification, but no production cryptographic guest has exercised it and the current 4,096-byte span cannot carry the current 16,340-byte maximum JWT signing input.',
      conditions: [
        'Define and version a private multi-field invocation frame or explicitly narrow the guest-linked JWT signing-input limit.',
        'Build and audit the selected asymmetric verifier with its real stack, static data, scratch, key encoding, signature encoding, and malformed-frame corpus.',
        'Repeat deterministic post-link inspection and exact-artifact Node/Fastly execution with no fallback.',
        'Keep the independent cryptographic and side-channel review blockers from F1 open.',
      ],
      evidence: completeLoopCitations(),
    }),
    axisDecision({
      axis: 'invocation-arena',
      decision: 'REQUIRED',
      rationale:
        'Production verification needs one caller-owned, compiler-laid-out invocation region that frames signing input, normalized public-key bytes, signature bytes, and fixed algorithm parameters while preserving synchronous lifetime and scalar output.',
      conditions: [
        'The arena remains package/compiler-private and is not exposed as a public crypto allocation option.',
        'The arena contract is versioned separately from the Phase A single-span proof.',
        'Every field has checked offset, length, alignment, maximum, overlap, and lifetime rules before guest dereference.',
      ],
      evidence: completeLoopCitations({
        A: 'Phase A proves one synchronous caller-produced borrowed byte span and scalar result, not a multi-field crypto frame.',
        D: 'Phase D requires the exact signing input, authenticator bytes, and key material to reach crypto without backend leakage or fallback.',
      }),
    }),
    axisDecision({
      axis: 'guest-allocator',
      decision: 'PROHIBITED',
      rationale:
        'An allocator would invalidate the accepted fixed-layout proof and add cross-toolchain ownership, lifetime, failure, and overlap semantics that the loop has not established. A verifier that cannot fit bounded stack and scratch must trigger redesign rather than silently add an allocator.',
      conditions: [
        'Stack and fixed scratch are allowed only with explicit compiler-owned bounds and final-artifact audit.',
        'Any future allocator proposal requires a new ABI version and architecture review; it is not an extension of borrowed-span v1.',
      ],
      evidence: completeLoopCitations({
        A: 'The accepted A result explicitly proves no guest or primary allocator, no heap path, and no memory growth.',
        B: 'The Phase B contract and audit preserve fixed memory and reject memory-growth or incompatible memory policy.',
      }),
    }),
    axisDecision({
      axis: 'prebuilt-reproducibility',
      decision: 'CONDITIONAL',
      rationale:
        'Packaged bytes, provenance metadata, content-addressed materialization, linking, optimization, and final artifacts are reproducible and independently inspectable. A clean source-to-prebuilt byte-for-byte reconstruction has not been sealed.',
      conditions: [
        'Freeze source, lockfile, target, compiler, linker, optimizer, commands, and tool hashes for the selected crypto unit.',
        'Rebuild on a clean machine and require the produced prebuilt bytes and final linked artifacts to match the reviewed candidate.',
        'Record license and provenance dispositions before release readiness.',
      ],
      evidence: completeLoopCitations({
        B: 'Phase B reproduces materialization and final composition from the packaged prebuilt, records source provenance, and does not rebuild source in ordinary compilation.',
        E: 'E4 hash-checks the independent Rust proof but explicitly does not make it load-bearing for HS256.',
      }),
    }),
    axisDecision({
      axis: 'source-built-units',
      decision: 'MAINTAINER-ONLY',
      rationale:
        'Source reconstruction is useful release and audit evidence, but executing guest source during ordinary application builds would widen the trust boundary and weaken the sealed prebuilt identity.',
      conditions: [
        'No source-built application guest feature or local override is introduced.',
        'A future maintainer rebuild lane is explicit, pinned, isolated, non-fallback, and produces reviewable prebuilt bytes rather than becoming the runtime path.',
      ],
      evidence: completeLoopCitations({
        B: 'The accepted production pipeline is package-prebuilt only; source-build contracts, local overrides, dynamic loading, and self-registration are absent.',
      }),
    }),
    axisDecision({
      axis: 'non-crypto-generalization',
      decision: 'NOT READY',
      rationale:
        'The evidence covers one checksum proof shape and a crypto/JWT loop that does not use guest linking. It does not establish a generic package ABI, output ownership model, state model, multiple guest units, or arbitrary imports.',
      conditions: [
        'Do not advertise guest linking as a general package mechanism.',
        'Any non-crypto candidate must justify its own bounded ABI, memory, authority, output, failure, and target-reality contract.',
      ],
      evidence: completeLoopCitations({
        C: 'Phase C deliberately keeps HS256 on guest-source and defers guest-linked crypto.',
        E: 'The complete JWT loop proves zero guest-linked units, so it supplies integration context rather than a second guest-link workload.',
      }),
    }),
    axisDecision({
      axis: 'public-abi-exposure',
      decision: 'KEEP PRIVATE',
      rationale:
        'The current memory layout, frame shape, Binaryen mechanism, prebuilt format, and algorithm encodings are implementation details likely to change during the first real cryptographic guest and a future Component Model transition.',
      conditions: [
        'Keep public authoring at jwt.verify and the explicit crypto algorithm/profile seam.',
        'Do not expose memory bases, arena sizes, allocator switches, guest manifests, linker controls, or source-build commands.',
        'A future public guest ABI requires a separate human architecture decision and compatibility contract.',
      ],
      evidence: completeLoopCitations({
        B: 'Phase B classifies the seam as internal synchronized first-party and explicitly preserves a Component Model replacement boundary.',
        D: 'Phase D keeps JWT provider-neutral and crypto-owned without exposing backend representations.',
      }),
    }),
  ]);

  assert.equal(axes.length, Object.keys(ALLOWED_AXIS_DECISIONS).length);

  const inputBounds = Object.freeze([
    Object.freeze({
      input: 'signing-input',
      decision: 'INSUFFICIENT',
      acceptedGuestMaximumBytes: borrowedMaximum,
      currentJwtMaximumBytes: signingInputMaximum,
      shortfallBytes: signingInputShortfall,
      reason:
        'The exact current JWT signing input may exceed the only accepted borrowed-span maximum.',
      requiredResolution:
        'Version a larger or segmented private invocation frame, or explicitly narrow the guest-linked algorithm limit without changing existing HS256 semantics.',
      evidence: Object.freeze([
        citation(
          'A',
          'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
          'The largest accepted borrowed span is 4,096 bytes.',
        ),
        citation(
          'D',
          'wasm/.test-results/jwt-d0/jwt-crypto-requirements.json',
          'The effective exact JWT signing-input maximum is 16,340 bytes.',
        ),
      ]),
    }),
    Object.freeze({
      input: 'public-key-material',
      decision: 'UNRESOLVED',
      reason:
        'Common ES256 and RSA verification keys can fit well below the physical arena capacity, but no canonical raw/DER/JWK normalization, maximum, or malformed-key contract has been selected.',
      requiredResolution:
        'F3 must choose the experiment and freeze a package-private normalized key encoding and bound before implementation.',
      evidence: Object.freeze([
        citation(
          'C',
          'wasm/.test-results/crypto-c4/phase-c-seal.json',
          'Only secret-key HS256 is implemented; asymmetric key handling is deferred.',
        ),
        citation(
          'D',
          'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json',
          'The completed JWT composition implements only secret-key HS256.',
        ),
      ]),
    }),
    Object.freeze({
      input: 'signature-bytes',
      decision: 'CAPACITY-SUFFICIENT-CONTRACT-UNPROVEN',
      reason:
        'Expected ES256 raw signatures and common RSA signatures fit inside 4,096 bytes, but strict encoding and exact size rules remain algorithm-specific and unimplemented.',
      requiredResolution:
        'Freeze exact raw/encoded signature rules and malformed-signature vectors with the F3-selected algorithm.',
      evidence: Object.freeze([
        citation(
          'A',
          'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
          'The accepted span carries up to 4,096 bytes.',
        ),
        citation(
          'E',
          'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
          'No asymmetric signature parser or verifier is present in the complete loop.',
        ),
      ]),
    }),
    Object.freeze({
      input: 'algorithm-parameters',
      decision: 'SUFFICIENT-IF-STATIC-AND-BOUNDED',
      reason:
        'Algorithm identity should remain statically selected by the profile and target plan; any small curve, hash, or encoding discriminator can remain inside the private frame or guest implementation.',
      requiredResolution:
        'Reject dynamic parameter bags and freeze only the F3-selected verifier parameters.',
      evidence: Object.freeze([
        citation(
          'C',
          'wasm/.test-results/crypto-c4/phase-c-seal.json',
          'Crypto already requires exact realization selection and no fallback.',
        ),
        citation(
          'E',
          'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
          'The target matrix proves explicit algorithm and realization identity.',
        ),
      ]),
    }),
    Object.freeze({
      input: 'verification-result',
      decision: 'SUFFICIENT',
      reason:
        'A fixed scalar can encode the closed crypto result category without returning guest-owned memory or backend detail.',
      requiredResolution:
        'Preserve normalized closed statuses and keep raw backend errors out of the ABI.',
      evidence: Object.freeze([
        citation(
          'A',
          'wasm/.test-results/guest-link-a4/guest-link-poc-decision.md',
          'Phase A proves a synchronous scalar output and explicit invalid-range status.',
        ),
        citation(
          'C',
          'wasm/.test-results/crypto-c4/phase-c-seal.json',
          'Phase C proves the closed verification-result taxonomy and redaction.',
        ),
      ]),
    }),
  ]);

  return Object.freeze({
    version: ASSESSMENT_VERSION,
    checkpoint: 'F2',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    assessmentMeaning:
      'The production-suitability reassessment is complete. PASS does not mean the guest-link is unconditionally production-ready.',
    proofStatus: Object.freeze({
      jwtCryptoLoop: 'PASS',
      changedByAssessment: false,
      guestLinkRequiredForHs256: false,
      productionReleaseReadiness:
        inputs.f1Hardening.productionReleaseReadiness.classification,
    }),
    headlineDecision: Object.freeze({
      guestLinkedProductionCrypto: 'CONDITIONAL',
      reason:
        'The bounded architecture remains viable, but current evidence does not close the signing-input, real-crypto stack/scratch, pointer-retention, and source-rebuild assumptions.',
      nextExperimentMayProceed: true,
      productionClaimAuthorized: false,
    }),
    classificationAxes: axes,
    boundedInputAssessment: inputBounds,
    directQuestions: Object.freeze([
      Object.freeze({
        question:
          'Does the accepted one-memory borrowed-span ABI support production cryptographic verification?',
        answer: 'CONDITIONAL',
        reason:
          'The shape is suitable, but the current byte bound and proof workload are insufficient for an unconditional production claim.',
      }),
      Object.freeze({
        question: 'Is a caller-owned invocation arena sufficient?',
        answer: 'CONDITIONAL-YES',
        reason:
          'A compiler-owned private arena is the preferred bounded design, but its multi-field frame and size must be versioned and proven with the selected real verifier.',
      }),
      Object.freeze({
        question: 'Is an allocator contract required?',
        answer: 'NO-CURRENT-ABI-PROHIBITS-IT',
        reason:
          'The current production experiment should stop or redesign if bounded stack and scratch are insufficient.',
      }),
      Object.freeze({
        question:
          'Can static data, stack, borrowed ranges, and outputs remain non-overlapping under optimization?',
        answer: 'PROVEN-FOR-FIXTURE-CONDITIONAL-FOR-CRYPTO',
        reason:
          'The proof fixture passes exact pre/post-optimization layout audits; a real cryptographic stack and scratch bound has not been observed.',
      }),
      Object.freeze({
        question: 'Are pointer lifetime and retention rules enforceable?',
        answer: 'PARTIALLY',
        reason:
          'Synchronous no-callback execution is enforceable. General non-retention by a stateful production guest needs implementation-specific source and binary audit plus arena clearing.',
      }),
      Object.freeze({
        question:
          'Are malformed ranges normalized without target-dependent traps?',
        answer: 'YES-FOR-V1-SPAN-UNPROVEN-FOR-FUTURE-FRAME',
        reason:
          'Nine v1 invalid classes match under Node and Fastly before and after optimization; multi-field frame validation does not yet exist.',
      }),
      Object.freeze({
        question:
          'Are prebuilt units reproducible and independently inspectable enough?',
        answer: 'CONDITIONAL',
        reason:
          'Packaged and linked bytes are strong; clean source-to-prebuilt reproduction remains open.',
      }),
      Object.freeze({
        question: 'Should source-built units remain maintainer-only?',
        answer: 'YES',
        reason:
          'Ordinary builds must consume reviewed prebuilt identities and never execute package or application supplied build commands.',
      }),
      Object.freeze({
        question:
          'Is the private Binaryen/core-Wasm mechanism replaceable by Component Model/WIT?',
        answer: 'REPLACEABLE-BY-DESIGN-NOT-MIGRATION-PROVEN',
        reason:
          'The pipeline already isolates the mechanism behind plans, target policy, reports, and exact audited final bytes; semantic ABI changes still require a versioned successor.',
      }),
      Object.freeze({
        question: 'Is guest linking ready for a non-crypto package?',
        answer: 'NOT READY',
        reason:
          'No second workload proves output ownership, state, multiple units, imports, or a generalized package contract.',
      }),
      Object.freeze({
        question: 'Which complexity should remain package-private?',
        answer:
          'ALL-GUEST-FRAME-LAYOUT-KEY-ENCODING-TOOLCHAIN-AND-AUDIT-MECHANICS',
        reason:
          'The public seam remains jwt.verify plus explicit crypto configuration and normalized results.',
      }),
    ]),
    componentModelReplacement: Object.freeze({
      possible: true,
      currentMechanismPublic: false,
      stableSeams: Object.freeze(
        inputs.b0.design.componentModelReplacementSeam.stableInputs,
      ),
      mustPreserve: Object.freeze(
        inputs.b0.design.componentModelReplacementSeam.mustPreserve,
      ),
      migrationProven: false,
      thirdPartyComponentsAuthorized: false,
    }),
    complexityPlacement: Object.freeze({
      public: Object.freeze([
        'jwt.verify',
        'explicit configured crypto algorithm',
        'normalized verification result and diagnostics',
      ]),
      packagePrivate: Object.freeze([
        'invocation-frame encoding and bounds',
        'public-key normalization and signature encoding',
        'memory bases, stack, scratch, and arena placement',
        'guest-unit manifest and prebuilt provenance',
        'Binaryen linker, optimizer, commands, and pass order',
        'algorithm implementation and backend status mapping',
        'arena clearing and sensitive-buffer handling',
      ]),
      compilerPrivate: Object.freeze([
        'guest-unit planning and trust resolution',
        'content-addressed materialization',
        'post-link whole-module optimization',
        'complete final-artifact audit',
        'provider delivery of exact audited bytes',
      ]),
      publicAllocationKnob: false,
      publicThirdPartyGuestApi: false,
    }),
    evidenceClassification: Object.freeze({
      observedFacts: Object.freeze([
        `The accepted v1 guest input is one synchronous read-only span of at most ${borrowedMaximum} bytes in one fixed 2 MiB memory.`,
        'The proof fixture normalizes nine malformed range classes without traps or memory mutation and matches under Node and local Fastly before and after optimization.',
        'The production pipeline accepts only synchronized first-party package-prebuilt units and preserves deterministic content-addressed materialization and exact final bytes.',
        `The current JWT contract permits an exact signing input up to ${signingInputMaximum} bytes.`,
        'HS256 uses guest-source:pulse-hmac-as, emits zero linked units, and is the only executable algorithm in the sealed four-target loop.',
        'No asymmetric implementation, production deployment, activation, publication, public guest ABI, or source-build application lane exists.',
      ]),
      inferences: Object.freeze([
        'A versioned caller-owned frame is a simpler and safer extension than allocator coordination for scalar verification.',
        'A verifier that accepts normalized bounded key and signature inputs should fit the one-memory model if its real stack and scratch are proven.',
        'The Component Model can replace static core-Wasm linking without changing public JWT APIs because the mechanism is already private and plan-driven.',
      ]),
      unresolvedAssumptions: Object.freeze([
        'The selected asymmetric implementation stack, static data, fixed scratch, and optimization behavior fit a compiler-owned non-overlapping layout.',
        'A canonical public-key and signature encoding can be bounded without hidden allocation or backend-specific representations.',
        'The signing-input mismatch is resolved by a versioned frame or an explicit algorithm-specific limit without weakening exact-byte semantics.',
        'A real crypto guest cannot retain borrowed pointers or sensitive frame contents across calls.',
        'Clean source-to-prebuilt reconstruction produces the reviewed bytes with frozen tools.',
        'Independent cryptographic and side-channel reviews remain open as recorded by F1.',
      ]),
      toolDocumentedBehaviorAcceptedAsSafetyProof: false,
    }),
    versions: Object.freeze({
      workingCandidate: inputs.f0.workingCandidate.candidateVersion,
      frozenReleaseCatalog: inputs.frozenRelease.releaseVersion,
      versionNumberIsProofGate: false,
      publicationAuthorized: false,
    }),
    sources: Object.freeze({
      hashVerifiedAThroughE: inputs.verified.checkpoints,
      phaseADecision: inputs.verified.phaseADecision,
      jwtRequirements: inputs.verified.d0Requirements,
      frozenRelease: inputs.verified.frozenRelease,
      workingCandidate: inputs.verified.workingCandidate,
      f1: inputs.verified.f1,
      f1Hardening: inputs.verified.f1Hardening,
    }),
    boundaries: Object.freeze({
      implementationChanged: false,
      memoryAbiChanged: false,
      allocatorAdded: false,
      publicAbiAdded: false,
      thirdPartyGuestSupport: false,
      sourceBuildLaneAdded: false,
      asymmetricImplementation: false,
      publication: false,
      documentationPromotion: false,
      remoteDeployment: false,
      providerActivation: false,
    }),
    nextAuthorizedCheckpoint: 'F3',
  });
}

function buildAssumptionLedger(inputs, assessment) {
  const items = Object.freeze([
    assumption({
      id: 'signing-input-capacity',
      status: 'OPEN-BLOCKING-UNCONDITIONAL-GO',
      owner: '@pulse-compute/jwt and @pulse-compute/crypto maintainers',
      reason:
        'The accepted v1 span is 4,096 bytes while the current exact JWT signing-input maximum is 16,340 bytes.',
      nextAction:
        'Choose a versioned larger/segmented private frame or an explicit guest-linked algorithm limit; preserve original signing bytes and reject overflow before guest dereference.',
      evidence: [
        'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
        'wasm/.test-results/jwt-d0/jwt-crypto-requirements.json',
      ],
    }),
    assumption({
      id: 'asymmetric-key-and-signature-encoding',
      status: 'OPEN-BLOCKING-IMPLEMENTATION',
      owner: 'F3 algorithm decision and @pulse-compute/crypto maintainers',
      reason:
        'No canonical key normalization, signature encoding, exact maximum, or malformed-input taxonomy exists for ES256 or RS256.',
      nextAction:
        'Select the first experiment, then freeze package-private encodings, bounds, and deterministic fixtures before implementation.',
      evidence: [
        'wasm/.test-results/crypto-c4/phase-c-seal.json',
        'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
      ],
    }),
    assumption({
      id: 'real-crypto-stack-static-and-scratch-layout',
      status: 'OPEN-BLOCKING-UNCONDITIONAL-GO',
      owner: '@pulse-compute/wasm-guest-link and crypto implementation maintainers',
      reason:
        'The fixture has trivial stack behavior. No selected asymmetric implementation has proven its real stack high-water mark, static data, scratch writes, or optimized layout.',
      nextAction:
        'Compile the selected verifier with fixed bases, instrument or conservatively bound stack/scratch, and audit pairwise ranges before and after optimization on Node and Fastly.',
      evidence: [
        'wasm/.test-results/guest-link-a3/guest-link-poc-final-audit.json',
        'wasm/.test-results/guest-link-b1/final-wasm-audit.json',
      ],
    }),
    assumption({
      id: 'invocation-frame-contract',
      status: 'REQUIRED-NOT-IMPLEMENTED',
      owner: '@pulse-compute/crypto and compiler maintainers',
      reason:
        'Production verification has several typed byte inputs, but borrowed-span v1 proves only one opaque span.',
      nextAction:
        'Define a private versioned frame with checked offsets, lengths, alignment, non-overlap, total size, zeroization, and scalar result.',
      evidence: [
        'wasm/.test-results/guest-link-a4/guest-link-poc-decision.md',
        'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json',
      ],
    }),
    assumption({
      id: 'pointer-retention-with-stateful-crypto',
      status: 'OPEN-BLOCKING-UNCONDITIONAL-GO',
      owner: '@pulse-compute/wasm-guest-link and independent security reviewer',
      reason:
        'The proof guest has no stores or mutable state. Real crypto needs stores and scratch, so the fixture’s structural non-retention inference does not automatically generalize.',
      nextAction:
        'Specify no-retention and arena-clearing obligations, inspect source and final bytes for persistent state, and replay consecutive-call contamination tests.',
      evidence: [
        'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
        'wasm/.test-results/guest-link-b1/final-wasm-audit.json',
      ],
    }),
    assumption({
      id: 'multi-field-malformed-range-normalization',
      status: 'OPEN-BLOCKING-IMPLEMENTATION',
      owner: '@pulse-compute/wasm-guest-link and crypto maintainers',
      reason:
        'The nine proven invalid classes cover one pointer/length pair, not a frame containing multiple possibly overlapping or overflowing ranges.',
      nextAction:
        'Validate the complete frame before any dereference and add overflow, overlap, aliasing, alignment, truncation, duplicate-field, and boundary vectors across exact final artifacts.',
      evidence: [
        'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
        'wasm/.test-results/guest-link-a3/guest-link-poc-final-audit.json',
      ],
    }),
    assumption({
      id: 'clean-source-to-prebuilt-reproduction',
      status: 'OPEN-PRODUCTION-READINESS',
      owner: 'release engineering and guest-unit maintainers',
      reason:
        'Phase B reproduces from packaged prebuilt bytes and retains source provenance, but does not seal clean source reconstruction to identical prebuilt bytes.',
      nextAction:
        'Run an isolated maintainer-only rebuild using exact source, lockfile, target, tools, commands, and environment; compare prebuilt and linked artifact hashes.',
      evidence: [
        'wasm/.test-results/guest-link-b1/guest-link-package-report.json',
        'wasm/.test-results/jwt-f1/jwt-f1-production-hardening.json',
      ],
    }),
    assumption({
      id: 'component-model-migration',
      status: 'CONTAINED-NOT-PROVEN',
      owner: '@pulse-compute/wasm-guest-link maintainers',
      reason:
        'The current mechanism is isolated behind private plans and reports, but no Component Model/WIT implementation has reproduced the semantics or evidence.',
      nextAction:
        'Keep mechanism details private and require a versioned successor to preserve trust, no-fallback, memory/lifetime, reports, and exact provider artifact identity.',
      evidence: [
        'wasm/.test-results/guest-link-b0/guest-link-contract-design.json',
        'wasm/.test-results/guest-link-b4/phase-b-seal.json',
      ],
    }),
  ]);

  return Object.freeze({
    version: ASSUMPTION_VERSION,
    checkpoint: 'F2',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    assessmentDecision:
      assessment.headlineDecision.guestLinkedProductionCrypto,
    meaning:
      'All assumptions that prevent unconditional production suitability are explicit; this ledger does not resolve them.',
    items,
    counts: Object.freeze({
      total: items.length,
      open: items.filter((entry) => entry.status.startsWith('OPEN')).length,
      requiredNotImplemented: items.filter(
        (entry) => entry.status === 'REQUIRED-NOT-IMPLEMENTED',
      ).length,
      containedNotProven: items.filter(
        (entry) => entry.status === 'CONTAINED-NOT-PROVEN',
      ).length,
    }),
    allocatorDisposition: Object.freeze({
      currentAbi: 'PROHIBITED',
      publicConfiguration: false,
      futureChangeRequiresNewAbiAndArchitectureReview: true,
    }),
    nextAuthorizedCheckpoint: 'F3',
  });
}

function renderDecision(assessment, ledger) {
  const lines = [
    '# F2 guest-link production-suitability decision',
    '',
    `**Assessment:** ${assessment.classification}`,
    `**Guest-linked production crypto:** ${assessment.headlineDecision.guestLinkedProductionCrypto}`,
    `**Production-release readiness:** ${assessment.proofStatus.productionReleaseReadiness}`,
    '**Next authorized checkpoint:** F3',
    '',
    'F2 preserves the guest-link architecture but does not grant an',
    'unconditional production claim. The exact v1 borrowed span is 4,096 bytes;',
    'the current JWT contract permits an exact signing input up to 16,340 bytes.',
    'A real asymmetric verifier, its stack/scratch layout, multi-field malformed',
    'range behavior, pointer non-retention, and clean source reconstruction are',
    'not yet proven.',
    '',
    '## Classification axes',
    '',
    '| Axis | Decision |',
    '|---|---|',
    ...assessment.classificationAxes.map(
      (entry) => `| ${entry.axis} | **${entry.decision}** |`,
    ),
    '',
    '## Required shape for the first guest-linked crypto experiment',
    '',
    '- Keep a caller-owned, compiler-laid-out invocation arena private.',
    '- Version a bounded multi-field frame; do not reinterpret borrowed-span v1.',
    '- Preserve exact signing bytes and reject every overflow or overlap before',
    '  guest dereference.',
    '- Keep the guest allocator prohibited. Stop or redesign if bounded stack',
    '  and scratch are insufficient.',
    '- Audit the real verifier before and after optimization, then execute the',
    '  exact final artifact under Node and local Fastly with no fallback.',
    '- Rebuild prebuilt bytes in a maintainer-only clean environment.',
    '',
    '## Explicit open assumptions',
    '',
    '| Assumption | Status | Owner |',
    '|---|---|---|',
    ...ledger.items.map(
      (entry) =>
        `| ${entry.id} | ${entry.status} | ${entry.owner.replaceAll('|', '\\|')} |`,
    ),
    '',
    '## Boundary',
    '',
    'This decision does not change the memory ABI, add an allocator, expose a',
    'public or third-party guest contract, add source builds, implement',
    'asymmetric cryptography, publish packages, deploy a provider, or activate',
    'a service. The unpublished JWT/crypto candidate remains 1.0.0-beta.1; the frozen',
    'release catalog remains 1.0.0-beta.1.',
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
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const inputs = loadAndVerifyInputs();
  const assessment = buildAssessment(inputs);
  const assumptions = buildAssumptionLedger(inputs, assessment);

  const assessmentRecord = writeOutput(
    options.outputDirectory,
    'jwt-f2-guest-link-suitability.json',
    stableJson(assessment),
  );
  const assumptionsRecord = writeOutput(
    options.outputDirectory,
    'jwt-f2-memory-assumption-ledger.json',
    stableJson(assumptions),
  );
  const decisionRecord = writeOutput(
    options.outputDirectory,
    'guest-link-production-suitability-decision.md',
    renderDecision(assessment, assumptions),
  );

  const evidence = Object.freeze({
    version: EVIDENCE_VERSION,
    checkpoint: 'F2',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    scope: 'guest-link-production-suitability-reassessment',
    reports: Object.freeze({
      assessment: assessmentRecord,
      memoryAssumptions: assumptionsRecord,
      decision: decisionRecord,
    }),
    decisions: Object.freeze(
      Object.fromEntries(
        assessment.classificationAxes.map((entry) => [
          entry.axis,
          entry.decision,
        ]),
      ),
    ),
    acceptance: Object.freeze({
      everyDecisionCitesAThroughE: assessment.classificationAxes.every(
        (entry) =>
          PHASES.every((phase) =>
            entry.evidence.some((citationEntry) => citationEntry.phase === phase),
          ),
      ),
      unresolvedMemoryAndToolchainAssumptionsExplicit:
        assumptions.items.length > 0 &&
        assessment.evidenceClassification.unresolvedAssumptions.length > 0,
      publicThirdPartyGuestSupportImplied: false,
      phaseABorrowedSpanUpgradedToGeneralAllocatorClaim: false,
      componentModelReplacementRemainsPossible:
        assessment.componentModelReplacement.possible,
      productionSuitabilityClaim:
        assessment.headlineDecision.guestLinkedProductionCrypto,
      productionReleaseReadiness:
        assessment.proofStatus.productionReleaseReadiness,
    }),
    boundaries: assessment.boundaries,
    nextAuthorizedCheckpoint: 'F3',
  });
  writeOutput(
    options.outputDirectory,
    'jwt-f2-evidence.json',
    stableJson(evidence),
  );

  process.stdout.write(
    `ok - F2 classified guest-linked production crypto ${assessment.headlineDecision.guestLinkedProductionCrypto}; ` +
      `${assessment.classificationAxes.length} axes and ${assumptions.items.length} explicit assumptions authorize F3 without a production claim\n`,
  );
}

main();
