'use strict';

const crypto = require('node:crypto');
const {
  CANONICAL_PROVIDER_CONTRACT_VERSION,
  CANONICAL_PROVIDER_PLAN_VERSION,
  normalizeDescriptor
} = require('./canonical-provider.js');
const { defineFinalWasmPolicy } = require('./final-wasm-policy.js');
const {
  CANONICAL_NATIVE_PLAN_VERSION
} = require('../handler/canonical-native-plan.js');
const {
  JAVASCRIPT_APPLICATION_PLAN_VERSION,
  JAVASCRIPT_TARGET_DESCRIPTOR_VERSION
} = require('../project/javascript-application.js');

const PROVIDER_TOOLCHAIN_VERSION = 'pulse.provider-toolchain.v1';
const PROVIDER_DRIVER_VERSION = 'pulse.provider-driver.v1';
const PROVIDER_TARGET_DESCRIPTOR_VERSION = 'pulse.provider-target-descriptor.v1';
const PROVIDER_TARGET_INVOCATION_VERSION = 'pulse.provider-target-invocation.v1';
const PROVIDER_TARGET_RESULT_VERSION = 'pulse.provider-target-result.v1';
const PROVIDER_REQUIREMENTS_VERSION = 'pulse.provider-requirements.v1';
const PROVIDER_NATIVE_ARTIFACT_VERSION = 'pulse.provider-native-artifact.v1';
const PROVIDER_PACKAGING_AUDIT_VERSION = 'pulse.provider-packaging-audit.v1';
const PROVIDER_JAVASCRIPT_PACKAGE_RESULT_VERSION = 'pulse.provider-javascript-package-result.v1';
const PROVIDER_PLAN_INPUT_VERSION = 'pulse.provider-plan-input.v1';

const TOOLCHAIN_FIELDS = Object.freeze([
  'version', 'id', 'packageName', 'packageVersion', 'createDriver'
]);
const DRIVER_FIELDS = Object.freeze([
  'version',
  'id',
  'descriptor',
  'executable',
  'localExecution',
  'deployable',
  'deploymentValidated',
  'sourcePackage',
  'compiledWasm',
  'defaultBuildMode',
  'sourceOnlySupported',
  'targetSupport',
  'normalizeConfig',
  'defaultLocalNetworkFetch',
  'projectConfigDocument',
  'configReference',
  'initTemplate',
  'javascript',
  'events',
  'targets',
  'execute',
  'createLoweringPlan',
  'inspectRealization',
  'writeTarget',
  'executionOptions'
]);
const TARGET_FIELDS = Object.freeze([
  'version',
  'id',
  'provider',
  'mode',
  'target',
  'targetId',
  'runtimeClass',
  'status',
  'sourceApplication',
  'automaticFallback',
  'hostBridge',
  'applicationLoader',
  'requestAdapter',
  'lifecycle',
  'capabilities',
  'keyTypes',
  'realizations',
  'jwt',
  'crypto',
  'finalWasmPolicy',
  'reporting',
  'commands'
]);
const JAVASCRIPT_DRIVER_FIELDS = Object.freeze([
  'kind',
  'localEmulation',
  'buildTimeLoader',
  'localExecutionMode',
  'realityRunner',
  'targetSupportPolicy',
  'validateApplication',
  'loadApplication',
  'writeSourcePackage',
  'describeSourcePackage',
  'executeTestCase',
  'createServer',
  'createFixtureFetch',
  'createLocalEnvironment',
  'createTestRequest',
  'executeLocalRequest'
]);
const EVENT_DRIVER_FIELDS = Object.freeze(['targets', 'executeTestCase']);
const COMMAND_FIELDS = Object.freeze(['compile', 'inspect', 'doctor', 'build', 'test', 'dev']);
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
const JAVASCRIPT_PACKAGE_FIELDS = Object.freeze([
  'version',
  'outDir',
  'entryFile',
  'bundledApplicationFile',
  'packageFile',
  'applicationPlanFile',
  'deploymentFile',
  'deploymentCandidateFile',
  'buildConfigFile',
  'fastlyTomlFile',
  'schemaRegistryFile',
  'schemaCodecsFile',
  'manifestFile',
  'manifest',
  'files'
]);
const NATIVE_ARTIFACT_FIELDS = Object.freeze([
  'version',
  'compilerVersion',
  'wasm',
  'wat',
  'manifest',
  'realizationArtifacts',
  'guestUnits',
  'guestAudit',
  'finalArtifact'
]);
const PROVIDER_PLAN_FIELDS = Object.freeze([
  'version',
  'contractVersion',
  'provider',
  'providerVersion',
  'package',
  'runtime',
  'buildTarget',
  'deployable',
  'localExecution',
  'requirements',
  'bindings',
  'operations',
  'providerSpecificUserland',
  'providerSdkUserland',
  'capabilityDiscoveryFromUserland'
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Pulse provider toolchain ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function assertExactFields(value, fields, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  const allowed = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field)).sort();
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown fields: ${unknown.join(', ')}.`);
  return value;
}

function assertData(value, label, seen = new Set()) {
  if (value === null || value === undefined) return;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return;
  if (['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError(`${label} must contain data only.`);
  }
  if (typeof value !== 'object') throw new TypeError(`${label} contains an unsupported value.`);
  if (seen.has(value)) throw new TypeError(`${label} must not contain cycles.`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) assertData(child, `${label}.${key}`, seen);
  seen.delete(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertDeepFrozen(value, label, seen = new Set()) {
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
  if (seen.has(value)) throw new TypeError(`${label} must not contain cycles.`);
  if (!Object.isFrozen(value)) throw new TypeError(`${label} must be immutable.`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${label}.${key}`, seen);
  seen.delete(value);
}

