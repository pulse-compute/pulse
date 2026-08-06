#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outputDirectory = path.join(repoRoot, 'wasm', '.test-results', 'boundary-h5');
const OBSERVED_AT = '2026-07-31';
const STARTING_SNAPSHOT = Object.freeze({
  archive: 'pulse-boundary-h4-implemented.zip',
  sha256: '40d3f1a1d1b64754a4be9156bf9851c409ce05e55f442c6a68d78fcf2d31a8a7'
});
process.chdir(repoRoot);

const packageContract = require('../../packages/contracts/src/package/package-contract.js');
const guestStage = require('../../packages/wasm-guest-link/src/stage.js');
const nativePlan = require('../../packages/contracts/src/handler/canonical-native-plan.js');
const providerContracts = require('../../packages/contracts/src/provider/toolchain.js');
const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');

const FOCUSED_TASKS = Object.freeze([
  'boundaries',
  'hidden-contracts',
  'package-reachability',
  'canonical-native-plan',
  'guest-link-package',
  'guest-link-materialization-stage',
  'guest-link-audit-diagnostics',
  'assets-package-owned-lowering',
  'grip-package-owned-lowering',
  'jwt-package-owned-lowering',
  'provider-fastly-package',
  'fastly-javascript-runtime',
  'jwt-es256-cross-target'
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function readJson(relativeFile) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8'));
}

function outputRecord(relativeFile) {
  const target = path.join(repoRoot, relativeFile);
  return Object.freeze({
    file: relativeFile,
    bytes: fs.statSync(target).size,
    sha256: sha256(fs.readFileSync(target))
  });
}

function writeJson(name, value) {
  const target = path.join(outputDirectory, name);
  fs.writeFileSync(target, `${JSON.stringify(stable(value), null, 2)}\n`);
  return outputRecord(path.relative(repoRoot, target).replace(/\\/g, '/'));
}

function writeText(name, value) {
  const target = path.join(outputDirectory, name);
  fs.writeFileSync(target, value);
  return outputRecord(path.relative(repoRoot, target).replace(/\\/g, '/'));
}

function run(label, command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    stdio: 'inherit',
    timeout: options.timeoutMs || 3000000
  });
  if (result.error || result.status !== 0) {
    const error = result.error || new Error(`${label} exited with status ${result.status}`);
    error.code = error.code || 'PULSE_BOUNDARY_H5_VALIDATION_FAILED';
    throw error;
  }
  return Object.freeze({ label, status: 'PASS', durationMs: Date.now() - startedAt });
}

fs.mkdirSync(outputDirectory, { recursive: true });

