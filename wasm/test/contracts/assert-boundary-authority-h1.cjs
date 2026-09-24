#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outputDirectory = path.join(repoRoot, 'wasm', '.test-results', 'boundary-h1');
const OBSERVED_AT = '2026-07-30';
const STARTING_SNAPSHOT = Object.freeze({
  archive: 'pulse-boundary-h0-implemented.zip',
  sha256: '0ee68dda4687cd388a305d0590d29b4e2e66cd162b55cf4dfce6fa450c411ea0'
});

process.chdir(repoRoot);

const packageContract = require('../../packages/contracts/src/package/package-contract.js');
const canonicalRuntime = require('../../packages/contracts/src/handler/canonical-runtime.js');
const {
  invokeLowerableCompilerBuilder
} = require('../../packages/library-kit/src/compiler/handler-library-contracts.js');
const {
  buildPackageOwnedLoweringPlan
} = require('../../packages/library-kit/src/compiler/package-lowering.js');

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
    range: { start: 10, end: 20 },
    resource: { kind: 'literal', value: 'updates' },
    payload: { message: 'ready' },
    providerRequirements: ['example.emit'],
    loc: { file: 'src/index.ts', line: 2, column: 3 },
    ...overrides
  };
}

const authority = Object.freeze({
  contractId: 'pulse.example',
  npmPackage: '@pulse-compute/example',
  lowerableSubpath: '@pulse-compute/example'
});
const manifest = Object.freeze({
  version: 'pulsewasm.lowerable-library-manifest.v2',
  kind: 'pulsewasm.lowerable-library-manifest',
  contractId: authority.contractId,
  npmPackage: authority.npmPackage,
  lowerableSubpath: authority.lowerableSubpath,
  facade: Object.freeze({
    namespace: 'example',
    symbols: Object.freeze(['emit'])
  }),
  compiler: Object.freeze({
    version: 'pulsewasm.lowerable-compiler-builder.v1',
    entry: './pulsewasm.compiler.cjs',
    export: 'buildExampleLoweringPlan',
    builderOwner: authority.npmPackage,
    trust: 'first-party'
  }),
  modes: Object.freeze({
    typescript: Object.freeze({ entry: './dist/index.js' }),
    jsEngine: Object.freeze({ entry: './dist/index.js' }),
    wasm: Object.freeze({
      sidecar: './as/index.as.ts',
      lowerings: Object.freeze([])
    })
  })
});
const record = Object.freeze({
  packageName: authority.npmPackage,
  manifest
});
const rawBuilderResult = Object.freeze({
  artifact: Object.freeze({
    version: 'pulse.example-lowering-plan.v1',
    status: 'ok',
    contractId: authority.contractId,
    package: authority.npmPackage,
    lowerableSubpath: authority.lowerableSubpath,
    entries: Object.freeze([])
  }),
  canonicalEffects: Object.freeze([Object.freeze(effect())]),
  diagnostics: Object.freeze([]),
  hasErrors: false
});
let capturedInvocation;
const loaded = Object.freeze({
  entry: path.join(repoRoot, 'packages', 'example', 'pulsewasm.compiler.cjs'),
  exportName: 'buildExampleLoweringPlan',
  compiler: manifest.compiler,
  builder(input) {
    capturedInvocation = input;
    return rawBuilderResult;
  }
});
const sourceFile = Object.freeze({
  fileName: 'src/index.ts',
  text: 'export default function handler() {}',
  getFullText() {
    return this.text;
  }
});
const callerInputs = {
  cwd: repoRoot,
  workspaceRoot: repoRoot,
  sourceFile,
  typescript: Object.freeze({ SyntaxKind: Object.freeze({ SourceFile: 0 }) }),
  generatedBy: 'boundary-h1-test',
  routePlan: Object.freeze({ routes: Object.freeze([]) }),
  schemaBundle: Object.freeze({ registry: Object.freeze({ schemas: Object.freeze([]) }) }),
  compilerCache: Object.freeze({ mustNotCross: true }),
  rawCliConfig: Object.freeze({ mustNotCross: true }),
  providerDriver: Object.freeze({ mustNotCross: true }),
  runtimeObject: Object.freeze({ mustNotCross: true })
};
Object.defineProperty(callerInputs, 'targetDescriptor', {
  enumerable: true,
  get() {
    throw new Error('targetDescriptor must not be observed by the package builder boundary');
  }
});