function dataClone(value, label) {
  assertData(value, label);
  if (value === undefined || value === null) return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Object.freeze(value.map((entry, index) => dataClone(entry, `${label}[${index}]`)));
  if (typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, dataClone(value[key], `${label}.${key}`)])));
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function commands(input, label) {
  assertExactFields(input || {}, COMMAND_FIELDS, `${label} commands`);
  return Object.freeze(Object.fromEntries(COMMAND_FIELDS.map((field) => [field, input && input[field] === true])));
}

function normalizeProviderTargetDescriptor(input, expected = {}) {
  assertExactFields(input, TARGET_FIELDS, 'Pulse provider target descriptor');
  const provider = nonEmpty(expected.provider || input.provider, 'target provider');
  if (input.provider !== undefined && input.provider !== provider) {
    throw new TypeError(`Pulse provider target descriptor provider mismatch: expected ${provider}, received ${String(input.provider)}.`);
  }
  const target = nonEmpty(expected.target || input.target || input.mode, 'target');
  if (!['native', 'javascript'].includes(target)) throw new TypeError(`Pulse provider target ${target} is unsupported.`);
  if (input.target !== undefined && input.target !== target) {
    throw new TypeError(`Pulse provider target descriptor target mismatch: expected ${target}, received ${String(input.target)}.`);
  }
  const runtimeClass = nonEmpty(input.runtimeClass, 'target runtimeClass');
  if (runtimeClass !== target) throw new TypeError(`Pulse provider target ${target} runtimeClass must be ${target}.`);
  const expectedVersion = target === 'javascript'
    ? JAVASCRIPT_TARGET_DESCRIPTOR_VERSION
    : PROVIDER_TARGET_DESCRIPTOR_VERSION;
  if (input.version !== expectedVersion) {
    throw new TypeError(`Pulse provider target ${provider}/${target} version must be ${expectedVersion}.`);
  }
  if (input.automaticFallback !== false) throw new TypeError(`Pulse provider target ${provider}/${target} must disable automatic fallback.`);
  const normalizedCommands = commands(input.commands, `Pulse provider target ${provider}/${target}`);
  const finalWasmPolicy = target === 'native' && input.status === 'supported'
    ? defineFinalWasmPolicy(input.finalWasmPolicy)
    : (input.finalWasmPolicy === undefined ? undefined : defineFinalWasmPolicy(input.finalWasmPolicy));
  return deepFreeze({
    version: expectedVersion,
    provider,
    target,
    targetId: nonEmpty(input.targetId || input.id, 'targetId'),
    runtimeClass,
    status: nonEmpty(input.status, 'target status'),
    sourceApplication: target === 'javascript',
    automaticFallback: false,
    ...(target === 'javascript' ? {
      hostBridge: input.hostBridge === true,
      applicationLoader: input.applicationLoader === true,
      requestAdapter: input.requestAdapter === true,
      lifecycle: input.lifecycle === true
    } : {}),
    ...(input.capabilities !== undefined ? { capabilities: dataClone(input.capabilities, 'target capabilities') } : {}),
    ...(input.keyTypes !== undefined ? { keyTypes: dataClone(input.keyTypes, 'target keyTypes') } : {}),
    ...(input.realizations !== undefined ? { realizations: dataClone(input.realizations, 'target realizations') } : {}),
    ...(input.jwt !== undefined ? { jwt: dataClone(input.jwt, 'target jwt') } : {}),
    ...(input.crypto !== undefined ? { crypto: dataClone(input.crypto, 'target crypto') } : {}),
    ...(finalWasmPolicy ? { finalWasmPolicy } : {}),
    ...(input.reporting !== undefined ? { reporting: dataClone(input.reporting, 'target reporting') } : {}),
    commands: normalizedCommands
  });
}

