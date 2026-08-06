#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
process.chdir(repoRoot);

const entitiesLowerer = require('../../../packages/entities/pulsewasm.compiler.cjs');
const { writeCanonicalBuild } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { compileProject } = require('../../packages/cli/src/project-execution.js');
const { run, parseJson } = require('../cli/helpers.cjs');

const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/entities-inspection');
const sourceFile = path.join(fixture, 'src/index.ts');
const secretSentinel = 'entities-i8-secret-sentinel';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function artifact(inspection, id) {
  const entry = inspection.artifacts.find((candidate) => candidate.id === id);
  assert.ok(entry, `missing package inspection artifact ${id}`);
  return entry;
}

function assertNoPrivateInspectionFields(value) {
  const forbidden = new Set([
    'payload',
    'providerObject',
    'rawId',
    'requestId',
    'resolvedSecret',
    'resource',
    'runtimeInputs',
    'runtimeObject',
    'sourceText'
  ]);
  function visit(current, location) {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${location}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      assert.equal(forbidden.has(key), false, `${location}.${key} is private inspection data`);
      visit(child, `${location}.${key}`);
    }
  }
  visit(value, 'packageInspection');
}

function lowerAt(cwd) {
  return entitiesLowerer.buildEntitiesLoweringPlan({
    cwd,
    sourcePath: path.join(cwd, 'src/index.ts'),
    sourceText: fs.readFileSync(sourceFile, 'utf8'),
    schemaBundle: {
      declaredSchemaIds: ['tools.LookupInput', 'tools.LookupOutput'],
      registry: { schemas: [{ id: 'tools.LookupInput' }, { id: 'tools.LookupOutput' }] }
    }
  });
}

const nodeProject = resolveProject({ cwd: fixture, profile: 'node-javascript' });
const nodeCompiled = compileProject(nodeProject);
const inspection = nodeCompiled.packageInspection;
assert.equal(inspection.version, 'pulse.canonical-package-inspection.v1');
assert.deepEqual(inspection.summary, {
  packages: 1,
  artifacts: 2,
  declaredHandlers: 2,
  handlerEffects: 1
});
assert.equal(nodeCompiled.packageApplication.version, 'pulse.terminal-package-intrinsic-application.v1');
assert.equal(nodeCompiled.packageApplication.contractId, 'pulse.entities');
assert.equal(nodeCompiled.packageApplication.realization, 'provider-dependent');
assert.equal(Object.prototype.hasOwnProperty.call(nodeCompiled.packageApplication, 'sourceText'), false);

const catalogArtifact = artifact(inspection, 'pulse.entities-catalog.v1');
const declarationArtifact = artifact(inspection, 'pulse.entities-inspection.v1');
const catalog = catalogArtifact.data;
const declaration = declarationArtifact.data;
assert.equal(catalog.version, 'pulse.entities-catalog.v1');
assert.equal(declaration.version, 'pulse.entities-inspection.v1');
assert.equal(declaration.planHash, nodeCompiled.packageApplication.planHash);
assert.equal(declaration.catalogHash, catalog.catalogHash);
assert.deepEqual(catalog.routers[0].entities.map((entry) => entry.name), ['customer.lookup', 'system.notify']);
assert.ok(catalog.routers[0].entities.every((entry) => Object.values(entry.eligibility).every(Boolean)));
assert.deepEqual(declaration.routers[0].adapter, {
  id: 'json-rpc',
  version: 'pulse.entities-adapter.v1',
  adapterVersion: 'pulse.entities-json-rpc-adapter.v1',
  options: { acceptEmptyObjectForNoInput: false, namedParamsOnly: true }
});
assert.deepEqual(declaration.routers[0].entities[0].schemas, {
  input: 'tools.LookupInput',
  output: 'tools.LookupOutput'
});
assert.deepEqual(declaration.routers[0].entities[0].metadata, {
  tags: ['tools', 'customer'],
  title: 'Lookup customer'
});
assert.deepEqual(declaration.routers[0].entities.map((entry) => entry.handler.exportName), ['lookupCustomer', 'notifySystem']);

for (const target of ['node-javascript', 'node-native']) {
  assert.equal(declaration.targets[target].eligible, true);
  assert.equal(declaration.targets[target].evidence, 'measured-execution');
  assert.equal(declaration.targets[target].runtimeExecutionMeasured, true);
  assert.equal(declaration.targets[target].providerRealityValidated, false);
  assert.equal(declaration.targets[target].externalProviderExecution, false);
  assert.match(declaration.targets[target].reasonCode, /_MEASURED$/);
  assert.equal(declaration.targets[target].evidenceTask, 'entities-cross-target');
}
for (const target of ['fastly-javascript', 'fastly-native']) {
  assert.equal(declaration.targets[target].eligible, true);
  assert.equal(declaration.targets[target].evidence, 'measured-execution');
  assert.equal(declaration.targets[target].runtimeExecutionMeasured, true);
  assert.equal(declaration.targets[target].providerRealityValidated, true);
  assert.equal(declaration.targets[target].externalProviderExecution, true);
  assert.equal(declaration.targets[target].evidenceTask, 'entities-cross-target');
  assert.equal(declaration.targets[target].evidenceEngine, 'viceroy 0.20.1');
  assert.match(declaration.targets[target].reasonCode, /_VICEROY_MEASURED$/);
}
assert.equal(declaration.policy.fastlyCompileOnly, false);
assert.equal(declaration.policy.fastlyExternalExecutionClaimed, true);
assert.equal(declaration.policy.fourModeExecutionMeasured, true);
assert.equal(declaration.policy.providerRealityValidated, true);

