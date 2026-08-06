#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
process.chdir(repoRoot);

const entitiesContracts = require('../../packages/contracts/src/entities/contracts.js');
const manifestContracts = require('../../packages/contracts/src/library/manifest.js');
const packageContracts = require('../../packages/contracts/src/package/package-contract.js');
const entitiesManifest = require('../../../packages/entities/pulsewasm.manifest.cjs');
const entitiesLowerer = require('../../../packages/entities/pulsewasm.compiler.cjs');
const {
  discoverLowerableLibraryManifests,
  loadLowerableCompilerBuilder
} = require('../../packages/library-kit/src/compiler/handler-library-contracts.js');
const {
  buildPackageOwnedLoweringPlan
} = require('../../packages/library-kit/src/compiler/package-lowering.js');
const {
  recognizeProjectPackageOperations
} = require('../../packages/compiler/src/spine/package-operation-seam.js');

function schemaBundle(ids = ['tools.LookupInput', 'tools.LookupOutput']) {
  return {
    declaredSchemaIds: ids,
    schemaIds: ids,
    registry: { schemas: ids.map((id) => ({ id })) }
  };
}

function source(registrations = `
rpc.on('customer.lookup', {
  input: 'tools.LookupInput',
  output: 'tools.LookupOutput',
  metadata: { z: ['read'], a: { title: 'Lookup', stable: true } },
}, lookup)
rpc.on('system.ping', { input: null, output: null }, ping)
`) {
  return `import { EntityRouter as Router, jsonRpc as makeJsonRpc } from '@pulse-compute/entities'
import { lookupCustomer as lookup } from './handlers.js'
const ping = () => undefined
const rpc = new Router({
  adapter: makeJsonRpc({ namedParamsOnly: true, acceptEmptyObjectForNoInput: true }),
})
${registrations}
export default async function handler(ctx) {
  return rpc.handle(ctx)
}
`;
}

function build(input = source(), extra = {}) {
  return entitiesLowerer.createEntitiesPackageCompilerBuilder({
    cwd: repoRoot,
    sourcePath: 'src/entities.ts',
    sourceText: input,
    schemaBundle: schemaBundle(),
    ...extra
  });
}

function expectCode(input, code, extra = {}) {
  const result = build(input, extra);
  assert.equal(result.artifact.status, 'error', `expected ${code}`);
  assert.ok(
    result.diagnostics.some((entry) => entry.code === code),
    `expected ${code}; got ${result.diagnostics.map((entry) => entry.code).join(', ')}`
  );
  return result;
}

const manifestValidation = manifestContracts.validateLowerableLibraryManifest(entitiesManifest);
assert.equal(manifestValidation.status, 'ok');
assert.equal(entitiesManifest.contractId, entitiesContracts.ENTITIES_CONTRACT_ID);
assert.equal(entitiesManifest.npmPackage, entitiesContracts.ENTITIES_PACKAGE_NAME);
assert.equal(entitiesManifest.lowerableSubpath, entitiesContracts.ENTITIES_LOWERABLE_SUBPATH);
assert.equal(entitiesManifest.compiler.export, entitiesContracts.ENTITIES_LOWERER_EXPORT);
assert.equal(entitiesManifest.compiler.trust, 'first-party');
assert.equal(entitiesManifest.modes.wasm.mode, 'implemented-now');
assert.equal(entitiesManifest.modes.wasm.sidecarStatus, 'implemented-now');
assert.deepEqual(entitiesManifest.modes.wasm.sourceContribution, {
  entry: './pulsewasm.native.cjs',
  export: 'buildEntitiesNativeSource',
  id: 'pulse-entities-native-as',
  language: 'assemblyscript',
  semanticOwner: '@pulse-compute/entities',
  providerAuthority: ['request', 'effect-execution', 'logging', 'response-transport']
});
assert.equal(entitiesManifest.policy.nativeDispatcherImplemented, true);
assert.equal(entitiesManifest.policy.nativeSourceGeneratorImplemented, true);
assert.equal(entitiesManifest.policy.javascriptDispatcherImplemented, true);
assert.equal(entitiesManifest.policy.packageTargetPromoted, true);
assert.equal(entitiesManifest.policy.automaticFallback, false);
assert.equal(fs.existsSync(path.join(repoRoot, 'packages/entities/as/index.as.ts')), true);
assert.equal(fs.existsSync(path.join(repoRoot, 'packages/entities/pulsewasm.native.cjs')), true);