function normalizeJavascriptDriver(input, descriptor) {
  if (input === undefined) {
    if (descriptor && descriptor.commands.build) throw new TypeError('Pulse JavaScript target requires a provider JavaScript driver.');
    return undefined;
  }
  assertExactFields(input, JAVASCRIPT_DRIVER_FIELDS, 'Pulse provider JavaScript driver');
  if (descriptor && descriptor.commands.build && typeof input.writeSourcePackage !== 'function') {
    throw new TypeError('Pulse provider JavaScript driver is missing writeSourcePackage().');
  }
  if (descriptor && descriptor.commands.build && typeof input.describeSourcePackage !== 'function') {
    throw new TypeError('Pulse provider JavaScript driver is missing describeSourcePackage().');
  }
  if (input.targetSupportPolicy !== undefined && !isRecord(input.targetSupportPolicy)) {
    throw new TypeError('Pulse provider JavaScript targetSupportPolicy must be an object.');
  }
  return Object.freeze({ ...input });
}

function normalizeEventDriver(input, targets) {
  if (input === undefined) return undefined;
  assertExactFields(input, EVENT_DRIVER_FIELDS, 'Pulse provider event driver');
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new TypeError('Pulse provider event driver targets must be a non-empty array.');
  }
  const normalizedTargets = [...new Set(input.targets.map((target) => nonEmpty(target, 'event driver target')))].sort();
  const unknownTargets = normalizedTargets.filter((target) => !['native', 'javascript'].includes(target));
  if (unknownTargets.length > 0) throw new TypeError(`Pulse provider event driver declares unknown targets: ${unknownTargets.join(', ')}.`);
  for (const target of normalizedTargets) {
    if (!targets[target] || !targets[target].commands.test) {
      throw new TypeError(`Pulse provider event driver target ${target} requires an implemented test command.`);
    }
  }
  if (typeof input.executeTestCase !== 'function') {
    throw new TypeError('Pulse provider event driver is missing executeTestCase().');
  }
  return Object.freeze({ targets: Object.freeze(normalizedTargets), executeTestCase: input.executeTestCase });
}

