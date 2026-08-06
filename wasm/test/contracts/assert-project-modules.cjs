#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
process.chdir(repoRoot);

const { compileCanonicalProject, CanonicalProjectCompileError } = require('../../packages/compiler/src/canonical-project-compiler.js');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { compileProject } = require('../../packages/cli/src/project-execution.js');
const { buildReachableProjectGraph } = require('../../packages/compiler/src/project/reachable-graph-builder.js');
const { compilerReachableGraphImplementationContract } = require('../../packages/compiler/src/project/reachable-graph-implementation.js');

const fixtureRoot = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects', 'reachable-modules');

function write(root, relative, source) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
}

function routerOptions(rootDir, extra = {}) {
  return {
    rootDir,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(rootDir, 'tsconfig.json'),
    applicationProjectMetadata: {
      selectedProfile: { name: 'test', source: 'fixture' },
      strict: true,
      target: 'native',
      host: 'node',
      projectHash: '1'.repeat(64),
      configPlanHash: '2'.repeat(64),
      bindings: { config: ['APP_VERSION'], secret: [] },
      fragments: {}
    },
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    ...extra
  };
}

function compileRouterFixture() {
  const rootDir = path.join(fixtureRoot, 'router');
  return compileCanonicalProject(path.join(rootDir, 'src', 'index.ts'), routerOptions(rootDir));
}

