#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outputDirectory = path.join(repoRoot, 'wasm', '.test-results', 'boundary-h5');
process.chdir(repoRoot);

const canonicalRuntime = require('../../packages/contracts/src/handler/canonical-runtime.js');
const packageContract = require('../../packages/contracts/src/package/package-contract.js');
const providerContracts = require('../../packages/contracts/src/provider/toolchain.js');
const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const {
  FINAL_WASM_POLICY_VERSION,
  defineFinalWasmPolicy
} = require('../../packages/contracts/src/provider/final-wasm-policy.js');
const guestStage = require('../../packages/wasm-guest-link/src/stage.js');
const { runBoundaryDriftProof } = require('./boundary-drift-h5.cjs');

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
}

function captureRejection(id, guardrail, run, expected) {
  let caught;
  assert.throws(run, (error) => {
    caught = error;
    return expected.test(`${error && error.code || ''} ${error && error.message || ''}`);
  }, `${id} must fail at ${guardrail}`);
  return Object.freeze({
    id,
    guardrail,
    status: 'PASS',
    rejected: true,
    observedCode: caught && caught.code || null,
    expectedDiagnostic: expected.source,
    automaticFallback: false
  });
}

function effect(overrides = {}) {
  return {
    version: canonicalRuntime.CANONICAL_PACKAGE_EFFECT_VERSION,
    contractId: 'pulse.example',
    package: '@pulse-compute/example',
    import: '@pulse-compute/example',
    kind: 'example.emit',
    providerKind: 'example',
    operation: 'emit',
    capability: 'example.emit',
    result: 'ack',
    placement: 'statement',
    range: { start: 1, end: 2 },
    resource: { kind: 'literal', value: 'updates' },
    payload: { message: 'ready' },
    providerRequirements: ['example.emit'],
    loc: { file: 'src/index.ts', line: 1, column: 1 },
    ...overrides
  };
}

const authority = Object.freeze({
  contractId: 'pulse.example',
  npmPackage: '@pulse-compute/example',
  lowerableSubpath: '@pulse-compute/example'
});
const operation = packageContract.createCanonicalPackageOperation(effect(), authority, 1);
const providerRequirement = {
  version: packageContract.PROVIDER_REQUIREMENT_RECORD_VERSION,
  authorityVersion: 'pulse.provider-requirement-authority.v1',
  planVersion: 'pulse.canonical-native-plan.v3',
  planHash: 'a'.repeat(64),
  providerNeutral: true,
  capabilities: ['example.emit'],
  providerKinds: ['example'],
  operations: [],
  packageEffects: [],
  packages: [],
  packageOperationIds: [operation.id],
  hostCapabilities: [],
  policy: {
    providerSelected: false,
    providerNeutralPlanRequired: true,
    sourceAstAccepted: false,
    sourceTextAccepted: false,
    canonicalPlanOnly: true,
    packageLoweringBundleOnly: true
  }
};

const cases = [];
cases.push(captureRejection(
  'H5-N01',
  'contract-version-mismatch',
  () => packageContract.normalizeCanonicalPackageOperation({ ...operation, version: 'pulse.canonical-package-operation.v99' }),
  /must use pulse\.canonical-package-operation\.v1/
));
cases.push(captureRejection(
  'H5-N02',
  'unknown-fields-at-exact-boundaries',
  () => packageContract.normalizeCanonicalPackageOperation({ ...operation, compilerPrivate: true }),
  /unsupported field/
));
cases.push(captureRejection(
  'H5-N03',
  'owner-package-mismatch',
  () => packageContract.normalizeCanonicalPackageEffect(effect({ package: '@pulse-compute/other' }), authority),
  /identity must equal its manifest authority/
));
cases.push(captureRejection(
  'H5-N04',
  'malformed-canonical-package-operation',
  () => packageContract.normalizeCanonicalPackageOperation({ ...operation, id: 'nondeterministic' }),
  /deterministic identity/
));
cases.push(captureRejection(
  'H5-N05',
  'malformed-provider-requirement',
  () => packageContract.normalizeProviderRequirementRecord({ ...providerRequirement, providerNeutral: false }),
  /must remain provider-neutral/
));