function defineProviderDriver(input, expected = {}) {
  assertExactFields(input, DRIVER_FIELDS, 'Pulse provider driver');
  if (input.version !== PROVIDER_DRIVER_VERSION) {
    throw new TypeError(`Pulse provider driver version must be ${PROVIDER_DRIVER_VERSION}.`);
  }
  const id = nonEmpty(input.id, 'driver id');
  if (expected.id && id !== expected.id) {
    throw new TypeError(`Pulse provider driver id mismatch: expected ${expected.id}, received ${id}.`);
  }
  for (const field of ['normalizeConfig', 'projectConfigDocument', 'initTemplate']) {
    if (typeof input[field] !== 'function') throw new TypeError(`Pulse provider driver ${id} is missing ${field}().`);
  }
  if (!isRecord(input.targets)) throw new TypeError(`Pulse provider driver ${id} is missing target descriptors.`);
  const unknownTargets = Object.keys(input.targets).filter((target) => !['native', 'javascript'].includes(target));
  if (unknownTargets.length > 0) throw new TypeError(`Pulse provider driver ${id} declares unknown targets: ${unknownTargets.join(', ')}.`);
  const targets = Object.freeze(Object.fromEntries(Object.entries(input.targets).map(([target, descriptor]) => [
    target,
    normalizeProviderTargetDescriptor(descriptor, { provider: id, target })
  ])));
  const executable = input.executable === true;
  if (executable && typeof input.createLoweringPlan !== 'function') {
    throw new TypeError(`Pulse provider driver ${id} is missing createLoweringPlan().`);
  }
  if (targets.native && targets.native.commands.inspect && typeof input.inspectRealization !== 'function') {
    throw new TypeError(`Pulse provider driver ${id} is missing inspectRealization().`);
  }
  if (targets.native && targets.native.commands.build && typeof input.writeTarget !== 'function') {
    throw new TypeError(`Pulse provider driver ${id} is missing writeTarget().`);
  }
  if ((targets.native && (targets.native.commands.test || targets.native.commands.dev)) && typeof input.execute !== 'function') {
    throw new TypeError(`Pulse provider driver ${id} is missing execute().`);
  }
  const descriptor = input.descriptor === undefined ? undefined : normalizeDescriptor(input.descriptor);
  if (descriptor && descriptor.id !== id) throw new TypeError(`Pulse provider driver ${id} descriptor identity does not match.`);
  const javascript = normalizeJavascriptDriver(input.javascript, targets.javascript);
  const events = normalizeEventDriver(input.events, targets);
  return Object.freeze({
    version: PROVIDER_DRIVER_VERSION,
    id,
    descriptor,
    executable,
    localExecution: input.localExecution === true,
    deployable: input.deployable === true,
    deploymentValidated: input.deploymentValidated === true,
    sourcePackage: input.sourcePackage === true,
    compiledWasm: input.compiledWasm === true,
    defaultBuildMode: nonEmpty(input.defaultBuildMode || 'compile-only', 'driver defaultBuildMode'),
    sourceOnlySupported: input.sourceOnlySupported === true,
    targetSupport: input.targetSupport === undefined ? undefined : dataClone(input.targetSupport, 'driver targetSupport'),
    normalizeConfig: input.normalizeConfig,
    defaultLocalNetworkFetch: input.defaultLocalNetworkFetch === true,
    projectConfigDocument: input.projectConfigDocument,
    configReference: input.configReference === undefined ? undefined : dataClone(input.configReference, 'driver configReference'),
    initTemplate: input.initTemplate,
    javascript,
    events,
    targets,
    execute: input.execute,
    createLoweringPlan: input.createLoweringPlan,
    inspectRealization: input.inspectRealization,
    writeTarget: input.writeTarget,
    executionOptions: input.executionOptions
  });
}

function assertProviderDriver(value, expected = {}) {
  return defineProviderDriver(value, expected);
}

function defineProviderToolchain(input) {
  assertExactFields(input, TOOLCHAIN_FIELDS, 'Pulse provider toolchain');
  if (input.version !== PROVIDER_TOOLCHAIN_VERSION) {
    throw new TypeError(`Pulse provider toolchain version must be ${PROVIDER_TOOLCHAIN_VERSION}.`);
  }
  if (typeof input.createDriver !== 'function') {
    throw new TypeError('Pulse provider toolchain createDriver must be a function.');
  }
  if (input.createDriver.length !== 0) {
    throw new TypeError('Pulse provider toolchain createDriver must receive no compiler service or caller option bag.');
  }
  return Object.freeze({
    version: PROVIDER_TOOLCHAIN_VERSION,
    id: nonEmpty(input.id, 'id'),
    packageName: nonEmpty(input.packageName, 'packageName'),
    packageVersion: nonEmpty(input.packageVersion, 'packageVersion'),
    createDriver: input.createDriver
  });
}

function assertProviderToolchain(value, expected = {}) {
  const toolchain = defineProviderToolchain(value);
  if (expected.packageName && toolchain.packageName !== expected.packageName) {
    throw new TypeError(`Pulse provider toolchain package mismatch: expected ${expected.packageName}, received ${toolchain.packageName}.`);
  }
  if (expected.id && toolchain.id !== expected.id) {
    throw new TypeError(`Pulse provider toolchain id mismatch: expected ${expected.id}, received ${toolchain.id}.`);
  }
  return toolchain;
}

function packagesForPlan(plan) {
  const entries = plan && plan.target === 'javascript'
    ? plan.packages || []
    : plan && plan.packages && plan.packages.effects || [];
  const records = new Map();
  for (const entry of entries) {
    const packageName = entry.packageName || entry.package;
    const contractId = entry.contractId;
    if (!packageName && !contractId) continue;
    const record = Object.freeze({
      packageName: packageName === undefined ? null : String(packageName),
      contractId: contractId === undefined ? null : String(contractId)
    });
    records.set(`${record.packageName || ''}\0${record.contractId || ''}`, record);
  }
  return Object.freeze([...records.values()].sort((left, right) => (
    String(left.packageName).localeCompare(String(right.packageName))
    || String(left.contractId).localeCompare(String(right.contractId))
  )));
}