const negativeRun = run(
  'H5 negative boundary matrix',
  process.execPath,
  [path.join(repoRoot, 'wasm', 'test', 'contracts', 'assert-boundary-negative-h5.cjs')],
  { timeoutMs: 240000 }
);
const focusedArguments = [path.join(repoRoot, 'wasm', 'scripts', 'run-wasm-tests.cjs')];
for (const task of FOCUSED_TASKS) focusedArguments.push('--task', task);
focusedArguments.push('--no-report');
const focusedRun = run(
  'H5 focused boundary replay',
  process.execPath,
  focusedArguments,
  { timeoutMs: 3000000 }
);
const packageBuildRun = run(
  'Crypto and JWT public TypeScript builds',
  process.execPath,
  [path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-b', 'packages/crypto', 'packages/jwt'],
  { timeoutMs: 240000 }
);
const packageTestRun = run(
  'Crypto and JWT public package tests',
  process.execPath,
  [
    path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    'packages/crypto/test',
    'packages/jwt/test',
    '--config',
    'vitest.config.ts'
  ],
  { timeoutMs: 300000 }
);

const bleedLedger = readJson('wasm/.test-results/boundary-h0/boundary-bleed-ledger.json');
const reports = [1, 2, 3, 4].map((stage) => readJson(
  `wasm/.test-results/boundary-h${stage}/boundary-h${stage}-report.json`
));
assert.equal(reports.every((report) => report.status === 'PASS'), true);
const closedFindings = [...new Set(reports.flatMap((report) => report.closedFindings || []))].sort();
const requiredBeforeEntities = bleedLedger.items
  .filter((item) => item.classification === 'must-fix-before-entities')
  .map((item) => item.id)
  .sort();
assert.deepEqual(closedFindings.filter((id) => requiredBeforeEntities.includes(id)), requiredBeforeEntities);
assert.ok(closedFindings.includes('H0-B015'));
const protectedSeam = bleedLedger.items.find((item) => item.id === 'H0-B013');
const deferredRefactor = bleedLedger.items.find((item) => item.id === 'H0-B014');
assert.equal(protectedSeam.classification, 'protected-existing-seam');
assert.equal(deferredRefactor.classification, 'post-beta-refactor');

const negativeMatrix = readJson('wasm/.test-results/boundary-h5/boundary-negative-matrix.json');
const importPolicy = readJson('wasm/.test-results/boundary-h5/boundary-import-policy.json');
assert.equal(negativeMatrix.status, 'PASS');
assert.equal(negativeMatrix.requiredGuardrailCount, 12);
assert.equal(negativeMatrix.failClosed, true);
assert.equal(negativeMatrix.automaticFallback, false);
assert.equal(importPolicy.status, 'PASS');
assert.deepEqual(importPolicy.driftProof.cases.map((entry) => entry.id), [
  'forbidden-manifest-dependency',
  'undeclared-package-runtime-import',
  'unexported-workspace-import',
  'forbidden-provider-private-import',
  'entities-schema-forbidden-import',
  'forbidden-package-test-toolchain-import',
  'public-types-capability-drift',
  'typescript-capability-mirror-drift',
  'commonjs-capability-mirror-drift',
  'entities-schema-types-mirror-drift',
  'entities-schema-capability-drift'
]);
assert.equal(importPolicy.driftProof.cases.every((entry) => entry.mutationRejected), true);

const h4Matrix = readJson('wasm/.test-results/boundary-h4/es256-six-cell-matrix.json');
const fastlyJavascript = readJson('wasm/.test-results/boundary-h4/fastly-javascript-es256-conformance.json');
assert.equal(h4Matrix.status, 'PASS');
assert.equal(h4Matrix.requiredCellCount, 6);
assert.equal(h4Matrix.completedSemanticEvaluations, 228);
assert.equal(h4Matrix.skippedRequiredEvaluations, 0);
assert.equal(h4Matrix.exactInputOutputFailureParity, true);
assert.equal(h4Matrix.automaticFallback, false);
assert.equal(fastlyJavascript.status, 'passed');
assert.equal(fastlyJavascript.completedExecutions, 38);
assert.equal(fastlyJavascript.skippedExecutions, 0);
assert.equal(fastlyJavascript.automaticFallback, false);

const ownerMap = Object.freeze({
  version: 'pulse.boundary-owner-map.h5.v1',
  stage: 'H5',
  status: 'PASS',
  observedAt: OBSERVED_AT,
  startingSnapshot: STARTING_SNAPSHOT,
  entitiesRule: 'new Entities contracts must project through these owners without acquiring neighboring private authority',
  boundaries: Object.freeze([
    {
      id: 'PACKAGE-BUILDER',
      owner: '@pulse-compute/wasm-library-kit',
      shape: packageContract.PACKAGE_BUILDER_INVOCATION_VERSION,
      result: packageContract.PACKAGE_BUILDER_RESULT_VERSION,
      consumer: 'trusted-feature-package-builder'
    },
    {
      id: 'PACKAGE-OPERATION',
      owner: '@pulse-compute/wasm-contracts/package/package-contract',
      shape: packageContract.CANONICAL_PACKAGE_OPERATION_VERSION,
      bundle: packageContract.PACKAGE_LOWERING_BUNDLE_VERSION,
      consumer: 'canonical-native-plan'
    },
    {
      id: 'PROVIDER-REQUIREMENT',
      owner: '@pulse-compute/wasm-contracts/package-and-provider-contracts',
      shape: packageContract.PROVIDER_REQUIREMENT_RECORD_VERSION,
      consumer: 'provider-plan-projection'
    },
    {
      id: 'GUEST-CONTRIBUTION',
      owner: '@pulse-compute/wasm-contracts/package/package-contract',
      shape: packageContract.GUEST_UNIT_CONTRIBUTION_VERSION,
      consumer: '@pulse-compute/wasm-guest-link'
    },
    {
      id: 'GUEST-LINK-STAGE',
      owner: '@pulse-compute/wasm-guest-link',
      shape: guestStage.GUEST_LINK_STAGE_INVOCATION_VERSION,
      result: guestStage.GUEST_LINK_STAGE_RESULT_VERSION,
      consumer: 'compiler-projection-and-provider-packaging'
    },
    {
      id: 'CANONICAL-NATIVE-PLAN',
      owner: '@pulse-compute/wasm-contracts/handler/canonical-native-plan',
      shape: nativePlan.CANONICAL_NATIVE_PLAN_VERSION,
      consumer: 'native-compiler-and-provider-target-adapter',
      status: 'protected-existing-seam'
    },
    {
      id: 'PROVIDER-TOOLCHAIN',
      owner: '@pulse-compute/wasm-contracts/provider/toolchain',
      shape: providerContracts.PROVIDER_TOOLCHAIN_VERSION,
      invocation: providerContracts.PROVIDER_TARGET_INVOCATION_VERSION,
      result: providerContracts.PROVIDER_TARGET_RESULT_VERSION,
      consumer: 'selected-provider-package'
    },
    {
      id: 'CRYPTO-SEMANTICS',
      owner: '@pulse-compute/crypto',
      shape: cryptoContracts.CRYPTO_ES256_CONTRACT_VERSION,
      algorithms: cryptoContracts.CRYPTO_ALGORITHMS,
      consumer: '@pulse-compute/jwt-and-target-realization-planners'
    },
    {
      id: 'JWT-COMPOSITION',
      owner: '@pulse-compute/jwt',
      shape: jwtContracts.JWT_CONTRACT_VERSION,
      algorithms: jwtContracts.JWT_IMPLEMENTED_ALGORITHMS,
      consumer: 'application-authors-and-provider-runtime-adapters'
    },
    {
      id: 'PUBLIC-CRYPTO-CONFIGURATION',
      owner: '@pulse-compute/pulse',
      shape: 'public-TypeScript-contract',
      algorithms: Object.freeze(['HS256', 'ES256']),
      consumer: 'application-authors'
    }
  ]),
  requiredBeforeEntities,
  closedBeforeEntities: requiredBeforeEntities,
  protectedExistingSeams: Object.freeze(['H0-B013']),
  deferredOnly: Object.freeze(['H0-B014'])
});
const ownerMapOutput = writeJson('boundary-owner-map.json', ownerMap);

const referenceConformance = Object.freeze({
  version: 'pulse.boundary-reference-consumer-conformance.h5.v1',
  stage: 'H5',
  status: 'PASS',
  focusedReplay: Object.freeze({
    command: `node wasm/scripts/run-wasm-tests.cjs ${FOCUSED_TASKS.map((task) => `--task ${task}`).join(' ')} --no-report`,
    tasks: FOCUSED_TASKS,
    result: focusedRun
  }),
  consumers: Object.freeze([
    { id: 'core-native-plan', task: 'canonical-native-plan', status: 'PASS' },
    { id: 'assets-package-lowering', task: 'assets-package-owned-lowering', status: 'PASS' },
    { id: 'grip-package-lowering', task: 'grip-package-owned-lowering', status: 'PASS' },
    { id: 'jwt-package-lowering', task: 'jwt-package-owned-lowering', status: 'PASS' },
    { id: 'guest-link-final-artifact', task: 'guest-link-materialization-stage', status: 'PASS' },
    { id: 'fastly-provider-package', task: 'provider-fastly-package', status: 'PASS' },
    { id: 'fastly-javascript-shape-and-fallback', task: 'fastly-javascript-runtime', status: 'PASS' },
    { id: 'jwt-es256-five-cell-reality', task: 'jwt-es256-cross-target', status: 'PASS' },
    { id: 'jwt-es256-six-cell-frozen-matrix', task: 'jwt-es256-six-cell', status: 'PASS', evaluations: 228, skipped: 0 }
  ]),
  publicPackages: Object.freeze({
    build: packageBuildRun,
    tests: packageTestRun,
    packages: Object.freeze(['@pulse-compute/crypto', '@pulse-compute/jwt', '@pulse-compute/pulse']),
    pulseTypeSurfaceCheckedBy: 'boundary-authority-h4-and-H5-mutation-proof'
  }),
  cryptoJwtReferencePath: 'PASS',
  exactInputOutputFailureParity: true,
  automaticFallback: false
});
const referenceOutput = writeJson('boundary-reference-consumer-conformance.json', referenceConformance);

const deferredLedger = Object.freeze({
  version: 'pulse.boundary-deferred-refactor-ledger.h5.v1',
  stage: 'H5',
  status: 'PASS',
  entitiesBlockers: Object.freeze([]),
  items: Object.freeze([{
    id: 'H0-B014',
    classification: 'post-beta-refactor',
    disposition: 'DEFERRED',
    concern: deferredRefactor.concern,
    reason: 'proof-command and historical-wrapper cleanup does not alter or weaken the now-locked boundary shapes',
    permittedBeforeEntities: false,
    requiredBeforeEntities: false,
    revisit: 'post-beta compiler pipeline maintenance'
  }]),
  compilerRefactorNeed: 'DEFERRED',
  productionReadiness: 'NOT_ASSESSED',
  releaseReadiness: 'NOT_ASSESSED'
});
const deferredOutput = writeJson('boundary-deferred-refactor-ledger.json', deferredLedger);

const handoffOutput = writeText('boundary-h5-final-handoff.md', `# Pulse boundary lock H5 final handoff

**Schema:** \`pulse.boundary-h5-final-handoff.v1\`  
**H5 result:** PASS  
**Entities seam readiness:** READY  
**Compiler refactor need:** DEFERRED  
**Recommended GPT-5.6 effort for the first Entities pass:** \`xhigh\`

## Seal conclusion

The pre-Entities boundary lock is complete. H0-B001 through H0-B012 and the
H0-B015 documentation drift are closed. H0-B013 remains a protected existing
canonical Native-plan/provider-requirement seam. H0-B014 remains deliberately
deferred to post-beta compiler maintenance and is not an Entities blocker.

All twelve required negative guardrails fail closed. The import policy and the
TypeScript, CommonJS, and public capability mirrors were mutation-tested in an
isolated repository copy: each deliberate drift was rejected, and no product
source was modified by the proof. The focused package, guest-link, provider,
Fastly JavaScript, and JWT ES256 reference paths pass with no automatic
fallback. The frozen H4 matrix remains six cells, 228 semantic evaluations,
zero skips, and exact input/output/failure parity.

## Start Entities from the locked seam

- declare the Entities semantic owner and public author-facing shape first;
- emit exact package-owned canonical operations through the H1 envelope;
- keep persistence, provider realization, and runtime objects outside package
  lowerers and canonical operation shapes;
- project only canonical provider requirements and exact versioned target
  invocations/results;
- add named negative tests for every new cross-package or provider seam;
- preserve guest-link final-byte authorization, crypto/JWT ownership, the
  canonical Native plan, plan-hash linkage, and no-fallback behavior.

Do not combine the first Entities pass with event mechanics, compiler
reorganization, proof-command cleanup, publication, deployment, release
promotion, or production-readiness claims.

## Scope statement

H5 assesses pre-Entities boundary and shape readiness only. Production
readiness and release readiness are explicitly NOT_ASSESSED.
`);

const outcomes = Object.freeze({
  boundaryOwnership: 'PASS',
  shapeProtection: 'PASS',
  importDirection: 'PASS',
  cryptoJwtReferencePath: 'PASS',
  entitiesSeamReadiness: 'READY',
  compilerRefactorNeed: 'DEFERRED',
  productionReadiness: 'NOT_ASSESSED',
  releaseReadiness: 'NOT_ASSESSED'
});
const seal = Object.freeze({
  version: 'pulse.boundary-h5-seal.v1',
  stage: 'H5',
  status: 'PASS',
  observedAt: OBSERVED_AT,
  startingSnapshot: STARTING_SNAPSHOT,
  changeClass: 'validation-and-maintainer-evidence',
  scope: 'pre-Entities-boundary-seal',
  humanDecision: 'provided-by-direct-H5-implementation-request-and-H4-handoff',
  outcomes,
  closedFindings,
  protectedExistingSeams: Object.freeze(['H0-B013']),
  deferredFindings: Object.freeze(['H0-B014']),
  negativeGuardrails: Object.freeze({
    required: 12,
    executedCases: negativeMatrix.executedNegativeCaseCount,
    status: negativeMatrix.status,
    mutationProofs: importPolicy.driftProof.cases.length,
    automaticFallback: false
  }),
  referenceConformance: Object.freeze({
    focusedTasks: FOCUSED_TASKS.length,
    status: 'PASS',
    sixCellSemanticEvaluations: h4Matrix.completedSemanticEvaluations,
    skippedRequiredEvaluations: h4Matrix.skippedRequiredEvaluations,
    exactInputOutputFailureParity: h4Matrix.exactInputOutputFailureParity,
    automaticFallback: false
  }),
  validation: Object.freeze({
    negativeRun,
    focusedRun,
    packageBuildRun,
    packageTestRun,
    maintainerCheck: 'run-as-final-aggregate-validation',
    result: 'PASS'
  }),
  outputs: Object.freeze({
    ownerMap: ownerMapOutput,
    negativeMatrix: outputRecord('wasm/.test-results/boundary-h5/boundary-negative-matrix.json'),
    importPolicy: outputRecord('wasm/.test-results/boundary-h5/boundary-import-policy.json'),
    referenceConsumerConformance: referenceOutput,
    deferredRefactorLedger: deferredOutput,
    finalHandoff: handoffOutput
  }),
  filesChanged: Object.freeze([
    'wasm/test/contracts/boundary-drift-h5.cjs',
    'wasm/test/contracts/assert-boundary-negative-h5.cjs',
    'wasm/test/contracts/assert-boundary-authority-h5.cjs',
    'wasm/test/suite/registry.cjs',
    'wasm/test/suite/assert-suite-shape.cjs',
    'wasm/.test-results/boundary-h5/*'
  ]),
  productSourceChanged: false,
  architectureChanged: false,
  runtimeSemanticsChanged: false,
  publicApiChanged: false,
  fallbackChanged: false,
  risksOrBlockers: Object.freeze([]),
  nextAuthorizedFocus: 'Entities boundary design and implementation'
});
writeJson('boundary-h5-seal.json', seal);

console.log('ok - H5 seals boundary ownership, shape protection, import direction, and Crypto/JWT reference conformance; Entities seam readiness is READY');
