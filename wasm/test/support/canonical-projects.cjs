'use strict';

const path = require('node:path');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { compileProject } = require('../../packages/cli/src/project-execution.js');
const { loadCanonicalModule, compileCanonicalFile } = require('../../packages/compiler/src/canonical-api-compiler.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const examplesRoot = path.join(repoRoot, 'examples');
const internalFixtureRoot = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'internal-canonical');

const EXAMPLES = Object.freeze({
  hello: '01-hello-json',
  schema: '02-request-schema',
  fetchComposition: '03-fetch-composition',
  fastlyCapabilities: '05-fastly-capabilities',
  opaqueProxy: '07-opaque-proxy',
  router: '09-router-lowering',
  mcpProxy: '12-mcp-proxy'
});

function exampleRoot(id) {
  const root = path.resolve(examplesRoot, id);
  if (!root.startsWith(`${examplesRoot}${path.sep}`)) throw new Error(`canonical example escapes examples root: ${id}`);
  return root;
}

function resolveExample(id) {
  return resolveProject({ cwd: exampleRoot(id) });
}

function compileExample(id) {
  const project = resolveExample(id);
  const compiled = compileProject(project);
  return Object.freeze({ project, compiled, program: loadCanonicalModule(compiled) });
}

function internalFixture(name) {
  const file = path.join(internalFixtureRoot, name, 'app.ts');
  const compiled = compileCanonicalFile(file, { rootDir: path.join(repoRoot, 'wasm') });
  return Object.freeze({ file, compiled, program: loadCanonicalModule(compiled) });
}

module.exports = Object.freeze({
  repoRoot,
  examplesRoot,
  internalFixtureRoot,
  EXAMPLES,
  exampleRoot,
  resolveExample,
  compileExample,
  internalFixture
});