function createProviderRequirements(input) {
  assertExactFields(input, ['version', 'capabilities', 'bindings', 'packages'], 'Pulse provider requirements');
  if (input.version !== PROVIDER_REQUIREMENTS_VERSION) {
    throw new TypeError(`Pulse provider requirements version must be ${PROVIDER_REQUIREMENTS_VERSION}.`);
  }
  if (!Array.isArray(input.capabilities)) throw new TypeError('Pulse provider requirements capabilities must be an array.');
  if (!Array.isArray(input.packages)) throw new TypeError('Pulse provider requirements packages must be an array.');
  return deepFreeze({
    version: PROVIDER_REQUIREMENTS_VERSION,
    capabilities: Object.freeze([...new Set(input.capabilities.map(String))].sort()),
    bindings: dataClone(input.bindings || {}, 'provider requirement bindings'),
    packages: dataClone(input.packages, 'provider package requirements')
  });
}

function createProviderPlanInput(input) {
  assertExactFields(input, ['version', 'capabilities', 'providerOperations', 'opaqueReturnCount'], 'Pulse provider plan input');
  if (input.version !== PROVIDER_PLAN_INPUT_VERSION) {
    throw new TypeError(`Pulse provider plan input version must be ${PROVIDER_PLAN_INPUT_VERSION}.`);
  }
  if (!Array.isArray(input.capabilities)) throw new TypeError('Pulse provider plan input capabilities must be an array.');
  if (!Array.isArray(input.providerOperations)) throw new TypeError('Pulse provider plan input providerOperations must be an array.');
  const opaqueReturnCount = Number(input.opaqueReturnCount || 0);
  if (!Number.isSafeInteger(opaqueReturnCount) || opaqueReturnCount < 0) {
    throw new TypeError('Pulse provider plan input opaqueReturnCount must be a non-negative integer.');
  }
  return deepFreeze({
    version: PROVIDER_PLAN_INPUT_VERSION,
    capabilities: Object.freeze([...new Set(input.capabilities.map(String))].sort()),
    providerOperations: dataClone(input.providerOperations, 'provider plan operations'),
    opaqueReturnCount
  });
}

function normalizeCanonicalProviderPlan(input, expected = {}) {
  assertExactFields(input, PROVIDER_PLAN_FIELDS, 'Pulse canonical provider plan');
  if (input.version !== CANONICAL_PROVIDER_PLAN_VERSION) {
    throw new TypeError(`Pulse canonical provider plan version must be ${CANONICAL_PROVIDER_PLAN_VERSION}.`);
  }
  if (input.contractVersion !== CANONICAL_PROVIDER_CONTRACT_VERSION) {
    throw new TypeError(`Pulse canonical provider plan contractVersion must be ${CANONICAL_PROVIDER_CONTRACT_VERSION}.`);
  }
  const provider = nonEmpty(input.provider, 'canonical provider plan provider');
  if (expected.provider && provider !== expected.provider) {
    throw new TypeError(`Pulse canonical provider plan provider mismatch: expected ${expected.provider}, received ${provider}.`);
  }
  if (!Array.isArray(input.requirements)) throw new TypeError('Pulse canonical provider plan requirements must be an array.');
  if (!isRecord(input.bindings)) throw new TypeError('Pulse canonical provider plan bindings must be an object.');
  if (!Array.isArray(input.operations)) throw new TypeError('Pulse canonical provider plan operations must be an array.');
  return dataClone(input, 'canonical provider plan');
}

function projectProviderRequirements(applicationPlan, providerPlan) {
  const plan = normalizeCanonicalProviderPlan(providerPlan);
  return createProviderRequirements({
    version: PROVIDER_REQUIREMENTS_VERSION,
    capabilities: plan.requirements,
    bindings: plan.bindings,
    packages: packagesForPlan(applicationPlan)
  });
}

