#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const COMPARISON_VERSION =
  'pulse.jwt-asymmetric-candidate-comparison.f3.v1';
const MATRIX_VERSION = 'pulse.jwt-asymmetric-five-target-matrix.f3.v1';
const EVIDENCE_VERSION = 'pulse.jwt-f3-evidence.v1';
const SOURCE_VERSION =
  'pulse.jwt-asymmetric-primary-source-evidence.f3.v1';
const CANDIDATES = Object.freeze(['ES256', 'RS256', 'Ed25519']);
const TARGETS = Object.freeze([
  'node-javascript',
  'fastly-javascript',
  'browser-javascript',
  'native-wasm',
  'esp32',
]);
const CRITERIA = Object.freeze([
  'security-objective-and-authority-separation',
  'current-jwt-ecosystem-demand',
  'key-and-signature-encoding-complexity',
  'strict-der-and-raw-signature-handling',
  'public-key-parsing',
  'code-size',
  'data-stack-and-memory',
  'borrowed-span-fit',
  'allocation-and-large-integer-support',
  'small-auditable-host-neutral-implementation',
  'source-license-and-provenance',
  'reproducible-prebuilt-generation',
  'deterministic-test-vectors',
  'node-and-fastly-conformance',
  'compile-link-and-optimization-cost',
  'side-channel-and-constant-time-review',
  'guest-link-seam-value',
  'component-model-and-wit-migration',
  'jwt-fixture-interoperability-without-bypass',
]);
const CRITERION_STATUSES = new Set([
  'FAVORABLE',
  'MIXED',
  'UNFAVORABLE',
  'CONDITIONAL',
  'UNMEASURED',
]);

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-f3');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT F3 option: ${argv[index]}`);
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

function sourceReferences(sourceIds, sourceById) {
  assert.ok(Array.isArray(sourceIds) && sourceIds.length > 0);
  return Object.freeze(
    sourceIds.map((id) => {
      const source = sourceById.get(id);
      assert.ok(source, `Unknown F3 primary source: ${id}`);
      return Object.freeze({
        id: source.id,
        url: source.url,
      });
    }),
  );
}

function criterion(status, finding, sourceIds, sourceById, unknowns = []) {
  assert.ok(CRITERION_STATUSES.has(status), status);
  assert.ok(finding);
  assert.ok(Array.isArray(unknowns));
  if (status === 'UNMEASURED') {
    assert.ok(unknowns.length > 0, 'UNMEASURED criteria must name unknowns');
  }
  return Object.freeze({
    status,
    finding,
    sources: sourceReferences(sourceIds, sourceById),
    unknowns: Object.freeze(unknowns),
  });
}

function candidateAssessment(value) {
  assert.ok(CANDIDATES.includes(value.algorithm));
  assert.deepEqual(Object.keys(value.criteria), CRITERIA);
  assert.equal(value.privateFrame.rawPayloadBytes <= value.privateFrame.capacityBytes, true);
  assert.equal(value.privateFrame.capacityBytes % 256, 0);
  return Object.freeze({
    ...value,
    criteria: Object.freeze(value.criteria),
    requiredPreconditions: Object.freeze(value.requiredPreconditions),
  });
}