const manifest = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'packages', 'crypto', 'guests', 'es256-rustcrypto', 'pulse.guest-unit.json'),
  'utf8'
));
const mismatchedContribution = packageContract.normalizeCanonicalGuestUnitContribution({
  version: packageContract.GUEST_UNIT_CONTRIBUTION_VERSION,
  id: manifest.id,
  manifest: './guests/es256-rustcrypto/pulse.guest-unit.json',
  owner: '@pulse-compute/not-crypto',
  packageVersion: manifest.packageVersion,
  origin: 'package-prebuilt'
});
const finalWasmPolicy = defineFinalWasmPolicy({
  version: FINAL_WASM_POLICY_VERSION,
  descriptorOwner: '@pulse-compute/provider-node',
  toolchainVersion: providerContracts.PROVIDER_TOOLCHAIN_VERSION,
  descriptorIdentity: 'node-native',
  permittedImports: [],
  requiredExports: []
});
const emptyWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
cases.push(captureRejection(
  'H5-N06',
  'guest-contribution-manifest-mismatch',
  () => guestStage.realizeGuestLinkStage({
    version: guestStage.GUEST_LINK_STAGE_INVOCATION_VERSION,
    primaryWasm: emptyWasm,
    guestUnits: [{
      contribution: mismatchedContribution,
      packageRoot: path.join(repoRoot, 'packages', 'crypto')
    }],
    projectRoot: repoRoot,
    profile: 'native',
    finalWasmPolicy,
    synchronizedPackages: [{ name: '@pulse-compute/not-crypto', version: manifest.packageVersion }],
    optimizationPosture: 'native-default'
  }),
  /PULSE_GUEST_UNIT_OWNER_MISMATCH/
));

const emptyWasmSha256 = sha256(emptyWasm);
cases.push(captureRejection(
  'H5-N07',
  'guest-link-failure-before-provider-packaging',
  () => providerContracts.createProviderNativeArtifact({
    compilerVersion: 'pulse.test-compiler.v1',
    wasm: emptyWasm,
    manifest: { wasm: { sha256: emptyWasmSha256 } },
    guestLink: {
      audit: { status: 'failed', artifact: { sha256: emptyWasmSha256 } },
      finalArtifact: { sha256: emptyWasmSha256 },
      providerPackaging: { authorized: false }
    }
  }),
  /does not match the final guest-link audit/
));
cases.push(captureRejection(
  'H5-N08',
  'malformed-provider-toolchain-or-target-descriptor',
  () => providerContracts.normalizeProviderTargetDescriptor({
    version: 'pulse.provider-target-descriptor.v99',
    provider: 'fastly',
    target: 'native',
    runtimeClass: 'native',
    targetId: 'fastly-native',
    status: 'supported',
    automaticFallback: false,
    commands: {}
  }),
  /version must be pulse\.provider-target-descriptor\.v1/
));
cases.push(captureRejection(
  'H5-N09',
  'provider-receives-noncanonical-private-values',
  () => providerContracts.createProviderPlanInput({
    version: providerContracts.PROVIDER_PLAN_INPUT_VERSION,
    capabilities: [],
    providerOperations: [],
    opaqueReturnCount: 0,
    rawLowererOutput: { private: true }
  }),
  /unknown fields: rawLowererOutput/
));

const drift = runBoundaryDriftProof(repoRoot);
for (const item of drift.cases.filter((entry) => entry.id.includes('import') || entry.id.includes('dependency'))) {
  cases.push(Object.freeze({
    id: `H5-N10-${item.id}`,
    guardrail: 'forbidden-cross-package-imports-and-manifest-dependencies',
    status: item.status,
    rejected: item.mutationRejected,
    expectedDiagnostic: item.expectedDiagnostic,
    automaticFallback: false
  }));
}
for (const item of drift.cases.filter((entry) => entry.id.includes('capability') || entry.id.includes('types'))) {
  cases.push(Object.freeze({
    id: `H5-N11-${item.id}`,
    guardrail: 'typescript-commonjs-public-capability-drift',
    status: item.status,
    rejected: item.mutationRejected,
    expectedDiagnostic: item.expectedDiagnostic,
    automaticFallback: false
  }));
}