function createProviderNativeArtifact(native) {
  if (!isRecord(native) || !Buffer.isBuffer(native.wasm) || !isRecord(native.manifest)) {
    throw new TypeError('Pulse provider Native artifact projection requires compiled Wasm and its manifest.');
  }
  const observedSha256 = sha256(native.wasm);
  if (!native.manifest.wasm || native.manifest.wasm.sha256 !== observedSha256) {
    throw new TypeError('Pulse provider Native artifact bytes do not match their manifest.');
  }
  let guestAudit = null;
  if (native.guestLink) {
    const audit = native.guestLink.audit;
    const packaging = native.guestLink.providerPackaging;
    const finalArtifact = native.guestLink.finalArtifact;
    if (!audit || audit.status !== 'passed' || !audit.artifact || audit.artifact.sha256 !== observedSha256) {
      throw new TypeError('Pulse provider Native artifact does not match the final guest-link audit.');
    }
    if (!packaging || packaging.authorized !== true || !finalArtifact || finalArtifact.sha256 !== observedSha256) {
      throw new TypeError('Pulse provider Native artifact is not authorized for provider packaging.');
    }
    guestAudit = dataClone({ audit, finalArtifact, providerPackaging: packaging }, 'provider Native guest audit');
  }
  return deepFreeze({
    version: PROVIDER_NATIVE_ARTIFACT_VERSION,
    compilerVersion: nonEmpty(native.compilerVersion, 'Native artifact compilerVersion'),
    wasm: Buffer.from(native.wasm),
    wat: String(native.wat || ''),
    manifest: dataClone({
      compilerVersion: native.manifest.compilerVersion,
      assemblyScript: native.manifest.assemblyScript,
      optimization: native.manifest.optimization,
      wasm: native.manifest.wasm,
      wat: native.manifest.wat,
      importModules: native.manifest.importModules,
      imports: native.manifest.imports,
      exports: native.manifest.exports,
      packageRealizationArtifacts: native.manifest.packageRealizationArtifacts,
      crypto: native.manifest.crypto,
      policy: native.manifest.policy
    }, 'provider Native manifest'),
    realizationArtifacts: dataClone(native.realizationArtifacts || [], 'provider Native realization artifacts'),
    guestUnits: dataClone(native.guestUnits || [], 'provider Native guest units'),
    guestAudit,
    finalArtifact: Object.freeze({
      bytes: native.wasm.byteLength,
      sha256: observedSha256,
      magic: native.manifest.wasm.magic
    })
  });
}

function assertProviderNativeArtifact(input) {
  assertExactFields(input, NATIVE_ARTIFACT_FIELDS, 'Pulse provider Native artifact');
  if (input.version !== PROVIDER_NATIVE_ARTIFACT_VERSION) {
    throw new TypeError(`Pulse provider Native artifact version must be ${PROVIDER_NATIVE_ARTIFACT_VERSION}.`);
  }
  assertDeepFrozen(input, 'Pulse provider Native artifact');
  if (!Buffer.isBuffer(input.wasm) || !isRecord(input.manifest) || !isRecord(input.finalArtifact)) {
    throw new TypeError('Pulse provider Native artifact requires exact Wasm, manifest, and finalArtifact values.');
  }
  const observedSha256 = sha256(input.wasm);
  if (
    !input.manifest.wasm
    || input.manifest.wasm.sha256 !== observedSha256
    || input.finalArtifact.sha256 !== observedSha256
    || input.finalArtifact.bytes !== input.wasm.byteLength
  ) {
    throw new TypeError('Pulse provider Native artifact identity does not match its exact bytes.');
  }
  if (input.guestAudit) {
    const audit = input.guestAudit.audit;
    const finalArtifact = input.guestAudit.finalArtifact;
    const packaging = input.guestAudit.providerPackaging;
    if (
      !audit
      || audit.status !== 'passed'
      || !audit.artifact
      || audit.artifact.sha256 !== observedSha256
      || !finalArtifact
      || finalArtifact.sha256 !== observedSha256
      || !packaging
      || packaging.authorized !== true
    ) {
      throw new TypeError('Pulse provider Native artifact is not the exact guest-audited packaging artifact.');
    }
  }
  return input;
}

function normalizeProject(input, action) {
  assertExactFields(input, ['root', 'outDir', 'profile'], 'Pulse provider invocation project');
  return Object.freeze({
    root: nonEmpty(input.root, 'invocation project root'),
    outDir: action === 'write-native' || action === 'write-javascript'
      ? nonEmpty(input.outDir, 'invocation output directory')
      : null,
    profile: nonEmpty(input.profile, 'invocation profile')
  });
}

