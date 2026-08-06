#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const contracts = require('../../packages/contracts/src/provider/toolchain.js');
const {
  FINAL_WASM_POLICY_VERSION,
  defineFinalWasmPolicy
} = require('../../packages/contracts/src/provider/final-wasm-policy.js');

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const finalWasmPolicy = defineFinalWasmPolicy({
  version: FINAL_WASM_POLICY_VERSION,
  descriptorOwner: '@example/provider-proof',
  toolchainVersion: contracts.PROVIDER_TOOLCHAIN_VERSION,
  descriptorIdentity: 'proof-native',
  permittedImports: [],
  requiredExports: []
});

const nativeTarget = Object.freeze({
  version: contracts.PROVIDER_TARGET_DESCRIPTOR_VERSION,
  provider: 'proof',
  target: 'native',
  targetId: 'proof-native',
  runtimeClass: 'native',
  status: 'supported',
  automaticFallback: false,
  finalWasmPolicy,
  commands: Object.freeze({ compile: true, inspect: true, build: true })
});

const wasm = Buffer.from('0061736d01000000', 'hex');
const wasmHash = hash(wasm);
const nativeArtifact = contracts.createProviderNativeArtifact(Object.freeze({
  compilerVersion: 'pulse.canonical-native-wasm-compiler.v3',
  wasm,
  wat: '(module)',
  manifest: Object.freeze({
    compilerVersion: 'pulse.canonical-native-wasm-compiler.v3',
    assemblyScript: Object.freeze({ package: 'assemblyscript', version: '0.28.18' }),
    optimization: Object.freeze({ posture: 'native-size' }),
    wasm: Object.freeze({ bytes: wasm.byteLength, sha256: wasmHash, magic: '0061736d01000000' }),
    wat: Object.freeze({ bytes: 8, sha256: hash('(module)') }),
    importModules: Object.freeze([]),
    imports: Object.freeze([]),
    exports: Object.freeze([]),
    packageRealizationArtifacts: Object.freeze({ version: 'proof', count: 0, ids: Object.freeze([]) }),
    policy: Object.freeze({ providerNeutral: true })
  }),
  realizationArtifacts: Object.freeze([]),
  guestUnits: Object.freeze([])
}));

const applicationPlan = Object.freeze({
  version: 'pulse.canonical-native-plan.v2',
  source: Object.freeze({ sourceHash: 'proof', projectSourceHash: 'proof' }),
  packages: Object.freeze({ effects: Object.freeze([]) })
});
const providerPlan = Object.freeze({
  version: 'pulse.canonical-provider-plan.v1',
  contractVersion: 'pulse.canonical-provider-contract.v1',
  provider: 'proof',
  requirements: Object.freeze([]),
  bindings: Object.freeze({}),
  operations: Object.freeze([])
});
const requirements = contracts.projectProviderRequirements(applicationPlan, providerPlan);

const invocationInput = {
  version: contracts.PROVIDER_TARGET_INVOCATION_VERSION,
  action: 'write-native',
  provider: 'proof',
  selectedTarget: nativeTarget,
  applicationPlan,
  providerPlan,
  providerConfig: Object.freeze({ kind: 'proof' }),
  requirements,
  nativeArtifact,
  javascript: null,
  project: Object.freeze({ root: repoRoot, outDir: path.join(repoRoot, '.proof'), profile: 'proof' }),
  synchronizedPackages: Object.freeze([]),
  optimization: Object.freeze({ posture: 'native-size' }),
  timeoutMs: 1000
};

const invocation = contracts.createProviderTargetInvocation(invocationInput);
assert.equal(invocation.version, contracts.PROVIDER_TARGET_INVOCATION_VERSION);
assert.deepEqual(Object.keys(invocation).sort(), [
  'action', 'applicationPlan', 'javascript', 'nativeArtifact', 'optimization', 'project',
  'provider', 'providerConfig', 'providerPlan', 'requirements', 'selectedTarget',
  'synchronizedPackages', 'timeoutMs', 'version'
].sort());
assert.equal(Object.isFrozen(invocation), true);
assert.equal(Object.isFrozen(invocation.requirements.packages), true);