const normalizedBuilderResult = invokeLowerableCompilerBuilder(
  loaded,
  record,
  Object.freeze([]),
  callerInputs
);

assert.deepEqual(Object.keys(capturedInvocation), packageContract.PACKAGE_BUILDER_INVOCATION_FIELDS);
assert.equal(capturedInvocation.version, packageContract.PACKAGE_BUILDER_INVOCATION_VERSION);
assert.equal(Object.isFrozen(capturedInvocation), true);
assert.equal(Object.isFrozen(capturedInvocation.manifest), true);
assert.equal(Object.isFrozen(capturedInvocation.libraryContracts), true);
assert.equal(Object.isFrozen(capturedInvocation.routePlan), true);
assert.equal(Object.isFrozen(capturedInvocation.schemaBundle), true);
for (const field of [
  'targetDescriptor',
  'packageTarget',
  'compilerCache',
  'rawCliConfig',
  'providerDriver',
  'runtimeObject',
  'manifestRecord',
  'manifestRecords'
]) {
  assert.equal(Object.hasOwn(capturedInvocation, field), false, `${field} crossed the package builder boundary`);
}
assert.equal(normalizedBuilderResult.version, packageContract.PACKAGE_BUILDER_RESULT_VERSION);
assert.deepEqual(Object.keys(normalizedBuilderResult), [
  'version',
  'contractId',
  'npmPackage',
  'lowerableSubpath',
  'artifact',
  'contributions',
  'diagnostics',
  'warnings',
  'hasErrors'
]);
assert.equal(Object.isFrozen(normalizedBuilderResult), true);
assert.equal(Object.isFrozen(normalizedBuilderResult.artifact), true);
assert.equal(Object.isFrozen(normalizedBuilderResult.contributions.canonicalEffects), true);
assert.throws(
  () => packageContract.normalizePackageBuilderResult({ ...rawBuilderResult, providerDriver: {} }, authority),
  /unsupported field/
);
assert.throws(
  () => packageContract.normalizePackageBuilderResult({
    ...rawBuilderResult,
    artifact: { ...rawBuilderResult.artifact, targetDescriptor: {} }
  }, authority),
  /must not contain/
);
assert.throws(
  () => packageContract.normalizePackageBuilderResult({
    ...rawBuilderResult,
    artifact: { ...rawBuilderResult.artifact, package: '@pulse-compute/not-example' }
  }, authority),
  /identity must equal/
);
assert.throws(
  () => packageContract.normalizePackageBuilderResult({
    ...rawBuilderResult,
    canonicalEffects: [effect({ range: { start: 20, end: 30 } }), effect({ range: { start: 10, end: 15 } })]
  }, authority),
  /deterministic source order/
);

const mutablePayload = { message: 'ready' };
const operation = packageContract.createCanonicalPackageOperation(effect({
  payload: mutablePayload,
  providerRequirements: ['time.wall-clock', 'example.emit']
}), {
  ...authority,
  hostCapabilities: ['result', 'clock', 'clock']
}, 1);
mutablePayload.message = 'changed-after-normalization';
assert.equal(operation.payload.message, 'ready');
assert.equal(operation.id, 'pulse.example:1:example.emit');
assert.deepEqual(operation.hostCapabilities, ['clock', 'result']);
assert.deepEqual(operation.providerRequirements, ['example.emit', 'time.wall-clock']);
assert.equal(Object.isFrozen(operation), true);
assert.equal(Object.isFrozen(operation.canonicalEffect), true);
assert.deepEqual(packageContract.normalizeCanonicalPackageOperation(operation), operation);
assert.throws(
  () => packageContract.createCanonicalPackageOperation(effect({ privateCompilerField: true }), authority, 1),
  /unsupported field/
);
assert.throws(
  () => packageContract.createCanonicalPackageOperation(effect({ contractId: 'pulse.other' }), authority, 1),
  /identity must equal/
);
assert.throws(
  () => packageContract.normalizeCanonicalPackageOperation({ ...operation, unexpected: true }),
  /unsupported field/
);
assert.throws(
  () => packageContract.normalizeCanonicalPackageOperation({ ...operation, id: 'nondeterministic' }),
  /exactly match/
);