const product = packageContracts.normalizePackageContract(JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'packages/entities/pulse.package.json'), 'utf8')
));
assert.equal(product.targets.native.status, 'provider-dependent');
assert.equal(product.targets.javascript.status, 'supported');
assert.deepEqual(product.targets.native.providerRequirements, ['effect-execution', 'logging', 'request', 'response-transport']);
assert.deepEqual(product.targets.javascript.providerRequirements, ['effect-execution', 'logging', 'request', 'response-transport']);

const direct = build();
assert.equal(direct.artifact.status, 'ok');
assert.equal(direct.hasErrors, false);
assert.equal(direct.canonicalEffects.length, 0);
assert.equal(direct.canonicalIntrinsics.length, 1);
assert.equal(direct.schemaReferences.length, 2);
assert.deepEqual(direct.realizationArtifacts, [{
  version: 'pulse.entities-native-builder-descriptor.v1',
  id: 'pulse-entities-native-as',
  contractId: 'pulse.entities',
  package: '@pulse-compute/entities',
  kind: 'package-native-source-builder',
  mediaType: 'application/vnd.pulse.entities-native-builder+json',
  data: {
    entry: './pulsewasm.native.cjs',
    export: 'buildEntitiesNativeSource',
    sourceVersion: 'pulse.entities-native-source.v1',
    managedHandlerNativeBundleVersion: 'pulse.managed-handler-native-bundle.v1',
    packageTargetPromoted: true,
    automaticFallback: false
  }
}]);
assert.deepEqual(direct.artifact.plan.routers.map((entry) => entry.id), ['rpc']);
assert.deepEqual(direct.artifact.plan.routers[0].entities.map((entry) => entry.discriminator), [
  'customer.lookup',
  'system.ping'
]);
assert.deepEqual(direct.artifact.plan.routers[0].entities[0].handler, {
  version: 'pulse.entities-handler-reference.v1',
  file: 'src/handlers.js',
  exportName: 'lookupCustomer',
  localName: 'lookup'
});
assert.deepEqual(direct.artifact.plan.routers[0].entities[1].handler, {
  version: 'pulse.entities-handler-reference.v1',
  file: 'src/entities.ts',
  exportName: 'ping',
  localName: 'ping'
});
assert.deepEqual(Object.keys(direct.artifact.plan.routers[0].entities[0].metadata), ['a', 'z']);
assert.match(direct.artifact.plan.planHash, /^[a-f0-9]{64}$/);
assert.match(direct.artifact.catalog.catalogHash, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(direct.artifact.plan), true);
assert.equal(Object.isFrozen(direct.artifact.catalog), true);
assert.deepEqual(direct.schemaReferences.map((entry) => [entry.id, entry.usage, entry.capability]), [
  ['tools.LookupInput', 'entity-input', 'schema.decode'],
  ['tools.LookupOutput', 'entity-output', 'schema.encode']
]);
assert.deepEqual(direct.canonicalIntrinsics[0], {
  version: 'pulse.package-intrinsic.v1',
  contractId: 'pulse.entities',
  package: '@pulse-compute/entities',
  import: '@pulse-compute/entities',
  kind: 'entities.handle',
  operation: 'handle',
  intrinsic: 'pulse.entities.handle.v1',
  packageIntrinsic: 'pulse.entities.handle.v1',
  compilerName: '__pulse_entities_handle',
  valueKind: 'response',
  argumentIndexes: [0],
  staticArguments: [direct.artifact.plan],
  range: direct.canonicalIntrinsics[0].range,
  loc: direct.canonicalIntrinsics[0].loc
});
assert.equal(direct.artifact.policy.namedImportAliasesSupported, true);
assert.equal(direct.artifact.policy.namespaceImportsSupported, false);
assert.equal(direct.artifact.policy.routeTopologySymbolsRequired, false);
assert.equal(direct.artifact.policy.nativeDispatcherImplemented, true);
assert.equal(direct.artifact.policy.nativeSourceGeneratorImplemented, true);
assert.equal(direct.artifact.policy.packageTargetPromoted, true);
assert.equal(direct.inspectionArtifacts.length, 2);
assert.equal(direct.inspectionArtifacts[0].data.version, 'pulse.entities-catalog.v1');
assert.equal(direct.managedHandlers.length, 2);

