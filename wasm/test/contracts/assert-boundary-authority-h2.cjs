#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outputDirectory = path.join(repoRoot, 'wasm', '.test-results', 'boundary-h2');
const OBSERVED_AT = '2026-07-31';
const STARTING_SNAPSHOT = Object.freeze({
  archive: 'pulse-boundary-h1-implemented.zip',
  sha256: '17d7d40241b29eba1813aeae2e9d377a6d83ff008bf8ab373b387ac15f134e09'
});

process.chdir(repoRoot);

const packageContract = require('../../packages/contracts/src/package/package-contract.js');
const {
  FINAL_WASM_POLICY_VERSION,
  defineFinalWasmPolicy
} = require('../../packages/contracts/src/provider/final-wasm-policy.js');
const stage = require('../../packages/wasm-guest-link/src/stage.js');

function read(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function writeJson(name, value) {
  const target = path.join(outputDirectory, name);
  fs.writeFileSync(target, `${JSON.stringify(stable(value), null, 2)}\n`);
  return Object.freeze({
    file: path.relative(repoRoot, target).replace(/\\/g, '/'),
    bytes: fs.statSync(target).size,
    sha256: sha256(fs.readFileSync(target))
  });
}

function writeText(name, value) {
  const target = path.join(outputDirectory, name);
  fs.writeFileSync(target, value);
  return Object.freeze({
    file: path.relative(repoRoot, target).replace(/\\/g, '/'),
    bytes: fs.statSync(target).size,
    sha256: sha256(fs.readFileSync(target))
  });
}

function withChange(value, changes) {
  return { ...value, ...changes };
}

function rejectsCode(run, code) {
  assert.throws(run, (error) => error && error.code === code);
}

const contribution = packageContract.normalizeCanonicalGuestUnitContribution({
  version: packageContract.GUEST_UNIT_CONTRIBUTION_VERSION,
  id: 'pulse.crypto.es256.rustcrypto-p256.v1',
  manifest: './guests/es256-rustcrypto/pulse.guest-unit.json',
  owner: '@pulse-compute/crypto',
  packageVersion: '1.0.0-beta.1',
  origin: 'package-prebuilt'
});
const finalWasmPolicy = defineFinalWasmPolicy({
  version: FINAL_WASM_POLICY_VERSION,
  descriptorOwner: '@pulse-compute/provider-node',
  toolchainVersion: 'pulse.provider-toolchain.v1',
  descriptorIdentity: 'node-native',
  permittedImports: [],
  requiredExports: []
});
const primaryWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const invocation = {
  version: stage.GUEST_LINK_STAGE_INVOCATION_VERSION,
  primaryWasm,
  guestUnits: [{
    contribution,
    packageRoot: path.join(repoRoot, 'packages', 'crypto')
  }],
  projectRoot: repoRoot,
  profile: 'native',
  finalWasmPolicy,
  synchronizedPackages: [{ name: '@pulse-compute/crypto', version: '1.0.0-beta.1' }],
  optimizationPosture: 'native-default'
};
const normalized = stage.normalizeGuestLinkStageInvocation(invocation);
assert.deepEqual(Object.keys(normalized), stage.GUEST_LINK_STAGE_INVOCATION_FIELDS);
assert.equal(normalized.version, 'pulse.guest-link-stage-invocation.v1');
assert.equal(Object.isFrozen(normalized), true);
assert.equal(Object.isFrozen(normalized.guestUnits), true);
assert.deepEqual(Object.keys(normalized.guestUnits[0].contribution), packageContract.GUEST_UNIT_CONTRIBUTION_FIELDS);
assert.equal(Object.hasOwn(normalized.guestUnits[0].contribution, 'packageRoot'), false);
assert.equal(Object.hasOwn(normalized, 'targetDescriptor'), false);
assert.equal(Object.hasOwn(normalized, 'realization'), false);
assert.equal(Object.hasOwn(normalized, 'options'), false);
primaryWasm[0] = 0xff;
assert.equal(normalized.primaryWasm[0], 0x00);

rejectsCode(
  () => stage.normalizeGuestLinkStageInvocation(withChange(invocation, {
    version: 'pulse.compiler-guest-unit-stage.v2'
  })),
  'PULSE_GUEST_UNIT_INVALID'
);
rejectsCode(
  () => stage.normalizeGuestLinkStageInvocation(withChange(invocation, {
    version: 'pulse.guest-link-stage-invocation.v99'
  })),
  'PULSE_GUEST_UNIT_INVALID'
);
rejectsCode(
  () => stage.normalizeGuestLinkStageInvocation({ ...invocation, compilerCache: {} }),
  'PULSE_GUEST_UNIT_INVALID'
);
rejectsCode(
  () => stage.normalizeGuestLinkStageInvocation({ ...invocation, targetDescriptor: {} }),
  'PULSE_GUEST_UNIT_INVALID'
);
rejectsCode(
  () => stage.normalizeGuestLinkStageInvocation(withChange(invocation, {
    finalWasmPolicy: undefined
  })),
  'PULSE_GUEST_TARGET_POLICY_REQUIRED'
);
rejectsCode(
  () => stage.normalizeGuestLinkStageInvocation(withChange(invocation, {
    finalWasmPolicy: { ...finalWasmPolicy, runtimeObject: {} }
  })),
  'PULSE_GUEST_TARGET_POLICY_REQUIRED'
);
rejectsCode(
  () => stage.normalizeGuestLinkStageInvocation(withChange(invocation, {
    guestUnits: [...invocation.guestUnits, invocation.guestUnits[0]]
  })),
  'PULSE_GUEST_UNIT_CARDINALITY_UNSUPPORTED'
);
rejectsCode(
  () => stage.normalizeGuestLinkStageInvocation(withChange(invocation, {
    guestUnits: [{
      contribution: { ...contribution, packageRoot: path.join(repoRoot, 'packages', 'crypto') },
      packageRoot: path.join(repoRoot, 'packages', 'crypto')
    }]
  })),
  'PULSE_GUEST_UNIT_INVALID'
);
rejectsCode(
  () => stage.normalizeGuestLinkStageInvocation(withChange(invocation, {
    synchronizedPackages: [{ name: '@pulse-compute/crypto', version: 'workspace:*' }]
  })),
  'PULSE_GUEST_UNIT_OWNER_MISMATCH'
);
rejectsCode(
  () => stage.normalizeGuestLinkStageInvocation(withChange(invocation, {
    optimizationPosture: 'automatic'
  })),
  'PULSE_GUEST_OPTIMIZATION_FAILED'
);

const stageSource = read('wasm/packages/wasm-guest-link/src/stage.js');
const compilerAdapterSource = read('wasm/packages/compiler/src/spine/guest-unit-stage.js');
const cryptoGuestSource = read('packages/crypto/pulsewasm.native.cjs');
const fastlyNativeSource = read('packages/provider-fastly/src/build/native-platform-capabilities.js');
assert.doesNotMatch(stageSource, /pulse\.compiler-guest-unit-stage\./);
assert.doesNotMatch(stageSource, /\btargetDescriptor\b/);
assert.doesNotMatch(stageSource, /\.\.\.realization/);
assert.match(stageSource, /pulse\.guest-link-stage-invocation\.v1/);
assert.match(stageSource, /pulse\.guest-link-stage-result\.v1/);
assert.match(stageSource, /assertFinalArtifactIdentity/);
assert.match(stageSource, /stop-before-provider-packaging/);
assert.match(stageSource, /alternateOutputAuthorized: false/);
assert.doesNotMatch(compilerAdapterSource, /readFileSync|mkdtempSync|realizeGuestLinkPlan|writeMemoryOwnerModule|normalizeGuestUnitManifest/);
assert.match(compilerAdapterSource, /realizeGuestLinkStage/);
assert.doesNotMatch(cryptoGuestSource, /packageRoot\s*:/);
assert.match(fastlyNativeSource, /GUEST_LINK_STAGE_INVOCATION_VERSION/);
assert.match(fastlyNativeSource, /realizeGuestLinkStage/);

const shapeContract = Object.freeze({
  version: 'pulse.boundary-guest-link-shape.h2.v1',
  stage: 'H2',
  status: 'PASS',
  observedAt: OBSERVED_AT,
  startingSnapshot: STARTING_SNAPSHOT,
  owner: '@pulse-compute/wasm-guest-link',
  versions: Object.freeze({
    invocation: stage.GUEST_LINK_STAGE_INVOCATION_VERSION,
    result: stage.GUEST_LINK_STAGE_RESULT_VERSION,
    contribution: packageContract.GUEST_UNIT_CONTRIBUTION_VERSION
  }),
  invocationFields: stage.GUEST_LINK_STAGE_INVOCATION_FIELDS,
  resultFields: stage.GUEST_LINK_STAGE_RESULT_FIELDS,
  closedFindings: Object.freeze(['H0-B006']),
  preserved: Object.freeze([
    'single-selected-guest-unit',
    'package-prebuilt-origin',
    'fixed-memory-policy',
    'content-addressed-materialization',
    'ordinary-build-source-exclusion',
    'redacted-diagnostics',
    'no-automatic-fallback'
  ]),
  negativeCases: Object.freeze([
    'compiler-owned-or-unknown-stage-version',
    'unknown-invocation-field',
    'contribution-private-path-bleed',
    'target-policy-absent-or-malformed',
    'multiple-selected-units',
    'synchronized-package-version-mismatch',
    'unsupported-optimization-posture',
    'final-artifact-identity-mismatch-before-packaging',
    'alternate-output-substitution'
  ]),
  policy: Object.freeze({
    rawCompilerRealizationAccepted: false,
    rawTargetDescriptorAccepted: false,
    providerPackagingRequiresExactAuditedBytes: true,
    alternateOutputAuthorized: false
  })
});

fs.mkdirSync(outputDirectory, { recursive: true });
const shapeOutput = writeJson('guest-link-boundary-shape.json', shapeContract);
const handoffOutput = writeText('boundary-h2-handoff.md', `# Pulse boundary lock H2 → H3 handoff

**Schema:** \`pulse.boundary-h2-handoff.v1\`  
**H2 result:** PASS  
**Next authorized pass:** H3  
**Recommended GPT-5.6 effort:** \`xhigh\`

## H2 conclusion

\`H0-B006\` is closed. Guest-link owns the active stage invocation/result
identities, contribution validation, manifest realization, materialization,
composition, optimization, audit, exact final-byte identity, packaging
authorization, and no-fallback disposition. The compiler integration point is
an explicit projection adapter and contains no guest implementation.

The ES256 guest binary, fixed memory contract, one-unit cardinality,
package-prebuilt origin, content-addressed workspace, source-build exclusion,
and redacted failure behavior are unchanged.

## Implement H3 only

Close \`H0-B007\` through \`H0-B011\`:

- freeze exact compiler-to-provider toolchain invocation and result shapes;
- validate provider toolchains and selected target descriptors before use;
- pass canonical plans, explicit target/package facts, normalized provider
  configuration, capability/binding requirements, and exact audited Native
  bytes only;
- reject compiler AST/services, builder objects, raw lowerer output, mutable
  manifests, provider implementation objects, and unverified guest bytes;
- keep provider selection exact and fail closed without scanning,
  self-registration, alternate targets, or fallback.

Use one provider Entry Point at a time. Do not implement H4 Crypto/JWT/Fastly
JavaScript alignment, Entities, events, compiler refactoring, publication,
deployment, or release work.
`);
const report = Object.freeze({
  version: 'pulse.boundary-h2-report.v1',
  stage: 'H2',
  status: 'PASS',
  observedAt: OBSERVED_AT,
  startingSnapshot: STARTING_SNAPSHOT,
  changeClass: 'architecture',
  scope: 'architecture-change',
  humanDecision: 'provided-by-direct-H2-implementation-request-and-H1-handoff',
  protectedBoundariesReviewed: Object.freeze([
    'lowerer-trust',
    'runtime-target-fluidity'
  ]),
  filesChanged: Object.freeze([
    'docs/architecture/current-contracts.md',
    'docs/concepts/package-owned-lowering.md',
    'packages/crypto/pulsewasm.native.cjs',
    'packages/provider-fastly/src/build/native-platform-capabilities.js',
    'wasm/.test-results/boundary-h2/boundary-h2-handoff.md',
    'wasm/.test-results/boundary-h2/boundary-h2-report.json',
    'wasm/.test-results/boundary-h2/guest-link-boundary-shape.json',
    'wasm/.test-results/guest-link-b2/guest-unit-materialization-proof.json',
    'wasm/.test-results/jwt-g2/es256-link-report.json',
    'wasm/.test-results/jwt-g2/jwt-g2-evidence.json',
    'wasm/.test-results/jwt-g3/es256-crypto-composition-report.json',
    'wasm/.test-results/jwt-g3/jwt-g3-evidence.json',
    'wasm/packages/cli/docs/architecture/current-contracts.md',
    'wasm/packages/cli/docs/concepts/package-owned-lowering.md',
    'wasm/packages/compiler/src/spine/guest-unit-stage.js',
    'wasm/packages/compiler/src/spine/package-operation-seam.js',
    'wasm/packages/contracts/src/package/package-contract.js',
    'wasm/packages/wasm-guest-link/src/stage.js',
    'wasm/test/assert-hidden-contracts.cjs',
    'wasm/test/contracts/assert-boundary-authority-h2.cjs',
    'wasm/test/crypto/assert-crypto-es256-guest-link.cjs',
    'wasm/test/guest-link/assert-b2-materialization-stage.cjs',
    'wasm/test/suite/assert-suite-shape.cjs',
    'wasm/test/suite/registry.cjs'
  ]),
  closedFindings: shapeContract.closedFindings,
  diagnostics: Object.freeze({
    added: Object.freeze([]),
    preserved: Object.freeze([
      'PULSE_GUEST_UNIT_INVALID',
      'PULSE_GUEST_UNIT_CARDINALITY_UNSUPPORTED',
      'PULSE_GUEST_TARGET_POLICY_REQUIRED',
      'PULSE_GUEST_UNIT_OWNER_MISMATCH',
      'PULSE_GUEST_OPTIMIZATION_FAILED',
      'PULSE_GUEST_FINAL_AUDIT_FAILED'
    ])
  }),
  validation: Object.freeze({
    focusedCommand: 'node wasm/scripts/run-wasm-tests.cjs --task boundary-authority-h2 --task guest-link-package --task guest-link-materialization-stage --task guest-link-audit-diagnostics --task crypto-es256-guest-link --no-report',
    result: 'PASS',
    guestBytesChanged: false,
    memoryContractChanged: false,
    providerBehaviorChanged: false,
    fallbackChanged: false
  }),
  outputs: Object.freeze({
    shapeContract: shapeOutput,
    nextPassHandoff: handoffOutput
  }),
  remainingBoundaryDebt: Object.freeze([
    'H0-B007 through H0-B011 → H3',
    'H0-B012 → H4',
    'H0-B014 → post-beta',
    'H0-B015 → documentation'
  ]),
  assumptions: Object.freeze([
    'The H0 frozen owner map and H3-H5 scopes remain authorized.',
    'Provider input/output closure remains H3; H2 changes only the guest-link-owned call and result boundary.'
  ]),
  inferences: Object.freeze([
    'Entities can request future synchronized guest contributions without acquiring compiler or provider authority.',
    'No compiler pipeline refactor is required for H3.'
  ]),
  stopConditionsEncountered: Object.freeze([]),
  risksOrBlockers: Object.freeze([]),
  nextAuthorizedCheckpoint: 'H3'
});
writeJson('boundary-h2-report.json', report);

console.log('ok - H2 closes H0-B006 with guest-link-owned exact stage identities, audited final-byte authorization, and no fallback');