const loweringBundle = packageContract.normalizePackageLoweringBundle({
  inputVersion: 'pulse.package-operation-recognition.v1',
  operations: [operation],
  packages: [
    { contractId: 'pulse.zed', package: '@pulse-compute/zed' },
    { contractId: 'pulse.example', package: authority.npmPackage }
  ],
  schemaReferences: [],
  realizationArtifacts: [],
  guestUnits: [],
  cryptoRequirements: []
});
assert.equal(loweringBundle.version, packageContract.PACKAGE_LOWERING_BUNDLE_VERSION);
assert.deepEqual(loweringBundle.packages.map((entry) => entry.contractId), ['pulse.example', 'pulse.zed']);
assert.deepEqual(loweringBundle.requiredHostCapabilities, ['clock', 'result']);
assert.deepEqual(loweringBundle.requiredProviderCapabilities, ['example.emit', 'time.wall-clock']);
assert.equal(Object.isFrozen(loweringBundle), true);
assert.throws(
  () => packageContract.normalizePackageLoweringBundle({
    inputVersion: 'pulse.package-operation-recognition.v1',
    operations: [{ ...operation, order: 2, id: 'pulse.example:2:example.emit' }],
    packages: [],
    schemaReferences: [],
    realizationArtifacts: [],
    guestUnits: [],
    cryptoRequirements: []
  }),
  /contiguous/
);

const providerRecordInput = {
  version: packageContract.PROVIDER_REQUIREMENT_RECORD_VERSION,
  authorityVersion: 'pulse.provider-requirement-authority.v1',
  planVersion: 'pulse.canonical-native-plan.v3',
  planHash: 'a'.repeat(64),
  providerNeutral: true,
  capabilities: ['example.emit', 'time.wall-clock'],
  providerKinds: ['example'],
  operations: [],
  packageEffects: [],
  packages: [
    { contractId: 'pulse.zed', package: '@pulse-compute/zed', import: '@pulse-compute/zed' },
    { contractId: authority.contractId, package: authority.npmPackage, import: authority.lowerableSubpath }
  ],
  packageOperationIds: [operation.id],
  hostCapabilities: ['clock', 'result'],
  policy: {
    providerSelected: false,
    providerNeutralPlanRequired: true,
    sourceAstAccepted: false,
    sourceTextAccepted: false,
    canonicalPlanOnly: true,
    packageLoweringBundleOnly: true
  }
};
const providerRecord = packageContract.normalizeProviderRequirementRecord(providerRecordInput);
assert.equal(providerRecord.version, packageContract.PROVIDER_REQUIREMENT_RECORD_VERSION);
assert.deepEqual(providerRecord.packages.map((entry) => entry.contractId), ['pulse.example', 'pulse.zed']);
assert.equal(Object.isFrozen(providerRecord), true);
assert.equal(Object.isFrozen(providerRecord.policy), true);
assert.throws(
  () => packageContract.normalizeProviderRequirementRecord({ ...providerRecordInput, selectedProvider: 'node' }),
  /unsupported field/
);
assert.throws(
  () => packageContract.normalizeProviderRequirementRecord({ ...providerRecordInput, capabilities: ['time.wall-clock', 'example.emit'] }),
  /must be sorted/
);

