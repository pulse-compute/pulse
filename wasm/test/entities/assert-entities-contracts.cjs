#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const contracts = require('../../packages/contracts/src/entities/contracts.js');
const runtimeContracts = require('../../packages/contracts/src/entities/runtime.js');
const jsonRpc = require('../../packages/contracts/src/entities/json-rpc.js');
const catalog = require('../../packages/contracts/src/entities/catalog.js');
const packageContracts = require('../../packages/contracts/src/package/package-contract.js');
const contractsRoot = require('../../packages/contracts/src/index.js');

function expectCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code, `expected ${code}`);
}

assert.deepEqual({
  package: contracts.ENTITIES_PACKAGE_VERSION,
  contract: contracts.ENTITIES_CONTRACT_VERSION,
  adapter: contracts.ENTITIES_ADAPTER_VERSION,
  jsonRpc: jsonRpc.ENTITIES_JSON_RPC_ADAPTER_VERSION,
  plan: contracts.ENTITIES_PLAN_VERSION,
  catalog: contracts.ENTITIES_CATALOG_VERSION,
  failure: contracts.ENTITIES_FAILURE_VERSION,
  diagnostics: contracts.ENTITIES_DIAGNOSTIC_VERSION,
  registry: contracts.ENTITIES_REGISTRY_VERSION,
  handlerReference: contracts.ENTITIES_HANDLER_REFERENCE_VERSION,
  packageIntrinsic: contracts.ENTITIES_PACKAGE_INTRINSIC_VERSION
}, {
  package: 'pulse.entities-package.v1',
  contract: 'pulse.entities-contract.v1',
  adapter: 'pulse.entities-adapter.v1',
  jsonRpc: 'pulse.entities-json-rpc-adapter.v1',
  plan: 'pulse.entities-lowering-plan.v1',
  catalog: 'pulse.entities-catalog.v1',
  failure: 'pulse.entities-failure.v1',
  diagnostics: 'pulse.entities-diagnostics.v1',
  registry: 'pulse.entities-registry.v1',
  handlerReference: 'pulse.entities-handler-reference.v1',
  packageIntrinsic: 'pulse.package-intrinsic.v1'
});
assert.equal(contracts.ENTITIES_CONTRACT_ID, 'pulse.entities');
assert.equal(contracts.ENTITIES_PACKAGE_NAME, '@pulse-compute/entities');
assert.equal(contracts.ENTITIES_LOWERER_ID, 'pulse.entities.compiler-builder.v1');
assert.equal(contracts.ENTITIES_LOWERER_EXPORT, 'createEntitiesPackageCompilerBuilder');
assert.equal(contracts.ENTITIES_LOWERER_MANIFEST, './pulsewasm.manifest.cjs');
assert.deepEqual(contracts.ENTITIES_PUBLIC_SYMBOLS, ['EntityRouter', 'jsonRpc']);
assert.deepEqual(contracts.ENTITIES_PACKAGE_INTRINSICS, {
  handle: {
    name: 'pulse.entities.handle.v1',
    compilerName: '__pulse_entities_handle',
    valueKind: 'response',
    argumentIndexes: [0]
  }
});
assert.equal(contractsRoot.entitiesContracts, contracts);
assert.equal(contractsRoot.entitiesRuntime, runtimeContracts);
assert.equal(contractsRoot.entitiesJsonRpc, jsonRpc);
assert.equal(contractsRoot.entitiesCatalog, catalog);
assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, 'wasm/packages/contracts/src/entities/runtime.js'), 'utf8'), /node:crypto|require\(['"]crypto['"]\)|Buffer\./);
for (const source of ['entity-router.ts', 'adapters/json-rpc.ts']) {
  const publicSource = fs.readFileSync(path.join(repoRoot, 'packages/entities/src', source), 'utf8');
  assert.match(publicSource, /@pulse-compute\/wasm-contracts\/entities\/runtime/);
  assert.doesNotMatch(publicSource, /@pulse-compute\/wasm-contracts\/entities\/contracts|node:crypto|Buffer\./);
}

const defaults = contracts.normalizeEntityLimits();
assert.deepEqual(defaults, contracts.ENTITIES_DEFAULT_LIMITS);
assert.equal(Object.isFrozen(defaults), true);
expectCode(() => contracts.normalizeEntityLimits({ maxEnvelopeBytes: 0 }), 'PULSE_ENTITIES_LIMIT_INVALID');
expectCode(() => contracts.normalizeEntityLimits({ maxEnvelopeBytes: 10, maxPayloadBytes: 11 }), 'PULSE_ENTITIES_LIMIT_INVALID');
expectCode(() => contracts.normalizeEntityLimits({ unknown: 1 }), 'PULSE_ENTITIES_LIMIT_INVALID');

assert.equal(contracts.normalizeDiscriminator('customer.lookup'), 'customer.lookup');
assert.equal(contracts.normalizeDiscriminator('東京.lookup'), '東京.lookup');
expectCode(() => contracts.normalizeDiscriminator(''), 'PULSE_ENTITIES_DISCRIMINATOR_INVALID');
expectCode(() => contracts.normalizeDiscriminator('éé', { ...defaults, maxMethodBytes: 3 }), 'PULSE_ENTITIES_DISCRIMINATOR_INVALID');
assert.equal(contracts.normalizeSchemaId('tools.CustomerLookupInput'), 'tools.CustomerLookupInput');
assert.equal(contracts.normalizeSchemaId(null), null);
expectCode(() => contracts.normalizeSchemaId('CustomerLookupInput'), 'PULSE_ENTITIES_SCHEMA_ID_INVALID');

const metadata = contracts.normalizeStaticMetadata({
  z: ['read', { nested: true }],
  a: { title: 'Lookup', score: 1.5, optional: null }
});
assert.deepEqual(Object.keys(metadata), ['a', 'z']);
assert.deepEqual(Object.keys(metadata.a), ['optional', 'score', 'title']);
assert.equal(Object.isFrozen(metadata), true);
assert.equal(Object.isFrozen(metadata.a), true);
assert.equal(Object.isFrozen(metadata.z), true);
assert.equal(Object.isFrozen(metadata.z[1]), true);
expectCode(() => contracts.normalizeStaticMetadata({ value: Number.NaN }), 'PULSE_ENTITIES_METADATA_INVALID');
expectCode(() => contracts.normalizeStaticMetadata({ value: 1n }), 'PULSE_ENTITIES_METADATA_INVALID');
const cyclic = {};
cyclic.self = cyclic;
expectCode(() => contracts.normalizeStaticMetadata(cyclic), 'PULSE_ENTITIES_METADATA_INVALID');
const accessor = {};
Object.defineProperty(accessor, 'secret', { enumerable: true, get() { return 'hidden'; } });
expectCode(() => contracts.normalizeStaticMetadata(accessor), 'PULSE_ENTITIES_METADATA_INVALID');

const declaration = contracts.normalizeEntityDeclaration({
  output: 'tools.CustomerLookupOutput',
  input: 'tools.CustomerLookupInput',
  metadata: { title: 'Lookup' }
});
assert.deepEqual(declaration, {
  input: 'tools.CustomerLookupInput',
  output: 'tools.CustomerLookupOutput',
  metadata: { title: 'Lookup' }
});
expectCode(() => contracts.normalizeEntityDeclaration({ input: null }), 'PULSE_ENTITIES_DECLARATION_INVALID');
expectCode(() => contracts.normalizeEntityDeclaration({ input: null, output: null, extra: true }), 'PULSE_ENTITIES_DECLARATION_INVALID');

function betaHandler() {}
function alphaHandler() {}
const alpha = {
  discriminator: 'alpha.call',
  declaration: { input: null, output: 'tools.CustomerLookupOutput', metadata: { order: 1 } },
  handler: alphaHandler
};
const beta = {
  discriminator: 'beta.call',
  declaration: { input: 'tools.CustomerLookupInput', output: null, metadata: { order: 2 } },
  handler: betaHandler
};
const registry = contracts.normalizeEntityRegistry([beta, alpha]);
const reordered = contracts.normalizeEntityRegistry([alpha, beta]);
assert.deepEqual(registry.entries.map((entry) => entry.discriminator), ['alpha.call', 'beta.call']);
assert.equal(registry.registryHash, reordered.registryHash);
assert.match(registry.registryHash, /^[a-f0-9]{64}$/);
expectCode(() => contracts.normalizeEntityRegistry([alpha, alpha]), 'PULSE_ENTITIES_DISCRIMINATOR_DUPLICATE');
const anonymousHandler = () => {};
Object.defineProperty(anonymousHandler, 'name', { value: '' });
expectCode(() => contracts.normalizeEntityRegistration({
  discriminator: 'anonymous.call',
  declaration: { input: null, output: null },
  handler: anonymousHandler
}), 'PULSE_ENTITIES_HANDLER_INVALID');

assert.deepEqual(contracts.normalizeHandlerReference({
  file: 'src/entities.ts',
  exportName: 'lookupCustomer'
}), {
  version: 'pulse.entities-handler-reference.v1',
  file: 'src/entities.ts',
  exportName: 'lookupCustomer',
  localName: 'lookupCustomer'
});
expectCode(() => contracts.normalizeHandlerReference({ file: '../escape.ts', exportName: 'handler' }), 'PULSE_ENTITIES_HANDLER_UNRESOLVED');

const adapter = jsonRpc.createJsonRpcAdapter({ acceptEmptyObjectForNoInput: true });
assert.deepEqual(adapter.options, { namedParamsOnly: true, acceptEmptyObjectForNoInput: true });
assert.deepEqual(contracts.normalizeAdapter(adapter), adapter);
expectCode(() => jsonRpc.normalizeJsonRpcOptions({ namedParamsOnly: false }), 'PULSE_ENTITIES_ADAPTER_OPTIONS_INVALID');
expectCode(() => jsonRpc.normalizeJsonRpcOptions({ batch: true }), 'PULSE_ENTITIES_ADAPTER_OPTIONS_INVALID');
assert.deepEqual(jsonRpc.normalizeJsonRpcId('request-1'), { kind: 'string', value: 'request-1' });
assert.deepEqual(jsonRpc.normalizeJsonRpcId(7), { kind: 'number', value: 7 });
assert.deepEqual(jsonRpc.normalizeJsonRpcId(null), { kind: 'null', value: null });
assert.deepEqual(jsonRpc.normalizeJsonRpcId(undefined, false), { kind: 'absent', value: undefined });
expectCode(() => jsonRpc.normalizeJsonRpcId(1.5), 'PULSE_ENTITIES_DECLARATION_INVALID');
expectCode(() => jsonRpc.normalizeJsonRpcId(Number.MAX_SAFE_INTEGER + 1), 'PULSE_ENTITIES_DECLARATION_INVALID');

const failure = contracts.normalizeEntityFailure({ kind: 'unknown-entity', message: 'Unknown entity.' });
assert.deepEqual(failure, {
  version: 'pulse.entities-failure.v1',
  kind: 'unknown-entity',
  code: 'PULSE_ENTITIES_UNKNOWN_ENTITY',
  message: 'Unknown entity.'
});
assert.deepEqual(jsonRpc.mapEntitiesFailureToJsonRpc(failure), { code: -32601, message: 'Method not found' });
expectCode(() => contracts.normalizeEntityFailure({ kind: 'unknown-entity', message: 'x'.repeat(257) }), 'PULSE_ENTITIES_LIMIT_EXCEEDED');

function planInput(entities) {
  return {
    version: contracts.ENTITIES_PLAN_VERSION,
    contractId: contracts.ENTITIES_CONTRACT_ID,
    routers: [{ id: 'rpc', adapter, binding: { kind: 'request' }, entities }]
  };
}
const planAlpha = {
  discriminator: 'alpha.call',
  inputSchema: null,
  outputSchema: 'tools.CustomerLookupOutput',
  handler: { file: 'src/entities.ts', exportName: 'alphaHandler' },
  metadata: { title: 'Alpha' }
};
const planBeta = {
  discriminator: 'beta.call',
  inputSchema: 'tools.CustomerLookupInput',
  outputSchema: null,
  handler: { file: 'src/entities.ts', exportName: 'betaHandler' }
};
const plan = contracts.normalizeEntityPlan(planInput([planBeta, planAlpha]));
const planReordered = contracts.normalizeEntityPlan(planInput([planAlpha, planBeta]));
assert.equal(plan.planHash, planReordered.planHash);
assert.deepEqual(plan.routers[0].entities.map((entry) => entry.discriminator), ['alpha.call', 'beta.call']);
assert.match(plan.planHash, /^[a-f0-9]{64}$/);

function catalogInput(entities) {
  return {
    version: contracts.ENTITIES_CATALOG_VERSION,
    contractId: contracts.ENTITIES_CONTRACT_ID,
    routers: [{ id: 'rpc', adapter: 'json-rpc', binding: 'request', entities }]
  };
}
const catalogAlpha = {
  name: 'alpha.call',
  inputSchema: null,
  outputSchema: 'tools.CustomerLookupOutput',
  metadata: { title: 'Alpha' },
  eligibility: { 'node-javascript': true, 'node-native': false }
};
const catalogBeta = {
  name: 'beta.call',
  inputSchema: 'tools.CustomerLookupInput',
  outputSchema: null,
  eligibility: { 'fastly-javascript': true }
};
const normalizedCatalog = catalog.normalizeEntityCatalog(catalogInput([catalogBeta, catalogAlpha]));
const reorderedCatalog = catalog.normalizeEntityCatalog(catalogInput([catalogAlpha, catalogBeta]));
assert.equal(normalizedCatalog.catalogHash, reorderedCatalog.catalogHash);
assert.deepEqual(normalizedCatalog.routers[0].entities.map((entry) => entry.name), ['alpha.call', 'beta.call']);
assert.deepEqual(Object.keys(normalizedCatalog.routers[0].entities[0].eligibility), catalog.ENTITIES_CATALOG_TARGETS);

const packageRoot = path.join(repoRoot, 'packages/entities');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const pulsePackage = JSON.parse(fs.readFileSync(path.join(packageRoot, 'pulse.package.json'), 'utf8'));
assert.equal(packageJson.name, '@pulse-compute/entities');
assert.equal(packageJson.version, '1.0.0-beta.1');
assert.deepEqual(Object.keys(packageJson.exports), ['.', './pulsewasm/manifest', './pulsewasm/compiler', './pulsewasm-native']);
assert.deepEqual(packageJson.pulsewasm, { manifest: './pulsewasm.manifest.cjs' });
assert.deepEqual(packageJson.files, ['dist', 'README.md', 'pulse.package.json', 'pulsewasm.manifest.cjs', 'pulsewasm.compiler.cjs', 'pulsewasm.native.cjs', 'as', 'conformance']);
assert.equal(fs.existsSync(path.join(packageRoot, 'pulsewasm.manifest.cjs')), true);
assert.equal(fs.existsSync(path.join(packageRoot, 'pulsewasm.compiler.cjs')), true);
assert.equal(fs.existsSync(path.join(packageRoot, 'pulsewasm.native.cjs')), true);
assert.equal(fs.existsSync(path.join(packageRoot, 'as/index.as.ts')), true);
const normalizedPackage = packageContracts.normalizePackageContract(pulsePackage);
assert.equal(normalizedPackage.contractId, 'pulse.entities');
assert.equal(normalizedPackage.targets.native.status, 'provider-dependent');
assert.equal(normalizedPackage.targets.javascript.status, 'supported');
assert.equal(normalizedPackage.conformance.status, 'target-overlap');
assert.equal(fs.existsSync(path.join(packageRoot, 'conformance/i9.json')), true);
assert.equal(normalizedPackage.lowering.manifest, './pulsewasm.manifest.cjs');
assert.deepEqual(normalizedPackage.authoring.symbols, ['EntityRouter', 'jsonRpc']);

const diagnostics = Object.values(contracts.ENTITIES_DIAGNOSTIC_CODES);
assert.equal(new Set(diagnostics).size, diagnostics.length);
assert.ok(diagnostics.every((code) => /^PULSE_ENTITIES_[A-Z0-9_]+$/.test(code)));

console.log(JSON.stringify({
  version: contracts.ENTITIES_CONTRACT_VERSION,
  registryHash: registry.registryHash,
  planHash: plan.planHash,
  catalogHash: normalizedCatalog.catalogHash,
  diagnostics: diagnostics.length,
  packageExports: Object.keys(packageJson.exports),
  executableLowererInstalled: true,
  releaseAssigned: false
}));
console.log('ok - Entities versions, normalizers, declaration registry, plan/catalog identities, trusted lowerer, and package-owned Native source entry are singular and bounded');