function createProviderTargetInvocation(input) {
  assertExactFields(input, INVOCATION_FIELDS, 'Pulse provider target invocation');
  if (input.version !== PROVIDER_TARGET_INVOCATION_VERSION) {
    throw new TypeError(`Pulse provider target invocation version must be ${PROVIDER_TARGET_INVOCATION_VERSION}.`);
  }
  const action = nonEmpty(input.action, 'invocation action');
  if (!['inspect-native', 'write-native', 'write-javascript'].includes(action)) {
    throw new TypeError(`Pulse provider target invocation action ${action} is unsupported.`);
  }
  const target = action.endsWith('javascript') ? 'javascript' : 'native';
  const provider = nonEmpty(input.provider, 'invocation provider');
  const selectedTarget = normalizeProviderTargetDescriptor(input.selectedTarget, { provider, target });
  const expectedPlanVersion = target === 'native' ? CANONICAL_NATIVE_PLAN_VERSION : JAVASCRIPT_APPLICATION_PLAN_VERSION;
  if (!input.applicationPlan || input.applicationPlan.version !== expectedPlanVersion) {
    throw new TypeError(`Pulse provider ${target} invocation requires ${expectedPlanVersion}.`);
  }
  const applicationPlan = dataClone(input.applicationPlan, `canonical ${target} application plan`);
  const providerPlan = normalizeCanonicalProviderPlan(input.providerPlan, { provider });
  const requirements = createProviderRequirements(input.requirements);
  const projectedRequirements = projectProviderRequirements(applicationPlan, providerPlan);
  if (JSON.stringify(requirements) !== JSON.stringify(projectedRequirements)) {
    throw new TypeError('Pulse provider invocation requirements do not match its canonical plans.');
  }
  const projected = {
    version: PROVIDER_TARGET_INVOCATION_VERSION,
    action,
    provider,
    selectedTarget,
    applicationPlan,
    providerPlan,
    providerConfig: dataClone(input.providerConfig || {}, 'normalized provider config'),
    requirements,
    nativeArtifact: target === 'native' ? input.nativeArtifact : null,
    javascript: target === 'javascript' ? dataClone(input.javascript || {}, 'provider JavaScript package facts') : null,
    project: normalizeProject(input.project, action),
    synchronizedPackages: dataClone(input.synchronizedPackages || [], 'synchronized provider packages'),
    optimization: input.optimization === undefined ? null : dataClone(input.optimization, 'provider optimization posture'),
    timeoutMs: input.timeoutMs === undefined ? null : Number(input.timeoutMs)
  };
  if (target === 'native') {
    projected.nativeArtifact = assertProviderNativeArtifact(input.nativeArtifact);
  }
  return deepFreeze(projected);
}

function fileRecord(input) {
  if (input === undefined || input === null) return Object.freeze({});
  if (!isRecord(input)) throw new TypeError('Pulse provider target result files must be an object.');
  return Object.freeze(Object.fromEntries(Object.keys(input).sort()
    .filter((key) => input[key] !== undefined && input[key] !== null)
    .map((key) => [key, nonEmpty(input[key], `target result file ${key}`)])));
}

function packagingAudit(input) {
  if (input === undefined || input === null) return null;
  assertExactFields(input, ['version', 'artifactSha256', 'auditedSha256', 'authorized'], 'Pulse provider packaging audit');
  if (input.version !== PROVIDER_PACKAGING_AUDIT_VERSION) {
    throw new TypeError(`Pulse provider packaging audit version must be ${PROVIDER_PACKAGING_AUDIT_VERSION}.`);
  }
  const artifactSha256 = nonEmpty(input.artifactSha256, 'packaging artifactSha256');
  const auditedSha256 = nonEmpty(input.auditedSha256, 'packaging auditedSha256');
  if (input.authorized !== true || artifactSha256 !== auditedSha256) {
    throw new TypeError('Pulse provider packaged bytes do not match the authorized final guest audit.');
  }
  return Object.freeze({ version: PROVIDER_PACKAGING_AUDIT_VERSION, artifactSha256, auditedSha256, authorized: true });
}

function normalizeProviderTargetResult(input, expected = {}) {
  assertExactFields(input, RESULT_FIELDS, 'Pulse provider target result');
  if (input.version !== PROVIDER_TARGET_RESULT_VERSION) {
    throw new TypeError(`Pulse provider target result version must be ${PROVIDER_TARGET_RESULT_VERSION}.`);
  }
  const action = nonEmpty(input.action, 'target result action');
  const provider = nonEmpty(input.provider, 'target result provider');
  const target = nonEmpty(input.target, 'target result target');
  if (expected.action && action !== expected.action) throw new TypeError(`Pulse provider target result action mismatch: expected ${expected.action}.`);
  if (expected.provider && provider !== expected.provider) throw new TypeError(`Pulse provider target result provider mismatch: expected ${expected.provider}.`);
  if (expected.target && target !== expected.target) throw new TypeError(`Pulse provider target result target mismatch: expected ${expected.target}.`);
  if (input.automaticFallback !== false) throw new TypeError('Pulse provider target result must disable automatic fallback.');
  if (input.build !== null && input.build !== undefined && !isRecord(input.build)) throw new TypeError('Pulse provider target result build must be an object or null.');
  if (input.realization !== null && input.realization !== undefined && !isRecord(input.realization)) throw new TypeError('Pulse provider target result realization must be an object or null.');
  return deepFreeze({
    version: PROVIDER_TARGET_RESULT_VERSION,
    action,
    provider,
    target,
    status: nonEmpty(input.status, 'target result status'),
    automaticFallback: false,
    files: fileRecord(input.files),
    build: input.build == null ? null : dataClone(input.build, 'provider build result'),
    realization: input.realization == null ? null : dataClone(input.realization, 'provider realization result'),
    packaging: packagingAudit(input.packaging)
  });
}