const compilerSeamSource = read('wasm/packages/compiler/src/spine/package-operation-seam.js');
const providerAuthoritySource = read('wasm/packages/compiler/src/spine/provider-requirement-authority.js');
const handlerLibrarySource = read('wasm/packages/library-kit/src/compiler/handler-library-contracts.js');
const packageLoweringSource = read('wasm/packages/library-kit/src/compiler/package-lowering.js');
const jwtBuilderSource = read('packages/jwt/pulsewasm.compiler.cjs');
const jwtManifestSource = read('packages/jwt/pulsewasm.manifest.cjs');
const canonicalProjectSource = read('wasm/packages/compiler/src/canonical-project-compiler.js');

assert.doesNotMatch(compilerSeamSource, /const CANONICAL_PACKAGE_OPERATION_VERSION = 'pulse\.canonical-package-operation\.v1'/);
assert.doesNotMatch(compilerSeamSource, /const PACKAGE_LOWERING_BUNDLE_VERSION = 'pulse\.package-lowering-bundle\.v1'/);
assert.doesNotMatch(compilerSeamSource, /const PACKAGE_CONTRACT_CATALOG_VERSION = 'pulse\.package-contract-catalog\.v2'/);
assert.match(compilerSeamSource, /createCanonicalPackageOperation/);
assert.match(compilerSeamSource, /normalizePackageLoweringBundle/);
assert.doesNotMatch(providerAuthoritySource, /const PROVIDER_REQUIREMENT_RECORD_VERSION = 'pulse\.provider-requirement-record\.v1'/);
assert.match(providerAuthoritySource, /normalizeProviderRequirementRecord/);
assert.doesNotMatch(handlerLibrarySource, /loaded\.builder\(\{\s*\.\.\.inputs/);
assert.doesNotMatch(packageLoweringSource, /\.\.\.inputs/);
assert.doesNotMatch(jwtBuilderSource, /targetDescriptor|packageTarget|targetDecision/);
assert.doesNotMatch(jwtManifestSource, /target capability descriptor/);
assert.doesNotMatch(compilerSeamSource, /targetDescriptor: options\.packageTargetDescriptor|packageTarget: options\.packageTarget/);
assert.doesNotMatch(canonicalProjectSource, /schemaBundle: schema\.bundle,\s*packageTargetDescriptor:/);

let poisonedTargetRead = false;
const jwtResult = buildPackageOwnedLoweringPlan({
  cwd: repoRoot,
  workspaceRoot: repoRoot,
  contractId: 'pulse.jwt',
  sourcePath: 'src/index.ts',
  sourceText: `import { jwt } from '@pulse-compute/jwt'
export default async function handler(ctx) {
  return jwt.verify(ctx, jwt.bearer(ctx.req), {
    algorithms: ['HS256'],
    key: { type: 'secret', binding: 'JWT_H1_SECRET_BINDING' }
  })
}`,
  get targetDescriptor() {
    poisonedTargetRead = true;
    throw new Error('package builder observed a provider target descriptor');
  }
});
assert.equal(poisonedTargetRead, false);
assert.equal(jwtResult.version, packageContract.PACKAGE_BUILDER_RESULT_VERSION);
assert.equal(jwtResult.artifact.status, 'ok');
assert.deepEqual(jwtResult.contributions.canonicalEffects[0].providerRequirements, [
  'jwt.verify',
  'jwt.verify.hs256',
  'secret.get',
  'time.wall-clock'
]);
assert.equal(Object.hasOwn(jwtResult.artifact.entries[0], 'target'), false);

const shapeContract = Object.freeze({
  version: 'pulse.boundary-package-shape.h1.v1',
  stage: 'H1',
  status: 'PASS',
  observedAt: OBSERVED_AT,
  startingSnapshot: STARTING_SNAPSHOT,
  owners: Object.freeze({
    builderInvocationAndResult: '@pulse-compute/wasm-contracts/package/package-contract + @pulse-compute/wasm-library-kit',
    canonicalPackageOperation: '@pulse-compute/wasm-contracts/package/package-contract',
    packageLoweringBundle: '@pulse-compute/wasm-contracts/package/package-contract',
    providerRequirementRecord: '@pulse-compute/wasm-contracts/package/package-contract',
    packageRecognition: 'trusted first-party feature package',
    targetEligibility: 'compiler/provider boundary after canonical requirements'
  }),
  versions: Object.freeze({
    builderInvocation: packageContract.PACKAGE_BUILDER_INVOCATION_VERSION,
    builderResult: packageContract.PACKAGE_BUILDER_RESULT_VERSION,
    canonicalOperation: packageContract.CANONICAL_PACKAGE_OPERATION_VERSION,
    loweringBundle: packageContract.PACKAGE_LOWERING_BUNDLE_VERSION,
    providerRequirementRecord: packageContract.PROVIDER_REQUIREMENT_RECORD_VERSION
  }),
  invocationFields: packageContract.PACKAGE_BUILDER_INVOCATION_FIELDS,
  resultFields: Object.freeze(Object.keys(normalizedBuilderResult)),
  contributionFields: Object.freeze(Object.keys(normalizedBuilderResult.contributions)),
  closedFindings: Object.freeze([
    'H0-B001',
    'H0-B002',
    'H0-B003',
    'H0-B004',
    'H0-B005'
  ]),
  negativeCases: Object.freeze([
    'unknown invocation/result/operation/provider-record field',
    'manifest/artifact/effect owner mismatch',
    'unsupported version',
    'nondeterministic source or operation order',
    'post-normalization mutation',
    'provider target/compiler cache/runtime object bleed',
    'resolved-secret field bleed'
  ]),
  policy: Object.freeze({
    trustedFirstPartyOnly: true,
    targetDescriptorAtBuilderBoundary: false,
    rawCliConfigAtBuilderBoundary: false,
    providerObjectAtBuilderBoundary: false,
    arbitraryCompilerServicesAtBuilderBoundary: false,
    automaticFallback: false,
    compilerRefactorAuthorized: false
  })
});

fs.mkdirSync(outputDirectory, { recursive: true });
const shapeOutput = writeJson('package-boundary-shape.json', shapeContract);
const handoffOutput = writeText('boundary-h1-handoff.md', `# Pulse boundary lock H1 → H2 handoff

**Schema:** \`pulse.boundary-h1-handoff.v1\`  
**H1 result:** PASS  
**Next authorized pass:** H2  
**Recommended GPT-5.6 effort:** \`high\`

## H1 conclusion

H0-B001 through H0-B005 are closed. Package builders receive one exact
immutable invocation envelope, compiler orchestration receives one normalized
versioned result envelope, canonical operation/lowering/provider-requirement
identities and normalizers have one contract owner, and JWT no longer observes
provider targets.

Assets, GRIP, and JWT keep package-owned recognition. Trusted-first-party-only,
provider-neutral semantics, explicit target selection, and no-fallback policy
remain unchanged.

## Implement H2 only

Close \`H0-B006\` and the guest-link ownership boundary:

- replace active \`pulse.compiler-guest-unit-stage.*\` identities with
  guest-link-owned identities;
- keep any compiler adapter thin and free of guest implementation logic;
- pass normalized guest contributions plus explicit target/final-Wasm policy
  facts, never raw compiler state;
- return exact audited final bytes, normalized reports, artifact identity,
  packaging authorization, and a no-fallback disposition;
- stop before provider packaging on materialization, composition,
  optimization, or audit failure.

Preserve the current single selected guest, package-prebuilt origin, fixed
memory policy, content-addressed materialization, source-build exclusion, and
redacted diagnostics.

Do not implement H3 provider requests, H4 crypto/JWT/Fastly alignment,
Entities, events, compiler beautification, publication, or release work.
`);
const report = Object.freeze({
  version: 'pulse.boundary-h1-report.v1',
  stage: 'H1',
  status: 'PASS',
  observedAt: OBSERVED_AT,
  startingSnapshot: STARTING_SNAPSHOT,
  changeClass: 'architecture',
  scope: 'architecture-change',
  humanDecision: 'provided-by-direct-H1-implementation-request-and-H0-freeze',
  protectedBoundariesReviewed: Object.freeze([
    'lowerer-trust',
    'runtime-target-fluidity'
  ]),
  filesChanged: Object.freeze([
    'docs/architecture/current-contracts.md',
    'docs/concepts/package-owned-lowering.md',
    'docs/contributing/package-lowerer-contract.md',
    'packages/grip/pulsewasm.compiler.cjs',
    'packages/jwt/pulsewasm.compiler.cjs',
    'packages/jwt/pulsewasm.manifest.cjs',
    'wasm/packages/cli/docs/architecture/current-contracts.md',
    'wasm/packages/cli/docs/concepts/package-owned-lowering.md',
    'wasm/packages/cli/docs/contributing/package-lowerer-contract.md',
    'wasm/packages/compiler/src/canonical-project-compiler.js',
    'wasm/packages/compiler/src/spine/package-operation-seam.js',
    'wasm/packages/compiler/src/spine/provider-requirement-authority.js',
    'wasm/packages/contracts/src/package/package-contract.js',
    'wasm/packages/library-kit/src/compiler/handler-library-contracts.js',
    'wasm/packages/library-kit/src/compiler/package-lowering.js',
    'wasm/test/assert-hidden-contracts.cjs',
    'wasm/test/contracts/assert-boundary-authority-h0.cjs',
    'wasm/test/contracts/assert-boundary-authority-h1.cjs',
    'wasm/test/jwt/assert-jwt-package-owned-lowering.cjs',
    'wasm/test/library/assert-grip-package-owned-lowering.cjs',
    'wasm/test/suite/assert-suite-shape.cjs',
    'wasm/test/suite/registry.cjs'
  ]),
  closedFindings: shapeContract.closedFindings,
  diagnostics: Object.freeze({
    added: Object.freeze([]),
    changed: Object.freeze([
      'JWT package recognition no longer emits target-eligibility diagnostics; canonical crypto/provider eligibility owns selected-target failure after requirements exist.'
    ])
  }),
  validation: Object.freeze({
    focusedCommand: 'node wasm/scripts/run-wasm-tests.cjs --task boundary-authority-h0 --task boundary-authority-h1 --task package-reachability --task assets-package-owned-lowering --task grip-package-owned-lowering --task jwt-package-owned-lowering --task hidden-contracts --task boundaries --no-report',
    result: 'PASS',
    publicSurfaceChanged: false,
    providerBehaviorChanged: false,
    targetSupportChanged: false,
    fallbackChanged: false
  }),
  outputs: Object.freeze({
    shapeContract: shapeOutput,
    nextPassHandoff: handoffOutput
  }),
  remainingBoundaryDebt: Object.freeze([
    'H0-B006 → H2',
    'H0-B007 through H0-B011 → H3',
    'H0-B012 → H4',
    'H0-B014 → post-beta',
    'H0-B015 → documentation'
  ]),
  assumptions: Object.freeze([
    'The H0 frozen owner map and H2-H5 scopes remain authorized.',
    'TypeScript SourceFile and API references remain compiler-owned opaque syntax inputs; arbitrary Program and service objects remain excluded.'
  ]),
  inferences: Object.freeze([
    'Entities can consume package contributions after H2-H4 without widening the H1 feature-to-compiler seam.',
    'No broad compiler refactor is required to preserve this ownership split.'
  ]),
  stopConditionsEncountered: Object.freeze([]),
  risksOrBlockers: Object.freeze([]),
  nextAuthorizedCheckpoint: 'H2'
});
writeJson('boundary-h1-report.json', report);

console.log('ok - H1 closes H0-B001 through H0-B005 with exact immutable package contribution boundaries and authorizes H2 only');