const handlers = inspection.managedHandlers;
assert.equal(handlers.summary.handlers, 2);
assert.equal(handlers.summary.nativeEligible, 2);
assert.deepEqual(handlers.handlers.map((handler) => handler.source.exportName), ['lookupCustomer', 'notifySystem']);
assert.deepEqual(handlers.handlers[0].schemas, { input: 'tools.LookupInput', output: 'tools.LookupOutput' });
assert.deepEqual(handlers.handlers[0].effects.sites, [{
  kind: 'config.get',
  capability: 'config.get',
  providerKind: 'config',
  operation: 'get'
}]);
assert.equal(handlers.handlers[0].effects.logging, 1);
assert.equal(handlers.handlers[1].effects.logging, 1);
assert.ok(handlers.handlers.every((handler) => handler.eligibility.javascript.eligible && handler.eligibility.native.eligible));

const serializedInspection = JSON.stringify(inspection);
assert.equal(serializedInspection.includes(secretSentinel), false);
assert.equal(serializedInspection.includes('"MODE"'), false);
assert.equal(serializedInspection.includes('entity lookup'), false);
assertNoPrivateInspectionFields(inspection);

const fastlyProject = resolveProject({ cwd: fixture, profile: 'fastly-javascript' });
const fastlyCompiled = compileProject(fastlyProject);
assert.deepEqual(fastlyCompiled.packageInspection.artifacts, nodeCompiled.packageInspection.artifacts);
assert.equal(artifact(fastlyCompiled.packageInspection, 'pulse.entities-inspection.v1').data.targets['fastly-javascript'].evidence, 'measured-execution');

const cliInspection = parseJson(run(['inspect', '--profile', 'node-javascript', '--json'], fixture));
assert.equal(cliInspection.status, 'ok');
assert.deepEqual(cliInspection.compiler.packageInspection, inspection);
assert.deepEqual(cliInspection.compiler.packageApplication, nodeCompiled.packageApplication);
assert.equal(JSON.stringify(cliInspection).includes(secretSentinel), false);

const fastlyNativeInspection = parseJson(run(['inspect', '--profile', 'fastly-native', '--json'], fixture));
assert.equal(fastlyNativeInspection.status, 'ok');
assert.equal(fastlyNativeInspection.compiler.native.status, 'unavailable-for-project');
assert.equal(fastlyNativeInspection.compiler.native.requiredForSelectedTarget, true);
assert.equal(fastlyNativeInspection.provider.realization.status, 'unavailable-for-project');
assert.equal(fastlyNativeInspection.provider.realization.providerRealityValidated, false);
assert.deepEqual(fastlyNativeInspection.compiler.packageInspection, inspection);
assert.equal(
  artifact(fastlyNativeInspection.compiler.packageInspection, 'pulse.entities-inspection.v1').data.targets['fastly-native'].evidence,
  'measured-execution'
);

const checkoutA = lowerAt('/tmp/pulse-entities-i9-checkout-a');
const checkoutB = lowerAt('/tmp/pulse-entities-i9-checkout-b');
assert.equal(checkoutA.artifact.plan.planHash, checkoutB.artifact.plan.planHash);
assert.equal(checkoutA.artifact.catalog.catalogHash, checkoutB.artifact.catalog.catalogHash);
assert.deepEqual(checkoutA.inspectionArtifacts, checkoutB.inspectionArtifacts);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-entities-i9-build-'));
try {
  const outA = path.join(scratch, 'a');
  const outB = path.join(scratch, 'b');
  const buildA = writeCanonicalBuild(nodeCompiled, outA);
  const buildB = writeCanonicalBuild(nodeCompiled, outB);
  assert.deepEqual(buildA.packageInspectionArtifacts.map((entry) => entry.id), [
    'pulse.entities-catalog.v1',
    'pulse.entities-inspection.v1'
  ]);
  const catalogA = path.join(outA, 'entities-catalog.json');
  const catalogB = path.join(outB, 'entities-catalog.json');
  const inspectionA = path.join(outA, 'entities-inspection.json');
  const inspectionB = path.join(outB, 'entities-inspection.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(catalogA, 'utf8')), catalog);
  assert.deepEqual(JSON.parse(fs.readFileSync(inspectionA, 'utf8')), declaration);
  assert.equal(sha256(catalogA), sha256(catalogB));
  assert.equal(sha256(inspectionA), sha256(inspectionB));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(JSON.stringify({
  version: inspection.version,
  planHash: declaration.planHash,
  catalogHash: declaration.catalogHash,
  declaredHandlers: inspection.summary.declaredHandlers,
  measuredNodeTargets: 2,
  measuredFastlyTargets: 2,
  externalFastlyExecutionClaimed: true
}));
console.log('ok - Entities inspection exposes deterministic declarations, schemas, effects, eligibility, reasons, and build artifacts without runtime or provider data');