function loadAndVerifyInputs() {
  const sourceFile =
    'wasm/test/jwt/fixtures/contracts/jwt-asymmetric-candidate-evidence.json';
  const sourceEvidence = readJson(sourceFile);
  assert.equal(sourceEvidence.version, SOURCE_VERSION);
  assert.equal(sourceEvidence.checkpoint, 'F3');
  assert.deepEqual(sourceEvidence.scope.originalCandidates, [
    'ES256',
    'RS256',
  ]);
  assert.deepEqual(sourceEvidence.scope.amendedCandidates, CANDIDATES);
  assert.equal(sourceEvidence.scope.implementationAuthorized, false);

  const sourceById = new Map();
  for (const source of sourceEvidence.sources) {
    assert.ok(source.id);
    assert.match(source.url, /^https:\/\//);
    assert.ok(Array.isArray(source.facts) && source.facts.length > 0);
    assert.equal(sourceById.has(source.id), false, source.id);
    sourceById.set(source.id, source);
  }
  for (const target of TARGETS) {
    const targetEvidence = sourceEvidence.targetEvidence[target];
    assert.ok(targetEvidence, target);
    assert.deepEqual(Object.keys(targetEvidence.candidates), CANDIDATES);
    for (const candidate of CANDIDATES) {
      assert.ok(targetEvidence.candidates[candidate].status);
      sourceReferences(
        targetEvidence.candidates[candidate].sources,
        sourceById,
      );
    }
  }
  assert.deepEqual(
    Object.keys(sourceEvidence.implementationCandidates),
    CANDIDATES,
  );
  for (const candidate of CANDIDATES) {
    const implementation =
      sourceEvidence.implementationCandidates[candidate];
    assert.equal(implementation.measuredInPulse, false);
    sourceReferences(implementation.sources, sourceById);
  }

  const f0 = readJson(
    'wasm/.test-results/jwt-f0/jwt-f0-evidence-consolidation.json',
  );
  const f1 = readJson('wasm/.test-results/jwt-f1/jwt-f1-evidence.json');
  const f2 = readJson('wasm/.test-results/jwt-f2/jwt-f2-evidence.json');
  const f2Assessment = readJson(
    'wasm/.test-results/jwt-f2/jwt-f2-guest-link-suitability.json',
  );
  const a2 = readJson(
    'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
  );
  const c4 = readJson('wasm/.test-results/crypto-c4/phase-c-seal.json');
  const d0 = readJson(
    'wasm/.test-results/jwt-d0/jwt-crypto-requirements.json',
  );
  const d4 = readJson('wasm/.test-results/jwt-d4/jwt-phase-d-seal.json');
  const e4 = readJson('wasm/.test-results/jwt-e4/jwt-phase-e-seal.json');

  assert.equal(f0.status, 'passed');
  assert.equal(f0.classification, 'PASS');
  assert.equal(f1.status, 'passed');
  assert.equal(f1.classification, 'PASS');
  assert.equal(f2.status, 'passed');
  assert.equal(f2.classification, 'PASS');
  assert.equal(f2.nextAuthorizedCheckpoint, 'F3');
  assert.equal(f2Assessment.status, 'passed');
  assert.equal(
    f2Assessment.headlineDecision.guestLinkedProductionCrypto,
    'CONDITIONAL',
  );
  assert.equal(
    f2Assessment.headlineDecision.nextExperimentMayProceed,
    true,
  );
  assert.equal(c4.boundaries.asymmetricCrypto, false);
  assert.equal(d0.status, 'frozen-for-d1');
  assert.equal(d4.status, 'passed');
  assert.equal(d4.versionDecision.workingCandidate, '1.0.0-beta.1');
  assert.equal(d4.versionDecision.frozenReleaseCatalog, '1.0.0-beta.1');
  assert.equal(e4.status, 'passed');
  assert.equal(
    e4.implementationBoundaries.asymmetricImplementationPresent,
    false,
  );
  assert.deepEqual(
    e4.implementationBoundaries.publicJwtAlgorithmVocabulary,
    ['HS256', 'RS256', 'ES256', 'EdDSA'],
  );

  const inputRegion = a2.candidate.layout.inputRegion;
  const physicalArenaBytes =
    inputRegion.upperBoundaryExclusive - inputRegion.base;
  assert.equal(inputRegion.base, 524288);
  assert.equal(inputRegion.upperBoundaryExclusive, 2 * 1024 * 1024);
  assert.equal(physicalArenaBytes, 1572864);
  const provenSpan = a2.candidate.execution.validBoundaryRanges.find(
    (entry) => entry.class === 'maximum-accepted-length',
  );
  assert.equal(provenSpan.length, 4096);
  const signingInputMaximum =
    d0.resourceLimits.effectiveJwtSigningInputBytesMaximum;
  assert.equal(signingInputMaximum, 16340);

  for (const record of Object.values(f2.reports)) verifyRecord(record);

  return Object.freeze({
    sourceEvidence,
    sourceById,
    f0,
    f1,
    f2,
    f2Assessment,
    a2,
    c4,
    d0,
    d4,
    e4,
    physicalArenaBytes,
    provenSpanBytes: provenSpan.length,
    signingInputMaximum,
    records: Object.freeze({
      primarySources: fileRecord(sourceFile),
      f0: fileRecord(
        'wasm/.test-results/jwt-f0/jwt-f0-evidence-consolidation.json',
      ),
      f1: fileRecord(
        'wasm/.test-results/jwt-f1/jwt-f1-evidence.json',
      ),
      f2: fileRecord(
        'wasm/.test-results/jwt-f2/jwt-f2-evidence.json',
      ),
      f2Assessment: fileRecord(
        'wasm/.test-results/jwt-f2/jwt-f2-guest-link-suitability.json',
      ),
      memoryProof: fileRecord(
        'wasm/.test-results/guest-link-a2/guest-link-poc-memory-report.json',
      ),
      cryptoSeal: fileRecord(
        'wasm/.test-results/crypto-c4/phase-c-seal.json',
      ),
      jwtRequirements: fileRecord(
        'wasm/.test-results/jwt-d0/jwt-crypto-requirements.json',
      ),
      jwtSeal: fileRecord(
        'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json',
      ),
      targetSeal: fileRecord(
        'wasm/.test-results/jwt-e4/jwt-phase-e-seal.json',
      ),
    }),
  });
}

function buildCandidateAssessments(inputs) {
  const { sourceById, signingInputMaximum } = inputs;
  const c = (status, finding, sources, unknowns = []) =>
    criterion(status, finding, sources, sourceById, unknowns);

  const es256KeyBytes = 64;
  const es256SignatureBytes = 64;
  const es256RawPayloadBytes =
    signingInputMaximum + es256KeyBytes + es256SignatureBytes;
  const ed25519KeyBytes = 32;
  const ed25519SignatureBytes = 64;
  const ed25519RawPayloadBytes =
    signingInputMaximum + ed25519KeyBytes + ed25519SignatureBytes;
  const rsa3072ModulusBytes = 384;
  const rsaExponentSlotBytes = 8;
  const rsa3072SignatureBytes = 384;
  const rs256RawPayloadBytes =
    signingInputMaximum +
    rsa3072ModulusBytes +
    rsaExponentSlotBytes +
    rsa3072SignatureBytes;

  const es256 = candidateAssessment({
    algorithm: 'ES256',
    primitive: 'ECDSA over P-256 with SHA-256',
    joseIdentifier: 'ES256',
    experimentRole: 'RECOMMENDED',
    normalizedGuestInputs: Object.freeze({
      publicKey:
        'Exactly 64 bytes: big-endian x || y coordinates; host adapter removes JWK, SEC1, or SPKI representation.',
      signature:
        'Exactly 64 bytes: big-endian r || s as required for JWS; DER is rejected at the guest boundary.',
      parameters: 'Compile-time fixed P-256 and SHA-256.',
      result: 'One closed scalar verification status.',
    }),
    privateFrame: Object.freeze({
      signingInputMaximumBytes: signingInputMaximum,
      normalizedPublicKeyBytes: es256KeyBytes,
      signatureBytes: es256SignatureBytes,
      rawPayloadBytes: es256RawPayloadBytes,
      headerAlignmentAndReservedBytes: 172,
      capacityBytes: 16640,
    }),
    criteria: {
      'security-objective-and-authority-separation': c(
        'FAVORABLE',
        'Asymmetric verification keeps issuer authority out of verifiers and P-256 targets the intended modern security class.',
        ['rfc-7518'],
      ),
      'current-jwt-ecosystem-demand': c(
        'FAVORABLE',
        'ES256 is a recommended JOSE algorithm with meaningful current deployment, though RS256 remains the stronger compatibility default.',
        ['iana-jose-algorithms', 'rfc-7518'],
      ),
      'key-and-signature-encoding-complexity': c(
        'FAVORABLE',
        'The guest can consume one fixed 64-byte affine point and one fixed 64-byte JWS signature.',
        ['rfc-7518'],
      ),
      'strict-der-and-raw-signature-handling': c(
        'MIXED',
        'JWS fixes the signature as raw r || s, simplifying the guest, but every adapter must reject or explicitly normalize DER instead of passing backend-specific encodings through.',
        ['rfc-7518'],
      ),
      'public-key-parsing': c(
        'MIXED',
        'JWK, SEC1, and SPKI parsing stays outside the guest; the verifier must still validate that the normalized coordinates encode a valid P-256 point.',
        ['rfc-7518'],
      ),
      'code-size': c(
        'UNMEASURED',
        'A no_std P-256 candidate exists, but Pulse has not built or measured its final linked bytes.',
        ['rustcrypto-p256'],
        ['prebuilt bytes', 'linked bytes', 'optimized bytes'],
      ),
      'data-stack-and-memory': c(
        'UNMEASURED',
        'Fixed-width arithmetic is compatible with a bounded design, but actual stack high-water, static data, and scratch remain unknown.',
        ['rustcrypto-p256'],
        ['stack high-water', 'static data', 'scratch writes'],
      ),
      'borrowed-span-fit': c(
        'FAVORABLE',
        `The ${es256RawPayloadBytes}-byte maximum normalized payload fits a proposed 16,640-byte private frame and the existing physical arena.`,
        ['rfc-7518'],
      ),
      'allocation-and-large-integer-support': c(
        'FAVORABLE',
        'P-256 can use fixed-width field arithmetic without a guest allocator; that property must be proven for the selected feature set and final artifact.',
        ['rustcrypto-p256'],
      ),
      'small-auditable-host-neutral-implementation': c(
        'CONDITIONAL',
        'RustCrypto p256 is host-neutral and no_std-capable, but its documented audit and constant-time limitations keep suitability conditional.',
        ['rustcrypto-p256'],
      ),
      'source-license-and-provenance': c(
        'CONDITIONAL',
        'The candidate is Apache-2.0 OR MIT, but the exact source, features, dependency closure, and review disposition are not yet frozen.',
        ['rustcrypto-p256'],
      ),
      'reproducible-prebuilt-generation': c(
        'UNMEASURED',
        'The existing sealed prebuilt pipeline is applicable, but no ES256 source-to-prebuilt reconstruction has run.',
        ['rustcrypto-p256'],
        ['toolchain hash', 'source hash', 'prebuilt byte identity'],
      ),
      'deterministic-test-vectors': c(
        'FAVORABLE',
        'JOSE fixes the signature representation and RFC 6979 supplies deterministic ECDSA material for future signing tests; verification can use fixed positive and malformed vectors.',
        ['rfc-7518', 'rfc-6979'],
      ),
      'node-and-fastly-conformance': c(
        'MIXED',
        'Node Web Crypto documents ECDSA verification. Fastly JavaScript documents ECDSA key import but not ECDSA verify, while the guest-linked verifier can still be exercised in the Fastly Native cell.',
        [
          'node-webcrypto-v24',
          'fastly-subtle-import-key',
          'fastly-subtle-verify',
        ],
      ),
      'compile-link-and-optimization-cost': c(
        'UNMEASURED',
        'No ES256 guest has been compiled, linked, optimized, or timed in Pulse.',
        ['rustcrypto-p256'],
        ['compile time', 'link time', 'optimization time'],
      ),
      'side-channel-and-constant-time-review': c(
        'CONDITIONAL',
        'Verification handles public inputs, but field arithmetic, point validation, malformed inputs, and any future signer still need an independent review; future signing must use a deterministic nonce construction.',
        ['rustcrypto-p256', 'rfc-6979'],
      ),
      'guest-link-seam-value': c(
        'FAVORABLE',
        'A fixed-width real verifier exercises code linking, static data, stack, scratch, frame validation, optimization, and exact-artifact execution without first introducing general large-integer machinery.',
        ['rustcrypto-p256'],
      ),
      'component-model-and-wit-migration': c(
        'FAVORABLE',
        'Fixed byte fields plus a scalar result map directly to a future private WIT interface without exposing the current memory layout.',
        ['rfc-7518'],
      ),
      'jwt-fixture-interoperability-without-bypass': c(
        'CONDITIONAL',
        'ES256 JWT fixtures can pass through the existing crypto-owned seam once keys and raw signatures are normalized; no runtime or host fallback may be added.',
        ['rfc-7518'],
      ),
    },
    requiredPreconditions: [
      'Freeze the exact p256 source revision, minimal features, dependency closure, license disposition, and reproducible maintainer-only build.',
      'Implement private frame v2 with complete offset, length, overflow, alignment, overlap, and lifetime validation before dereference.',
      'Prove fixed stack, static data, scratch, no allocator, no memory growth, pointer non-retention, and deterministic arena clearing before and after optimization.',
      'Validate normalized P-256 points and strict 64-byte r || s values, including zero, out-of-range, malformed, truncated, and boundary cases.',
      'Run the same fixtures through Node JavaScript where eligible, Node Native, and Fastly Native exact artifacts with no backend bypass; keep Fastly JavaScript explicitly ineligible until ECDSA verify is proven.',
      'Complete independent cryptographic and side-channel review before any production claim.',
    ],
  });

  const rs256 = candidateAssessment({
    algorithm: 'RS256',
    primitive: 'RSASSA-PKCS1-v1_5 with SHA-256',
    joseIdentifier: 'RS256',
    experimentRole: 'COMPATIBILITY_LEADER_NOT_FIRST_GUEST',
    normalizedGuestInputs: Object.freeze({
      publicKey:
        'Candidate experiment form: exactly 384-byte big-endian modulus plus an 8-byte checked exponent slot for RSA-3072; host adapter removes JWK or SPKI representation.',
      signature:
        'Exactly 384 bytes for the RSA-3072 experiment; length must match the modulus.',
      parameters: 'Compile-time fixed SHA-256 and PKCS#1 v1.5 verification.',
      result: 'One closed scalar verification status.',
    }),
    privateFrame: Object.freeze({
      signingInputMaximumBytes: signingInputMaximum,
      normalizedPublicKeyBytes:
        rsa3072ModulusBytes + rsaExponentSlotBytes,
      signatureBytes: rsa3072SignatureBytes,
      rawPayloadBytes: rs256RawPayloadBytes,
      headerAlignmentAndReservedBytes: 292,
      capacityBytes: 17408,
    }),
    criteria: {
      'security-objective-and-authority-separation': c(
        'FAVORABLE',
        'Asymmetric verification preserves issuer/verifier authority separation; the experiment would use RSA-3072 rather than treating the JOSE 2048-bit minimum as the design target.',
        ['rfc-7518', 'esp-idf-crypto-guidance'],
      ),
      'current-jwt-ecosystem-demand': c(
        'FAVORABLE',
        'RS256 has the strongest compatibility evidence, including OpenID Connect requirements and a major managed issuer.',
        [
          'iana-jose-algorithms',
          'openid-connect-core',
          'aws-cognito-jwt',
        ],
      ),
      'key-and-signature-encoding-complexity': c(
        'UNFAVORABLE',
        'The modulus, exponent, and modulus-sized signature are substantially larger and require more normalization than either fixed-curve candidate.',
        ['rfc-7518'],
      ),
      'strict-der-and-raw-signature-handling': c(
        'MIXED',
        'The JWS signature is a modulus-sized octet string rather than an ECDSA DER tuple, but public keys still arrive through JWK or ASN.1/SPKI representations that must stay outside the guest.',
        ['rfc-7518'],
      ),
      'public-key-parsing': c(
        'UNFAVORABLE',
        'JWK or SPKI parsing, modulus sizing, exponent checks, and leading-zero normalization create the largest adapter contract of the candidates.',
        ['rfc-7518'],
      ),
      'code-size': c(
        'UNMEASURED',
        'A portable implementation exists, but Pulse has not measured the large-integer and PKCS#1 verification closure.',
        ['rustcrypto-rsa'],
        ['prebuilt bytes', 'linked bytes', 'optimized bytes'],
      ),
      'data-stack-and-memory': c(
        'UNMEASURED',
        'RSA verification is expected to need the largest arithmetic scratch, but no Pulse artifact supplies an actual bound.',
        ['rustcrypto-rsa'],
        ['stack high-water', 'large-integer scratch', 'static data'],
      ),
      'borrowed-span-fit': c(
        'MIXED',
        `The ${rs256RawPayloadBytes}-byte RSA-3072 normalized payload fits the physical arena but needs a larger 17,408-byte private frame than the fixed-curve candidates.`,
        ['rfc-7518', 'esp-idf-crypto-guidance'],
      ),
      'allocation-and-large-integer-support': c(
        'UNFAVORABLE',
        'RSA necessarily introduces large-integer arithmetic, and the candidate dependency path must prove whether allocation can be removed rather than assuming the current no-allocator contract fits.',
        ['rustcrypto-rsa'],
      ),
      'small-auditable-host-neutral-implementation': c(
        'CONDITIONAL',
        'A portable pure-Rust candidate exists, but its big-integer closure and documented security caveats create more audit surface than fixed-width curve verification.',
        ['rustcrypto-rsa'],
      ),
      'source-license-and-provenance': c(
        'CONDITIONAL',
        'The candidate is Apache-2.0 OR MIT, but the exact source, features, big-integer backend, dependency closure, and review disposition are not frozen.',
        ['rustcrypto-rsa'],
      ),
      'reproducible-prebuilt-generation': c(
        'UNMEASURED',
        'No RS256 source-to-prebuilt reconstruction or byte identity has run in Pulse.',
        ['rustcrypto-rsa'],
        ['toolchain hash', 'source hash', 'prebuilt byte identity'],
      ),
      'deterministic-test-vectors': c(
        'FAVORABLE',
        'RSASSA-PKCS1-v1_5 verification has deterministic expected results and abundant JOSE interoperability material; Pulse still needs a pinned strict corpus.',
        ['rfc-7518', 'openid-connect-core', 'aws-cognito-jwt'],
      ),
      'node-and-fastly-conformance': c(
        'FAVORABLE',
        'RSASSA-PKCS1-v1_5 verification is documented by both Node and Fastly JavaScript, making RS256 the immediate runtime compatibility leader.',
        ['node-webcrypto-v24', 'fastly-subtle-verify'],
      ),
      'compile-link-and-optimization-cost': c(
        'UNMEASURED',
        'No RSA guest has been compiled, linked, optimized, or timed in Pulse; qualitative big-integer concerns are not substituted for measurements.',
        ['rustcrypto-rsa'],
        ['compile time', 'link time', 'optimization time'],
      ),
      'side-channel-and-constant-time-review': c(
        'CONDITIONAL',
        'Verification operates on public material, but strict PKCS#1 v1.5 encoding, malformed-input behavior, arithmetic, and any reusable library paths still require review.',
        ['rustcrypto-rsa', 'rfc-7518'],
      ),
      'guest-link-seam-value': c(
        'MIXED',
        'RS256 would exercise the seam, but much of the first experiment would be spent proving large-integer and allocation behavior rather than the private frame and linker boundary itself.',
        ['rustcrypto-rsa'],
      ),
      'component-model-and-wit-migration': c(
        'FAVORABLE',
        'Bounded normalized key and signature fields plus a scalar result can migrate to WIT, provided modulus and exponent bounds remain explicit.',
        ['rfc-7518'],
      ),
      'jwt-fixture-interoperability-without-bypass': c(
        'FAVORABLE',
        'RS256 has the strongest existing issuer interoperability path and both current JavaScript runtimes document the primitive; Pulse must still route it only through crypto-owned exact realization selection.',
        [
          'openid-connect-core',
          'aws-cognito-jwt',
          'node-webcrypto-v24',
          'fastly-subtle-verify',
        ],
      ),
    },
    requiredPreconditions: [
      'Choose and justify a fixed RSA modulus policy; the comparison uses RSA-3072 rather than silently equating the JOSE 2048-bit minimum with the fixed-curve security objective.',
      'Prove an allocator-free or explicitly redesigned private ABI with measured big-integer stack and scratch.',
      'Freeze modulus, exponent, signature, JWK/SPKI normalization, and strict PKCS#1 v1.5 malformed-input rules.',
      'Build, optimize, audit, reproduce, and execute exact artifacts before making code-size or performance claims.',
      'Keep runtime support as an explicit realization choice and never bypass the crypto substrate.',
    ],
  });

  const ed25519 = candidateAssessment({
    algorithm: 'Ed25519',
    primitive: 'Ed25519 with its fixed SHA-512-based construction',
    joseIdentifier: 'Ed25519',
    experimentRole: 'STRATEGIC_SECOND',
    normalizedGuestInputs: Object.freeze({
      publicKey:
        'Exactly 32 compressed Edwards-y bytes; host adapter removes OKP JWK representation.',
      signature: 'Exactly 64 bytes: encoded R || encoded S.',
      parameters: 'Compile-time fixed Ed25519; no polymorphic EdDSA dispatch.',
      result: 'One closed scalar verification status.',
    }),
    privateFrame: Object.freeze({
      signingInputMaximumBytes: signingInputMaximum,
      normalizedPublicKeyBytes: ed25519KeyBytes,
      signatureBytes: ed25519SignatureBytes,
      rawPayloadBytes: ed25519RawPayloadBytes,
      headerAlignmentAndReservedBytes: 204,
      capacityBytes: 16640,
    }),
    criteria: {
      'security-objective-and-authority-separation': c(
        'FAVORABLE',
        'Ed25519 supplies asymmetric issuer/verifier authority separation with a modern fixed-curve design.',
        ['rfc-8032', 'rfc-9864'],
      ),
      'current-jwt-ecosystem-demand': c(
        'MIXED',
        'Ed25519 now has a fully specified JOSE identifier but remains Optional in the registry and is less common in current identity-provider JWT flows than RS256 or ES256.',
        ['iana-jose-algorithms', 'rfc-9864', 'openid-connect-core'],
      ),
      'key-and-signature-encoding-complexity': c(
        'FAVORABLE',
        'The 32-byte public key and 64-byte signature are the smallest and simplest fixed-width wire inputs in this comparison.',
        ['rfc-8032', 'rfc-8037'],
      ),
      'strict-der-and-raw-signature-handling': c(
        'FAVORABLE',
        'Ed25519 uses one fixed 64-byte signature encoding and has no ECDSA DER/raw ambiguity.',
        ['rfc-8032'],
      ),
      'public-key-parsing': c(
        'FAVORABLE',
        'The host adapter can reduce an OKP JWK to one fixed 32-byte key; the guest still enforces strict point and scalar validation.',
        ['rfc-8032', 'rfc-8037'],
      ),
      'code-size': c(
        'UNMEASURED',
        'A no_std implementation candidate exists, but Pulse has not measured its SHA-512 and curve dependency closure.',
        ['ed25519-dalek', 'rfc-8032'],
        ['prebuilt bytes', 'linked bytes', 'optimized bytes'],
      ),
      'data-stack-and-memory': c(
        'UNMEASURED',
        'The wire inputs are smallest, but actual stack, static data, SHA-512 state, and curve scratch remain unmeasured.',
        ['ed25519-dalek', 'rfc-8032'],
        ['stack high-water', 'static data', 'scratch writes'],
      ),
      'borrowed-span-fit': c(
        'FAVORABLE',
        `The ${ed25519RawPayloadBytes}-byte maximum normalized payload fits the same proposed 16,640-byte private frame as ES256 and the existing physical arena.`,
        ['rfc-8032'],
      ),
      'allocation-and-large-integer-support': c(
        'FAVORABLE',
        'A fixed-width no_std implementation path exists and does not inherently require an allocator, subject to exact feature and artifact proof.',
        ['ed25519-dalek'],
      ),
      'small-auditable-host-neutral-implementation': c(
        'CONDITIONAL',
        'ed25519-dalek is host-neutral and no_std-capable with strict APIs, but its exact backend and dependency closure still require review.',
        ['ed25519-dalek'],
      ),
      'source-license-and-provenance': c(
        'CONDITIONAL',
        'The candidate is Apache-2.0 OR MIT, but the exact source revision, features, curve backend, SHA-512 backend, and review disposition are not frozen.',
        ['ed25519-dalek'],
      ),
      'reproducible-prebuilt-generation': c(
        'UNMEASURED',
        'No Ed25519 source-to-prebuilt reconstruction or byte identity has run in Pulse.',
        ['ed25519-dalek'],
        ['toolchain hash', 'source hash', 'prebuilt byte identity'],
      ),
      'deterministic-test-vectors': c(
        'FAVORABLE',
        'RFC 8032 supplies deterministic vectors and Ed25519 signing is deterministic; RFC 8037 supplies JOSE representation examples.',
        ['rfc-8032', 'rfc-8037'],
      ),
      'node-and-fastly-conformance': c(
        'MIXED',
        'Current Node documents Ed25519, but Fastly JavaScript does not document Ed25519 import or verification; Native exact-artifact cells remain possible.',
        [
          'node-webcrypto-v24',
          'fastly-subtle-import-key',
          'fastly-subtle-verify',
        ],
      ),
      'compile-link-and-optimization-cost': c(
        'UNMEASURED',
        'No Ed25519 guest has been compiled, linked, optimized, or timed in Pulse.',
        ['ed25519-dalek'],
        ['compile time', 'link time', 'optimization time'],
      ),
      'side-channel-and-constant-time-review': c(
        'CONDITIONAL',
        'The implementation offers strict verification paths, but canonical encodings, small-order behavior, scalar ranges, curve backend behavior, and any signing path require explicit review.',
        ['ed25519-dalek', 'rfc-8032'],
      ),
      'guest-link-seam-value': c(
        'FAVORABLE',
        'A fixed-width real verifier would exercise the same private frame and artifact chain as ES256 with the smallest wire inputs.',
        ['ed25519-dalek', 'rfc-8032'],
      ),
      'component-model-and-wit-migration': c(
        'FAVORABLE',
        'Two fixed byte fields and a scalar result form a small future WIT interface without preserving the current memory layout.',
        ['rfc-8032'],
      ),
      'jwt-fixture-interoperability-without-bypass': c(
        'CONDITIONAL',
        'Pulse currently exposes the unpublished legacy EdDSA vocabulary; adopting the fully specified Ed25519 identifier needs an explicit versioned contract migration before fixtures can be authoritative.',
        ['rfc-9864', 'rfc-8037'],
      ),
    },
    requiredPreconditions: [
      'Make an explicit versioned migration from the unpublished EdDSA vocabulary to the fully specified Ed25519 JOSE identifier; do not add polymorphic dispatch.',
      'Pin Node and browser minimum versions and either prove Fastly JavaScript support or keep that target explicitly ineligible.',
      'Pin an ESP32 family, ESP-IDF version, and Ed25519 library or PSA/driver realization; current platform evidence is insufficient.',
      'Freeze the exact ed25519-dalek source, feature set, curve and SHA-512 backends, dependency closure, licenses, and reproducible build.',
      'Prove strict verification semantics, fixed stack/scratch, no allocator, optimized artifact behavior, and the full malformed-input corpus.',
      'Complete independent cryptographic and side-channel review before any production claim.',
    ],
  });

  return Object.freeze([es256, rs256, ed25519]);
}

function buildTargetMatrix(inputs) {
  const targetEvidence = inputs.sourceEvidence.targetEvidence;
  const dispositions = Object.freeze({
    'node-javascript': Object.freeze({
      ES256: 'RUNTIME-ADAPTER-CANDIDATE',
      RS256: 'RUNTIME-ADAPTER-CANDIDATE',
      Ed25519: 'CONDITIONAL-ON-PINNED-NODE-MINIMUM',
    }),
    'fastly-javascript': Object.freeze({
      ES256: 'INELIGIBLE-UNTIL-VERIFY-IS-PROVEN',
      RS256: 'RUNTIME-ADAPTER-CANDIDATE',
      Ed25519: 'INELIGIBLE-NOT-DOCUMENTED',
    }),
    'browser-javascript': Object.freeze({
      ES256: 'FORWARD-TARGET-BASELINE-REQUIRED',
      RS256: 'FORWARD-TARGET-BASELINE-REQUIRED',
      Ed25519: 'FORWARD-TARGET-MINIMUM-VERSIONS-REQUIRED',
    }),
    'native-wasm': Object.freeze({
      ES256: 'FIRST-GUEST-EXPERIMENT-CANDIDATE',
      RS256: 'IMPLEMENTABLE-UNMEASURED',
      Ed25519: 'IMPLEMENTABLE-UNMEASURED',
    }),
    esp32: Object.freeze({
      ES256: 'HOST-REALIZATION-DESIGN-REQUIRED',
      RS256: 'HOST-REALIZATION-DESIGN-REQUIRED',
      Ed25519: 'BLOCKED-UNTIL-REALIZATION-IS-PINNED',
    }),
  });

  const targets = Object.freeze(
    TARGETS.map((id) => {
      const evidence = targetEvidence[id];
      return Object.freeze({
        id,
        label: evidence.label,
        currentPulseProof: evidence.currentPulseProof,
        candidates: Object.freeze(
          Object.fromEntries(
            CANDIDATES.map((candidate) => [
              candidate,
              Object.freeze({
                documentedStatus:
                  evidence.candidates[candidate].status,
                f3Disposition: dispositions[id][candidate],
                sources: sourceReferences(
                  evidence.candidates[candidate].sources,
                  inputs.sourceById,
                ),
              }),
            ]),
          ),
        ),
      });
    }),
  );

  return Object.freeze({
    version: MATRIX_VERSION,
    checkpoint: 'F3',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    observedAt: inputs.sourceEvidence.observedAt,
    targetSet: Object.freeze(TARGETS),
    targetCount: targets.length,
    candidates: CANDIDATES,
    targets,
    conclusions: Object.freeze({
      immediateDocumentedJavaScriptCompatibilityLeader: 'RS256',
      firstGuestLinkedExperiment: 'ES256',
      smallestWireShape: 'Ed25519',
      universalFiveTargetSupportClaimAuthorized: false,
      reason:
        'Target eligibility remains explicit: no algorithm is promoted merely because another target supports it.',
    }),
    nativeWasmExecutionCells: Object.freeze([
      'Node Native',
      'Fastly Native/Viceroy',
    ]),
    forwardTargetsWithoutCurrentPulseExecutionProof: Object.freeze([
      'browser-javascript',
      'esp32',
    ]),
  });
}

function buildComparison(inputs, candidates, targetMatrix) {
  const privateFrame = Object.freeze({
    status: 'RECOMMENDED-NOT-IMPLEMENTED',
    version: 'private-invocation-frame-v2-proposal',
    physicalBorrowableRegionBytes: inputs.physicalArenaBytes,
    priorProofMaximumBytes: inputs.provenSpanBytes,
    selectedCapacityBytes: 16640,
    selectedRawPayloadBytes:
      candidates.find((entry) => entry.algorithm === 'ES256')
        .privateFrame.rawPayloadBytes,
    interpretation:
      'The 4,096-byte value is the maximum exercised by borrowed-span v1, not the physical memory limit. A larger versioned frame can occupy the existing 1,572,864-byte input region.',
    supersedesF2CapacityInterpretation: true,
    remainingConditionality: Object.freeze([
      'No asymmetric guest implementation has measured stack, static data, scratch, or final optimized layout.',
      'No private multi-field frame validator has proven overflow, overlap, alignment, truncation, lifetime, or retention behavior.',
      'No selected source has reproduced reviewed prebuilt bytes on a clean maintainer-only build.',
      'Cryptographic and side-channel review remain open.',
    ]),
    fields: Object.freeze([
      'version-and-total-length',
      'signing-input-offset-and-length',
      'normalized-public-key-offset-and-length',
      'signature-offset-and-length',
      'reserved-fixed-algorithm-slot',
    ]),
    validationOrder:
      'Validate frame version, total length, every checked addition, bounds, exact field sizes, alignment, and pairwise non-overlap before any guest dereference.',
    allocatorRequired: false,
    allocatorAllowed: false,
    publicAbi: false,
  });
  assert.ok(
    privateFrame.selectedCapacityBytes <=
      privateFrame.physicalBorrowableRegionBytes,
  );
  assert.ok(
    privateFrame.selectedRawPayloadBytes <=
      privateFrame.selectedCapacityBytes,
  );

  const comparison = Object.freeze({
    version: COMPARISON_VERSION,
    checkpoint: 'F3',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    decisionMeaning:
      'The evidence-based recommendation is complete. PASS does not implement or advertise any asymmetric algorithm.',
    amendedScope: Object.freeze({
      requestedByUser: true,
      original: Object.freeze(['ES256', 'RS256']),
      evaluated: CANDIDATES,
      ed25519IncludedAcrossEveryCriterionAndTarget: true,
    }),
    method: Object.freeze({
      criteria: CRITERIA,
      criterionCount: CRITERIA.length,
      equalCriteriaApplied: candidates.every(
        (candidate) =>
          JSON.stringify(Object.keys(candidate.criteria)) ===
          JSON.stringify(CRITERIA),
      ),
      numericPopularityScoreUsed: false,
      aggregateNumericScoreUsed: false,
      unmeasuredFactsConvertedToFavorableScores: false,
      currentRuntimeAvailabilitySeparatedFromGuestExperimentFitness: true,
    }),
    recommendation: Object.freeze({
      algorithm: 'ES256',
      guestLinkedReadiness: 'CONDITIONAL',
      reason:
        'ES256 gives the best balance for the first guest-linked verifier: fixed-width inputs, SHA-256 reuse, an allocator-free implementation path, meaningful real-crypto pressure on the private link seam, documented Node and ESP32-family paths, and a smaller unrelated complexity burden than RSA. RS256 remains the compatibility leader. Ed25519 has the cleanest wire shape and is a strong later candidate, but its new JOSE identifier migration, SHA-512 closure, undocumented Fastly JavaScript path, and unproven ESP32 realization make it a weaker first five-target-balanced experiment.',
      compatibilityLeader: 'RS256',
      wireShapeLeader: 'Ed25519',
      universalTargetSupportClaimAuthorized: false,
      productionClaimAuthorized: false,
    }),
    identifierDisposition: Object.freeze({
      currentPulseUnpublishedVocabulary: Object.freeze(
        inputs.e4.implementationBoundaries.publicJwtAlgorithmVocabulary,
      ),
      currentStandardIdentifier: 'Ed25519',
      deprecatedStandardIdentifier: 'EdDSA',
      contractChangedByF3: false,
      requiredFutureAction:
        'Handle EdDSA-to-Ed25519 as an explicit versioned unpublished-contract migration before Ed25519 implementation; do not accept both as silent aliases.',
      sources: sourceReferences(
        ['iana-jose-algorithms', 'rfc-9864'],
        inputs.sourceById,
      ),
    }),
    privateFrame,
    candidates,
    targetMatrixSummary: targetMatrix.conclusions,
    smallestNextExperiment: Object.freeze({
      algorithm: 'ES256',
      operation: 'verify-only',
      signingInputBytes: Object.freeze({
        minimum: 0,
        maximum: inputs.signingInputMaximum,
        exactOriginalBytesRequired: true,
      }),
      normalizedPublicKey:
        'Exactly 64 bytes, P-256 big-endian x || y; parsing stays in a crypto-owned adapter.',
      signature:
        'Exactly 64 bytes, JOSE big-endian r || s; DER is rejected at the guest boundary.',
      output: 'One normalized scalar verification status.',
      frameCapacityBytes: 16640,
      algorithmParameters: 'Compile-time fixed P-256 and SHA-256.',
      guestAllocator: 'PROHIBITED',
      executionCells: Object.freeze([
        'Node Native exact final artifact',
        'Fastly Native/Viceroy exact final artifact',
        'Node JavaScript runtime adapter conformance where eligible',
      ]),
      explicitlyExcluded: Object.freeze([
        'signing',
        'public memory ABI',
        'third-party guest units',
        'source builds during application compilation',
        'automatic runtime or algorithm fallback',
        'Fastly JavaScript support claim without ECDSA verify evidence',
        'browser support claim',
        'ESP32 support claim',
      ]),
    }),
    requiredPreconditions: Object.freeze(
      candidates.find((entry) => entry.algorithm === 'ES256')
        .requiredPreconditions,
    ),
    evidenceClassification: Object.freeze({
      observed: Object.freeze([
        'The existing physical guest input region is 1,572,864 bytes.',
        'Borrowed-span v1 exercised a maximum of 4,096 bytes.',
        'The current JWT exact signing-input maximum is 16,340 bytes.',
        'The current Pulse closed loop implements only HS256 and no asymmetric guest.',
        'Current Node documents all three primitives.',
        'Current Fastly JavaScript verification documentation lists RSASSA-PKCS1-v1_5 but not ECDSA or Ed25519.',
        'Modern Chrome, Firefox, and Safari releases document Ed25519 support.',
        'Current ESP32 evidence does not establish a generally available Ed25519 realization across an unpinned family and ESP-IDF version.',
      ]),
      reasonedDesignChoices: Object.freeze([
        'Use a 16,640-byte private frame for the ES256 experiment inside the existing physical region.',
        'Normalize JWK, SEC1, and SPKI representations outside the guest while retaining validation inside the verifier.',
        'Choose ES256 for the first guest experiment, RS256 for the strongest compatibility lane, and retain Ed25519 as the strategic second fixed-curve candidate.',
      ]),
      unmeasured: Object.freeze([
        'candidate code size',
        'stack high-water',
        'static-data range',
        'scratch range',
        'compile time',
        'link time',
        'optimization time',
        'source-to-prebuilt reproducibility',
        'final-artifact runtime performance',
      ]),
    }),
    versions: Object.freeze({
      workingCandidate: inputs.f0.workingCandidate.candidateVersion,
      frozenReleaseCatalog: '1.0.0-beta.1',
      discrepancyResolution:
        'F3 applies to the unpublished 1.0.0-beta.1 working candidate. The frozen 1.0.0-beta.1 release catalog remains unchanged and is not a proof blocker.',
      publicationAuthorized: false,
    }),
    boundaries: Object.freeze({
      implementationChanged: false,
      asymmetricImplementationAdded: false,
      signingAdded: false,
      publicAlgorithmVocabularyChanged: false,
      memoryAbiChanged: false,
      privateFrameImplemented: false,
      allocatorAdded: false,
      publicAbiAdded: false,
      targetSupportAdvertised: false,
      automaticFallbackAdded: false,
      sourceBuildLaneAdded: false,
      packagePublished: false,
      documentationPromoted: false,
      providerDeployed: false,
      providerActivated: false,
    }),
    sources: inputs.records,
    nextAuthorizedCheckpoint: 'F4',
  });

  assert.equal(comparison.method.equalCriteriaApplied, true);
  assert.equal(
    candidates.flatMap((candidate) =>
      Object.values(candidate.criteria).filter(
        (entry) => entry.status === 'UNMEASURED',
      ),
    ).length > 0,
    true,
  );
  assert.equal(
    candidates.every((candidate) =>
      Object.values(candidate.criteria).every(
        (entry) =>
          entry.status !== 'UNMEASURED' || entry.unknowns.length > 0,
      ),
    ),
    true,
  );
  return comparison;
}

function renderDecision(comparison, targetMatrix) {
  const candidateRows = comparison.candidates.map((candidate) => {
    const favorable = Object.values(candidate.criteria).filter(
      (entry) => entry.status === 'FAVORABLE',
    ).length;
    const mixed = Object.values(candidate.criteria).filter(
      (entry) => entry.status === 'MIXED',
    ).length;
    const conditional = Object.values(candidate.criteria).filter(
      (entry) => entry.status === 'CONDITIONAL',
    ).length;
    const unfavorable = Object.values(candidate.criteria).filter(
      (entry) => entry.status === 'UNFAVORABLE',
    ).length;
    const unmeasured = Object.values(candidate.criteria).filter(
      (entry) => entry.status === 'UNMEASURED',
    ).length;
    return `| ${candidate.algorithm} | ${candidate.experimentRole} | ${favorable} | ${mixed} | ${conditional} | ${unfavorable} | ${unmeasured} |`;
  });
  const targetRows = targetMatrix.targets.flatMap((target) =>
    CANDIDATES.map(
      (candidate) =>
        `| ${target.label} | ${candidate} | ${target.candidates[candidate].f3Disposition} |`,
    ),
  );
  const lines = [
    '# F3 asymmetric algorithm recommendation',
    '',
    '**Recommendation:** ES256',
    '**Guest-linked readiness:** CONDITIONAL',
    '**Compatibility leader:** RS256',
    '**Smallest wire shape:** Ed25519',
    '**Next authorized checkpoint:** F4',
    '',
    comparison.recommendation.reason,
    '',
    'The comparison includes Ed25519 across the same 19 criteria and all five',
    'targets. The modern JOSE identifier is `Ed25519`; legacy `EdDSA` is',
    'deprecated. F3 records the required unpublished-contract migration but',
    'does not change the current public vocabulary.',
    '',
    '## Equal-criteria summary',
    '',
    'The counts are descriptive, not a numeric score. Unmeasured facts never',
    'contribute a favorable result.',
    '',
    '| Candidate | Role | Favorable | Mixed | Conditional | Unfavorable | Unmeasured |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...candidateRows,
    '',
    '## Five-target disposition',
    '',
    '| Target | Candidate | F3 disposition |',
    '|---|---|---|',
    ...targetRows,
    '',
    'RS256 is the current JavaScript compatibility leader because both Node and',
    'Fastly document RSASSA-PKCS1-v1_5 verification. That does not make it the',
    'best first guest-linked experiment: RSA adds large-integer, allocation,',
    'key-size, and scratch questions before the private seam itself is proven.',
    '',
    'Ed25519 is a strong strategic second candidate. Its fixed 32-byte key and',
    '64-byte signature are ideal for the frame, and current Node and modern',
    'browsers document it. Fastly JavaScript does not document it, the ESP32',
    'realization is unproven, SHA-512 joins the dependency closure, and Pulse',
    'must migrate from the deprecated EdDSA label explicitly.',
    '',
    '## Span correction and private frame',
    '',
    `Borrowed-span v1 proved ${comparison.privateFrame.priorProofMaximumBytes.toLocaleString('en-US')} bytes; it did not establish a physical maximum. The`,
    `existing region contains ${comparison.privateFrame.physicalBorrowableRegionBytes.toLocaleString('en-US')} bytes, so the selected ES256 payload of`,
    `${comparison.privateFrame.selectedRawPayloadBytes.toLocaleString('en-US')} bytes fits a proposed ${comparison.privateFrame.selectedCapacityBytes.toLocaleString('en-US')}-byte private frame without`,
    'moving memory or adding an allocator. The recommendation versions that',
    'frame instead of reinterpreting v1.',
    '',
    'Guest-linked readiness remains conditional because no asymmetric guest has',
    'yet proven its actual stack, static data, scratch, optimized layout,',
    'pointer retention, malformed multi-field ranges, or reproducible source',
    'build.',
    '',
    '## Smallest next experiment',
    '',
    '- Verify only; do not add signing.',
    '- Accept the existing exact signing input up to 16,340 bytes.',
    '- Normalize a P-256 key to exactly 64-byte big-endian `x || y` outside the',
    '  guest, then validate the point inside the verifier.',
    '- Accept only the JOSE 64-byte big-endian `r || s` signature; reject DER at',
    '  the guest boundary.',
    '- Use a 16,640-byte private frame, fixed P-256/SHA-256 parameters, no',
    '  allocator, no memory growth, and one scalar result.',
    '- Execute exact Node Native and Fastly Native artifacts, plus eligible',
    '  JavaScript conformance, without fallback.',
    '',
    '## Boundary',
    '',
    'F3 is evidence-only. It does not implement asymmetric cryptography, change',
    'the memory or public ABI, alter the algorithm vocabulary, advertise any',
    'target, add source builds or fallback, publish packages, promote docs,',
    'deploy, or activate a provider. The unpublished working candidate remains',
    '1.0.0-beta.1 and the frozen release catalog remains 1.0.0-beta.1.',
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
  const candidates = buildCandidateAssessments(inputs);
  const targetMatrix = buildTargetMatrix(inputs);
  const comparison = buildComparison(inputs, candidates, targetMatrix);

  const comparisonRecord = writeOutput(
    options.outputDirectory,
    'jwt-f3-asymmetric-candidate-comparison.json',
    stableJson(comparison),
  );
  const matrixRecord = writeOutput(
    options.outputDirectory,
    'jwt-f3-five-target-matrix.json',
    stableJson(targetMatrix),
  );
  const decisionRecord = writeOutput(
    options.outputDirectory,
    'asymmetric-algorithm-decision.md',
    renderDecision(comparison, targetMatrix),
  );

  const evidence = Object.freeze({
    version: EVIDENCE_VERSION,
    checkpoint: 'F3',
    phase: 'F',
    status: 'passed',
    classification: 'PASS',
    scope: 'three-candidate-asymmetric-algorithm-recommendation',
    reports: Object.freeze({
      comparison: comparisonRecord,
      targetMatrix: matrixRecord,
      decision: decisionRecord,
    }),
    acceptance: Object.freeze({
      es256Rs256AndEd25519Compared: true,
      sameCriteriaAppliedToEveryCandidate:
        comparison.method.equalCriteriaApplied,
      allFiveTargetsWeighed: targetMatrix.targetCount === 5,
      unknownsConvertedToFavorableScores: false,
      recommendationNamesSmallestNextExperiment: true,
      guestSpanCanExpandWithinExistingPhysicalRegion: true,
      remainingConditionalityNamesUnprovenImplementationFacts: true,
      implementationRemainsOutsidePhaseF: true,
      targetSupportAdvertised: false,
      automaticFallbackAdded: false,
    }),
    recommendation: comparison.recommendation,
    privateFrame: comparison.privateFrame,
    identifierDisposition: comparison.identifierDisposition,
    versions: comparison.versions,
    boundaries: comparison.boundaries,
    sources: inputs.records,
    nextAuthorizedCheckpoint: 'F4',
  });
  writeOutput(
    options.outputDirectory,
    'jwt-f3-evidence.json',
    stableJson(evidence),
  );

  process.stdout.write(
    'ok - F3 recommends ES256 CONDITIONALLY after equal ES256, RS256, ' +
      'and Ed25519 comparison across five targets; the proposed 16,640-byte ' +
      'private frame fits the existing physical arena and implementation ' +
      'remains outside Phase F\n',
  );
}

main();
