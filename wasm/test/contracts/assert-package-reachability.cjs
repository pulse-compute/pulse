#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
process.chdir(repoRoot);

const graphContract = require('../../packages/contracts/src/project/reachable-graph.js');
const {
  compileCanonicalProject,
  CanonicalProjectCompileError
} = require('../../packages/compiler/src/canonical-project-compiler.js');
const {
  buildReachableProjectGraph
} = require('../../packages/compiler/src/project/reachable-graph-builder.js');
const {
  compilerReachableGraphImplementationContract
} = require('../../packages/compiler/src/project/reachable-graph-implementation.js');
const {
  PACKAGE_CONTRACT_CATALOG_VERSION,
  discoverPackageContractCatalog,
  packageOperationRecognitionForCompiled
} = require('../../packages/compiler/src/spine/package-operation-seam.js');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { compileProject } = require('../../packages/cli/src/project-execution.js');

const fixtureRoot = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects', 'reachable-packages', 'router');

function write(root, relative, source) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
}

function options(rootDir, extra = {}) {
  return {
    rootDir,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(rootDir, 'tsconfig.json'),
    applicationProjectMetadata: {
      selectedProfile: { name: 'test', source: 'fixture' },
      strict: true,
      target: 'native',
      host: 'fastly',
      projectHash: '3'.repeat(64),
      configPlanHash: '4'.repeat(64),
      bindings: { config: [], secret: [] },
      fragments: {}
    },
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    ...extra
  };
}

function compileFixture(rootDir = fixtureRoot) {
  return compileCanonicalProject(path.join(rootDir, 'src', 'index.ts'), options(rootDir));
}