assert.throws(
  () => contracts.createProviderTargetInvocation({ ...invocationInput, compiled: Object.freeze({ ast: true }) }),
  /unknown fields: compiled/
);
assert.throws(
  () => contracts.createProviderPlanInput({
    version: contracts.PROVIDER_PLAN_INPUT_VERSION,
    capabilities: [],
    providerOperations: [],
    opaqueReturnCount: 0,
    rawLowererOutput: {}
  }),
  /unknown fields: rawLowererOutput/
);
assert.throws(
  () => contracts.defineProviderToolchain({
    version: contracts.PROVIDER_TOOLCHAIN_VERSION,
    id: 'proof',
    packageName: '@example/proof',
    packageVersion: '1.0.0',
    createDriver(_compilerService) {}
  }),
  /must receive no compiler service/
);
assert.throws(
  () => contracts.createProviderRequirements({ version: 'pulse.provider-requirements.v0', capabilities: [], bindings: {}, packages: [] }),
  /version must be pulse.provider-requirements.v1/
);
assert.throws(
  () => contracts.defineProviderDriver({
    version: contracts.PROVIDER_DRIVER_VERSION,
    id: 'proof',
    executable: true,
    defaultBuildMode: 'native-provider',
    normalizeConfig() { return {}; },
    projectConfigDocument() {},
    initTemplate() { return {}; },
    createLoweringPlan() { return providerPlan; },
    targets: Object.freeze({ native: nativeTarget })
  }),
  /missing inspectRealization/
);
assert.throws(
  () => contracts.normalizeProviderTargetDescriptor({ ...nativeTarget, finalWasmPolicy: undefined }),
  /Final Wasm policy must be an object/
);
assert.throws(
  () => contracts.normalizeProviderTargetDescriptor({ ...nativeTarget, version: undefined }),
  /version must be pulse.provider-target-descriptor.v1/
);
assert.throws(
  () => contracts.createProviderTargetInvocation({ ...invocationInput, provider: 'other' }),
  /provider mismatch/
);
assert.throws(
  () => contracts.createProviderTargetInvocation({
    ...invocationInput,
    providerPlan: Object.freeze({ ...providerPlan, compiled: Object.freeze({}) })
  }),
  /unknown fields: compiled/
);
assert.throws(
  () => contracts.createProviderTargetInvocation({
    ...invocationInput,
    requirements: contracts.createProviderRequirements({
      version: contracts.PROVIDER_REQUIREMENTS_VERSION,
      capabilities: ['fetch'],
      bindings: {},
      packages: []
    })
  }),
  /requirements do not match its canonical plans/
);
assert.throws(
  () => contracts.createProviderTargetInvocation({
    ...invocationInput,
    nativeArtifact: { ...nativeArtifact, manifest: { ...nativeArtifact.manifest } }
  }),
  /must be immutable/
);
assert.throws(
  () => contracts.normalizeProviderTargetResult({
    version: 'pulse.provider-target-result.v0',
    action: 'write-native',
    provider: 'proof',
    target: 'native',
    status: 'built',
    automaticFallback: false,
    files: {},
    build: {},
    realization: {},
    packaging: null
  }),
  /version must be pulse.provider-target-result.v1/
);
assert.throws(
  () => contracts.normalizeProviderTargetResult({
    version: contracts.PROVIDER_TARGET_RESULT_VERSION,
    action: 'write-native',
    provider: 'proof',
    target: 'native',
    status: 'built',
    automaticFallback: false,
    files: {},
    build: {},
    realization: {},
    packaging: Object.freeze({
      version: contracts.PROVIDER_PACKAGING_AUDIT_VERSION,
      artifactSha256: 'a'.repeat(64),
      auditedSha256: 'b'.repeat(64),
      authorized: true
    })
  }),
  /do not match the authorized final guest audit/
);

const compilerSourceRoot = path.join(repoRoot, 'wasm', 'packages', 'compiler', 'src');
for (const file of fs.readdirSync(compilerSourceRoot, { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || !/\.js$/.test(file.name)) continue;
  const full = path.join(file.parentPath, file.name);
  const source = fs.readFileSync(full, 'utf8');
  assert.doesNotMatch(source, /require\('@pulse-compute\/provider-(?:node|fastly)/, `${path.relative(repoRoot, full)} imports a concrete provider`);
}

const bootstrapSource = fs.readFileSync(path.join(compilerSourceRoot, 'provider-toolchain.js'), 'utf8');
assert.doesNotMatch(bootstrapSource, /buildJavascriptTargetSupportEvidence/, 'provider bootstrap must not hand a compiler service to createDriver');
assert.match(bootstrapSource, /toolchain\.createDriver\(\)/, 'provider driver creation must receive no compiler option bag');
const executionSource = fs.readFileSync(path.join(repoRoot, 'wasm', 'packages', 'cli', 'src', 'project-execution.js'), 'utf8');
assert.match(executionSource, /driver\.writeTarget\(providerTargetInvocation\(/);
assert.doesNotMatch(executionSource, /driver\.writeTarget\(\s*\{/);
assert.doesNotMatch(executionSource, /driver\.inspectRealization\(\s*\{/);

console.log('ok - provider toolchains, target descriptors, invocations, requirements, results, and final-byte packaging are exact, versioned, and fail closed');