function expectCompileDiagnostic(root, code, expectedFile, sources, options = {}) {
  for (const [relative, source] of Object.entries(sources)) write(root, relative, source);
  if (!fs.existsSync(path.join(root, 'tsconfig.json'))) write(root, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  assert.throws(
    () => compileCanonicalProject(path.join(root, 'src', 'index.ts'), routerOptions(root, options)),
    (error) => {
      assert.ok(error instanceof CanonicalProjectCompileError || error && Array.isArray(error.diagnostics), error && error.stack);
      const diagnostic = (error.diagnostics || []).find((entry) => entry.code === code);
      assert.ok(diagnostic, `expected ${code}; got ${(error.diagnostics || []).map((entry) => entry.code).join(', ')}`);
      if (expectedFile) assert.equal(diagnostic.file, expectedFile);
      return true;
    }
  );
}

const implementation = compilerReachableGraphImplementationContract();
assert.equal(implementation.version, 'pulse.compiler-reachable-graph-contract.v3');
assert.equal(implementation.implementation.recursiveWalkerImplemented, true);
assert.equal(implementation.implementation.importedHandlerCompilationImplemented, true);
assert.equal(implementation.implementation.importedRouterCompilationImplemented, true);
assert.equal(implementation.implementation.sourceOwnershipImplemented, true);
assert.equal(implementation.implementation.runtimeCycleDiagnosticsImplemented, true);
assert.equal(implementation.implementation.unsupportedBoundaryDiagnosticsImplemented, true);
assert.equal(implementation.implementation.packageReachabilityImplemented, true);
assert.equal(implementation.implementation.packageBindingOwnershipImplemented, true);
assert.equal(implementation.implementation.packageReExportOwnershipImplemented, true);
assert.equal(implementation.implementation.lifecycleReachabilityImplemented, true);
assert.equal(implementation.implementation.eligibilityProjectionImplemented, true);
assert.equal(implementation.implementation.cacheImplemented, false);
assert.equal(implementation.implementation.bundlerImplemented, false);

const router = compileRouterFixture();
const routerAgain = compileRouterFixture();
assert.deepEqual(router.reachableGraph, routerAgain.reachableGraph);
assert.equal(router.moduleLinkage.linked, true);
assert.equal(router.moduleLinkage.summary.projectModules, 5);
assert.equal(router.moduleLinkage.summary.runtimeProjectModules, 4);
assert.equal(router.reachableGraph.modules.filter((entry) => entry.kind === 'project').length, 5);
assert.equal(router.reachableGraph.edges.length, 7);
assert.equal(router.reachableGraph.handlers.length, 5);
assert.equal(router.reachableGraph.cycles.length, 0);
assert.equal(router.reachableGraph.firstUnsupportedBoundary, null);
assert.ok(router.reachableGraph.modules.every((entry) => !JSON.stringify(entry).includes(repoRoot)));
assert.equal(router.reachableGraph.edges.find((entry) => entry.kind === 'type-import').runtime, false);
assert.equal(router.reachableGraph.modules.find((entry) => entry.path === 'src/types/user.ts').runtime, false);
assert.deepEqual(router.router.routePlan.routes.map((route) => `${route.method} ${route.path}`), ['GET /users/:id', 'GET /api/users']);
assert.deepEqual(router.router.handlerTable.handlers.map((entry) => entry.file), ['src/handlers/user.ts', 'src/handlers/user.ts', 'src/handlers/user.ts']);
assert.deepEqual(router.metadata.effectSites.map((effect) => [effect.id, effect.kind]), [['config-1', 'config.get']]);
assert.deepEqual(router.metadata.continuationSites.map((site) => [site.id, site.effectIds]), [['continuation-1', ['config-1']]]);
assert.notEqual(router.router.handlerTable.handlers[0].symbolId, router.router.handlerTable.handlers[1].symbolId);
assert.deepEqual(router.reachableGraph.handlers.find((entry) => entry.localName === 'getUser').wrappers, ['parentheses', 'satisfies']);
assert.deepEqual(router.reachableGraph.handlers.find((entry) => entry.localName === 'api').wrappers, ['as-cast', 'parentheses']);
assert.equal(router.reachableGraph.handlers.find((entry) => entry.localName === 'listUsers').source.file, 'src/routers/api.ts');
assert.ok(router.watchFiles.some((file) => file.endsWith(path.join('src', 'types', 'user.ts'))));
assert.doesNotMatch(router.generatedSource, /\bPromise\b|Asyncify|async function|await\s/);

const resolvedProject = resolveProject({ cwd: path.join(fixtureRoot, 'router'), env: {} });
const cliCompiled = compileProject(resolvedProject);
assert.equal(cliCompiled.reachableGraph.version, 'pulse.reachable-graph-manifest.v2');
assert.deepEqual(cliCompiled.router.routePlan.routes.map((route) => route.path), ['/users/:id', '/api/users']);
assert.deepEqual(cliCompiled.metadata.effectSites.map((effect) => effect.kind), ['config.get']);
assert.equal(cliCompiled.moduleLinkage.summary.runtimeProjectModules, 4);

const plainRoot = path.join(fixtureRoot, 'plain');
const plain = compileCanonicalProject(path.join(plainRoot, 'src', 'index.ts'), {
  rootDir: plainRoot,
  workspaceRoot: repoRoot,
  tsconfigFile: path.join(plainRoot, 'tsconfig.json'),
  strict: true,
  requireAsync: true,
  requireEffectAwait: true
});
assert.equal(plain.moduleLinkage.linked, true);
assert.equal(plain.metadata.file, 'src/handler.ts');
assert.equal(plain.reachableGraph.handlers.length, 1);
assert.equal(plain.reachableGraph.handlers[0].role, 'handler');
assert.equal(plain.reachableGraph.handlers[0].source.file, 'src/handler.ts');

const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-project-modules-portable-'));
try {
  const sourceRoot = path.join(fixtureRoot, 'router');
  const copiedRoot = path.join(portableRoot, 'router');
  fs.cpSync(sourceRoot, copiedRoot, { recursive: true });
  const sourceGraph = buildReachableProjectGraph(path.join(sourceRoot, 'src', 'index.ts'), {
    rootDir: sourceRoot,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(sourceRoot, 'tsconfig.json')
  }).graph;
  const copiedGraph = buildReachableProjectGraph(path.join(copiedRoot, 'src', 'index.ts'), {
    rootDir: copiedRoot,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(copiedRoot, 'tsconfig.json')
  }).graph;
  assert.equal(copiedGraph.graphHash, sourceGraph.graphHash);
  assert.deepEqual(copiedGraph.modules, sourceGraph.modules);
  const sourceHandler = sourceGraph.modules.find((entry) => entry.path === 'src/handlers/user.ts');
  const copiedHandler = copiedGraph.modules.find((entry) => entry.path === 'src/handlers/user.ts');
  assert.equal(copiedHandler.id, sourceHandler.id);
  fs.appendFileSync(path.join(copiedRoot, 'src', 'handlers', 'user.ts'), '\n// content-only graph identity proof\n');
  const changedGraph = buildReachableProjectGraph(path.join(copiedRoot, 'src', 'index.ts'), {
    rootDir: copiedRoot,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(copiedRoot, 'tsconfig.json')
  }).graph;
  const changedHandler = changedGraph.modules.find((entry) => entry.path === 'src/handlers/user.ts');
  assert.equal(changedHandler.id, sourceHandler.id);
  assert.notEqual(changedGraph.graphHash, sourceGraph.graphHash);
  assert.notEqual(changedHandler.contentHash, sourceHandler.contentHash);
} finally {
  fs.rmSync(portableRoot, { recursive: true, force: true });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-project-modules-contract-'));
try {
  const anonymousRoot = path.join(tempRoot, 'anonymous');
  write(anonymousRoot, 'src/index.ts', `export default async function (ctx) { return ctx.json({ ok: true }) }\n`);
  write(anonymousRoot, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  const anonymous = compileCanonicalProject(path.join(anonymousRoot, 'src', 'index.ts'), {
    rootDir: anonymousRoot,
    workspaceRoot: repoRoot,
    strict: true,
    requireAsync: true,
    requireEffectAwait: true
  });
  assert.equal(anonymous.moduleLinkage.linked, false);
  assert.equal(anonymous.reachableGraph.handlers[0].localName, '<default-handler>');

  const cycleRoot = path.join(tempRoot, 'cycle');
  expectCompileDiagnostic(cycleRoot, 'PULSE_PROJECT_MODULE_CYCLE_UNSUPPORTED', 'src/a.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'\nimport './a.js'\nconst app = new Pulse({ auto: true })\napp.get('/', async (ctx) => ctx.text('ok'))\nexport default app\n`,
    'src/a.ts': `import './b.js'\nexport const a = true\n`,
    'src/b.ts': `import './a.js'\nexport const b = true\n`
  });

  const dynamicRoot = path.join(tempRoot, 'dynamic');
  expectCompileDiagnostic(dynamicRoot, 'PULSE_PROJECT_DYNAMIC_IMPORT_UNSUPPORTED', 'src/handler.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'\nimport { handler } from './handler.js'\nconst app = new Pulse({ auto: true })\napp.get('/', handler)\nexport default app\n`,
    'src/handler.ts': `export async function handler(ctx) { await import('./later.js'); return ctx.text('ok') }\n`,
    'src/later.ts': `export const later = true\n`
  });

  const requireRoot = path.join(tempRoot, 'require');
  expectCompileDiagnostic(requireRoot, 'PULSE_PROJECT_COMMONJS_REQUIRE_UNSUPPORTED', 'src/handler.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'\nimport { handler } from './handler.js'\nconst app = new Pulse({ auto: true })\napp.get('/', handler)\nexport default app\n`,
    'src/handler.ts': `export async function handler(ctx) { require('./module.cjs'); return ctx.text('ok') }\n`
  });

  const missingRoot = path.join(tempRoot, 'missing');
  expectCompileDiagnostic(missingRoot, 'PULSE_PROJECT_MODULE_NOT_FOUND', 'src/index.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'\nimport { handler } from './missing.js'\nconst app = new Pulse({ auto: true })\napp.get('/', handler)\nexport default app\n`
  });

  const namespaceRoot = path.join(tempRoot, 'namespace');
  expectCompileDiagnostic(namespaceRoot, 'PULSE_PROJECT_NAMESPACE_HANDLER_REFERENCE_UNSUPPORTED', 'src/index.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'\nimport * as handlers from './handler.js'\nconst app = new Pulse({ auto: true })\napp.get('/', handlers)\nexport default app\n`,
    'src/handler.ts': `export async function handler(ctx) { return ctx.text('ok') }\n`
  });

  const valueImportRoot = path.join(tempRoot, 'runtime-value-import');
  expectCompileDiagnostic(valueImportRoot, 'PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED', 'src/handler.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'
import { handler } from './handler.js'
const app = new Pulse({ auto: true })
app.get('/', handler)
export default app
`,
    'src/handler.ts': `import { message } from './helper.js'
export async function handler(ctx) { return ctx.text(message) }
`,
    'src/helper.ts': `export const message = 'hello'
`
  });

  const sideEffectRoot = path.join(tempRoot, 'runtime-side-effect-import');
  expectCompileDiagnostic(sideEffectRoot, 'PULSE_PROJECT_RUNTIME_SIDE_EFFECT_IMPORT_UNSUPPORTED', 'src/handler.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'
import { handler } from './handler.js'
const app = new Pulse({ auto: true })
app.get('/', handler)
export default app
`,
    'src/handler.ts': `import './setup.js'
export async function handler(ctx) { return ctx.text('ok') }
`,
    'src/setup.ts': `export const configured = true
`
  });

  const syncRoot = path.join(tempRoot, 'sync');
  expectCompileDiagnostic(syncRoot, 'PULSE_HANDLER_ASYNC_REQUIRED', 'src/handler.ts', {
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse'\nimport { handler } from './handler.js'\nconst app = new Pulse({ auto: true })\napp.get('/', handler)\nexport default app\n`,
    'src/handler.ts': `export function handler(ctx) { return ctx.text('ok') }\n`
  });

  const duplicateRoot = path.join(tempRoot, 'duplicate');
  write(duplicateRoot, 'src/a.ts', `export async function handler(ctx) { return ctx.text('a') }\n`);
  write(duplicateRoot, 'src/b.ts', `export async function handler(ctx) { return ctx.text('b') }\n`);
  write(duplicateRoot, 'src/index.ts', `import { Pulse } from '@pulse-compute/pulse'\nimport { handler as a } from './a.js'\nimport { handler as b } from './b.js'\nconst app = new Pulse({ auto: true })\napp.get('/a', a)\napp.get('/b', b)\nexport default app\n`);
  write(duplicateRoot, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  const duplicate = compileCanonicalProject(path.join(duplicateRoot, 'src', 'index.ts'), routerOptions(duplicateRoot));
  assert.equal(duplicate.router.handlerTable.handlers.length, 2);
  assert.deepEqual(duplicate.router.handlerTable.handlers.map((entry) => entry.localName), ['handler', 'handler']);
  assert.equal(new Set(duplicate.router.handlerTable.handlers.map((entry) => entry.symbolId)).size, 2);
  assert.equal(new Set(duplicate.router.handlerTable.handlers.map((entry) => entry.id)).size, 2);
  assert.deepEqual(duplicate.router.handlerTable.handlers.map((entry) => entry.file).sort(), ['src/a.ts', 'src/b.ts']);

  const extendsRoot = path.join(tempRoot, 'extends');
  write(extendsRoot, 'src/index.ts', `export default async function handler(ctx) { return ctx.text('ok') }\n`);
  write(extendsRoot, 'tsconfig.json', '{"extends":"./base.json","compilerOptions":{"baseUrl":"."}}\n');
  write(extendsRoot, 'base.json', '{"compilerOptions":{}}\n');
  assert.throws(
    () => buildReachableProjectGraph(path.join(extendsRoot, 'src', 'index.ts'), { rootDir: extendsRoot, workspaceRoot: repoRoot, tsconfigFile: path.join(extendsRoot, 'tsconfig.json') }),
    (error) => Boolean(error && error.diagnostics && error.diagnostics.some((entry) => entry.code === 'PULSE_PROJECT_TSCONFIG_EXTENDS_UNSUPPORTED'))
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`ok - project graph compiles ${router.moduleLinkage.summary.runtimeProjectModules} runtime modules through one Handler/Router IR path`);