function expectDiagnostic(root, code, expectedFile, sources, extra = {}) {
  for (const [relative, source] of Object.entries(sources)) write(root, relative, source);
  if (!fs.existsSync(path.join(root, 'tsconfig.json'))) write(root, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  assert.throws(
    () => compileCanonicalProject(path.join(root, 'src', 'index.ts'), options(root, extra)),
    (error) => {
      assert.ok(error instanceof CanonicalProjectCompileError || error && Array.isArray(error.diagnostics), error && error.stack);
      const diagnostic = (error.diagnostics || []).find((entry) => entry.code === code);
      assert.ok(diagnostic, `expected ${code}; got ${(error.diagnostics || []).map((entry) => entry.code).join(', ')}`);
      if (expectedFile) assert.equal(diagnostic.file, expectedFile);
      assert.equal(error.code === code || error.diagnostics.some((entry) => entry.code === code), true);
      return true;
    }
  );
}

const implementation = compilerReachableGraphImplementationContract();
assert.equal(implementation.version, 'pulse.compiler-reachable-graph-contract.v3');
assert.equal(implementation.implementation.packageReachabilityImplemented, true);
assert.equal(implementation.implementation.packageBindingOwnershipImplemented, true);
assert.equal(implementation.implementation.packageReExportOwnershipImplemented, true);
assert.equal(implementation.implementation.lifecycleReachabilityImplemented, true);
assert.equal(implementation.implementation.eligibilityProjectionImplemented, true);
assert.equal(implementation.implementation.cacheImplemented, false);
assert.equal(implementation.implementation.bundlerImplemented, false);

const projectionContract = graphContract.defaultReachableGraphProjectionContract();
assert.equal(projectionContract.packageReachabilityVersion, 'pulse.package-reachability-projection.v1');
assert.equal(projectionContract.packageBindingVersion, 'pulse.package-binding-ownership.v1');
assert.equal(projectionContract.applicationEntrySafetyVersion, 'pulse.application-entry-safety.v1');
assert.equal(projectionContract.nativeEligibilityVersion, 'pulse.native-eligibility-projection.v1');
assert.equal(projectionContract.policies.packageLoweringSeamUnchanged, true);
assert.equal(projectionContract.policies.externalCompilerPlugins, false);
assert.equal(projectionContract.policies.automaticTargetFallback, false);

const catalog = discoverPackageContractCatalog({ cwd: fixtureRoot, workspaceRoot: repoRoot });
assert.equal(catalog.version, PACKAGE_CONTRACT_CATALOG_VERSION);
assert.deepEqual(catalog.contracts.map((entry) => entry.contractId), ['pulse.assets', 'pulse.entities', 'pulse.grip', 'pulse.jwt', 'pulse.s3']);
assert.deepEqual(catalog.contracts.map((entry) => entry.lowerableSubpath), [
  '@pulse-compute/assets',
  '@pulse-compute/entities',
  '@pulse-compute/grip',
  '@pulse-compute/jwt',
  '@pulse-compute/s3'
]);
assert.deepEqual(catalog.contracts.map((entry) => entry.compatibilitySubpaths), [
  ['@pulse-compute/assets/pulsewasm'],
  [],
  ['@pulse-compute/grip/pulsewasm'],
  [],
  []
]);
assert.ok(catalog.contracts.every((entry) => entry.compilerTrust === 'first-party'));
assert.ok(catalog.contracts.every((entry) => entry.targetSupport.native === true));
assert.ok(catalog.contracts.filter((entry) => entry.contractId !== 'pulse.s3').every((entry) => entry.targetSupport.javascript === 'declared'));
assert.equal(catalog.contracts.find((entry) => entry.contractId === 'pulse.s3').targetSupport.javascript, 'declared');
const entitiesCatalogContract = catalog.contracts.find((entry) => entry.contractId === 'pulse.entities');
assert.equal(entitiesCatalogContract.targetSupport.native, true);
assert.equal(entitiesCatalogContract.targetSupport.javascript, 'declared');
assert.equal(entitiesCatalogContract.productContract.targets.native.status, 'provider-dependent');
assert.equal(entitiesCatalogContract.productContract.targets.javascript.status, 'supported');
assert.equal(catalog.policy.sourceSubstringSelection, false);
assert.equal(catalog.policy.graphReachabilitySelection, true);
assert.equal(catalog.policy.publicRegistration, false);

const project = compileFixture();
const repeated = compileFixture();
assert.match(project.reachableGraph.graphHash, /^[a-f0-9]{64}$/);
assert.deepEqual(project.reachableGraph, repeated.reachableGraph);
assert.deepEqual(project.packageReachability, repeated.packageReachability);
assert.deepEqual(project.entrySafety, repeated.entrySafety);
assert.deepEqual(project.nativeEligibility, repeated.nativeEligibility);
assert.equal(project.packageReachability.version, projectionContract.packageReachabilityVersion);
assert.deepEqual(project.packageReachability.selectedContracts, ['pulse.grip']);
assert.equal(project.packageReachability.policy.packageUseFromResolvedReachabilityOnly, true);
assert.equal(project.packageReachability.policy.substringSelection, false);
assert.equal(project.packageReachability.policy.publicPluginApi, false);
const gripPackage = project.packageReachability.packages.find((entry) => entry.contractId === 'pulse.grip');
assert.ok(gripPackage);
assert.equal(gripPackage.nativeStatus, 'trusted-lowerable');
assert.equal(gripPackage.packageSubpath, './pulsewasm');
assert.deepEqual(gripPackage.facadeSymbols, ['broadcast', 'handoff', 'isWebSocket', 'subscribe']);
const gripBinding = project.packageReachability.bindings.find((entry) => entry.contractId === 'pulse.grip' && entry.localName === 'grip');
assert.ok(gripBinding);
assert.equal(gripBinding.via, 'direct-import');
assert.equal(gripBinding.direct, true);
assert.equal(gripBinding.used, true);
assert.equal(gripBinding.source.file, 'src/routes/events.ts');
assert.equal(project.entrySafety.importSafe, true);
assert.deepEqual(project.entrySafety.lifecycleEdges, []);
assert.equal(project.nativeEligibility.eligible, true);
assert.deepEqual(project.nativeEligibility.blockers, []);
assert.equal(project.nativeEligibility.policy.automaticFallback, false);
assert.equal(project.nativeEligibility.policy.selectedTargetChangesEligibility, false);
assert.equal(project.reachableGraph.modules.find((entry) => entry.packageContract === 'pulse.grip').owner, 'pulse-package');
assert.equal(project.reachableGraph.edges.some((entry) => entry.kind === 'package-contract' && entry.packageContract === 'pulse.grip'), true);
assert.equal(project.reachableGraph.edges.some((entry) => entry.kind === 'type-import' && entry.specifier === '@pulse-compute/grip/pulsewasm' && entry.runtime === false), true);
assert.deepEqual(project.metadata.effectSites.map((entry) => entry.kind), ['grip.channel', 'grip.hold', 'grip.publish']);
assert.ok(project.metadata.effectSites.every((entry) => entry.position.file === 'src/routes/events.ts'));
assert.doesNotMatch(project.generatedSource, /grip\.(?:channel|hold|publish)\s*\(/);
const recognition = packageOperationRecognitionForCompiled(project);
assert.equal(recognition.policy.selection, 'reachable-graph-per-module');
assert.deepEqual(recognition.selectedContracts, ['pulse.grip']);
assert.deepEqual(recognition.operations.map((entry) => entry.id), [
  'pulse.grip:1:grip.channel',
  'pulse.grip:2:grip.hold',
  'pulse.grip:3:grip.publish'
]);
assert.ok(recognition.operations.every((entry) => entry.source.file === 'src/routes/events.ts'));
assert.ok(project.watchFiles.some((file) => file.endsWith(path.join('packages', 'grip', 'pulsewasm.manifest.cjs'))));

const resolved = resolveProject({ cwd: fixtureRoot, env: {} });
const cliCompiled = compileProject(resolved);
assert.equal(cliCompiled.reachableGraph.graphHash, project.reachableGraph.graphHash);
assert.deepEqual(cliCompiled.packageReachability.selectedContracts, ['pulse.grip']);
assert.equal(cliCompiled.entrySafety.importSafe, true);
assert.equal(cliCompiled.nativeEligibility.eligible, true);

const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-package-reachability-portable-'));
try {
  const copied = path.join(portableRoot, 'router');
  fs.cpSync(fixtureRoot, copied, { recursive: true });
  const copiedProject = compileFixture(copied);
  assert.equal(copiedProject.reachableGraph.graphHash, project.reachableGraph.graphHash);
  assert.deepEqual(copiedProject.packageReachability, project.packageReachability);
  assert.deepEqual(copiedProject.nativeEligibility, project.nativeEligibility);
} finally {
  fs.rmSync(portableRoot, { recursive: true, force: true });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-package-reachability-contract-'));
try {
  const commentRoot = path.join(tempRoot, 'comment-only');
  write(commentRoot, 'src/index.ts', `// @pulse-compute/grip/pulsewasm must not select a lowerer\nexport default async function handler(ctx) { return ctx.text('ok') }\n`);
  write(commentRoot, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  const commentOnly = compileCanonicalProject(path.join(commentRoot, 'src', 'index.ts'), options(commentRoot, { applicationProjectMetadata: undefined }));
  assert.deepEqual(commentOnly.packageReachability.selectedContracts, []);
  assert.equal(commentOnly.metadata.packageEffectCount, 0);

  const typeOnlyRoot = path.join(tempRoot, 'type-only');
  write(typeOnlyRoot, 'src/index.ts', `import type { GripHold } from '@pulse-compute/grip/pulsewasm'\nexport default async function handler(ctx) { const value: GripHold | undefined = undefined; void value; return ctx.text('ok') }\n`);
  write(typeOnlyRoot, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  const typeOnly = compileCanonicalProject(path.join(typeOnlyRoot, 'src', 'index.ts'), options(typeOnlyRoot, { applicationProjectMetadata: undefined }));
  assert.deepEqual(typeOnly.packageReachability.selectedContracts, []);
  assert.equal(typeOnly.nativeEligibility.eligible, true);
  assert.equal(typeOnly.metadata.packageEffectCount, 0);

  const unsupportedRoot = path.join(tempRoot, 'unsupported-package');
  expectDiagnostic(unsupportedRoot, 'PULSE_NATIVE_IMPORT_UNSUPPORTED', 'src/handler.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'\nimport { handler } from './handler.js'\nconst app = new Pulse({ auto: true })\napp.get('/', handler)\nexport default app\n`,
    'src/handler.ts': `import ts from 'typescript'\nexport async function handler(ctx) { return ctx.text(ts.version) }\n`
  });

  const wrongSubpathRoot = path.join(tempRoot, 'wrong-subpath');
  expectDiagnostic(wrongSubpathRoot, 'PULSE_PACKAGE_SUBPATH_UNSUPPORTED', 'src/handler.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'\nimport { handler } from './handler.js'\nconst app = new Pulse({ auto: true })\napp.get('/', handler)\nexport default app\n`,
    'src/handler.ts': `import { grip } from '@pulse-compute/grip/unsupported'\nexport async function handler(ctx) { return ctx.text(String(grip)) }\n`
  });

  const entitiesProviderDependentRoot = path.join(tempRoot, 'entities-provider-dependent');
  write(entitiesProviderDependentRoot, 'src/index.ts', `import { EntityRouter, jsonRpc } from '@pulse-compute/entities'\nconst rpc = new EntityRouter({ adapter: jsonRpc() })\nexport default function handler(ctx) { return rpc.handle(ctx) }\n`);
  write(entitiesProviderDependentRoot, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  const entitiesProviderDependent = compileCanonicalProject(
    path.join(entitiesProviderDependentRoot, 'src', 'index.ts'),
    options(entitiesProviderDependentRoot)
  );
  assert.equal(entitiesProviderDependent.nativeEligibility.eligible, true);
  assert.deepEqual(entitiesProviderDependent.packageReachability.selectedContracts, ['pulse.entities']);
  assert.equal(entitiesProviderDependent.packageApplication.realization, 'provider-dependent');
  assert.equal(entitiesProviderDependent.packageInspection.artifacts[0].data.version, 'pulse.entities-catalog.v1');

  const reExportRoot = path.join(tempRoot, 'package-re-export');
  expectDiagnostic(reExportRoot, 'PULSE_PACKAGE_REEXPORT_LOWERING_DEFERRED', 'src/handler.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'\nimport { handler } from './handler.js'\nconst app = new Pulse({ auto: true })\napp.get('/', handler)\nexport default app\n`,
    'src/package.ts': `export { grip } from '@pulse-compute/grip/pulsewasm'\n`,
    'src/handler.ts': `import { grip } from './package.js'\nexport async function handler(ctx) { await grip.channel('events:test'); return grip.hold('stream') }\n`
  });

  const lifecycleRoot = path.join(tempRoot, 'lifecycle');
  expectDiagnostic(lifecycleRoot, 'PULSE_APPLICATION_ENTRY_LIFECYCLE_SIDE_EFFECT', 'src/index.ts', {
    'src/provider.ts': `export { serve } from '@pulse-compute/provider-fastly'\n`,
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'\nimport { serve } from './provider.js'\nconst app = new Pulse({ auto: true })\napp.get('/', async (ctx) => ctx.text('ok'))\nserve(app)\nexport default app\n`
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`ok - package reachability selects ${project.packageReachability.selectedContracts.join(', ')}, owns ${project.packageReachability.bindings.length} bindings, and rejects unsupported boundaries without fallback`);