const records = discoverLowerableLibraryManifests({ cwd: repoRoot, workspaceRoot: repoRoot });
const entitiesRecord = records.find((entry) => entry.manifest.contractId === 'pulse.entities');
assert.ok(entitiesRecord);
assert.equal(entitiesRecord.validation.status, 'ok');
const loaded = loadLowerableCompilerBuilder(entitiesRecord);
assert.equal(loaded.exportName, entitiesContracts.ENTITIES_LOWERER_EXPORT);
assert.equal(typeof loaded.builder, 'function');
assert.equal(loaded.builder.name, 'createEntitiesPackageCompilerBuilder');

const normalized = buildPackageOwnedLoweringPlan({
  cwd: repoRoot,
  workspaceRoot: repoRoot,
  manifestRecords: records,
  contractId: 'pulse.entities',
  sourcePath: 'src/entities.ts',
  sourceText: source(),
  schemaBundle: schemaBundle()
});
assert.equal(normalized.version, 'pulse.package-builder-result.v1');
assert.equal(normalized.artifact.status, 'ok');
assert.equal(normalized.contributions.canonicalEffects.length, 0);
assert.equal(normalized.contributions.canonicalIntrinsics.length, 1);
assert.equal(normalized.contributions.schemaReferences.length, 2);
assert.equal(normalized.contributions.realizationArtifacts.length, 1);
assert.equal(normalized.contributions.realizationArtifacts[0].id, 'pulse-entities-native-as');
assert.equal(normalized.contributions.inspectionArtifacts.length, 2);
assert.equal(normalized.contributions.managedHandlers.length, 2);

const recognized = recognizeProjectPackageOperations(path.join(repoRoot, 'src/entities.ts'), {
  rootDir: repoRoot,
  workspaceRoot: repoRoot,
  sourceText: source(),
  sourceName: 'src/entities.ts',
  publicSourceName: 'src/entities.ts',
  selectedContracts: ['pulse.entities'],
  schemaBundle: schemaBundle()
});
assert.deepEqual(recognized.selectedContracts, ['pulse.entities']);
assert.deepEqual(recognized.operations, []);
assert.equal(recognized.intrinsics.length, 1);
assert.equal(recognized.intrinsics[0].kind, 'entities.handle');
assert.equal(recognized.intrinsics[0].loc.file, 'src/entities.ts');
assert.deepEqual(recognized.schemaReferences.map((entry) => entry.file), ['src/entities.ts', 'src/entities.ts']);
assert.deepEqual(recognized.packages[0].hostCapabilities, []);
assert.equal(recognized.packages[0].mode, 'implemented-now');
assert.equal(recognized.realizationArtifacts.length, 1);
assert.equal(recognized.realizationArtifacts[0].id, 'pulse-entities-native-as');
assert.equal(recognized.inspectionArtifacts.length, 2);
assert.equal(recognized.managedHandlers.length, 2);

const checkoutA = build(source(), { cwd: '/tmp/checkout-a', sourcePath: '/tmp/checkout-a/src/entities.ts' });
const checkoutB = build(source(), { cwd: '/tmp/checkout-b', sourcePath: '/tmp/checkout-b/src/entities.ts' });
assert.equal(checkoutA.artifact.plan.planHash, checkoutB.artifact.plan.planHash);
assert.equal(checkoutA.artifact.catalog.catalogHash, checkoutB.artifact.catalog.catalogHash);
assert.deepEqual(checkoutA.artifact.plan, checkoutB.artifact.plan);
assert.deepEqual(checkoutA.artifact.catalog, checkoutB.artifact.catalog);