function normalizeProviderJavascriptPackageResult(input, expected = {}) {
  assertExactFields(input, JAVASCRIPT_PACKAGE_FIELDS, 'Pulse provider JavaScript package result');
  const sourcePackageVersion = nonEmpty(input.version, 'JavaScript source package version');
  if (!isRecord(input.manifest) || input.manifest.version !== sourcePackageVersion) {
    throw new TypeError('Pulse provider JavaScript package manifest must match its versioned result.');
  }
  if (!Array.isArray(input.files)) throw new TypeError('Pulse provider JavaScript package result files must be an array.');
  const paths = Object.freeze({
    entry: nonEmpty(input.entryFile, 'JavaScript package entryFile'),
    package: nonEmpty(input.packageFile, 'JavaScript package packageFile'),
    applicationPlan: nonEmpty(input.applicationPlanFile, 'JavaScript package applicationPlanFile'),
    manifest: nonEmpty(input.manifestFile, 'JavaScript package manifestFile'),
    ...(input.bundledApplicationFile ? { bundledApplication: nonEmpty(input.bundledApplicationFile, 'JavaScript package bundledApplicationFile') } : {}),
    ...(input.deploymentFile ? { deployment: nonEmpty(input.deploymentFile, 'JavaScript package deploymentFile') } : {}),
    ...(input.deploymentCandidateFile ? { deploymentCandidate: nonEmpty(input.deploymentCandidateFile, 'JavaScript package deploymentCandidateFile') } : {}),
    ...(input.buildConfigFile ? { buildConfig: nonEmpty(input.buildConfigFile, 'JavaScript package buildConfigFile') } : {}),
    ...(input.fastlyTomlFile ? { fastlyToml: nonEmpty(input.fastlyTomlFile, 'JavaScript package fastlyTomlFile') } : {}),
    ...(input.schemaRegistryFile ? { schemaRegistry: nonEmpty(input.schemaRegistryFile, 'JavaScript package schemaRegistryFile') } : {}),
    ...(input.schemaCodecsFile ? { schemaCodecs: nonEmpty(input.schemaCodecsFile, 'JavaScript package schemaCodecsFile') } : {})
  });
  return deepFreeze({
    version: PROVIDER_JAVASCRIPT_PACKAGE_RESULT_VERSION,
    provider: nonEmpty(expected.provider, 'JavaScript package provider'),
    target: 'javascript',
    sourcePackageVersion,
    outDir: nonEmpty(input.outDir, 'JavaScript package outDir'),
    paths,
    manifest: dataClone(input.manifest, 'provider JavaScript package manifest'),
    fileRecords: dataClone(input.files, 'provider JavaScript package file records'),
    automaticFallback: false
  });
}

module.exports = Object.freeze({
  PROVIDER_TOOLCHAIN_VERSION,
  PROVIDER_DRIVER_VERSION,
  PROVIDER_TARGET_DESCRIPTOR_VERSION,
  PROVIDER_TARGET_INVOCATION_VERSION,
  PROVIDER_TARGET_RESULT_VERSION,
  PROVIDER_REQUIREMENTS_VERSION,
  PROVIDER_NATIVE_ARTIFACT_VERSION,
  PROVIDER_PACKAGING_AUDIT_VERSION,
  PROVIDER_JAVASCRIPT_PACKAGE_RESULT_VERSION,
  PROVIDER_PLAN_INPUT_VERSION,
  defineProviderToolchain,
  assertProviderToolchain,
  defineProviderDriver,
  assertProviderDriver,
  normalizeProviderTargetDescriptor,
  createProviderRequirements,
  createProviderPlanInput,
  projectProviderRequirements,
  createProviderNativeArtifact,
  assertProviderNativeArtifact,
  createProviderTargetInvocation,
  normalizeProviderTargetResult,
  normalizeProviderJavascriptPackageResult
});
