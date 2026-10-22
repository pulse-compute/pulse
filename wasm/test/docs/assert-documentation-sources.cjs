#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isPublicDocumentationSource } = require('../../../scripts/documentation-system.cjs');
const { SOURCE_CONTRACT, publicPageSources, publicAssetSources } = require('../../../scripts/documentation-sources.cjs');
const { buildExpectedFiles, transformCliCopy } = require('../../scripts/sync-reference-docs.cjs');

function assertDocumentationSources() {
  // Importing the source owner must not execute presentation or release code.
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function (request, ...args) {
      assert(!/build-docs-site|documentation-site-config|documentation-release|package-support/.test(request), request);
      return load.call(this, request, ...args);
    };
    const source = require('./scripts/documentation-sources.cjs');
    assert(source.publicPageSources().length > 0);
    assert(source.publicAssetSources().length > 0);
  `], { cwd: path.resolve(__dirname, '../../..'), stdio: 'pipe' });
  assert.equal(SOURCE_CONTRACT.schemaVersion, 'pulse.documentation-sources.v1');
  assert.equal(SOURCE_CONTRACT.assetPolicy, 'eligible-documentation-non-markdown');
  assert.equal(SOURCE_CONTRACT.documentationRoot, 'docs/');
  assert.equal(SOURCE_CONTRACT.examplesRoot, 'examples/');
  assert.deepEqual(Object.keys(SOURCE_CONTRACT).sort(), [
    'schemaVersion', 'rootRoutes', 'documentationRoot', 'examplesRoot',
    'excludedSegments', 'excludedPrefixes', 'excludedNames', 'sourceAliases',
    'routeAliases', 'hiddenPrefixes', 'assetPolicy'
  ].sort());
  const { sourceToRoute } = require('../../../scripts/documentation-system.cjs');
  for (const [source, route] of Object.entries(SOURCE_CONTRACT.rootRoutes)) assert.equal(sourceToRoute(source), route);
  assert.deepEqual(SOURCE_CONTRACT.sourceAliases, { 'examples/README.md': 'docs/examples.md' });

  const excluded = [
    'docs/AGENTS.md',
    'docs/contributing/AGENTS.md',
    'docs/internal/run.md',
    'docs/internal/run.json',
    'docs/architecture/decisions/history.md',
    'docs/architecture/decisions/evidence.json',
    'docs/guides/internal/run.json'
  ];
  const included = ['docs/guides/current.md', 'docs/fixtures/selected.json'];
  const from = 'docs/architecture/current-contracts.md';
  for (const target of ['../internal/proof.md#result', './decisions/history.md', '../AGENTS.md']) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
    assert.equal(transformCliCopy(from, `[Evidence](${target})`),
      `Evidence (repository-only: \`${resolved}\`)\n`, 'excluded source stays a readable checkout pointer');
  }
  for (const markdown of [
    '[Public](../guides/current.md#result)', '[Hosted](https://example.test/proof)',
    '![Image](../internal/proof.png)', '`[Literal](../internal/proof.md)`',
    '```md\n[Literal](../internal/proof.md)\n```',
    '~~~md\n[Literal](../internal/proof.md)\n~~~'
  ]) assert.equal(transformCliCopy(from, markdown), markdown + '\n', 'preserve public links and literal/image content');
  const pages = ['README.md', 'API.md', 'CHANGELOG.md', 'docs/README.md', 'docs/examples.md', 'docs/nested/README.md', 'examples/demo/README.md'];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-doc-source-policy-'));
  try {
    for (const source of [...excluded, ...included, ...pages, 'examples/README.md']) {
      fs.mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
      fs.writeFileSync(path.join(root, source), source.endsWith('.json') ? '{}' : '# Fixture\n');
    }
    for (const source of excluded) {
      assert.equal(isPublicDocumentationSource(source), false, source);
      assert.equal(isPublicDocumentationSource(source.replaceAll('/', '\\')), false, source);
    }
    for (const source of included) assert.equal(isPublicDocumentationSource(source), true, source);
    assert.equal(isPublicDocumentationSource('docs/../private.json'), false);
    assert.deepEqual(publicPageSources(root), [...pages, included[0]].sort());
    assert.equal(sourceToRoute('docs/nested/README.md'), 'nested/');
    assert.equal(sourceToRoute('examples/demo/README.md'), 'examples/demo/');
    assert.equal(sourceToRoute('docs/guides/current.md'), 'guides/current/');
    assert.equal(isPublicDocumentationSource('docs/fixtures/AGENTS.md'), false);
    assert.deepEqual(publicAssetSources(root), [included[1]], 'repository-only JSON must not leak as hosted assets');

    const expected = buildExpectedFiles();
    const installed = [...expected.keys()].filter((file) => file.startsWith('wasm/packages/cli/docs/'));
    assert.ok(installed.length > 0, 'installed documentation must still be generated');
    for (const file of installed) {
      assert.equal(isPublicDocumentationSource(file.slice('wasm/packages/cli/'.length)), true, file);
    }
    assert.equal(expected.has('wasm/packages/cli/docs/maintainers/compiler-efficiency-p01.md'), false,
      'retired evidence must not be regenerated into the CLI');
    console.log('ok - documentation pages, assets and installed copies exclude repository-only evidence');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { assertDocumentationSources };
if (require.main === module) assertDocumentationSources();
