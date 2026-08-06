#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
process.chdir(repoRoot);

const catalogContracts = require('../../packages/contracts/src/entities/catalog.js');
const lowerer = require('../../../packages/entities/pulsewasm.compiler.cjs');
const {
  discoverPackageContractCatalog
} = require('../../packages/compiler/src/spine/package-operation-seam.js');

const alpha = `rpc.on('alpha.lookup', {
  input: 'tools.AlphaInput',
  output: 'tools.AlphaOutput',
  metadata: { title: 'Alpha', nested: { order: 1 } },
}, alphaHandler)`;
const beta = `rpc.on('beta.notify', {
  input: null,
  output: null,
  metadata: { title: 'Beta', tags: ['notify', 'bounded'] },
}, betaHandler)`;

function source(registrations) {
  return `import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
function alphaHandler() {}
function betaHandler() {}
const rpc = new EntityRouter({ adapter: jsonRpc() })
${registrations.join('\n')}
export default function handler(ctx) { return rpc.handle(ctx) }
`;
}

function build(registrations, cwd, sourcePath) {
  return lowerer.buildEntitiesLoweringPlan({
    cwd,
    sourcePath,
    sourceText: source(registrations),
    schemaBundle: {
      declaredSchemaIds: ['tools.AlphaInput', 'tools.AlphaOutput'],
      registry: { schemas: [{ id: 'tools.AlphaInput' }, { id: 'tools.AlphaOutput' }] }
    }
  });
}

const first = build([beta, alpha], repoRoot, 'src/catalog.ts');
const second = build([alpha, beta], repoRoot, 'src/catalog.ts');
assert.equal(first.artifact.status, 'ok');
assert.equal(second.artifact.status, 'ok');
assert.equal(first.artifact.plan.planHash, second.artifact.plan.planHash);
assert.equal(first.artifact.catalog.catalogHash, second.artifact.catalog.catalogHash);
assert.deepEqual(first.artifact.catalog, second.artifact.catalog);
assert.deepEqual(first.artifact.catalog.routers[0].entities.map((entry) => entry.name), ['alpha.lookup', 'beta.notify']);
assert.deepEqual(Object.keys(first.artifact.catalog.routers[0].entities[0].metadata), ['nested', 'title']);
assert.deepEqual(first.artifact.catalog.routers[0].entities[0].eligibility, {
  'fastly-javascript': true,
  'fastly-native': true,
  'node-javascript': true,
  'node-native': true
});
assert.deepEqual(Object.keys(first.artifact.catalog.routers[0].entities[0].eligibility), catalogContracts.ENTITIES_CATALOG_TARGETS);
assert.equal(Object.isFrozen(first.artifact.catalog), true);
assert.equal(Object.isFrozen(first.artifact.catalog.routers[0].entities[0].metadata), true);
assert.equal(JSON.stringify(first.artifact.catalog).includes('handler'), false);
assert.equal(JSON.stringify(first.artifact.catalog).includes('src/catalog.ts'), false);

const checkoutA = build([beta, alpha], '/tmp/entities-a', '/tmp/entities-a/src/catalog.ts');
const checkoutB = build([alpha, beta], '/tmp/entities-b', '/tmp/entities-b/src/catalog.ts');
assert.equal(checkoutA.artifact.catalog.catalogHash, checkoutB.artifact.catalog.catalogHash);
assert.deepEqual(checkoutA.artifact.catalog, checkoutB.artifact.catalog);

const packageCatalog = discoverPackageContractCatalog({ cwd: repoRoot, workspaceRoot: repoRoot });
const entry = packageCatalog.contracts.find((contract) => contract.contractId === 'pulse.entities');
assert.ok(entry);
assert.equal(entry.validationStatus, 'ok');
assert.equal(entry.compilerOwner, '@pulse-compute/entities');
assert.equal(entry.compilerTrust, 'first-party');
assert.deepEqual(entry.facadeSymbols, ['EntityRouter', 'jsonRpc']);
assert.equal(entry.targetSupport.native, true);
assert.equal(entry.targetSupport.javascript, 'declared');
assert.equal(entry.productContract.targets.native.status, 'provider-dependent');
assert.equal(entry.productContract.targets.javascript.status, 'supported');
assert.equal(entry.productContract.targets.native.reasonCode, 'PULSE_ENTITIES_NATIVE_PROVIDER_INTEGRATION_REQUIRED');
assert.equal(entry.productContract.targets.javascript.reasonCode, null);
assert.equal(entry.productContract.conformance.status, 'target-overlap');
assert.equal(packageCatalog.policy.trustedFirstPartyOnly, true);
assert.equal(packageCatalog.policy.publicRegistration, false);

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/entities/package.json'), 'utf8'));
assert.deepEqual(packageJson.pulsewasm, { manifest: './pulsewasm.manifest.cjs' });
assert.deepEqual(Object.keys(packageJson.exports), ['.', './pulsewasm/manifest', './pulsewasm/compiler', './pulsewasm-native']);
assert.equal(packageJson.files.includes('pulsewasm.manifest.cjs'), true);
assert.equal(packageJson.files.includes('pulsewasm.compiler.cjs'), true);
assert.equal(packageJson.files.includes('pulsewasm.native.cjs'), true);
assert.equal(packageJson.files.includes('as'), true);
assert.equal(packageJson.files.includes('conformance'), true);

console.log(JSON.stringify({
  version: first.artifact.catalog.version,
  catalogHash: first.artifact.catalog.catalogHash,
  entityOrder: first.artifact.catalog.routers[0].entities.map((entity) => entity.name),
  targetsEligible: 4,
  releaseAssigned: false
}));
console.log('ok - Entities catalog remains deterministic, non-sensitive, immutable, and honest about I9 target support without assigning a release');