expectCode(`import * as entities from '@pulse-compute/entities'\nexport default function handler(ctx) { return ctx.text(String(entities)) }\n`, 'PULSE_ENTITIES_ADAPTER_STATIC_REQUIRED');

expectCode(`import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
const selected = jsonRpc()
const rpc = new EntityRouter({ adapter: selected })
export default function handler(ctx) { return rpc.handle(ctx) }
`, 'PULSE_ENTITIES_ADAPTER_STATIC_REQUIRED');

expectCode(`import { EntityRouter } from '@pulse-compute/entities'
function otherAdapter() { return {} }
const rpc = new EntityRouter({ adapter: otherAdapter() })
export default function handler(ctx) { return rpc.handle(ctx) }
`, 'PULSE_ENTITIES_ADAPTER_UNSUPPORTED');

expectCode(source(`const method = 'customer.lookup'\nrpc.on(method, { input: null, output: null }, ping)`), 'PULSE_ENTITIES_DISCRIMINATOR_STATIC_REQUIRED');
expectCode(source(`rpc.on('system.ping', { input: null, output: null }, ping)\nrpc.on('system.ping', { input: null, output: null }, ping)`), 'PULSE_ENTITIES_DISCRIMINATOR_DUPLICATE');
expectCode(source(`rpc.on('system.ping', { input: schemaId, output: null }, ping)`), 'PULSE_ENTITIES_SCHEMA_ID_INVALID');
expectCode(source(`rpc.on('system.ping', { input: 'tools.Missing', output: null }, ping)`), 'PULSE_ENTITIES_SCHEMA_MISSING');
expectCode(source(`rpc.on('system.ping', { input: null, output: null, metadata: dynamicMetadata }, ping)`), 'PULSE_ENTITIES_METADATA_INVALID');
expectCode(source(`rpc.on('system.ping', { input: null, output: null }, missingHandler)`), 'PULSE_ENTITIES_HANDLER_UNRESOLVED');
expectCode(source(`if (enabled) rpc.on('system.ping', { input: null, output: null }, ping)`), 'PULSE_ENTITIES_REGISTRATION_UNSUPPORTED');

expectCode(`import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
const rpc = new EntityRouter({ adapter: jsonRpc() })
export default function handler(ctx) { const value = rpc.handle(ctx); return value }
`, 'PULSE_ENTITIES_BINDING_UNSUPPORTED');

expectCode(`import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
const rpc = new EntityRouter({ adapter: jsonRpc() })
export default async function handler(ctx) { await ctx.req.json(); return rpc.handle(ctx) }
`, 'PULSE_ENTITIES_BODY_CONSUMER_CONFLICT');

for (const file of [
  'wasm/packages/library-kit/src/compiler/handler-library-contracts.js',
  'wasm/packages/library-kit/src/compiler/package-lowering.js',
  'wasm/packages/compiler/src/spine/package-operation-seam.js'
]) {
  const genericSource = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  assert.doesNotMatch(genericSource, /@pulse-compute\/entities|EntityRouter|jsonRpc|entities\.handle/);
}

const releaseManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release/pulse-release-manifest.json'), 'utf8'));
assert.equal(releaseManifest.packages.some((entry) => entry.name === '@pulse-compute/entities'), true);

console.log(JSON.stringify({
  version: direct.artifact.version,
  planHash: direct.artifact.plan.planHash,
  catalogHash: direct.artifact.catalog.catalogHash,
  entities: direct.artifact.summary.entities,
  schemaReferences: direct.schemaReferences.length,
  intrinsic: direct.canonicalIntrinsics[0].intrinsic,
  targetStatus: product.targets.native.status,
  negativeDiagnostics: 12
}));
console.log('ok - Entities package-owned extraction emits deterministic plan/catalog inspection, managed-handler descriptors, terminal intrinsic, and I9 target truth');
