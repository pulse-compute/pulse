#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isPublicDocumentationSource } = require('../../../scripts/documentation-system.cjs');
const { publicPageSources, publicAssetSources } = require('../../../scripts/build-docs-site.cjs');
const { buildExpectedFiles } = require('../../scripts/sync-reference-docs.cjs');

function assertDocumentationSources() {
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-doc-source-policy-'));
  try {
    for (const source of [...excluded, ...included]) {
      fs.mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
      fs.writeFileSync(path.join(root, source), source.endsWith('.json') ? '{}' : '# Fixture\n');
    }
    for (const source of excluded) {
      assert.equal(isPublicDocumentationSource(source), false, source);
      assert.equal(isPublicDocumentationSource(source.replaceAll('/', '\\')), false, source);
    }
    for (const source of included) assert.equal(isPublicDocumentationSource(source), true, source);
    assert.equal(isPublicDocumentationSource('docs/../private.json'), false);
    assert.deepEqual(publicPageSources(root).filter((source) => source.startsWith('docs/')), [included[0]]);
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
