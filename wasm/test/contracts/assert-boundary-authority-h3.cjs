#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outputDirectory = path.join(repoRoot, 'wasm', '.test-results', 'boundary-h3');
const OBSERVED_AT = '2026-07-31';
const STARTING_SNAPSHOT = Object.freeze({
  archive: 'pulse-boundary-h2-implemented.zip',
  sha256: '3aa68a76ce872737684fd302bd09662f9127d63015fba0c007843412c049d79f'
});

process.chdir(repoRoot);

const contracts = require('../../packages/contracts/src/provider/toolchain.js');
const nodeToolchain = require('../../../packages/provider-node/src/toolchain.js');
const fastlyToolchain = require('../../../packages/provider-fastly/src/toolchain/index.js');
const {
  NODE_PROVIDER_DESCRIPTOR
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const {
  NODE_JWT_VERIFY_CAPABILITY,
  NODE_NATIVE_TARGET_CAPABILITIES
} = require('../../../packages/provider-node/src/capabilities.js');

const INVOCATION_FIELDS = Object.freeze([
  'version',
  'action',
  'provider',
  'selectedTarget',
  'applicationPlan',
  'providerPlan',
  'providerConfig',
  'requirements',
  'nativeArtifact',
  'javascript',
  'project',
  'synchronizedPackages',
  'optimization',
  'timeoutMs'
]);
const RESULT_FIELDS = Object.freeze([
  'version',
  'action',
  'provider',
  'target',
  'status',
  'automaticFallback',
  'files',
  'build',
  'realization',
  'packaging'
]);

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

for (const toolchain of [nodeToolchain, fastlyToolchain]) {
  assert.equal(toolchain.version, contracts.PROVIDER_TOOLCHAIN_VERSION);
  assert.equal(toolchain.createDriver.length, 0);
  const driver = contracts.assertProviderDriver(toolchain.createDriver(), { id: toolchain.id });
  assert.equal(driver.version, contracts.PROVIDER_DRIVER_VERSION);
  assert.equal(Object.isFrozen(driver), true);
  assert.equal(driver.targets.native.version, contracts.PROVIDER_TARGET_DESCRIPTOR_VERSION);
  assert.equal(driver.targets.native.automaticFallback, false);
  assert.ok(driver.targets.native.finalWasmPolicy);
  assert.equal(driver.targets.javascript.version, 'pulse.javascript-target-descriptor.v2');
  assert.equal(driver.targets.javascript.automaticFallback, false);
}

const nodeDriver = contracts.assertProviderDriver(nodeToolchain.createDriver(), { id: 'node' });
const applicationPlan = Object.freeze({
  version: 'pulse.javascript-application-plan.v1',
  target: 'javascript',
  packages: Object.freeze([])
});
const providerPlan = Object.freeze({
  version: 'pulse.canonical-provider-plan.v1',
  contractVersion: 'pulse.canonical-provider-contract.v1',
  provider: 'node',
  providerVersion: 'proof',
  package: '@pulse-compute/provider-node',
  runtime: 'proof',
  buildTarget: 'node',
  deployable: true,
  localExecution: true,
  requirements: Object.freeze([]),
  bindings: Object.freeze({}),
  operations: Object.freeze([]),
  providerSpecificUserland: false,
  providerSdkUserland: false,
  capabilityDiscoveryFromUserland: false
});
const requirements = contracts.projectProviderRequirements(applicationPlan, providerPlan);
const invocationInput = {
  version: contracts.PROVIDER_TARGET_INVOCATION_VERSION,
  action: 'write-javascript',
  provider: 'node',
  selectedTarget: nodeDriver.targets.javascript,
  applicationPlan,
  providerPlan,
  providerConfig: Object.freeze({ kind: 'node' }),
  requirements,
  nativeArtifact: null,
  javascript: Object.freeze({ schemaBundle: null }),
  project: Object.freeze({ root: repoRoot, outDir: path.join(repoRoot, '.proof'), profile: 'proof' }),
  synchronizedPackages: Object.freeze([]),
  optimization: null,
  timeoutMs: 1000
};
const invocation = contracts.createProviderTargetInvocation(invocationInput);
assert.deepEqual(Object.keys(invocation), INVOCATION_FIELDS);
assert.equal(Object.isFrozen(invocation), true);
assert.equal(Object.isFrozen(invocation.applicationPlan), true);
assert.throws(
  () => contracts.createProviderTargetInvocation({ ...invocationInput, compiled: Object.freeze({}) }),
  /unknown fields: compiled/
);
assert.throws(
  () => contracts.createProviderTargetInvocation({
    ...invocationInput,
    providerPlan: Object.freeze({ ...providerPlan, rawLowererOutput: Object.freeze({}) })
  }),
  /unknown fields: rawLowererOutput/
);

const result = contracts.normalizeProviderTargetResult({
  version: contracts.PROVIDER_TARGET_RESULT_VERSION,
  action: 'inspect-native',
  provider: 'node',
  target: 'native',
  status: 'inspected',
  automaticFallback: false,
  files: Object.freeze({}),
  build: null,
  realization: Object.freeze({ providerNeutralWasm: true }),
  packaging: null
});
assert.deepEqual(Object.keys(result), RESULT_FIELDS);
assert.equal(Object.isFrozen(result), true);
assert.ok(NODE_PROVIDER_DESCRIPTOR.capabilities.includes(NODE_JWT_VERIFY_CAPABILITY));
assert.ok(NODE_NATIVE_TARGET_CAPABILITIES.includes(NODE_JWT_VERIFY_CAPABILITY));
assert.equal(NODE_PROVIDER_DESCRIPTOR.lowering[NODE_JWT_VERIFY_CAPABILITY], 'node.native.jwt.verify');

const compilerSourceRoot = path.join(repoRoot, 'wasm', 'packages', 'compiler', 'src');
for (const entry of fs.readdirSync(compilerSourceRoot, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.js$/.test(entry.name)) continue;
  const source = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
  assert.doesNotMatch(source, /require\('@pulse-compute\/provider-(?:node|fastly)/);
}
const proofComposition = read('wasm/packages/compiler/bin/provider-proof-composition.js');
assert.match(proofComposition, /@pulse-compute\/provider-node\/compiler/);
assert.match(proofComposition, /@pulse-compute\/provider-fastly\/compiler/);

const executionSource = read('wasm/packages/cli/src/project-execution.js');
assert.match(executionSource, /driver\.writeTarget\(providerTargetInvocation\(/);
assert.doesNotMatch(executionSource, /driver\.writeTarget\(\s*\{/);
assert.doesNotMatch(executionSource, /driver\.inspectRealization\(\s*\{/);
const importScanner = read('wasm/test/assert-import-boundaries.cjs');
assert.match(importScanner, /\(\?:ts\|tsx\)/);
assert.match(importScanner, /provider-package-conformance-imports\.json/);
const conformanceContract = JSON.parse(read('wasm/test/contracts/provider-package-conformance-imports.json'));
assert.equal(conformanceContract.version, 'pulse.provider-package-conformance-imports.v1');
assert.equal(conformanceContract.imports.length, 7);

const shapeContract = Object.freeze({
  version: 'pulse.boundary-provider-shape.h3.v1',
  stage: 'H3',
  status: 'PASS',
  observedAt: OBSERVED_AT,
  startingSnapshot: STARTING_SNAPSHOT,
  owner: '@pulse-compute/wasm-contracts/provider/toolchain',
  versions: Object.freeze({
    toolchain: contracts.PROVIDER_TOOLCHAIN_VERSION,
    driver: contracts.PROVIDER_DRIVER_VERSION,
    nativeTargetDescriptor: contracts.PROVIDER_TARGET_DESCRIPTOR_VERSION,
    invocation: contracts.PROVIDER_TARGET_INVOCATION_VERSION,
    requirements: contracts.PROVIDER_REQUIREMENTS_VERSION,
    nativeArtifact: contracts.PROVIDER_NATIVE_ARTIFACT_VERSION,
    targetResult: contracts.PROVIDER_TARGET_RESULT_VERSION,
    packagingAudit: contracts.PROVIDER_PACKAGING_AUDIT_VERSION,
    javascriptPackageResult: contracts.PROVIDER_JAVASCRIPT_PACKAGE_RESULT_VERSION,
    providerPlanInput: contracts.PROVIDER_PLAN_INPUT_VERSION
  }),
  invocationFields: INVOCATION_FIELDS,
  resultFields: RESULT_FIELDS,
  closedFindings: Object.freeze(['H0-B007', 'H0-B008', 'H0-B009', 'H0-B010', 'H0-B011']),
  preserved: Object.freeze([
    'exact-selected-provider-entrypoint',
    'provider-owned-target-support-policy',
    'canonical-native-plan-provider-neutrality',
    'guest-audited-final-byte-identity',
    'no-automatic-fallback',
    'named-provider-package-conformance-imports'
  ]),
  negativeCases: Object.freeze([
    'concrete-provider-import-under-compiler-src',
    'compiler-service-passed-to-create-driver',
    'unknown-driver-or-target-field',
    'unversioned-or-mismatched-target-descriptor',
    'missing-advertised-driver-callable',
    'missing-native-final-wasm-policy',
    'raw-compiler-or-lowerer-field-in-provider-invocation',
    'provider-or-target-identity-mismatch',
    'canonical-plan-and-requirement-mismatch',
    'mutable-native-manifest',
    'unverified-or-substituted-native-bytes',
    'unversioned-provider-result',
    'packaging-audit-hash-mismatch',
    'unscanned-provider-private-typescript-import'
  ]),
  policy: Object.freeze({
    compilerServicesAccepted: false,
    rawCompilerObjectsAccepted: false,
    rawLowererOutputAccepted: false,
    mutableNativeManifestAccepted: false,
    exactSelectedProviderRequired: true,
    exactTargetDescriptorRequired: true,
    providerPackagingRequiresExactAuditedBytes: true,
    alternateProviderAuthorized: false,
    alternateTargetAuthorized: false,
    automaticFallback: false
  })
});

fs.mkdirSync(outputDirectory, { recursive: true });
const shapeOutput = writeJson('provider-boundary-shape.json', shapeContract);
const handoffOutput = writeText('boundary-h3-handoff.md', `# Pulse boundary lock H3 → H4 handoff

**Schema:** \`pulse.boundary-h3-handoff.v1\`  
**H3 result:** PASS  
**Next authorized pass:** H4  
**Recommended GPT-5.6 effort:** \`xhigh\`

## H3 conclusion

\`H0-B007\` through \`H0-B011\` are closed. Compiler source no longer imports
concrete provider implementations. The selected \`./toolchain\` creates a
versioned, exact driver with no compiler service; target descriptors are
normalized and command callables are checked before use.

Provider planning receives only a versioned provider-plan projection.
Inspection and packaging receive one immutable target invocation containing
canonical plans, normalized provider configuration, projected requirements,
explicit project/package facts, and—only for Native—the exact verified and
guest-authorized Wasm artifact. Provider results are normalized, versioned,
provider/target-bound, fallback-free, and packaging-audit checked.

Node's canonical provider capability truth now includes its existing
\`jwt.verify\` implementation. The seven feature-package TypeScript imports of
provider-private test surfaces are covered by one exact named conformance
allowlist and by the repository boundary scanner.

## Implement H4 only

Close \`H0-B012\` by aligning Crypto/JWT semantics, Fastly JavaScript ES256
eligibility, provider target declarations, runtime-neutral crypto contracts,
and the public Pulse crypto types. Execute the frozen six-cell shared semantic
corpus, including Fastly JavaScript under Viceroy, with exact input/output and
failure parity and no algorithm, target, provider, or runtime fallback.

Preserve the H1 package contracts, H2 guest-link boundary, H3 provider
invocation/result boundary, and the protected canonical Native plan seam. Do
not implement Entities, events, compiler reorganization, publication,
deployment, release promotion, or post-beta proof-command cleanup.
`);

const report = Object.freeze({
  version: 'pulse.boundary-h3-report.v1',
  stage: 'H3',
  status: 'PASS',
  observedAt: OBSERVED_AT,
  startingSnapshot: STARTING_SNAPSHOT,
  changeClass: 'architecture',
  scope: 'architecture-change',
  humanDecision: 'provided-by-direct-H3-implementation-request-and-H2-handoff',
  protectedBoundariesReviewed: Object.freeze([
    'lowerer-trust',
    'provider-registry',
    'runtime-target-fluidity'
  ]),
  filesChanged: Object.freeze([
    'docs/architecture/current-contracts.md',
    'docs/concepts/contracts-and-providers.md',
    'docs/contributing/adding-core-provider.md',
    'docs/reference/project-config.schema.json',
    'packages/provider-fastly/src/build/canonical-target.js',
    'packages/provider-fastly/src/build/native-platform-capabilities.js',
    'packages/provider-fastly/src/toolchain/index.js',
    'packages/jwt/pulsewasm.compiler.cjs',
    'packages/provider-node/src/native/target.js',
    'packages/provider-node/src/capabilities.js',
    'packages/provider-node/src/runtime/canonical-api-runtime.js',
    'packages/provider-node/src/toolchain.js',
    'wasm/.test-results/boundary-h3/boundary-h3-handoff.md',
    'wasm/.test-results/boundary-h3/boundary-h3-report.json',
    'wasm/.test-results/boundary-h3/provider-boundary-shape.json',
    'wasm/.test-results/jwt-g4/es256-fastly-native-reality.json',
    'wasm/.test-results/jwt-g4/es256-javascript-conformance.json',
    'wasm/.test-results/jwt-g4/es256-node-native-reality.json',
    'wasm/.test-results/jwt-g4/jwt-g4-evidence.json',
    'wasm/packages/cli/bin/pulsewasm-extract.js',
    'wasm/packages/cli/docs/architecture/current-contracts.md',
    'wasm/packages/cli/docs/concepts/contracts-and-providers.md',
    'wasm/packages/cli/docs/contributing/adding-core-provider.md',
    'wasm/packages/cli/docs/reference/project-config.schema.json',
    'wasm/packages/cli/project-config.schema.json',
    'wasm/packages/cli/src/project-execution.js',
    'wasm/packages/compiler/bin/provider-proof-composition.js',
    'wasm/packages/compiler/bin/pulsewasm-extract.js',
    'wasm/packages/compiler/src/cli.js',
    'wasm/packages/compiler/src/codegen/config-provider-resolution.js (removed)',
    'wasm/packages/compiler/src/codegen/fastly-adapter.js (removed)',
    'wasm/packages/compiler/src/codegen/fastly-command-entry.js (removed)',
    'wasm/packages/compiler/src/codegen/fastly-config-secret-serve.js (removed)',
    'wasm/packages/compiler/src/codegen/fastly-hostcall-binding.js (removed)',
    'wasm/packages/compiler/src/codegen/fastly-readiness.js (removed)',
    'wasm/packages/compiler/src/codegen/node-adapter.js (removed)',
    'wasm/packages/compiler/src/codegen/runtime-provider-kv.js (removed)',
    'wasm/packages/compiler/src/compiled-wasm-node-adapter-kv.js (removed)',
    'wasm/packages/compiler/src/extractor.js',
    'wasm/packages/compiler/src/provider-toolchain.js',
    'wasm/packages/contracts/src/provider/toolchain.js',
    'wasm/test/assert-contract-ownership.cjs',
    'wasm/test/assert-import-boundaries.cjs',
    'wasm/test/contracts/assert-boundary-authority-h3.cjs',
    'wasm/test/contracts/assert-provider-toolchain-boundary.cjs',
    'wasm/test/contracts/assert-target-support.cjs',
    'wasm/test/contracts/provider-package-conformance-imports.json',
    'wasm/test/guest-link/assert-b2-materialization-stage.cjs',
    'wasm/test/jwt/assert-jwt-es256-cross-target.cjs',
    'wasm/test/provider/assert-fastly-package.cjs',
    'wasm/test/provider/assert-provider-packages.cjs',
    'wasm/test/suite/assert-suite-shape.cjs',
    'wasm/test/suite/registry.cjs'
  ]),
  closedFindings: shapeContract.closedFindings,
  diagnostics: Object.freeze({ added: Object.freeze([]), preserved: Object.freeze([]) }),
  validation: Object.freeze({
    focusedCommand: 'node wasm/scripts/run-wasm-tests.cjs --task boundary-authority-h3 --task provider-toolchain --task provider-packages --task provider-fastly-package --task canonical-native-plan --task target-support --no-report',
    viceroyCrossTargetCommand: 'PATH="<viceroy-0.20.1>:$PATH" node wasm/scripts/run-wasm-tests.cjs --task jwt-es256-cross-target --no-report',
    viceroyCrossTargetResult: 'PASS — 5 existing G4 cells, 38 corpus cases, 190 semantic evaluations, 0 skipped',
    result: 'PASS',
    compilerOutputBehaviorChanged: false,
    providerInvocationShapeChanged: true,
    internalRealizationArtifactIdentityCanonicalized: true,
    providerCapabilityTruthAligned: true,
    newProviderCapabilityAdded: false,
    runtimeSemanticsChanged: false,
    fallbackChanged: false
  }),
  outputs: Object.freeze({ shapeContract: shapeOutput, nextPassHandoff: handoffOutput }),
  remainingBoundaryDebt: Object.freeze([
    'H0-B012 → H4',
    'H0-B014 → post-beta compiler proof-command cleanup',
    'H0-B015 → H4-or-later current-truth documentation pass'
  ]),
  protectedExistingSeams: Object.freeze(['H0-B013 canonical-native-plan and provider-requirement plan-hash authority']),
  assumptions: Object.freeze([
    'The H0 frozen owner map and H4 scope remain authorized.',
    'Built-in provider package dependencies remain explicit composition dependencies, not compiler implementation authority.'
  ]),
  inferences: Object.freeze([
    'Entities can consume package and provider contracts without acquiring compiler, guest-link, or provider implementation authority.',
    'No broad compiler pipeline refactor is required before Entities.'
  ]),
  stopConditionsEncountered: Object.freeze([]),
  risksOrBlockers: Object.freeze([]),
  nextAuthorizedCheckpoint: 'H4'
});
writeJson('boundary-h3-report.json', report);

console.log('ok - H3 closes H0-B007 through H0-B011 with exact provider contracts, audited artifact identity, capability truth, and no fallback');