cases.push(captureRejection(
  'H5-N12-target',
  'unsupported-target-or-realization-with-no-fallback',
  () => providerContracts.normalizeProviderTargetDescriptor({
    version: providerContracts.PROVIDER_TARGET_DESCRIPTOR_VERSION,
    provider: 'fastly',
    target: 'browser',
    runtimeClass: 'browser',
    targetId: 'fastly-browser',
    status: 'unsupported',
    automaticFallback: false,
    commands: {}
  }),
  /target browser is unsupported/
));
cases.push(captureRejection(
  'H5-N12-realization',
  'unsupported-target-or-realization-with-no-fallback',
  () => cryptoContracts.planCryptoRealizations({
    declaration: cryptoContracts.normalizeCryptoConfiguration({
      ES256: { realization: cryptoContracts.CRYPTO_ES256_GUEST_LINKED_REALIZATION }
    }),
    requirements: cryptoContracts.normalizeCryptoRequirements([{
      algorithm: 'ES256',
      requestedBy: '@pulse-compute/jwt',
      semanticOwner: cryptoContracts.CRYPTO_SEMANTIC_OWNER
    }]),
    target: 'javascript',
    targetDescriptor: {
      crypto: cryptoContracts.defineCryptoTargetCapabilities({
        target: 'javascript',
        algorithms: [{ algorithm: 'ES256', realization: 'runtime-builtin', implemented: true }]
      })
    },
    profile: 'default'
  }),
  /PULSE_CRYPTO_REALIZATION_PIN_INVALID/
));

const requiredGuardrails = Object.freeze([
  'contract-version-mismatch',
  'unknown-fields-at-exact-boundaries',
  'owner-package-mismatch',
  'malformed-canonical-package-operation',
  'malformed-provider-requirement',
  'guest-contribution-manifest-mismatch',
  'guest-link-failure-before-provider-packaging',
  'malformed-provider-toolchain-or-target-descriptor',
  'provider-receives-noncanonical-private-values',
  'forbidden-cross-package-imports-and-manifest-dependencies',
  'typescript-commonjs-public-capability-drift',
  'unsupported-target-or-realization-with-no-fallback'
]);
assert.deepEqual([...new Set(cases.map((entry) => entry.guardrail))], requiredGuardrails);
assert.equal(cases.every((entry) => entry.status === 'PASS' && entry.rejected), true);
assert.equal(cases.every((entry) => entry.automaticFallback === false), true);

fs.mkdirSync(outputDirectory, { recursive: true });
writeJson('boundary-negative-matrix.json', Object.freeze({
  version: 'pulse.boundary-negative-matrix.h5.v1',
  stage: 'H5',
  status: 'PASS',
  requiredGuardrailCount: requiredGuardrails.length,
  executedNegativeCaseCount: cases.length,
  requiredGuardrails,
  cases,
  failClosed: true,
  automaticFallback: false
}));
writeJson('boundary-import-policy.json', Object.freeze({
  version: 'pulse.boundary-import-policy.h5.v1',
  stage: 'H5',
  status: 'PASS',
  scanner: 'wasm/test/assert-import-boundaries.cjs',
  policyOwner: 'repository-maintainer-boundary-gate',
  compilerImportDirection: 'contracts-and-feature-packages-must-not-depend-on-compiler-internals',
  workspaceDependencyPolicy: 'every executable workspace import must be declared by the importer and exported by the owner',
  packageTestPolicy: 'public-package tests use declared entries; compiler conformance belongs under wasm/test',
  providerPrivateImportPolicy: 'named-conformance-allowlist-only',
  driftProof: drift,
  productionSourcesMutated: false
}));

console.log(`ok - H5 rejects ${cases.length} negative cases across ${requiredGuardrails.length} boundary guardrails, including mutation-proven package dependency/export, private-toolchain, Entities schema, and capability drift`);
